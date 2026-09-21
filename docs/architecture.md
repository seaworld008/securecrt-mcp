> **0.2.0-preview.2 update:** New installs use `client` policy (client-owned command authorization); upgrades preserve old settings. `run_command` is the preferred orchestration tool; low-level protocol-2 tools remain. See [Agent usage](agent-usage.md). Earlier preview.1 approval/default-policy examples below are historical, not a change to existing settings. Actual desktop approval behavior is not certified by CI.

# Architecture

Rust owns MCP tools, command authorization, auditing, operation deduplication, lifecycle and bounded output. The Python standard-library adapter owns SecureCRT-native object references, input-context checks, bounded capture calls, cleanup/watchdog and local IPC. No native extensions or UI key simulation are introduced.

## Data path

MCP stdio → Rust Engine → loopback protocol 2 → SecureCRT script thread → retained native Tab → existing authenticated remote connection.

A command is registered before dispatch. A failed pre-send audit rejects it. A transport failure after a dispatch attempt is unknown, never proof of nonexecution. An operation ID can return an existing job but cannot replay it; tombstones remain after output expiry within the process (bounded at 4096). Output cache limits bound memory; full caches reject new work instead of evicting running jobs.

Rust polls one bounded native capture at a time. Every native `ReadString` has a one-second timeout, allowing other requests between polls. One active capture per window avoids multiplying this delay across many tabs in the preview. Remote commands keep running independently of capture; timeout restores native screen settings without sending Ctrl+C.

## Identity and freshness

Session IDs bind retained native Tab references. Tab indexes are display metadata only and are never used to reselect a write target. The adapter periodically detects native reference errors, disconnected state or changed configured endpoint metadata. Leases expire after 120 seconds without renewal; active/unresolved references are retained for diagnosis. A read supplies a 30-second single-use screen token including visible content and cursor coordinates. Dispatch also checks an explicit expected input line.

These mechanisms are conservative mistake guards, not host authentication. A rapid unobserved reconnect, nested SSH change or spoofed prompt can evade sampled detection. Do not equate configured endpoint metadata with the current shell's host. Human target verification remains required.

## Output semantics

Snapshot is explicitly unknown. Prompt mode only attests that a literal text boundary was observed. POSIX mode runs a quoted eval envelope in the current shell and parses random markers across chunks; no subshell is silently inserted. Completion separators add newlines. TUI rendering, binary output, shell-wide redirection, exit/exec/set -e and background processes have no byte-exact/completion guarantee.

Native timeout slices can be incomplete on some SecureCRT/Python combinations; the result preserves `capture_may_be_incomplete`. Output is not an authorized instruction source. Do not silently fetch credentials, escalate privilege, retry or kill programs based on captured text.
