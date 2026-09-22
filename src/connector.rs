//! Backend-neutral connector sessions.
//!
//! The existing `securecrt_*` tools deliberately keep their protocol-2
//! semantics.  This module adds an opt-in OpenSSH backend with long-lived
//! command and PTY sessions so a command does not pay a new SSH handshake.

use anyhow::{Context, Result, anyhow, ensure};
use base64::Engine as _;
use portable_pty::{CommandBuilder, MasterPty, PtySize, native_pty_system};
use rmcp::schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use std::{
    collections::{HashMap, VecDeque},
    io::{Read, Write},
    process::Stdio,
    sync::{
        Arc, Mutex as StdMutex,
        atomic::{AtomicBool, Ordering},
    },
    thread,
    time::Instant,
};
use tokio::{
    io::{AsyncBufReadExt, AsyncReadExt, AsyncWriteExt, BufReader},
    process::{Child, ChildStdin, ChildStdout, Command},
    sync::{Mutex, Notify},
    time::{Duration, timeout},
};
use uuid::Uuid;

const MAX_OUTPUT: usize = 1_048_576;
const MAX_PAGE: usize = 65_536;

#[derive(Debug, Clone, Copy, Deserialize, Serialize, JsonSchema, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ConnectorBackend {
    Securecrt,
    Openssh,
}

#[derive(Debug, Clone, Copy, Deserialize, Serialize, JsonSchema, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ConnectorMode {
    Exec,
    Pty,
}

#[derive(Debug, Clone, Deserialize, Serialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct ConnectorOpenParams {
    pub backend: ConnectorBackend,
    /// OpenSSH Host alias or destination. Never a tab index.
    pub target: String,
    pub config_path: Option<String>,
    pub mode: ConnectorMode,
    pub rows: Option<u16>,
    pub cols: Option<u16>,
}

#[derive(Debug, Clone, Deserialize, Serialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct ConnectorSessionParams {
    pub session_id: String,
}

#[derive(Debug, Clone, Deserialize, Serialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct ConnectorStatusParams {
    pub session_id: Option<String>,
    pub command_id: Option<String>,
}

#[derive(Debug, Clone, Deserialize, Serialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct ConnectorAcknowledgeParams {
    pub session_id: String,
    pub confirmed_idle: bool,
}

#[derive(Debug, Clone, Deserialize, Serialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct ConnectorExecParams {
    pub session_id: String,
    pub command: String,
    pub operation_id: Option<String>,
    pub timeout_ms: Option<u64>,
    pub max_bytes: Option<usize>,
}

#[derive(Debug, Clone, Deserialize, Serialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct ConnectorReadParams {
    pub command_id: String,
    pub cursor: Option<u64>,
    pub max_bytes: Option<usize>,
    pub wait_ms: Option<u64>,
}

#[derive(Debug, Clone, Deserialize, Serialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct ConnectorWriteParams {
    pub session_id: String,
    pub text: String,
    pub append_enter: Option<bool>,
}

#[derive(Debug, Clone, Deserialize, Serialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct ConnectorResizeParams {
    pub session_id: String,
    pub rows: u16,
    pub cols: u16,
}

#[derive(Debug, Clone, Deserialize, Serialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct ConnectorBatchParams {
    pub session_id: String,
    pub commands: Vec<String>,
    pub timeout_ms: Option<u64>,
}

struct RingBuffer {
    bytes: VecDeque<u8>,
    start: u64,
    closed: bool,
    reason: Option<String>,
}

impl RingBuffer {
    fn new() -> Self {
        Self {
            bytes: VecDeque::new(),
            start: 0,
            closed: false,
            reason: None,
        }
    }

    fn append(&mut self, data: &[u8]) {
        self.bytes.extend(data.iter().copied());
        while self.bytes.len() > MAX_OUTPUT {
            self.bytes.pop_front();
            self.start += 1;
        }
    }

    fn close(&mut self, reason: impl Into<String>) {
        self.closed = true;
        self.reason = Some(reason.into());
    }

    fn page(&self, cursor: u64, max: usize) -> Value {
        let requested = cursor;
        let actual = cursor.max(self.start);
        let offset = (actual - self.start) as usize;
        let bytes: Vec<u8> = self.bytes.iter().skip(offset).take(max).copied().collect();
        let next = if offset + bytes.len() < self.bytes.len() || !self.closed {
            Some(actual + bytes.len() as u64)
        } else {
            None
        };
        payload(
            bytes,
            json!({
                "cursor": actual,
                "next_cursor": next,
                "gap": requested < self.start,
                "dropped_bytes": self.start.saturating_sub(requested),
                "retained_bytes": self.bytes.len(),
                "state": if self.closed { "completed" } else { "running" },
                "reason": self.reason,
            }),
        )
    }
}

