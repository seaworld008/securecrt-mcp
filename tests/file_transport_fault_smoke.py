"""Compiled Rust with two authenticated fake file adapters; no SSH or desktop.

Inject ready-file publication gaps while another instance remains available.
Bound commands must keep their original route and must never be replayed.
"""
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import threading
import time
import uuid

from mcp_smoke import FakeBridge, MCP


class FileAdapter:
    def __init__(self, root, token):
        self.instance = str(uuid.uuid4())
        self.directory = root / 'instances' / self.instance
        self.directory.mkdir(parents=True)
        self.token = token
        self.fake = FakeBridge()
        self.stop = threading.Event()
        self.publication_lock = threading.Lock()
        self.blocked_until = 0
        self.gap_kind = None
        self.gap_seconds = 0
        self.calls = []
        self.publish()
        self.thread = threading.Thread(target=self.serve, daemon=True)
        self.thread.start()

    def publish(self):
        data = dict(protocol_version=2, bridge_instance=self.instance,
                    last_poll_ms=int(time.time()*1000))
        temporary = self.directory / 'ready.tmp'
        temporary.write_text(json.dumps(data), encoding='utf-8')
        try:
            os.replace(temporary, self.directory/'ready.json')
        except PermissionError:
            # Windows reader sharing: retry publication on the next fixture tick.
            pass

    def method(self, name, params):
        self.calls.append(name)
        if name == 'list_sessions':
            return {'sessions':[{'id':self.instance+'/session/1', 'connected':True}]}
        result = self.fake.method(name, params)
        if name == 'attach':
            result['attachment_id'] = self.instance+'/attachment/1'
        if name == 'prepare_and_begin' and self.gap_seconds:
            self.pause_publication(self.gap_kind,self.gap_seconds)
        return result

    def pause_publication(self, kind, seconds):
        with self.publication_lock:
            self.blocked_until = time.monotonic()+seconds
            ready = self.directory/'ready.json'
            if kind == 'incomplete-json':
                ready.write_text('{', encoding='utf-8')
            else:
                ready.unlink(missing_ok=True)

    def serve(self):
        while not self.stop.wait(0.002):
            with self.publication_lock:
                if time.monotonic() >= self.blocked_until:
                    self.publish()
            for path in self.directory.glob('*.request.json'):
                try:
                    request = json.loads(path.read_text(encoding='utf-8'))
                    path.unlink()
                    assert request['token']==self.token
                    assert request['deadline_ms']>int(time.time()*1000)
                    response = dict(protocol_version=2, bridge_instance=self.instance,
                                    id=request['id'], ok=False, result=None, error=None)
                    try:
                        response.update(ok=True, result=self.method(request['method'],request['params']))
                    except Exception as error:
                        response['error']=str(error)
                    temporary = self.directory/(request['id']+'.response.tmp')
                    temporary.write_text(json.dumps(response),encoding='utf-8')
                    os.replace(temporary,self.directory/(request['id']+'.response.json'))
                except FileNotFoundError:
                    continue

    def close(self):
        self.stop.set()
        self.thread.join(timeout=2)
        self.fake.server_close()


def run(binary):
    binary = Path(binary).resolve()
    for backend in ('securecrt','xshell'):
        for gap in ('missing','incomplete-json'):
            with tempfile.TemporaryDirectory() as temporary:
                root=Path(temporary)
                env=dict(os.environ,SECURECRT_MCP_HOME=str(root))
                subprocess.run([str(binary),'init'],env=env,check=True,stdout=subprocess.DEVNULL)
                config=root/'config.toml'
                config.write_text(config.read_text().replace('mode = "client"','mode = "unrestricted"'),encoding='utf-8')
                secret_path=root/('bridge.json' if backend=='securecrt' else 'xshell_bridge.json')
                secret=json.loads(secret_path.read_text())
                ipc=root/(backend+'-fixture-ipc')
                secret['ipc_dir']=str(ipc)
                secret_path.write_text(json.dumps(secret),encoding='utf-8')
                a,b = FileAdapter(ipc,secret['token']),FileAdapter(ipc,secret['token'])
                client=MCP(binary,env)
                try:
                    opened=client.tool('connector_open',{'backend':backend,'target':a.instance+'/session/1','mode':'exec'})
                    a.gap_kind,a.gap_seconds=gap,0.08
                    value=client.tool('connector_exec',{'session_id':opened['session_id'],
                        'command':'printf route-once','mode':'posix','timeout_ms':2000,'wait_ms':3000})
                    until=time.monotonic()+5
                    while value['state'] in ('starting','running') and time.monotonic()<until:
                        value=client.tool('connector_get_status',{'command_id':value['command_id']})
                        time.sleep(0.01)
                    assert value['state']=='completed' and value['exit_code']==0,value
                    assert len(a.fake.sent)==1 and not b.fake.sent,'command replayed or sent to peer'
                    assert 'poll_bulk' in a.calls or 'poll' in a.calls
                    assert not any(name in b.calls for name in ('poll_bulk','poll','prepare_and_begin','begin')),'capture routed to peer'
                    # A genuinely offline bound instance must fail without calling B.
                    a.pause_publication('missing',2)
                    before=list(b.calls)
                    failed=client.tool('connector_read_screen',{'session_id':opened['session_id']},expect_error=True)
                    assert 'error' in failed,failed
                    assert b.calls==before,'offline bound instance was substituted'
                    print('PASS: '+backend+' / '+gap+' gap; original route, one send, offline fails closed',flush=True)
                finally:
                    client.close()
                    a.close()
                    b.close()


if __name__=='__main__':
    run(sys.argv[1])
