# securecrt-mcp

[简体中文](README.md) · [English](README.en.md) · [Documentation map](docs/README.en.md)

Let your AI assistant work through SSH tabs you have already logged into. **securecrt-mcp** is a local Rust MCP server for Codex, Claude and other MCP clients, for people operating remote systems through **SecureCRT or Windows Xshell**.

[![CI main](https://github.com/seaworld008/securecrt-mcp/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/seaworld008/securecrt-mcp/actions/workflows/ci.yml?query=branch%3Amain)
[![Latest release](https://img.shields.io/github/v/release/seaworld008/securecrt-mcp?display_name=tag)](https://github.com/seaworld008/securecrt-mcp/releases/latest)
[![MIT](https://img.shields.io/badge/license-MIT-blue)](LICENSE)
[![Rust 1.88+](https://img.shields.io/badge/Rust-1.88%2B-orange)](Cargo.toml)

MCP lets an AI client call tools running on your computer. Desktop backends reuse the terminal's existing login, VPN, bastion and MFA context without exporting SSH credentials or opening another SSH connection. The optional **OpenSSH** backend opens its own connection with your system SSH client, agent, configuration and host keys.

- Discover tabs and bind an explicit target; reuse that attachment for commands or batches of up to 20 commands.
- Track state, actual POSIX exit codes, paginated output, timeouts and local audit records.
- Use OpenSSH exec / PTY streams for logs, pagers and REPLs. Desktop backends capture screens; they are not native PTYs.
- Keep client approvals and remote account permissions under your control. Unknown results require inspection; commands and idle recovery are never retried automatically.

## Get started

**[Installation and upgrade](docs/installation.en.md)** · [Codex](docs/clients/codex.en.md) · [Claude Code / Desktop](docs/clients/claude.en.md) · **[Agent setup prompts](docs/agent-setup.md#english-prompt)**

Paste this into Codex, Claude Code or another Agent with local tools:

```text
Install https://github.com/seaworld008/securecrt-mcp for my AI client.
Read its current docs/agent-setup.md and docs/installation.en.md first.
Identify my OS, architecture and terminal; verify the source and checksum.
Preserve existing MCP entries, approvals, policies, tokens and SSH logins.
Use my client's documented setup route and run doctor --offline.
Load the bridge when authorized; hand off any unavailable native UI steps.
Test harmlessly only in an explicitly authorized idle tab; never assume idle.
Report passed, failed and untested layers; config checks are not SSH proof.
```

### Choose a platform and source

The paths below describe **current main**. See the [support matrix](docs/support-matrix.md) for tested systems and exact evidence; other versions and architectures require validation.

| Platform / backend | Native entry after initialization | End-user runtime |
| --- | --- | --- |
| Windows / SecureCRT | `securecrt-mcp-securecrt.js` in the chosen application directory | Installed SecureCRT + system JScript; no Python, Node or Rust |
| Windows / Xshell | `securecrt-mcp-xshell.js` in Xshell's Scripts folder; custom application home uses `xshell-scripts` | Installed Xshell + system JScript; no Python, Node or Rust |
| macOS / SecureCRT | `securecrt_bridge.py` in the chosen application directory | Installed SecureCRT + a Python engine it can load; standard library only |
| Windows, macOS, Linux / optional OpenSSH | Explicit `openssh` backend; no desktop bridge | System OpenSSH and separately authorized SSH access |

Linux desktop SecureCRT is unverified in the current desktop matrix. **Source builds** need Rust 1.88+ and a platform linker; Node 22 is for development/testing/packaging, not installed Windows terminal use. macOS engine support is determined by the installed SecureCRT loader, not by your shell's Python version.

**Release boundary:** published **v0.5.2** comes from [`3c3489b`](https://github.com/seaworld008/securecrt-mcp/commit/3c3489ba267008af2e7bdcc09b0f890c56feb71b), before `install` and the current Windows self-contained scripts. The latest-release badge does not imply these features exist in its ZIP. Inspect the archive and its matching documentation; never mix old binaries with current adapters.

For the current installation flow, keep the current main checkout and its matching documentation. Clone it and record the full commit:

```sh
git clone --branch main https://github.com/seaworld008/securecrt-mcp.git
cd securecrt-mcp
git rev-parse HEAD
```

Check the [main CI runs](https://github.com/seaworld008/securecrt-mcp/actions/workflows/ci.yml?query=branch%3Amain) for a successful run on that exact commit, then build with Rust 1.88+:

```sh
cargo build --release --locked
```

The executable is `target/release/securecrt-mcp` (`securecrt-mcp.exe` on Windows). Alternatively, choose a successful [main CI run](https://github.com/seaworld008/securecrt-mcp/actions/workflows/ci.yml?query=branch%3Amain), verify its commit and platform/architecture, and inspect `native-test-bundle-<OS>-<ARCH>`. These artifacts are test bundles, not public releases. Verify the inner ZIP against its `.zip.sha256`; release downloads use their own `SHA256SUMS`. See [installation](docs/installation.en.md) for checksum commands and package inspection.

### Initialize, connect and verify

1. **Codex users:** run the selected binary's `install`, or `install.cmd` / `install.command` only if the selected package contains it. This installs a private binary and updates Codex's `securecrt` entry, preserving other settings and existing approval/tool restrictions. It does not configure every AI client or modify global PATH.
2. **Claude-only / other clients:** use the selected binary's `init` to initialize the bridge without writing Codex configuration. Register a stable **absolute binary path**, `args = ["serve"]` and the same absolute `SECURECRT_MCP_HOME`. See [Claude configuration](docs/clients/claude.en.md).
3. With the same binary and application home, run `doctor --offline`. In an explicitly authorized idle terminal, load the entry shown by `paths` via **Script → Run**. SecureCRT needs one script per process; cancel it in its original launching tab. Xshell uses its actual discovery scope. Reload the AI client and run the selected backend's online doctor.
4. Discover with `connector_list`, verify the authorized target, bind with `connector_open`, then inspect it with `connector_read_screen`. Only after verifying an explicitly authorized idle POSIX test tab, run a harmless `printf` and check `state`, `sent`, `exit_code` and output. Configuration and doctor checks do not prove execution or client approval behavior.

Updating files does not reload a running bridge. Upgrade when idle, cancel the old instance, load the fixed entry, restart MCP and rediscover targets. Ordinary upgrades retain tokens and policy; **do not use `init --force`**. See [installation](docs/installation.en.md), [Agent workflow](docs/agent-usage.en.md) and [troubleshooting](docs/troubleshooting.md).

## Learn more and contribute

[Documentation map](docs/README.md) · [Interfaces](docs/connectors.md) · [Architecture](docs/architecture.md) · [Security model](docs/security-model.md) · [Security reporting](SECURITY.md) · [Support policy](docs/support-policy.md)

Start development with [contributing](CONTRIBUTING.md) and [Agent maintenance](docs/agent-maintenance.md). [Testing](docs/testing.md) and [desktop acceptance](docs/desktop-acceptance.md) separate automated checks from actual native UI, SSH and client approval evidence. Use [GitHub issues](https://github.com/seaworld008/securecrt-mcp/issues) for sanitized bug reports and questions; follow [SECURITY.md](SECURITY.md) for vulnerabilities.
