# securecrt-mcp

[![CI](https://github.com/seaworld008/securecrt-mcp/actions/workflows/ci.yml/badge.svg)](https://github.com/seaworld008/securecrt-mcp/actions/workflows/ci.yml)
[中文](README.md) · [Installation](docs/installation.md) · [Desktop acceptance](docs/desktop-acceptance.md)

**securecrt-mcp 0.5.2** is a Rust MCP server for reusing authenticated SecureCRT / Xshell SSH tabs. Unified `connector_*` tools provide opaque target handles, command/batch state, real exit codes, pagination, bounded output and audit. Client approvals and remote account permissions remain operator-owned. Desktop backends reuse existing VPN, bastion, keys and MFA without exporting credentials or opening another SSH connection. Explicit `openssh` sessions use system OpenSSH, Agent, ssh_config and known_hosts for persistent exec / PTY.

## Install

Use a release or CI bundle containing the current source. A merge to main does not replace old public release assets. Verify SHA256SUMS and inspect the package for `install.cmd` / `install.command` and the platform entries.

| Platform | One-click installer | Native entry | User runtime |
| --- | --- | --- | --- |
| Windows SecureCRT | `install.cmd` | `%USERPROFILE%\.securecrt-mcp\securecrt-mcp-securecrt.js` | System JScript; no Python, Node or Rust |
| Windows Xshell | `install.cmd` | `securecrt-mcp-xshell.js` in the standard Xshell Scripts folder | System JScript; no Python, Node or Rust |
| macOS SecureCRT | `install.command` | `~/.securecrt-mcp/securecrt_bridge.py` | A Python engine loadable by SecureCRT; standard library only |

The CLI equivalent is `securecrt-mcp install`. It installs into the private user directory, deploys platform entries and updates only the securecrt MCP executable/arguments in Codex configuration, preserving other settings, comments and existing approval/tool restrictions. Tokens, policy, custom deny rules and SSH logins are retained. No global PATH changes are made.

Reload Codex, then select the fixed entry with **Script → Run** in an idle connected terminal. Each SecureCRT process needs one script covering every connected Tab. Duplicate starts show a friendly notice and retain the original instance. To stop it, select a Tab where Cancel is enabled and choose **Script → Cancel**. Xshell uses its actual native discovery scope.

Windows users may also select the self-contained `.js` entry directly from an extracted bundle; it releases the matching Rust binary automatically. Mac has no vendor-supported JScript/ActiveX native interface, so a single minimum Python adapter remains. Build, package, client and acceptance controllers use JS/Rust. No additional Python upper bound is imposed once the terminal has loaded the engine and the required APIs/source identity match. SecureCRT's own loader version/architecture requirements still apply. [Vendor scripting platforms](https://www.vandyke.com/products/securecrt/scripts.html)

Reuse an already working Mac engine. No pip or pywin32 is required. If the engine is absent, follow the installed terminal's supported-version notice and official installation instructions, then restart SecureCRT. The project does not promise that arbitrary Python versions can be loaded by the vendor's native engine. [Official Mac engine loading](https://www.vandyke.com/support/tips/how-to-use-python-scripting-securecrt-on-macos.html)

## Upgrade and diagnose

Run `install` again from a new bundle to replace the private executable and fixed entry. Source developers use:

```sh
git pull --ff-only origin main
cargo build --release --locked
./target/release/securecrt-mcp install
```

`upgrade` only refreshes configured entries. Do not use `init --force` for routine upgrades. Replacing a file does not reload it in a running terminal: cancel when idle, run the same entry, restart MCP and rediscover targets; old handles remain invalid.

Use the absolute executable path printed by installation:

```sh
securecrt-mcp doctor --offline
securecrt-mcp doctor --backend securecrt
securecrt-mcp doctor --backend xshell
securecrt-mcp doctor --backend openssh
```

Offline checks validate local files. Online checks report the actual terminal engine, native APIs and source identity. Windows send/read methods are observed only after actual calls; unknown APIs are not claimed as tested. Doctor or compilation alone does not establish desktop acceptance.

## Workflow

1. Discover with `connector_list`, verify backend, title and current screen.
2. Bind with `connector_open` and retain its returned `session_id`.
3. Reuse the attachment with `connector_exec` or an explicit batch of at most 20 commands.
4. Check `state`, `sent`, `exit_code`, `error_code` and cursor-paginated output.
5. Stop on uncertainty. Inspect the original terminal; acknowledge only after the original command is finished and a fresh idle screen token is available. Commands, Ctrl+C and idle recovery are never retried automatically.

Each Tab retains its own capture/interlock. An operation ID is deduplicated in one MCP process, not across arbitrary process restarts. Batch entries keep independent outputs and exit codes; uncertainty stops subsequent entries. OpenSSH stream tools support logs, pagers, REPLs, PTY input and resizing; desktop screens are not native PTYs.

An optional authenticated loopback daemon lets CLI / JS / PowerShell clients share one retained Engine. Native MCP is already persistent and does not need another daemon. See [persistent terminals](docs/persistent-terminal.md), [CLI clients](docs/clients/command-line.md), [connectors](docs/connectors.md) and [security model](docs/security-model.md).

## Acceptance and development

[Desktop cases](docs/desktop-test-cases.md) define D01–D14 and real UI U01–U04. Windows historical receipts and new Mac receipts are separate, tied to exact binary/source hashes and working-tree status. Keep FAIL receipts; do not enlarge the original 10-second long-output budget to manufacture a pass. Never publish endpoints, user names, session IDs, tokens or prior terminal history.

For explicitly authorized idle test tabs only:

```sh
node tests/desktop_matrix.js target/release/securecrt-mcp --backend securecrt --all-idle --expect-securecrt 2 --exercise-recovery --output-dir .local-evidence/mac-desktop-UNIQUE
```

Use repeated explicit `--target securecrt=OPAQUE_ID` arguments when business tabs are present. Duplicate launch, cancellation/reload and disconnect/reconnect require actual native UI evidence.

Develop with Rust 1.88+ and Node. Only native Mac adapter contract development tests require Python; Windows installed users require none of those developer tools.

```sh
cargo fmt --all -- --check
cargo clippy --locked --all-targets --all-features -- -D warnings
cargo test --locked --all-targets --all-features
cargo build --locked
node tests/windows_bridge_test.js
node tests/mcp_smoke.js target/debug/securecrt-mcp
node tests/mac_adapter_contract.js
node scripts/validate_repository.js
```

See [testing](docs/testing.md), [support policy](docs/support-policy.md), [support matrix](docs/support-matrix.md), [troubleshooting](docs/troubleshooting.md), [contribution guide](CONTRIBUTING.md) and [license](LICENSE). Client approval rejection remains a separate client-side acceptance check; installation never silently widens existing approvals.
