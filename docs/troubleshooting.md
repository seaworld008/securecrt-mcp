> **0.3.0 update:** Continuous diagnostics should use the persistent terminal workflow: [attach / exec / batch / daemon](persistent-terminal.md). Client permissions remain operator-owned; client mode now includes the narrow catastrophic guard. The earlier one-call API remains compatible. New installs generate the terminal tool preset; existing configuration is never silently replaced.

> **0.2.0-preview.2 update:** New installs use `client` policy (client-owned command authorization); upgrades preserve old settings. `run_command` is the preferred orchestration tool; low-level protocol-2 tools remain. See [Agent usage](agent-usage.md). Earlier preview.1 approval/default-policy examples below are historical, not a change to existing settings. Actual desktop approval behavior is not certified by CI.

# Troubleshooting

**Protocol/version mismatch:** run `upgrade`, cancel the old script in SecureCRT, then run the installed script again. A file updated on disk does not replace an already running Python script. `doctor --offline` checks files; `doctor` checks the real runtime. Do not use force reset for ordinary mismatch repair.

**Python engine fails to load:** consult VanDyke's compatibility documentation for your SecureCRT version and architecture. The external `python --version` may not match SecureCRT's embedded runtime. Version 9.0 Windows historically required a compatible Python 3.8 installation; that is not a recommendation to deploy an unsupported runtime indefinitely. Do not add Python packages to solve protocol errors; the adapter uses the standard library.

**stale_session:** the lease expired, a disconnect/config change was observed, or its retained native Tab no longer exists. Re-list and inspect; never substitute the current occupant of an old index. Tab captions and configured hosts do not prove nested SSH targets.

**stale_screen / prompt_mismatch:** read the screen again, inspect current input context and use its new Token. Do not automatically acknowledge prompts or fill credentials. Concurrent human typing and asynchronous terminal output can deliberately invalidate freshness.

**busy / unresolved:** a native capture is active or its remote outcome is uncertain. Inspect the tracked command, explicitly interrupt only if appropriate, then inspect and acknowledge idle. No automatic Ctrl+C/retry is performed. If the original Tab is gone, inspect remote state manually before restarting the adapter.

**capture_may_be_incomplete / truncated:** pagination only retrieves retained captured text, not unlimited history. Native timeout slices, TUI rendering and binary output are not guaranteed lossless. Reduce command output, avoid follow/TUI modes, or use an independently approved log-file workflow. Never pretend the visible screen is full command output.

**Audit unavailable:** check the configured parent directory, file permissions and disk space. Enabled auditing fails closed before sends. A post-send warning is not proof the command failed to run.

**Windows build says executable in use:** exit the MCP client holding the old binary before building/replacing it. Leave authenticated SSH tabs intact.

**Multiple SecureCRT windows:** automatic discovery is not implemented. Use separate absolute `SECURECRT_MCP_HOME` directories, distinct localhost ports and separately installed scripts; keep each MCP client entry explicitly associated with its instance. Do not launch identical fixed-port adapters and assume they aggregate sessions.
