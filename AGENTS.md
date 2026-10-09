# Repository guide for AI Agents

## Start here

Read `README.md` (English) or `README.zh-CN.md`, then [documentation map](docs/README.md), [contributing](CONTRIBUTING.md) and [Agent maintenance](docs/agent-maintenance.md). For user installation read [Agent setup](docs/agent-setup.md) and the selected client guide instead. Read the relevant contract and implementation before editing.

## Repository map and facts

- `src/`: Rust CLI, configuration/installation, connector state, policy, output and audit.
- `bridge/`: Windows JScript and the minimum macOS Python native adapter; terminal calls stay on the native script thread.
- `clients/`: optional JS/PowerShell callers; `tests/`: Node controllers and Rust/adapter contracts.
- `scripts/`: repository validation, portable bundles and release gates.
- `support/`: runtime support data; `docs/`: operational guides, contracts and historical evidence; `.github/workflows/`: CI/release orchestration.

The current main installer writes Codex configuration. Claude-only setup uses `init` and separate client registration. Public v0.5.2 comes from an earlier source and lacks current installer/self-contained Windows features. Treat the selected commit, binary and bridge identity as facts; version equality does not prove feature or acceptance equality.

## Editing and validation

Keep changes within the assigned scope and preserve others' work. Do not change dependencies, protocols, version, approvals or release policy as a side effect of documentation work. `README.md` must equal `README.en.md`; Chinese entry capabilities and boundaries must agree. Preserve existing version/protocol assertions in validation scripts.

For documentation: `node scripts/validate_repository.js` and `git diff --check`. For code: follow [testing](docs/testing.md) with locked Rust commands and applicable Node/adapter contracts. Report exact commands/results and untested environments. Never infer real desktop or client approval success from compilation, mock tests or doctor.

## User state and terminal input

Preserve existing MCP entries, approvals, tools, policies, tokens and SSH logins. Do not read credential files, `.data/`, private evidence/configuration or unrelated terminal history without explicit scope; never include secrets in output or changes. Do not bypass OS prompts or loosen approvals.

Terminal input requires an explicitly authorized idle test target and harmless agreed commands. Do not guess idle, choose business tabs, auto-replay uncertain commands, auto-acknowledge idle or send Ctrl+C without explicit authorization. Loading/reloading bridges and client approval tests require real UI; when unavailable, provide precise manual steps and mark untested. Keep failed evidence intact.

## Delivery boundaries

Commit, push, PR, merge, tag and release actions require the corresponding task authorization. Do not manufacture approval or publish because CI passed. Existing public assets, release notes and historical receipts remain unchanged unless explicitly assigned; release requires an explicit request and gates tied to the exact reviewed/tested commit. See [Agent maintenance](docs/agent-maintenance.md) for checks and handoff.
