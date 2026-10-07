# Contributing

## Rust MSRV policy

The current MSRV is **Rust 1.88**, recorded in `Cargo.toml` and
`rust-toolchain.toml`. It constrains contributors and `cargo install` builds.
Precompiled release users do not need Rust. Compiler requirements do not change
SecureCRT, Xshell, Python or OS runtime requirements.

Raise MSRV only in a **minor release** (for example 0.5.x to 0.6.0), never in a
patch release. Document the old/new MSRV and reason in CHANGELOG, update both
manifests and CI together, and validate on the declared minimum. Dependencies
requiring a newer compiler must wait for that minor release or stay compatible.
This change does not raise MSRV.

See [support policy](docs/support-policy.md) and [support matrix](docs/support-matrix.md).

Use Rust 1.88 and Python 3.12. Keep Cargo.lock updated deliberately, run `cargo fmt --all -- --check`, `cargo clippy --locked --all-targets --all-features -- -D warnings`, `cargo test --locked --all-targets --all-features`, `python -m unittest discover -s tests -v`, and the compiled-binary `tests/mcp_smoke.py`. Validate local docs with `scripts/validate_repository.py`.

Write regression tests before changing behavior. Keep native crt calls in the SecureCRT script thread. Tests must never connect to production hosts or use real secrets. Do not add automatic command retries, hidden Ctrl+C, permissive fallback to tab indexes, silent audit errors, or approval=true arguments.

Explain security impact, migration and desktop evidence separately from mocked CI. Native API behavior must be tested against actual supported SecureCRT versions before promising compatibility. See [testing](docs/testing.md) and [security](SECURITY.md).
