"""Regressions for delivery evidence and ergonomic explicit recovery; no SSH."""
import unittest
from test_bridge import Crt, namespace


class UXAdapterTests(unittest.TestCase):
    def setUp(self):
        self.now = 1000000
        self.crt = Crt()
        self.adapter = namespace['NativeAdapter'](self.crt, now=lambda: self.now)
        self.sid = self.adapter.list_sessions()['sessions'][0]['id']

    def params(self):
        view = self.adapter.read_screen(self.sid)
        return dict(session=self.sid, screen_token=view['screen_token'], expected_prompt='user$',
                    text='printf hello', capture_id='ux-test', runtime_ms=5000)

    def wire(self, method, params):
        req = dict(protocol_version=2, id='wire-test', deadline_ms=self.now+2000,
                   token='a'*64, method=method, params=params)
        return namespace['handle_request'](self.adapter, req, 'a'*64)

    def test_pre_send_rejection_is_explicitly_unsent(self):
        params = self.params(); params['screen_token'] = 'stale'
        result = self.wire('begin', params)
        self.assertFalse(result['ok'])
        self.assertIs(result.get('sent'), False)
        self.assertEqual(result.get('error_code'), 'stale_screen')
        self.assertFalse(self.crt.tabs[0].Screen.sent)

    def test_failed_native_send_is_unknown_not_false(self):
        params = self.params()
        def failed(text):
            self.crt.tabs[0].Screen.sent.append(text)
            raise RuntimeError('native send reported failure after delivery')
        self.crt.tabs[0].Screen.Send = failed
        result = self.wire('begin', params)
        self.assertFalse(result['ok'])
        self.assertIn('sent', result)
        self.assertIsNone(result['sent'])
        self.assertEqual(result.get('error_code'), 'send_unknown')

    def test_explicit_ack_returns_a_new_usable_view(self):
        self.adapter.begin(**self.params()); self.adapter.end('ux-test', False)
        old = self.adapter.read_screen(self.sid)
        result = self.adapter.acknowledge_idle(self.sid, old['screen_token'], 'user$')
        self.assertTrue(result['idle_acknowledged'])
        view = result.get('screen', {})
        self.assertIn('screen_token', view)
        self.assertNotEqual(view['screen_token'], old['screen_token'])
        self.adapter.begin(self.sid, view['screen_token'], 'user$', 'printf again', 'ux-next', 5000)
        self.assertEqual(len(self.crt.tabs[0].Screen.sent), 2)

    def test_idle_read_renews_the_same_native_lease(self):
        self.now += 100000
        self.adapter.read_screen(self.sid)
        self.now += 30000
        self.assertEqual(self.adapter.read_screen(self.sid)['session'], self.sid)


if __name__ == '__main__':
    unittest.main()
