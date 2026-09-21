"""Native completion marker can precede the next visible prompt. No SSH is used."""
import unittest
from test_bridge import Crt, namespace

class PromptReadinessTests(unittest.TestCase):
    def setUp(self):
        self.app=Crt();self.a=namespace['NativeAdapter'](self.app)
        self.sid=self.a.list_sessions()['sessions'][0]['id']
        self.binding=self.a.attach(self.sid,expected_prompt='user$')
        self.a.prepare_and_begin(attachment_id=self.binding['attachment_id'],text='printf test',
            capture_id='first',runtime_ms=30000,completion_marker='END_owned')
    def end_before_prompt(self):
        self.app.tabs[0].Screen.text='previous output\nEND_owned 0'
        self.a.end('first',True)
    def test_end_marker_must_not_be_adopted_as_next_input_prompt(self):
        self.end_before_prompt()
        count=len(self.app.tabs[0].Screen.sent)
        with self.assertRaisesRegex(Exception,'context_changed'):
            self.a.prepare_and_begin(attachment_id=self.binding['attachment_id'],text='printf next',capture_id='next',runtime_ms=30000)
        self.assertEqual(len(self.app.tabs[0].Screen.sent),count)
    def test_delayed_original_prompt_rebases_only_owned_output_row(self):
        self.end_before_prompt()
        self.app.tabs[0].Screen.text='line one\nline two\nuser$ '
        self.app.tabs[0].Screen.CurrentRow=3
        self.a.prepare_and_begin(attachment_id=self.binding['attachment_id'],text='printf next',capture_id='next',runtime_ms=30000)
        self.assertEqual(self.app.tabs[0].Screen.sent[-1],'printf next\r')
    def test_short_prompt_render_delay_is_waited_without_remote_input(self):
        self.end_before_prompt()
        sleeps=[]
        def pump(ms):
            sleeps.append(ms);self.app.tabs[0].Screen.text='output\nuser$ '
        self.app.Sleep=pump
        self.a.prepare_and_begin(attachment_id=self.binding['attachment_id'],text='printf next',capture_id='next',runtime_ms=30000)
        self.assertTrue(sleeps)
        self.assertEqual(self.app.tabs[0].Screen.sent,['printf test\r','printf next\r'])
    def test_changed_or_partial_prompt_is_not_silently_adopted(self):
        self.end_before_prompt()
        self.app.tabs[0].Screen.text='output\nuser$ partial-command'
        with self.assertRaisesRegex(Exception,'context_changed'):
            self.a.prepare_and_begin(attachment_id=self.binding['attachment_id'],text='printf next',capture_id='next',runtime_ms=30000)
        self.assertEqual(self.app.tabs[0].Screen.sent,['printf test\r'])

if __name__=='__main__':unittest.main()
