# Preview.2 Agent UX upgrade

Build `main`, run `upgrade`, restart the native script, run `doctor`, then reload the MCP client. Existing policy/token remain unchanged. New installations use `mode = "client"`; existing users explicitly edit that one setting only if they want command approvals delegated to the client. Custom deny patterns are not automatically deleted.

`codex-config` now defaults to an additive basic tool preset and approval mode `auto`. Inspect and merge the output; do not append duplicate tables or overwrite unrelated client settings. `--approval-mode prompt --toolset full` provides explicit prompts and the full low-level surface.

Prefer `run_command` for routine idle POSIX-shell investigations. The old low-level tools remain available. One-use screen tokens still exist internally but are not normal high-level parameters. Acknowledge unresolved work only after inspecting the original terminal; acknowledgements now return a fresh screen.

See [Agent usage](agent-usage.md) and [local clients](clients/command-line.md). The following is the historical protocol-1 to protocol-2 migration; its preview.1 desktop record is not relabeled as preview.2 validation.

# 0.1.x → 0.2.0-preview.1 升级与首次验收

协议及执行接口有变更。先在测试环境升级，不把旧会话 ID 或旧屏幕判断复用到新进程。

## 升级顺序

1. 确认没有正在执行或结果不明的远端命令；不要为了升级自动中断它们。
2. 在 SecureCRT 中 Script → Cancel 停止旧脚本，SSH Tab 保持登录；退出占用旧 exe 的 Codex。
3. `git status --short` 确认本地修改，`git pull --ff-only origin main` 获取代码，不用 reset/clean 丢弃改动。
4. `cargo build --locked --release`。
5. Windows 执行 `.\target\release\securecrt-mcp.exe upgrade`，其他系统执行 `./target/release/securecrt-mcp upgrade`。
6. `doctor --offline` 检查配置/内嵌版本；在 SecureCRT 中运行 `paths` 输出的脚本，确认启动框。
7. `doctor` 检查实际运行时。执行 `codex-config`，将增量配置合并到原 TOML，不覆盖其他设置，然后重新启动 Codex。

普通升级保留配置和 Token。替换脚本时备份旧文件；备份可能包含秘密，目录必须私有。`init --force` 是显式重置，不是普通更新命令。

## 第一次调用

让 AI 列出会话，再读取一个明确的测试会话。人工确认当前主机、账号、Shell 和空闲状态。提交命令要携带新的 `session`、`screen_token`、`expected_prompt`、唯一 `operation_id`。旧 `tab:1` 选择器应被拒绝。

首次测试选择已确认的 POSIX Shell，命令 `uname -a`，mode 设为 `posix`。提交后取 `command_id`，查询状态和分页输出。退出码和提示符不是同一种保证。

然后依次测试：拒绝审批零发送、Tab 重排后不串机器、读屏后改动导致 stale_screen、只读命令输出、无换行输出、较长输出分页、显式中断与超时后的未决保护。使用测试会话，禁止拿真实业务文件做破坏验证。

## 结果不确定时

`timed_out` / `cancelled` / `unknown` 都不表示远端已经终止。先看 SecureCRT 原始屏幕，人工确认是否需要中断或等待。确认同一原会话空闲后，取得新的屏幕 Token，再批准 `securecrt_acknowledge_idle`。它只清除本地保护，不发送探测命令，也不证明远端进程死亡。

如果原 Tab 已关闭、句柄失效或适配器重启，先人工排查远端状态，再重新枚举；不要把旧命令自动发到新 Tab。

## 回退

停止新的 MCP/脚本，确认无未决远端操作，再使用旧版本的二进制及其同版本脚本。不要将协议 1 二进制与协议 2 脚本混用。正常升级留下的 config/token 不应通过强制初始化随意重置。
