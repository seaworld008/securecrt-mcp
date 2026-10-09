#!/usr/bin/env node
"use strict";
// The only interpreter boundary: exercise the actual Mac-only SecureCRT Python SDK adapter.
// These are native API doubles/contracts, not Python implementations of Node controllers.
const { spawn } = require("node:child_process");
const { ROOT } = require("./node_harness");
const nativeFixture = String.raw`import sys
"""Native SecureCRT calls are faked; no sockets or remote hosts are contacted."""
import importlib.util
from pathlib import Path
import socket
import threading
import time
import unittest

PATH = Path(sys.argv[1]) / 'bridge' / 'securecrt_bridge.py'
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

    def Sleep(self, milliseconds):
        pass


`;
// Each interpreter receives fresh globals from one shared native SDK fixture.
const nativeContract =
  nativeFixture +
  String.raw`class AdapterTests(unittest.TestCase):
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

    def test_attachment_expected_prompt_rejects_before_send(self):
        attachment = self.adapter.attach(self.sid, expected_prompt='user$')
        with self.assertRaisesRegex(Exception, 'prompt_mismatch'):
            self.adapter.prepare_and_begin(
                text='printf should-not-send', capture_id='attachment-op',
                runtime_ms=10000, attachment_id=attachment['attachment_id'],
                expected_prompt='root#')
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


class TablessStartupTests(unittest.TestCase):
    def test_listener_starts_without_tabs_or_ui_sleep(self):
        class NoTabApp:
            def GetTabCount(self):
                return 0

            def Sleep(self, milliseconds):
                raise RuntimeError('no active SecureCRT tab')

            class Dialog:
                @staticmethod
                def MessageBox(message, title):
                    raise RuntimeError('dialog unavailable without a tab')

        probe = socket.socket()
        probe.bind(('127.0.0.1', 0))
        port = probe.getsockname()[1]
        probe.close()
        stop = threading.Event()
        error = []
        config = {'host': '127.0.0.1', 'port': port, 'token': 't' * 64}

        def run():
            try:
                namespace['serve'](NoTabApp(), config, stop)
            except Exception as exc:
                error.append(exc)

        thread = threading.Thread(target=run, daemon=True)
        thread.start()
        connected = False
        for _ in range(100):
            client = socket.socket()
            try:
                client.settimeout(0.05)
                client.connect(('127.0.0.1', port))
                connected = True
                break
            except OSError:
                time.sleep(0.01)
            finally:
                client.close()
        stop.set()
        thread.join(1)
        self.assertTrue(connected)
        self.assertFalse(error, error)



"""Simulated time proves lease logic; not a real ten-minute SecureCRT desktop test."""
import unittest


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


"""Native API doubles only; never contact remote SSH targets."""
import unittest


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


"""Regressions for delivery evidence and ergonomic explicit recovery; no SSH."""
import unittest



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



"""Regression review of attachment authority and output batching."""
import unittest


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


"""Deterministic native redraw races. Only fake CRT objects; no SSH or sockets."""
import types
import unittest
from unittest.mock import patch



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
        self.elapsed = 0  # Redraw budgets below measure time after attachment.
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
        if not self.screen.sent:
            self.assertFalse(self.frames)
            self.elapsed += ms
            return  # The initial attachment also requires a stable frame.
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



"""Native completion marker can precede the next visible prompt. No SSH is used."""
import unittest


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

class QueuedPromptTests(unittest.TestCase):
    def test_completed_capture_drains_pre_display_prompt_before_reuse(self):
        app=Crt();a=namespace['NativeAdapter'](app)
        sid=a.list_sessions()['sessions'][1]['id']
        binding=a.attach(sid,expected_prompt='user$')
        screen=app.tabs[1].Screen
        a.prepare_and_begin(attachment_id=binding['attachment_id'],text='printf one',capture_id='one',runtime_ms=10000,completion_marker='END_one')
        screen.text='output\nEND_one 0'
        reads=[]
        def read(patterns,seconds):
            reads.append((patterns,seconds))
            if patterns==['user$ ']:
                screen.text='output\nuser$ '
                screen.MatchIndex=1
            return ''
        screen.ReadString=read
        a.end('one',True)
        self.assertEqual(reads,[(['user$ '],1)])
        a.prepare_and_begin(attachment_id=binding['attachment_id'],text='printf two',capture_id='two',runtime_ms=10000)
        self.assertEqual(screen.sent,['printf one\r','printf two\r'])
        self.assertFalse(app.tabs[0].Screen.sent)

class CompletePrefixTests(unittest.TestCase):
    def test_same_visible_prompt_still_drains_queued_final_space(self):
        class PreciseScreen(Screen):
            Rows=1;CurrentRow=1;CurrentColumn=7
            def __init__(self):
                super().__init__();self.text='demo$ ';self.reads=[]
            def Get2(self,row,column,end,last):
                # SecureCRT Mac appends a synthetic row newline even to single-row Get2.
                return self.text[column-1:last]+'\n'
            def ReadString(self,patterns,seconds):
                self.reads.append((patterns,seconds))
                if patterns==['demo$ ']:
                    self.text='demo$ ';self.CurrentColumn=7;self.MatchIndex=1
                return ''
        app=Crt();screen=PreciseScreen();app.tabs[1].Screen=screen
        adapter=namespace['NativeAdapter'](app)
        sid=adapter.list_sessions()['sessions'][1]['id']
        binding=adapter.attach(sid,expected_prompt='demo$')
        self.assertEqual(screen.reads,[],'startup must not unconditionally drain remote input')
        adapter.prepare_and_begin(attachment_id=binding['attachment_id'],text='printf first',capture_id='owned',runtime_ms=10000,completion_marker='END_owned')
        screen.text='demo$';screen.CurrentColumn=6
        adapter.end('owned',True)
        self.assertEqual(screen.reads,[(['demo$ '],1)])
        self.assertEqual(screen.CurrentColumn,7)
        self.assertEqual(screen.sent,['printf first\r'])
        self.assertFalse(app.tabs[0].Screen.sent)
        self.assertEqual(adapter._input(adapter._session(sid))['input_prefix'],'demo$ ')
        adapter.prepare_and_begin(attachment_id=binding['attachment_id'],text='printf second',capture_id='second',runtime_ms=10000)
        self.assertEqual(screen.sent,['printf first\r','printf second\r'])

class AtomicScreenTests(unittest.TestCase):
    def test_input_cursor_is_sampled_after_get2_pumps_rendering(self):
        app=Crt();a=namespace['NativeAdapter'](app)
        sid=a.list_sessions()['sessions'][1]['id']
        screen=app.tabs[1].Screen
        screen.CurrentColumn=6
        old=screen.Get2
        def get(*args):
            screen.CurrentColumn=7
            return old(*args)
        screen.Get2=get
        view=a._input(a._session(sid))
        self.assertEqual(view['cursor_column'],7)
    def test_full_screen_and_input_token_use_one_stable_frame(self):
        app=Crt();a=namespace['NativeAdapter'](app)
        sid=a.list_sessions()['sessions'][0]['id']
        screen=app.tabs[0].Screen
        old=screen.Get2
        calls=[]
        def get(*args):
            value=old(*args)
            calls.append(args)
            if len(calls)==1:screen.text='new output\nuser$ '
            return value
        screen.Get2=get
        view=a.read_screen(sid)
        self.assertEqual(view['text'],'new output\nuser$ ')
        a._guard(sid,view['screen_token'],'user$')

class InitialPromptStabilityTests(unittest.TestCase):
    def test_attachment_waits_for_trailing_prompt_space_before_binding(self):
        app=Crt();a=namespace['NativeAdapter'](app)
        sid=a.list_sessions()['sessions'][1]['id'];screen=app.tabs[1].Screen
        screen.CurrentColumn=6
        app.Sleep=lambda ms:setattr(screen,'CurrentColumn',7)
        binding=a.attach(sid,expected_prompt='user$')
        self.assertEqual(a.attachments[binding['attachment_id']]['context']['cursor_column'],7)
        self.assertFalse(screen.sent)

class CapabilityProbeTests(unittest.TestCase):
    def app(self):
        class ProbeScreen:
            Get2=ReadString=Send=lambda *a: (_ for _ in ()).throw(AssertionError('probe invoked terminal I/O'))
            CurrentRow=CurrentColumn=Rows=Columns=MatchIndex=1
            Synchronous=IgnoreEscape=False
        class ProbeSession:
            Connected=True
        class ProbeTab:
            Screen=ProbeScreen();Session=ProbeSession();Caption='fixture';Index=1
        class ProbeApp:
            Version='fixture';Sleep=lambda *a:None
            GetTabCount=lambda *a:1
            GetTab=lambda *a:ProbeTab()
        return ProbeApp()
    def test_capability_probe_is_read_only(self):
        result=namespace['probe_capabilities'](self.app())
        self.assertIs(result['tab.Screen.Send'],True)
        self.assertIs(result['tab.Screen.Get2'],True)
        self.assertIs(result['tab.Screen.Synchronous'],True)
        self.assertIs(result['tab.Session.Config.GetOption'],False)
    def test_tabless_probe_reports_unknown(self):
        app=self.app();app.GetTabCount=lambda:0
        result=namespace['probe_capabilities'](app)
        self.assertIs(result['crt.GetTabCount'],True)
        self.assertIsNone(result['tab.Screen.Get2'])

unittest.main(argv=["mac-native-contract"], verbosity=2)
`;
const nativeWorker =
  nativeFixture +
  String.raw`import json,re,os

class BufferedScreen(Screen):
    def __init__(self):
        super().__init__()
        self.buffer=''; self.ready=0; self.native_calls=0
    def Send(self,text):
        self.sent.append(text)
        if text=='\x03': self.buffer=''; return
        begin=re.search(r'MCP_BEGIN_[a-f0-9]+',text)
        end=re.search(r'MCP_END_[a-f0-9]+',text)
        if begin and end:
            output=('log-line '+ 'x'*118+'\n')*1600 if 'many-lines' in text else ('中'*70000 if 'long-line' in text else 'hello')
            self.buffer='echoed envelope\n'+begin[0]+'\n'+output+'\n'+end[0]+' 0\n'
        else:
            self.buffer='stream-data\n'
        self.ready=time.monotonic()+(0.2 if 'slow-command' in text else 0)
    def ReadString(self,patterns,seconds):
        assert seconds==1
        self.native_calls+=1
        if time.monotonic()<self.ready:
            time.sleep(0.001); self.MatchIndex=0; return ''
        positions=[(self.buffer.find(p),i,p) for i,p in enumerate(patterns) if p in self.buffer]
        if positions:
            at,i,p=min(positions)
            value=self.buffer[:at]; self.buffer=self.buffer[at+len(p):]; self.MatchIndex=i+1; return value
        value,self.buffer=self.buffer,'';self.MatchIndex=0
        if not value: time.sleep(0.001)
        return value

class App(Crt):
    class Dialog:
        @staticmethod
        def MessageBox(*args): pass
    def __init__(self,stop):
        super().__init__();self.stop=stop
        self.tabs.append(Tab(self,'test-c'))
        for tab in self.tabs: tab.Screen=BufferedScreen()
    def Sleep(self,ms):
        if self.stop.is_set(): raise RuntimeError('test stop')
        time.sleep(ms/1000)

class RepaintingScreen(BufferedScreen):
    def __init__(self):
        super().__init__()
        self.completion_marker = None
        self.frames = []
        self.ready_samples = 0
        self.commands = []
        self.redraw_mode = 'normal'
        self.redraw_waits = 0
        self.premature_sends = []
        self.assert_readiness = False

    def show(self, line, column, row):
        self.CurrentColumn, self.CurrentRow = column, row
        self.Rows = max(5, row)
        self.text = '\n'.join(['prior unrelated output'] * (row - 1) + [line])
        self.ready_samples = 0

    def Get2(self, start, col, end, last):
        result = super().Get2(start, col, end, last)
        if start == end == self.CurrentRow and result.rstrip() == 'user$' and self.CurrentColumn == 8:
            self.ready_samples += 1
        return result

    def Send(self, text):
        if self.assert_readiness:
            line = self.text.split('\n')[self.CurrentRow - 1].rstrip()
            if self.frames or line != 'user$' or self.CurrentColumn != 8 or self.ready_samples < 2:
                self.premature_sends.append(text)
                raise AssertionError('native Send happened before two ready input samples')
        self.sent.append(text)
        begin = re.search(r'MCP_BEGIN_[a-f0-9]+', text)
        end = re.search(r'MCP_END_[a-f0-9]+', text)
        assert begin and end, 'this fixture only accepts POSIX command envelopes'
        command = re.search(r"; eval '([^']*)';", text).group(1)
        self.commands.append(command)
        self.completion_marker = end[0]
        self.assert_readiness = False
        self.ready_samples = 0
        self.buffer = 'echoed envelope\n' + begin[0] + '\n' + command + '-output\n'
        if command != 'never-completes':
            self.buffer += end[0] + ' 0\n'

    def ReadString(self, patterns, seconds):
        value = super().ReadString(patterns, seconds)
        if self.completion_marker and value == self.completion_marker + ' 0':
            self.assert_readiness = True
            if self.redraw_mode == 'half-input':
                self.show('user$ partial-command', 24, 2)
            elif self.redraw_mode == 'foreign-marker':
                self.show('MCP_END_other_session 0', 24, 2)
            else:
                self.show('', 1, 3)
                self.frames = [('user$ ', 1, 3), ('user$ ', 8, 4)]
        return value

    def advance_redraw(self):
        if self.frames:
            self.redraw_waits += 1
            self.show(*self.frames.pop(0))


class RepaintingApp(App):
    def __init__(self, stop):
        super().__init__(stop)
        for tab in self.tabs:
            tab.Screen = RepaintingScreen()

    def Sleep(self, ms):
        # The server's 1ms service yield does not hide the race. Native prompt redraw
        # progresses only while the guard explicitly yields for readiness.
        if ms >= 5:
            for tab in self.tabs:
                tab.Screen.advance_redraw()
        super().Sleep(ms)



home=Path(sys.argv[2]); secret=json.loads((home/'bridge.json').read_text())
stop=threading.Event();app=RepaintingApp(stop)
original=namespace['handle_request']
def handle(adapter,request,token):
    if request.get('method')=='developer_native_fixture':
        assert request['token']==token
        p=request.get('params',{})
        if 'mode' in p:app.tabs[p.get('tab',0)].Screen.redraw_mode=p['mode']
        if p.get('buffered'):
            screen=BufferedScreen();screen.advance_redraw=lambda:None
            app.tabs[p.get('tab',0)].Screen=screen
        return dict(protocol_version=2,bridge_instance=adapter.instance,id=request['id'],ok=True,
            result={'tabs':[{'commands':getattr(s.Screen,'commands',[]),'premature':getattr(s.Screen,'premature_sends',[]),
                'redraw_waits':getattr(s.Screen,'redraw_waits',0),'sent':s.Screen.sent} for s in app.tabs]},error=None)
    return original(adapter,request,token)
namespace['handle_request']=handle
try:namespace['serve'](app,secret)
except Exception as error:
    print(type(error).__name__,file=sys.stderr);raise
`;
async function run() {
  return new Promise((resolve, reject) => {
    const proc = spawn(
      process.env.SECURECRT_TEST_PYTHON || "python3",
      ["-c", nativeContract, ROOT],
      { stdio: "inherit" },
    );
    proc.on("error", reject);
    proc.on("exit", (code) =>
      code === 0
        ? resolve()
        : reject(new Error("Mac native contract failed " + code)),
    );
  });
}
if (require.main === module)
  run()
    .then(() => (process.argv[2] ? compiledNative(process.argv[2]) : null))
    .catch((e) => {
      console.error(e.message);
      process.exitCode = 1;
    });
