use crate::config::PolicyConfig;
use anyhow::{Context, Result};
use regex::Regex;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Decision {
    Allow,
    Deny,
}

#[derive(Debug, Clone)]
pub struct PolicyDecision {
    pub decision: Decision,
    pub reason: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Mode {
    Observe,
    Safe,
    Allowlist,
    Unrestricted,
}

#[derive(Clone)]
pub struct PolicyEngine {
    mode: Mode,
    allow_raw_send: bool,
    allow_interrupt: bool,
    safe_patterns: Vec<Regex>,
    custom_allow_patterns: Vec<Regex>,
    deny_patterns: Vec<Regex>,
}

impl PolicyEngine {
    pub fn new(config: &PolicyConfig) -> Result<Self> {
        let mode = match config.mode.to_ascii_lowercase().as_str() {
            "observe" => Mode::Observe,
            "safe" => Mode::Safe,
            "allowlist" => Mode::Allowlist,
            "unrestricted" => Mode::Unrestricted,
            other => anyhow::bail!(
                "unsupported policy mode `{other}`; expected observe, safe, allowlist, or unrestricted"
            ),
        };

        Ok(Self {
            mode,
            allow_raw_send: config.allow_raw_send,
            allow_interrupt: config.allow_interrupt,
            safe_patterns: compile_patterns(SAFE_PATTERNS.iter().copied())?,
            custom_allow_patterns: compile_patterns(
                config.custom_allow_patterns.iter().map(String::as_str),
            )?,
            deny_patterns: {
                let mut patterns = compile_patterns(HARD_DENY_PATTERNS.iter().copied())?;
                patterns.extend(compile_patterns(
                    config.custom_deny_patterns.iter().map(String::as_str),
                )?);
                patterns
            },
        })
    }

    pub fn classify_command(&self, command: &str) -> PolicyDecision {
        let trimmed = command.trim();
        if trimmed.is_empty() {
            return deny("empty commands are not allowed");
        }
        if trimmed.len() > 32_768 {
            return deny("command is larger than the 32 KiB policy limit");
        }
        if trimmed.contains('\n') || trimmed.contains('\r') {
            return deny("multi-line commands are blocked; send one command at a time");
        }
        if self.deny_patterns.iter().any(|re| re.is_match(trimmed)) {
            return deny("command matched a deny rule");
        }

        match self.mode {
            Mode::Observe => deny("policy mode is observe; command execution is disabled"),
            Mode::Unrestricted => allow("policy mode is unrestricted and no deny rule matched"),
            Mode::Allowlist => {
                if self.custom_allow_patterns.iter().any(|re| re.is_match(trimmed)) {
                    allow("command matched a configured allow rule")
                } else {
                    deny("command did not match any configured allow rule")
                }
            }
            Mode::Safe => {
                if self.custom_allow_patterns.iter().any(|re| re.is_match(trimmed)) {
                    return allow("command matched an explicit custom allow rule");
                }
                if has_unsafe_shell_control(trimmed) {
                    return deny(
                        "safe mode blocks shell control/redirection operators unless an explicit custom allow rule matches",
                    );
                }
                if self.safe_patterns.iter().any(|re| re.is_match(trimmed)) {
                    allow("command matched a safe/read-oriented allow rule")
                } else {
                    deny("command is not in the safe/read-oriented allowlist")
                }
            }
        }
    }

    pub fn raw_send_allowed(&self) -> bool {
        self.allow_raw_send && self.mode != Mode::Observe
    }

    pub fn interrupt_allowed(&self) -> bool {
        self.allow_interrupt && self.mode != Mode::Observe
    }
}

fn compile_patterns<'a>(patterns: impl IntoIterator<Item = &'a str>) -> Result<Vec<Regex>> {
    patterns
        .into_iter()
        .map(|pattern| {
            Regex::new(pattern).with_context(|| format!("invalid policy regex: {pattern}"))
        })
        .collect()
}

fn has_unsafe_shell_control(command: &str) -> bool {
    // Deliberately conservative. Pipelines/redirection/compound commands can turn an
    // otherwise read-only command into a write or execution primitive.
    [";", "&&", "||", "|", ">", "<", "`", "$(", "${"]
        .iter()
        .any(|token| command.contains(token))
}

fn allow(reason: impl Into<String>) -> PolicyDecision {
    PolicyDecision {
        decision: Decision::Allow,
        reason: reason.into(),
    }
}

fn deny(reason: impl Into<String>) -> PolicyDecision {
    PolicyDecision {
        decision: Decision::Deny,
        reason: reason.into(),
    }
}