struct PtyTransport {
    writer: Arc<StdMutex<Box<dyn Write + Send>>>,
    master: Arc<StdMutex<Box<dyn MasterPty + Send>>>,
    child: Arc<StdMutex<Box<dyn portable_pty::Child + Send>>>,
    buffer: Arc<StdMutex<RingBuffer>>,
    notify: Arc<Notify>,
}

struct ExecTransport {
    stdin: Mutex<ChildStdin>,
    stdout: Mutex<BufReader<ChildStdout>>,
    child: Mutex<Child>,
    command_lock: Mutex<()>,
    unresolved: AtomicBool,
}

enum SessionTransport {
    Exec(Arc<ExecTransport>),
    Pty(Arc<PtyTransport>),
}

struct Session {
    id: String,
    target: String,
    mode: ConnectorMode,
    created: Instant,
    transport: SessionTransport,
}

struct CommandRecord {
    session_id: String,
    operation_id: String,
    state: String,
    sent: Option<bool>,
    output: Vec<u8>,
    output_start: u64,
    exit_code: Option<i32>,
    truncated: bool,
    reason: String,
    created: Instant,
    finished: Option<Instant>,
    queue_wait_us: u64,
    first_byte_us: Option<u64>,
    native_read_count: u64,
    output_bytes: usize,
}

struct ExecOutcome {
    state: &'static str,
    sent: Option<bool>,
    output: Vec<u8>,
    exit_code: Option<i32>,
    truncated: bool,
    reason: String,
    queue_wait_us: u64,
    first_byte_us: Option<u64>,
    native_read_count: u64,
}

#[derive(Clone, Default)]
pub struct ConnectorManager {
    sessions: Arc<Mutex<HashMap<String, Arc<Session>>>>,
    commands: Arc<Mutex<HashMap<String, CommandRecord>>>,
    operations: Arc<Mutex<HashMap<String, (String, String)>>>,
}

impl ConnectorManager {
    pub fn new() -> Self {
        Self::default()
    }

    pub async fn list(&self) -> Result<Value> {
        let sessions = self.sessions.lock().await;
        let mut result = Vec::with_capacity(sessions.len());
        for session in sessions.values() {
            result.push(json!({
                "session_id": session.id,
                "backend": "openssh",
                "target": session.target,
                "mode": session.mode,
                "age_ms": session.created.elapsed().as_millis(),
            }));
        }
        Ok(json!({"sessions": result, "backend": "openssh"}))
    }

    pub async fn open(&self, p: ConnectorOpenParams) -> Result<Value> {
        ensure!(
            p.backend == ConnectorBackend::Openssh,
            "this manager only opens backend=openssh"
        );
        validate_target(&p.target)?;
        if let Some(path) = &p.config_path {
            ensure!(
                !path.is_empty() && path.len() <= 4096,
                "invalid config_path"
            );
        }
        let id = format!("openssh/{}", Uuid::new_v4());
        let transport = match p.mode {
            ConnectorMode::Exec => {
                SessionTransport::Exec(Arc::new(spawn_exec(&p.target, p.config_path.as_deref())?))
            }
            ConnectorMode::Pty => SessionTransport::Pty(Arc::new(spawn_pty(
                &p.target,
                p.config_path.as_deref(),
                p.rows.unwrap_or(40),
                p.cols.unwrap_or(160),
            )?)),
        };
        let session = Arc::new(Session {
            id: id.clone(),
            target: p.target,
            mode: p.mode,
            created: Instant::now(),
            transport,
        });
        self.sessions
            .lock()
            .await
            .insert(id.clone(), session.clone());
        Ok(json!({
            "session_id": id,
            "backend": "openssh",
            "target": session.target,
            "mode": session.mode,
            "rows": p.rows.unwrap_or(40),
            "cols": p.cols.unwrap_or(160),
            "persistent": true,
            "remote_termination_confirmed": false,
        }))
    }

