---
name: verify
description: 运行项目已配置的验证。触发：验证、跑测试、verification、verify、df-verify、dev-flow-verify。当 dev_flow_next 返回 verification 时使用。
---

仅使用 Dev Flow MCP。调用 `dev_flow_next`；仅当它返回 `verification` 时使用 `dev_flow_verify`。禁止执行未登记的验证命令；尝试须经 MCP 记录。
