# Architecture: persistent terminal connector

## Ownership boundaries

MCP clients own approval. Rust owns local session/operation state, command boundaries, incremental parsing, output retention and auditing. The standard-library Python adapter owns only native SecureCRT calls and buffering/connection bookkeeping. All crt calls stay on its script thread. A future supported PTY backend can replace that boundary; a normal external Rust process cannot directly access the injected crt object.

## Runtime paths

Native MCP: client -> one long-lived `serve` process -> retained Engine -> four persistent bounded bridge lanes -> adapter -> existing authenticated Tab.

Repeated CLI: CLI or Python/PowerShell helper -> explicitly started authenticated localhost daemon -> one retained Engine -> same bridge protocol. No automatic daemon spawning, no fallback/replay after a failed call. These are separate Engine instances; do not mix their command/attachment IDs.

## State and scheduling

Session handles bind retained native Tab objects, not tab positions. Attachments retain an owner, cooperative mode, configured metadata and sampled input context. Native `prepare_and_begin` combines validation and dispatch, without an external read/token round-trip. Old single-use screen-token APIs remain available.

Registry busy/interlock keys are session-scoped. Different tabs can make progress independently. Native calls are still serialized; at most16 captures are admitted, not16 native threads. Quiet reads can add queueing and timeouts; three-tab acceptance is explicitly tested with the fake adapter, not claimed as zero-contention desktop performance.

High-level exec reuses attachments; batch keeps every command separate and visible in the initial client approval context. Local command state and output caches are bounded. The operation ledger persists within the Engine even when old output is evicted, preventing automatic replay. It is not durable exactly-once storage.

## Data plane

One in-flight request per persistent lane; request IDs and token checks per frame. Poll traffic uses three lanes; control traffic uses a separate lane. A failed exchange is dropped and never resent. New requests can use a new socket. Partial/oversized/mismatched responses are not interpreted as unsent evidence.

Native poll_bulk batches buffered delimiters up to a read/time budget and returns at most64KiB of UTF-8. Pending native bytes drain without another quiet wait. Large native strings have a bounded retained remainder, with explicit overflow beyond that bound. The incremental Rust parser no longer holds a whole arbitrary line while waiting for a completion marker.

Normal commands retain a bounded prefix; streams retain a bounded rolling tail with absolute cursors and explicit gaps. Notifications wake local waiting tool calls instead of timer-polling the registry. This is incremental pull/long-poll at the MCP boundary, not unsolicited raw PTY events.

## Failure and cleanup

sent is true/false/null according to delivery evidence. Unknown, timeout, lost reply and cancellation never trigger replay. Explicit stream close stops local capture but does not interrupt SSH. Explicit interrupt never proves all remote processes terminated. Acknowledgement requires an inspected idle context and cannot rewrite historical outcomes as success.

The daemon refuses normal shutdown with active/unresolved local jobs or batches. Native Script > Cancel and process termination may leave remote work running. Native watchdog releases capture settings and preserves unresolved state. No background installation or remote tmux changes happen.

See [performance](performance.md), [protocol](bridge-protocol.md), [security](security-model.md), and [native acceptance](testing.md).
