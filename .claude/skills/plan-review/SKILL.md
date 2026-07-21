---
name: plan-review
description: 多维度独立审查计划，查漏补缺后再执行。已有 requirements-coverage 覆盖矩阵、需求说明书、OpenSpec 产物或实现计划需要从架构、安全、规范、项目文件和需求缺口角度审查时使用；dev-flow 在风险维度触发计划审查门禁时使用。
---

# 计划审查

对一份计划文档进行多维度、多角色、对抗性审查。每个审查 Agent 会同时分析实现计划、需求覆盖结论、需求材料和项目实际代码/规范，从它们之间的差距中发现问题。

先读取项目适配层。Claude 环境默认读取 `.claude/rules/project-workflow.md`，从中获取 `<FEATURE_ROOT>`、`<REVIEW_ROOT>`、`<SCOPED_SPEC_ROOT>`、验证配置和项目能力边界。

## 核心规则

- 不写业务代码；审查报告不 dump 完整实现或大段计划原文，只写 findings。
- 不替代 `requirements-coverage`；标准 L 和命中 security 风险标签的计划缺少覆盖矩阵时必须退回 `requirements-coverage`，其它场景才可记录流程风险和明显遗漏。
- 不替代 `code-review`，也不能被实现后的 `code-review` 替代；本技能只做实现前计划审查。
- 不只依赖当前对话。优先读取用户显式路径和上一步 `[HANDOFF]`，再按约定目录查找文件。
- **severity 识别属于本 skill**：CRITICAL/HIGH 由本 skill（及 reviewer prompts）判定；CLI 不扫描自然语言、不自动 promote。light 执行中一旦产生 CRITICAL/HIGH，必须先调用 `node .claude/skills/dev-flow/scripts/dev-flow-status.mjs promote-gate <feature-id> plan_review --to full --reason <text>`（在仓库根目录执行），再落盘 full 报告；即使 finding 随后被修复，也保留 full 报告与 disposition。
- CRITICAL/HIGH 是实现前阻塞项；必须修复、反驳，或由用户明确接受风险后才能继续。
- 与 Locked Decision Log 冲突时只能标记 `scope-conflict` 并停下请求用户决定，不得自行改写已锁定决策。
- 标准 M/L 无论 `light` 还是 `full`，都必须在第一处业务源码修改前完成本门禁。
- L 级 / full 审查报告保存到 `<REVIEW_ROOT>/<feature-id>-plan-review.md`；light 不创建空报告，可用 inline 或指向已有 heading。

## 资产读取

按 `dev-flow/references/protocol.md` 的资产读取优先级；本技能额外查找 OpenSpec 产物（`proposal.md`/`design.md`/`tasks.md`/`specs/**/*.md`）和 `<FEATURE_ROOT>/<feature-id>/requirements-coverage.md`。找不到计划时，提示用户提供路径或先使用 `writing-plans`。

## 前置检查

标准 L 和命中 security 风险标签的计划，必须先完成 `requirements-coverage`；`requirements-coverage.md` 缺失且 `status.md` 未记录已完成时，停止并交回 `requirements-coverage`，不生成 plan-review 报告。标准 M 中 `risk_gates.requirements_coverage` 不是 `none` 时同样要求先完成覆盖门禁。

`requirements-coverage` 有 `MISSING`、`CONFLICT`、`OUT_OF_SCOPE`，或 L 级有未接受的 `PARTIAL`/`UNVERIFIABLE` 时，不继续审查计划优劣，先修订需求或计划。审查过程中新发现"需求条目未映射到任务/验收/验证"的 coverage 缺口时，标记为 `coverage-return`，退回 `requirements-coverage` 更新矩阵后再重新审查；不要在报告里直接改计划并把 coverage 结论当作已通过。

未完成覆盖时：`Current gate: plan-review`，`Next skill: requirements-coverage`，`Auto-continue: yes`，`Stop reason: requirements coverage required before plan-review`（格式见 protocol.md）。

## 前置信息收集

在启动审查前，先收集所有审查视角共同需要的信息，避免重复读取：

1. **计划和需求材料**：实现计划、需求说明书、OpenSpec proposal/design/tasks/spec delta。
2. **需求覆盖材料**：`requirements-coverage` 输出的矩阵或结论。
3. **项目规范文件**：始终读取 `.claude/rules/project-workflow.md` 和 `CLAUDE.md`。
4. **可选规则文件**：存在才读取，不存在不要报错；优先读取与当前任务相关的 `.claude/rules/`、`.claude/skills/` 规则，以及命中的 `<SCOPED_SPEC_ROOT>/<scope>/index.md`。本轮只适配 Claude，除非用户显式提供路径，不读取 Agent 入口说明。
5. **计划涉及的源文件**：从计划中提取路径后读取相关页面、组件、API、状态、路由、类型、配置和关键依赖文件。

