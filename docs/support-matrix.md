# 支持矩阵与证据边界

当前安装见[一键安装](installation.md)，验收命令见[桌面测试用例](desktop-test-cases.md)。Windows 仅支持自包含 JScript，Mac只保留单个标准库Python原生层。没有额外Python最高版本限制；以SecureCRT实际加载和API能力为准。

| 平台 / 客户端 | 实际运行层 | 真机证据 |
| --- | --- | --- |
| Windows 11 ARM64 / SecureCRT 9.6.2 x64 | JScript，共用Windows核心 | [2026-10-08 四Tab矩阵](acceptance/windows-native-matrix-2026-10-08.json)，两个SecureCRT Tab；[原生UI](acceptance/windows-native-ui-2026-10-08.json) |
| Windows 11 ARM64 / Xshell 8.0.0.26 x86 | JScript，共用Windows核心 | 同一历史矩阵的两个Xshell Tab；只认证回执中的源码/二进制 |
| macOS 27.0.1 / ARM64 / SecureCRT 9.5.2 build3325 | 实际Python 3.11.17 | 本次独立Mac验收回执；精确源码摘要改变后需重新加载与验证 |
| 其他Windows/Mac版本、架构 | 原生API探测 | 未实测组合不冒称认证 |
| Linux桌面SecureCRT | 未进行本轮真机验收 | 未测；安装工具可用不等于桌面通过 |
| 系统OpenSSH | Rust + OS ssh | 本地探测与真实认证、exec/PTY分开 |

旧Python Windows/Xshell回执保留在`acceptance/`作为历史；其Python版本、pywin32安装方法和原生缺陷不再是当前用户配置流程。历史Windows回执也不能证明新Mac代码或Windows新二进制原生UI已验收。

至少两个明确获准空闲POSIX Tab：

```sh
node tests/desktop_matrix.js PATH_TO_BINARY --backend securecrt --all-idle --expect-securecrt 2 --exercise-recovery --output-dir .local-evidence/UNIQUE
```

存在业务会话时使用多个显式 `--target securecrt=OPAQUE_ID`。回执记录系统、完整终端/实际引擎、源码提交及修改状态、摘要、数量、各项PASS/FAIL/未测、20条短命令中位数/p95、2,500行中文原定10秒预算与完整性。UI重复运行/取消/重载/断开重连另取原生证据，不用模拟替代。
