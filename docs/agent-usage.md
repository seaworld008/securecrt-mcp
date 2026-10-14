# Agent 会话工作流

[简体中文](agent-usage.md) · [English](agent-usage.en.md) · [文档地图](README.md) · [安装说明](installation.md) · [安装提示词](agent-setup.md#中文提示词) · [连接器契约](connectors.md)

使用公开 MCP 工具 `connector_*`；旧的 `securecrt_*` 和 `run_command` 工具未注册。Rust CLI 的 `run` 是独立的手工调试入口。保持同一个 MCP 连接，以保留状态和分页输出；可选 daemon 的用法见[持久调用](persistent-terminal.md)。

<a id="discover-and-bind-before-input"></a>

## 输入前先发现并绑定

`connector_list` 发现实际目标，但不授予执行权限。核对后端、标题和**明确获准的测试目标**。尚未确认空闲状态时，通过原生 UI 或观察附件检查原终端。不要凭标题推断空闲，也不要把所有已连接 Tab 当作测试环境。

`connector_open` 示例（将 target 替换为当前列表中的不透明 ID）：

```json
{"backend":"securecrt","target":"opaque-target-from-current-list","mode":"exec"}
```

Mac 执行绑定会选择已核验的原生 Tab 并采样稳定上下文，不发送探测命令。观察附件不会切换焦点或输入。保留返回的 `session_id`，后续调用都使用它，不要用 Tab 编号或同名目标代替。

绑定后，用返回的 `session_id` 调用 `connector_read_screen` 检查当前屏幕。只有已明确授权且核实为处于空闲状态的 **POSIX shell**，才使用 `connector_exec`：

```json
{"session_id":"returned-session-id","command":"printf 'CHECK_OK\\n'","mode":"posix","timeout_ms":10000,"wait_ms":1000,"operation_id":"new-unique-operation-id"}
```

上述值是占位符，不能作为可重复使用的真实句柄或 operation ID。密码提示、菜单、编辑器、数据库 REPL 和分页器都不是 POSIX 命令边界。`running` / `starting` 表示应查询原 `command_id`，不要重新发送。`wait_ms` 是本次等待时长；`timeout_ms` 是捕获预算，不是重试远端工作的许可。

<a id="interpret-the-receipt"></a>

## 理解回执

| 字段 | 含义 |
| --- | --- |
| `state` | starting / running / completed / rejected / timed_out / cancelled / unknown |
| `sent` | true：有发送证据；false：未发送；null：无法确认送达，应检查状态 |
| `exit_code` | 真实 POSIX 完成标记；未知时绝不伪造为零 |
| `begin_marker_observed` / `end_marker_observed` | 仅来自本次捕获流，不能用历史屏幕补造 |
| `execution_state` / `capture_state` | 前台完成证据与正文捕获状态分别报告；完成仍可能缺正文 |
| `dropped_retention_bytes` | 已观察但未保留的字节数，不包括无法计量的原生丢失 |
| `text` / `next_cursor` | 保留的输出与按 UTF-8 字节分页的游标 |
| `truncated` / `capture_may_be_incomplete` | 保留上限或捕获风险；明确标记输出可能缺失 |
| `requires_idle_ack` | 未解除的互锁需要显式恢复；延迟轮询不得重置已经确认的取消状态 |
| `error_code` / `action` | 失败阶段与下一步建议 |
| `remote_termination_confirmed` | false；前台完成或 Ctrl+C 不能证明所有远端子孙进程都已结束 |

在同一 MCP 进程内，相同 operation ID 和语义会返回原任务，不会再次发送。更改目标、命令或模式会产生冲突；输出过期不授予重放权限。这不提供跨重启的永久去重。拒绝后，先确认未发送，再获得授权，以不同 ID 发起新操作。

`connector_exec_batch` 必须在调用时列出所有预定命令（最多 20 条），并用 `connector_get_batch_status` 查询。每条命令有自己的 command ID、输出和退出码。结果不确定、上下文拒绝或超时都会停止后续条目，即使设置了 `on_error=continue`；该选项仅适用于已确认完成且退出码非零的命令。

<a id="stop-and-inspect-uncertainty"></a>

## 遇到不确定结果时停止并检查

检查原 Tab，确认原前台命令已结束。只有获得明确恢复授权后，才获取新的 `connector_read_screen` token，并用 `confirmed_idle=true`、`screen_token` 和精确的 `expected_prompt` 调用 `connector_acknowledge`。不要自动判定空闲。失效附件需要重新绑定；历史 timeout/unknown/cancelled 结果仍保持原状态。

不会自动确认空闲、发送 Ctrl+C、重放或切换后端。MCP 断开连接后，在有限预算内继续收尾已发送任务，不额外输入，也不自动终止远端工作。一次性 CLI 不是长期分页缓存；应使用同一 MCP 进程或显式 daemon。

## 提示符恢复与最小读屏

当前 Windows 桥接支持 `connector_restore_prompt`。前提是同一 owner/附件已经可靠捕获本次 POSIX 完成标记、没有 active/unresolved 命令，并且操作者确认原 shell 空闲。先读取新屏幕，再用原提示符恢复：

```json
{"session_id":"returned-session-id","context_only":true}
```

上述参数用于 `connector_read_screen`，只省略返回的屏幕正文；token 仍校验完整原生帧。也可用 `tail_lines=8`、`max_bytes=4096` 控制尾部正文。返回 token 到期时间和省略字节数；新读屏会替换该会话的旧 token。

```json
{"session_id":"returned-session-id","confirmed_idle":true,"screen_token":"fresh-token","expected_prompt":"original exact prompt"}
```

上述参数用于 `connector_restore_prompt`，仅在空白输入行、光标列 1、原宽度未变时发送一次 Enter。密码、分页器、输入中的命令、resize、其他 owner、失效 token、未知前台状态均拒绝。恢复失败会保留互锁，不能再次发送恢复按键；恢复不终止后台任务。已有正常提示符不发送按键。Mac/旧桥接不支持时在发送前拒绝。

当前 Windows 枚举 lease 为 120 秒、screen token 为 30 秒、attachment 为 600 秒；这些是当前实现值。有效 owner attachment 的操作和 capture poll 会重新核实真实对象并续期，heartbeat 不会延长 screen token。重连、端点/标题/索引变化仍拒绝；附件失效需要重新枚举和绑定。

## 捕获、脚本和后台工作

Windows SecureCRT `ReadString` 超时会返回空串并消费未匹配数据。逐行有界批量读取保留开始标记和已完成行；无换行文本若跨原生等待超时仍可能缺失，`capture_may_be_incomplete=true` 明确披露。退出码以本次标记为准，不能把空正文或屏幕历史当作完整日志。Windows 捕获保留原生 API 返回的 ANSI 文本；这仍是 SDK 文本，并非 SSH 原始字节。`structuredContent` 提供直接可读字段，同时保留兼容文本 JSON。

JSON-RPC stdio 客户端应使用无 PTY 的管道；stdout 只承载协议，诊断写 stderr。本地 PTY 回显、换行和 ANSI 展示不能当作远端重复执行。

```json
{"session_id":"returned-session-id","command":"printf 'checked UTF-8 output\\n'","mode":"posix","prefer_native_log":true}
```

Windows 可通过上述显式选项请求同一已登录终端的原生日志捕获。SecureCRT 返回 `capture_transport=native_raw_log`，按 UTF-8 增量读取原始日志；Xshell 返回 `native_session_log`，保留原有日志格式，增量解码 UTF-8 或带 BOM 的 UTF-16。两者避免逐行 SDK 调用及滚动缓冲边界；完成仍要求本次精确开始/结束标记。已有用户日志保持原样，SDK 不支持或发送前失败且完整回滚时回退到原捕获路径。发送后失败不切换传输或重放。Mac 与其他模式保留原路径；默认不开启此选项。批次也可以在 `connector_exec_batch` 上明确设置此选项。

临时日志会把命令回显和输出写到本地私有 IPC 实例目录，单次最多读取 16 MiB；不要对含密码或其他秘密的命令开启。正常结束、超时及 watchdog 会关闭日志并恢复脚本的日志路径偏好/屏幕设置，Rust 读取最终刷新后清理自己的文件。操作系统/终端进程强杀或主机跳过脚本清理时仍可能残留文件或日志状态；重载必须先确认原测试终端空闲并检查日志状态。不会保存会话配置，也不会读取/停止用户已开启的日志。Xshell 的 SDK 查询值记录最后实际日志文件名，关闭后可能仍显示本次文件名；这与脚本路径偏好和持久配置不同，不会为了恢复查询值重新开启用户日志。编码错误会替换并明确报告可能不完整。Xshell 要求终端处于 UTF-8 模式，保留日志格式设置；时间戳等前缀如果改变标记行，可能无法确认完成。屏幕回退路径在锚点滚出缓冲后报告不确定，不清空历史或重试。

可选 [脚本传输辅助模块](../clients/script_transport.js) 在已有附件上执行有界分块命令：规范 UTF-8/LF、受限 0600 暂存、SHA-256 校验后同目录原子替换，最多 1 MiB。调用者明确选择目标路径并允许覆盖；上传完成不等于执行完成。不上传密码；审计应保持默认 `include_command_text=false`。Base64 分块仍有终端回显，不能宣称它是隐蔽传输。遇到不确定结果立即停止，不自动重新上传或发送清理命令；按返回的 staging_path 检查和清理。

目标 shell 需要 `base64`，摘要使用 `sha256sum` 或 `shasum -a 256`；兼容 GNU/Linux 与 macOS 的文件权限命令。校验从标准输入读取文件，不依赖带反斜杠文件名的摘要输出格式。

后台任务应重定向整个启动组合，例如：

```sh
(nohup sh -c 'first-command && sh /approved/task.sh' </dev/null >/approved/task.log 2>&1 &)
```

`first-command && nohup task &` 会把整个 AND 列表放后台；只给最后一个子命令加重定向不足以隔离其他输出。使用唯一任务目录，将最终退出码写入临时结果文件后原子改名，并单独查询它和任务日志。前台包装器退出 0 只证明启动包装器结束；PID 存在或日志不增长不能证明任务完成。

安装会保留客户端审批设置。`codex-config --toolset terminal --approval-mode prompt` 仅打印可选配置块，不要用它覆盖已有限制。客户端拒绝且未发送的路径必须在真实环境验收，见 [Codex](clients/codex.md)（[English](clients/codex.en.md)）或 [Claude](clients/claude.md)。构建、配置写入和 doctor 不能证明真实命令完成或审批行为。公开报告不得包含令牌、端点、用户名、句柄或已有终端历史。
