mod audit;
mod bridge;
mod config;
mod critical;
mod daemon;
mod execution;
mod fault;
mod local_cli;
mod model;
mod policy;
#[cfg(test)]
mod regression;
mod server;
mod terminal;

use anyhow::{Context, Result, ensure};
use audit::AuditLog;
use bridge::BridgeClient;
use clap::{Parser, Subcommand};
use config::{
    BridgeSecret, Config, MAX_FRAME, PROTOCOL, app_dir, bridge_config_path, bridge_script_path,
    config_path, load_bridge_secret,
};
use execution::Engine;
use policy::PolicyEngine;
use rmcp::{ServiceExt, transport::stdio};
use server::SecureCrtServer;
use std::{fs, io::Write, path::Path};
use uuid::Uuid;

const BRIDGE_SCRIPT: &str = include_str!("../bridge/securecrt_bridge.py");

#[derive(Parser)]
#[command(
    name = "securecrt-mcp",
    version,
    about = "Local MCP control of existing SecureCRT sessions"
)]
struct Cli {
    #[command(subcommand)]
    command: Option<Command>,
}
#[derive(Subcommand)]
enum Command {
    Serve,
    /// Retain one Engine for separate CLI clients. Foreground only, never auto-spawned.
    Daemon {
        #[arg(long, conflicts_with = "cleanup_stale")]
        stop: bool,
        /// Explicitly remove a refused stale endpoint after inspecting SecureCRT; no state reset.
        #[arg(long)]
        cleanup_stale: bool,
    },
    /// Invoke the persistent daemon using a UTF-8 JSON file, without starting another Engine.
    Session {
        #[arg(value_parser=["sessions","screen","attach","exec","exec-batch","batch-status","detach","heartbeat","status","output","acknowledge-idle","interrupt","shell-open","shell-read","shell-write","shell-close","latency","ping"])]
        method: String,
        #[arg(long, default_value = "-")]
        input: String,
    },
    /// Initialize files; preserve existing policy/token unless --force is explicitly supplied.
    Init {
        #[arg(long)]
        force: bool,
    },
    /// Upgrade the embedded adapter with a backup, without resetting policy or rotating the token.
    Upgrade,
    /// Check configuration, embedded adapter and (unless --offline) the actual SecureCRT runtime.
    Doctor {
        #[arg(long)]
        offline: bool,
        #[arg(long, conflicts_with = "offline")]
        latency: bool,
    },
    Paths,
    /// Print an additive Codex configuration; never modify the user's Codex files.
    CodexConfig {
        #[arg(long, default_value="auto", value_parser=["auto", "prompt", "writes", "approve"])]
        approval_mode: String,
        #[arg(long, default_value="terminal", value_parser=["terminal", "basic", "full"])]
        toolset: String,
    },
    /// List existing sessions as JSON, without sending remote input.
    Sessions,
    /// Read an explicit session as JSON.
    Screen {
        #[arg(long)]
        session: String,
    },
    /// Execute one JSON request from a UTF-8 file or '-' stdin. Keeps the process alive until terminal state.
    Run {
        #[arg(long)]
        input: String,
    },
    /// Inspect effective policy for the command in a JSON file or '-' stdin. Never connects.
    PolicyCheck {
        #[arg(long)]
        input: String,
    },
}

