# Install with an AI Agent / 用 AI Agent 安装

[Documentation map](README.md) · [Installation](installation.md) · [Daily use](agent-usage.md)

Copy one prompt into Codex, Claude Code or another Agent with local filesystem and command tools. A chat-only client cannot install local software. This authorizes setup; real terminal input still requires explicit authorization for an idle test target. Human-only UI steps should be handed back with exact menu actions and paths.

## English prompt

```text
Set up https://github.com/seaworld008/securecrt-mcp for me.
1. Identify OS/architecture, AI client/version, terminal/version and existing
   MCP/application configuration. Read official repository README,
   docs/installation.md, docs/support-matrix.md and the selected client guide.
   Inspect relevant configuration without printing secrets; do not read
   credential files or unrelated terminal history.
2. Choose a matching, verifiable source. Public v0.5.2 is from
   3c3489ba267008af2e7bdcc09b0f890c56feb71b and predates install and current
   self-contained Windows scripts. Inspect the chosen archive and CLI help;
   do not invent assets or mix binaries/adapters. If current entries are
   missing, keep current main and its matching docs, record git rev-parse HEAD,
   confirm successful CI for that commit, then use Rust 1.88+ and
   cargo build --release --locked; or select a successful CI bundle tied to
   its exact tested commit/OS/architecture. Verify the release SHA256SUMS or
   CI ZIP sidecar from that same source. Record source and binary identity.
3. Make incremental changes, preserving other MCP entries, approvals, tool
   restrictions, policies, tokens and existing SSH logins. Do not change
   global PATH or bypass OS security prompts. Explain that install writes
   Codex configuration even for a Claude-only user. For Claude-only use init
   and a stable verified binary path, then register it in Claude. Claude Code
   and Desktop configurations are separate. Use the absolute binary with
   args ["serve"] and the same absolute SECURECRT_MCP_HOME everywhere.
   For a Windows custom home, verify the terminal process inherited that
   variable; selecting a script path or setting MCP env alone is insufficient.
   Prefer the existing/default home rather than disrupting logged-in terminals.
4. Run doctor --offline using that binary/home; for Xshell also use its
   backend offline check. Use available authorized native UI tools to load
   the bridge at an idle boundary; otherwise pause that dependent step and
   give the exact Script > Run path/menu sequence. Reuse
   an already loadable Mac Python engine; if unavailable, follow the installed
   terminal's official version/architecture instructions. Never silently
   install extra runtimes, weaken policy or bypass system security dialogs.
5. After bridge loading and client reload are actually observed (or confirmed
   by the user for manual steps), run online diagnostics and connector_list.
   Ask which dedicated idle POSIX test tab is explicitly authorized if that
   scope is not already established. Inspect the original terminal. Do not
   automatically declare terminals idle or select business tabs. Bind only
   that target, inspect it with connector_read_screen, then execute one harmless
   printf with a new operation_id and check
   state, sent, exit_code and output. No business commands, automatic replay,
   Ctrl+C or idle acknowledgement. Inspect uncertain results before proceeding.
6. Report source/commit, binary/home/client paths, sanitized changes, actual
   commands/check results and required manual steps. Distinguish local build,
   configuration, offline diagnostics, bridge connectivity, real execution
   and client approval verification. Mark every unrun check as untested.
```

## 中文提示词

```text
请帮我配置 https://github.com/seaworld008/securecrt-mcp。
1. 先识别 OS/架构、AI 客户端/版本、终端/版本及已有 MCP/应用配置。阅读官方仓库
   README、docs/installation.md、docs/support-matrix.md 和对应客户端指南。
   检查有关配置但不打印秘密，不读取凭据文件或无关终端历史。
2. 选择可核验的匹配来源。公开 v0.5.2 来自
   3c3489ba267008af2e7bdcc09b0f890c56feb71b，早于 install 和当前 Windows
   自包含脚本。检查所选包文件及 CLI help，不杜撰资产、不混搭二进制与适配器。
   缺少当前入口时，保留最新 main 及配套文档，用 git rev-parse HEAD 记录提交，
   核对该提交的成功 CI，再用 Rust 1.88+ 执行 cargo build --release --locked；
   或选择成功 CI 中对应已测试提交、OS/架构的包。
   用同来源的 Release SHA256SUMS 或 CI ZIP sidecar 校验，记录源码与二进制身份。
3. 增量修改，保留其他 MCP、审批、工具范围、策略、令牌和 SSH 登录。不改全局
   PATH、不绕过系统安全提示。说明 install 即使只用 Claude 也会写 Codex；
   Claude-only 应使用 init，将稳定路径的已校验二进制单独注册到 Claude。
   Claude Code 与 Desktop 是两套配置。所有入口使用二进制绝对路径、["serve"]
   及同一绝对路径 SECURECRT_MCP_HOME。Windows 自定义目录时确认终端进程也继承
   该变量；选脚本路径或只设置 MCP env 不足以生效。优先沿用已有/默认目录，
   不为切换目录破坏已登录终端。
4. 用同一二进制/应用目录执行 doctor --offline；Xshell 另做后端离线检查。
   可用且已获准时，使用原生 UI 工具在空闲边界加载桥接；否则只暂停依赖步骤，
   给出准确的 Script > Run 菜单与路径。
   Mac 优先复用已有可加载 Python 引擎；缺少时遵循当前终端官方版本/架构要求，
   不静默叠加运行时、不放宽策略、不绕过安全弹窗。
5. 实际观察到桥接加载和客户端重载后（人工步骤由我确认），执行在线诊断
   和 connector_list。若尚未明确测试范围，询问我授权哪一个专用空闲 POSIX
   测试 Tab，并检查原终端。
   不自动确认空闲、不选择业务 Tab。仅绑定获准目标，用 connector_read_screen
   核对屏幕后，以新 operation_id 执行
   一条无害 printf，核对 state、sent、exit_code 与输出。不执行业务命令，
   不自动重放、Ctrl+C 或空闲确认；结果不确定先检查原会话。
6. 报告来源/提交、二进制/应用/客户端路径、脱敏改动、实际命令/结果与人工步骤。
   区分编译、配置、离线诊断、桥接连通、真实执行和客户端审批验证；
   未运行的检查明确标未测。
```

## What a completed setup report should show

| Layer | Evidence | What it does not establish |
| --- | --- | --- |
| Source/package | Commit, OS/architecture, matching checksum and entry inspection | Compatibility with arbitrary terminal versions |
| Configuration | Sanitized added/updated entry with absolute binary, `serve` and home | That the client has loaded it |
| Offline doctor | Actual exit status and local checks | Bridge UI loading, SSH execution, stopped listener or approvals |
| Online backend doctor | Actual runtime/API/source report | A completed command or every desktop acceptance case |
| Authorized test | Verified target, final state, send evidence, real exit code and intended output | Production workload safety or remote descendant termination |
| Client approval check | Observed rejection with zero input in a dedicated test tab | A policy guarantee for other clients/versions |

Follow [Codex](clients/codex.en.md) or [Claude](clients/claude.md) for client registration and approval checks. If a local tool, download, UI action or approval is unavailable, report the exact remaining step; do not replace it with a claim of success.
