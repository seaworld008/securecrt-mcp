"""Real Rust -> TCP -> actual adapter code with fake native CRT screens.
No SSH, no production host. Timing measures connector overhead with buffered output,
not native desktop/VPN/LLM latency. Optional --baseline uses an older adapter source.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import socket
import subprocess
import sys
import tempfile
import threading
import time
from mcp_smoke import MCP
from test_bridge import Crt, Screen, Tab

ROOT=Path(__file__).resolve().parents[1]

class BufferedScreen(Screen):
    def __init__(self):
        super().__init__()
        self.buffer=''; self.ready=0; self.native_calls=0
    def Send(self,text):
        self.sent.append(text)
        if text=='\x03': self.buffer=''; return
        begin=re.search(r'MCP_BEGIN_[a-f0-9]+',text)
        end=re.search(r'MCP_END_[a-f0-9]+',text)
        if begin and end:
            output=('log-line '+ 'x'*118+'\n')*1600 if 'many-lines' in text else ('中'*70000 if 'long-line' in text else 'hello')
            self.buffer='echoed envelope\n'+begin[0]+'\n'+output+'\n'+end[0]+' 0\n'
        else:
            self.buffer='stream-data\n'
        self.ready=time.monotonic()+(0.2 if 'slow-command' in text else 0)
    def ReadString(self,patterns,seconds):
        assert seconds==1
        self.native_calls+=1
        if time.monotonic()<self.ready:
            time.sleep(0.001); self.MatchIndex=0; return ''
        positions=[(self.buffer.find(p),i,p) for i,p in enumerate(patterns) if p in self.buffer]
        if positions:
            at,i,p=min(positions)
            value=self.buffer[:at]; self.buffer=self.buffer[at+len(p):]; self.MatchIndex=i+1; return value
        value,self.buffer=self.buffer,'';self.MatchIndex=0
        if not value: time.sleep(0.001)
        return value

class App(Crt):
    class Dialog:
        @staticmethod
        def MessageBox(*args): pass
    def __init__(self,stop):
        super().__init__();self.stop=stop
        self.tabs.append(Tab(self,'test-c'))
        for tab in self.tabs: tab.Screen=BufferedScreen()
    def Sleep(self,ms):
        if self.stop.is_set(): raise RuntimeError('test stop')
        time.sleep(ms/1000)

class Harness:
    def __init__(self,binary,adapter_path=None):
        self.binary=Path(binary).resolve();self.temp=tempfile.TemporaryDirectory();self.root=Path(self.temp.name)
        self.env=dict(os.environ,SECURECRT_MCP_HOME=str(self.root))
        subprocess.check_call([str(self.binary),'init'],env=self.env,stdout=subprocess.DEVNULL)
        source=Path(adapter_path or ROOT/'bridge/securecrt_bridge.py').read_text(encoding='utf-8')
        ns={'__name__':'performance_native','__file__':str(ROOT/'bridge/securecrt_bridge.py')}
        exec(compile(source,'performance_native','exec'),ns)
        self.ns=ns
        with socket.socket() as sock:
            sock.bind(('127.0.0.1',0)); self.port=sock.getsockname()[1]
        self.secret=json.loads((self.root/'bridge.json').read_text(encoding='utf-8'))
        self.secret['port']=self.port
        (self.root/'bridge.json').write_text(json.dumps(self.secret),encoding='utf-8')
        cfg=self.root/'config.toml'
        cfg.write_text(cfg.read_text(encoding='utf-8').replace('port = 27855','port = '+str(self.port)),encoding='utf-8')
        self.stop=threading.Event(); self.app=App(self.stop)
        self.errors=[]
        def serve():
            try:ns['serve'](self.app,self.secret)
            except RuntimeError as exc:
                if not self.stop.is_set():self.errors.append(str(exc))
            except Exception as exc:self.errors.append(repr(exc))
        self.thread=threading.Thread(target=serve,daemon=True);self.thread.start()
        for _ in range(100):
            try:
                with socket.create_connection(('127.0.0.1',self.port),timeout=0.1):break
            except OSError:time.sleep(0.01)
        assert not self.errors,self.errors
        self.mcp=MCP(self.binary,self.env)
    def close(self):
        self.mcp.close();self.stop.set();self.thread.join(3)
        assert not self.thread.is_alive(),'adapter test thread did not stop'
        assert not self.errors,self.errors
        self.temp.cleanup()

def run(binary,adapter_path=None,baseline=False):
    h=Harness(binary,adapter_path)
    try:
        m=h.mcp
        ids=[s['id'] for s in m.tool('list_sessions')['sessions']]
        aid=None if baseline else m.tool('attach',dict(session=ids[0],mode='shared',expected_prompt='user$'))['attachment_id']
        def execute(command,wait=5000):
            if baseline:return m.tool('run_command',dict(session=ids[0],command=command,mode='posix',wait_ms=wait))
            return m.tool('exec',dict(attachment_id=aid,command=command,mode='posix',wait_ms=wait))
        times=[]
        for i in range(20):
            start=time.perf_counter();v=execute('printf hello');times.append((time.perf_counter()-start)*1000)
            assert v['state']=='completed' and v['exit_code']==0,v
        start=time.perf_counter();v=execute('many-lines',0)
        # Avoid MCP test helper's eight-second total budget for the old per-line path.
        until=time.monotonic()+60
        while v['state'] in ('starting','running') and time.monotonic()<until:
            time.sleep(0.05);v=m.tool('get_command_status',dict(command_id=v['command_id']))
        many_ms=(time.perf_counter()-start)*1000
        assert v['state']=='completed',v
        cid=v['command_id']; cursor=0; output=''
        while True:
            page=m.tool('get_command_output',dict(command_id=cid,cursor=cursor,max_bytes=65536));output+=page['text']
            cursor=page['next_cursor']
            if cursor is None:break
        assert len(output.encode())>100000 and output.count('log-line ')==1600
        many_polls=v.get('timing',{}).get('poll_calls')
        start=time.perf_counter();large=execute('long-line',5000)
        long_ms=(time.perf_counter()-start)*1000
        if not baseline:
            assert large['state']=='completed',large
            cursor=0;large_output=''
            while True:
                page=m.tool('get_command_output',dict(command_id=large['command_id'],cursor=cursor,max_bytes=65536));large_output+=page['text'];cursor=page['next_cursor']
                if cursor is None:break
            assert large_output=='中'*70000+'\n',len(large_output)
            assert many_polls<100,('still one RPC per line',many_polls)
            # Three simultaneous sessions; no global busy gate.
            jobs=[]
            for sid in ids:
                view=m.tool('attach',dict(session=sid,mode='shared',expected_prompt='user$'))
                jobs.append(m.tool('exec',dict(attachment_id=view['attachment_id'],command='slow-command',mode='posix',wait_ms=0)))
            assert all(j['sent'] for j in jobs),jobs
            for j in jobs:assert m.done(j['command_id'])['state']=='completed'
            # Batch results and independent exit boundaries; all commands visible up front.
            binding=m.tool('attach',dict(session=ids[0],expected_prompt='user$'))
            batch=m.tool('exec_batch',dict(attachment_id=binding['attachment_id'],commands=['printf one','printf two'],operation_id='batch-perf'))
            for _ in range(100):
                batch=m.tool('get_batch_status',dict(batch_id=batch['batch_id']))
                if batch['state']!='running':break
                time.sleep(0.02)
            assert batch['state']=='completed' and len(batch['results'])==2,batch
            assert all(r['exit_code']==0 for r in batch['results'])
            assert m.tool('exec_batch',dict(attachment_id=binding['attachment_id'],commands=['printf one','printf two'],operation_id='batch-perf'))['batch_id']==batch['batch_id']
            latency=m.tool('latency')
            assert latency['transport']['connections_reused']>20,latency
        else:latency={}
        report=dict(label='baseline' if baseline else 'persistent',scope='real Rust/TCP/adapter, fake already-buffered native screens; NOT SSH or LLM latency',
            commands=20,short_commands_ms=times,short_p50_ms=sorted(times)[10],short_total_ms=sum(times),
            many_lines=1600,many_output_bytes=len(output.encode()),many_lines_ms=many_ms,many_lines_poll_calls=many_polls,
            long_line_bytes=210000,long_line_state=large['state'],long_line_ms=long_ms,latency=latency)
        print('PERFORMANCE_REPORT='+json.dumps(report))
        return report
    finally:h.close()

if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('binary');p.add_argument('--adapter');p.add_argument('--baseline',action='store_true');p.add_argument('--output')
    a=p.parse_args();report=run(a.binary,a.adapter,a.baseline)
    if a.output:Path(a.output).write_text(json.dumps(report,indent=2),encoding='utf-8')
