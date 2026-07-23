---
name: coverage-review
description: 登记需求/测试/回撤覆盖证据。触发：需求覆盖、coverage、coverage-review、df-coverage-review、dev-flow-coverage-review。当 dev_flow_next 要求 coverage 时使用。
---

仅使用 Dev Flow MCP。先调用 `dev_flow_next`；当它要求 coverage 时，更新并登记 coverage artifact，再记录该一步。不得用代码审查替代计划审查。
