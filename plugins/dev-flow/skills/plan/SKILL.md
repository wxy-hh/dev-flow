---
name: plan
description: 按路线产出实现计划。触发：写计划、实现计划、plan、df-plan、dev-flow-plan。当 dev_flow_next 要求 plan 相关步骤时使用。
---

仅使用 Dev Flow MCP 与其资产。调用 `dev_flow_status`、`dev_flow_next`，只执行唯一动作。

先以 `dev_flow_next` 决定步骤。Trace source artifact 的合法写盘是 `dev_flow_scaffold_artifact` → Read 已登记 artifact → 编辑 → `dev_flow_record_artifact_with_trace` → `dev_flow_record_step`；禁止抢先 Write、直接编辑 snapshot/state pointer 或复制路线映射。生成的 `status` 只允许 scaffold，禁止编辑或 `record_artifact`，随后继续 MCP 返回的唯一动作。

- `implementation-plan`：standard M 提交 `TASK-...` 与其 `RU-...`；standard L 只提交 `TASK-...`，其 `rollbackUnit` 指向稍后由 rollback-safety 登记的 RU。
  - RU 的 `file_scope` 必须覆盖该单元全部写目标；含移动/重命名（`mv` / `git mv`）时必须**同时包含源路径与目标路径**（门禁按路径校验，源侧遗漏会被 `DEV_FLOW_IMPLEMENTATION_UNIT_OUT_OF_SCOPE` 拦截）。
  - 测试副产物清理路径（如 `__screenshots__`、`.coverage`）不属于实现 scope：需要清理时把该路径明确列入 RU `file_scope` 并重登记，或留待 logic-complete 后以 git 命令清理（此前 git 写会被 `DEV_FLOW_GIT_GUARD` 拦截）。
  - `file_scope` 应在实现批准前一次性定稿：实现阶段修改计划会使实现批准作废并要求重新确认（HUMAN GATE 重审）。
  - 「前向验证独立可过」：若某单元的前向验证在依赖单元尚未落地时必然失败（如测试先行），测试与修复必须合并进同一单元（原子单元）；checkpoint 前清理 scratch/ 中的残留红测试。
- `coverage-matrix`：交给 coverage-review，以 `TEST-...` → `AC-...` 的 Trace delta 登记。
- `plan_review` 必须服从 next：对 `review: 1` 的 standard M/L，依次处理 `create-review-batch`、`review-jobs-pending`，仅当返回 `run-step(plan_review)` 才以空 evidence 调用 `dev_flow_record_step`；Core 自动派生 batch evidence。只有旧 `review: 0` active feature 使用 `{ reviewType: "plan" }`，不得手写或编辑生成的 plan-review 投影。

完成当前 plan/coverage/rollback/plan_review 步骤后立即再次调用 next。若返回 `present-human-gate: implementation_approval`：

1. 立即调用 `dev_flow_present_gate`；
2. 若返回 `interactionOutcome: confirm`，这是有溯源的真实用户选择：继续 next，不再要求文本批准；禁止同回合伪造 confirm 或在没有真实控件响应时实现；
3. 若返回 `interactionOutcome: request-changes`，依据返回值 `response.comment` 的结构化修改意见更新并登记计划资料，再重新展示新门禁；
4. 仅 `interactionOutcome: pending` 才**直接询问用户**——“需要你批准开始实现，回复「确认」批准；如需修改，回复「修改计划：<内容>」”；仅在用户无法确认时，才以代码块展示 `interaction.fallback` 的一次性回复行兜底。用户提交后读取 status 中的同一 interaction，展示既有 token，不创建新 interaction。

后续用户提交一次性回复时调用 `dev_flow_respond_interaction`；仅没有 interaction 的旧 feature 才使用 `dev_flow_confirm_gate`。present 前不得邀请批准。
