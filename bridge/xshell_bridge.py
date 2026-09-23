# $language = "Python3"
# $interface = "1.0"

"""Xshell 8 native connector bridge.

Run this file from Xshell's Script menu. It exposes the same authenticated
request/response contract as the SecureCRT bridge through private file IPC
while keeping all xsh calls on Xshell's script thread. Xshell does not expose a connected-tab collection,
so discovery uses the current session file's directory as a name index and
then probes those names through SelectTabName in single-process mode. Session
file contents are never read.
"""

import hashlib
import hmac
import json
import os
import platform
import sys
import time
import uuid
from pathlib import Path

BRIDGE_VERSION = "0.5.0"
PROTOCOL_VERSION = 2
MAX_FRAME = 262144
MAX_CHUNK = 65536
LEASE_MS = 120000
SCREEN_MS = 30000
DISCOVERY_LIMIT = 128


def fail(message):
    raise ValueError(message)


def string(value, name, maximum=65536):
    if not isinstance(value, str) or not value or len(value.encode("utf-8")) > maximum:
        fail("invalid " + name)
    return value


def now_ms():
    return int(time.time() * 1000)


class NativeAdapter:
    def __init__(self, app):
        self.app = app
        self.instance = str(uuid.uuid4())
        self.sessions = {}
        self.tokens = {}
        self.captures = {}
        self.attachments = {}
        self.unresolved = {}
        self.owner = "legacy"
        self.metrics = dict(requests=0, native_reads=0, native_read_ms=0,
                            connections=0, context_rejections=0)

    def _metadata(self):
        session = self.app.Session
        return {
            "session_name": str(getattr(session, "SessionName", "")),
            "tab_text": str(getattr(session, "TabText", "")),
            "remote_address": str(getattr(session, "RemoteAddress", "")),
            "remote_port": int(getattr(session, "RemotePort", 0) or 0),
            "user": str(getattr(session, "UserName", "")),
        }

    def _connected(self):
        return bool(self.app.Session.Connected)

    def _select(self, target):
        target = string(target, "session", 512)
        # Resolve opaque list IDs back to a named Xshell tab before calling
        # SelectTabName; the hash itself is intentionally not user-selectable.
        known = self.sessions.get(target)
        if known:
            metadata = known["metadata"]
            target = metadata["session_name"] or metadata["tab_text"]
        elif target.startswith("xshell/"):
            target = target.rsplit("/", 1)[-1]
        current = self._metadata()
        if target not in (current["session_name"], current["tab_text"]):
            try:
                if not bool(self.app.Session.SelectTabName(target)):
                    fail("session_not_found: Xshell requires a connected named tab in single-process mode")
            except Exception as exc:
                fail("session_select_failed: " + str(exc))
        if not self._connected():
            fail("session_not_connected")
        return self._metadata()

    def _session_id(self, metadata):
        name = "\0".join((metadata["session_name"], metadata["remote_address"],
                          str(metadata["remote_port"]), metadata["user"]))
        if not name.strip("\0"):
            name = metadata["tab_text"]
        return self.instance + "/" + hashlib.sha256(name.encode("utf-8")).hexdigest()[:24]

    def _discovery_names(self):
        names = []
        seen = set()

        def add(value):
            value = str(value or "").strip()
            if value and value not in seen and len(names) < DISCOVERY_LIMIT:
                seen.add(value)
                names.append(value)

        current = self._metadata()
        add(current["session_name"])
        add(current["tab_text"])
        session_path = str(getattr(self.app.Session, "Path", "") or "")
        if session_path:
            try:
                root = Path(session_path).expanduser().resolve().parent
                if root.exists() and root.is_dir():
                    for path in sorted(root.rglob("*.xsh"), key=lambda item: str(item).lower()):
                        add(path.stem)
            except (OSError, ValueError):
                pass
        return names

    def _discover_sessions(self):
        current = self._metadata()
        names = self._discovery_names()
        sessions = []
        errors = []
        selected = False
        for name in names:
            metadata = current if name in (current["session_name"], current["tab_text"]) else None
            if metadata is None:
                try:
                    if not bool(self.app.Session.SelectTabName(name)):
                        errors.append(dict(name=name, error="session_not_found"))
                        continue
                    selected = True
                    if not self._connected():
                        errors.append(dict(name=name, error="session_not_connected"))
                        continue
                    metadata = self._metadata()
                except Exception as exc:
                    errors.append(dict(name=name, error="session_select_failed: " + str(exc)))
                    continue
            sid = self._session_id(metadata)
            self.sessions[sid] = dict(metadata=metadata, expires=now_ms() + LEASE_MS)
            if not any(item["session_id"] == sid for item in sessions):
                sessions.append(dict(id=sid, session_id=sid, connected=True,
                                     lease_expires_ms=self.sessions[sid]["expires"],
                                     capabilities=self._capabilities(), **metadata))
        if selected:
            original = current["session_name"] or current["tab_text"]
            try:
                if original:
                    self.app.Session.SelectTabName(original)
            except Exception:
                errors.append(dict(name=original, error="restore_failed"))
        return sessions, errors, len(names)

    def _screen(self):
        screen = self.app.Screen
        rows, columns = int(screen.Rows), int(screen.Columns)
        text = str(screen.Get(1, 1, rows, columns))
        if len(text.encode("utf-8")) > MAX_CHUNK:
            fail("screen_too_large: resize the terminal")
        row, column = int(screen.CurrentRow), int(screen.CurrentColumn)
        line = str(screen.Get(row, 1, row, columns)).rstrip()
        digest = hashlib.sha256((text + "\0" + str(row) + ":" + str(column)).encode("utf-8")).hexdigest()
        return dict(text=text, current_line=line, cursor_row=row, cursor_column=column,
                    rows=rows, columns=columns, digest=digest)

    def _entry(self, session):
        metadata = self._select(session)
        sid = self._session_id(metadata)
        self.sessions[sid] = dict(metadata=metadata, expires=now_ms() + LEASE_MS)
        return sid, self.sessions[sid]

    def list_sessions(self):
        if not self._connected():
            return dict(bridge_instance=self.instance, sessions=[], enumeration="named_files",
                        capabilities=self._capabilities())
        sessions, errors, candidate_count = self._discover_sessions()
        return dict(bridge_instance=self.instance, enumeration="named_files",
                    sessions=sessions,
                    capabilities=self._capabilities(),
                    discovery=dict(method="session_file_names", candidates=candidate_count,
                                   limit=DISCOVERY_LIMIT, errors=errors),
                    selection_note="Names come from .xsh filenames; connected state is probed through SelectTabName")

    def _capabilities(self):
        return ["session_leases", "screen_tokens", "attachments", "prepare_and_begin",
                "per_session_capture", "interrupt", "ack_fresh_view",
                "named_session_discovery"]

    def read_screen(self, session):
        sid, entry = self._entry(session)
        value = self._screen()
        token = str(uuid.uuid4())
        self.tokens[token] = dict(session=sid, digest=value.pop("digest"), expires=now_ms() + SCREEN_MS)
        value.update(session=sid, screen_token=token, token_expires_ms=now_ms() + SCREEN_MS,
                     configured_endpoint=entry["metadata"],
                     context_warning="Configured endpoint is not proof of the current nested SSH target.")
        return value

    def _guard(self, session, screen_token, expected_prompt, attachment_id=None):
        sid, entry = self._entry(session)
        if attachment_id:
            attachment = self.attachments.get(attachment_id)
            if not attachment or attachment["session"] != sid:
                fail("attachment_mismatch")
            if expected_prompt:
                current = self._screen()["current_line"]
                if current != str(expected_prompt).rstrip():
                    self.metrics["context_rejections"] += 1
                    fail("prompt_mismatch")
            return sid, entry
        expected_prompt = string(expected_prompt, "expected_prompt", 512).rstrip()
        token = self.tokens.pop(screen_token, None)
        current = self._screen()
        if (not token or token["session"] != sid or now_ms() > token["expires"]
                or token["digest"] != current["digest"]
                or current["current_line"] != expected_prompt):
            self.metrics["context_rejections"] += 1
            fail("stale_screen: read the terminal again before sending")
        return sid, entry

    def attach(self, session, mode="shared", expected_prompt=None):
        if mode not in ("shared", "exclusive", "observe"):
            fail("invalid ownership mode")
        sid, entry = self._entry(session)
        if mode != "observe" and expected_prompt is not None:
            current = self._screen()["current_line"]
            if current != str(expected_prompt).rstrip():
                fail("prompt_mismatch: target is not at the expected input context")
        aid = str(uuid.uuid4())
        self.attachments[aid] = dict(session=sid, mode=mode, entry=entry, expires=now_ms() + 600000)
        return dict(attachment_id=aid, session=sid, mode=mode, configured_endpoint=entry["metadata"],
                    current_line=self._screen()["current_line"], capabilities=self._capabilities())

    def heartbeat(self, attachment_id):
        attachment = self.attachments.get(string(attachment_id, "attachment_id"))
        if not attachment:
            fail("stale_attachment")
        self._select(attachment["entry"]["metadata"]["session_name"])
        attachment["expires"] = now_ms() + 600000
        return dict(attachment_id=attachment_id, session=attachment["session"],
                    unresolved=self.unresolved.get(attachment["session"]))

    def detach(self, attachment_id):
        self.attachments.pop(string(attachment_id, "attachment_id"), None)
        return dict(detached=True, attachment_id=attachment_id)

    def prepare_and_begin(self, session, attachment_id, expected_prompt, text, capture_id,
                          runtime_ms, completion_marker=None):
        aid = string(attachment_id, "attachment_id")
        attachment = self.attachments.get(aid)
        if not attachment:
            fail("stale_attachment")
        sid, entry = self._guard(session, "", expected_prompt, aid)
        if sid in self.unresolved:
            fail("unresolved: inspect and acknowledge idle first")
        string(text, "text")
        string(capture_id, "capture_id", 128)
        self._select(entry["metadata"]["session_name"])
        self.app.Screen.Synchronous = True
        self.app.Screen.Send(text + "\r")
        self.captures[capture_id] = dict(session=sid, entry=entry, until=now_ms() + int(runtime_ms),
                                        marker=completion_marker, last=self._screen()["text"],
                                        owner=self.owner)
        return dict(capture_id=capture_id, sent=True)

    def poll(self, capture_id, wait_for=None):
        return self.poll_bulk(capture_id, wait_for=wait_for, max_reads=1)

    def poll_bulk(self, capture_id, wait_for=None, max_reads=128):
        capture = self.captures.get(string(capture_id, "capture_id"))
        if not capture:
            old = self.unresolved.get(capture_id)
            if old:
                return dict(text="", overflow=False, expired=True, capture_may_be_incomplete=True)
            fail("capture_mismatch")
        self._select(capture["entry"]["metadata"]["session_name"])
        started = time.monotonic()
        chunk = ""
        for _ in range(max(1, min(int(max_reads), 128))):
            value = self._screen()
            current = value["text"]
            old = capture["last"]
            if current.startswith(old):
                delta = current[len(old):]
            elif old and old in current:
                delta = current.split(old, 1)[1]
            else:
                delta = current
            capture["last"] = current
            chunk += delta
            self.metrics["native_reads"] += 1
            if capture["marker"] and capture["marker"] in chunk:
                break
            if delta:
                break
            if now_ms() >= capture["until"]:
                break
            self.app.Session.Sleep(20)
            if (time.monotonic() - started) >= 1.0:
                break
        expired = now_ms() >= capture["until"]
        return dict(text=chunk, overflow=False, expired=expired,
                    capture_may_be_incomplete=expired and not (capture["marker"] and capture["marker"] in chunk))

    def end(self, capture_id, confirmed_complete=False):
        capture = self.captures.pop(capture_id, None)
        if capture:
            self.app.Screen.Synchronous = False
            if not confirmed_complete:
                self.unresolved[capture["session"]] = dict(capture_id=capture_id, deadline_expired=True)
        return dict(ended=True, unresolved=self.unresolved.get(capture["session"]) if capture else None,
                    restore_errors=[])

    def interrupt(self, capture_id):
        capture = self.captures.get(string(capture_id, "capture_id"))
        if not capture:
            fail("capture_mismatch")
        self._select(capture["entry"]["metadata"]["session_name"])
        self.app.Screen.Send(chr(3))
        return dict(interrupt_sent=True, remote_termination_confirmed=False)

    def acknowledge_idle(self, session, screen_token, expected_prompt):
        sid, _ = self._guard(session, screen_token, expected_prompt)
        self.unresolved.pop(sid, None)
        return dict(idle_acknowledged=True, session=sid, remote_termination_confirmed=False)

    def focus_session(self, session):
        sid, _ = self._entry(session)
        return dict(focused=True, session=sid)

    def ping(self):
        return dict(bridge_version=BRIDGE_VERSION, protocol_version=PROTOCOL_VERSION,
                    bridge_instance=self.instance, python=sys.version.split()[0],
                    platform=platform.system(), architecture=platform.machine(),
                    xshell_version=str(getattr(self.app, "Version", "unknown")),
                    capabilities=self._capabilities(), enumeration="named_files",
                    metrics=self.metrics, native_keyboard_lock=False)


