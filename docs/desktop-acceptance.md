> 当前安装与平台入口见[一键安装](installation.md)。Windows 仅使用 `.js`；Mac 仅保留 `securecrt_bridge.py` 原生层，工具均为 JS/Rust。

# 桌面客户端测试与验收规范

当前平台入口为 Windows Xshell/SecureCRT JScript 与 Mac SecureCRT 最小 Python 原生层。
Mac 2026-10-09 两 Tab 完整矩阵及原生 UI 已通过，见[脱敏 Mac 回执](acceptance/mac-native-matrix-2026-10-09.md)。Windows历史回执只认证其中的确切源码；Linux桌面未进行本轮真机验收。
模拟测试、编译和 Windows 通过均不能替代 Mac 真机证据。

## 入口与统一接口

所有客户端使用同一个 Rust 核心和 `connector_*` 工具协议。Windows 共用
`bridge/windows_bridge.js` 和同一个启动模板，仅客户端标记、脚本头不同。
SecureCRT 强制要求语言脚本头，Xshell 使用 `Main()` 入口，因此发布包提供
两个明确命名的文件；不要求用户修改脚本识别客户端。

| 系统 / 客户端 | 选择的入口 | 运行要求 |
| --- | --- | --- |
| Windows Xshell | `securecrt-mcp-xshell.js` | 包内自带 Rust 程序；不用安装 Python、pywin32 或 Rust |
| Windows SecureCRT | `securecrt-mcp-securecrt.js` | 包内自带 Rust 程序；不用修改 SecureCRT Python 设置 |
| macOS SecureCRT | `securecrt_bridge.py`，由 `init/upgrade` 安装 | 使用 SecureCRT 实际加载的兼容 Python 引擎；JScript 入口不适用于 Mac |
| OpenSSH | 同一个 Rust 程序的 `backend=openssh` | 系统 OpenSSH、现有 Agent 和 known_hosts；不自动接管其他工具的登录会话 |

Windows 解压发布包后，在终端「运行脚本」中选择对应 `.js`。首次运行自动
释放配套程序到用户目录，核对二进制和桥接摘要，保留 Token、策略和登录。
成功后显示客户端、已连接会话数；提示自动关闭，桥接持续运行。停止使用
终端「停止/取消脚本」。没有会话时不能宣称执行验收通过。

SecureCRT 每个应用进程只需启动一次，管理该进程内的全部已连接 Tab。
其他 Tab 重复选择脚本应提示“已经启动，无需重复运行”，立即结束新脚本。
SecureCRT 的原生 Script → Cancel 可能跳过脚本的清理代码；只能在空闲时取消。
独占文件锁随脚本引擎释放，允许同一进程重新运行；旧在线登记最多 5 秒后
因心跳过期失效。不能把遗留登记文件当成仍在运行，也不能仅凭心跳抢占锁。
独立 SecureCRT 进程分别启动。原脚本无响应时提示先停止旧脚本再重启，
不得仅因为心跳过期另起一份脚本。Xshell 按实际可发现的窗口/会话范围启动，
验收必须确认枚举结果覆盖目标，不能照搬 SecureCRT 的全 Tab 规则。

JScript 的 COM 方法属性读取可能直接调用方法。在线检查只读取安全属性，
发送/等待接口在真实调用成功后记为已验证；未使用前为未知。在线检查
不得等待远端输入或发送命令；实际执行测试后再次检查接口记录。

拉取源代码本身不会覆盖用户目录中的脚本。开发测试按下面顺序更新：

```powershell
cargo build --release --locked
.\target\release\securecrt-mcp.exe upgrade
```

Windows `upgrade` 更新固定名称的 `.js` 入口，保留已选择的文件 IPC 传输、
Token 和策略。只有闲时取消旧脚本并重新运行，新代码才进入终端进程。
本轮不新增旧版备份管理功能。重启 MCP 服务后重新枚举会话，旧句柄作废。

## 验收环境与证据

