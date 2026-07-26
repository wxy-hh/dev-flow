---
name: implement
description: 仅在路线授权后实现。触发：按计划执行、开始实现、implement、implementation、df-implement、dev-flow-implement。当 dev_flow_next 返回 implementation 时使用。
---

仅使用 Dev Flow MCP。调用 `dev_flow_next`；仅当返回 `implementation`（run-step）时实现。

在 `implementation_approval` 已确认前不得实现或写 protected business roots。若 next 为 present/wait human gate，输出统一停步话术并停止。

批准后允许按已批准计划连续编辑多个文件，不逐文件调用 next；完整 implementation 结束时只调用一次 `dev_flow_record_step(implementation)`。上下文压缩后用 `dev_flow_status` + 当前 diff + 已批准计划恢复，不新增 partial state 或 progress artifact。

禁止手改 `.dev-flow` 控制文件。需要 artifact 时严格执行 `dev_flow_scaffold_artifact` → Read 已登记路径 → 编辑 → `dev_flow_record_artifact`，禁止盲写脚手架文件。
