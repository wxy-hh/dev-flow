---
name: dev-flow
description: 新开发需求的默认入口。先按改动拓扑判断 XS/S/M/L，再独立识别 security/data/money/external/availability 风险；小任务直接实现，大任务按 work.md 批次推进，高风险任务必须经过实现前确认。
---

# 开发工作流

dev-flow 只做三件事：选择足够轻的执行方式、阻止未确认的高风险实现、在完成前取得新鲜验证证据。

先读取 `.claude/rules/project-workflow.md`、`CLAUDE.md` 和直接相关源码。项目事实只来自项目适配层，不把其它项目的路径或命令写进本技能。

## 1. 先判断任务规模

等级决定计划深度、执行批次和恢复方式，不直接决定安全门禁。

| 等级 | 判断 | 默认方式 |
|------|------|----------|
| XS | 单点、行为不变或显然、可立即验证 | 直接修改并验证 |
| S | 局部行为变化，边界清楚，单模块内可回滚 | 简短复述后修改并验证 |
| M | 一个功能内有多个协同步骤，但共享契约稳定、失败范围有限 | 对话内短计划；跨会话时可用一个 `work.md` |
| L | 跨架构层、共享契约/协议、多条调用链、部分成功状态或协调回滚 | 一个 `work.md`，按批次执行 |

任一强信号即可判为 L：

- 改动跨越三个及以上架构层，例如 Web → API → Queue → Worker → Shared。
- 修改被多个调用方消费的共享接口、协议、状态模型或基础抽象。
- 同一能力必须在多条链路保持一致，漏改会产生静默不一致。
- 发布、失败恢复或回滚必须跨模块协调。
- 适配外部协议时，参数、错误、流式语义或用量语义存在差异。

文件数量只是调查线索。大量机械替换可以降级；一行共享鉴权逻辑也可能带高风险。

例如，给四条模型链路接入新 provider，且改动横跨 Web、API、Queue、Worker、Shared，并适配参数、错误、流式和用量语义，应判为 L，而不是因为“只是增加一个模型”判为 M。

## 2. 再判断风险

风险标签独立决定硬门禁和验证强度：

- `security`：登录、鉴权、权限、token/session、敏感信息。
- `data`：删除、迁移、数据完整性、不可逆状态变化。
- `money`：支付、订单金额、计费调用、用量归属。
- `external`：外部协议、跨系统入口、密钥、第三方失败语义。
- `availability`：共享运行时、关键链路或广泛故障面。

标签按失败后果触发，不按关键词触发：复用现有鉴权客户端不自动算 `security`，展示价格不自动算 `money`，通过稳定封装调用既有外部 API 不自动算 `external`。只有本次改动改变控制决策、敏感信息处理、计费归属、外部契约/失败传播或共享可用性时才加标签。

任务可以是 `S + security`，也可以是没有高风险标签的 L。先向用户报告一个 XS/S/M/L，再用一句话说明风险标签和由此触发的门禁。

## 3. 产物预算

- 普通 XS/S：零流程文件。
- 普通 M：默认零流程文件；只有跨会话恢复或重要决策需要持久化时，最多一个 `work.md`。
- L：一个 `work.md`。
- 任意带风险标签的任务：一个 `work.md`，不受等级影响。
- 只有测试必须由用户或外部环境独立执行时，才增加一个 `manual-test.md`。

需求澄清、覆盖检查、计划审查、回撤、代码审查和验证默认写进对话或同一个 `work.md`，不各建报告。用户明确要求独立文档时才例外。

## 4. 唯一工作文件

路径：

```text
<FEATURE_ROOT>/<feature-id>/work.md
```

顶部使用固定状态块，不再维护第二份摘要：

```markdown
# <feature name>

## State
- Level: L
- Risks: external, money, availability
- Phase: planning
- Approval: pending
- Approval evidence: none
- Verification: pending
- Accepted risks: none
- Updated: YYYY-MM-DD

## Boundary
- Goal: ...
- Out of scope: ...
- Acceptance: ...

## Context
- `path/to/relevant-non-sensitive-file`: why it matters

## Batches
- [ ] Batch 1: outcome; scope; verification; rollback
- [ ] Batch 2: outcome; scope; verification; rollback

## Risk and rollback
- ...

## Verification
- Evidence: pending
```

