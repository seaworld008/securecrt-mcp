# Security model

`securecrt-mcp` should be treated as privileged local automation because it can type into terminals that may already be authenticated to production infrastructure.

## Default protections

### Loopback-only bridge

The SecureCRT bridge is configured for `127.0.0.1` and rejects non-loopback configuration. Do not expose the bridge through port forwarding, containers, LAN listeners, or reverse proxies.

### Random bridge token

`securecrt-mcp init` creates a random token in:

```text
~/.securecrt-mcp/bridge.json
```

Every Rust-to-bridge request must contain the token.

### Default policy mode

The default `unrestricted` mode preserves ordinary commands and scripts so the MCP does not duplicate Codex's approval model. A small hard-deny set still blocks high-impact operations before text is sent to SecureCRT. The remote account, RBAC, and Codex approval remain authoritative.

### Raw text disabled

`securecrt_send_text` is disabled by default. If raw input were enabled, an MCP model could bypass command classification by sending arbitrary keystrokes.

### Audit log

Command attempts and privileged actions are appended to:

```text
~/.securecrt-mcp/audit.jsonl
```

You can disable command text if audit logs might contain sensitive command arguments:

```toml
[audit]
include_command_text = false
```

## Threats considered

### MCP prompt injection

A remote server, log line, README, issue, or terminal output may contain text that tries to persuade an AI agent to execute commands. The local policy engine is independent of model intent and blocks commands outside configured rules.

### Shell composition bypass

In safe mode the project rejects common composition primitives such as `;`, `&&`, `||`, pipes, redirections, command substitution, and multiline input. The default unrestricted mode intentionally leaves ordinary composition to Codex and the remote shell; only the hard-deny patterns are enforced locally.

### Credential duplication

The project does not ask the MCP client for SecureCRT SSH credentials. Existing authenticated SecureCRT tabs are reused.

### Local untrusted processes

A token is still required even though the bridge listens only on loopback. Local malware running as the same user is outside the project's security boundary; OS-level process isolation and endpoint security are still required.

## Policy modes

### observe

No command execution, raw send, or interrupt. Best for initial rollout and monitoring.

### safe

Built-in read-oriented allow rules plus optional custom allow patterns. Recommended default.

### allowlist

Only your custom allow patterns are accepted. Useful for tightly controlled operational runbooks.

### unrestricted

Allows commands that do not match the small hard deny set. This is not equivalent to a secure sandbox; keep Codex approval, least-privilege accounts, and server-side controls enabled.

Optional deny rules

The following patterns are intentionally not enabled by default. Add only the rules that fit the environment to `custom_deny_patterns` when package changes, Git writes, downloads, privilege escalation, or database mutations need an extra local guard:

```toml
custom_deny_patterns = [
  '(?i)^\s*(sudo|su)\b',
  '(?i)^\s*(apt|apt-get|yum|dnf|pip|npm|cargo)\s+(install|remove|update|upgrade)\b',
  '(?i)^\s*git\s+(push|reset|clean|rebase|checkout|switch)\b',
  '(?i)^\s*(curl|wget|aria2c)\b',
  '(?i)^\s*(mysql|psql|sqlite3)\b.*\b(insert|update|delete|drop|alter|truncate)\b'
]
```

## Production recommendations

- The default is `unrestricted` for Codex-controlled use; choose `safe` or `observe` when a stricter rollout is required.
- Keep `allow_raw_send = false`.
- Add narrow custom allow patterns for known internal diagnostic scripts instead of broad shell access.
- Keep the bridge on `127.0.0.1`.
- Protect the local user account and SecureCRT session locking.
- Review `audit.jsonl` during early deployment.
- Use separate SecureCRT windows or OS accounts for environments with very different privilege levels.
- Never rely on the MCP policy as the only production authorization boundary; continue using least-privilege SSH accounts, sudo policy, Kubernetes RBAC, database roles, and network controls.

## Reporting security issues

Do not open a public issue for a vulnerability that could expose SecureCRT sessions or bypass policy. Follow [SECURITY.md](../SECURITY.md).
