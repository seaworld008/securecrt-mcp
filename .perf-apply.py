from pathlib import Path

def change(path, old, new):
    p=Path(path); s=p.read_text(encoding='utf-8')
    if old not in s: raise AssertionError((path,old[:100]))
    p.write_text(s.replace(old,new),encoding='utf-8')

# Embed the new runtime into the existing single script; keep its public helpers and entry point.
p=Path('bridge/securecrt_bridge.py');s=p.read_text(encoding='utf-8');native=Path('.perf-native.py').read_text(encoding='utf-8')
cls,server=native[native.index('class NativeAdapter:'):].split('\ndef serve(',1)
s=s[:s.index('class NativeAdapter:')]+cls+'\n'+s[s.index('METHODS ='):]
s=s[:s.index('def serve(')]+'def serve('+server+'\n\n'+s[s.index('def main():'):]
s=s.replace("'end', 'interrupt', 'acknowledge_idle', 'send_text')", "'end', 'interrupt', 'acknowledge_idle', 'send_text', 'attach', 'heartbeat', 'detach', 'prepare_and_begin', 'poll_bulk', 'stream_write')")
s=s.replace("        adapter.request_deadline = deadline", "        adapter.owner = string(request.get('client_id', 'legacy'), 'client_id', 128)\n        adapter.metrics['requests'] += 1\n        adapter.request_deadline = deadline")
s=s.replace('0.2.0-preview.2','0.3.0-preview.1');p.write_text(s,encoding='utf-8')
for name in ['Cargo.toml','Cargo.lock','tests/mcp_smoke.py']:
    p=Path(name);p.write_text(p.read_text(encoding='utf-8').replace('0.2.0-preview.2','0.3.0-preview.1'),encoding='utf-8')
change('src/main.rs','mod audit;', 'mod critical;\nmod terminal;\nmod audit;')
change('src/policy.rs','        if self.mode != "client" {', '        if crate::critical::is_critical(cmd) {\n            return denied("critical_guardrail: catastrophic command position/target; client approval does not override this narrow guard");\n        }\n        if self.mode != "client" {')
change('src/model.rs','    Posix,','    Posix,\n    /// Continuous capture. Explicit close/interrupt; no automatic completion inference.\n    Stream,')
change('src/model.rs','pub struct ExecuteParams {','pub struct ExecuteParams {\n    #[serde(default)]\n    pub attachment_id: Option<String>,')
change('src/execution.rs','use anyhow::{Result, ensure};','use anyhow::{Context, Result, ensure};')
change('src/execution.rs','mod convenience;', 'mod convenience;\nmod persistent;')
change('src/execution.rs','use tokio::sync::Mutex;','use tokio::sync::{Mutex, Notify};')
change('src/execution.rs','    busy: Option<String>,','    busy: HashMap<String,String>,')
change('src/execution.rs','    run_gate: Arc<Mutex<()>>,','    run_gates: Arc<Mutex<HashMap<String,Arc<Mutex<()>>>>>,\n    changed: Arc<Notify>,\n    terminal: Arc<Mutex<persistent::TerminalState>>,')
change('src/execution.rs','            run_gate: Arc::new(Mutex::new(())),','            run_gates: Arc::new(Mutex::new(HashMap::new())),\n            changed: Arc::new(Notify::new()),\n            terminal: Arc::new(Mutex::new(persistent::TerminalState::default())),')
change('src/execution.rs','    output_bytes: usize,','    output_bytes: usize,\n    output_start: usize,\n    stream: bool,\n    created: Instant,\n    first_output_us: Option<u64>,\n    poll_calls: u64,')
change('src/execution.rs','            "remote_termination_confirmed": false})','            "remote_termination_confirmed": false, "stream": self.stream, "output_start": self.output_start,\n            "timing": {"elapsed_us": self.finished.unwrap_or_else(Instant::now).duration_since(self.created).as_micros() as u64,\n                "first_output_us": self.first_output_us, "poll_calls": self.poll_calls}})')
change('src/execution.rs','        self.output_bytes = self.output_bytes.saturating_add(text.len());','''        if !text.is_empty() && self.first_output_us.is_none() {self.first_output_us=Some(self.created.elapsed().as_micros() as u64);}
        self.output_bytes = self.output_bytes.saturating_add(text.len());
        if self.stream {
            self.output.push_str(text);
            if self.output.len()>limit {
                let mut remove=self.output.len()-limit;
                while !self.output.is_char_boundary(remove){remove+=1;}
                self.output.drain(..remove);self.output_start+=remove;self.truncated=true;
            }
            return;
        }''')
