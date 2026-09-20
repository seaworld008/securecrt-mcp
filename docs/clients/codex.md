# Codex integration

## Windows

After placing `securecrt-mcp.exe` at a stable path, add a server entry to the Codex configuration:

```toml
[mcp_servers.securecrt]
command = "C:\\Tools\\securecrt-mcp.exe"
args = ["serve"]
```

## macOS / Linux

```toml
[mcp_servers.securecrt]
command = "/usr/local/bin/securecrt-mcp"
args = ["serve"]
```

## Before starting Codex

1. Run `securecrt-mcp init` once.
2. Open the SSH sessions you want to use in SecureCRT.
3. In SecureCRT choose **Script > Run...** and run `~/.securecrt-mcp/securecrt_bridge.py`.
4. Run `securecrt-mcp doctor`.
5. Start/restart Codex so it loads the MCP server configuration.

## Suggested operational prompts

Read-only Kubernetes investigation:

```text
Use SecureCRT. List current sessions, find the k8s master tab, run read-only
commands to investigate unhealthy pods in namespace jwxt-prod. You may use
kubectl get, describe, logs and top. Do not make changes.
```

Host troubleshooting:

```text
On the SecureCRT tab named activity-h5admin, inspect CPU, memory, disk,
network listeners and relevant service logs. Explain the likely bottleneck.
Do not restart services or edit files.
```

## Safety

Codex can request tools, but the `securecrt-mcp` policy engine remains authoritative. A prompt asking the model to bypass policy does not change local policy configuration.
