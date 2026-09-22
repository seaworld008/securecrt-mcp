> **0.3.0 update:** Continuous diagnostics should use the persistent terminal workflow: [attach / exec / batch / daemon](../persistent-terminal.md). Client permissions remain operator-owned; client mode now includes the narrow catastrophic guard. The earlier one-call API remains compatible. New installs generate the terminal tool preset; existing configuration is never silently replaced.

> **0.3.0 update:** New installs use `client` policy (client-owned command authorization); upgrades preserve old settings. `run_command` is the preferred orchestration tool; low-level protocol-2 tools remain. See [Agent usage](../agent-usage.md). Earlier preview approval/default-policy examples below are historical, not a change to existing settings. Actual desktop approval behavior still requires local acceptance.

# Codex integration

Use `securecrt-mcp codex-config` to print additive TOML with the binary's real absolute path. Merge it into your existing configuration; never overwrite other model/plugin settings. All tools default to prompt; explicitly read-only tools have approve overrides.

See the official MCP configuration documentation: https://developers.openai.com/codex/mcp/ . The installed client must support the keys. Tool annotations are hints, not proof of authorization.

Before production, request a harmless unique command and **reject** it in the actual client's approval UI. Verify zero terminal input and no dispatch_attempt for that operation. Then use a new operation ID and explicitly allow it, verifying one dispatch. CI validates configuration/metadata but cannot attest a real client's human rejection.

[Migration](../migration-0.2.md) · [Test layers](../testing.md)
