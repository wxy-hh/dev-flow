---
name: plan
description: 按路线产出实现计划。触发：写计划、实现计划、plan、df-plan、dev-flow-plan。当 dev_flow_next 要求 plan 相关步骤时使用。
---

仅使用 Dev Flow MCP 与其资产。调用 `dev_flow_next`，只执行它返回的唯一动作。

合法写盘：`dev_flow_scaffold_artifact` → 编辑已登记 artifact → `dev_flow_record_artifact`，再记录步骤。禁止抢先 Write 未登记路径。若 next 为 human gate，输出统一停步话术并停止。
