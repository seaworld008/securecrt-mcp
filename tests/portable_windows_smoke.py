"""Windows WSH bootstrap with an isolated profile and no Python/Node on child PATH.

The controller is a developer test. The generated end-user scripts use only WSH,
Windows COM and the embedded executable. Hosts here are fixtures, not desktops.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import time
import uuid

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'scripts'))
from portable_scripts import windows_scripts


def ipc_publication_stress(work, source, cscript):
    root = work / 'concurrent-ipc'
    root.mkdir()
    manifest = {'bridge_instance': 'stress-instance', 'ipc_dir': str(root),
                'adapter_sha256': hashlib.sha256(source.encode('utf-8')).hexdigest(),
                'token': 'stress-token', 'runtime': {}}
    driver = work / 'concurrent-ipc.js'
    stop = root / 'stop.flag'
    driver.write_text(source + "\n" +
        'mcpNotifyStarted=function(){};\n' +
        'var stopPath=' + json.dumps(str(stop)) + ';\n' +
        'var host={GetTabCount:function(){return 0;},Sleep:function(ms){' +
        'if(new ActiveXObject("Scripting.FileSystemObject").FileExists(stopPath)) throw "script cancelled";' +
        'WScript.Sleep(ms);}};\n' +
        'try{mcpServeWindows(host,"securecrt",' + json.dumps(manifest) + ',' +
        json.dumps(source) + ');}catch(e){if(String(e).indexOf("cancelled")<0){WScript.Echo(mcpError(e));WScript.Quit(9);}}',
        encoding='ascii')
    process = subprocess.Popen([str(cscript), '//nologo', '//E:JScript', str(driver)],
                               stdout=subprocess.PIPE, stderr=subprocess.STDOUT)
    directory = root / 'instances' / 'stress-instance'
    until = time.monotonic()+40
    started=time.monotonic()
    try:
        while not (directory / 'ready.json').exists():
            assert process.poll() is None and time.monotonic()<until, 'native IPC stress did not start'
            time.sleep(0.01)
        # Consume and unlink responses while COM enumerates the same directory.
        for _ in range(200):
            pending = []
            for _ in range(4):
                request_id = str(uuid.uuid4())
                request = {'id': request_id, 'protocol_version': 2, 'token': 'stress-token',
                           'client_id': 'stress-client', 'deadline_ms': int(time.time()*1000)+35000,
                           'method': 'list_sessions', 'params': {}}
                temporary = directory / (request_id+'.tmp')
                temporary.write_text(json.dumps(request), encoding='ascii')
                temporary.rename(directory / (request_id+'.request.json'))
                pending.append(directory / (request_id+'.response.json'))
            batch_until=time.monotonic()+35
            while pending:
                assert process.poll() is None, 'native IPC loop exited during concurrent consumption'
                assert time.monotonic()<batch_until, 'native IPC response batch exceeded its 35-second request budget; no replay'
                for response in pending[:]:
                    try:
                        value = json.loads(response.read_text(encoding='utf-8-sig'))
                    except (FileNotFoundError, PermissionError):
                        continue
                    assert value['ok'] and value['result']['sessions']==[]
                    response.unlink()
                    pending.remove(response)
                time.sleep(0.001)
        print('PASS: 800 authenticated native IPC requests with concurrent response deletion; %.2f seconds' % (time.monotonic()-started), flush=True)
    finally:
        stop.write_text('stop',encoding='ascii')
        try:
            output,_ = process.communicate(timeout=5)
        except subprocess.TimeoutExpired:
            process.kill(); process.communicate()
            raise AssertionError('native stress loop did not stop')
        if output:
            print('Native fixture diagnostic: '+output.decode(errors='replace'),flush=True)
    assert process.returncode==0, output.decode(errors='replace')
    assert not (directory / 'ready.json').exists(), 'native stress cancellation left ready registry'


def run(binary):
    assert os.name == 'nt', 'WSH smoke requires Windows'
    scripts = windows_scripts(ROOT, binary)
    source = (ROOT / 'bridge/windows_bridge.js').read_bytes().decode('utf-8')
    digest = hashlib.sha256(binary.read_bytes()).hexdigest()
    windir = Path(os.environ['WINDIR'])
    with tempfile.TemporaryDirectory(prefix='MCP 中文 bootstrap ') as temporary:
        work = Path(temporary)
        ipc_publication_stress(work, source, windir / 'System32/cscript.exe')
        core_probe = work / 'core.js'
        core_probe.write_text(source + '''
if (mcpSha256("abc") != "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad") throw Error("SHA mismatch");
if (mcpParse(mcpJson({text:"\\u4e2d\\u6587", list:[1,true,null]})).text != "\\u4e2d\\u6587") throw Error("JSON mismatch");
var fso=new ActiveXObject("Scripting.FileSystemObject");
var xml=new ActiveXObject("MSXML2.DOMDocument.6.0");
var node=xml.createElement("test");node.dataType="bin.base64";node.text="YWJj";
var stream=new ActiveXObject("ADODB.Stream");stream.Type=1;stream.Open();stream.Write(node.nodeTypedValue);stream.Close();
if(typeof fso.CreateTextFile == "undefined") throw Error("native method typeof unavailable");
var caught=false;try {mcpFail("test detailed error");}catch(e){caught=mcpError(e).indexOf("test detailed error")>=0;}
if(!caught) throw Error("error detail unavailable");
WScript.Echo("PASS: classic JScript SHA/JSON and native COM extraction");
''', encoding='ascii')
        for engine in ('System32', 'SysWOW64'):
            cscript = windir / engine / 'cscript.exe'
            subprocess.run([str(cscript), '//nologo', '//E:JScript', str(core_probe)], check=True, timeout=30)
            for backend in ('xshell', 'securecrt'):
                profile = work / (engine + '-' + backend)
                child_env = dict(os.environ, SECURECRT_MCP_HOME=str(profile), PATH=str(windir / engine))
                # One disconnected native fixture; cancellation stops only this test loop.
                fixture = '''
var turns=0;
function stop(ms){if (++turns>3) throw Error("script cancelled");WScript.Sleep(ms);}
var xsh={Session:{Connected:false,Sleep:stop,Path:""},Screen:{}};
var crt={Version:"9.0.0",GetTabCount:function(){return 0;},Sleep:stop};
'''
                entry = scripts['securecrt-mcp-' + backend + '.js'].decode('ascii')
                if backend == 'securecrt':
                    entry = '\n'.join(entry.split('\n')[2:])
                # Report a bootstrap failure to the test runner, never block on a modal popup.
                entry = entry.replace('shell.Popup("SecureCRT MCP: " + message, 0, "SecureCRT MCP", 16);', 'throw error;')
                driver = work / (engine + '-' + backend + '.js')
                # Suppress only the UI notification in this developer fixture.
                entry = entry.replace('eval(MCP_NATIVE_SOURCE);', 'eval(MCP_NATIVE_SOURCE);mcpNotifyStarted=function(){};mcpNotify=function(f,d,m,style){if(style==16) WScript.Quit(9);};')
                startup = '\nMain();' if backend == 'xshell' else ''
                driver.write_text(fixture + entry + startup + '\nif(turns<1) throw Error("native loop did not start");\n', encoding='ascii')
                for iteration in (1, 2):
                    subprocess.run([str(cscript), '//nologo', '//E:JScript', str(driver)],
                                   env=child_env, check=True, timeout=45, capture_output=True)
                    secret_path = profile / ('bridge.json' if backend == 'securecrt' else 'xshell_bridge.json')
                    secret = json.loads(secret_path.read_text(encoding='utf-8'))
                    assert Path(secret['ipc_dir']) == profile / (backend + '-native-ipc')
                    assert hashlib.sha256((profile / 'bin' / digest / 'securecrt-mcp.exe').read_bytes()).hexdigest() == digest
                    assert not list(profile.glob('*.py')), 'native startup must not deploy Python'
                    assert not list(profile.glob('*.bak')), 'trial initialization must not add upgrade backups'
                    assert not list(profile.glob('native-start-*.json')), 'temporary token-bearing manifest must be removed'
                    assert not list((profile / (backend + '-native-ipc')).rglob('ready.json')), 'cancelled fixture must remove heartbeat'
                    config = (profile / 'config.toml').read_bytes()
                    if iteration == 1:
                        token, config_bytes = secret['token'], config
                    else:
                        assert token == secret['token'] and config_bytes == config
                print('PASS: ' + engine + ' ' + backend + ' embedded extraction, no-Python PATH, restart, token/config preservation', flush=True)
                if engine == 'System32' and backend == 'xshell':
                    subprocess.run([str(binary), 'upgrade'], env=child_env, check=True, capture_output=True, timeout=30)
                    upgraded = json.loads(secret_path.read_text(encoding='utf-8'))
                    assert upgraded['token'] == token and upgraded['ipc_dir'] == secret['ipc_dir']
                    assert (profile / 'xshell-scripts/securecrt-mcp-xshell.js').is_file()
                    assert (profile / 'securecrt-mcp-securecrt.js').is_file()
                    assert (profile / 'config.toml').read_bytes() == config_bytes
                    print('PASS: upgrade refreshes fixed native entries and preserves selected native transport', flush=True)
        print('PASS: isolated Windows bootstrap; real terminal acceptance remains required')


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('binary', type=Path)
    run(parser.parse_args().binary.resolve())
