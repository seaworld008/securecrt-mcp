"""Exercise production Xshell adapter contracts, replacing only native xsh APIs."""
from test_xshell_bridge import MODULE, FakeXshell, FakeScreen, request


def opened():
    app = FakeXshell()
    adapter = MODULE.NativeAdapter(app)
    sid = adapter.list_sessions()['sessions'][0]['session_id']
    aid = request(adapter, 'attach', session=sid)['result']['attachment_id']
    return app, adapter, sid, aid


def begin(adapter, sid, aid):
    return request(adapter, 'prepare_and_begin', session=sid, attachment_id=aid,
                   expected_prompt=None, text='printf fixture', capture_id='capture',
                   runtime_ms=2000, completion_marker='FIXTURE_END')


def test_successful_capture_releases_session_without_idle_ack():
    app, adapter, sid, aid = opened()
    assert begin(adapter, sid, aid)['ok']
    result = request(adapter, 'end', capture_id='capture', confirmed_complete=True)
    assert result['result']['unresolved'] is False


def test_interrupt_accepts_engine_session_and_capture_contract():
    app, adapter, sid, aid = opened()
    assert begin(adapter, sid, aid)['ok']
    result = request(adapter, 'interrupt', session=sid, capture_id='capture')
    assert result['ok'], result.get('error')


def test_attachment_refuses_password_context_without_explicit_prompt():
    app, adapter, sid, aid = opened()
    app.Screen.text = 'Password: '
    result = begin(adapter, sid, aid)
    assert not result['ok']
    assert result['sent'] is False
    assert app.Screen.pending is None


def test_presend_prompt_rejection_reports_no_delivery():
    app, adapter, sid, aid = opened()
    result = request(adapter, 'prepare_and_begin', session=sid, attachment_id=aid,
                     expected_prompt='wrong', text='printf fixture', capture_id='capture',
                     runtime_ms=2000)
    assert not result['ok']
    assert result['sent'] is False


def test_fast_native_output_is_captured_before_send_returns():
    app, adapter, sid, aid = opened()
    class ImmediateScreen(FakeScreen):
        def Send(self, value):
            self.text = self._text + '\r\nFIXTURE_BEGIN\r\nfixture\r\nFIXTURE_END 0\r\nphp-test# '
    app.Screen = ImmediateScreen(app.Session)
    assert begin(adapter, sid, aid)['ok']
    result = request(adapter, 'poll_bulk', capture_id='capture', max_reads=1)
    assert 'FIXTURE_BEGIN\nfixture\nFIXTURE_END 0' in result['result']['text']


def test_timed_out_capture_can_be_explicitly_interrupted_without_replay():
    app, adapter, sid, aid = opened()
    assert begin(adapter, sid, aid)['ok']
    assert request(adapter, 'end', capture_id='capture', confirmed_complete=False)['ok']
    result = request(adapter, 'interrupt', session=sid, capture_id='capture')
    assert result['ok'], result.get('error')
    assert result['result']['remote_termination_confirmed'] is False


def test_interrupt_refuses_another_session_before_send():
    app, adapter, sid, aid = opened()
    assert begin(adapter, sid, aid)['ok']
    result = request(adapter, 'interrupt', session='different', capture_id='capture')
    assert not result['ok'] and result['sent'] is False


def test_expired_attachment_refuses_send():
    app, adapter, sid, aid = opened()
    adapter.attachments[aid]['expires'] = 0
    result = begin(adapter, sid, aid)
    assert not result['ok'] and result['sent'] is False


def test_changed_named_endpoint_refuses_original_opaque_session():
    app, adapter, sid, aid = opened()
    app.Session.RemoteAddress = '192.0.2.22'
    result = begin(adapter, sid, aid)
    assert not result['ok'] and result['sent'] is False


def test_acknowledge_refuses_active_capture():
    app, adapter, sid, aid = opened()
    assert begin(adapter, sid, aid)['ok']
    screen = request(adapter, 'read_screen', session=sid)['result']
    result = request(adapter, 'acknowledge_idle', session=sid,
                     screen_token=screen['screen_token'], expected_prompt=screen['current_line'])
    assert not result['ok'] and result['sent'] is False


def test_script_shutdown_restores_active_native_synchronous_state(tmp_path, monkeypatch):
    import threading
    import time
    app = FakeXshell()
    stop = threading.Event()
    original = MODULE.NativeAdapter
    def active_adapter(native):
        adapter = original(native)
        sid = adapter.list_sessions()['sessions'][0]['session_id']
        aid = adapter.attach(sid)['attachment_id']
        adapter.prepare_and_begin(sid, aid, None, 'printf fixture', 'active', 2000)
        return adapter
    monkeypatch.setattr(MODULE, 'NativeAdapter', active_adapter)
    monkeypatch.setattr(MODULE, 'show_startup_notice', lambda logger=None: None)
    thread = threading.Thread(target=MODULE.serve, args=(app, {'ipc_dir':str(tmp_path),'token':'t'*32}, stop), daemon=True)
    thread.start()
    until = time.monotonic() + 3
    while not list((tmp_path / 'instances').glob('*/ready.json')):
        assert time.monotonic() < until
        time.sleep(.01)
    stop.set()
    thread.join(3)
    assert not thread.is_alive()
    assert app.Screen.Synchronous is False


