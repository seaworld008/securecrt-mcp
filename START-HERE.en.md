# Windows: start here

[简体中文](START-HERE.md) · [Full installation guide](docs/installation.en.md)

For Windows bundles containing the `.cmd` launchers below. Verify the package source and accompanying SHA-256, then **extract the entire ZIP** to a stable directory. Install SecureCRT or Xshell and an MCP client separately. End users do not need Rust, Node or Python, or to provide SSH passwords again. This bundle contains the MCP tool, not terminal applications or licenses.

## First use with Codex

1. Double-click **`install.cmd`** as the Windows account normally running your client and terminal; do not choose Run as administrator unnecessarily. It installs into the user directory and adds the Codex entry while preserving other settings. The window stays open with results and script paths. Continue after `Local installation checked`. The default application directory is `%USERPROFILE%\.securecrt-mcp`. These local checks do not require a running bridge.
2. Open your terminal and log into your own test server. Wait for an idle shell prompt; password prompts, running commands and editors are not idle shells.
3. Double-click **`show-paths.cmd`** and load the indicated file **inside the terminal**. Do not double-click `.js` in Explorer or start a separate `/SCRIPT` window instead of the authenticated tab.
4. Reload Codex MCP, restarting Codex if needed. Confirm that the `securecrt` service and tools such as `connector_list` appear. The client starts the MCP server automatically; do not launch the EXE manually or keep a separate `serve` window open.
5. Run **`check-securecrt.cmd`** or **`check-xshell.cmd`** for the application you use. Load and check both separately when using both. Diagnostics alone do not prove command execution; some capabilities need observed API calls, as described below.
6. Authorize one harmless test on a named idle test tab. Use the prompt below with the correct application/tab name. Review client approvals, then verify the marker, `completed`, `sent=true` and exit code `0`. If the outcome is uncertain, inspect the original tab; do not replay automatically.

| Terminal | Menu | File shown by `paths` |
| --- | --- | --- |
| SecureCRT | Script → Run | `bridge_script`: `securecrt-mcp-securecrt.js` |
| Xshell | Tools → Script → Run Script | `xshell_installed_script`: `securecrt-mcp-xshell.js` |

```text
List sessions through securecrt MCP and select only [application / test tab name].
I confirm this tab is connected and idle, and authorize one printf 'MCP_TEST_OK\n'.
Read the prompt first, then send once and verify output, state and exit code.
Stop on ambiguous targets, prompt mismatch or unknown outcome. Do not replay or send Ctrl+C.
```

Load one script per SecureCRT process for its connected tabs. Do not assume one Xshell script covers every window or tab: use actual `connector_list` results. For another intended idle tab, load its script and rediscover. Do not repeatedly cancel/reload a running bridge.

## Later use

Install once. While the terminal and script remain open, rediscover sessions through your AI client. Closing the terminal stops the script; after your next login, load it again through the menu. A running MCP server does not imply a running terminal bridge. Keep the authenticated terminal open.

## Claude or another MCP client only

Run **`initialize-only.cmd` instead of `install.cmd`**. It does not write Codex configuration. Keep the extracted directory at a stable path and follow the [Claude guide](docs/clients/claude.en.md): absolute EXE path, `serve` argument and the same application directory reported by `paths`. Other clients also use stdio. Then load the terminal script, reload your client and verify as above. This route does not automatically configure all clients.

## Troubleshooting and upgrades

| Symptom | Action |
| --- | --- |
| Installation fails | Keep the error and confirm complete extraction. If the old EXE is locked, stop its MCP client before upgrading; preserve SSH logins. Do not use `init --force`. |
| `Terminal bridge is not running` | Run the correct `.js` through the authenticated terminal's menu. Installation does not load native scripts. |
| `unknown_apis` or non-tier_1 support | Read the reasons. Methods not yet called may be unknown; if this is the only issue, use the explicitly authorized single test above, then diagnose again. Resolve missing APIs, script errors or identity mismatches first. Unknown/tier_2 is not full certification. |
| Diagnostics work but AI tools are absent | Reload the client/MCP; check account and configuration location. Existing tool restrictions and approvals remain in effect. |
| Tools appear but the desired tab does not | Check connection state, application/window and actual bridge scope, then rediscover. |
| Custom home cannot find the bridge | Launchers respect inherited `SECURECRT_MCP_HOME`; they do not reset it. Terminal and AI client must use the same directory. An already running terminal does not inherit later environment changes. See [application directory](docs/installation.en.md#2-choose-the-application-directory-and-client). |

For upgrades, wait until the intended terminal is idle and previous work is resolved, stop the MCP client, and run the new package installer. Cancel the old terminal script (in SecureCRT, return to its original tab), load the new entry, then restart the client and check. Preserve configuration, tokens, logins and the old package. Updating files does not reload running bridges.

Share only versions, errors, exit codes and sanitized results when reporting issues, not tokens, server details, screen history or private configuration. See [Agent workflow](docs/agent-usage.en.md) for further usage.
