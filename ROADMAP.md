# Roadmap

## 0.2.0-preview.1

Implemented for CI and desktop acceptance: protocol 2; retained native session leases; screen freshness; bounded lifecycle/capture/output; no automatic interrupt/replay; fail-closed pre-dispatch audit; finite safe grammar; configuration validation; upgrade/doctor; client approval configuration and rejection checklist; locked CI and checksum preview-release workflow.

## Required before stable release

- Real SecureCRT runtime acceptance for each advertised desktop and Python combination.
- Verify native Tab reference lifetime and actual ReadString partial-output semantics.
- Real installed Codex human-rejection verification.
- Measure cancellation/UI responsiveness and long-output behavior.

## Later improvements

- Per-session environment labels/policy profiles and stronger remote identity attestation.
- Multi-window discovery and per-session parallel capture after native API validation.
- Durable command journal and crash recovery without making impossible exactly-once promises.
- Optional secure audit sink, Windows custom ACLs, signed/notarized binaries, SBOM and provenance.
- Additional terminal backends only when they preserve the explicit authentication/context boundary.

Existing issue discussion remains authoritative for priorities. Do not close runtime-validation issues merely because mocks pass.
