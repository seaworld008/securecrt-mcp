//! Agent-oriented orchestration over the same low-level execution engine.
use super::*;
use crate::{fault, model::RunParams};

impl Engine {
    /// One call, one intended send. The client owns approval; no hidden recovery sends.
    pub async fn run_command(&self, params: RunParams) -> Result<Value> {
        match self.run_command_inner(params).await {
            Ok(result) => Ok(result),
            Err(error) => Ok(fault::details(&error)),
        }
    }

    async fn run_command_inner(&self, p: RunParams) -> Result<Value> {
        let timeout = p
            .timeout_ms
            .unwrap_or(30_000.min(self.config.bridge.max_command_timeout_ms));
        let max = p.max_bytes.unwrap_or(16_384);
        let wait = p
            .wait_ms
            .unwrap_or((timeout + 2 * self.config.bridge.request_timeout_ms).min(50_000));
        ensure!((4..=65_536).contains(&max), "invalid max_bytes (4..65536)");
        ensure!(wait <= 60_000, "invalid wait_ms (0..60000)");
        ensure!(
            (1000..=self.config.bridge.max_command_timeout_ms).contains(&timeout),
            "invalid timeout_ms"
        );
        let op = p
            .operation_id
            .clone()
            .unwrap_or_else(|| Uuid::new_v4().to_string());
        // Do not include ephemeral screen tokens or response pagination/wait choices.
        let fingerprint = format!(
            "run:{:x}",
            Sha256::digest(serde_json::to_vec(&json!({
                "session": p.session, "command": p.command, "mode": p.mode,
                "expected_prompt": p.expected_prompt, "wait_for": p.wait_for,
                "timeout_ms": timeout, "settle_ms": p.settle_ms.unwrap_or(750)
            }))?)
        );
        // Serialize only preflight/dispatch. Never wait in a queue and type later unexpectedly.
        let gate_ref = self.gate_for(&p.session).await;
        let gate = gate_ref
            .try_lock()
            .map_err(|_| anyhow::anyhow!("busy: another command is preparing; nothing sent"))?;
        let existing = {
            let registry = self.inner.lock().await;
            if let Some((id, hash)) = registry.operations.get(&op) {
                ensure!(
                    *hash == fingerprint,
                    "operation_id conflict: parameters differ; nothing sent"
                );
                Some(id.clone())
            } else {
                ensure!(
                    !registry.busy.contains_key(&p.session),
                    "busy/unresolved: inspect current operation; nothing sent"
                );
                None
            }
        };
        if let Some(id) = existing {
            drop(gate);
            return self.wait_result(&id, wait, max).await;
        }
        if p.mode == CaptureMode::Posix && self.bridge.supports_fast().await? {
            let job = self
                .submit_internal(
                    ExecuteParams {
                        session: p.session,
                        attachment_id: None,
                        screen_token: String::new(),
                        expected_prompt: p.expected_prompt.unwrap_or_default(),
                        operation_id: op,
                        command: p.command,
                        mode: p.mode,
                        wait_for: p.wait_for,
                        timeout_ms: Some(timeout),
                        settle_ms: p.settle_ms,
                    },
                    Some(fingerprint),
                )
                .await?;
            drop(gate);
            return self
                .wait_result(
                    job["command_id"].as_str().context("missing command_id")?,
                    wait,
                    max,
                )
                .await;
        }
        // Reading is not a command or a remote probe. Explicit mode is still required.
        let screen = self
            .bridge
            .call("read_screen", json!({"session": p.session}))
            .await
            .map_err(|e| anyhow::anyhow!("preflight read failed (nothing sent): {e}"))?;
        let current = screen["current_line"].as_str().unwrap_or("").trim_end();
        let expected = match p.expected_prompt {
            Some(prompt) => {
                ensure!(
                    prompt.trim_end() == current,
                    "prompt_mismatch: expected input changed; nothing sent"
                );
                prompt.trim_end().to_owned()
            }
            None => {
                ensure!(
                    p.mode == CaptureMode::Posix && shell_prompt_candidate(current),
                    "input_context_required: automatic capture requires an idle POSIX-style prompt; supply explicit expected_prompt only after inspection"
                );
                current.to_owned()
            }
        };
        let token = screen["screen_token"]
            .as_str()
            .ok_or_else(|| anyhow::anyhow!("bridge_incompatible: missing screen token"))?
            .to_owned();
        let job = self
            .submit_internal(
                ExecuteParams {
                    attachment_id: None,
                    session: p.session,
                    screen_token: token,
                    expected_prompt: expected,
                    operation_id: op,
                    command: p.command,
                    mode: p.mode,
                    wait_for: p.wait_for,
                    timeout_ms: Some(timeout),
                    settle_ms: p.settle_ms,
                },
                Some(fingerprint),
            )
            .await?;
        let id = job["command_id"]
            .as_str()
            .ok_or_else(|| anyhow::anyhow!("missing command_id"))?
            .to_owned();
        drop(gate);
        self.wait_result(&id, wait, max).await
    }