METHODS = ("ping", "list_sessions", "read_screen", "focus_session", "prepare_and_begin",
           "poll", "poll_bulk", "end", "interrupt", "acknowledge_idle", "attach",
           "heartbeat", "detach")


def handle_request(adapter, request, token):
    response = dict(id="", protocol_version=PROTOCOL_VERSION, ok=False, result=None, error=None)
    try:
        if not isinstance(request, dict):
            fail("invalid request")
        response["id"] = string(request.get("id"), "id", 128)
        supplied = request.get("token")
        if not isinstance(supplied, str) or not hmac.compare_digest(supplied.encode(), token.encode()):
            fail("authentication failed")
        if request.get("protocol_version") != PROTOCOL_VERSION:
            fail("protocol_mismatch: upgrade and restart the Xshell adapter")
        if int(request.get("deadline_ms", 0)) <= now_ms():
            fail("expired request deadline; nothing was sent")
        method = request.get("method")
        if method not in METHODS:
            fail("unsupported method")
        params = request.get("params", {})
        adapter.owner = string(request.get("client_id", "legacy"), "client_id", 128)
        adapter.metrics["requests"] += 1
        response.update(ok=True, result=getattr(adapter, method)(**params))
    except Exception as exc:
        response["error"] = str(exc)[:1024]
        response["error_code"] = str(exc).split(":", 1)[0][:64]
    response["sent"] = True if response["ok"] else None
    return response


