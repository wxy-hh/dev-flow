# Dev Flow 插件包

本目录是随本仓库 Claude Code / Codex marketplace 分发的**自包含** Dev Flow 插件。

- 含预构建入口：`dist/mcp-server.mjs`、`dist/claude-hook.mjs`、`dist/codex-hook.mjs`  
- 消费方**不要**在此目录执行 `npm install`  
- 技能、policy、模板与 MCP 源码均在本包内  
- **1.1.0+** 含 `grillme`（需求/方案逐题拷问）；标准 M/L 两态需求在 `requirements` 步骤内强制 grill 子流程，由 core 校验 `grill_status`  
- 技能 id 为短名（如 `task`、`plan`）；斜杠为 `/dev-flow:task`；description 保留 `df-*` / `dev-flow-*` 作匹配兼容  

安装与使用说明见仓库根目录 [README.md](../../README.md)（技能表含 `grillme`）。  
路线与架构见 [docs/routes.md](../../docs/routes.md)、[docs/architecture.md](../../docs/architecture.md)。  
发布流程见 [docs/publishing.md](../../docs/publishing.md)。
