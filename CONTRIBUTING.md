# Contributing

Contributions are welcome, especially from SecureCRT, SRE, MCP, Rust, and security practitioners.

## Development setup

Requirements:

- Rust 1.88+
- Python 3 for bridge syntax tests
- SecureCRT 9.x for integration testing

Run:

```bash
cargo fmt --all -- --check
cargo clippy --all-targets --all-features
cargo test --all-targets
python3 -m py_compile bridge/securecrt_bridge.py
```

## Pull requests

Keep changes focused. A pull request should explain:

- the problem
- why the change belongs in `securecrt-mcp`
- security implications
- how it was tested
- behavior on Windows/macOS/Linux when relevant

Changes that expand command execution power should include tests for both allowed and denied cases.

## Bridge compatibility

Do not assume SecureCRT's `crt` object exists in a normal Python process. Integration logic that touches `crt` must continue to run inside SecureCRT.

Avoid non-standard Python packages in the bridge unless there is a compelling cross-platform reason. The bridge should remain close to Python's standard library.

## Commit style

Conventional-style prefixes are encouraged:

```text
feat: ...
fix: ...
docs: ...
test: ...
ci: ...
refactor: ...
security: ...
```
