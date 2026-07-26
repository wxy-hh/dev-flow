---
name: coverage-review
description: 登记需求/测试/回撤覆盖证据。触发：需求覆盖、coverage、coverage-review、df-coverage-review、dev-flow-coverage-review。当 dev_flow_next 要求 coverage 时使用。
---

仅使用 Dev Flow MCP。先调用 `dev_flow_next`；当它要求 coverage 时，对人工维护的 coverage artifact 严格执行 `dev_flow_scaffold_artifact` → Read 已登记路径 → 编辑 → `dev_flow_record_artifact` → `dev_flow_record_step(coverage_review)`。不得用代码审查替代计划审查。
