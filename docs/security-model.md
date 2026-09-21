> **0.2.0-preview.2 update:** New installs use `client` policy (client-owned command authorization); upgrades preserve old settings. `run_command` is the preferred orchestration tool; low-level protocol-2 tools remain. See [Agent usage](agent-usage.md). Earlier preview.1 approval/default-policy examples below are historical, not a change to existing settings. Actual desktop approval behavior is not certified by CI.

# Security model and non-guarantees

The server is privileged local automation for already authenticated terminals, not an SSH sandbox. Anyone controlling the local user account or bridge token can bypass Rust-side policy. Do not expose the port through LAN listeners, port forwarding, proxies or containers. Keep config/token/backups/audit private; never commit them.

## Authorization

The existing unrestricted default is preserved deliberately. It passes ordinary single-line commands after basic validation and convenience dangerous-command filters. Anchored deny patterns do not parse shell wrappers, scripts, aliases, sudo or compound commands. They are not a complete security boundary.

Observe disables command execution/raw input/interrupt. Safe permits a narrow finite grammar of known arguments; unsupported forms are rejected. It still cannot constrain remote aliases, configured credential plugins, executable behavior, secret-bearing output or resource consumption. Allowlist accepts full-command administrator expressions; they are explicit trusted exceptions, including any shell syntax they allow. Raw input is opt-in and bypasses command classification.

Actual access control belongs to SSH users, sudo, Kubernetes RBAC, database roles, network controls and verified client approval. MCP annotations are hints. There is no `approved=true` argument and no claim that this server can attest a GUI approval in an arbitrary MCP client. Use generated Codex configuration on a supporting client and perform the rejection test before production.

## Preventing operational mistakes

Opaque short-lived session handles retain native Tab objects. Screen tokens and explicit expected input lines are required before sends. An observed disconnect/config change invalidates a handle; rapid reconnects between observations and nested SSH transitions cannot be proven from the available APIs. A prompt can be spoofed. Inspect target and account, and avoid shared typing while an AI command runs.

An uncertain/timed-out/cancelled command blocks new sends until explicit idle acknowledgement. No automatic retries or implicit interrupts. Ctrl+C does not prove process termination. POSIX completion markers attest only that the wrapper reached a boundary, not that background work stopped or an untrusted remote is honest.

## Audit and resource bounds

Audit failure before dispatch prevents input; post-dispatch audit failure is reported alongside the result, never converted into a claim of nonexecution. Default logs store command hashes, event IDs and outcomes, not raw command text. Hashes are not encryption; deliberately low-entropy commands can be guessed. Enabling raw text logging may expose secrets. Logs are local, not tamper-evident or remotely replicated.

Frames are bounded during Rust reads; Python also bounds incoming frames and outgoing chunks. Native capture may itself allocate a large chunk before the adapter can trim it, so this is not a memory sandbox around SecureCRT. The output cache and operation ledger are bounded. Linux/macOS initialization restricts the application directory; Windows relies on current-user profile ACLs. Stronger custom ACL enforcement and anti-malware protection are not claimed.

See [SECURITY.md](../SECURITY.md) for private reporting. Never use real secrets or production data in public bug reports.
