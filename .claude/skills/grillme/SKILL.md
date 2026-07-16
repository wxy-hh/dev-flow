---
name: grillme
description: 对需求、方案或实现计划进行一问一答式强力追问。用户说 grillme、grill me、grill、grilling、拷问一下、压测方案、挑战这个计划、找隐含假设时使用。
---

# 方案拷问

对用户进行一问一答式访谈，直到需求、计划或设计的关键分支都被澄清。dev-flow 标准 M/L 中，本技能读取用户提供的完整需求文档，或读取 `req-probe`/OpenSpec 刚生成的需求资产。

规则：

1. 一次只问一个问题，等待用户回答后再继续。
2. 每个问题都给出你的推荐答案，降低用户决策成本。
3. 如果问题可以通过阅读代码库回答，先自己查代码，不要把可验证事实抛给用户。
4. 只压测需求、方案和计划；不要写代码，不要替代 `writing-plans`。
5. 把重要结论合并回需求说明书、OpenSpec change 或实现计划；标准 M/L 必须先完成合并，再输出需求确认门禁。
6. 阻塞决策默认最多五个；仅在出现架构新分支、不可逆风险或配额/成本问题时扩至八个。非阻塞澄清（复述、确认听清、查代码后的事实核对）不占名额。
7. 收敛后展示完整 Decision Log（决策 ID、来源、结论、影响需求、非目标）。dev-flow 标准 M/L 再输出 `[HUMAN GATE:requirement_confirmation]`；只有已展示完整 Decision Log 与该 HUMAN GATE 后，用户的「继续」才可视为确认，其他场景的「继续」只表示继续提问或继续流程。
8. 没有发现新分支或阻塞问题、且不是 dev-flow 标准 M/L 或任何 L 级链路时，可以直接交接给 `writing-plans`。
9. dev-flow 标准 M/L 链路中，本技能是需求固化阶段唯一的 `requirement_confirmation` 输出者。压测和文档更新结束后，先调用 `complete-gate <feature-id> grillme`，让 status 的 `next_action` 变为 `await requirement_confirmation`，再输出该门禁并停止；等待用户确认后才能进入 `writing-plans`，不得 `Auto-continue: yes` 直达。用户在进入本技能前已经明确确认需求基线且无未决问题时，dev-flow 应跳过本技能并直接登记 evidence，不得调用后再重复确认。
10. 发现需要用户决策的新边界时，输出 `Auto-continue: no`，并在 `Stop reason` 写明要确认的问题。

`[HUMAN GATE]` 和 `[HANDOFF]` 格式见 `dev-flow/references/protocol.md`；`Current gate: grillme`，`Next skill: writing-plans`。
