# Performance methodology and native limits

## Root causes verified in preview.2

The previous implementation opened a TCP connection for each bridge RPC, read one native delimiter per poll, slept 5ms after each poll, and serialized all captures with one window-global interlock. Its short-command helper still created a fresh Engine for each standalone CLI process. A parser waited for an entire line and quarantined output exceeding 64 KiB. These were connector costs, not evidence of slow SSH networks.

The 0.3 path keeps four independently serialized NDJSON lanes (a bounded pool, not arbitrary multiplexing), uses TCP_NODELAY, combines preparation/begin, batches up to128 buffered native reads per RPC within a time budget, and yields without a fixed delay when data arrives. Awaiters use notifications. Per-session state permits independent tabs. Long native strings are drained in UTF-8 chunks; continuous streams use a bounded tail with explicit gap metadata.

An error after a write is never retried. An idle closed/dirty socket may be discarded before a **new** exchange. Request IDs, token checks, bounded frames and deadlines remain. Pipelining multiple requests on one lane is not supported; separate lanes prevent a pending poll from owning the control lane.

## Reproducible comparison

[Baseline raw report](benchmarks/baseline.json) and [persistent raw report](benchmarks/persistent.json) were produced in the same GitHub Actions job, comparing immutable main `9e94b4c4acaeb5a0c9cf4f6d14d2597b24e06214` with the performance implementation. Both use a real compiled Rust binary, actual TCP framing and the actual Python adapter code. Only the native SecureCRT screen is simulated with already-buffered deterministic output.

| Workload | preview.2 baseline | persistent implementation |
|---|---:|---:|
| 20 short commands, total | 1160.12 ms | 180.07 ms |
| short command median | 57.93 ms | 8.63 ms |
| 1600 lines / 204801 bytes, local completion observation | 12069.76 ms | 56.44 ms |
| poll RPCs for that buffered multiline output | one delimiter per RPC in old implementation | 13 |
| 210000-byte single line | unknown after native overflow | completed, complete Unicode output verified |
| persistent workload transport | new TCP per exchange | 4 connections opened, 182 exchanges reused |

**These are synthetic connector results, NOT real SSH throughput, not guarantees, and not model-visible end-to-end latency.** The multiline completion measurement includes a50ms test status sampling interval and excludes fetching all output pages. Short timings include MCP/adapter work but no real terminal rendering, encryption, VPN, bastion, remote process scheduling, human approval or LLM reasoning. Do not market the ratio as an equivalent speedup of all SSH operations. Raw JSON retains all samples and scope labels.

Test source: [performance_smoke.py](../tests/performance_smoke.py). Re-run:

```sh
cargo build --locked
python tests/performance_smoke.py target/debug/securecrt-mcp --output performance.json
```

Use the `.exe` suffix on Windows. No SSH target is contacted. Additional transport, stream and daemon tests exercise fragmented persistent frames, lost-after-send uncertainty, explicit cancellation, multi-tab execution, cache gaps and reusable CLI processes.

## Measure your actual installation

```powershell
.\target\release\securecrt-mcp.exe doctor --latency
```

This sends20 read-only bridge pings and reports p50/p95/min/max, opened/reused connections, RPC counts and accumulated timings, native reads and bytes. It does not run commands on your servers. For actual command latency inspect `timing.elapsed_us`, `timing.first_output_us`, `timing.poll_calls`, plus the bridge runtime metrics. Client approval/LLM latency is not measured by the connector.

Native acceptance should include20 short commands; three tabs;100KB multiline and Unicode/no-newline output; a10-minute capture; manual input; script restart; interrupted and lost-result operations. Record OS, SecureCRT/Python versions, client, commit, remote command, local timing and end-to-end wall clock separately.

## Boundaries that optimizations cannot hide

SecureCRT's documented synchronous scripting API holds input in a pre-display buffer and exposes it through WaitFor/ReadString calls. The connector does not own its PTY or receive a verified portable raw-byte/keyboard event subscription. `ReadString(...,1)` returns early on a match but may wait up to1 second when quiet. Batching removes delimiter-level RPC overhead, not that native timeout. Native calls remain on the script thread; several quiet sessions may add queueing time. Python receives the native string before it can enforce a chunk bound; retained overflow is bounded to16MiB with explicit loss, not an OS-level allocation guarantee.

Default stream capture retains a rolling bounded tail rather than blocking SecureCRT indefinitely when the consumer stops reading. A slow consumer gets a gap, not fabricated full logs. Real push PTY events and OS-enforced keyboard ownership would require a different supported backend; they are not claimed here.

