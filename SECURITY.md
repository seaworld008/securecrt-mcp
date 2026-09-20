# Security policy

## Supported versions

During the early v0.x phase, security fixes are applied to the latest release and `main`.

## Reporting a vulnerability

Please do not open a public GitHub issue for vulnerabilities that could:

- bypass command policy
- expose bridge authentication tokens
- permit non-loopback bridge access
- execute commands in a different SecureCRT tab than requested
- disclose terminal/session data unexpectedly

Use GitHub's private vulnerability reporting feature for the repository when available, or contact the maintainer privately through the repository owner's published GitHub contact channel.

Include:

- affected version/commit
- operating system and SecureCRT version
- proof of concept
- expected vs actual behavior
- impact assessment

## Security assumptions

`securecrt-mcp` does not provide a sandbox around the remote systems. It adds local policy and auditing before typing into already authenticated SecureCRT sessions. Remote authorization must still be enforced by SSH accounts, sudo, Kubernetes RBAC, database permissions, and other infrastructure controls.
