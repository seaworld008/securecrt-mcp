# 实际 API 与版本依赖

审查日期：2026-10-07。只列 Bridge/Rust 实际使用或探测的成员。history 未说明首发时标 unknown；某版本已存在不等于精确首发版本。历史 OS 实测按操作者最新要求暂缓，当前用能力探测加本机实际冒烟验证。

## SecureCRT

| API | 用途 | 最低版本证据与本机验证 |
|---|---|---|
| `crt.GetTabCount()` | 枚举/维持；必要 | 首发 unknown；9.5.2 已调用 |
| `crt.GetTab(index)` | 保留对象；必要 | 首发 unknown；9.5.2 已调用，索引不作长期身份 |
| `crt.Sleep(ms)` | 原生消息泵；必要 | 6.6 history 已记载取消行为，首发 unknown；9.5.2 已调用 |
| `crt.Dialog.MessageBox()` | 启动通知；可降级 | 首发 unknown；9.5.2 启动已调用 |
| `crt.ScriptFullName` | 配置定位；可由 `__file__` 替代 | **6.7 新增**；9.5.2 已读取 |
| `crt.Version` | 可选诊断 | 首发 unknown；9.5.2 已读取 |
| `Tab.Caption` | 展示；必要 | 首发 unknown；9.5.2 已读取 |
| `Tab.Index` | 对象仍存在检查；必要 | 首发 unknown；9.5.2 已读取 |
| `Tab.Activate()` | 显式 focus | 首发 unknown；9.5.2 原生 focus_session 已通过 |
| `Tab.Session.Connected` | 连接状态；必要 | 首发 unknown；9.5.2 已读取 |
| `Session.Config.GetOption()` | 可选配置元数据 | 首发 unknown；9.5.2 Hostname/Username/Protocol Name 有值，Port 为 None；不证明真实/嵌套目标 |
| `Screen.Get2(r1,c1,r2,c2)` | Unicode 读屏/上下文；必要 | **6.5 已存在并修复**，首发 unknown；9.5.2 实测 |
| `Screen.CurrentRow` | 输入行；必要 | 首发 unknown；官方 Scripting Essentials/安装版文档；9.5.2 实测 |
| `Screen.CurrentColumn` | 输入边界；必要 | 同上 |
| `Screen.Rows` | 有界范围；必要 | 同上 |
| `Screen.Columns` | 范围/resize；必要 | 同上 |
| `Screen.ReadString(patterns,1)` | 输出捕获；必要，timeout 为秒 | **6.1 已记载**，首发 unknown；9.5.2 实测 |
| `Screen.MatchIndex` | 保留分隔符；必要 | **6.6 修复 Python 0-based 行为**；当前 1-based，0 为超时；9.5.2 实测 |
| `Screen.Synchronous` | 捕获设置/恢复；必要 | 6.0/6.6 已记载，首发 unknown；9.5.2 实测 |
| `Screen.IgnoreEscape` | 捕获设置/恢复；必要 | 首发 unknown；安装版 Screen Object 文档；9.5.2 实测 |
| `Screen.Send(text)` | 显式命令/中断；必要 | 首发 unknown；9.1 新增的 codec 参数未使用；9.5.2 实测 |

