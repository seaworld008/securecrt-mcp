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
        ipc_root = Path(config["ipc_dir"])
        ipc = ipc_root / "instances" / "file-worker"
        ipc.mkdir(parents=True)
        (ipc / "ready.json").write_text(json.dumps({
            "bridge_instance": "file-worker", "bridge_version": "0.5.0",
            "protocol_version": 2, "started_ms": int(time.time() * 1000),
        }), encoding="utf-8")
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
            assert value["xshell_enumeration"] == "instance_registry"
        finally:
            mcp.close()
            stop.set()
            thread.join(1)


def test_compiled_mcp_aggregates_and_routes_multiple_xshell_instances():
    binary = Path(__file__).parents[1] / "target" / "debug" / "securecrt-mcp.exe"
    if not binary.exists():
        binary = Path(__file__).parents[1] / "target" / "debug" / "securecrt-mcp"
    with tempfile.TemporaryDirectory() as directory:
        root = Path(directory)
        env = dict(os.environ, SECURECRT_MCP_HOME=str(root))
        subprocess.check_call([str(binary), "init"], env=env, stdout=subprocess.DEVNULL)
        ipc_root = Path(json.loads((root / "xshell_bridge.json").read_text(encoding="utf-8"))["ipc_dir"])
        workers = []
        stop = threading.Event()

        def worker(instance, session_name):
            ipc = ipc_root / "instances" / instance
            ipc.mkdir(parents=True, exist_ok=True)
            ready = ipc / "ready.json"
            def heartbeat():
                temporary = ipc / ".ready.json.tmp"
                temporary.write_text(json.dumps({"bridge_instance": instance, "bridge_version": "0.5.0",
                                                 "protocol_version": 2, "last_poll_ms": int(time.time() * 1000)}), encoding="utf-8")
                try:
                    os.replace(temporary, ready)
                except PermissionError:
                    temporary.unlink(missing_ok=True)
            heartbeat()
            while not stop.is_set():
                heartbeat()
                for request_path in sorted(ipc.glob("*.request.json")):
                    try:
                        request = json.loads(request_path.read_text(encoding="utf-8"))
                        request_path.unlink()
                        method = request["method"]
                        if method == "ping":
                            result = {"bridge_version": "0.5.0", "protocol_version": 2,
                                      "capabilities": ["poll_bulk", "file_ipc"]}
                        elif method == "list_sessions":
                            result = {"bridge_instance": instance, "enumeration": "named_files",
                                      "capabilities": ["poll_bulk"],
                                      "sessions": [{"id": f"{instance}/session-1", "session_id": f"{instance}/session-1",
                                                    "session_name": session_name, "connected": True}]}
                        elif method == "attach":
                            result = {"attachment_id": f"attachment-{instance}", "session": f"{instance}/session-1",
                                      "mode": "shared", "current_line": "root# "}
                        else:
                            result = {"sent": True, "text": "", "capture_id": request.get("params", {}).get("capture_id")}
                        response = {"id": request["id"], "protocol_version": 2, "bridge_instance": instance,
                                    "ok": True, "result": result, "sent": True}
                        temporary = ipc / ("." + request["id"] + ".response.tmp")
                        temporary.write_text(json.dumps(response), encoding="utf-8")
                        os.replace(temporary, ipc / (request["id"] + ".response.json"))
                    except FileNotFoundError:
                        pass
                time.sleep(0.01)

        for instance, name in (("instance-a", "alpha"), ("instance-b", "beta")):
            thread = threading.Thread(target=worker, args=(instance, name), daemon=True)
            workers.append(thread)
            thread.start()
        for _ in range(100):
            if all((ipc_root / "instances" / instance / "ready.json").exists()
                   for instance in ("instance-a", "instance-b")):
                break
            time.sleep(0.01)
        mcp = MCP(binary, env)
        try:
            listed = mcp.tool("connector_list")
            assert {item["session_name"] for item in listed["xshell"]} == {"alpha", "beta"}, listed
            opened = mcp.tool("connector_open", {"backend": "xshell", "target": "instance-b/session-1", "mode": "exec"})
            assert opened.get("attachment_id", "").startswith("instance-b/"), opened
        finally:
            mcp.close()
            stop.set()
            for thread in workers:
                thread.join(1)
