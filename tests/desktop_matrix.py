"""Opt-in, parallel real desktop acceptance for every explicitly selected idle tab.

Never restarts scripts, retries commands or clears uncertainty. Independent tabs
continue after another tab fails; the failed tab is excluded from later phases.
"""
import argparse
from concurrent.futures import ThreadPoolExecutor, as_completed
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys
import time
import uuid

from mcp_smoke import MCP

ROOT = Path(__file__).resolve().parents[1]


def native_file_identity(backends):
    """Read-only identity gate before attaching or sending any SSH probes.

    Native COM methods remain unobserved before the first capture, so the full
    doctor capability gate belongs after acceptance. This gate only sends ping.
    TCP adapters retain the CLI's normal doctor check.
    """
    root = Path(os.environ.get('SECURECRT_MCP_HOME', str(Path.home()/'.securecrt-mcp')))
    expected = hashlib.sha256((ROOT/'bridge/windows_bridge.js').read_bytes()).hexdigest()
    checked = []
    for backend in backends:
        config_path = root/('bridge.json' if backend=='securecrt' else 'xshell_bridge.json')
        config = json.loads(config_path.read_text(encoding='utf-8-sig'))
        if not config.get('ipc_dir'):
            continue
        ipc = Path(config['ipc_dir'])
        instances = {}
        for _ in range(3):
            for ready_path in (ipc/'instances').glob('*/ready.json'):
                try:
                    ready = json.loads(ready_path.read_text(encoding='utf-8-sig'))
                    if int(time.time()*1000)-ready['last_poll_ms']<5000:
                        instances[ready_path.parent] = ready
                except (OSError, ValueError, KeyError):
                    continue
            time.sleep(.03)
        assert instances, backend+': no live native adapter; load the installed script'
        for directory in instances:
            request_id = str(uuid.uuid4())
            temporary = directory/(request_id+'.tmp')
            response = directory/(request_id+'.response.json')
            request = {'protocol_version':2, 'id':request_id, 'client_id':'desktop-identity-preflight',
                       'token':config['token'], 'deadline_ms':int(time.time()*1000)+5000,
                       'method':'ping', 'params':{}}
            temporary.write_text(json.dumps(request),encoding='utf-8')
            os.replace(temporary,directory/(request_id+'.request.json'))
            until = time.monotonic()+6
            value = None
            while time.monotonic()<until:
                try:
                    value = json.loads(response.read_text(encoding='utf-8-sig'))
                    response.unlink()
                    break
                except (OSError, ValueError):
                    time.sleep(.02)
            assert value is not None, backend+': native identity ping did not respond'
            runtime = value.get('result',{})
            actual = runtime.get('adapter_sha256')
            checked.append({'backend':backend,'expected_sha256':expected,'running_sha256':actual})
            assert actual==expected, backend+': running script '+str(actual)+' differs from installed source '+expected+'; cancel the old script and reload'
    return checked


def identity_preflight(binary, backends):
    identities = native_file_identity(backends)
    for backend in backends:
        probe = subprocess.run([str(binary),'doctor','--backend',backend],capture_output=True,timeout=45)
        if probe.returncode==0:
            continue
        raw = probe.stdout.decode(errors='replace').replace('\r\n','\n')
        if backend=='securecrt':
            supports = [json.loads(line[len('support='):]) for line in raw.splitlines() if line.startswith('support=')]
            validation_failed = 'unsupported or incomplete runtime' not in probe.stderr.decode(errors='replace')
        else:
            value = json.loads(raw)
            supports = [instance.get('support',{}) for instance in value.get('instances',[])]
            validation_failed = any(instance.get('validation_error') or not instance.get('runtime') for instance in value.get('instances',[]))
        # A known source may have unobserved COM methods before its first capture.
        # Only that specific unknown state is allowed; every other failure blocks.
        native_checked = any(item['backend']==backend for item in identities)
        incomplete_only = supports and all(report.get('tier')=='unknown' and
            set(report.get('reasons',[]))=={'native_probe_incomplete_or_no_tab'} for report in supports)
        assert native_checked and incomplete_only and not validation_failed, backend+': binary/runtime identity or support check failed before SSH probes; inspect doctor'
    return identities


