# securecrt-mcp

[![CI](https://github.com/seaworld008/securecrt-mcp/actions/workflows/ci.yml/badge.svg)](https://github.com/seaworld008/securecrt-mcp/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Rust](https://img.shields.io/badge/Rust-1.88%2B-orange.svg)](https://www.rust-lang.org/)

英文版（可选）：[README.en.md](README.en.md)

> 让 Codex、Claude 等 AI 通过 MCP **直接查看和操作 SecureCRT 中已经登录好的 SSH 会话**，而不是重新保存一套 SSH 密码/私钥。

`securecrt-mcp` 是一个使用 Rust 编写的跨平台 MCP Server。它通过一个运行在 SecureCRT 进程内部的轻量 Python Bridge，访问 SecureCRT 已经打开的 Tab、读取终端屏幕并在经过本地安全策略检查后发送命令。

SecureCRT 继续负责：

- SSH 密码/私钥
- Jump Host / 堡垒机
- MFA
- Session 管理
- Host Key
- 终端模拟

`securecrt-mcp` 只负责：

- 枚举已经打开的 SecureCRT Tab
- 读取当前可见终端内容
- 聚焦指定 Tab
- 发送经过策略检查的单条命令
- Ctrl+C 中断命令
- 把结果返回给 MCP Client

## 为什么需要 Bridge

SecureCRT 的 `crt` 自动化对象只会注入到 **由 SecureCRT 自己启动的脚本** 中。普通外部 Python/Rust 进程拿不到 `crt` 对象，所以不能直接 attach 到你已经登录好的 SecureCRT 会话。

因此本项目采用：

```text
Codex / Claude / MCP Client
            │
            │ MCP stdio
            ▼
┌─────────────────────────────┐
│ securecrt-mcp               │
│ Rust                        │
│                             │
│ MCP Tools                   │
│ 安全策略                    │
│ 审计日志                    │
└─────────────┬───────────────┘
              │ 127.0.0.1
              │ Token + NDJSON
              ▼
┌─────────────────────────────┐
│ securecrt_bridge.py         │
│ 在 SecureCRT 内运行         │
│                             │
│ crt.GetTabCount()           │
│ crt.GetTab()                │
│ Screen.Get2()               │
│ Screen.Send()               │
└─────────────┬───────────────┘
              │
        已经登录的 SSH Tab
```

这意味着 **AI 不需要再次知道服务器密码、私钥和堡垒机认证信息**。

## 当前状态

当前是 **v0.1.1 早期预览版本**。架构和核心实现已经就位，但在正式宣称各平台完整兼容前，仍应在真实 SecureCRT 环境逐项验证。验证矩阵见 [docs/testing.md](docs/testing.md)。

当前已经包含：

- Rust MCP Server
- Windows / macOS / Linux 架构
- SecureCRT Python 3 Bridge
- localhost + 随机 Token 鉴权
- SecureCRT Tab 枚举
- 终端屏幕读取
- 指定 Tab 聚焦
- 命令执行
- Ctrl+C
- 默认安全命令白名单
- 高危命令拦截
- JSONL 本地审计日志
- Codex 接入文档
- GitHub Actions CI
- 开源项目文档结构

SecureCRT 是 VanDyke Software 的商业软件。本项目是独立开源项目，与 VanDyke Software 无隶属或官方合作关系。

## MCP Tools

| Tool | 功能 | 默认状态 |
|---|---|---|
| `securecrt_bridge_status` | 检查 Bridge 是否在线 | 允许 |
| `securecrt_list_sessions` | 获取当前 SecureCRT Tab | 允许 |
| `securecrt_read_screen` | 读取终端当前屏幕 | 允许 |
| `securecrt_focus_session` | 切换到某个 Tab | 允许 |
| `securecrt_execute_command` | 执行一条命令 | 安全白名单 |
| `securecrt_interrupt` | Ctrl+C | 允许 |
| `securecrt_send_text` | 任意文本/按键发送 | **默认禁用** |

## 快速安装

### 1. 编译

```bash
cargo build --release
```

Windows：

```text
target\release\securecrt-mcp.exe
```

macOS/Linux：

```text
target/release/securecrt-mcp
```

### 2. 初始化

```bash
securecrt-mcp init
```

会自动创建：

```text
~/.securecrt-mcp/config.toml
~/.securecrt-mcp/bridge.json
~/.securecrt-mcp/securecrt_bridge.py
```

其中 `bridge.json` 保存随机生成的本机认证 Token。

### 3. 在 SecureCRT 启动 Bridge

Windows 上 SecureCRT 9.0 需要兼容的 Python 3 运行时。若出现 `Unable to load the Python scripting engine`，安装 Python 3.8 x64 后完全退出并重新打开 SecureCRT，再运行 Bridge。

SecureCRT 中点击：

```text
Script -> Run...
```

选择：

```text
~/.securecrt-mcp/securecrt_bridge.py
```

Bridge 会一直运行。停止时使用：

```text
Script -> Cancel
```

### 4. 检查

```bash
securecrt-mcp doctor
```

正常会看到：

```text
bridge: OK
```

### 5. Codex 配置

Windows：

```toml
[mcp_servers.securecrt]
command = "C:\\Tools\\securecrt-mcp.exe"
args = ["serve"]
```

macOS/Linux：

```toml
[mcp_servers.securecrt]
command = "/usr/local/bin/securecrt-mcp"
args = ["serve"]
```

之后可以直接对 Codex 说：

```text
列出我 SecureCRT 当前已经登录的服务器。

检查 k8s-master01 上 jwxt-prod 命名空间所有 Pod，
如果有异常继续查看 describe 和 logs，只排查，不执行变更。
```

## Windows 首次使用完整流程

在 Windows 上建议按下面顺序执行，避免把 Bridge 运行在错误的 SecureCRT 窗口中：

1. 打开 SecureCRT，并在同一个窗口连接需要操作的服务器。
2. 在仓库根目录执行 `cargo build --release`。
3. 执行 `target\\release\\securecrt-mcp.exe init`。
4. 在 SecureCRT 当前已登录窗口选择 `Script -> Run...`，运行 `C:\\Users\\<用户名>\\.securecrt-mcp\\securecrt_bridge.py`。
5. 保持脚本运行，执行 `target\\release\\securecrt-mcp.exe doctor`，确认 `bridge: OK`。
6. 将 `target\\release\\securecrt-mcp.exe` 加入 Codex 的 `config.toml`，然后重启 Codex，让它重新加载 MCP 配置。

Bridge 只能看到**运行脚本的那个 SecureCRT 进程/窗口**中的 Tab。多个 SecureCRT 窗口需要分别运行 Bridge；同一窗口内的 Tab 会以 `tab:1`、`tab:2` 等稳定选择器返回。

## 日常使用方式

推荐先让 Codex 列出会话，再指定 `tab:<index>`，不要直接依赖易变的 Tab 标题：

```text
先调用 securecrt_list_sessions，确认当前两个会话及其 tab id。
读取 tab:1 和 tab:2 的屏幕内容，然后只执行只读巡检：hostname、uptime、df -h、free -h、ss -lntp。
不要重启服务、修改配置或删除文件。
```

Kubernetes 只读排查示例：

```text
使用 SecureCRT 的 k8s master 会话，执行 kubectl get nodes -o wide、kubectl get namespaces、kubectl get deployments -A 和异常 Pod 检查。
如果发现异常，再执行对应的 describe 或 logs；不要执行变更。
```

`securecrt_execute_command` 每次只发送一条命令。默认会等待短暂时间后读取可见屏幕；慢命令可指定 `timeout_ms`、`settle_ms` 或已知提示符的 `wait_for`。

## 文件操作验证与权限边界

默认 `safe` 策略是只读的，`touch`、重定向写入、`rm` 等命令会被拦截。需要验证写文件时，只为一次性测试文件增加精确的 `custom_allow_patterns`，完成后立即恢复为空；不要为生产路径添加通配规则，也不要把策略切换为 `unrestricted` 来绕过检查。

建议的验证顺序：

```text
1. ls -l /root/<唯一测试文件>                 # 确认不存在
2. touch /root/<唯一测试文件>                 # 创建
3. cat /root/<唯一测试文件>                   # 读取
4. echo <测试内容> > /root/<唯一测试文件>      # 修改
5. cat /root/<唯一测试文件>                   # 验证修改
6. unlink /root/<唯一测试文件>                # 删除
7. ls -l /root/<唯一测试文件>                 # 确认已删除
```

不要用真实业务文件、历史备份、`.ssh`、数据库文件或容器数据目录做 CRUD 测试。所有命令尝试都会写入 `~/.securecrt-mcp/audit.jsonl`（默认不记录完整命令文本）。

## 默认策略

默认：

```toml
[policy]
mode = "unrestricted"
allow_raw_send = false
allow_interrupt = true
```

权限批准由 Codex 的权限模型和操作者确认负责；MCP 只做本地桥接、审计和少量关键危险命令硬过滤。普通命令或脚本尽量原样发送，不在 MCP 内重复实现 Codex 的审批流程。

典型允许：

```bash
kubectl get pods -A
kubectl describe pod xxx -n prod
kubectl logs deployment/xxx -n prod
systemctl status nginx
journalctl -u nginx -n 200
ss -lntp
df -h
free -h
docker ps
docker logs xxx
```

典型禁止：

```bash
kubectl delete
kubectl apply
kubectl patch
kubectl rollout restart
systemctl restart
rm
mkfs
dd
iptables
firewall-cmd
docker exec
docker rm
```

如果显式选择 `safe` 模式，还会额外禁止：

```text
;
&&
||
|
>
<
`...`
$(...)
```

这适合需要严格只读的场景；日常使用默认 `unrestricted`，由 Codex 的权限确认和远端账号/RBAC 控制风险。

如果公司内部有固定只读脚本，可以通过 `custom_allow_patterns` 单独开放，而不是直接切到 unrestricted。

## 配置文件

```toml
[bridge]
host = "127.0.0.1"
port = 27855
connect_timeout_ms = 1500
request_timeout_ms = 35000
max_command_timeout_ms = 30000

[policy]
mode = "unrestricted"
allow_raw_send = false
allow_interrupt = true
custom_allow_patterns = []
custom_deny_patterns = []

[audit]
enabled = true
file = "audit.jsonl"
include_command_text = false
```

四种策略模式：

- `observe`：只能查看，不能执行命令。
- `safe`：内置 SRE 常用只读命令白名单，并禁止 shell 组合语法。
- `allowlist`：只允许你自己配置的正则规则。
- `unrestricted`：除少量硬性 deny 规则外原样发送命令；适合交给 Codex 做权限确认的日常使用。

默认硬过滤只覆盖高破坏性的核心命令：磁盘/分区破坏、关机重启、`dd`、服务启停、Kubernetes/Helm 变更、容器删除或停启、防火墙修改和账号权限修改。包管理、Git 写操作、下载、SQL/Redis 变更、提权和文件写入等可选规则只在文档中列举，默认不启用，用户可按环境加入 `custom_deny_patterns`。最终批准仍由 Codex 和服务器本身的账号/RBAC 控制。

可选危险规则示例（默认关闭，按需复制到 `[policy]`）：

```toml
custom_deny_patterns = [
  '(?i)^\s*(sudo|su)\b',
  '(?i)^\s*(apt|apt-get|yum|dnf|pip|npm|cargo)\s+(install|remove|update|upgrade)\b',
  '(?i)^\s*git\s+(push|reset|clean|rebase|checkout|switch)\b',
  '(?i)^\s*(curl|wget|aria2c)\b',
  '(?i)^\s*(mysql|psql|sqlite3)\b.*\b(insert|update|delete|drop|alter|truncate)\b'
]
```

## 审计

所有命令执行尝试会写到：

```text
~/.securecrt-mcp/audit.jsonl
```

内容包括：

- 时间
- 操作类型
- SecureCRT Tab
- 是否允许
- 策略判定原因
- 命令内容（可以关闭）

## 一个重要限制

Bridge 当前只能访问 **运行这个 Bridge 脚本的 SecureCRT 进程/窗口中的 Tab**。

这是有意的第一版设计。一方面更符合 SecureCRT 官方脚本模型，另一方面也减少了跨窗口自动控制造成的安全风险。

后续可以继续演进：

- 多 SecureCRT Window/Process Bridge 注册
- Prompt 自动识别
- Linux shell sentinel 模式
- Session 标签/分组
- 临时授权机制
- MCP elicitation 人工确认高危操作
- 命令流式输出
- 截图/终端结构化解析
- 更细粒度 RBAC
- Windows 安装包 / Homebrew / Cargo install
- 自动 Release 二进制

详细见 [ROADMAP.md](ROADMAP.md)。

## 开发验证

```bash
cargo fmt --all -- --check
cargo clippy --all-targets --all-features
cargo test --all-targets
python3 -m py_compile bridge/securecrt_bridge.py
```

## 文档

- [架构设计](docs/architecture.md)
- [安全模型](docs/security-model.md)
- [Bridge 协议](docs/bridge-protocol.md)
- [Codex 配置（中文默认）](docs/clients/codex.md)
- [Codex integration (English)](docs/clients/codex.en.md)
- [故障排查](docs/troubleshooting.md)
- [验证与兼容性](docs/testing.md)
- [Roadmap](ROADMAP.md)
- [贡献指南](CONTRIBUTING.md)

## License

MIT License。
