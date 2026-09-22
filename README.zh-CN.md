# securecrt-mcp

[![CI](https://github.com/seaworld008/securecrt-mcp/actions/workflows/ci.yml/badge.svg)](https://github.com/seaworld008/securecrt-mcp/actions/workflows/ci.yml) · [MIT](LICENSE) · [English](README.en.md)

**0.3.0-preview.2 · 持久终端性能预览版 · Bridge 协议 2**

让 Codex、Claude 等 AI Agent 操作 **SecureCRT 中已经登录好的服务器会话**。保留现有 VPN、堡垒机、SSH 密钥和 MFA 流程，不重新登录、不导出服务器凭证。

```text
Codex / Claude / MCP Client
           │ 常驻 stdio
           ▼
    Rust 会话与执行引擎
    attachments / batch / 增量输出 / 诊断
           │ 有界持久 NDJSON 连接池
           ▼
    SecureCRT 内置 Python 适配器
           │ 原生 crt 脚本 API
           ▼
    已登录的 SSH Tab
```

MCP 是连接与执行层，不是第二套 AI 审批系统。默认 `client` 模式允许常规操作，只保留狭窄的极高危防误操作过滤和用户自定义拒绝规则；命令批准由客户端配置，最终权限由服务器账号控制。项目独立于 VanDyke Software。

## 本版为什么更快

之前的主要开销不是多一个函数，而是逐行 RPC、每次新建 TCP、固定暂停、窗口级全局互斥和 CLI 每次重建 Engine。本版对应修改了这些层：

| 旧路径 | 新路径 |
|---|---|
| 每个 Bridge 请求新建 TCP | 4条有界持久连接通道，控制与输出读取分离，TCP_NODELAY |
| 每行日志返回一次 RPC | 按数量/时间预算批量读取原生缓冲，再按 UTF-8 块返回 |
| 每次有数据也暂停5ms | 有进展即继续，调用者使用通知唤醒 |
| 单个窗口只能一个 capture | 每个 Tab 独立执行、超时和未决状态 |
| 每条命令重新外部传 Token | attach 一次后使用 exec；普通 run 也合并准备和发送 |
| 超过64KiB单行直接未知 | 增量解析及分块，连续流提供滚动缓存和缺口标记 |
| CLI 退出丢失缓存 | 可选常驻 daemon，跨 CLI/Python/PowerShell 调用保留同一个 Engine |

同一测试环境，1600行/约200KB的已缓冲输出从约12.07秒降到56毫秒；20条短命令总计从约1.16秒降到0.18秒。**这是实际 Rust/TCP/适配器 + 模拟原生屏幕的连接器基准，不是实际 SSH、VPN 或模型端到端性能保证。** [完整方法和原始结果](docs/performance.md)。

## 安装和升级

需要 Rust 1.88 编译，以及能运行 Python 3 脚本的 SecureCRT。适配器只使用 Python 标准库，保持3.8语法兼容；兼容测试不意味着推荐过期运行时作为安全基线。

已有用户：先确认无活动/未决操作，停止已启动的 daemon，SecureCRT 中 Script → Cancel，退出占用旧程序的客户端，保留 SSH Tab。逐条执行，遇错停止：

```powershell
git status --short
git switch main
git pull --ff-only origin main
cargo build --locked --release
.\target\release\securecrt-mcp.exe upgrade
.\target\release\securecrt-mcp.exe doctor --offline
.\target\release\securecrt-mcp.exe paths
.\target\release\securecrt-mcp.exe codex-config --toolset terminal --approval-mode auto
```

本地修改先保存，不用强制 reset/clean。首次安装使用 `init`，普通升级不用 `init --force`。`upgrade` 保留配置/Token、备份被替换的适配器，并从当前 Rust 二进制释放相同版本脚本。

在 SecureCRT 中 Script → Run，运行 `paths` 返回的脚本；启动提示框点击 OK。然后：

```powershell
.\target\release\securecrt-mcp.exe doctor
.\target\release\securecrt-mcp.exe doctor --latency
```

确认运行中版本及 capabilities，不要只更新磁盘文件却继续运行旧脚本。macOS/Linux 使用 `./target/release/securecrt-mcp`。默认目录 `~/.securecrt-mcp`；可用绝对路径 `SECURECRT_MCP_HOME` 覆盖。适配器读取自身目录中的 bridge.json。

**现有安装保留原 mode。** 使用客户端主导模式时，只修改 MCP 自己配置中现有 `[policy]` 的 `mode = "client"`；不要覆盖 Codex 的其他配置，也不要清空自己配置的 custom_deny_patterns。

## 最短的日常路径

原生 MCP 的启动命令是 `securecrt-mcp serve`，让它持续运行。先 list、核实目标，然后：

```json
{"session":"实际会话句柄","mode":"shared"}
```

用上面的参数调用 `securecrt_attach`，取得 attachment_id。之后优先 `securecrt_exec`：

```json
{"attachment_id":"实际 attachment_id","command":"docker ps","mode":"posix","max_bytes":16384}
```

多步排查可用 `securecrt_exec_batch`：

```json
{
  "attachment_id":"实际 attachment_id",
  "commands":["hostname","uptime","df -h","docker ps"],
  "operation_id":"diagnostic-001",
  "on_error":"stop"
}
```

全部命令在客户端的同一个工具批准上下文中列出，每条有独立输出、退出码和审计记录。返回 batch_id 后查询 get_batch_status；不是每条再启动一个 CLI。非零退出可选择停止或继续，未知结果始终停止。

长日志使用 shell_open/read；结束捕获用 shell_close，需要 Ctrl+C 则明确 interrupt。输出按 UTF-8 字节游标读取，落后导致数据淘汰时明确报告 gap。`run_command` 和低层工具仍保留兼容。[持久终端完整指南](docs/persistent-terminal.md)。

## Codex / Claude

将 `codex-config --toolset terminal` 打印的增量配置合并到原文件，避免重复表名或遗留旧 enabled_tools 隐藏新工具。`auto|prompt|writes|approve` 由操作者选择；生成器不改文件，不伪装只读工具绕过确认。

Claude Code 可使用：

```powershell
claude mcp add --transport stdio --scope user securecrt -- "C:\Tools\securecrt-mcp.exe" serve
```

路径换成实际安装位置。详见 [Codex](docs/clients/codex.md) / [Claude](docs/clients/claude.md)。客户端权限和本地安全模式不能从文档自动获得，必须验证实际工具可见性和拒绝后的零发送。

## 独立 CLI 高频调用

原生 MCP 不需要 daemon。只有从 PowerShell/Python 反复独立调用 CLI、又要跨进程保留状态时，在独立终端显式启动：

```powershell
.\target\release\securecrt-mcp.exe daemon
```

另一个终端使用 `session attach|exec|output --input 文件.json`。旧 run/sessions/screen 也会优先使用已启动的 daemon。失败不会回退到新 Engine 重发。提供 [Python 客户端](clients/persistent_client.py) 和 [PowerShell 封装](clients/SecureCRT.Session.ps1)。daemon 和原生 MCP 是不同实例，不能混用它们的 attachment_id/command_id。

## 可靠性与权限边界

- 未知命令不自动重放，断线不自动 Ctrl+C，不自动 acknowledge_idle。连接重建只用于新的请求，不重试已失败交换。
- attachment 绑定原生 Tab，不是永久授权。shared/exclusive 是合作式所有权；exclusive **不是原生键盘锁**。人工输入只通过上下文采样检测，不能保证捕获全部按键。
- 配置端点指纹不是嵌套 SSH 的真实 Host Key；`authenticated_host_fingerprint` 返回 null。先核实目标。
- POSIX 完成标记代表前台命令返回，不证明后台派生进程全部结束。snapshot 仍不代表完成。
- command 状态、sent 三态、截断、游标缺口都要检查。原始交互写入需显式 allow_raw_send；碎片输入不能被当作完整 Shell 命令过滤。
- 只监听回环地址，随机 Token、消息大小和截止时间仍保留。同用户恶意程序、被盗 Token 不是隔离边界。

`client` 下允许 `rm -f /root/test.txt`、`rm -rf /root/test-dir`、grep 搜索文本和一般服务操作；极高危命令位置/目标如根目录清空、格式化、块设备写入、关机重启、防火墙清空仍被拒绝。它是有限防误操作规则，不是完整 Shell 静态分析或沙箱，动态脚本/别名等可能绕过。通过 `policy-check --input request.json` 查询实际原因，自定义规则仍可收紧。见 [安全模型](docs/security-model.md)。

## 原生限制和验证状态

所有 crt API 仍在 SecureCRT 脚本线程调用，多个静默 ReadString 可能增加排队时间；单次静默等待最多1秒，批量读取不等于原生 PTY 事件推送。没有为了跑分使用未验证的零/小数超时。原生返回字符串之前无法限制它的内部分配；持续流通过有界缓存明确报告丢失，而不是承诺无限保存。

历史实测：2026-09-20，preview.1 协议2在 Windows x64、SecureCRT9.0.0 x64、内嵌Python3.8.10上验证了已登录会话、读屏、POSIX hostname 和旧策略拒绝路径。**这是旧版的用户实测记录，不自动认证0.3或其他平台。** 新版真实桌面仍需完成 [升级与验收](docs/migration-0.3.md)。

CI 覆盖三平台 Rust/真实MCP stdio、适配器模拟接口、持久TCP、故障注入、daemon跨进程、PowerShell和打包检查。测试不会连接生产 SSH。没有 Release Tag 不代表已有公开预编译包；[发布流程](docs/releases.md)按验证通过的Tag执行。

## 开发

```sh
cargo fmt --all -- --check
cargo clippy --locked --all-targets --all-features -- -D warnings
cargo test --locked --all-targets --all-features
cargo build --locked
python -m unittest discover -s tests -v
python tests/mcp_smoke.py target/debug/securecrt-mcp
python tests/performance_smoke.py target/debug/securecrt-mcp
python tests/persistent_fault_smoke.py target/debug/securecrt-mcp
python tests/daemon_smoke.py target/debug/securecrt-mcp
python scripts/validate_repository.py
```

Windows 二进制加.exe；综合测试脚本需Python3.12，适配器单元测试还覆盖Python3.8。贡献指南见 [CONTRIBUTING](CONTRIBUTING.md)。

[架构](docs/architecture.md) · [协议](docs/bridge-protocol.md) · [性能](docs/performance.md) · [Agent](docs/agent-usage.md) · [验收](docs/testing.md) · [排障](docs/troubleshooting.md) · [路线图](ROADMAP.md)


## Audit durability / 审计持久化时机

`audit.durability = "os_buffered"` is the default for configurations omitting this new field. The append handle is reused and each write is flushed to the operating system before dispatch; write/open failures still reject before sending. It does **not** fsync every event and may lose recent audit records on OS crash/power loss. Choose `"each_event"` to restore synchronous event durability, accepting local disk latency. This is a durability/performance choice, not a change to client permissions. Configure it explicitly when upgrading under an existing audit-compliance requirement. Log rotation that replaces the file requires restarting the MCP/daemon to reopen the handle; copy-truncate retains the handle but has the usual rotation races.

默认省略新字段时使用操作系统缓冲，减少每次审计打开文件和同步刷盘的开销；这不保证断电时最近审计记录仍在磁盘。要求逐事件落盘时显式设置 `durability = "each_event"`。命令结果的 `timing.audit_dispatch_us` 用于区分审计开销和 Bridge/远端耗时。

After an owned completion marker, the attachment waits briefly for the original prompt/input column rather than adopting a marker line as a new prompt. A changed prompt (including `cd` that changes prompt text), partially typed command, or uncertain input context requires explicit inspection/re-attachment; it is not silently trusted.
