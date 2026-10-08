# 支持矩阵与实测证据

记录日期：2026-10-08。配套 [支持策略](support-policy.md)、[API 清单](api-compatibility.md)、[架构](connector-architecture.md)。
PASS 仅表示该格子的实际冒烟通过；DEFERRED 表示操作者明确暂缓；PENDING 表示尚未完成实际客户端验收。文档可用版本记录不等于完整实测。

## 当前机器

| OS / 架构 | 终端 | 实际 Python / OpenSSH | 结果 | 范围 |
|---|---|---|---|---|
| macOS 27.0.1 / ARM64 | SecureCRT 9.5.2 build 3325 | 加载 Python 3.11.17 | PASS / Tier 2 | 22 项 MCP/真实 SSH 检查；另外 Computer Use 直接输入与原生 Tab.Activate 成功 |
| 同上 | 系统 OpenSSH | OpenSSH 10.3p1 / LibreSSL 3.3.6 | PASS（本地 CLI 探测）/ Tier 2 | `-V`、隔离 `-G -T -F --`；没有将其写成远端认证/PTY 通过 |
| Windows 11 10.0.26200 / ARM64（Fusion 25.0.0） | Xshell 8 Build 0110；PE ProductVersion 8.0.0.26 | 外置 Python 3.14.2 x86 / pywin32 312 | PASS / Tier 2 | 两台已登录 SSH 服务器 × 新旧 MCP 协议，各 15 项检查；[脱敏收据](acceptance/windows-xshell-0.5.1.json) |

SecureCRT 首次启动失败原因为可用外部 Python 3.13 超出该 9.5.2 安装版弹窗列出的 3.8–3.11；安装 3.11、重启并运行原生 Bridge 后成功。最初完整冒烟曾遇到捕获超时并留下未决状态；检查原终端、明确恢复后运行的完整 22 项通过。该失败没有被写成“命令未发送”，没有自动重放或自动 Ctrl+C。

基线源码：PR #29 的 `26c05849a8ea98ad6fe6a22e67326ed05669f569`；后续能力探测脚本已在同一机器重载，`doctor` 检出 16 项必要 API，缺失/未知均为 0。新旧两种 MCP 时代的最小五项分别通过。原始本机收据保存在被 Git 忽略的 `.local-evidence/`，不公开终端历史、端点、token 或会话 ID。

## Windows Xshell 实际验收

源码 `e8b32f456f7bfb8c6c8ce7dfc90ef0401894fe84` 的 CI Windows 工件已在上述虚拟机安装，实际加载的 Bridge 摘要与源码一致。两台服务器分别在 legacy / modern 协议下通过执行、三命令批量、中文 UTF-8 分页、错误提示符拒绝、去重、超时保留输出、未决状态拒绝发送、显式中断、检查后确认 idle、恢复执行，以及 snapshot / prompt / stream 不带换行末行输出和 prompt attachment 复用。测试输出用分段 printf 生成，避免把命令回显当成成功结果。doctor 返回 0，两个实时实例的必要 API 均通过；没有把此结果升级成完整 Tier 1 版本矩阵认证。