change('src/execution.rs','                    output_bytes: 0,','                    output_bytes: 0,\n                    output_start: 0, stream: p.mode == CaptureMode::Stream, created: Instant::now(), first_output_us: None, poll_calls: 0,')
change('src/execution.rs','        let timeout = p.timeout_ms.unwrap_or(5000);','        let fast = self.bridge.supports_fast().await?;\n        let timeout = p.timeout_ms.unwrap_or(5000);')
change('src/execution.rs','            !p.expected_prompt.trim().is_empty()\n                && p.expected_prompt.len() <= 512\n                && !p.expected_prompt.chars().any(char::is_control),','            (fast && p.screen_token.is_empty() && (p.mode == CaptureMode::Posix || p.attachment_id.is_some()))\n                || (!p.expected_prompt.trim().is_empty() && p.expected_prompt.len() <= 512\n                    && !p.expected_prompt.chars().any(char::is_control)),')
change('src/execution.rs','                registry.busy.is_none(),','                !registry.busy.contains_key(&p.session),')
change('src/execution.rs','            registry.busy = Some(id.clone());','            registry.busy.insert(p.session.clone(),id.clone());')
change('src/execution.rs','j.finished.is_none_or(|t| t.elapsed() < retention)','j.requires_idle_ack || j.finished.is_none_or(|t| t.elapsed() < retention)')
change('src/execution.rs','                    .filter_map(|(id, job)| job.finished.map(|finished| (id.clone(), finished)))','                    .filter(|(_,job)| !job.requires_idle_ack)\n                    .filter_map(|(id, job)| job.finished.map(|finished| (id.clone(), finished)))')
old='''        let request = json!({"session": p.session, "screen_token": p.screen_token,
            "expected_prompt": p.expected_prompt, "text": text, "capture_id": id, "runtime_ms": timeout});'''
new='''        let prepared=fast && p.screen_token.is_empty();
        let mut request=if prepared {json!({"session":p.session,"attachment_id":p.attachment_id,
            "expected_prompt":if p.expected_prompt.is_empty(){None}else{Some(&p.expected_prompt)},
            "text":text,"capture_id":id,"runtime_ms":timeout})}else{
            json!({"session":p.session,"screen_token":p.screen_token,"expected_prompt":p.expected_prompt,
                "text":text,"capture_id":id,"runtime_ms":timeout})};
        if fast {request["completion_marker"]=if p.mode==CaptureMode::Posix{json!(&end)}else{Value::Null};}'''