约束：

- `Risks` 只能是 `none` 或已定义标签。
- `Risks: none` 时使用 `Approval: not-required`；有标签时在风险卡后的用户确认前保持 `Approval: pending`。
- `Context` 只列恢复时真正需要重读的少量路径；禁止登记 `.env*`、凭据或整个源码清单。
- L 通常拆成 3–7 个结果导向批次。每批写结果、主要范围、验证和回撤，不写逐行编辑教程。
- 每完成一批，立即勾选、记录验证，并更新 State；计划不能与实际进度长期漂移。

## 5. 高风险硬门禁

只要存在风险标签，实现前输出一次风险卡：

```text
[HUMAN GATE:implementation_approval]
边界：<做什么和不做什么>
风险：<已触发标签及失败后果>
回撤：<如何止损或撤回>
验证：<如何证明关键路径>
请确认是否开始实现。
[/HUMAN GATE]
```

输出风险卡后当前回合立即停止，不写业务代码。

用户最初说“直接改”只表达任务意图，不能自动接受随后披露的风险。只有用户在风险卡之后明确回复确认，才能把 `Approval` 改为 `confirmed`、把原话写入 `Approval evidence` 并开始实现。

用户要求跳过时，先说明具体残留风险；只有后续明确回复“跳过并接受风险”才能把 `Approval` 写为 `skipped`，同时记录 evidence 和 `Accepted risks`。

需求仍有会改变方案或风险的歧义时先澄清，不固定增加第二个人工门禁。执行中出现新风险标签或明显扩大边界时，更新风险卡并再次停下；普通实现偏差由代理自行修正。

## 6. 各等级执行路径

### XS / S

1. 读取直接相关文件。
2. 复述必要边界；只有阻塞问题才询问。
3. 做最小修改。
4. 运行最相关验证并汇报证据。

### M

1. 在对话里给出 2–5 个结果步骤。
2. 若需要恢复或命中风险，创建一个短 `work.md`。
3. 实现后基于真实 diff 做审查。
4. 运行相关命令和必要行为验证。

### L

1. 创建 `work.md`，写清边界、3–7 个批次、风险和回撤。
2. 有风险标签时停在 HUMAN GATE；无风险标签时可直接开始。
3. 一次只推进一个可验证批次；完成后立即更新恢复点。
4. 除非遇到新风险、明显扩范围或需要外部授权，否则批次之间自动继续。
5. 完成后基于完整 diff 做一次审查和新鲜验证。
6. 将 `Phase` 标为 `done`、`Verification` 标为 `passed|partial|failed`，记录实际 Evidence。
7. 运行 `.claude/skills/dev-flow/scripts/dev-flow-feature-check <feature-id> --finish`。

可使用 `writing-plans`、`requirements-coverage`、`plan-review`、`rollback-units`、`code-review` 或 `verification-before-completion` 作为检查视角，但它们不是固定流水线，也不默认创建新文件。

## 7. 恢复与重分级

恢复 L、风险任务或已落盘的 M 时，只读取 `work.md` 的未完成批次、其中列出的少量 Context 和当前 diff。不要重跑已完成且证据仍然新鲜的批次。

发现实际范围更大时，说明原等级、新等级和依据；升级到 L 后创建或补齐 `work.md`。发现新风险时按硬门禁处理。降级时保留已有有效证据，但不补建轻量路径不需要的文件。

## 8. 完成标准

- 结论必须由本轮实际运行的命令、页面/接口行为或人工检查支撑。
- L 运行时行为改动不能只靠 type-check 或 lint。
- 验证后代码变化会使旧证据失效，必须重跑受影响检查。
- `partial` 必须写清缺失覆盖和用户接受的残留风险；否则不能收尾。
- 不自动提交、推送、合并、回滚或删除分支，除非用户明确授权相应动作。

## 回复格式

开始时：

```text
我判断这是 <level>，因为 <scope evidence>。风险标签：<none|tags>。我会 <route>。
```

结束时只汇报改动、验证和残留风险。只有实际停顿时才给出简短恢复信息：feature id、当前 phase、未完成批次和下一步；不要重复完整资产清单。
