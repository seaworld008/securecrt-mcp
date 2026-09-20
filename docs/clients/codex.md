# Codex 接入（中文默认）

英文版：[codex.en.md](codex.en.md)

本文是 Windows + SecureCRT + Codex 的完整接入步骤。MCP Server 通过 stdio 启动，Bridge 必须由 SecureCRT 自己运行。

## 一次性安装

1. 安装 Rust 1.88 或更新版本，并确认 `cargo --version` 可用。
2. 安装 SecureCRT。SecureCRT 9.0 在 Windows 上需要兼容的 Python 3 运行时；遇到 `Unable to load the Python scripting engine` 时安装 Python 3.8 x64。
3. 在仓库根目录编译并初始化：

```powershell
cargo build --release
.\target\release\securecrt-mcp.exe init
```

初始化文件位于：

```text
C:\Users\<用户名>\.securecrt-mcp\config.toml
C:\Users\<用户名>\.securecrt-mcp\bridge.json
C:\Users\<用户名>\.securecrt-mcp\securecrt_bridge.py
```

`bridge.json` 包含本机随机 token，不要提交到 Git、聊天或工单。

## 每次启动

1. 打开 SecureCRT，在**同一个窗口**连接需要使用的服务器。
2. 如果刚安装或升级了 Python，完全退出并重新打开 SecureCRT，使它重新加载 Python 引擎。
3. 在 SecureCRT 选择 `Script -> Run...`，运行 `C:\Users\<用户名>\.securecrt-mcp\securecrt_bridge.py`。
4. 保持脚本运行。看到 Bridge 提示框后点击确认，不要选择 `Script -> Cancel`。
5. 验证：

```powershell
.\target\release\securecrt-mcp.exe doctor
```

预期输出包含：

```text
bridge: OK
"securecrt_tabs": 2
```

Bridge 只访问运行脚本的 SecureCRT 窗口。会话选择器来自 `securecrt_list_sessions`，例如 `tab:1`、`tab:2`；关闭或重排 Tab 后应重新列出会话。

## Codex 配置

编辑 `%USERPROFILE%\.codex\config.toml`，加入：

```toml
[mcp_servers.securecrt]
command = "C:\\Tools\\securecrt-mcp.exe"
args = ["serve"]
startup_timeout_sec = 30.0
```

如果使用仓库构建产物，`command` 改为绝对路径，例如：

```toml
command = "E:\\AI-codex\\053-securecrt-mcp\\target\\release\\securecrt-mcp.exe"
```

修改配置后重启 Codex。MCP Server 由 Codex 按需启动，不需要手工单独运行 `serve`。

## 推荐提示词

只读巡检：

```text
先调用 securecrt_list_sessions，确认当前会话和 tab id。
读取每个会话的屏幕内容，然后执行 hostname、uptime、df -h、free -h、ss -lntp。
只做观察和分析，不重启服务、不修改配置、不删除文件。
```

Kubernetes：

```text
在 k8s master 会话上执行 kubectl get nodes -o wide、kubectl get namespaces、kubectl get deployments -A。
检查异常 Pod 时再使用 describe 和 logs；不要执行 delete、apply、patch 或 rollout restart。
```

## 文件 CRUD 测试

默认 `policy.mode = "safe"` 不允许文件写入和删除。需要测试时，只增加针对唯一临时文件的精确规则，测试后立即将 `custom_allow_patterns` 恢复为 `[]`：

```toml
[policy]
mode = "safe"
custom_allow_patterns = [
  '^touch /root/\\.securecrt-mcp-crud-test-YYYYMMDD$',
  '^echo securecrt-mcp-crud-v2 > /root/\\.securecrt-mcp-crud-test-YYYYMMDD$',
  '^unlink /root/\\.securecrt-mcp-crud-test-YYYYMMDD$'
]
```

验证顺序是 `ls` 确认不存在、`touch` 创建、`cat` 读取、`echo ... >` 修改、再次 `cat` 验证、`unlink` 删除、最后 `ls` 确认不存在。不要对真实业务文件、备份、`.ssh`、数据库或容器数据目录做测试。

## 故障排查

- `doctor` 超时：确认 SecureCRT 中 Bridge 脚本仍在运行，并检查 `127.0.0.1:27855` 是否被其他进程占用。
- Python 引擎错误：安装 Python 3.8 x64 后完全重启 SecureCRT。
- 会话数量为 0：确认脚本运行在包含已登录 Tab 的 SecureCRT 窗口。
- 命令被拦截：这是本地策略的预期行为；优先使用只读命令，不要切换到 `unrestricted` 绕过策略。
- 输出不完整：增加 `settle_ms`，或传入命令完成后一定会出现的 `wait_for` 文本。
