# Contributing

Use Rust 1.88 and Python 3.12. Keep Cargo.lock updated deliberately, run `cargo fmt --all -- --check`, `cargo clippy --locked --all-targets --all-features -- -D warnings`, `cargo test --locked --all-targets --all-features`, `python -m unittest discover -s tests -v`, and the compiled-binary `tests/mcp_smoke.py`. Validate local docs with `scripts/validate_repository.py`.

Write regression tests before changing behavior. Keep native crt calls in the SecureCRT script thread. Tests must never connect to production hosts or use real secrets. Do not add automatic command retries, hidden Ctrl+C, permissive fallback to tab indexes, silent audit errors, or approval=true arguments.

Explain security impact, migration and desktop evidence separately from mocked CI. Native API behavior must be tested against actual supported SecureCRT versions before promising compatibility. See [testing](docs/testing.md) and [security](SECURITY.md).
