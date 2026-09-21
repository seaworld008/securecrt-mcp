//! One-shot local client. Uses the same Rust engine, never its own SSH connection.
use crate::{
    audit::AuditLog,
    bridge::BridgeClient,
    config::{self, Config},
    execution::Engine,
    fault,
    model::RunParams,
    policy::{Decision, PolicyEngine},
};
use anyhow::{Result, ensure};
use serde_json::{Value, json};
use std::{fs::File, io::Read};

fn engine() -> Result<Engine> {
    let config = Config::load()?;
    let bridge = BridgeClient::new(config.bridge.clone(), config::load_bridge_secret()?)?;
    let audit = AuditLog::new(
        config.audit.enabled,
        config.audit.include_command_text,
        config.audit_path()?,
    );
    let policy = PolicyEngine::new(&config.policy)?;
    Ok(Engine::new(bridge, audit, policy, config))
}
fn input(path: &str) -> Result<Value> {
    let mut bytes = Vec::new();
    if path == "-" {
        std::io::stdin().take(262_145).read_to_end(&mut bytes)?;
    } else {
        File::open(path)?.take(262_145).read_to_end(&mut bytes)?;
    }
    ensure!(
        bytes.len() <= 262_144,
        "invalid input: JSON exceeds 256 KiB"
    );
    // Windows editors may include a UTF-8 BOM; no locale-dependent decoding.
    let bytes = bytes.strip_prefix(&[0xef, 0xbb, 0xbf]).unwrap_or(&bytes);
    Ok(serde_json::from_slice(bytes)?)
}
fn emit(value: &Value) -> Result<()> {
    println!("{}", serde_json::to_string(value)?);
    Ok(())
}
pub async fn sessions() -> Result<()> {
    emit(&engine()?.bridge.call("list_sessions", json!({})).await?)
}
pub async fn screen(session: String) -> Result<()> {
    emit(
        &engine()?
            .bridge
            .call("read_screen", json!({"session":session}))
            .await?,
    )
}
pub fn policy_check(path: &str) -> Result<()> {
    let value = input(path)?;
    let command = value["command"]
        .as_str()
        .ok_or_else(|| anyhow::anyhow!("invalid command"))?;
    let config = Config::load()?;
    let decision = PolicyEngine::new(&config.policy)?.classify_command(command);
    emit(
        &json!({"mode":config.policy.mode, "config":config::config_path()?,
        "allowed":decision.decision==Decision::Allow,"reason":decision.reason,
        "sent":false,"client_approval_verified":false}),
    )
}
pub async fn run(path: &str) -> Result<()> {
    let operation = async {
        let params: RunParams = serde_json::from_value(input(path)?)?;
        let max = params.max_bytes.unwrap_or(16_384);
        let engine = engine()?;
        let mut result = engine.run_command(params).await?;
        // Do not exit just because the caller requested a short initial wait. The capture engine
        // must remain alive. Killing this CLI manually still requires explicit native recovery.
        while matches!(result["state"].as_str(), Some("starting" | "running")) {
            let id = result["command_id"]
                .as_str()
                .ok_or_else(|| anyhow::anyhow!("missing command_id"))?
                .to_owned();
            result = engine.wait_result(&id, 60_000, max).await?;
        }
        result["client"] = json!("one_shot_cli");
        result["output_available_after_exit"] = json!(false);
        Ok::<Value, anyhow::Error>(result)
    }
    .await;
    let result = operation.unwrap_or_else(|error| fault::details(&error));
    emit(&result)?;
    ensure!(
        result["state"] == "completed" && result["exit_code"].as_i64().is_none_or(|code| code == 0),
        "command did not complete successfully; see JSON result, do not replay automatically"
    );
    Ok(())
}
