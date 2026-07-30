---
name: status
description: 查看并接力 Dev Flow 状态。触发：查状态、继续任务、当前进度、status、df-status、dev-flow-status。
---

仅使用 Dev Flow MCP：`dev_flow_status` 与 `dev_flow_next`；需要核对 Trace 时只读调用 `dev_flow_get_traceability`。禁止直接编辑工作流状态文件、snapshot 或 state pointer。

用户说“继续 / 当前进度”时：

1. 先调用 `dev_flow_status`（StatusView = state + `progress`）。`reviewStatus` 存在时，它与只读 `plan-review` Markdown 由同一 Core 投影派生。
2. `progress` 是展示权威；不要仅凭 raw `steps.*.status === satisfied` 声称证据仍 fresh。
3. 若 `progress.verificationFreshness.status === stale`，明确说明 `VERIFICATION_STALE` 并要求重新 verification。
4. 若 `progress.wait.kind !== "none"`，用中英并列 gate 名、MCP 返回的 `replyHint` 和剩余 steps 复述；不要复制本地批准词、重新 start/classify 或直接推进。
5. `progress.acceptanceAssist.suggested=true` 时标注“可选建议，不影响流程”；它不会产生等待、门禁或 finalize 条件。仅在有实际浏览器工具且用户明确要求后才协助验收。
6. wait 为 none 时再调用 `dev_flow_next`，只执行唯一动作。若 action 带 `requiredEvidence`，原样展示 fields/checks/verificationKinds。
7. `reviewStatus.enforced=true` 且 `reviewStatus.projection.batch.visibility=coarse` 时，只复述 batch/job 状态；不得索取、推断或转述其他 reviewer 的 findings。visibility 为 `complete` 后才可复述完整 findings/dispositions。不得编辑或登记 `plan-review`。
8. `implementation.enforced=true` 时复述实现单元进度：`implementation.activeUnitId`（进行中的 RU）、`implementation.lastCheckpointId`（最近 checkpoint）、`implementation.remainingUnitIds`（剩余单元）。`rollback.enforced=true` 时复述 `rollback.chain`、`rollback.validTargets`（合法预览目标）与 `rollback.conflicts`（未登记修改）；`validTargets` 为空表示当前没有可预览的回撤目标。

```text
当前：<featureId> · <route>
阶段：<grill Q-… | HUMAN GATE: requirement_confirmation（需求确认） | implementation_approval（实现批准）>
为何等待：…
继续：<progress.wait 中的 hint>
后续：<progress.remainingSteps 压缩>
```

合法等待不是失败。corrupt feature 使用 `dev_flow_recover_corrupt_feature`，禁止手改 `state.json`。降为 light 时用 `dev_flow_reclassify` + `userEvidence`；指纹变化后只能走完 standard 或 abandon 重开。