def serve(app, config):
    ipc_dir = Path(string(config.get("ipc_dir"), "ipc_dir", 1024))
    if not ipc_dir.is_absolute():
        fail("Xshell IPC directory must be absolute")
    token = string(config["token"], "token", 256)
    if len(token) < 32:
        fail("bridge token too short")
    if not ipc_dir.exists():
        ipc_dir.mkdir(parents=True)
    for path in ipc_dir.iterdir():
        if path.is_file() and (path.name.endswith(".request.json") or
                               path.name.endswith(".response.json") or
                               path.name.endswith(".request.tmp") or
                               path.name == "ready.json"):
            try:
                path.unlink()
            except OSError:
                pass
    adapter = NativeAdapter(app)
    ready = ipc_dir / "ready.json"
    ready.write_text(json.dumps({"bridge_instance": adapter.instance,
                                 "bridge_version": BRIDGE_VERSION,
                                 "protocol_version": PROTOCOL_VERSION,
                                 "started_ms": now_ms()}, ensure_ascii=False), encoding="utf-8")
    try:
        try:
            app.Dialog.MessageBox("Xshell MCP 已启动；当前脚本只控制已连接的命名会话。", "Xshell MCP")
        except Exception:
            pass
        while True:
            requests = sorted((p for p in ipc_dir.iterdir() if p.name.endswith(".request.json")),
                              key=lambda p: p.name)
            for request_path in requests:
                try:
                    request = json.loads(request_path.read_text(encoding="utf-8"))
                    request_path.unlink()
                    response = handle_request(adapter, request, token)
                    request_id = string(request.get("id"), "id", 128)
                    response_path = ipc_dir / (request_id + ".response.json")
                    temporary = ipc_dir / ("." + request_id + ".response.tmp")
                    temporary.write_text(json.dumps(response, ensure_ascii=False), encoding="utf-8")
                    os.replace(str(temporary), str(response_path))
                except Exception as exc:
                    try:
                        request_path.unlink()
                    except OSError:
                        pass
                    error_path = ipc_dir / (request_path.name.replace(".request.json", ".response.json"))
                    try:
                        error_path.write_text(json.dumps({"id": "", "protocol_version": PROTOCOL_VERSION,
                                                          "bridge_instance": adapter.instance, "ok": False,
                                                          "error": str(exc), "sent": None}), encoding="utf-8")
                    except OSError:
                        pass
            try:
                ready.write_text(json.dumps({"bridge_instance": adapter.instance,
                                             "bridge_version": BRIDGE_VERSION,
                                             "protocol_version": PROTOCOL_VERSION,
                                             "last_poll_ms": now_ms()}, ensure_ascii=False), encoding="utf-8")
            except OSError:
                pass
            app.Session.Sleep(50)
    finally:
        try:
            ready.unlink()
        except OSError:
            pass


def load_config(script):
    candidates = []
    configured_home = os.environ.get("SECURECRT_MCP_HOME")
    if configured_home:
        candidates.append(Path(configured_home) / "xshell_bridge.json")
    candidates.append(Path.home() / ".securecrt-mcp" / "xshell_bridge.json")
    candidates.append(script.parent / "xshell_bridge.json")
    for candidate in candidates:
        try:
            if candidate.is_file():
                with candidate.open("r", encoding="utf-8") as handle:
                    return json.load(handle)
        except (OSError, ValueError):
            continue
    fail("xshell_bridge.json missing; run securecrt-mcp init")


def main():
    if "xsh" not in globals():
        fail("Run this script inside Xshell via Tools > Script > Run")
    script = Path(globals().get("__file__", "xshell_bridge.py")).resolve()
    config = load_config(script)
    serve(xsh, config)


if "xsh" in globals():
    main()
