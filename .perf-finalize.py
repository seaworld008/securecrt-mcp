"""Reviewed final transformations; removed after validation, never a runtime dependency."""
from pathlib import Path

def change(path,old,new):
    p=Path(path);s=p.read_text(encoding='utf-8')
    if old not in s:raise AssertionError((path,old[:120]))
    p.write_text(s.replace(old,new),encoding='utf-8')

# Lexical POSIX normalization, not a remote filesystem/symlink resolver.
change('src/critical.rs',"fn protected(path: &str) -> bool {\n    let path = path.trim_end_matches('/');",'''fn normalized(path: &str) -> String {
    if !path.starts_with('/') {return path.into();}
    let mut parts=Vec::new();
    for p in path.split('/') {match p {""|"."=>{},".."=>{parts.pop();},_=>parts.push(p)}}
    format!("/{}",parts.join("/"))
}
fn authentication_target(path:&str)->bool {
    let p=normalized(path);
    p=="/etc/ssh" || p.starts_with("/etc/ssh/") || p.starts_with("/etc/sudoers")
}
fn protected(path: &str) -> bool {
    let normalized=normalized(path);
    let path = normalized.trim_end_matches('/');''')
change('src/critical.rs','''        if ["tee", "truncate", "cp", "mv", "install"].contains(&cmd)
            && a.iter()
                .any(|s| s.starts_with("/etc/ssh/") || s.starts_with("/etc/sudoers"))
        {
            return true;
        }''','''        if ["cp","install"].contains(&cmd) {
            let destination=a.windows(2).find(|p|p[0]=="-t"||p[0]=="--target-directory")
                .map(|p|p[1].as_str()).or_else(||a.last().map(String::as_str));
            if destination.is_some_and(authentication_target){return true;}
        }
        if ["tee","truncate","mv"].contains(&cmd) && a.iter().any(|s|authentication_target(s)) {
            return true;
        }''')
p=Path('src/regression.rs');p.write_text(p.read_text()+ '\n'+Path('tests/critical_scope.rs.txt').read_text(),encoding='utf-8')
Path('tests/critical_scope.rs.txt').unlink()
# Separate long stream capture budget from routine command timeouts.
change('src/config.rs','    pub max_command_timeout_ms: u64,','    pub max_command_timeout_ms: u64,\n    pub max_stream_timeout_ms: u64,')
change('src/config.rs','            max_command_timeout_ms: 30_000,','            max_command_timeout_ms: 30_000,\n            max_stream_timeout_ms: 3_600_000,')
change('src/config.rs','        ensure!(\n            (4096..=16_777_216).contains(&b.max_output_bytes),','        ensure!((1000..=3_600_000).contains(&b.max_stream_timeout_ms), "invalid max_stream_timeout_ms");\n        ensure!(\n            (4096..=16_777_216).contains(&b.max_output_bytes),')
change('src/execution.rs','(1000..=self.config.bridge.max_command_timeout_ms).contains(&timeout)', '(1000..=if p.mode==CaptureMode::Stream{self.config.bridge.max_stream_timeout_ms}else{self.config.bridge.max_command_timeout_ms}).contains(&timeout)')
change('src/execution/persistent.rs','''        let timeout = p
            .timeout_ms
            .unwrap_or(self.config.bridge.max_command_timeout_ms.min(30000));''','''        let timeout = p.timeout_ms.unwrap_or(if p.mode==CaptureMode::Stream {
            self.config.bridge.max_stream_timeout_ms.min(600000)
        }else{self.config.bridge.max_command_timeout_ms.min(30000)});''')
change('src/execution/persistent.rs','max_bytes: Some(4096),','max_bytes: Some(1024),')
change('src/execution/persistent.rs','.wait_result(cid, 60000, 4096)','.wait_result(cid, 60000, 1024)')
# Reserve local attachment capacity before a native attach rather than leaking on rejection.
change('src/execution/persistent.rs','''        let value = self.bridge.call("attach", serde_json::to_value(p)?).await?;''','''        let mut registry = self.terminal.lock().await;
        ensure!(registry.attachments.len()<128,"attachment cache full; detach unused attachments");
        let value = self.bridge.call("attach", serde_json::to_value(p)?).await?;''')
