mod audit;
mod bridge;
mod config;
mod model;
mod policy;
mod server;

use anyhow::{Context, Result};
use audit::AuditLog;
use bridge::BridgeClient;
use clap::{Parser, Subcommand};
use config::{
    BridgeSecret, Config, app_dir, bridge_config_path, bridge_script_path, config_path,
    load_bridge_secret,
};
use policy::PolicyEngine;
use rmcp::{ServiceExt, transport::stdio};
use server::SecureCrtServer;
use std::{fs, path::Path};
use tracing_subscriber::EnvFilter;
use uuid::Uuid;

const BRIDGE_SCRIPT: &str = include_str!("../bridge/securecrt_bridge.py");

#[derive(Parser, Debug)]
#[command(
    name = "securecrt-mcp",
    version,
    about = "MCP server for controlling existing SecureCRT sessions through a local in-process bridge"
)]
struct Cli {
    #[command(subcommand)]
    command: Option<Command>,
}

#[derive(Subcommand, Debug)]
enum Command {
    /// Start the MCP server over stdio (default when no subcommand is supplied).
    Serve,
    /// Install/update the SecureCRT bridge script and local configuration.
    Init {
        /// Overwrite existing config/token/script files.
        #[arg(long)]
        force: bool,
    },
    /// Check local configuration and bridge connectivity.
    Doctor,
    /// Print local paths used by securecrt-mcp.
    Paths,
}

#[tokio::main]
async fn main() -> Result<()> {
    init_tracing();
    let cli = Cli::parse();
    match cli.command.unwrap_or(Command::Serve) {
        Command::Serve => serve().await,
        Command::Init { force } => init_files(force),
        Command::Doctor => doctor().await,
        Command::Paths => print_paths(),
    }
}

fn init_tracing() {
    let filter = EnvFilter::try_from_default_env().unwrap_or_else(|_| EnvFilter::new("warn"));
    let _ = tracing_subscriber::fmt()
        .with_env_filter(filter)
        .with_writer(std::io::stderr)
        .with_target(false)
        .try_init();
}

async fn serve() -> Result<()> {
    let config = Config::load()?;
    let secret = load_bridge_secret()?;
    let policy = PolicyEngine::new(&config.policy)?;
    let audit = AuditLog::new(
        config.audit.enabled,
        config.audit.include_command_text,
        config.audit_path()?,
    );
    let bridge = BridgeClient::new(config.bridge.clone(), secret)?;
    let server = SecureCrtServer::new(bridge, policy, audit, config);

    let service = server.serve(stdio()).await.context("failed to start MCP stdio service")?;
    service.waiting().await.context("MCP service stopped with an error")?;
    Ok(())
}

async fn doctor() -> Result<()> {
    let config = Config::load()?;
    let secret = load_bridge_secret()?;
    let bridge = BridgeClient::new(config.bridge.clone(), secret)?;

    println!("securecrt-mcp doctor");
    println!("  config: {}", config_path()?.display());
    println!("  bridge config: {}", bridge_config_path()?.display());
    println!("  bridge script: {}", bridge_script_path()?.display());
    println!("  policy mode: {}", config.policy.mode);

    let result = bridge.call("ping", serde_json::json!({})).await.with_context(|| {
        "SecureCRT bridge is not reachable. Start SecureCRT, then run the installed securecrt_bridge.py using Script > Run."
    })?;
    println!("  bridge: OK");
    println!("  response: {}", serde_json::to_string_pretty(&result)?);
    Ok(())
}

fn print_paths() -> Result<()> {
    println!("app_dir={}", app_dir()?.display());
    println!("config={}", config_path()?.display());
    println!("bridge_config={}", bridge_config_path()?.display());
    println!("bridge_script={}", bridge_script_path()?.display());
    Ok(())
}

fn init_files(force: bool) -> Result<()> {
    let dir = app_dir()?;
    fs::create_dir_all(&dir)
        .with_context(|| format!("failed to create app directory: {}", dir.display()))?;
    set_private_dir_permissions(&dir)?;

    let cfg_path = config_path()?;
    if !cfg_path.exists() || force {
        let default_config = Config::default();
        let config_text = toml::to_string_pretty(&default_config)
            .context("failed to encode default config")?;
        fs::write(&cfg_path, config_text)
            .with_context(|| format!("failed to write {}", cfg_path.display()))?;
    }
    set_private_file_permissions(&cfg_path)?;

    // Load the preserved or newly-created config before creating bridge credentials,
    // so a user-selected localhost port is respected on repair/upgrade installs.
    let config = Config::load()?;
    let secret_path = bridge_config_path()?;
    if !secret_path.exists() || force {
        let token = format!("{}{}", Uuid::new_v4().simple(), Uuid::new_v4().simple());
        let secret = BridgeSecret {
            host: config.bridge.host.clone(),
            port: config.bridge.port,
            token,
            max_request_bytes: 1_048_576,
        };
        let secret_text = serde_json::to_string_pretty(&secret)?;
        fs::write(&secret_path, secret_text)
            .with_context(|| format!("failed to write {}", secret_path.display()))?;
    }
    set_private_file_permissions(&secret_path)?;

    // The bridge script is generated from the current binary and is safe to refresh
    // during normal upgrades without rotating credentials or resetting policy.
    let script_path = bridge_script_path()?;
    fs::write(&script_path, BRIDGE_SCRIPT)
        .with_context(|| format!("failed to write {}", script_path.display()))?;

    println!("securecrt-mcp initialized at {}", dir.display());
    println!("Bridge script: {}", bridge_script_path()?.display());
    println!("Next: in SecureCRT choose Script > Run... and select the bridge script above.");
    println!("Then run: securecrt-mcp doctor");
    Ok(())
}

#[cfg(unix)]
fn set_private_file_permissions(path: &Path) -> Result<()> {
    use std::os::unix::fs::PermissionsExt;
    fs::set_permissions(path, fs::Permissions::from_mode(0o600))
        .with_context(|| format!("failed to set private permissions on {}", path.display()))
}

#[cfg(not(unix))]
fn set_private_file_permissions(_path: &Path) -> Result<()> {
    Ok(())
}

#[cfg(unix)]
fn set_private_dir_permissions(path: &Path) -> Result<()> {
    use std::os::unix::fs::PermissionsExt;
    fs::set_permissions(path, fs::Permissions::from_mode(0o700))
        .with_context(|| format!("failed to set private permissions on {}", path.display()))
}

#[cfg(not(unix))]
fn set_private_dir_permissions(_path: &Path) -> Result<()> {
    Ok(())
}
