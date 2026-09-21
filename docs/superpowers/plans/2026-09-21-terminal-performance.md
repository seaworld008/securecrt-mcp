# Persistent terminal performance implementation plan

Goal: reuse already authenticated SecureCRT tabs with client-owned approval and measurable connector overhead. Preserve existing user configuration, no remote SSH credentials, no automatic replay or interrupt.

Baseline: 9e94b4c4acaeb5a0c9cf4f6d14d2597b24e06214 (0.2.0-preview.2).

## Evidence and architecture

The baseline makes one TCP connection per RPC, consumes one native newline per poll, sleeps 5 ms per poll and uses a window-global capture interlock. Single-use CLI creates a new Engine. One-call MCP already exists; another wrapper alone is not a solution.

Implement persistent bounded NDJSON transport with a small independently serialized lane pool and request IDs. Never resend a failed exchange. New requests may establish a fresh connection. Native API calls remain on the SecureCRT script thread. Batch buffered native reads in one RPC and stop on an explicit completion boundary rather than doing a network round trip per line. Remove deliberate sleeps when progress is available; preserve bounded quiet waits where SecureCRT exposes only second-based ReadString. Do not claim nonblocking native events or true keyboard interception without a supported API.

Use per-session captures and unresolved interlocks, attachment handles, atomic prepare-and-begin, sequential batches with per-command results and explicit stop/continue policy, and long-running incremental stream operations. Shared/exclusive ownership describes connector cooperation, not an OS-level keyboard lock. Report configured-endpoint fingerprints separately from an unavailable authenticated nested SSH identity.

## Tasks

- [ ] Reproduce missing batched reads, multi-tab capture, attachment reuse and long-line handling with native regression tests.
- [ ] Implement bounded persistent transport, per-session adapter state, native batching and attachment context binding; retain legacy tools.
- [ ] Refactor Rust registry into per-session ownership, notification-driven waits, bounded incremental parsing and execution metrics.
- [ ] Add attachment exec/batch and stream interfaces without command replay or hidden recovery. Preserve command approvals at the MCP call boundary.
- [ ] Add critical-only default command guard and explicit custom filters; retain legacy modes and validate common CRUD/grep commands offline.
- [ ] Provide persistent daemon routing for standalone CLI use, reusable client sessions, latency diagnostics and performance regression harness.
- [ ] Run strict locked Rust and Python tests, transport fragmentation/reconnect/no-replay tests, 20 commands/three tabs/100KB and long-line tests, docs/package checks.
- [ ] Review final branch, open PR, merge only after final three-platform CI succeeds; distinguish mocks from native acceptance.

## Acceptance limits

Native SecureCRT has no verified portable raw-PTY data/keyboard event API in the sources reviewed. A one-second ReadString timeout is a maximum quiet wait, not proof each call always costs one second. Local synthetic timings exclude VPN, SSH, SecureCRT desktop scheduling, LLM and approval latency. Report all limits rather than claim identical direct-SSH timing.
