# Agent session workflow

[简体中文](agent-usage.md) · [English](agent-usage.en.md) · [Documentation map](README.en.md) · [Installation](installation.en.md) · [Setup prompt](agent-setup.md#english-prompt) · [Connector contract](connectors.md)

Use public MCP tools named `connector_*`; old `securecrt_*` and `run_command` tools are not registered. The Rust CLI's `run` is a separate manual debugging entry. Keep one MCP connection for retained state and pagination; [persistent calling](persistent-terminal.md) explains the optional daemon.

## Discover and bind before input

`connector_list` discovers actual targets without authorizing execution. Verify backend, title and the **explicitly authorized test target**. Use the native UI or an observation attachment to inspect the original terminal when idle state is not yet established. Never infer idle from a title or assume every connected tab is a test environment.

Example `connector_open` (replace the target with the current list's opaque ID):

```json
{"backend":"securecrt","target":"opaque-target-from-current-list","mode":"exec"}
```

Mac execution binding selects the verified native tab and samples stable context without sending a probe command. Observation attachments do not focus or input. Retain the returned `session_id` for all later calls; do not substitute tab numbers or same-name targets.

After binding, use `connector_read_screen` with the returned `session_id` to inspect the current screen. Only after explicit authorization and verification of an idle **POSIX shell**, use `connector_exec`:

```json
{"session_id":"returned-session-id","command":"printf 'CHECK_OK\\n'","mode":"posix","timeout_ms":10000,"wait_ms":1000,"operation_id":"new-unique-operation-id"}
```

The values above are placeholders, not reusable live handles/operation IDs. Password prompts, menus, editors, database REPLs and pagers are not POSIX command boundaries. `running` / `starting` means query the original `command_id`, not resend. `wait_ms` is the current wait; `timeout_ms` is the capture budget, not permission to retry remote work.

## Interpret the receipt

| Field | Meaning |
| --- | --- |
| `state` | starting / running / completed / rejected / timed_out / cancelled / unknown |
| `sent` | true: send evidence; false: zero send; null: cannot establish delivery, inspect state |
| `exit_code` | Actual POSIX completion marker; unknown is never fabricated as zero |
| `begin_marker_observed` / `end_marker_observed` | Evidence from this capture stream, never reconstructed from old screen text |
| `execution_state` / `capture_state` | Foreground completion and body capture are separate; completion may coexist with missing body |
| `dropped_retention_bytes` | Observed bytes not retained; excludes unmeasurable native loss |
| `text` / `next_cursor` | Retained output and UTF-8-byte pagination cursor |
| `truncated` / `capture_may_be_incomplete` | Bounded retention or capture risk; missing output is explicit |
| `requires_idle_ack` | Unresolved interlock needs explicit recovery; late polling must not reset an acknowledged cancellation |
| `error_code` / `action` | Failure phase and next-step guidance |
| `remote_termination_confirmed` | false; foreground completion/Ctrl+C does not prove every remote descendant ended |

Within one MCP process, the same operation ID and semantics return the original task without another send. Changing target, command or mode conflicts; expired output does not authorize replay. This is not permanent deduplication across restarts. After rejection, establish zero send and obtain authorization before a new operation with a different ID.

`connector_exec_batch` must list all intended commands at call time (maximum 20); query `connector_get_batch_status`. Each entry has its own command ID, output and exit code. Uncertainty, context rejection or timeout stops subsequent entries even with `on_error=continue`; that option applies only to a confirmed completed nonzero exit.

## Stop and inspect uncertainty

Inspect the original tab and confirm the original foreground command has ended. Only with explicit recovery authorization, get a fresh `connector_read_screen` token and use `connector_acknowledge` with `confirmed_idle=true`, `screen_token` and exact `expected_prompt`. Do not automatically declare idle. Rebind invalid attachments; historical timeout/unknown/cancelled states remain those outcomes.

There is no automatic acknowledgement, Ctrl+C, replay or backend switch. MCP disconnection drains already sent tasks within a bounded budget, without extra input or automatic remote termination. A one-shot CLI is not a long-term pagination cache; use the same MCP process or explicit daemon.

## Prompt restoration and bounded screen views

The current Windows bridge supports `connector_restore_prompt`. The same owner/attachment must have captured its POSIX completion marker, with no active or unresolved command, and the operator must confirm that the original shell is idle. Call `connector_read_screen` with `context_only=true`, or `tail_lines=8` and `max_bytes=4096`. Projection omits returned history; the fresh token still validates the full native frame. Each fresh read replaces that session's older token.

```json
{"session_id":"returned-session-id","context_only":true}
```

Then call `connector_restore_prompt` with `session_id`, `confirmed_idle=true`, the fresh `screen_token` and the original exact `expected_prompt`. It sends one Enter only for a blank input line at column 1 with unchanged width. Password/pager/typed input, resize, another owner, stale tokens and unknown foreground work are rejected. A failed restoration retains an interlock and cannot resend the key. An already normal prompt requires no input. Restoration never terminates background work. Mac/older bridges reject this unsupported operation before sending.

```json
{"session_id":"returned-session-id","confirmed_idle":true,"screen_token":"fresh-token","expected_prompt":"original exact prompt"}
```

Current Windows enumeration leases last 120 seconds, screen tokens 30 seconds and attachments 600 seconds. Valid owner attachments and active polls revalidate the actual retained object and renew its lease; heartbeat never renews screen tokens. Reconnection or changed endpoint/title/index still rejects. Expired attachments require discovery and binding again.

## Capture, scripts and background work

Windows SecureCRT `ReadString` returns empty and consumes unmatched data on timeout. Bounded batched line reads preserve BEGIN and complete lines; an unterminated fragment crossing a native timeout can still be lost and is disclosed with `capture_may_be_incomplete=true`. Exit evidence remains separate. Neither empty body nor screen history proves complete output. Windows retains ANSI text returned by the native SDK; this is SDK text, not raw SSH bytes. Results add `structuredContent` while retaining compatible text JSON.

Use pipes without a PTY for JSON-RPC stdio. Protocol belongs on stdout and diagnostics on stderr; local echo, wrapping and ANSI rendering do not prove duplicate remote execution.

```json
{"session_id":"returned-session-id","command":"printf 'checked UTF-8 output\\n'","mode":"posix","prefer_native_log":true}
```

This explicit Windows option requests native logging on the same authenticated session. SecureCRT reports `capture_transport=native_raw_log` and reads UTF-8 raw logs; Xshell reports `native_session_log`, uses its configured log format and decodes UTF-8 or BOM-tagged UTF-16 incrementally. Both avoid SDK calls per line and the screen scrollback bound. Completion still requires this operation's exact BEGIN/END markers. Existing user logging stays unchanged. Unsupported SDKs or a pre-send failure with complete rollback fall back to the original receive path; failures after send never switch transport or replay. Mac and other capture modes retain their existing path. The option defaults off and also applies to a batch when explicitly supplied on `connector_exec_batch`.

The private IPC instance directory temporarily stores command echo and output, with a 16 MiB read bound per capture. Do not opt in for commands containing secrets. Normal completion, timeout and watchdog close logging and restore script log-path preferences/screen settings; Rust drains the final flush and deletes its own file. OS/terminal termination or a host skipping script cleanup can leave files or logging state; verify the original test terminal is idle and inspect logging before reloading. Session configuration is never saved and existing user logs are neither read nor stopped. Xshell reports the last actual log filename, which can still identify this capture after closing; that metadata differs from script path preferences and persistent configuration. The bridge never restarts a user logger to restore the reported filename. Invalid encoding is replaced and explicitly reported as possibly incomplete. Xshell logging preserves configured formatting: timestamps or other prefixes that change marker lines can prevent completion. It requires the terminal's UTF-8 mode and never changes logging options. Screen fallback reports uncertainty when its anchor rolls out of scrollback; it does not clear history or retry.

The optional [script transport helper](../clients/script_transport.js) uses an already-owned attachment: UTF-8/LF, bounded chunks, a private 0600 staging file, SHA-256 verification and same-directory atomic replacement, with a 1 MiB limit. The caller explicitly selects the destination and authorizes overwriting it. Upload is distinct from execution. Do not upload secrets; retain default `include_command_text=false`. Base64 chunks still echo in the terminal, so this is not hidden transfer. Uncertainty stops all further writes, including cleanup; inspect the returned staging_path without automatically uploading again.

The target shell needs `base64` and either `sha256sum` or `shasum -a 256`. Permission commands support GNU/Linux and macOS. Checksums read file contents through stdin, avoiding escaped-filename output differences.

Redirect the entire background launch, for example:

```sh
(nohup sh -c 'first-command && sh /approved/task.sh' </dev/null >/approved/task.log 2>&1 &)
```

`first-command && nohup task &` backgrounds the whole AND list; redirecting only the last child leaves earlier output on the shared terminal. Use a unique task directory and write the final exit status to a temporary result file before atomically renaming it. Query that result and task log separately. A launcher exit of 0, a live PID or an unchanged log does not prove the background task succeeded.

Installation retains client approval settings. `codex-config --toolset terminal --approval-mode prompt` only prints an optional block; do not use it to overwrite existing restrictions. Client-specific rejection with zero send needs real acceptance in [Codex](clients/codex.en.md) ([中文](clients/codex.md)) or [Claude](clients/claude.en.md). Build, config writes and doctor are not evidence of real command completion or approval. Keep tokens, endpoints, usernames, handles and previous terminal history out of public reports.
