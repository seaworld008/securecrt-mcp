use anyhow::{Context, Result, bail};
use serde::{Deserialize, Serialize};
use std::{env, fs, path::PathBuf};

pub const APP_DIR: &str = ".securecrt-mcp";
pub const CONFIG_FILE: &str = "config.toml";
pub const BRIDGE_CONFIG_FILE: &str = "bridge.json";
pub const BRIDGE_SCRIPT_FILE: &str = "securecrt_bridge.py";

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(default)]
pub struct Config {
    pub bridge: BridgeConfig,
    pub policy: PolicyConfig,
    pub audit: AuditConfig,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default)]
pub struct BridgeConfig {
    pub host: String,
    pub port: u16,
    pub connect_timeout_ms: u64,
    pub request_timeout_ms: u64,
    pub max_command_timeout_ms: u64,
}

impl Default for BridgeConfig {
    fn default() -> Self {
        Self {
            host: "127.0.0.1".to_owned(),
            port: 27_855,
            connect_timeout_ms: 1_500,
            request_timeout_ms: 35_000,
            max_command_timeout_ms: 30_000,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default)]
pub struct PolicyConfig {
    /// observe = no command execution; safe = built-in read-oriented allowlist;
    /// allowlist = only custom_allow_patterns; unrestricted = allow commands unless hard-denied.
    pub mode: String,
    pub allow_raw_send: bool,
    pub allow_interrupt: bool,
    pub custom_allow_patterns: Vec<String>,
    pub custom_deny_patterns: Vec<String>,
}

impl Default for PolicyConfig {
    fn default() -> Self {
        Self {
            mode: "safe".to_owned(),
            allow_raw_send: false,
            allow_interrupt: true,
            custom_allow_patterns: Vec::new(),
            custom_deny_patterns: Vec::new(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default)]
pub struct AuditConfig {
    pub enabled: bool,
    pub file: String,
    pub include_command_text: bool,
}

impl Default for AuditConfig {
    fn default() -> Self {
        Self {
            enabled: true,
            file: "audit.jsonl".to_owned(),
            include_command_text: false,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BridgeSecret {
    pub host: String,
    pub port: u16,
    pub token: String,
    pub max_request_bytes: usize,
}

pub fn user_home() -> Result<PathBuf> {
    if cfg!(windows) {
        if let Some(path) = env::var_os("USERPROFILE") {
            return Ok(PathBuf::from(path));
        }
    }
    if let Some(path) = env::var_os("HOME") {
        return Ok(PathBuf::from(path));
    }
    if let Some(path) = env::var_os("USERPROFILE") {
        return Ok(PathBuf::from(path));
    }
    bail!("unable to determine user home directory from HOME or USERPROFILE")
}

pub fn app_dir() -> Result<PathBuf> {
    Ok(user_home()?.join(APP_DIR))
}

pub fn config_path() -> Result<PathBuf> {
    Ok(app_dir()?.join(CONFIG_FILE))
}

pub fn bridge_config_path() -> Result<PathBuf> {
    Ok(app_dir()?.join(BRIDGE_CONFIG_FILE))
}

pub fn bridge_script_path() -> Result<PathBuf> {
    Ok(app_dir()?.join(BRIDGE_SCRIPT_FILE))
}

impl Config {
    pub fn load() -> Result<Self> {
        let path = config_path()?;
        if !path.exists() {
            return Ok(Self::default());
        }
        let raw = fs::read_to_string(&path)
            .with_context(|| format!("failed to read config: {}", path.display()))?;
        toml::from_str(&raw).with_context(|| format!("failed to parse config: {}", path.display()))
    }

    pub fn audit_path(&self) -> Result<PathBuf> {
        let path = PathBuf::from(&self.audit.file);
        if path.is_absolute() {
            Ok(path)
        } else {
            Ok(app_dir()?.join(path))
        }
    }
}

pub fn load_bridge_secret() -> Result<BridgeSecret> {
    let path = bridge_config_path()?;
    let raw = fs::read_to_string(&path).with_context(|| {
        format!(
            "failed to read bridge credentials at {}. Run `securecrt-mcp init` first",
            path.display()
        )
    })?;
    serde_json::from_str(&raw)
        .with_context(|| format!("failed to parse bridge credentials: {}", path.display()))
}
