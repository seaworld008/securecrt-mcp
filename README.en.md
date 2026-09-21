# securecrt-mcp

**0.2.0-preview.2 / bridge protocol 2 / [中文](README.md)**

A Rust MCP server controlling **existing authenticated SecureCRT tabs** through a Python standard-library native adapter. No new SSH connections or exported SSH credentials. Independent of VanDyke Software.

## Preview boundaries

This preview changes session selectors and command execution. CI tests Rust and a fake native adapter; it does not certify actual SecureCRT desktop compatibility or interactive Codex approvals. Test on non-production sessions first.

New installations use `policy.mode = "client"`, delegating command risk/approval to the client without a built-in command denylist. Explicit custom deny rules still apply. Upgrades preserve existing policy verbatim; the old unrestricted profile remains available. Client mode is trusted-client passthrough; legacy unrestricted includes a convenience deny filter. Neither is a sandbox. Scripts, wrappers, aliases and compound commands can evade that filter. Remote accounts/RBAC and verified client approvals remain necessary. Safe mode is a small finite grammar, not arbitrary-shell security. Custom allow expressions match the entire command and are explicit administrative exceptions.

## Build and upgrade

```sh
cargo build --locked --release
./target/release/securecrt-mcp upgrade
./target/release/securecrt-mcp doctor --offline
./target/release/securecrt-mcp codex-config
```

Use `init` for first installation. Windows uses `target\release\securecrt-mcp.exe`. Stop the old script and exit clients holding the binary before upgrading. `upgrade` preserves policy/token, backs up the replaced adapter, and uses the embedded version. `init --force` is an explicit reset/rotation with backups; not routine repair.

Run `./target/release/securecrt-mcp paths` to print the installed script path. Run that script using **SecureCRT → Script → Run**, dismiss its startup dialog, then run `doctor`. It reports the actual embedded Python/platform and bridge protocol, not an external Python executable. The standard config directory is `~/.securecrt-mcp`; `SECURECRT_MCP_HOME` may specify an absolute override. The script reads `bridge.json` beside itself.

## Verified Windows flow

This is historical **preview.1** evidence, not desktop certification of preview.2 or its new client-policy default.

On 2026-09-20, protocol 2 was exercised against Windows x64, SecureCRT 9.0.0 x64 and embedded Python 3.8.10:

- `doctor` reported Bridge `0.2.0-preview.1`, protocol 2, and a healthy runtime connection.
- `securecrt_list_sessions` returned two logged-in SSH session leases; subsequent operations used opaque leases rather than legacy `tab:1` selectors.
- `securecrt_read_screen` returned the current prompt and a single-use `screen_token`.
- After confirming an idle POSIX shell, `hostname` completed through `mode = "posix"` with the expected session output.
- `rm -rf` was rejected by the Rust policy before it reached SecureCRT.

This evidence covers the tested Windows/SecureCRT combination only. It is not a certification of other SecureCRT versions, terminal types, or client approval UIs. On timeout, cancellation or `unknown`, inspect the original screen and confirm idleness before any further action; do not replay automatically.

`codex-config` prints additive TOML with `--approval-mode auto --toolset basic` by default, and read-only exceptions. Use `--approval-mode prompt` for explicit per-call prompts and `--toolset full` for every low-level tool. It never edits your client settings. Verify actual approval rejection in your installed Codex; annotations and documentation are not approval enforcement.

## Preferred one-call workflow

Select an existing session, then call `securecrt_run_command` with `session`, `command`, and explicit `mode: "posix"`. It obtains fresh native context, submits once, waits and returns bounded `text`, `sent`, `state`, `exit_code` and `next_cursor`. Prompt/snapshot and nonstandard prompts require explicit `expected_prompt`. Prompt inference is a UX heuristic, NOT remote-host authentication.

`wait_ms` bounds waiting for this response, not the remote operation. A running result is polled by its original command ID, not resubmitted. Exact pre-send rejection no longer creates an unnecessary unknown interlock. A lost reply is still `sent: null`; there is never an automatic retry, interrupt or idle acknowledgement. Explicit idle acknowledgement returns a fresh usable screen token. Results are evicted at cache capacity without deleting replay-prevention tombstones.

Use the native MCP connection for persistent jobs. The Rust one-shot CLI and thin Python/PowerShell wrappers remove JSON-RPC/string-escaping boilerplate; see [local clients](docs/clients/command-line.md) and [Agent usage](docs/agent-usage.md).

## Low-level execution workflow

List sessions → read screen → inspect target and idle context → submit an approved command with `session`, `screen_token`, `expected_prompt`, unique `operation_id`, `command` and `mode` → poll `command_id` → page output with UTF-8 byte cursors.

- `snapshot` sends the original text and captures a screen, ending as **unknown**, not success.
- `prompt` waits for an explicit literal `wait_for`; exit code remains null.
- `posix` is explicit POSIX-only opt-in. A random marker envelope uses `eval` in the current shell, preserving cd/export. A leading newline before the end marker handles output without a trailing newline. It is not suitable for appliances, PowerShell, passwords, editors or REPLs. exit/exec/set -e may prevent completion markers. Background jobs are not supervised.

One active native capture per SecureCRT window in this preview. No automatic retries or implicit Ctrl+C. Timeout/cancellation/unknown states leave an interlock. Inspect the original terminal, then explicitly acknowledge idle with fresh context. A sent interrupt does not prove remote termination.

Opaque session leases retain native Tab references rather than resolving mutable indexes for sends. Observed disconnects/config changes invalidate them; repeated enumeration renews leases. Sampled APIs cannot prove an unobserved reconnect or the current nested SSH target. Screen tokens expire in 30 seconds and are single-use. This is mistake prevention, not hostile-server authentication.

Output is bounded (default 1 MiB/job, 32 jobs); pagination reports truncation/incompleteness. Native capture timeout behavior needs runtime testing. Duplicate operation IDs within one MCP process do not re-execute; changed arguments conflict and expired outputs do not permit replay. There is no persistent exactly-once guarantee across restarts.

## Tools

`securecrt_run_command`, `securecrt_bridge_status`, `securecrt_list_sessions`, `securecrt_read_screen`, `securecrt_focus_session`, `securecrt_execute_command`, `securecrt_get_command_status`, `securecrt_get_command_output`, `securecrt_interrupt`, `securecrt_acknowledge_idle`, `securecrt_send_text` (disabled by default).

Audit failure before dispatch prevents sends; post-dispatch errors remain visible alongside the actual result. The adapter binds explicitly to loopback with a random token and expiring bounded frames. Same-user malware/token theft is outside the security boundary. Windows relies on user-profile ACLs; no custom ACL hardening is claimed.

## Development

```sh
cargo fmt --all -- --check
cargo clippy --locked --all-targets --all-features -- -D warnings
cargo test --locked --all-targets --all-features
cargo build --locked
python -m unittest discover -s tests -v
python tests/mcp_smoke.py target/debug/securecrt-mcp
python tests/ux_smoke.py target/debug/securecrt-mcp
python tests/review_smoke.py target/debug/securecrt-mcp
python scripts/validate_repository.py
```

Rust 1.88; Python 3.12 for repository/smoke checks. Adapter-only tests also run on Python 3.8. CI runs Rust and live MCP/fake-bridge tests on three operating systems. Tag-gated preview releases package four desktop targets with checksums; existence of a workflow is not proof a release has been published.

[Architecture](docs/architecture.md) · [Protocol](docs/bridge-protocol.md) · [Security](docs/security-model.md) · [Migration](docs/migration-0.2.md) · [Testing](docs/testing.md) · [Releases](docs/releases.md) · [MIT License](LICENSE)
