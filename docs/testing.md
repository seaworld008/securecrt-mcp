# Validation evidence and remaining desktop acceptance

Version: **0.2.0-preview.1**. This document distinguishes test layers; green CI is not a SecureCRT compatibility certification.

## Automated gates

- Rust 1.88 format/check/Clippy (`-D warnings`)/unit tests with Cargo.lock on Linux, macOS and Windows.
- Compiled binary driven through real MCP stdio and a local fake bridge: handshake, tool discovery/annotations, policy and parameter denial, operation deduplication, UTF-8 pagination, busy state, explicit cancellation, timeout without implicit Ctrl+C, protocol/oversized-frame rejection, audit failure before send, upgrade preservation and generated Codex config.
- Python fake-crt tests cover retained Tab references, reordering, closure/reconnection observation, metadata/freshness/expiry checks, native cleanup, bounded polling, explicit interruption and request authentication/deadlines.
- Version/protocol/documentation link checks. Adapter syntax/tests also run with Python 3.8; general test utilities use Python 3.12.

The initial red run of the native-adapter regression suite failed against the old adapter; the implemented adapter passes the suite. Rust cannot be compiled in the offline authoring container and must be checked through GitHub Actions. Do not replace this distinction with a local compilation claim.

## Manual acceptance still required

### Completed Windows evidence

On 2026-09-20, commit `68cfb10` was exercised with SecureCRT 9.0.0 x64 on Windows x64 and embedded Python 3.8.10. The protocol-2 Bridge reported the expected version and capabilities; the live MCP server enumerated two connected SSH session leases, read a fresh screen token, completed `hostname` in explicit POSIX mode, and rejected `rm -rf` before dispatch. No production mutation was performed.

This is evidence for that desktop/runtime combination, not a claim of cross-platform compatibility or interactive Codex approval. Keep the remaining matrix below open for each additional desktop and client.

Record exact OS, architecture, SecureCRT version, **embedded** Python version, client version and commit tested. The earlier 0.1.1 Windows two-session report does not automatically validate this protocol-2 implementation.

Test on each intended desktop: native Get2/CurrentRow/CurrentColumn/ReadString availability; tab object lifetime during reorder/close; reconnect detection; actual ReadString timeout/partial-output behavior; a no-newline command; POSIX cd/export persistence; prompt-mode boundary; large output; cancellation latency; UI responsiveness; script cancellation cleanup; protocol mismatch/upgrade; rejected approval causing zero remote input.

For optional POSIX probes, use disposable shells and harmless commands (`uname -a`, `printf hello`, `pwd`). Do not execute destructive examples from policy tests: those tests compare strings only. AI-readable terminal output is untrusted.

Client approval: review [Codex acceptance](clients/codex.md). Generated TOML and tool metadata are tested, but a real human rejection cannot be attested without exercising that client. Do not mark that manual step complete from a mock.
