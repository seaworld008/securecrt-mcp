"""Cross-platform live MCP stdio tests against a local fake bridge, never SSH.

This tests the compiled Rust binary, not a Python reimplementation of its policy.
Native crt behavior is covered separately with test_bridge.py and still needs real
SecureCRT desktop validation. No model credentials are needed.
"""
import json
import os
from pathlib import Path
import queue
import re
import socketserver
import subprocess
import sys
import tempfile
import threading
import time
import tomllib


class FakeBridge(socketserver.ThreadingTCPServer):
    allow_reuse_address = True
    daemon_threads = True

    def __init__(self):
        super().__init__(('127.0.0.1', 0), Handler)
        self.sent, self.interrupts, self.active = [], [], None
        self.protocol = 2
        self.oversized = False
        self.lock = threading.Lock()

    def method(self, name, p):
        with self.lock:
            if name == 'ping':
                return {'bridge_version': '0.2.0-preview.2', 'protocol_version': 2}
            if name == 'list_sessions':
                return {'sessions': [{'id': 'fake-instance/fake-session', 'caption': 'test', 'connected': True}]}
            if name == 'read_screen':
                return {'text': 'test output\nuser$ ', 'current_line': 'user$', 'screen_token': 'test-token'}
            if name == 'begin':
                if self.active:
                    raise ValueError('busy')
                self.sent.append(p['text']); self.active = p
                return {'sent': True}
            if name == 'poll':
                if not self.active:
                    raise ValueError('capture_mismatch')
                text = self.active['text']
                if 'slow-command' in text:
                    return {'text': '', 'overflow': False, 'expired': False, 'capture_may_be_incomplete': True}
                begin = re.search(r'MCP_BEGIN_[a-f0-9]+', text)
                end = re.search(r'MCP_END_[a-f0-9]+', text)
                if begin and end:
                    output = '中' * 3000 if 'large-output' in text else 'hello'
                    output = 'echoed input\n' + begin[0] + '\r\n' + output + '\r\n' + end[0] + ' 0\r\n'
                else:
                    output = 'ordinary output\nuser$'
                return {'text': output, 'overflow': False, 'expired': False, 'capture_may_be_incomplete': False}
            if name == 'end':
                if self.active and self.active['capture_id'] != p['capture_id']:
                    raise ValueError('capture_mismatch')
                self.active = None
                return {'released': True, 'unresolved': not p.get('confirmed_complete'), 'restore_errors': []}
            if name == 'interrupt':
                self.interrupts.append(p['capture_id']); self.active = None
                return {'interrupt_sent': True, 'remote_termination_confirmed': False}
            if name == 'acknowledge_idle':
                if self.active:
                    raise ValueError('busy')
                return {'idle_acknowledged': True}
            if name == 'focus_session':
                return {'focused': True}
            if name == 'send_text':
                raise ValueError('raw sends must never reach this fake bridge by default')
            raise ValueError('unknown method')


class Handler(socketserver.StreamRequestHandler):
    def handle(self):
        data = self.rfile.readline(262146)
        try:
            request = json.loads(data)
            response = dict(protocol_version=self.server.protocol, bridge_instance='fake-instance',
                            id=request['id'], ok=False, result=None, error=None)
            if request['deadline_ms'] <= int(time.time() * 1000):
                raise ValueError('expired request')
            result = self.server.method(request['method'], request.get('params', {}))
            response.update(ok=True, result=result)
        except Exception as exc:
            response['error'] = str(exc)
        try:
            if self.server.oversized:
                self.wfile.write(b'x' * 270000 + b'\n')
            else:
                self.wfile.write((json.dumps(response) + '\n').encode())
        except (BrokenPipeError, ConnectionResetError):
            pass


