# Dev Flow Windows 本地通知设计

## 目标

让 Windows 用户可以主动启用一次 Dev Flow 原生 Toast 通知与系统提示音，同时不改变工作流、门禁或 MCP 通知的非阻塞语义。

## 决策

采用“显式启用、当前用户范围、尽力而为”的实现：新增不依赖 feature state 的 MCP 工具 `dev_flow_enable_windows_notifications`。只有用户明确调用该工具时，插件才创建或刷新当前用户开始菜单中的 `Dev Flow 通知.lnk`，并把固定 AUMID `io.github.wxy_hh.dev_flow` 写入快捷方式属性。

开始菜单快捷方式是未打包桌面程序发出 Windows Toast 所需的通知身份。插件不在 marketplace 安装时自动改写用户系统目录，也不需要管理员权限。快捷方式设置为不可固定；其目标是当前 Node 运行时的无窗口立即退出命令，目的仅是提供稳定的通知身份，不能作为 Dev Flow 的启动入口。

## 运行时行为

`emitAttention` 始终先尝试发送 MCP `notifications/message`。本地提醒随后按平台分支：

- macOS：维持现有 `osascript` 横幅与 Glass 提示音；
- Windows：仅在 `Dev Flow 通知.lnk` 存在时，使用 `powershell.exe` 和 Windows Runtime Toast API 发出横幅与系统默认通知音；
- 其他平台、未启用 Windows、通知权限/专注模式关闭、命令失败：不报错，不阻塞流程。

CI、`NODE_ENV=test`、以及 `DEV_FLOW_DISABLE_ATTENTION=1` 继续禁止所有本地 OS 提醒；MCP 通知不受影响。

## 安全与可维护性

PowerShell 通过 UTF-16LE Base64 编码传参，标题与正文先做 XML 转义，避免用户控制的 feature ID 进入命令解释层。注册脚本使用内嵌 C# COM interop 设置 `.lnk` 的 `System.AppUserModel.ID` 与不可固定属性；不写注册表、不安装依赖、不请求提权。显式启用失败时，MCP 工具返回结构化失败结果和恢复建议，而不是影响任何 feature。

## 验收标准

- 在 Windows，显式启用工具创建/刷新当前用户范围的 AUMID 快捷方式并返回路径；再次调用安全幂等。
- 启用后，决策等待和 finalize 仅各尝试一次 Toast，含标题、正文和系统默认音。
- 未启用时，Windows 不启动 PowerShell Toast；仍发送 MCP 通知。
- macOS 行为不变；Linux/其他平台无本地提醒。
- CI、测试环境及 `DEV_FLOW_DISABLE_ATTENTION=1` 永远不启动 `osascript` 或 PowerShell。
- 单元测试通过注入平台、文件存在性与进程执行器覆盖成功、未启用、失败、静默和转义路径；完整 npm 与 host E2E 套件通过。
