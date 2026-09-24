"""Whole-branch regressions against compiled MCP. No native or remote commands run."""
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import threading
import time
from mcp_smoke import MCP
from ux_smoke import UXBridge, SID


class ReviewBridge(UXBridge):
    def __init__(self):
        super().__init__()
        self.grace_until = 0

    def method(self, name, p):
        if name in ('begin', 'prepare_and_begin') and self.fault == 'no-send-evidence':
            self.fault = None
            super().method(name, p)
            return {}
        if name in ('begin', 'prepare_and_begin') and 'grace-command' in p['text']:
            self.grace_until = time.monotonic()+0.25
        if name in ('poll', 'poll_bulk') and time.monotonic() < self.grace_until:
            time.sleep(0.03)
            return {'text':'','overflow':False,'expired':False,'capture_may_be_incomplete':True}
        return super().method(name, p)


def run(binary):
    binary = str(Path(binary).resolve())
    with tempfile.TemporaryDirectory() as tmp, ReviewBridge() as bridge:
        env = dict(os.environ, SECURECRT_MCP_HOME=tmp)
        subprocess.check_call([binary,'init'],env=env,stdout=subprocess.DEVNULL)
        p = Path(tmp)/'config.toml'
        p.write_text(p.read_text().replace('port = 27855', 'port = '+str(bridge.server_address[1]))
                     .replace('max_jobs = 32','max_jobs = 4'))
        secret = Path(tmp)/'bridge.json'; data=json.loads(secret.read_text())
        data['port']=bridge.server_address[1]; secret.write_text(json.dumps(data))
        threading.Thread(target=bridge.serve_forever,daemon=True).start()
        mcp = MCP(binary,env)
        def call(**extra):
            return mcp.tool('run_command',dict(session=SID,command='printf hello',mode='posix',**extra))
        call(operation_id='original')
        for i in range(12):
            assert call(operation_id='cache-'+str(i))['state']=='completed'
        before=len(bridge.sent)
        old=mcp.tool('run_command', dict(session=SID, command='printf hello', mode='posix', operation_id='original'), expect_error=True)
        assert old['error']['data']['error_code'] == 'command_not_found' and len(bridge.sent)==before, 'eviction allowed replay'
        active=mcp.tool('run_command',dict(session=SID,command='slow-command',mode='posix',timeout_ms=1000,wait_ms=0))
        assert mcp.done(active['command_id'])['state']=='timed_out'
        view=mcp.tool('read_screen',dict(session=SID))
        mcp.tool('acknowledge_idle',dict(session=SID,screen_token=view['screen_token'],expected_prompt='user$'))
        assert mcp.tool('get_command_status',dict(command_id=active['command_id']))['requires_idle_ack'] is False, 'acknowledged job still requests acknowledgement'
        bridge.fault='no-send-evidence'
        unknown=call()
        assert unknown['state']=='unknown' and unknown['sent'] is None, 'malformed begin success was treated as confirmed send'
        mcp.close()
        # Fake operator reset, not an automatic production recovery implementation.
        bridge.active=None; bridge.unresolved=False
        mcp=MCP(binary,env)
        job=mcp.tool('run_command',dict(session=SID,command='grace-command',mode='posix',wait_ms=0))
        assert job['state']=='running'
        mcp.close()
        assert bridge.active is None and bridge.unresolved is False, 'graceful EOF abandoned an almost-complete command'
        assert not bridge.interrupts
        bridge.shutdown()
    print('PASS: cache eviction/no replay, explicit recovery status, malformed send evidence, bounded graceful EOF drain')


if __name__=='__main__':
    run(sys.argv[1])
