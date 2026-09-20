# Changelog

All notable changes to this project will be documented here.

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
