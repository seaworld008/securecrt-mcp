# Documentation map

[简体中文](README.md) · [English](README.en.md) · [English overview](../README.en.md)

Start with your intent. This map links the complete English overview, installation, usage and client guides. The setup prompt is bilingual; maintenance guidance remains in English, and some detailed operational/evidence documents are currently in Chinese.

| I want to… | Read |
| --- | --- |
| Decide whether this fits my platform | [Overview](../README.en.md), [support matrix](support-matrix.md), [runtime support policy](support-policy.md) |
| Install and connect an AI client | [Copy a setup prompt](agent-setup.md#english-prompt) → [installation](installation.en.md) → [Codex](clients/codex.en.md) ([中文](clients/codex.md)) or [Claude Code / Desktop](clients/claude.en.md) |
| Use sessions daily | [Agent workflow](agent-usage.en.md), [connector tools](connectors.md), [persistent terminals](persistent-terminal.md), [CLI / JS / PowerShell](clients/command-line.md) |
| Upgrade an existing setup | [Installation: Upgrade](installation.en.md#upgrade), [troubleshooting](troubleshooting.md); retain policy/token and reload the bridge |
| Diagnose a problem | [Troubleshooting](troubleshooting.md), [support policy](support-policy.md), [API compatibility](api-compatibility.md) |
| Understand security or report a vulnerability | [Security model](security-model.md), [security reporting](../SECURITY.md) |
| Understand interfaces and architecture | [Connector contract](connectors.md), [connector architecture](connector-architecture.md), [architecture](architecture.md), [bridge protocol](bridge-protocol.md), [vendor references](references.md) |
| Develop or run automated tests | [Contributing](../CONTRIBUTING.md) → [Agent maintenance](agent-maintenance.md) → [testing](testing.md); root `AGENTS.md` is the repository guide |
| Verify an actual desktop | [Acceptance rules](desktop-acceptance.md), [test cases](desktop-test-cases.md), [Mac test prompt](mac-securecrt-test-prompt.md), [support evidence](support-matrix.md) |
| Maintain a release | [Agent maintenance: release boundary](agent-maintenance.md#commit-and-release-boundaries), [release process](releases.md), [changelog](../CHANGELOG.md) |
| Read performance or historical decisions | [Performance](performance.md), [readiness evidence](production-readiness.md), [0.2 migration](migration-0.2.md), [0.3 migration](migration-0.3.md); `releases/`, `plans/`, `superpowers/` contain historical records |

## Reading order for Agents

**Setup:** overview → [Agent setup](agent-setup.md#english-prompt) → [installation](installation.en.md) → selected client guide → [Agent usage](agent-usage.en.md). Inspect the selected package's own docs and source before applying current-main instructions.

**Development/maintenance:** root `AGENTS.md` → [contributing](../CONTRIBUTING.md) → [Agent maintenance](agent-maintenance.md) → relevant architecture/contract → [testing](testing.md) → applicable acceptance/release rules.

The published v0.5.2 source predates the current installer. [Installation](installation.en.md) records the release source, current-main build and CI artifact checks. Historical receipts certify only their recorded source, hashes and environment, not current main or every compatible-looking device.
