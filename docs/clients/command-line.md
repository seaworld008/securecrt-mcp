> **0.3.0 update:** Continuous diagnostics should use the persistent terminal workflow: [attach / exec / batch / daemon](../persistent-terminal.md). Client permissions remain operator-owned; client mode now includes the narrow catastrophic guard. The earlier one-call API remains compatible. New installs generate the terminal tool preset; existing configuration is never silently replaced.

# Rust CLI、Python 和 PowerShell 调用

推荐 Agent 直接接入持久 MCP 并使用 run_command。下面的客户端适合手工调试和不便直接调用 MCP 的工具。它们共用 Rust 引擎，不维护第二套状态机，不绕过本地协议保护，也不新建 SSH 连接。

## Rust CLI：不需要手工拼 JSON-RPC

```powershell
.\target\release\securecrt-mcp.exe sessions
.\target\release\securecrt-mcp.exe screen --session "从列表取得的会话句柄"
.\target\release\securecrt-mcp.exe run --input request.json
.\target\release\securecrt-mcp.exe policy-check --input request.json
```

request.json 是 UTF-8 文件（允许 UTF-8 BOM）：

```json
{
  "session": "从列表取得的会话句柄",
  "command": "grep 'deny' /etc/nginx/nginx.conf",
  "mode": "posix",
  "timeout_ms": 30000,
  "max_bytes": 60000
}
```

`run --input -` 从标准输入读取 JSON，最多256KiB。推荐 Windows 使用文件，以避免终端管道的历史编码差异。远端命令仍是单行文本，保留引号、美元符号、管道和 Unicode，不由本地 Shell 二次解释。

run 保持进程直到任务到达本地终态，不因 wait_ms=0 就退出。stdout 是 JSON，stderr 是诊断；非成功结果使用非零退出码，绝不自动重试。CLI 本身没有 Codex 审批弹窗：通过 Agent 调用时由调用该 CLI 的客户端工具权限控制；手工调用代表操作者自己发起。

一次性进程退出后，其任务缓存不再提供后续页。返回值明确包含 output_available_after_exit=false；需要持续状态和长输出分页时使用持久 MCP。不要将两个独立 CLI 进程视为共享的 exactly-once 事务。

## Python 标准库封装

```powershell
python clients/securecrt_client.py --binary .\target\release\securecrt-mcp.exe sessions
python clients/securecrt_client.py --binary .\target\release\securecrt-mcp.exe run --input request.json
python clients/securecrt_client.py --binary .\target\release\securecrt-mcp.exe policy-check --input request.json
```

无需第三方 Python 包。封装用 argv 启动 Rust CLI，继承标准字节流，不使用 shell=True，不复制 Bridge Token，不自行轮询或重试。Python 版本要求与 SecureCRT 内嵌 Python 是两回事；这个包装器也可以不用，直接调用 Rust CLI。

## PowerShell 封装

文件方式：

```powershell
.\clients\SecureCRT.ps1 -Binary .\target\release\securecrt-mcp.exe -Action sessions
.\clients\SecureCRT.ps1 -Binary .\target\release\securecrt-mcp.exe -Action run -InputFile .\request.json
```

不想自己写 JSON 时，可以让封装用 UTF-8 临时文件处理：

```powershell
$command = @'
grep 'deny' /etc/nginx/nginx.conf
'@
.\clients\SecureCRT.ps1 -Binary .\target\release\securecrt-mcp.exe `
    -Action run -Session "从列表取得的会话句柄" -Mode posix `
    -CommandText $command -TimeoutMs 30000 -MaxBytes 60000
```

使用单引号 here-string 避免 PowerShell 展开远端 `$变量`。CommandText 不自动推断捕获模式，run 时必须给 -Mode。临时文件仅用于参数传递，正常结束或异常时都会尝试清理；不要在命令参数中放密码/私钥。

## 定位为什么命令被拒绝

policy-check 不连接 Bridge、不发送远端输入，返回配置路径、mode、allowed 和 reason。它可以区分：

- client：命令风险交给调用方，仍遵循明确自定义拒绝规则。
- builtin_guardrail[index]：旧本地模式的内置规则。
- custom_deny_rule[index]：本机操作者配置的规则。
- 有限只读语法不匹配：safe 模式的参数/命令不在支持范围。

改变策略属于操作者选择，不应让 Agent 为了让自己的请求成功而私自修改本机配置。普通 upgrade 不改变策略或 Token。

## 压力和失败场景

已有活动任务时，不自动中断；出现未决状态，不自动 acknowledge。停止进程或丢失响应后，先检查原 SecureCRT 终端。默认缓存并非持久数据库；不要用不确定重试来补齐丢失的输出。

本版本测试包含原生 Rust 可执行程序加模拟 Bridge，Windows CI 执行 PowerShell 7 和 Windows PowerShell 5.1 包装器路径及 UTF-8 输出。是否通过应以对应提交 CI 为准，不等于 SecureCRT 桌面认证。
