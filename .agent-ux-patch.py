"""One-use feature-branch source transformation; removed before final PR."""
from pathlib import Path


def edit(path, old, new, count=1):
    p = Path(path)
    text = p.read_text(encoding='utf-8')
    assert text.count(old) == count, (path, text.count(old), old[:120])
    p.write_text(text.replace(old, new), encoding='utf-8')


edit('src/main.rs', 'mod execution;', 'mod execution;\nmod fault;\nmod local_cli;')
edit('src/execution.rs', 'use anyhow::{Result, ensure};', 'use anyhow::{Result, ensure};\nmod convenience;')
edit('src/execution.rs', '    id: String,\n    session: String,', '    id: String,\n    operation_id: String,\n    sent: Option<bool>,\n    requires_idle_ack: bool,\n    session: String,')
edit('src/execution.rs', '"command_id": self.id, "session": self.session, "state": self.state,', '''"command_id": self.id, "operation_id": self.operation_id, "session": self.session, "state": self.state,
            "sent": self.sent, "requires_idle_ack": self.requires_idle_ack,
            "error_code": if matches!(self.state, State::Rejected | State::Unknown | State::TimedOut) { Some(crate::fault::code(&self.reason)) } else { None },
            "action": if self.state.active() { "Poll this command_id or explicitly interrupt; never resubmit." }
                else if self.requires_idle_ack { crate::fault::action("busy_unresolved") }
                else if self.state == State::Rejected { crate::fault::action(crate::fault::code(&self.reason)) }
                else { "Read further output pages if next_cursor is present." },
            "automatic_retry": false,''')
edit('src/execution.rs', '    inner: Arc<Mutex<Registry>>,', '    inner: Arc<Mutex<Registry>>,\n    run_gate: Arc<Mutex<()>>,')
edit('src/execution.rs', '            inner: Arc::new(Mutex::new(Registry::default())),', '            inner: Arc::new(Mutex::new(Registry::default())),\n            run_gate: Arc::new(Mutex::new(())),')
edit('src/execution.rs', '    pub async fn submit(&self, p: ExecuteParams) -> Result<Value> {', '''    pub async fn submit(&self, p: ExecuteParams) -> Result<Value> {
        self.submit_internal(p, None).await
    }

    async fn submit_internal(&self, p: ExecuteParams, stable_fingerprint: Option<String>) -> Result<Value> {''')
edit('src/execution.rs', '        let fingerprint = format!("{:x}", Sha256::digest(serde_json::to_vec(&p)?));', '        let fingerprint = stable_fingerprint.unwrap_or(format!("{:x}", Sha256::digest(serde_json::to_vec(&p)?)));')
edit('src/execution.rs', '''            ensure!(
                registry.jobs.len() < self.config.bridge.max_jobs,
                "job cache full; wait for retention expiry"
            );''', '''            if registry.jobs.len() >= self.config.bridge.max_jobs {
                // Output eviction never removes the operation ledger: old IDs cannot replay.
                let oldest = registry.jobs.iter().filter_map(|(id, job)| {
                    job.finished.map(|finished| (id.clone(), finished))
                }).min_by_key(|(_, finished)| *finished).map(|(id, _)| id);
                if let Some(id) = oldest { registry.jobs.remove(&id); }
            }
            ensure!(registry.jobs.len() < self.config.bridge.max_jobs, "job cache full; active work is never evicted");''')
edit('src/execution.rs', '                    id: id.clone(),\n                    session: p.session.clone(),', '''                    id: id.clone(),
                    operation_id: p.operation_id.clone(),
                    sent: Some(false),
                    requires_idle_ack: false,
                    session: p.session.clone(),''')
edit('src/execution.rs', '''        if let Err(error) = self.bridge.call("begin", request).await {
            // The transport cannot prove whether a remote send occurred; preserve an inspectable job.
            self.finish(
                &id,
                State::Unknown,
                None,
                &format!("dispatch outcome unknown: {error}; do not replay"),
                false,
            )
            .await;
            return self.status(&id).await;
        }
        if let Some(job) = self.inner.lock().await.jobs.get_mut(&id) {
            job.state = State::Running;''', '''        if let Some(job) = self.inner.lock().await.jobs.get_mut(&id) { job.sent = None; }
        if let Err(error) = self.bridge.call("begin", request).await {
            let unsent = error.downcast_ref::<crate::fault::BridgeFault>()
                .is_some_and(|e| e.sent == Some(false));
            if let Some(job) = self.inner.lock().await.jobs.get_mut(&id) {
                job.sent = if unsent { Some(false) } else { None };
            }
            self.finish(&id, if unsent { State::Rejected } else { State::Unknown }, None,
                &format!("{}: {error}", if unsent { "not sent" } else { "dispatch outcome unknown; do not replay" }), unsent).await;
            return self.status(&id).await;
        }
        if let Some(job) = self.inner.lock().await.jobs.get_mut(&id) {
            job.sent = Some(true);
            job.state = State::Running;''')
