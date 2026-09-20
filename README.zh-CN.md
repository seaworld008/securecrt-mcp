# securecrt-mcp

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

当前是 **v0.1.0 早期预览版本**。架构和核心实现已经就位，但在正式宣称各平台完整兼容前，仍应在真实 SecureCRT 环境逐项验证。验证矩阵见 [docs/testing.md](docs/testing.md)。

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

## 默认安全策略

默认：

```toml
[policy]
mode = "safe"
allow_raw_send = false
allow_interrupt = true
```

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

`safe` 模式还默认禁止：

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

这样可以避免 AI 通过 shell 组合语法绕过只读命令限制。

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
mode = "safe"
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
- `safe`：内置 SRE 常用只读命令白名单。
- `allowlist`：只允许你自己配置的正则规则。
- `unrestricted`：除硬性 deny 规则外基本放开，不建议生产环境默认使用。

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
- [Codex 配置](docs/clients/codex.md)
- [故障排查](docs/troubleshooting.md)
- [验证与兼容性](docs/testing.md)
- [Roadmap](ROADMAP.md)
- [贡献指南](CONTRIBUTING.md)

## License

MIT License。
