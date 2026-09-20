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

### Safe policy mode

The default `safe` mode allows a deliberately narrow set of read-oriented SRE commands. Unknown commands are denied rather than guessed safe.

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

In safe mode the project rejects common composition primitives such as `;`, `&&`, `||`, pipes, redirections, command substitution, and multiline input. This is intentionally restrictive because an allowed read command can otherwise be chained into a write command.

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

Allows commands that do not match the hard deny set. This is not equivalent to a secure sandbox. Do not use it as a default on production sessions.

## Production recommendations

- Start with `observe`, then move to `safe` after validation.
- Keep `allow_raw_send = false`.
- Add narrow custom allow patterns for known internal diagnostic scripts instead of broad shell access.
- Keep the bridge on `127.0.0.1`.
- Protect the local user account and SecureCRT session locking.
- Review `audit.jsonl` during early deployment.
- Use separate SecureCRT windows or OS accounts for environments with very different privilege levels.
- Never rely on the MCP policy as the only production authorization boundary; continue using least-privilege SSH accounts, sudo policy, Kubernetes RBAC, database roles, and network controls.

## Reporting security issues

Do not open a public issue for a vulnerability that could expose SecureCRT sessions or bypass policy. Follow [SECURITY.md](../SECURITY.md).