edit('src/execution.rs', '            job.state = state;\n            job.exit_code = code;', '            job.state = state;\n            job.requires_idle_ack = !release;\n            job.exit_code = code;')
edit('src/execution.rs', '''        let released = self
            .bridge''', '''        if p.mode == CaptureMode::Posix && state != State::Completed {
            let partial = parser.drain_partial();
            if let Some(job) = self.inner.lock().await.jobs.get_mut(&id) {
                job.append(&partial, self.config.bridge.max_output_bytes);
            }
        }
        let released = self
            .bridge''')
edit('src/execution.rs', '''    pub fn feed(&mut self, chunk: &str) -> (String, Option<i32>) {''', '''    pub fn drain_partial(&mut self) -> String {
        if !self.started || self.done || self.overflow { return String::new(); }
        std::mem::take(&mut self.pending)
    }
    pub fn feed(&mut self, chunk: &str) -> (String, Option<i32>) {''')

edit('src/bridge.rs', '''            ensure!(response["ok"].as_bool() == Some(true), "bridge rejected request: {}", response["error"]);
            Ok::<Value, anyhow::Error>(response["result"].clone())''', '''            if response["ok"].as_bool() != Some(true) {
                return Err(crate::fault::BridgeFault {
                    message: format!("bridge rejected request: {}", response["error"]),
                    sent: response["sent"].as_bool(),
                }.into());
            }
            Ok::<Value, anyhow::Error>(response["result"].clone())''')
edit('src/bridge.rs', '''        result.context(
            "bridge timeout: outcome may be unknown; NEVER automatically replay a command",
        )?''', '''        let outcome = result.context("bridge timeout: outcome may be unknown; NEVER automatically replay a command")
            .and_then(|value| value);
        outcome.map_err(|error| {
            if error.downcast_ref::<crate::fault::BridgeFault>().is_some() { error }
            else { crate::fault::BridgeFault { message: format!("{error:#}"), sent: None }.into() }
        })''')

edit('bridge/securecrt_bridge.py', '        self.request_deadline = None', '        self.request_deadline = None\n        self.send_attempted = False')
edit('bridge/securecrt_bridge.py', '        return entry\n\n    def list_sessions', "        entry['expires'] = self.now() + LEASE_MS\n        return entry\n\n    def list_sessions")
edit('bridge/securecrt_bridge.py', "            screen.Send(text + '\\r')", "            self.send_attempted = True\n            screen.Send(text + '\\r')")
edit('bridge/securecrt_bridge.py', "            entry['tab'].Screen.Send('\\x03')", "            self.send_attempted = True\n            entry['tab'].Screen.Send('\\x03')")
edit('bridge/securecrt_bridge.py', "        entry['tab'].Screen.Send(text + ('\\r' if append_enter else ''))", "        self.send_attempted = True\n        entry['tab'].Screen.Send(text + ('\\r' if append_enter else ''))")
edit('bridge/securecrt_bridge.py', '        return dict(idle_acknowledged=True, remote_termination_confirmed=False)', '''        result = dict(idle_acknowledged=True, remote_termination_confirmed=False)
        try:
            result['screen'] = self.read_screen(session)
        except Exception as exc:
            result['screen_error'] = str(exc)
            result['action'] = 'read_screen before the next operation'
        return result''')
edit('bridge/securecrt_bridge.py', "        self.capture = None\n        if not confirmed_complete:", "        self.capture = None\n        c['entry']['expires'] = self.now() + LEASE_MS\n        if not confirmed_complete:")
edit('bridge/securecrt_bridge.py', "capabilities=['session_leases', 'screen_tokens', 'bounded_poll', 'interrupt'],", "capabilities=['session_leases', 'screen_tokens', 'bounded_poll', 'interrupt', 'delivery_evidence', 'ack_fresh_view'],")
edit('bridge/securecrt_bridge.py', '''def handle_request(adapter, request, token):
    response =''', '''def handle_request(adapter, request, token):
    adapter.send_attempted = False
    response =''')
