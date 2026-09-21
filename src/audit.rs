use anyhow::{Context, Result};
use chrono::Utc;
use serde_json::json;
use sha2::{Digest, Sha256};
use std::{path::PathBuf, sync::Arc};
use tokio::{fs::{File,OpenOptions}, io::AsyncWriteExt, sync::Mutex};

/// Reuse one append handle. OS-buffered mode flushes Rust's pending write before
/// dispatch but does not fsync each event. each_event explicitly opts into durability latency.
#[derive(Clone)]
pub struct AuditLog {
    enabled: bool,
    include_text: bool,
    path: Arc<PathBuf>,
    file: Arc<Mutex<Option<File>>>,
    sync_each: bool,
}
impl AuditLog {
    pub fn new(enabled: bool, include_text: bool, path: PathBuf) -> Self {
        Self {enabled,include_text,path:Arc::new(path),file:Arc::new(Mutex::new(None)),sync_each:false}
    }
    pub fn with_sync(mut self,sync_each:bool)->Self {self.sync_each=sync_each;self}
    pub async fn record(&self,event:&str,id:&str,session:&str,detail:&str,command:Option<&str>)->Result<()> {
        if !self.enabled{return Ok(());}
        let record=json!({"timestamp":Utc::now().to_rfc3339(),"event":event,"command_id":id,
            "session":session,"detail":detail,
            "command_sha256":command.map(|c|format!("{:x}",Sha256::digest(c.as_bytes()))),
            "command":if self.include_text{command}else{None}});
        let mut bytes=serde_json::to_vec(&record)?;bytes.push(b'\n');
        let mut guard=self.file.lock().await;
        if guard.is_none(){
            let mut options=OpenOptions::new();options.create(true).append(true);
            #[cfg(unix)] options.mode(0o600);
            *guard=Some(options.open(self.path.as_ref()).await.context("audit log unavailable")?);
        }
        let result=async{
            let file=guard.as_mut().expect("opened above");
            file.write_all(&bytes).await?;
            // Wait for the OS write, not merely enqueue it on Tokio's filesystem pool.
            file.flush().await?;
            if self.sync_each{file.sync_data().await?;}
            Ok::<(),anyhow::Error>(())
        }.await;
        if result.is_err(){*guard=None;}
        result.context("audit write failed")
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[tokio::test]
    async fn missing_directory_is_not_silently_ignored(){
        let path=std::env::temp_dir().join(uuid::Uuid::new_v4().to_string()).join("audit.jsonl");
        assert!(AuditLog::new(true,false,path).record("dispatch","id","s","test",None).await.is_err());
    }
    #[tokio::test]
    async fn buffered_and_durable_writes_are_visible_before_return(){
        for sync in [false,true]{
            let path=std::env::temp_dir().join(format!("securecrt-audit-{}.jsonl",uuid::Uuid::new_v4()));
            let log=AuditLog::new(true,false,path.clone()).with_sync(sync);
            for i in 0..3 {log.record("test",&i.to_string(),"s","test",Some("sensitive text")).await.unwrap();}
            let text=tokio::fs::read_to_string(&path).await.unwrap();
            assert_eq!(text.lines().count(),3);
            assert!(!text.contains("sensitive text"));
            for line in text.lines(){serde_json::from_str::<serde_json::Value>(line).unwrap();}
            drop(log);tokio::fs::remove_file(path).await.unwrap();
        }
    }
}
