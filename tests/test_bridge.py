"""Native SecureCRT calls are faked; no sockets or remote hosts are contacted."""
import importlib.util
from pathlib import Path
import unittest

PATH = Path(__file__).resolve().parents[1] / 'bridge' / 'securecrt_bridge.py'
# Import definitions from the old script without launching its server.
namespace = {'__name__': 'adapter_under_test', '__file__': str(PATH)}
source = PATH.read_text(encoding='utf-8')
if source.rstrip().endswith('main()') and '\nmain()' in source:
    source = source.rsplit('\nmain()', 1)[0]
exec(compile(source, str(PATH), 'exec'), namespace)


class Screen:
    Rows = 2
    Columns = 80
    CurrentRow = 2
    CurrentColumn = 8
    Synchronous = False
    IgnoreEscape = False
    MatchIndex = 0

    def __init__(self):
        self.sent = []
        self.text = 'ready\nuser$ '
        self.chunks = []

    def Get2(self, start, col, end, last):
        return '\n'.join(self.text.split('\n')[start - 1:end])

    def Send(self, text):
        self.sent.append(text)

    def ReadString(self, patterns, seconds):
        assert seconds == 1, 'only bounded one-second native waits allowed'
        if self.chunks:
            value, self.MatchIndex = self.chunks.pop(0)
            return value
        self.MatchIndex = 0
        return ''


class Config:
    def __init__(self, hostname):
        self.hostname = hostname

    def GetOption(self, key):
        return {'Hostname': self.hostname, 'Username': 'test',
                'Protocol Name': 'SSH2', 'Port': 22}[key]


class Session:
    def __init__(self, hostname):
        self.Connected = True
        self.Config = Config(hostname)


class Tab:
    def __init__(self, app, hostname):
        self.app, self.Caption = app, hostname
        self.Session, self.Screen = Session(hostname), Screen()

    @property
    def Index(self):
        return self.app.tabs.index(self) + 1

    def Activate(self):
        self.app.focus = self


class Crt:
    Version = 'fake-9.x'

    def __init__(self):
        self.tabs = [Tab(self, 'test-a'), Tab(self, 'test-b')]

    def GetTabCount(self):
        return len(self.tabs)

    def GetTab(self, index):
        return self.tabs[index - 1]


