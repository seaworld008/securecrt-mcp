# Preview release process

The tag workflow builds Windows x86_64, Linux x86_64, macOS ARM64 and macOS Intel archives. Intel macOS is cross-built on the selected macOS runner; compilation is not a native Intel desktop test. Other architectures/packagers are not claimed.

Before tagging: complete CI and the intended desktop acceptance matrix, review migration notes, ensure Cargo.toml / Bridge / docs share the version, and verify no private config/logs enter the tree. Publishing a tag is a separate release decision; merging this preview PR does not create a release.

Push a reviewed `v<package-version>` tag. The workflow checks tag/version, formatting, warnings, tests and MCP smoke before building artifacts. The publish job only runs after every target succeeds, verifies every SHA-256 sidecar and creates a GitHub **prerelease**. Existing releases are not overwritten. Archives contain the executable, license and migration/readme files; the exact adapter is embedded in the binary and installed by init/upgrade.

Users should verify SHA256SUMS before installation and stop old clients before replacing binaries. Checksums detect corruption, not publisher impersonation. OS code signing/notarization, SBOM and provenance attestations are future work and are not claimed by this workflow.
