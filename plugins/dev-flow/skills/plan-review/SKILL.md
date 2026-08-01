---
name: plan-review
description: 审查实现计划。触发：计划审查、plan review、plan-review、df-plan-review、dev-flow-plan-review。当 dev_flow_next 指向 plan_review 时使用。
---

仅使用 Dev Flow MCP。调用 `dev_flow_next`，只执行它返回的唯一动作。

对于 `review: 1` 的 standard M/L，`plan_review` 是 Core 审查状态机：

1. `create-review-batch`：调用 `dev_flow_create_review_batch`，再调用 next；同一 current basis 的重复 create 是幂等的。
2. `review-jobs-pending`：按返回的 job 逐个调用 `dev_flow_claim_review_job`、`dev_flow_get_review_job`、`dev_flow_submit_review_job`。提交结构化 `coverageSummary`、`findings` 和必要时的 `resolutions`；不得传入 `basisHash`、`assuranceLevel`、role 或 depth。
   - 若 `dev_flow_next` 要求风险接受（blocking findings 需用户决策）：调用 `dev_flow_present_review_risk_acceptance`，面向用户自然呈现「存在阻断性审查发现，是否接受风险？回复『接受风险：<原因>』或『不接受』」；禁止向用户展示 `interaction.fallback` 的 token 行（仅在用户无法自然回复时作为最后兜底）。
3. 只有 next 返回 `run-step(plan_review)` 时，调用 `dev_flow_record_step(plan_review, {})`。Core 从 current complete batch 自动派生 evidence；不得手写 batch/basis/assurance，也不得把 findings 当作 plan-review artifact 写入。

`plan-review` 是只读、内容寻址的 Core 投影；用 `dev_flow_status.reviewStatus` 查看它。batch 未完成时只显示 job 状态，完成后才显示 findings/dispositions。不可编辑、scaffold 或 `record_artifact`。旧的 `review: 0` active feature 才继续 `dev_flow_scaffold_artifact` → Read 已登记路径 → 编辑 → `dev_flow_record_artifact` → `dev_flow_record_step(plan_review)`，其 evidence 使用 `reviewType: "plan"`。

完成 `plan_review` 记步后再次 `dev_flow_next`：若返回 `present-human-gate: implementation_approval`，调用 `dev_flow_present_gate` 并按其统一 `interactionOutcome` 处理：confirm 继续、request-changes 按 `response.comment` 修订并重新展示、pending 才**直接询问用户**——“需要你批准开始实现，回复「确认」批准；如需修改，回复「修改计划：<内容>」”；仅在用户无法确认时，才以代码块展示 `interaction.fallback` 的一次性回复行兜底。用户提出后只读取 status 中同一 interaction 并展示既有 token。若返回 `wait-human-gate`，由本技能或随后的 status 面向用户复述等待内容——gate 归属是当前 next action，不是固定 skill 名。

```text
需要你批准开始实现：

<计划摘要一句话>

回复「确认」批准；如需修改，回复「修改计划：<内容>」
```

附计划/风险/回撤摘要。合法等待不是失败。禁止手改 state。
