# $language = "Python3"
# $interface = "1.0"
#
# securecrt-mcp in-process bridge
#
# IMPORTANT: This file must be run by SecureCRT (Script > Run...).
# A normal external Python interpreter cannot access SecureCRT's `crt` object.

import json
import socket
from pathlib import Path

APP_DIR = Path.home() / ".securecrt-mcp"
CONFIG_PATH = APP_DIR / "bridge.json"
BRIDGE_VERSION = "0.1.0"


def load_config():
    with CONFIG_PATH.open("r", encoding="utf-8") as handle:
        cfg = json.load(handle)
    host = cfg.get("host", "127.0.0.1")
    if host != "127.0.0.1":
        raise ValueError("bridge host must be 127.0.0.1")
    if not cfg.get("token"):
        raise ValueError("bridge token is missing")
    return cfg


def get_tab(selector):
    if selector is None:
        raise ValueError("session is required")

    if isinstance(selector, int):
        index = selector
    else:
        value = str(selector).strip()
        if value.lower().startswith("tab:"):
            index = int(value.split(":", 1)[1])
        elif value.isdigit():
            index = int(value)
        else:
            matches = []
            for i in range(1, crt.GetTabCount() + 1):
                tab = crt.GetTab(i)
                if tab.Caption == value:
                    matches.append(tab)
            if not matches:
                raise ValueError("no SecureCRT tab has caption: {0}".format(value))
            if len(matches) > 1:
                raise ValueError(
                    "multiple tabs have caption {0}; use tab:<index> instead".format(value)
                )
            return matches[0]

    if index < 1 or index > crt.GetTabCount():
        raise ValueError("tab index out of range: {0}".format(index))
    return crt.GetTab(index)


def safe_session_metadata(tab):
    result = {}
    try:
        cfg = tab.Session.Config
        for key, output_name in (
            ("Hostname", "hostname"),
            ("Username", "username"),
            ("Protocol Name", "protocol"),
            ("Port", "port"),
        ):
            try:
                result[output_name] = cfg.GetOption(key)
            except Exception:
                pass
    except Exception:
        pass
    return result


def tab_to_dict(tab, script_tab_index):
    data = {
        "id": "tab:{0}".format(tab.Index),
        "index": tab.Index,
        "caption": tab.Caption,
        "connected": bool(tab.Session.Connected),
        "bridge_host_tab": tab.Index == script_tab_index,
    }
    data.update(safe_session_metadata(tab))
    return data


def visible_screen(tab, start_row=None, end_row=None, trim=True):
    rows = int(tab.Screen.Rows)
    cols = int(tab.Screen.Columns)
    start = 1 if start_row is None else int(start_row)
    end = rows if end_row is None else int(end_row)
    start = max(1, min(start, rows))
    end = max(start, min(end, rows))
    text = tab.Screen.Get2(start, 1, end, cols)
    if trim:
        lines = [line.rstrip() for line in text.splitlines()]
        while lines and not lines[-1]:
            lines.pop()
        text = "\n".join(lines)
    return {
        "session": "tab:{0}".format(tab.Index),
        "caption": tab.Caption,
        "rows": rows,
        "columns": cols,
        "start_row": start,
        "end_row": end,
        "text": text,
    }


