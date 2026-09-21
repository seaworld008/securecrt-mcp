//! Command lifecycle and bounded output. No automatic replay, implicit Ctrl+C or shell guessing.
use crate::{
    audit::AuditLog,
    bridge::BridgeClient,
    config::Config,
    model::{CaptureMode, ContextParams, ExecuteParams, OutputParams},
    policy::{Decision, PolicyEngine},
};
use anyhow::{Result, ensure};
mod convenience;
use serde::Serialize;
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use std::{
    collections::HashMap,
    sync::{
        Arc,
        atomic::{AtomicBool, Ordering},
    },
    time::{Duration, Instant},
};
use tokio::sync::Mutex;
use uuid::Uuid;

#[derive(Clone, Copy, Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum State {
    Starting,
    Running,
    Completed,
    TimedOut,
    Cancelled,
    Unknown,
    Rejected,
}
impl State {
    fn active(self) -> bool {
        matches!(self, Self::Starting | Self::Running)
    }
}

struct Job {
    id: String,
    operation_id: String,
    sent: Option<bool>,
    requires_idle_ack: bool,
    session: String,
    state: State,
    output: String,
    output_bytes: usize,
    exit_code: Option<i32>,
    reason: String,
    truncated: bool,
    incomplete: bool,
    audit_warning: Option<String>,
    finished: Option<Instant>,
    stop: Arc<AtomicBool>,
}
impl Job {
    fn snapshot(&self) -> Value {
        json!({"command_id": self.id, "operation_id": self.operation_id, "session": self.session, "state": self.state,
            "sent": self.sent, "requires_idle_ack": self.requires_idle_ack,
            "error_code": if matches!(self.state, State::Rejected | State::Unknown | State::TimedOut) { Some(crate::fault::code(&self.reason)) } else { None },
            "action": if self.state.active() { "Poll this command_id or explicitly interrupt; never resubmit." }
                else if self.requires_idle_ack { crate::fault::action("busy_unresolved") }
                else if self.state == State::Rejected { crate::fault::action(crate::fault::code(&self.reason)) }
                else { "Read further output pages if next_cursor is present." },
            "automatic_retry": false,
            "exit_code": self.exit_code, "reason": self.reason, "truncated": self.truncated,
            "capture_may_be_incomplete": self.incomplete, "retained_bytes": self.output.len(),
            "observed_output_bytes": self.output_bytes, "audit_warning": self.audit_warning,
            "remote_termination_confirmed": false})
    }
    fn append(&mut self, text: &str, limit: usize) {
        self.output_bytes = self.output_bytes.saturating_add(text.len());
        let count = prefix_len(text, limit.saturating_sub(self.output.len()));
        self.output.push_str(&text[..count]);
        self.truncated |= count != text.len();
    }
}

#[derive(Default)]
struct Registry {
    jobs: HashMap<String, Job>,
    // Tombstones prevent replay even after output expires; bounded, refuse new submissions at cap.
    operations: HashMap<String, (String, String)>,
    busy: Option<String>,
}

#[derive(Clone)]
pub struct Engine {
    pub bridge: BridgeClient,
    pub audit: AuditLog,
    pub policy: PolicyEngine,
    pub config: Config,
    inner: Arc<Mutex<Registry>>,
    run_gate: Arc<Mutex<()>>,
}

impl Engine {
    pub fn new(
        bridge: BridgeClient,
        audit: AuditLog,
        policy: PolicyEngine,
        config: Config,
    ) -> Self {
        Self {
            bridge,
            audit,
            policy,
            config,
            inner: Arc::new(Mutex::new(Registry::default())),
            run_gate: Arc::new(Mutex::new(())),
        }
    }

    pub async fn submit(&self, p: ExecuteParams) -> Result<Value> {
        self.submit_internal(p, None).await
    }

