//! Explicit migration of a stopped legacy native script; never release its
//! retained OS handle, stop a terminal process, or alter SSH sessions.
use anyhow::{Context, Result, ensure};
use serde_json::{Value, json};
use std::{
    fs,
    path::Path,
    time::{SystemTime, UNIX_EPOCH},
};

pub fn record(
    root: &Path,
    pid: u32,
    previous: &str,
    source: &str,
    stopped: bool,
    idle: bool,
) -> Result<Value> {
    ensure!(
        stopped && idle,
        "confirm the original script stopped and its captures are idle; no repair written"
    );
    ensure!(
        pid > 0 && uuid::Uuid::parse_str(previous).is_ok(),
        "invalid native host identity"
    );
    let now = SystemTime::now().duration_since(UNIX_EPOCH)?.as_millis() as u64;
    let host = root.join("hosts").join(pid.to_string());
    for p in [
        root.to_path_buf(),
        root.join("hosts"),
        host.clone(),
        host.join("owner.json"),
    ] {
        let m = fs::symlink_metadata(&p)?;
        ensure!(
            !m.file_type().is_symlink(),
            "native recovery links are not permitted"
        );
        #[cfg(windows)]
        {
            use std::os::windows::fs::MetadataExt;
            ensure!(
                m.file_attributes() & 0x400 == 0,
                "native recovery reparse points are not permitted"
            );
        }
    }
    let owner: Value = serde_json::from_slice(&fs::read(host.join("owner.json"))?)?;
    ensure!(
        owner["bridge_instance"] == previous && owner["fenced"] != true,
        "legacy native generation mismatch; no repair written"
    );
    ensure!(
        owner["capture_count"].as_u64().unwrap_or(0) == 0
            && owner["unresolved_count"].as_u64().unwrap_or(0) == 0,
        "original generation still has captures or uncertainty"
    );
    let heartbeat = owner["last_poll_ms"]
        .as_u64()
        .context("missing native heartbeat")?;
    ensure!(
        now.saturating_sub(heartbeat) >= 5000,
        "native generation is still fresh; no repair written"
    );
    let path = host.join("legacy-stop.json");
    if let Ok(m) = fs::symlink_metadata(&path) {
        ensure!(
            !m.file_type().is_symlink(),
            "native recovery receipt is a link"
        );
        #[cfg(windows)]
        {
            use std::os::windows::fs::MetadataExt;
            ensure!(
                m.file_attributes() & 0x400 == 0,
                "native recovery receipt is a reparse point"
            );
        }
    }
    let receipt = json!({"confirmed_script_stopped":true,"confirmed_idle":true,"bridge_instance":previous,"host_pid":pid,"adapter_sha256":source,"expires_ms":now+60000});
    // The consumer parses complete bounded JSON and fails closed while this
    // explicit repair receipt is incomplete.
    fs::write(&path, serde_json::to_vec(&receipt)?)?;
    Ok(
        json!({"recorded":true,"host_pid":pid,"expires_ms":now+60000,"scope":"stopped legacy script only; reload the installed native entry within 60 seconds"}),
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn migration_requires_confirmation_matching_stale_legacy_identity_and_idle_state() {
        let root =
            std::env::temp_dir().join(format!("securecrt-recovery-{}", uuid::Uuid::new_v4()));
        let id = uuid::Uuid::new_v4().to_string();
        let host = root.join("hosts/123");
        fs::create_dir_all(&host).unwrap();
        let owner = host.join("owner.json");
        let now = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_millis() as u64;
        fs::write(
            &owner,
            serde_json::to_vec(&json!({"bridge_instance":id,"last_poll_ms":now})).unwrap(),
        )
        .unwrap();
        assert!(record(&root, 123, &id, "source", false, true).is_err());
        assert!(record(&root, 123, &id, "source", true, false).is_err());
        assert!(record(&root, 123, &id, "source", true, true).is_err());
        fs::write(
            &owner,
            serde_json::to_vec(
                &json!({"bridge_instance":id,"last_poll_ms":now-6000,"unresolved_count":1}),
            )
            .unwrap(),
        )
        .unwrap();
        assert!(record(&root, 123, &id, "source", true, true).is_err());
        fs::write(
            &owner,
            serde_json::to_vec(&json!({"bridge_instance":id,"last_poll_ms":now-6000})).unwrap(),
        )
        .unwrap();
        assert!(
            record(
                &root,
                123,
                &uuid::Uuid::new_v4().to_string(),
                "source",
                true,
                true
            )
            .is_err()
        );
        assert!(!host.join("legacy-stop.json").exists());
        assert!(record(&root, 123, &id, "source", true, true).unwrap()["recorded"] == true);
        assert!(host.join("legacy-stop.json").is_file());
        fs::remove_dir_all(&root).unwrap();
    }
}
