from pathlib import Path


def edit(path, old, new):
    p=Path(path); text=p.read_text(encoding='utf-8')
    assert text.count(old)==1, (path, text.count(old), old[:120])
    p.write_text(text.replace(old,new),encoding='utf-8')


edit('src/execution.rs', '        if let Err(error) = self.bridge.call("begin", request).await {', '''        let begin_result = self.bridge.call("begin", request).await.and_then(|value| {
            if value["sent"].as_bool() == Some(true) { Ok(value) }
            else { Err(crate::fault::BridgeFault {
                message: "dispatch outcome unknown: success reply lacks send evidence; do not replay".into(), sent: None,
            }.into()) }
        });
        if let Err(error) = begin_result {''')
edit('src/execution.rs', '''        if registry.busy == previous {
            registry.busy = None;
        }''', '''        if registry.busy == previous {
            if let Some(id) = previous.as_ref() {
                if let Some(job) = registry.jobs.get_mut(id) {
                    job.requires_idle_ack = false;
                }
            }
            registry.busy = None;
        }''')
edit('src/execution.rs', '"error_code": if matches!(self.state, State::Rejected | State::Unknown | State::TimedOut) { Some(crate::fault::code(&self.reason)) } else { None },', '"error_code": if self.state == State::TimedOut { Some("capture_timeout") } else if matches!(self.state, State::Rejected | State::Unknown) { Some(crate::fault::code(&self.reason)) } else { None },')
edit('src/main.rs', '            let service = SecureCrtServer::new(Engine::new(bridge, audit, policy, config))', '''            let engine = Engine::new(bridge, audit, policy, config);
            let service = SecureCrtServer::new(engine.clone())''')
edit('src/main.rs', '            service.waiting().await?;', '''            let ended = service.waiting().await;
            engine.drain_on_disconnect().await;
            ended?;''')
edit('src/main.rs', '    let quoted = toml::Value::String(path).to_string();', '''    let quoted = toml::Value::String(path).to_string();
    let tool_timeout = 65 + 2 * Config::load()?.bridge.request_timeout_ms.div_ceil(1000);''')
edit('src/main.rs', 'tool_timeout_sec = 65', 'tool_timeout_sec = {tool_timeout}')
with Path('src/execution/convenience.rs').open('a',encoding='utf-8') as f:
    f.write('''

impl Engine {
    /// Graceful EOF only: drain already-sent work for at most two seconds. No new command,
    /// no interrupt and no implicit acknowledgement. Hard termination still needs recovery.
    pub async fn drain_on_disconnect(&self) {
        let active = {
            let registry = self.inner.lock().await;
            registry.busy.as_ref().filter(|id| registry.jobs.get(*id).is_some_and(|j| j.state.active())).cloned()
        };
        if let Some(id) = active {
            let _ = self.wait_result(&id, 2000, 4).await;
        }
    }
}
''')
edit('clients/SecureCRT.ps1', "$ErrorActionPreference = 'Stop'", "$ErrorActionPreference = 'Stop'\n[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)\n$OutputEncoding = [Console]::OutputEncoding")
edit('clients/SecureCRT.ps1', "[ValidateSet('posix','prompt','snapshot')][string]$Mode = 'posix',", "[ValidateSet('posix','prompt','snapshot')][string]$Mode,")
edit('clients/SecureCRT.ps1', "            $request = @{session=$Session;", "            if ($Action -eq 'run' -and -not $Mode) { throw 'run requires an explicit -Mode with -CommandText' }\n            $request = @{session=$Session;")
edit('tests/ux_smoke.py', "            script = wrapper.with_name('SecureCRT.ps1')\n            result = subprocess.check_output(['pwsh', '-NoProfile', '-File', str(script), '-Binary', binary,\n                                              '-Action', 'run', '-InputFile', str(params)], env=env, text=True, encoding='utf-8')\n            assert json.loads(result)['state'] == 'completed'", "            script = wrapper.with_name('SecureCRT.ps1')\n            payload['command'] = 'large-output'\n            params.write_text(json.dumps(payload), encoding='utf-8')\n            for shell in ('pwsh', 'powershell.exe'):\n                result = subprocess.check_output([shell, '-NoProfile', '-File', str(script), '-Binary', binary,\n                                                  '-Action', 'run', '-InputFile', str(params)], env=env, text=True, encoding='utf-8')\n                parsed = json.loads(result)\n                assert parsed['state'] == 'completed' and parsed['text'].startswith('中')")

