# Installation, upgrade and runtime engines

[Documentation map](README.md) · [Agent setup prompt / 安装提示词](agent-setup.md) · [Codex](clients/codex.en.md) · [Claude](clients/claude.md)

This page describes **current main**, not every published ZIP. Desktop bridges reuse existing terminal logins; OpenSSH is a separate, explicitly chosen connection.

## 1. Select and verify the source

Public **v0.5.2** was published from [`3c3489ba267008af2e7bdcc09b0f890c56feb71b`](https://github.com/seaworld008/securecrt-mcp/commit/3c3489ba267008af2e7bdcc09b0f890c56feb71b). It predates the current `install` command and self-contained Windows JScript entries. Do not expect `install.cmd` or `install.command` in that old ZIP. Its historical Windows Python requirements differ from current main; use the package's own versioned documentation if deliberately using that release. Never combine its binary with current bridge files.

Choose one source:

| Source | What to check |
| --- | --- |
| [Public release](https://github.com/seaworld008/securecrt-mcp/releases/latest) | Release tag, recorded source commit, target architecture, archive contents and its own `SHA256SUMS`. Latest does not mean current-main installer support. |
| [Successful main CI](https://github.com/seaworld008/securecrt-mcp/actions/workflows/ci.yml?query=branch%3Amain) | Exact run commit, successful relevant jobs and `native-test-bundle-<OS>-<ARCH>` artifact. Extract the artifact wrapper, then check its inner ZIP against the accompanying `.zip.sha256`. Artifact availability/login is controlled by GitHub; this is a test bundle, not a release or desktop certification. |
| Main source | Keep current main and its matching documentation. Record the full commit and working-tree status, and confirm a successful CI run for that commit. Build locally with Rust 1.88+ and the platform linker/toolchain. |

```sh
git clone --branch main https://github.com/seaworld008/securecrt-mcp.git
cd securecrt-mcp
git rev-parse HEAD
```

Find a successful [main CI run](https://github.com/seaworld008/securecrt-mcp/actions/workflows/ci.yml?query=branch%3Amain) for the printed commit before continuing:

```sh
cargo build --release --locked
```

Use `target/release/securecrt-mcp` (Windows: `target/release/securecrt-mcp.exe`). Keep this checkout so the new setup and Agent guides remain available locally. Historical acceptance commits describe their recorded runtime, not the default installation checkout; a shared version string does not prove package identity.

Example checksum checks, in the directory containing the downloaded ZIP and trusted checksum file (replace `PACKAGE.zip` with its actual filename):

```sh
# macOS: compare the output with SHA256SUMS or PACKAGE.zip.sha256
shasum -a 256 PACKAGE.zip
# Linux: when the complete release set or selected CI ZIP is present
sha256sum --check SHA256SUMS
# For a CI ZIP instead:
sha256sum --check PACKAGE.zip.sha256
```

```powershell
Get-FileHash -Algorithm SHA256 .\PACKAGE.zip
# Compare Hash with its entry in SHA256SUMS or PACKAGE.zip.sha256.
```

Verify provenance as well as checksums: a hash detects mismatched bytes, not publisher impersonation. Inspect the selected binary's `--help` and `--version` and the ZIP contents. Only use bundled `install.cmd` / `install.command` when present and paired with that binary. Do not disable OS protection or bypass security prompts; let the user authorize the verified source according to local policy.

## 2. Choose the application directory and client

The default application home is `%USERPROFILE%\.securecrt-mcp` on Windows or `~/.securecrt-mcp` on macOS/Linux. An optional `SECURECRT_MCP_HOME` **absolute path** overrides it. Keep initialization, bridge, diagnostics and every MCP client on the same home. Use `paths` to get actual paths; do not guess them or publish configuration secrets.

**Windows custom-home detail:** the self-contained launcher reads `SECURECRT_MCP_HOME` from the **terminal process environment**, not from the selected script's folder. An already running SecureCRT/Xshell will not inherit a later PowerShell environment change, and the MCP client's env does not set the terminal's env. Prefer the existing/default home for an already logged-in terminal. For a custom home, the terminal must have been launched with that same variable; any exit/relaunch needs the user's authorization and must not discard existing SSH work. If that cannot be arranged, pause this step rather than silently initializing a second home. On macOS the native script loads `bridge.json` beside its actual script file.

The following commands are examples after replacing the paths. `/absolute/path` and `C:\Tools` are placeholders, not required installation locations.

```sh
export SECURECRT_MCP_HOME="/absolute/path/to/app-home"
"/absolute/path/to/securecrt-mcp" paths
# Codex users:
"/absolute/path/to/securecrt-mcp" install
# Claude-only / other clients: choose init INSTEAD of install
# "/absolute/path/to/securecrt-mcp" init
```

```powershell
$env:SECURECRT_MCP_HOME = "C:\Tools\securecrt-mcp-home"
& "C:\Tools\securecrt-mcp.exe" paths
# Codex users:
& "C:\Tools\securecrt-mcp.exe" install
# Claude-only / other clients: choose init INSTEAD of install
# & "C:\Tools\securecrt-mcp.exe" init
```

**What `install` does** (see `src/installation.rs`):

1. Copies the running binary into `<app-home>/bin`.
2. Initializes/updates the platform bridge, retaining existing tokens, policies and SSH logins.
3. Writes Codex's `mcp_servers.securecrt`: absolute `command`, `args = ["serve"]` and `env.SECURECRT_MCP_HOME`. It uses `CODEX_HOME/config.toml` if that environment variable is set to an absolute directory, otherwise the user's `.codex/config.toml`.
4. Preserves other MCP entries, comments, existing approvals, tool restrictions and other env keys. Adds startup/tool timeouts only if absent; new entries use the client's own approval defaults. Prints the installed binary and bridge locations.

It does not change global PATH or configure Claude. It writes Codex even when only Claude is intended. **Claude-only users should keep the verified binary at a stable absolute path, run `init` instead, then register it with Claude**. `init` initializes the application's config/bridge but does not copy a private binary or write Codex. Backups can contain secrets; keep them private. Configure any other MCP client using the same stdio command, `serve` argument and home.

See [Codex configuration](clients/codex.en.md) ([中文](clients/codex.md)) and [Claude Code / Desktop configuration](clients/claude.md) for additive examples. These clients have separate configuration and approval handling.

## 3. Load the native bridge

| Backend | Current entry | User runtime |
| --- | --- | --- |
| Windows SecureCRT | `<app-home>\securecrt-mcp-securecrt.js` | SecureCRT + system JScript; no Python, Node or Rust |
| Windows Xshell | Xshell's detected standard Scripts directory; with explicit `SECURECRT_MCP_HOME`: `<app-home>\xshell-scripts\securecrt-mcp-xshell.js` | Xshell + system JScript; no Python, Node or Rust |
| macOS SecureCRT | `<app-home>/securecrt_bridge.py` | SecureCRT-loadable Python engine; standard library only |
| Optional OpenSSH | No desktop script; explicit `openssh` backend | System OpenSSH + separately authorized connection |

Use the path printed during initialization or by `paths`. On Windows a current bundle may also contain self-contained `.js` entries that release their matching Rust binary; that is separate from `install`'s Codex configuration step.

When the intended terminal is idle and the user has authorized loading the bridge, choose **Script → Run** and the printed entry. SecureCRT requires one script per process, covering its connected tabs. Duplicate starts retain the original instance; cancel through **Script → Cancel** in the original launching tab. Cancellation preserves SSH login but does not prove remote work has ended. Xshell uses actual native discovery/instance scope; do not assume all windows are covered.

macOS SecureCRT does not have the Windows JScript/ActiveX scripting interface. Reuse an already loadable Python engine. If loading fails, follow the installed SecureCRT version's supported Python version/architecture and restart SecureCRT after installing the official runtime. No `pip`, pywin32 or global PATH changes are required. The terminal loader still decides what can load; the bridge adds no arbitrary Python upper bound after loading and API/source checks. [Vendor scripting platforms](https://www.vandyke.com/products/securecrt/scripts.html) · [macOS engine loading](https://www.vandyke.com/support/tips/how-to-use-python-scripting-securecrt-on-macos.html)

See the [support matrix](support-matrix.md) for tested versions/architectures. Linux desktop SecureCRT is unverified in the current matrix. Source builders need Rust 1.88+ and a linker; Node 22 is a development/test/package dependency and Python is also used by Mac adapter contract tests. These are distinct from installed end-user requirements.

## 4. Check each layer separately

Use the selected binary's absolute path; the commands below show subcommands to append to it:

```text
doctor --offline
doctor --backend xshell --offline
doctor --backend securecrt
doctor --backend xshell
doctor --backend openssh
```

Offline doctor validates local files/configuration and does **not** connect to the desktop bridge, prove a listener has stopped or test client approvals. Online desktop doctor inspects the loaded terminal engine, native capabilities and running source identity. OpenSSH doctor probes the local system client; actual authentication/exec/PTY needs a separate authorized test.

Reload the AI client. Discover via `connector_list`, verify backend/title, bind only the authorized target with `connector_open`, then inspect it with `connector_read_screen`. After explicit authorization for a dedicated idle POSIX test tab, execute one harmless `printf`; check state, send evidence, actual exit code and output. Follow [Agent usage](agent-usage.md) and the client-specific approval rejection check. Never treat successful compilation, config writes or doctor as proof of session execution.

## Upgrade

With a newly verified binary, Codex users rerun `install`; Claude-only users retain the stable binary path and run `upgrade`. `upgrade` refreshes embedded bridge entries without writing Codex; it does not replace a separately installed binary. Stop clients before replacing a binary in use. Ordinary updates preserve tokens and policy; do not use `init --force`.

Replacing files does not reload running scripts. At an authorized idle boundary, cancel the old script, load the fixed entry, restart MCP, run doctor and discover/bind new targets. Old handles are invalid. For unresolved work, inspect the original tab before any cancellation or recovery. See [troubleshooting](troubleshooting.md) and [desktop acceptance](desktop-acceptance.md).
