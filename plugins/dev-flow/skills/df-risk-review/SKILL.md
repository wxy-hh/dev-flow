---
name: df-risk-review
description: 通过 Dev Flow MCP 登记路线相关的风险证据。用户说风险卡、risk、risk review、安全审批、df-risk-review、dev-flow-risk-review 时使用。当 dev_flow_next 要求 risk 相关步骤时使用。
---

仅使用 Dev Flow MCP。调用 `dev_flow_next`；仅针对返回的路线步骤使用 risk-card artifact 与 `dev_flow_record_step`。不得绕过路线义务。
