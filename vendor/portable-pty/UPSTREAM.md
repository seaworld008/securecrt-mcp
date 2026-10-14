# portable-pty 0.9.0: headless Windows console option

Upstream: https://crates.io/crates/portable-pty/0.9.0
Repository: https://github.com/wezterm/wezterm/tree/main/pty
License: MIT, preserved in LICENSE.md.
Original crates.io package checksum: `b4a596a2b3d2752d94f51fac2d4a96737b8705dddd311a32b9af47211f08671e`.

This is the cached, published 0.9.0 source. `upstream-sha256.json` records the
original files using LF-normalized SHA-256. Only Cargo.toml and
src/win/psuedocon.rs are patched: the opt-in `headless` feature omits
PSEUDOCONSOLE_INHERIT_CURSOR. Default behavior, other Windows flags and Unix
implementations remain upstream behavior. The MCP enables this feature because
its virtual console has no parent terminal cursor to inherit.

Microsoft documents that cursor inheritance requires asynchronous terminal
queries and replies, and can hang without them:
https://learn.microsoft.com/en-us/windows/console/createpseudoconsole
The MCP performs standard headless startup without synthesizing terminal input.

Updates must preserve the license, refresh source provenance, reapply this
small feature and run compiled Windows ConPTY and real SSH read/write/resize
checks plus the existing cross-platform suite. Do not edit the Cargo registry.
