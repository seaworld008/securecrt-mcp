# Roadmap

Current platform entries and installation are documented in [one-click installation](docs/installation.md). Windows uses JScript only; Mac retains the minimum standard-library Python SDK layer. Build/package/client/acceptance controllers use JS/Rust.

## Delivered implementation

- Unified connector tools, retained native leases, strict sampled input context, bounded capture/output, audit, explicit interruption and inspected-idle recovery without automatic replay.
- Persistent MCP / optional daemon, operation deduplication, per-command batch results, UTF-8 pagination and explicit OpenSSH exec / PTY.
- User-scoped one-click binary/platform-entry/Codex configuration installation preserving existing approval and policy settings.
- [Mac two-Tab real native acceptance](docs/acceptance/mac-native-matrix-2026-10-09.md), with original-budget long output and verified overlapping capture isolation. Historical Windows receipts are kept separately.

## Remaining independent validation

- Codex client human-rejection UI in each advertised client configuration.
- Other exact terminal/OS/architecture tuples and Windows native UI for future changed source.
- Closing and recreating Tabs as a distinct native GUI lifecycle path; disconnect/reconnect is already covered for the recorded Mac run.

## Future work

Additional terminal backends require publicly supported native interfaces and the same identity, approval, no-replay and evidence boundaries. Durable journals, signing/notarization, Windows ACL hardening, SBOM/provenance and stronger remote identity attestation are separate scoped improvements. Do not close runtime-validation work merely because mocks/CI pass, or imply impossible cross-restart exactly-once guarantees.