## Practices evaluated

- [tmux control mode](https://github.com/tmux/tmux/wiki/Control-Mode): stable pane identity, command/output boundaries and output flow-control. We adopt those design principles, not its command syntax. No automatic tmux installation or mutation of the remote environment.
- [ssh-session-mcp](https://github.com/zw-awa/ssh-session-mcp): persistent PTY/session state and incremental cursor-based interaction. That project owns the PTY; its input interception cannot simply be asserted for SecureCRT.
- [Tabby MCP](https://github.com/thuanpham582002/tabby-mcp-server): command boundaries and stored output. We do not copy automatic interrupt/replay behavior.
- [Warp SSH](https://docs.warp.dev/terminal/warpify/ssh): illustrates why a PTY/tmux integration can be more asynchronous. A new SSH/tmux backend would change deployment requirements; this project keeps existing SCRT authentication.
- [VanDyke scripting FAQ](https://www.vandyke.com/support/securecrt/scripting_faq.html): authoritative native buffering and readiness constraints.


## Audit durability / 审计持久化时机

`audit.durability = "os_buffered"` is the default for configurations omitting this new field. The append handle is reused and each write is flushed to the operating system before dispatch; write/open failures still reject before sending. It does **not** fsync every event and may lose recent audit records on OS crash/power loss. Choose `"each_event"` to restore synchronous event durability, accepting local disk latency. This is a durability/performance choice, not a change to client permissions. Configure it explicitly when upgrading under an existing audit-compliance requirement. Log rotation that replaces the file requires restarting the MCP/daemon to reopen the handle; copy-truncate retains the handle but has the usual rotation races.

默认省略新字段时使用操作系统缓冲，减少每次审计打开文件和同步刷盘的开销；这不保证断电时最近审计记录仍在磁盘。要求逐事件落盘时显式设置 `durability = "each_event"`。命令结果的 `timing.audit_dispatch_us` 用于区分审计开销和 Bridge/远端耗时。

After an owned completion marker, the attachment waits briefly for the original prompt/input column rather than adopting a marker line as a new prompt. A changed prompt (including `cd` that changes prompt text), partially typed command, or uncertain input context requires explicit inspection/re-attachment; it is not silently trusted.

## 0.3.0-preview.2: completion is not input readiness

The native regression was a race between the owned completion marker and subsequent screen rendering, not a new SSH connection or a slow TCP pool. The previous guard accepted one matching sample immediately; a prompt with an unrestored cursor instead hit the unexpected-text branch and was rejected without waiting. Captured row movement and redraws after that first match made consecutive commands/batches fragile. The old doubles mostly kept a fully stable prompt visible and did not reproduce the intermediate cursor states.

The fix remains in the adapter's attachment guard/end lifecycle: require the original capture's confirmed POSIX marker, allow at most 500ms of read-only repaint readiness (also capped by the request deadline), and require two matching prompt/input-column/terminal-width samples separated by approximately 10ms. Only connector-owned post-completion scrolling permits rebasing the row; the low-level screen-token/digest path is unchanged. Blank lines, that capture's exact marker and a cursor still inside the original prompt can settle; unexpected input, other markers, changed prompts/width or a cursor past the original input boundary are rejected. Missing completion evidence and unresolved work never enter this recovery path. No automatic send, retry, interrupt, reconnect or permission change is involved.

A normally ready prompt adds roughly one sample interval, **not** a fixed 500ms sleep. The native script thread remains serialized, and native calls/OS scheduling can add delay outside the deliberate wait budget. An exhausted readiness budget rejects the pending command as unsent rather than misreporting it as a running-command timeout. `context_changed` now remains a specific Rust error code with an actionable original-terminal recovery message.

Regression entrypoints:

```sh
python -m pytest -q tests
python tests/prompt_readiness_smoke.py target-latest-test/release/securecrt-mcp
```

Use `.exe` on Windows. The smoke test drives the actual compiled Rust MCP, TCP framing and adapter against deterministic fake CRT redraws; it verifies sequential reuse, a three-command batch with independent output/exit/audit, uncertain-context batch stopping even with `continue`, two-tab isolation and timeout/no replay. Unit cases include delayed/blank/marker/premature single samples, partial manual input, changed width/prompt, deadline and lease expiry. No business host is contacted. These tests are functional race regressions, **not real SecureCRT latency measurements or native PTY certification**. The older benchmark JSON files above remain unchanged and are not relabelled as this release's performance.
