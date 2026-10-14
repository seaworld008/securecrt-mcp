use super::*;

#[cfg(unix)]
fn test_manager() -> ConnectorManager {
    ConnectorManager::new(
        crate::policy::PolicyEngine::new(&crate::config::PolicyConfig::default()).unwrap(),
        crate::audit::AuditLog::new(false, false, std::path::PathBuf::new()),
    )
}

#[cfg(unix)]
async fn guarded_fixture(
    policy: crate::config::PolicyConfig,
    audit: crate::audit::AuditLog,
) -> (ConnectorManager, Arc<ExecTransport>) {
    let manager = ConnectorManager::new(crate::policy::PolicyEngine::new(&policy).unwrap(), audit);
    let transport = local_transport();
    manager.sessions.lock().await.insert(
        "openssh/guard-fixture".into(),
        Arc::new(Session {
            id: "openssh/guard-fixture".into(),
            target: "local shell, no SSH".into(),
            mode: ConnectorMode::Exec,
            created: Instant::now(),
            transport: SessionTransport::Exec(transport.clone()),
        }),
    );
    (manager, transport)
}

#[cfg(unix)]
fn guarded_params(command: &str) -> ConnectorExecParams {
    ConnectorExecParams {
        session_id: "openssh/guard-fixture".into(),
        command: command.into(),
        mode: None,
        expected_prompt: None,
        wait_for: None,
        operation_id: None,
        timeout_ms: Some(1000),
        wait_ms: None,
        max_bytes: None,
        prefer_native_log: None,
    }
}

#[cfg(unix)]
#[tokio::test]
async fn openssh_policy_and_audit_rejections_send_nothing_to_the_transport() {
    for mode in ["observe", "client", "safe", "allowlist"] {
        let policy = crate::config::PolicyConfig {
            mode: mode.into(),
            custom_deny_patterns: vec!["guard_probe".into()],
            ..Default::default()
        };
        let audit = crate::audit::AuditLog::new(false, false, std::path::PathBuf::new());
        let (manager, transport) = guarded_fixture(policy, audit).await;
        let error = manager
            .exec(guarded_params("guard_probe=changed"))
            .await
            .unwrap_err();
        assert_eq!(crate::fault::details(&error)["sent"], false);
        let probe = run_exec(
            &transport,
            "printf '%s' \"${guard_probe:-unchanged}\"",
            1000,
        )
        .await;
        assert_eq!(String::from_utf8(probe.output).unwrap(), "unchanged\n");
    }
    let audit_path = std::env::temp_dir()
        .join(Uuid::new_v4().to_string())
        .join("missing/audit.jsonl");
    let audit = crate::audit::AuditLog::new(true, false, audit_path);
    let (manager, transport) = guarded_fixture(Default::default(), audit).await;
    let error = manager
        .exec(guarded_params("guard_probe=changed"))
        .await
        .unwrap_err();
    assert_eq!(
        crate::fault::details(&error)["error_code"],
        "audit_unavailable"
    );
    let probe = run_exec(
        &transport,
        "printf '%s' \"${guard_probe:-unchanged}\"",
        1000,
    )
    .await;
    assert_eq!(String::from_utf8(probe.output).unwrap(), "unchanged\n");
}

#[cfg(unix)]
#[tokio::test]
async fn openssh_batch_checks_every_command_before_the_first_send() {
    let policy = crate::config::PolicyConfig {
        custom_deny_patterns: vec!["forbidden".into()],
        ..Default::default()
    };
    let (manager, transport) = guarded_fixture(
        policy,
        crate::audit::AuditLog::new(false, false, std::path::PathBuf::new()),
    )
    .await;
    assert!(
        manager
            .batch(ConnectorBatchParams {
                session_id: "openssh/guard-fixture".into(),
                commands: vec!["guard_probe=changed".into(), "printf forbidden".into()],
                operation_id: None,
                on_error: Some("continue".into()),
                timeout_ms: Some(1000),
                prefer_native_log: None,
            })
            .await
            .is_err()
    );
    let probe = run_exec(
        &transport,
        "printf '%s' \"${guard_probe:-unchanged}\"",
        1000,
    )
    .await;
    assert_eq!(String::from_utf8(probe.output).unwrap(), "unchanged\n");
}

#[tokio::test]
async fn openssh_raw_and_interrupt_require_policy_and_before_send_audit() {
    for mode in ["client", "observe"] {
        let policy = crate::config::PolicyConfig {
            mode: mode.into(),
            allow_raw_send: mode == "observe",
            allow_interrupt: mode == "observe",
            ..Default::default()
        };
        let manager = ConnectorManager::new(
            crate::policy::PolicyEngine::new(&policy).unwrap(),
            crate::audit::AuditLog::new(false, false, std::path::PathBuf::new()),
        );
        let error = manager
            .write(ConnectorWriteParams {
                session_id: "no-session".into(),
                text: "test".into(),
                append_enter: None,
            })
            .await
            .unwrap_err();
        assert!(error.to_string().contains("raw input disabled"));
        let error = manager
            .interrupt(ConnectorSessionParams {
                session_id: "no-session".into(),
            })
            .await
            .unwrap_err();
        assert!(error.to_string().contains("interrupt disabled"));
    }
    let policy = crate::config::PolicyConfig {
        allow_raw_send: true,
        ..Default::default()
    };
    let audit_path = std::env::temp_dir()
        .join(Uuid::new_v4().to_string())
        .join("missing/audit.jsonl");
    let manager = ConnectorManager::new(
        crate::policy::PolicyEngine::new(&policy).unwrap(),
        crate::audit::AuditLog::new(true, false, audit_path),
    );
    for error in [
        manager.guard.raw("test", "test").await.unwrap_err(),
        manager.guard.interrupt("test").await.unwrap_err(),
    ] {
        assert_eq!(
            crate::fault::details(&error)["error_code"],
            "audit_unavailable"
        );
        assert_eq!(crate::fault::details(&error)["sent"], false);
    }
}

