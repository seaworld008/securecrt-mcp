"""Opt-in minimal live smoke. Explicitly select an idle POSIX test target first.

Only literal printf commands are executed. Reports omit target IDs, endpoint
metadata, tokens and existing terminal text. Never automatically retry or ack.
"""
import argparse
import base64
import json
import os
from pathlib import Path
import sys
import time

from mcp_smoke import MCP
from protocol_harness import modern_meta


class ModernMCP(MCP):
    def __init__(self, binary, env):
        super().__init__(binary, env, initialize=False)
        self.request('server/discover', {})

    def request(self, method, params):
        return super().request(method, dict(params, _meta=modern_meta()))


def bytes_page(value):
    value = value.get('output', value)
    if value.get('base64') is not None:
        return base64.b64decode(value['base64'])
    return value.get('text', '').encode('utf-8')


def run(args):
    client = (ModernMCP if args.protocol == 'modern' else MCP)(args.binary.resolve(), dict(os.environ))
    sid = None
    checks = []
    def check(name, condition):
        assert condition, name
        checks.append(name)
        print('PASS: ' + name, flush=True)
    try:
        opened = client.tool('connector_open', {'backend': args.backend, 'target': args.target,
                      'mode': 'exec', 'config_path': args.config_path})
        check('attach', 'session_id' in opened)
        sid = opened['session_id']
        result = client.tool('connector_exec', {'session_id': sid, 'mode': 'posix',
            'command': "printf 'MCP_ACCEPTANCE_OK\\n'", 'wait_ms': 10000, 'timeout_ms': 10000})
        check('exec', result['state'] == 'completed' and result['exit_code'] == 0
              and b'MCP_ACCEPTANCE_OK' in bytes_page(result))
        batch = client.tool('connector_exec_batch', {'session_id': sid,
            'commands': ["printf 'BATCH_A\\n'", "printf 'BATCH_B\\n'", "printf 'BATCH_C\\n'"]})
        until = time.monotonic() + 20
        while batch['state'] == 'running' and time.monotonic() < until:
            time.sleep(0.02)
            batch = client.tool('connector_get_batch_status', {'batch_id': batch['batch_id']})
        results = [r.get('result', r) for r in batch['results']]
        check('batch', batch['state'] == 'completed' and len(results) == 3
              and all(r['exit_code'] == 0 for r in results))
        expected = '分页_中文_' * 12
        result = client.tool('connector_exec', {'session_id': sid, 'mode': 'posix',
            'command': "printf '%s\\n' '" + expected + "'", 'max_bytes': 16,
            'wait_ms': 10000, 'timeout_ms': 10000})
        data, page = bytes_page(result), result.get('output', result)
        cursor, pages = page['next_cursor'], 1
        while cursor is not None:
            page = client.tool('connector_read', {'command_id': result['command_id'],
                                                'cursor': cursor, 'max_bytes': 16})
            data += bytes_page(page)
            cursor = page['next_cursor']
            pages += 1
            assert pages < 100, 'pagination exceeded bound'
        check('pagination', pages > 1 and expected in data.decode('utf-8'))
        params = {'session_id': sid, 'mode': 'posix', 'command': "printf 'MUST_NOT_SEND'"}
        if args.backend == 'openssh':
            params['command'] += '\n'
        else:
            params['expected_prompt'] = 'not-the-verified-prompt'
        response = client.request('tools/call', {'name': 'connector_exec', 'arguments': params})
        if response.get('error'):
            denied = response['error'].get('data', {})
        else:
            denied = json.loads(next(c['text'] for c in response['result']['content'] if c['type'] == 'text'))
        check('rejection', denied.get('state') == 'rejected' and denied.get('sent') is False)
        return {'scope': 'live_connector', 'backend': args.backend, 'protocol': args.protocol,
                'status': 'PASS', 'checks': checks, 'pages': pages,
                'source_commit': args.source_commit, 'tested_on': args.tested_on}
    finally:
        if sid:
            client.tool('connector_close', {'session_id': sid})
        client.close()


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('binary', type=Path)
    parser.add_argument('--backend', required=True, choices=['securecrt', 'xshell', 'openssh'])
    parser.add_argument('--target', required=True, help='Verified opaque desktop ID or explicitly selected OpenSSH alias')
    parser.add_argument('--config-path')
    parser.add_argument('--protocol', choices=['legacy', 'modern'], default='legacy')
    parser.add_argument('--source-commit', required=True)
    parser.add_argument('--tested-on', required=True)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    try:
        receipt = run(args)
    except Exception as error:
        args.output.write_text(json.dumps({'status': 'FAIL', 'backend': args.backend,
            'protocol': args.protocol, 'error_type': type(error).__name__,
            'source_commit': args.source_commit, 'tested_on': args.tested_on}) + '\n')
        raise
    args.output.write_text(json.dumps(receipt, ensure_ascii=False, indent=2) + '\n')
