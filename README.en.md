# securecrt-mcp

[![CI](https://github.com/seaworld008/securecrt-mcp/actions/workflows/ci.yml/badge.svg)](https://github.com/seaworld008/securecrt-mcp/actions/workflows/ci.yml)
[![Release](https://img.shields.io/github/v/release/seaworld008/securecrt-mcp?display_name=tag)](https://github.com/seaworld008/securecrt-mcp/releases)
[![License](https://img.shields.io/github/license/seaworld008/securecrt-mcp)](LICENSE)
[中文说明](README.md)

**securecrt-mcp 0.4.0** is a production-oriented Rust MCP server for operating SSH sessions that are already authenticated in SecureCRT from Codex, Claude, or another MCP client, with an explicit persistent OpenSSH/PTY connector option.

It reuses the operator's VPN, bastion, SSH key, and MFA flow. It does not create a second SSH connection or export server credentials. This project is independent of VanDyke Software.

> **Production scope:** suitable for operations diagnostics, release checks, log inspection, and controlled changes. It is a SecureCRT session connector, not a native SSH/PTY implementation and not a second AI approval system. Client approval, remote account authorization, and human target confirmation remain required.

> **High-performance connector (opt-in):** the new `connector_*` tools can open persistent system OpenSSH command or PTY sessions explicitly. SecureCRT remains the default backend. OpenSSH uses the user's `ssh_config`, Agent, ProxyJump and known_hosts; MCP does not store passwords. See [Unified connectors](docs/connectors.md).

## What it provides

- Opaque session handles for existing SecureCRT tabs instead of mutable tab indexes.
- `attach -> exec` reuse for repeated commands on one verified tab.
- `exec_batch` with up to 20 explicit commands, independent output, exit codes, audits, and command IDs.
- Batched native reads, incremental output, cursor pagination, and explicit truncation/gap reporting.
- Per-session leases, capture interlocks, timeouts, interrupts, idle acknowledgement, and unresolved-work quarantine.
- An optional loopback daemon for CLI, Python, and PowerShell clients that need one retained Engine.
- A narrow catastrophic-operation guard; routine command decisions stay with the MCP client and remote account.
- No automatic replay of unknown commands, implicit Ctrl+C, tab rebinding, or approval bypass.
- Persistent OpenSSH `ssh -T`/`ssh -tt` sessions provide command execution, long-running streams, PTY input, resize and absolute-cursor pagination.

## Verified scope

Before 0.4.0, Rust, Bridge, MCP stdio, batch, daemon, fault-injection, packaging, and connector tests passed. Real desktop acceptance was run on Windows x64 with SecureCRT 9.0.0 and embedded Python 3.8.10:

- Three Linux SSH tabs (`php_test`, `php_dev`, `k8s-master1`) completed `hostname`, `uptime`, and `pwd` batches after a SecureCRT restart.
- Long output was read through cursor pagination.
- An `observe` attachment rejected execution with `sent=false`.
- Slow or uncertain prompt redraw returns `context_changed` without sending the next command.
- Running the Bridge script twice shows a friendly already-running message instead of a Python bind traceback.

These results do not claim native SSH equivalence. Validate the actual targets, client approval UI, SecureCRT build, and business workflow in every production environment.

## Install on Windows

Download the Windows x64 archive and `SHA256SUMS` from the [latest Release](https://github.com/seaworld008/securecrt-mcp/releases/latest):

```powershell
Get-FileHash .\securecrt-mcp-0.4.0-x86_64-pc-windows-msvc.zip -Algorithm SHA256
Get-Content .\SHA256SUMS
```

Unpack and initialize:

```powershell
.\securecrt-mcp.exe init
.\securecrt-mcp.exe paths
```

In SecureCRT choose **Script -> Run** and run the Bridge path printed by `paths`. Dismiss the Chinese startup dialog, then verify:

```powershell
.\securecrt-mcp.exe doctor
.\securecrt-mcp.exe doctor --latency
```

Running the script again is harmless: the active Bridge reports that it is already running. To restart, resolve active or unresolved work first, then stop the script or restart SecureCRT.

### Upgrade

```powershell
git pull --ff-only origin main
cargo build --locked --release
.\target\release\securecrt-mcp.exe upgrade
.\target\release\securecrt-mcp.exe doctor --offline
```

`upgrade` preserves the existing token, policy, and custom deny rules and backs up the previous Bridge. Restart the installed Bridge after upgrading; replacing the file does not replace a script already loaded in SecureCRT memory. Do not use `init --force` for routine upgrades.

## MCP client setup

Generate additive Codex terminal configuration:

```powershell
.\securecrt-mcp.exe codex-config --toolset terminal --approval-mode prompt
```

Merge the output into the existing Codex configuration. Example for Claude Code:

```powershell
claude mcp add --transport stdio --scope user securecrt -- `
  "C:\Tools\securecrt-mcp.exe" serve
```

Start with `prompt` while validating client rejection and zero terminal input, then choose the approval mode required by your operating policy.

## Daily workflow

1. List sessions and inspect the target screen.
2. Attach once to the verified tab and retain the `attachment_id`.
3. Reuse that attachment for `securecrt_exec`, or submit a small explicit `securecrt_exec_batch`.
4. Check `state`, `sent`, `exit_code`, `error_code`, cursors, and audit fields on every result.
5. Use `securecrt_shell_open/read` for long-running output and explicit `securecrt_interrupt` for a foreground process that must be interrupted.

```json
{
  "attachment_id": "actual attachment id",
  "command": "hostname",
  "mode": "posix",
  "timeout_ms": 30000
}
```

Batch is not a transaction or permanent authorization. Every command must be visible in the first client approval context. Unknown, timed-out, changed-context, and transport-failed work stops without replay.

## Safety boundaries

- The Bridge listens only on `127.0.0.1`, with a random token, request deadlines, and frame limits.
- `client` mode delegates routine approval to Codex/Claude. The built-in guard blocks only a small set of catastrophic mistakes; it is not a shell parser or sandbox.
- `shared`, `exclusive`, and `observe` are cooperative connector modes, not a SecureCRT keyboard lock. Human input, reconnects, and nested SSH targets still require operator confirmation.
- Attachments are not permanent authorization, and daemon restart does not provide exactly-once durability.
- A POSIX completion marker proves foreground return, not that background children terminated.
- MySQL, pagers, REPLs, editors, and password prompts are not ordinary POSIX shells; inspect before sending shell commands.

See [security model](docs/security-model.md), [persistent terminal guide](docs/persistent-terminal.md), and the [production checklist](docs/production-readiness.md).

## Production checklist

- [ ] Run `doctor` on the target SecureCRT installation and confirm the Bridge version and capabilities.
- [ ] Reject one harmless command in the real client approval UI and verify zero terminal input.
- [ ] Complete repeated commands and a small batch on the same attachment.
- [ ] Verify slow redraw fails closed with `context_changed` and never duplicates a command.
- [ ] Distinguish POSIX shells from MySQL/REPL, pager, and editor contexts.
- [ ] Protect the daemon endpoint, audit directory, and token backups with local OS permissions.
- [ ] Start with a non-production tab before enabling production sessions.

## Documentation

- [中文生产验收](docs/production-readiness.md)
- [Persistent terminal](docs/persistent-terminal.md)
- [Security model](docs/security-model.md)
- [Architecture](docs/architecture.md) · [Bridge protocol](docs/bridge-protocol.md)
- [Performance and limits](docs/performance.md)
- [Unified connectors and OpenSSH/PTY](docs/connectors.md)
- [Troubleshooting](docs/troubleshooting.md)
- [Codex](docs/clients/codex.en.md) · [Claude](docs/clients/claude.md)
- [Release process](docs/releases.md)

## Development

```powershell
cargo fmt --all -- --check
cargo clippy --locked --all-targets --all-features -- -D warnings
cargo test --locked --all-targets --all-features
python -m pytest -q tests
python scripts/validate_repository.py
```

Contributions: [CONTRIBUTING.md](CONTRIBUTING.md). Private security reports: [SECURITY.md](SECURITY.md).

## License

MIT License. See [LICENSE](LICENSE).
