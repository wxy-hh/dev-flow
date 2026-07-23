---
name: df-plan-review
description: 做实现前的独立计划审查。用户说计划审查、plan-review、审查实现计划、df-plan-review、dev-flow-plan-review 时使用。当 dev_flow_next 返回 plan_review 时使用。
---

仅使用 Dev Flow MCP。调用 `dev_flow_next`；仅当它返回 `plan_review` 时，以 `reviewType: "plan"` 登记证据。本技能不能完成 code-review。
