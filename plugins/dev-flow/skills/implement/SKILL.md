---
name: implement
description: 仅在路线授权后实现。触发：按计划执行、开始实现、implement、implementation、df-implement、dev-flow-implement。当 dev_flow_next 返回 implementation 时使用。
---

仅使用 Dev Flow MCP。调用 `dev_flow_next`；仅当它返回 `implementation` 时实现，并只记录该步骤。在必需的 implementation approval 确认前不得实现。
