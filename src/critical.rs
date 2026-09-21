//! Narrow mistake guard, NOT a shell parser or authorization sandbox.
//! Inspect command positions, not quoted grep arguments. Aliases/dynamic scripts may evade it.
#[derive(Default)]
struct Word {
    text: String,
}
fn segments(input: &str) -> Vec<Vec<String>> {
    let mut result = Vec::new();
    let mut words = Vec::new();
    let mut word = Word::default();
    let mut quote = None;
    let mut escape = false;
    for c in input.chars() {
        if escape {
            word.text.push(c);
            escape = false;
            continue;
        }
        if c == '\\' && quote != Some('\'') {
            escape = true;
            continue;
        }
        if let Some(q) = quote {
            if c == q {
                quote = None;
            } else {
                word.text.push(c);
            }
            continue;
        }
        if c == '\'' || c == '"' {
            quote = Some(c);
            continue;
        }
        if c.is_whitespace() || ";|&()".contains(c) {
            if !word.text.is_empty() {
                words.push(std::mem::take(&mut word.text));
            }
            if !c.is_whitespace() && !words.is_empty() {
                result.push(std::mem::take(&mut words));
            }
        } else {
            word.text.push(c);
        }
    }
    if !word.text.is_empty() {
        words.push(word.text);
    }
    if !words.is_empty() {
        result.push(words);
    }
    result
}
fn normalized(path: &str) -> String {
    if !path.starts_with('/') {
        return path.into();
    }
    let mut parts = Vec::new();
    for p in path.split('/') {
        match p {
            "" | "." => {}
            ".." => {
                parts.pop();
            }
            _ => parts.push(p),
        }
    }
    format!("/{}", parts.join("/"))
}
fn authentication_target(path: &str) -> bool {
    let p = normalized(path);
    p == "/etc/ssh" || p.starts_with("/etc/ssh/") || p.starts_with("/etc/sudoers")
}
fn protected(path: &str) -> bool {
    let normalized = normalized(path);
    let path = normalized.trim_end_matches('/');
    path.is_empty()
        || [
            "/*", "/.*", "/bin", "/sbin", "/usr", "/lib", "/lib64", "/boot", "/etc", "/dev",
            "/proc", "/sys", "/home", "/root", "/var", "/mnt", "/media",
        ]
        .contains(&path)
        || path.starts_with("/dev/")
        || path.starts_with("/etc/ssh/")
        || path.starts_with("/etc/sudoers")
}
fn check(input: &str, depth: usize) -> bool {
    if depth > 4 {
        return false;
    }
    for mut words in segments(input) {
        while words
            .first()
            .is_some_and(|s| s.contains('=') && !s.starts_with('/'))
        {
            words.remove(0);
        }
        loop {
            let Some(first) = words.first() else {
                break;
            };
            let cmd = first.rsplit('/').next().unwrap_or(first);
            if !["sudo", "command", "env", "nohup"].contains(&cmd) {
                break;
            }
            words.remove(0);
            while words
                .first()
                .is_some_and(|s| s.starts_with('-') || s.contains('='))
            {
                let option = words.remove(0);
                if ["-u", "-g", "-h", "--user", "--group"].contains(&option.as_str())
                    && !words.is_empty()
                {
                    words.remove(0);
                }
            }
        }
        let Some(first) = words.first() else {
            continue;
        };
        let cmd = first.rsplit('/').next().unwrap_or(first);
        let a = &words[1..];
        if ["sh", "bash", "dash", "zsh"].contains(&cmd) {
            if let Some(i) = a.iter().position(|v| v == "-c" || v == "-lc") {
                if a.get(i + 1).is_some_and(|s| check(s, depth + 1)) {
                    return true;
                }
            }
        }
        if cmd == "rm" && a.iter().any(|s| !s.starts_with('-') && protected(s)) {
            return true;
        }
        if cmd.starts_with("mkfs")
            || [
                "wipefs", "shred", "fdisk", "parted", "shutdown", "reboot", "poweroff", "halt",
            ]
            .contains(&cmd)
        {
            return true;
        }
        if cmd == "dd"
            && a.iter()
                .any(|s| s.strip_prefix("of=").is_some_and(protected))
        {
            return true;
        }
        if ["iptables", "ip6tables"].contains(&cmd)
            && a.iter()
                .any(|s| ["-F", "--flush", "-X", "--delete-chain"].contains(&s.as_str()))
        {
            return true;
        }
        if cmd == "nft" && a.windows(2).any(|p| p == ["flush", "ruleset"]) {
            return true;
        }
        if ["cp", "install"].contains(&cmd) {
            let destination = a
                .windows(2)
                .find(|p| p[0] == "-t" || p[0] == "--target-directory")
                .map(|p| p[1].as_str())
                .or_else(|| a.last().map(String::as_str));
            if destination.is_some_and(authentication_target) {
                return true;
            }
        }
        if ["tee", "truncate", "mv"].contains(&cmd) && a.iter().any(|s| authentication_target(s)) {
            return true;
        }
    }
    false
}
pub fn is_critical(command: &str) -> bool {
    check(command, 0)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn ordinary_crud_and_search_text_are_not_critical() {
        for s in [
            "rm -f /root/test.txt",
            "rm -rf /root/test-dir",
            "grep 'shutdown' nginx.conf",
            "grep deny nginx.conf",
            "grep 'rm -rf /' test.log",
            "systemctl restart nginx",
            "iptables -L -n",
            "dd if=/tmp/a of=/tmp/b",
            "docker exec api sh -c 'ls /tmp'",
            "printf '%s' 'reboot'",
            "cat /etc/ssh/sshd_config",
        ] {
            assert!(!is_critical(s), "{s}");
        }
    }
    #[test]
    fn critical_positions_and_common_wrappers_are_detected() {
        for s in [
            "rm -rf /",
            "rm -rf /*",
            "/bin/rm -- /etc",
            "sudo rm -rf /",
            "sudo -u root /bin/rm -rf /",
            "echo ready; rm -rf /",
            "env A=x sh -c 'rm -rf /'",
            "mkfs.ext4 /dev/sda",
            "dd if=/tmp/x of=/dev/sda",
            "iptables -F",
            "nft flush ruleset",
            "reboot",
            "rm -rf /etc/ssh/sshd_config",
        ] {
            assert!(is_critical(s), "{s}");
        }
    }
}