edit('bridge/securecrt_bridge.py', "        response['error'] = str(exc)[:1024]\n    return response", "        response['error'] = str(exc)[:1024]\n        response['error_code'] = str(exc).split(':', 1)[0][:64]\n    response['sent'] = (True if response['ok'] else None) if adapter.send_attempted else False\n    return response")

edit('src/config.rs', '            mode: "unrestricted".into(),', '            mode: "client".into(),')
edit('src/policy.rs', '["observe", "safe", "allowlist", "unrestricted"]', '["client", "observe", "safe", "allowlist", "unrestricted"]')
edit('src/policy.rs', '''        let mut deny = HARD_DENY
            .iter()
            .map(|p| Regex::new(p))
            .collect::<Result<Vec<_>, _>>()?;
        deny.extend(compile(&config.custom_deny_patterns, false)?);''', '''        let deny = compile(&config.custom_deny_patterns, false)?;''')
edit('src/policy.rs', '''        if self.deny.iter().any(|p| p.is_match(cmd)) {
            return denied("command matched a local deny rule");
        }
        let allowed = self.mode == "unrestricted"''', '''        if let Some(index) = self.deny.iter().position(|p| p.is_match(cmd)) {
            return denied(&format!("custom_deny_rule[{index}]: operator-configured pattern matched"));
        }
        if self.mode != "client" {
            for (index, pattern) in HARD_DENY.iter().enumerate() {
                if Regex::new(pattern).expect("static guardrail regex").is_match(cmd) {
                    return denied(&format!("builtin_guardrail[{index}]: legacy optional local policy"));
                }
            }
        }
        let allowed = self.mode == "client" || self.mode == "unrestricted"''')
edit('src/server.rs', '.map_err(|e| McpError::invalid_params(e.to_string(), None))', '.map_err(|e| McpError::invalid_params(e.to_string(), Some(crate::fault::details(&e))))')
edit('src/server.rs', 'impl SecureCrtServer {\n    #[tool(', '''impl SecureCrtServer {
    #[tool(
        description = "Preferred command tool: reuse an explicit session, obtain a fresh screen internally, submit ONCE, wait and return bounded output plus sent/state/exit_code/next_cursor. Client owns command approval. mode is REQUIRED: posix is an explicit idle POSIX-shell assertion, not for REPLs/passwords/appliances; prompt/snapshot require expected_prompt. Omitted expected_prompt in posix uses a conservative prompt heuristic, NOT host authentication. No automatic retry, Ctrl+C or unresolved acknowledgement. Use operation_id for same-process deduplication. A running result means poll command_id, never resubmit.",
        annotations(read_only_hint = false, destructive_hint = true, idempotent_hint = false)
    )]
    async fn securecrt_run_command(&self, Parameters(p): Parameters<crate::model::RunParams>) -> Result<String, McpError> {
        result(self.engine.run_command(p).await)
    }

    #[tool(''')

with Path('src/model.rs').open('a', encoding='utf-8') as f:
    f.write('''

/// Agent-oriented command submission. Response budgets do not change operation identity.
#[derive(Debug, Clone, Deserialize, Serialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct RunParams {
    pub session: String,
    pub command: String,
    /// Explicit capture type. posix asserts an idle POSIX shell; never infer it for appliances/REPLs.
    pub mode: CaptureMode,
    /// Optional stable ID for same-process deduplication. Omitted IDs are generated and returned.
    pub operation_id: Option<String>,
    /// Optional for ordinary POSIX-style prompts, required for prompt/snapshot and unusual input contexts.
    pub expected_prompt: Option<String>,
    pub wait_for: Option<String>,
    /// Remote capture budget. Default min(30000, configured maximum).
    pub timeout_ms: Option<u64>,
    /// Wait for this response, 0..60000 ms. A shorter wait returns running, without cancelling.
    pub wait_ms: Option<u64>,
    /// First output page bound in UTF-8 bytes, 4..65536. Default 16384.
    pub max_bytes: Option<usize>,
    pub settle_ms: Option<u64>,
}
''')
edit('src/main.rs', '    CodexConfig,', '''    CodexConfig {
        #[arg(long, default_value="auto", value_parser=["auto", "prompt", "writes", "approve"])]
        approval_mode: String,
        #[arg(long, default_value="basic", value_parser=["basic", "full"])]
        toolset: String,
    },
    /// List existing sessions as JSON, without sending remote input.
    Sessions,
    /// Read an explicit session as JSON.
    Screen { #[arg(long)] session: String },
    /// Execute one JSON request from a UTF-8 file or '-' stdin. Keeps the process alive until terminal state.
    Run { #[arg(long)] input: String },
    /// Inspect effective policy for the command in a JSON file or '-' stdin. Never connects.
    PolicyCheck { #[arg(long)] input: String },''')
