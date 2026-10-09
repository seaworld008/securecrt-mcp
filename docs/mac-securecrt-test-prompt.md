> 当前安装与平台入口见[一键安装](installation.md)。Windows 仅使用 `.js`；Mac 仅保留 `securecrt_bridge.py` 原生层，工具均为 JS/Rust。

# Mac SecureCRT 真机验收提示词

将下面内容直接交给 Mac 上的 Codex。Windows 的回执只能作为参照，不作为
Mac 通过的证明。

```text
请在这台 Mac 上完成 securecrt-mcp 最新 main 的 SecureCRT 真机验收，持续修复
直到通过，不能只做编译或模拟测试。仓库：https://github.com/seaworld008/securecrt-mcp.git。

先遵守当前仓库 AGENTS.md，检查现有工作区、未提交修改、macOS 架构、SecureCRT
完整版本及实际脚本引擎。已有仓库先 fetch，确认工作区干净再切 main 并 pull
--ff-only；保留我的未提交修改，存在冲突时使用隔离工作区，不 reset/clean。
没有仓库则克隆。记录 origin/main 与实际 HEAD，确保包含 Windows 自包含脚本
及 tests/desktop_matrix.js；读 docs/desktop-acceptance.md、
docs/desktop-test-cases.md 和 Windows 脱敏验收回执（若仓库中提供）。

构建 cargo build --release --locked，执行 ./target/release/securecrt-mcp upgrade
及 doctor --offline。保留原 Token、策略、登录连接，不 init --force，不新增
旧版备份管理。Mac 入口是 ~/.securecrt-mcp/securecrt_bridge.py，不能运行
Windows 的 .js。不要依据终端里的 python --version 猜测 SecureCRT 的引擎；
必须读取运行中的桥接报告。优先用已经可用的引擎，缺少依赖先明确具体原因，
不要盲目安装多套 Python 或改全局 PATH。

在我现有 SecureCRT 窗口里、空闲时取消旧脚本并加载新入口；若你无法操作原生
菜单，只让我完成这一步，其余自动执行。不要用 /SCRIPT 另开未连接窗口。
Mac执行附件绑定会原生选择对应测试Tab；首次绑定不发送探测输入。
一个 SecureCRT 进程运行一次脚本，要覆盖这个进程的所有已连接测试 Tab；
至少两个 Tab。明确列出数量并确认这些是允许执行无业务修改测试的空闲
POSIX 终端，不能漏掉 Tab 后宣称全部通过。其他不属于测试的会话不要发送输入。

先做真实会话发现和新鲜屏幕检查，随后执行：
node tests/desktop_matrix.js target/release/securecrt-mcp --backend securecrt
  --all-idle --expect-securecrt <实际确认的测试Tab数量> --exercise-recovery
  --output-dir .local-evidence/mac-desktop-<本次唯一编号>
上面是一条命令；仅当全部已连接会话均为获准测试的终端时使用 --all-idle，
否则用多个 --target securecrt=<实际会话ID> 明确限定，并校验所选数量。

逐 Tab 覆盖 legacy 和 modern 协议、同一附件连续 20 条执行、operation ID 去重、
中文与无换行输出、退出码 7、三命令 batch、2,500 行中文在原定 10 秒预算完成、
分页首尾及完整性、错误提示符拒绝、heartbeat、有限 sleep 超时保持不确定、
显式 Ctrl+C 和新鲜上下文恢复，以及全部测试 Tab 的并发隔离。用不同标记核对
没有串会话；不能只测一个 Tab。完成后 doctor --backend securecrt 必须通过，
运行中的桥接摘要必须与所测二进制一致。

按用例文档补充真实 UI 检查：同进程其他 Tab 重复启动友好提示且原实例继续
响应；取消脚本后登记消失而 SSH 登录保持；重新加载获得新句柄；仅在专用
测试连接上验证断开/重连后旧句柄拒绝。UI 无法操作的项目明确标未测，不用
模拟测试顶替，不把 Windows 的重复启动表现假定成 Mac 结果。

失败时记录 FAIL 和准确阶段，保留已有回执及审计。不重发不确定命令，不因
超时扩大预算来制造通过，不自动确认空闲或中断未明确属于本次测试的命令。
恢复必须先检查原会话真正结束及空闲边界，再使用新鲜屏幕令牌显式确认。
修复后加载与新二进制配套的脚本，只重新验证受影响项；最终完整矩阵也要
通过。可并行独立 Tab，避免无理由重复构建、长等待或整套测试。

修复需要同时保持 Windows 共享核心及脚本契约兼容，运行相关 Rust、Node、Mac 原生适配契约
及编译后 MCP 回归；不要声称 Mac 能验证 Windows 原生 UI。

输出脱敏 matrix.json/matrix.md：代码提交及是否有未提交改动、二进制/桥接
SHA-256、系统/架构/SecureCRT/实际引擎版本、覆盖 Tab 数量、每项 PASS/FAIL/
未测、总耗时、短命令中位数和 p95、长输出耗时及完整性。不要提交地址、
用户名、会话ID、密码、Token 或已有终端历史。若所有要求未通过，明确剩余
阻塞，禁止称作最终版。如果产生修复，测试通过后提交 PR，等待 CI 全绿再
合并 main，并核对远端 main 已包含修复。最后简洁汇报结果和证据路径。
```
