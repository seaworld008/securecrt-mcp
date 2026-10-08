"""Build-time generator. The resulting scripts never call Python or download files."""
import base64
import hashlib
import json
from pathlib import Path


def windows_scripts(repository: Path, binary: Path) -> dict:
    payload = binary.read_bytes()
    encoded = base64.b64encode(payload).decode('ascii')
    source = (repository / 'bridge/windows_bridge.js').read_bytes().decode('utf-8')
    launcher = (repository / 'bridge/portable_launcher.js').read_text(encoding='utf-8')
    common = (
        '// Self-contained Windows package; select this file inside the terminal.\n'
        'var MCP_BINARY_SHA256 = ' + json.dumps(hashlib.sha256(payload).hexdigest()) + ';\n'
        'var MCP_BINARY_SIZE = ' + str(len(payload)) + ';\n'
        'var MCP_NATIVE_SOURCE = ' + json.dumps(source, ensure_ascii=True) + ';\n'
        'var MCP_BINARY_BASE64 = [\n' + ',\n'.join(json.dumps(encoded[i:i+8192])
                                                  for i in range(0, len(encoded), 8192)) + '\n];\n'
        + launcher
    )
    result = {}
    for backend in ('xshell', 'securecrt'):
        header = '# $language = "JScript"\n# $interface = "1.0"\n' if backend == 'securecrt' else ''
        result['securecrt-mcp-' + backend + '.js'] = (
            header + 'var MCP_BACKEND = ' + json.dumps(backend) + ';\n' + common
        ).encode('ascii')
    return result
