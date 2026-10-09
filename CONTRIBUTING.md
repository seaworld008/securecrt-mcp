# Contributing

[中文入口](README.md) · [English overview](README.en.md) · [中文文档地图](docs/README.md) · [English documentation map](docs/README.en.md)

Start with the [English documentation map](docs/README.en.md), [Agent maintenance guide](docs/agent-maintenance.md) and [testing](docs/testing.md). The root `AGENTS.md` gives repository guidance for coding Agents. Report sanitized bugs or propose changes through [GitHub issues](https://github.com/seaworld008/securecrt-mcp/issues); use [SECURITY.md](SECURITY.md) for vulnerabilities.

Build with Rust 1.88+ and a platform linker. Node 22 runs test/package/client controllers; Python is used for Mac native adapter contract tests. Installed Windows users need system JScript, not those development tools. Keep Rust responsible for state, parsing, bounded output and audit; native adapters call terminal APIs on their script thread. Do not reintroduce Windows Python bindings.

Make focused changes and update affected docs. `README.md` and `README.zh-CN.md` are byte-identical Simplified Chinese entries; `README.en.md` is the complete English alternative with matching capabilities and limitations. Keep installation examples consistent with `src/installation.rs`, CLI definitions and packaging. Run `node scripts/validate_repository.js` for documentation changes; code changes need the relevant locked Rust/Node checks in [testing](docs/testing.md).

Actual Windows/macOS native UI claims require evidence from that environment and exact source/binary/bridge hashes. CI and simulated SDK objects do not replace desktop or client approval tests. Preserve failures and state untested cases. Never commit tokens, credentials, endpoints, usernames, opaque handles or previous terminal history; preserve configuration, approvals and SSH logins.

A PR should state the problem, resulting behavior and exact validation scope. Review and merge only the checked head after required CI and review resolution. Commits, pushes, merges, tags and releases must stay within the requested authorization. Do not overwrite published assets or alter historical receipts. Publication requires an explicit release request and the reviewed release gates; see [maintenance boundaries](docs/agent-maintenance.md#commit-and-release-boundaries).
