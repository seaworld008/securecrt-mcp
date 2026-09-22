# Changelog

## [0.3.0-preview.2] - 2026-09-22

- Fix confirmed-command prompt repaint races with bounded 500ms/two-sample readiness before the next attachment send. Preserve original prompt/input column/width while rebasing owned scroll rows.
- Require capture-specific confirmed POSIX marker evidence; recheck deadlines/session leases during read-only waits. Keep half-input, changed prompts, unknown outcomes and unresolved work fail-closed without replay.
- Preserve `context_changed` as an actionable Rust error code without changing delivery evidence or client permissions.
- Add deterministic redraw regression tests and compiled MCP/adapter batch, per-command audit, two-tab and timeout/no-replay coverage to CI and release gates.
- Keep protocol 2 and all existing interfaces/policy settings; upgrade and restart the embedded adapter together. Native desktop validation remains required.

## [0.3.0-preview.1] - 2026-09-21

- Persistent bounded Bridge connection pool, atomic prepare-and-begin, batched buffered native reads and notification-driven waits.
- Per-session capture/interlocks, attach/exec/batch, cooperative ownership and incremental streams with explicit gaps.
- Incremental long-line parser, native overflow draining and delivery evidence; no unknown replay or implicit interrupt.
- Optional authenticated foreground daemon, CLI/Python/PowerShell state reuse and explicit shutdown/stale-endpoint cleanup.
- Narrow catastrophic guard with quoted-search/ordinary CRUD regression tests; client permissions and custom deny rules preserved.
- Stream-specific timeout budget; terminal tool preset; doctor --latency; comparative benchmark with explicit synthetic scope.
- Native transport fragmentation/lost-send, three-tab, long-output, stream and daemon regression tests.

## 0.2.0-preview.2 — 2026-09-21

- Add agent-first run_command with internal fresh context, one submission, bounded wait/output, explicit capture mode and stable operation identity.
- Add delivery evidence and actionable structured errors; proven pre-send rejections no longer become unresolved jobs. Malformed success/lost responses remain uncertain.
- Add client policy for new installs; preserve existing configuration and optional legacy guardrails/custom rules. Add effective-policy diagnostics.
- Renew actively used native leases, return a fresh screen after explicit acknowledgement and reflect acknowledgement in job status.
- Evict old completed output while retaining replay-prevention tombstones; preserve partial output on timeout.
- Drain already-sent work for up to two seconds on graceful MCP EOF, without new input or implicit recovery. Hard-kill/restart recovery is still manual.
- Add Rust JSON CLI plus Python/PowerShell wrappers and configurable additive Codex tool presets.
- Preserve historical preview.1 Windows acceptance; new desktop behavior still requires local verification. No release tag created by this change.


## 0.2.0-preview.1 — 2026-09-20

### Breaking preview changes
- Bridge protocol 2; upgrade and restart the embedded adapter together with the Rust binary.
- Opaque session leases replace mutable tab indexes/captions for operations.
- Execute requires a fresh screen token, explicit input context and operation ID; returns an asynchronous command ID.
- Interrupt targets a tracked command; uncertain outcomes require explicit idle acknowledgement.
- Custom allow rules match the full command. Safe mode is a narrow finite grammar, not command-prefix matching.

### Added
- Rust execution lifecycle, POSIX marker parsing, prompt/snapshot modes, bounded UTF-8 output pagination.
- Bounded native capture calls; explicit interruption, watchdog and no automatic remote replay.
- Fail-closed pre-dispatch audit and visible post-dispatch audit warnings.
- Expiring bounded wire requests, protocol identity and parameter validation.
- Safe adapter upgrade/backups, offline/online doctor and additive Codex approval configuration generation.
- Native-adapter regression tests, real MCP stdio/fake-bridge smoke tests, locked CI and gated checksum release workflow.

### Retained guarantees and limitations
- Preserve 0.1.2 unrestricted default and existing user policy/token during normal upgrades.
- No native Python extensions, new SSH connections, automatic client-approval claims or automatic server-target discovery.
- Preview still requires actual SecureCRT and client rejection tests. A sampled API cannot detect every reconnect.

## 0.1.2 — 2026-09-20
- Default policy changed to unrestricted with a small convenience hard-deny set; approval belongs to the client and remote authorization.

## 0.1.1 — 2026-09-20
- Chinese-first guides and recorded Windows first-run / two SSH-session validation.
- SecureCRT 9.0 script header compatibility fix.

## 0.1.0 — 2026-09-20
- Initial Rust stdio MCP server, in-process Python adapter, policy, audit and cross-platform CI.