def code_revision():
    try:
        commit=subprocess.check_output(['git','rev-parse','HEAD'],cwd=ROOT,stderr=subprocess.DEVNULL,text=True).strip()
        dirty=bool(subprocess.check_output(['git','status','--porcelain','--untracked-files=all'],cwd=ROOT,stderr=subprocess.DEVNULL,text=True).strip())
        return {'commit':commit,'working_tree_modified':dirty}
    except (OSError,subprocess.CalledProcessError):
        return {'commit':None,'working_tree_modified':None,'origin':'unpacked bundle; see binary and source identities'}


def discover(binary, backends, all_idle, explicit):
    client = MCP(binary, dict(os.environ))
    targets = []
    try:
        # Merge repeated read-only discovery to tolerate a registry publication gap.
        found = {backend: {} for backend in backends}
        for _ in range(3):
            listed = client.tool('connector_list')
            for backend in backends:
                for item in listed.get(backend, []):
                    if item.get('connected'):
                        found[backend][item['id']] = item
            time.sleep(0.03)
        for backend in backends:
            for target in found[backend]:
                if not all_idle and (backend, target) not in explicit:
                    continue
                label = backend + '-tab-' + str(1 + sum(t['backend']==backend for t in targets))
                opened = client.tool('connector_open', {'backend': backend, 'target': target, 'mode': 'exec'})
                assert 'session_id' in opened, label + ': attachment rejected; inspect original idle boundary'
                try:
                    screen = client.tool('connector_read_screen', {'session_id': opened['session_id']})
                    assert screen['current_line'].endswith(('#','$','%')) and not screen.get('unresolved'), label + ': requires a verified idle shell with no uncertainty'
                finally:
                    client.tool('connector_close', {'session_id': opened['session_id']})
                targets.append({'backend':backend, 'target':target, 'label':label})
        assert targets, 'No selected connected idle targets; start the native scripts first'
        assert explicit.issubset({(t['backend'],t['target']) for t in targets}), 'Some explicitly selected targets are unavailable'
        return targets
    finally:
        client.close()


def execute_case(binary, directory, target, phase, recovery, source_commit):
    receipt = directory / (target['label']+'-'+phase+'.json')
    if phase == 'full-legacy':
        command = [sys.executable, str(ROOT/'tests/securecrt_desktop_smoke.py'), str(binary),
                   '--backend',target['backend'], '--session',target['target'], '--protocol','legacy',
                   '--output',str(receipt)]
        if recovery:
            command.append('--exercise-recovery')
    else:
        command = [sys.executable, str(ROOT/'tests/connector_acceptance.py'), str(binary),
                   '--backend',target['backend'], '--target',target['target'], '--protocol','modern',
                   '--source-commit',source_commit, '--tested-on',time.strftime('%Y-%m-%d'),
                   '--output',str(receipt)]
    started = time.monotonic()
    # A process timeout only stops the controller. It never replays or sends Ctrl+C.
    try:
        process = subprocess.run(command, capture_output=True, timeout=150)
        value = json.loads(receipt.read_text(encoding='utf-8')) if receipt.exists() else {'error_type':'MissingReceipt'}
        passed = process.returncode==0 and (value.get('passed') is True or value.get('status')=='PASS')
    except subprocess.TimeoutExpired:
        value, passed = {'error_type':'ControllerTimeout','requires_original_terminal_inspection':True}, False
    result = {'label':target['label'], 'backend':target['backend'], 'phase':phase,
              'passed':passed,'wall_ms':round((time.monotonic()-started)*1000), 'result':value}
    print(('PASS' if passed else 'FAIL')+': '+target['label']+' / '+phase, flush=True)
    return result


