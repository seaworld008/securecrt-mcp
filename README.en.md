# securecrt-mcp

**0.3.0-preview.1 · persistent terminal preview · bridge protocol 2 · [中文](README.md)**

Control existing authenticated SecureCRT tabs from Codex, Claude or another MCP client. Reuse the operator's VPN, bastion, SSH authentication and MFA. No new SSH connection or exported server credentials. Independent of VanDyke Software.

## Persistent by design

- Four bounded persistent NDJSON lanes, control/read separation and TCP_NODELAY; never replay a failed exchange.
- Batched native buffered reads instead of one bridge RPC per newline; no fixed sleep while output makes progress.
- Per-session execution/interlocks, retained attachments, atomic preparation/begin and bounded notification-driven output waits.
- Explicit batches with independent command IDs/output/exit codes/audits; uncertainty always stops.
- Incremental long-line parsing and continuous stream capture with a rolling tail and explicit cursor gaps.
- Optional authenticated foreground daemon for standalone CLI clients that need one retained Engine across processes.
- `doctor --latency`, actual command timing fields and reproducible comparative benchmarks.

The same-host synthetic test improved1600 lines/204801 bytes from12069.76ms to56.44ms, and20 short commands from1160.12ms to180.07ms. **Real Rust/TCP/adapter, simulated already-buffered native screens: not SSH, VPN, native desktop, approval or LLM latency.** [Method, scope and raw samples](docs/performance.md).

## Build and upgrade

Stop existing captures only after resolving their status, stop a running daemon, cancel the old SecureCRT script and close clients holding the binary. Preserve SSH tabs and local Git changes.

```sh
git pull --ff-only origin main
cargo build --locked --release
./target/release/securecrt-mcp upgrade
./target/release/securecrt-mcp doctor --offline
./target/release/securecrt-mcp paths
./target/release/securecrt-mcp codex-config --toolset terminal --approval-mode auto
```

Use init for first installation. Windows uses target\\release\\securecrt-mcp.exe. upgrade preserves installed policy/token and backs up the adapter; init --force is an explicit reset, not routine repair. Start the installed adapter using SecureCRT Script > Run, dismiss its dialog, then run doctor and doctor --latency. Default data home is ~/.securecrt-mcp; SECURECRT_MCP_HOME may override it with an absolute path.

Merge client configuration without replacing unrelated settings. Older enabled_tools lists may hide new tools. Existing installations retain their selected policy: explicitly choose `[policy] mode="client"` for client-owned command approval with the narrow catastrophic guard. Custom deny rules are not erased.

## Tool workflow

List sessions, inspect target, attach once, then exec repeatedly or exec_batch. Detach does not exit SSH or kill work. Each execution tool remains non-read-only and potentially destructive; an attachment never grants permanent approval. `run_command` is retained as a compatible one-off wrapper and also uses fused preparation on capable adapters.

```json
{"attachment_id":"actual handle","command":"docker ps","mode":"posix","max_bytes":16384}
```

Batch commands are all visible in the initial approval context. At most20 commands, stop/continue-on-confirmed-nonzero policy, always stop on uncertainty. Query batch_id; each result has its own command_id for output pagination. It is not an atomic remote transaction.

Use shell_open for an explicit long-running command, shell_read for incremental data, and shell_close to stop capture without remote input. Explicit interrupt sends Ctrl+C. Raw shell_write requires allow_raw_send; arbitrary input fragments cannot be safely classified as complete shell commands. Default stream capture is10minutes, bounded by max_stream_timeout_ms (default1hour); capturing does not supervise all remote processes.

Use [persistent terminal instructions](docs/persistent-terminal.md), [Claude setup](docs/clients/claude.md), [Codex setup](docs/clients/codex.en.md), and [migration](docs/migration-0.3.md).

## CLI reuse

Native MCP serve is already persistent and does not need a daemon. For repeated standalone CLI calls, explicitly start `securecrt-mcp daemon` in a separate terminal, then `session attach|exec|output --input request.json`. Existing run/sessions/screen route through a running daemon and never automatically fall back after failure. Python and PowerShell wrappers are in clients/. Use daemon --stop after all active/unresolved work is resolved. A stale endpoint can be explicitly cleaned only after a refused connection; this never clears remote/bridge state.

## Safety and native boundaries

client mode delegates routine command decisions, retaining a narrow catastrophic mistake guard and explicit custom deny patterns. Ordinary file deletion, grep text and routine service operations are not inherently rejected by that default. Legacy safe/allowlist/unrestricted profiles remain optional and are not silently overwritten. This is not a shell sandbox; wrappers, dynamic code, aliases and raw input have limits. Remote account authorization remains necessary.

shared/exclusive/observe are cooperative connector modes, not a native keyboard lock. Sampled input/cursor context does not observe every keystroke. Configured endpoint hashes are not authenticated nested SSH fingerprints; the latter is explicitly null. No automatic unknown-command retry, implicit Ctrl+C, or acknowledgement. Session/operation IDs are not durable exactly-once state across process restarts.

Native calls remain on SecureCRT's script thread. A quiet ReadString can wait one second and multiple quiet captures can queue; buffering optimizations do not create a raw-PTY event API. Long native strings are allocated by SecureCRT before Python can bound them. Retained output is bounded and loss/gaps are reported.

Historical Windows evidence: on2026-09-20, preview.1 protocol2 was exercised on Windows x64, SecureCRT9.0.0 x64 and embedded Python3.8.10, including session enumeration, read-screen, hostname and old policy rejection. This is not a validation claim for0.3 or other platforms. Final CI must pass cross-platform Rust/MCP/fault/daemon tests; actual native desktop and client approval behavior still require local acceptance.

[Architecture](docs/architecture.md) · [Protocol](docs/bridge-protocol.md) · [Security](docs/security-model.md) · [Performance](docs/performance.md) · [Testing](docs/testing.md) · [Releases](docs/releases.md) · [MIT](LICENSE)
