---
name: code-review
description: 完成实现后进行代码审查。用户说 code-review、代码审查、检查这次改动、写完帮我 review、完成后审查和自验时使用；这是 requesting-code-review 的项目别名。
---

# 代码审查

使用 `.claude/skills/requesting-code-review/SKILL.md` 进行审查。

项目约定：

1. 先读取项目适配层；Claude 环境默认读取 `.claude/rules/project-workflow.md`。
2. 审查输入必须包含需求或计划来源。轻量 M 可使用对话内需求摘要 + diff + 涉及文件 + 验证证据；标准 M/L 使用 `openspec/changes/<change>/`、`<FEATURE_ROOT>/<feature>/需求说明书.md`、实现计划或 `status.md`。
3. 审查输入优先读取用户手动路径、上一步 `[HANDOFF]` 和 `<FEATURE_ROOT>/<feature-id>/context/review.jsonl`；没有时再按 feature 目录自动查找需求、计划、回撤清单和进度台账。
4. 审查重点先看需求覆盖、回归风险、项目规范、回撤完整性和缺失验证。
5. `code-review` 只审查已经产生的代码改动，不能替代实现前 `plan-review`，也不能把缺失的 `plan-review` 倒填为通过。
6. Critical / Important 问题必须先处理，或由用户明确接受风险。
7. 审查前优先读取 `<FEATURE_ROOT>/<feature-id>/status.md`；审查后更新状态文件和 `dev_flow_status`，并把审查报告追加到 `context/verify.jsonl`。
8. L 级功能保存到 `<REVIEW_ROOT>/YYYY-MM-DD-<feature-id>-code-review.md`，并在无阻塞时输出 `[HANDOFF]` 给 `verification-before-completion`。

不要把“代码审查”替代“验证”。审查后仍需要按 `verification-before-completion` 的证据规则完成验证。
