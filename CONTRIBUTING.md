# Contributing

Use Rust 1.88+ and Node for build/test/package/client controllers. Only the Mac native adapter contract developer job requires Python; Windows terminal entries use system JScript exclusively. Do not reintroduce Windows Python bindings or separate Python clients.

Follow [testing](docs/testing.md), [desktop cases](docs/desktop-test-cases.md) and [installation](docs/installation.md). Rust owns command state, parsing, bounded output and audit. Native adapters remain on the terminal script thread and never resend uncertain commands, guess idle state or switch targets automatically.

Run strict locked format/check/Clippy/Rust tests, Node native/compiled MCP/fault/performance/daemon/package regressions, the Mac adapter contract and `node scripts/validate_repository.js`. Use a fresh output directory for each authorized desktop run and retain FAIL evidence. An actual Windows or Mac native UI claim requires that client's observable behavior; simulated SDK objects and CI do not replace it.

Keep Token, credentials, endpoints, user names, opaque session IDs and existing terminal history out of commits/PRs. Preserve user configuration, approvals and SSH logins during installation/upgrades. Update bilingual README mirrors, platform paths, manifest and version/source checks together. Existing releases and historical receipts remain immutable.

Submit a PR with the concrete problem, resulting behavior and exact validation scope. Merge only the reviewed head after all required CI checks succeed and unresolved review threads are cleared. Do not silently overwrite public release assets or publish without an explicit release request.
