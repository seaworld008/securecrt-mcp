# 故障排查

安装和更新见[一键安装](installation.md)。Windows只有`.js`入口；Mac只有单个`securecrt_bridge.py`原生层。不要向Windows安装Python/pywin32来修复当前桥接。

**版本或摘要不匹配**：新包执行`install`或当前二进制执行`upgrade`，空闲时取消原脚本并选择固定入口，重启MCP并重新发现目标。文件更新不替换内存实例；普通升级不使用`init --force`。

**Mac无法加载引擎**：先按当前SecureCRT自己的错误提示和系统要求确认支持版本/架构，再安装官方运行时并完全重启SecureCRT。已有能加载的引擎直接复用，不安装pip包、不改全局PATH、不叠加多套Python。在线doctor中的实际Python才是证据，项目不设置额外版本上限。[厂商加载说明](https://www.vandyke.com/support/tips/how-to-use-python-scripting-securecrt-on-macos.html)

**安装器报Codex配置错误**：现有TOML必须有效，`mcp_servers`和`securecrt`必须为表。修复该文件语法后重新执行安装，安装器不会绕过格式错误覆盖用户设置。用户私有目录内的符号链接文件被拒绝，使用明确实际目录。

**重复脚本**：SecureCRT同进程一次启动即可。其他Tab重复启动应提示已运行，原实例继续响应；原脚本没有响应时回到启动Tab空闲取消，再重载，不仅根据心跳抢占锁。Mac的不同应用进程若使用相同TCP端口会冲突，需要分别明确目录/端口；Windows原生实例登记按进程区分。

**stale_session / stale_attachment**：断开、重连、配置变化、原对象关闭或租约过期使句柄失效。重新枚举并检查目标，不能用旧索引、同名会话或其他进程替代。

**stale_screen / unstable_screen / prompt_mismatch / context_changed**：文本、行列位置、尺寸或输入边界变化。先检查原Tab，只读获取新屏幕；不能自动重发原命令或把半条输入/密码框当成空闲。Mac稳定快照与提示符排空修复不取消这些拒绝边界。

**busy / unresolved / capture_timeout**：原任务仍活跃或结果不确定。停止新输入，检查command_id和原终端；只对本次明确跟踪的命令显式中断。原命令结束、空闲确认后以新鲜令牌显式ack，保留历史超时/取消结果。没有自动重放或自动Ctrl+C。

**输出不完整**：分页只读取保留的捕获数据，不能恢复已丢历史。truncated/gap必须报告；TUI、二进制、无限follow输出用明确授权的专用PTY流程。2,500行中文验收必须在原定10秒预算逐行一致，超时后增加预算不是通过。

**审计不可用**：检查路径、权限和空间。启用审计时，发送前记录失败会拒绝；发送后的警告不能当作远端未执行。

**Windows二进制被占用**：停止持有旧二进制的MCP客户端后从新包运行安装，不断开SSH登录。解压包不可误用Mac入口。

问题报告只提供版本、脱敏状态、摘要和用例阶段，不上传Token、私钥、地址、会话ID或已有终端历史。
