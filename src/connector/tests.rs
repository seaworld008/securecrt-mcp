use super::*;

#[cfg(unix)]
fn local_transport() -> Arc<ExecTransport> {
    let mut child = Command::new("sh")
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .kill_on_drop(true)
        .spawn()
        .unwrap();
    Arc::new(ExecTransport {
        stdin: Mutex::new(child.stdin.take().unwrap()),
        stdout: Mutex::new(BufReader::new(child.stdout.take().unwrap())),
        child: Mutex::new(child),
        command_lock: Mutex::new(()),
        unresolved: AtomicBool::new(false),
    })
}

#[cfg(unix)]
#[tokio::test]
async fn queued_command_is_rejected_if_the_session_became_unresolved() {
    let transport = local_transport();
    let guard = transport.command_lock.lock().await;
    let pending = transport.clone();
    let task =
        tokio::spawn(async move { run_exec(&pending, "printf should-not-send", 1000).await });
    transport.unresolved.store(true, Ordering::SeqCst);
    drop(guard);
    let result = task.await.unwrap();
    assert_eq!(result.state, "rejected");
    assert_eq!(result.sent, Some(false));
    assert!(result.output.is_empty());
}

#[cfg(unix)]
#[tokio::test]
async fn timeout_keeps_partial_unterminated_output_and_interlocks_the_session() {
    let transport = local_transport();
    let result = run_exec(&transport, "printf partial; sleep 1", 100).await;
    assert_eq!(result.state, "unknown");
    assert_eq!(result.output, b"partial");
    assert!(
        result
            .first_byte_us
            .is_some_and(|arrival| arrival < 100_000)
    );
    assert!(result.native_read_count >= 2);
    assert!(transport.unresolved.load(Ordering::SeqCst));
    assert_eq!(
        run_exec(&transport, "printf should-not-send", 1000)
            .await
            .sent,
        Some(false)
    );
}

#[cfg(unix)]
#[tokio::test]
async fn long_unterminated_lines_are_bounded_without_losing_completion() {
    let transport = local_transport();
    let result = run_exec(
        &transport,
        "awk 'BEGIN {for (i=0;i<1100000;i++) printf \"x\"}'",
        10000,
    )
    .await;
    assert_eq!(result.state, "completed");
    assert_eq!(result.exit_code, Some(0));
    assert_eq!(result.output.len(), MAX_OUTPUT);
    assert!(result.truncated);
}

#[cfg(unix)]
#[tokio::test]
async fn output_eviction_keeps_the_operation_ledger_and_never_replays() {
    let manager = ConnectorManager::new();
    manager.sessions.lock().await.insert(
        "openssh/local-fixture".into(),
        Arc::new(Session {
            id: "openssh/local-fixture".into(),
            target: "local fixture, no SSH".into(),
            mode: ConnectorMode::Exec,
            created: Instant::now(),
            transport: SessionTransport::Exec(local_transport()),
        }),
    );
    let params = |index| ConnectorExecParams {
        session_id: "openssh/local-fixture".into(),
        command: "counter=$((${counter:-0}+1)); printf '%s' \"$counter\"".into(),
        mode: None,
        expected_prompt: None,
        wait_for: None,
        operation_id: Some(format!("fixture-{index}")),
        timeout_ms: Some(1000),
        wait_ms: None,
        max_bytes: None,
    };
    for index in 0..=MAX_COMMANDS {
        let value = manager.exec(params(index)).await.unwrap();
        assert_eq!(value["exit_code"], json!(0));
    }
    assert_eq!(manager.commands.lock().await.len(), MAX_COMMANDS);
    assert!(manager.exec(params(0)).await.is_err());
    let value = manager.exec(params(MAX_COMMANDS + 1)).await.unwrap();
    assert!(
        value["output"]["text"]
            .as_str()
            .unwrap()
            .starts_with(&(MAX_COMMANDS + 2).to_string())
    );
    assert!(
        manager
            .read(ConnectorReadParams {
                command_id: value["command_id"].as_str().unwrap().into(),
                cursor: Some(u64::MAX),
                max_bytes: Some(4),
                wait_ms: None
            })
            .await
            .is_err()
    );
}

#[test]
fn ring_buffer_reports_absolute_cursor_gaps() {
    let mut ring = RingBuffer::new();
    ring.append(&vec![b'x'; MAX_OUTPUT + 4]);
    let page = ring.page(0, 4);
    assert_eq!(page["cursor"], json!(4));
    assert_eq!(page["gap"], json!(true));
    assert_eq!(page["dropped_bytes"], json!(4));
    assert_eq!(page["next_cursor"], json!(8));
}

#[test]
fn binary_payload_keeps_text_preview_and_base64() {
    let value = payload(vec![0xff, 0x00, 0x61], json!({}));
    assert!(value["base64"].as_str().is_some());
    assert_eq!(value["text"], json!("�\0a"));
}

#[test]
fn target_and_command_validation_reject_control_input() {
    assert!(validate_target("host\nname").is_err());
    assert!(validate_target("-oProxyCommand=untrusted").is_err());
    assert!(validate_target(" host").is_err());
    assert!(validate_target("user@host").is_ok());
    assert!(validate_target("[::1]").is_ok());
    assert!(validate_command("printf hi\nrm -rf /").is_err());
    assert!(validate_text("\u{1b}[31m").is_ok());
    assert!(validate_text("secret\0").is_err());
}
