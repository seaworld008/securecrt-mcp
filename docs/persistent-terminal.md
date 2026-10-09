# 持久 MCP、批量和可选 daemon

当前安装见[一键安装](installation.md)，统一参数见[连接器](connectors.md)。Rust复用同一Engine、附件和命令缓存；Windows采用JScript文件IPC，Mac只有最小Python原生层，客户端/工具均为JS/Rust。

## 已登录桌面 Tab

`connector_list`确认目标 → `connector_open`显式绑定 → 多次`connector_exec`或一次`connector_exec_batch` → `connector_read`分页 → `connector_close`。

```json
{"backend":"securecrt","target":"明确目标ID","mode":"exec"}
```

后续请求使用返回的`session_id`：

```json
{"session_id":"返回的session_id","command":"hostname","mode":"posix","timeout_ms":10000,"wait_ms":1000}
```

Mac执行附件绑定会原生选择目标Tab并核对稳定屏幕；观察附件不聚焦也不发送。没有原生键盘锁，不与人工在同一Tab同时输入。上下文、连接代际和租约变化均拒绝，不改绑同名/同索引会话。

## 完成和输入边界

POSIX结束标记证明本次前台命令完成，不表示提示符已完全渲染。Mac的单行`Get2`也会追加行换行符，原生前缀读取去掉合成CR/LF而保留提示符尾空格；完成捕获读取这个完整原始前缀，以排空同步显示前缓冲。新命令仍要求原提示符、原光标列、原终端宽度连续两次一致，才允许重定位由本工具输出造成的行变化。

Get2会推进原生渲染，光标在文本读取后取样；全文屏幕令牌需要一致帧。初次绑定跨native yield稳定输入边界。500ms快速就绪预算仅在空行、本次精确marker或原光标未归位等安全过渡时延长一次至1.5s；半条输入、光标越过原边界的空格、不同提示符、密码/pager/REPL、resize均拒绝。没有探测Send、重放或自动确认空闲。

未取得本次POSIX完成证据、timeout、unknown、snapshot等不获得完成后的rebase权限。输入拒绝是`sent=false`，与已发送命令捕获超时分开记录。

## Batch 和分页

```json
{"session_id":"返回的session_id","commands":["hostname","uptime","pwd"],"operation_id":"diagnostic-batch-001","on_error":"stop","timeout_ms":10000}
```

最多20条明确命令，每条独立输出、退出码和command_id；`continue`只允许确认完成的非零退出。上下文拒绝、不确定或超时永远停止后续。完整已保留输出用 `connector_read` 的 `command_id/cursor/max_bytes`分页，不自行按字符计算字节游标。`truncated/gap`必须报告，不把屏幕当完整日志。

## OpenSSH PTY

桌面Tab不是PTY。交互流显式`connector_stream_open`（`backend=openssh`、`target`为已有ssh_config别名、`mode=pty`），返回`session_id`。读流接口的参数名为`command_id`，在PTY路径传入这个返回的会话句柄：

```json
{"command_id":"打开PTY返回的session_id","cursor":0,"max_bytes":16384,"wait_ms":1000}
```

`connector_stream_write`使用`session_id/text/append_enter`，`connector_resize`使用`session_id/rows/cols`。原始交互输入由客户端和远端权限控制，不冒充完整Shell命令过滤。结束会话使用`connector_close`；显式中断用`connector_interrupt`，不声称所有远端进程已结束。输出是有界ring，落后时报告gap；非法UTF-8包含有损预览与base64原始字节。

## 可选 daemon

MCP本身已经常驻。仅频繁从CLI/JS/PowerShell跨进程调用时，在单独终端显式执行：

```sh
securecrt-mcp daemon
securecrt-mcp session attach --input attach.json
securecrt-mcp session exec --input exec.json
securecrt-mcp session output --input output.json
securecrt-mcp daemon --stop
```

使用安装输出的绝对二进制路径。daemon保持前台，认证loopback端点由私有文件保存。已有daemon失败不会自动退回新Engine重新发送。不把不同MCP/daemon的句柄混用，不承诺跨重启永久exactly-once。

JS可选使用[persistent_client.js](../clients/persistent_client.js)：

```js
const { SecureCRTClient } = require('../clients/persistent_client.js');
const client = new SecureCRTClient();
const sessions = await client.sessions(); // Read-only; choose an explicit target.
```

PowerShell可点加载[SecureCRT.Session.ps1](../clients/SecureCRT.Session.ps1)。普通用户不需要Node客户端；Rust CLI和原生MCP可直接使用。每次权限决定来自客户端设置，不从附件寿命推导永久授权。
