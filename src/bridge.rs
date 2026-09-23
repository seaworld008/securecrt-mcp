//! Authenticated Bridge transport for SecureCRT TCP and Xshell file IPC.
use crate::config::{BridgeConfig, BridgeSecret, MAX_FRAME, PROTOCOL};
use crate::fault::BridgeFault;
use anyhow::{Context, Result, ensure};
use serde_json::{Value, json};
use std::{
    hash::{Hash, Hasher},
    path::PathBuf,
    sync::{
        Arc,
        atomic::{AtomicU64, Ordering},
    },
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};
use tokio::{
    fs,
    io::{AsyncBufReadExt, AsyncWriteExt, BufReader},
    net::TcpStream,
    sync::{Mutex, OnceCell},
    time::{sleep, timeout},
};
use uuid::Uuid;

struct Connection {
    reader: BufReader<TcpStream>,
    used: Instant,
}

enum Transport {
    Tcp {
        lanes: Vec<Mutex<Option<Connection>>>,
    },
    File {
        ipc_dir: PathBuf,
        lane: Mutex<()>,
    },
}

#[derive(Default)]
struct Counters {
    connects: AtomicU64,
    reused: AtomicU64,
    calls: AtomicU64,
    failures: AtomicU64,
    total_us: AtomicU64,
    connect_us: AtomicU64,
}

#[derive(Clone)]
pub struct BridgeClient {
    config: Arc<BridgeConfig>,
    secret: Arc<BridgeSecret>,
    transport: Arc<Transport>,
    fast: Arc<OnceCell<bool>>,
    client_id: Arc<String>,
    counters: Arc<Counters>,
}

impl BridgeClient {
    pub fn new(config: BridgeConfig, secret: BridgeSecret) -> Result<Self> {
        ensure!(
            config.host == "127.0.0.1" && secret.host == config.host && secret.port == config.port,
            "bridge endpoint mismatch; preserve config and repair bridge.json, do not reset policy"
        );
        Ok(Self::build(
            config,
            secret,
            Transport::Tcp {
                lanes: (0..4).map(|_| Mutex::new(None)).collect(),
            },
        ))
    }

    pub fn new_file(config: BridgeConfig, secret: BridgeSecret, ipc_dir: PathBuf) -> Result<Self> {
        ensure!(
            ipc_dir.is_absolute(),
            "Xshell IPC directory must be absolute"
        );
        if let Some(configured) = &secret.ipc_dir {
            ensure!(
                PathBuf::from(configured) == ipc_dir,
                "Xshell IPC directory mismatch; run init"
            );
        }
        Ok(Self::build(
            config,
            secret,
            Transport::File {
                ipc_dir,
                lane: Mutex::new(()),
            },
        ))
    }

    fn build(config: BridgeConfig, secret: BridgeSecret, transport: Transport) -> Self {
        Self {
            config: Arc::new(config),
            secret: Arc::new(secret),
            transport: Arc::new(transport),
            fast: Arc::new(OnceCell::new()),
            client_id: Arc::new(Uuid::new_v4().to_string()),
            counters: Arc::new(Counters::default()),
        }
    }

    pub async fn supports_fast(&self) -> Result<bool> {
        Ok(*self
            .fast
            .get_or_try_init(|| async {
                let info = self.call("ping", json!({})).await?;
                Ok::<bool, anyhow::Error>(
                    info["capabilities"]
                        .as_array()
                        .is_some_and(|c| c.iter().any(|v| v == "poll_bulk")),
                )
            })
            .await?)
    }

    pub fn metrics(&self) -> Value {
        let c = &self.counters;
        let transport = match self.transport.as_ref() {
            Transport::Tcp { .. } => "tcp",
            Transport::File { .. } => "file_ipc",
        };
        json!({"connections_opened":c.connects.load(Ordering::Relaxed),"connections_reused":c.reused.load(Ordering::Relaxed),
            "bridge_rpc_calls":c.calls.load(Ordering::Relaxed),"bridge_rpc_failures":c.failures.load(Ordering::Relaxed),
            "bridge_rpc_total_us":c.total_us.load(Ordering::Relaxed),"connect_total_us":c.connect_us.load(Ordering::Relaxed),
            "pool_lanes":4,"transport":transport,"automatic_replay":false})
    }

    pub async fn call(&self, method: &str, params: Value) -> Result<Value> {
        let started = Instant::now();
        self.counters.calls.fetch_add(1, Ordering::Relaxed);
        let mut h = std::collections::hash_map::DefaultHasher::new();
        params["capture_id"].as_str().unwrap_or("").hash(&mut h);
        let lane = if matches!(method, "poll" | "poll_bulk") {
            1 + (h.finish() as usize % 3)
        } else {
            0
        };
        let result = timeout(
            Duration::from_millis(self.config.request_timeout_ms),
            async {
                match self.transport.as_ref() {
                    Transport::Tcp { lanes } => self.call_tcp(method, params, lane, lanes).await,
                    Transport::File { ipc_dir, lane } => {
                        self.call_file(method, params, ipc_dir, lane).await
                    }
                }
            },
        )
        .await
        .context("bridge timeout: outcome may be unknown; NEVER automatically replay a command")?;
        self.counters
            .total_us
            .fetch_add(started.elapsed().as_micros() as u64, Ordering::Relaxed);
        if result.is_err() {
            self.counters.failures.fetch_add(1, Ordering::Relaxed);
        }
        result
    }

