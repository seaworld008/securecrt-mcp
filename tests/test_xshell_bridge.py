import importlib.util
import json
import os
from pathlib import Path
import tempfile
import threading
import time


SCRIPT = Path(__file__).parents[1] / "bridge" / "xshell_bridge.py"
SPEC = importlib.util.spec_from_file_location("xshell_bridge_under_test", SCRIPT)
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)


class FakeSession:
    def __init__(self, session_path=""):
        self.Connected = True
        self.SessionName = "php-test"
        self.TabText = "root@php-test"
        self.RemoteAddress = "10.0.0.11"
        self.RemotePort = 22
        self.UserName = "root"
        self.Path = session_path
        self.selected = []
        self.tabs = {
            "php-test": ("root@php-test", "10.0.0.11"),
            "k8s-master": ("root@k8s-master", "10.0.0.12"),
        }

    def SelectTabName(self, name):
        self.selected.append(name)
        if name in self.tabs:
            tab_text, address = self.tabs[name]
            self.SessionName = name
            self.TabText = tab_text
            self.RemoteAddress = address
            return True
        return False

    def Sleep(self, _milliseconds):
        if getattr(self, "screen", None) is not None and self.screen.pending is not None:
            self.screen.text = self.screen.pending
            self.screen.pending = None
        return None


class FakeScreen:
    def __init__(self, session):
        self.session = session
        self.Synchronous = False
        self.pending = None

    @property
    def _lines(self):
        return self._text.splitlines() or [""]

    @property
    def _text(self):
        return getattr(self, "text", "php-test# ")

    @property
    def Rows(self):
        return 24

    @property
    def Columns(self):
        return 120

    @property
    def CurrentRow(self):
        return len(self._lines)

    @property
    def CurrentColumn(self):
        return len(self._lines[-1]) + 1

    def Get(self, first_row, _first_column, last_row, _last_column):
        if first_row == 1 and last_row == self.Rows:
            return self._text
        return self._lines[first_row - 1]

    def Send(self, value):
        command = value.rstrip("\r\n")
        prompt = "k8s-master# " if self.session.SessionName == "k8s-master" else "php-test# "
        self.pending = prompt + "\r\nok: " + command + "\r\n" + prompt

    def WaitForStrings(self, _sentinels, _milliseconds):
        if self.pending is not None:
            self.text = self.pending
            self.pending = None
        return 0


class FakeDialog:
    def MessageBox(self, *_args):
        return None


def test_yield_to_xshell_uses_short_session_sleep_for_ui_responsiveness():
    calls = []

    class Session:
        def Sleep(self, milliseconds):
            calls.append(milliseconds)

    app = type("App", (), {"Session": Session()})()

    assert MODULE.yield_to_xshell(app, 50) is True
    assert calls == [MODULE.HOST_WAIT_MS]


def test_yield_to_xshell_converts_host_cancel_to_clean_stop():
    class CancelledSession:
        def Sleep(self, _milliseconds):
            raise KeyboardInterrupt()

    app = type("App", (), {"Session": CancelledSession()})()
    assert MODULE.yield_to_xshell(app, 7) is False


def test_yield_to_xshell_converts_unstructured_host_cancel_to_clean_stop():
    class CancelledSession:
        def Sleep(self, _milliseconds):
            raise TypeError("'NoneType' object is not callable")

    app = type("App", (), {"Session": CancelledSession()})()
    assert MODULE.yield_to_xshell(app, 7) is False


def test_yield_to_xshell_falls_back_without_session_sleep(monkeypatch):
    calls = []
    monkeypatch.setattr(MODULE.time, "sleep", lambda seconds: calls.append(seconds))
    app = type("App", (), {})()

    assert MODULE.yield_to_xshell(app, 50) is True
    assert calls == [0.05]

def test_startup_notice_uses_external_process_without_host_modal(monkeypatch):
    calls = []

    monkeypatch.setattr(MODULE, "_show_startup_notice_process",
                        lambda logger=None: calls.append("process") or True)

    MODULE.show_startup_notice()
    assert calls == ["process"]