p=Path('README.md'); text=p.read_text(encoding='utf-8')
text=text.replace('**0.2.0-preview.1 ·','**0.2.0-preview.2 ·',1)
text=text.replace('## 本版解决的问题','''## 一次调用，完成常规排查

完成会话选择后，优先使用 `securecrt_run_command`：

```json
{"session":"从会话列表取得的句柄","command":"docker ps","mode":"posix","timeout_ms":30000,"max_bytes":60000}
```

工具内部读取新屏幕、获取 Token、提交一次命令、等待并返回有界输出；正常情况下不必手动轮询或再取一次输出。`mode` 必填：`posix` 是调用方明确选择空闲 POSIX Shell，不用于密码提示、堡垒机菜单或数据库 REPL。

新安装默认 `policy.mode = "client"`，命令风险与批准交给客户端。升级不修改旧策略；已有用户按需将现有 `[policy]` 的 `mode` 改成 `client`。自定义拒绝规则仍是操作者显式配置，不会被悄悄删除。

详见 [Agent 使用与错误恢复](docs/agent-usage.md) 和 [Python / PowerShell 客户端](docs/clients/command-line.md)。

## 本版解决的问题''')
text=text.replace('- 每次发送需要新鲜、单次使用的', '- 低层接口每次发送需要新鲜、单次使用的')
text=text.replace('- 命令先返回 `command_id`，再查询状态和分页输出。', '- 低层提交先返回 `command_id`；高层工具整合等待和输出。')
text=text.replace('## 已验证的 Windows 流程','## 已验证的 Windows 流程\n\n以下是 **preview.1 的历史实测**，保留原始证据；不是 preview.2 高层工具或新默认 `client` 策略的桌面验收。')
text=text.replace('default_tools_approval_mode = "prompt"','default_tools_approval_mode = "auto"')
text=text.replace('生成器还会为会话列表、状态和输出读取提供相应只读例外。命令执行、原始输入、中断及清除未决状态保持提示确认。', '生成器默认 `--approval-mode auto --toolset basic`，由 Codex 标准权限逻辑决定批准；只读工具提供例外。需要逐次确认可选择 `--approval-mode prompt`，需要全部低层工具可选择 `--toolset full`。生成配置不代表已验证实际客户端批准行为。')
start=text.index('## 日常调用流程\n'); end=text.index('### 三种捕获模式',start)
text=text[:start]+'''## 日常调用流程

先列出会话并核实目标。日常命令使用 `securecrt_run_command`，读取返回的 `text`、`state`、`exit_code`。`running` 表示继续查询原 `command_id`；`next_cursor` 非空表示可读取后续页。高级场景仍可使用 `read_screen → execute_command → status/output` 低层流程。

高层工具不会自动重试命令、Ctrl+C 或确认未决状态。明确未发送的拒绝返回 `sent: false`，不再错误地制造本地 unknown 阻塞；丢失发送回执仍返回 `sent: null` 并保留保护。显式确认空闲后同时返回新 `screen`，包含可用的新 Token。

示例：

```text
列出 SecureCRT 会话并让我确认目标。后续优先用 run_command 在已确认的 POSIX Shell 上排查 Docker、Nginx 和网络。
遵循客户端权限决定；不自动重试未知结果，不自动中断或确认空闲。输出不够时按 next_cursor 读取后续页。
```

'''+text[end:]
text=text.replace('`snapshot`（默认）','`snapshot`（低层默认；高层需明确选择）')
text=text.replace('| `securecrt_execute_command` |', '| `securecrt_run_command` | 首选的一次调用执行与有界输出 |\n| `securecrt_execute_command` |')
old='保留 `0.1.2` 的默认 `unrestricted`，现有配置升级不被覆盖。它允许普通单行命令，仅保留便利性危险命令过滤；脚本、包装、别名或组合语法可能绕过过滤，**不是沙箱**。真正授权依赖客户端审批、SSH 账号、sudo、Kubernetes RBAC 和数据库权限。'
assert old in text
text=text.replace(old,'新安装默认 `client`：不使用内置危险命令词表代替客户端授权。可选自定义拒绝规则、原始输入开关、输入/消息大小限制、审计和会话绑定仍然有效。旧版 `unrestricted` 保留原来的便利性过滤，升级不改变现有配置；两者都**不是沙箱**。真正授权依赖客户端权限、SSH 账号、sudo、Kubernetes RBAC 和数据库权限。')
text=text.replace('mode = "unrestricted"','mode = "client"')
text=text.replace('输出默认每任务保留 1 MiB、最多 32 个任务，参数乘积上限 128 MiB。','输出默认每任务保留 1 MiB、最多 32 个任务，参数乘积上限 128 MiB。缓存满时淘汰最旧的已结束结果，仍保留操作去重记录；不会因删掉输出而重新执行旧操作。')
text=text.replace('python tests/mcp_smoke.py target/debug/securecrt-mcp','python tests/mcp_smoke.py target/debug/securecrt-mcp\npython tests/ux_smoke.py target/debug/securecrt-mcp\npython tests/review_smoke.py target/debug/securecrt-mcp')
p.write_text(text,encoding='utf-8'); Path('README.zh-CN.md').write_text(text,encoding='utf-8')
p=Path('README.en.md');text=p.read_text(encoding='utf-8').replace('**0.2.0-preview.1 /','**0.2.0-preview.2 /',1)
text=text.replace('The unrestricted default introduced in 0.1.2 is preserved.', 'New installations use `policy.mode = "client"`, delegating command risk/approval to the client without a built-in command denylist. Explicit custom deny rules still apply. Upgrades preserve existing policy verbatim; the old unrestricted profile remains available.')
text=text.replace('It is trusted-client passthrough with a convenience deny filter, NOT a sandbox.', 'Client mode is trusted-client passthrough; legacy unrestricted includes a convenience deny filter. Neither is a sandbox.')
text=text.replace('## Verified Windows flow','## Verified Windows flow\n\nThis is historical **preview.1** evidence, not desktop certification of preview.2 or its new client-policy default.')
text=text.replace('with all tools defaulting to `prompt`, and read-only exceptions','with `--approval-mode auto --toolset basic` by default, and read-only exceptions. Use `--approval-mode prompt` for explicit per-call prompts and `--toolset full` for every low-level tool')
text=text.replace('## Execution workflow','''## Preferred one-call workflow

Select an existing session, then call `securecrt_run_command` with `session`, `command`, and explicit `mode: "posix"`. It obtains fresh native context, submits once, waits and returns bounded `text`, `sent`, `state`, `exit_code` and `next_cursor`. Prompt/snapshot and nonstandard prompts require explicit `expected_prompt`. Prompt inference is a UX heuristic, NOT remote-host authentication.

`wait_ms` bounds waiting for this response, not the remote operation. A running result is polled by its original command ID, not resubmitted. Exact pre-send rejection no longer creates an unnecessary unknown interlock. A lost reply is still `sent: null`; there is never an automatic retry, interrupt or idle acknowledgement. Explicit idle acknowledgement returns a fresh usable screen token. Results are evicted at cache capacity without deleting replay-prevention tombstones.

Use the native MCP connection for persistent jobs. The Rust one-shot CLI and thin Python/PowerShell wrappers remove JSON-RPC/string-escaping boilerplate; see [local clients](docs/clients/command-line.md) and [Agent usage](docs/agent-usage.md).

## Low-level execution workflow''')
text=text.replace('`securecrt_bridge_status`,', '`securecrt_run_command`, `securecrt_bridge_status`,',1)
text=text.replace('python tests/mcp_smoke.py target/debug/securecrt-mcp','python tests/mcp_smoke.py target/debug/securecrt-mcp\npython tests/ux_smoke.py target/debug/securecrt-mcp\npython tests/review_smoke.py target/debug/securecrt-mcp')
p.write_text(text,encoding='utf-8')
p=Path('CHANGELOG.md');text=p.read_text(encoding='utf-8')
p.write_text('''# Changelog

## 0.2.0-preview.2 — 2026-09-21

- Add agent-first run_command with internal fresh context, one submission, bounded wait/output, explicit capture mode and stable operation identity.
- Add delivery evidence and actionable structured errors; proven pre-send rejections no longer become unresolved jobs. Malformed success/lost responses remain uncertain.
- Add client policy for new installs; preserve existing configuration and optional legacy guardrails/custom rules. Add effective-policy diagnostics.
- Renew actively used native leases, return a fresh screen after explicit acknowledgement and reflect acknowledgement in job status.
- Evict old completed output while retaining replay-prevention tombstones; preserve partial output on timeout.
- Drain already-sent work for up to two seconds on graceful MCP EOF, without new input or implicit recovery. Hard-kill/restart recovery is still manual.
- Add Rust JSON CLI plus Python/PowerShell wrappers and configurable additive Codex tool presets.
- Preserve historical preview.1 Windows acceptance; new desktop behavior still requires local verification. No release tag created by this change.

'''+text.removeprefix('# Changelog\n'),encoding='utf-8')
p=Path('docs/migration-0.2.md');text=p.read_text(encoding='utf-8')
p.write_text('''# Preview.2 Agent UX upgrade

Build `main`, run `upgrade`, restart the native script, run `doctor`, then reload the MCP client. Existing policy/token remain unchanged. New installations use `mode = "client"`; existing users explicitly edit that one setting only if they want command approvals delegated to the client. Custom deny patterns are not automatically deleted.

`codex-config` now defaults to an additive basic tool preset and approval mode `auto`. Inspect and merge the output; do not append duplicate tables or overwrite unrelated client settings. `--approval-mode prompt --toolset full` provides explicit prompts and the full low-level surface.

Prefer `run_command` for routine idle POSIX-shell investigations. The old low-level tools remain available. One-use screen tokens still exist internally but are not normal high-level parameters. Acknowledge unresolved work only after inspecting the original terminal; acknowledgements now return a fresh screen.

See [Agent usage](agent-usage.md) and [local clients](clients/command-line.md). The following is the historical protocol-1 to protocol-2 migration; its preview.1 desktop record is not relabeled as preview.2 validation.

'''+text,encoding='utf-8')
for path in ['docs/security-model.md','docs/architecture.md','docs/bridge-protocol.md','docs/testing.md','docs/troubleshooting.md','docs/clients/codex.md','docs/clients/codex.en.md']:
    p=Path(path);text=p.read_text(encoding='utf-8')
    notice='''> **0.2.0-preview.2 update:** New installs use `client` policy (client-owned command authorization); upgrades preserve old settings. `run_command` is the preferred orchestration tool; low-level protocol-2 tools remain. See [Agent usage](LINK). Earlier preview.1 approval/default-policy examples below are historical, not a change to existing settings. Actual desktop approval behavior is not certified by CI.\n\n'''
    notice=notice.replace('LINK','../agent-usage.md' if '/clients/' in path else 'agent-usage.md')
    p.write_text(notice+text,encoding='utf-8')
print('Applied review fixes and updated documentation without replacing historical Windows evidence')
