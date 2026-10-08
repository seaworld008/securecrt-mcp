# Windows 无 Python 试用包

## 用户要求与验收

用户解压后，在 Xshell / SecureCRT 中选择一个固定名称的脚本即可启动；不要求
安装 Python、pywin32、Rust，不修改 PATH、系统 COM 注册或终端的 Python 设置。
保留 Token、策略和登录会话。本阶段仅供用户本人试用，不新增升级备份机制。
启动成功不算完整通过，
必须完成真实会话执行、连续复用、批量、中文分页和长输出检查。

本机的 Python Xshell 绑定组合会被写入保护拦截；SecureCRT 的 2,500 行输出
曾超过 10 秒捕获预算。这两项是交付缺口，不以环境安装教程代替产品修复。

## 决策

Windows 默认便携入口使用终端支持的 JScript。终端原生 API 只在终端脚本线程
访问；编译后的 Rust 仍负责 MCP、策略、审计、命令封装和输出缓存。Python
桥接保持可用，供已有安装和非 Windows 平台使用。

单文件入口包含编译后二进制，首次运行释放到用户私有目录，隐藏启动配套
初始化命令，然后通过认证文件 IPC 通信。释放目录按二进制摘要区分，避免
覆盖正在运行的程序。后续启动复用同一配套程序，无在线下载或管理员要求。
桥接核心与二进制一起打包，运行摘要必须匹配；不信任系统 Python 或 PATH。

选择新入口显式切换该后端的传输；发送后失败不回退另一后端，不重放命令。
会话以不透明句柄绑定，持有者、上下文、未决状态和新鲜屏幕令牌保护保持有效。
每个 Xshell 进程独立注册；同一进程内按原生选项支持的范围选择已登录 Tab。

## 分阶段验证

1. Windows 自带 JScript 32/64 位引擎验证入口和 COM 文件能力。
2. 模拟原生 API 验证认证、去重边界、上下文拒绝、捕获、超时和显式恢复。
3. 在隔离用户目录验证无需 Python 的释放、初始化和再次启动。
4. 真实 Xshell / SecureCRT 中选择新版入口，验证连续命令、批量、UTF-8
   分页与 2,500 行输出，并记录实际终端版本、引擎和脚本摘要。

未完成第 4 步的包标记为待真机验收，不称为正式可用版本。首次 MCP 客户端
添加服务器仍遵守客户端自己的配置流程；不覆盖其他 MCP 配置。

## 厂商接口依据

- [Xshell 脚本语言](https://netsarang.atlassian.net/wiki/spaces/ENSUP/pages/2237305656/Using%2BScripts)
- [Xshell Session 接口](https://netsarang.atlassian.net/wiki/spaces/ENSUP/pages/2237305704/xsh.Session)
- [SecureCRT JScript 与 Windows ActiveX](https://www.vandyke.com/products/securecrt/jscript.html)
- [SecureCRT 脚本头与对象线程](https://www.vandyke.com/support/securecrt/scripting_faq.html)
