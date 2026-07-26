---
name: rollback-safety
description: 登记回撤与安全证据。触发：回撤单元、rollback、rollback-safety、df-rollback-safety、dev-flow-rollback-safety。当 dev_flow_next 要求 rollback/safety 时使用。
---

仅使用 Dev Flow MCP 与路线资产。调用 `dev_flow_status` / `dev_flow_next`，只执行它请求的 rollback_safety、rollback_unit 或 risk_controls 动作。路线要求 rollback-safety 或 rollback-units artifact 时，严格执行 `dev_flow_scaffold_artifact` → Read 已登记路径 → 编辑 → `dev_flow_record_artifact` → `dev_flow_record_step`。

从 `requiredEvidence.checks` 提交本步要求的 rollback / full-rollback；二者是不同义务，不得互相替代。禁止在 Skill 内复制风险映射或替其他步骤补 evidence。