def dispatch(method, params, script_tab_index):
    if method == "ping":
        return {
            "bridge": "securecrt-mcp",
            "bridge_version": BRIDGE_VERSION,
            "securecrt_tabs": crt.GetTabCount(),
            "script_host_tab": "tab:{0}".format(script_tab_index),
        }

    if method == "list_sessions":
        sessions = []
        for i in range(1, crt.GetTabCount() + 1):
            sessions.append(tab_to_dict(crt.GetTab(i), script_tab_index))
        return {"sessions": sessions, "count": len(sessions)}

    if method == "read_screen":
        tab = get_tab(params.get("session"))
        return visible_screen(
            tab,
            params.get("start_row"),
            params.get("end_row"),
            params.get("trim", True),
        )

    if method == "focus_session":
        tab = get_tab(params.get("session"))
        tab.Activate()
        return {"session": "tab:{0}".format(tab.Index), "caption": tab.Caption}

    if method == "send_text":
        tab = get_tab(params.get("session"))
        if not tab.Session.Connected:
            raise ValueError("target tab is not connected")
        text = params.get("text", "")
        if not isinstance(text, str):
            raise ValueError("text must be a string")
        if params.get("append_enter", False):
            text += "\r"
        tab.Screen.Send(text)
        return {"session": "tab:{0}".format(tab.Index), "sent": True}

    if method == "interrupt":
        tab = get_tab(params.get("session"))
        if not tab.Session.Connected:
            raise ValueError("target tab is not connected")
        tab.Screen.Send("\x03")
        return {"session": "tab:{0}".format(tab.Index), "interrupted": True}

    if method == "execute_command":
        tab = get_tab(params.get("session"))
        if not tab.Session.Connected:
            raise ValueError("target tab is not connected")
        command = params.get("command")
        if not isinstance(command, str) or not command.strip():
            raise ValueError("command must be a non-empty string")
        if "\n" in command or "\r" in command:
            raise ValueError("multi-line commands are not accepted")

        timeout_ms = int(params.get("timeout_ms", 5000))
        timeout_seconds = max(1, int((timeout_ms + 999) / 1000))
        settle_ms = max(25, int(params.get("settle_ms", 750)))
        wait_for = params.get("wait_for")

        if wait_for:
            old_sync = tab.Screen.Synchronous
            try:
                tab.Screen.Synchronous = True
                tab.Screen.Send(command + "\r")
                output = tab.Screen.ReadString(str(wait_for), timeout_seconds)
                return {
                    "session": "tab:{0}".format(tab.Index),
                    "caption": tab.Caption,
                    "mode": "read_string",
                    "wait_for": wait_for,
                    "output": output,
                }
            finally:
                tab.Screen.Synchronous = old_sync

        tab.Screen.Send(command + "\r")
        crt.Sleep(settle_ms)
        snapshot = visible_screen(tab, None, None, True)
        snapshot["mode"] = "screen_snapshot"
        snapshot["settle_ms"] = settle_ms
        return snapshot

    raise ValueError("unsupported bridge method: {0}".format(method))


def recv_line(conn, max_bytes):
    data = bytearray()
    while len(data) < max_bytes:
        chunk = conn.recv(min(4096, max_bytes - len(data)))
        if not chunk:
            break
        data.extend(chunk)
        if b"\n" in chunk:
            break
    if len(data) >= max_bytes and b"\n" not in data:
        raise ValueError("request exceeds max_request_bytes")
    line = bytes(data).split(b"\n", 1)[0]
    return line.decode("utf-8")


def main():
    cfg = load_config()
    host = cfg.get("host", "127.0.0.1")
    port = int(cfg.get("port", 27855))
    token = cfg["token"]
    max_bytes = int(cfg.get("max_request_bytes", 1048576))
    script_tab = crt.GetScriptTab()
    script_tab_index = int(script_tab.Index)

    server = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    server.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    server.bind((host, port))
    server.listen(16)
    server.settimeout(0.05)

    crt.Dialog.MessageBox(
        "securecrt-mcp bridge is running on {0}:{1}.\n\n"
        "Keep this script running while an MCP client uses SecureCRT.\n"
        "Use Script > Cancel to stop the bridge.".format(host, port),
        "securecrt-mcp",
    )

    try:
        while True:
            try:
                conn, _addr = server.accept()
            except socket.timeout:
                crt.Sleep(25)
                continue

            try:
                conn.settimeout(5.0)
                request = json.loads(recv_line(conn, max_bytes))
                request_id = str(request.get("id", ""))
                if request.get("token") != token:
                    response = {
                        "id": request_id,
                        "ok": False,
                        "result": None,
                        "error": "authentication failed",
                    }
                else:
                    try:
                        result = dispatch(
                            request.get("method", ""),
                            request.get("params") or {},
                            script_tab_index,
                        )
                        response = {
                            "id": request_id,
                            "ok": True,
                            "result": result,
                            "error": None,
                        }
                    except Exception as exc:
                        response = {
                            "id": request_id,
                            "ok": False,
                            "result": None,
                            "error": "{0}: {1}".format(type(exc).__name__, exc),
                        }
                payload = (json.dumps(response, ensure_ascii=False) + "\n").encode("utf-8")
                conn.sendall(payload)
            except Exception:
                # Avoid leaking stack traces over the bridge. The local SecureCRT user can
                # inspect this message if a malformed request hits the bridge.
                try:
                    response = {
                        "id": "",
                        "ok": False,
                        "result": None,
                        "error": "bridge request processing failed",
                    }
                    conn.sendall((json.dumps(response) + "\n").encode("utf-8"))
                except Exception:
                    pass
            finally:
                try:
                    conn.close()
                except Exception:
                    pass
                crt.Sleep(1)
    finally:
        server.close()


main()
