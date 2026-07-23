---
name: df-verify
description: 仅运行项目已配置的 Dev Flow 验证。用户说验证、跑测试、verification、完成前验证、df-verify、dev-flow-verify 时使用。当 dev_flow_next 返回 verification 时使用。
---

仅使用 Dev Flow MCP。调用 `dev_flow_next`；仅当它返回 `verification` 时使用 `dev_flow_verify`。禁止执行未登记的验证命令；尝试须经 MCP 记录。
