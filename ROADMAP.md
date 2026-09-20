# Roadmap

This roadmap is directional. Issues and real-world feedback should determine exact sequencing.

## v0.1 — foundation

- [x] Rust MCP server over stdio
- [x] SecureCRT in-process Python 3 bridge
- [x] localhost token authentication
- [x] session listing
- [x] visible screen capture
- [x] tab focus
- [x] command execution
- [x] Ctrl+C
- [x] raw input opt-in
- [x] local policy engine
- [x] audit log
- [x] Windows/macOS/Linux-oriented CI
- [x] Codex documentation

## v0.2 — execution reliability

- [ ] prompt profiles per session
- [ ] POSIX sentinel command-completion mode
- [ ] improved screen-delta capture
- [ ] command output size limits and truncation metadata
- [ ] bridge heartbeat/health state
- [ ] explicit bridge protocol version negotiation
- [ ] better duplicate/reordered tab identity handling

## v0.3 — production governance

- [ ] temporary privilege elevation with local human approval
- [ ] MCP elicitation for clients that support interactive confirmation
- [ ] per-session policy profiles
- [ ] environment labels: dev/test/prod
- [ ] protected-session deny rules
- [ ] secret-aware audit redaction
- [ ] optional signed policy file

## v0.4 — multi-window and richer terminal control

- [ ] multiple SecureCRT process/window bridge registration
- [ ] bridge discovery without opening LAN listeners
- [ ] terminal selection/clipboard helpers
- [ ] scrollback capture where reliably supported
- [ ] optional structured prompt detection
- [ ] streaming/long-running command support

## Distribution

- [ ] signed GitHub Releases
- [ ] Windows MSI or winget package
- [ ] Homebrew formula
- [ ] `cargo install securecrt-mcp`
- [ ] reproducible release provenance / SBOM

## Ecosystem

- [ ] Claude Desktop examples
- [ ] VS Code / GitHub Copilot examples
- [ ] Cursor examples
- [ ] OpenClaw / agent gateway examples
- [ ] reusable SRE policy packs for Kubernetes, Docker, Linux, MySQL, Redis

## Long-term

If VanDyke exposes an official external automation API or native MCP integration, add it as a new backend while retaining the existing MCP tool surface where possible.
