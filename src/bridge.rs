use crate::{
    config::{BridgeConfig, BridgeSecret},
    model::{BridgeRequest, BridgeResponse},
};
use anyhow::{Context, Result, bail};
use serde_json::Value;
use std::{sync::Arc, time::Duration};
use tokio::{
    io::{AsyncBufReadExt, AsyncWriteExt, BufReader},
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
        if config.host != "127.0.0.1" {
            bail!(
                "bridge.host must be 127.0.0.1; refusing non-loopback or name-resolved endpoints"
            );
        }
        if secret.host != config.host || secret.port != config.port {
            bail!(
                "bridge endpoint mismatch: config.toml says {}:{}, bridge.json says {}:{}; run `securecrt-mcp init --force` or make them consistent",
                config.host,
                config.port,
                secret.host,
                secret.port
            );
        }
        Ok(Self {
            config: Arc::new(config),
            secret: Arc::new(secret),
        })
    }

    pub async fn call(&self, method: &str, params: Value) -> Result<Value> {
        let address = format!("{}:{}", self.secret.host, self.secret.port);
        let stream = timeout(
            Duration::from_millis(self.config.connect_timeout_ms),
            TcpStream::connect(&address),
        )
        .await
        .with_context(|| format!("timed out connecting to SecureCRT bridge at {address}"))??;

        let request = BridgeRequest {
            id: Uuid::new_v4().to_string(),
            token: self.secret.token.clone(),
            method: method.to_owned(),
            params,
        };
        let line = serde_json::to_vec(&request).context("failed to encode bridge request")?;
        if line.len() > self.secret.max_request_bytes {
            bail!("bridge request is larger than configured max_request_bytes");
        }

        let (read_half, mut write_half) = stream.into_split();
        timeout(
            Duration::from_millis(self.config.request_timeout_ms),
            async {
                write_half.write_all(&line).await?;
                write_half.write_all(b"\n").await?;
                write_half.flush().await
            },
        )
        .await
        .context("timed out writing to SecureCRT bridge")??;

        let mut reader = BufReader::new(read_half);
        let mut response_line = String::new();
        let bytes = timeout(
            Duration::from_millis(self.config.request_timeout_ms),
            reader.read_line(&mut response_line),
        )
        .await
        .context("timed out waiting for SecureCRT bridge response")??;

        if bytes == 0 {
            bail!("SecureCRT bridge closed the connection without a response");
        }
        if response_line.len() > self.secret.max_request_bytes {
            bail!("SecureCRT bridge response is larger than configured max_request_bytes");
        }

        let response: BridgeResponse =
            serde_json::from_str(&response_line).context("invalid JSON from SecureCRT bridge")?;
        if response.id != request.id {
            bail!("SecureCRT bridge response id did not match request id");
        }
        if !response.ok {
            bail!(
                "SecureCRT bridge error: {}",
                response.error.unwrap_or_else(|| "unknown error".to_owned())
            );
        }
        Ok(response.result)
    }
}
