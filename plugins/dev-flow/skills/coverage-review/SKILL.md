---
name: coverage-review
description: 查看或补充需求/测试/回撤覆盖证据。触发：需求覆盖、coverage、coverage-review、df-coverage-review、dev-flow-coverage-review。2.0 中覆盖是 planning/review 的内部义务，不是固定路线步骤。
---

仅使用 Dev Flow MCP。先调用 `dev_flow_status` / `dev_flow_next` 查看当前 planning obligation；不要自行创建 coverage 路线步骤或重复确认。结构化 coverage 从实施计划 trace delta、review findings 和 verification summary 生成；若 Core 返回明确的补证据动作，再按该动作登记，并保持同一 CAS、NFC 路径和 pointer 完整性。不得手改 snapshot/state pointer，也不得用代码审查替代计划审查。
