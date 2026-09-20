# securecrt-mcp

[![CI](https://github.com/seaworld008/securecrt-mcp/actions/workflows/ci.yml/badge.svg)](https://github.com/seaworld008/securecrt-mcp/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Rust](https://img.shields.io/badge/Rust-1.88%2B-orange.svg)](https://www.rust-lang.org/)
[![MCP](https://img.shields.io/badge/MCP-2026--07--28-blue.svg)](https://modelcontextprotocol.io/)

> Let AI assistants safely inspect and operate **SSH sessions that are already logged in inside SecureCRT**.

`securecrt-mcp` is a cross-platform Model Context Protocol (MCP) server written in Rust. It connects MCP clients such as Codex or Claude Desktop to SecureCRT through a small Python bridge that runs **inside the SecureCRT process**.

The project does **not** reimplement SSH and does not need your SSH password, private key, jump-host configuration, or MFA secret. SecureCRT remains responsible for authentication and session management; the MCP layer only interacts with tabs you already opened.

**中文默认文档:** [README.md](README.md)

## Why this project exists

SecureCRT exposes a powerful scripting API for tabs, sessions, and terminal screens, but its `crt` automation object exists only inside a script launched by SecureCRT. An external Rust/Python process cannot directly attach to that object.

`securecrt-mcp` bridges that gap:

```text
Codex / Claude / other MCP client
             │
             │ MCP over stdio
             ▼
┌──────────────────────────────┐
│ securecrt-mcp (Rust)         │
│                              │
│ MCP tools                    │
│ policy engine                │
│ audit log                    │
│ localhost bridge client      │
└──────────────┬───────────────┘
               │ NDJSON + token
               │ 127.0.0.1 only
               ▼
┌──────────────────────────────┐
│ SecureCRT Python bridge      │
│ running inside SecureCRT     │
│                              │
│ crt.GetTabCount()            │
│ crt.GetTab()                 │
│ tab.Screen.Get2()            │
│ tab.Screen.Send()            │
└──────────────┬───────────────┘
               │
        existing logged-in tabs
      ┌────────┼────────┐
      ▼        ▼        ▼
   K8s prod  MySQL   Nginx host
```

## Status

**v0.1.1 — early preview / foundation.**

The architecture, bridge protocol, local policy engine, audit trail, CI, documentation, and core MCP tools are in place. The project intentionally starts conservative: raw keystroke injection is disabled by default and command execution uses a read-oriented allowlist. See [validation and compatibility](docs/testing.md) for the distinction between automated checks and real SecureCRT runtime verification.

SecureCRT is proprietary software from VanDyke Software. This project is independent and is not affiliated with or endorsed by VanDyke Software.

## Supported platforms

The Rust MCP server is designed for:

- Windows 10/11 and Windows Server
- macOS (Intel and Apple Silicon)
- Linux

The bridge relies on SecureCRT's Python 3 scripting support. VanDyke documents Python scripting across Windows, macOS, and Linux. See the upstream SecureCRT documentation linked in [docs/references.md](docs/references.md).

## MCP tools

| Tool | Purpose | Default policy |
|---|---|---|
| `securecrt_bridge_status` | Check bridge connectivity | Allowed |
| `securecrt_list_sessions` | List existing SecureCRT tabs | Allowed |
| `securecrt_read_screen` | Read visible terminal text | Allowed |
| `securecrt_focus_session` | Focus a tab locally | Allowed |
| `securecrt_execute_command` | Send one command and capture output/screen | Safe allowlist |
| `securecrt_interrupt` | Send Ctrl+C | Allowed |
| `securecrt_send_text` | Raw text/keystroke injection | **Disabled** |

The initial bridge only sees tabs in the SecureCRT window/process instance where the bridge script is running.

## Quick start

### 1. Build

```bash
cargo build --release
```

The binary will be at:

```text
target/release/securecrt-mcp        # macOS/Linux
target\release\securecrt-mcp.exe    # Windows
```

### 2. Initialize local files

```bash
securecrt-mcp init
```

This creates:

```text
~/.securecrt-mcp/config.toml
~/.securecrt-mcp/bridge.json
~/.securecrt-mcp/securecrt_bridge.py
~/.securecrt-mcp/audit.jsonl         # created on first audited action
```

`bridge.json` contains a random local authentication token. On Unix-like systems the initializer restricts the config directory and secret files to the current user.

### 3. Start the bridge in SecureCRT

In SecureCRT:

```text
Script -> Run...
```

Select:

```text
~/.securecrt-mcp/securecrt_bridge.py
```

Keep the script running while you use the MCP server. Use **Script -> Cancel** to stop it.

### 4. Verify

```bash
securecrt-mcp doctor
```

A healthy setup reports `bridge: OK` and the number of SecureCRT tabs visible to the bridge.

### 5. Add to Codex

Windows example:

```toml
[mcp_servers.securecrt]
command = "C:\\Tools\\securecrt-mcp.exe"
args = ["serve"]
```

macOS/Linux example:

```toml
[mcp_servers.securecrt]
command = "/usr/local/bin/securecrt-mcp"
args = ["serve"]
```

Then ask your MCP client something like:

```text
List my SecureCRT sessions. On tab k8s-master01, inspect the pods in jwxt-prod
and explain any unhealthy workloads. Do not make changes.
```

## Command safety model

Default `policy.mode = "safe"` is intentionally conservative.

Examples allowed by default include:

```bash
kubectl get pods -A
kubectl describe pod my-pod -n prod
kubectl logs deployment/api -n prod
systemctl status nginx
journalctl -u nginx -n 200
ss -lntp
df -h
free -h
docker ps
docker logs api
```

Examples blocked by default include:

```bash
kubectl delete pod my-pod
kubectl apply -f deployment.yaml
systemctl restart nginx
rm -rf /tmp/example
dd if=/dev/zero of=/dev/sda
iptables -F
docker exec ...
```

Safe mode also blocks shell chaining, pipelines, redirection, command substitution, and multiline commands unless you intentionally add a custom allow rule. This is conservative by design.

See [docs/security-model.md](docs/security-model.md) before using the project against production systems.

## Configuration

`~/.securecrt-mcp/config.toml`:

```toml
[bridge]
host = "127.0.0.1"
port = 27855
connect_timeout_ms = 1500
request_timeout_ms = 35000
max_command_timeout_ms = 30000

[policy]
mode = "safe"
allow_raw_send = false
allow_interrupt = true
custom_allow_patterns = []
custom_deny_patterns = []

[audit]
enabled = true
file = "audit.jsonl"
include_command_text = false
```

Policy modes:

- `observe`: list/read/focus only; command execution is disabled.
- `safe`: built-in read-oriented allowlist plus custom allow patterns.
- `allowlist`: only commands matching your `custom_allow_patterns`.
- `unrestricted`: commands are allowed unless they match a hard deny rule. Use only in trusted environments.

## Output behavior

`securecrt_execute_command` supports two capture modes:

1. **Screen snapshot (default):** send a command, wait briefly, then capture the visible terminal screen.
2. **`wait_for` mode:** use SecureCRT `ReadString()` and wait for literal text such as a known prompt or marker.

The default is deliberately generic because SecureCRT can connect to Linux shells, network appliances, serial consoles, and many other targets with different prompts.

## Development

```bash
cargo fmt --all -- --check
cargo clippy --all-targets --all-features
cargo test --all-targets
python3 -m py_compile bridge/securecrt_bridge.py
```

See:

- [Architecture](docs/architecture.md)
- [Bridge protocol](docs/bridge-protocol.md)
- [Security model](docs/security-model.md)
- [Codex setup (English)](docs/clients/codex.en.md)
- [Codex 配置（中文默认）](docs/clients/codex.md)
- [Troubleshooting](docs/troubleshooting.md)
- [Validation / compatibility](docs/testing.md)
- [Roadmap](ROADMAP.md)
- [Contributing](CONTRIBUTING.md)

## Design principles

1. **Use existing SecureCRT authentication.** Never duplicate SSH credentials when an authenticated tab already exists.
2. **Local by default.** The bridge binds to loopback only and requires a random token.
3. **Least privilege.** Read-oriented commands are the default; raw input is opt-in.
4. **Auditable actions.** Mutating tool attempts and command executions are recorded locally.
5. **Portable boundary.** SecureCRT-specific automation lives in the Python bridge; MCP, policy, and audit logic stay in Rust.
6. **Evolvable protocol.** If VanDyke adds an official external automation/MCP API in the future, a new bridge backend can replace the Python adapter without rewriting the MCP surface.

## Security

Treat an MCP client with access to your SecureCRT sessions as privileged automation. Review [SECURITY.md](SECURITY.md) and [docs/security-model.md](docs/security-model.md), especially before enabling `unrestricted` mode or raw text injection.

Do not expose the bridge port beyond localhost. Do not commit `~/.securecrt-mcp/bridge.json` or audit logs to Git.

## License

MIT. See [LICENSE](LICENSE).