    pub async fn exec(&self, p: ConnectorExecParams) -> Result<Value> {
        validate_command(&p.command)?;
        let max = p.max_bytes.unwrap_or(16_384);
        ensure!((4..=MAX_PAGE).contains(&max), "invalid max_bytes");
        let timeout_ms = p.timeout_ms.unwrap_or(30_000);
        ensure!((100..=600_000).contains(&timeout_ms), "invalid timeout_ms");
        let session = self.session(&p.session_id).await?;
        let SessionTransport::Exec(transport) = &session.transport else {
            return Err(anyhow!(
                "connector session is PTY mode; use connector_stream_*"
            ));
        };
        ensure!(
            !transport.unresolved.load(Ordering::SeqCst),
            "session unresolved; inspect or close and reopen before sending"
        );
        let operation_id = p.operation_id.unwrap_or_else(|| Uuid::new_v4().to_string());
        let fingerprint = format!("{}:{}:{}", p.session_id, p.command, timeout_ms);
        let command_id = Uuid::new_v4().to_string();
        let existing_command = {
            let mut operations = self.operations.lock().await;
            if let Some((old, old_fingerprint)) = operations.get(&operation_id) {
                ensure!(
                    old_fingerprint == &fingerprint,
                    "operation_id conflict; nothing sent"
                );
                Some(old.clone())
            } else {
                operations.insert(operation_id.clone(), (command_id.clone(), fingerprint));
                None
            }
        };
        if let Some(existing_command) = existing_command {
            return self.command_status(&existing_command).await;
        }
        let created = Instant::now();
        let outcome = run_exec(transport, &p.command, timeout_ms).await;
        if outcome.state == "unknown" {
            transport.unresolved.store(true, Ordering::SeqCst);
        };
        let output_bytes = outcome.output.len();
        let record = CommandRecord {
            session_id: p.session_id,
            operation_id,
            state: outcome.state.into(),
            sent: outcome.sent,
            output: outcome.output,
            output_start: 0,
            exit_code: outcome.exit_code,
            truncated: outcome.truncated,
            reason: outcome.reason,
            created,
            finished: Some(Instant::now()),
            queue_wait_us: outcome.queue_wait_us,
            first_byte_us: outcome.first_byte_us,
            native_read_count: outcome.native_read_count,
            output_bytes,
        };
        self.commands
            .lock()
            .await
            .insert(command_id.clone(), record);
        let mut value = self.command_status(&command_id).await?;
        value["output"] = self.read_once(&command_id, 0, max).await?;
        Ok(value)
    }

    pub async fn batch(&self, p: ConnectorBatchParams) -> Result<Value> {
        ensure!(
            !p.commands.is_empty() && p.commands.len() <= 20,
            "batch needs 1..20 commands"
        );
        let mut results = Vec::with_capacity(p.commands.len());
        let mut state = "completed";
        for (index, command) in p.commands.into_iter().enumerate() {
            let result = self
                .exec(ConnectorExecParams {
                    session_id: p.session_id.clone(),
                    command,
                    operation_id: None,
                    timeout_ms: p.timeout_ms,
                    max_bytes: Some(1024),
                })
                .await?;
            let failed = result["state"] != "completed" || result["exit_code"] != 0;
            results.push(json!({"index": index, "result": result}));
            if failed {
                state = "stopped";
                break;
            }
        }
        Ok(json!({"state": state, "results": results, "automatic_retry": false}))
    }

    pub async fn read(&self, p: ConnectorReadParams) -> Result<Value> {
        let max = p.max_bytes.unwrap_or(16_384);
        ensure!((4..=MAX_PAGE).contains(&max), "invalid max_bytes");
        if let Some(wait_ms) = p.wait_ms {
            ensure!(wait_ms <= 60_000, "invalid wait_ms");
        }
        let result = self
            .read_once(&p.command_id, p.cursor.unwrap_or(0), max)
            .await?;
        Ok(result)
    }

    pub async fn status(&self, p: ConnectorSessionParams) -> Result<Value> {
        let session = self.session(&p.session_id).await?;
        Ok(
            json!({"session_id": session.id, "backend": "openssh", "target": session.target, "mode": session.mode}),
        )
    }

    pub async fn command_status(&self, id: &str) -> Result<Value> {
        let commands = self.commands.lock().await;
        let record = commands.get(id).context("unknown connector command_id")?;
        Ok(command_value(id, record))
    }

