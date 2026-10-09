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

安装会保留客户端审批设置。`codex-config --toolset terminal --approval-mode prompt` 仅打印可选配置块，不要用它覆盖已有限制。客户端拒绝且未发送的路径必须在真实环境验收，见 [Codex](clients/codex.md)（[English](clients/codex.en.md)）或 [Claude](clients/claude.md)。构建、配置写入和 doctor 不能证明真实命令完成或审批行为。公开报告不得包含令牌、端点、用户名、句柄或已有终端历史。
