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

## 真机矩阵

[桌面规范](desktop-acceptance.md)和[用例](desktop-test-cases.md)是验收标准。明确授权至少两个空闲POSIX Tab，核对实际桥接和配套二进制摘要后执行：

```sh
node tests/desktop_matrix.js target/release/securecrt-mcp --backend securecrt --all-idle --expect-securecrt 2 --exercise-recovery --output-dir .local-evidence/mac-UNIQUE
```

只在全部已连接会话都属于测试时使用 `--all-idle`，否则用显式目标。legacy、modern、连续20条、中文无换行、非零退出、batch、原定10秒2,500行完整分页、上下文拒绝、有限超时和显式恢复、并发隔离均逐Tab检查。

U01–U04另用实际终端UI：启动、其他Tab重复启动、空闲取消且登录保留、重新加载获得新句柄、专用Tab断开/重连拒绝旧附件。`desktop_lifecycle_probe.js`通过新控制目录的实际阶段与flag协调原生UI；没有真实确认不能写flag。关闭重建Tab不等同断开重连，未做项目明确写未测。

失败保留FAIL阶段和审计；不自动重发未知命令、不扩大长输出预算、不自动中断业务命令。恢复必须检查原会话结束和新鲜空闲屏幕。公开回执脱敏，不含Token、地址、用户名、会话ID和已有终端历史。代码/CI通过、原生GUI通过、远端业务通过分别报告。
