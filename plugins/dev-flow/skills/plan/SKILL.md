---
name: plan
description: 在 planning 阶段生成实施计划并触发 Core 内嵌审查。
---

仅使用 Dev Flow MCP 和已登记资产；禁止手改状态、Trace、Review snapshot。读取 `dev_flow_status`，需要细节时 inspect `classification`、`artifacts`、`review`，在当前中文阶段合同内推进。

standard M/L 需要 `实施计划.md`，light L 需要该文件，XS/S/light M 不强制生成 Markdown。编辑资产遵循：scaffold → 读取登记路径 → 编辑 → record；Trace delta 与 artifact hash 必须由一个 CAS 提交。

planning 内部自动完成：冻结计划 basis、创建 review batch、按角色审查、修复 blocking findings、生成只读 review 投影。`plan-review` 是 review job/独立技能，不是额外路线步骤；不要求模型手写 `plan-review.md` 或重复确认。

计划中的每个任务必须是可独立验证的行为切片，并说明范围、验收、验证和可恢复策略；测试与使其通过的实现默认属于同一 RU，红测试允许作为 RU 内临时状态，不允许成为 checkpoint 边界；forwardVerification 必须在本 RU 与已 checkpoint 依赖状态下通过。不要机械拆成“先写测试再写实现”导致验证死锁。计划事实发生变化时，Core 只使受影响的 review/approval basis 失效。light L 计划必须为每个任务声明 `rollback_unit`，为每个 RU 声明 `tasks` 与 `depends_on`；依赖须闭合且无环（TASK↔RU 双向一致、depends_on 目标都存在），否则登记会被拒绝（`PLAN_TASK_GRAPH_INVALID`）。
