# $language = "Python3"
# $interface = "1.0"

"""SecureCRT native adapter. Run through Script > Run, not external Python.

All crt calls remain on the SecureCRT script thread. Rust owns command parsing,
policy, lifecycle, output storage and audit. Native waits are at most one second.
"""
import hashlib
import hmac
import json
import platform
import select
import socket
import sys
import time
import uuid
from pathlib import Path

BRIDGE_VERSION = "0.2.0-preview.2"
PROTOCOL_VERSION = 2
MAX_FRAME = 262144
MAX_CHUNK = 65536
LEASE_MS = 120000
SCREEN_MS = 30000
WATCHDOG_MS = 10000


def fail(message):
    raise ValueError(message)


def integer(value, name, low, high):
    if type(value) is not int or not low <= value <= high:
        fail("invalid {0}: expected integer in [{1}, {2}]".format(name, low, high))
    return value


def string(value, name, maximum=65536):
    if not isinstance(value, str) or not value or len(value.encode('utf-8')) > maximum:
        fail("invalid " + name)
    return value


def metadata(tab):
    result = {}
    for key, name in (("Hostname", "configured_host"), ("Username", "configured_user"),
                      ("Protocol Name", "protocol"), ("Port", "port")):
        try:
            result[name] = tab.Session.Config.GetOption(key)
        except Exception:
            result[name] = None
    return result


