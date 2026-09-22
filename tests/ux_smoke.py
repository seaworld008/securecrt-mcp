"""Exercise the compiled server and local clients against a fake bridge; no SSH."""
import json
import os
from pathlib import Path
import re
import socketserver
import subprocess
import sys
import tempfile
import threading
import time
import tomllib
from mcp_smoke import MCP, FakeBridge


class UXBridge(FakeBridge):
    def __init__(self):
        super().__init__()
        self.RequestHandlerClass = UXHandler
        self.current_line = 'user$'
        self.fault = None
        self.token_index = 0
        self.unresolved = False
        self.calls = []

    def method(self, name, p):
        self.calls.append(name)
        if name == 'ping':
            return {'bridge_version': VERSION, 'protocol_version': 2,
                    'unresolved': self.unresolved, 'capabilities': ['delivery_evidence']}
        if name == 'read_screen':
            self.token_index += 1
            return {'session': SID, 'text': 'previous output\n' + self.current_line,
                    'current_line': self.current_line, 'screen_token': 'view-' + str(self.token_index)}
        if name == 'begin':
            if self.unresolved:
                raise ValueError('unresolved: inspect original session')
            if self.fault == 'stale':
                self.fault = None
                raise ValueError('stale_screen: changed before send')
            if p['screen_token'] != 'view-' + str(self.token_index):
                raise ValueError('stale_screen: reused token')
            if self.fault == 'lost':
                self.fault = None
                self.sent.append(p['text']); self.active = p; self.unresolved = True
                raise ConnectionAbortedError('lost reply AFTER native send')
        if name == 'end':
            self.unresolved = not p.get('confirmed_complete')
        if name == 'acknowledge_idle':
            self.unresolved = False
            return dict(idle_acknowledged=True, screen=self.method('read_screen', {'session': SID}))
        return super().method(name, p)


class UXHandler(socketserver.StreamRequestHandler):
    def handle(self):
        q = json.loads(self.rfile.readline(262146))
        r = dict(id=q['id'], protocol_version=2, bridge_instance='fake-instance', ok=False,
                 result=None, error=None, sent=False)
        try:
            if q['deadline_ms'] <= int(time.time()*1000):
                raise ValueError('expired request')
            r.update(ok=True, result=self.server.method(q['method'], q.get('params', {})))
        except ConnectionAbortedError:
            return
        except Exception as e:
            r.update(error=str(e), error_code=str(e).split(':')[0])
        self.wfile.write((json.dumps(r) + '\n').encode())


SID = 'fake-instance/fake-session'
VERSION = '0.4.1'


