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

BRIDGE_VERSION = "0.3.0-preview.1"
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
        self.sessions, self.tokens, self.captures, self.unresolved_sessions, self.attachments = {}, {}, {}, {}, {}
        self.request_deadline = None
        self.send_attempted = False
        self.owner = 'legacy'
        self.metrics = dict(requests=0, native_reads=0, native_read_ms=0, chunks=0, bytes=0,
                            lease_renewals=0, context_rejections=0, connections=0)

    @property
    def capture(self):
        return next(iter(self.captures.values()), None)

    @property
    def unresolved(self):
        return next(iter(self.unresolved_sessions.values()), None)

    def _alive(self, entry):
        try:
            return (not entry['revoked'] and entry['tab'].Session.Connected
                    and 1 <= entry['tab'].Index <= self.app.GetTabCount()
                    and metadata(entry['tab']) == entry['metadata'])
        except Exception:
            return False

    def maintain(self):
        for entry in self.sessions.values():
            if not self._alive(entry): entry['revoked'] = True
        self.tokens = {k: v for k, v in self.tokens.items() if self.now() <= v['expires']}
        for c in list(self.captures.values()):
            if (self.now() >= c['until'] or self.now() - c['heartbeat'] > WATCHDOG_MS
                    or not self._alive(c['entry'])):
                expired = self.now() >= c['until']
                self.end(c['id'], False)
                self.unresolved_sessions[c['session']]['deadline_expired'] = expired
        self.attachments = {k: a for k, a in self.attachments.items()
                            if self.now() <= a['expires'] and self._alive(a['entry'])}
        protected = {c['session'] for c in self.captures.values()} | set(self.unresolved_sessions)
        protected |= {a['session'] for a in self.attachments.values()}
        self.sessions = {k: v for k, v in self.sessions.items()
                         if k in protected or (not v['revoked'] and self.now() <= v['expires'])}

    def _session(self, sid):
        e = self.sessions.get(sid)
        protected = (any(c['session'] == sid for c in self.captures.values())
                     or sid in self.unresolved_sessions
                     or any(a['session'] == sid and self.now() <= a['expires'] for a in self.attachments.values()))
        if not e or not self._alive(e) or (self.now() > e['expires'] and not protected):
            fail('stale_session: list sessions again; never substitute a tab index')
        e['expires'] = self.now() + LEASE_MS
        self.metrics['lease_renewals'] += 1
        return e

    def list_sessions(self):
        self.maintain()
        result = []
        for index in range(1, self.app.GetTabCount() + 1):
            tab = self.app.GetTab(index)
            if not tab.Session.Connected:
                result.append(dict(id=None, index=index, caption=tab.Caption, connected=False))
                continue
            found = next(((sid, e) for sid, e in self.sessions.items()
                          if self._alive(e) and e['tab'].Index == index), None)
            if found:
                sid, e = found
                e['expires'] = self.now() + LEASE_MS
            else:
                if len(self.sessions) >= 128: fail('session_limit')
                sid = self.instance + '/' + str(uuid.uuid4())
                e = dict(tab=tab, metadata=metadata(tab), revoked=False, expires=self.now() + LEASE_MS)
                self.sessions[sid] = e
            result.append(dict(id=sid, index=index, caption=tab.Caption, connected=True,
                               lease_expires_ms=e['expires'], unresolved=self.unresolved_sessions.get(sid), **e['metadata']))
        return dict(bridge_instance=self.instance, sessions=result,
                    unresolved=self.unresolved, unresolved_sessions=list(self.unresolved_sessions.values()),
                    max_active_captures=16)

    def _input(self, entry):
        s = entry['tab'].Screen
        row, column, columns = int(s.CurrentRow), int(s.CurrentColumn), int(s.Columns)
        return dict(current_line=s.Get2(row, 1, row, columns).rstrip(),
                    cursor_row=row, cursor_column=column, columns=columns)

    def _screen(self, entry):
        s = entry['tab'].Screen
        rows, columns = int(s.Rows), int(s.Columns)
        text = s.Get2(1, 1, rows, columns)
        if len(text.encode('utf-8')) > MAX_CHUNK: fail('screen_too_large: resize the terminal')
        result = self._input(entry)
        digest = hashlib.sha256((text + '\0' + str(result['cursor_row']) + ':' + str(result['cursor_column'])).encode('utf-8')).hexdigest()
        result.update(text=text, rows=rows, digest=digest)
        return result

    def read_screen(self, session):
        e = self._session(session)
        result = self._screen(e)
        token = str(uuid.uuid4())
        self.tokens = {k: v for k, v in self.tokens.items()
                       if v['session'] != session and v['expires'] >= self.now()}
        self.tokens[token] = dict(session=session, digest=result.pop('digest'), expires=self.now() + SCREEN_MS)
        result.update(session=session, screen_token=token, token_expires_ms=self.now() + SCREEN_MS,
                      configured_endpoint=e['metadata'],
                      unresolved=self.unresolved_sessions.get(session),
                      context_warning='Configured endpoint is not proof of the current nested SSH target.')
        return result

    def _guard(self, session, screen_token, expected_prompt):
        if isinstance(screen_token, str) and screen_token.startswith('attachment:'):
            a = self._attachment(screen_token[len('attachment:'):], write=True)
            if a['session'] != session: fail('attachment_mismatch')
            self._attachment_context(a)
            return a['entry']
        e = self._session(session)
        prompt = string(expected_prompt, 'expected_prompt', 512).rstrip()
        if not prompt or any(ord(c) < 32 for c in prompt): fail('invalid expected_prompt')
        token = self.tokens.pop(screen_token, None)
        current = self._screen(e)
        if (not token or token['session'] != session or self.now() > token['expires']
                or token['digest'] != current['digest']):
            self.metrics['context_rejections'] += 1
            fail('stale_screen: read the terminal again before sending')
        if current['current_line'] != prompt:
            self.metrics['context_rejections'] += 1
            fail('prompt_mismatch: target is not at the expected input context')
        return e

    def _before_send(self):
        if self.request_deadline is not None and self.now() >= self.request_deadline:
            fail('expired request immediately before native send; nothing sent')

    def _ownership(self, session):
        for a in self.attachments.values():
            if (a['session'] == session and a['mode'] == 'exclusive' and a['owner'] != self.owner
                    and self.now() <= a['expires']):
                fail('ownership_conflict: another connector owns this session; no input sent')

    def begin(self, session, screen_token, expected_prompt, text, capture_id, runtime_ms,
              completion_marker=None):
        self.maintain()
        self._ownership(session)
        if any(c['session'] == session for c in self.captures.values()): fail('busy: this session has an active capture')
        if session in self.unresolved_sessions: fail('unresolved: inspect the previous command and acknowledge idle first')
        if len(self.captures) >= 16: fail('capture_limit')
        text = string(text, 'text')
        string(capture_id, 'capture_id', 128)
        if capture_id in self.captures: fail('capture_id conflict')
        integer(runtime_ms, 'runtime_ms', 1000, 3600000)
        if completion_marker is not None: string(completion_marker, 'completion_marker', 128)
        if any(ord(c) < 32 or ord(c) == 127 for c in text): fail('control characters are not accepted in commands')
        e = self._guard(session, screen_token, expected_prompt)
        s = e['tab'].Screen
        self._before_send()
        self.captures[capture_id] = dict(id=capture_id, session=session, entry=e, owner=self.owner,
            until=self.now() + runtime_ms, heartbeat=self.now(), old_sync=s.Synchronous,
            old_ignore=s.IgnoreEscape, completion_marker=completion_marker, pending=b'',
            attachment_id=screen_token[len('attachment:'):] if screen_token.startswith('attachment:') else None)
        try:
            s.Synchronous = True
            s.IgnoreEscape = True
            self.send_attempted = True
            s.Send(text + '\r')
        except Exception:
            self.end(capture_id, False)
            fail('send_unknown: native send failed; command may already have been delivered')
        return dict(capture_id=capture_id, sent=True)

    def poll(self, capture_id, wait_for=None):
        return self.poll_bulk(capture_id, wait_for=wait_for, max_reads=1)

    def poll_bulk(self, capture_id, wait_for=None, max_reads=128):
        integer(max_reads, 'max_reads', 1, 256)
        self.maintain()
        c = self.captures.get(capture_id)
        if not c:
            old = next((u for u in self.unresolved_sessions.values() if u['capture_id'] == capture_id), None)
            if old and old.get('deadline_expired'):
                return dict(text='', overflow=False, expired=True, capture_may_be_incomplete=True)
            fail('capture_mismatch: capture expired, disconnected or ended; outcome unknown')
        if c['owner'] != self.owner: fail('ownership_conflict')
        c['heartbeat'] = self.now()
        attachment = self.attachments.get(c.get('attachment_id'))
        if attachment: attachment['expires'] = self.now() + 600000
        s = c['entry']['tab'].Screen
        patterns = ['\n']
        if wait_for is not None:
            string(wait_for, 'wait_for', 512)
            if any(ord(ch) < 32 for ch in wait_for): fail('invalid wait_for')
            patterns.insert(0, wait_for)
        started = time.monotonic()
        count, uncertain, overflow = 0, False, False
        pending = c['pending']
        # Local batching removes one socket round-trip + Rust sleep per output line.
        # Never pass a fractional/zero timeout: supported native API uses seconds.
        draining_pending = bool(pending)
        while not draining_pending and len(pending) < MAX_CHUNK and count < max_reads:
            read_started = time.monotonic()
            text = s.ReadString(patterns, 1)
            elapsed = (time.monotonic() - read_started) * 1000
            self.metrics['native_reads'] += 1
            self.metrics['native_read_ms'] += elapsed
            index = int(s.MatchIndex)
            matched = 1 <= index <= len(patterns)
            if matched: text += patterns[index - 1]
            uncertain |= not matched
            data = text.encode('utf-8')
            # The native API itself allocates its string before Python can bound it.
            # Bound retained native overflow; disclose actual loss, never silently hide it.
            if len(data) > 16 * 1024 * 1024:
                data = data[:16 * 1024 * 1024].decode('utf-8', errors='ignore').encode('utf-8')
                overflow = True
            pending += data
            count += 1
            marker = c.get('completion_marker')
            boundary = marker and any(line.rstrip('\r').startswith(marker + ' ') for line in text.split('\n'))
            if (boundary or not matched or (wait_for and index == 1) or overflow
                    or elapsed > 2 or time.monotonic() - started >= 0.012): break
        end = min(len(pending), MAX_CHUNK)
        while end and end < len(pending) and (pending[end] & 0xC0) == 0x80: end -= 1
        data, c['pending'] = pending[:end], pending[end:]
        self.metrics['chunks'] += 1
        self.metrics['bytes'] += len(data)
        return dict(text=data.decode('utf-8'), overflow=overflow,
                    pending_bytes=len(c['pending']), native_reads=count,
                    native_read_ms=(time.monotonic()-started)*1000,
                    expired=self.now() >= c['until'], capture_may_be_incomplete=uncertain)

    def end(self, capture_id, confirmed_complete=False):
        if type(confirmed_complete) is not bool: fail('invalid confirmed_complete')
        c = self.captures.get(capture_id)
        if not c:
            if any(u['capture_id'] == capture_id for u in self.unresolved_sessions.values()):
                return dict(released=True, unresolved=True)
            fail('capture_mismatch')
        # maintain() also ends expired captures independent of the request owner.
        self.captures.pop(capture_id)
        sid = c['session']
        c['entry']['expires'] = self.now() + LEASE_MS
        if not confirmed_complete: self.unresolved_sessions[sid] = dict(session=sid, capture_id=c['id'])
        errors = []
        for prop, value in (('Synchronous', c['old_sync']), ('IgnoreEscape', c['old_ignore'])):
            try: setattr(c['entry']['tab'].Screen, prop, value)
            except Exception as exc: errors.append(type(exc).__name__)
        if errors: self.unresolved_sessions[sid] = dict(session=sid, capture_id=c['id'])
        attachment = self.attachments.get(c.get('attachment_id'))
        if attachment and confirmed_complete and not errors:
            # Record only connector-owned completion. This is not keyboard interception.
            attachment['awaiting_prompt'] = True
            attachment['completion_marker'] = c.get('completion_marker')
            attachment['expires'] = self.now() + 600000
        return dict(released=True, unresolved=sid in self.unresolved_sessions, restore_errors=errors)

    def interrupt(self, session, capture_id):
        c = self.captures.get(capture_id) or self.unresolved_sessions.get(session)
        if not c or c.get('id', c.get('capture_id')) != capture_id or c['session'] != session:
            fail('capture_mismatch: refusing to interrupt an unrelated foreground program')
        if 'owner' in c and c['owner'] != self.owner: fail('ownership_conflict')
        self._ownership(session)
        e = self._session(session)
        self._before_send()
        try:
            self.send_attempted = True
            e['tab'].Screen.Send('\x03')
        finally:
            if capture_id in self.captures: self.end(capture_id, False)
        return dict(interrupt_sent=True, remote_termination_confirmed=False)

    def acknowledge_idle(self, session, screen_token, expected_prompt):
        if any(c['session'] == session for c in self.captures.values()): fail('busy: cannot acknowledge idle during capture')
        self._ownership(session)
        self._guard(session, screen_token, expected_prompt)
        self.unresolved_sessions.pop(session, None)
        result = dict(idle_acknowledged=True, remote_termination_confirmed=False)
        try: result['screen'] = self.read_screen(session)
        except Exception as exc: result.update(screen_error=str(exc), action='read_screen before the next operation')
        # An explicit recovery changes context; old attachments must be re-established.
        self.attachments = {k: a for k, a in self.attachments.items() if a['session'] != session}
        return result

    def send_text(self, session, screen_token, expected_prompt, text, append_enter=False):
        if any(c['session'] == session for c in self.captures.values()) or session in self.unresolved_sessions:
            fail('busy: raw input requires an idle session')
        self._ownership(session)
        if type(append_enter) is not bool: fail('invalid append_enter')
        string(text, 'text', 8192)
        e = self._guard(session, screen_token, expected_prompt)
        self._before_send()
        self.unresolved_sessions[session] = dict(session=session, capture_id='raw-' + str(uuid.uuid4()))
        self.send_attempted = True
        e['tab'].Screen.Send(text + ('\r' if append_enter else ''))
        return dict(sent=True, unresolved=self.unresolved_sessions[session])

    def focus_session(self, session):
        self._session(session)['tab'].Activate()
        return dict(focused=True)

    def attach(self, session, mode='shared', expected_prompt=None):
        if mode not in ('shared', 'exclusive', 'observe'): fail('invalid ownership mode')
        self.maintain()
        e = self._session(session)
        if len(self.attachments) >= 128: fail('attachment_limit')
        self._ownership(session)
        if mode == 'exclusive' and any(a['session'] == session and a['owner'] != self.owner for a in self.attachments.values()):
            fail('ownership_conflict')
        context = self._input(e)
        if expected_prompt is not None and context['current_line'] != expected_prompt.rstrip(): fail('prompt_mismatch')
        if expected_prompt is None and mode != 'observe':
            line = context['current_line']
            if (not line.endswith(('$', '#', '%'))
                    or any(x in line.lower() for x in ('password', 'passphrase', '--more--', '密码'))):
                fail('input_context_required: inspect terminal and provide an explicit expected_prompt')
        aid = self.instance + '/attachment/' + str(uuid.uuid4())
        self.attachments[aid] = dict(session=session, entry=e, mode=mode, context=context,
                                    owner=self.owner, expires=self.now()+600000)
        return dict(attachment_id=aid, session=session, mode=mode, current_line=context['current_line'],
                    lease_expires_ms=self.now()+600000, configured_endpoint=e['metadata'],
                    configured_endpoint_fingerprint=hashlib.sha256(json.dumps(e['metadata'],sort_keys=True).encode()).hexdigest(),
                    authenticated_host_fingerprint=None, native_keyboard_lock=False,
                    input_detection='sampled-context-only', unresolved=self.unresolved_sessions.get(session))

    def _attachment(self, attachment_id, write=False):
        a = self.attachments.get(attachment_id)
        if not a or self.now() > a['expires'] or not self._alive(a['entry']): fail('stale_attachment: attach again after inspecting the target')
        if a['owner'] != self.owner: fail('ownership_conflict')
        if write and a['mode'] == 'observe': fail('observe attachment does not permit writes')
        a['expires'] = self.now() + 600000
        a['entry']['expires'] = self.now() + LEASE_MS
        return a

    def _attachment_context(self, a):
        if a.get('awaiting_prompt'):
            # After an owned completion, the marker may be visible before the shell prompt.
            # Rebase row only when the ORIGINAL prompt and input column return. Never adopt
            # arbitrary post-command text, a password prompt, or a half-entered command.
            until = time.monotonic() + 0.2
            while True:
                current = self._input(a['entry'])
                if all(current[k] == a['context'][k] for k in ('current_line', 'cursor_column', 'columns')):
                    a['context'] = current
                    a['awaiting_prompt'] = False
                    return
                line = current['current_line']
                marker = a.get('completion_marker')
                owned_marker = marker and line.startswith(marker + ' ') and line[len(marker)+1:].isdigit()
                sleeper = getattr(self.app, 'Sleep', None)
                if (line and not owned_marker) or not callable(sleeper) or time.monotonic() >= until:
                    break
                sleeper(5)
        elif self._input(a['entry']) == a['context']:
            return
        self.metrics['context_rejections'] += 1
        fail('context_changed: input/cursor changed; inspect and attach again; nothing sent')

    def heartbeat(self, attachment_id):
        a = self._attachment(attachment_id)
        return dict(attachment_id=attachment_id, session=a['session'], lease_expires_ms=a['expires'],
                    context_unchanged=self._input(a['entry']) == a['context'],
                    unresolved=self.unresolved_sessions.get(a['session']))

    def detach(self, attachment_id):
        a = self._attachment(attachment_id)
        self.attachments.pop(attachment_id)
        return dict(detached=True, session=a['session'], sent=False, remote_termination_confirmed=False)

    def prepare_and_begin(self, text, capture_id, runtime_ms, session=None, attachment_id=None,
                          expected_prompt=None, completion_marker=None):
        if attachment_id:
            a = self._attachment(attachment_id, write=True)
            session = a['session']
            token = 'attachment:' + attachment_id
            prompt = a['context']['current_line']
        else:
            view = self.read_screen(session)
            prompt, token = view['current_line'], view['screen_token']
            if expected_prompt is not None and prompt != expected_prompt.rstrip(): fail('prompt_mismatch')
            if expected_prompt is None and (not prompt.endswith(('$','#','%')) or any(x in prompt.lower() for x in ('password','passphrase','--more--','密码'))):
                fail('input_context_required: inspect terminal and provide expected_prompt')
        return self.begin(session, token, prompt, text, capture_id, runtime_ms, completion_marker)

    def stream_write(self, capture_id, text, append_enter=True):
        c = self.captures.get(capture_id)
        if not c: fail('capture_mismatch')
        if c['owner'] != self.owner: fail('ownership_conflict')
        string(text, 'text', 8192)
        if type(append_enter) is not bool: fail('invalid append_enter')
        self._before_send()
        self.send_attempted = True
        c['entry']['tab'].Screen.Send(text + ('\r' if append_enter else ''))
        return dict(sent=True, capture_id=capture_id)

    def ping(self):
        self.maintain()
        return dict(bridge_version=BRIDGE_VERSION, protocol_version=PROTOCOL_VERSION,
                    bridge_instance=self.instance, python=sys.version.split()[0], platform=platform.system(),
                    architecture=platform.machine(), securecrt_version=str(getattr(self.app,'Version','unknown')),
                    securecrt_tabs=self.app.GetTabCount(), max_active_captures=16,
                    capabilities=['session_leases','screen_tokens','bounded_poll','interrupt','delivery_evidence',
                                  'ack_fresh_view','persistent_ndjson','poll_bulk','attachments','prepare_and_begin','per_session_capture'],
                    unresolved=self.unresolved, unresolved_sessions=list(self.unresolved_sessions.values()),
                    metrics=self.metrics, native_quiet_wait_max_ms=1000, native_keyboard_lock=False)


