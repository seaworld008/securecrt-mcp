"""Canonical connector transport, uncertain delivery and batch recovery tests."""
import json
import socket
import sys
import time

from performance_smoke import Harness


def run(binary):
    h = Harness(binary)
    try:
        m = h.mcp
        names = {t['name']: t for t in m.request('tools/list', {})['result']['tools']}
        required = [
            'connector_list', 'connector_open', 'connector_exec',
            'connector_exec_batch', 'connector_get_batch_status',
            'connector_get_status', 'connector_read', 'connector_read_screen',
            'connector_heartbeat', 'connector_interrupt',
            'connector_acknowledge', 'connector_close',
        ]
        assert all(name in names for name in required), names.keys()
        assert not any(name.startswith('securecrt_') for name in names)
        assert names['connector_exec_batch']['annotations']['destructiveHint']

        with socket.create_connection(('127.0.0.1', h.port), timeout=2) as stream:
            stream.settimeout(5)
            with stream.makefile('rb') as source:
                for number in range(2):
                    q = dict(protocol_version=2, id='fragment-' + str(number),
                             token=h.secret['token'], client_id='wire-test',
                             keep_alive=True, deadline_ms=int(time.time() * 1000) + 5000,
                             method='ping', params={})
                    wire = (json.dumps(q) + '\n').encode()
                    stream.sendall(wire[:17]); stream.sendall(wire[17:])
                    response = json.loads(source.readline())
                    assert response['id'] == q['id'] and response['ok'] and response['persistent']

        listed = m.tool('connector_list')
        target = listed['securecrt'][0]['session_id']
        opened = m.tool('connector_open', {
            'backend': 'securecrt', 'target': target, 'mode': 'exec'
        })
        session_id = opened['session_id']

        original = h.ns['handle_request']; lost = [False]

        def drop_once(adapter, request, token):
            value = original(adapter, request, token)
            if request.get('method') == 'prepare_and_begin' and not lost[0]:
                lost[0] = True
                raise ConnectionAbortedError('injected AFTER native Send')
            return value

        h.ns['handle_request'] = drop_once
        before = len(h.app.tabs[0].Screen.sent)
        result = m.tool('connector_exec', {
            'session_id': session_id, 'command': 'printf lost',
            'operation_id': 'lost-reply', 'mode': 'posix'
        })
        assert result['state'] == 'unknown' and result['sent'] is None, result
        assert len(h.app.tabs[0].Screen.sent) == before + 1, 'lost exchange replayed'
        again = m.tool('connector_exec', {
            'session_id': session_id, 'command': 'printf lost',
            'operation_id': 'lost-reply', 'mode': 'posix'
        })
        assert again['command_id'] == result['command_id']
        assert len(h.app.tabs[0].Screen.sent) == before + 1
        view = m.tool('connector_read_screen', {'session_id': session_id})
        m.tool('connector_interrupt', {'command_id': result['command_id']})
        m.tool('connector_acknowledge', {
            'session_id': session_id, 'confirmed_idle': True,
            'screen_token': view['screen_token'], 'expected_prompt': 'user$'
        })
        h.ns['handle_request'] = original
        opened = m.tool('connector_open', {
            'backend': 'securecrt', 'target': target, 'mode': 'exec'
        })
        session_id = opened['session_id']

        batch = m.tool('connector_exec_batch', {
            'session_id': session_id,
            'commands': ['printf one', 'printf two'],
            'operation_id': 'batch-wire-test', 'on_error': 'stop'
        })
        status = None
        until = time.monotonic() + 8
        while time.monotonic() < until:
            status = m.tool('connector_get_batch_status', {'batch_id': batch['batch_id']})
            if status['state'] != 'running':
                break
            time.sleep(0.02)
        assert status and status['state'] == 'completed', status
        assert len(status['results']) == 2, status
        print('PASS: unified connector tools, fragmented bridge, uncertain delivery, no replay, explicit recovery and batch state')
    finally:
        h.close()


if __name__ == '__main__':
    run(sys.argv[1])