def test_external_startup_notice_builds_detached_wscript_popup(monkeypatch, tmp_path):
    system32 = tmp_path / "System32"
    system32.mkdir()
    wscript = system32 / "wscript.exe"
    wscript.write_bytes(b"test")
    calls = []
    monkeypatch.setenv("WINDIR", str(tmp_path))
    monkeypatch.setattr(MODULE.tempfile, "gettempdir", lambda: str(tmp_path))
    monkeypatch.setattr(MODULE.subprocess, "Popen",
                        lambda args, **kwargs: calls.append((args, kwargs)))

    notice = MODULE._show_startup_notice_process()
    assert notice and notice["owned"] is True
    assert calls and calls[0][0][0] == str(wscript)
    assert calls[0][0][1] == "//nologo"
    assert calls[0][0][2].endswith(".vbs")
    assert calls[0][1]["close_fds"] is True
    assert calls[0][1]["creationflags"] >= 0
    script_path = Path(calls[0][0][2])
    script_text = script_path.read_text(encoding="utf-16")
    assert "WScript.Shell" in script_text
    assert str(MODULE.STARTUP_NOTICE_STYLE) in script_text
    suppressed = MODULE._show_startup_notice_process()
    assert suppressed and suppressed["owned"] is False
    assert len(calls) == 1
    script_path.unlink()
    (tmp_path / ("securecrt-mcp-xshell-notice-" + str(MODULE.os.getpid()) + ".lock")).unlink()


def test_dismiss_startup_notice_terminates_owned_popup_and_keeps_host_marker(tmp_path):
    class FakeProcess:
        pid = 1234

        def __init__(self):
            self.terminated = False
            self.waited = False

        def poll(self):
            return None

        def terminate(self):
            self.terminated = True

        def wait(self, timeout=None):
            self.waited = True

    script_path = tmp_path / "notice.vbs"
    lock_path = tmp_path / "notice.lock"
    script_path.write_text("popup", encoding="utf-8")
    lock_path.write_text("lock", encoding="ascii")
    process = FakeProcess()
    events = []

    MODULE.dismiss_startup_notice(
        {"owned": True, "process": process, "script_path": str(script_path),
         "lock_path": str(lock_path)},
        lambda event, **fields: events.append((event, fields)),
    )

    assert process.terminated is True
    assert process.waited is True
    assert not script_path.exists()
    assert lock_path.exists()
    assert events[0][0] == "startup_notice_stopped"


def test_startup_notice_is_once_per_xshell_process(monkeypatch, tmp_path):
    system32 = tmp_path / "System32"
    system32.mkdir()
    (system32 / "wscript.exe").write_bytes(b"test")
    monkeypatch.setenv("WINDIR", str(tmp_path))
    monkeypatch.setattr(MODULE.tempfile, "gettempdir", lambda: str(tmp_path))
    monkeypatch.setattr(MODULE.subprocess, "Popen", lambda *args, **kwargs: type(
        "Process", (), {"pid": 1}
    )())
    monkeypatch.setattr(MODULE.os, "getpid", lambda: 101)

    first = MODULE._show_startup_notice_process()
    second = MODULE._show_startup_notice_process()
    assert first and first["owned"] is True
    assert second and second["owned"] is False
    assert second["reason"] == "host"

    monkeypatch.setattr(MODULE.os, "getpid", lambda: 202)
    third = MODULE._show_startup_notice_process()
    assert third and third["owned"] is True

    for path in tmp_path.glob("securecrt-mcp-xshell-notice-*"):
        path.unlink()


def test_dismiss_startup_notice_does_not_touch_suppressed_popup():
    class ForbiddenProcess:
        def terminate(self):
            raise AssertionError("suppressed popup must not be terminated")

    MODULE.dismiss_startup_notice({"owned": False, "process": ForbiddenProcess()})


def test_cleanup_stale_instances_removes_abandoned_runtime_state(tmp_path):
    now = MODULE.STALE_INSTANCE_MS + 10_000
    instances = tmp_path / "instances"
    old = instances / "old"
    active = instances / "active"
    old.mkdir(parents=True)
    active.mkdir()
    old.joinpath("ready.json").write_text(
        json.dumps({"started_ms": 1}), encoding="utf-8"
    )
    active.joinpath("ready.json").write_text(
        json.dumps({"last_poll_ms": now - 100}), encoding="utf-8"
    )
    MODULE.cleanup_stale_instances(tmp_path, now=now)
    assert not old.exists()
    assert active.exists()


class FakeXshell:
    def __init__(self, session_path=""):
        self.Session = FakeSession(session_path)
        self.Screen = FakeScreen(self.Session)
        self.Session.screen = self.Screen
        self.Dialog = FakeDialog()
        self.Version = "8-test"


def request(adapter, method, **params):
    return MODULE.handle_request(
        adapter,
        {
            "id": method + "-1",
            "token": "t" * 32,
            "protocol_version": MODULE.PROTOCOL_VERSION,
            "deadline_ms": MODULE.now_ms() + 30_000,
            "client_id": "pytest",
            "method": method,
            "params": params,
        },
        "t" * 32,
    )


