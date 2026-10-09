> 当前安装与平台入口见[一键安装](docs/installation.md)。Windows 仅使用 `.js`；Mac 仅保留 `securecrt_bridge.py` 原生层，工具均为 JS/Rust。

# Changelog

## Unreleased — 2026-10-09

- Keep only the minimum macOS SecureCRT Python native layer; remove Windows Python/Xshell adapters and migrate build, package, client, desktop acceptance and regression controllers to JS/Rust. Windows installed users need no Python, Node, pywin32 or Rust.
- Add one-click `install.cmd` / `install.command` and Rust `install`: user-scoped binary, platform entries and additive Codex settings; preserve tokens, policy, existing approvals, comments and SSH logins.
- Repair Mac native initial Tab binding, Get2 consistent input/screen snapshots and complete prompt-prefix draining, retaining prompt spaces but excluding Get2's synthetic row newline. No probe sends or weakened input guards.
- Prevent a late capture runner from restoring uncertainty after an explicitly acknowledged cancelled command.
- Record complete Mac native acceptance on two Tabs: legacy/modern, twenty-command reuse, 2,500 ordered UTF-8 rows within the original 10-second budget, demonstrably overlapping Tab isolation, cancellation/reload and dedicated disconnect/reconnect. Keep sanitized prior FAIL stages.
- Remove additional Python version ceilings/floors from loaded-engine diagnostics; the terminal's actual loader/API requirements still apply. Refresh all current setup, client, test and support guidance; historical receipts remain immutable.


## Unreleased

- Add self-contained Windows JScript entries for Xshell and SecureCRT, with embedded Rust executable, authenticated file IPC, native source identity and visible startup status; Python and pywin32 are not runtime requirements for these entries.
- Preserve native Xshell transport on upgrade and refresh fixed native script entries without adding trial backup management.
- Share desktop acceptance across Xshell and SecureCRT, measure twenty-command reuse and 2,500-line UTF-8 capture, and document separate Mac acceptance requirements.
- Run an opt-in parallel acceptance matrix across every selected idle Tab, including protocol compatibility, concurrent isolation and explicit recovery, with machine-readable and Markdown receipts.
- Keep file IPC bound to its original terminal instance across readiness publication gaps, retry transient Windows read sharing conflicts, and tolerate disappearing response files without replaying commands.
- Pump Xshell synchronous output through a bounded native wait, and keep capability checks from accidentally invoking COM methods.
- Start SecureCRT from the actual JScript body, drain POSIX output in bulk through its unique result marker, and retain the real exit-code suffix across partial reads.
- Hold a native exclusive file lease for SecureCRT so duplicate starts stay safe and cancelling the script releases ownership even when the host skips script cleanup.
- Record passing Windows acceptance for two SecureCRT and two Xshell Tabs, plus native duplicate-start, cancellation/restart and disconnect/reconnect checks; ship the reusable lifecycle probe and a separate Mac test prompt.

- Resolve Xshell's script folder through either its native Python getter or
  its Active Scripting string property, avoiding a startup TypeError.

## [0.5.3] - 2026-10-09

- Make Simplified Chinese the primary README and documentation entry while retaining complete English alternatives.
- Add Agent installation prompts, documentation maps, cross-Agent repository guidance, and maintenance/release boundaries.
- Clarify current-main installation, Codex/Claude configuration, release provenance, and evidence limits.
- Harden bilingual documentation, package membership, archive links, and CRLF-compatible validation.

## [0.5.2] - 2026-10-08

- Reject the unchanged pre-send prompt as completion until capture observes output progress.
- Include JSON desktop acceptance receipts in every release archive.
- Verify relative Markdown links against actual archive members during packaging.
- Carries the Windows Xshell reliability fixes and live acceptance from 0.5.1;
  its tag build was cancelled before publication after the missing receipt was detected.

## [0.5.1] - 2026-10-08

- Refresh only the requesting client’s attachment from the validated idle screen after explicit recovery; preserve other clients’ input boundaries.

- Reject native writes on the reproduced unsafe Xshell embedded Python combination, provide the vendor external Python recovery path, and expose binding safety to doctor.
- Preserve Unicode POSIX command bytes through the observed ANSI input binding; use the Xshell Main script entry point.