def isolation(binary, backend, targets):
    client = MCP(binary, dict(os.environ))
    opened = []
    phase = 'open'
    try:
        commands = []
        for i, target in enumerate(targets):
            phase = 'open'
            value = client.tool('connector_open', {'backend':backend, 'target':target['target'], 'mode':'exec'})
            assert 'session_id' in value, 'isolation attachment rejected; inspect original idle boundary'
            opened.append(value['session_id'])
            marker = 'MATRIX_ISOLATION_'+str(i)+'_'+os.urandom(8).hex()
            phase = 'begin'
            value = client.tool('connector_exec', {'session_id':value['session_id'],
                'command':"printf '%s\\n' '"+marker+"'", 'mode':'posix', 'wait_ms':0,'timeout_ms':10000})
            assert 'command_id' in value, 'isolation begin rejected; inspect original input boundary'
            commands.append((value['command_id'],marker))
        until = time.monotonic()+40
        for command_id, marker in commands:
            phase = 'status'
            while time.monotonic()<until:
                status = client.tool('connector_get_status', {'command_id':command_id})
                if status['state'] not in ('starting','running'):
                    break
                time.sleep(0.02)
            assert status['state']=='completed' and status['exit_code']==0
            phase = 'read'
            page = client.tool('connector_read', {'command_id':command_id,'max_bytes':65536})
            text = page.get('output',page)['text']
            assert marker in text and all(other not in text for _,other in commands if other!=marker)
        return {'backend':backend,'phase':'concurrent-tab-isolation','tabs':len(targets),'passed':True}
    except Exception as error:
        return {'backend':backend,'phase':'concurrent-tab-isolation','tabs':len(targets),'passed':False,'failed_step':phase,'error_type':type(error).__name__,
                'missing_key':str(error) if isinstance(error,KeyError) else None}
    finally:
        for session in opened:
            try:
                client.tool('connector_close', {'session_id':session})
            except Exception:
                pass  # Preserve the isolation failure if the instance went offline.
        client.close()


