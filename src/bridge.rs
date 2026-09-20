use crate::config::{BridgeConfig, BridgeSecret, MAX_FRAME, PROTOCOL};
use anyhow::{Context, Result, ensure};
use serde_json::{Value, json};
use std::{
    sync::Arc,
    time::{Duration, SystemTime, UNIX_EPOCH},
};
use tokio::{
    io::{AsyncBufReadExt, AsyncReadExt, AsyncWriteExt, BufReader},
    net::TcpStream,
    time::timeout,
};
use uuid::Uuid;

#[derive(Clone)]
pub struct BridgeClient {
    config: Arc<BridgeConfig>,
    secret: Arc<BridgeSecret>,
}
impl BridgeClient {
    pub fn new(config: BridgeConfig, secret: BridgeSecret) -> Result<Self> {
        ensure!(
            config.host == "127.0.0.1" && secret.host == config.host && secret.port == config.port,
            "bridge endpoint mismatch; preserve config and repair bridge.json, do not reset policy"
        );
        Ok(Self {
            config: Arc::new(config),
            secret: Arc::new(secret),
        })
    }
    pub async fn call(&self, method: &str, params: Value) -> Result<Value> {
        let id = Uuid::new_v4().to_string();
        let now = SystemTime::now().duration_since(UNIX_EPOCH)?.as_millis() as u64;
        let request = json!({"protocol_version": PROTOCOL, "id": id, "token": self.secret.token,
            "deadline_ms": now + self.config.request_timeout_ms, "method": method, "params": params});
        let mut bytes = serde_json::to_vec(&request)?;
        bytes.push(b'\n');
        let limit = MAX_FRAME.min(self.secret.max_request_bytes);
        ensure!(bytes.len() <= limit, "request exceeds frame limit");
        let result = timeout(Duration::from_millis(self.config.request_timeout_ms), async {
            let address = format!("127.0.0.1:{}", self.config.port);
            let mut stream = timeout(Duration::from_millis(self.config.connect_timeout_ms), TcpStream::connect(address))
                .await.context("bridge connect timeout")??;
            stream.write_all(&bytes).await?;
            let mut reader = BufReader::new(stream.take((limit + 1) as u64));
            let mut frame = Vec::new();
            reader.read_until(b'\n', &mut frame).await?;
            ensure!(frame.len() <= limit && frame.last() == Some(&b'\n'), "oversized or incomplete bridge frame");
            let response: Value = serde_json::from_slice(&frame)?;
            ensure!(response["protocol_version"].as_u64() == Some(PROTOCOL as u64),
                "bridge protocol mismatch: run upgrade, stop Script > Cancel, then start the installed adapter");
            ensure!(response["id"] == id, "bridge response ID mismatch");
            ensure!(response["bridge_instance"].is_string(), "missing bridge identity");
            ensure!(response["ok"].as_bool() == Some(true), "bridge rejected request: {}", response["error"]);
            Ok::<Value, anyhow::Error>(response["result"].clone())
        }).await;
        result.context(
            "bridge timeout: outcome may be unknown; NEVER automatically replay a command",
        )?
    }
}
