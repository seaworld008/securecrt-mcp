# 开发回归与真机验收

运行安装见[一键安装](installation.md)。开发控制器、打包、客户端和故障测试均为Node JS/Rust。仅Mac原生适配契约由 `mac_adapter_contract.js` 在开发测试中调用Python运行内联原生对象断言；用户Windows入口不安装Python、Node或Rust。

## 编译与自动回归

```sh
cargo fmt --all -- --check
cargo check --locked --all-targets --all-features
cargo clippy --locked --all-targets --all-features -- -D warnings
cargo test --locked --all-targets --all-features
cargo build --locked
node tests/windows_bridge_test.js
node tests/mcp_smoke.js target/debug/securecrt-mcp
node tests/ux_smoke.js target/debug/securecrt-mcp
node tests/review_smoke.js target/debug/securecrt-mcp
node tests/performance_smoke.js target/debug/securecrt-mcp
node tests/persistent_fault_smoke.js target/debug/securecrt-mcp
node tests/file_transport_fault_smoke.js target/debug/securecrt-mcp
node tests/daemon_smoke.js target/debug/securecrt-mcp
node tests/package_smoke.js target/debug/securecrt-mcp ci-local
node tests/mac_adapter_contract.js
node scripts/validate_repository.js
```

Windows使用 `.exe` 路径；Windows自包含入口隔离测试额外执行 `node tests/portable_windows_smoke.js target/debug/securecrt-mcp.exe`。CI在三平台运行编译后MCP和Node套件，Mac原生层契约有单独引擎开发测试。开发模拟对象不得冒称真实客户端结果。

覆盖认证、deadline、拒绝且零发送、部分/丢失响应不重放、持久连接、operation去重、batch、UTF-8分页、长输出、daemon、文件IPC实例隔离和打包摘要。原生Mac契约另外覆盖显示前提示符缓冲、Get2推进渲染产生的文本/光标混合帧、首次提示符尾空格延迟与恢复令牌。

脚本分块辅助模块以本地 POSIX shell 验证（Windows 使用现有 WSL，不安装额外软件）：

```sh
node tests/script_transport_contract.js
```

Mac 适配器开发契约把大型原生 fixture 通过 stdin 传给 Python，避免 Windows 命令行长度上限。在 Windows 可将 `SECURECRT_TEST_PYTHON` 指向已有 Python 的绝对路径；这不代表 Mac 真机 UI 已验证，也不增加 Windows 用户的运行依赖。

## 真机矩阵

输出捕获与提示符恢复专项控制器必须传入新枚举的精确目标、空闲测试授权和私有报告路径：

```sh
node tests/capture_reliability_live.js target/release/securecrt-mcp --backend securecrt --target fresh-opaque-test-target --confirmed-idle true --quick-count 100 --mixed-count 20 --output .local-evidence/native-capture.json
```

Windows 使用 `.exe`。它记录实际短命令 p50/p95、首输出、poll 次数、延迟/ANSI 后台输出恢复、2500 行分页和计数文件去重；遇到不确定结果停止，不自动发送 Ctrl+C 或重放。重载后须重新枚举，至少跨两次独立加载运行。报告不包含已有屏幕或端点。并未包含同网络原生 SSH 对照、所有交互程序或真实重连验收；不得据此宣称完整平台矩阵通过。

另加 `--prefer-native-log true` 明确允许该轮非秘密测试命令的私有临时原始日志。分别验证默认 ReadString 与原生日志路径、分片 UTF-8、延迟无换行、结束刷新、超时、已有用户日志回退和正常清理。用户策略拒绝测试临时目录的清理时，记录拒绝及遗留目录，不改策略或换命令绕过。临时目录仅含测试计数，公开报告不包含真实端点。Rust 的原始日志读取测试另外验证追加、保持句柄、非法 UTF-8、文件路径与链接边界；原始日志文件在宿主强制退出时的残留边界必须保留。

[桌面规范](desktop-acceptance.md)和[用例](desktop-test-cases.md)是验收标准。明确授权至少两个空闲POSIX Tab，核对实际桥接和配套二进制摘要后执行：

```sh
node tests/desktop_matrix.js target/release/securecrt-mcp --backend securecrt --all-idle --expect-securecrt 2 --exercise-recovery --output-dir .local-evidence/mac-UNIQUE
```

只在全部已连接会话都属于测试时使用 `--all-idle`，否则用显式目标。legacy、modern、连续20条、中文无换行、非零退出、batch、原定10秒2,500行完整分页、上下文拒绝、有限超时和显式恢复、并发隔离均逐Tab检查。

U01–U04另用实际终端UI：启动、其他Tab重复启动、空闲取消且登录保留、重新加载获得新句柄、专用Tab断开/重连拒绝旧附件。`desktop_lifecycle_probe.js`通过新控制目录的实际阶段与flag协调原生UI；没有真实确认不能写flag。关闭重建Tab不等同断开重连，未做项目明确写未测。

断开 flag 必须在终端确认框完成后，以原生 Tab 已断开和其他测试页仍连接为证据；
确认框阻塞脚本造成的 IPC 暂时离线不证明 SSH 已断开。重连 flag 还须核对同一 Tab
身份和认证后的新鲜空闲画面。UI 等待期限与原定命令预算分开，失败保留且不重放。

同一 SecureCRT 脚本线程的默认 `ReadString` 会进行秒级等待。完整 legacy 套件混合
长输出与其他 Tab 的刻意超时/恢复时，使用 `--jobs 1` 分项运行，再单独验收同时执行
隔离；原生日志用并行完整套件验收。不得增加长输出预算或隐藏混合并行的 FAIL。
0.5.7 的确切范围和同机 OpenSSH 对照见[Windows 回执](acceptance/windows-mac-regression-2026-10-14.md)。

失败保留FAIL阶段和审计；不自动重发未知命令、不扩大长输出预算、不自动中断业务命令。恢复必须检查原会话结束和新鲜空闲屏幕。公开回执脱敏，不含Token、地址、用户名、会话ID和已有终端历史。代码/CI通过、原生GUI通过、远端业务通过分别报告。
