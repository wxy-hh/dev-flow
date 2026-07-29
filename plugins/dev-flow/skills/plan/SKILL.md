---
name: plan
description: 按路线产出实现计划。触发：写计划、实现计划、plan、df-plan、dev-flow-plan。当 dev_flow_next 要求 plan 相关步骤时使用。
---

仅使用 Dev Flow MCP 与其资产。调用 `dev_flow_status`、`dev_flow_next`，只执行唯一动作。

先以 `dev_flow_next` 决定步骤。Trace source artifact 的合法写盘是 `dev_flow_scaffold_artifact` → Read 已登记 artifact → 编辑 → `dev_flow_record_artifact_with_trace` → `dev_flow_record_step`；禁止抢先 Write、直接编辑 snapshot/state pointer 或复制路线映射。生成的 `status` 只允许 scaffold，禁止编辑或 `record_artifact`，随后继续 MCP 返回的唯一动作。

- `implementation-plan`：standard M 提交 `TASK-...` 与其 `RU-...`；standard L 只提交 `TASK-...`，其 `rollbackUnit` 指向稍后由 rollback-safety 登记的 RU。
- `coverage-matrix`：交给 coverage-review，以 `TEST-...` → `AC-...` 的 Trace delta 登记。
- `plan_review` 保持既有 `dev_flow_record_step` 与 `{ reviewType: "plan" }`，本阶段不调用 review batch。

完成当前 plan/coverage/rollback/plan_review 步骤后立即再次调用 next。若返回 `present-human-gate: implementation_approval`：

1. 立即调用 `dev_flow_present_gate`；
2. 若返回 `interactionOutcome: confirm`，这是有溯源的真实用户选择：继续 next，不再要求文本批准；禁止同回合伪造 confirm 或在没有真实控件响应时实现；
3. 若返回 `interactionOutcome: request-changes`，依据返回值 `response.comment` 的结构化修改意见更新并登记计划资料，再重新展示新门禁；
4. 仅 `interactionOutcome: pending` 才输出返回值 `interaction.fallback` 并停止。先说明“已打开选择卡片；如未看到，请直接说明‘没有看到选择卡片’，我会展示文字回复。”；用户提出后读取 status 中的同一 interaction，展示既有 token，不创建新 interaction。

后续用户提交一次性回复时调用 `dev_flow_respond_interaction`；仅没有 interaction 的旧 feature 才使用 `dev_flow_confirm_gate`。present 前不得邀请批准。