    async fn submit_internal(
        &self,
        p: ExecuteParams,
        stable_fingerprint: Option<String>,
    ) -> Result<Value> {
        ensure!(
            !p.operation_id.is_empty()
                && p.operation_id.len() <= 128
                && p.operation_id
                    .bytes()
                    .all(|b| b.is_ascii_alphanumeric() || b"-_.".contains(&b)),
            "operation_id must be 1..128 ASCII identifier characters"
        );
        let timeout = p.timeout_ms.unwrap_or(5000);
        ensure!(
            (1000..=self.config.bridge.max_command_timeout_ms).contains(&timeout),
            "invalid timeout_ms"
        );
        let settle = p.settle_ms.unwrap_or(750);
        ensure!(
            (25..=timeout.min(10_000)).contains(&settle),
            "invalid settle_ms"
        );
        ensure!(
            !p.expected_prompt.trim().is_empty()
                && p.expected_prompt.len() <= 512
                && !p.expected_prompt.chars().any(char::is_control),
            "invalid expected_prompt"
        );
        if p.mode == CaptureMode::Prompt {
            ensure!(
                p.wait_for.as_ref().is_some_and(|s| !s.trim().is_empty()
                    && s.len() <= 512
                    && !s.chars().any(char::is_control)),
                "prompt mode requires a nonempty literal wait_for"
            );
        }
        let fingerprint =
            stable_fingerprint.unwrap_or(format!("{:x}", Sha256::digest(serde_json::to_vec(&p)?)));
        let id = Uuid::new_v4().to_string();
        let stop = Arc::new(AtomicBool::new(false));
        {
            let mut registry = self.inner.lock().await;
            if let Some((old_id, hash)) = registry.operations.get(&p.operation_id) {
                ensure!(
                    *hash == fingerprint,
                    "operation_id conflict: parameters differ; nothing sent"
                );
                return registry.jobs.get(old_id).map(Job::snapshot).ok_or_else(|| {
                    anyhow::anyhow!(
                        "operation already seen but output expired; never replay automatically"
                    )
                });
            }
            ensure!(
                registry.busy.is_none(),
                "busy/unresolved: inspect the current job and acknowledge idle; no automatic interrupt"
            );
            let retention = Duration::from_secs(self.config.bridge.job_retention_sec);
            registry
                .jobs
                .retain(|_, j| j.finished.is_none_or(|t| t.elapsed() < retention));
            if registry.jobs.len() >= self.config.bridge.max_jobs {
                // Output eviction never removes the operation ledger: old IDs cannot replay.
                let oldest = registry
                    .jobs
                    .iter()
                    .filter_map(|(id, job)| job.finished.map(|finished| (id.clone(), finished)))
                    .min_by_key(|(_, finished)| *finished)
                    .map(|(id, _)| id);
                if let Some(id) = oldest {
                    registry.jobs.remove(&id);
                }
            }
            ensure!(
                registry.jobs.len() < self.config.bridge.max_jobs,
                "job cache full; active work is never evicted"
            );
            ensure!(
                registry.operations.len() < 4096,
                "operation ledger full; inspect all work before restarting MCP"
            );
            registry
                .operations
                .insert(p.operation_id.clone(), (id.clone(), fingerprint));
            registry.busy = Some(id.clone());
            registry.jobs.insert(
                id.clone(),
                Job {
                    id: id.clone(),
                    operation_id: p.operation_id.clone(),
                    sent: Some(false),
                    requires_idle_ack: false,
                    session: p.session.clone(),
                    state: State::Starting,
                    output: String::new(),
                    output_bytes: 0,
                    exit_code: None,
                    reason: "dispatch pending".into(),
                    truncated: false,
                    incomplete: false,
                    audit_warning: None,
                    finished: None,
                    stop: stop.clone(),
                },
            );
        }
        let decision = self.policy.classify_command(&p.command);
        // Mandatory before-send audit: an I/O error must not be swallowed.
        if let Err(error) = self
            .audit
            .record(
                "dispatch_attempt",
                &id,
                &p.session,
                &decision.reason,
                Some(&p.command),
            )
            .await
        {
            self.finish(
                &id,
                State::Rejected,
                None,
                &format!("not sent: {error}"),
                true,
            )
            .await;
            return self.status(&id).await;
        }
        if decision.decision == Decision::Deny {
            self.finish(&id, State::Rejected, None, &decision.reason, true)
                .await;
            return self.status(&id).await;
        }
        let marker_id = Uuid::new_v4().simple().to_string();
        let begin = format!("MCP_BEGIN_{marker_id}");
        let end = format!("MCP_END_{marker_id}");
        let text = if p.mode == CaptureMode::Posix {
            envelope(&p.command, &begin, &end)
        } else {
            p.command.clone()
        };
        let request = json!({"session": p.session, "screen_token": p.screen_token,
            "expected_prompt": p.expected_prompt, "text": text, "capture_id": id, "runtime_ms": timeout});
        if let Some(job) = self.inner.lock().await.jobs.get_mut(&id) {
            job.sent = None;
        }
        if let Err(error) = self.bridge.call("begin", request).await {
            let unsent = error
                .downcast_ref::<crate::fault::BridgeFault>()
                .is_some_and(|e| e.sent == Some(false));
            if let Some(job) = self.inner.lock().await.jobs.get_mut(&id) {
                job.sent = if unsent { Some(false) } else { None };
            }
            self.finish(
                &id,
                if unsent {
                    State::Rejected
                } else {
                    State::Unknown
                },
                None,
                &format!(
                    "{}: {error}",
                    if unsent {
                        "not sent"
                    } else {
                        "dispatch outcome unknown; do not replay"
                    }
                ),
                unsent,
            )
            .await;
            return self.status(&id).await;
        }
        if let Some(job) = self.inner.lock().await.jobs.get_mut(&id) {
            job.sent = Some(true);
            job.state = State::Running;
            job.reason = "capturing output".into();
        }
        let engine = self.clone();
        let job_id = id.clone();
        tokio::spawn(async move {
            engine.run(job_id, p, begin, end, stop).await;
        });
        self.status(&id).await
    }

