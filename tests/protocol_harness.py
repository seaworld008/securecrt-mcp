"""Wire-level protocol tests use a compiled server and an isolated fake bridge."""
from contextlib import contextmanager
import json
import os
from pathlib import Path
import subprocess
import tempfile
import threading

from mcp_smoke import FakeBridge, MCP

SUPPORTED = ['2026-07-28', '2025-11-25']


def modern_meta(version='2026-07-28'):
    return {'io.modelcontextprotocol/protocolVersion': version,
            'io.modelcontextprotocol/clientCapabilities': {},
            'io.modelcontextprotocol/clientInfo': {'name': 'protocol-consistency', 'version': '1'}}


@contextmanager
def wire_server():
    root = Path(__file__).resolve().parents[1]
    binary = root / 'target' / 'debug' / ('securecrt-mcp.exe' if os.name == 'nt' else 'securecrt-mcp')
    with tempfile.TemporaryDirectory() as directory, FakeBridge() as bridge:
        home = Path(directory)
        env = dict(os.environ, SECURECRT_MCP_HOME=str(home))
        subprocess.check_call([str(binary), 'init'], env=env, stdout=subprocess.DEVNULL)
        secret = json.loads((home / 'bridge.json').read_text())
        secret['port'] = bridge.server_address[1]
        (home / 'bridge.json').write_text(json.dumps(secret))
        config = home / 'config.toml'
        config.write_text(config.read_text().replace('port = 27855', 'port = ' + str(secret['port'])))
        thread = threading.Thread(target=bridge.serve_forever, daemon=True)
        thread.start()
        client = MCP(binary, env, initialize=False)
        try:
            yield client, bridge
        finally:
            if client.process.poll() is None:
                client.close()
            bridge.shutdown()
            thread.join(2)