class NativeAdapter:
    def __init__(self, app, now=None):
        self.app = app
        self.now = now or (lambda: int(time.time() * 1000))
        self.instance = str(uuid.uuid4())
        self.sessions = {}
        self.tokens = {}
        self.capture = None
        self.unresolved = None
        self.request_deadline = None
        self.send_attempted = False

    def _alive(self, entry):
        try:
            return (not entry['revoked'] and entry['tab'].Session.Connected
                    and 1 <= entry['tab'].Index <= self.app.GetTabCount()
                    and metadata(entry['tab']) == entry['metadata'])
        except Exception:
            return False

    def maintain(self):
        for entry in self.sessions.values():
            if not self._alive(entry):
                entry['revoked'] = True
        self.tokens = {k: v for k, v in self.tokens.items() if self.now() <= v['expires']}
        if self.capture:
            c = self.capture
            if (self.now() >= c['until'] or self.now() - c['heartbeat'] > WATCHDOG_MS
                    or not self._alive(c['entry'])):
                expired = self.now() >= c['until']
                self.end(c['id'], False)
                self.unresolved['deadline_expired'] = expired
        protected = set()
        if self.capture:
            protected.add(self.capture['session'])
        if self.unresolved:
            protected.add(self.unresolved['session'])
        self.sessions = {k: v for k, v in self.sessions.items()
                         if k in protected or (not v['revoked'] and self.now() <= v['expires'])}

    def _session(self, sid):
        entry = self.sessions.get(sid)
        protected = ((self.capture and self.capture['session'] == sid)
                     or (self.unresolved and self.unresolved['session'] == sid))
        if (not entry or not self._alive(entry)
                or (self.now() > entry['expires'] and not protected)):
            fail('stale_session: list sessions again; never substitute a tab index')
        entry['expires'] = self.now() + LEASE_MS
        return entry

    def list_sessions(self):
        self.maintain()
        result = []
        for index in range(1, self.app.GetTabCount() + 1):
            tab = self.app.GetTab(index)
            if not tab.Session.Connected:
                result.append(dict(id=None, index=index, caption=tab.Caption, connected=False))
                continue
            # Reuse a retained native reference, never rebind a handle to GetTab(index).
            found = next(((sid, e) for sid, e in self.sessions.items()
                          if self._alive(e) and e['tab'].Index == index), None)
            if found:
                sid, entry = found
                entry['expires'] = self.now() + LEASE_MS
            else:
                if len(self.sessions) >= 128:
                    fail('session_limit: close unused tabs or wait for leases to expire')
                sid = self.instance + '/' + str(uuid.uuid4())
                entry = dict(tab=tab, metadata=metadata(tab), revoked=False,
                             expires=self.now() + LEASE_MS)
                self.sessions[sid] = entry
            result.append(dict(id=sid, index=index, caption=tab.Caption, connected=True,
                               lease_expires_ms=entry['expires'], **entry['metadata']))
        return dict(bridge_instance=self.instance, sessions=result,
                    unresolved=self.unresolved, max_active_captures=1)

    def _screen(self, entry):
        screen = entry['tab'].Screen
        rows, columns = int(screen.Rows), int(screen.Columns)
        text = screen.Get2(1, 1, rows, columns)
        if len(text.encode('utf-8')) > MAX_CHUNK:
            fail('screen_too_large: resize the terminal')
        row, column = int(screen.CurrentRow), int(screen.CurrentColumn)
        current_line = screen.Get2(row, 1, row, columns).rstrip()
        digest = hashlib.sha256((text + '\0' + str(row) + ':' + str(column)).encode('utf-8')).hexdigest()
        return dict(text=text, current_line=current_line, rows=rows, columns=columns,
                    cursor_row=row, cursor_column=column, digest=digest)

    def read_screen(self, session):
        entry = self._session(session)
        result = self._screen(entry)
        token = str(uuid.uuid4())
        # Only the latest view of a session is valid; bound tokens independently of requests.
        self.tokens = {k: v for k, v in self.tokens.items()
                       if v['session'] != session and v['expires'] >= self.now()}
        self.tokens[token] = dict(session=session, digest=result.pop('digest'),
                                  expires=self.now() + SCREEN_MS)
        result.update(session=session, screen_token=token, token_expires_ms=self.now() + SCREEN_MS,
                      configured_endpoint=entry['metadata'],
                      context_warning='Configured endpoint is not proof of the current nested SSH target.')
        return result

    def _guard(self, session, screen_token, expected_prompt):
        entry = self._session(session)
        prompt = string(expected_prompt, 'expected_prompt', 512).rstrip()
        if not prompt or any(ord(c) < 32 for c in prompt):
            fail('invalid expected_prompt')
        token = self.tokens.pop(screen_token, None)
        current = self._screen(entry)
        if (not token or token['session'] != session or self.now() > token['expires']
                or token['digest'] != current['digest']):
            fail('stale_screen: read the terminal again before sending')
        if current['current_line'] != prompt:
            fail('prompt_mismatch: target is not at the expected input context')
        return entry

    def _before_send(self):
        if self.request_deadline is not None and self.now() >= self.request_deadline:
            fail("expired request immediately before native send; nothing sent")

    def begin(self, session, screen_token, expected_prompt, text, capture_id, runtime_ms):
        self.maintain()
        if self.capture:
            fail('busy: a capture is already running; no automatic interrupt')
        if self.unresolved:
            fail('unresolved: inspect the previous command and acknowledge idle first')
        text = string(text, 'text')
        string(capture_id, 'capture_id', 128)
        integer(runtime_ms, 'runtime_ms', 1000, 3600000)
        if any(ord(c) < 32 or ord(c) == 127 for c in text):
            fail('control characters are not accepted in commands')
        entry = self._guard(session, screen_token, expected_prompt)
        screen = entry['tab'].Screen
        self._before_send()
        self.capture = dict(id=capture_id, session=session, entry=entry,
                            until=self.now() + runtime_ms, heartbeat=self.now(),
                            old_sync=screen.Synchronous, old_ignore=screen.IgnoreEscape)
        try:
            screen.Synchronous = True
            screen.IgnoreEscape = True
            self.send_attempted = True
            screen.Send(text + '\r')
        except Exception:
            self.end(capture_id, False)
            fail('send_unknown: native send failed; command may already have been delivered')
        return dict(capture_id=capture_id, sent=True)

    def poll(self, capture_id, wait_for=None):
        self.maintain()
        c = self.capture
        if not c or c['id'] != capture_id:
            if (self.unresolved and self.unresolved['capture_id'] == capture_id
                    and self.unresolved.get('deadline_expired')):
                return dict(text='', overflow=False, expired=True, capture_may_be_incomplete=True)
            fail('capture_mismatch: capture expired, disconnected or ended; outcome unknown')
        c['heartbeat'] = self.now()
        screen = c['entry']['tab'].Screen
        patterns = ['\n']
        if wait_for is not None:
            string(wait_for, 'wait_for', 512)
            if any(ord(c) < 32 for c in wait_for):
                fail('invalid wait_for')
            patterns.insert(0, wait_for)
        text = screen.ReadString(patterns, 1)
        index = int(screen.MatchIndex)
        matched = 1 <= index <= len(patterns)
        if matched:
            text += patterns[index - 1]
        data = text.encode('utf-8')
        overflow = len(data) > MAX_CHUNK
        if overflow:
            text = data[:MAX_CHUNK].decode('utf-8', errors='ignore')
        return dict(text=text, overflow=overflow, expired=self.now() >= c['until'],
                    capture_may_be_incomplete=not matched)

    def end(self, capture_id, confirmed_complete=False):
        if type(confirmed_complete) is not bool:
            fail('invalid confirmed_complete')
        c = self.capture
        if not c or c['id'] != capture_id:
            if self.unresolved and self.unresolved['capture_id'] == capture_id:
                return dict(released=True, unresolved=True)
            fail('capture_mismatch')
        self.capture = None
        c['entry']['expires'] = self.now() + LEASE_MS
        if not confirmed_complete:
            self.unresolved = dict(session=c['session'], capture_id=c['id'])
        errors = []
        for prop, value in (('Synchronous', c['old_sync']), ('IgnoreEscape', c['old_ignore'])):
            try:
                setattr(c['entry']['tab'].Screen, prop, value)
            except Exception as exc:
                errors.append(type(exc).__name__)
        if errors:
            self.unresolved = dict(session=c['session'], capture_id=c['id'])
        return dict(released=True, unresolved=self.unresolved is not None, restore_errors=errors)

    def interrupt(self, session, capture_id):
        c = self.capture or self.unresolved
        cid = c.get('id', c.get('capture_id')) if c else None
        if not c or cid != capture_id or c['session'] != session:
            fail('capture_mismatch: refusing to interrupt an unrelated foreground program')
        entry = self._session(session)
        self._before_send()
        try:
            self.send_attempted = True
            entry['tab'].Screen.Send('\x03')
        finally:
            if self.capture:
                self.end(capture_id, False)
        return dict(interrupt_sent=True, remote_termination_confirmed=False)

    def acknowledge_idle(self, session, screen_token, expected_prompt):
        if self.capture:
            fail('busy: cannot acknowledge idle during capture')
        self._guard(session, screen_token, expected_prompt)
        if self.unresolved and self.unresolved['session'] != session:
            fail('capture_mismatch: acknowledge the original session, not another tab')
        self.unresolved = None
        result = dict(idle_acknowledged=True, remote_termination_confirmed=False)
        try:
            result['screen'] = self.read_screen(session)
        except Exception as exc:
            result['screen_error'] = str(exc)
            result['action'] = 'read_screen before the next operation'
        return result

    def send_text(self, session, screen_token, expected_prompt, text, append_enter=False):
        if self.capture or self.unresolved:
            fail('busy: raw input requires an idle window')
        if type(append_enter) is not bool:
            fail('invalid append_enter')
        string(text, 'text', 8192)
        entry = self._guard(session, screen_token, expected_prompt)
        self._before_send()
        # Even an intentional raw send may start a remote program: quarantine afterwards.
        self.unresolved = dict(session=session, capture_id='raw-' + str(uuid.uuid4()))
        self.send_attempted = True
        entry['tab'].Screen.Send(text + ('\r' if append_enter else ''))
        return dict(sent=True, unresolved=self.unresolved)

    def focus_session(self, session):
        self._session(session)['tab'].Activate()
        return dict(focused=True)

    def ping(self):
        self.maintain()
        return dict(bridge_version=BRIDGE_VERSION, protocol_version=PROTOCOL_VERSION,
                    bridge_instance=self.instance, python=sys.version.split()[0],
                    platform=platform.system(), architecture=platform.machine(),
                    securecrt_version=str(getattr(self.app, 'Version', 'unknown')),
                    securecrt_tabs=self.app.GetTabCount(), max_active_captures=1,
                    capabilities=['session_leases', 'screen_tokens', 'bounded_poll', 'interrupt', 'delivery_evidence', 'ack_fresh_view'],
                    unresolved=self.unresolved)