    /// Bounded wait and first page, without a second command dispatch.
    pub async fn wait_result(&self, id: &str, wait_ms: u64, max_bytes: usize) -> Result<Value> {
        ensure!(
            wait_ms <= 60_000 && (4..=65_536).contains(&max_bytes),
            "invalid bounded wait/output parameters"
        );
        let until = Instant::now() + Duration::from_millis(wait_ms);
        loop {
            let changed = self.changed.notified();
            tokio::pin!(changed);
            changed.as_mut().enable();
            let registry = self.inner.lock().await;
            let job = registry.jobs.get(id).ok_or_else(|| fault::BridgeFault {
                message: "unknown/expired command_id; never infer it was not executed".into(),
                sent: None,
            })?;
            if !job.state.active() || Instant::now() >= until {
                let mut result = job.snapshot();
                let end = prefix_len(&job.output, max_bytes);
                result["text"] = json!(&job.output[..end]);
                result["cursor"] = json!(job.output_start);
                result["next_cursor"] = if end < job.output.len() || job.state.active() {
                    json!(end + job.output_start)
                } else {
                    Value::Null
                };
                result["wait_budget_exhausted"] = json!(job.state.active());
                return Ok(result);
            }
            drop(registry);
            let _ = tokio::time::timeout_at(tokio::time::Instant::from_std(until), changed).await;
        }
    }
}

fn shell_prompt_candidate(line: &str) -> bool {
    if line.is_empty() || line.len() > 512 || line.chars().any(char::is_control) {
        return false;
    }
    let lower = line.to_lowercase();
    if [
        "password",
        "passphrase",
        "--more--",
        "verification code",
        "otp:",
        "密码",
    ]
    .iter()
    .any(|s| lower.contains(s))
    {
        return false;
    }
    // A UX heuristic, not host authentication. Bare '>' is a continuation prompt.
    line.ends_with('$') || line.ends_with('#') || line.ends_with('%')
}

impl Engine {
    /// Graceful EOF only: drain already-sent work for at most two seconds. No new command,
    /// no interrupt and no implicit acknowledgement. Hard termination still needs recovery.
    pub async fn drain_on_disconnect(&self) {
        let until = tokio::time::Instant::now() + Duration::from_secs(2);
        loop {
            let changed = self.changed.notified();
            tokio::pin!(changed);
            changed.as_mut().enable();
            let active = self
                .inner
                .lock()
                .await
                .jobs
                .values()
                .any(|j| j.state.active());
            if !active || tokio::time::Instant::now() >= until {
                break;
            }
            let _ = tokio::time::timeout_at(until, changed).await;
        }
    }
    async fn gate_for(&self, session: &str) -> Arc<Mutex<()>> {
        let mut gates = self.run_gates.lock().await;
        // Retain a gate only while somebody is holding or awaiting it.
        gates.retain(|_, v| Arc::strong_count(v) > 1);
        gates
            .entry(session.into())
            .or_insert_with(|| Arc::new(Mutex::new(())))
            .clone()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn prompt_candidate_does_not_guess_password_or_continuation_context() {
        assert!(shell_prompt_candidate("root@test:~#"));
        assert!(shell_prompt_candidate("user$"));
        for line in [
            ">",
            ">>>",
            "mysql>",
            "Password:",
            "--More--",
            "",
            "Password#",
        ] {
            assert!(!shell_prompt_candidate(line), "{line}");
        }
    }
}