module.exports = { run, compiledNative };
// Node owns the compiled MCP controller; Python is limited to the actual native SDK fixture.
async function compiledNative(binary) {
  const fs = require("node:fs"),
    path = require("node:path"),
    os = require("node:os"),
    net = require("node:net"),
    crypto = require("node:crypto"),
    {
      MCP,
      command,
      readJSON,
      writeJSON,
      sleep,
      assert,
    } = require("./node_harness");
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "mac-native-node-")),
    env = { ...process.env, SECURECRT_MCP_HOME: home };
  let worker, mcp;
  try {
    assert.equal((await command(binary, ["init"], env)).code, 0);
    const free = net.createServer();
    await new Promise((r) => free.listen(0, "127.0.0.1", r));
    const port = free.address().port;
    await new Promise((r) => free.close(r));
    const secret = readJSON(path.join(home, "bridge.json"));
    secret.port = port;
    writeJSON(path.join(home, "bridge.json"), secret);
    const cfg = path.join(home, "config.toml");
    fs.writeFileSync(
      cfg,
      fs.readFileSync(cfg, "utf8").replace("port = 27855", "port = " + port),
    );
    worker = spawn(
      process.env.SECURECRT_TEST_PYTHON || "python3",
      ["-c", nativeWorker, ROOT, home],
      { stdio: ["ignore", "ignore", "pipe"], env },
    );
    let errors = "";
    worker.stderr.on("data", (b) => (errors += b));
    const until = Date.now() + 5000;
    while (true) {
      try {
        await new Promise((resolve, reject) => {
          const socket = net.createConnection({ host: "127.0.0.1", port });
          socket.once("connect", () => {
            socket.destroy();
            resolve();
          });
          socket.once("error", reject);
        });
        break;
      } catch {
        assert(
          worker.exitCode === null && Date.now() < until,
          "native fixture startup failed: " + errors,
        );
        await sleep(20);
      }
    }
    async function debug(params = {}) {
      return new Promise((resolve, reject) => {
        const socket = net.createConnection({ host: "127.0.0.1", port }),
          id = crypto.randomUUID();
        let buffer = "";
        socket.once("error", reject);
        socket.once("connect", () =>
          socket.write(
            JSON.stringify({
              protocol_version: 2,
              id,
              token: secret.token,
              client_id: "developer-node",
              deadline_ms: Date.now() + 3000,
              method: "developer_native_fixture",
              params,
            }) + "\n",
          ),
        );
        socket.on("data", (b) => {
          buffer += b;
          const i = buffer.indexOf("\n");
          if (i >= 0) {
            socket.destroy();
            try {
              const value = JSON.parse(buffer.slice(0, i));
              assert(value.id === id && value.ok);
              resolve(value.result);
            } catch (e) {
              reject(e);
            }
          }
        });
      });
    }
    mcp = await new MCP(binary, env).start();
    const targets = (await mcp.tool("connector_list")).securecrt.map(
        (x) => x.id,
      ),
      sid = (
        await mcp.tool("connector_open", {
          backend: "securecrt",
          target: targets[0],
          mode: "exec",
        })
      ).session_id;
    const exec = (command, extra = {}) =>
      mcp.tool("connector_exec", {
        session_id: sid,
        command,
        mode: "posix",
        wait_ms: 10000,
        ...extra,
      });
    for (const cmd of ["hostname", "uptime", "pwd"]) {
      const v = await exec(cmd);
      assert.equal(v.state, "completed");
      assert.equal(v.exit_code, 0);
      assert.equal(v.text, cmd + "-output\n");
    }
    let batch = await mcp.tool("connector_exec_batch", {
      session_id: sid,
      commands: ["hostname", "uptime", "df -h /"],
      operation_id: "native-readiness",
    });
    while (batch.state === "running") {
      await sleep(10);
      batch = await mcp.tool("connector_get_batch_status", {
        batch_id: batch.batch_id,
      });
    }
    assert.equal(batch.state, "completed");
    assert.equal(batch.results.length, 3);
    for (let i = 0; i < 3; i++) {
      assert.equal(batch.results[i].index, i);
      assert.equal(batch.results[i].sent, true);
      assert.equal(batch.results[i].exit_code, 0);
    }
    let snapshot = await debug();
    assert.deepEqual(snapshot.tabs[0].commands, [
      "hostname",
      "uptime",
      "pwd",
      "hostname",
      "uptime",
      "df -h /",
    ]);
    assert.equal(snapshot.tabs[0].premature.length, 0);
    assert(snapshot.tabs[0].redraw_waits >= 4);
    const audit = fs
      .readFileSync(path.join(home, "audit.jsonl"), "utf8")
      .trim()
      .split("\n")
      .map(JSON.parse);
    for (const result of batch.results) {
      const records = audit.filter((r) => r.command_id === result.command_id);
      assert.equal(
        records.filter((r) => r.event === "dispatch_attempt").length,
        1,
      );
      assert.equal(
        records.filter((r) => r.event === "terminal_state").length,
        1,
      );
    }
    await debug({ mode: "half-input" });
    batch = await mcp.tool("connector_exec_batch", {
      session_id: sid,
      commands: ["hostname", "uptime", "pwd"],
      operation_id: "typed-input-stop",
      on_error: "continue",
    });
    while (batch.state === "running") {
      await sleep(10);
      batch = await mcp.tool("connector_get_batch_status", {
        batch_id: batch.batch_id,
      });
    }
    assert.equal(batch.state, "stopped");
    assert.equal(batch.results.length, 2);
    assert.equal(batch.results[1].state, "rejected");
    assert.equal(batch.results[1].sent, false);
    assert.equal(batch.results[1].error_code, "context_changed");
    snapshot = await debug();
    assert.equal(snapshot.tabs[0].commands.length, 7);
    assert.equal(snapshot.tabs[0].premature.length, 0);
    const peer = (
      await mcp.tool("connector_open", {
        backend: "securecrt",
        target: targets[1],
        mode: "exec",
      })
    ).session_id;
    const peerResult = await mcp.tool("connector_exec", {
      session_id: peer,
      command: "pwd",
      mode: "posix",
      wait_ms: 10000,
    });
    assert.equal(peerResult.state, "completed");
    const timeout = await mcp.tool("connector_exec", {
      session_id: peer,
      command: "never-completes",
      mode: "posix",
      timeout_ms: 1000,
      wait_ms: 10000,
    });
    assert.equal(timeout.state, "timed_out");
    await mcp.tool(
      "connector_exec",
      { session_id: peer, command: "pwd", mode: "posix" },
      true,
    );
    snapshot = await debug();
    assert.deepEqual(snapshot.tabs[1].commands, ["pwd", "never-completes"]);
    assert(
      snapshot.tabs.every(
        (t) => t.premature.length === 0 && !t.sent.includes("\x03"),
      ),
    );
    // Retain the original performance boundary: real Rust/TCP/native adapter,
    // already buffered SDK doubles, and exact long UTF-8 rows without replay.
    await debug({ buffered: true, tab: 2 });
    const buffered = (
      await mcp.tool("connector_open", {
        backend: "securecrt",
        target: targets[2],
        mode: "exec",
      })
    ).session_id;
    async function collect(command) {
      const job = await mcp.tool("connector_exec", {
        session_id: buffered,
        command,
        mode: "posix",
        wait_ms: 10000,
        timeout_ms: 20000,
      });
      assert.equal(job.state, "completed");
      assert.equal(job.exit_code, 0);
      let cursor = 0,
        text = "",
        pages = 0;
      do {
        const page = await mcp.tool("connector_read", {
          command_id: job.command_id,
          cursor,
          max_bytes: 65536,
        });
        text += page.text;
        cursor = page.next_cursor;
        assert(++pages < 100);
      } while (cursor !== null);
      assert.equal(job.truncated, false);
      return { job, text, pages };
    }
    const many = await collect("many-lines");
    assert.equal(many.text.split("log-line ").length - 1, 1600);
    assert(Buffer.byteLength(many.text) > 100000);
    assert(
      many.job.timing.poll_calls < 100,
      "native still using one RPC per output line",
    );
    const long = await collect("long-line");
    assert(
      long.text === "中".repeat(70000) + "\n",
      "native long UTF-8 line lost/duplicated bytes",
    );
    console.log(
      "PASS: actual Mac SDK adapter bulk capture, 1600 rows/210000 UTF-8 bytes, exact native output and bounded poll RPC count",
    );
    console.log(
      "PASS: compiled MCP / actual Mac adapter / deterministic native redraw: sequential reuse, batch output+exit+audit, typed input stop even on continue, independent Tab, timeout no replay",
    );
  } finally {
    if (mcp) await mcp.close();
    if (worker) {
      worker.kill();
      await new Promise((r) => {
        if (worker.exitCode !== null) r();
        else worker.once("exit", r);
      });
    }
    fs.rmSync(home, { recursive: true, force: true });
  }
}
