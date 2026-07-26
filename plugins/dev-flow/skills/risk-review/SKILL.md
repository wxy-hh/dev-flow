---
name: risk-review
description: 登记路线相关风险证据。触发：风险卡、risk、risk-review、df-risk-review、dev-flow-risk-review。当 dev_flow_next 要求 risk 相关步骤时使用。
---

仅使用 Dev Flow MCP。调用 `dev_flow_status` / `dev_flow_next`；仅针对返回的 risk_review / risk_controls 动作使用 risk-card artifact 与 `dev_flow_record_step`。人工维护 risk-card 时严格执行 `dev_flow_scaffold_artifact` → Read 已登记路径 → 编辑 → `dev_flow_record_artifact` → `dev_flow_record_step`；生成的 `status` 只允许 scaffold，禁止手工编辑或 record。

从 `requiredEvidence` 读取当前步骤的非空 fields/checks；禁止在 Skill 内复制 risk → evidence 映射、补写其他步骤证据或绕过路线义务。