change('src/execution/persistent.rs','''        let mut registry = self.terminal.lock().await;
        ensure!(
            registry.attachments.len() < 128,
            "attachment cache full; detach unused attachments"
        );
        registry.attachments.insert(id, value.clone());''','''        registry.attachments.insert(id, value.clone());''')
change('src/execution/persistent.rs','''        let result = self
            .bridge
            .call("detach", json!({"attachment_id":id}))
            .await?;
        self.terminal.lock().await.attachments.remove(id);
        Ok(result)''','''        let result = self.bridge.call("detach",json!({"attachment_id":id})).await;
        // Explicitly forget an unusable local handle even if the native lease expired.
        self.terminal.lock().await.attachments.remove(id);
        result''')
# Renew attachment during active captures; a 10-minute stream should not lose its binding.
change('bridge/securecrt_bridge.py',"        c['heartbeat'] = self.now()\n        s = c['entry']['tab'].Screen", "        c['heartbeat'] = self.now()\n        attachment = self.attachments.get(c.get('attachment_id'))\n        if attachment: attachment['expires'] = self.now() + 600000\n        s = c['entry']['tab'].Screen")
change('bridge/securecrt_bridge.py',"                data = data[:16 * 1024 * 1024]", "                data = data[:16 * 1024 * 1024].decode('utf-8', errors='ignore').encode('utf-8')")
# Shutdown gates new work first, but exits only after the acknowledgement is written.
change('src/daemon.rs','use anyhow::{', 'use std::sync::atomic::{AtomicBool, Ordering};\nuse anyhow::{')
change('src/daemon.rs','    let lifecycle = Arc::new(RwLock::new(()));','    let lifecycle = Arc::new(RwLock::new(()));\n    let shutting_down=Arc::new(AtomicBool::new(false));')
change('src/daemon.rs','let lifecycle=lifecycle.clone();','let lifecycle=lifecycle.clone();let shutting_down=shutting_down.clone();')
change('src/daemon.rs','if result.is_ok(){let _=stop_tx.send(true);}result','if result.is_ok(){shutting_down.store(true,Ordering::SeqCst);}result')
change('src/daemon.rs','if *stop_tx.borrow(){Err(', 'if shutting_down.load(Ordering::SeqCst){Err(')
change('src/daemon.rs',"if let Ok(mut data)=serde_json::to_vec(&value){data.push(b'\\n');if data.len()<=LIMIT{let _=timeout(Duration::from_secs(5),reader.get_mut().write_all(&data)).await;}}",'''if let Ok(mut data)=serde_json::to_vec(&value){
                        data.push(b'\\n');
                        if data.len()>LIMIT {
                            data=serde_json::to_vec(&json!({"id":value["id"],"ok":false,"error":{
                                "error_code":"response_too_large","command_id":value["result"]["command_id"],
                                "state":value["result"]["state"],"sent":value["result"]["sent"],
                                "action":"Read the existing command_id with a smaller max_bytes; never replay the command."}})).unwrap_or_default();
                            data.push(b'\\n');
                        }
                        let _=timeout(Duration::from_secs(5),reader.get_mut().write_all(&data)).await;
                    }''')
# The new persistent tools must actually be visible in generated client config.
change('src/main.rs','default_value="basic", value_parser=["basic", "full"]','default_value="terminal", value_parser=["terminal", "basic", "full"]')
change('src/main.rs','''    if toolset == "basic" {''','''    if toolset == "terminal" {
        let names=["bridge_status","list_sessions","read_screen","run_command","get_command_status",
            "get_command_output","interrupt","acknowledge_idle","attach","exec","exec_batch",
            "get_batch_status","heartbeat","detach","shell_open","shell_read","shell_write","shell_close","latency"];
        let tools=names.iter().map(|n|toml::Value::String(format!("securecrt_{n}"))).collect();
        println!("enabled_tools = {}",toml::Value::Array(tools));
    }
    if toolset == "basic" {''')
