# 安装、升级与引擎

当前运行层为 Rust + Windows JScript / Mac 最小 Python 原生适配层。Windows 无需 Python、pywin32、Node 或 Rust；Node 是开发/验收工具依赖，JS 客户端是可选入口。

下载包含当前提交的 ZIP，核对 SHA256SUMS，解压到普通用户目录。Windows 双击 `install.cmd`，macOS 双击 `install.command`；也可在解压目录运行 `securecrt-mcp install`。文件若被系统标记为不可执行，可按本机应用安全策略授权来源后运行命令行入口。安装器不绕过系统安全保护。

`install` 自动完成：

1. 在用户私有目录 `.securecrt-mcp/bin` 保存二进制。
2. 初始化/升级当前平台固定入口，保留 Token、策略和登录。
3. 增量修改 Codex `mcp_servers.securecrt` 的 command / args；保留用户的其他配置、注释、审批和工具范围。使用 `CODEX_HOME` 时写入该目录，不另建第二份配置。
4. 输出二进制与脚本位置。重新加载 Codex，在终端空闲时取消旧实例并选择固定入口。

安装不会改全局 PATH。后续使用输出的二进制绝对路径。常规升级重复 `install`；仅更新桥接文件使用 `upgrade`。禁止把 `init --force` 用作常规更新。

| 客户端 | 固定入口 |
| --- | --- |
| Windows SecureCRT | `%USERPROFILE%\.securecrt-mcp\securecrt-mcp-securecrt.js` |
| Windows Xshell | 标准 Xshell Scripts 目录中的 `securecrt-mcp-xshell.js` |
| macOS SecureCRT | `~/.securecrt-mcp/securecrt_bridge.py` |

Mac SecureCRT 不支持 Windows ActiveX/JScript 原生对象。[厂商平台说明](https://www.vandyke.com/products/securecrt/scripts.html)是保留单个 Python 文件的原因。桥接只使用标准库；不安装 Python 包、不引用系统 `python` 命令、不设置任意版本上限。在线 `doctor` 读取实际加载引擎，再检查原生 API、版本/源码摘要。

已有可用引擎时直接复用。如果终端提示无法加载引擎，按当前安装版自己的支持列表安装官方 Python 并完全退出/重启 SecureCRT。SecureCRT 的原生加载器决定允许的版本和架构，安装器不会伪造环境通过，也不会盲目叠加多套运行时或改全局 PATH。[官方加载规则](https://www.vandyke.com/support/tips/how-to-use-python-scripting-securecrt-on-macos.html)

Mac执行附件绑定先原生选择已核对目标Tab并读取稳定屏幕；观察附件不聚焦、不输入。SecureCRT 每个进程一次启动覆盖其全部已连接 Tab；重复启动只提示，原实例继续工作。在启动脚本的 Tab 取消，SSH 登录保留。重新加载后重新发现并绑定目标，不复用旧句柄。Xshell 以实际原生发现范围为准。

确认就绪：运行 `doctor --offline`，再运行 `doctor --backend securecrt` / `xshell`；新配置加载后完成[真实桌面验收](desktop-acceptance.md)。旧公开 Release 不会被 main 合并自动替换，下载前检查包中入口和源码对应信息。