该安装版嵌入 Python 3.8.6 的 `Xsh` 绑定在重复 Sleep / Send 时出现原生引用计数缺陷，已复现进程崩溃；这组精确运行时禁止写入。实测使用厂商支持的 [外置 32 位 Python / pywin32](https://netsarang.atlassian.net/wiki/spaces/ENSUP/pages/1816723519/Using+Python+scripts+with+an+installed+Python+program+Python+v3.14)，固定安装目录并重新启动原生脚本。原始会话文件、凭据和服务器业务配置未修改。

## 暂缓的 Windows 格子

每行包含独立的最低和最高 Python 格子，两个 OS 列均是独立待测组合。版本范围来自厂商 history 的新增/移除记录；最终还应核对各安装版 System Requirements。9.7.3 为本次核对的最新 9.7.x。[9.7 history](https://www.vandyke.com/products/securecrt/history.txt)

| 产品版本 | Python 边界 | Windows 10 22H2 | Windows 11 | 版本范围证据 |
|---|---|---|---|---|
| SecureCRT 9.1.x | 最低 3.8 | DEFERRED | DEFERRED | 9.0 引入外部 3.8 |
| SecureCRT 9.1.x | 最高 3.9 | DEFERRED | DEFERRED | 9.1 新增 3.9；Windows 11 厂商兼容从 9.1.1 开始 |
| SecureCRT 9.3.x | 最低 3.8 | DEFERRED | DEFERRED | 3.8 尚未移除 |
| SecureCRT 9.3.x | 最高 3.10 | DEFERRED | DEFERRED | Windows/Mac 9.2 新增 3.10 |
| SecureCRT 9.5.x | 最低 3.8 | DEFERRED | DEFERRED | 本机 9.5.2 载入错误提示列明范围 |
| SecureCRT 9.5.x | 最高 3.11 | DEFERRED | DEFERRED | 9.4 新增 3.11 |
| SecureCRT 9.6.x | 最低 3.9（安装版复核） | DEFERRED | DEFERRED | 9.6 明确移除 3.8；下界由继承范围推导，不是实测 |
| SecureCRT 9.6.x | 最高 3.13 | DEFERRED | DEFERRED | Windows/Mac 9.6 新增 3.12/3.13 |
| SecureCRT 9.7.3 | 最低 3.9（安装版复核） | DEFERRED | DEFERRED | history 未给完整最低版本清单，保留复核要求 |
| SecureCRT 9.7.3 | 最高 3.14（Windows） | DEFERRED | DEFERRED | 9.7 新增 Windows 3.14；不能推广到 Mac/Linux |
| Xshell 7 | 该安装版实际引擎 | DEFERRED | DEFERRED | 文档列 Python 脚本与 Session/Screen API；嵌入版本未实测 |
| Xshell 8 | 外置 3.14.2 x86 / pywin32 312 | DEFERRED | 上述 ARM64 精确组合 PASS / Tier 2；其他组合 DEFERRED | 不进行 OS 交叉矩阵 |
| OS 自带 OpenSSH | 实际 `ssh -V` | DEFERRED | DEFERRED | 不把 GitHub runner 或 Mac 的版本代入 Windows |

官方版本记录：[9.0](https://www.vandyke.com/download/securecrt/9.0/history.txt)、[9.1](https://www.vandyke.com/download/securecrt/9.1/history.txt)、[9.2](https://www.vandyke.com/download/securecrt/9.2/history.txt)、[9.4](https://www.vandyke.com/download/securecrt/9.4/history.txt)、[9.6](https://www.vandyke.com/download/securecrt/9.6/history.txt)。

## 统一最小冒烟

先核实闲置的 POSIX 测试目标，从 `connector_list` 取得实际目标 ID。新请求不按旧标签下标或标题替换目标。

```text
python tests/connector_acceptance.py PATH_TO_BINARY --backend securecrt --target OPAQUE_ID --protocol legacy --source-commit TESTED_SHA --tested-on YYYY-MM-DD --output PRIVATE_RECEIPT.json
python tests/connector_acceptance.py PATH_TO_BINARY --backend securecrt --target OPAQUE_ID --protocol modern --source-commit TESTED_SHA --tested-on YYYY-MM-DD --output PRIVATE_RECEIPT.json
```

Xshell 改 `--backend xshell`；OpenSSH 使用明确选定的 alias，可加 `--config-path`。最小集依次验证 attach、字面 `printf` 执行、三命令 batch、UTF-8 字节分页、拒绝前零发送。OpenSSH 页若提供 base64，按原始字节拼接，不能拼接有损 text 预览。失败只记录 FAIL 和错误类型，退出并检查原终端，不自动重发/ack。

CI 将已测试的原生 ZIP 和摘要作为 `native-test-bundle-OS-ARCH` 工件保留，供本机/实际 Xshell 测试环境使用；它不是新 Release，也不证明终端原生 API 已通过。预编译用户无需安装 Rust。选择工件时核对同一 CI 提交和 SHA-256，不混用旧 Release 的二进制与新 Bridge。

扩展的 SecureCRT 原生测试使用 `tests/securecrt_desktop_smoke.py`：大输出、非零退出、operation_id 去重、双标签、显式超时与 Ctrl+C 恢复；后两项必须显式传 `--exercise-recovery`。这是操作者选择的测试流程，不是产品的自动恢复逻辑。
