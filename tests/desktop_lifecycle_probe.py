"""Opt-in live disconnect/reconnect assertions coordinated with native UI actions.

The controller never disconnects a terminal itself. A UI operator writes each
flag only after the corresponding action. Private control files must not be
published; the final receipt contains no endpoint, credentials or handles.
"""
import argparse
import json
import os
from pathlib import Path
import time
import uuid

from mcp_smoke import MCP


def wait_phase(directory, stage, flag, timeout):
    (directory / 'status.json').write_text(json.dumps({'stage': stage}), encoding='utf-8')
    print('WAIT: ' + stage, flush=True)
    until = time.monotonic() + timeout
    while not (directory / flag).exists():
        assert time.monotonic() < until, 'UI phase not confirmed; no automatic recovery'
        time.sleep(.05)


def fingerprint(item):
    fields = ('index', 'configured_host', 'configured_user', 'protocol', 'port',
              'session_name', 'remote_address', 'remote_port', 'user')
    return {field: item[field] for field in fields if field in item}


def run(args):
    started = time.monotonic()
    directory = args.control_dir.resolve()
    directory.mkdir(parents=True, exist_ok=False)
    client = MCP(args.binary.resolve(), dict(os.environ))
    receipt = {'scope': 'real MCP / native UI disconnect and reconnect / SSH',
               'backend': args.backend, 'checks': [], 'passed': False}
    try:
        targets = client.tool('connector_list')[args.backend]
        original = next(item for item in targets if item['id'] == args.target and item['connected'])
        identity = fingerprint(original)
        old = client.tool('connector_open', {'backend': args.backend, 'target': args.target, 'mode': 'exec'})['session_id']
        view = client.tool('connector_read_screen', {'session_id': old})
        assert view['current_line'].endswith(('#', '$', '%')) and not view.get('unresolved')
        receipt['checks'].append('original idle connected attachment')
        wait_phase(directory, 'await_disconnect', 'disconnected.flag', args.ui_timeout)
        until = time.monotonic() + 3
        while True:
            targets = client.tool('connector_list').get(args.backend, [])
            if not any(item['id'] == args.target and item.get('connected') for item in targets):
                break
            assert time.monotonic() < until, 'disconnected target still listed as connected'
            time.sleep(.05)
        rejected = client.tool('connector_exec', {'session_id': old, 'command': "printf 'LIFECYCLE_MUST_NOT_SEND\\n'", 'mode': 'posix', 'wait_ms': 0})
        assert rejected.get('sent') is False and rejected.get('state') == 'rejected', 'old attachment did not fail before send'
        receipt['checks'].append('disconnected old attachment rejected with sent=false')
        wait_phase(directory, 'await_reconnect', 'reconnected.flag', args.ui_timeout)
        targets = client.tool('connector_list').get(args.backend, [])
        matches = [item for item in targets if item.get('connected') and fingerprint(item) == identity]
        assert len(matches) == 1, 'reconnected identity is missing or ambiguous'
        fresh = matches[0]
        assert fresh['id'] != args.target, 'reconnection revived an old native handle'
        rejected = client.tool('connector_exec', {'session_id': old, 'command': "printf 'LIFECYCLE_MUST_NOT_SEND\\n'", 'mode': 'posix', 'wait_ms': 0})
        assert rejected.get('sent') is False and rejected.get('state') == 'rejected', 'old attachment revived after reconnect'
        receipt['checks'].append('reconnected generation rejects old attachment with sent=false')
        session = client.tool('connector_open', {'backend': args.backend, 'target': fresh['id'], 'mode': 'exec'})['session_id']
        marker = 'LIFECYCLE_FRESH_' + uuid.uuid4().hex
        result = client.tool('connector_exec', {'session_id': session, 'command': "printf '%s\\n' '" + marker + "'", 'mode': 'posix', 'timeout_ms': 10000, 'wait_ms': 0})
        command = result['command_id']
        until = time.monotonic() + 15
        while result['state'] in ('starting', 'running'):
            assert time.monotonic() < until, 'fresh generation capture failed; inspect original terminal'
            time.sleep(.02)
            result.update(client.tool('connector_get_status', {'command_id': command}))
        assert result['state'] == 'completed' and result['exit_code'] == 0 and not result.get('requires_idle_ack')
        page = client.tool('connector_read', {'command_id': command, 'max_bytes': 65536})
        assert page['text'].strip() == marker
        client.tool('connector_close', {'session_id': session})
        receipt['checks'].append('fresh generation executes exactly one unique marker')
        receipt['passed'] = True
    except Exception as error:
        receipt['error_type'] = type(error).__name__
        raise
    finally:
        client.close()
        receipt['wall_seconds'] = round(time.monotonic() - started, 2)
        args.output.write_text(json.dumps(receipt, indent=2) + '\n', encoding='utf-8')
        (directory / 'status.json').write_text(json.dumps({'stage': 'finished', 'passed': receipt['passed']}), encoding='utf-8')
    print('PASS: native disconnect/reconnect lifecycle', flush=True)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('binary', type=Path)
    parser.add_argument('--backend', choices=['securecrt', 'xshell'], required=True)
    parser.add_argument('--target', required=True, help='explicit dedicated idle test target')
    parser.add_argument('--control-dir', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--ui-timeout', type=float, default=180)
    run(parser.parse_args())
