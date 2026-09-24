# Unified Connectors

The only public MCP namespace is `connector_*`. SecureCRT, Xshell and system
OpenSSH are selected by `backend` and expose their supported capabilities in
the returned session object. The old `securecrt_*` names are no longer
registered by the server.

For the complete backend contract and Xshell setup, see
[connector architecture](connector-architecture.md).

## Screen-backed desktop session

Use `connector_list` to inspect SecureCRT or Xshell sessions, then open an
explicit session:

```json
{
  "backend": "securecrt",
  "target": "opaque-session-id-from-connector_list",
  "mode": "exec"
}
```

The Xshell backend discovers `.xsh` names below each current session's folder,
then probes those names with `SelectTabName`. Every Xshell process registers an
isolated file-IPC instance; Rust aggregates live instances and routes
attachments back to their originating process. Its `connector_list` result
reports `enumeration: "instance_registry"`; session file contents are never
read. Both
backends return an attachment-backed `session_id` and support
`connector_exec`, `connector_exec_batch`, `connector_read_screen`,
`connector_heartbeat`, `connector_interrupt`, `connector_acknowledge`, and
`connector_close`. Neither backend is a native PTY. The unified list result
exposes discovery as `xshell_enumeration` and reports probe counts and
per-name errors in `xshell_discovery`.

## OpenSSH command session

Open an `exec` session with an OpenSSH Host alias or destination using
`connector_open`:

```json
{
  "backend": "openssh",
  "target": "php-test",
  "config_path": null,
  "mode": "exec"
}
```

The connector starts one long-lived `ssh -T` process and wraps each command in
unique begin/end markers. It does not perform a new handshake for every
command. Use `connector_exec` for one command,
`connector_exec_batch` for a sequential list, and
`connector_read` for additional UTF-8-byte pages.

`operation_id` is deduplicated within the daemon lifetime. A write or transport
failure after dispatch is `unknown`; never resubmit it automatically. Inspect
the original session and call `connector_acknowledge` only after confirming
that the shell is idle.

## OpenSSH PTY session

Use `connector_stream_open` (or `connector_open` with
`mode: "pty"`) for logs,
REPLs, pagers, editors and password prompts. The Windows implementation uses
the system OpenSSH client and the cross-platform PTY layer; Linux uses the
same OpenSSH client with a Unix PTY. Output is a bounded absolute-cursor ring
buffer. If bytes are not valid UTF-8, the response includes a lossy `text`
preview and a `base64` field.

`connector_stream_write` is raw terminal input. It is intentionally not parsed
as a shell command. The MCP does not store passwords or change the user's
OpenSSH authentication policy; the calling model/client owns approval and
credential handling. `connector_resize` updates the PTY dimensions
and `connector_interrupt` sends an explicit interrupt without claiming remote
termination.

## Authentication and host keys

The backend uses the user's OpenSSH configuration, Agent, ProxyJump and
known_hosts by default. `config_path` is an optional explicit `ssh_config`
path. The connector does not add `StrictHostKeyChecking=no`, store passwords,
or silently fall back to another backend. Select the backend explicitly.

## Limits and measurements

Command output is retained up to the configured bounded cache and returned in
pages of at most 64KiB. PTY streams retain a bounded rolling tail and report a
cursor gap when a slow reader falls behind. `connector_metrics` reports active
sessions, completed/unknown counts, retained bytes and native read counts.
Each completed or unknown command also exposes `timing.queue_wait_us`,
`timing.first_byte_us`, `timing.completion_us`, `timing.native_read_count`,
`timing.output_bytes` and `timing.throughput_bps`. Use the benchmark harness to compare
OpenSSH connector latency and throughput with a direct `ssh` command on the
same host; SecureCRT screen reads and OpenSSH PTY reads are reported as
separate backends.
