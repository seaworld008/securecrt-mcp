# 运行支持与实际引擎

当前只有 Windows JScript 原生入口与 Mac 最小 Python 原生适配层。旧 Windows Python/Xshell 绑定、pywin32 配置和 Python 客户端已移除，不保留双路径维护。Node 是开发和可选 JS 客户端依赖，安装后的终端脚本不调用 Node。

| 平台 | 入口 | 诊断依据 |
| --- | --- | --- |
| Windows SecureCRT / Xshell | 自包含 `.js` | 真正加载的 JScript、终端版本、必需原生 API、运行源码 SHA-256 |
| macOS SecureCRT | 单个 `securecrt_bridge.py` | SecureCRT 内实际 Python、终端版本、原生 API、运行源码 SHA-256 |
| 系统 OpenSSH | Rust + OS ssh | 本地 CLI 探测；实际认证/exec/PTY另行验收 |

一键安装和增量 Codex 配置见[安装说明](installation.md)。优先复用 Mac 已有可用引擎；桥接仅用标准库，不需 pip。运行中的引擎由 SecureCRT 原生加载器选择，不依据外部 `python --version` 推断，也不在桥接诊断中设额外 Python 上限。若已经实际加载、必需能力存在且摘要匹配，未来 Python 版本不会因为任意硬编码最大版本被拒绝。

SecureCRT 自身仍决定能够加载哪些 Python 版本、架构和标准安装路径。缺少引擎时按当前安装版提示安装官方运行时并完全重启 SecureCRT；项目不会把无法加载的引擎标成通过。[官方 Mac 加载说明](https://www.vandyke.com/support/tips/how-to-use-python-scripting-securecrt-on-macos.html)和[脚本语言平台范围](https://www.vandyke.com/products/securecrt/scripts.html)。Windows 无需更改 Python 设置。

`doctor` 的支持层级：

| 状态 | 含义 |
| --- | --- |
| `unsupported` | 缺少必要 API、运行脚本不匹配或使用已移除入口；不宣称就绪 |
| `unknown` | 尚未取得完整实际运行时或必要方法未验证 |
| `tier_2` | 实际版本/源码/必要能力检查通过；不自动证明所有真实桌面用例 |
| `tier_1` | 精确系统/架构/终端/引擎/脚本摘要有90天内、完整真机证书 |

脚本摘要变化后旧真机证书不自动认证新实现。认证过期回到实际探测层级，不意味着已运行任务被强制停止。支持策略不替代客户端审批或远端权限，不从一台设备推广所有平台兼容性。

```text
securecrt-mcp doctor --offline
securecrt-mcp doctor --backend securecrt
securecrt-mcp doctor --backend xshell
securecrt-mcp doctor --backend openssh
```

普通 `install`/`upgrade` 保留 Token、策略和登录。只在空闲时取消旧脚本并重载固定入口。MCP重启后重新发现目标，旧附件不恢复。OpenSSH本地`-V/-G`使用隔离配置，不连接远端，不评估用户Match exec；真实认证需要独立测试。
