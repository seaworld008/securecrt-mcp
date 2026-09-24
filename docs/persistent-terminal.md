# 持久终端使用指南

适用版本：0.3.0。目标是复用 SecureCRT 已登录 Tab，减少连接器开销；不是创建第二条 SSH 连接，也不是修改 Codex/Claude 的权限。

## 推荐：原生 MCP 常驻进程

客户端只需启动 `securecrt-mcp serve` 一次。不要为每条命令重新启动它。连续排查使用：

1. `connector_list`：选择、核实目标。
2. `connector_open`：建立短期绑定，返回带后端前缀的 `session_id`。
3. 多次 `connector_exec`，或一次 `connector_exec_batch`。
4. 不再使用时 `connector_close`。这不会退出 SSH、杀进程或确认未决状态。

示例 attach：

```json
{"session":"实际会话句柄","mode":"shared","expected_prompt":"[user@test-host ~]$"}
```

`expected_prompt` 可以省略；省略时只对常见 POSIX 提示符提供启发式便利。它不是服务器身份认证。先核实堡垒机之后实际所在的机器，不要向菜单、密码框、编辑器或数据库 REPL 发送 Shell 命令。

连续执行：

```json
{"attachment_id":"实际 attachment_id","command":"docker ps","mode":"posix","timeout_ms":30000,"max_bytes":16384}
```

高层 `connector_exec` 支持一次性诊断；底层会使用合并后的 `prepare_and_begin`，连续工作建议复用返回的 `session_id`。屏幕读取和恢复使用统一的 `connector_read_screen`、`connector_acknowledge`。

## 命令完成后的提示符 readiness / rebase

`completed` 表示 Rust 已验证本次 POSIX 命令的结束标记，不表示 SecureCRT 已将下一次输入提示符完全重绘。0.3.0 将这两个时刻分开处理：原捕获的 `end(confirmed_complete=true)` 且带有该捕获自己的 completion marker、原生设置恢复成功时，才允许下一次 `prepare_and_begin` 使用有界的内部 readiness 检查。

先等待 **500ms**，同时服从该 Bridge 请求的剩余 deadline；如果期间只观察到空行、本次精确 marker 或原提示符光标尚未归位等安全过渡态，则只延长一次，整体最多 **1.5s**。每次使用 `crt.Sleep` 让出约 **10ms** 后重新采样。正常已就绪提示符只需一次采样间隔，不会无条件停满1.5s。必须连续两次观察到**原提示符文本、原输入光标列和原终端列数**一致，才能更新 attachment 的屏幕行位置。上一命令导致的滚屏可以改变 `cursor_row`；这不等于授权接受不同提示符，也不要求历史整页 digest 保持不变。

允许等待的过渡仅为：空输入行、本次捕获的精确结束标记行，或原提示符已经显示但光标仍未恢复到原输入边界。标记不是提示符。半行命令、提示符右侧额外输入（包括被文本去尾空白隐藏的空格）、密码/passphrase、pager、REPL、编辑器、其他捕获的标记、不同提示符或终端宽度变化，均不当成可恢复的就绪状态。采样到这些不确定内容就拒绝，不继续等待它被清除。等待中也会再次验证原 Tab 存活、绑定租约和请求 deadline。

整个过程只读屏并让出脚本线程，**不发送 Enter、空格、Ctrl+C 或任何探测命令**；不重新枚举/替换会话，不建立新的 SSH 连接，不自动重放被拒绝或结果未知的命令。超时的 readiness 请求返回 `state=rejected`、`sent=false`、`error_code=context_changed`；请求本身过期则报告过期。它不是远端命令执行超时，也不会把此前已完成的命令改成成功重试。终端后来稳定后，新的显式调用可以复用同一个 attachment；若提示符改变，需要检查原终端后重新 attach。

这一行为只对有本次已确认 POSIX marker 证据的完成生效。`unknown`、`timed_out`、`send_unknown`、snapshot、未决状态以及没有 marker 的完成，不获得重绘 rebase 权限。原低层 screen-token/digest 校验保持不变。

batch 的下一条命令使用同一 readiness 路径：上一条已确认完成且输入边界就绪才发送下一条；每条输出、退出码、command_id 和审计独立。`on_error=continue` 仅允许在确认完成的非零退出码后继续，**不会**跳过 `context_changed`、readiness 等待耗尽、未知结果、超时或未决状态。被拒绝的命令及它后面的命令不会被自动发送。

这仍是采样式协调，而不是原子键盘锁。shared 模式不能可靠发现两次采样之间所有人工输入，exclusive 也仍只是连接器之间的合作式独占，observe 不能写入。请勿在同一 Shell 同时人工键入和让 Agent 执行。500ms 是快速路径，1.5s 是安全过渡态的总主动等待上限，不保证 SecureCRT 原生 API 调用/桌面调度自身不会超时阻塞；本版不声称实现原生 PTY 或绝对 SSH 等价体验。

## 批量排查

```json
{
  "attachment_id":"实际 attachment_id",
  "commands":["hostname","uptime","df -h","docker ps","nginx -T"],
  "operation_id":"host-diagnostic-001",
  "on_error":"stop",
  "timeout_ms":30000
}
```

调用 `connector_exec_batch`，再用 `connector_get_batch_status` 查询 `batch_id`。最多20条命令，所有命令在第一次调用的批准上下文中明确列出；每条独立发送、审计、退出码和 command_id。每条内联输出最多1024字节；完整已保留输出按 command_id 分页读取。

`stop` 遇到非零退出码停止；`continue` 仅在确认完成且退出非零时继续。未知、超时、未决、传输失败始终停止。批量不是数据库事务，也不承诺排他占用整个远端 Shell；不要与人工或其他客户端在同一 Tab 交叉操作。

