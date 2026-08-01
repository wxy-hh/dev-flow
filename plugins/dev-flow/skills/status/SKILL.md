---
name: status
description: 查看并接力 Dev Flow 状态。触发：查状态、继续任务、当前进度、status、df-status、dev-flow-status。
---

仅使用 Dev Flow MCP：`dev_flow_status` 与 `dev_flow_next`；需要核对 Trace 时只读调用 `dev_flow_get_traceability`。禁止直接编辑工作流状态文件、snapshot 或 state pointer。

用户说“继续 / 当前进度”时：

1. 先调用 `dev_flow_status`（StatusView = state + `progress`）。`reviewStatus` 存在时，它与只读 `plan-review` Markdown 由同一 Core 投影派生。
2. `progress` 是展示权威；不要仅凭 raw `steps.*.status === satisfied` 声称证据仍 fresh。
3. 若 `progress.verificationFreshness.status === stale`，明确说明 `VERIFICATION_STALE` 并要求重新 verification。
4. 若 `progress.wait.kind !== "none"`，面向用户以自然语言复述等待内容（参考 MCP 返回的 `replyHint` 判定门禁类型与动作）：HUMAN GATE 提示「回复『确认』或『修改需求/修改计划：<内容>』」，grill 提示「回复 A/B/C 或方案名称」；不向用户展示 featureId/route 等内部标识；不要复制本地批准词、重新 start/classify 或直接推进。
5. `progress.acceptanceAssist.suggested=true` 时标注“可选建议，不影响流程”；它不会产生等待、门禁或 finalize 条件。仅在有实际浏览器工具且用户明确要求后才协助验收。
6. wait 为 none 时再调用 `dev_flow_next`，只执行唯一动作。若 action 带 `requiredEvidence`，原样展示 fields/checks/verificationKinds。
7. `reviewStatus.enforced=true` 且 `reviewStatus.projection.batch.visibility=coarse` 时，只复述 batch/job 状态；不得索取、推断或转述其他 reviewer 的 findings。visibility 为 `complete` 后才可复述完整 findings/dispositions。不得编辑或登记 `plan-review`。
8. `implementation.enforced=true` 时面向用户复述实现单元进度——判定依据 `implementation.activeUnitId` / `implementation.lastCheckpointId` / `implementation.remainingUnitIds`，但话术**不带 `RU-`/`CP-` 内部 id**：「进行中的实现单元」「最近一次保存点」「剩余 N 个实现单元」。`rollback.enforced=true` 时复述回撤状态：「可回撤到前 N 个保存点」（依据 `rollback.validTargets`，为空则说「当前没有可回撤的目标」）、「检测到 N 处未登记修改（路径…）」（依据 `rollback.conflicts`）；`rollback.gateStatus` 为 `pending` 时等待用户确认、`confirmed` 时已确认可执行；`rollback.openTransaction` 存在时报告事务可续办并提示运行 `dev_flow_doctor`。

```text
<自然语言呈现等待内容：HUMAN GATE 为「需要你确认/批准…，回复『确认』或『修改需求/修改计划：<内容>』」；
grill 为「Q-…：<问题>，回复 A/B/C 或方案名称」>
<可选一行小字：剩余步骤进度>
```

合法等待不是失败。corrupt feature 使用 `dev_flow_recover_corrupt_feature`，禁止手改 `state.json`。降为 light 时用 `dev_flow_reclassify` + `userEvidence`；指纹变化后只能走完 standard 或 abandon 重开。
