use anyhow::{Context, Result};
use chrono::Utc;
use serde_json::json;
use sha2::{Digest, Sha256};
use std::{path::PathBuf, sync::Arc};
use tokio::{fs::OpenOptions, io::AsyncWriteExt, sync::Mutex};

#[derive(Clone)]
pub struct AuditLog { enabled: bool, include_text: bool, path: Arc<PathBuf>, lock: Arc<Mutex<()>> }
impl AuditLog {
    pub fn new(enabled: bool, include_text: bool, path: PathBuf) -> Self {
        Self { enabled, include_text, path: Arc::new(path), lock: Arc::new(Mutex::new(())) }
    }
    pub async fn record(&self, event: &str, id: &str, session: &str, detail: &str, command: Option<&str>) -> Result<()> {
        if !self.enabled { return Ok(()); }
        let _guard = self.lock.lock().await;
        let mut options = OpenOptions::new();
        options.create(true).append(true);
        #[cfg(unix)]
        options.mode(0o600);
        // Do not silently create arbitrary parent directories or ignore permission errors.
        let mut file = options.open(self.path.as_ref()).await.context("audit log unavailable; action not authorized")?;
        let record = json!({"timestamp": Utc::now().to_rfc3339(), "event": event,
            "command_id": id, "session": session, "detail": detail,
            "command_sha256": command.map(|c| format!("{:x}", Sha256::digest(c.as_bytes()))),
            "command": if self.include_text { command } else { None }});
        let mut bytes = serde_json::to_vec(&record)?; bytes.push(b'\n');
        file.write_all(&bytes).await?;
        file.sync_data().await?;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[tokio::test]
    async fn missing_directory_is_not_silently_ignored() {
        let path = std::env::temp_dir().join(uuid::Uuid::new_v4().to_string()).join("audit.jsonl");
        assert!(AuditLog::new(true, false, path).record("dispatch", "id", "s", "test", None).await.is_err());
    }
}
