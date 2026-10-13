> 当前安装与平台入口见[一键安装](installation.md)。Windows 仅使用 `.js`；Mac 仅保留 `securecrt_bridge.py` 原生层，工具均为 JS/Rust。

# Bridge protocol 2: capability-negotiated persistent extension

Mac SecureCRT uses loopback TCP with UTF-8 NDJSON and a maximum frame of 262144 bytes. Windows SecureCRT and Xshell use the same protocol-2 envelope through authenticated private file IPC from system JScript; Windows Python adapters are removed. SecureCRT has a bounded four-lane pool; Xshell serializes one request at a time within each process because native tab focus is process-global, while separate Xshell processes use independent lanes. Responses match request IDs. No replay follows any ambiguous write/result.

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
| restore_prompt | Windows capability only: explicit confirmed idle, fresh full-frame token, original expected prompt, owned completion, blank column-1 line; one Enter with a failure interlock, never replay or interrupt |

ping advertises persistent_ndjson, poll_bulk, attachments, prepare_and_begin and per_session_capture, plus native-read/connection metrics. Native calls are still single-threaded; capabilities do not claim keyboard interception or raw PTY events.

Captures and unresolved states are keyed by session/capture identity, not globally. Owner checks protect active capture operations; explicit recovery after an owner exits still requires fresh inspected screen context. The native script cannot prove the current nested SSH host or all manual keystrokes.

Run results distinguish sent=false (known pre-send rejection), true (delivery evidence) and null (unknown). End/interrupt/close never claim all remote processes terminated. Retention gaps and output truncation are separate from command exit status.

Windows SecureCRT drains newline-delimited records in bounded batches. Native
ReadString timeout returns empty after consuming unmatched input, so timeouts
disclose possible body loss. Completion and timeout are separate: a fully parsed
owned completion marker can establish exit even if its poll crossed the deadline.
Post-completion prompt pumping uses a receive-only millisecond WaitForString
when verified by a bounded unit probe; legacy engines retain the one-second
fallback. It does not send a shell probe. Capability/source identity must be
checked after bridge reload; no protocol-version change is implied.

Windows SecureCRT and Xshell support an explicit `prefer_native_log=true` opt-in on
POSIX prepare/begin. The native adapter starts a unique log only when user
logging is off; unsupported/pre-send failures can fall back after verified
rollback. `poll` reports `capture_log_file`, `native_log_stopped` and
`capture_transport=native_raw_log` (SecureCRT) or `native_session_log` (Xshell). Rust accepts only the current job UUID under
its authenticated file-IPC instance, rejects links/reparse points, holds a shared
read handle, decodes UTF-8 (or BOM-tagged UTF-16 for Xshell) incrementally and requires the exact owned markers.
The file has a 16 MiB bound. `end` closes/flushed the logger and restores runtime
settings. `capture_log_reader=true` leaves the file for Rust's final drain and
cleanup; watchdog/native-only cleanup removes its own file directly. This log
includes command echo on local disk; it is opt-in and does not save configuration
or read/change existing user logging. A hard host/process stop can leave a file
or logging state. Millisecond waits on the fast path pump only the owner's raw
capture or verified completed transition; idle tabs and ReadString captures
retain the original receive boundary. Xshell logs use a `.capture.log` suffix to
avoid native extension rewriting and accept only exact escaped/unescaped forms
of the owned path. Its native log formatting and terminal encoding are preserved.
