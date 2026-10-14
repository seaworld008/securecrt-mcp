# Mac 0.5.6 最终发布源码复验

去重补充修复的干净提交为 `b9b810751580b029c6e79beb7ba78c19b33f14f7`。在原来两个获准空闲 Tab 上，使用新构建再次完成完整 legacy/modern 矩阵，详见[脱敏 JSON](mac-native-final-2026-10-14.json)。后续提交仅增加回执、变更说明和发布文档。

- 二进制 SHA-256：`014e916eceb0554955f3d1c1829e97199790a5217dc375ccc09c67432e8b7c18`。
- 实际加载的 Mac 桥接 SHA-256：`ba0b6159d328b6fd8ddd0063fd2abcdd12fbc59b2ebaae2929a75c681529d54e`，与此前 UI 验收完全相同。
- 环境仍为 macOS 27.0.1 ARM64、SecureCRT 9.5.2 (ARM64 build 3325)、原生 Python 3.11.17。
- 两 Tab 连续 20 条、批次、中文无换行、非零退出、完整分页、上下文拒绝、超时/显式中断与恢复、并发隔离全部通过，总耗时 23.756 秒。
- 2,500 行中文精确有序、无漏行重复：Tab 1 为 2,349 ms，Tab 2 为 2,173 ms，捕获预算仍为 10 秒。
- 短命令 p50/p95：Tab 1 为 316/427 ms，Tab 2 为 329/460 ms。并行矩阵采样不是原生 SSH 对照。

OpenSSH 去重修复使已有 operation 在审计故障或原会话 unresolved 时仍返回原回执；只有新请求才进行策略/审计并发送。新增本地 shell 回归确认重复操作只生成一次审计、计数只增加一次、新 operation 在审计不可用时拒绝，以及超时旧回执查询不清除互锁。51 项 Rust 测试与完整编译后 Node 套件通过，独立复核通过。

旧候选源码的 `main` CI 已取消、Release 工作流已跳过，未从该提交发布 v0.5.6。最终发布只允许来自补充修复合并后、通过完整 CI 的 main 提交。此前[FAIL 与原生 UI 记录](mac-native-matrix-2026-10-14.md)保持。Windows 真机沿用既有 0.5.5 回执；真实客户端审批 UI、Intel Mac、Linux 桌面及新 OpenSSH 真实主机未重测。