    pub async fn status_any(&self, p: ConnectorStatusParams) -> Result<Value> {
        match (p.session_id, p.command_id) {
            (Some(session_id), None) => self.status(ConnectorSessionParams { session_id }).await,
            (None, Some(command_id)) => self.command_status(&command_id).await,
            _ => Err(anyhow!("provide exactly one of session_id or command_id")),
        }
    }

    pub async fn stream_read(&self, p: ConnectorReadParams) -> Result<Value> {
        let max = p.max_bytes.unwrap_or(16_384);
        ensure!((4..=MAX_PAGE).contains(&max), "invalid max_bytes");
        let session_id = p
            .command_id
            .strip_prefix("stream:")
            .unwrap_or(&p.command_id);
        let session = self.session(session_id).await?;
        let SessionTransport::Pty(transport) = &session.transport else {
            return Err(anyhow!("not a PTY session"));
        };
        let cursor = p.cursor.unwrap_or(0);
        let wait_ms = p.wait_ms.unwrap_or(1000);
        ensure!(wait_ms <= 60_000, "invalid wait_ms");
        let until = tokio::time::Instant::now() + Duration::from_millis(wait_ms);
        loop {
            let notify = transport.notify.clone();
            let value = {
                let buffer = transport
                    .buffer
                    .lock()
                    .map_err(|_| anyhow!("PTY buffer poisoned"))?;
                buffer.page(cursor, max)
            };
            if value["text"].as_str().is_some_and(|s| !s.is_empty())
                || !value["base64"].is_null()
                || value["state"] == "completed"
                || tokio::time::Instant::now() >= until
            {
                return Ok(value);
            }
            let _ = timeout(
                until.saturating_duration_since(tokio::time::Instant::now()),
                notify.notified(),
            )
            .await;
        }
    }

    pub async fn write(&self, p: ConnectorWriteParams) -> Result<Value> {
        validate_text(&p.text)?;
        let session = self.session(&p.session_id).await?;
        let SessionTransport::Pty(transport) = &session.transport else {
            return Err(anyhow!("connector_write requires a PTY session"));
        };
        let text = if p.append_enter.unwrap_or(false) {
            format!("{}\r", p.text)
        } else {
            p.text
        };
        let writer = transport.writer.clone();
        tokio::task::spawn_blocking(move || {
            let mut writer = writer.lock().map_err(|_| anyhow!("PTY writer poisoned"))?;
            writer.write_all(text.as_bytes())?;
            writer.flush()?;
            Ok::<_, anyhow::Error>(())
        })
        .await??;
        Ok(json!({"sent": true, "remote_termination_confirmed": false}))
    }

    pub async fn resize(&self, p: ConnectorResizeParams) -> Result<Value> {
        ensure!(p.rows > 0 && p.cols > 0, "invalid PTY size");
        let session = self.session(&p.session_id).await?;
        let SessionTransport::Pty(transport) = &session.transport else {
            return Err(anyhow!("connector_resize requires a PTY session"));
        };
        let master = transport.master.clone();
        tokio::task::spawn_blocking(move || {
            master
                .lock()
                .map_err(|_| anyhow!("PTY master poisoned"))?
                .resize(PtySize {
                    rows: p.rows,
                    cols: p.cols,
                    pixel_width: 0,
                    pixel_height: 0,
                })?;
            Ok::<_, anyhow::Error>(())
        })
        .await??;
        Ok(json!({"resized": true, "rows": p.rows, "cols": p.cols}))
    }

    pub async fn interrupt(&self, p: ConnectorSessionParams) -> Result<Value> {
        let session = self.session(&p.session_id).await?;
        match &session.transport {
            SessionTransport::Pty(transport) => {
                let writer = transport.writer.clone();
                tokio::task::spawn_blocking(move || {
                    writer
                        .lock()
                        .map_err(|_| anyhow!("PTY writer poisoned"))?
                        .write_all(&[3])?;
                    Ok::<_, anyhow::Error>(())
                })
                .await??;
            }
            SessionTransport::Exec(transport) => {
                ensure!(
                    transport.unresolved.load(Ordering::SeqCst),
                    "exec interrupt requires an unresolved command"
                );
                let mut stdin = transport.stdin.lock().await;
                stdin.write_all(&[3]).await?;
                stdin.flush().await?;
            }
        }
        Ok(json!({"interrupt_sent": true, "remote_termination_confirmed": false}))
    }

