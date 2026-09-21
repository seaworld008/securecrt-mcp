# Agent 优先：一次调用执行命令

0.2.0-preview.2 的定位是已登录终端的连接层，不是第二套 AI 权限系统。MCP 客户端决定是否批准命令；本工具负责明确目标、一次发送、输出与状态。不要把模型对风险的判断误认为 MCP 已经验证了用户批准。

## 推荐路径

先调用 `securecrt_list_sessions`，选择并核实目标。后续常规排查优先调用：

```json
{
  "session": "从当前会话列表取得的句柄",
  "command": "docker ps",
  "mode": "posix",
  "timeout_ms": 30000,
  "max_bytes": 60000
}
```

高层工具自动完成新屏幕读取、一次性 Token、输入上下文检查、一次提交、等待和第一段输出。不需要模型手工复制 screen_token，也不需要对每个快速命令调用 status 和 output。

`mode` 必填。选择 `posix` 表示调用方已确认当前是空闲 POSIX Shell。常见 `$`、`#`、`%` 提示符可从当前行取得；这是启发式便利功能，不证明当前主机、Shell 或权限。非标准提示符传 `expected_prompt`，但仍需先检查终端。`prompt` 和 `snapshot` 必须明确传 expected_prompt；前者还需要 `wait_for`。不要用 POSIX 包装去回答密码提示、输入到编辑器/数据库 REPL/堡垒机选择菜单。

## 返回结果

一次运行的结果包含以下信息：

| 字段 | 语义 |
|---|---|
| `command_id`, `operation_id` | 已登记命令及操作身份 |
| `state` | starting / running / completed / rejected / timed_out / cancelled / unknown |
| `sent` | true：得到发送证据；false：尚未发送或明确拒绝发送；null：不能确认发送结果。必须同时查看 state。 |
| `exit_code` | POSIX 标记解析的退出码；不能得到时为 null |
| `text`, `next_cursor` | 首段输出及后续 UTF-8 字节游标 |
| `truncated`, `capture_may_be_incomplete` | 输出是否受限或捕获有不完整风险 |
| `requires_idle_ack` | 当前本地未决保护是否仍需要明确恢复 |
| `error_code`, `action` | 机器可读错误类别及下一步提示 |
| `remote_termination_confirmed` | false；结束标记或 Ctrl+C 都不证明所有派生远端进程终止 |

`timeout_ms` 是执行捕获预算（默认最多 30000ms，受本机配置约束）；`wait_ms` 只是本次工具调用的等待预算，0..60000ms。短等待返回 running，不取消、不重发。继续使用原 command_id 查询状态/输出。

`max_bytes` 是第一段输出大小（4..65536，默认16384），不是远端日志全量大小。后续页使用 `securecrt_get_command_output` 和返回的 next_cursor。不要按字符数自己计算游标。缓存默认每命令1MiB，最多32份结果；满时淘汰最旧已结束结果。操作去重记录不会随输出一起删除。

## 操作去重

operation_id 可以省略，工具生成并返回。需要对同一工具请求防止重复发送时，由客户端生成固定 ID。同一 MCP 进程内，同一 ID 和同一语义返回原任务；允许改变等待时间及输出页大小，不因内部屏幕 Token 改变而冲突。改变命令、目标、模式或执行预算会冲突。

同一 ID 已被拒绝时也会返回旧拒绝结果；确认零发送后要发起新的明确操作，使用新 ID。输出被淘汰后仍然不重发。缺失结果、连接错误或新 MCP 进程都不等于未执行。去重记录有4096条上限；重启前先确认没有活动/未决任务。不提供跨进程持久 exactly-once。

## 错误恢复

- `stale_screen` + rejected/sent=false：原生上下文在发送前变化。重新检查屏幕，然后由客户端决定新的明确操作；工具内部不自动重试。
- `stale_session`：重新枚举并核实目标，不按同名标题/下标偷偷替换。
- `input_context_required`：检查当前输入行；不要把密码框或 continuation prompt 当 Shell。
- `busy_unresolved`：先区分活动任务和未决任务。活动任务等待或明确中断；未决任务检查原终端，确认空闲后才调用 acknowledge_idle。
- `custom_deny_rule`：操作者自己配置的拒绝规则匹配了；用 policy-check 查看实际策略来源。
- `builtin_guardrail`：正在使用旧的 unrestricted/safe/allowlist 等本地过滤模式；不是 client 默认路径。
- 发送回执丢失或损坏：sent=null / unknown，不重新执行。原生 Send 抛异常也不表示零发送。

明确 acknowledge_idle 后，返回值的 screen 携带新的可用 Token，旧任务的未决标志也同步更新。历史 timed_out/unknown 状态和退出码不会被改写成成功。没有自动 acknowledge、自动 Ctrl+C 或未知结果重放。

## 客户端退出

普通 MCP stdin EOF 时，Rust 最多用两秒收集已经发送、即将完成任务的结果；不发送额外命令，也不自动确认空闲。强制终止进程、长任务超过收尾预算或连接不明时，Bridge 仍可能留下 unresolved。这是必要的结果不确定保护，不通过删除状态假装恢复。

一次性 CLI 会保持本进程直到所提交任务结束为本地终态；不要在拿到 running 后马上关闭这个进程。CLI 退出后其内存结果不可继续分页，持续排查优先使用原生 MCP。

## 将命令授权交给客户端

新安装默认：

```toml
[policy]
mode = "client"
allow_raw_send = false
allow_interrupt = true
custom_allow_patterns = []
custom_deny_patterns = []
```

升级保留旧配置。已有用户需要主动将 mode 改成 client；已有 custom_deny_patterns 不会被清空。client 不运行内置危险命令词表，普通读取和变更命令都交给客户端权限/远端账号控制。传输大小、会话绑定、一次性上下文、原始输入开关和审计仍是协议/连接保护，不是命令风险审批。

当前检查的旧默认源码不会因为 grep 的参数包含 deny 或 shutdown 而匹配内置危险规则。现场反馈未能在该默认规则下复现；本版通过明确区分自定义拒绝、旧内置过滤、有限只读模式，并提供 policy-check 来定位，不声称存在一个已证实的 grep deny 默认规则缺陷。

`codex-config` 默认给出 basic 工具集、approval_mode=auto。可选择 prompt、writes、approve 和 full 工具集；只打印增量配置，不覆盖文件。应根据实际客户端官方说明和本机验收决定权限配置。MCP 将 run_command 标为非只读、可能产生破坏性操作，不伪装成只读工具绕过客户端确认。

## 仍需本机验证

自动化使用真实 Rust MCP stdio 与模拟 Bridge，不连接生产系统。当前版本的实际 SecureCRT 原生对象生命周期、提示符显示时序、ReadString 输出行为，以及你的客户端拒绝审批后零发送，仍需在测试会话验证。原有 preview.1 Windows 实测记录保留，不被冒充为本版验证。
