# Changelog

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
