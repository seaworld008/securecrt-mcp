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


## Audit durability / 审计持久化时机

`audit.durability = "os_buffered"` is the default for configurations omitting this new field. The append handle is reused and each write is flushed to the operating system before dispatch; write/open failures still reject before sending. It does **not** fsync every event and may lose recent audit records on OS crash/power loss. Choose `"each_event"` to restore synchronous event durability, accepting local disk latency. This is a durability/performance choice, not a change to client permissions. Configure it explicitly when upgrading under an existing audit-compliance requirement. Log rotation that replaces the file requires restarting the MCP/daemon to reopen the handle; copy-truncate retains the handle but has the usual rotation races.

默认省略新字段时使用操作系统缓冲，减少每次审计打开文件和同步刷盘的开销；这不保证断电时最近审计记录仍在磁盘。要求逐事件落盘时显式设置 `durability = "each_event"`。命令结果的 `timing.audit_dispatch_us` 用于区分审计开销和 Bridge/远端耗时。

After an owned completion marker, the attachment waits briefly for the original prompt/input column rather than adopting a marker line as a new prompt. A changed prompt (including `cd` that changes prompt text), partially typed command, or uncertain input context requires explicit inspection/re-attachment; it is not silently trusted.
