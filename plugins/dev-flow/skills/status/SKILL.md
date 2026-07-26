---
name: status
description: 查看并接力 Dev Flow 状态。触发：查状态、继续任务、当前进度、status、df-status、dev-flow-status。
---

仅使用 Dev Flow MCP：`dev_flow_status` 与 `dev_flow_next`；禁止直接编辑工作流状态文件。

用户说“继续 / 当前进度”时：

1. 先调用 `dev_flow_status`（StatusView = state + `progress`）。
2. `progress` 是展示权威；不要仅凭 raw `steps.*.status === satisfied` 声称证据仍 fresh。
3. 若 `progress.verificationFreshness.status === stale`，明确说明 `VERIFICATION_STALE` 并要求重新 verification。
4. 若 `progress.wait.kind !== "none"`，用中英并列 gate 名、MCP 返回的 `replyHint` 和剩余 steps 复述；不要复制本地批准词、重新 start/classify 或直接推进。
5. wait 为 none 时再调用 `dev_flow_next`，只执行唯一动作。若 action 带 `requiredEvidence`，原样展示 fields/checks/verificationKinds。

```text
当前：<featureId> · <route>
阶段：<grill Q-… | HUMAN GATE: requirement_confirmation（需求确认） | implementation_approval（实现批准）>
为何等待：…
继续：<progress.wait 中的 hint>
后续：<progress.remainingSteps 压缩>
```

合法等待不是失败。corrupt feature 使用 `dev_flow_recover_corrupt_feature`，禁止手改 `state.json`。降为 light 时用 `dev_flow_reclassify` + `userEvidence`；指纹变化后只能走完 standard 或 abandon 重开。
