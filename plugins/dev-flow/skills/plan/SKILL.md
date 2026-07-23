---
name: plan
description: 按路线产出实现计划。触发：写计划、实现计划、plan、df-plan、dev-flow-plan。当 dev_flow_next 要求 plan 相关步骤时使用。
---

仅使用 Dev Flow MCP 与其资产。调用 `dev_flow_next`，只执行它返回的唯一动作；在记录对应步骤前先登记已更新的 artifact。
