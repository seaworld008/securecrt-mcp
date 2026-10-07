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
    assert 'FIXTURE_BEGIN\r\nfixture\r\nFIXTURE_END 0' in result['result']['text']


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