读取到的文件内容作为项目上下文，随计划文本、需求材料和覆盖结论一起传给审查 Agent。

## 执行审查

收集完信息后直接启动多视角审查，不要额外等待确认。审查 Prompt 模板见 [references/review-prompts.md](references/review-prompts.md)。

审查维度必须覆盖：需求覆盖缺口是否已经反映到计划、架构设计和模块边界是否合理、安全权限数据完整性和错误分支是否充分、计划列出的项目文件是否真实必要符合项目约定、验证方式是否能证明需求完成、回撤边界是否能支撑后续 `rollback-units`。

审查结果按严重程度排序并去重：CRITICAL -> HIGH -> MEDIUM -> LOW。报告只写 **findings + evidence + disposition + remaining risks**，不重贴计划或完整实现。

## 覆盖缺口映射

- 覆盖矩阵中的 `MISSING`、`CONFLICT`、`OUT_OF_SCOPE` 一律按 CRITICAL 处理。
- L 级中的 `PARTIAL` 或 `UNVERIFIABLE` 按 CRITICAL 处理；标准 M 中至少按 HIGH 处理，除非用户已明确接受风险。
- 标准 M/L 中未解释的 `EXTRA` 至少按 HIGH 处理。

## 审查报告格式（findings-only）

```markdown
# 计划审查报告

## 统计
- CRITICAL: N 条
- HIGH: N 条
- MEDIUM: N 条
- LOW: N 条

## 输入资产
- 需求来源 / 实现计划 / 覆盖矩阵 / 规范 / 相关源码：（路径指针，不粘贴全文）

## Findings

### C1. [标题] — CRITICAL
- **维度**：架构 / 风险边界 / 文件可行性 / UX / 验证
- **Evidence**：计划/代码/规范的最短引用
- **Suggestion**：可操作改进（禁止完整实现 dump）
- **Disposition**：待用户决定 / 已采纳 / 已反驳 / 已调整 / 已接受风险

## Remaining risks
- ...
```

## 用户决策和修订

有 CRITICAL/HIGH 时，停下让用户对每条做出决定：采纳 / 反驳 / 调整。根据用户决定修订原始计划，并更新审查报告里的 disposition，展示修订点摘要。

无 CRITICAL/HIGH 时，不需要逐条审批；如果回撤单元、安全审查等实现前门禁仍未完成，可以自动交给下一道已触发门禁。如果下一步会写业务代码，必须输出 `[HUMAN GATE:implementation_approval]` 并停止。

## 输出和交接

输出顺序：用户决策摘要、结论、报告路径（L 级 `<REVIEW_ROOT>/<feature-id>-plan-review.md`）、CRITICAL/HIGH、MEDIUM/LOW、修订建议。

保存报告后把路径追加到 `status.md` 的 `assets`（`kind: "review"`），用 `complete-gate plan-review --evidence-file ...` 登记；标准 M/L 必须保持 `human_gates.implementation_approval.required: true`，用户确认前保持 `status: pending`。按 `dev-flow/references/protocol.md` 输出 `[HANDOFF]`。

常见取值：

- 回撤单元触发为 `full`：`Next skill: rollback-units`，`Auto-continue: yes`。
- 只需要轻量回撤证据：先把回撤摘要写入 `status.md`，再输出 `[HUMAN GATE:implementation_approval]`。
- 安全审查尚未完成：`Next skill: security-reviewer`，或在 `status.md` 中补轻量安全结论。
- 下一步是 `executing-plans`（实现）：不得 `Auto-continue: yes`。必须先输出 `[HUMAN GATE:implementation_approval]`，再输出 `Next skill: executing-plans`，`Auto-continue: no`，`Stop reason: human implementation approval required after plan-review`。
- 有 CRITICAL/HIGH：`Next skill: plan-review`，`Auto-continue: no`，`Stop reason: CRITICAL/HIGH findings need user decision or plan revision`。

## 注意事项

- 计划少于 100 字时，提示计划过于简略，建议先补充细节。
- 审查 Agent 输出 JSON，但向用户展示时用自然语言。
- 严禁编造不存在的问题；每条发现都要能指向计划、代码或规范事实。
- 不在审查报告中加入实现代码；这是计划审查，不是代码审查。
