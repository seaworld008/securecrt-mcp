use crate::config::PolicyConfig;
use anyhow::{Context, Result, ensure};
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
#[derive(Clone)]
pub struct PolicyEngine {
    mode: String,
    raw: bool,
    interrupt: bool,
    allow: Vec<Regex>,
    deny: Vec<Regex>,
}

impl PolicyEngine {
    pub fn new(config: &PolicyConfig) -> Result<Self> {
        let mode = config.mode.to_ascii_lowercase();
        ensure!(
            ["client", "observe", "safe", "allowlist", "unrestricted"].contains(&mode.as_str()),
            "invalid policy.mode"
        );
        ensure!(
            config.custom_allow_patterns.len() <= 128 && config.custom_deny_patterns.len() <= 128,
            "too many policy patterns"
        );
        let compile = |patterns: &[String], full: bool| -> Result<Vec<Regex>> {
            patterns
                .iter()
                .map(|pattern| {
                    ensure!(pattern.len() <= 4096, "policy pattern exceeds 4096 bytes");
                    let pattern = if full {
                        format!(r"\A(?:{pattern})\z")
                    } else {
                        pattern.clone()
                    };
                    Regex::new(&pattern).context("invalid policy regex")
                })
                .collect()
        };
        let deny = compile(&config.custom_deny_patterns, false)?;
        Ok(Self {
            mode,
            raw: config.allow_raw_send,
            interrupt: config.allow_interrupt,
            allow: compile(&config.custom_allow_patterns, true)?,
            deny,
        })
    }

    pub fn classify_command(&self, command: &str) -> PolicyDecision {
        let denied = |reason: &str| PolicyDecision {
            decision: Decision::Deny,
            reason: reason.into(),
        };
        // Validate the original bytes, not a trimmed copy: leading Ctrl+U/CR can alter a terminal.
        if command.len() > 32_768 || command.chars().any(char::is_control) {
            return denied("control/multiline input or command length is not allowed");
        }
        let cmd = command.trim();
        if cmd.is_empty() {
            return denied("empty command");
        }
        if self.mode == "observe" {
            return denied("observe mode disables execution");
        }
        if let Some(index) = self.deny.iter().position(|p| p.is_match(cmd)) {
            return denied(&format!(
                "custom_deny_rule[{index}]: operator-configured pattern matched"
            ));
        }
        if self.mode != "client" {
            for (index, pattern) in HARD_DENY.iter().enumerate() {
                if Regex::new(pattern)
                    .expect("static guardrail regex")
                    .is_match(cmd)
                {
                    return denied(&format!(
                        "builtin_guardrail[{index}]: legacy optional local policy"
                    ));
                }
            }
        }
        let allowed = self.mode == "client"
            || self.mode == "unrestricted"
            || self.allow.iter().any(|p| p.is_match(cmd))
            || (self.mode == "safe" && safe_command(cmd));
        if allowed {
            PolicyDecision {
                decision: Decision::Allow,
                reason:
                    "allowed by local policy; this is not proof of client approval or a sandbox"
                        .into(),
            }
        } else {
            denied("not in the finite safe grammar or an explicit full-command allow rule")
        }
    }

    pub fn raw_send_allowed(&self) -> bool {
        self.raw && self.mode != "observe"
    }
    pub fn interrupt_allowed(&self) -> bool {
        self.interrupt && self.mode != "observe"
    }
}

fn literal(word: &str) -> bool {
    !word.is_empty()
        && !word.starts_with('-')
        && word
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b"_./:=,@%+-".contains(&b))
}

fn options(args: &[&str], flags: &[&str], values: &[&str], positionals: bool) -> bool {
    let mut i = 0;
    while i < args.len() {
        let arg = args[i];
        if flags.contains(&arg) {
            i += 1;
            continue;
        }
        if values.contains(&arg) {
            i += 1;
            if i >= args.len() || !literal(args[i]) {
                return false;
            }
            if ["-n", "--tail"].contains(&arg) && args[i].parse::<u32>().is_ok_and(|n| n > 5000) {
                return false;
            }
        } else if !positionals || !literal(arg) {
            return false;
        }
        i += 1;
    }
    true
}

