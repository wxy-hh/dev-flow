---
name: risk-review
description: 登记路线相关风险证据。触发：风险卡、risk、risk-review、df-risk-review、dev-flow-risk-review。当 dev_flow_next 要求 risk 相关步骤时使用。
---

仅使用 Dev Flow MCP。调用 `dev_flow_next`；仅针对返回的路线步骤使用 risk-card artifact 与 `dev_flow_record_step`。不得绕过路线义务。
