# Validation and compatibility

`securecrt-mcp` touches two independent runtimes: the Rust MCP server and SecureCRT's in-process Python scripting engine. Treat both as part of the compatibility matrix.

## Automated validation

GitHub Actions is configured to run on every push to `main` and every pull request:

| Check | Linux | Windows | macOS |
|---|---:|---:|---:|
| `cargo fmt --check` | ✅ CI | ✅ CI | ✅ CI |
| `cargo check --all-targets --all-features` | ✅ CI | ✅ CI | ✅ CI |
| `cargo clippy` | ✅ CI | ✅ CI | ✅ CI |
| `cargo test` | ✅ CI | ✅ CI | ✅ CI |
| Python bridge syntax | ✅ CI | — | — |

The Python bridge itself has no third-party Python dependency.

## Runtime validation matrix

The repository starts at v0.1 as an early preview. Before declaring a platform fully verified, test all of the following against an actual SecureCRT installation:

1. `securecrt-mcp init`
2. `Script -> Run... -> securecrt_bridge.py`
3. `securecrt-mcp doctor`
4. session enumeration
5. screen capture
6. focus switching
7. safe read-only command execution
8. `wait_for` capture
9. Ctrl+C interruption
10. blocked destructive commands

Track real-world platform/version results in issues and update this document as evidence accumulates.

## Local release gate

Before tagging a release, run:

```bash
cargo fmt --all -- --check
cargo check --all-targets --all-features
cargo clippy --all-targets --all-features -- -D warnings
cargo test --all-targets --all-features
python3 -m py_compile bridge/securecrt_bridge.py
```

A release should not be promoted from preview solely because the code compiles. It should also be exercised against at least one real SecureCRT session and, for claims of cross-platform verification, against the corresponding operating systems.
