---
name: rollback-safety
description: 登记回撤与安全证据，并做只读回撤预览。触发：回撤单元、rollback、rollback-safety、df-rollback-safety、dev-flow-rollback-safety。当 dev_flow_next 要求 rollback/safety 时使用。
---

仅使用 Dev Flow MCP 与路线资产。调用 `dev_flow_status` / `dev_flow_next`，只执行它请求的 rollback_safety、rollback_unit 或 risk_controls 动作。standard L 的 `rollback-units` artifact 严格执行 `dev_flow_scaffold_artifact` → Read 已登记路径 → 编辑 → `dev_flow_record_artifact_with_trace` → `dev_flow_record_step`，delta 只提交 `RU-...`。standard M 的 `rollback_unit` 不新建 artifact 或 RU：只调用 `dev_flow_record_step`，由 Core 校验 implementation-plan 已登记的 RU 和 `requiredEvidence.checks`。非 Trace 的 rollback-safety 仍用 `dev_flow_record_artifact`；禁止手改 snapshot/state pointer。

从 `requiredEvidence.checks` 提交本步要求的 rollback / full-rollback；二者是不同义务，不得互相替代。禁止在 Skill 内复制风险映射或替其他步骤补 evidence。

## 回撤预览、门禁与执行（第 4A 阶段）

`checkpoints: 1` feature 可用 `dev_flow_preview_rollback` 对已确认 checkpoint 做**只读**预览：只返回撤销顺序、文件影响与验证命令，不修改工作区或状态。预览返回 `ROLLBACK_CONFLICT` 时，只如实复述冲突明细（路径与 expected/actual）并停止，由用户决定下一步。

`checkpoints: 1` 且 `rollbackExecution: 1` feature 可用以下完整回撤流程：

### 回撤确认门禁

1. 调用 `dev_flow_present_rollback_gate` 展示回撤确认门禁。工具会：重新计算预览与 basis hash、创建 `rollback-confirmation` 交互、返回撤销单元、文件影响和回撤验证命令，并通过 MCP 启示等待用户响应。
2. 用户必须从后续交互中确认；无法在同一条消息中自批。
3. 若 basis 过期或工作区出现冲突，门禁自动清除并提示重新展示。
4. 门禁确认后的 `rollbackGate.status === "confirmed"`。

### 回撤执行

1. 确认门禁后，调用 `dev_flow_execute_rollback` 执行回撤。
2. 执行过程采用可续办事务日志：备份 → 文件恢复 → 回撤验证 → 状态提交。
3. 验证失败时自动补偿恢复到回撤前状态。
4. 事务中断（崩溃）时可续办，`dev_flow_doctor` 报告 open transaction 状态。
5. 成功回撤后将撤销的 RU 标记 `rolled_back`，最早撤销 RU 变回 `pending`，下游步骤（code review、verification、feature-check、finalize）失效。

禁止通过 Bash、Write 或任何宿主工具自行恢复文件。若 preview 返回冲突或 basis 过期，必须先解决问题再重新展示门禁。