METHODS = ('ping', 'list_sessions', 'read_screen', 'focus_session', 'begin', 'poll',
           'end', 'interrupt', 'acknowledge_idle', 'send_text')


def handle_request(adapter, request, token):
    adapter.send_attempted = False
    response = dict(id='', protocol_version=PROTOCOL_VERSION,
                    bridge_instance=adapter.instance, ok=False, result=None, error=None)
    try:
        if not isinstance(request, dict):
            fail('invalid request')
        response['id'] = string(request.get('id'), 'id', 128)
        supplied = request.get('token')
        if not isinstance(supplied, str) or not hmac.compare_digest(supplied.encode(), token.encode()):
            fail('authentication failed')
        if type(request.get('protocol_version')) is not int or request['protocol_version'] != PROTOCOL_VERSION:
            fail('protocol_mismatch: upgrade and restart the SecureCRT adapter')
        deadline = integer(request.get('deadline_ms'), 'deadline_ms', 1, 2 ** 53)
        if deadline <= adapter.now() or deadline - adapter.now() > 60000:
            fail('expired or excessive request deadline; nothing was sent')
        method = request.get('method')
        if method not in METHODS:
            fail('unsupported method')
        params = request.get('params', {})
        if not isinstance(params, dict):
            fail('invalid params')
        adapter.request_deadline = deadline
        try:
            result = getattr(adapter, method)(**params)
            response.update(ok=True, result=result)
        finally:
            adapter.request_deadline = None
    except Exception as exc:
        response['error'] = str(exc)[:1024]
        response['error_code'] = str(exc).split(':', 1)[0][:64]
    response['sent'] = (True if response['ok'] else None) if adapter.send_attempted else False
    return response