产品 Python3 下界为 **9.0**。9.3 history 修复了脚本引用已关闭 Tab 的崩溃，不能以相同 API 名字推广生命周期保证。依据：[9.0](https://www.vandyke.com/download/securecrt/9.0/history.txt)、[9.3](https://www.vandyke.com/download/securecrt/9.3/history.txt)、[6.1](https://www.vandyke.com/download/securecrt/6.1/history.txt)、[6.5](https://www.vandyke.com/download/securecrt/6.5/history.txt)、[6.6](https://www.vandyke.com/download/securecrt/6.6/history.txt)、[6.7](https://www.vandyke.com/download/securecrt/6.7/history.txt)、[Scripting Essentials](https://www.vandyke.com/support/tips/scripting/scripting_essentials.pdf)、[ReadString](https://www.vandyke.com/support/tips/readstring.html)、[同步缓冲 FAQ](https://www.vandyke.com/support/securecrt/scripting_faq.html)。9.5.2 自带 Application/Tab/Session/Screen Object 帮助是本机精确参数参考。

## Xshell

7/8 官方手册列出主要 Session/Screen 接口；精确首发没有确认。本轮等待实际 Xshell 安装，不把 double 的通过写成原生通过。[7 手册](https://www.netsarang.com/docs/Xshell7_manual.pdf)、[8 手册](https://www.netsarang.com/docs/Xshell8_manual.pdf)

| API | 用途 | 最早确认 / 首发 |
|---|---|---|
| `xsh.Session.Connected` | 必要连接检查 | 7 文档 / unknown |
| `Session.SelectTabName()` | 必要选择后核实 | 7 / unknown |
| `Session.SessionName` | 必要绑定 | 7 / unknown |
| `Session.TabText` | 必要辅助绑定 | 7 / unknown |
| `Session.Path` | 只枚举 .xsh 名称；缺失时发现降级 | 7 / unknown |
| `Session.Sleep(ms)` | 不使用；实测 Python 3.8 绑定返回引用有缺陷 | 7 / unknown |
| `Session.RemoteAddress` | 可选 getattr 元数据 | unknown，不冒充手册保证 |
| `Session.RemotePort` | 可选元数据 | unknown |
| `Session.UserName` | 可选元数据 | unknown |
| `xsh.Screen.Get()` | 必要屏幕 delta/上下文 | 7 / unknown |
| `Screen.CurrentRow` | 必要当前行 | 7 / unknown |
| `Screen.CurrentColumn` | 必要输入位置 | 7 / unknown |
| `Screen.Rows` | 必要范围 | 7 / unknown |
| `Screen.Columns` | 必要范围 | 7 / unknown |
| `Screen.Synchronous` | 必要发送附近同步 | 7 / unknown |
| `Screen.Send()` | 必要显式发送/中断 | 7 / unknown |
| `Screen.WaitForStrings(strings, ms)` | 必要有界原生消息泵 | 7 / unknown；手册 timeout 为毫秒 |
| `xsh.Version` | 可选诊断 | unknown |

8 build 0067 修复了 SelectTabName 改变标签名及 Windows 11 24H2 的 JScript WaitForStrings；不是所有 Python/OS 的认证。[官方更新历史](https://www.netsarang.com/en/xshell-update-history/)
Bridge 不调用 xsh.Dialog；通知由独立 Windows 消息进程实现。实测 Xshell 8 Build 0110 / Python 3.8.6 的 Session.Sleep 会持续减少 None 引用计数，不能用于循环。WaitForStrings 的列表遍历结束留下特定 SystemError；桥接仅处理已观察到的明确异常链，其余异常停止服务。普通 time.sleep 无法处理终端事件，不能作为生产降级。非 ASCII POSIX 命令使用 ASCII 八进制 printf + eval 传输原始 UTF-8 字节；非 ASCII prompt 输入在发送前拒绝。

## Python

| 实际特性 | 首个版本 | 使用 |
|---|---|---|
| 字典 `**` 展开 | 3.5 / PEP 448 | SecureCRT 元数据 |
| f-string | 3.6 / PEP 498 | Xshell IPC/日志 |
| `str.isascii()` | 3.7 | 完成 marker 校验 |
| `Path.unlink(missing_ok=True)` | 3.8 | Xshell 临时文件清理，支持下界取 3.8 |
| pathlib | 3.4 | 配置/IPC/定位 |
| `time.monotonic()` | 3.3 | 有界等待 |
| `hmac.compare_digest()` | 3.3 | token 比较 |

SecureCRT 标准库：errno/hashlib/hmac/json/platform/select/socket/sys/time/uuid/pathlib。
Xshell：ctypes/errno/hashlib/hmac/json/os/platform/subprocess/sys/threading/time/uuid/pathlib，Windows 辅助路径使用 winreg。Bridge 不依赖第三方包或 tomllib；后者只用于外部验证/打包。CI 3.8/3.12 不是产品加载引擎；本机实际为 3.11.17。

依据：[3.5](https://docs.python.org/3/whatsnew/3.5.html)、[3.6](https://docs.python.org/3/whatsnew/3.6.html)、[3.7](https://docs.python.org/3/whatsnew/3.7.html)、[pathlib](https://docs.python.org/3/library/pathlib.html)、[time](https://docs.python.org/3/library/time.html#time.monotonic)、[hmac](https://docs.python.org/3/library/hmac.html#hmac.compare_digest)。

## OpenSSH / PTY

| 特性 | 版本证据 | 实际依赖 |
|---|---|---|
| SSH2、持续 stdin/stdout | 精确首发未确认 | 一个 ssh -T 进程复用；远端还须 POSIX printf/eval/$? |
| `-T` / `-tt` | 当前官方 ssh(1)，首发 unknown | 禁用/强制 PTY |
| `-F` | 当前 ssh(1)，首发 unknown | 用户显式 ssh_config |
| `--` | 本机程序实测，首发 unknown | 参数终止；同时拒绝选项形状目标 |
| `-V` | 当前 ssh(1)，首发 unknown | 实际版本诊断，本机系统 10.3p1 |
| `-G` | **6.8 新增** | 隔离配置的本地诊断 |
| ProxyJump/-J、Include、IdentityAgent | **7.3 新增** | 仅操作者已有配置使用时依赖 |
| Unix PTY / Windows ConPTY | portable-pty 0.9；ConPTY 最低 Windows 10 1809 / Server 2019 | 本地流/resize；不把桌面屏幕当作 PTY |

依据：[ssh(1)](https://man.openbsd.org/ssh)、[6.8](https://www.openssh.com/txt/release-6.8)、[7.3](https://www.openssh.com/txt/release-7.3)。本地参数探测通过；Windows 交叉系统验证按最新范围暂缓。

ConPTY 的系统下界来自 [Microsoft CreatePseudoConsole](https://learn.microsoft.com/en-us/windows/console/createpseudoconsole)；本轮只核对文档，不作 Windows 实测声明。
