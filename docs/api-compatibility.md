# 当前原生接口与环境边界

当前平台入口见[一键安装](installation.md)。Windows使用系统JScript，Mac仅保留一个Python原生适配文件。诊断依据实际能力和运行摘要，不承诺未实测组合，不设置独立于终端加载器的Python最高版本。

## SecureCRT 原生 API

| API | 使用 |
| --- | --- |
| `crt.GetTabCount()` / `GetTab(index)` | 枚举连接并保留真实Tab对象；索引不是长期身份 |
| `crt.Sleep(ms)` | 在原生脚本线程推进事件循环和有界稳定检查 |
| `Dialog.MessageBox` / `ScriptFullName` / `Version` | 启动提示、入口路径、实际版本报告 |
| `Tab.Caption` / `Index` / `Activate` | 展示、存活核对、显式焦点操作 |
| `Session.Connected` / `Config.GetOption` | 连接代际与配置元数据，不证明嵌套SSH身份 |
| `Screen.Get2` / `CurrentRow` / `CurrentColumn` / `Rows` / `Columns` | Unicode屏幕与输入上下文；一致帧令牌 |
| `Screen.ReadString(patterns,1)` / `MatchIndex` | 有界捕获，timeout单位秒；匹配分隔符补回输出 |
| `Screen.Synchronous` / `IgnoreEscape` | 捕获设置，完成/清理时恢复 |
| `Screen.Send` | 已校验上下文后发送；显式Ctrl+C只针对记录中的命令 |

Mac `Get2` 可以推进渲染，不能混合读前光标与读后文本。初次附件需要跨原生yield的稳定输入边界；全文屏幕令牌由一致文本/光标帧生成。完成标记与空闲输入边界分开：同步显示前缓冲中的原提示符需有界读取，下一次发送仍校验原提示符和光标，人工输入、resize、变更提示符均拒绝。

[厂商同步缓冲说明](https://www.vandyke.com/support/securecrt/scripting_faq.html)和本机应用帮助中的Tab/Screen对象文档是参数依据。Windows COM成员读取可能直接调用方法，因此ping仅检查安全属性；发送/等待方法在实际执行后标为已验证。

## Xshell JScript

`xsh.Session.Connected`、`SessionName`、`TabText`、`SelectTabName`确认目标，`Path`用于已知`.xsh`文件名索引。`Screen.Get`、行列位置和尺寸用于输入边界与增量缓冲读取；`Screen.Send`、`WaitForStrings`及`Session.Sleep`在终端脚本线程调用。真实方法调用后才记录能力。进程登记、原生文件锁、心跳及请求deadline保留严格边界。

旧Python Xsh引用计数、ANSI绑定和pywin32恢复路径已移除；不把它们作为当前用户环境要求。不同进程/发现范围需单独枚举验证。API和界面依据[厂商脚本说明](https://netsarang.atlassian.net/wiki/spaces/ENSUP/pages/2237305656/Using%2BScripts)，真实Windows行为以精确源码对应的回执为准。

## Mac 最小 Python 层

仅使用`errno/hashlib/hmac/json/platform/select/socket/sys/time/uuid/pathlib`标准库，不依赖pip、pywin32或第三方原生扩展。Rust负责策略、状态、解析、输出缓存和审计，Node负责构建/测试/打包/可选客户端。Python只负责必须在SecureCRT脚本线程调用的原生API和受限本地IPC。

解释器版本由运行桥接报告，外部命令行Python版本不能替代它。成功加载后检查实际API和源码，无人为版本上限；无法加载则按该安装版自己的版本/架构列表修复并重启。[厂商Mac加载规则](https://www.vandyke.com/support/tips/how-to-use-python-scripting-securecrt-on-macos.html)

## OpenSSH / PTY

显式OpenSSH后端使用系统`ssh -T/-tt`、已有Agent/ssh_config/known_hosts，配置选项由系统OpenSSH提供。PTY/resize来自portable-pty；桌面Screen不是PTY。`doctor`使用隔离配置执行本地`-V/-G`，不连接服务器。真实认证、exec、交互流与客户端审批分别验收。[ssh(1)](https://man.openbsd.org/ssh)
