---
name: plan-review
description: 审查实现计划。触发：计划审查、plan review、plan-review、df-plan-review、dev-flow-plan-review。当 dev_flow_next 指向 plan_review 时使用。
---

仅使用 Dev Flow MCP。调用 `dev_flow_next`，只执行它返回的唯一动作。记录 `plan_review` 时 evidence 使用 `reviewType: "plan"`。

完成 `plan_review` 记步后再次 `dev_flow_next`：若返回 `present-human-gate` / `wait-human-gate`（常见为 `implementation_approval`），**由本技能或随后的 status 输出统一停步话术并停止**——gate 归属是当前 next action，不是固定 skill 名。

```text
当前：<featureId> · <route>
阶段：HUMAN GATE: implementation_approval
为何等待：需要明确批准后才能改 protected 业务代码
继续：批准实现 / approved / LGTM
后续：implementation → …
```

附计划/风险/回撤摘要。合法等待不是失败。禁止手改 state。
