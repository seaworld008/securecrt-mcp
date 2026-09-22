# 0.3.0 生产验收与运行边界

0.3.0 是 securecrt-mcp 的第一个稳定生产版本。它适用于在 SecureCRT 中复用已经登录的 SSH Tab，向 MCP 客户端提供可审计的读屏、命令执行、批量诊断和长输出读取。

稳定版的含义是接口、升级路径、失败保护和发布工件已经达到可运营标准；不表示 SecureCRT 原生脚本 API 变成了 SSH/PTY，也不替代客户端审批、远端权限和人工目标确认。

## 发布前证据

- Rust：fmt、严格 Clippy、锁定依赖测试和 release build。
- Python：适配器单元测试、MCP stdio、持久连接、daemon、故障注入、分页、批量和打包检查。
- Windows 桌面：SecureCRT 9.0.0 x64、内嵌 Python 3.8.10、真实 SSH Tab。
- 重启后实测三个 Tab：`php_test`、`php_dev`、`k8s-master1`；每个 Tab 的 `hostname`、`uptime`、`pwd` batch 均返回 3/3 完成结果。
- 长输出按游标分页读取成功；`observe` attachment 执行被拒绝且 `sent=false`。
- 慢重绘无法确认时返回 `context_changed`，不会自动重放或自动确认未决任务。
- 重复运行 Bridge 时返回中文“已经在运行”提示，不再把端口占用显示为 Python 堆栈。

真实桌面验收不替代 CI；CI 也不能证明每个 SecureCRT 版本、客户端审批 UI 或业务脚本的行为。

## 推荐上线流程

1. 下载 Release ZIP 与 `SHA256SUMS`，校验文件摘要。
2. 在测试机运行 `init` 或 `upgrade`，确认 `doctor --offline` 后再运行 SecureCRT Bridge。
3. 运行 `doctor`，确认 `bridge_version=0.3.0`、`protocol_version=2` 和预期 capabilities。
4. 在非生产 Tab 中拒绝一次无害命令，确认客户端没有输入回显和远端执行。
5. 在同一个 attachment 上执行 `hostname`、`uptime`、`pwd`，再执行一个小 batch。
6. 验证审计目录、Token、daemon 配置和 Bridge 备份的本机访问权限。
7. 确认 MCP 客户端、SecureCRT 和远端账号的变更窗口，再开放生产 Tab。

## 启动与重复启动

Bridge 是 SecureCRT 脚本，不是独立 Python 服务。首次运行 `Script -> Run` 会在回环端口启动服务并显示中文提示；即使当前没有登录或打开远端 Tab，也会先启动监听，此时 `list_sessions` 返回空数组，后续登录后自动发现会话。再次运行同一脚本时，如果端口已由旧实例占用，会显示“SecureCRT MCP 已经在运行”，不会重复监听，也不会发起新的 SSH 连接。

如果 SecureCRT 菜单中的 `Script -> Cancel` 不可用，直接重启 SecureCRT 是可靠的脚本生命周期清理方式。替换磁盘上的 Bridge 文件不会替换已经加载在 SecureCRT 内存中的旧脚本；升级后必须重新运行脚本，必要时重启 SecureCRT。

## 必须保留的边界

- `shared`、`exclusive`、`observe` 是连接器协作模式，不是操作系统级键盘锁。
- 屏幕和光标是采样结果；两次采样之间的人工输入、重连或嵌套 SSH 目标不能被完全证明不存在。
- `completed` 证明前台命令结束标记已解析，不证明后台派生进程结束。
- `context_changed`、`capture_timeout`、传输失败和未知状态必须先检查原始 Tab，再决定是否重新 attach；禁止自动重放。
- MySQL、REPL、pager、编辑器和密码框不是普通 POSIX shell。先读屏确认，再决定是否使用专用交互流程。
- daemon、审计记录和输出缓存不是跨重启 exactly-once 数据库。
- 默认危险命令过滤是狭窄的防误操作层，不是完整 shell 静态分析器或沙箱；客户端审批和远端最小权限仍是主控制面。

## 出现异常时

先停止继续发送命令，读取同一个 Tab 的新 screen token，查看 command/batch status 和 `requires_idle_ack`。只有确认原始终端确实空闲后，才使用 `acknowledge_idle`。不要因为响应丢失就重试同一个 operation ID，也不要自动 Ctrl+C。

问题报告请提供版本、`doctor` 摘要、脱敏后的状态字段和复现命令类别；不要上传密码、Token、私钥、完整业务日志或生产数据。
