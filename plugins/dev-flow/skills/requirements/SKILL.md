---
name: requirements
description: 采集、压测并确认需求。触发：写需求、需求不清楚、requirements、df-requirements、dev-flow-requirements。当 dev_flow_next 指向 requirements 或 requirement_confirmation 时使用。
---

以 Dev Flow MCP 为唯一工作流权威。先读 `dev_flow_status`，再调用 `dev_flow_next`，只执行它返回的唯一动作。禁止手改 state/控制文件。

## 合法写盘顺序

**`dev_flow_scaffold_artifact` → Read 已登记 artifact → 编辑 → `dev_flow_record_artifact`**。禁止抢先 Write 未登记路径。

标准 M/L 的 `requirements` 步骤：

1. 仅在 MCP 请求时脚手架 `requirements.md`。
2. `missing-or-unclear` 或 `documented-unconfirmed` 委托 `grillme`（兼容 `df-grillme` / `dev-flow-grillme`）；后续回合续写已有 Decision Log 与首个未决 `Q-...`，不要重开访谈。
3. 每轮 grill 文件更新后立即 `dev_flow_record_artifact(requirements)`，再输出停步话术。禁止只改文件不登记。
4. 仅当 `dev_flow.grill_status` 为 `complete`（当前题字段已清除）并已登记，才可 `dev_flow_record_step(requirements)`。
5. record step 后立即调用 `dev_flow_next`。若返回 `present-human-gate: requirement_confirmation`，立即调用 `dev_flow_present_gate`；只有 present 成功后才输出 HUMAN GATE 并停止。
6. present 前禁止邀请用户确认；present 后必须等待用户下一条消息，禁止同回合调用 `dev_flow_confirm_gate`。确认文本和 replyHint 以 MCP status 为准。

对 `provided-confirmed` 不自动调用 grillme；脚手架或快照需求后以 `grill_status: not_required` 继续。显式 grillme 交接可改为 `complete`，之后必须重新登记并重新展示因此失效的需求门禁。

## 停步话术（HUMAN GATE）

```text
当前：<featureId> · <route>
阶段：HUMAN GATE: requirement_confirmation（需求确认）
为何等待：需要明确批准需求基线
继续：<progress.wait.replyHint>
后续：<压缩剩余 steps>
```

附目标、范围和关键决策摘要。合法等待不是失败。禁止创建第二份 requirements artifact、需求门禁或工作流状态文件。
