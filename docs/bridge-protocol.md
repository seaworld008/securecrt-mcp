# Bridge protocol

The bridge protocol is a private localhost protocol between the Rust MCP process and the Python script running inside SecureCRT.

Transport: TCP, default `127.0.0.1:27855`.

Framing: one UTF-8 JSON object per line (NDJSON).

## Request

```json
{
  "id": "uuid",
  "token": "local-secret",
  "method": "list_sessions",
  "params": {}
}
```

## Success response

```json
{
  "id": "same-uuid",
  "ok": true,
  "result": {},
  "error": null
}
```

## Error response

```json
{
  "id": "same-uuid",
  "ok": false,
  "result": null,
  "error": "human-readable local error"
}
```

## Methods

### ping

Returns bridge version and visible tab count.

### list_sessions

Returns tabs in the SecureCRT process/window hosting the bridge.

### read_screen

Parameters:

```json
{
  "session": "tab:2",
  "start_row": 1,
  "end_row": 40,
  "trim": true
}
```

### focus_session

```json
{"session":"tab:2"}
```

### execute_command

```json
{
  "session": "tab:2",
  "command": "kubectl get pods -A",
  "wait_for": null,
  "timeout_ms": 5000,
  "settle_ms": 750
}
```

Authorization happens in Rust before this method is called.

### send_text

```json
{
  "session": "tab:2",
  "text": "hello",
  "append_enter": false
}
```

This MCP tool is disabled by default.

### interrupt

Sends Ctrl+C (`0x03`) to the target tab.

## Versioning

The bridge includes a `bridge_version` in `ping`. Breaking wire changes should increment a future protocol version field and preserve backward compatibility where practical.
