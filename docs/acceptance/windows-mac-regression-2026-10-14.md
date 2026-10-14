# Windows regression after the Mac 0.5.6 changes

Date: 2026-10-14. Base: `9fdf27e436c94dda67f9ea201aa142764994eac5`.
Changes: normal native stop, professional notices, Windows recovery guidance,
selected-instance desktop diagnostics, bilingual README overhaul and bounded
consecutive IPC waits.

Private receipts remain local, including failed attempts. No credentials, endpoint
addresses, tokens, session IDs or existing terminal history are included here.

## Native SSH comparison

The operator supplied one authorized test server. From the same Windows machine,
100 identical short commands exercised empty output, a line, nonzero exit,
Chinese multiline output and output without a trailing newline. A dedicated
native SSH PTY used the same framing approach as the terminal bridge. Separate
measurements used exec channels on one authenticated SSH transport, and 10
Windows system OpenSSH processes with fresh authentication each time.

| Native path | Samples | p50 | p95 |
| --- | ---: | ---: | ---: |
| Persistent SSH PTY, Paramiko 4.0.0 | 100 | 12.013 ms | 16.748 ms |
| Compiled MCP / persistent Windows OpenSSH | 100 | 12 ms | 16 ms |
| New exec channel on a persistent SSH transport | 100 | 79.785 ms | 95.918 ms |
| Fresh Windows OpenSSH process and login | 10 | 466.933 ms | 560.056 ms |

Handshake: 72.401 ms. Authenticated connection: 232.246 ms. The first endpoint
key was explicitly pinned; subsequent connections required that exact key.
The SecureCRT RSA key was also compared with a direct SSH handshake before
acceptance. Credentials were read only from the authorized workbook record and
were never included in command-line arguments or reports.

The direct PTY and exec-channel checks returned exactly 2,500 Chinese rows / 40,000 UTF-8 bytes:
PTY 24.851 ms, exec channel 102.874 ms, SHA-256
`d9317cab19ed37c2b414c7fc3466aa0ec61655c0080d8cb62d7f5d2065bb76e5`.
These are protocol baselines, not MCP overhead measurements or a claim that
existing desktop SDKs achieve native SSH latency.

The real compiled MCP OpenSSH backend subsequently passed 100 commands with
exact output, a three-command batch including exit 7, operation receipt reuse,
an explicit harmless deny-rule sentinel rejected with `sent=false`, and exactly
107 private dispatch audit records. Its 2,500-row output matched the same hash
in 34 ms. The first authenticated command took 500 ms and was excluded from
the warm-command percentiles. The test used a fresh isolated MCP configuration;
existing client policies and SSH configuration were unchanged.

This test exposed the OpenSSH envelope's extra separator LF in command output.
The fix removes exactly that protocol byte after END. Real trailing newlines,
blank lines, CRLF, Unicode, truncation and partial uncertain output remain
distinct; an exact output-limit body is no longer truncated by its separator.

## Final candidate results

Full behavioral/performance candidate executable SHA-256:
`a80c87c2c5e1eda0c0bef51d96e3c731db051ca526d1ff8af4a48c6614e7fe77`.
Windows native adapter SHA-256:
`9c9c502a21f73c0eaf60f1f458534d700f769ca7ebf19c7fe61bfdc034247f99`.
Mac adapter SHA-256:
`6836a59fab221cb21aedf3c74eecbdfecbd298c4d22acc4306f2aa5541d16054`.
Release builds can have different executable hashes; their checksums and pinned
source are supplied by the release workflow.

Post-review diagnostic acceptance executable SHA-256:
`52c04617872c147e7edc036babb1ae78cea8a71a62a8d5daf65ef86706541c82`.
The additional change is scoped to native diagnostics and acceptance routing;
both native adapters and the command/capture paths retain the hashes and behavior
tested above. This executable repeated both clients' two-tab parallel native-log
full/modern/isolation matrices, the compiled Node suite, 43 Rust tests and 91 Mac
adapter assertions. SecureCRT default full suites also passed sequentially with
separate simultaneous isolation on this executable. Compiled two-instance diagnostics check only the requested
host, retain selected source failures, refuse missing targets without probing
another host, and check all hosts by default. The test's non-atomic heartbeat
fixture failure was retained and corrected to match native atomic publication.

