# 升级到 0.3.0-preview.1

这是持久终端性能预览版，Bridge 协议仍为2（增加能力协商）。旧接口保留，新 attachment/批量/stream 需要新版适配器。旧脚本没有声明新能力时，兼容 run 路径会保守降级；不能把它当作已经启用性能优化。

## Windows

先核实没有活动或未决操作，停止旧 daemon（若启动过：`daemon --stop`），在 SecureCRT 中 Script → Cancel，退出占用旧二进制的 Codex/Claude。保留 SSH 登录会话。

```powershell
git status --short
git switch main
git pull --ff-only origin main
cargo build --locked --release
.\target\release\securecrt-mcp.exe --version
.\target\release\securecrt-mcp.exe upgrade
.\target\release\securecrt-mcp.exe doctor --offline
.\target\release\securecrt-mcp.exe paths
.\target\release\securecrt-mcp.exe codex-config --toolset terminal --approval-mode auto
```

逐条执行，遇错停止；本地修改先提交或保存，不用强制 reset/clean。`upgrade` 保留配置和 Token，并备份被替换适配器；不使用 `init --force` 进行普通升级。

确认 MCP 自己的 config.toml 中现有 `[policy]` 的 `mode="client"`。旧安装保留旧mode和custom规则；不会悄悄更改已有权限。client 默认仅加入狭窄极高危过滤，普通文件 CRUD/grep/服务操作交给客户端审批。

在 SecureCRT 中运行 paths 返回的新版 `securecrt_bridge.py`；点击启动提示OK。运行 `doctor`，确认版本、协议及 capabilities 含 `persistent_ndjson`、`poll_bulk`、`attachments`、`per_session_capture`。然后用 `doctor --latency` 测本机连接器。

合并生成的 Codex 配置，不能保留旧 enabled_tools 却期待 Agent 自动看到 attach/exec。不要覆盖其他模型、插件和MCP配置，也不要重复添加同名表。确认 command 指向新编译二进制，而不是其他目录的旧副本。重启客户端、重新枚举会话、重新 attach；旧句柄不跨适配器重启复用。

## 第一轮验收

常驻 MCP 路径使用 list → attach → 多次exec/一次batch → detach；不要每条命令运行一次 CLI。Python/PowerShell 频繁独立调用时才显式启动 daemon。审批仍由客户端配置决定，新增工具未伪装成只读，拒绝后应观察零输入。

分别记录：20条短命令用时；三Tab是否互相busy；100KB日志、超长行完整性；stream增量/游标缺口；人工输入造成的上下文变化；断连后旧操作不会重发；明确中断和未决恢复。真实桌面验证完成前不要把模拟基准描述为实际SSH等效性能。

详见 [持久终端指南](persistent-terminal.md)、[性能方法与限制](performance.md)。
