---
name: grilling
description: 对需求、方案或实现计划进行强力追问。用户想在开发前压测计划、找遗漏分支、找隐含假设，或说 grill、grilling、拷问、挑战方案时使用。
---

# 方案拷问

对用户进行一问一答式访谈，直到计划或设计的关键分支都被澄清。

规则：

1. 一次只问一个问题，等待用户回答后再继续。
2. 每个问题都给出你的推荐答案，降低用户决策成本。
3. 如果问题可以通过阅读代码库回答，先自己查代码，不要把可验证事实抛给用户。
4. 只压测需求、方案和计划；不要写代码，不要替代 `writing-plans`。
5. 把重要结论合并回需求说明书、OpenSpec change 或实现计划。
6. 没有发现新分支或阻塞问题时，输出 `[HANDOFF]` 给 `writing-plans`，`Auto-continue: yes`。
7. 发现需要用户决策的新边界时，输出 `Auto-continue: no`，并在 `Stop reason` 写明要确认的问题。

交接格式：

```text
[HANDOFF]
Feature ID: <feature-id>
Level: <M|L>
Current gate: grilling
Generated assets:
- <updated requirement or openspec paths>
Next skill: writing-plans
Next inputs:
- <updated requirement or openspec paths>
Auto-continue: yes
[/HANDOFF]
```
