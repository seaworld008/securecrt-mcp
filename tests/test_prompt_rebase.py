"""Deterministic native redraw races. Only fake CRT objects; no SSH or sockets."""
import types
import unittest
from unittest.mock import patch

from test_bridge import Crt, namespace


class PromptRebaseTests(unittest.TestCase):
    def setUp(self):
        self.elapsed = 0
        self.app = Crt()
        self.screen = self.app.tabs[0].Screen
        self.frames = []
        self.sleeps = []
        self.during_sleep = None
        clock = types.SimpleNamespace(monotonic=lambda: self.elapsed / 1000,
                                      time=lambda: self.now() / 1000,
                                      sleep=lambda seconds: self.pump(round(seconds * 1000)))
        patcher = patch.dict(namespace, time=clock)
        patcher.start()
        self.addCleanup(patcher.stop)
        self.app.Sleep = self.pump
        self.a = namespace['NativeAdapter'](self.app, now=self.now)
        self.ids = [s['id'] for s in self.a.list_sessions()['sessions']]
        self.sid = self.ids[0]
        self.binding = self.a.attach(self.sid, expected_prompt='user$')
        self.aid = self.binding['attachment_id']
        self.a.prepare_and_begin(attachment_id=self.aid, text='printf first',
                                 capture_id='first', runtime_ms=30000,
                                 completion_marker='END_owned')

    def now(self):
        return 1000000 + self.elapsed

    def view(self, line, column=8, row=2, screen=None, columns=80):
        screen = screen or self.screen
        screen.Rows = max(5, row)
        screen.CurrentRow, screen.CurrentColumn, screen.Columns = row, column, columns
        screen.text = '\n'.join(['unrelated older output'] * (row - 1) + [line])

    def pump(self, ms):
        self.assertGreater(ms, 0)
        self.assertLessEqual(ms, 20)
        # Every sample wait must occur BEFORE the next native Send.
        self.assertEqual(self.screen.sent, ['printf first\r'])
        self.sleeps.append(ms)
        self.elapsed += ms
        if self.frames:
            self.view(*self.frames.pop(0))
        if self.during_sleep:
            self.during_sleep()

    def complete(self, line='', column=1, row=2, confirmed=True):
        self.view(line, column, row)
        self.a.end('first', confirmed)

    def next_request(self, deadline_ms=None, aid=None, cid='next'):
        return namespace['handle_request'](self.a, {
            'id': cid, 'protocol_version': 2, 'token': 'a' * 64,
            'deadline_ms': deadline_ms if deadline_ms is not None else self.now() + 2000,
            'method': 'prepare_and_begin',
            'params': {'attachment_id': aid or self.aid, 'text': 'printf next',
                       'capture_id': cid, 'runtime_ms': 30000,
                       'completion_marker': 'END_next'}}, 'a' * 64)

    def assert_unsent(self, result, code='context_changed'):
        self.assertFalse(result['ok'], result)
        self.assertIs(result['sent'], False, result)
        self.assertIn(code, result['error'], result)
        self.assertEqual(self.screen.sent, ['printf first\r'])
        self.assertNotIn('next', self.a.captures)

    def test_blank_then_prompt_then_column_recovers_without_early_send(self):
        self.complete()
        self.frames = [('user$ ', 1, 3), ('user$ ', 8, 3), ('user$ ', 8, 4)]
        result = self.next_request()
        self.assertTrue(result['ok'], result)
        self.assertIs(result['sent'], True)
        self.assertGreaterEqual(len(self.sleeps), 3)
        self.assertEqual(self.screen.sent, ['printf first\r', 'printf next\r'])
        self.assertEqual(self.a.attachments[self.aid]['context']['cursor_row'], 4)

    def test_first_matching_sample_is_not_sufficient_during_redraw(self):
        self.complete('user$ ', 8, 3)
        self.frames = [('', 1, 4), ('END_owned 0', 12, 4), ('user$ ', 8, 5)]
        result = self.next_request()
        self.assertTrue(result['ok'], result)
        self.assertGreaterEqual(len(self.sleeps), 4, 'accepted a single transient prompt sample')
        self.assertEqual(self.a.attachments[self.aid]['context']['cursor_row'], 5)

    def test_same_prompt_wrong_column_waits_for_the_original_boundary(self):
        self.complete('user$ ', 1)
        self.frames = [('user$ ', 4, 2), ('user$ ', 8, 3)]
        result = self.next_request()
        self.assertTrue(result['ok'], result)
        self.assertGreaterEqual(len(self.sleeps), 3)

    def test_original_prompt_must_be_stable_in_two_samples(self):
        self.complete('user$ ', 8)
        result = self.next_request()
        self.assertTrue(result['ok'], result)
        self.assertGreaterEqual(len(self.sleeps), 1)

    def test_redraw_longer_than_old_200ms_budget_can_complete(self):
        self.complete()
        def delayed_prompt():
            if self.elapsed >= 250:
                self.view('user$ ', 8, 4)
        self.during_sleep = delayed_prompt
        result = self.next_request()
        self.assertTrue(result['ok'], result)
        self.assertGreaterEqual(self.elapsed, 260)
        self.assertLessEqual(self.elapsed, 500)

    def test_realistic_slow_tab_uses_one_safe_readiness_extension(self):
        self.complete()
        def delayed_prompt():
            if self.elapsed >= 900:
                self.view('user$ ', 8, 4)
        self.during_sleep = delayed_prompt
        result = self.next_request()
        self.assertTrue(result['ok'], result)
        self.assertGreaterEqual(self.elapsed, 910)
        self.assertLessEqual(self.elapsed, 1500)
        self.assertEqual(self.a.metrics['prompt_readiness_extensions'], 1)

    def test_only_owned_marker_can_be_waited_on(self):
        self.complete('END_other_capture 0', 8)
        self.frames = [('user$ ', 8, 3)]
        self.assert_unsent(self.next_request())
        self.assertFalse(self.sleeps)

    def test_owned_marker_never_becomes_prompt_and_wait_is_bounded(self):
        self.complete('END_owned 0', 12)
        result = self.next_request()
        self.assert_unsent(result)
        self.assertGreater(self.elapsed, 0)
        self.assertLessEqual(self.elapsed, 1500)
        self.assertEqual(self.a.metrics['prompt_readiness_extensions'], 1)
        self.assertLessEqual(len(self.sleeps), 151)
        self.assertEqual(self.a.attachments[self.aid]['context']['current_line'], 'user$')
        # A NEW explicit invocation after a settled redraw reuses the original binding.
        self.view('user$ ', 8, 4)
        self.assertTrue(self.next_request(cid='explicit-new')['ok'])

    def test_never_accept_marker_with_extra_text_or_invalid_exit_status(self):
        self.complete()
        for line in ['END_owned 0 pwd', 'END_owned 999', 'END_owned -1', 'END_owned ٠']:
            with self.subTest(line=line):
                self.view(line)
                self.a.attachments[self.aid]['awaiting_prompt'] = True
                self.a.attachments[self.aid]['completion_marker'] = 'END_owned'
                self.assert_unsent(self.next_request())
        self.assertFalse(self.sleeps)

    def test_unsafe_or_changed_prompt_rejects_without_waiting_for_erasure(self):
        self.complete()
        for line in ['user$ pwd', 'Password:', 'Passphrase for key:', '--More--',
                     'mysql>', '>>>', 'vim -- INSERT --', 'root@other#', 'unknown output']:
            with self.subTest(line=line):
                self.view(line)
                self.frames = [('user$ ', 8, 3)]
                self.assert_unsent(self.next_request())
        self.assertFalse(self.sleeps)

    def test_half_typed_input_arriving_during_wait_is_rejected(self):
        self.complete()
        self.frames = [('user$ partial-command', 24, 2), ('user$ ', 8, 2)]
        self.assert_unsent(self.next_request())
        self.assertEqual(len(self.sleeps), 1)

    def test_hidden_trailing_input_space_is_not_a_ready_prompt(self):
        self.complete('user$   ', 9)
        self.frames = [('user$ ', 8, 2)]
        self.assert_unsent(self.next_request())
        self.assertFalse(self.sleeps)

    def test_resized_terminal_is_not_silently_rebased(self):
        self.complete('user$ ', 8)
        self.screen.Columns = 100
        self.assert_unsent(self.next_request())
        self.assertFalse(self.sleeps)

    def test_request_deadline_caps_redraw_wait_and_sends_nothing(self):
        self.complete()
        self.assert_unsent(self.next_request(deadline_ms=self.now() + 20), 'expired')
        self.assertLessEqual(self.elapsed, 20)

    def test_disconnect_during_redraw_rejects_before_send(self):
        self.complete()
        self.frames = [('user$ ', 8, 3)]
        self.during_sleep = lambda: setattr(self.app.tabs[0].Session, 'Connected', False)
        self.assert_unsent(self.next_request(), 'stale_attachment')

    def test_lease_expiring_during_redraw_is_not_renewed_by_guessing(self):
        self.complete()
        self.frames = [('user$ ', 8, 3)]
        self.during_sleep = lambda: self.a.attachments[self.aid].update(expires=self.now() - 1)
        self.assert_unsent(self.next_request(), 'stale_attachment')

    def test_confirmed_complete_without_marker_does_not_authorize_rebase(self):
        self.a.captures['first']['completion_marker'] = None
        self.complete('user$ ', 8, 3)
        self.assert_unsent(self.next_request())
        self.assertFalse(self.sleeps)

    def test_unknown_completion_never_rebases_or_replays(self):
        self.complete('user$ ', 8, 3, confirmed=False)
        self.assert_unsent(self.next_request(), 'unresolved')
        self.assertFalse(self.sleeps)
        self.assertIn(self.sid, self.a.unresolved_sessions)

    def test_capture_timeout_never_rebases_or_replays(self):
        self.elapsed += 30001
        self.a.maintain()
        self.view('user$ ', 8, 3)
        self.assert_unsent(self.next_request(), 'unresolved')
        self.assertFalse(self.sleeps)

    def test_idle_row_change_without_owned_completion_remains_strict(self):
        aid = self.a.attach(self.ids[1], expected_prompt='user$')['attachment_id']
        second = self.app.tabs[1].Screen
        self.view('user$ ', 8, 3, screen=second)
        self.assert_unsent(self.next_request(aid=aid))
        self.assertFalse(second.sent)

    def test_two_tab_completions_do_not_share_rebase_context(self):
        aid = self.a.attach(self.ids[1], expected_prompt='user$')['attachment_id']
        second = self.app.tabs[1].Screen
        self.a.prepare_and_begin(attachment_id=aid, text='printf second-tab',
                                 capture_id='second', runtime_ms=30000, completion_marker='END_second')
        self.complete()
        self.frames = [('user$ ', 8, 4)]
        result = self.next_request()
        self.assertTrue(result['ok'], result)
        self.assertIn('second', self.a.captures)
        self.assertEqual(second.sent, ['printf second-tab\r'])
        self.view('END_owned 0', 8, screen=second)
        self.a.end('second', True)
        result = self.next_request(aid=aid, cid='other-next')
        self.assertFalse(result['ok'], result)
        self.assertIs(result['sent'], False)
        self.assertIn('context_changed', result['error'])
        self.assertEqual(second.sent, ['printf second-tab\r'])

    def test_observe_never_gains_write_access_from_completion(self):
        self.complete('user$ ', 8)
        aid = self.a.attach(self.sid, mode='observe')['attachment_id']
        self.assert_unsent(self.next_request(aid=aid), 'observe')
        self.assertFalse(self.sleeps)

    def test_shared_and_exclusive_use_same_readiness_not_new_permission_model(self):
        # Other ownership regression tests cover exclusion of a different connector.
        self.a.attachments[self.aid]['mode'] = 'exclusive'
        self.complete()
        self.frames = [('user$ ', 8, 3)]
        self.assertTrue(self.next_request()['ok'])
        self.assertFalse(self.binding['native_keyboard_lock'])


if __name__ == '__main__':
    unittest.main()
