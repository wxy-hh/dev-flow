---
name: grillme
description: 一问一答压测需求/方案/计划。触发：grillme、grill me、拷问、压测方案、df-grillme、dev-flow-grillme。标准 M/L 的 requirements 步骤内使用。
---

# 方案拷问

存在活跃 feature 时，Dev Flow MCP 仅可用于只读的 `dev_flow_status` 与 `dev_flow_next`。本技能禁止调用任何 MCP mutation、登记 artifact、记录步骤，或 present/confirm HUMAN GATE。

## 集成需求模式

仅当活跃 feature 为标准 M/L，且当前路线步骤为 `requirements` 时使用本模式。

1. 提问前先阅读相关代码、配置与 `requirements.md`。仓库可验证的事实自行查清，不要甩给用户。
2. 在第一个未决问题前，将 `dev_flow.grill_status` 从 `pending` 改为 `in_progress`。每轮只问一个阻塞问题；须给出推荐答案、选项与影响。
3. 只维护 `requirements.md` 的 `## Decision Log` 与 `## Open Questions` 两节。使用稳定的 `Q-001...` 与 `D-001...` ID。保留既有决策；状态为 `in_progress` 或仍有未决问题时，从第一个未决问题续问。
4. 阻塞问题默认最多五个；仅在出现架构新分支、不可逆风险或配额/成本决策时可扩至八个。
5. 无阻塞问题后，将 `dev_flow.grill_status` 设为 `complete`，将 `## Open Questions` 设为 `- None`，并交接给 `requirements`（兼容旧名 `df-requirements` / `dev-flow-requirements`）。不要写范围、验收标准，也不做任何 MCP 状态迁移。

## 显式咨询模式

若没有兼容的活跃 requirements 步骤，仅在对话中压测用户给出的需求或计划。不编辑文件、不变更 Dev Flow 状态，也不替代 `plan-review`。

在 `provided-confirmed` 的 requirements 步骤上显式调用时，使用集成模式。`requirements` 技能必须登记每一次编辑，以便在需要时使既有需求确认哈希失效。