Windows 两个 SecureCRT Tab、两个 Xshell Tab 的[完整真机矩阵](acceptance/windows-native-matrix-2026-10-08.json)
已全部通过，总耗时 89.42 秒。每个 Tab 均完成 legacy 全面验收、modern 验收、
显式恢复；两种客户端的跨 Tab 并发隔离也通过。2,500 行中文均按内容和顺序
逐行一致，在原定 10 秒预算内完成：SecureCRT 两 Tab 为 2.51 / 1.40 秒，
Xshell 为 9.90 / 3.03 秒。Xshell 后台 Tab 接近预算上限，慢机器仍须重新验收。

[原生 UI 回执](acceptance/windows-native-ui-2026-10-08.json)另行记录：固定入口启动
及友好重复提示、同进程 Cancel 后重新启动且保留两个登录连接，以及两种客户端
断开/重连后旧附件拒绝发送、新附件执行成功。取消原生脚本时，SecureCRT 自身
会显示 `Script Cancelled`，这是客户端取消通知。请在最初启动脚本的 Tab 打开
Script → Cancel；其他 Tab 的 Cancel 可能处于禁用状态。

[验收状态](acceptance/windows-validation-2026-10-08.json)只证明所记录二进制与
工作区源码的历史 Windows 验收。Mac 独立回执见上面的2026-10-09记录，Linux桌面未测。早期
[Xshell 单独回执](acceptance/windows-xshell-native-2026-10-08.json)保留为历史记录；
其摘要和时长不代表最终四 Tab 矩阵。真实 UI 回执只覆盖断开并重连同一 Tab，
关闭后重建 Tab 的 GUI 路径未单独测试；断线必须被原生轮询实际观察到。

每份回执记录：日期、操作系统和架构、终端完整版本、脚本引擎、Rust
二进制与桥接 SHA-256、代码提交、MCP 协议模式。工作区有未提交改动时必须
明确说明，不能只写旧 HEAD 表示新功能来源。回执不包含密码、Token、
服务器地址、已有终端历史或会话文件内容。

使用明确指定的空闲 POSIX 测试会话；测试命令以 `printf`、`hostname`、
`uptime`、`pwd` 和有限次数的 `awk` 为主。生产业务配置、服务、数据不作为
验收样本。结束标记只证明该命令完成，不证明所有后台后代已终止。

## 自动门槛

```text
cargo fmt --all -- --check
cargo check --locked --all-targets --all-features
cargo clippy --locked --all-targets --all-features -- -D warnings
cargo test --locked --all-targets --all-features
node tests/mac_adapter_contract.js
node tests/windows_bridge_test.js
node tests/portable_windows_smoke.js target/release/securecrt-mcp.exe
node tests/package_smoke.js target/release/securecrt-mcp.exe x86_64-pc-windows-msvc
node scripts/validate_repository.js
```

这里的 Node 是开发控制器依赖；Mac 原生契约开发测试才调用 Python。Windows 发布入口无这些运行依赖。
Windows 隔离测试会从子进程 PATH 排除它们，并覆盖中文路径、32/64 位
Windows 脚本引擎、首次释放、再次启动、摘要、取消清理和配置保留。

## 一键覆盖全部 Tab

完整用例、并行矩阵与结果读取见 [桌面自动验收用例](desktop-test-cases.md)。
矩阵逐个检查所选 Tab，覆盖 legacy/modern、连续复用、长输出和跨 Tab 隔离。

## 真机门槛

