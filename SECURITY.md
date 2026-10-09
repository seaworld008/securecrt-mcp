# Security policy

Read the [security model](docs/security-model.md) for policy, authentication, audit and execution boundaries. This project is not a sandbox for remote systems: AI client approvals and SSH account permissions remain essential. Desktop backends reuse existing sessions; optional OpenSSH opens a separate connection.

## Supported versions

During v0.x, fixes target current main and the latest release line. A main fix is not present in a published asset until a new release is explicitly published. Check the exact source/binary identity and [installation source boundary](docs/installation.md); do not infer coverage from a shared version string.

## Report a vulnerability

For policy bypass, token exposure, non-loopback bridge access, execution in the wrong tab or unexpected terminal data disclosure, avoid public issue details. Use the repository's [Security page](https://github.com/seaworld008/securecrt-mcp/security) and **Report a vulnerability** if private reporting is enabled. This guide does not assume that feature is enabled or invent a private contact address. If it is unavailable, ask for a private reporting route without posting exploit details or secrets.

Include the affected version and commit, OS/architecture, terminal/client versions, a sanitized reproduction, expected/actual behavior and impact. Do not attach tokens, credentials, endpoints, usernames, session handles or existing terminal history. Ordinary sanitized bugs can use [GitHub issues](https://github.com/seaworld008/securecrt-mcp/issues).