    async fn run(
        &self,
        id: String,
        p: ExecuteParams,
        begin: String,
        end: String,
        stop: Arc<AtomicBool>,
    ) {
        let started = Instant::now();
        let timeout = Duration::from_millis(p.timeout_ms.unwrap_or(5000));
        let settle = Duration::from_millis(p.settle_ms.unwrap_or(750));
        let mut parser = MarkerParser::new(begin, end);
        let mut prompt_tail = String::new();
        let (mut state, mut code, mut reason) = loop {
            if stop.load(Ordering::SeqCst) {
                break (
                    State::Cancelled,
                    None,
                    "interrupt requested; termination unproven".to_owned(),
                );
            }
            if started.elapsed() >= timeout {
                break (
                    State::TimedOut,
                    None,
                    "capture deadline exceeded; remote may still run".to_owned(),
                );
            }
            let request = json!({"capture_id": id, "wait_for": if p.mode == CaptureMode::Prompt { p.wait_for.clone() } else { None }});
            let response = match self.bridge.call("poll", request).await {
                Ok(value) => value,
                Err(error) => {
                    break (
                        State::Unknown,
                        None,
                        format!("capture lost: {error}; no replay"),
                    );
                }
            };
            let chunk = response["text"].as_str().unwrap_or("");
            let (output, exit) = if p.mode == CaptureMode::Posix {
                parser.feed(chunk)
            } else {
                (chunk.to_owned(), None)
            };
            if let Some(job) = self.inner.lock().await.jobs.get_mut(&id) {
                job.append(&output, self.config.bridge.max_output_bytes);
                job.incomplete |= response["capture_may_be_incomplete"]
                    .as_bool()
                    .unwrap_or(true);
            }
            if response["overflow"].as_bool() == Some(true) || parser.overflow {
                break (
                    State::Unknown,
                    None,
                    "native chunk/line exceeded capture bound; output incomplete".to_owned(),
                );
            }
            if response["expired"].as_bool() == Some(true) {
                break (
                    State::TimedOut,
                    None,
                    "native capture deadline exceeded".to_owned(),
                );
            }
            if let Some(exit) = exit {
                break (
                    State::Completed,
                    Some(exit),
                    "POSIX end marker observed".to_owned(),
                );
            }
            if p.mode == CaptureMode::Prompt {
                prompt_tail.push_str(chunk);
                if let Some(index) = prompt_tail.rfind('\n') {
                    prompt_tail = prompt_tail[index + 1..].to_owned();
                }
                if prompt_tail.trim_end_matches('\r') == p.wait_for.as_deref().unwrap_or("") {
                    break (
                        State::Completed,
                        None,
                        "literal prompt observed; exit code unverified".to_owned(),
                    );
                }
                if prompt_tail.len() > 65_536 {
                    break (State::Unknown, None, "prompt line exceeds limit".to_owned());
                }
            }
            if p.mode == CaptureMode::Snapshot && started.elapsed() >= settle {
                break (
                    State::Unknown,
                    None,
                    "snapshot captured; command completion unknown, inspect and acknowledge idle"
                        .to_owned(),
                );
            }
            tokio::time::sleep(Duration::from_millis(5)).await;
        };
        if stop.load(Ordering::SeqCst) {
            state = State::Cancelled;
            code = None;
        }
        if p.mode == CaptureMode::Posix && state != State::Completed {
            let partial = parser.drain_partial();
            if let Some(job) = self.inner.lock().await.jobs.get_mut(&id) {
                job.append(&partial, self.config.bridge.max_output_bytes);
            }
        }
        let released = self
            .bridge
            .call(
                "end",
                json!({"capture_id": id, "confirmed_complete": state == State::Completed}),
            )
            .await;
        let release_ok = released.as_ref().is_ok_and(|r| {
            r["unresolved"].as_bool() == Some(false)
                && r["restore_errors"].as_array().is_none_or(Vec::is_empty)
        });
        if !release_ok && state == State::Completed {
            reason.push_str("; adapter cleanup requires inspection");
        }
        if p.mode == CaptureMode::Snapshot {
            if let Ok(screen) = self
                .bridge
                .call("read_screen", json!({"session": p.session}))
                .await
            {
                if let Some(job) = self.inner.lock().await.jobs.get_mut(&id) {
                    job.output.clear();
                    job.output_bytes = 0;
                    job.incomplete = true;
                    job.append(
                        screen["text"].as_str().unwrap_or(""),
                        self.config.bridge.max_output_bytes,
                    );
                }
            }
        }
        self.finish(
            &id,
            state,
            code,
            &reason,
            release_ok && state == State::Completed,
        )
        .await;
    }