change('src/main.rs','''        "get_command_output",
    ] {''','''        "get_command_output",
        "get_batch_status", "heartbeat", "shell_read", "latency",
    ] {''')
# Include a persistent PowerShell5.1/7 test using the same daemon/Engine.
change('tests/daemon_smoke.py',"        cli('detach',dict(attachment_id=attach['attachment_id']))",'''        if sys.platform=='win32':
            script=Path(__file__).resolve().parents[1]/'clients'/'SecureCRT.Session.ps1'
            for shell in ('pwsh','powershell.exe'):
                command=". '"+str(script).replace("'","''")+"'; $r=Invoke-SecureCRTSession -Binary '"+str(h.binary).replace("'","''")+"' -Action output -Request @{command_id='"+result['command_id']+"'}; $r | ConvertTo-Json -Compress"
                value=json.loads(subprocess.check_output([shell,'-NoProfile','-Command',command],env=h.env,text=True,encoding='utf-8'))
                assert value['text']=='hello\\n',value
        cli('detach',dict(attachment_id=attach['attachment_id']))''')
# Version consistency and historical records are distinct; do not rewrite prior acceptance dates.
Path('README.zh-CN.md').write_bytes(Path('README.md').read_bytes())
p=Path('CHANGELOG.md');old=p.read_text(encoding='utf-8');p.write_text('''# Changelog

## [0.3.0-preview.1] - 2026-09-21

- Persistent bounded Bridge connection pool, atomic prepare-and-begin, batched buffered native reads and notification-driven waits.
- Per-session capture/interlocks, attach/exec/batch, cooperative ownership and incremental streams with explicit gaps.
- Incremental long-line parser, native overflow draining and delivery evidence; no unknown replay or implicit interrupt.
- Optional authenticated foreground daemon, CLI/Python/PowerShell state reuse and explicit shutdown/stale-endpoint cleanup.
- Narrow catastrophic guard with quoted-search/ordinary CRUD regression tests; client permissions and custom deny rules preserved.
- Stream-specific timeout budget; terminal tool preset; doctor --latency; comparative benchmark with explicit synthetic scope.
- Native transport fragmentation/lost-send, three-tab, long-output, stream and daemon regression tests.

''' + old.removeprefix('# Changelog').lstrip(),encoding='utf-8')
for name in ['docs/agent-usage.md','docs/clients/command-line.md','docs/clients/codex.md','docs/clients/codex.en.md','docs/troubleshooting.md']:
    p=Path(name)
    if p.exists():
        relative='../persistent-terminal.md' if p.parent.name=='clients' else 'persistent-terminal.md'
        text=p.read_text(encoding='utf-8')
        intro='> **0.3.0 update:** Continuous diagnostics should use the persistent terminal workflow: [attach / exec / batch / daemon]('+relative+'). Client permissions remain operator-owned; client mode now includes the narrow catastrophic guard. The earlier one-call API remains compatible. New installs generate the terminal tool preset; existing configuration is never silently replaced.\n\n'
        p.write_text(intro+text,encoding='utf-8')
# All packaged docs referenced by README and all thin clients ship together; no separate adapter download.
change('scripts/package_release.py',"    for path in ('LICENSE', 'README.md', 'README.en.md', 'docs/migration-0.2.md'):\n        z.write(root / path, path)",'''    files=[root/'LICENSE',root/'README.md',root/'README.en.md',root/'README.zh-CN.md',root/'CHANGELOG.md',root/'CONTRIBUTING.md',root/'SECURITY.md',root/'ROADMAP.md']
    files+=list((root/'docs').rglob('*.md'))+list((root/'docs'/'benchmarks').glob('*.json'))
    files+=list((root/'clients').glob('*.py'))+list((root/'clients').glob('*.ps1'))
    for path in files:
        z.write(path,path.relative_to(root).as_posix())''')
print('Final source, critical guard, stream lifetime, daemon shutdown and client distribution updates applied')
