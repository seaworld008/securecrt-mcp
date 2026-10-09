# securecrt-mcp

[English](README.md) · [简体中文](README.zh-CN.md) · [文档地图](docs/README.md)

让 AI 助手通过你已经登录的 SSH Tab 工作。**securecrt-mcp** 是本机 Rust MCP Server，面向通过 **SecureCRT 或 Windows Xshell** 管理远端系统的用户，可接入 Codex、Claude 等 MCP 客户端。

[![CI main](https://github.com/seaworld008/securecrt-mcp/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/seaworld008/securecrt-mcp/actions/workflows/ci.yml?query=branch%3Amain)
[![最新发布](https://img.shields.io/github/v/release/seaworld008/securecrt-mcp?display_name=tag)](https://github.com/seaworld008/securecrt-mcp/releases/latest)
[![MIT](https://img.shields.io/badge/license-MIT-blue)](LICENSE)
[![Rust 1.88+](https://img.shields.io/badge/Rust-1.88%2B-orange)](Cargo.toml)

MCP 让 AI 客户端调用你电脑上的本机工具。桌面后端沿用终端已有的登录、VPN、堡垒机与 MFA 上下文，不导出 SSH 凭据、不另建 SSH 连接。可选 **OpenSSH** 后端会另建连接，使用系统 SSH 客户端、SSH Agent、配置和主机密钥。

- 发现 Tab、显式绑定目标，同一附件可连续执行命令或最多 20 条的批量任务。
- 跟踪命令状态、真实 POSIX 退出码、分页输出、超时和本地审计记录。
- OpenSSH 提供 exec / PTY 流，适合日志、分页器和 REPL；桌面后端捕获屏幕，并非原生 PTY。
- 客户端审批和远端账号权限由操作者掌握；结果未知时先检查，不自动重发命令或确认空闲。

## 开始使用

**[安装与升级](docs/installation.md)** · [Codex](docs/clients/codex.md) · [Claude Code / Desktop](docs/clients/claude.md) · **[Agent 安装提示词](docs/agent-setup.md)**

复制到 Codex、Claude Code 或其他具备本机工具的 Agent：

```text
请为我的 AI 客户端安装 https://github.com/seaworld008/securecrt-mcp。
先读官方当前 docs/agent-setup.md 和 docs/installation.md。
识别 OS、架构和终端，核对所选来源与摘要。
保留已有 MCP、审批、策略、令牌和 SSH 登录。
按对应客户端文档配置，并执行 doctor --offline。
获准后加载桥接；无法操作的原生 UI 步骤给我准确交接。
仅在明确授权的空闲 Tab 做无害验证，不自动判定空闲。
分别报告通过、失败和未测项，不把配置检查当作 SSH 执行证明。
```

### 选择平台和来源

以下是 **当前 main** 的路径。已测系统与精确证据见[支持矩阵](docs/support-matrix.md)，其他版本、架构仍需验证。

| 平台 / 后端 | 初始化后的原生入口 | 最终用户运行依赖 |
| --- | --- | --- |
| Windows / SecureCRT | 所选应用目录中的 `securecrt-mcp-securecrt.js` | 已安装 SecureCRT + 系统 JScript；无需 Python、Node、Rust |
| Windows / Xshell | Xshell Scripts 目录中的 `securecrt-mcp-xshell.js`；自定义应用目录时在 `xshell-scripts` 下 | 已安装 Xshell + 系统 JScript；无需 Python、Node、Rust |
| macOS / SecureCRT | 所选应用目录中的 `securecrt_bridge.py` | 已安装 SecureCRT + 它能加载的 Python 引擎；桥接仅用标准库 |
| Windows、macOS、Linux / 可选 OpenSSH | 显式选择 `openssh`，无需桌面桥接 | 系统 OpenSSH 与另行授权的 SSH 访问 |

本轮未验证 Linux 桌面 SecureCRT。**源码构建**需要 Rust 1.88+ 和平台链接器；Node 22 用于开发、测试和打包，不是已安装 Windows 终端的运行依赖。macOS 引擎兼容性由当前 SecureCRT 加载器决定，不能根据 shell 的 Python 版本推断。

**发布边界：** 公开 **v0.5.2** 的源码是 [`3c3489b`](https://github.com/seaworld008/securecrt-mcp/commit/3c3489ba267008af2e7bdcc09b0f890c56feb71b)，早于 `install` 和当前 Windows 自包含脚本。最新发布徽章不代表其 ZIP 含有这些功能。请核对包内文件及该包配套文档，不要混用旧二进制与当前适配器。

需要当前安装流程时，保留最新 main 源码及其配套文档，克隆后记录完整提交：

```sh
git clone --branch main https://github.com/seaworld008/securecrt-mcp.git
cd securecrt-mcp
git rev-parse HEAD
```

在 [main CI](https://github.com/seaworld008/securecrt-mcp/actions/workflows/ci.yml?query=branch%3Amain) 核对该提交的成功运行，再用 Rust 1.88+ 构建：

```sh
cargo build --release --locked
```

产物为 `target/release/securecrt-mcp`，Windows 为 `securecrt-mcp.exe`。也可在[成功的 main CI](https://github.com/seaworld008/securecrt-mcp/actions/workflows/ci.yml?query=branch%3Amain) 中核对提交、平台与架构，选择 `native-test-bundle-<OS>-<ARCH>` artifact。这些是测试包，并非公开 Release。内层 ZIP 使用随附 `.zip.sha256` 校验；Release 使用自己的 `SHA256SUMS`。检查方法见[安装说明](docs/installation.md)。

### 初始化、接入和验证

1. **Codex 用户：** 执行所选二进制的 `install`；仅在所选包确实包含时使用 `install.cmd` / `install.command`。它将二进制放入私有目录并增量更新 Codex 的 `securecrt` 条目，保留其他设置及既有审批/工具限制，不会配置所有 AI 客户端，也不改全局 PATH。
2. **仅 Claude 或其他客户端：** 执行所选二进制的 `init`，初始化桥接而不写 Codex 配置。向客户端注册稳定的**二进制绝对路径**、`args = ["serve"]` 和同一绝对路径 `SECURECRT_MCP_HOME`，见 [Claude 接入](docs/clients/claude.md)。
3. 用同一二进制和应用目录执行 `doctor --offline`。在明确授权的空闲终端，通过 **Script → Run** 加载 `paths` 显示的入口。SecureCRT 每个进程一次，取消要回到最初启动脚本的 Tab；Xshell 以实际发现范围为准。重新加载 AI 客户端，再运行对应后端的在线 doctor。
4. `connector_list` 发现会话，核对获准目标后用 `connector_open` 绑定，再用 `connector_read_screen` 检查屏幕。只有核实明确授权的空闲 POSIX 测试 Tab 后才执行无害 `printf`，检查 `state`、`sent`、`exit_code` 与输出。配置和 doctor 检查不能代替真实执行或客户端审批验收。

更新磁盘文件不会重载桥接。升级须等终端空闲，取消旧实例、加载固定入口、重启 MCP 并重新发现目标。常规升级保留令牌和策略，**不要使用 `init --force`**。详见[安装说明](docs/installation.md)、[Agent 工作流](docs/agent-usage.md)和[排障](docs/troubleshooting.md)。

## 深入阅读与贡献

[文档地图](docs/README.md) · [接口](docs/connectors.md) · [架构](docs/architecture.md) · [安全模型](docs/security-model.md) · [漏洞报告](SECURITY.md) · [支持策略](docs/support-policy.md)

开发从[贡献指南](CONTRIBUTING.md)和 [Agent 维护导航](docs/agent-maintenance.md)开始。[开发测试](docs/testing.md)与[桌面验收](docs/desktop-acceptance.md)区分自动检查和真实原生 UI、SSH、客户端审批证据。问题与脱敏报告可到 [GitHub issues](https://github.com/seaworld008/securecrt-mcp/issues)，漏洞请遵循 [SECURITY.md](SECURITY.md)。