    pub async fn acknowledge(&self, p: ConnectorAcknowledgeParams) -> Result<Value> {
        ensure!(
            p.confirmed_idle,
            "confirmed_idle must be true after inspecting the original session"
        );
        let session = self.session(&p.session_id).await?;
        let SessionTransport::Exec(transport) = &session.transport else {
            return Ok(json!({"idle_acknowledged": true, "session_id": p.session_id}));
        };
        transport.unresolved.store(false, Ordering::SeqCst);
        Ok(
            json!({"idle_acknowledged": true, "session_id": p.session_id, "remote_termination_confirmed": false}),
        )
    }

    pub async fn close(&self, p: ConnectorSessionParams) -> Result<Value> {
        let session = self
            .sessions
            .lock()
            .await
            .remove(&p.session_id)
            .context("unknown connector session")?;
        match &session.transport {
            SessionTransport::Exec(transport) => {
                let _ = transport.child.lock().await.kill().await;
            }
            SessionTransport::Pty(transport) => {
                let _ = transport
                    .child
                    .lock()
                    .map_err(|_| anyhow!("PTY child poisoned"))?
                    .kill();
            }
        }
        Ok(
            json!({"closed": true, "session_id": p.session_id, "remote_termination_confirmed": false}),
        )
    }

    pub async fn metrics(&self) -> Result<Value> {
        let sessions = self.sessions.lock().await;
        let commands = self.commands.lock().await;
        let completed = commands
            .values()
            .filter(|command| command.state == "completed")
            .count();
        let unknown = commands
            .values()
            .filter(|command| command.state == "unknown")
            .count();
        let retained_output_bytes: usize =
            commands.values().map(|command| command.output_bytes).sum();
        let native_read_count: u64 = commands
            .values()
            .map(|command| command.native_read_count)
            .sum();
        Ok(json!({
            "backend":"openssh",
            "sessions":sessions.len(),
            "commands":commands.len(),
            "completed":completed,
            "unknown":unknown,
            "retained_output_bytes":retained_output_bytes,
            "native_read_count":native_read_count,
            "persistent":true
        }))
    }

    async fn session(&self, id: &str) -> Result<Arc<Session>> {
        self.sessions
            .lock()
            .await
            .get(id)
            .cloned()
            .context("unknown connector session")
    }

    async fn read_once(&self, id: &str, cursor: u64, max: usize) -> Result<Value> {
        let commands = self.commands.lock().await;
        let record = commands.get(id).context("unknown connector command_id")?;
        let actual = cursor.max(record.output_start);
        let offset = (actual - record.output_start) as usize;
        let end = (offset + max).min(record.output.len());
        let bytes = record.output.get(offset..end).unwrap_or_default().to_vec();
        let next = if end < record.output.len() {
            Some(record.output_start + end as u64)
        } else {
            None
        };
        Ok(payload(
            bytes,
            json!({"command_id":id,"cursor":actual,"next_cursor":next,"gap":cursor < record.output_start,"dropped_bytes":record.output_start.saturating_sub(cursor),"retained_bytes":record.output.len(),"state":record.state,"exit_code":record.exit_code,"truncated":record.truncated,"sent":record.sent,"reason":record.reason,"automatic_retry":false}),
        ))
    }
}

fn validate_target(target: &str) -> Result<()> {
    ensure!(
        !target.is_empty() && target.len() <= 512 && !target.chars().any(char::is_control),
        "invalid OpenSSH target"
    );
    Ok(())
}
fn validate_command(command: &str) -> Result<()> {
    ensure!(
        !command.is_empty() && command.len() <= 32_768 && !command.chars().any(char::is_control),
        "invalid command"
    );
    Ok(())
}
fn validate_text(text: &str) -> Result<()> {
    ensure!(
        !text.is_empty() && text.len() <= 8192 && !text.chars().any(|c| c == '\0'),
        "invalid connector input"
    );
    Ok(())
}

fn spawn_exec(target: &str, config_path: Option<&str>) -> Result<ExecTransport> {
    let mut command = Command::new("ssh");
    if let Some(path) = config_path {
        command.arg("-F").arg(path);
    }
    let mut child = command
        .arg("-T")
        .arg(target)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .context("failed to start OpenSSH")?;
    let stdin = child.stdin.take().context("OpenSSH stdin unavailable")?;
    let stdout = child.stdout.take().context("OpenSSH stdout unavailable")?;
    if let Some(mut stderr) = child.stderr.take() {
        tokio::spawn(async move {
            let mut sink = [0u8; 16 * 1024];
            while stderr
                .read(&mut sink)
                .await
                .ok()
                .is_some_and(|size| size > 0)
            {}
        });
    }
    Ok(ExecTransport {
        stdin: Mutex::new(stdin),
        stdout: Mutex::new(BufReader::new(stdout)),
        child: Mutex::new(child),
        command_lock: Mutex::new(()),
        unresolved: AtomicBool::new(false),
    })
}

