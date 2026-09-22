# securecrt-mcp

[![CI](https://github.com/seaworld008/securecrt-mcp/actions/workflows/ci.yml/badge.svg)](https://github.com/seaworld008/securecrt-mcp/actions/workflows/ci.yml)
[![Release](https://img.shields.io/github/v/release/seaworld008/securecrt-mcp?display_name=tag)](https://github.com/seaworld008/securecrt-mcp/releases)
[![License](https://img.shields.io/github/license/seaworld008/securecrt-mcp)](LICENSE)
[![Rust](https://img.shields.io/badge/rust-1.88%2B-orange)](https://www.rust-lang.org/)
[English](README.en.md)

**securecrt-mcp 0.4.0** 是一个面向生产环境的 Rust MCP Server：让 Codex、Claude 等 MCP 客户端安全、可审计地操作 SecureCRT 中已经登录的 SSH 会话，并可显式选择持久 OpenSSH/PTY 连接器。

它复用操作员已经完成的 VPN、堡垒机、SSH 密钥和 MFA 流程，不建立第二条 SSH 连接，也不导出服务器凭据。项目独立于 VanDyke Software。

> **生产定位**：适合运维诊断、发布检查、日志查看和受控变更。它是 SecureCRT 会话连接层，不是原生 SSH/PTY，也不是第二套 AI 权限系统。客户端审批、远端账号权限和人工目标确认仍然有效。

> **高性能连接器（opt-in）**：新增 `connector_*` 工具可显式打开系统 OpenSSH 的长期命令会话或 PTY 会话。SecureCRT 仍是默认后端；OpenSSH 使用现有 `ssh_config`、Agent、ProxyJump 和 known_hosts，不在 MCP 中保存密码。详见 [统一连接器](docs/connectors.md)。

## 能力概览

- 复用已登录的 SecureCRT Tab，按不透明会话句柄绑定目标，避免用 Tab 序号误操作。
- `attach -> exec` 连续执行，减少重复建立连接、读屏和令牌开销。
- `exec_batch` 支持最多 20 条命令，每条拥有独立输出、退出码、审计和 command ID；不确定结果始终停止。
- 批量读取原生缓冲、增量输出和滚动游标，长日志明确报告截断或 gap。
- per-session 捕获、lease、超时、interrupt、idle acknowledgement 和未决任务隔离。
- 可选 loopback daemon，供 CLI、Python 和 PowerShell 高频调用复用同一个 Engine。
- 默认仅做少量极高危防误操作过滤；普通命令由 MCP 客户端审批和远端账号权限决定。
- 不自动重放未知命令，不自动 Ctrl+C，不自动切换到同名会话，不静默绕过客户端审批。
- OpenSSH connector 使用持久 `ssh -T`/`ssh -tt` 会话，支持命令、长驻流、PTY 输入、resize 和绝对 cursor 分页。

## 已验证范围

0.4.0 发布前完成了 Rust、Bridge、MCP stdio、批量执行、daemon、故障注入、打包和连接器测试，并在 Windows x64 / SecureCRT 9.0.0 / 内嵌 Python 3.8.10 上进行了真实桌面验收：

- Linux SSH Tab：`hostname`、`uptime`、`pwd`、`id` 连续执行成功。
- 四命令 batch 完成，逐条返回输出和退出码。
- 慢重绘场景会等待有限预算；上下文仍不稳定时返回 `context_changed`，不发送下一条命令。
- 长输出可按游标分页读取，观察模式 attachment 会拒绝执行且 `sent=false`。
- 重复运行 Bridge 脚本时显示中文“已经在运行”提示，不再暴露 Python 端口异常。

测试成功不等于原生 SSH 等价。真实目标、客户端审批、SecureCRT 桌面行为和远端业务仍应在你的环境完成验收。

## 安装（Windows）

### 1. 下载并校验

从 [最新 Release](https://github.com/seaworld008/securecrt-mcp/releases/latest) 下载 Windows x64 ZIP，同时下载 `SHA256SUMS`，在 PowerShell 中校验：

```powershell
Get-FileHash .\securecrt-mcp-0.4.0-x86_64-pc-windows-msvc.zip -Algorithm SHA256
Get-Content .\SHA256SUMS
```

Release 包含可执行文件、许可证、中文说明和对应版本的 SecureCRT Bridge。校验和用于发现传输损坏，不代替发布者身份验证。

### 2. 初始化 Bridge

解压后运行：

```powershell
.\securecrt-mcp.exe init
.\securecrt-mcp.exe paths
```

在 SecureCRT 中选择 **Script -> Run**，运行 `paths` 输出的 `securecrt_bridge.py`。首次启动会显示中文提示；点击“确定”后运行：

```powershell
.\securecrt-mcp.exe doctor
.\securecrt-mcp.exe doctor --latency
```

如果重复点击脚本，提示“SecureCRT MCP 已经在运行”即可，不需要再次启动。需要重启时先确认没有活动或未决命令，再停止脚本或重启 SecureCRT。

### 3. 升级

普通升级不要使用 `init --force`：

```powershell
git pull --ff-only origin main
cargo build --locked --release
.\target\release\securecrt-mcp.exe upgrade
.\target\release\securecrt-mcp.exe doctor --offline
```

`upgrade` 保留现有 Token、策略和自定义拒绝规则，并备份被替换的 Bridge。升级后必须重新运行安装目录中的 Bridge；旧脚本已加载在内存中时，仅替换文件不会改变运行版本。

## MCP 客户端配置

生成 Codex 终端工具配置：

```powershell
.\securecrt-mcp.exe codex-config --toolset terminal --approval-mode prompt
```

将输出合并到现有 Codex 配置，不要覆盖其他 MCP。Claude Code 示例：

```powershell
claude mcp add --transport stdio --scope user securecrt -- `
  "C:\Tools\securecrt-mcp.exe" serve
```

客户端权限模式由操作者选择。生产环境建议先使用 `prompt` 完成拒绝路径验收，再按组织策略启用更宽松的客户端审批模式。

## 日常操作路径

1. `securecrt_list_sessions` 列出会话，核对标题、目标和当前屏幕。
2. 对确认无误的 Tab 调用 `securecrt_attach`，保存返回的 `attachment_id`。
3. 复用同一个 attachment 调用 `securecrt_exec`；多步诊断使用 `securecrt_exec_batch`。
4. 每次检查 `state`、`sent`、`exit_code`、`error_code`、输出游标和审计字段。
5. 长日志使用 `securecrt_shell_open/read`；需要停止远端前台程序时显式调用 `securecrt_interrupt`。

示例：

```json
{
  "attachment_id": "实际 attachment_id",
  "command": "hostname",
  "mode": "posix",
  "timeout_ms": 30000
}
```

```json
{
  "attachment_id": "实际 attachment_id",
  "commands": ["hostname", "uptime", "df -h"],
  "operation_id": "ops-check-20260922-001",
  "on_error": "stop"
}
```

Batch 不是事务，也不是永久授权；所有命令应在客户端第一次批准时明确列出。未知、超时、上下文变化和传输失败始终停止，不自动重放。

## 安全边界

- Bridge 只监听 `127.0.0.1`，使用随机 Token、请求 deadline 和消息大小上限。
- `client` 模式把日常命令审批交给 Codex/Claude 等客户端；内置规则只拦截少量关键破坏性命令，不是 Shell 静态分析器或沙箱。
- `shared`、`exclusive`、`observe` 是连接器协作模式，不是 SecureCRT 键盘锁。人工输入、重连和嵌套 SSH 目标仍需操作员确认。
- attachment 不等于永久授权；daemon 重启后不提供 exactly-once 保证。
- POSIX 完成标记只证明前台命令返回，不证明后台子进程终止。
- MySQL、pager、REPL、编辑器、密码框等非普通 POSIX 提示符应先读屏确认，不要直接发送 Shell batch。

完整定义见 [安全模型](docs/security-model.md)、[持久终端指南](docs/persistent-terminal.md) 和 [生产验收清单](docs/production-readiness.md)。

## 生产验收清单

- [ ] 在目标 SecureCRT 版本运行 `doctor`，确认 Bridge 版本和 capabilities。
- [ ] 在测试 Tab 中拒绝一次无害命令，确认客户端拒绝后 SecureCRT 没有输入回显。
- [ ] 在同一 attachment 上完成连续命令和一个小 batch。
- [ ] 验证一个慢重绘 Tab 会等待或安全返回 `context_changed`，不会重复执行。
- [ ] 明确区分普通 shell、MySQL/REPL、pager 和编辑器上下文。
- [ ] 为 daemon、审计目录和 Token 备份设置本机访问控制和备份策略。
- [ ] 先在非生产 Tab 验证，再开放生产会话。

## 文档导航

- [中文生产验收](docs/production-readiness.md)
- [持久终端与批量操作](docs/persistent-terminal.md)
- [安全模型](docs/security-model.md)
- [架构与协议](docs/architecture.md) · [Bridge 协议](docs/bridge-protocol.md)
- [性能与已知限制](docs/performance.md)
- [统一连接器与 OpenSSH/PTY](docs/connectors.md)
- [排障](docs/troubleshooting.md)
- [Codex](docs/clients/codex.md) · [Claude](docs/clients/claude.md)
- [发布流程](docs/releases.md)

## 开发与验证

```powershell
cargo fmt --all -- --check
cargo clippy --locked --all-targets --all-features -- -D warnings
cargo test --locked --all-targets --all-features
python -m pytest -q tests
python scripts/validate_repository.py
```

贡献方式见 [CONTRIBUTING.md](CONTRIBUTING.md)，安全问题请按 [SECURITY.md](SECURITY.md) 私下报告。

## 许可证

MIT License，详见 [LICENSE](LICENSE)。
