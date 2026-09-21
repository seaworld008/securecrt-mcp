from pathlib import Path

def change(path,old,new):
    p=Path(path);s=p.read_text(encoding='utf-8')
    if old not in s:raise AssertionError((path,old[:120]))
    p.write_text(s.replace(old,new),encoding='utf-8')

change('bridge/securecrt_bridge.py',"            attachment['context'] = self._input(c['entry'])", "            attachment['awaiting_prompt'] = True\n            attachment['completion_marker'] = c.get('completion_marker')")
change('bridge/securecrt_bridge.py',"""    def _attachment_context(self, a):
        if self._input(a['entry']) != a['context']:
            self.metrics['context_rejections'] += 1
            fail('context_changed: input/cursor changed; inspect and attach again; nothing sent')""","""    def _attachment_context(self, a):
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
        fail('context_changed: input/cursor changed; inspect and attach again; nothing sent')""")
change('bridge/securecrt_bridge.py',"        if expected_prompt is not None and context['current_line'] != expected_prompt.rstrip(): fail('prompt_mismatch')", """        if expected_prompt is not None and context['current_line'] != expected_prompt.rstrip(): fail('prompt_mismatch')
        if expected_prompt is None and mode != 'observe':
            line = context['current_line']
            if (not line.endswith(('$', '#', '%'))
                    or any(x in line.lower() for x in ('password', 'passphrase', '--more--', '密码'))):
                fail('input_context_required: inspect terminal and provide an explicit expected_prompt')""")
# OS-buffered audit is still written before sending, but does not make an fsync durability promise.
change('src/config.rs','    pub include_command_text: bool,','    pub include_command_text: bool,\n    pub durability: String,')
change('src/config.rs','            include_command_text: false,','            include_command_text: false,\n            durability: "os_buffered".into(),')
change('src/config.rs','        ensure!(!self.audit.file.is_empty(), "audit.file must not be empty");','        ensure!(!self.audit.file.is_empty(), "audit.file must not be empty");\n        ensure!(["os_buffered","each_event"].contains(&self.audit.durability.as_str()),"invalid audit.durability");')
change('src/main.rs','''                config.audit_path()?,
            );''','''                config.audit_path()?,
            ).with_sync(config.audit.durability == "each_event");''')
change('src/local_cli.rs','''        config.audit_path()?,
    );''','''        config.audit_path()?,
    ).with_sync(config.audit.durability == "each_event");''')
# Isolate audit cost in command timing so a slow local disk is not attributed to SSH.
change('src/execution.rs','    poll_calls: u64,','    poll_calls: u64,\n    audit_dispatch_us: u64,')
change('src/execution.rs','poll_calls: 0,','poll_calls: 0,\n                    audit_dispatch_us: 0,')
change('src/execution.rs','"poll_calls": self.poll_calls','"poll_calls": self.poll_calls, "audit_dispatch_us": self.audit_dispatch_us')
p=Path('src/execution.rs');s=p.read_text();start=s.index('        // Mandatory before-send audit:')
a=s.index('        if let Err(error) = self',start);b=s.index('        {',a)
chunk=s[a:b]
assert chunk.endswith('.await\n'),chunk
replacement='        let audit_started=Instant::now();\n'+chunk.replace('if let Err(error) = self','let audit_result = self')[:-1]+';\n'
replacement+='        if let Some(job)=self.inner.lock().await.jobs.get_mut(&id){job.audit_dispatch_us=audit_started.elapsed().as_micros() as u64;}\n        if let Err(error)=audit_result\n'
s=s[:a]+replacement+s[b:];p.write_text(s)
# Exact, expanded package manifest instead of weakening to a partial allow-list.
change('tests/package_smoke.py',"    assert set(package.namelist()) == {binary.name, 'LICENSE', 'README.md', 'README.en.md', 'docs/migration-0.2.md'}",'''    expected={binary.name,'LICENSE','README.md','README.en.md','README.zh-CN.md','CHANGELOG.md','CONTRIBUTING.md','SECURITY.md','ROADMAP.md'}
    expected.update(p.relative_to(root).as_posix() for p in (root/'docs').rglob('*.md'))
    expected.update(p.relative_to(root).as_posix() for p in (root/'docs'/'benchmarks').glob('*.json'))
    expected.update(p.relative_to(root).as_posix() for pattern in ('*.py','*.ps1') for p in (root/'clients').glob(pattern))
    assert set(package.namelist()) == expected, sorted(set(package.namelist()) ^ expected)
    assert len(package.namelist()) == len(expected), 'duplicate archive members'
    assert 'clients/persistent_client.py' in expected and 'docs/migration-0.3.md' in expected''')
change('.github/workflows/release.yml','          python tests/mcp_smoke.py "$binary"','''          python tests/mcp_smoke.py "$binary"
          python tests/ux_smoke.py "$binary"
          python tests/review_smoke.py "$binary"
          python tests/performance_smoke.py "$binary"
          python tests/persistent_fault_smoke.py "$binary"
          python tests/daemon_smoke.py "$binary"''')
# Document the explicit durability tradeoff and prompt readiness rule.
for path in ['README.md','README.en.md','docs/security-model.md','docs/performance.md','docs/migration-0.3.md']:
    p=Path(path);s=p.read_text(encoding='utf-8')
    s+='''

## Audit durability / 审计持久化时机

`audit.durability = "os_buffered"` is the default for configurations omitting this new field. The append handle is reused and each write is flushed to the operating system before dispatch; write/open failures still reject before sending. It does **not** fsync every event and may lose recent audit records on OS crash/power loss. Choose `"each_event"` to restore synchronous event durability, accepting local disk latency. This is a durability/performance choice, not a change to client permissions. Configure it explicitly when upgrading under an existing audit-compliance requirement. Log rotation that replaces the file requires restarting the MCP/daemon to reopen the handle; copy-truncate retains the handle but has the usual rotation races.

默认省略新字段时使用操作系统缓冲，减少每次审计打开文件和同步刷盘的开销；这不保证断电时最近审计记录仍在磁盘。要求逐事件落盘时显式设置 `durability = "each_event"`。命令结果的 `timing.audit_dispatch_us` 用于区分审计开销和 Bridge/远端耗时。

After an owned completion marker, the attachment waits briefly for the original prompt/input column rather than adopting a marker line as a new prompt. A changed prompt (including `cd` that changes prompt text), partially typed command, or uncertain input context requires explicit inspection/re-attachment; it is not silently trusted.
'''
    p.write_text(s,encoding='utf-8')
Path('README.zh-CN.md').write_bytes(Path('README.md').read_bytes())
print('Reviewed audit hot path, delayed prompt readiness and exact distribution manifest')
