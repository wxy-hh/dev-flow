---
name: grillme
description: 对需求、方案或实现计划进行一问一答式强力追问。用户说 grillme、grill me、grill、grilling、拷问一下、压测方案、挑战这个计划、找隐含假设时使用。
---

# 方案拷问

对用户进行一问一答式访谈，直到计划或设计的关键分支都被澄清。

规则：

1. 一次只问一个问题，等待用户回答后再继续。
2. 每个问题都给出你的推荐答案，降低用户决策成本。
3. 如果问题可以通过阅读代码库回答，先自己查代码，不要把可验证事实抛给用户。
4. 只压测需求、方案和计划；不要写代码，不要替代 `writing-plans`。
5. 把重要结论合并回需求说明书、OpenSpec change 或实现计划。
6. 没有发现新分支或阻塞问题、且不是 dev-flow 标准 M/L 或任何 L 级链路时，可以直接交接给 `writing-plans`。
7. dev-flow 标准 M/L 或任何 L 级链路中，压测结束后必须输出 `[HUMAN GATE:requirement_confirmation]` 并停止，等待用户确认后才能进入 `writing-plans`；不得 `Auto-continue: yes` 直达。
8. 发现需要用户决策的新边界时，输出 `Auto-continue: no`，并在 `Stop reason` 写明要确认的问题。

`[HUMAN GATE]` 和 `[HANDOFF]` 格式见 `dev-flow/references/protocol.md`；`Current gate: grillme`，`Next skill: writing-plans`。
