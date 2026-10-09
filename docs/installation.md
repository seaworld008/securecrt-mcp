# 安装、升级与运行时引擎

[简体中文](installation.md) · [English](installation.en.md) · [文档地图](README.md) · [Agent 安装提示词](agent-setup.md#中文提示词) · [Codex](clients/codex.md) · [Claude](clients/claude.md)

本页介绍**当前 main**，并不适用于每一个已发布的 ZIP。桌面桥接沿用终端已有登录；OpenSSH 是需要显式选择并另行授权的独立连接。

<a id="1-select-and-verify-the-source"></a>

## 1. 选择并核验来源

公开 **v0.5.2** 发布自 [`3c3489ba267008af2e7bdcc09b0f890c56feb71b`](https://github.com/seaworld008/securecrt-mcp/commit/3c3489ba267008af2e7bdcc09b0f890c56feb71b)，早于当前 `install` 命令和 Windows 自包含 JScript 入口。该旧版 ZIP 不含 `install.cmd` 或 `install.command`。它的历史 Windows Python 要求与当前 main 不同；若明确选择该版本，应使用包内配套版本文档。不要将其二进制与当前桥接文件混用。

选择一种来源：

| 来源 | 核对内容 |
| --- | --- |
| [公开 Release](https://github.com/seaworld008/securecrt-mcp/releases/latest) | 发布 tag、记录的源码提交、目标架构、包内文件及该 Release 自己的 `SHA256SUMS`。最新发布不代表支持当前 main 安装器。 |
| [成功的 main CI](https://github.com/seaworld008/securecrt-mcp/actions/workflows/ci.yml?query=branch%3Amain) | 运行对应的精确提交、相关任务成功结果和 `native-test-bundle-<OS>-<ARCH>` artifact。先解开 artifact 外层，再用随附 `.zip.sha256` 校验内层 ZIP。下载可用性和登录要求由 GitHub 控制；这是测试包，不是 Release 或桌面验收证明。 |
| main 源码 | 保留当前 main 及配套文档，记录完整提交和工作区状态，核对该提交的成功 CI，再用 Rust 1.88+ 与平台链接器/工具链本地构建。 |

```sh
git clone --branch main https://github.com/seaworld008/securecrt-mcp.git
cd securecrt-mcp
git rev-parse HEAD
```

继续前，在 [main CI](https://github.com/seaworld008/securecrt-mcp/actions/workflows/ci.yml?query=branch%3Amain) 中找到上述提交的成功运行，再构建：

```sh
cargo build --release --locked
```

使用 `target/release/securecrt-mcp`（Windows 为 `target/release/securecrt-mcp.exe`）。保留这份源码副本，让新的安装与 Agent 指南仍可在本地查阅。历史验收提交描述的是当时记录的运行时，不是默认安装应切换的提交；相同版本号不能证明包身份一致。

在下载 ZIP 和可信摘要文件所在目录核验摘要，将 `PACKAGE.zip` 换成实际文件名：

```sh
# macOS：将输出与 SHA256SUMS 或 PACKAGE.zip.sha256 比较
shasum -a 256 PACKAGE.zip
# Linux：完整 Release 文件集或所选 CI ZIP 已下载时
sha256sum --check SHA256SUMS
# CI ZIP 则使用：
sha256sum --check PACKAGE.zip.sha256
```

```powershell
Get-FileHash -Algorithm SHA256 .\PACKAGE.zip
# 将 Hash 与 SHA256SUMS 或 PACKAGE.zip.sha256 中的对应条目比较。
```

同时核验来源：摘要能发现字节不匹配，不能证明发布者身份。检查所选二进制的 `--help`、`--version` 和 ZIP 文件清单。仅在包内确实提供、且与二进制配套时使用 `install.cmd` / `install.command`。不要关闭系统防护或绕过安全提示；让用户按本地策略授权已核验的来源。

<a id="2-choose-the-application-directory-and-client"></a>

## 2. 选择应用目录与客户端

默认应用目录在 Windows 为 `%USERPROFILE%\.securecrt-mcp`，在 macOS/Linux 为 `~/.securecrt-mcp`。可用 `SECURECRT_MCP_HOME` **绝对路径**覆盖默认值。初始化、桥接、诊断和每个 MCP 客户端必须使用同一目录。用 `paths` 获取实际路径，不猜测路径，也不公开配置秘密。

**Windows 自定义目录注意事项：** 自包含启动器从**终端进程环境**读取 `SECURECRT_MCP_HOME`，不是从所选脚本所在文件夹读取。已运行的 SecureCRT/Xshell 不会继承后来修改的 PowerShell 环境变量，MCP 客户端的 env 也不会设置终端 env。已登录终端优先沿用已有/默认目录。使用自定义目录时，终端必须在启动时继承同一变量；退出或重启需要用户授权，不能丢弃现有 SSH 工作。若无法满足，暂停此步骤，不要悄悄初始化第二个目录。macOS 原生脚本则加载实际脚本文件旁的 `bridge.json`。

下面的示例需要先替换路径。`/absolute/path` 与 `C:\Tools` 只是占位符，不是指定安装位置。

```sh
export SECURECRT_MCP_HOME="/absolute/path/to/app-home"
"/absolute/path/to/securecrt-mcp" paths
# Codex 用户：
"/absolute/path/to/securecrt-mcp" install
# 仅用 Claude / 其他客户端：选择 init，替代 install
# "/absolute/path/to/securecrt-mcp" init
```

```powershell
$env:SECURECRT_MCP_HOME = "C:\Tools\securecrt-mcp-home"
& "C:\Tools\securecrt-mcp.exe" paths
# Codex 用户：
& "C:\Tools\securecrt-mcp.exe" install
# 仅用 Claude / 其他客户端：选择 init，替代 install
# & "C:\Tools\securecrt-mcp.exe" init
```

**`install` 做什么**（见 `src/installation.rs`）：

1. 将正在运行的二进制复制到 `<app-home>/bin`。
2. 初始化/更新平台桥接，保留已有令牌、策略与 SSH 登录。
3. 写入 Codex 的 `mcp_servers.securecrt`：绝对路径 `command`、`args = ["serve"]` 和 `env.SECURECRT_MCP_HOME`。若 `CODEX_HOME` 环境变量是绝对目录，使用其 `config.toml`；否则使用用户的 `.codex/config.toml`。
4. 保留其他 MCP 条目、注释、已有审批、工具限制及其他 env 键。仅在缺失时添加启动/工具超时；新条目使用客户端自己的默认审批行为。打印已安装二进制和桥接位置。

它不改全局 PATH，也不配置 Claude；即使用户只打算用 Claude，它仍会写 Codex。**仅用 Claude 时，应将已核验二进制保留在稳定绝对路径，改用 `init`，再单独注册到 Claude。** `init` 初始化应用配置与桥接，不复制私有二进制，也不写 Codex。备份可能包含秘密，应私下保存。其他 MCP 客户端同样使用 stdio 命令、`serve` 参数和同一应用目录。

增量配置示例见 [Codex 接入](clients/codex.md)（[English](clients/codex.en.md)）和 [Claude Code / Desktop 接入](clients/claude.md)。这些客户端的配置与审批机制各自独立。

<a id="3-load-the-native-bridge"></a>

## 3. 加载原生桥接

| 后端 | 当前入口 | 用户运行依赖 |
| --- | --- | --- |
| Windows SecureCRT | `<app-home>\securecrt-mcp-securecrt.js` | SecureCRT + 系统 JScript；无需 Python、Node 或 Rust |
| Windows Xshell | 检测到的 Xshell 标准 Scripts 目录；显式设置 `SECURECRT_MCP_HOME` 时为 `<app-home>\xshell-scripts\securecrt-mcp-xshell.js` | Xshell + 系统 JScript；无需 Python、Node 或 Rust |
| macOS SecureCRT | `<app-home>/securecrt_bridge.py` | SecureCRT 能加载的 Python 引擎；仅使用标准库 |
| 可选 OpenSSH | 无桌面脚本；显式选择 `openssh` 后端 | 系统 OpenSSH + 另行授权的连接 |

使用初始化或 `paths` 打印的路径。Windows 当前包还可能带有自包含 `.js` 入口，可释放其配套 Rust 二进制；这与 `install` 写入 Codex 配置是不同步骤。

目标终端空闲且已获准加载桥接时，选择 **Script → Run**，加载打印出的入口。SecureCRT 每个进程只需一个脚本，覆盖其中已连接的 Tab。重复启动会保留原实例；取消时回到最初启动脚本的 Tab，选择 **Script → Cancel**。取消会保留 SSH 登录，但不能证明远端工作已结束。Xshell 以实际原生发现/实例范围为准，不要假设覆盖所有窗口。

macOS SecureCRT 没有 Windows JScript/ActiveX 脚本接口。优先复用已有可加载的 Python 引擎。加载失败时，遵循已安装 SecureCRT 版本支持的 Python 版本/架构要求，安装官方运行时后重启 SecureCRT。无需 `pip`、pywin32 或全局 PATH 修改。能否加载仍由终端加载器决定；桥接在加载与 API/来源检查后不会额外施加任意 Python 版本上限。[厂商脚本平台](https://www.vandyke.com/products/securecrt/scripts.html) · [macOS 引擎加载](https://www.vandyke.com/support/tips/how-to-use-python-scripting-securecrt-on-macos.html)

已测试版本与架构见[支持矩阵](support-matrix.md)。当前矩阵尚未验证 Linux 桌面 SecureCRT。源码构建需要 Rust 1.88+ 和链接器；Node 22 用于开发、测试与打包，Mac 适配器契约测试还使用 Python。这些要求与安装后的最终用户运行依赖不同。

<a id="4-check-each-layer-separately"></a>

## 4. 分层验证

使用所选二进制的绝对路径，下面列出要追加的子命令：

```text
doctor --offline
doctor --backend xshell --offline
doctor --backend securecrt
doctor --backend xshell
doctor --backend openssh
```

离线 doctor 检查本地文件与配置，**不会**连接桌面桥接、证明监听器已停止或测试客户端审批。在线桌面 doctor 检查已加载的终端引擎、原生能力和正在运行的源码身份。OpenSSH doctor 探测本地系统客户端；真实认证、exec 和 PTY 需要另行授权测试。

重新加载 AI 客户端。通过 `connector_list` 发现会话，核对后端/标题，仅用 `connector_open` 绑定获准目标，再用 `connector_read_screen` 检查屏幕。明确授权且核实专用 POSIX 测试 Tab 空闲后，执行一条无害 `printf`，检查状态、发送证据、真实退出码与输出。遵循 [Agent 工作流](agent-usage.md)与对应客户端的审批拒绝检查。编译成功、配置写入或 doctor 通过都不能证明会话执行成功。

<a id="upgrade"></a>

## 升级

核验新二进制后，Codex 用户重新运行 `install`；仅用 Claude 的用户保留稳定二进制路径并运行 `upgrade`。`upgrade` 更新内嵌桥接入口，不写 Codex，也不替换单独安装的二进制。替换正在使用的二进制前先停止客户端。常规更新保留令牌和策略，不要使用 `init --force`。

替换磁盘文件不会重新加载运行中的脚本。在已授权的空闲边界取消旧脚本，加载固定入口，重启 MCP，运行 doctor 并重新发现/绑定目标。旧句柄失效。未决工作应先检查原 Tab，再考虑取消或恢复。见[排障](troubleshooting.md)和[桌面验收](desktop-acceptance.md)。