def test_runtime_version_reads_product_version_of_the_actual_xshell_host(tmp_path, monkeypatch):
    import struct
    host = tmp_path / 'XshellCore.exe'
    # A Windows VS_VERSION_INFO resource; file and product versions differ.
    header = struct.pack('<3H', 92, 52, 0)
    key = 'VS_VERSION_INFO\0'.encode('utf-16le')
    fixed = struct.pack('<13I', 0xFEEF04BD, 0x10000, 0x80000, 0x2A0000,
                        0x80000, 0x5F0000, 0, 0, 0, 0, 0, 0, 0)
    host.write_bytes(header + key + b'\0\0' + fixed)
    monkeypatch.setattr(MODULE.sys, 'executable', str(host))
    app = FakeXshell()
    del app.Version
    report = MODULE.NativeAdapter(app).ping()
    assert report['xshell_version'] == '8.0.95.0'


def test_runtime_version_does_not_invent_a_version_without_host_evidence(tmp_path, monkeypatch):
    host = tmp_path / 'XshellCore.exe'
    host.write_bytes(b'not a version resource')
    monkeypatch.setattr(MODULE.sys, 'executable', str(host))
    app = FakeXshell()
    del app.Version
    assert MODULE.NativeAdapter(app).ping()['xshell_version'] == 'unknown'


class BufferedScreen(FakeScreen):
    @property
    def Rows(self):
        return max(24, len(self._lines) + 1)
    @property
    def CurrentRowInScreen(self):
        return min(24, self.CurrentRow)
    def Get(self, first_row, first_column, last_row, last_column):
        lines = [self._lines[row - 1] if 1 <= row <= len(self._lines) else ''
                 for row in range(first_row, last_row + 1)]
        if not lines:
            return ''
        if len(lines) == 1:
            return lines[0][first_column - 1:last_column]
        lines[0] = lines[0][first_column - 1:]
        lines[-1] = lines[-1][:last_column]
        return '\n'.join(lines)


def test_read_screen_bounds_the_viewport_even_with_large_scrollback():
    app = FakeXshell()
    app.Screen = BufferedScreen(app.Session)
    app.Screen.text = ('historical-data-' + 'x' * 90 + '\n') * 1000 + 'php-test# '
    adapter = MODULE.NativeAdapter(app)
    sid = adapter.list_sessions()['sessions'][0]['session_id']
    result = request(adapter, 'read_screen', session=sid)
    assert result['ok'], result.get('error')
    assert len(result['result']['text'].encode('utf-8')) < 10000
    assert result['result']['current_line'] == 'php-test#'


def test_capture_reads_owned_rows_without_repeating_existing_history():
    app = FakeXshell()
    class PartialScreen(BufferedScreen):
        def Send(self, value):
            self.text = self._text + value.rstrip('\r') + '\nFIXTURE_BEGIN\nfirst'
    app.Screen = PartialScreen(app.Session)
    app.Screen.text = 'private-old-history\nphp-test# '
    adapter = MODULE.NativeAdapter(app)
    sid = adapter.list_sessions()['sessions'][0]['session_id']
    aid = request(adapter, 'attach', session=sid)['result']['attachment_id']
    assert begin(adapter, sid, aid)['ok']
    first = request(adapter, 'poll_bulk', capture_id='capture', max_reads=4)['result']['text']
    app.Screen.text += ' second\nFIXTURE_END 0\nphp-test# '
    second = request(adapter, 'poll_bulk', capture_id='capture', max_reads=4)['result']['text']
    text = first + second
    assert 'private-old-history' not in text
    assert text.count('FIXTURE_BEGIN') == 1
    assert text.count('first second') == 1
    assert text.count('FIXTURE_END 0') == 1


def test_native_posix_wire_is_ascii_and_preserves_unicode_shell_semantics():
    import subprocess
    payload = "printf '\u5206\u9875_\u4e2d\u6587_🙂'; export MCP_WIRE_TEST='值'; printf '\nEND_TEST %s\n' \"$?\""
    wire = MODULE.native_command_text(payload, "END_TEST")
    assert wire.isascii()
    import shutil, pytest
    shell = shutil.which("sh")
    if not shell:
        pytest.skip("POSIX shell execution checked on Linux/macOS")
    result = subprocess.run([shell, "-c", wire + "; printf '%s' \"$MCP_WIRE_TEST\""],
                            capture_output=True, text=True, encoding="utf-8", check=True)
    assert result.stdout == "分页_中文_🙂\nEND_TEST 0\n值"


