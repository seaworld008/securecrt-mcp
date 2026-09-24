//! Authenticated Bridge transport for SecureCRT TCP and Xshell file IPC.
use crate::config::{BridgeConfig, BridgeSecret, MAX_FRAME, PROTOCOL};
use crate::fault::BridgeFault;
use anyhow::{Context, Result, ensure};
use futures::future::join_all;
use serde_json::{Value, json};
use std::{
    collections::HashMap,
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
        state: Arc<FileTransport>,
    },
}

struct FileTransport {
    root: PathBuf,
    lanes: Mutex<HashMap<String, Arc<Mutex<()>>>>,
    routes: Mutex<HashMap<String, String>>,
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
                state: Arc::new(FileTransport {
                    root: ipc_dir,
                    lanes: Mutex::new(HashMap::new()),
                    routes: Mutex::new(HashMap::new()),
                }),
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
                    Transport::File { state } => self.call_file(method, params, state).await,
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

    async fn file_instances(&self, state: &FileTransport) -> Result<Vec<(String, PathBuf)>> {
        let instances = state.root.join("instances");
        let mut result = Vec::new();
        let mut entries = match fs::read_dir(&instances).await {
            Ok(entries) => entries,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(result),
            Err(error) => return Err(error.into()),
        };
        while let Some(entry) = entries.next_entry().await? {
            if !entry.file_type().await?.is_dir() {
                continue;
            }
            let ready_path = entry.path().join("ready.json");
            let bytes = match fs::read(&ready_path).await {
                Ok(bytes) => bytes,
                Err(error) if error.kind() == std::io::ErrorKind::NotFound => continue,
                Err(error) => return Err(error.into()),
            };
            let ready: Value = match serde_json::from_slice(&bytes) {
                Ok(value) => value,
                Err(_) => continue,
            };
            let Some(instance) = ready["bridge_instance"].as_str() else {
                continue;
            };
            if ready["protocol_version"].as_u64() != Some(PROTOCOL as u64) {
                continue;
            }
            let heartbeat = ready["last_poll_ms"]
                .as_u64()
                .or(ready["started_ms"].as_u64());
            let Some(heartbeat) = heartbeat else { continue };
            let now = SystemTime::now().duration_since(UNIX_EPOCH)?.as_millis() as u64;
            if now.saturating_sub(heartbeat) > 5_000 {
                continue;
            }
            result.push((instance.to_owned(), entry.path()));
        }
        result.sort_by(|left, right| left.0.cmp(&right.0));
        Ok(result)
    }

    async fn file_lane(&self, state: &FileTransport, instance: &str) -> Arc<Mutex<()>> {
        let mut lanes = state.lanes.lock().await;
        lanes
            .entry(instance.to_owned())
            .or_insert_with(|| Arc::new(Mutex::new(())))
            .clone()
    }

    async fn call_file(&self, method: &str, params: Value, state: &FileTransport) -> Result<Value> {
        let instances = self.file_instances(state).await?;
        ensure!(
            !instances.is_empty(),
            "Xshell bridge is not running; start the script in each Xshell process"
        );
        if method == "list_sessions" {
            let mut sessions = Vec::new();
            let mut errors = Vec::new();
            let mut capabilities = Vec::new();
            let mut active = Vec::new();
            let calls = instances.iter().map(|(instance, dir)| {
                let params = params.clone();
                async move {
                    (
                        instance.clone(),
                        self.call_file_instance(method, params, state, instance, dir)
                            .await,
                    )
                }
            });
            for (instance, result) in join_all(calls).await {
                match result {
                    Ok(value) => {
                        active.push(instance.clone());
                        if let Some(items) = value["sessions"].as_array() {
                            sessions.extend(items.iter().cloned());
                        }
                        if let Some(items) = value["capabilities"].as_array() {
                            for item in items {
                                if !capabilities.contains(item) {
                                    capabilities.push(item.clone());
                                }
                            }
                        }
                        if let Some(items) = value["discovery"]["errors"].as_array() {
                            errors.extend(items.iter().cloned());
                        }
                    }
                    Err(error) => {
                        errors.push(json!({"instance":instance,"error":error.to_string()}))
                    }
                }
            }
            return Ok(
                json!({"bridge_instance":"aggregated","enumeration":"instance_registry",
                "sessions":sessions,"capabilities":capabilities,
                "discovery":{"method":"instance_registry","instances":active,"errors":errors}}),
            );
        }
        if method == "ping" {
            let (instance, dir) = &instances[0];
            let mut value = self
                .call_file_instance(method, params, state, instance, dir)
                .await?;
            value["instances"] = json!(instances.iter().map(|(id, _)| id).collect::<Vec<_>>());
            return Ok(value);
        }
        let route_key = ["session", "attachment_id", "capture_id"]
            .iter()
            .find_map(|key| params[*key].as_str())
            .map(str::to_owned);
        let selected = if let Some(key) = route_key.as_deref() {
            let routes = state.routes.lock().await;
            key.split('/')
                .next()
                .and_then(|prefix| instances.iter().find(|(id, _)| id == prefix).cloned())
                .or_else(|| {
                    routes.get(key).and_then(|id| {
                        instances
                            .iter()
                            .find(|(candidate, _)| candidate == id)
                            .cloned()
                    })
                })
        } else {
            None
        };
        let selected = selected.or_else(|| (instances.len() == 1).then(|| instances[0].clone()))
            .context("Xshell instance route is ambiguous; use a session or attachment returned by connector_list/connector_open")?;
        let value = self
            .call_file_instance(method, params.clone(), state, &selected.0, &selected.1)
            .await?;
        if let Some(key) = route_key {
            state.routes.lock().await.insert(key, selected.0.clone());
        }
        if let Some(key) = value["capture_id"].as_str() {
            state
                .routes
                .lock()
                .await
                .insert(key.to_owned(), selected.0.clone());
        }
        Ok(value)
    }

    async fn call_file_instance(
        &self,
        method: &str,
        params: Value,
        state: &FileTransport,
        instance: &str,
        ipc_dir: &PathBuf,
    ) -> Result<Value> {
        let lane = self.file_lane(state, instance).await;
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
                    ensure!(
                        response["bridge_instance"].as_str() == Some(instance),
                        "Xshell IPC response came from the wrong bridge instance"
                    );
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
        let mut result = response["result"].clone();
        if let Some(object) = result.as_object_mut() {
            object
                .entry("bridge_instance")
                .or_insert_with(|| response["bridge_instance"].clone());
        }
        Ok(result)
    }
}
