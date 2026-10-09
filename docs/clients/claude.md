# Claude Code / Claude Desktop 接入

[简体中文](claude.md) · [English](claude.en.md) · [安装说明](../installation.md) · [Agent 安装提示词](../agent-setup.md#中文提示词) · [文档地图](../README.md)

<a id="initialize-without-writing-codex"></a>

## 初始化而不写入 Codex

**当前 `install` 总会写入 Codex 配置，不会注册 Claude。** 仅用 Claude 时，应将已核验二进制保留在稳定绝对路径，设置所选绝对路径 `SECURECRT_MCP_HOME`，改为执行该二进制的 `init`。它初始化桥接与应用配置，不写 Codex，也不复制安装后的二进制。后续更新桥接用 `upgrade`，不要用 `init --force`。来源/包选择、初始化命令和 UI 桥接加载见[安装说明](../installation.md)。

使用持久的 **stdio** 服务：所选可执行文件的绝对路径，加参数 `serve`；不要使用 `run`，也不要每次工具调用都启动 daemon。两个客户端都必须使用初始化时相同的应用目录。

Windows 自定义目录时，原生终端进程也必须继承同一目录变量；Claude env 条目不会设置 SecureCRT/Xshell 的环境。加载脚本前先看[应用目录说明](../installation.md#2-choose-the-application-directory-and-client)，保留已有终端登录。

## Claude Code

先检查已安装的 `claude mcp add --help`。检查已有服务条目及作用域；合并既有 `securecrt` 条目时，不丢弃其他 env 键或权限设置。新增条目时替换以下占位路径：

```sh
claude mcp add --transport stdio --scope user --env SECURECRT_MCP_HOME=/absolute/path/to/app-home securecrt -- /absolute/path/to/securecrt-mcp serve
```

```powershell
claude mcp add --transport stdio --scope user --env "SECURECRT_MCP_HOME=C:\Tools\securecrt-mcp-home" securecrt -- "C:\Tools\securecrt-mcp.exe" serve
```

`--env` 后的 `--` 结束选项解析，避免服务名被当作另一个环境变量值。`--scope user` 属于 Claude Code，不是 Claude Desktop 配置位置。通过已安装客户端的检查命令/MCP 状态确认注册，按需重新加载客户端。[Claude Code 官方 MCP 说明](https://code.claude.com/docs/en/mcp)

## Claude Desktop

通过已安装 Claude Desktop 版本的设置/文档找到 MCP 配置。在已有 `mcpServers` 对象下合并此条目，不要替换整份文件或其他服务，也不要粘贴到 Claude Code 配置里。

Windows JSON 示例（路径为占位符）：

```json
{
  "mcpServers": {
    "securecrt": {
      "command": "C:\\Tools\\securecrt-mcp.exe",
      "args": ["serve"],
      "env": {
        "SECURECRT_MCP_HOME": "C:\\Tools\\securecrt-mcp-home"
      }
    }
  }
}
```

macOS 对应示例：

```json
{
  "mcpServers": {
    "securecrt": {
      "command": "/absolute/path/to/securecrt-mcp",
      "args": ["serve"],
      "env": {
        "SECURECRT_MCP_HOME": "/absolute/path/to/app-home"
      }
    }
  }
}
```

JSON 中 Windows 反斜杠转义为 `\\`；CLI 参数使用普通 `\`。绝对路径和显式应用目录让 GUI 启动的客户端无需继承安装 shell 环境也能找到同一应用文件。重启 Desktop，检查 MCP 服务/工具状态；JSON 有效本身不能证明已加载。

<a id="use-and-verify-approvals"></a>

## 使用并验证审批

运行离线 doctor，仅在获准且终端空闲时加载原生桥接，再检查在线后端诊断。然后 `connector_list` → 核对获准目标 → `connector_open` → `connector_read_screen` → `connector_exec` / `connector_exec_batch`。状态和分页见 [Agent 工作流](../agent-usage.md)。OpenSSH 专用流工具用于日志/REPL；`connector_close` 停止捕获，不终止远端工作。

打开会话不代表获得命令执行授权。客户端信任/权限由操作者掌握。在明确获准的空闲测试 Tab 请求无害 `printf`，使用客户端实际审批控件拒绝，核实无终端输入及对应审计派发。不要自动重试。另行授权一次新的批准操作，检查真实完成结果与输出。若客户端没有拒绝控件或拒绝后仍发送，停止并报告该缺口，不要根据 MCP annotations 宣称审批已验证。

不要为降低延迟添加无条件审批。本地 `client` 策略不能证明 Claude 的审批行为，远端 SSH 权限仍是实际权限边界。原始输入需要独立的本地显式启用。若客户端调用时限要求轮询，应使用较短 `wait_ms`；进度消息不保证延长硬超时。编译、注册、doctor 与真实会话执行是不同验证层。
