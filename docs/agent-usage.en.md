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

Installation retains client approval settings. `codex-config --toolset terminal --approval-mode prompt` only prints an optional block; do not use it to overwrite existing restrictions. Client-specific rejection with zero send needs real acceptance in [Codex](clients/codex.en.md) ([中文](clients/codex.md)) or [Claude](clients/claude.en.md). Build, config writes and doctor are not evidence of real command completion or approval. Keep tokens, endpoints, usernames, handles and previous terminal history out of public reports.
