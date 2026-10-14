# Mac SecureCRT 0.5.6 真机验收（2026-10-14）

本次在 macOS 27.0.1 / ARM64、SecureCRT 9.5.2 (ARM64 build 3325)、实际加载的 Python 3.11.17 上，通过两个明确获准的空闲 POSIX 测试 Tab 验收。

最终测试源码为 `036a5e52e9259620fe6ba804290a574f2398cd99`，工作区干净。后续发布准备只增加本回执、文档和发布请求；运行源码、依赖、桥接与调用器保持该提交的内容。

- 本机二进制 SHA-256：`ebe4ef63c0d288ede5fef80b6c047494bd4315ae18faa77a6188d9829b03c2c4`。
- 实际加载桥接 SHA-256：`ba0b6159d328b6fd8ddd0063fd2abcdd12fbc59b2ebaae2929a75c681529d54e`。
- 本地构建摘要与 CI/Release 二进制摘要分别记录，不要求跨环境构建字节相同。

## 完整矩阵

运行 `node tests/desktop_matrix.js target/release/securecrt-mcp --backend securecrt --all-idle --expect-securecrt 2 --exercise-recovery`，仅用于这两个全部获准的测试 Tab。最终矩阵耗时 24.121 秒，见[脱敏 JSON](mac-native-matrix-2026-10-14.json)。

两页均通过 legacy/modern、同附件连续 20 条、operation 去重、中文无换行、退出码 7、三命令批次、严格 2,500 行中文全文及分页、错误提示符零发送、heartbeat、有限超时保持不确定、显式 Ctrl+C、新鲜上下文恢复及真实并发隔离。

| 样本 | 短命令 p50 / p95 | 2,500 行捕获 |
| --- | --- | --- |
| Tab 1 | 353 / 787 ms | 2,253 ms |
| Tab 2 | 354 / 435 ms | 3,300 ms |

大输出每页均按内容及顺序完整核对，捕获预算保持 10 秒。短命令样本来自两页并行矩阵，不是同网络原生 SSH 对照。

## 原生 UI 与恢复

[UI 回执](mac-native-ui-2026-10-14.json)记录固定入口加载、取消、监听关闭、保留两个 SSH 登录、新代次句柄及真实同 Tab 断开重连。断线和重连后旧附件均 `sent=false`；新附件只执行一次唯一标记。

本机在桥接运行时禁用另一 Tab 的 Script → Run，因此重复启动由原生菜单阻止，原实例继续响应；友好重复提示分支未通过该 UI 路径触发。没有绕过客户端禁用操作。Script Cancelled 是原生取消通知，取消后监听确实退出，SSH 连接仍保留。

重载后另验证两页 `prefer_native_log=true` 回退到 Mac 原捕获。实际有限超时后，附件标识冒充屏幕令牌和错误提示符均拒绝恢复；检查原命令结束并取得新鲜完整屏幕令牌后，正确恢复成功。

## 失败保留与修复

[首轮 FAIL](mac-native-failures-2026-10-14.json)保留原始 0.5.5 Mac 矩阵：Tab 2 首条 `printf` 在原预算内未捕获到完成，实际界面没有命令回显。没有重发原未知命令；检查原测试页空闲后显式恢复。修复在 `Activate` 后让原生事件循环处理输入通道，再重验身份、光标、输入和截止时间，避免未处理的 Tab 切换直接进入 Send。

新增确定性契约模拟延迟生效的原生激活；在临时副本移除该等待，回归明确失败。修复后两次独立加载的完整双页矩阵通过。一次补充控制器遗漏 `mode=posix`，默认 snapshot 如约返回 unknown；该本地 FAIL 保留，控制器修正模式后另行检查通过，没有将 snapshot 冒称命令完成。

## 自动验证与范围

锁定 Rust fmt/check/clippy 和 49 项测试通过；完整编译后 MCP/Node 套件、91 项 Mac 适配器契约及确定性原生输出集成通过。GNU/BSD 脚本传输、`shasum`、权限、摘要、反斜杠文件名与不确定不重传通过。OpenSSH 使用本地 shell fixture 验证策略/审计拒绝零发送、批次提前校验及允许路径审计；这不是新增真实 OpenSSH 主机验收。

Windows 原生验收沿用[0.5.5 回执](windows-capture-2026-10-13.md)，本轮共享逻辑由 Windows CI 验证。真实 AI 客户端审批 UI、Intel Mac 和 Linux 桌面未在本轮验收。没有读取密码、修改用户策略或审批，也没有发布真实地址、用户名、句柄、令牌和已有终端历史。
