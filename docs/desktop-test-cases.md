> 当前安装与平台入口见[一键安装](installation.md)。Windows 仅使用 `.js`；Mac 仅保留 `securecrt_bridge.py` 原生层，工具均为 JS/Rust。

# 桌面自动验收用例

当前工具以 Node 控制 Rust/Mac最小原生层/Windows JScript；Mac双Tab矩阵与UI记录见
[2026-10-09回执](acceptance/mac-native-matrix-2026-10-09.md)。Windows历史证据与新源码分别认证；Linux桌面未测。不同验证层分别记录，不把
模拟原生对象、WSH 启动或 TCP 故障测试当作真实 SSH 执行。

## 一键运行

两边先加载与当前二进制配套的脚本，确认各个目标是空闲 POSIX 测试终端。
下面命令明确授权对全部发现的空闲会话执行无业务修改的测试命令：

```powershell
node tests/desktop_matrix.js target/release/securecrt-mcp.exe --all-idle --expect-securecrt 2 --expect-xshell 2 --exercise-recovery --output-dir .local-evidence/desktop-matrix
```

Mac 仅测 SecureCRT：

```sh
node tests/desktop_matrix.js target/release/securecrt-mcp --backend securecrt --all-idle --exercise-recovery --output-dir .local-evidence/mac-desktop-matrix
```

默认最多四个独立 Tab 并行；同一 Tab 的后续阶段依次运行。每个 Tab 先完成
完整 legacy 验收，然后完成 modern 验收；最后统一测试多 Tab 同时执行。
发送测试命令之前先以只读 ping 和 doctor 核对实际运行的脚本摘要，旧脚本
未停止或选错文件时立即失败；结束后再次检查完整接口记录与摘要。
`--expect-*` 校验覆盖数量，漏掉 Tab 不能算通过。

不希望接入所有会话时，用多个 `--target backend=会话ID` 替代 `--all-idle`。
`--exercise-recovery` 会执行有限 `sleep` 超时、显式 Ctrl+C 与恢复检查；省略
后这些真机项为未测。所有中断都仅针对本次明确启动的测试命令。

结果输出 `matrix.md`、`matrix.json` 与各 Tab 分项 JSON，退出码 0 表示全部
已运行项目通过，1 表示失败。回执不含地址、会话 ID、Token 或原有终端历史。
失败 Tab 不再进入后续命令阶段，也不自动重跑、重启脚本或确认空闲。独立
Tab 可以完成各自测试。每次使用新的输出目录保留历史失败证据。

## 用例与验证层

