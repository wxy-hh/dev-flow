# Dev Flow 5.0 插件包

本目录是 Claude Code / Codex marketplace 分发的自包含插件，包含 Skills、policy、MCP、Hooks 和三个受版本控制的预构建 bundle：

- `dist/mcp-server.mjs`
- `dist/claude-hook.mjs`
- `dist/codex-hook.mjs`

消费方不要在插件目录运行 `npm install`。业务仓必须是具有有效 HEAD 的 Git 仓库，并用 `dev_flow_init_project` 创建 project schema v2 配置。

5.0 使用 FeatureState v4、project/review/checkpoint v2，基础级别只有 XS/S/M/L。Core 从变更表面、行为复杂度、拓扑和风险事实派生动态控制与完整路线；不再有 light/standard、公开 feature-check、resolve-decision、approvalId 输入或 implementation files 输入。

用户要求更严格治理时可用 `controlEnhancements` 单调追加控制；它不能关闭 Core 下限，executable rollback 仍要求真实可逆的仓库事实。

`governedRoots` 是写门禁、ownership、fingerprint、checkpoint、verification 和 delivery 的单一范围。可信 Hook 写入自动归属；人工/IDE 变化必须确认。验证命令通过 `provides` 声明 guarantee，preflight 不计 evidence。安全 tracked 仓内 symlink 保存并恢复链接本身。

5.0 不迁移 4.x 数据。升级前用 4.x finalize/abandon，备份 `.dev-flow`，升级后重新初始化并运行 doctor。详见仓库根目录 [README.md](../../README.md) 和 [5.0 发布说明](../../docs/release-notes-5.0.0.md)。
