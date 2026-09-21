"""Standard-library client for an explicitly started securecrt-mcp daemon.
The daemon owns the Engine/attachments/results; no per-command Engine or SSH login.
Never retries or launches a fallback after an uncertain response.
"""
import json
import os
from pathlib import Path
import socket
import uuid

class SecureCRTClient:
    def __init__(self,home=None):
        self.home=Path(home or os.environ.get('SECURECRT_MCP_HOME') or Path.home()/'.securecrt-mcp')
    def call(self,method,**params):
        path=self.home/'daemon.json'
        if path.is_symlink():raise ValueError('refusing symlink daemon endpoint')
        endpoint=json.loads(path.read_text(encoding='utf-8'))
        port=endpoint['port']
        if not isinstance(port,int) or not 1024<=port<=65535:raise ValueError('invalid daemon port')
        request_id=str(uuid.uuid4())
        payload=(json.dumps(dict(id=request_id,token=endpoint['token'],method=method,params=params))+'\n').encode('utf-8')
        if len(payload)>262144:raise ValueError('request too large')
        with socket.create_connection(('127.0.0.1',port),timeout=2) as stream:
            stream.settimeout(75);stream.sendall(payload)
            with stream.makefile('rb') as source:line=source.readline(262145)
        if len(line)>262144 or not line.endswith(b'\n'):raise RuntimeError('invalid/oversized reply; execution outcome unknown; no retry')
        result=json.loads(line)
        if result.get('id')!=request_id:raise RuntimeError('response mismatch; do not replay')
        if not result.get('ok'):raise RuntimeError(result.get('error'))
        return result['result']
    def sessions(self):return self.call('sessions')
    def attach(self,session,mode='shared',expected_prompt=None):
        return self.call('attach',session=session,mode=mode,expected_prompt=expected_prompt)
    def execute(self,attachment_id,command,mode='posix',**options):
        return self.call('exec',attachment_id=attachment_id,command=command,mode=mode,**options)
    def output(self,command_id,**options):return self.call('output',command_id=command_id,**options)
    def detach(self,attachment_id):return self.call('detach',attachment_id=attachment_id)