- Fix Xshell success cleanup, explicit interrupt/recovery, attachment context and pre-send delivery evidence.
- Capture only newly completed Xshell buffer rows, with bounded viewport reads and explicit buffer-loss detection; never include pre-existing history in command results.
- Read the actual Xshell host product version without ctypes, which is absent from the observed embedded Python.
- Restore native capture state on script shutdown and add production-adapter MCP regressions.
- Preserve SHA-256 operation fingerprints with sha2 0.11.
- Fix Xshell result/status/interrupt routing and explicit recovery validation.
- Bound OpenSSH capture/caches and preserve timeout/cancellation interlocks.
- Add MCP 2026-07-28 discovery/per-request metadata alongside the 2025-11-25
  initialize flow, with separate protocol conformance suites.
- Add backend capabilities, running-script digest and support-tier diagnostics,
  support evidence documents and opt-in live acceptance scripts.
- MSRV remains **Rust 1.88**. Future increases occur only in minor releases with
  explicit CHANGELOG notes; precompiled users are unaffected.

## [0.5.0] - 2026-09-23

- Make `connector_*` the only public MCP namespace and select SecureCRT, Xshell,
  or system OpenSSH through the backend field.
- Add the Xshell Script Bridge with authenticated loopback transport, named
  session-file discovery, multi-tab probing, and automatic installation into
  Xshell's standard Scripts directory during `init` and `upgrade`.
- Keep SecureCRT compatibility during development while removing the old
  `securecrt_*` MCP surface from the final API.
- Reject stale or explicitly mismatched terminal prompts before any native input
  is sent, with regression coverage for both desktop bridges.
- Add unified connector, Xshell discovery, deployment, and user setup guidance.
- Harden Xshell startup and cancellation with an external one-shot notice, per-process lifecycle logs, and a short host-owned wait that keeps Script > Cancel responsive without crashing XshellCore.

## [0.4.1] - 2026-09-22

- Keep the SecureCRT Bridge listener available when SecureCRT has no active or connected tabs.
- Treat unavailable tab-bound dialog and sleep APIs as non-fatal during startup; sessions remain an empty live view until a tab connects.
- Add a zero-tab startup regression test and clarify the no-session lifecycle in the Chinese and English operational documentation.

## [0.4.0] - 2026-09-22

- Add an opt-in unified `connector_*` API with persistent OpenSSH command sessions and native PTY sessions while preserving every existing `securecrt_*` tool.
- Add long-lived `ssh -T` and `ssh -tt` transports, cursor-paginated bounded output, PTY resize/write/interrupt/close, explicit unknown/no-replay handling and operation-id deduplication.
- Add connector timing and throughput metrics, binary-safe output previews, bounded stderr draining and short SecureCRT probe budgets when the Bridge is unavailable.
- Improve SecureCRT bulk capture with an adaptive native drain window while preserving prompt/context safety and no automatic input or replay.
- Add unified connector documentation, Codex tool configuration, OpenSSH/PTY smoke coverage and real SecureCRT read-only acceptance including MySQL metadata and multi-page large-log handling.
- Credentials remain outside MCP configuration; OpenSSH uses the caller's ssh_config, Agent, ProxyJump and known_hosts. OpenSSH remote performance acceptance remains environment-specific and is opt-in.

## [0.3.0] - 2026-09-22

- Promote the persistent SecureCRT session workflow from preview to a stable production release after cross-platform CI and real SecureCRT desktop acceptance.
- Add a friendly Chinese startup dialog and a clear already-running response when the Bridge port is already occupied by the active SecureCRT script.
- Validate repeated commands, three-command batches across three SSH tabs, long-output pagination, observe-mode refusal, bounded prompt readiness, and no-replay failure handling.
- Document production installation, upgrade, client approval, target confirmation, interactive-shell boundaries, and the SecureCRT script lifecycle.

## [0.3.0-preview.3] - 2026-09-22

- Extend confirmed-completion prompt readiness once, up to 1.5 seconds, only while SecureCRT remains in a safe repaint transition. Normal ready prompts keep the short sampling path; typed input, changed prompts and unknown contexts remain rejected without sending.
- Add regression coverage for slow real-tab redraws and expose readiness-extension metrics for desktop diagnosis.

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
- Optional authenticated foreground daemon, CLI/JS/PowerShell state reuse and explicit shutdown/stale-endpoint cleanup.
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
- Add Rust JSON CLI plus JS/PowerShell wrappers and configurable additive Codex tool presets.
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