Real clients: SecureCRT 9.6.0 x64 and Xshell 8.0.0.26 x86 on Windows
10.0.26200.0. Only explicitly authorized idle test tabs received commands.

| Gate | Result and scope |
| --- | --- |
| SecureCRT default capture | PASS: both tabs, full legacy checks scheduled sequentially, modern checks and separate simultaneous two-tab command isolation |
| SecureCRT native raw logging | PASS: two-tab parallel full/modern matrix, fixed 10-second 2,500-row output, explicit own timeout/interrupt recovery and isolation |
| Xshell native session logging | PASS: two dedicated tabs, parallel full/modern matrix, fixed capture budget, explicit recovery and isolation |
| Xshell default screen capture | PASS: 100 consecutive exact-output commands on each dedicated tab; recorded before the OpenSSH-only framing fix, on the identical Windows adapter hash |
| Real reconnect, both clients | PASS: native disconnect confirmations, other test tab remains connected, old attachment rejected before send both disconnected/reconnected, new generation executes one unique marker |
| Windows normal stop | PASS: idle/source/generation/authentication guards, zero terminal input, native loop exit and SSH connection preservation |
| Compiled automated suite | PASS: 43 Windows Rust tests, full Node suite, real WSH 800-request stress and x86/x64/CMD/bundle checks |
| Mac adapter/transport contracts | PASS: 91 native-object assertions, compiled MCP using actual adapter, redraw/batch/timeout and large-output fixtures; local POSIX/WSL transfer |

The final real native capture performance suite used 100 short commands,
20 delayed/background-ANSI cases, 10 explicit prompt restorations, exactly
2,500 Unicode rows and operation de-duplication on each backend.

| Native bridge path | Short p50 | Short p95 |
| --- | ---: | ---: |
| SecureCRT raw logging | 180 ms | 225 ms |
| Xshell session logging | 646 ms | 1,072 ms |

An earlier Xshell run on the same test target and workload recorded 1,041 ms /
1,150 ms; the bounded consecutive IPC waits reduced the observed median. These
are separate runs, not a guarantee across terminal versions or system loads.
Existing policy refused deletion of test counter directories; only the harmless
test counts remain. No alternative deletion or policy relaxation was attempted.

## Acceptance boundaries

The 0.5.6 Windows bridge plus initial normal-stop implementation passed complete
two-tab SecureCRT default/raw-log and Xshell raw-log matrices. Those private
receipts record their binary and adapter hashes; they are retained separately
from the final 0.5.7 candidate tests. An old SecureCRT test profile failed public
key authentication during reconnection; the failed lifecycle receipt was kept.
The separately authorized direct test server supplies fresh idle regression tabs.

Old MCP entry scripts and temporary/backup variants were moved to a checksummed
private archive. Other user scripts, configuration and SSH logins were preserved.
The live SecureCRT recent-script list and Xshell script directory were checked.

The default SecureCRT `ReadString` path also has a retained FAIL: simultaneous
full legacy suites mixing long output and deliberate timeout/recovery waits on
one native script thread exceeded the original 10-second budget for one tab
(2,267 of 2,500 rows captured). The native SDK's seconds-based receive wait
can block other captures. Sequential full suites plus dedicated simultaneous
isolation passed; raw logging passed the parallel full suites. The budget was
not increased, no automatic replay was used, and native logging remains opt-in.
Use the raw-log path for long concurrent diagnostic output or OpenSSH for
latency-sensitive persistent commands.

Failed GUI coordination attempts were also retained: a pending disconnect
confirmation temporarily blocked script responses, and an authentication UI
deadline elapsed before login. Later U04 receipts required a closed native
confirmation, actual disconnected tab state and fresh authenticated idle context.
UI coordination waits are separate from the unchanged command capture budget.

No Linux desktop, Intel Mac desktop, or new client approval UI is claimed by
this Windows run. The existing Mac desktop report remains scoped to 0.5.6;
this run exercised the adapter contracts and OpenSSH behavior on Windows.