class MCP:
    def __init__(self, binary, env):
        self.process = subprocess.Popen([str(binary), 'serve'], stdin=subprocess.PIPE,
                                        stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                                        text=True, encoding='utf-8', env=env)
        self.lines = queue.Queue(); self.index = 0
        self.errors = []
        def read_errors():
            for line in self.process.stderr:
                self.errors.append(line)
        threading.Thread(target=read_errors, daemon=True).start()
        def read():
            for line in self.process.stdout:
                self.lines.put(line)
        threading.Thread(target=read, daemon=True).start()
        self.request('initialize', {'protocolVersion': '2025-11-25', 'capabilities': {},
                                   'clientInfo': {'name': 'securecrt-ci-smoke', 'version': '1.0'}})
        self.send({'jsonrpc': '2.0', 'method': 'notifications/initialized'})

    def send(self, value):
        self.process.stdin.write(json.dumps(value) + '\n'); self.process.stdin.flush()

    def request(self, method, params):
        self.index += 1
        self.send({'jsonrpc': '2.0', 'id': self.index, 'method': method, 'params': params})
        until = time.monotonic() + 15
        while time.monotonic() < until:
            try:
                item = json.loads(self.lines.get(timeout=max(0.1, until - time.monotonic())))
            except queue.Empty:
                self.process.terminate()
                self.process.wait(timeout=5)
                raise AssertionError('MCP response timeout: ' + ''.join(self.errors))
            if item.get('id') == self.index:
                return item
        raise AssertionError('MCP response timeout')

    def tool(self, name, params=None, expect_error=False):
        response = self.request('tools/call', {'name': 'securecrt_' + name, 'arguments': params or {}})
        failed = 'error' in response or response.get('result', {}).get('isError', False)
        if expect_error:
            assert failed, response
            return response
        assert not failed, response
        content = response['result']['content']
        return json.loads(next(c['text'] for c in content if c['type'] == 'text'))

    def done(self, command_id):
        until = time.monotonic() + 8
        while time.monotonic() < until:
            value = self.tool('get_command_status', {'command_id': command_id})
            if value['state'] not in ('starting', 'running'):
                return value
            time.sleep(0.02)
        raise AssertionError('job did not reach a terminal state')

    def close(self):
        self.process.stdin.close()
        try:
            self.process.wait(timeout=5)
        except subprocess.TimeoutExpired:
            self.process.terminate(); self.process.wait(timeout=5)
        error = ''.join(self.errors)
        assert self.process.returncode == 0, error


