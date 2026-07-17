# 工作流级别路线说明设计

## 目标

让使用 dev-flow 的用户在任务开始前知道当前级别会经过哪些步骤，并在执行过程中能根据阶段名称、HUMAN GATE 和 `status.md.next_action` 判断已经进行到哪里。

## 信息结构

- `README.md` 保留一屏内可读的路线速查表，并链接到完整指南。
- `docs/claude-dev-flow-guide.md` 维护面向用户的完整级别路线、停顿点、完成检查和进度判断方法。
- `.claude/skills/dev-flow/SKILL.md` 继续作为执行规则来源，只增加用户指南入口，不复制另一份详细规则。

流程契约仍以 `contract.json`、`SKILL.md`、`standard-ml.md` 和 `risk-gates.md` 为准；用户指南用于解释，不取代机器契约。

## 验证

- 对照活动 skill、contract 和 smoke test 核对所有路线。
- 运行 `dev-flow-doctor` 检查文档与流程包一致性。
