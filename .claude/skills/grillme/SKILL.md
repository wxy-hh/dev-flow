---
name: grillme
description: 对方案、需求或实现计划做一问一答式拷问。用户说 grillme、grill me、拷问一下、压测方案、挑战这个计划、找隐含假设时使用；这是 grilling 技能的项目别名。
---

# 方案拷问别名

运行 `grilling` 技能。

使用方式：

1. 读取 `.claude/skills/grilling/SKILL.md`。
2. 按它的规则执行：一次只问一个问题，每个问题给出推荐答案。
3. 如果问题可以通过阅读代码库回答，先读代码，不要把可自行确认的问题抛给用户。

`grillme` 只负责压力测试需求、方案和计划。不要写代码，不要生成完整实现计划；把关键结论合并回需求说明书、OpenSpec change 或实现计划。

如果没有发现新分支或阻塞问题，输出 `[HANDOFF]` 给 `writing-plans`：

```text
[HANDOFF]
Feature ID: <feature-id>
Level: <M|L>
Current gate: grillme
Generated assets:
- <updated requirement or openspec paths>
Next skill: writing-plans
Next inputs:
- <updated requirement or openspec paths>
Auto-continue: yes
[/HANDOFF]
```

如果发现需要用户决策的新边界，`Auto-continue: no`，并把 `Stop reason` 写成需要确认的问题。
