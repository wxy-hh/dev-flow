---
name: code-review
description: 实现后审查当前 diff，查找真实 bug、回归、安全问题和缺失验证；这是 requesting-code-review 的项目别名。
---

# 代码审查

使用 `.claude/skills/requesting-code-review/SKILL.md`。

输入以当前 diff、Boundary/用户需求、相关源码和已运行验证为准。存在 `work.md` 时读取它，但不为审查创建额外文件；结论合并到其 Verification，或直接在对话中输出。

代码审查不能替代验证。Critical/Important 问题必须修复、被证据反驳，或由用户明确接受风险。
