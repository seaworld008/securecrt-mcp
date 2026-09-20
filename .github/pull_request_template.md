## What changed

<!-- Describe the change. -->

## Why

<!-- What problem does this solve? -->

## Security impact

- [ ] No privilege/command-execution change
- [ ] Expands or changes command execution behavior (explain below)
- [ ] Changes bridge authentication/transport (explain below)

## Validation

- [ ] `cargo fmt --all -- --check`
- [ ] `cargo check --all-targets --all-features`
- [ ] `cargo clippy --all-targets --all-features`
- [ ] `cargo test --all-targets --all-features`
- [ ] `python3 -m py_compile bridge/securecrt_bridge.py`
- [ ] SecureCRT integration tested where applicable