fn spawn_pty(
    target: &str,
    config_path: Option<&str>,
    rows: u16,
    cols: u16,
) -> Result<PtyTransport> {
    let system = native_pty_system();
    let pair = system.openpty(PtySize {
        rows,
        cols,
        pixel_width: 0,
        pixel_height: 0,
    })?;
    let mut command = CommandBuilder::new("ssh");
    if let Some(path) = config_path {
        command.arg("-F");
        command.arg(path);
    }
    command.arg("-tt");
    command.arg(target);
    let child = pair.slave.spawn_command(command)?;
    drop(pair.slave);
    let reader = pair.master.try_clone_reader()?;
    let writer = pair.master.take_writer()?;
    let buffer = Arc::new(StdMutex::new(RingBuffer::new()));
    let notify = Arc::new(Notify::new());
    let thread_buffer = buffer.clone();
    let thread_notify = notify.clone();
    thread::spawn(move || pty_reader(reader, thread_buffer, thread_notify));
    Ok(PtyTransport {
        writer: Arc::new(StdMutex::new(writer)),
        master: Arc::new(StdMutex::new(pair.master)),
        child: Arc::new(StdMutex::new(child)),
        buffer,
        notify,
    })
}

fn pty_reader(
    mut reader: Box<dyn Read + Send>,
    buffer: Arc<StdMutex<RingBuffer>>,
    notify: Arc<Notify>,
) {
    let mut chunk = [0u8; 16 * 1024];
    loop {
        match reader.read(&mut chunk) {
            Ok(0) => {
                if let Ok(mut value) = buffer.lock() {
                    value.close("PTY closed");
                }
                notify.notify_waiters();
                break;
            }
            Ok(size) => {
                if let Ok(mut value) = buffer.lock() {
                    value.append(&chunk[..size]);
                }
                notify.notify_waiters();
            }
            Err(error) => {
                if let Ok(mut value) = buffer.lock() {
                    value.close(format!("PTY read failed: {error}"));
                }
                notify.notify_waiters();
                break;
            }
        }
    }
}

async fn run_exec(transport: &Arc<ExecTransport>, command: &str, timeout_ms: u64) -> ExecOutcome {
    let requested_at = Instant::now();
    let _guard = transport.command_lock.lock().await;
    let started_at = Instant::now();
    let queue_wait_us = started_at.duration_since(requested_at).as_micros() as u64;
    let marker = Uuid::new_v4().simple().to_string();
    let begin = format!("MCP_BEGIN_{marker}");
    let end = format!("MCP_END_{marker}");
    let quoted = command.replace('\'', "'\\''");
    let envelope =
        format!("printf '\\n%s\\n' '{begin}'; eval '{quoted}'; printf '\\n{end} %s\\n' \"$?\"\n");
    let mut stdin = transport.stdin.lock().await;
    if let Err(error) = stdin.write_all(envelope.as_bytes()).await {
        return ExecOutcome {
            state: "unknown",
            sent: None,
            output: Vec::new(),
            exit_code: None,
            truncated: false,
            reason: format!("OpenSSH write outcome unknown; do not replay: {error}"),
            queue_wait_us,
            first_byte_us: None,
            native_read_count: 0,
        };
    }
    if let Err(error) = stdin.flush().await {
        return ExecOutcome {
            state: "unknown",
            sent: Some(true),
            output: Vec::new(),
            exit_code: None,
            truncated: false,
            reason: format!("OpenSSH flush outcome unknown; do not replay: {error}"),
            queue_wait_us,
            first_byte_us: None,
            native_read_count: 0,
        };
    }
    drop(stdin);
    let mut stdout = transport.stdout.lock().await;
    let mut output = Vec::new();
    let mut started = false;
    let mut truncated = false;
    let mut first_byte_us = None;
    let mut native_read_count = 0;
    let deadline = timeout(Duration::from_millis(timeout_ms), async {
        loop {
            let mut line = Vec::new();
            let size = stdout.read_until(b'\n', &mut line).await?;
            native_read_count += 1;
            if size == 0 {
                return Err::<(Vec<u8>, i32, bool), anyhow::Error>(anyhow!(
                    "OpenSSH process exited before marker"
                ));
            }
            if first_byte_us.is_none() {
                first_byte_us = Some(started_at.elapsed().as_micros() as u64);
            }
            let text = String::from_utf8_lossy(&line);
            let trimmed = text.trim_end_matches(['\r', '\n']);
            if trimmed == begin {
                started = true;
                continue;
            }
            if let Some(code) = trimmed
                .strip_prefix(&(end.clone() + " "))
                .and_then(|s| s.parse::<i32>().ok())
            {
                return Ok((output.clone(), code, truncated));
            }
            if started {
                if output.len() < MAX_OUTPUT {
                    let remaining = MAX_OUTPUT - output.len();
                    let take = remaining.min(line.len());
                    output.extend_from_slice(&line[..take]);
                    truncated |= take != line.len();
                } else {
                    truncated = true;
                }
            }
        }
    })
    .await;
    match deadline {
        Ok(Ok((output, exit_code, truncated))) => ExecOutcome {
            state: "completed",
            sent: Some(true),
            output,
            exit_code: Some(exit_code),
            truncated,
            reason: "POSIX marker observed".into(),
            queue_wait_us,
            first_byte_us,
            native_read_count,
        },
        Ok(Err(error)) => ExecOutcome {
            state: "unknown",
            sent: Some(true),
            output,
            exit_code: None,
            truncated,
            reason: format!("command outcome unknown; do not replay: {error}"),
            queue_wait_us,
            first_byte_us,
            native_read_count,
        },
        Err(_) => ExecOutcome {
            state: "unknown",
            sent: Some(true),
            output,
            exit_code: None,
            truncated,
            reason: format!("command timeout after {timeout_ms}ms; remote work may continue"),
            queue_wait_us,
            first_byte_us,
            native_read_count,
        },
    }
}