METHODS = ('ping', 'list_sessions', 'read_screen', 'focus_session', 'begin', 'poll',
           'end', 'interrupt', 'acknowledge_idle', 'send_text', 'attach', 'heartbeat', 'detach', 'prepare_and_begin', 'poll_bulk', 'stream_write')


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
        adapter.owner = string(request.get('client_id', 'legacy'), 'client_id', 128)
        if method == 'end':
            capture = adapter.captures.get(params.get('capture_id'))
            if capture and capture['owner'] != adapter.owner:
                fail('ownership_conflict: cannot end another connector capture')
        adapter.metrics['requests'] += 1
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


def serve(app, config, stop_event=None):
    if config.get('host') != '127.0.0.1': fail('bridge host must be 127.0.0.1')
    port=integer(config.get('port'),'port',1024,65535)
    token=string(config.get('token'),'token',256)
    if len(token)<32: fail('bridge token too short')
    adapter=NativeAdapter(app)
    listener=socket.socket(socket.AF_INET,socket.SOCK_STREAM)
    listener.setsockopt(socket.SOL_SOCKET, socket.SO_EXCLUSIVEADDRUSE if sys.platform=='win32' else socket.SO_REUSEADDR,1)
    listener.bind(('127.0.0.1',port)); listener.listen(32); listener.setblocking(False)
    peers={}; next_maintenance=0
    def close(conn):
        peers.pop(conn,None)
        try: conn.close()
        except OSError: pass
    try:
        app.Dialog.MessageBox('securecrt-mcp '+BRIDGE_VERSION+'\nClick OK to serve persistent local connections.','securecrt-mcp')
        while not (stop_event and stop_event.is_set()):
            now=time.monotonic()
            if now>=next_maintenance:
                adapter.maintain(); next_maintenance=now+0.1
            writers=[c for c,p in peers.items() if p['out']]
            readers=[listener]+[c for c,p in peers.items() if not p['out']]
            readable,writable,_=select.select(readers,writers,[],0.002 if adapter.captures else 0.02)
            for conn in readable:
                if conn is listener:
                    client,_=listener.accept(); client.setblocking(False)
                    client.setsockopt(socket.IPPROTO_TCP,socket.TCP_NODELAY,1)
                    if len(peers)>=32: client.close()
                    else:
                        peers[client]=dict(buffer=bytearray(),out=b'',deadline=now+5,keep=False)
                        adapter.metrics['connections']+=1
                    continue
                p=peers.get(conn)
                if not p: continue
                try:
                    chunk=conn.recv(min(65536,MAX_FRAME+1-len(p['buffer'])))
                    if not chunk: close(conn); continue
                    if not p['buffer']: p['deadline']=time.monotonic()+5
                    p['buffer'].extend(chunk)
                    if len(p['buffer'])>MAX_FRAME: raise ValueError('oversized request')
                    if b'\n' not in p['buffer']: continue
                    line,trailing=bytes(p['buffer']).split(b'\n',1)
                    # One in-flight exchange per lane. Pipelining is rejected, not ambiguously executed.
                    if trailing: raise ValueError('pipelined frames unsupported')
                    p['buffer'].clear()
                    request=json.loads(line.decode('utf-8'))
                    result=handle_request(adapter,request,token)
                    p['keep']=bool(isinstance(request,dict) and request.get('keep_alive') is True and result.get('ok'))
                    result['persistent']=p['keep']
                    p['out']=(json.dumps(result,ensure_ascii=False)+'\n').encode('utf-8')
                    if len(p['out'])>MAX_FRAME: raise ValueError('response too large')
                    p['deadline']=time.monotonic()+5
                except (BlockingIOError,InterruptedError): continue
                except Exception: close(conn)
            for conn in writable:
                p=peers.get(conn)
                if not p: continue
                try:
                    sent=conn.send(p['out']); p['out']=p['out'][sent:]
                    if not p['out']:
                        if not p['keep']: close(conn)
                        else: p['deadline']=time.monotonic()+60
                except (BlockingIOError,InterruptedError): pass
                except OSError: close(conn)
            for conn,p in list(peers.items()):
                if time.monotonic()>p['deadline']: close(conn)
            app.Sleep(1)
    finally:
        for cid in list(adapter.captures): adapter.end(cid,False)
        for conn in list(peers): close(conn)
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
