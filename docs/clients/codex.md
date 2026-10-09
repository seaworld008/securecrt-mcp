# Codex 接入与审批

[简体中文](codex.md) · [English](codex.en.md) · [安装说明](../installation.md) · [文档地图](../README.md)

## 自动安装或手工注册

当前 main 的 `install` 增量写入 Codex 的 `securecrt` MCP 二进制、参数和应用目录，保留其他配置、注释及既有审批/工具范围。若设置了绝对路径 `CODEX_HOME`，写入其 `config.toml`，否则使用用户的 `.codex/config.toml`。仅在缺失时添加启动/工具超时。公开 v0.5.2 没有此安装入口；v0.5.3 包含当前 main，先核对[来源](../installation.md#1-select-and-verify-the-source)。

手工接入时，将已校验二进制保留在稳定绝对路径，用所选应用目录执行其 `init`。先检查已有 MCP；若已有 `securecrt`，仅合并 command、args、home，不覆盖其他 env、审批或工具限制。

先看已安装客户端的 `codex mcp add --help`，替换所有示例路径：

```sh
codex mcp add securecrt --env SECURECRT_MCP_HOME=/absolute/path/to/app-home -- /absolute/path/to/securecrt-mcp serve
```

```powershell
codex mcp add securecrt --env "SECURECRT_MCP_HOME=C:\Tools\securecrt-mcp-home" -- "C:\Tools\securecrt-mcp.exe" serve
```

对应 Windows TOML（合并到当前生效配置，不另建无关文件）：

```toml
[mcp_servers.securecrt]
command = "C:\\Tools\\securecrt-mcp.exe"
args = ["serve"]

[mcp_servers.securecrt.env]
SECURECRT_MCP_HOME = "C:\\Tools\\securecrt-mcp-home"
```

macOS/Linux 将两处值换成 Unix 绝对路径，不用 `~` 代替二进制绝对路径。TOML 基本字符串和 JSON 中 Windows 反斜杠写成 `\\`，CLI 参数用普通 `\`。二进制、桥接和客户端使用同一应用目录，保证 GUI 冷启动也能找到它。

Windows 自定义目录时，终端进程也必须继承同一变量；Codex env 不会设置 SecureCRT/Xshell env。按[应用目录说明](../installation.md#2-choose-the-application-directory-and-client)处理，保留已有 SSH 登录。

二进制的 `codex-config --toolset terminal --approval-mode prompt` 只打印可选增量配置，不写用户文件。合并前检查输出和客户端支持；遵守操作者/组织设置，不用生成默认值覆盖已有审批。见[官方 MCP 配置](https://developers.openai.com/codex/mcp/)。

## 验证加载与真实调用

用同一二进制/应用目录执行离线 doctor，获准且终端空闲时通过 UI 加载桥接，再重新加载 Codex。检查 MCP 服务/工具状态并执行对应后端在线 doctor。`connector_list` 核对获准目标后以 `connector_open` 绑定，再用 `connector_read_screen` 检查屏幕，后续 exec/batch/status/分页使用返回的 `session_id`，结束后 close。详见 [Agent 工作流](../agent-usage.md)；密码框、pager、REPL 不是空闲 POSIX shell。

在明确授权的专用空闲测试 Tab 请求新的无害 `printf`，在客户端审批 UI 拒绝，确认没有终端输入、远端执行和对应审计 `dispatch_attempt`。不要自动重试。另行获准后用新的 operation ID 批准，核对一次发送、一个 command ID 与真实最终结果。

没有审批 UI 或拒绝仍发送时停止，记录客户端版本及脱敏配置。CI、MCP annotations 与 doctor 不能证明这条拒绝路径。安装不放宽已有审批。不公开令牌、端点、用户名、句柄或已有历史；未知结果先检查原 Tab，再显式恢复。