class AdapterTests(unittest.TestCase):
    def setUp(self):
        self.assertIn('NativeAdapter', namespace, 'protocol-2 native adapter is missing')
        self.time = 1000000
        self.crt = Crt()
        self.adapter = namespace['NativeAdapter'](self.crt, now=lambda: self.time)
        self.sid = self.adapter.list_sessions()['sessions'][0]['id']

    def params(self):
        screen = self.adapter.read_screen(self.sid)
        return dict(session=self.sid, screen_token=screen['screen_token'],
                    expected_prompt='user$', text='printf hello', capture_id='op-1',
                    runtime_ms=10000)

    def test_handles_survive_reorder_without_retargeting(self):
        old = self.crt.tabs[0]
        self.crt.tabs.reverse()
        self.adapter.begin(**self.params())
        self.assertEqual(old.Screen.sent, ['printf hello\r'])
        self.assertFalse(self.crt.tabs[0].Screen.sent)

    def test_closed_handle_never_retargets_reused_index(self):
        self.crt.tabs.pop(0)
        with self.assertRaisesRegex(Exception, 'stale_session'):
            self.adapter.read_screen(self.sid)
        self.assertFalse(self.crt.tabs[0].Screen.sent)

    def test_observed_disconnect_revokes_handle(self):
        tab = self.crt.tabs[0]
        tab.Session.Connected = False
        self.adapter.maintain()
        tab.Session.Connected = True
        with self.assertRaisesRegex(Exception, 'stale_session'):
            self.adapter.read_screen(self.sid)

    def test_metadata_change_revokes_handle(self):
        self.crt.tabs[0].Session.Config.hostname = 'other'
        with self.assertRaisesRegex(Exception, 'stale_session'):
            self.adapter.read_screen(self.sid)

    def test_changed_screen_rejects_before_send(self):
        params = self.params()
        self.crt.tabs[0].Screen.text = 'different\nuser$ '
        with self.assertRaisesRegex(Exception, 'stale_screen'):
            self.adapter.begin(**params)
        self.assertFalse(self.crt.tabs[0].Screen.sent)

    def test_wrong_prompt_rejects_before_send(self):
        params = self.params(); params['expected_prompt'] = 'root#'
        with self.assertRaisesRegex(Exception, 'prompt_mismatch'):
            self.adapter.begin(**params)
        self.assertFalse(self.crt.tabs[0].Screen.sent)

    def test_expired_screen_rejects_before_send(self):
        params = self.params(); self.time += 31000
        with self.assertRaisesRegex(Exception, 'stale_screen'):
            self.adapter.begin(**params)
        self.assertFalse(self.crt.tabs[0].Screen.sent)

    def test_busy_does_not_interrupt(self):
        self.adapter.begin(**self.params())
        with self.assertRaisesRegex(Exception, 'busy'):
            self.adapter.begin(**self.params())
        self.assertEqual(self.crt.tabs[0].Screen.sent, ['printf hello\r'])

    def test_poll_preserves_no_newline_and_match_metadata(self):
        self.adapter.begin(**self.params())
        self.crt.tabs[0].Screen.chunks = [('hello', 1), ('partial', 0)]
        self.assertEqual(self.adapter.poll('op-1')['text'], 'hello\n')
        result = self.adapter.poll('op-1')
        self.assertEqual(result['text'], 'partial')
        self.assertTrue(result['capture_may_be_incomplete'])

    def test_prompt_poll_restores_the_matched_delimiter(self):
        self.adapter.begin(**self.params())
        self.crt.tabs[0].Screen.chunks = [('output\n', 1)]
        result = self.adapter.poll('op-1', wait_for='user$')
        self.assertEqual(result['text'], 'output\nuser$')

    def test_stop_restores_native_settings(self):
        screen = self.crt.tabs[0].Screen
        self.adapter.begin(**self.params())
        self.assertTrue(screen.Synchronous)
        self.adapter.end('op-1', confirmed_complete=True)
        self.assertFalse(screen.Synchronous)
        self.assertFalse(screen.IgnoreEscape)
        self.assertNotIn('\x03', screen.sent)

    def test_timeout_quarantines_without_killing_remote(self):
        self.adapter.begin(**self.params()); self.time += 10001
        self.adapter.maintain()
        self.assertFalse(self.crt.tabs[0].Screen.Synchronous)
        with self.assertRaisesRegex(Exception, 'unresolved'):
            self.adapter.begin(**self.params())
        self.assertNotIn('\x03', self.crt.tabs[0].Screen.sent)

    def test_poll_reports_explicit_deadline_after_watchdog_cleanup(self):
        self.adapter.begin(**self.params())
        self.time += 10001
        self.adapter.maintain()
        result = self.adapter.poll('op-1')
        self.assertTrue(result['expired'])
        self.assertEqual(result['text'], '')
        self.assertNotIn('\x03', self.crt.tabs[0].Screen.sent)

    def test_explicit_interrupt_only_for_matching_capture(self):
        self.adapter.begin(**self.params())
        with self.assertRaisesRegex(Exception, 'capture_mismatch'):
            self.adapter.interrupt(self.sid, 'other')
        self.adapter.interrupt(self.sid, 'op-1')
        self.assertEqual(self.crt.tabs[0].Screen.sent[-1], '\x03')
        self.assertTrue(self.adapter.unresolved)

    def test_quarantine_requires_fresh_explicit_idle_ack(self):
        self.adapter.begin(**self.params()); self.adapter.end('op-1', False)
        screen = self.adapter.read_screen(self.sid)
        self.adapter.acknowledge_idle(self.sid, screen['screen_token'], 'user$')
        self.assertFalse(self.adapter.unresolved)

    def test_expired_wire_request_never_dispatches(self):
        req = dict(protocol_version=2, id='test', deadline_ms=self.time - 1,
                   token='a' * 64, method='begin', params=self.params())
        result = namespace['handle_request'](self.adapter, req, 'a' * 64)
        self.assertFalse(result['ok'])
        self.assertIn('expired', result['error'])
        self.assertFalse(self.crt.tabs[0].Screen.sent)

    def test_deadline_rechecked_after_native_screen_validation(self):
        params = self.params()
        original = self.adapter._guard
        def delayed_guard(*args):
            entry = original(*args)
            self.time += 1100
            return entry
        self.adapter._guard = delayed_guard
        request = dict(protocol_version=2, id='test', deadline_ms=self.time + 1000,
                       token='a' * 64, method='begin', params=params)
        response = namespace['handle_request'](self.adapter, request, 'a' * 64)
        self.assertFalse(response['ok'])
        self.assertFalse(self.crt.tabs[0].Screen.sent)

    def test_wrong_token_never_dispatches(self):
        req = dict(protocol_version=2, id='test', deadline_ms=self.time + 1000,
                   token='b' * 64, method='begin', params=self.params())
        result = namespace['handle_request'](self.adapter, req, 'a' * 64)
        self.assertFalse(result['ok'])
        self.assertFalse(self.crt.tabs[0].Screen.sent)

    def test_protocol_mismatch_never_dispatches(self):
        req = dict(protocol_version=1, id='test', deadline_ms=self.time + 1000,
                   token='a' * 64, method='begin', params=self.params())
        self.assertFalse(namespace['handle_request'](self.adapter, req, 'a' * 64)['ok'])
        self.assertFalse(self.crt.tabs[0].Screen.sent)

    def test_echo_controls_are_rejected(self):
        params = self.params(); params['text'] = '\x15printf hello'
        with self.assertRaisesRegex(Exception, 'control'):
            self.adapter.begin(**params)
        self.assertFalse(self.crt.tabs[0].Screen.sent)

    def test_invalid_timeout_rejected(self):
        params = self.params(); params['runtime_ms'] = 0
        with self.assertRaisesRegex(Exception, 'runtime_ms'):
            self.adapter.begin(**params)
        self.assertFalse(self.crt.tabs[0].Screen.sent)


if __name__ == '__main__':
    unittest.main()
