# Changelog

All notable changes to this project will be documented here.

## [0.1.1] - 2026-09-20

### Added

- Chinese documentation is now the default README and Codex setup guide; English guides remain available as optional files.
- Windows first-run guidance for SecureCRT Python 3.8, Bridge startup, Codex reload, read-only operations, and controlled file CRUD verification.
- Runtime validation evidence for two connected SecureCRT SSH sessions.

### Fixed

- SecureCRT 9.0 Python bridge header compatibility by removing the standalone comment line after the required script headers.

## [Unreleased]

### Planned

- Real-world SecureCRT integration validation across Windows, macOS, and Linux
- release packaging
- richer prompt/completion handling

## [0.1.0] - 2026-09-20

### Added

- Rust MCP server using the official `rmcp` SDK
- SecureCRT Python 3 in-process bridge
- localhost token-authenticated bridge protocol
- session listing and visible-screen reading
- tab focusing
- command execution with snapshot or `wait_for` capture
- Ctrl+C interrupt
- opt-in raw text sending
- safe/read-oriented local command policy
- local JSONL audit trail
- CLI commands: `serve`, `init`, `doctor`, and `paths`
- cross-platform CI and project documentation
