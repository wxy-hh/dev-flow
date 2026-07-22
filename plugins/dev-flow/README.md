# Dev Flow 插件包

本目录是随本仓库 Claude Code / Codex marketplace 分发的**自包含** Dev Flow 插件。

- 含预构建入口：`dist/mcp-server.mjs`、`dist/claude-hook.mjs`、`dist/codex-hook.mjs`  
- 消费方**不要**在此目录执行 `npm install`  
- 技能、policy、模板与 MCP 源码均在本包内  

安装与使用说明见仓库根目录 [README.md](../../README.md)。  
路线与架构见 [docs/routes.md](../../docs/routes.md)、[docs/architecture.md](../../docs/architecture.md)。  
发布流程见 [docs/publishing.md](../../docs/publishing.md)。
