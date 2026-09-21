"""Native API doubles only; never contact remote SSH targets."""
import unittest
from test_bridge import Crt, namespace

class PerformanceAdapterTests(unittest.TestCase):
    def setUp(self):
        self.crt = Crt()
        self.now = 1000000
        self.a = namespace['NativeAdapter'](self.crt, now=lambda: self.now)
        self.ids = [s['id'] for s in self.a.list_sessions()['sessions']]

    def start(self, sid, cid):
        view = self.a.read_screen(sid)
        return self.a.begin(session=sid, screen_token=view['screen_token'], expected_prompt='user$',
                            text='printf test', capture_id=cid, runtime_ms=30000)

    def test_multiple_tabs_have_independent_capture_interlocks(self):
        self.start(self.ids[0], 'one')
        self.start(self.ids[1], 'two')
        self.a.end('one', False)
        self.crt.tabs[1].Screen.chunks = [('second-tab-output', 1)]
        self.assertIn('second-tab-output', self.a.poll('two')['text'])
        self.assertNotIn('\x03', self.crt.tabs[0].Screen.sent)

    def test_many_buffered_lines_are_read_in_one_rpc(self):
        self.assertTrue(hasattr(self.a, 'poll_bulk'), 'missing batched native poll')
        self.start(self.ids[0], 'one')
        self.crt.tabs[0].Screen.chunks = [('line-'+str(i), 1) for i in range(512)]
        result = self.a.poll_bulk('one', max_reads=128)
        self.assertGreaterEqual(result['text'].count('\n'), 100)
        self.assertFalse(result['overflow'])

    def test_large_native_line_is_paginated_not_discarded(self):
        self.assertTrue(hasattr(self.a, 'poll_bulk'), 'missing batched native poll')
        self.start(self.ids[0], 'one')
        original = '中' * 70000 + '\n'
        self.crt.tabs[0].Screen.chunks = [(original[:-1], 1)]
        parts=[]
        for _ in range(6):
            result=self.a.poll_bulk('one', max_reads=1)
            parts.append(result['text'])
            self.assertLessEqual(len(result['text'].encode('utf-8')), 65536)
            self.assertFalse(result['overflow'])
            if not result.get('pending_bytes'): break
        self.assertEqual(''.join(parts), original)

    def test_attach_does_not_send_and_prepare_reuses_target(self):
        self.assertTrue(hasattr(self.a, 'attach'), 'missing attachment runtime')
        binding=self.a.attach(self.ids[0], mode='shared', expected_prompt='user$')
        self.assertIn('attachment_id', binding)
        self.assertFalse(self.crt.tabs[0].Screen.sent)
        self.assertIsNone(binding.get('authenticated_host_fingerprint'))
        self.crt.tabs.reverse()
        self.a.prepare_and_begin(attachment_id=binding['attachment_id'], text='printf test',
                                 capture_id='one', runtime_ms=30000)
        self.assertEqual(self.crt.tabs[1].Screen.sent, ['printf test\r'])
        self.assertFalse(self.crt.tabs[0].Screen.sent)

    def test_attachment_detects_changed_input_without_sending(self):
        self.assertTrue(hasattr(self.a, 'attach'), 'missing attachment runtime')
        binding=self.a.attach(self.ids[0], mode='shared', expected_prompt='user$')
        self.crt.tabs[0].Screen.text='ready\nuser$ partial'
        with self.assertRaisesRegex(Exception, 'context_changed'):
            self.a.prepare_and_begin(attachment_id=binding['attachment_id'], text='printf test',
                                     capture_id='one', runtime_ms=30000)
        self.assertFalse(self.crt.tabs[0].Screen.sent)

if __name__ == '__main__': unittest.main()
