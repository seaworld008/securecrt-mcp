# SecureCRT MCP reliability design

Based on main `9ffccd0d`, approved user scope: policy/documentation correction, reliable execution, unified distribution.

## Boundary
Rust owns MCP, policy, audit, command lifecycle, marker parsing and bounded output storage. The standard-library Python adapter owns only native Tab references, freshness checks, bounded capture primitives and local IPC. Preserve the existing unrestricted default and explain that it is not a sandbox. Never add native extensions, implicit remote credentials, automatic interrupt or automatic command replay.

## Protocol 2
Requests have protocol_version, UUID id, deadline_ms, token, method, params. Reject expired/oversized/unauthenticated input before Screen.Send. Responses identify bridge_instance and protocol_version. A session lease is an opaque per-instance identifier bound to a retained Tab object, not an index. Leases expire; observed disconnects and changed connection metadata invalidate them. ReadScreen supplies a short-lived, single-use screen token. Sending requires a matching token and an explicit expected prompt; no remote probing is hidden in a read. A sampled native API cannot prove an undetected reconnect or nested SSH target: document this and require fresh context.

## Execution
Submit returns command_id promptly. Rust polls a bounded native capture call and stores output behind cursor pagination. Snapshot finishes as unknown, prompt completion has no exit-code guarantee, POSIX mode explicitly uses eval in the current shell with random begin/end markers. Completion must be parsed across chunk boundaries, including no-newline output. One active native capture per window in this preview; reject busy, never kill an existing process to start another. Timeout, disconnect and cancellation do not prove remote termination; retain a quarantine until explicit idle acknowledgement against fresh screen context. No retries after uncertain transport results.

## Guardrails
Audit failures before dispatch block sends; errors after dispatch surface without hiding command state. Controls and multiline input rejected before trim. Safe mode becomes a narrow finite grammar, custom rules are full-command administrative exceptions. Reject invalid timeout/size values on startup. Bound frames during reads, output buffers, command count and retention. Release all capture state on timeout/adapter exit.

## Delivery
Version 0.2.0-preview.1. Init/upgrade embed the exact adapter version, preserve policy/token and back up replaced script. Doctor reports actual bridge Python/platform/API capabilities and protocol compatibility; offline checks never pretend to validate SecureCRT. Add Codex prompt configuration and a human rejection checklist, not an invented approval attestation. Lock dependencies; CI covers Rust on three OSs, Python unit tests and a live stdio/fake-bridge smoke test. Release workflow gates platform artifacts and checksums on validation. No public release tag until real desktop testing.
