# Claude Code / Claude Desktop

[简体中文](claude.md) · [English](claude.en.md) · [Installation](../installation.en.md) · [Agent setup prompt](../agent-setup.md#english-prompt) · [Documentation map](../README.en.md)

## Initialize without writing Codex

**Current `install` always writes Codex configuration; it does not register Claude.** Claude-only users should keep the verified binary at a stable absolute path, set the chosen absolute `SECURECRT_MCP_HOME` and run that binary's `init` instead. This initializes the bridge and application configuration without writing Codex or copying an installed binary. Use `upgrade` for subsequent bridge refreshes, not `init --force`. Follow [installation](../installation.en.md) for source/package selection, initialization commands and UI bridge loading.

Use a persistent **stdio** server: the selected absolute executable with argument `serve`, not `run` or a daemon invocation per tool call. Both clients must receive the same application home as initialization.

For a Windows custom home, the native terminal process must also inherit that home variable; a Claude env entry does not set it for SecureCRT/Xshell. See the [application-directory instructions](../installation.en.md#2-choose-the-application-directory-and-client) before loading the script. Preserve existing logged-in terminals.

## Claude Code

Check installed `claude mcp add --help` first. Inspect existing server entries/scopes; merge an existing `securecrt` entry without dropping other env keys or permission settings. For a new entry, replace the placeholder paths:

```sh
claude mcp add --transport stdio --scope user --env SECURECRT_MCP_HOME=/absolute/path/to/app-home securecrt -- /absolute/path/to/securecrt-mcp serve
```

```powershell
claude mcp add --transport stdio --scope user --env "SECURECRT_MCP_HOME=C:\Tools\securecrt-mcp-home" securecrt -- "C:\Tools\securecrt-mcp.exe" serve
```

The `--` after `--env` ends option parsing so the server name is not consumed as another environment value. `--scope user` is for Claude Code; it is not a Claude Desktop configuration location. Use the installed client's inspection commands/MCP status to confirm registration, then reload the client as needed. [Official Claude Code MCP instructions](https://code.claude.com/docs/en/mcp)

## Claude Desktop

Locate the MCP configuration for your installed Claude Desktop version through its settings/documentation. Merge this entry under the existing `mcpServers` object; do not replace the file or other servers. Do not paste it into Claude Code's configuration.

Windows JSON example (placeholder paths):

```json
{
  "mcpServers": {
    "securecrt": {
      "command": "C:\\Tools\\securecrt-mcp.exe",
      "args": ["serve"],
      "env": {
        "SECURECRT_MCP_HOME": "C:\\Tools\\securecrt-mcp-home"
      }
    }
  }
}
```

macOS equivalent:

```json
{
  "mcpServers": {
    "securecrt": {
      "command": "/absolute/path/to/securecrt-mcp",
      "args": ["serve"],
      "env": {
        "SECURECRT_MCP_HOME": "/absolute/path/to/app-home"
      }
    }
  }
}
```

JSON escapes Windows backslashes as `\\`; CLI arguments use normal `\`. Absolute paths and the explicit home let a GUI-started client find the same application files without inheriting your installation shell. Restart Desktop and inspect its MCP server/tool status; a valid JSON file alone does not prove loading.

## Use and verify approvals

Run offline doctor, load the native bridge only when authorized and idle, and check online backend diagnostics. Then `connector_list` → verify authorized target → `connector_open` → `connector_read_screen` → `connector_exec` / `connector_exec_batch`. Follow [Agent workflow](../agent-usage.en.md) for state and pagination. OpenSSH-only stream tools handle logs/REPLs; `connector_close` stops capture, not remote work.

Opening a session does not authorize commands. Client trust/permissions remain operator-owned. On an explicitly authorized idle test tab, request a harmless `printf` and reject it using the client's actual approval controls; verify zero terminal input and corresponding audit dispatch. Do not retry automatically. Separately authorize a new approved operation and check its actual completion/output. If the client offers no rejection control or sends despite rejection, stop and report that gap; do not claim approval verification from MCP annotations.

Do not add blanket approvals to reduce latency. Local `client` policy does not attest to Claude's approval, and remote SSH permissions remain authoritative. Raw input is a separate local opt-in. Use short `wait_ms` values where client call limits require polling; progress messages do not guarantee extension of a hard timeout. Compilation, registration and doctor are separate from real session execution.
