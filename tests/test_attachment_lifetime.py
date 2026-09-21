"""Simulated time proves lease logic; not a real ten-minute SecureCRT desktop test."""
import unittest
from test_bridge import Crt, namespace

class AttachmentLifetimeTests(unittest.TestCase):
    def setUp(self):
        self.time=1000000;self.app=Crt()
        self.adapter=namespace['NativeAdapter'](self.app,now=lambda:self.time)
        self.sid=self.adapter.list_sessions()['sessions'][0]['id']
    def test_heartbeat_keeps_same_native_binding_over_ten_minutes(self):
        view=self.adapter.attach(self.sid,mode='shared',expected_prompt='user$')
        for _ in range(12):
            self.time+=60000;self.adapter.maintain()
            result=self.adapter.heartbeat(view['attachment_id'])
            self.assertEqual(result['session'],self.sid)
            self.assertTrue(result['context_unchanged'])
        self.assertFalse(self.app.tabs[0].Screen.sent)
    def test_expired_attachment_is_not_retargeted(self):
        view=self.adapter.attach(self.sid,expected_prompt='user$')
        self.time+=600001;self.adapter.maintain()
        with self.assertRaisesRegex(Exception,'stale_attachment'):
            self.adapter.heartbeat(view['attachment_id'])
    def test_observe_attachment_never_sends(self):
        view=self.adapter.attach(self.sid,mode='observe',expected_prompt='user$')
        with self.assertRaisesRegex(Exception,'observe'):
            self.adapter.prepare_and_begin(attachment_id=view['attachment_id'],text='printf example',capture_id='test',runtime_ms=5000)
        self.assertFalse(self.app.tabs[0].Screen.sent)
    def test_observed_reconnect_invalidates_attachment(self):
        view=self.adapter.attach(self.sid,expected_prompt='user$')
        self.app.tabs[0].Session.Connected=False;self.adapter.maintain()
        self.app.tabs[0].Session.Connected=True
        with self.assertRaisesRegex(Exception,'stale_attachment'):
            self.adapter.heartbeat(view['attachment_id'])

if __name__=='__main__':unittest.main()
