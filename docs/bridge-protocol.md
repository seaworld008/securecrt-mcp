# Bridge protocol 2: capability-negotiated persistent extension

Transport is loopback TCP, UTF-8 NDJSON, maximum frame262144 bytes. One in-flight exchange per connection lane; a Rust client uses a bounded four-lane pool, not arbitrary request multiplexing. Responses match request IDs. No replay after any ambiguous write/result.

Request fields: protocol_version=2, id, token, client_id, deadline_ms, method, params and optional keep_alive=true. Response fields: protocol_version, bridge_instance, id, ok, result/error, sent evidence, and persistent=true when the socket remains available for the next sequential exchange. Credentials and deadlines are validated per frame. Multiple pipelined frames are rejected. Fragmented frames are supported within frame/time limits. Idle connections expire; a new request may reconnect, not resubmit the failed exchange.

Legacy clients omit keep_alive and receive a one-shot response. Legacy adapters do not advertise new capabilities, so compatible run_command uses its old path. New attachment interfaces require upgraded runtime capabilities. Version mismatch diagnostics should always include restarting the installed script, not just rewriting its file.

Original methods remain: ping, list_sessions, read_screen, focus_session, begin, poll, end, interrupt, acknowledge_idle, send_text.

Additions:

| Method | Contract |
|---|---|
| attach | Retain session owner/mode/input context; no command input; real SSH host-key fingerprint is unavailable |
| heartbeat | Renew attachment lease, report sampled context change and unresolved status |
| detach | Release local binding only |
| prepare_and_begin | Atomically prepare/validate and send once; accepts a session or attachment |
| poll_bulk | Batch up to128 buffered native reads by default, bounded64KiB response chunks and explicit pending bytes |
| stream_write | Explicit opt-in input to the owner's active capture |

ping advertises persistent_ndjson, poll_bulk, attachments, prepare_and_begin and per_session_capture, plus native-read/connection metrics. Native calls are still single-threaded; capabilities do not claim keyboard interception or raw PTY events.

Captures and unresolved states are keyed by session/capture identity, not globally. Owner checks protect active capture operations; explicit recovery after an owner exits still requires fresh inspected screen context. The native script cannot prove the current nested SSH host or all manual keystrokes.

Run results distinguish sent=false (known pre-send rejection), true (delivery evidence) and null (unknown). End/interrupt/close never claim all remote processes terminated. Retention gaps and output truncation are separate from command exit status.