def run_matrix(args):
    started = time.monotonic()
    binary = args.binary.resolve()
    revision=code_revision()
    source_commit=(revision['commit'] or 'unpacked bundle')+('; working-tree modified; see matrix hashes' if revision['working_tree_modified'] else '')
    directory = args.output_dir.resolve()
    directory.mkdir(parents=True,exist_ok=True)
    explicit = set(tuple(value.split('=',1)) for value in args.target)
    assert args.all_idle or explicit, 'Use --all-idle or explicit --target backend=opaque-id'
    identities = identity_preflight(binary,args.backend)
    (directory/'identity-preflight.json').write_text(json.dumps(identities,indent=2)+'\n',encoding='utf-8')
    print('PASS: native source identity before SSH probes',flush=True)
    targets = discover(binary,args.backend,args.all_idle,explicit)
    print('Selected '+str(len(targets))+' verified idle tabs',flush=True)
    for backend,count in [('securecrt',args.expect_securecrt),('xshell',args.expect_xshell)]:
        if count is not None:
            assert sum(t['backend']==backend for t in targets)==count, 'Connected tab coverage mismatch: '+backend
    results, passing = [], targets
    for phase in ['full-legacy','minimal-modern']:
        completed = []
        with ThreadPoolExecutor(max_workers=args.jobs) as pool:
            futures = {pool.submit(execute_case,binary,directory,target,phase,args.exercise_recovery,source_commit):target for target in passing}
            for future in as_completed(futures):
                result = future.result()
                results.append(result)
                if result['passed']:
                    completed.append(futures[future])
        passing = completed
    for backend in args.backend:
        selected = [target for target in passing if target['backend']==backend]
        if len(selected)>1:
            result = isolation(binary,backend,selected)
            results.append(result)
            print(('PASS' if result['passed'] else 'FAIL')+': '+backend+' / concurrent-tab-isolation',flush=True)
    runtimes = {}
    for backend in args.backend:
        probe = subprocess.run([str(binary),'doctor','--backend',backend],capture_output=True,timeout=45)
        checked = probe.returncode==0
        results.append({'backend':backend,'phase':'runtime-and-source-identity','passed':checked})
        raw = probe.stdout.decode(errors='replace').replace('\r\n','\n')
        if backend=='securecrt' and 'bridge: OK\n' in raw:
            try:
                runtime,_ = json.JSONDecoder().raw_decode(raw.split('bridge: OK\n',1)[1].lstrip())
                native = [runtime]
            except json.JSONDecodeError:
                native = []
        elif backend=='xshell':
            try:
                value = json.loads(raw)
            except json.JSONDecodeError:
                value = {}
            native = [item['runtime'] for item in value.get('instances',[]) if item.get('runtime')]
        else:
            native = []
        runtimes[backend] = [{key:runtime.get(key) for key in ['script_engine','python','platform','architecture','os_version','adapter_sha256',backend+'_version']} for runtime in native]
    result = {'scope':'real desktop / native SDK / SSH; UI startup is separately checked',
              'tested_on':time.strftime('%Y-%m-%d'), 'binary_sha256':hashlib.sha256(binary.read_bytes()).hexdigest(),
              'code_revision':revision,
              'source_sha256':{name:hashlib.sha256((ROOT/name).read_bytes()).hexdigest() for name in ['bridge/windows_bridge.js','bridge/securecrt_bridge.py','bridge/xshell_bridge.py']},
              'tabs':{backend:sum(t['backend']==backend for t in targets) for backend in args.backend},
              'runtime':runtimes,
              'wall_seconds':round(time.monotonic()-started,2),'explicit_recovery_probes':args.exercise_recovery,
              'passed':all(r['passed'] for r in results) and len(passing)==len(targets),'results':results}
    (directory/'matrix.json').write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
    rows=['# Desktop acceptance','',('PASS' if result['passed'] else 'FAIL')+'; '+str(len(targets))+' tabs; '+str(result['wall_seconds'])+' seconds.','',
          '| Target | Scenario | Result |','| --- | --- | --- |']
    rows += ['| '+r.get('label',r['backend'])+' | '+r['phase']+' | '+('PASS' if r['passed'] else 'FAIL')+' |' for r in results]
    (directory/'matrix.md').write_text('\n'.join(rows)+'\n',encoding='utf-8')
    print(('PASS' if result['passed'] else 'FAIL')+': matrix; '+str(result['wall_seconds'])+' seconds; '+str(directory/'matrix.json'),flush=True)
    return 0 if result['passed'] else 1


def main(args):
    try:
        return run_matrix(args)
    except Exception as error:
        directory=args.output_dir.resolve()
        directory.mkdir(parents=True,exist_ok=True)
        result={'passed':False,'phase':'controller-or-preflight','error_type':type(error).__name__,
                'requires_original_terminal_inspection':True,'automatic_retry':False,
                'reason':str(error) if isinstance(error,AssertionError) else 'Inspect local controller diagnostics; no automatic replay'}
        (directory/'matrix.json').write_text(json.dumps(result,indent=2)+'\n',encoding='utf-8')
        (directory/'matrix.md').write_text('# Desktop acceptance\n\nFAIL: controller or preflight. Inspect original terminals before retrying.\n',encoding='utf-8')
        print('FAIL: controller or preflight; '+type(error).__name__+'; '+str(directory/'matrix.json'),flush=True)
        return 1


if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('binary',type=Path)
    parser.add_argument('--backend',nargs='+',choices=['securecrt','xshell'],default=['securecrt','xshell'])
    parser.add_argument('--all-idle',action='store_true',help='Explicitly authorize harmless probes on all discovered idle tabs')
    parser.add_argument('--target',action='append',default=[],help='Explicit backend=opaque-id (may repeat)')
    parser.add_argument('--expect-securecrt',type=int)
    parser.add_argument('--expect-xshell',type=int)
    parser.add_argument('--jobs',type=int,default=4,choices=range(1,9))
    parser.add_argument('--exercise-recovery',action='store_true',help='Opt in to finite sleep timeout and tracked Ctrl+C probes')
    parser.add_argument('--output-dir',type=Path,default=Path('.local-evidence/desktop-matrix'))
    sys.exit(main(parser.parse_args()))