def test_xshell_opaque_session_round_trip_and_named_selection():
    app = FakeXshell()
    adapter = MODULE.NativeAdapter(app)

    listed = request(adapter, "list_sessions")
    assert listed["ok"] is True
    session_id = listed["result"]["sessions"][0]["session_id"]

    attached = request(adapter, "attach", session=session_id, mode="shared",
                       expected_prompt="php-test# ")
    assert attached["ok"] is True
    attachment_id = attached["result"]["attachment_id"]

    begun = request(
        adapter,
        "prepare_and_begin",
        session=session_id,
        attachment_id=attachment_id,
        expected_prompt="php-test# ",
        text="printf probe",
        capture_id="capture-1",
        runtime_ms=2_000,
        completion_marker="ok: printf probe",
    )
    assert begun["ok"] is True

    polled = request(adapter, "poll_bulk", capture_id="capture-1",
                     wait_for="ok: printf probe", max_reads=4)
    assert polled["ok"] is True
    assert "ok: printf probe" in polled["result"]["text"]

    screen = request(adapter, "read_screen", session=session_id)
    assert screen["ok"] is True
    assert screen["result"]["session"] == session_id
    assert screen["result"]["current_line"] == "php-test#"

    focused = request(adapter, "focus_session", session="k8s-master")
    assert focused["ok"] is True
    assert app.Session.selected == ["k8s-master"]
    assert focused["result"]["session"] != session_id


def test_two_xshell_instances_stop_cleanly_and_write_lifecycle_logs(tmp_path, monkeypatch):
    monkeypatch.setattr(MODULE, "_show_startup_notice_process", lambda logger=None: True)
    config = {"ipc_dir": str(tmp_path / "ipc"), "token": "t" * 32}
    stop_events = [threading.Event(), threading.Event()]
    apps = [FakeXshell(), FakeXshell()]
    threads = [threading.Thread(target=MODULE.serve, args=(app, config, event), daemon=True)
               for app, event in zip(apps, stop_events)]
    for thread in threads:
        thread.start()

    ready_root = Path(config["ipc_dir"]) / "instances"
    deadline = time.time() + 3
    while time.time() < deadline and len(list(ready_root.glob("*/ready.json"))) < 2:
        time.sleep(0.01)
    ready_files = list(ready_root.glob("*/ready.json"))
    assert len(ready_files) == 2
    for event in stop_events:
        event.set()
    for thread in threads:
        thread.join(timeout=3)
        assert not thread.is_alive()

    logs = list((Path(config["ipc_dir"]) / "logs").glob("xshell-*.jsonl"))
    assert len(logs) == 2
    for log_path in logs:
        events = [json.loads(line)["event"] for line in log_path.read_text(encoding="utf-8").splitlines()]
        assert events[:5] == ["serve_start", "xshell_runtime", "host_wait_capability",
                              "screen_synchronous_unmanaged", "startup_notice_dispatched"]
        assert "serve_finally" in events
        assert "host_wait_failed" not in events
        assert "screen_wait_failed" not in events
        assert events[-1] == "serve_stopped"


def test_serve_does_not_touch_global_synchronous_property(tmp_path, monkeypatch):
    monkeypatch.setattr(MODULE, "_show_startup_notice_process", lambda logger=None: True)

    class CancelSensitiveScreen(FakeScreen):
        def __init__(self, session):
            self.session = session
            self.pending = None

        @property
        def Synchronous(self):
            return False

        @Synchronous.setter
        def Synchronous(self, _value):
            raise SystemError("error return without exception set")

    app = FakeXshell()
    app.Screen = CancelSensitiveScreen(app.Session)
    app.Session.screen = app.Screen
    stop = threading.Event()
    thread = threading.Thread(
        target=MODULE.serve,
        args=(app, {"ipc_dir": str(tmp_path / "ipc"), "token": "t" * 32}, stop),
        daemon=True,
    )
    thread.start()
    ready_root = Path(tmp_path / "ipc" / "instances")
    deadline = time.time() + 3
    while time.time() < deadline and not list(ready_root.glob("*/ready.json")):
        time.sleep(0.01)
    stop.set()
    thread.join(timeout=3)
    assert not thread.is_alive()


def test_xshell_attachment_expected_prompt_rejects_before_send():
    app = FakeXshell()
    adapter = MODULE.NativeAdapter(app)
    listed = request(adapter, "list_sessions")
    session_id = listed["result"]["sessions"][0]["session_id"]
    attached = request(adapter, "attach", session=session_id, mode="shared",
                       expected_prompt="php-test# ")
    rejected = request(
        adapter,
        "prepare_and_begin",
        session=session_id,
        attachment_id=attached["result"]["attachment_id"],
        expected_prompt="wrong-prompt",
        text="printf should-not-send",
        capture_id="wrong-prompt-capture",
        runtime_ms=2_000,
    )
    assert rejected["ok"] is False
    assert "prompt_mismatch" in rejected["error"]