    fn request(&self, method: &str, params: &Value, id: &str) -> Result<Vec<u8>> {
        let now = SystemTime::now().duration_since(UNIX_EPOCH)?.as_millis() as u64;
        let value = json!({"protocol_version":PROTOCOL,"id":id,"token":self.secret.token,"client_id":self.client_id,
            "keep_alive":true,"deadline_ms":now+self.config.request_timeout_ms,"method":method,"params":params});
        let bytes = serde_json::to_vec(&value)?;
        ensure!(
            bytes.len() <= MAX_FRAME.min(self.secret.max_request_bytes),
            "request exceeds frame limit"
        );
        Ok(bytes)
    }

    async fn call_tcp(
        &self,
        method: &str,
        params: Value,
        lane: usize,
        lanes: &[Mutex<Option<Connection>>],
    ) -> Result<Value> {
        let mut guard = lanes[lane].lock().await;
        let mut connection = guard.take();
        if connection
            .as_ref()
            .is_some_and(|c| c.used.elapsed() > Duration::from_secs(40))
        {
            connection = None;
        }
        if let Some(c) = &connection {
            let mut probe = [0u8; 1];
            match c.reader.get_ref().try_read(&mut probe) {
                Err(e) if e.kind() == std::io::ErrorKind::WouldBlock => {}
                _ => connection = None,
            }
        }
        let mut connection = if let Some(c) = connection {
            self.counters.reused.fetch_add(1, Ordering::Relaxed);
            c
        } else {
            let start = Instant::now();
            let stream = timeout(
                Duration::from_millis(self.config.connect_timeout_ms),
                TcpStream::connect(("127.0.0.1", self.config.port)),
            )
            .await
            .context("bridge connect timeout; no request sent")?
            .context("bridge connect failed; no request sent")?;
            stream.set_nodelay(true)?;
            self.counters.connects.fetch_add(1, Ordering::Relaxed);
            self.counters
                .connect_us
                .fetch_add(start.elapsed().as_micros() as u64, Ordering::Relaxed);
            Connection {
                reader: BufReader::new(stream),
                used: Instant::now(),
            }
        };
        let id = Uuid::new_v4().to_string();
        let mut bytes = self.request(method, &params, &id)?;
        bytes.push(b'\n');
        connection.reader.get_mut().write_all(&bytes).await?;
        connection.reader.get_mut().flush().await?;
        let mut frame = Vec::new();
        loop {
            let buffer = connection.reader.fill_buf().await?;
            ensure!(
                !buffer.is_empty(),
                "bridge disconnected; exchange outcome unknown; never replay"
            );
            let count = buffer
                .iter()
                .position(|b| *b == b'\n')
                .map_or(buffer.len(), |n| n + 1);
            ensure!(frame.len() + count <= MAX_FRAME, "oversized bridge frame");
            frame.extend_from_slice(&buffer[..count]);
            connection.reader.consume(count);
            if frame.last() == Some(&b'\n') {
                break;
            }
        }
        self.finish_response(serde_json::from_slice(&frame)?, &id)
    }

    async fn call_file(
        &self,
        method: &str,
        params: Value,
        ipc_dir: &PathBuf,
        lane: &Mutex<()>,
    ) -> Result<Value> {
        let _guard = lane.lock().await;
        fs::create_dir_all(ipc_dir).await?;
        let id = Uuid::new_v4().to_string();
        let request = ipc_dir.join(format!("{id}.request.json"));
        let temporary = ipc_dir.join(format!(".{id}.request.tmp"));
        let response_path = ipc_dir.join(format!("{id}.response.json"));
        fs::write(&temporary, self.request(method, &params, &id)?).await?;
        fs::rename(&temporary, &request).await?;
        self.counters.connects.fetch_add(1, Ordering::Relaxed);
        let deadline = Instant::now() + Duration::from_millis(self.config.request_timeout_ms);
        loop {
            match fs::read(&response_path).await {
                Ok(bytes) => {
                    let response: Value = serde_json::from_slice(&bytes)
                        .context("invalid Xshell IPC response; exchange outcome unknown")?;
                    let _ = fs::remove_file(&response_path).await;
                    return self.finish_response(response, &id);
                }
                Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
                Err(error) => return Err(error.into()),
            }
            if Instant::now() >= deadline {
                return Err(anyhow::anyhow!(
                    "Xshell IPC timeout: outcome may be unknown; NEVER automatically replay a command"
                ));
            }
            sleep(Duration::from_millis(20)).await;
        }
    }

    fn finish_response(&self, response: Value, id: &str) -> Result<Value> {
        ensure!(
            response["protocol_version"].as_u64() == Some(PROTOCOL as u64),
            "bridge protocol mismatch: upgrade and restart adapter"
        );
        ensure!(response["id"] == id, "bridge response ID mismatch");
        ensure!(
            response["bridge_instance"].is_string(),
            "missing bridge identity"
        );
        if response["ok"].as_bool() != Some(true) {
            return Err(BridgeFault {
                message: format!("bridge rejected request: {}", response["error"]),
                sent: response["sent"].as_bool(),
            }
            .into());
        }
        Ok(response["result"].clone())
    }
}
