---
name: code-review
description: 实现后的 diff 审查。触发：代码审查、code-review、df-code-review、dev-flow-code-review。当 dev_flow_status 显示代码审查时使用。
---

仅使用 Dev Flow MCP。先调用 `dev_flow_status`，仅当中文阶段为代码审查且能力合同允许时行动。

从 action/progress 的 `requiredEvidence` 读取本步义务，只提交其中要求的非空字段：基础为 `reviewType: "code"`，可能另含 `reviewDepth: "full"` 或 `checks`。路线要求 code-review artifact 时，严格执行 `dev_flow_scaffold_artifact` → Read 已登记路径 → 编辑 → `dev_flow_record_artifact` → `dev_flow_record_step(code_review)`。不得在 Skill 内复制 risk → evidence 映射，也不得把 `full-code-review` 写入 checks。code-review 与 plan-review 相互独立，不能互相顶替。