edit('src/main.rs', '        Command::CodexConfig => print_codex_config()?,', '''        Command::CodexConfig { approval_mode, toolset } => print_codex_config(&approval_mode, &toolset)?,
        Command::Sessions => local_cli::sessions().await?,
        Command::Screen { session } => local_cli::screen(session).await?,
        Command::Run { input } => local_cli::run(&input).await?,
        Command::PolicyCheck { input } => local_cli::policy_check(&input)?,''')
edit('src/main.rs', 'fn print_codex_config() -> Result<()> {', 'fn print_codex_config(approval_mode: &str, toolset: &str) -> Result<()> {')
edit('src/main.rs', 'default_tools_approval_mode = \\"prompt\\"', 'default_tools_approval_mode = \\"{approval_mode}\\"')
edit('src/main.rs', '''    for name in [
        "bridge_status",''', '''    if toolset == "basic" {
        println!("enabled_tools = [\\"securecrt_bridge_status\\", \\"securecrt_list_sessions\\", \\"securecrt_read_screen\\", \\"securecrt_run_command\\", \\"securecrt_get_command_status\\", \\"securecrt_get_command_output\\", \\"securecrt_interrupt\\", \\"securecrt_acknowledge_idle\\"]");
    }
    for name in [
        "bridge_status",''')
edit('tests/mcp_smoke.py', "cli('codex-config')", "cli('codex-config', '--approval-mode', 'prompt', '--toolset', 'full')")
edit('tests/mcp_smoke.py', "replace('mode = \"unrestricted\"', 'mode = \"safe\"')", "replace('mode = \"client\"', 'mode = \"safe\"')")
edit('tests/mcp_smoke.py', 'assert len(names) == 10', 'assert len(names) == 11')
for path in ['Cargo.toml', 'Cargo.lock', 'bridge/securecrt_bridge.py', 'tests/mcp_smoke.py']:
    p = Path(path)
    text = p.read_text(encoding='utf-8')
    assert '0.2.0-preview.1' in text, path
    p.write_text(text.replace('0.2.0-preview.1', '0.2.0-preview.2'), encoding='utf-8')

with Path('src/regression.rs').open('a', encoding='utf-8') as f:
    f.write('''

#[test]
fn client_profile_delegates_risk_without_treating_search_data_as_commands() {
    let config = Config::default();
    assert_eq!(config.policy.mode, "client");
    let policy = PolicyEngine::new(&config.policy).unwrap();
    for text in ["grep 'deny' nginx.conf", "grep 'shutdown' nginx.conf", "systemctl stop test-only", "rm -rf /tmp/FAKE-TEST"] {
        assert_eq!(policy.classify_command(text).decision, Decision::Allow, "{text}");
    }
    assert_eq!(policy.classify_command("\\u{3}uname").decision, Decision::Deny);
}

#[test]
fn legacy_guardrails_match_command_positions_not_grep_operands() {
    let mut config = Config::default();
    config.policy.mode = "unrestricted".into();
    let policy = PolicyEngine::new(&config.policy).unwrap();
    for text in ["grep 'deny' nginx.conf", "grep 'shutdown' nginx.conf", "grep deny nginx.conf", "systemctl status nginx"] {
        assert_eq!(policy.classify_command(text).decision, Decision::Allow, "{text}");
    }
    assert_eq!(policy.classify_command("systemctl stop test-only").decision, Decision::Deny);
    config.policy.mode = "client".into();
    config.policy.custom_deny_patterns.push("deny".into());
    let denied = PolicyEngine::new(&config.policy).unwrap().classify_command("grep deny nginx.conf");
    assert_eq!(denied.decision, Decision::Deny);
    assert!(denied.reason.contains("custom_deny_rule[0]"));
}

#[test]
fn timed_out_partial_output_is_not_discarded() {
    let mut parser = MarkerParser::new("BEGIN".into(), "END".into());
    assert_eq!(parser.feed("BEGIN\\npartial-without-newline").0, "");
    assert_eq!(parser.drain_partial(), "partial-without-newline");
    assert_eq!(parser.drain_partial(), "");
}
''')
print('Applied agent UX patches with exact baseline assertions')