#[tokio::main]
async fn main() -> Result<()> {
    let _ = tracing_subscriber::fmt()
        .with_writer(std::io::stderr)
        .with_target(false)
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| tracing_subscriber::EnvFilter::new("warn")),
        )
        .try_init();
    match Cli::parse().command.unwrap_or(Command::Serve) {
        Command::Serve => {
            let config = Config::load()?;
            let bridge = BridgeClient::new(config.bridge.clone(), load_bridge_secret()?)?;
            let audit = AuditLog::new(
                config.audit.enabled,
                config.audit.include_command_text,
                config.audit_path()?,
            )
            .with_sync(config.audit.durability == "each_event");
            let policy = PolicyEngine::new(&config.policy)?;
            let engine = Engine::new(bridge, audit, policy, config);
            let service = SecureCrtServer::new(engine.clone()).serve(stdio()).await?;
            let ended = service.waiting().await;
            engine.drain_on_disconnect().await;
            ended?;
        }
        Command::Init { force } => initialize(force)?,
        Command::Upgrade => initialize(false)?,
        Command::Doctor { offline, latency } => {
            if latency {
                local_cli::emit(&local_cli::engine()?.latency(20).await?)?;
            } else {
                doctor(offline).await?;
            }
        }
        Command::Daemon {
            stop,
            cleanup_stale,
        } => {
            if stop {
                local_cli::emit(&daemon::call("shutdown", serde_json::json!({})).await?)?;
            } else if cleanup_stale {
                daemon::cleanup_stale().await?;
            } else {
                daemon::serve().await?;
            }
        }
        Command::Session { method, input } => {
            local_cli::emit(&daemon::call(&method, local_cli::input(&input)?).await?)?
        }
        Command::Paths => {
            println!("app_dir={}", app_dir()?.display());
            println!("config={}", config_path()?.display());
            println!("bridge_config={}", bridge_config_path()?.display());
            println!("bridge_script={}", bridge_script_path()?.display());
        }
        Command::CodexConfig {
            approval_mode,
            toolset,
        } => print_codex_config(&approval_mode, &toolset)?,
        Command::Sessions => local_cli::sessions().await?,
        Command::Screen { session } => local_cli::screen(session).await?,
        Command::Run { input } => local_cli::run(&input).await?,
        Command::PolicyCheck { input } => local_cli::policy_check(&input)?,
    }
    Ok(())
}

fn reject_symlink(path: &Path) -> Result<()> {
    if let Ok(meta) = fs::symlink_metadata(path) {
        ensure!(
            !meta.file_type().is_symlink(),
            "refusing symlink: {}",
            path.display()
        );
    }
    Ok(())
}

fn replace_with_backup(path: &Path, contents: &str) -> Result<()> {
    reject_symlink(path)?;
    if path.exists() && fs::read(path)? == contents.as_bytes() {
        return Ok(());
    }
    let temporary = path.with_extension(format!("{}.tmp", Uuid::new_v4()));
    let backup = path.with_extension(format!("{}.bak", Uuid::new_v4()));
    let mut options = fs::OpenOptions::new();
    options.write(true).create_new(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    let mut file = options.open(&temporary)?;
    file.write_all(contents.as_bytes())?;
    file.sync_all()?;
    drop(file);
    let had_old = path.exists();
    if had_old {
        fs::rename(path, &backup)?;
    }
    if let Err(error) = fs::rename(&temporary, path) {
        if had_old {
            let _ = fs::rename(&backup, path);
        }
        let _ = fs::remove_file(&temporary);
        return Err(error.into());
    }
    if had_old {
        println!("backup={}", backup.display());
    }
    Ok(())
}

fn initialize(force: bool) -> Result<()> {
    let dir = app_dir()?;
    reject_symlink(&dir)?;
    fs::create_dir_all(&dir)?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(&dir, fs::Permissions::from_mode(0o700))?;
    }
    let config_file = config_path()?;
    reject_symlink(&config_file)?;
    if !config_file.exists() || force {
        replace_with_backup(&config_file, &toml::to_string_pretty(&Config::default())?)?;
    }
    let config = Config::load()?;
    let secret_file = bridge_config_path()?;
    reject_symlink(&secret_file)?;
    let mut secret = if secret_file.exists() && !force {
        load_bridge_secret()?
    } else {
        BridgeSecret {
            host: config.bridge.host.clone(),
            port: config.bridge.port,
            token: format!("{}{}", Uuid::new_v4().simple(), Uuid::new_v4().simple()),
            max_request_bytes: MAX_FRAME,
        }
    };
    // A changed localhost port follows configuration without rotating the existing secret.
    secret.host = config.bridge.host.clone();
    secret.port = config.bridge.port;
    replace_with_backup(&secret_file, &serde_json::to_string_pretty(&secret)?)?;
    replace_with_backup(&bridge_script_path()?, BRIDGE_SCRIPT)?;
    println!(
        "securecrt-mcp {} initialized at {}",
        env!("CARGO_PKG_VERSION"),
        dir.display()
    );
    println!(
        "Policy/token preserved unless --force was used. Backups may contain secrets; keep them private."
    );
    println!(
        "Stop the old adapter with Script > Cancel, then Script > Run: {}",
        bridge_script_path()?.display()
    );
    println!(
        "Run doctor, reload Codex, list sessions again. Old session handles are intentionally invalid."
    );
    Ok(())
}

