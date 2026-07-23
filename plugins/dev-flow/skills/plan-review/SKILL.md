---
name: plan-review
description: 实现前的独立计划审查。触发：计划审查、plan-review、df-plan-review、dev-flow-plan-review。当 dev_flow_next 返回 plan_review 时使用。
---

仅使用 Dev Flow MCP。调用 `dev_flow_next`；仅当它返回 `plan_review` 时，以 `reviewType: "plan"` 登记证据。本技能不能完成 code-review。
