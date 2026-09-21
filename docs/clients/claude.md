# Claude Code / Claude Desktop

Use the native persistent stdio server rather than spawning `run` for every command. Initialize/upgrade and start the installed bridge inside SecureCRT first.

Claude Code (replace the executable path):

```powershell
claude mcp add --transport stdio --scope user securecrt -- "C:\Tools\securecrt-mcp.exe" serve
```

A stdio client JSON example:

```json
{
  "mcpServers": {
    "securecrt": {
      "command": "C:\\Tools\\securecrt-mcp.exe",
      "args": ["serve"]
    }
  }
}
```

Merge with existing configuration; do not overwrite unrelated servers. Claude Code scopes/configuration and Claude Desktop configuration locations are separate. See [official Claude Code MCP instructions](https://code.claude.com/docs/en/mcp) for installed-client behavior. A compatible Claude Code server entry can set `timeout` in milliseconds; choose at least75000 for a60-second incremental read plus local overhead, or prefer short wait_ms values. Do not assume progress messages extend hard call limits.

Recommended tool flow: `securecrt_list_sessions`, inspect target, `securecrt_attach`, then `securecrt_exec` / `securecrt_exec_batch`. For continuous logs use `securecrt_shell_open/read`; `shell_close` stops capture, not remote work. All execution/write/batch tools are non-read-only and potentially destructive. Attachment does not authorize later commands. Client permissions are configured by the operator and should be tested, including a rejected tool call causing no terminal input.

Do not add a blanket approval rule merely to improve latency. The connector's `client` policy is not an attestation that Claude has approved the operation. SSH account permissions remain authoritative. Raw interactive input is a separate local opt-in.