def serve(app, config):
    if config.get('host') != '127.0.0.1':
        fail('bridge host must be 127.0.0.1')
    port = integer(config.get('port'), 'port', 1024, 65535)
    token = string(config.get('token'), 'token', 256)
    if len(token) < 32:
        fail('bridge token must contain at least 32 characters; rotate it using the CLI')
    adapter = NativeAdapter(app)
    listener = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    if sys.platform == 'win32':
        listener.setsockopt(socket.SOL_SOCKET, socket.SO_EXCLUSIVEADDRUSE, 1)
    else:
        listener.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    listener.bind(('127.0.0.1', port))
    listener.listen(16)
    listener.setblocking(False)
    peers = {}
    try:
        app.Dialog.MessageBox('securecrt-mcp ' + BRIDGE_VERSION + '\nClick OK to start servicing requests.\n'
                              'Script > Cancel stops the adapter without terminating remote commands.',
                              'securecrt-mcp')
        while True:
            adapter.maintain()
            readable, _, _ = select.select([listener] + list(peers), [], [], 0.02)
            for conn in readable:
                if conn is listener:
                    client, _ = listener.accept()
                    client.setblocking(False)
                    if len(peers) >= 16:
                        client.close()
                    else:
                        peers[client] = [bytearray(), time.monotonic() + 2]
                    continue
                buffer, until = peers[conn]
                try:
                    chunk = conn.recv(min(4096, MAX_FRAME + 1 - len(buffer)))
                    if not chunk:
                        raise ValueError('closed')
                    buffer.extend(chunk)
                    if len(buffer) > MAX_FRAME:
                        raise ValueError('oversized')
                    if b'\n' not in buffer:
                        continue
                    line, trailing = bytes(buffer).split(b'\n', 1)
                    if trailing:
                        raise ValueError('multiple frames are not accepted')
                    request = json.loads(line.decode('utf-8'))
                    result = handle_request(adapter, request, token)
                    payload = (json.dumps(result, ensure_ascii=False) + '\n').encode('utf-8')
                    if len(payload) > MAX_FRAME:
                        raise ValueError('response exceeds frame limit')
                    conn.settimeout(1)
                    conn.sendall(payload)
                except Exception:
                    pass  # Wire errors close the connection; no implicit command replay.
                else:
                    pass
                peers.pop(conn, None)
                conn.close()
            for conn, (_, until) in list(peers.items()):
                if time.monotonic() >= until:
                    peers.pop(conn, None)
                    conn.close()
            app.Sleep(1)
    finally:
        if adapter.capture:
            adapter.end(adapter.capture['id'], False)
        for conn in peers:
            conn.close()
        listener.close()


def main():
    if 'crt' not in globals():
        fail('Run this script inside SecureCRT via Script > Run, not external Python.')
    script = getattr(crt, 'ScriptFullName', globals().get('__file__'))
    if not script:
        fail('SecureCRT script path unavailable')
    config_path = Path(script).resolve().parent / 'bridge.json'
    with config_path.open('r', encoding='utf-8') as handle:
        config = json.load(handle)
    serve(crt, config)


if __name__ == '__main__' or 'crt' in globals():
    main()
