# 文档地图

[简体中文](README.md) · [English](README.en.md) · [项目概览](../README.md)

按你的目标选择阅读路线。概览、安装、日常使用和客户端指南默认展示简体中文，并提供完整英文备选。安装提示词保留双语模板；开发维护指南保留英文正文及中文入口，部分详细运行与验收文档目前仅有中文。

| 我想…… | 阅读路线 |
| --- | --- |
| 判断是否适合我的平台 | [项目概览](../README.md)、[支持矩阵](support-matrix.md)、[运行时支持策略](support-policy.md) |
| 安装并接入 AI 客户端 | [复制安装提示词](agent-setup.md#中文提示词) → [安装说明](installation.md) → [Codex](clients/codex.md)（[English](clients/codex.en.md)）或 [Claude Code / Desktop](clients/claude.md) |
| 日常使用会话 | [Agent 工作流](agent-usage.md)、[连接器工具](connectors.md)、[持久终端调用](persistent-terminal.md)、[CLI / JS / PowerShell](clients/command-line.md) |
| 升级已有安装 | [安装说明：升级](installation.md#upgrade)、[排障](troubleshooting.md)；保留策略与令牌，并重新加载桥接 |
| 排查问题 | [排障](troubleshooting.md)、[支持策略](support-policy.md)、[API 兼容性](api-compatibility.md) |
| 理解安全边界或报告漏洞 | [安全模型](security-model.md)、[漏洞报告](../SECURITY.md) |
| 理解接口与架构 | [连接器契约](connectors.md)、[连接器架构](connector-architecture.md)、[整体架构](architecture.md)、[桥接协议](bridge-protocol.md)、[厂商参考资料](references.md) |
| 开发或运行自动测试 | [贡献指南](../CONTRIBUTING.md) → [Agent 维护指南](agent-maintenance.md) → [开发测试](testing.md)；根目录 `AGENTS.md` 是仓库工作指南 |
| 验收真实桌面环境 | [验收规则](desktop-acceptance.md)、[测试用例](desktop-test-cases.md)、[Mac 测试提示词](mac-securecrt-test-prompt.md)、[支持证据](support-matrix.md) |
| 维护发布 | [Agent 维护指南：提交与发布边界](agent-maintenance.md#commit-and-release-boundaries)、[发布流程](releases.md)、[变更记录](../CHANGELOG.md) |
| 阅读性能与历史决策 | [性能](performance.md)、[就绪证据](production-readiness.md)、[0.2 迁移](migration-0.2.md)、[0.3 迁移](migration-0.3.md)；`releases/`、`plans/`、`superpowers/` 保存历史记录 |

## Agent 阅读顺序

**安装：** 项目概览 → [Agent 安装提示词](agent-setup.md) → [安装说明](installation.md) → 所选客户端指南 → [Agent 工作流](agent-usage.md)。应用当前 main 的步骤前，先检查所选包自己的文档和源码。

**开发与维护：** 根目录 `AGENTS.md` → [贡献指南](../CONTRIBUTING.md) → [Agent 维护指南](agent-maintenance.md) → 相关架构与契约 → [开发测试](testing.md) → 适用的验收与发布规则。

公开 v0.5.2 的源码早于当前安装器；v0.5.3 发布当前 main。[安装说明](installation.md)列出发布来源、当前 main 构建和 CI artifact 核对方法。历史验收记录仅证明其中记载的源码、摘要和环境，不能代表当前 main，也不能代表所有看似兼容的设备。
