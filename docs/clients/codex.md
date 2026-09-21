> **0.2.0-preview.2 update:** New installs use `client` policy (client-owned command authorization); upgrades preserve old settings. `run_command` is the preferred orchestration tool; low-level protocol-2 tools remain. See [Agent usage](../agent-usage.md). Earlier preview.1 approval/default-policy examples below are historical, not a change to existing settings. Actual desktop approval behavior is not certified by CI.

# Codex 接入与审批拒绝验收

先完成 [升级说明](../migration-0.2.md)。执行 `securecrt-mcp codex-config` 打印准确的二进制路径及增量 TOML；手动合并到现有配置，不覆盖其他 MCP/模型/插件设置。

生成配置将 `default_tools_approval_mode` 设为 `prompt`；仅会话状态、读屏、命令状态和分页输出设为 `approve`。执行、原始输入、中断和清除未决保护保持人工确认。配置项必须由实际安装的客户端支持；不认识键时应升级或按该版本文档配置，而不是静默取消审批。

官方参考（2026-09-20 检查）：https://developers.openai.com/codex/mcp/ 。客户端配置、组织策略和运行方式会影响审批行为；MCP annotations 不会替代客户端的安全执行器。

## “拒绝后零发送”人工验收

在非生产会话清晰显示的空闲 Shell 中，先读屏确认目标。要求 AI 提交无害且易辨认的 `printf securecrt-approval-check`，在客户端弹出的执行审批中选择**拒绝**。预期：SecureCRT 中没有该命令的输入回显，没有该操作的 `dispatch_attempt`（只读工具的调用不算命令发送），服务器侧没有执行。不要让 AI 自动重试。

重新发起一个新的操作 ID，这次选择允许。预期：看到一次命令输入、一个 command_id、一个 dispatch_attempt 和最终状态。再复查 Token/句柄过期与错误参数应在实际发送前拒绝。

如果没有弹窗或拒绝后仍发送，立即停止 MCP，只在 observe 模式继续诊断；记录客户端版本、脱敏配置和工具元数据。不能宣称“交给 Codex”就必然安全。当前仓库的 CI 只验证生成配置与元数据，不伪造你的客户端 GUI 验收。

## 使用提示

```text
读取明确的测试会话，确认主机和空闲 POSIX Shell。
请求我批准 uname -a，使用 mode=posix。
提交后查询 command_id 和分页输出；未知结果、超时和中断后停止，不重试、不自动清除未决状态。
```

只读输出也可能包含秘密。访问终端即授予相应数据读取能力，客户端的传输、记录和模型处理方式需要独立评估。

## 本次 Windows 实测

在 Windows x64、SecureCRT 9.0.0 x64、内嵌 Python 3.8.10 上，协议 2 流程已验证：重新枚举两个会话租约、读取一次性屏幕 Token、用 `mode = "posix"` 执行 `hostname` 并查询到 `completed`；`rm -rf` 在发送前返回 `rejected`。这不替代 Codex 客户端的“拒绝后零发送”人工验收，也不代表其他终端类型可以使用 POSIX 包装。
