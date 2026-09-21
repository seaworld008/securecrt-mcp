"""Regression review of attachment authority and output batching."""
import unittest
from test_perf_bridge import PerformanceAdapterTests

class NativeReviewTests(PerformanceAdapterTests):
    def test_pending_native_chunk_is_drained_without_another_wait(self):
        self.start(self.ids[0],'one')
        self.crt.tabs[0].Screen.chunks=[('x'*70000,1)]
        first=self.a.poll_bulk('one',max_reads=1)
        self.assertTrue(first['pending_bytes'])
        def unexpected(*args):self.fail('pending data triggered another native wait')
        self.crt.tabs[0].Screen.ReadString=unexpected
        result=self.a.poll_bulk('one')
        self.assertEqual(len(first['text'])+len(result['text']),70001)

    def test_observe_cannot_interrupt_another_owners_capture(self):
        self.a.owner='writer'
        self.start(self.ids[0],'one')
        self.a.owner='reader'
        with self.assertRaisesRegex(Exception,'ownership_conflict'):
            self.a.interrupt(self.ids[0],'one')
        self.assertNotIn('\x03',self.crt.tabs[0].Screen.sent)

    def test_observe_cannot_end_another_owners_capture(self):
        self.a.owner='writer';self.start(self.ids[0],'one')
        self.a.owner='reader'
        # Public wire method must enforce owner; maintenance is an internal cleanup path.
        request=dict(id='x',token='a'*64,protocol_version=2,client_id='reader',deadline_ms=self.now+1000,
                     method='end',params=dict(capture_id='one',confirmed_complete=True))
        response=self.a.__class__.__module__
        from test_bridge import namespace
        value=namespace['handle_request'](self.a,request,'a'*64)
        self.assertFalse(value['ok'])
        self.assertIn('one',self.a.captures)

    def test_exclusive_blocks_other_connector_but_not_claimed_keyboard_lock(self):
        self.a.owner='writer'
        a=self.a.attach(self.ids[0],mode='exclusive',expected_prompt='user$')
        self.assertFalse(a['native_keyboard_lock'])
        self.a.owner='reader'
        with self.assertRaisesRegex(Exception,'ownership_conflict'):self.start(self.ids[0],'one')
        self.assertFalse(self.crt.tabs[0].Screen.sent)

if __name__=='__main__':unittest.main()
