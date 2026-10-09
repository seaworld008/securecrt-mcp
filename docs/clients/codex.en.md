# Codex configuration and approvals

[Installation](../installation.md) writes the private executable path, `args=["serve"]` and the selected `env.SECURECRT_MCP_HOME` into the securecrt MCP entry only. Other settings, comments and existing approval/tool restrictions are retained. Reload Codex and restart the fixed native entry only when the terminal is idle.

`securecrt-mcp codex-config --toolset terminal --approval-mode prompt` prints an optional additive block; it does not overwrite configuration. Use keys supported by the installed client and operator/organization approval policy. [Official MCP configuration](https://developers.openai.com/codex/mcp/) is separate from actual client UI validation.

Discover explicit targets with `connector_list`, bind with `connector_open`, retain its `session_id` for repeated exec/batch/status/pagination, then close. Mac execution binding selects the verified native Tab before sampling input context; no probe command is sent. Never guess targets or use POSIX envelopes in password dialogs, pagers or REPLs.

On a dedicated idle test Tab, request a new harmless printf operation and reject it in the client approval UI. Verify zero terminal echo, remote execution and dispatch_attempt. Do not retry automatically. A new approved operation ID should produce one send, one command ID and the real final state. No approval popup or unexpected send means stop and record sanitized client/configuration details. CI and MCP annotations do not prove that UI path.

Never publish tokens, endpoints, user names, handles or previous terminal history. Unknown outcomes require original-terminal inspection and explicit tracked interruption/idle recovery.
