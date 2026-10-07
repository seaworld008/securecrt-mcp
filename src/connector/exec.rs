use super::*;

pub(super) async fn run_exec(
    transport: &Arc<ExecTransport>,
    command: &str,
    timeout_ms: u64,
) -> ExecOutcome {
    let requested_at = Instant::now();
    let _guard = transport.command_lock.lock().await;
    let started_at = Instant::now();
    let queue_wait_us = started_at.duration_since(requested_at).as_micros() as u64;
    if transport.unresolved.load(Ordering::SeqCst) {
        return ExecOutcome {
            state: "rejected",
            sent: Some(false),
            output: Vec::new(),
            exit_code: None,
            truncated: false,
            reason: "session unresolved after waiting; nothing sent".into(),
            queue_wait_us,
            first_byte_us: None,
            native_read_count: 0,
        };
    }
    let marker = Uuid::new_v4().simple().to_string();
    let begin = format!("MCP_BEGIN_{marker}");
    let end = format!("MCP_END_{marker}");
    let quoted = command.replace('\'', "'\\''");
    let envelope =
        format!("printf '\\n%s\\n' '{begin}'; eval '{quoted}'; printf '\\n{end} %s\\n' \"$?\"\n");
    let mut stdin = transport.stdin.lock().await;
    if let Err(error) = stdin.write_all(envelope.as_bytes()).await {
        transport.unresolved.store(true, Ordering::SeqCst);
        return ExecOutcome {
            state: "unknown",
            sent: None,
            output: Vec::new(),
            exit_code: None,
            truncated: false,
            reason: format!("OpenSSH write outcome unknown; do not replay: {error}"),
            queue_wait_us,
            first_byte_us: None,
            native_read_count: 0,
        };
    }
    if let Err(error) = stdin.flush().await {
        transport.unresolved.store(true, Ordering::SeqCst);
        return ExecOutcome {
            state: "unknown",
            sent: Some(true),
            output: Vec::new(),
            exit_code: None,
            truncated: false,
            reason: format!("OpenSSH flush outcome unknown; do not replay: {error}"),
            queue_wait_us,
            first_byte_us: None,
            native_read_count: 0,
        };
    }
    drop(stdin);
    let mut stdout = transport.stdout.lock().await;
    let mut output = Vec::new();
    let mut started = false;
    let mut truncated = false;
    let mut first_byte_us = None;
    let mut native_read_count = 0;
    let mut at_line_start = true;
    // Keep an unfinished read outside the timeout future so partial output
    // survives cancellation while waiting for a newline.
    let mut line = Vec::new();
    let deadline = timeout(Duration::from_millis(timeout_ms), async {
        loop {
            line.clear();
            native_read_count += 1;
            if !stdout.fill_buf().await?.is_empty() && first_byte_us.is_none() {
                first_byte_us = Some(started_at.elapsed().as_micros() as u64);
            }
            // Bound even a peer's unterminated line before it reaches the cache.
            let size = (&mut *stdout)
                .take(MAX_PAGE as u64)
                .read_until(b'\n', &mut line)
                .await?;
            if size == 0 {
                return Err::<(Vec<u8>, i32, bool), anyhow::Error>(anyhow!(
                    "OpenSSH process exited before marker"
                ));
            }
            let text = String::from_utf8_lossy(&line);
            let trimmed = text.trim_end_matches(['\r', '\n']);
            let marker_boundary = at_line_start;
            at_line_start = line.ends_with(b"\n");
            if marker_boundary && trimmed == begin {
                started = true;
                continue;
            }
            if let Some(code) = marker_boundary.then_some(trimmed).and_then(|text| {
                text.strip_prefix(&(end.clone() + " "))
                    .and_then(|s| s.parse::<i32>().ok())
            }) {
                return Ok((output.clone(), code, truncated));
            }
            if started {
                if output.len() < MAX_OUTPUT {
                    let remaining = MAX_OUTPUT - output.len();
                    let take = remaining.min(line.len());
                    output.extend_from_slice(&line[..take]);
                    truncated |= take != line.len();
                } else {
                    truncated = true;
                }
            }
        }
    })
    .await;
    if !matches!(&deadline, Ok(Ok(_))) && started && !line.is_empty() {
        let take = MAX_OUTPUT.saturating_sub(output.len()).min(line.len());
        output.extend_from_slice(&line[..take]);
        truncated |= take != line.len();
    }
    let outcome = match deadline {
        Ok(Ok((output, exit_code, truncated))) => ExecOutcome {
            state: "completed",
            sent: Some(true),
            output,
            exit_code: Some(exit_code),
            truncated,
            reason: "POSIX marker observed".into(),
            queue_wait_us,
            first_byte_us,
            native_read_count,
        },
        Ok(Err(error)) => ExecOutcome {
            state: "unknown",
            sent: Some(true),
            output,
            exit_code: None,
            truncated,
            reason: format!("command outcome unknown; do not replay: {error}"),
            queue_wait_us,
            first_byte_us,
            native_read_count,
        },
        Err(_) => ExecOutcome {
            state: "unknown",
            sent: Some(true),
            output,
            exit_code: None,
            truncated,
            reason: format!("command timeout after {timeout_ms}ms; remote work may continue"),
            queue_wait_us,
            first_byte_us,
            native_read_count,
        },
    };
    // Publish uncertainty while the command lock is still held, so queued calls
    // cannot send between this result and the manager storing its receipt.
    if outcome.state == "unknown" {
        transport.unresolved.store(true, Ordering::SeqCst);
    }
    outcome
}
