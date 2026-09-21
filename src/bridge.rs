//! Bounded persistent request/response lanes. Never replay an exchange after any write.
use crate::config::{BridgeConfig, BridgeSecret, MAX_FRAME, PROTOCOL};
use crate::fault::BridgeFault;
use anyhow::{Context, Result, ensure};
use serde_json::{Value, json};
use std::{hash::{Hash, Hasher}, sync::{Arc, atomic::{AtomicU64, Ordering}}, time::{Duration, Instant, SystemTime, UNIX_EPOCH}};
use tokio::{io::{AsyncBufReadExt, AsyncWriteExt, BufReader}, net::TcpStream, sync::{Mutex, OnceCell}, time::timeout};
use uuid::Uuid;

struct Connection { reader: BufReader<TcpStream>, used: Instant }
#[derive(Default)]
struct Counters { connects: AtomicU64, reused: AtomicU64, calls: AtomicU64, failures: AtomicU64, total_us: AtomicU64, connect_us: AtomicU64 }
#[derive(Clone)]
pub struct BridgeClient {
    config: Arc<BridgeConfig>,
    secret: Arc<BridgeSecret>,
    lanes: Arc<Vec<Mutex<Option<Connection>>>>,
    fast: Arc<OnceCell<bool>>,
    client_id: Arc<String>,
    counters: Arc<Counters>,
}
impl BridgeClient {
    pub fn new(config: BridgeConfig, secret: BridgeSecret) -> Result<Self> {
        ensure!(config.host == "127.0.0.1" && secret.host == config.host && secret.port == config.port,
            "bridge endpoint mismatch; preserve config and repair bridge.json, do not reset policy");
        Ok(Self { config: Arc::new(config), secret: Arc::new(secret),
            lanes: Arc::new((0..4).map(|_| Mutex::new(None)).collect()), fast: Arc::new(OnceCell::new()),
            client_id: Arc::new(Uuid::new_v4().to_string()), counters: Arc::new(Counters::default()) })
    }
    pub async fn supports_fast(&self) -> Result<bool> {
        Ok(*self.fast.get_or_try_init(|| async {
            let info=self.call("ping",json!({})).await?;
            Ok::<bool,anyhow::Error>(info["capabilities"].as_array().is_some_and(|c| c.iter().any(|v| v=="poll_bulk")))
        }).await?)
    }
    pub fn metrics(&self) -> Value {
        let c=&self.counters;
        json!({"connections_opened":c.connects.load(Ordering::Relaxed),"connections_reused":c.reused.load(Ordering::Relaxed),
            "bridge_rpc_calls":c.calls.load(Ordering::Relaxed),"bridge_rpc_failures":c.failures.load(Ordering::Relaxed),
            "bridge_rpc_total_us":c.total_us.load(Ordering::Relaxed),"connect_total_us":c.connect_us.load(Ordering::Relaxed),
            "pool_lanes":4,"automatic_replay":false})
    }
    pub async fn call(&self, method: &str, params: Value) -> Result<Value> {
        let started=Instant::now();
        self.counters.calls.fetch_add(1,Ordering::Relaxed);
        let mut h=std::collections::hash_map::DefaultHasher::new();
        params["capture_id"].as_str().unwrap_or("").hash(&mut h);
        // Keep control/interrupt traffic independent of a blocked polling lane.
        let lane=if matches!(method,"poll"|"poll_bulk") {1+(h.finish() as usize % 3)} else {0};
        let result=timeout(Duration::from_millis(self.config.request_timeout_ms), async {
            let mut guard=self.lanes[lane].lock().await;
            // Own the connection while awaiting. Cancellation drops it rather than leaving
            // a partial response for a future request on the shared lane.
            let mut connection=guard.take();
            if connection.as_ref().is_some_and(|c|c.used.elapsed()>Duration::from_secs(40)) { connection=None; }
            if let Some(c)=&connection {
                let mut probe=[0u8;1];
                // Detect a known closed/dirty idle lane before sending any request bytes.
                match c.reader.get_ref().try_read(&mut probe) {
                    Err(e) if e.kind()==std::io::ErrorKind::WouldBlock => {},
                    _ => { connection=None; }
                }
            }
            let mut connection=if let Some(c)=connection {
                self.counters.reused.fetch_add(1,Ordering::Relaxed); c
            } else {
                let start=Instant::now();
                let stream=timeout(Duration::from_millis(self.config.connect_timeout_ms),
                    TcpStream::connect(("127.0.0.1",self.config.port))).await
                    .context("bridge connect timeout; no request sent")?
                    .context("bridge connect failed; no request sent")?;
                stream.set_nodelay(true)?;
                self.counters.connects.fetch_add(1,Ordering::Relaxed);
                self.counters.connect_us.fetch_add(start.elapsed().as_micros() as u64,Ordering::Relaxed);
                Connection {reader:BufReader::new(stream),used:Instant::now()}
            };
            let id=Uuid::new_v4().to_string();
            let now=SystemTime::now().duration_since(UNIX_EPOCH)?.as_millis() as u64;
            let request=json!({"protocol_version":PROTOCOL,"id":id,"token":self.secret.token,
                "client_id":*self.client_id,"keep_alive":true,"deadline_ms":now+self.config.request_timeout_ms,
                "method":method,"params":params});
            let mut bytes=serde_json::to_vec(&request)?; bytes.push(b'\n');
            let limit=MAX_FRAME.min(self.secret.max_request_bytes);
            ensure!(bytes.len()<=limit,"request exceeds frame limit");
            connection.reader.get_mut().write_all(&bytes).await?;
            connection.reader.get_mut().flush().await?;
            let mut frame=Vec::new();
            loop {
                let buffer=connection.reader.fill_buf().await?;
                ensure!(!buffer.is_empty(),"bridge disconnected; exchange outcome unknown; never replay");
                let count=buffer.iter().position(|b|*b==b'\n').map_or(buffer.len(),|n|n+1);
                ensure!(frame.len()+count<=limit,"oversized bridge frame");
                frame.extend_from_slice(&buffer[..count]); connection.reader.consume(count);
                if frame.last()==Some(&b'\n') {break;}
            }
            let response:Value=serde_json::from_slice(&frame)?;
            ensure!(response["protocol_version"].as_u64()==Some(PROTOCOL as u64),"bridge protocol mismatch: upgrade and restart adapter");
            ensure!(response["id"]==id,"bridge response ID mismatch");
            ensure!(response["bridge_instance"].is_string(),"missing bridge identity");
            let ok=response["ok"].as_bool()==Some(true);
            if ok && response["persistent"].as_bool()==Some(true) && connection.reader.buffer().is_empty() {
                connection.used=Instant::now(); *guard=Some(connection);
            }
            if !ok {return Err(BridgeFault {message:format!("bridge rejected request: {}",response["error"]),sent:response["sent"].as_bool()}.into());}
            Ok(response["result"].clone())
        }).await.context("bridge timeout: outcome may be unknown; NEVER automatically replay a command")?;
        self.counters.total_us.fetch_add(started.elapsed().as_micros() as u64,Ordering::Relaxed);
        if result.is_err() {self.counters.failures.fetch_add(1,Ordering::Relaxed);}
        result
    }
}
