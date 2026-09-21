use anyhow::{Context, Result, bail, ensure};
use serde::{Deserialize, Serialize};
use std::{env, fs, path::PathBuf};

pub const PROTOCOL: u32 = 2;
pub const MAX_FRAME: usize = 262_144;
pub const BRIDGE_SCRIPT_FILE: &str = "securecrt_bridge.py";

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(default, deny_unknown_fields)]
pub struct Config {
    pub bridge: BridgeConfig,
    pub policy: PolicyConfig,
    pub audit: AuditConfig,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default, deny_unknown_fields)]
pub struct BridgeConfig {
    pub host: String,
    pub port: u16,
    pub connect_timeout_ms: u64,
    pub request_timeout_ms: u64,
    pub max_command_timeout_ms: u64,
    pub max_stream_timeout_ms: u64,
    pub max_output_bytes: usize,
    pub max_jobs: usize,
    pub job_retention_sec: u64,
}

impl Default for BridgeConfig {
    fn default() -> Self {
        Self {
            host: "127.0.0.1".into(),
            port: 27_855,
            connect_timeout_ms: 1_500,
            request_timeout_ms: 5_000,
            max_command_timeout_ms: 30_000,
            max_stream_timeout_ms: 3_600_000,
            max_output_bytes: 1_048_576,
            max_jobs: 32,
            job_retention_sec: 3600,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default, deny_unknown_fields)]
pub struct PolicyConfig {
    pub mode: String,
    pub allow_raw_send: bool,
    pub allow_interrupt: bool,
    pub custom_allow_patterns: Vec<String>,
    pub custom_deny_patterns: Vec<String>,
}

impl Default for PolicyConfig {
    fn default() -> Self {
        Self {
            mode: "client".into(),
            allow_raw_send: false,
            allow_interrupt: true,
            custom_allow_patterns: Vec::new(),
            custom_deny_patterns: Vec::new(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default, deny_unknown_fields)]
pub struct AuditConfig {
    pub enabled: bool,
    pub file: String,
    pub include_command_text: bool,
    pub durability: String,
}

impl Default for AuditConfig {
    fn default() -> Self {
        Self {
            enabled: true,
            file: "audit.jsonl".into(),
            include_command_text: false,
            durability: "os_buffered".into(),
        }
    }
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct BridgeSecret {
    pub host: String,
    pub port: u16,
    pub token: String,
    pub max_request_bytes: usize,
}

pub fn app_dir() -> Result<PathBuf> {
    if let Some(path) = env::var_os("SECURECRT_MCP_HOME") {
        let path = PathBuf::from(path);
        ensure!(path.is_absolute(), "SECURECRT_MCP_HOME must be absolute");
        return Ok(path);
    }
    let home = if cfg!(windows) {
        env::var_os("USERPROFILE").or_else(|| env::var_os("HOME"))
    } else {
        env::var_os("HOME")
    };
    Ok(PathBuf::from(home.context("HOME/USERPROFILE is unavailable")?).join(".securecrt-mcp"))
}

pub fn config_path() -> Result<PathBuf> {
    Ok(app_dir()?.join("config.toml"))
}
pub fn bridge_config_path() -> Result<PathBuf> {
    Ok(app_dir()?.join("bridge.json"))
}
pub fn bridge_script_path() -> Result<PathBuf> {
    Ok(app_dir()?.join(BRIDGE_SCRIPT_FILE))
}

impl Config {
    pub fn load() -> Result<Self> {
        let path = config_path()?;
        let config: Self = if path.exists() {
            toml::from_str(&fs::read_to_string(&path)?)
                .with_context(|| format!("invalid configuration: {}", path.display()))?
        } else {
            Self::default()
        };
        config.validate()?;
        Ok(config)
    }

    pub fn validate(&self) -> Result<()> {
        let b = &self.bridge;
        ensure!(b.host == "127.0.0.1", "bridge.host must be 127.0.0.1");
        ensure!(b.port >= 1024, "bridge.port must be in 1024..65535");
        ensure!(
            (100..=10_000).contains(&b.connect_timeout_ms),
            "invalid connect_timeout_ms"
        );
        ensure!(
            (2000..=60_000).contains(&b.request_timeout_ms),
            "invalid request_timeout_ms (2000..60000)"
        );
        ensure!(
            (1000..=3_600_000).contains(&b.max_command_timeout_ms),
            "invalid max_command_timeout_ms"
        );
        ensure!(
            (1000..=3_600_000).contains(&b.max_stream_timeout_ms),
            "invalid max_stream_timeout_ms"
        );
        ensure!(
            (4096..=16_777_216).contains(&b.max_output_bytes),
            "invalid max_output_bytes"
        );
        ensure!((1..=128).contains(&b.max_jobs), "invalid max_jobs");
        ensure!(
            (60..=86_400).contains(&b.job_retention_sec),
            "invalid job_retention_sec"
        );
        ensure!(
            b.max_output_bytes.saturating_mul(b.max_jobs) <= 134_217_728,
            "output cache exceeds 128 MiB budget"
        );
        ensure!(!self.audit.file.is_empty(), "audit.file must not be empty");
        ensure!(
            ["os_buffered", "each_event"].contains(&self.audit.durability.as_str()),
            "invalid audit.durability"
        );
        crate::policy::PolicyEngine::new(&self.policy)?;
        Ok(())
    }

    pub fn audit_path(&self) -> Result<PathBuf> {
        let path = PathBuf::from(&self.audit.file);
        Ok(if path.is_absolute() {
            path
        } else {
            app_dir()?.join(path)
        })
    }
}

pub fn load_bridge_secret() -> Result<BridgeSecret> {
    let secret: BridgeSecret = serde_json::from_str(
        &fs::read_to_string(bridge_config_path()?)
            .context("bridge.json missing: run securecrt-mcp init")?,
    )?;
    if secret.host != "127.0.0.1"
        || secret.port < 1024
        || secret.token.len() < 32
        || secret.token.len() > 256
        || !secret.token.is_ascii()
        || secret.max_request_bytes < 4096
    {
        bail!("invalid bridge.json; repair settings without exposing the token");
    }
    Ok(secret)
}
