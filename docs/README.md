# Documentation map / 文档地图

[English overview](../README.md) · [中文入口](../README.zh-CN.md)

Start with your intent. The setup and maintenance guides below are in English; the setup prompt is available in English and Chinese. Some detailed operational/evidence documents are currently in Chinese.

| I want to… / 目标 | Read |
| --- | --- |
| Decide whether this fits my platform | [Overview](../README.md), [support matrix](support-matrix.md), [runtime support policy](support-policy.md) |
| Install and connect an AI client / 安装 | [Copy a setup prompt](agent-setup.md) → [installation](installation.md) → [Codex](clients/codex.en.md) ([中文](clients/codex.md)) or [Claude Code / Desktop](clients/claude.md) |
| Use sessions daily / 日常使用 | [Agent workflow](agent-usage.md), [connector tools](connectors.md), [persistent terminals](persistent-terminal.md), [CLI / JS / PowerShell](clients/command-line.md) |
| Upgrade an existing setup / 升级 | [Installation: Upgrade](installation.md#upgrade), [troubleshooting](troubleshooting.md); retain policy/token and reload the bridge |
| Diagnose a problem / 排障 | [Troubleshooting](troubleshooting.md), [support policy](support-policy.md), [API compatibility](api-compatibility.md) |
| Understand security or report a vulnerability | [Security model](security-model.md), [security reporting](../SECURITY.md) |
| Understand interfaces and architecture | [Connector contract](connectors.md), [connector architecture](connector-architecture.md), [architecture](architecture.md), [bridge protocol](bridge-protocol.md), [vendor references](references.md) |
| Develop or run automated tests / 开发测试 | [Contributing](../CONTRIBUTING.md) → [Agent maintenance](agent-maintenance.md) → [testing](testing.md); root `AGENTS.md` is the repository guide |
| Verify an actual desktop / 真机验收 | [Acceptance rules](desktop-acceptance.md), [test cases](desktop-test-cases.md), [Mac test prompt](mac-securecrt-test-prompt.md), [support evidence](support-matrix.md) |
| Maintain a release / 发布维护 | [Agent maintenance: release boundary](agent-maintenance.md#commit-and-release-boundaries), [release process](releases.md), [changelog](../CHANGELOG.md) |
| Read performance or historical decisions | [Performance](performance.md), [readiness evidence](production-readiness.md), [0.2 migration](migration-0.2.md), [0.3 migration](migration-0.3.md); `releases/`, `plans/`, `superpowers/` contain historical records |

## Reading order for Agents

**Setup:** overview → [Agent setup](agent-setup.md) → [installation](installation.md) → selected client guide → [Agent usage](agent-usage.md). Inspect the selected package's own docs and source before applying current-main instructions.

**Development/maintenance:** root `AGENTS.md` → [contributing](../CONTRIBUTING.md) → [Agent maintenance](agent-maintenance.md) → relevant architecture/contract → [testing](testing.md) → applicable acceptance/release rules.

The published v0.5.2 source predates the current installer. [Installation](installation.md) records the release source, current-main build and CI artifact checks. Historical receipts certify only their recorded source, hashes and environment, not current main or every compatible-looking device.
