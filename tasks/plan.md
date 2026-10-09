# Mac 真机验收与 JS/Rust 工具迁移

2026-10-09，已安全拉取包含`82d667b`的main，起始工作区无未提交修改。用户确认两Tab为获准空闲POSIX测试终端，第一Tab可断开/重连。

当前规格：Windows只有自包含JScript入口，其余构建、打包、客户端和验收控制器迁移JS/Rust；仅保留Mac必须的`bridge/securecrt_bridge.py`标准库原生层。复用实际加载引擎，不另设Python版本上限。安装自动部署用户目录二进制、固定入口与增量Codex配置，不改PATH，不改既有审批、Token、策略或SSH登录。

已完成本地证据：[Mac双Tab矩阵和UI](../docs/acceptance/mac-native-matrix-2026-10-09.md)，以及Rust严格检查、Node编译/故障/daemon/打包和Mac原生契约回归。历史FAIL保留，未自动重试不确定命令，长输出保持原10秒预算。WindowsWSH在实际Windows CI验证；这台Mac不冒称Windows原生UI验收。

交付门槛：分任务审查与全分支审查 → PR精确HEAD全部必需CI成功 → 无未解决审查线程 → 精确HEAD合并 → 核对远端main。GitHub记录PR/CI/merge状态，本地回执只认证对应源码/摘要，不推断发布资产。用户未请求发布新Release，不能覆盖旧公开包。