    async fn finish(&self, id: &str, state: State, code: Option<i32>, reason: &str, release: bool) {
        let session = {
            let mut registry = self.inner.lock().await;
            let Some(job) = registry.jobs.get_mut(id) else {
                return;
            };
            job.state = state;
            job.requires_idle_ack = !release;
            job.exit_code = code;
            job.reason = reason.into();
            job.finished = Some(Instant::now());
            let session = job.session.clone();
            if release && registry.busy.as_deref() == Some(id) {
                registry.busy = None;
            }
            session
        };
        if let Err(error) = self
            .audit
            .record("terminal_state", id, &session, reason, None)
            .await
        {
            if let Some(job) = self.inner.lock().await.jobs.get_mut(id) {
                job.audit_warning = Some(error.to_string());
            }
        }
    }

    pub async fn status(&self, id: &str) -> Result<Value> {
        self.inner
            .lock()
            .await
            .jobs
            .get(id)
            .map(Job::snapshot)
            .ok_or_else(|| {
                anyhow::anyhow!("unknown/expired command_id; never infer it was not executed")
            })
    }

    pub async fn output(&self, p: OutputParams) -> Result<Value> {
        let max = p.max_bytes.unwrap_or(16_384);
        ensure!((4..=65_536).contains(&max), "invalid max_bytes");
        let offset = p.cursor.unwrap_or(0);
        let registry = self.inner.lock().await;
        let job = registry
            .jobs
            .get(&p.command_id)
            .ok_or_else(|| anyhow::anyhow!("unknown command_id"))?;
        ensure!(
            offset <= job.output.len() && job.output.is_char_boundary(offset),
            "invalid UTF-8 byte cursor"
        );
        let end = offset + prefix_len(&job.output[offset..], max);
        Ok(
            json!({"command_id": job.id, "state": job.state, "text": &job.output[offset..end],
            "cursor": offset, "next_cursor": if end < job.output.len() || job.state.active() { Some(end) } else { None },
            "retained_bytes": job.output.len(), "truncated": job.truncated, "capture_may_be_incomplete": job.incomplete}),
        )
    }