审批由客户端决定是逐个工具调用提示、信任会话还是其他权限策略。**一次 batch 授权覆盖列出的全部命令，并不等于每条都另弹一次窗口。** attachment 自身不给后续命令永久授权。

## 持续日志与交互输入

OpenSSH 的 `connector_stream_open` 接受和 exec 类似的参数，原样启动明确指定的长命令，立即返回 command_id：

```json
{"attachment_id":"实际 attachment_id","command":"tail -f /var/log/nginx/error.log","mode":"stream"}
```

随后调用：

```json
{"command_id":"实际 command_id","cursor":0,"max_bytes":16384,"wait_ms":1000}
```

这是 `connector_stream_read`。有增量数据即可返回，没有数据时可以等待；不会要求模型每秒发送一套 begin/end。它使用持续捕获和有界滚动缓存，**只适用于 OpenSSH PTY**。

游标为绝对 UTF-8 字节偏移。消费者落后时返回 `gap`、`dropped_bytes` 和实际 `cursor`，不能把有缺口的日志称为全量。已完成命令保留头部上限，stream 保留最新尾部上限；两者均明确标注截断。

`connector_stream_write` 是显式交互原始输入，默认仍需本机 `allow_raw_send=true`。键入碎片不是完整 Shell 命令，因此不能声称极高危命令过滤可以覆盖任意 REPL/编辑器输入。开启此能力就授予了这项更底层的控制，客户端应明确批准。

`connector_stream_close` 只停止本地捕获，**不发送 Ctrl+C**。需要打断远端命令时调用 `connector_interrupt`；之后检查原始终端，并明确 `connector_acknowledge`。不自动清除未知结果，不自动重试。

stream 默认捕获10分钟，受 `bridge.max_stream_timeout_ms` 约束（默认最大1小时）。这不是 SSH 连接寿命：捕获超时不自动终止远端进程。普通命令仍默认受 `max_command_timeout_ms` 限制。需要更长会话时让客户端在绑定空闲期间定期 heartbeat，而不是重复创建绑定。

## shared / exclusive / observe 的准确含义

- shared：合作式复用；发送前检查当前输入行/光标是否仍符合绑定上下文。不会在每条命令外部重新传 screen_token。
- exclusive：排除**其他连接器实例**对同一 Tab 的输入；不锁 SecureCRT 键盘、菜单、粘贴或其他应用。
- observe：此绑定不能用于 exec/写入。

三种模式不是远端账户权限。返回字段明确包含 `native_keyboard_lock=false`、`input_detection=sampled-context-only`、`authenticated_host_fingerprint=null`。配置端点指纹仅标识 SecureCRT 连接配置，不是嵌套 SSH 的不可伪造 Host Key。

原生 API 通过采样而不是键盘事件工作，无法证明两次采样之间没有人工输入、重连或目标变化。不要同时让人和 Agent 在同一 Shell 输入。检测到上下文变化时不发送，重新读屏、核实目标后重新 attach；不自动改绑同名 Tab。

## CLI / Python / PowerShell：需要时启用常驻 daemon

原生 MCP 已是常驻进程，**不需要为它另外开启 daemon**。频繁从 PowerShell/Python 调用 CLI 时，可在一个独立终端显式启动：

```powershell
.\target\release\securecrt-mcp.exe daemon
```

它保持前台运行，在回环地址监听，并使用用户目录内随机 Token 鉴权。另一个终端调用：

```powershell
.\target\release\securecrt-mcp.exe session attach --input attach.json
.\target\release\securecrt-mcp.exe session exec --input exec.json
.\target\release\securecrt-mcp.exe session output --input output.json
```

已有 `run/sessions/screen` 发现显式启动的 daemon 后也会使用它。**daemon 失败后绝不悄悄回退到新 Engine 再执行**。同一个 daemon 中会话、任务、输出分页和去重记录跨 CLI 进程保留；daemon 重启后不提供持久 exactly-once 保证。

Python 可以使用 [persistent_client.py](../clients/persistent_client.py)，不需要每次启动子进程。PowerShell 可点加载 [SecureCRT.Session.ps1](../clients/SecureCRT.Session.ps1)：

```powershell
. .\clients\SecureCRT.Session.ps1
$bin = (Resolve-Path .\target\release\securecrt-mcp.exe).Path
$list = Invoke-SecureCRTSession -Binary $bin -Action sessions
# 人工选择正确的 session，不默认取第一台生产服务器。
$attachment = Invoke-SecureCRTSession -Binary $bin -Action attach -Request @{
    session = '已核实的会话句柄'; mode = 'shared'
}
$result = Invoke-SecureCRTSession -Binary $bin -Action exec -Request @{
    attachment_id = $attachment.attachment_id; command = 'hostname'; mode = 'posix'
}
$result
```

停止前确认无活动/未决任务，运行 `daemon --stop`。异常结束遗留 daemon.json 时，先核实原终端，再用 `daemon --cleanup-stale`；仅在端口明确拒绝连接时删除本地端点文件，不清理远端任务或 Bridge 未决状态。

同一机器上原生 MCP 与独立 daemon 是不同 Engine。不要把一个实例的 attachment_id/command_id 交给另一个实例，也不要假设它们自动共享授权、缓存和会话所有权。

## 当前边界

不同 Tab 可以独立执行、独立超时和恢复，但所有 crt API 调用仍在 SecureCRT 脚本线程串行执行。静默 `ReadString` 可能等1秒，多个静默捕获可能互相增加等待；不能把并发任务支持等同于原生 API 真并行。高流量缓冲输出通过批量读取显著减少 RPC；真实桌面、终端显示、远端工具和模型延迟仍需本机测量。
