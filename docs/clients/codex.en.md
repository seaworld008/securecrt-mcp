# Codex configuration and approvals

[简体中文](codex.md) · [English](codex.en.md) · [Installation](../installation.en.md) · [Documentation map](../README.en.md)

## Choose automatic installation or manual registration

Current-main `install` writes only the `securecrt` MCP command/arguments/home in Codex, preserving unrelated configuration, comments and existing approvals/tool restrictions. It uses absolute `CODEX_HOME/config.toml` when set, otherwise the user's `.codex/config.toml`. It adds default startup/tool timeouts only when absent. The public v0.5.2 binary predates this installer; v0.5.3 contains current main; check [source selection](../installation.en.md#1-select-and-verify-the-source) first.

For manual registration, keep the verified binary at a stable absolute path and run its `init` with the chosen application home. Inspect existing entries before adding; if `securecrt` already exists, merge only its command, arguments and home, preserving other env keys and approval/tool restrictions.

Check the installed `codex mcp add --help` before using these examples. Replace all placeholder paths:

```sh
codex mcp add securecrt --env SECURECRT_MCP_HOME=/absolute/path/to/app-home -- /absolute/path/to/securecrt-mcp serve
```

```powershell
codex mcp add securecrt --env "SECURECRT_MCP_HOME=C:\Tools\securecrt-mcp-home" -- "C:\Tools\securecrt-mcp.exe" serve
```

Equivalent TOML for Windows (merge into the active Codex config, not a new unrelated file):

```toml
[mcp_servers.securecrt]
command = "C:\\Tools\\securecrt-mcp.exe"
args = ["serve"]

[mcp_servers.securecrt.env]
SECURECRT_MCP_HOME = "C:\\Tools\\securecrt-mcp-home"
```

On macOS/Linux replace both values with absolute Unix paths; do not use `~` as an executable path. TOML basic strings and JSON strings escape Windows backslashes as `\\`; CLI arguments use ordinary `\`. The binary, bridge and client must use the same application home, including GUI cold starts.

For a Windows custom home, the terminal process must inherit the same variable; Codex's env does not set SecureCRT/Xshell's env. Follow the [application-directory instructions](../installation.en.md#2-choose-the-application-directory-and-client) and preserve existing logged-in terminals.

The binary's `codex-config --toolset terminal --approval-mode prompt` prints an optional additive block; it does not write Codex files. Inspect its output and installed-client support before merging. Keep operator/organization policy; do not replace existing approval rules with generated defaults. [Official Codex MCP documentation](https://developers.openai.com/codex/mcp/)

## Verify loading and real operation

Run offline doctor with that binary/home, load the native bridge through the terminal UI when authorized and idle, then reload Codex. Inspect its MCP server/tool status and run the selected backend's online doctor. Discover with `connector_list`, verify the authorized target, bind with `connector_open`, then inspect it with `connector_read_screen`. Retain its `session_id` for exec/batch/status/pagination, then close. Follow [Agent usage](../agent-usage.en.md); password dialogs, pagers and REPLs are not idle POSIX shells.

On an explicitly authorized dedicated idle test tab, request a new harmless `printf` and reject it in the client approval UI. Verify zero terminal input, remote execution and corresponding audit `dispatch_attempt`. Do not retry automatically. With separate authorization, a new approved operation ID should produce one send, one command ID and the actual final result.

If no approval UI appears or rejection still sends input, stop and record client version and sanitized configuration. CI, MCP annotations and successful doctor do not prove the rejection path. Installation does not loosen existing approvals. Do not publish tokens, endpoints, usernames, handles or prior history; unknown outcomes require inspection of the original tab and explicit tracked recovery.
