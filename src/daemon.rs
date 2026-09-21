//! Optional foreground daemon for reusable CLI calls. Never auto-start, auto-fallback or replay.
use crate::{config, execution::Engine, fault, model, terminal};
use anyhow::{Context, Result, bail, ensure};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use std::{fs, io::Write, path::PathBuf, sync::Arc, time::Duration};
use tokio::{
    io::{AsyncBufReadExt, AsyncWriteExt, BufReader},
    net::{TcpListener, TcpStream},
    sync::{RwLock, Semaphore, watch},
    time::timeout,
};
use uuid::Uuid;
const LIMIT: usize = 262144;
#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct Endpoint {
    port: u16,
    token: String,
    pid: u32,
    version: String,
}
fn endpoint_path() -> Result<PathBuf> {
    Ok(config::app_dir()?.join("daemon.json"))
}
pub fn available() -> bool {
    endpoint_path().is_ok_and(|p| p.exists())
}
fn endpoint() -> Result<Endpoint> {
    let path = endpoint_path()?;
    ensure!(
        !fs::symlink_metadata(&path)?.file_type().is_symlink(),
        "refusing symlink daemon endpoint"
    );
    let bytes = fs::read(&path)?;
    ensure!(bytes.len() < 4096, "invalid daemon endpoint");
    let e: Endpoint = serde_json::from_slice(&bytes)?;
    ensure!(
        e.port >= 1024 && e.token.len() == 64 && e.token.bytes().all(|b| b.is_ascii_hexdigit()),
        "invalid daemon endpoint"
    );
    Ok(e)
}
async fn frame(reader: &mut BufReader<TcpStream>) -> Result<Vec<u8>> {
    let mut out = Vec::new();
    loop {
        let b = reader.fill_buf().await?;
        ensure!(
            !b.is_empty(),
            "daemon connection closed; result unknown, do not replay"
        );
        let n = b
            .iter()
            .position(|x| *x == b'\n')
            .map_or(b.len(), |i| i + 1);
        ensure!(out.len() + n <= LIMIT, "daemon frame exceeds 256 KiB");
        out.extend_from_slice(&b[..n]);
        reader.consume(n);
        if out.last() == Some(&b'\n') {
            return Ok(out);
        }
    }
}
pub async fn call(method: &str, params: Value) -> Result<Value> {
    let e = endpoint().context(
        "daemon unavailable: start securecrt-mcp daemon; never fallback after a send error",
    )?;
    let id = Uuid::new_v4().to_string();
    let req = json!({"id":id,"token":e.token,"method":method,"params":params});
    let mut data = serde_json::to_vec(&req)?;
    data.push(b'\n');
    ensure!(data.len() <= LIMIT, "daemon request exceeds frame limit");
    timeout(Duration::from_secs(75), async {
        let stream = timeout(
            Duration::from_secs(2),
            TcpStream::connect(("127.0.0.1", e.port)),
        )
        .await??;
        stream.set_nodelay(true)?;
        let mut reader = BufReader::new(stream);
        reader.get_mut().write_all(&data).await?;
        let value: Value = serde_json::from_slice(&frame(&mut reader).await?)?;
        ensure!(
            value["id"] == id,
            "daemon response id mismatch; outcome unknown"
        );
        ensure!(
            value["ok"] == true,
            "daemon rejected request: {}",
            value["error"]
        );
        Ok::<Value, anyhow::Error>(value["result"].clone())
    })
    .await
    .context("daemon timeout; existing operation may still run; do not replay")?
}
async fn route(engine: &Engine, method: &str, p: Value) -> Result<Value> {
    match method {
        "sessions" => engine.bridge.call("list_sessions", json!({})).await,
        "screen" => engine.bridge.call("read_screen", p).await,
        "run" => engine.run_command(serde_json::from_value(p)?).await,
        "attach" => {
            engine
                .attach(serde_json::from_value::<terminal::AttachParams>(p)?)
                .await
        }
        "exec" => {
            engine
                .exec(serde_json::from_value::<terminal::ExecParams>(p)?)
                .await
        }
        "exec-batch" => {
            engine
                .exec_batch(serde_json::from_value::<terminal::BatchParams>(p)?)
                .await
        }
        "batch-status" => {
            engine
                .batch_status(p["batch_id"].as_str().context("batch_id required")?)
                .await
        }
        "detach" => {
            engine
                .detach(
                    p["attachment_id"]
                        .as_str()
                        .context("attachment_id required")?,
                )
                .await
        }
        "heartbeat" => engine.bridge.call("heartbeat", p).await,
        "status" => {
            engine
                .status(p["command_id"].as_str().context("command_id required")?)
                .await
        }
        "output" => {
            engine
                .output(serde_json::from_value::<model::OutputParams>(p)?)
                .await
        }
        "acknowledge-idle" => engine.acknowledge_idle(serde_json::from_value(p)?).await,
        "interrupt" => {
            engine
                .interrupt(p["command_id"].as_str().context("command_id required")?)
                .await
        }
        "shell-open" => {
            let mut p: terminal::ExecParams = serde_json::from_value(p)?;
            p.mode = model::CaptureMode::Stream;
            p.wait_ms = Some(0);
            engine.exec(p).await
        }
        "shell-read" => engine.stream_read(serde_json::from_value(p)?).await,
        "shell-write" => engine.stream_write(serde_json::from_value(p)?).await,
        "shell-close" => {
            engine
                .stream_close(p["command_id"].as_str().context("command_id required")?)
                .await
        }
        "latency" => engine.latency(20).await,
        "ping" => Ok(
            json!({"version":env!("CARGO_PKG_VERSION"),"pid":std::process::id(),"persistent_engine":true}),
        ),
        _ => bail!("unsupported daemon method"),
    }
}
fn equal_token(a: &str, b: &str) -> bool {
    if a.len() != b.len() {
        return false;
    }
    a.bytes()
        .zip(b.bytes())
        .fold(0u8, |diff, (x, y)| diff | (x ^ y))
        == 0
}
struct EndpointGuard {
    path: PathBuf,
}
impl Drop for EndpointGuard {
    fn drop(&mut self) {
        let _ = fs::remove_file(&self.path);
    }
}
pub async fn serve() -> Result<()> {
    let engine = crate::local_cli::engine()?;
    let path = endpoint_path()?;
    let listener = TcpListener::bind(("127.0.0.1", 0)).await?;
    let endpoint = Endpoint {
        port: listener.local_addr()?.port(),
        token: format!("{}{}", Uuid::new_v4().simple(), Uuid::new_v4().simple()),
        pid: std::process::id(),
        version: env!("CARGO_PKG_VERSION").into(),
    };
    let mut options = fs::OpenOptions::new();
    options.write(true).create_new(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    let mut file = options.open(&path).context(
        "daemon.json already exists; inspect existing daemon, do not overwrite its identity",
    )?;
    let _guard = EndpointGuard { path };
    file.write_all(&serde_json::to_vec(&endpoint)?)?;
    file.sync_all()?;
    drop(file);
    eprintln!(
        "securecrt-mcp daemon ready: loopback port {} pid {}; stop with daemon --stop",
        endpoint.port, endpoint.pid
    );
    let token = Arc::new(endpoint.token);
    let slots = Arc::new(Semaphore::new(32));
    let (stop_tx, mut stop_rx) = watch::channel(false);
    let lifecycle = Arc::new(RwLock::new(()));
    loop {
        tokio::select! {
            _=stop_rx.changed()=>{break;},
            accepted=listener.accept()=>{
                let (stream,_)=accepted?;
                let Ok(permit)=slots.clone().try_acquire_owned() else {drop(stream);continue;};
                let engine=engine.clone();let token=token.clone();let stop_tx=stop_tx.clone();let lifecycle=lifecycle.clone();
                tokio::spawn(async move {
                    let _permit=permit;
                    let mut reader=BufReader::new(stream);
                    let read=timeout(Duration::from_secs(5),frame(&mut reader)).await;
                    let Ok(Ok(bytes))=read else{return;};
                    let Ok(req)=serde_json::from_slice::<Value>(&bytes) else{return;};
                    let Some(provided)=req["token"].as_str() else{return;};
                    if !equal_token(provided,&token){return;}
                    let id=req["id"].clone();
                    let method=req["method"].as_str().unwrap_or("");
                    let stopping=method=="shutdown";
                    let result=if stopping {
                        let _lock=lifecycle.write().await;
                        let result=engine.quiescent().await.map(|()|json!({"stopping":true,"sent":false}));
                        if result.is_ok(){let _=stop_tx.send(true);}result
                    } else {
                        let _lock=lifecycle.read().await;
                        if *stop_tx.borrow(){Err(anyhow::anyhow!("daemon shutting down; nothing sent"))}
                        else {route(&engine,method,req["params"].clone()).await}
                    };
                    let shutdown_ok=stopping&&result.is_ok();
                    let value=match result {Ok(v)=>json!({"id":id,"ok":true,"result":v}),Err(e)=>json!({"id":id,"ok":false,"error":fault::details(&e)})};
                    if let Ok(mut data)=serde_json::to_vec(&value){data.push(b'\n');if data.len()<=LIMIT{let _=timeout(Duration::from_secs(5),reader.get_mut().write_all(&data)).await;}}
                    if shutdown_ok{let _=stop_tx.send(true);}
                });
            }
        }
    }
    engine.drain_on_disconnect().await;
    Ok(())
}
pub async fn cleanup_stale() -> Result<()> {
    let e = endpoint()?;
    match timeout(
        Duration::from_secs(2),
        TcpStream::connect(("127.0.0.1", e.port)),
    )
    .await
    {
        Ok(Err(error)) if error.kind() == std::io::ErrorKind::ConnectionRefused => {
            fs::remove_file(endpoint_path()?)?
        }
        _ => bail!("daemon endpoint may still be active; refusing cleanup"),
    }
    eprintln!(
        "Removed stale daemon endpoint only. Inspect SecureCRT before new work; unresolved state is NOT cleared."
    );
    Ok(())
}