async fn doctor(offline: bool) -> Result<()> {
    let config = Config::load()?;
    let secret = load_bridge_secret()?;
    ensure!(
        fs::read_to_string(bridge_script_path()?)
            .context("installed adapter missing; run upgrade")?
            == BRIDGE_SCRIPT,
        "installed adapter differs from this binary; run upgrade, then restart the script"
    );
    println!(
        "server_version={} protocol={PROTOCOL}",
        env!("CARGO_PKG_VERSION")
    );
    println!(
        "policy={} (not an approval attestation or remote sandbox)",
        config.policy.mode
    );
    println!(
        "config={} adapter={}",
        config_path()?.display(),
        bridge_script_path()?.display()
    );
    println!(
        "platform={} arch={}",
        std::env::consts::OS,
        std::env::consts::ARCH
    );
    let bridge = BridgeClient::new(config.bridge, secret)?;
    if offline {
        println!("offline_checks=OK; SecureCRT runtime and client approval NOT tested");
        return Ok(());
    }
    let info = bridge.call("ping", serde_json::json!({})).await?;
    ensure!(
        info["bridge_version"].as_str() == Some(env!("CARGO_PKG_VERSION")),
        "running adapter version differs; Script > Cancel and run the upgraded script"
    );
    println!("bridge: OK\n{}", serde_json::to_string_pretty(&info)?);
    println!(
        "Check actual Python/SecureCRT compatibility in this report; external python --version is not the embedded runtime."
    );
    println!("Client approval rejection still requires the documented interactive test.");
    Ok(())
}

fn print_codex_config(approval_mode: &str, toolset: &str) -> Result<()> {
    let path = std::env::current_exe()?.to_string_lossy().into_owned();
    let quoted = toml::Value::String(path).to_string();
    let tool_timeout = 65 + 2 * Config::load()?.bridge.request_timeout_ms.div_ceil(1000);
    println!("# Merge this block into your config; do not duplicate an existing securecrt table.");
    println!(
        "[mcp_servers.securecrt]\ncommand = {quoted}\nargs = [\"serve\"]\nstartup_timeout_sec = 30\ntool_timeout_sec = {tool_timeout}\ndefault_tools_approval_mode = \"{approval_mode}\""
    );
    if toolset == "terminal" {
        let names = [
            "bridge_status",
            "list_sessions",
            "read_screen",
            "run_command",
            "get_command_status",
            "get_command_output",
            "interrupt",
            "acknowledge_idle",
            "attach",
            "exec",
            "exec_batch",
            "get_batch_status",
            "heartbeat",
            "detach",
            "shell_open",
            "shell_read",
            "shell_write",
            "shell_close",
            "latency",
        ];
        let tools = names
            .iter()
            .map(|n| toml::Value::String(format!("securecrt_{n}")))
            .collect();
        println!("enabled_tools = {}", toml::Value::Array(tools));
    }
    if toolset == "basic" {
        println!(
            "enabled_tools = [\"securecrt_bridge_status\", \"securecrt_list_sessions\", \"securecrt_read_screen\", \"securecrt_run_command\", \"securecrt_get_command_status\", \"securecrt_get_command_output\", \"securecrt_interrupt\", \"securecrt_acknowledge_idle\"]"
        );
    }
    for name in [
        "bridge_status",
        "list_sessions",
        "read_screen",
        "get_command_status",
        "get_command_output",
        "get_batch_status",
        "heartbeat",
        "shell_read",
        "latency",
    ] {
        println!("\n[mcp_servers.securecrt.tools.securecrt_{name}]\napproval_mode = \"approve\"");
    }
    println!(
        "\n# Requires a Codex version supporting these keys. Test rejection before enabling production sessions."
    );
    Ok(())
}
