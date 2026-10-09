# Agent 的统一会话工作流

安装见[一键安装](installation.md)，持久调用见[持久终端](persistent-terminal.md)。公开MCP工具仅为 `connector_*`，不要使用旧 `securecrt_*` 或 `run_command` 工具名。Rust CLI 的 `run` 是另一个手工调试入口。

先 `connector_list` 确认真实目标、后端和空闲屏幕，再 `connector_open`：

```json
{"backend":"securecrt","target":"当前列表的不透明目标ID","mode":"exec"}
```

Mac执行附件绑定会通过原生API选择这个已核对Tab，再读取稳定上下文；不发送探测命令。把返回的 `session_id` 用于所有后续调用，不拿Tab序号或同名目标代替。

```json
{"session_id":"返回的session_id","command":"printf 'CHECK_OK\\n'","mode":"posix","timeout_ms":10000,"wait_ms":1000,"operation_id":"explicit-check-001"}
```

只有确认空闲POSIX shell时使用`posix`；密码框、菜单、编辑器、数据库REPL和pager不是该模式。返回`running/starting`继续查询原`command_id`，不重发。`wait_ms`是本次等待时间，`timeout_ms`是捕获预算，两者不能混为远端任务重试。

| 字段 | 解释 |
| --- | --- |
| `state` | starting/running/completed/rejected/timed_out/cancelled/unknown |
| `sent` | true有发送证据；false零发送；null不能确认，必须结合state |
| `exit_code` | 实际POSIX结束标记的退出码；未知不伪造0 |
| `text` / `next_cursor` | 已保留输出和UTF-8字节分页游标 |
| `truncated` / `capture_may_be_incomplete` | 输出有界或捕获风险，不隐瞒缺失 |
| `requires_idle_ack` | 未决保护尚需显式空闲恢复；已ack的取消结果不能被晚到轮询重置 |
| `error_code` / `action` | 错误阶段与下一步提示 |
| `remote_termination_confirmed` | false；前台结束/Ctrl+C都不证明所有远端后代结束 |

同一MCP进程同一operation ID和语义返回原任务，不重复发送；改变目标、命令或模式会冲突，输出淘汰也不重发。重启MCP不是跨进程永久去重。拒绝后只有明确检查零发送才发起新的不同ID操作。

批量使用 `connector_exec_batch`，命令在调用时全部列明（最多20条），再查询 `connector_get_batch_status`。每条保留command_id、输出和退出码。不确定结果、上下文拒绝、超时必须停止后续，即使 `on_error=continue`；该选项只允许确认完成的非零退出后继续。

恢复先检查原Tab及前台命令已结束，获取 `connector_read_screen` 的新鲜令牌，显式调用 `connector_acknowledge`，提供`confirmed_idle=true`、`screen_token`和精确`expected_prompt`。旧附件作废后重新绑定；历史超时/未知/取消状态不改写成成功。没有自动ack、Ctrl+C、重放或后端切换。

MCP退出时只在有界预算内收尾已经发送的任务，不追加输入，不自动终止远端进程。一次性CLI不能作为长期分页缓存；持续状态使用同一个MCP或显式daemon。

安装保留客户端已有审批设置，不自动放宽。`codex-config --toolset terminal --approval-mode prompt`只打印可选增量配置，实际拒绝后零发送须在所用客户端验收。屏幕与输出可能包含秘密，公开回执不得包含地址、用户名、Token、会话ID或已有历史。
