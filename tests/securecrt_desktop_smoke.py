"""Opt-in live desktop acceptance; requires explicitly chosen idle POSIX tabs.

No files, services or credentials are changed. Recovery probes only run when
--exercise-recovery is supplied. Reports omit endpoints, screens and session IDs.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import sys
import time


def run(args):
    sys.path.insert(0, str(args.repository / 'tests'))
    from mcp_smoke import MCP
    from connector_acceptance import ModernMCP
    backend = getattr(args, 'backend', 'securecrt')
    protocol = getattr(args, 'protocol', 'legacy')
    mcp = (ModernMCP if protocol == 'modern' else MCP)(args.binary.resolve(), dict(os.environ))
    opened = []
    report = {'scope': 'real MCP / native desktop / SSH', 'backend': backend,
              'protocol': protocol, 'binary_sha256': hashlib.sha256(args.binary.read_bytes()).hexdigest(), 'checks': []}
    def check(name, condition):
        if not condition:
            report['failure']={'check':name}
        assert condition, name
        report['checks'].append(name)
        print('PASS: ' + name, flush=True)
    def done(command_id):
        until = time.monotonic() + 40
        while time.monotonic() < until:
            value = mcp.tool('connector_get_status', {'command_id': command_id})
            if value['state'] not in ('starting', 'running'):
                return value
            time.sleep(0.02)
        raise AssertionError('command did not settle; inspect original tab, do not replay')
    def execute(sid, command, **kw):
        started = time.monotonic()
        result = mcp.tool('connector_exec', dict(session_id=sid, command=command,
                         mode='posix', timeout_ms=10000, wait_ms=0, **kw))
        if result['state'] in ('starting', 'running'):
            result.update(done(result['command_id']))
        if result.get('command_id') is None:
            return result
        page = mcp.tool('connector_read', {'command_id': result['command_id'], 'max_bytes': kw.get('max_bytes', 65536)})
        result.update(page.get('output', page))
        result['wall_ms'] = round((time.monotonic() - started)*1000, 1)
        return result
    def open_tab(target):
        value = mcp.tool('connector_open', {'backend': backend, 'target': target, 'mode': 'exec'})
        assert 'session_id' in value, 'attach failed; inspect runtime and original terminal before retrying'
        sid = value['session_id']
        opened.append(sid)
        return sid
    try:
        tools = mcp.request('tools/list', {})['result']['tools']
        check('unified connector tool discovery', all(t['name'].startswith('connector_') for t in tools))
        listed = mcp.tool('connector_list')
        check('explicit connected target', any(s.get('id') == args.session and s['connected'] for s in listed[backend]))
        sid = open_tab(args.session)
        screen = mcp.tool('connector_read_screen', {'session_id': sid})
        prompt = screen['current_line']
        check('fresh native screen and idle prompt', bool(screen['screen_token']) and prompt.endswith(('#', '$', '%')))
        marker = 'SCRT_MCP_DESKTOP_OK'
        result = execute(sid, "printf '" + marker + "\\n'", operation_id='desktop-dedup')
        check('POSIX marker completion', result['state'] == 'completed' and result['exit_code'] == 0 and marker in result['text'])
        again = execute(sid, "printf '" + marker + "\\n'", operation_id='desktop-dedup')
        check('same operation returns same command without replay', result['command_id'] == again['command_id'])
        result = execute(sid, "printf '中文_no_newline'")
        check('Unicode and no-newline capture', result['state'] == 'completed' and '中文_no_newline' in result['text'])
        result = execute(sid, "sh -c 'exit 7'")
        check('nonzero exit code retained', result['state'] == 'completed' and result['exit_code'] == 7)
        batch = mcp.tool('connector_exec_batch', {'session_id': sid, 'commands': ['hostname', 'uptime', 'pwd']})
        until = time.monotonic() + 20
        while batch['state'] == 'running' and time.monotonic() < until:
            time.sleep(0.02)
            batch = mcp.tool('connector_get_batch_status', {'batch_id': batch['batch_id']})
        report['diagnostics_batch']={'state':batch['state'],'results':[
            {key:value.get(key) for key in ('state','exit_code','sent','error_code','requires_idle_ack')}
            for value in batch.get('results',[])]}
        check('three-command diagnostics batch', batch['state'] == 'completed' and len(batch['results']) == 3 and all(r['exit_code'] == 0 for r in batch['results']))
        timings=[]
        for i in range(20):
            value = execute(sid, "printf 'DESKTOP_REUSE_%02d\\n'" % i)
            if value['state']!='completed':
                report['failure']={'phase':'continuous_reuse','index':i,'state':value['state'],'sent':value.get('sent'),'error_code':value.get('error_code')}
            assert value['state']=='completed' and value['exit_code']==0 and ('DESKTOP_REUSE_%02d' % i) in value['text'], 'continuous reuse failed; do not replay'
            timings.append(value['wall_ms'])
        check('twenty consecutive commands retain original attachment', len(timings)==20)
        report['short_command_wall_ms']={'median':sorted(timings)[len(timings)//2], 'p95':sorted(timings)[18], 'samples':timings}
        command = "awk 'BEGIN {for (i=0;i<2500;i++) printf \"%04d_中文_0123456789abcdef\\n\", i}'"
        result = execute(sid, command, max_bytes=1024)
        report['large_output_capture']={key:result.get(key) for key in ('state','exit_code','sent','error_code','requires_idle_ack','wall_ms')}
        pages, text, cursor = 1, result['text'], result['next_cursor']
        while cursor is not None:
            page = mcp.tool('connector_read', {'command_id': result['command_id'], 'cursor': cursor, 'max_bytes': 1024})
            page = page.get('output', page)
            text += page['text']
            cursor = page['next_cursor']
            pages += 1
            assert pages < 200, 'pagination did not terminate'
        lines=[line.rstrip() for line in text.splitlines() if line.strip()]
        expected=['%04d_中文_0123456789abcdef' % i for i in range(2500)]
        report['large_output_integrity']={'rows':len(lines),'expected_rows':2500,'exact_ordered_rows':lines==expected}
        check('large UTF-8 output pagination', result['state'] == 'completed' and not result.get('requires_idle_ack') and pages > 1 and '0000_中文_' in text and '2499_中文_' in text and not result['truncated'])
        check('all 2500 UTF-8 rows match exactly in order without loss or duplicates', lines==expected)
        report['large_output'] = {'pages': pages, 'bytes': len(text.encode('utf-8')), 'capture_budget_ms':10000, 'wall_ms_to_first_page':result['wall_ms']}
        rejected = execute(sid, "printf 'SHOULD_NOT_SEND'", expected_prompt='not-the-real-prompt')
        check('wrong prompt rejected before native send', rejected['state'] == 'rejected' and rejected['sent'] is False)
        check('attachment heartbeat', mcp.tool('connector_heartbeat', {'session_id': sid})['unresolved'] is None)
        if args.peer:
            peer = open_tab(args.peer)
            first = mcp.tool('connector_exec', {'session_id': sid, 'command': "sleep 1; printf 'TAB_A\\n'", 'mode': 'posix', 'wait_ms': 0, 'timeout_ms': 10000})
            second = mcp.tool('connector_exec', {'session_id': peer, 'command': "printf 'TAB_B\\n'", 'mode': 'posix', 'wait_ms': 0, 'timeout_ms': 10000})
            check('independent tab completion', done(first['command_id'])['exit_code'] == 0 and done(second['command_id'])['exit_code'] == 0)
        if args.exercise_recovery:
            value = mcp.tool('connector_exec', {'session_id': sid, 'command': 'sleep 2', 'mode': 'posix', 'timeout_ms': 1000, 'wait_ms': 10000})
            check('timeout preserves uncertainty', value['state'] in ('timed_out', 'unknown') and value['requires_idle_ack'])
            time.sleep(2)
            view = mcp.tool('connector_read_screen', {'session_id': sid})
            check('original prompt restored after finite sleep', view['current_line'] == prompt)
            blocked = execute(sid, "printf 'BUSY_SHOULD_NOT_SEND'")
            check('unresolved session refuses new input', blocked['state'] == 'rejected' and blocked['sent'] is False)
            view = mcp.tool('connector_read_screen', {'session_id': sid})
            refused = mcp.tool('connector_acknowledge', {'session_id': sid, 'confirmed_idle': False,
                               'screen_token': view['screen_token'], 'expected_prompt': prompt}, expect_error=True)
            check('false idle confirmation cannot clear uncertainty', 'confirmed_idle' in refused['error']['message'])
            ack = mcp.tool('connector_acknowledge', {'session_id': sid, 'confirmed_idle': True,
                           'screen_token': view['screen_token'], 'expected_prompt': prompt})
            check('explicit recovery with fresh context', ack['idle_acknowledged'])
            opened.remove(sid)  # acknowledgement invalidates this attachment
            sid = open_tab(args.session)
            value = execute(sid, "printf 'RECOVERED\\n'")
            check('new attachment works after recovery', value['state'] == 'completed' and 'RECOVERED' in value['text'])
            value = mcp.tool('connector_exec', {'session_id': sid, 'command': 'sleep 10', 'mode': 'posix',
                                              'timeout_ms': 20000, 'wait_ms': 0})
            time.sleep(0.1)
            interrupted = mcp.tool('connector_interrupt', {'command_id': value['command_id']})
            check('explicit Ctrl+C on the tracked command', interrupted['interrupt_sent'] and not interrupted['remote_termination_confirmed'])
            check('interrupt outcome retained', done(value['command_id'])['state'] == 'cancelled')
            until = time.monotonic() + 3
            while True:
                view = mcp.tool('connector_read_screen', {'session_id': sid})
                if view['current_line'] == prompt or time.monotonic() >= until:
                    break
                time.sleep(0.05)
            check('idle prompt after explicit interrupt', view['current_line'] == prompt)
            ack = mcp.tool('connector_acknowledge', {'session_id': sid, 'confirmed_idle': True,
                           'screen_token': view['screen_token'], 'expected_prompt': prompt})
            check('explicit post-interrupt recovery', ack['idle_acknowledged'])
            opened.remove(sid)
        report['passed'] = True
        return report
    except Exception as error:
        report['passed'] = False
        report['error_type'] = type(error).__name__
        # Do not include transport errors that can contain existing terminal output.
        if getattr(args, 'output', None):
            args.output.write_text(json.dumps(report, ensure_ascii=False, indent=2)+'\n', encoding='utf-8')
        raise
    finally:
        for sid in opened:
            mcp.tool('connector_close', {'session_id': sid})
        mcp.close()


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('binary', type=Path)
    parser.add_argument('--repository', type=Path, default=Path(__file__).resolve().parents[1])
    parser.add_argument('--session', required=True, help='Explicit opaque session ID from sessions; verify idle POSIX shell first')
    parser.add_argument('--peer', help='Optional second explicitly chosen idle POSIX tab')
    parser.add_argument('--backend', choices=['securecrt','xshell'], default='securecrt')
    parser.add_argument('--protocol', choices=['legacy','modern'], default='legacy')
    parser.add_argument('--exercise-recovery', action='store_true')
    parser.add_argument('--output', type=Path)
    args = parser.parse_args()
    report = run(args)
    if args.output:
        args.output.write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
