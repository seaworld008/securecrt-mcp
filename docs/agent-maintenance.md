# Agent development and maintenance guide

[中文文档地图](README.md) · [English documentation map](README.en.md) · [Contributing](../CONTRIBUTING.md) · [Testing](testing.md)

中文摘要：维护先核对契约与源码，再按改动类型验证。中文主入口与镜像必须字节一致，英文备选保留同等能力和边界。真实 UI、SSH 与客户端审批需独立证据；未测环境明确交接。提交、推送、合并和发布需要对应授权，历史验收与公开资产按其原始来源保留。下方保留跨 Agent 使用的英文维护规则。

Read root `AGENTS.md` → overview → contributing → this guide → relevant contract/source → testing. For installation on a user's machine use [Agent setup](agent-setup.md#english-prompt); for operations use [Agent usage](agent-usage.en.md). Keep detailed procedures in those existing guides.

## Find the authoritative implementation

| Area | Implementation / directory | Contract and checks |
| --- | --- | --- |
| CLI and setup | `src/main.rs`, `src/installation.rs`, `src/config.rs` | [Installation](installation.en.md), client guides, `tests/installation_env_smoke.js` |
| MCP and connector lifecycle | `src/server.rs`, `src/connector.rs`, `src/connector/`, `src/execution.rs`, `src/terminal.rs` | [Connectors](connectors.md), [connector architecture](connector-architecture.md), [Agent workflow](agent-usage.en.md) |
| Native adapters | `bridge/`, `src/portable.rs`, `src/bridge.rs` | [Bridge protocol](bridge-protocol.md), [API compatibility](api-compatibility.md), Windows/portable and Mac adapter tests |
| Policy and audit | `src/policy.rs`, `src/audit.rs`, `src/config.rs` | [Security model](security-model.md); rejection/uncertainty regressions |
| Persistent local calling | `src/daemon.rs`, `src/local_cli.rs`, `clients/` | [Persistent terminals](persistent-terminal.md), [CLI clients](clients/command-line.md) |
| Build, bundle and release | `Cargo.toml`, `scripts/package_release.js`, `scripts/portable_scripts.js`, `scripts/release_gate.js`, `.github/workflows/` | [Testing](testing.md), [release process](releases.md); actual workflows/gates control publication |
| Documentation/support evidence | Root READMEs, `docs/`, `support/`, `scripts/validate_repository.js` | [Support matrix](support-matrix.md), [support policy](support-policy.md), [desktop acceptance](desktop-acceptance.md) |

Check actual filenames before editing; modules may be reorganized. Historical `docs/acceptance/`, `docs/releases/`, `docs/plans/`, `docs/superpowers/` and benchmark reports document their own context, not current acceptance.

## Validation by change type

Documentation-only changes:

```sh
node scripts/validate_repository.js
git diff --check
```

The validator checks version/protocol assertions, the Simplified Chinese README mirror, bilingual navigation and examples, eight-line setup prompts, local links and bilingual guide anchors. Also compare Chinese/English capability and source boundaries, shell/PowerShell/TOML/JSON paths, client-specific scopes and actual CLI definitions. A link existing locally does not prove external availability or GitHub rendering.

For code changes use Rust 1.88+, platform linker and Node 22; Mac adapter contract development also uses Python:

```sh
cargo fmt --all -- --check
cargo check --locked --all-targets --all-features
cargo clippy --locked --all-targets --all-features -- -D warnings
cargo test --locked --all-targets --all-features
cargo build --locked
node tests/run_node_tests.js target/debug/securecrt-mcp
node tests/mac_adapter_contract.js target/debug/securecrt-mcp
node scripts/validate_repository.js
```

Windows binary paths end in `.exe`; run the Mac contract in its supported development environment. The Node runner includes compiled MCP, uncertainty, IPC, daemon, installation and package regressions; see [testing](testing.md) for focused commands. Several tests use local listeners. If sandbox/network/port restrictions prevent a check, report it and hand it to the maintainer in the required environment; do not work around isolation.

## Evidence and UI handoff

Desktop and AI client approval checks are separate from CI. Use [desktop cases](desktop-test-cases.md) and [acceptance rules](desktop-acceptance.md), only with explicitly authorized idle test tabs. Record the source SHA/dirty status and exact binary/adapter hashes, OS, terminal, loaded engine, PASS/FAIL/untested and original output budgets. Preserve FAIL receipts; never enlarge a budget to turn failure into success.

When UI is unavailable, state the exact platform/client, menu actions, chosen script path and expected observations. Do not automatically choose idle targets, run business commands, acknowledge recovery or claim UI checks passed. Keep credentials, endpoints, usernames, tokens, handles and prior history out of public reports. Do not access private evidence or user configuration merely to gather context.

## Commit and release boundaries

A task must authorize its own commit/push/PR/merge/tag/publication steps. Prepare reviewable changes and report checks before any external action; passing CI alone does not authorize release.

Public v0.5.2 is tied to `3c3489ba267008af2e7bdcc09b0f890c56feb71b`; installation follows current main and records the actual checkout SHA with its matching CI result. These may share a version string while differing in capabilities. Do not replace old ZIPs or rewrite historical receipts.

For a separately authorized release, inspect the actual release workflow, gate and request before taking action. The current workflow can enter through a `v*` tag or successful main CI, but publication is gated by an explicit release decision/request and the exact selected source. A main merge does not replace a published asset. Treat [release documentation](releases.md) as navigation and the workflow/gate as executable facts. Verify intended target builds, checksums, source, CI and actual desktop scope; do not imply that cross-compilation verifies a native UI.

Hand off changed files, rationale, exact verification results, untested UI/environment steps and source/release limitations. Repository metadata recommendations (About/topics) belong in the handoff; never create a release tag to represent a topic.
