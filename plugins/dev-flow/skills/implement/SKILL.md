---
name: implement
description: 仅在路线授权后实现。触发：按计划执行、开始实现、implement、implementation、df-implement、dev-flow-implement。当 dev_flow_next 返回 implementation 或实现单元动作时使用。
---

仅使用 Dev Flow MCP。调用 `dev_flow_next`；仅当返回实现相关动作时实现。

在 `implementation_approval` 已确认前不得实现或写 protected business roots。若 next 为 present/wait human gate，输出统一停步话术并停止。

## checkpoints: 1（新 feature 默认）

implementation 步骤内按实现单元（rollback unit）逐个推进，全部动作以 `dev_flow_next` / `dev_flow_status` 返回为准，不自行挑选或跳过单元：

1. next 返回 `begin-implementation-unit` → 调用 `dev_flow_begin_implementation_unit`。
2. 只编辑该单元 `fileScope` 内的文件（越界写入会被 Core/Hook 拒绝）；单元进行中可连续编辑多个文件，不逐文件调用 next。
3. next 返回 `checkpoint-implementation-unit` → 调用 `dev_flow_checkpoint_implementation_unit` 确认单元。失败（`CHECKPOINT_VERIFICATION_FAILED`、`IMPLEMENTATION_UNIT_OUT_OF_SCOPE`）时先修复再重试，禁止手改 checkpoint manifests/blobs/baselines 等控制文件。
4. 重复 1–3 直到全部单元 checkpointed；next 返回 `run-step(implementation)` 后只调用一次 `dev_flow_record_step(implementation)`。

## checkpoints: 0（旧 feature）

批准后允许按已批准计划连续编辑多个文件，不逐文件调用 next；完整 implementation 结束时只调用一次 `dev_flow_record_step(implementation)`。

上下文压缩后用 `dev_flow_status` + 当前 diff + 已批准计划恢复，不新增 partial state 或 progress artifact。

禁止手改 `.dev-flow` 控制文件。需要 artifact 时严格执行 `dev_flow_scaffold_artifact` → Read 已登记路径 → 编辑 → `dev_flow_record_artifact`，禁止盲写脚手架文件。
