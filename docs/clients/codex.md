# Codex 接入与审批

[一键安装](../installation.md)自动写入`mcp_servers.securecrt`的私有二进制绝对路径、`args=["serve"]`和所选目录的`env.SECURECRT_MCP_HOME`，保留其他配置、注释、现有审批和工具范围。安装后重新加载Codex，在空闲原生终端重载当前入口。

需要自行选择工具范围/审批时，运行：

```sh
securecrt-mcp codex-config --toolset terminal --approval-mode prompt
```

该命令只打印增量配置，不替代用户文件。生产权限由操作者/组织设置，安装器不修改既有审批。以实际客户端支持的配置键为准。官方[MCP配置](https://developers.openai.com/codex/mcp/)不等于真实审批拒绝已验收。

工具流程：`connector_list`核对目标 → `connector_open` → 同一`session_id`连续`connector_exec/connector_exec_batch` → 状态/分页 → close。Mac绑定执行附件会原生选择对应Tab，不发送探测输入。`backend`和目标必须明确，桌面会话只在确认POSIX提示符后使用posix模式。

## 拒绝后零发送

在专用空闲测试Tab发起新的无害`printf`操作，在客户端弹出的执行审批中拒绝。应没有终端回显、远端执行和该操作的dispatch_attempt。不要自动重试。再发起新的operation ID并批准，核对一次输入、一个command_id和最终结果。

没有弹窗或拒绝后仍发送时，停止执行并记录客户端版本与脱敏配置，不把MCP annotations或CLI权限当作审批证明。这项客户端UI验收独立于SecureCRT双Tab矩阵，不能由CI模拟替代。

屏幕/输出可能含秘密；不要公开Token、地址、用户名、会话句柄或已有历史。超时与未知先检查原Tab，显式中断/恢复只针对已跟踪任务。
