"""Compiled MCP -> real TCP/adapter -> deterministic repainting CRT doubles.

Never executes a shell or connects to SSH. Fake output deliberately reproduces the
marker -> blank -> original prompt with stale column -> ready prompt transition.
"""
import hashlib
import json
import re
import sys
import time
from unittest.mock import patch

import performance_smoke as perf


class RepaintingScreen(perf.BufferedScreen):
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


class RepaintingApp(perf.App):
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


def harness(binary):
    with patch.object(perf, 'App', RepaintingApp):
        return perf.Harness(binary)


def attach_all(h):
    sessions = h.mcp.tool('list_sessions')['sessions']
    return [(s['id'], h.mcp.tool('attach', {'session': s['id'], 'mode': 'shared',
                                         'expected_prompt': 'user$'})['attachment_id'])
            for s in sessions]


def exec_one(h, aid, command, **extra):
    return h.mcp.tool('exec', dict(attachment_id=aid, command=command, mode='posix', **extra))


def batch_done(h, batch):
    until = time.monotonic() + 8
    while time.monotonic() < until:
        result = h.mcp.tool('get_batch_status', {'batch_id': batch['batch_id']})
        if result['state'] != 'running':
            return result
        time.sleep(0.01)
    raise AssertionError('batch did not finish within fixture budget')


def check_audit(h, results, commands, sid):
    until = time.monotonic() + 2
    while True:
        records = []
        for path in h.root.rglob('*.jsonl'):
            records.extend(json.loads(line) for line in path.read_text(encoding='utf-8').splitlines())
        terminal_ids = {r.get('command_id') for r in records if r.get('event') == 'terminal_state'}
        if all(r['command_id'] in terminal_ids for r in results):
            break
        assert time.monotonic() < until, 'audit terminal records missing'
        time.sleep(0.01)
    for result, command in zip(results, commands):
        entries = [r for r in records if r.get('command_id') == result['command_id']]
        assert sum(r['event'] == 'dispatch_attempt' for r in entries) == 1, entries
        assert sum(r['event'] == 'terminal_state' for r in entries) == 1, entries
        attempt = next(r for r in entries if r['event'] == 'dispatch_attempt')
        assert attempt['command_sha256'] == hashlib.sha256(command.encode()).hexdigest(), attempt
        assert attempt['session'] == sid, attempt


def run(binary):
    h = harness(binary)
    try:
        sid, aid = attach_all(h)[0]
        commands = ['hostname', 'uptime', 'pwd']
        results = [exec_one(h, aid, command) for command in commands]
        assert all(r['state'] == 'completed' and r['exit_code'] == 0 for r in results), results
        screen = h.app.tabs[0].Screen
        assert screen.commands == commands and not screen.premature_sends
        assert screen.redraw_waits >= 4
        # No new attachment or sessions call between commands or before this batch.
        commands = ['hostname', 'uptime', 'df -h /']
        batch = h.mcp.tool('exec_batch', {'attachment_id': aid, 'commands': commands,
                                        'on_error': 'stop', 'operation_id': 'three-readiness-commands'})
        result = batch_done(h, batch)
        assert result['state'] == 'completed' and len(result['results']) == 3, result
        results = result['results']
        assert len({r['command_id'] for r in results}) == 3
        for index, (r, command) in enumerate(zip(results, commands)):
            assert r['index'] == index and r['session'] == sid and r['sent'] is True, r
            assert r['exit_code'] == 0 and r['text'] == command + '-output\n', r
        check_audit(h, results, commands, sid)
        assert screen.commands == ['hostname', 'uptime', 'pwd'] + commands
        assert not screen.premature_sends
    finally:
        h.close()

    h = harness(binary)
    try:
        sid, aid = attach_all(h)[0]
        h.app.tabs[0].Screen.redraw_mode = 'half-input'
        result = batch_done(h, h.mcp.tool('exec_batch', {
            'attachment_id': aid, 'commands': ['hostname', 'uptime', 'df -h /'],
            'on_error': 'continue', 'operation_id': 'uncertain-second-context'}))
        assert result['state'] == 'stopped' and len(result['results']) == 2, result
        first, refused = result['results']
        assert first['state'] == 'completed' and first['exit_code'] == 0
        assert refused['state'] == 'rejected' and refused['sent'] is False, refused
        assert refused['error_code'] == 'context_changed' and refused['action'], refused
        assert not refused['requires_idle_ack'], refused
        assert h.app.tabs[0].Screen.commands == ['hostname']
        assert not h.app.tabs[0].Screen.premature_sends
    finally:
        h.close()

    h = harness(binary)
    try:
        ids = attach_all(h)
        h.app.tabs[0].Screen.redraw_mode = 'foreign-marker'
        first_jobs = [exec_one(h, aid, 'hostname', wait_ms=0) for _, aid in ids[:2]]
        assert all(j['sent'] is True for j in first_jobs), first_jobs
        for j in first_jobs:
            assert h.mcp.done(j['command_id'])['state'] == 'completed'
        refused = exec_one(h, ids[0][1], 'uptime')
        assert refused['state'] == 'rejected' and refused['sent'] is False, refused
        other = exec_one(h, ids[1][1], 'pwd')
        assert other['state'] == 'completed' and other['session'] == ids[1][0], other
        assert h.app.tabs[0].Screen.commands == ['hostname']
        assert h.app.tabs[1].Screen.commands == ['hostname', 'pwd']
        assert all(not t.Screen.premature_sends for t in h.app.tabs)
    finally:
        h.close()

    h = harness(binary)
    try:
        _, aid = attach_all(h)[0]
        result = batch_done(h, h.mcp.tool('exec_batch', {
            'attachment_id': aid, 'commands': ['hostname', 'never-completes', 'pwd'],
            'timeout_ms': 1000, 'on_error': 'continue', 'operation_id': 'timeout-no-replay'}))
        assert result['state'] == 'stopped' and len(result['results']) == 2, result
        assert result['results'][1]['state'] == 'timed_out', result
        refused = h.mcp.tool('exec', {'attachment_id': aid, 'command': 'pwd', 'mode': 'posix'},
                             expect_error=True)['error']['data']
        assert refused['state'] == 'rejected' and refused['sent'] is False, refused
        assert refused['error_code'] == 'busy_unresolved' and refused['automatic_retry'] is False, refused
        assert h.app.tabs[0].Screen.commands == ['hostname', 'never-completes']
        assert '\x03' not in h.app.tabs[0].Screen.sent
    finally:
        h.close()
    print('PASS: same attachment sequential commands, 3-command batch/output/exit/audit, '
          'typed-input stop even on continue, per-tab isolation, timeout/no replay; '
          'real MCP/TCP/adapter with fake native redraw, NOT live SecureCRT/SSH')


if __name__ == '__main__':
    run(sys.argv[1])
