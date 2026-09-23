import json
import os
from pathlib import Path
import subprocess
import tempfile
import threading
import time

from mcp_smoke import MCP


def test_compiled_mcp_discovers_xshell_through_file_ipc():
    binary = Path(__file__).parents[1] / "target" / "debug" / "securecrt-mcp.exe"
    if not binary.exists():
        binary = Path(__file__).parents[1] / "target" / "debug" / "securecrt-mcp"
    with tempfile.TemporaryDirectory() as directory:
        root = Path(directory)
        env = dict(os.environ, SECURECRT_MCP_HOME=str(root))
        subprocess.check_call([str(binary), "init"], env=env, stdout=subprocess.DEVNULL)
        config = json.loads((root / "xshell_bridge.json").read_text(encoding="utf-8"))
        ipc = Path(config["ipc_dir"])
        stop = threading.Event()

        def worker():
            while not stop.is_set():
                for request_path in sorted(ipc.glob("*.request.json")):
                    try:
                        request = json.loads(request_path.read_text(encoding="utf-8"))
                        request_path.unlink()
                        if request["method"] == "ping":
                            result = {"bridge_version": "0.5.0", "protocol_version": 2,
                                      "capabilities": ["poll_bulk", "file_ipc"]}
                        elif request["method"] == "list_sessions":
                            result = {"bridge_instance": "file-worker", "enumeration": "named_files",
                                      "sessions": [{"id": "file-worker/session-1",
                                                    "session_id": "file-worker/session-1",
                                                    "session_name": "php-test",
                                                    "tab_text": "root@php-test",
                                                    "connected": True,
                                                    "capabilities": ["exec", "batch", "screen_read"]}]}
                        else:
                            result = {"ok": True}
                        response = {"id": request["id"], "protocol_version": 2,
                                    "bridge_instance": "file-worker", "ok": True,
                                    "result": result, "sent": True}
                        temporary = ipc / ("." + request["id"] + ".response.tmp")
                        temporary.write_text(json.dumps(response), encoding="utf-8")
                        os.replace(temporary, ipc / (request["id"] + ".response.json"))
                    except FileNotFoundError:
                        pass
                time.sleep(0.01)

        thread = threading.Thread(target=worker, daemon=True)
        thread.start()
        mcp = MCP(binary, env)
        try:
            value = mcp.tool("connector_list")
            assert value["xshell"][0]["session_name"] == "php-test"
            assert value["xshell_enumeration"] == "named_files"
        finally:
            mcp.close()
            stop.set()
            thread.join(1)
