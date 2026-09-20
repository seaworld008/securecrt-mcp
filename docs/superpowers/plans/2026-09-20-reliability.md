# Terminal Reliability Implementation Plan

> For agentic workers: execute inline with test-driven-development and verification-before-completion.

**Goal:** Deliver a reviewable preview implementing the user-approved reliability and distribution scope.
**Architecture:** Retain the Rust server and a minimal SecureCRT adapter; protocol 2 provides session leases, freshness and bounded capture. Rust manages execution and pagination.
**Tech Stack:** Rust 1.88, rmcp, Tokio, Python standard library, GitHub Actions.
**Spec:** ../specs/2026-09-20-reliability.md

## Global constraints
- Preserve existing user configuration and unrestricted default; no policy-as-sandbox claims.
- No production connection, hidden probes, automatic retry/interrupt, or native Python extension.
- No silent fallback to tab indexes. Versioned protocol is a deliberate preview breaking change.

## Review focus
- Closed/reordered/reconnected native tabs must not redirect an old handle.
- Stale screen tokens, expired requests and failed audit must produce zero sends.
- Partial marker/no-newline output and timeouts must not become false success.
- Cancellation must yield an interrupt opportunity and must not imply process death.
- Upgrade must preserve policy/token and warn about running older adapters.

## Tasks
- [x] 1. Regression tests: Python fake-crt tests for leases/freshness/framing with observed red/green runs; Rust tests for policy, validation, output/markers, validated on Actions.
- [x] 2. Guardrails: src/config.rs, policy.rs, audit.rs, bridge.rs; strict framing/configuration, bounded permissions, fail-closed dispatch.
- [x] 3. Adapter: protocol-2 retained references and bounded begin/poll/end primitives; fake-crt tests.
- [x] 4. Rust execution: src/execution.rs, model.rs, server.rs; submit/status/output/interrupt/acknowledge-idle, no retry, precise terminal states.
- [x] 5. Installation and docs: src/main.rs; safe upgrade, versioned script, doctor, migration, approval-rejection checklist.
- [x] 6. CI/release: genuine Cargo.lock, three-platform workflow, live MCP smoke test, artifact packaging and checksum workflow.
- [ ] 7. Whole-branch review, inspect all PR checks, merge expected SHA and verify main. The PR records final evidence; manual desktop acceptance remains separate.

## Commands
```sh
python -m unittest discover -s tests -v
cargo fmt --all -- --check
cargo check --locked --all-targets --all-features
cargo clippy --locked --all-targets --all-features -- -D warnings
cargo test --locked --all-targets --all-features
python tests/mcp_smoke.py target/debug/securecrt-mcp
```

Rust tooling/network are unavailable in the local authoring container: Rust gates run on GitHub Actions, not fabricated locally. No fresh-context reviewer tool is available; use explicit self-review with test evidence.
