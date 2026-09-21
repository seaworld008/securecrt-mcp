"""Compile-time CLI + retained daemon engine test, using actual adapter with fake screens."""
import json
from pathlib import Path
import subprocess
import sys
import time
from performance_smoke import Harness

def run(binary):
    help=subprocess.run([binary,'daemon','--help'],capture_output=True,text=True)
    assert help.returncode==0,'daemon command missing'
    h=Harness(binary)
    proc=None
    try:
        proc=subprocess.Popen([str(h.binary),'daemon'],env=h.env,stdout=subprocess.DEVNULL,stderr=subprocess.PIPE,text=True,encoding='utf-8')
        path=h.root/'daemon.json'
        for _ in range(100):
            if path.exists() and path.stat().st_size:break
            if proc.poll() is not None:raise AssertionError(proc.stderr.read())
            time.sleep(0.02)
        assert path.exists(),'daemon did not publish endpoint'
        def cli(method,params):
            request=h.root/'request.json';request.write_text(json.dumps(params,ensure_ascii=False),encoding='utf-8')
            return json.loads(subprocess.check_output([str(h.binary),'session',method,'--input',str(request)],env=h.env,text=True,encoding='utf-8'))
        sid=cli('sessions',{})['sessions'][0]['id']
        attach=cli('attach',dict(session=sid,mode='shared',expected_prompt='user$'))
        result=cli('exec',dict(attachment_id=attach['attachment_id'],command='printf hello',mode='posix',operation_id='persistent-cli-op'))
        assert result['state']=='completed' and result['exit_code']==0,result
        assert cli('output',dict(command_id=result['command_id']))['text']=='hello\n'
        count=len(h.app.tabs[0].Screen.sent)
        again=cli('exec',dict(attachment_id=attach['attachment_id'],command='printf hello',mode='posix',operation_id='persistent-cli-op'))
        assert again['command_id']==result['command_id'] and len(h.app.tabs[0].Screen.sent)==count
        # Python reusable client shares daemon state, not a new Engine.
        sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'clients'))
        from persistent_client import SecureCRTClient
        client=SecureCRTClient(h.root)
        assert client.output(result['command_id'])['text']=='hello\n'
        # Existing one-shot CLI automatically uses the explicitly running daemon.
        request=h.root/'run.json';request.write_text(json.dumps(dict(session=sid,command='printf hello',mode='posix')),encoding='utf-8')
        routed=json.loads(subprocess.check_output([str(h.binary),'run','--input',str(request)],env=h.env,text=True,encoding='utf-8'))
        assert routed['client']=='persistent_daemon' and routed['output_available_after_exit']
        assert cli('output',dict(command_id=routed['command_id']))['text']=='hello\n'
        cli('detach',dict(attachment_id=attach['attachment_id']))
        subprocess.check_call([str(h.binary),'daemon','--stop'],env=h.env,stdout=subprocess.DEVNULL)
        proc.wait(timeout=5);assert proc.returncode==0,proc.stderr.read()
        assert not path.exists(),'graceful daemon exit left stale identity'
        print('PASS: daemon attachment/result cache survives separate CLI/Python processes; no replay')
    finally:
        if proc and proc.poll() is None:proc.terminate();proc.wait(timeout=5)
        if proc and proc.stderr:proc.stderr.close()
        h.close()

if __name__=='__main__':run(sys.argv[1])
