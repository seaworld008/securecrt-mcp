# 支持矩阵与双时代 MCP 实施计划

日期：2026-10-07。保留最初的审查、PR/issue 处理和 Mac 真机测试目标。

## 已完成基线

- 原有 PR #23/#24/#25/#27/#28 已审查、验证并合并；#24 的 SHA-256 兼容问题已修复。
- PR #29 修复 Xshell 结果路由、显式空闲确认和 OpenSSH 目标参数；已通过三平台 CI 并合并。
- Mac SecureCRT 9.5.2 ARM64 / Python 3.11.17：22 项真实 MCP/SSH 检查通过，包括批次、分页、拒绝、超时、Ctrl+C 与显式恢复。
- PR #30 限制 OpenSSH 输出/缓存并修复排队期间的未决状态；单独验证和审查。

## 顺序与验收

1. 官方 API/语法/特性清单：对齐源码、官方历史和安装版帮助。最早引入版本无法确认时明确写 unknown，不能把首次找到的文档年份当引入版本。
2. 最小冒烟与机器可读证据：显式选择已核实目标，attach→exec→batch→分页→拒绝；证据不包含 token、端点、用户终端历史。
3. 矩阵：Windows 10 22H2 / Windows 11 × SecureCRT 9.1/9.3/9.5/9.6/9.7.x × 各版本 Python 最低/最高；Xshell 7/8 和 OS OpenSSH。逐格保留 PASS/FAIL/DEGRADED/BLOCKED，只有真机收据才能 PASS。
4. 支持策略与 doctor：一个版本化规则来源，输出 Tier、已探测/未知/缺失能力和修复措施；不把 runtime 探测等同矩阵认证。
5. MCP 双时代：仅声明 2026-07-28 与 2025-11-25，分别验证 discover/逐请求元数据与 initialize；不支持版本返回 -32022 及 supported/requested。
6. MSRV：贡献者/cargo install 受 Rust MSRV 约束，预编译用户不受影响；仅小版本调整并写 CHANGELOG。
7. 全套本地与三平台 CI、审查和精确 head 合并；同步当前目录，保留原始未完成矩阵项。

## 当前资源依赖

- Windows 11 VMware ARM 虚拟机存在，但系统矩阵已暂缓；实际 Xshell 安装环境/入口等待操作者提供。
- Windows 10/11 与历史版本系统矩阵按操作者 2026-10-07 最新指示暂缓，不再等待这些介质。
- Apple Silicon 的 Windows 11 ARM 不能冒充 Windows 10 x64；虚拟化/仿真、客体 OS、终端架构必须分开记录。
- Windows 客体登录/安装协议若需要操作者完成，保留明确 BLOCKED 证据，继续其他已授权工作。
