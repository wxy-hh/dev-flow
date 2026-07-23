---
name: implement
description: 仅在路线授权后实现。触发：按计划执行、开始实现、implement、implementation、df-implement、dev-flow-implement。当 dev_flow_next 返回 implementation 时使用。
---

仅使用 Dev Flow MCP。调用 `dev_flow_next`；仅当它返回 `implementation`（run-step）时实现，并只记录该步骤。

在必需的 `implementation_approval` **已确认**前不得实现、不得写 protected business roots。若 next 为 `present-human-gate` / `wait-human-gate`：输出统一停步话术并停止，不要实现。

禁止手改 `.dev-flow` 控制文件。业务证据仍走 scaffold → 编辑已登记路径 → record。
