# Connector architecture

The MCP server exposes one public tool namespace: `connector_*`. The backend
is selected in `connector_open` and is reported on every session. Backend names
are routing data, not separate user interfaces.

## Layers

```text
MCP client and approval
        |
        v
connector facade
  session IDs, capabilities, operation IDs, output cursors, audit
        |
backend adapters
  SecureCRT bridge | Xshell bridge | system OpenSSH | future adapters
        |
authenticated desktop tab, local ssh process, or PTY
```

The facade owns the contracts that must remain identical across clients:

- opaque backend-bound session IDs;
- explicit backend selection and capability checks;
- one approval per mutating tool call;
- stable `operation_id` deduplication and deterministic batch child IDs;
- `sent: false`, `sent: true`, and `sent: null` delivery evidence;
- unknown outcomes stop and are never replayed;
- bounded output, absolute cursors, and explicit truncation or gap state;
- explicit interrupt and idle acknowledgement with no automatic Ctrl+C.

The adapter owns only transport-specific work. It must not add a second login,
store passwords, infer the nested SSH host from a configured profile, or turn a
screen reader into a native PTY claim.

## Public operations

| Operation | SecureCRT | Xshell | OpenSSH exec | OpenSSH PTY |
| --- | --- | --- | --- | --- |
| `connector_list` | yes | `.xsh` names under current session folder; single-process probing | active local sessions | active local sessions |
| `connector_open` | attach existing tab | attach/select named tab | persistent `ssh -T` | persistent `ssh -tt` |
| `connector_exec` | yes | yes | yes | no |
| `connector_exec_batch` | yes | yes | yes | no |
| `connector_read_screen` | yes | yes | no | use stream read |
| `connector_stream_*` | capability denied | capability denied | capability denied | yes |
| `connector_interrupt` | command ID | command ID | session ID or command ID | session ID |
| `connector_acknowledge` | fresh screen token | fresh screen token | confirmed idle session | session state |
| `connector_close` | release attachment | release attachment | close process | close process |

The MCP schema contains `connector_read_screen` and `connector_heartbeat` so
screen-backed adapters do not need a private prefix. Capability errors are
returned explicitly when an operation is not valid for a backend.

## Session identity

Session handles are opaque and never use a tab index. The current format is
`<backend>/<backend-owned-id>`, for example `securecrt/<attachment>` or
`xshell/<attachment>`. Batch handles use the same namespace, such as
`securecrt/<batch>` or `xshell/<batch>`, so status lookup cannot cross
backends. Clients must persist returned handles only for the current MCP
process and call `connector_list` again after a bridge restart.

`configured_endpoint`, `RemoteAddress`, or a saved session name is metadata for
operator confirmation. None of them proves the identity of a nested SSH host.

## Adapter rules

SecureCRT reuses the logged-in tab through the protocol-2 in-process bridge. It
has screen context, per-session captures, attachments, interruption and idle
acknowledgement, but no native PTY.

Xshell uses `bridge/xshell_bridge.py`, run from Xshell's Script menu. Xshell's
script API exposes `SessionName`, `TabText`, `Path`, `RemoteAddress`,
`Screen.Get`, `Screen.Send`, `WaitForStrings`, and `SelectTabName`.
Each Xshell process registers an isolated file-IPC instance. Rust aggregates
live instances and routes attachments back to their originating process. The
adapter uses the current session file's folder as a name index, reads only
`.xsh` filenames, probes each name with `SelectTabName`, and restores the
original tab. This is reported as `enumeration: "instance_registry"`; unlisted
unsaved tabs still require an explicit known session name.

The embedded Python environment does not provide socket modules, so this
adapter uses the private authenticated file IPC directory created by `init`.
Requests and responses use unique IDs and atomic file replacement. Xshell
processes one request at a time because tab selection and native screen focus
are process-global. Separate Xshell processes use independent lanes and remain
concurrently usable with SecureCRT and OpenSSH.

System OpenSSH uses the user's `ssh_config`, Agent, ProxyJump and known_hosts.
It is the backend for native PTY, resize, raw input, REPL and pager workflows.
The MCP server does not add `StrictHostKeyChecking=no`, capture passwords, or
silently fall back to a desktop client.

## Xshell rollout

1. Run `securecrt-mcp.exe init` once. This creates the private bridge files and
   installs `securecrt-mcp-xshell.py` into Xshell's standard `Scripts` folder.
   The separate file-IPC token and directory remain in the MCP private directory.
2. Run `securecrt-mcp-xshell.py` from Xshell's Script menu in every Xshell
   process that should be controlled. Single-process mode is optional.
3. Call `connector_list` and verify the returned `backend`, `session_name`,
   `remote_address`, `enumeration`, and `capabilities` before opening it.
4. Use the returned `xshell/<attachment>` handle for `connector_exec` or
   `connector_exec_batch`; use `connector_read_screen` before an explicit
   acknowledgement.

The first live acceptance uses harmless `hostname`, `pwd`, and a fixed probe
string on each test tab. It must verify output, exit state, no duplicate send
after the same `operation_id`, and a rejected stale-screen acknowledgement.

The Xshell bridge writes one bounded JSONL lifecycle log per running script to
`%USERPROFILE%\.securecrt-mcp\xshell-ipc\logs`. Entries include startup,
detached notice creation, request method and result, host-yield failures,
cancel, and final cleanup; tokens and terminal contents are never logged. The
development regression suite also runs two fake Xshell instances concurrently
and verifies that both stop cleanly:

The idle loop uses Xshell's `Session.Sleep(1)` host wait. The one-millisecond
wait returns control to Xshell's message pump frequently enough for multiple
bridge instances while keeping **Tools -> Script -> Cancel** responsive. On
cancellation, Xshell may return an unstructured `NoneType`/`TypeError` from that
COM call; the bridge records the host-wait failure, treats it as a normal stop,
and removes the IPC registration. A normal Python `time.sleep` must not be used
for the Xshell production path because it can leave XshellCore waiting on the
embedded script and produce a Windows `AppHangXProcB1` report. The bridge does
not change `Screen.Synchronous` for its entire lifetime because that property
can also raise an unstructured host `SystemError` during cancellation. Command
execution manages synchronization only around its own `Screen.Send` operation.
`Screen.WaitForStrings` remains a diagnostic capability check; it is not used
as the idle loop because this Xshell build exposes it without a timeout
argument. Startup notices run in one foreground `wscript.exe` process and use a
temporary lock so repeated launches cannot stack duplicate dialogs. The popup
has a finite timeout as a crash safety net, and the bridge keeps the process
handle for its own popup so it can close it silently during normal cleanup. The
notice marker is scoped to the Xshell process ID, so a second script in the same
Xshell process is suppressed while a new Xshell process gets a fresh startup
notice.

If a lifecycle log contains `host_wait_failed` with a `NoneType` or `TypeError`
message, that is the expected cancellation signature on the affected Xshell
build, not a bridge request failure. If it appears during startup without a
script cancellation, stop the script and inspect the Xshell application log.

```powershell
python -m pytest -q tests/test_xshell_bridge.py
```

## Future adapters

PuTTY, MobaXterm, terminal servers, and other clients implement the same
adapter contract. Each new adapter must first pass the contract tests with a
fake native runtime, then a desktop acceptance matrix covering discovery,
selection, prompt changes, disconnects, unknown delivery, interruption, and
restart. Adding an adapter must not add another public MCP prefix.