fn safe_command(command: &str) -> bool {
    // This is deliberately NOT a shell parser. Unknown syntax/options are denied.
    let words: Vec<_> = command.split_ascii_whitespace().collect();
    if words.is_empty() || words.len() > 64 {
        return false;
    }
    let a = &words[1..];
    match words[0] {
        "pwd" | "whoami" | "date" => a.is_empty(),
        "hostname" => options(a, &["-s", "-f", "-I"], &[], false),
        "uname" => options(
            a,
            &["-a", "-s", "-n", "-r", "-v", "-m", "-p", "-i", "-o"],
            &[],
            false,
        ),
        "uptime" => options(a, &["-p", "-s"], &[], false),
        "id" => options(a, &["-u", "-g", "-G", "-n", "-r"], &[], false),
        "free" => options(a, &["-h", "-m", "-g", "-b", "-k", "-w", "-t"], &[], false),
        "df" => options(a, &["-h", "-T", "-i", "-a", "-P"], &[], true),
        "ls" => options(
            a,
            &[
                "-l", "-a", "-la", "-al", "-lh", "-lah", "-alh", "-h", "-d", "-ld", "-ltr",
            ],
            &[],
            true,
        ),
        "ps" => a == ["aux"] || a == ["-ef"],
        "ss" => options(
            a,
            &["-lntp", "-lntup", "-antp", "-tulpn", "-lnt", "-s"],
            &[],
            false,
        ),
        "cat" | "stat" | "wc" => !a.is_empty() && a.iter().all(|w| literal(w)),
        "head" | "tail" => !a.is_empty() && options(a, &[], &["-n"], true),
        "ip" => {
            a.len() >= 2
                && ["addr", "address", "link", "route", "neigh"].contains(&a[0])
                && a[1] == "show"
                && options(&a[2..], &[], &["dev"], true)
        }
        "dmesg" => options(a, &["--ctime", "--human", "--decode"], &[], false),
        "journalctl" => {
            a.contains(&"--no-pager")
                && options(
                    a,
                    &["--no-pager", "--utc", "-b", "-k"],
                    &["-n", "-u", "--since", "--until"],
                    false,
                )
        }
        "systemctl" => {
            !a.is_empty()
                && [
                    "status",
                    "show",
                    "is-active",
                    "is-enabled",
                    "list-units",
                    "list-unit-files",
                ]
                .contains(&a[0])
                && (a[0].starts_with("is-") || a.contains(&"--no-pager"))
                && options(&a[1..], &["--no-pager", "--full", "--all"], &[], true)
        }
        "docker" | "podman" => {
            !a.is_empty()
                && match a[0] {
                    "ps" => options(&a[1..], &["-a", "--no-trunc"], &[], false),
                    "stats" => {
                        a.contains(&"--no-stream") && options(&a[1..], &["--no-stream"], &[], true)
                    }
                    "logs" => options(&a[1..], &["--timestamps"], &["--tail", "--since"], true),
                    "inspect" | "images" | "info" | "version" => options(&a[1..], &[], &[], true),
                    _ => false,
                }
        }
        "kubectl" => {
            !a.is_empty()
                && [
                    "get",
                    "describe",
                    "logs",
                    "top",
                    "version",
                    "api-resources",
                    "api-versions",
                ]
                .contains(&a[0])
                && options(
                    &a[1..],
                    &[
                        "-A",
                        "--all-namespaces",
                        "--previous",
                        "--timestamps",
                        "--no-headers",
                    ],
                    &[
                        "-n",
                        "--namespace",
                        "-c",
                        "--container",
                        "-o",
                        "--output",
                        "--tail",
                        "--since",
                    ],
                    true,
                )
                && a.windows(2).all(|p| {
                    !["-o", "--output"].contains(&p[0])
                        || ["wide", "json", "yaml", "name"].contains(&p[1])
                })
        }
        _ => false,
    }
}

// Convenience mistake filter only. Wrappers/aliases/scripts can evade this in unrestricted mode.
const HARD_DENY: &[&str] = &[
    r"(?i)^\s*(rm|shred|wipefs|mkfs(?:\.[a-z0-9]+)?|fdisk|parted|dd|reboot|shutdown|poweroff|halt)\b",
    r"(?i)^\s*systemctl\s+(restart|stop|start|enable|disable|mask|unmask|daemon-reload)\b",
    r"(?i)^\s*service\s+\S+\s+(restart|stop|start)\b",
    r"(?i)^\s*kubectl\s+(delete|apply|create|replace|patch|edit|scale|cordon|uncordon|drain)\b",
    r"(?i)^\s*kubectl\s+rollout\s+(restart|undo)\b",
    r"(?i)^\s*helm\s+(install|upgrade|uninstall|rollback)\b",
    r"(?i)^\s*(docker|podman)\s+(rm|rmi|kill|restart|stop|start|run|exec|system\s+prune|image\s+prune|container\s+prune|volume\s+prune)\b",
    r"(?i)^\s*(iptables|ip6tables|nft|firewall-cmd|ufw|passwd|useradd|userdel|usermod|groupadd|groupdel|chown|chmod)\b",
];
