# Dev Flow 5.0 插件包

本目录是 Claude Code / Codex marketplace 分发的自包含插件，包含 Skills、policy、MCP、Hooks 和三个受版本控制的预构建 bundle：

- `dist/mcp-server.mjs`
- `dist/claude-hook.mjs`
- `dist/codex-hook.mjs`

消费方不要在插件目录运行 `npm install`。业务仓必须是具有有效 HEAD 的 Git 仓库，并用 `dev_flow_init_project` 创建 project schema v2 配置。

5.0 使用 FeatureState v4、project/review/checkpoint v2，基础级别只有 XS/S/M/L。Core 从变更表面、行为复杂度、拓扑和风险事实派生动态控制与完整路线；不再有 light/standard、公开 feature-check、resolve-decision、approvalId 输入或 implementation files 输入。

用户要求更严格治理时可用 `controlEnhancements` 单调追加控制；它不能关闭 Core 下限，executable rollback 仍要求真实可逆的仓库事实。

`governedRoots` 是写门禁、ownership、fingerprint、checkpoint、verification 和 delivery 的单一范围。可信 Hook 写入自动归属；人工/IDE 变化必须确认。验证命令通过 `provides` 声明 guarantee，preflight 不计 evidence。安全 tracked 仓内 symlink 保存并恢复链接本身。

工作区归属问题先绑定呈现时的未知路径集合；多路径支持“全部纳入当前任务”“全部排除并先处理”“逐个确认”，观察过但没有明确归属的路径仍会阻塞。普通决策在表单与文本入口共享同一语义匹配器，接受唯一可判定的简称和登记同义表达；批准继续使用严格整句规则。`.git`、`.dev-flow`、`node_modules` 永久排除在业务指纹之外。项目配置变化必须使用 `dev_flow_update_project` 的 sha256 CAS 入口；被 RU 引用的验证命令按引用切片失效，无关命令不会推倒全部 review。验证命令变更使活动单元的 Trace 切片 stale 时，用 `dev_flow_abandon_implementation_unit` 取消该单元、重登记计划刷新基线后重新开始；工作区改动保留。

受支持宿主分别记录 session、prompt 与 tool hook 能力。开始任务、实现推进、checkpoint 和 finalize 需要最近 15 分钟内的相应同宿主健康信号；缺失、局部断线或过期时 Core 返回可恢复阻塞。hook 在失联后重新出现时，Core 自动对账活动工作区；未知路径进入正式 ownership interaction，不要求用户先手工调用 reconcile。不要手工注入 host event 或编辑 `.dev-flow`。

5.0 不迁移 4.x 数据。升级前用 4.x finalize/abandon，备份 `.dev-flow`，升级后重新初始化并运行 doctor。详见仓库根目录 [README.md](../../README.md) 和 [5.0 发布说明](../../docs/release-notes-5.0.0.md)。
