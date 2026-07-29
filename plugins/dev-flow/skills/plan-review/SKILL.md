---
name: plan-review
description: 审查实现计划。触发：计划审查、plan review、plan-review、df-plan-review、dev-flow-plan-review。当 dev_flow_next 指向 plan_review 时使用。
---

仅使用 Dev Flow MCP。调用 `dev_flow_next`，只执行它返回的唯一动作。

对于 `review: 1` 的 standard M/L，`plan_review` 是 Core 审查状态机：

1. `create-review-batch`：调用 `dev_flow_create_review_batch`，再调用 next；同一 current basis 的重复 create 是幂等的。
2. `review-jobs-pending`：按返回的 job 逐个调用 `dev_flow_claim_review_job`、`dev_flow_get_review_job`、`dev_flow_submit_review_job`。提交结构化 `coverageSummary`、`findings` 和必要时的 `resolutions`；不得传入 `basisHash`、`assuranceLevel`、role 或 depth。
3. 只有 next 返回 `run-step(plan_review)` 时，调用 `dev_flow_record_step(plan_review, {})`。Core 从 current complete batch 自动派生 evidence；不得手写 batch/basis/assurance，也不得把 findings 当作 plan-review artifact 写入。

`plan-review` 是只读生成投影，不可编辑或 `record_artifact`。旧的 `review: 0` active feature 才继续 `dev_flow_scaffold_artifact` → Read 已登记路径 → 编辑 → `dev_flow_record_artifact` → `dev_flow_record_step(plan_review)`，其 evidence 使用 `reviewType: "plan"`。

完成 `plan_review` 记步后再次 `dev_flow_next`：若返回 `present-human-gate`，调用 `dev_flow_present_gate` 并按其统一 `interactionOutcome` 处理：confirm 继续、request-changes 按 `response.comment` 修订并重新展示、pending 才输出返回值 `interaction.fallback` 的停步话术。先说明“已打开选择卡片；如未看到，请直接说明‘没有看到选择卡片’，我会展示文字回复。”；用户提出后只读取 status 中同一 interaction 并展示既有 token。若返回 `wait-human-gate`，由本技能或随后的 status 输出当前 interaction 的控件/一次性回复——gate 归属是当前 next action，不是固定 skill 名。

```text
当前：<featureId> · <route>
阶段：HUMAN GATE: implementation_approval
为何等待：需要明确批准后才能改 protected 业务代码
继续：选择“确认执行”或“提出修改意见”；无控件时使用 status.progress.wait.replyHint 的一次性回复
后续：implementation → …
```

附计划/风险/回撤摘要。合法等待不是失败。禁止手改 state。