def run(binary):
    binary = Path(binary).resolve()
    with tempfile.TemporaryDirectory() as temporary, FakeBridge() as bridge:
        root = Path(temporary)
        env = dict(os.environ, SECURECRT_MCP_HOME=str(root))
        def cli(*args):
            return subprocess.check_output([str(binary), *args], env=env, text=True, encoding='utf-8')
        cli('init')
        config_path = root / 'config.toml'
        original_token = json.loads((root / 'bridge.json').read_text())['token']
        configured = config_path.read_text().replace('mode = "client"', 'mode = "safe"')
        config_path.write_text(configured)
        cli('upgrade')
        assert config_path.read_text() == configured, 'upgrade reset user policy'
        assert json.loads((root / 'bridge.json').read_text())['token'] == original_token, 'upgrade rotated token'
        assert 'offline_checks=OK' in cli('doctor', '--offline')
        config = tomllib.loads(cli('codex-config', '--approval-mode', 'prompt', '--toolset', 'full'))
        assert config['mcp_servers']['securecrt']['default_tools_approval_mode'] == 'prompt'
        assert config['mcp_servers']['securecrt']['command'] == str(binary)
        secret_path = root / 'bridge.json'
        secret = json.loads(secret_path.read_text()); secret['port'] = bridge.server_address[1]
        secret_path.write_text(json.dumps(secret))
        config_path.write_text(configured.replace('mode = "safe"', 'mode = "unrestricted"')
                               .replace('port = 27855', 'port = ' + str(secret['port']))
                               .replace('max_output_bytes = 1048576', 'max_output_bytes = 4096'))
        threading.Thread(target=bridge.serve_forever, daemon=True).start()
        assert 'bridge: OK' in cli('doctor')
        mcp = MCP(binary, env)
        tools = mcp.request('tools/list', {})['result']['tools']
        names = {t['name']: t for t in tools}
        assert len(names) == 11, names.keys()
        assert names['securecrt_execute_command']['annotations']['readOnlyHint'] is False
        assert names['securecrt_execute_command']['annotations']['destructiveHint'] is True
        assert names['securecrt_read_screen']['annotations']['readOnlyHint'] is True
        sid = mcp.tool('list_sessions')['sessions'][0]['id']
        counter = 0
        def command(text, timeout=5000, mode='posix'):
            nonlocal counter
            counter += 1
            view = mcp.tool('read_screen', {'session': sid})
            return dict(session=sid, screen_token=view['screen_token'], expected_prompt='user$',
                        operation_id='smoke-' + str(counter), command=text, mode=mode, timeout_ms=timeout)
        params = command('printf hello')
        job = mcp.tool('execute_command', params)
        assert mcp.done(job['command_id'])['state'] == 'completed'
        page = mcp.tool('get_command_output', {'command_id': job['command_id']})
        assert page['text'] == 'hello\n', page
        sent = len(bridge.sent)
        assert mcp.tool('execute_command', params)['command_id'] == job['command_id']
        assert len(bridge.sent) == sent, 'duplicate operation replayed'
        conflicting = dict(params, command='printf other')
        mcp.tool('execute_command', conflicting, expect_error=True)
        blocked = mcp.tool('execute_command', command('systemctl restart test-only'))
        assert blocked['state'] == 'rejected' and len(bridge.sent) == sent
        mcp.tool('send_text', dict(session=sid, screen_token='token', expected_prompt='user$', text='secret'), expect_error=True)
        invalid = command('printf hello'); invalid['timeout_ms'] = 0
        mcp.tool('execute_command', invalid, expect_error=True)
        large = mcp.tool('execute_command', command('large-output'))
        assert mcp.done(large['command_id'])['truncated']
        page = mcp.tool('get_command_output', {'command_id': large['command_id'], 'max_bytes': 4})
        assert page['text'] == '中' and page['next_cursor'] == 3
        mcp.tool('get_command_output', {'command_id': large['command_id'], 'cursor': 1}, expect_error=True)
        slow = mcp.tool('execute_command', command('slow-command', 4000))
        mcp.tool('execute_command', command('printf later'), expect_error=True)
        mcp.tool('interrupt', {'command_id': slow['command_id']})
        assert mcp.done(slow['command_id'])['state'] == 'cancelled'
        assert len(bridge.interrupts) == 1
        def acknowledge():
            view = mcp.tool('read_screen', {'session': sid})
            return mcp.tool('acknowledge_idle', dict(session=sid, screen_token=view['screen_token'], expected_prompt='user$'))
        acknowledge()
        timed = mcp.tool('execute_command', command('slow-command', 1000))
        assert mcp.done(timed['command_id'])['state'] == 'timed_out'
        assert len(bridge.interrupts) == 1, 'timeout implicitly sent Ctrl+C'
        acknowledge()
        prompt_params = command('printf prompt-check', mode='prompt')
        prompt_params['wait_for'] = 'user$'
        prompt_job = mcp.tool('execute_command', prompt_params)
        prompt_result = mcp.done(prompt_job['command_id'])
        assert prompt_result['state'] == 'completed' and prompt_result['exit_code'] is None
        snapshot = mcp.tool('execute_command', command('printf snapshot-check', mode='snapshot'))
        assert mcp.done(snapshot['command_id'])['state'] == 'unknown'
        assert len(bridge.interrupts) == 1
        mcp.tool('execute_command', command('printf blocked-by-snapshot'), expect_error=True)
        acknowledge()
        bridge.protocol = 1
        mcp.tool('bridge_status', expect_error=True)
        bridge.protocol = 2; bridge.oversized = True
        mcp.tool('bridge_status', expect_error=True)
        bridge.oversized = False
        mcp.close()
        # Failure to write an audit record must stop a dispatch, even in unrestricted mode.
        config_path.write_text(config_path.read_text().replace('file = "audit.jsonl"', 'file = "missing/audit.jsonl"'))
        before = len(bridge.sent)
        other = MCP(binary, env)
        rejected = other.tool('execute_command', dict(session=sid, screen_token='test-token',
                         expected_prompt='user$', operation_id='audit-failure', command='printf audit-check', mode='posix'))
        assert rejected['state'] == 'rejected', rejected
        assert len(bridge.sent) == before, 'audit failure still sent input'
        other.close()
        bridge.shutdown()
        records = [json.loads(line) for line in (root / 'audit.jsonl').read_text().splitlines()]
        assert any(r['event'] == 'terminal_state' for r in records)
        assert all(r.get('command') is None for r in records), 'command text leaked with default audit settings'
    print('PASS: live MCP handshake, 10 tools, annotations, policy/parameter denial, idempotency, UTF-8 pagination, '
          'busy, explicit cancellation, prompt/snapshot, timeout/no-auto-interrupt, protocol/frame rejection, fail-closed audit, '
          'safe upgrade and Codex config. Native SecureCRT and interactive Codex approvals are NOT simulated as verified.')


if __name__ == '__main__':
    run(sys.argv[1])
