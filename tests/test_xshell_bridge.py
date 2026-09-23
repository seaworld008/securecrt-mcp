import importlib.util
import json
import os
from pathlib import Path
import tempfile


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


class FakeDialog:
    def MessageBox(self, *_args):
        return None


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
