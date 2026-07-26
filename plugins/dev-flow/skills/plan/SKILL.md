---
name: plan
description: 按路线产出实现计划。触发：写计划、实现计划、plan、df-plan、dev-flow-plan。当 dev_flow_next 要求 plan 相关步骤时使用。
---

仅使用 Dev Flow MCP 与其资产。调用 `dev_flow_status`、`dev_flow_next`，只执行唯一动作。

合法写盘：可编辑 artifact 使用 `dev_flow_scaffold_artifact` → Read 已登记 artifact → 编辑 → `dev_flow_record_artifact` → `dev_flow_record_step`。禁止抢先 Write 未登记路径。生成的 `status` 只允许 scaffold，禁止编辑或 `record_artifact`，随后继续 MCP 返回的唯一动作。

完成当前 plan/coverage/rollback/plan_review 步骤后立即再次调用 next。若返回 `present-human-gate: implementation_approval`：

1. 立即调用 `dev_flow_present_gate`；
2. present 成功后才输出 `HUMAN GATE: implementation_approval（实现批准）`；
3. 使用 `progress.wait.replyHint`，不复制批准词表；
4. 停止并等待用户下一条消息，禁止同回合 confirm 或实现。

只有后续用户消息与 MCP 明确批准语义匹配时才调用 `dev_flow_confirm_gate`。present 前不得邀请批准。