| 编号 | 场景与通过标准 | 自动执行方式 |
| --- | --- | --- |
| W01 | 32/64 位 JScript、中文路径、无 Python/Node PATH，自带程序释放且摘要一致 | `portable_windows_smoke.js` |
| W02 | 再次启动保留 Token/策略，升级刷新固定文件，不重置已选择传输 | 同上 |
| W03 | 800 次认证 IPC 请求，同时取走结果文件，循环不中断且取消后移除登记 | 同上；真实 Windows 文件系统，模拟终端对象 |
| N01 | JSON/SHA-256、畸形输入、重复键、原型键、过期与认证失败不发送 | `windows_bridge_test.js` |
| N02 | SecureCRT 同 PID 重复启动只通知；不同 PID 独立；旧实例暂停时不抢占；原生文件锁释放后才能重新启动 | 同上；实际取消与提示另行真机检查 |
| N06 | SecureCRT 批量读取完整 2,500 行，保留 Unicode、真实退出码；结束标记后未收到退出码不能伪造完成 | `windows_bridge_test.js`；真实时限由 D07 验证 |
| N03 | 连接/身份/租约改变、断开、错误令牌、观察模式与持有者冲突拒绝 | 同上；原生对象模拟，非 GUI 断线证明 |
| N04 | native send 失败保持未知；watchdog、清理、捕获状态恢复、临时附件回收 | 同上 |
| N05 | ping 不读可能调用等待/发送的 COM 方法属性；文件消失不退出循环 | 同上 |
| R01 | Windows 共享读短暂拒绝时仅重读原文件；等待有上限 | Rust 文件读取测试 |
| R02 | MCP 参数/策略拒绝、逐字节标记、取消、长行、审计失败、断链不重放 | MCP/故障/重绘回归脚本 |
| R03 | 两实例同时在线，原实例登记短暂消失/JSON 未写完仍只轮询原实例；真正离线拒绝，不换实例 | `file_transport_fault_smoke.js`；编译后的 Rust + 模拟文件适配器 |
| D01 | 每个真实已连接 Tab 被选中并验证新鲜空闲屏幕，无未决任务 | `desktop_matrix.js` 前置检查 |
| D02 | 明确 POSIX 完成标记及退出码 0 | 每 Tab 全面验收 |
| D03 | 同 operation ID 返回同 command ID，命令只发送一次 | 同上 |
| D04 | 中文与无换行输出完整；退出码 7 如实保留 | 同上 |
| D05 | 三命令 batch 独立输出、状态、退出码，无漏项 | 同上 |
| D06 | 同一附件连续 20 条命令，记录中位数、p95 与各次耗时 | 同上 |
| D07 | 2,500 行中文，原定 10 秒捕获预算完成；逐行核对内容及顺序，无丢行、重复或污染，无截断 | 同上；页数随输出字节数变化 |
| D08 | 错误提示符被拒绝且 `sent=false`；heartbeat 无未决状态 | 同上 |
| D09 | 有限 sleep 超时保持不确定，阻止新输入；未明确确认不得清除状态 | `--exercise-recovery` |
| D10 | 原终端恢复空闲后，以新鲜令牌明确恢复；旧附件作废，新附件可执行 | 同上 |
| D11 | 显式中断本次 sleep；返回取消，不能冒称远端全部进程已终止 | 同上 |
| D12 | modern 协议握手、执行、batch、UTF-8 小分页与拒绝 | 每 Tab modern 最小验收 |
| D13 | 同时向所有Tab发送有限sleep+不同标记，确认所有任务同时running，各结果只含自己的标记 | 矩阵最后的并发隔离检查 |
| D14 | 实际终端版本、脚本引擎、架构与脚本摘要匹配所测二进制；旧版在发送前被拦截 | 只读 ping 与在线 doctor；逐实例检查 |
| U01 | 解压后选择脚本即启动；成功提示的数量与实际在线一致 | 真机 UI；WSH 隔离测试补充依赖证据 |
| U02 | SecureCRT 其他 Tab 重复运行只提示已启动，原实例继续响应 | 真机 UI；本轮通过 Computer Use 捕获提示及原实例心跳 |
| U03 | 空闲时 Script → Cancel 释放原生独占锁，5 秒内旧登记失效，保持登录；重新运行获得新句柄 | 真机 UI，不能用模拟取消替代；原生取消可能跳过 finally；实际Cancel可用的Tab随SDK操作范围而变 |
| U04 | 断开/重连同一测试 Tab 后旧附件 `sent=false`；新一代目标重新绑定并执行 | 原生 UI + `desktop_lifecycle_probe.js`；关闭重建 GUI 路径未单独测试 |

`W/N/R` 是开发自动回归，`D` 是自动真机验收，`U` 是需要客户端 UI 配合的
验收。未完成的项目明确写为未测；不能把其中一层的成功覆盖其他层。

长输出超时、输出丢失、串会话、版本/摘要不一致以及不确定结果都判 FAIL。
扩大原预算、重新绑定或自动重发后成功不能替代原失败。恢复前必须查看原
终端的真实完成情况与空闲边界，并保留旧命令的不确定历史。

## 断开重连自动断言

仅选专用空闲 Tab，运行 `desktop_lifecycle_probe.js`，传入二进制、`--backend`、
`--target`、新的 `--control-dir` 和 `--output`。测试保持同一个 MCP 进程和旧附件，
依次输出 `await_disconnect`、`await_reconnect`。通过原生 UI 断开后确认实际断开，
再在控制目录创建 `disconnected.flag`；原生重连并确认空闲后创建
`reconnected.flag`。UI 可由 Computer Use 操作，无需让用户手工点选。

测试自动核对：旧附件在断开时及重连后均拒绝发送、同一目标获得新标识、
新附件只执行一次唯一标记。阶段默认最长 180 秒，失败保留回执并停止，不重放。
UI 操作失败时不能写确认文件；不能复用旧控制目录。控制文件、真实目标标识和
终端历史只放 `.local-evidence`；仅脱敏最终回执可提交。例：

```text
node tests/desktop_lifecycle_probe.js <binary> --backend <securecrt或xshell> --target <明确测试目标> --control-dir .local-evidence/lifecycle-<唯一编号> --output .local-evidence/lifecycle-<唯一编号>.json
```

本轮结果见[四 Tab 矩阵](acceptance/windows-native-matrix-2026-10-08.json)及
[原生 UI 回执](acceptance/windows-native-ui-2026-10-08.json)。
