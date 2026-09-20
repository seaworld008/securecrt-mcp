use anyhow::{Context, Result};
use chrono::Utc;
use serde::Serialize;
use std::{path::PathBuf, sync::Arc};
use tokio::{fs::OpenOptions, io::AsyncWriteExt, sync::Mutex};

#[derive(Clone)]
pub struct AuditLog {
    enabled: bool,
    include_command_text: bool,
    path: Arc<PathBuf>,
    lock: Arc<Mutex<()>>,
}

#[derive(Serialize)]
struct AuditRecord<'a> {
    timestamp: String,
    action: &'a str,
    session: Option<&'a str>,
    allowed: bool,
    reason: &'a str,
    command: Option<&'a str>,
}

impl AuditLog {
    pub fn new(enabled: bool, include_command_text: bool, path: PathBuf) -> Self {
        Self {
            enabled,
            include_command_text,
            path: Arc::new(path),
            lock: Arc::new(Mutex::new(())),
        }
    }

    pub async fn record(
        &self,
        action: &str,
        session: Option<&str>,
        allowed: bool,
        reason: &str,
        command: Option<&str>,
    ) -> Result<()> {
        if !self.enabled {
            return Ok(());
        }

        let _guard = self.lock.lock().await;
        if let Some(parent) = self.path.parent() {
            tokio::fs::create_dir_all(parent).await.with_context(|| {
                format!("failed to create audit directory: {}", parent.display())
            })?;
        }

        let record = AuditRecord {
            timestamp: Utc::now().to_rfc3339(),
            action,
            session,
            allowed,
            reason,
            command: if self.include_command_text {
                command
            } else {
                None
            },
        };
        let mut line = serde_json::to_vec(&record).context("failed to serialize audit record")?;
        line.push(b'\n');

        let mut file = OpenOptions::new()
            .create(true)
            .append(true)
            .open(self.path.as_ref())
            .await
            .with_context(|| format!("failed to open audit log: {}", self.path.display()))?;
        file.write_all(&line)
            .await
            .context("failed to append audit record")?;
        Ok(())
    }
}