    pub async fn interrupt(&self, id: &str) -> Result<Value> {
        ensure!(
            self.policy.interrupt_allowed(),
            "interrupt disabled by local policy"
        );
        let (session, stop) = {
            let registry = self.inner.lock().await;
            let job = registry
                .jobs
                .get(id)
                .ok_or_else(|| anyhow::anyhow!("unknown command_id"))?;
            ensure!(
                registry.busy.as_deref() == Some(id) && job.state != State::Starting,
                "not an interruptible current command"
            );
            (job.session.clone(), job.stop.clone())
        };
        self.audit
            .record(
                "interrupt_attempt",
                id,
                &session,
                "explicit request; not proof of remote termination",
                None,
            )
            .await?;
        let result = self
            .bridge
            .call("interrupt", json!({"session": session, "capture_id": id}))
            .await?;
        stop.store(true, Ordering::SeqCst);
        self.finish(
            id,
            State::Cancelled,
            None,
            "interrupt sent; inspect and acknowledge idle",
            false,
        )
        .await;
        Ok(result)
    }

    pub async fn acknowledge_idle(&self, p: ContextParams) -> Result<Value> {
        let previous = {
            let registry = self.inner.lock().await;
            if let Some(id) = &registry.busy {
                let job = &registry.jobs[id];
                ensure!(
                    !job.state.active() && job.session == p.session,
                    "cannot acknowledge another or still-active command"
                );
            }
            registry.busy.clone()
        };
        self.audit
            .record(
                "idle_acknowledgement",
                "",
                &p.session,
                "fresh context required; no automatic probing",
                None,
            )
            .await?;
        let result = self
            .bridge
            .call("acknowledge_idle", serde_json::to_value(&p)?)
            .await?;
        let mut registry = self.inner.lock().await;
        if registry.busy == previous {
            registry.busy = None;
        }
        Ok(result)
    }
}

fn prefix_len(text: &str, max: usize) -> usize {
    let mut count = max.min(text.len());
    while !text.is_char_boundary(count) {
        count -= 1;
    }
    count
}

pub fn envelope(command: &str, begin: &str, end: &str) -> String {
    let quoted = command.replace('\'', "'\\''");
    // No subshell: cd/export persist. Explicit POSIX opt-in; exit/exec/set -e may prevent the marker.
    format!("printf '\\n%s\\n' '{begin}'; eval '{quoted}'; printf '\\n{end} %s\\n' \"$?\"")
}

pub struct MarkerParser {
    begin: String,
    end: String,
    started: bool,
    done: bool,
    pending: String,
    pub overflow: bool,
}
impl MarkerParser {
    pub fn new(begin: String, end: String) -> Self {
        Self {
            begin,
            end,
            started: false,
            done: false,
            pending: String::new(),
            overflow: false,
        }
    }
    pub fn drain_partial(&mut self) -> String {
        if !self.started || self.done || self.overflow {
            return String::new();
        }
        std::mem::take(&mut self.pending)
    }
    pub fn feed(&mut self, chunk: &str) -> (String, Option<i32>) {
        if self.done || self.overflow {
            return (String::new(), None);
        }
        self.pending.push_str(chunk);
        let mut output = String::new();
        while let Some(index) = self.pending.find('\n') {
            let line = self.pending[..index].trim_end_matches('\r').to_owned();
            self.pending.drain(..=index);
            if !self.started {
                if line == self.begin {
                    self.started = true;
                }
                continue;
            }
            if let Some(status) = line.strip_prefix(&(self.end.clone() + " ")) {
                if let Ok(code) = status.parse::<i32>() {
                    if (0..=255).contains(&code) {
                        self.done = true;
                        self.pending.clear();
                        return (output, Some(code));
                    }
                }
            }
            output.push_str(&line);
            output.push('\n');
        }
        if self.pending.len() > 65_536 {
            self.overflow = true;
            self.pending.clear();
        }
        (output, None)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn unicode_output_bound_never_splits_a_codepoint() {
        assert_eq!(prefix_len("你好world", 4), 3);
        assert_eq!(prefix_len("你好world", 2), 0);
    }
    #[test]
    fn envelope_has_separate_completion_line_without_subshell() {
        let text = envelope("printf hello", "BEGIN_x", "END_x");
        assert!(text.contains("printf '\\nEND_x %s\\n'"));
        assert!(!text.starts_with('('));
    }
}
