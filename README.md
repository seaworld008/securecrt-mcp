# securecrt-mcp

[![CI](https://github.com/seaworld008/securecrt-mcp/actions/workflows/ci.yml/badge.svg)](https://github.com/seaworld008/securecrt-mcp/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

**0.2.0-preview.2 · Bridge 协议 2 · [English](README.en.md)**

让 AI 操作 SecureCRT **已经登录的会话**，继续复用 VPN、堡垒机、SSH 密钥与 MFA。Rust 负责 MCP、策略、执行状态、输出分页及审计；标准库 Python 适配器只在 SecureCRT 脚本线程内调用 `crt` API。不新建 SSH 连接，不导出 SSH 凭证，也不是 VanDyke 官方产品。

> 这是接口有变化的预览版。自动化测试不等于真实 SecureCRT 三平台验证，也不能证明你的 Codex 配置会弹出审批。先在测试会话完成 [升级与验收](docs/migration-0.2.md)，再接生产环境。

## 一次调用，完成常规排查

完成会话选择后，优先使用 `securecrt_run_command`：

```json
{"session":"从会话列表取得的句柄","command":"docker ps","mode":"posix","timeout_ms":30000,"max_bytes":60000}
```

工具内部读取新屏幕、获取 Token、提交一次命令、等待并返回有界输出；正常情况下不必手动轮询或再取一次输出。`mode` 必填：`posix` 是调用方明确选择空闲 POSIX Shell，不用于密码提示、堡垒机菜单或数据库 REPL。

新安装默认 `policy.mode = "client"`，命令风险与批准交给客户端。升级不修改旧策略；已有用户按需将现有 `[policy]` 的 `mode` 改成 `client`。自定义拒绝规则仍是操作者显式配置，不会被悄悄删除。

详见 [Agent 使用与错误恢复](docs/agent-usage.md) 和 [Python / PowerShell 客户端](docs/clients/command-line.md)。

## 本版解决的问题

- 会话使用绑定原生 Tab 对象的、不透明短期句柄，不再接受 `tab:1` 或标题作为操作目标。重排不会主动重新绑定目标；已观察到的断线、连接配置变化和租约到期使旧句柄失效。
- 低层接口每次发送需要新鲜、单次使用的 `screen_token` 和明确的 `expected_prompt`，避免把旧屏幕上的判断用于变化后的输入上下文。
- 低层提交先返回 `command_id`；高层工具整合等待和输出。`completed`、`timed_out`、`cancelled`、`unknown` 与 `rejected` 不混淆。
- POSIX 模式使用随机完成标记和退出码，不依赖固定 sleep；不自动包装其他类型终端。无换行输出也有独立结束标记行。
- 原生捕获调用每次最多等待一秒，调用之间可以处理显式中断。超时不会自动 Ctrl+C，也不会自动重放命令。
- 审计在发送前失败就拒绝执行；发送后审计失败保留结果并返回警告。输出、消息帧和缓存均有大小限制。
- `upgrade` 统一更新内嵌适配器并备份旧文件，保留现有策略和 Token；`doctor` 检查实际运行的适配器版本、Python 和平台。

**重要边界：**句柄绑定的是 SecureCRT 会话，不是不可伪造的远端主机身份。嵌套 SSH、提示符伪装、两次采样之间完成的断开重连，仍需人核实目标；本地同一用户的恶意程序不在隔离边界内。

## 安装与升级

要求：Rust 1.88，以及对应 SecureCRT 版本可加载的 Python 3。适配器保持 Python 3.8 语法兼容，但不把旧 Python 运行时推荐为生产安全基线。请按 VanDyke 文档选择产品与 Python 的组合。

已有仓库的 Windows 用户：先确认没有未完成命令，停止旧 Bridge（保留 SSH Tab），退出占用二进制的 Codex，再执行：

```powershell
git status --short
git pull --ff-only origin main
cargo build --locked --release
.\target\release\securecrt-mcp.exe upgrade
.\target\release\securecrt-mcp.exe doctor --offline
.\target\release\securecrt-mcp.exe codex-config
```

首次安装用 `init` 替代 `upgrade`。不要为了修复普通问题使用 `init --force`：它会在备份后重置配置、旋转 Token。

先执行 `.\target\release\securecrt-mcp.exe paths` 获取脚本路径。在 SecureCRT 选择 **Script → Run**，运行输出的 `securecrt_bridge.py`。提示框出现后点击 OK，才开始处理请求。随后执行：

```powershell
.\target\release\securecrt-mcp.exe doctor
```

macOS/Linux 对应二进制为 `./target/release/securecrt-mcp`，其余子命令相同。默认数据目录是用户主目录下 `.securecrt-mcp`；可用绝对路径环境变量 `SECURECRT_MCP_HOME` 指定独立目录。适配器读取**自身所在目录**的 `bridge.json`，不要分开放置。

## 已验证的 Windows 流程

以下是 **preview.1 的历史实测**，保留原始证据；不是 preview.2 高层工具或新默认 `client` 策略的桌面验收。

2026-09-20 在 Windows x64、SecureCRT 9.0.0 x64、内嵌 Python 3.8.10 上完成了协议 2 的真实桌面验收：

- `doctor` 报告 Bridge `0.2.0-preview.1`、协议 2，且运行时检查通过。
- `securecrt_list_sessions` 返回两个已登录 SSH 会话的短期租约；后续操作只使用租约，不使用旧版 `tab:1`。
- `securecrt_read_screen` 返回当前提示符和一次性 `screen_token`。
- 在确认空闲 POSIX Shell 后，`hostname` 通过 `mode = "posix"` 提交，状态变为 `completed`，输出与目标会话一致。
- `rm -rf` 在 Rust 策略层被标记为 `rejected`，没有发送到 SecureCRT。

这组结果只证明当前 Windows/SecureCRT 组合的实测路径，不代表其他 SecureCRT 版本、终端类型或 Codex 客户端已经完成审批验收。发生超时、取消或 `unknown` 时，不要自动重试；先读原始屏幕并人工确认空闲。

## Codex 审批不是自动获得的

`codex-config` 打印当前二进制绝对路径和增量 TOML 示例，不修改你的 Codex 配置。将输出合并到原文件，避免重复表名。支持相应配置项的 Codex 应设置：

```toml
[mcp_servers.securecrt]
command = "C:\\Tools\\securecrt-mcp.exe"
args = ["serve"]
startup_timeout_sec = 30
tool_timeout_sec = 65
default_tools_approval_mode = "auto"

[mcp_servers.securecrt.tools.securecrt_read_screen]
approval_mode = "approve"
```

生成器默认 `--approval-mode auto --toolset basic`，由 Codex 标准权限逻辑决定批准；只读工具提供例外。需要逐次确认可选择 `--approval-mode prompt`，需要全部低层工具可选择 `--toolset full`。生成配置不代表已验证实际客户端批准行为。旧版客户端若不支持这些键，不要直接删掉审批配置并假定安全；按 [客户端验收](docs/clients/codex.md) 实际测试“拒绝后零发送”。MCP annotations 是提示元数据，不是安全执行器。

## 日常调用流程

先列出会话并核实目标。日常命令使用 `securecrt_run_command`，读取返回的 `text`、`state`、`exit_code`。`running` 表示继续查询原 `command_id`；`next_cursor` 非空表示可读取后续页。高级场景仍可使用 `read_screen → execute_command → status/output` 低层流程。

高层工具不会自动重试命令、Ctrl+C 或确认未决状态。明确未发送的拒绝返回 `sent: false`，不再错误地制造本地 unknown 阻塞；丢失发送回执仍返回 `sent: null` 并保留保护。显式确认空闲后同时返回新 `screen`，包含可用的新 Token。

示例：

```text
列出 SecureCRT 会话并让我确认目标。后续优先用 run_command 在已确认的 POSIX Shell 上排查 Docker、Nginx 和网络。
遵循客户端权限决定；不自动重试未知结果，不自动中断或确认空闲。输出不够时按 next_cursor 读取后续页。
```

### 三种捕获模式

| mode | 行为 | 结束语义 |
|---|---|---|
| `snapshot`（低层默认；高层需明确选择） | 原样发送并截取可见屏幕 | `unknown`，不是执行完成；需人工核查并确认空闲 |
| `prompt` | 原样发送，等待 `wait_for` 字面提示符 | `completed` 仅表示看到文本，退出码为 null |
| `posix` | 明确选择 POSIX Shell，当前 Shell 中 `eval` + 随机标记 | 标记匹配后给出退出码；不会创建子 Shell 隐式丢失 cd/export |

不对 PowerShell、设备 CLI、密码提示、编辑器或 REPL 自动启用 POSIX 包装。`exit`、`exec`、`set -e`、重定向整个 Shell、后台任务或连接中断可能使标记无法出现，必须保留不确定结果。包装会额外输出分隔换行，不承诺字节级原样输出。

本预览版每个 SecureCRT 窗口只允许一个活动捕获；已有任务时拒绝新任务，不自动杀掉旧任务。取消、超时或未知状态后，窗口保持未决保护；确认原会话确实空闲后，用新屏幕 Token 调用 `securecrt_acknowledge_idle`。Tab 丢失或原生对象失效时需要人工排查后重启适配器。

`operation_id` 在同一 MCP 进程内去重；相同 ID 参数不同会拒绝，输出过期后也不重放。重启后没有持久化的 exactly-once 保证。不要把网络失败等同于“服务器没有执行”。

## 工具

| 工具 | 用途 |
|---|---|
| `securecrt_bridge_status` | 运行时、协议与未决状态 |
| `securecrt_list_sessions` | 获取短期会话句柄 |
| `securecrt_read_screen` | 读屏及获取一次性上下文 Token |
| `securecrt_focus_session` | 聚焦明确会话 |
| `securecrt_run_command` | 首选的一次调用执行与有界输出 |
| `securecrt_execute_command` | 提交经批准的命令 |
| `securecrt_get_command_status` | 生命周期状态 |
| `securecrt_get_command_output` | UTF-8 字节游标分页 |
| `securecrt_interrupt` | 对指定命令显式发送 Ctrl+C |
| `securecrt_acknowledge_idle` | 人工检查后解除未决保护 |
| `securecrt_send_text` | 默认禁用的高权限原始输入 |

## 策略范围

新安装默认 `client`：不使用内置危险命令词表代替客户端授权。可选自定义拒绝规则、原始输入开关、输入/消息大小限制、审计和会话绑定仍然有效。旧版 `unrestricted` 保留原来的便利性过滤，升级不改变现有配置；两者都**不是沙箱**。真正授权依赖客户端权限、SSH 账号、sudo、Kubernetes RBAC 和数据库权限。

`observe` 禁止发送命令；`safe` 只支持有限的命令/参数语法，未知参数拒绝，而不是仅检查命令名前缀；`allowlist` 仅允许管理员配置的完整命令正则。自定义允许规则是受信任管理员的显式例外。任何模式都不保证命令输出不含秘密，配置和读取权限需独立管理。

```toml
[policy]
mode = "client"
allow_raw_send = false
allow_interrupt = true
custom_allow_patterns = []
custom_deny_patterns = []
```

输出默认每任务保留 1 MiB、最多 32 个任务，参数乘积上限 128 MiB。缓存满时淘汰最旧的已结束结果，仍保留操作去重记录；不会因删掉输出而重新执行旧操作。游标是 UTF-8 **字节**偏移；必须遵循返回的 `next_cursor`。`truncated` 和 `capture_may_be_incomplete` 表示结果并非完整文件或可靠全量日志，不能忽略。原生 `ReadString` 超时行为因运行时需实测，本版保守标注捕获不完整风险。

## 开发与发布

```bash
cargo fmt --all -- --check
cargo clippy --locked --all-targets --all-features -- -D warnings
cargo test --locked --all-targets --all-features
cargo build --locked
python -m unittest discover -s tests -v
python tests/mcp_smoke.py target/debug/securecrt-mcp
python tests/ux_smoke.py target/debug/securecrt-mcp
python tests/review_smoke.py target/debug/securecrt-mcp
python scripts/validate_repository.py
```

Windows 的 smoke test 二进制加 `.exe`。Python 3.8 只用于适配器单元测试；仓库校验和 MCP 测试脚本用 Python 3.12（需要 `tomllib`）。CI 包含 Windows/macOS/Linux Rust 检查和实际 stdio + 模拟 Bridge 测试。

Tag 发布流程构建 Windows x64、Linux x64、macOS ARM64/Intel ZIP 和 SHA256SUMS，验证通过才创建 GitHub **预发布**。工作流存在不代表本版已经发布二进制或已完成桌面验收。见 [发布流程](docs/releases.md)。

## 文档

[架构](docs/architecture.md) · [协议](docs/bridge-protocol.md) · [安全](docs/security-model.md) · [升级](docs/migration-0.2.md) · [验收](docs/testing.md) · [Codex](docs/clients/codex.md) · [排障](docs/troubleshooting.md) · [路线图](ROADMAP.md)

MIT License，详见 [LICENSE](LICENSE)。
