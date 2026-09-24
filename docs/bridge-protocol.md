# Bridge protocol 2: capability-negotiated persistent extension

SecureCRT uses loopback TCP with UTF-8 NDJSON and a maximum frame of 262144 bytes. Xshell uses the same protocol-2 envelope through a private file IPC directory because its embedded Python runtime does not provide socket modules. SecureCRT has a bounded four-lane pool; Xshell serializes one request at a time within each process because native tab focus is process-global, while separate Xshell processes use independent lanes. Responses match request IDs. No replay follows any ambiguous write/result.

Request fields: protocol_version=2, id, token, client_id, deadline_ms, method, and params. Response fields: protocol_version, bridge_instance, id, ok, result/error, and sent evidence. TCP may add persistent=true for a retained connection. File IPC writes `<uuid>.request.json` through a temporary file and atomic rename; the Xshell script writes the matching `<uuid>.response.json` the same way. Credentials and deadlines are validated per request. A timed-out file request remains an unknown exchange and is never replayed automatically.

The protocol-2 envelope is the only supported bridge contract. A version or
transport mismatch requires upgrading the installed script and restarting it;
rewriting the file alone does not replace a script already loaded in client
memory.

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