def run(binary):
    binary = str(Path(binary).resolve())
    with tempfile.TemporaryDirectory() as tmp, UXBridge() as bridge:
        env = dict(os.environ, SECURECRT_MCP_HOME=tmp)
        def cli(*args):
            return subprocess.check_output([binary, *args], env=env, text=True, encoding='utf-8')
        cli('init')
        config_file = Path(tmp)/'config.toml'
        initial = config_file.read_text()
        assert tomllib.loads(initial)['policy']['mode'] == 'client', 'new install should delegate command-risk decisions'
        secret_file = Path(tmp)/'bridge.json'
        secret = json.loads(secret_file.read_text()); secret['port'] = bridge.server_address[1]
        secret_file.write_text(json.dumps(secret))
        config_file.write_text(initial.replace('port = 27855', 'port = ' + str(secret['port'])))
        threading.Thread(target=bridge.serve_forever, daemon=True).start()
        mcp = MCP(binary, env)
        tools = {t['name']: t for t in mcp.request('tools/list', {})['result']['tools']}
        assert 'securecrt_run_command' in tools, 'securecrt_run_command high-level tool missing'
        assert tools['securecrt_run_command']['annotations']['readOnlyHint'] is False
        assert tools['securecrt_run_command']['annotations']['idempotentHint'] is False
        def call(command='printf hello', **kwargs):
            return mcp.tool('run_command', dict(session=SID, command=command, mode='posix', **kwargs))
        job = call(operation_id='one')
        assert job['state'] == 'completed' and job['sent'] is True, job
        assert job['exit_code'] == 0 and job['text'] == 'hello\n', job
        assert job['remote_termination_confirmed'] is False
        before = len(bridge.sent)
        retry = call(operation_id='one', max_bytes=4)
        assert retry['command_id'] == job['command_id'] and len(bridge.sent) == before
        assert retry['next_cursor'] == 4
        conflict = call('printf different', operation_id='one')
        assert conflict['sent'] is False and conflict['error_code'] == 'operation_conflict', conflict
        assert len(bridge.sent) == before
        for command in ["grep 'deny' nginx.conf", "grep 'shutdown' nginx.conf", 'grep deny nginx.conf',
                        'systemctl status nginx', 'systemctl stop test-only', 'rm -rf /tmp/FAKE-ONLY']:
            assert call(command)['state'] == 'completed'
        before = len(bridge.sent)
        for extra in [dict(max_bytes=0), dict(timeout_ms=0), dict(wait_ms=60001)]:
            invalid = call(**extra)
            assert invalid['sent'] is False and invalid['state'] == 'rejected', invalid
        assert len(bridge.sent) == before
        bridge.current_line = 'Password:'
        denied = call()
        assert denied['sent'] is False and denied['error_code'] == 'input_context_required', denied
        bridge.current_line = '>'
        assert call()['sent'] is False, 'continuation prompt was mistaken for an idle shell'
        bridge.current_line = 'user$'
        bridge.fault = 'stale'
        denied = call()
        assert denied['state'] == 'rejected' and denied['sent'] is False, denied
        assert denied['error_code'] == 'stale_screen' and denied['action'], denied
        assert call()['state'] == 'completed', 'unsent rejection incorrectly left a local interlock'
        page = call('large-output', max_bytes=4)
        assert page['text'] == '中' and page['next_cursor'] == 3, page
        remaining = mcp.tool('get_command_output', dict(command_id=page['command_id'], cursor=page['next_cursor']))
        assert remaining['text'].startswith('中')
        active = call('slow-command', timeout_ms=1000, wait_ms=0)
        assert active['state'] in ('starting', 'running'), active
        busy = call()
        assert busy['sent'] is False and busy['error_code'] == 'busy_unresolved', busy
        assert mcp.done(active['command_id'])['state'] == 'timed_out'
        assert not bridge.interrupts, 'timeout or busy implicitly interrupted the terminal'
        def acknowledge():
            view = mcp.tool('read_screen', dict(session=SID))
            return mcp.tool('acknowledge_idle', dict(session=SID, screen_token=view['screen_token'], expected_prompt='user$'))
        fresh = acknowledge()
        assert fresh['screen']['screen_token']
        snapshot = mcp.tool('run_command', dict(session=SID, command='printf snapshot', mode='snapshot', expected_prompt='user$'))
        assert snapshot['state'] == 'unknown' and snapshot['requires_idle_ack'], snapshot
        assert call()['sent'] is False
        acknowledge()
        bridge.fault = 'lost'
        uncertain = call('printf uncertain')
        assert uncertain['state'] == 'unknown' and uncertain['sent'] is None, uncertain
        before = len(bridge.sent)
        assert call()['sent'] is False and len(bridge.sent) == before
        assert not bridge.interrupts
        mcp.close()
        bridge.active = None; bridge.unresolved = False
        params = Path(tmp)/'request.json'
        payload = dict(session=SID, command="printf '%s' '$HOME | quoted 中文'", mode='posix')
        params.write_text(json.dumps(payload, ensure_ascii=False), encoding='utf-8')
        result = json.loads(cli('run', '--input', str(params)))
        assert result['state'] == 'completed' and '$HOME | quoted 中文' in bridge.sent[-1]
        assert json.loads(cli('sessions'))['sessions'][0]['id'] == SID
        assert json.loads(cli('screen', '--session', SID))['current_line'] == 'user$'
        checked = json.loads(cli('policy-check', '--input', str(params)))
        assert checked['mode'] == 'client' and checked['allowed'] is True
        settings = tomllib.loads(cli('codex-config'))['mcp_servers']['securecrt']
        assert settings['default_tools_approval_mode'] == 'auto'
        assert 'securecrt_run_command' in settings['enabled_tools']
        assert 'securecrt_execute_command' not in settings['enabled_tools']
        config = tomllib.loads(cli('codex-config', '--approval-mode', 'prompt', '--toolset', 'full'))
        assert 'enabled_tools' not in config['mcp_servers']['securecrt']
        preserved = config_file.read_text().replace('mode = "client"', 'mode = "safe"')
        config_file.write_text(preserved); cli('upgrade')
        assert config_file.read_text() == preserved, 'upgrade changed existing permission settings'
        config_file.write_text(preserved.replace('mode = "safe"', 'mode = "client"'))
        wrapper = Path(__file__).resolve().parents[1]/'clients'/'securecrt_client.py'
        result = subprocess.check_output([sys.executable, str(wrapper), '--binary', binary, 'run', '--input', str(params)], env=env, text=True, encoding='utf-8')
        assert json.loads(result)['state'] == 'completed'
        if sys.platform == 'win32':
            script = wrapper.with_name('SecureCRT.ps1')
            payload['command'] = 'large-output'
            params.write_text(json.dumps(payload), encoding='utf-8')
            for shell in ('pwsh', 'powershell.exe'):
                result = subprocess.check_output([shell, '-NoProfile', '-File', str(script), '-Binary', binary,
                                                  '-Action', 'run', '-InputFile', str(params)], env=env, text=True, encoding='utf-8')
                parsed = json.loads(result)
                assert parsed['state'] == 'completed' and parsed['text'].startswith('中')
        bridge.shutdown()
    print('PASS: one-call MCP, client policy, deduplication, context guard, explicit unsent rejection, uncertainty/no replay, busy/no auto-ack, UTF-8 pages, CLI and wrappers; native desktop approval NOT tested')


if __name__ == '__main__':
    run(sys.argv[1])
