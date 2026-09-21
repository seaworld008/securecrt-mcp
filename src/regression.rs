//! Regression tests: no SSH connections or native SecureCRT runtime required.
use crate::{
    config::Config,
    execution::MarkerParser,
    policy::{Decision, PolicyEngine},
};

#[test]
fn configuration_rejects_panicking_timeouts() {
    let mut config = Config::default();
    config.bridge.max_command_timeout_ms = 0;
    assert!(config.validate().is_err());
    config.bridge.max_command_timeout_ms = 30_000;
    config.bridge.host = "0.0.0.0".into();
    assert!(config.validate().is_err());
}

#[test]
fn safe_is_not_just_a_command_prefix() {
    let mut config = Config::default();
    config.policy.mode = "safe".into();
    let engine = PolicyEngine::new(&config.policy).unwrap();
    for command in [
        "ip link set eth0 down",
        "journalctl --vacuum-time=1s",
        "dmesg -C",
        "git branch -D scratch",
        "ss -K dst 127.0.0.1",
        "hostname --file /tmp/name",
        "kubectl get pods --raw /api",
        "\x15uname -a",
        "uname -a\n",
        "cat /etc/hosts\x03",
    ] {
        assert_eq!(
            engine.classify_command(command).decision,
            Decision::Deny,
            "{command}"
        );
    }
    for command in [
        "uname -a",
        "df -h",
        "free -h",
        "kubectl get pods -A",
        "ip link show",
        "journalctl --no-pager -u nginx -n 200",
        "docker stats --no-stream",
    ] {
        assert_eq!(
            engine.classify_command(command).decision,
            Decision::Allow,
            "{command}"
        );
    }
}

#[test]
fn custom_allow_test_actually_requires_a_matching_rule() {
    let mut config = Config::default();
    config.policy.mode = "allowlist".into();
    let command = "kubectl get pods -A | grep Running";
    assert_eq!(
        PolicyEngine::new(&config.policy)
            .unwrap()
            .classify_command(command)
            .decision,
        Decision::Deny
    );
    config
        .policy
        .custom_allow_patterns
        .push(r"kubectl get pods -A \| grep Running".into());
    let engine = PolicyEngine::new(&config.policy).unwrap();
    assert_eq!(engine.classify_command(command).decision, Decision::Allow);
    assert_eq!(
        engine
            .classify_command(&(command.to_owned() + "; echo extra"))
            .decision,
        Decision::Deny
    );
}

#[test]
fn marker_can_be_split_at_every_byte_boundary() {
    let input = "echoed command\r\nBEGIN_test\r\nhello\r\nEND_test 7\r\nprompt$";
    for split in 0..input.len() {
        let mut parser = MarkerParser::new("BEGIN_test".into(), "END_test".into());
        let (first, a) = parser.feed(&input[..split]);
        let (second, b) = parser.feed(&input[split..]);
        assert_eq!(a.or(b), Some(7), "split={split}");
        assert_eq!(first + &second, "hello\n", "split={split}");
    }
}

#[test]
fn echoed_marker_does_not_complete_a_command() {
    let mut parser = MarkerParser::new("BEGIN_test".into(), "END_test".into());
    assert_eq!(
        parser.feed("printf 'BEGIN_test'; echo 'END_test 0'\n").1,
        None
    );
    assert_eq!(parser.feed("BEGIN_test\nnormal\nEND_test nope\n").1, None);
}

#[test]
fn client_profile_delegates_risk_without_treating_search_data_as_commands() {
    let config = Config::default();
    assert_eq!(config.policy.mode, "client");
    let policy = PolicyEngine::new(&config.policy).unwrap();
    for text in [
        "grep 'deny' nginx.conf",
        "grep 'shutdown' nginx.conf",
        "systemctl stop test-only",
        "rm -rf /tmp/FAKE-TEST",
    ] {
        assert_eq!(
            policy.classify_command(text).decision,
            Decision::Allow,
            "{text}"
        );
    }
    assert_eq!(
        policy.classify_command("\u{3}uname").decision,
        Decision::Deny
    );
}

#[test]
fn legacy_guardrails_match_command_positions_not_grep_operands() {
    let mut config = Config::default();
    config.policy.mode = "unrestricted".into();
    let policy = PolicyEngine::new(&config.policy).unwrap();
    for text in [
        "grep 'deny' nginx.conf",
        "grep 'shutdown' nginx.conf",
        "grep deny nginx.conf",
        "systemctl status nginx",
    ] {
        assert_eq!(
            policy.classify_command(text).decision,
            Decision::Allow,
            "{text}"
        );
    }
    assert_eq!(
        policy.classify_command("systemctl stop test-only").decision,
        Decision::Deny
    );
    config.policy.mode = "client".into();
    config.policy.custom_deny_patterns.push("deny".into());
    let denied = PolicyEngine::new(&config.policy)
        .unwrap()
        .classify_command("grep deny nginx.conf");
    assert_eq!(denied.decision, Decision::Deny);
    assert!(denied.reason.contains("custom_deny_rule[0]"));
}

#[test]
fn timed_out_partial_output_is_not_discarded() {
    let mut parser = MarkerParser::new("BEGIN".into(), "END".into());
    assert_eq!(parser.feed("BEGIN\npartial-without-newline").0, "");
    assert_eq!(parser.drain_partial(), "partial-without-newline");
    assert_eq!(parser.drain_partial(), "");
}

// Incorporated into Rust regression.rs during this development pass.
#[test]
fn critical_scope_allows_auth_config_backup_but_not_replacement() {
    use crate::critical::is_critical;
    assert!(!is_critical(
        "cp /etc/ssh/sshd_config /tmp/sshd_config.backup"
    ));
    assert!(is_critical("cp /tmp/new-config /etc/ssh/sshd_config"));
    assert!(is_critical("rm -rf /tmp/../"));
    assert!(is_critical("rm -rf /etc/ssh/../sudoers"));
    assert!(!is_critical("rm -rf /root/test-dir"));
}
