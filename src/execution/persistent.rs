//! Persistent attachment and batch orchestration. Uses the same audited execution path.
use super::*;
use crate::{fault, terminal::*};

#[derive(Default)]
pub(super) struct TerminalState {
    attachments: HashMap<String, Value>,
    batches: HashMap<String, (String, Value)>,
}
impl Engine {
    pub async fn attach(&self, p: AttachParams) -> Result<Value> {
        ensure!(
            self.bridge.supports_fast().await?,
            "bridge_incompatible: upgrade and restart for attachments"
        );
        ensure!(
            ["shared", "exclusive", "observe"].contains(&p.mode.as_str()),
            "invalid ownership mode"
        );
        let mut registry = self.terminal.lock().await;
        ensure!(
            registry.attachments.len() < 128,
            "attachment cache full; detach unused attachments"
        );
        let value = self.bridge.call("attach", serde_json::to_value(p)?).await?;
        let id = value["attachment_id"]
            .as_str()
            .context("missing attachment_id")?
            .to_owned();
        registry.attachments.insert(id, value.clone());
        Ok(value)
    }
    pub async fn detach(&self, id: &str) -> Result<Value> {
        let result = self
            .bridge
            .call("detach", json!({"attachment_id":id}))
            .await;
        // Explicitly forget an unusable local handle even if the native lease expired.
        self.terminal.lock().await.attachments.remove(id);
        result
    }
    pub async fn exec(&self, p: ExecParams) -> Result<Value> {
        let a = self
            .terminal
            .lock()
            .await
            .attachments
            .get(&p.attachment_id)
            .cloned()
            .context("stale_attachment: attach using this persistent MCP/daemon instance")?;
        ensure!(
            a["mode"] != "observe",
            "observe attachment does not permit commands"
        );
        let timeout = p.timeout_ms.unwrap_or(if p.mode == CaptureMode::Stream {
            self.config.bridge.max_stream_timeout_ms.min(600000)
        } else {
            self.config.bridge.max_command_timeout_ms.min(30000)
        });
        let wait = p
            .wait_ms
            .unwrap_or((timeout + 2 * self.config.bridge.request_timeout_ms).min(50000));
        let max = p.max_bytes.unwrap_or(16384);
        ensure!(
            wait <= 60000 && (4..=65536).contains(&max),
            "invalid wait_ms/max_bytes"
        );
        let fingerprint = format!(
            "attachment:{:x}",
            Sha256::digest(serde_json::to_vec(&json!({
            "attachment":p.attachment_id,"command":p.command,"mode":p.mode,"timeout":timeout,"wait_for":p.wait_for}))?)
        );
        let job = self
            .submit_internal(
                ExecuteParams {
                    session: a["session"]
                        .as_str()
                        .context("invalid attachment session")?
                        .into(),
                    attachment_id: Some(p.attachment_id),
                    screen_token: String::new(),
                    expected_prompt: String::new(),
                    operation_id: p.operation_id.unwrap_or_else(|| Uuid::new_v4().to_string()),
                    command: p.command,
                    mode: p.mode,
                    wait_for: p.wait_for,
                    timeout_ms: Some(timeout),
                    settle_ms: None,
                },
                Some(fingerprint),
            )
            .await?;
        self.wait_result(
            job["command_id"].as_str().context("missing command_id")?,
            wait,
            max,
        )
        .await
    }
    pub async fn exec_batch(&self, p: BatchParams) -> Result<Value> {
        ensure!(
            !p.commands.is_empty() && p.commands.len() <= 20,
            "batch needs 1..20 explicit commands"
        );
        ensure!(
            p.commands.iter().map(String::len).sum::<usize>() <= 32768,
            "batch input exceeds 32 KiB"
        );
        let policy = p.on_error.as_deref().unwrap_or("stop");
        ensure!(
            ["stop", "continue"].contains(&policy),
            "on_error must be stop or continue"
        );
        ensure!(
            self.terminal
                .lock()
                .await
                .attachments
                .contains_key(&p.attachment_id),
            "stale_attachment"
        );
        for command in &p.commands {
            let d = self.policy.classify_command(command);
            ensure!(
                d.decision == Decision::Allow,
                "batch preflight rejected before any send: {}",
                d.reason
            );
        }
        let id = p
            .operation_id
            .clone()
            .unwrap_or_else(|| Uuid::new_v4().to_string());
        ensure!(
            !id.is_empty()
                && id.len() <= 96
                && id
                    .bytes()
                    .all(|b| b.is_ascii_alphanumeric() || b"._-".contains(&b)),
            "invalid batch operation_id"
        );
        let hash = format!("{:x}", Sha256::digest(serde_json::to_vec(&p)?));
        let initial =
            json!({"batch_id":id,"state":"running","results":[],"automatic_replay":false});
        {
            let mut state = self.terminal.lock().await;
            if let Some((old, value)) = state.batches.get(&id) {
                ensure!(old == &hash, "operation_id conflict");
                return Ok(value.clone());
            }
            ensure!(
                state.batches.len() < 128,
                "batch ledger full; complete work before restarting"
            );
            state.batches.insert(id.clone(), (hash, initial.clone()));
        }
        let engine = self.clone();
        let batch = id.clone();
        tokio::spawn(async move {
            let mut stopped = false;
            for (index, command) in p.commands.iter().enumerate() {
                let op = format!(
                    "batch-{:x}",
                    Sha256::digest(format!("{batch}:{index}").as_bytes())
                );
                let result = engine
                    .exec(ExecParams {
                        attachment_id: p.attachment_id.clone(),
                        command: command.clone(),
                        mode: CaptureMode::Posix,
                        operation_id: Some(op),
                        timeout_ms: p.timeout_ms,
                        wait_ms: Some(60000),
                        max_bytes: Some(1024),
                        wait_for: None,
                    })
                    .await;
                let mut result = result.unwrap_or_else(|e| fault::details(&e));
                while matches!(result["state"].as_str(), Some("starting" | "running")) {
                    let Some(cid) = result["command_id"].as_str() else {
                        break;
                    };
                    result = engine
                        .wait_result(cid, 60000, 1024)
                        .await
                        .unwrap_or_else(|e| fault::details(&e));
                }
                result["index"] = json!(index);
                stopped = result["state"] != "completed"
                    || result["requires_idle_ack"] == true
                    || (p.on_error.as_deref() != Some("continue")
                        && result["exit_code"].as_i64() != Some(0));
                let mut state = engine.terminal.lock().await;
                if let Some((_, value)) = state.batches.get_mut(&batch) {
                    value["results"].as_array_mut().unwrap().push(result);
                }
                drop(state);
                if stopped {
                    break;
                }
            }
            if let Some((_, value)) = engine.terminal.lock().await.batches.get_mut(&batch) {
                value["state"] = json!(if stopped { "stopped" } else { "completed" });
            }
        });
        Ok(initial)
    }
    pub async fn batch_status(&self, id: &str) -> Result<Value> {
        self.terminal
            .lock()
            .await
            .batches
            .get(id)
            .map(|(_, v)| v.clone())
            .context("unknown batch_id; never replay")
    }
    pub async fn stream_read(&self, p: StreamReadParams) -> Result<Value> {
        let wait = p.wait_ms.unwrap_or(1000);
        ensure!(wait <= 60000, "invalid wait_ms");
        let until = tokio::time::Instant::now() + Duration::from_millis(wait);
        loop {
            let changed = self.changed.notified();
            tokio::pin!(changed);
            changed.as_mut().enable();
            let value = self
                .output(OutputParams {
                    command_id: p.command_id.clone(),
                    cursor: p.cursor,
                    max_bytes: p.max_bytes,
                })
                .await?;
            if value["text"].as_str().is_some_and(|s| !s.is_empty())
                || !matches!(value["state"].as_str(), Some("starting" | "running"))
                || tokio::time::Instant::now() >= until
            {
                return Ok(value);
            }
            let _ = tokio::time::timeout_at(until, changed).await;
        }
    }
    pub async fn stream_write(&self, p: StreamWriteParams) -> Result<Value> {
        ensure!(
            self.policy.raw_send_allowed(),
            "interactive raw input disabled: explicitly enable allow_raw_send and client approval"
        );
        ensure!(
            !p.text.is_empty() && p.text.len() <= 8192,
            "invalid raw input length"
        );
        // This is explicit raw input, not a claim that fragments can be classified as shell commands.
        let session = {
            let registry = self.inner.lock().await;
            let j = registry.jobs.get(&p.command_id).context("unknown stream")?;
            ensure!(
                j.stream && j.state.active(),
                "not an active interactive stream"
            );
            j.session.clone()
        };
        self.audit
            .record(
                "stream_write",
                &p.command_id,
                &session,
                "explicit raw input",
                Some(&p.text),
            )
            .await?;
        self.bridge.call("stream_write",json!({"capture_id":p.command_id,"text":p.text,"append_enter":p.append_enter.unwrap_or(true)})).await
    }
    pub async fn stream_close(&self, id: &str) -> Result<Value> {
        let session = {
            let registry = self.inner.lock().await;
            let j = registry.jobs.get(id).context("unknown stream")?;
            ensure!(j.stream && j.state.active(), "not an active stream");
            j.session.clone()
        };
        self.audit
            .record(
                "stream_close",
                id,
                &session,
                "stop capture only; no remote interrupt",
                None,
            )
            .await?;
        if let Some(j) = self.inner.lock().await.jobs.get(id) {
            j.stop.store(true, Ordering::SeqCst);
        }
        self.wait_result(id, 5000, 16384).await
    }
    pub async fn latency(&self, samples: u32) -> Result<Value> {
        ensure!(
            (1..=100).contains(&samples),
            "latency samples must be 1..100"
        );
        let mut values = Vec::new();
        let mut runtime = Value::Null;
        for _ in 0..samples {
            let t = Instant::now();
            runtime = self.bridge.call("ping", json!({})).await?;
            values.push(t.elapsed().as_micros() as u64);
        }
        values.sort_unstable();
        let count = values.len();
        Ok(
            json!({"samples":count,"p50_us":values[count/2],"p95_us":values[(count*95/100).min(count-1)],
            "min_us":values[0],"max_us":values[count-1],"transport":self.bridge.metrics(),"runtime":runtime,
            "scope":"local connector ping only; excludes SSH command, VPN, LLM and approval latency","sent":false}),
        )
    }
}

impl Engine {
    pub async fn quiescent(&self) -> Result<()> {
        ensure!(
            self.inner.lock().await.busy.is_empty(),
            "cannot stop daemon with active/unresolved jobs; inspect and resolve first"
        );
        ensure!(
            !self
                .terminal
                .lock()
                .await
                .batches
                .values()
                .any(|(_, b)| b["state"] == "running"),
            "cannot stop daemon with active batch"
        );
        Ok(())
    }
}
