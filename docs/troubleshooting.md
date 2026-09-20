# Troubleshooting

## `securecrt-mcp doctor` cannot connect

Confirm the bridge script is running inside SecureCRT:

```text
Script -> Run... -> ~/.securecrt-mcp/securecrt_bridge.py
```

Check that another process is not already listening on port `27855`.

Windows:

```powershell
Get-NetTCPConnection -LocalPort 27855 -ErrorAction SilentlyContinue
```

macOS/Linux:

```bash
lsof -nP -iTCP:27855 -sTCP:LISTEN
```

## Bridge says authentication failed

The Rust process and Python bridge are reading different `bridge.json` files, or one file was replaced while the other process remained running.

1. Stop the SecureCRT bridge with **Script -> Cancel**.
2. Run `securecrt-mcp init --force`.
3. Restart the bridge.
4. Run `securecrt-mcp doctor`.

Be aware that `--force` replaces local policy configuration with defaults.

## Python3 script does not start in SecureCRT

The bridge header requests `Python3`. Confirm your SecureCRT version and Python 3 scripting configuration. SecureCRT 9.x documents Python 3 automation support; on Windows a compatible external Python 3 installation may be required depending on your SecureCRT setup.

## A command is blocked

This is usually expected in `safe` mode. Check the message and audit log.

Prefer adding a narrow anchored regex to `custom_allow_patterns`, for example:

```toml
custom_allow_patterns = [
  '^/usr/local/bin/my-readonly-healthcheck(?:\\s+--[a-z-]+)*$'
]
```

Avoid broad expressions such as `.*` for production sessions.

## Output is incomplete

The default command capture is a visible-screen snapshot after `settle_ms`. For slow commands, increase `settle_ms` or supply `wait_for` with predictable prompt/marker text.

For example, a client can call `securecrt_execute_command` with a larger timeout and a `wait_for` value known to occur after command completion.

## Duplicate tab captions

Use the stable selector returned for the current tab listing, for example:

```text
tab:3
```

Tab indices can change when tabs are closed or reordered, so list sessions again before a sensitive action.