fn payload(bytes: Vec<u8>, mut extra: Value) -> Value {
    let text = String::from_utf8(bytes.clone());
    match text {
        Ok(text) => extra["text"] = json!(text),
        Err(_) => {
            extra["text"] = json!(String::from_utf8_lossy(&bytes));
            extra["base64"] = json!(base64::engine::general_purpose::STANDARD.encode(bytes));
        }
    }
    extra
}

fn command_value(id: &str, record: &CommandRecord) -> Value {
    let elapsed_us = record
        .finished
        .unwrap_or_else(Instant::now)
        .duration_since(record.created)
        .as_micros() as u64;
    let throughput_bps = if elapsed_us > 0 {
        (record.output_bytes as u128 * 1_000_000 / elapsed_us as u128) as u64
    } else {
        0
    };
    json!({
        "command_id":id,
        "session_id":record.session_id,
        "operation_id":record.operation_id,
        "state":record.state,
        "sent":record.sent,
        "exit_code":record.exit_code,
        "truncated":record.truncated,
        "retained_bytes":record.output.len(),
        "reason":record.reason,
        "automatic_retry":false,
        "remote_termination_confirmed":false,
        "timing": {
            "elapsed_us": elapsed_us,
            "queue_wait_us": record.queue_wait_us,
            "first_byte_us": record.first_byte_us,
            "completion_us": elapsed_us,
            "native_read_count": record.native_read_count,
            "output_bytes": record.output_bytes,
            "throughput_bps": throughput_bps
        }
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ring_buffer_reports_absolute_cursor_gaps() {
        let mut ring = RingBuffer::new();
        ring.append(&vec![b'x'; MAX_OUTPUT + 4]);
        let page = ring.page(0, 4);
        assert_eq!(page["cursor"], json!(4));
        assert_eq!(page["gap"], json!(true));
        assert_eq!(page["dropped_bytes"], json!(4));
        assert_eq!(page["next_cursor"], json!(8));
    }

    #[test]
    fn binary_payload_keeps_text_preview_and_base64() {
        let value = payload(vec![0xff, 0x00, 0x61], json!({}));
        assert!(value["base64"].as_str().is_some());
        assert_eq!(value["text"], json!("�\0a"));
    }

    #[test]
    fn target_and_command_validation_reject_control_input() {
        assert!(validate_target("host\nname").is_err());
        assert!(validate_command("printf hi\nrm -rf /").is_err());
        assert!(validate_text("\u{1b}[31m").is_ok());
        assert!(validate_text("secret\0").is_err());
    }
}
