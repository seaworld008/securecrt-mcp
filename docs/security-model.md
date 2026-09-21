# Security model and deliberate limits

This is privileged automation of already authenticated terminals. The connector is not an SSH sandbox or an independent AI authorization service.

## Default client policy

Client mode accepts routine commands and delegates their risk/approval decisions to the MCP client and remote accounts. A narrow catastrophic mistake guard still checks literal command positions/targets: root/protected top-level deletion, common disk format/write targets, shutdown/reboot and firewall flush, plus selected SSH/sudo configuration mutations. Quoted search text is not treated as an executed command. Ordinary test-file deletion and routine service work are not blocked merely by their command names.

The guard is intentionally not a complete shell parser, mount-point inventory, alias expansion or arbitrary-program analysis. Indirection, scripts, symlinks, dynamic variables, redirects and raw interactive input may evade it. Do not describe it as guaranteed protection from every destructive command. It does not override server-side privileges or attest client approval.

User custom_deny_patterns still run; legacy safe/allowlist/unrestricted modes remain opt-in. Upgrades preserve existing configuration. Narrow allow patterns do not override the catastrophic guard. policy-check reports effective mode/path/reason without connecting to SSH.

## Attachments and ownership

An attachment authorizes no commands. Each exec/batch/write tool is non-read-only and potentially destructive for client approval purposes. Batch approval includes every listed command; it is not a promise of a separate dialog for every child command.

shared/exclusive/observe apply to cooperating connector instances. Exclusive prevents other identified connector owners from writing, but is not a SecureCRT keyboard/paste/UI lock. Input changes are sampled; activity between samples can go undetected. Configured host/user and their hash cannot authenticate the current nested SSH target. authenticated_host_fingerprint is null rather than fabricated.

Raw input is explicitly opt-in. Raw fragments, REPL instructions and editor keys cannot be constrained by a whole-command filter. Operators enabling allow_raw_send accept this lower-level capability and must configure client approval appropriately.

## Transport and storage

Bridge and optional daemon bind only127.0.0.1, use random local tokens and bounded UTF-8 NDJSON frames. Never forward these ports onto a LAN. Persistent connections require per-frame credentials/IDs/deadlines; failed exchanges are never replayed. Daemon identity files use private Unix permissions and inherited Windows user-profile ACLs; no custom Windows ACL guarantee is claimed. Same-user malware/token theft is outside the boundary.

Audit failure before sending rejects the dispatch. Terminal output and command arguments may contain secrets; command text audit is off by default. Output/ledger limits prevent unbounded retained caches, but native SecureCRT may allocate a large ReadString before Python can inspect it. Stream gaps are reported, not hidden as complete output. Avoid public log/diagnostic uploads containing secrets.

## Recovery

Unknown is not unsent. No automatic Ctrl+C, automatic acknowledge or unknown-command replay. Stale attachment must not be rebound to another same-named tab. Explicit close only releases capture and may leave remote work running. A completed POSIX marker does not prove background descendants terminated. Engine restart loses non-durable state; inspect the native terminal before reconnecting workflows.

An explicit stale daemon cleanup only removes a refused local endpoint file. It never certifies remote idleness, clears adapter interlocks or recovers exactly-once results.

Report security issues using [SECURITY.md](../SECURITY.md).