def test_native_unicode_prompt_command_is_rejected_before_send():
    import pytest
    with pytest.raises(ValueError, match="unicode_input_requires_posix"):
        MODULE.native_command_text("echo 中文", None)


def test_native_ascii_command_is_unchanged():
    assert MODULE.native_command_text("printf 'hello'", None) == "printf 'hello'"


def test_unsafe_embedded_python_rejects_command_before_native_send(monkeypatch):
    import pytest
    app = FakeXshell()
    adapter = MODULE.NativeAdapter(app)
    attachment = adapter.attach("php-test")
    monkeypatch.setattr(MODULE, "unsafe_embedded_binding", lambda app: True)
    with pytest.raises(ValueError, match="unsafe_native_python_binding"):
        adapter.prepare_and_begin("php-test", attachment["attachment_id"], None,
                                  "printf hello", "unsafe", 1000, "END_unsafe")
    assert app.Screen.pending is None and not adapter.captures and adapter.send_attempted is False


def test_unsafe_embedded_python_rejects_interrupt_before_native_send(monkeypatch):
    app, adapter, sid, aid = opened()
    assert begin(adapter, sid, aid)["ok"]
    monkeypatch.setattr(MODULE, "unsafe_embedded_binding", lambda app: True)
    calls = []
    monkeypatch.setattr(app.Screen, "Send", lambda text: calls.append(text))
    response = request(adapter, "interrupt", session=sid, capture_id="capture")
    assert not response["ok"] and response["sent"] is False and calls == []


def test_explicit_idle_ack_refreshes_owned_attachment_after_timeout_redraw():
    app, adapter, sid, aid = opened()
    assert begin(adapter, sid, aid)["ok"]
    app.Screen.pending = None
    app.Screen.text = "php-test# old_command\n^C\nphp-test# "
    request(adapter, "end", capture_id="capture", confirmed_complete=False)
    screen = request(adapter, "read_screen", session=sid)["result"]
    assert request(adapter, "acknowledge_idle", session=sid,
                   screen_token=screen["screen_token"], expected_prompt=screen["current_line"])["ok"]
    resumed = begin(adapter, sid, aid)
    assert resumed["ok"], resumed


def test_idle_ack_does_not_refresh_another_clients_attachment():
    app, adapter, sid, aid = opened()
    adapter.owner = "other-client"
    other = adapter.attach(sid, mode="observe")["attachment_id"]
    before = dict(adapter.attachments[other]["context"])
    assert begin(adapter, sid, aid)["ok"]
    app.Screen.pending = None
    app.Screen.text = "php-test# old_command\n^C\nphp-test# "
    request(adapter, "end", capture_id="capture", confirmed_complete=False)
    screen = request(adapter, "read_screen", session=sid)["result"]
    assert request(adapter, "acknowledge_idle", session=sid,
                   screen_token=screen["screen_token"], expected_prompt=screen["current_line"])["ok"]
    assert adapter.attachments[other]["context"] == before
    assert adapter.attachments[aid]["context"]["cursor_row"] == screen["cursor_row"]


def test_raw_capture_keeps_unterminated_output_without_duplication():
    app, adapter, sid, aid = opened()
    assert request(adapter, "prepare_and_begin", session=sid, attachment_id=aid,
                   expected_prompt=None, text="printf fixture", capture_id="raw", runtime_ms=2000)["ok"]
    app.Screen.pending = None
    app.Screen.text = "php-test# printf fixture\nPARTIAL"
    first = request(adapter, "poll", capture_id="raw")["result"]
    assert "PARTIAL" in first["text"]
    assert request(adapter, "poll", capture_id="raw")["result"]["text"] == ""
    app.Screen.text += "_CONTINUED"
    assert request(adapter, "poll", capture_id="raw")["result"]["text"] == "_CONTINUED"
    app.Screen.text += "\nphp-test# "
    tail = request(adapter, "poll", capture_id="raw")["result"]["text"]
    assert "PARTIAL" not in tail and tail.startswith("\n")


def test_prompt_completion_reuses_original_input_boundary_after_row_change():
    app, adapter, sid, aid = opened()
    assert request(adapter, "prepare_and_begin", session=sid, attachment_id=aid,
                   expected_prompt=None, text="printf fixture", capture_id="raw", runtime_ms=2000)["ok"]
    app.Screen.pending = None
    app.Screen.text = "php-test# printf fixture\noutput\nphp-test# "
    assert request(adapter, "end", capture_id="raw", confirmed_complete=True)["ok"]
    assert begin(adapter, sid, aid)["ok"]
