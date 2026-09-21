from pathlib import Path

def change(path,old,new):
    p=Path(path);s=p.read_text(encoding='utf-8')
    if old not in s:raise AssertionError((path,old[:100]))
    p.write_text(s.replace(old,new),encoding='utf-8')

# Draining a native overflow chunk must not wait for more remote output.
change('bridge/securecrt_bridge.py',"        while len(pending) < MAX_CHUNK and count < max_reads:","        draining_pending = bool(pending)\n        while not draining_pending and len(pending) < MAX_CHUNK and count < max_reads:")
# Native lifecycle cleanup is internal, but public 'end' requests must respect capture ownership.
change('bridge/securecrt_bridge.py',"        adapter.metrics['requests'] += 1", "        if method == 'end':\n            capture = adapter.captures.get(params.get('capture_id'))\n            if capture and capture['owner'] != adapter.owner:\n                fail('ownership_conflict: cannot end another connector capture')\n        adapter.metrics['requests'] += 1")
change('bridge/securecrt_bridge.py',"        self._ownership(session)\n        e = self._session(session)\n        self._before_send()", "        if 'owner' in c and c['owner'] != self.owner: fail('ownership_conflict')\n        self._ownership(session)\n        e = self._session(session)\n        self._before_send()")
# A startup daemon endpoint preserves one Engine across standalone clients.
change('src/local_cli.rs','fn engine() -> Result<Engine>', 'pub(crate) fn engine() -> Result<Engine>')
change('src/local_cli.rs','fn input(path: &str) -> Result<Value>', 'pub(crate) fn input(path: &str) -> Result<Value>')
change('src/local_cli.rs','fn emit(value: &Value) -> Result<()>', 'pub(crate) fn emit(value: &Value) -> Result<()>')
change('src/local_cli.rs','pub async fn sessions() -> Result<()> {','pub async fn sessions() -> Result<()> {\n    if crate::daemon::available(){return emit(&crate::daemon::call("sessions",json!({})).await?);}')
change('src/local_cli.rs','pub async fn screen(session: String) -> Result<()> {','pub async fn screen(session: String) -> Result<()> {\n    if crate::daemon::available(){return emit(&crate::daemon::call("screen",json!({"session":session})).await?);}')
change('src/local_cli.rs','pub async fn run(path: &str) -> Result<()> {','''pub async fn run(path: &str) -> Result<()> {
    if crate::daemon::available() {
        // Never fall back to a new Engine after a daemon failure; a command may have been sent.
        let mut value=crate::daemon::call("run",input(path)?).await?;
        value["client"]=json!("persistent_daemon");value["output_available_after_exit"]=json!(true);
        emit(&value)?;
        ensure!(matches!(value["state"].as_str(),Some("running"|"starting"|"completed")),"daemon command failed; inspect JSON before another operation");
        return Ok(());
    }
''')
change('src/main.rs','mod critical;', 'mod critical;\nmod daemon;')
change('src/main.rs','    Serve,','''    Serve,
    /// Retain one Engine for separate CLI clients. Foreground only, never auto-spawned.
    Daemon {
        #[arg(long, conflicts_with="cleanup_stale")]
        stop: bool,
        /// Explicitly remove a refused stale endpoint after inspecting SecureCRT; no state reset.
        #[arg(long)]
        cleanup_stale: bool,
    },
    /// Invoke the persistent daemon using a UTF-8 JSON file, without starting another Engine.
    Session {
        #[arg(value_parser=["sessions","screen","attach","exec","exec-batch","batch-status","detach","heartbeat","status","output","acknowledge-idle","interrupt","shell-open","shell-read","shell-write","shell-close","latency","ping"])]
        method: String,
        #[arg(long, default_value="-")]
        input: String,
    },''')
change('src/main.rs','        offline: bool,','        offline: bool,\n        #[arg(long, conflicts_with="offline")]\n        latency: bool,')
change('src/main.rs','        Command::Doctor { offline } => doctor(offline).await?,','''        Command::Doctor { offline, latency } => {
            if latency {local_cli::emit(&local_cli::engine()?.latency(20).await?)?;}else{doctor(offline).await?;}
        },
        Command::Daemon {stop,cleanup_stale} => {
            if stop {local_cli::emit(&daemon::call("shutdown",serde_json::json!({})).await?)?;}
            else if cleanup_stale {daemon::cleanup_stale().await?;}else{daemon::serve().await?;}
        },
        Command::Session {method,input} => local_cli::emit(&daemon::call(&method,local_cli::input(&input)?).await?)?,''')
# Engine quiescence checks command and batch state; daemon lifecycle RW lock covers preflight.
p=Path('src/execution/persistent.rs');s=p.read_text();s+='''
impl Engine {
    pub async fn quiescent(&self)->Result<()> {
        ensure!(self.inner.lock().await.busy.is_empty(),"cannot stop daemon with active/unresolved jobs; inspect and resolve first");
        ensure!(!self.terminal.lock().await.batches.values().any(|(_,b)|b["state"]=="running"),"cannot stop daemon with active batch");
        Ok(())
    }
}
''';p.write_text(s)
# Avoid a shutdown/preflight race in daemon: command handlers hold read leases, shutdown takes write.
change('src/daemon.rs','sync::{Semaphore,watch}', 'sync::{Semaphore,watch,RwLock}')
change('src/daemon.rs','    let (stop_tx,mut stop_rx)=watch::channel(false);','    let (stop_tx,mut stop_rx)=watch::channel(false);\n    let lifecycle=Arc::new(RwLock::new(()));')
change('src/daemon.rs','let stop_tx=stop_tx.clone();','let stop_tx=stop_tx.clone();let lifecycle=lifecycle.clone();')
change('src/daemon.rs','                    let result=if stopping {engine.quiescent().await.map(|()|json!({"stopping":true,"sent":false}))}\n                        else{route(&engine,method,req["params"].clone()).await};','''                    let result=if stopping {
                        let _lock=lifecycle.write().await;
                        let result=engine.quiescent().await.map(|()|json!({"stopping":true,"sent":false}));
                        if result.is_ok(){let _=stop_tx.send(true);}result
                    } else {
                        let _lock=lifecycle.read().await;
                        if *stop_tx.borrow(){Err(anyhow::anyhow!("daemon shutting down; nothing sent"))}
                        else {route(&engine,method,req["params"].clone()).await}
                    };''')
# Do not claim an operator-requested local stream close sent an interrupt.
change('src/execution.rs','"interrupt requested; termination unproven".to_owned()', '"capture cancellation requested; remote termination unproven".to_owned()')
print('Applied reviewed output/ownership fixes and persistent CLI routing')