def test_xshell_discovers_connected_named_session_files_and_restores_focus():
    with tempfile.TemporaryDirectory() as directory:
        Path(directory, "php-test.xsh").write_text("ignored", encoding="utf-8")
        Path(directory, "k8s-master.xsh").write_text("ignored", encoding="utf-8")
        app = FakeXshell(str(Path(directory, "php-test.xsh")))
        adapter = MODULE.NativeAdapter(app)

        listed = request(adapter, "list_sessions")
        assert listed["ok"] is True
        result = listed["result"]
        assert result["enumeration"] == "named_files"
        assert {item["session_name"] for item in result["sessions"]} == {"php-test", "k8s-master"}
        assert result["discovery"]["method"] == "session_file_names"
        assert app.Session.SessionName == "php-test"


def test_deployed_script_loads_token_config_from_private_mcp_home(monkeypatch):
    with tempfile.TemporaryDirectory() as directory:
        private_home = Path(directory, "private")
        script_folder = Path(directory, "Xshell", "Scripts")
        private_home.mkdir()
        script_folder.mkdir(parents=True)
        config = {"host": "127.0.0.1", "port": 27856, "token": "t" * 32,
                  "max_request_bytes": 262144}
        config_path = private_home / "xshell_bridge.json"
        config_path.write_text(json.dumps(config), encoding="utf-8")
        monkeypatch.setenv("SECURECRT_MCP_HOME", str(private_home))
        loaded = MODULE.load_config(script_folder / "securecrt-mcp-xshell.py")
        assert loaded == config
        assert os.environ["SECURECRT_MCP_HOME"] == str(private_home)


def test_xshell_stale_screen_and_authentication_fail_closed():
    app = FakeXshell()
    adapter = MODULE.NativeAdapter(app)
    listed = request(adapter, "list_sessions")
    session_id = listed["result"]["sessions"][0]["session_id"]
    screen = request(adapter, "read_screen", session=session_id)

    bad = MODULE.handle_request(
        adapter,
        {
            "id": "bad-auth",
            "token": "wrong",
            "protocol_version": MODULE.PROTOCOL_VERSION,
            "deadline_ms": MODULE.now_ms() + 30_000,
            "method": "read_screen",
            "params": {"session": session_id},
        },
        "t" * 32,
    )
    assert bad["ok"] is False

    acknowledged = request(
        adapter,
        "acknowledge_idle",
        session=session_id,
        screen_token=screen["result"]["screen_token"],
        expected_prompt="wrong-prompt",
    )
    assert acknowledged["ok"] is False
    assert "stale_screen" in acknowledged["error"]


def test_xshell_file_ipc_server_round_trip_without_socket_modules():
    with tempfile.TemporaryDirectory() as directory:
        ipc = Path(directory, "ipc")
        app = FakeXshell()
        stop = threading.Event()
        errors = []
        def run():
            try:
                MODULE.serve(app, {"ipc_dir": str(ipc), "token": "t" * 32}, stop_event=stop)
            except RuntimeError as exc:
                if not stop.is_set():
                    errors.append(str(exc))
            except Exception as exc:
                errors.append(repr(exc))

        thread = threading.Thread(target=run, daemon=True)
        thread.start()
        ready = next((ipc / "instances").glob("*/ready.json"), None)
        for _ in range(100):
            ready = next((ipc / "instances").glob("*/ready.json"), None)
            if ready is not None and ready.exists():
                break
            time.sleep(0.01)
        assert ready is not None and ready.exists()
        ipc = ready.parent

        request_id = "file-ipc-test"
        request = {
            "protocol_version": MODULE.PROTOCOL_VERSION,
            "id": request_id,
            "token": "t" * 32,
            "client_id": "pytest",
            "keep_alive": True,
            "deadline_ms": MODULE.now_ms() + 30_000,
            "method": "ping",
            "params": {},
        }
        temporary = ipc / ".file-ipc-test.request.tmp"
        temporary.write_text(json.dumps(request), encoding="utf-8")
        os.replace(str(temporary), str(ipc / (request_id + ".request.json")))
        response_path = ipc / (request_id + ".response.json")
        for _ in range(100):
            if response_path.exists():
                break
            time.sleep(0.01)
        assert response_path.exists()
        response = json.loads(response_path.read_text(encoding="utf-8"))
        assert response["ok"] is True
        assert response["id"] == request_id
        assert response["result"]["bridge_version"] == MODULE.BRIDGE_VERSION
        assert not errors
        stop.set()
        thread.join(1)
        assert not thread.is_alive()
        assert not ready.exists()