| 检查 | 通过标准 |
| --- | --- |
| 首次启动 | 不安装依赖，不改注册表、PATH 或 Python 设置；成功提示与实际桥接在线一致 |
| 重复启动 | SecureCRT 同一进程其他 Tab 再运行时提示已启动；原脚本继续响应，实例与捕获不被替换 |
| 在线检查 | 及时返回，不调用发送/等待接口；连续检查后原脚本仍响应 |
| 发现与身份 | 列出实际已连接目标；重新启动不复用旧句柄；不靠 Tab 序号替代身份 |
| 核心执行 | 明确退出码；中文、无换行输出保持完整；非零退出码如实返回 |
| 连续复用 | 同一附件连续执行 20 条命令，无重绑、漏输出或串会话 |
| 批量 | 三条命令分别返回输出、状态、退出码；不确定结果停止后续命令 |
| 操作去重 | 同一 MCP 进程中，相同 operation ID 返回原 command ID，不重复发送 |
| 长输出 | 2,500 行中文输出在原定 10 秒捕获预算内完成，首尾存在，分页完整且无截断 |
| 多会话 | 两个明确目标分别完成，输出不串；不支持的原生发现方式如实报告 |
| 上下文拒绝 | 错误提示符、已有输入、观察模式或持有者冲突，必须 `sent=false` |
| 超时 / 取消 | 保留不确定状态；新命令被拦截；不自动重试、Ctrl+C 或确认空闲 |
| 显式恢复 | 先检查原会话与真实完成情况，再用新鲜屏幕令牌明确确认；错误令牌不得清除未决状态 |
| 停止脚本 | 移除在线登记，恢复本工具改变的原生捕获状态；保持登录连接 |

长输出 10 秒未完成即该项 FAIL。调大预算成功只能补充记录，不能替代原预算
通过。出现不确定结果先检查原终端，禁止自动重跑来制造绿色结果。

两种 MCP 协议模式分别运行最小验收：

```text
node tests/connector_acceptance.js <binary> --backend <securecrt或xshell> --target <已确认的会话ID> --protocol <legacy或modern> --source-commit <commit> --tested-on <日期> --output <回执.json>
```

全面验收使用同一个跨客户端脚本：

```text
node tests/securecrt_desktop_smoke.js <binary> --backend <securecrt或xshell> --session <已确认的会话ID> --peer <第二会话ID> --protocol legacy --output <回执.json>
```

`--peer` 可省略；省略时多会话项为未测。`--exercise-recovery` 才执行有限
超时和明确 Ctrl+C 测试，必须选择可中断的测试会话。默认不发送 Ctrl+C。
发生失败保存 FAIL 回执；退出不改变未知命令的历史结果。

## Mac 拉取后执行

可直接使用 [Mac 真机验收提示词](mac-securecrt-test-prompt.md) 交给 Mac 上的 Codex。

先拉取包含本次改动的确切分支 / 提交；Windows 本地改动没有推送时不能从
远端获取。Mac 上构建与初始化：

```sh
git pull --ff-only
cargo build --release --locked
./target/release/securecrt-mcp upgrade
./target/release/securecrt-mcp doctor --offline
```

在 SecureCRT 中闲时取消旧脚本，运行 `~/.securecrt-mcp/securecrt_bridge.py`。
然后运行在线 `doctor`，确认报告中的 **实际加载 Python**、终端版本、
原生 API 和摘要。已有引擎满足该安装版要求时无需再安装；不把外部
`python --version` 当作 SecureCRT 引擎证据。

重启 MCP 服务，列出会话并人工确认空闲目标。执行上面的两种协议最小
验收，以及全面验收（`<binary>` 使用 `target/release/securecrt-mcp`、
`--backend securecrt`）。按相同标准检查中文、连续复用、批量、多 Tab、
长输出和恢复，提交脱敏 JSON 回执。其他源码/设备仍需独立真机回执，本次精确Mac运行见上面的记录。

## 厂商依据与扩展原则

- [SecureCRT 脚本语言、脚本头和同步捕获](https://www.vandyke.com/support/securecrt/scripting_faq.html)
- [Xshell 支持的脚本语言](https://netsarang.atlassian.net/wiki/spaces/ENSUP/pages/2237305656/Using%2BScripts)

其他 SSH 工具只有公开并可验证的原生接口才能复用其已有会话。增加后端
必须沿用统一工具协议、显式选择目标、原生线程调用、认证和边界检查。
禁止用键盘模拟、读取密码、隐式新建 SSH 或失败后自动切换后端冒充兼容。