const HARD_DENY_PATTERNS: &[&str] = &[
    r"(?i)^\s*(rm|shred|wipefs|mkfs(?:\.[a-z0-9]+)?|fdisk|parted)\b",
    r"(?i)^\s*(reboot|shutdown|poweroff|halt)\b",
    r"(?i)^\s*dd\b",
    r"(?i)^\s*systemctl\s+(restart|stop|start|enable|disable|mask|unmask|daemon-reload)\b",
    r"(?i)^\s*service\s+\S+\s+(restart|stop|start)\b",
    r"(?i)^\s*kubectl\s+(delete|apply|create|replace|patch|edit|scale|cordon|uncordon|drain)\b",
    r"(?i)^\s*kubectl\s+rollout\s+(restart|undo)\b",
    r"(?i)^\s*helm\s+(install|upgrade|uninstall|rollback)\b",
    r"(?i)^\s*(docker|podman)\s+(rm|rmi|kill|restart|stop|start|run|exec|system\s+prune|image\s+prune|container\s+prune|volume\s+prune)\b",
    r"(?i)^\s*(iptables|ip6tables|nft|firewall-cmd|ufw)\b",
    r"(?i)^\s*(passwd|useradd|userdel|usermod|groupadd|groupdel|chown|chmod)\b",
];

const SAFE_PATTERNS: &[&str] = &[
    r"(?i)^\s*(pwd|whoami|hostname|uptime|uname|id)\s*(?:-[a-z0-9-]+\s*)*$",
    r"(?i)^\s*date\s*$",
    r"(?i)^\s*(ls|dir)\b[^;&|><`$]*$",
    r"(?i)^\s*(df|du|free|vmstat|iostat|mpstat|sar)\b[^;&|><`$]*$",
    r"(?i)^\s*(ps|pstree|pgrep)\b[^;&|><`$]*$",
    r"(?i)^\s*(ss|netstat|lsof)\b[^;&|><`$]*$",
    r"(?i)^\s*ip\s+(addr|address|a|link|route|r|neigh|neighbor)\b[^;&|><`$]*$",
    r"(?i)^\s*(cat|head|tail|grep|egrep|fgrep|wc|stat)\b[^;&|><`$]*$",
    r"(?i)^\s*journalctl\b[^;&|><`$]*$",
    r"(?i)^\s*dmesg\b[^;&|><`$]*$",
    r"(?i)^\s*systemctl\s+(status|show|is-active|is-enabled|list-units|list-unit-files)\b[^;&|><`$]*$",
    r"(?i)^\s*(docker|podman)\s+(ps|logs|stats|inspect|images|info|version)\b[^;&|><`$]*$",
    r"(?i)^\s*kubectl\s+(get|describe|logs|top|api-resources|api-versions|cluster-info|version|explain)\b[^;&|><`$]*$",
    r"(?i)^\s*kubectl\s+auth\s+can-i\b[^;&|><`$]*$",
    r"(?i)^\s*helm\s+(list|status|history|get|show|version)\b[^;&|><`$]*$",
    r"(?i)^\s*helm\s+repo\s+list\b[^;&|><`$]*$",
    r"(?i)^\s*git\s+(status|log|diff|show|branch|remote\s+-v)\b[^;&|><`$]*$",
    r#"(?i)^\s*mysql\b[^;&|><`$]*\s-e\s+["']?\s*(show|select|explain|desc|describe)\b[^;&|><`$]*$"#,
    r"(?i)^\s*redis-cli\b[^;&|><`$]*\s+(ping|info|dbsize|role|client\s+list|slowlog\s+get|memory\s+stats|scan|get|mget|ttl|pttl|type|exists)\b[^;&|><`$]*$",
];

#[cfg(test)]
mod tests {
    use super::*;

    fn engine() -> PolicyEngine {
        PolicyEngine::new(&PolicyConfig::default()).expect("policy")
    }

    #[test]
    fn allows_read_only_kubectl() {
        assert_eq!(
            engine().classify_command("kubectl get pods -A").decision,
            Decision::Allow
        );
    }

    #[test]
    fn denies_destructive_kubectl() {
        assert_eq!(
            engine()
                .classify_command("kubectl delete pod nginx")
                .decision,
            Decision::Deny
        );
    }

    #[test]
    fn safe_mode_denies_shell_chaining() {
        assert_eq!(
            engine()
                .classify_command("kubectl get pods; rm -rf /tmp/x")
                .decision,
            Decision::Deny
        );
    }

    #[test]
    fn explicit_custom_allow_can_permit_a_reviewed_pipeline() {
        let mut config = PolicyConfig::default();
        config.custom_allow_patterns = vec![
            r"^kubectl get pods -A \| grep Running$".to_owned(),
        ];
        let policy = PolicyEngine::new(&config).expect("policy");
        assert_eq!(
            policy
                .classify_command("kubectl get pods -A | grep Running")
                .decision,
            Decision::Allow
        );
    }

    #[test]
    fn raw_send_is_off_by_default() {
        assert!(!engine().raw_send_allowed());
    }
}