change('src/execution.rs',old,new)
change('src/execution.rs','self.bridge.call("begin", request).await.and_then','self.bridge.call(if prepared {"prepare_and_begin"} else {"begin"}, request).await.and_then')
change('src/execution.rs','        let started = Instant::now();','        let fast=self.bridge.supports_fast().await.unwrap_or(false);\n        let started = Instant::now();')
change('src/execution.rs','            let request = json!({"capture_id": id, "wait_for": if p.mode == CaptureMode::Prompt { p.wait_for.clone() } else { None }});','            let mut request = json!({"capture_id": id, "wait_for": if p.mode == CaptureMode::Prompt { p.wait_for.clone() } else { None }});\n            if fast {request["max_reads"]=json!(128);}')
change('src/execution.rs','self.bridge.call("poll", request).await','self.bridge.call(if fast {"poll_bulk"} else {"poll"}, request).await')
change('src/execution.rs','                job.append(&output, self.config.bridge.max_output_bytes);','                job.poll_calls+=1;\n                job.append(&output, self.config.bridge.max_output_bytes);')
change('src/execution.rs','            if response["overflow"].as_bool() == Some(true) || parser.overflow {','            self.changed.notify_waiters();\n            if response["overflow"].as_bool() == Some(true) || parser.overflow {')
change('src/execution.rs','            tokio::time::sleep(Duration::from_millis(5)).await;','            if chunk.is_empty(){tokio::time::sleep(Duration::from_millis(5)).await;}else{tokio::task::yield_now().await;}')
change('src/execution.rs','            if release && registry.busy.as_deref() == Some(id) {\n                registry.busy = None;\n            }','            if release && registry.busy.get(&session).map(String::as_str) == Some(id) {\n                registry.busy.remove(&session);\n            }')
change('src/execution.rs','        if let Err(error) = self\n            .audit\n            .record("terminal_state",','        self.changed.notify_waiters();\n        if let Err(error) = self\n            .audit\n            .record("terminal_state",')
change('src/execution.rs','        let offset = p.cursor.unwrap_or(0);','        let requested = p.cursor;')
change('src/execution.rs','        ensure!(\n            offset <= job.output.len() && job.output.is_char_boundary(offset),','        let requested=requested.unwrap_or(job.output_start);\n        let offset=requested.max(job.output_start)-job.output_start;\n        ensure!(\n            offset <= job.output.len() && job.output.is_char_boundary(offset),')
change('src/execution.rs','"cursor": offset, "next_cursor": if end < job.output.len() || job.state.active() { Some(end) } else { None },','"cursor": offset+job.output_start, "next_cursor": if end < job.output.len() || job.state.active() { Some(end+job.output_start) } else { None },\n            "gap":requested<job.output_start,"dropped_bytes":job.output_start.saturating_sub(requested),')
change('src/execution.rs','                registry.busy.as_deref() == Some(id) && job.state != State::Starting,','                registry.busy.get(&job.session).map(String::as_str) == Some(id) && job.state != State::Starting,')
change('src/execution.rs','            if let Some(id) = &registry.busy {','            if let Some(id) = registry.busy.get(&p.session) {')
change('src/execution.rs','            registry.busy.clone()','            registry.busy.get(&p.session).cloned()')
change('src/execution.rs','        if registry.busy == previous {','        if registry.busy.get(&p.session) == previous.as_ref() {')
change('src/execution.rs','            registry.busy = None;','            registry.busy.remove(&p.session);')
# Bounded incremental marker parser; long output lines no longer cause Unknown by themselves.
p=Path('src/execution.rs');s=p.read_text();a=s.index('pub struct MarkerParser');b=s.index('\n#[cfg(test)]',a)
s=s[:a]+'''pub struct MarkerParser {
    begin:String,end:String,started:bool,done:bool,pending:String,mid_line:bool,pub overflow:bool,
}
impl MarkerParser {
    pub fn new(begin:String,end:String)->Self {Self{begin,end,started:false,done:false,pending:String::new(),mid_line:false,overflow:false}}
    pub fn drain_partial(&mut self)->String {if !self.started||self.done{String::new()}else{std::mem::take(&mut self.pending)}}
    pub fn feed(&mut self,chunk:&str)->(String,Option<i32>){
        if self.done{return (String::new(),None);}
        self.pending.push_str(chunk);let mut output=String::new();
        while let Some(index)=self.pending.find('\\n') {
            let line=self.pending[..index].trim_end_matches('\\r').to_owned();self.pending.drain(..=index);
            if !self.started {if !self.mid_line&&line==self.begin{self.started=true;}self.mid_line=false;continue;}
            if !self.mid_line {
                if let Some(status)=line.strip_prefix(&(self.end.clone()+" ")) {
                    if let Ok(code)=status.parse::<i32>() {if (0..=255).contains(&code){self.done=true;self.pending.clear();return(output,Some(code));}}
                }
            }
            output.push_str(&line);output.push('\\n');self.mid_line=false;
        }
        // Keep only a small candidate header. Non-marker long lines flow immediately.
        if self.pending.len()>self.begin.len().max(self.end.len())+32 {
            let n=self.pending.len()-usize::from(self.pending.ends_with('\\r'));
            if self.started{output.push_str(&self.pending[..n]);}
            self.pending.drain(..n);self.mid_line=true;
        }
        (output,None)
    }
}
''' + s[b:];p.write_text(s)
# High-level facade uses fused native preparation when advertised; old adapters remain compatible.
p=Path('src/execution/convenience.rs');s=p.read_text();s=s.replace('        let gate = self\n            .run_gate\n            .try_lock()', '        let gate_ref=self.gate_for(&p.session).await;\n        let gate = gate_ref.try_lock()')
s=s.replace('registry.busy.is_none()', '!registry.busy.contains_key(&p.session)')
needle='        // Reading is not a command or a remote probe. Explicit mode is still required.'
assert needle in s
s=s.replace(needle,'''        if p.mode==CaptureMode::Posix && self.bridge.supports_fast().await? {
            let job=self.submit_internal(ExecuteParams{session:p.session,attachment_id:None,
                screen_token:String::new(),expected_prompt:p.expected_prompt.unwrap_or_default(),
                operation_id:op,command:p.command,mode:p.mode,wait_for:p.wait_for,
                timeout_ms:Some(timeout),settle_ms:p.settle_ms},Some(fingerprint)).await?;
            drop(gate);
            return self.wait_result(job["command_id"].as_str().context("missing command_id")?,wait,max).await;
        }
''' + needle)
s=s.replace('                ExecuteParams {','                ExecuteParams {\n                    attachment_id: None,')
s=s.replace('        loop {\n            let registry = self.inner.lock().await;', '        loop {\n            let changed=self.changed.notified();tokio::pin!(changed);changed.as_mut().enable();\n            let registry = self.inner.lock().await;')
s=s.replace('result["cursor"] = json!(0);','result["cursor"] = json!(job.output_start);').replace('json!(end)\n','json!(end+job.output_start)\n')
s=s.replace('            tokio::time::sleep(Duration::from_millis(25)).await;','            let _=tokio::time::timeout_at(tokio::time::Instant::from_std(until),changed).await;')
a=s.index('    pub async fn drain_on_disconnect');b=s.index('\n}\n\n#[cfg(test)]',a)
s=s[:a]+'''    pub async fn drain_on_disconnect(&self) {
        let until=tokio::time::Instant::now()+Duration::from_secs(2);
        loop {
            let changed=self.changed.notified();tokio::pin!(changed);changed.as_mut().enable();
            let active=self.inner.lock().await.jobs.values().any(|j|j.state.active());
            if !active||tokio::time::Instant::now()>=until{break;}
            let _=tokio::time::timeout_at(until,changed).await;
        }
    }
    async fn gate_for(&self,session:&str)->Arc<Mutex<()>> {
        let mut gates=self.run_gates.lock().await;
        // Retain a gate only while somebody is holding or awaiting it.
        gates.retain(|_,v|Arc::strong_count(v)>1);
        gates.entry(session.into()).or_insert_with(||Arc::new(Mutex::new(()))).clone()
    }
''' + s[b:];p.write_text(s)
# New module's Context extension comes from super's import.
# Annotate potentially dangerous operations honestly; no private authorization bypass.
p=Path('src/server.rs');s=p.read_text();anchor='impl SecureCrtServer {\n    #[tool('
pos=s.index(anchor)+len('impl SecureCrtServer {\n')
methods=Path('.perf-tools.rs').read_text();s=s[:pos]+methods+'\n'+s[pos:];p.write_text(s)
# Preserve previous regression expectations for the original tool subset, add new tests separately.
p=Path('tests/mcp_smoke.py');s=p.read_text();s=s.replace('assert len(names) == 11, names.keys()', 'assert len(names) >= 11, names.keys()');p.write_text(s)
print('Applied persistent transport/native batching/per-session engine; strict tests follow')
