---
name: requirements
description: 采集、压测并确认需求。触发：写需求、需求不清楚、requirements、df-requirements、dev-flow-requirements。当 dev_flow_next 指向 requirements 或 requirement_confirmation 时使用。
---

以 Dev Flow MCP 为唯一工作流权威。先读 `dev_flow_status`，再调用 `dev_flow_next`，只执行它返回的唯一动作。禁止手改 state/控制文件。

## 合法写盘顺序

**`dev_flow_scaffold_artifact` → 编辑已登记 artifact → `dev_flow_record_artifact`**。禁止抢先 Write 未登记路径。

标准 M/L 的 `requirements` 步骤：

1. 仅在 MCP 请求时脚手架 `requirements.md`。
2. 若 `classification.requirements` 为 `missing-or-unclear` 或 `documented-unconfirmed`，委托给 `grillme`（兼容 `df-grillme` / `dev-flow-grillme`）。后续回合续写已有 Decision Log 与首个未决 `Q-...`，不要重开访谈。
3. **每一轮 grill 文件更新后，立即**对 `requirements` 调用 `dev_flow_record_artifact`，再输出停步话术等人。禁止只改文件不登记。本技能是唯一可登记该 artifact、记录 `requirements` 步骤、或 present/confirm `requirement_confirmation` 的技能。
4. 仅当 `dev_flow.grill_status` 为 `complete`（且当前题字段已清除）并已登记后，才可 `dev_flow_record_step(requirements)`。然后 `dev_flow_next`；当它要求 `requirement_confirmation` 时，展示 HUMAN GATE 并停止。

对 `provided-confirmed`：不要自动调用 grillme；脚手架或快照需求后以 `grill_status: not_required` 继续。显式 grillme 交接可将其改为 `complete`，之后本技能必须登记已编辑 artifact，并重新展示因此失效的需求门禁。

## 停步话术（HUMAN GATE）

当 `next` 为 `present-human-gate` / `wait-human-gate` 且 gate 为 `requirement_confirmation` 时输出：

```text
当前：<featureId> · <route>
阶段：HUMAN GATE: requirement_confirmation
为何等待：需要明确批准需求基线
继续：确认需求 / approved / LGTM
后续：<压缩剩余 steps>
```

附简短需求业务摘要（目标、范围、关键决策）。这是合法等待，不是失败。

禁止绕过 MCP 的 grill-status 校验，也禁止创建第二份 requirements artifact、需求门禁或工作流状态文件。
