"""Actual adapter transport fragmentation, uncertain delivery and bounded stream recovery.
The native screen is a fake; never executes remote commands.
"""
import json
import socket
import sys
import time
import tomllib
from performance_smoke import Harness

def run(binary):
    h=Harness(binary)
    try:
        m=h.mcp
        names={t['name']:t for t in m.request('tools/list',{})['result']['tools']}
        required=['attach','exec','exec_batch','get_batch_status','heartbeat','detach','shell_open','shell_read','shell_write','shell_close','latency']
        assert all('securecrt_'+n in names for n in required)
        assert names['securecrt_exec_batch']['annotations']['destructiveHint']
        assert names['securecrt_shell_write']['annotations']['readOnlyHint'] is False
        # Persistent framing: fragment a request across writes, then exchange another on same socket.
        with socket.create_connection(('127.0.0.1',h.port),timeout=2) as stream:
            stream.settimeout(5)
            with stream.makefile('rb') as source:
                for number in range(2):
                    q=dict(protocol_version=2,id='fragment-'+str(number),token=h.secret['token'],client_id='wire-test',
                           keep_alive=True,deadline_ms=int(time.time()*1000)+5000,method='ping',params={})
                    wire=(json.dumps(q)+'\n').encode();stream.sendall(wire[:17]);stream.sendall(wire[17:])
                    response=json.loads(source.readline())
                    assert response['id']==q['id'] and response['ok'] and response['persistent']
        sid=m.tool('list_sessions')['sessions'][0]['id']
        binding=m.tool('attach',dict(session=sid,expected_prompt='user$'))
        # A lost reply AFTER a successful native Send must not be replayed or classified as unsent.
        original=h.ns['handle_request'];lost=[False]
        def drop_once(adapter,request,token):
            value=original(adapter,request,token)
            if request.get('method')=='prepare_and_begin' and not lost[0]:
                lost[0]=True
                raise ConnectionAbortedError('injected AFTER native Send')
            return value
        h.ns['handle_request']=drop_once
        before=len(h.app.tabs[0].Screen.sent)
        result=m.tool('exec',dict(attachment_id=binding['attachment_id'],command='printf lost',mode='posix',operation_id='lost-reply'))
        assert result['state']=='unknown' and result['sent'] is None,result
        assert len(h.app.tabs[0].Screen.sent)==before+1,'lost exchange replayed'
        again=m.tool('exec',dict(attachment_id=binding['attachment_id'],command='printf lost',mode='posix',operation_id='lost-reply'))
        assert again['command_id']==result['command_id'] and len(h.app.tabs[0].Screen.sent)==before+1
        assert m.tool('bridge_status')['protocol_version']==2,'new read-only exchange could not reconnect'
        assert '\x03' not in h.app.tabs[0].Screen.sent
        m.tool('interrupt',dict(command_id=result['command_id']))
        view=m.tool('read_screen',dict(session=sid))
        m.tool('acknowledge_idle',dict(session=sid,screen_token=view['screen_token'],expected_prompt='user$'))
        h.ns['handle_request']=original
        # Native stream retains a bounded rolling tail, reporting an explicit cursor gap.
        binding=m.tool('attach',dict(session=sid,expected_prompt='user$'))
        stream=m.tool('shell_open',dict(attachment_id=binding['attachment_id'],command='stream-test',mode='stream',timeout_ms=10000))
        h.app.tabs[0].Screen.buffer='x'*(1048576+10000)+'\n'
        until=time.monotonic()+8
        while time.monotonic()<until:
            status=m.tool('get_command_status',dict(command_id=stream['command_id']))
            if status['output_start']>0:break
            time.sleep(0.02)
        page=m.tool('shell_read',dict(command_id=stream['command_id'],cursor=0,max_bytes=1000,wait_ms=0))
        assert page['gap'] and page['dropped_bytes']>0 and len(page['text'])<=1000,page
        control_count=h.app.tabs[0].Screen.sent.count('\x03')
        closed=m.tool('shell_close',dict(command_id=stream['command_id']))
        assert closed['state']=='cancelled' and closed['requires_idle_ack'],closed
        assert h.app.tabs[0].Screen.sent.count('\x03')==control_count,'local capture close interrupted remote work'
        view=m.tool('read_screen',dict(session=sid))
        m.tool('acknowledge_idle',dict(session=sid,screen_token=view['screen_token'],expected_prompt='user$'))
        print('PASS: persistent fragmented exchanges, reconnect without replay, uncertain send, bounded stream gaps and explicit close')
    finally:h.close()

if __name__=='__main__':run(sys.argv[1])