#[cfg(unix)]
#[tokio::test]
async fn openssh_allowed_command_writes_a_private_audit_before_dispatch() {
    let path = std::env::temp_dir().join(format!("openssh-audit-{}.jsonl", Uuid::new_v4()));
    let (manager, _) = guarded_fixture(
        Default::default(),
        crate::audit::AuditLog::new(true, false, path.clone()),
    )
    .await;
    let result = manager
        .exec(guarded_params("printf nonsecret-fixture"))
        .await
        .unwrap();
    assert_eq!(result["exit_code"], 0);
    let record: Value =
        serde_json::from_str(std::fs::read_to_string(&path).unwrap().trim()).unwrap();
    assert_eq!(record["event"], "dispatch_attempt");
    assert_eq!(record["command_id"], result["command_id"]);
    assert_eq!(record["command"], Value::Null);
    assert_eq!(
        record["command_sha256"],
        sha256_hex("printf nonsecret-fixture")
    );
    drop(manager);
    std::fs::remove_file(path).unwrap();
}

#[cfg(unix)]
#[tokio::test]
async fn batch_ledger_exhaustion_returns_prior_command_receipts() {
    let manager = test_manager();
    manager.sessions.lock().await.insert(
        "openssh/batch-fixture".into(),
        Arc::new(Session {
            id: "openssh/batch-fixture".into(),
            target: "local fixture".into(),
            mode: ConnectorMode::Exec,
            created: Instant::now(),
            transport: SessionTransport::Exec(local_transport()),
        }),
    );
    for index in 0..MAX_OPERATIONS - 1 {
        manager.operations.lock().await.insert(
            format!("reserved-{index}"),
            ("old-receipt".into(), "old-fingerprint".into()),
        );
    }
    let value = manager
        .batch(ConnectorBatchParams {
            session_id: "openssh/batch-fixture".into(),
            commands: vec!["printf first".into(), "printf second".into()],
            operation_id: Some("capacity-batch".into()),
            on_error: None,
            timeout_ms: Some(1000),
            prefer_native_log: None,
        })
        .await
        .unwrap();
    assert_eq!(value["state"], json!("stopped"));
    assert_eq!(value["results"].as_array().unwrap().len(), 2);
    assert_eq!(value["results"][0]["result"]["state"], json!("completed"));
    let id = value["results"][0]["result"]["command_id"]
        .as_str()
        .unwrap();
    assert_eq!(
        manager.command_status(id).await.unwrap()["exit_code"],
        json!(0)
    );
    assert_eq!(value["results"][1]["result"]["sent"], json!(false));
}

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
async fn partial_end_marker_is_not_exposed_as_timeout_output() {
    let code = "import sys,re,time; time.sleep(0.25); print('fixture-ready',flush=True); line=sys.stdin.readline(); begin=re.search(r'MCP_BEGIN_[a-f0-9]+',line).group(); end=re.search(r'MCP_END_[a-f0-9]+',line).group(); sys.stdout.write(begin+'\\nuser-output\\n'+end[:20]); sys.stdout.flush(); time.sleep(1)";
    let mut child = Command::new("python3")
        .args(["-c", code])
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .kill_on_drop(true)
        .spawn()
        .unwrap();
    // Deliberately start slower than 200 ms: fixture setup is not the capture's
    // deadline. Wait for readiness without widening that deadline or retrying.
    let mut stdout = BufReader::new(child.stdout.take().unwrap());
    let mut ready = String::new();
    timeout(Duration::from_secs(5), stdout.read_line(&mut ready))
        .await
        .expect("Python fixture did not become ready")
        .unwrap();
    assert_eq!(ready, "fixture-ready\n");
    let transport = Arc::new(ExecTransport {
        stdin: Mutex::new(child.stdin.take().unwrap()),
        stdout: Mutex::new(stdout),
        child: Mutex::new(child),
        command_lock: Mutex::new(()),
        unresolved: AtomicBool::new(false),
    });
    let value = run_exec(&transport, "fixture", 200).await;
    assert_eq!(value.state, "unknown");
    assert_eq!(value.output, b"user-output\n");
    assert!(!String::from_utf8_lossy(&value.output).contains("MCP_END"));
}

#[cfg(unix)]
#[tokio::test]
async fn cancelled_capture_keeps_the_transport_interlocked() {
    let transport = local_transport();
    let pending = transport.clone();
    let task = tokio::spawn(async move { run_exec(&pending, "sleep 1", 5000).await });
    for _ in 0..100 {
        if transport.stdout.try_lock().is_err() {
            break;
        }
        tokio::time::sleep(Duration::from_millis(1)).await;
    }
    assert!(transport.stdout.try_lock().is_err());
    assert!(!transport.unresolved.load(Ordering::SeqCst));
    task.abort();
    assert!(task.await.is_err());
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
async fn ordinary_concurrent_execs_serialize_without_uncertainty() {
    let transport = local_transport();
    let (first, second) = tokio::join!(
        run_exec(&transport, "sleep 0.05; printf first", 1000),
        run_exec(&transport, "printf second", 1000)
    );
    assert_eq!(first.state, "completed");
    assert_eq!(second.state, "completed");
    assert!(!transport.unresolved.load(Ordering::SeqCst));
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
    let manager = test_manager();
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
        prefer_native_log: None,
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
