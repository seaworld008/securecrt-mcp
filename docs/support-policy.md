# 支持策略

策略版本：2026-10-07；下次复审：**2026-11-07**。
可执行规则来自 [support/policy.json](../support/policy.json)，`doctor` 与文档共用该规则。
Windows 10/11 多版本实测于 2026-10-07 按操作者最新要求暂缓；当前验收范围是本机 SecureCRT 和安装后的实际 Xshell。

## 分级

| 状态 | 含义 | 处理 |
|---|---|---|
| Tier 1 | 精确 OS/架构/终端/Python/运行脚本摘要组合有 90 天内的完整真机收据，并匹配当前脚本；必要能力全部可用 | 优先回归与故障修复 |
| Tier 2 | 运行时必要 API 可用，但缺少当前精确组合认证，或属于已测的版本/OS 例外 | 按能力使用；有界失败、未知结果保留、不重放 |
| unsupported | 必要 API 缺失、运行脚本与二进制不一致，或低于明确的桥接语言/产品下界 | `doctor` 返回修复指引及非零退出；升级/修复后重测 |
| unknown | 未启动 Bridge、没有可用于探测的标签、或旧 Bridge 不报告能力 | 不伪装成“缺失”；启动测试会话和当前 Bridge 后重测 |

当前尚无 Tier 1 证书。Mac 27.0.1 / SecureCRT 9.5.2 ARM64 / Python 3.11.17 已通过真机验证，归 Tier 2；当前厂商系统要求列出 macOS 26/15，不能从这条记录推广到所有 macOS 或 Windows。[厂商系统要求](https://www.vandyke.com/products/system_req.html)

`doctor` 的 API 反射是只读存在性/可调用性检查，不执行远端命令，也不消耗终端输出，不能替代 attach→exec→batch→分页→拒绝的收据。MCP 权限、命令策略、目标核实与支持 Tier 是独立条件；Tier 1 不提供额外命令授权。版本字段和摘要来自本地已认证 Bridge，不是远端主机身份认证。

## 下界与退役

- 桥接支持 Python **3.8+**；SecureCRT **9.0+**、Xshell **7+** 是实现覆盖下界，具体版本仍需能力探测。Linux 某些旧 SecureCRT 接受 Python 3.6，不意味着当前脚本支持 Python 3.6。
- SecureCRT 9.6 移除 Python 3.8 支持；必须使用该产品版本实际允许的引擎。升级不自动安装、替换或放宽签名验证。[9.6 history](https://www.vandyke.com/download/securecrt/9.6/history.txt)
- 退役提前 **90 天**公告，经一次支持策略 PR 和 CHANGELOG 记录；到期删除认证记录、更新诊断与迁移指引。文档日期不会静默停止正在运行的任务。
- 认证超过 **90 天**或脚本摘要改变，自动失去 Tier 1 的依据，回到 Tier 2；证书过期不是“功能已失败”。产品/OS/Python 版本、厂商生命周期和未修复原生缺陷在每次月度复审中检查。
- 下一次复审决定是否继续保留旧的 9.0/9.1 与 Xshell 7 兼容分支；本轮没有未经实测就宣告其完整认证或直接删除它们。

## Xshell 内置 Python 例外

Xshell 8 Build 0110（运行程序产品版本 8.0.0.26）内置 Python 3.8.6
实测 `Session.Sleep` 和 `Screen.Send` 返回引用存在缺陷：100 次调用会令
`None` 引用计数持续下降，长时间运行可触发宿主 SIGABRT。此精确组合禁止
命令发送和中断；读取会话、诊断与升级指引仍可用，不能列为通过认证。

可使用厂商支持的外部 **32 位 Python + pywin32** 配置，保留 Python 桥接器。
先安装与 Xshell 架构匹配的 Python、安装并注册 pywin32 的 Active Scripting
引擎，按厂商说明配置其 DLL；然后在 Xshell 工具 → 选项 → 高级启用
“不要使用 Xshell 的嵌入式 Python”。实际加载版本应由 Bridge 的 `python`
字段确认，外部命令行版本不能替代这一检查。
配置步骤参见[厂商 Python 3.14 说明](https://netsarang.atlassian.net/wiki/spaces/ENSUP/pages/1816723519/Using%2BPython%2Bscripts%2Bwith%2Ban%2Binstalled%2BPython%2Bprogram%2BPython%2Bv3.14)。
外部引擎仍须完成真机验收，安装成功不等于兼容性通过。

## 运行方式

```text
securecrt-mcp doctor
securecrt-mcp doctor --backend xshell
securecrt-mcp doctor --backend openssh
securecrt-mcp doctor --offline
```

默认检查 SecureCRT；Xshell 使用实例文件 IPC；OpenSSH 的诊断用隔离配置运行本地 `-V/-G`，不会建立 SSH 连接，也不会执行用户 `Match exec` 配置。OpenSSH 的真实认证、POSIX exec 和 PTY 要单独验收。

普通 `upgrade` 保留 token/策略并备份脚本；闲时用产品菜单停止旧脚本，再运行安装路径的脚本。外部 `python --version` 不代表实际加载的引擎。macOS 安装兼容 Python 后需要重启 SecureCRT 才能识别。[官方 Python 加载说明](https://www.vandyke.com/support/tips/how-to-use-python-scripting-securecrt-on-macos.html)
