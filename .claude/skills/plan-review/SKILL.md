---
name: plan-review
description: 多维度独立审查计划，查漏补缺后再执行。已有 requirements-coverage 覆盖矩阵、需求说明书、OpenSpec 产物或实现计划需要从架构、安全、规范、项目文件和需求缺口角度审查时使用；dev-flow 在风险维度触发计划审查门禁时使用。
---

# 计划审查

对一份计划文档进行多维度、多角色、对抗性审查。每个审查 Agent 会同时分析实现计划、需求覆盖结论、需求材料和项目实际代码/规范，从它们之间的差距中发现问题。

先读取项目适配层。Claude 环境默认读取 `.claude/rules/project-workflow.md`，从中获取 `<FEATURE_ROOT>`、`<REVIEW_ROOT>`、验证配置和项目能力边界；写文件前再展开为真实路径。

## 核心规则

- 不写业务代码。
- 不替代 `requirements-coverage`；覆盖矩阵缺失时只能记录流程风险和明显遗漏。
- 不只依赖当前对话。优先读取用户显式路径和上一步 `[HANDOFF]`，再按约定目录查找文件。
- CRITICAL/HIGH 是实现前阻塞项；必须修复、反驳，或由用户明确接受风险后才能继续。
- L 级审查报告必须保存到 `<REVIEW_ROOT>/YYYY-MM-DD-<feature-id>-plan-review.md`。

## 资产读取

输入优先级：

1. 用户当前消息中手动引用的计划、需求、覆盖矩阵或 OpenSpec 路径。
2. 上一步 `[HANDOFF]` 的 `Next inputs`。
3. 当前 feature 目录的约定文件：
   - `<FEATURE_ROOT>/<feature-id>/需求说明书.md`
   - `<FEATURE_ROOT>/<feature-id>/初步实现计划.md`
   - `<FEATURE_ROOT>/<feature-id>/requirements-coverage.md`
4. 对应 OpenSpec 产物：
   - `openspec/changes/<change-id>/proposal.md`
   - `openspec/changes/<change-id>/design.md`
   - `openspec/changes/<change-id>/tasks.md`
   - `openspec/changes/<change-id>/specs/**/*.md`
5. 无明确 feature 时，查找最近修改的 `<FEATURE_ROOT>/*/初步实现计划.md`，再读取同目录需求和覆盖矩阵。

如果找不到计划，提示用户提供计划路径或先使用 `writing-plans`。如果找不到覆盖矩阵，标准 M/L 要把“缺少需求覆盖门禁”列为流程风险。

## 前置信息收集

在启动审查前，先收集所有审查视角共同需要的信息，避免重复读取：

1. **计划和需求材料**：实现计划、需求说明书、OpenSpec proposal/design/tasks/spec delta。
2. **需求覆盖材料**：`requirements-coverage` 输出的矩阵或结论。
3. **项目规范文件**：始终读取 `.claude/rules/project-workflow.md` 和 `CLAUDE.md`。
4. **可选规则文件**：存在才读取，不存在不要报错；优先读取 `.claude/rules/`、`.claude/skills/` 下与当前任务相关的规则。本轮只适配 Claude，除非用户显式提供路径，不读取 Agent 入口说明。
5. **计划涉及的源文件**：从计划中提取路径后读取 Vue、API、store、router、类型、配置和关键依赖文件。

读取到的文件内容作为项目上下文，随计划文本、需求材料和覆盖结论一起传给审查 Agent。

## 执行审查

收集完信息后直接启动多视角审查，不要额外等待确认。审查 Prompt 模板见 `references/review-prompts.md`。

审查维度必须覆盖：

- 需求覆盖缺口是否已经反映到计划。
- 架构设计和模块边界是否合理。
- 安全、权限、数据完整性和错误分支是否充分。
- 计划列出的项目文件是否真实、必要、符合项目约定。
- 验证方式是否能证明需求完成。
- 回撤边界是否能支撑后续 `rollback-units`。

审查结果按严重程度排序并去重：CRITICAL -> HIGH -> MEDIUM -> LOW。

## 覆盖缺口映射

- 覆盖矩阵中的 `MISSING`、`CONFLICT`、`OUT_OF_SCOPE` 一律按 CRITICAL 处理。
- L 级中的 `PARTIAL` 或 `UNVERIFIABLE` 按 CRITICAL 处理；标准 M 中至少按 HIGH 处理，除非用户已明确接受风险。
- 标准 M/L 中未解释的 `EXTRA` 至少按 HIGH 处理。

## 审查报告格式

```markdown
# 计划审查报告

## 统计
- CRITICAL: N 条
- HIGH: N 条
- MEDIUM: N 条
- LOW: N 条

## 输入资产
- 需求来源：
- 实现计划：
- 覆盖矩阵：
- 项目规范：
- 相关源码：

## 需求覆盖输入
- 覆盖结论：通过 / 有缺口 / 未提供
- 影响审查的覆盖缺口：...

## 严重发现（CRITICAL）

### 1. [问题标题]
- **覆盖维度**：架构审查 / 风险边界 / 文件可行性 / UX / 验证
- **问题描述**：
- **事实依据**
  - 计划原文：
  - 代码现状：
  - 规范要求：
- **改进建议**：
- **采纳状态**：待用户决定 / 已采纳 / 已反驳 / 已调整

## 重要发现（HIGH）
...

## 中等发现（MEDIUM）
...

## 轻微发现（LOW）
...

## 审查小结
- 计划整体质量评价：
- 建议优先处理项：
```

## 用户决策和修订

有 CRITICAL/HIGH 时，停下让用户决定：

```text
请对每条 CRITICAL/HIGH 做出决定：采纳 / 反驳 / 调整。
```

根据用户决定修订原始计划，并更新审查报告里的采纳状态。修订后展示修订点摘要。无 CRITICAL/HIGH 时，不需要逐条审批，直接输出交接块进入下一道已触发门禁；如果回撤单元门禁被触发，则进入 `rollback-units`。

## 输出和交接

输出顺序：

1. 一句话结论：通过 / 需修订 / 阻塞。
2. 报告路径；L 级必须保存为 `<REVIEW_ROOT>/YYYY-MM-DD-<feature-id>-plan-review.md`。
3. CRITICAL/HIGH 阻塞项摘要。
4. MEDIUM/LOW 摘要。
5. 修订建议或已修订摘要。
6. 更新 `<FEATURE_ROOT>/<feature-id>/status.md`。
7. `[HANDOFF]` 交接块。

无 CRITICAL/HIGH 时：

```text
[HANDOFF]
Feature ID: <feature-id>
Level: <M|L>
Current gate: plan-review
Generated assets:
- <FEATURE_ROOT>/<feature-id>/status.md
- <REVIEW_ROOT>/YYYY-MM-DD-<feature-id>-plan-review.md
Next skill: <next-triggered-gate>
Next inputs:
- <FEATURE_ROOT>/<feature-id>/需求说明书.md
- <FEATURE_ROOT>/<feature-id>/初步实现计划.md
- <FEATURE_ROOT>/<feature-id>/requirements-coverage.md
- <REVIEW_ROOT>/YYYY-MM-DD-<feature-id>-plan-review.md
Auto-continue: yes
[/HANDOFF]
```

常见取值：

- 回撤单元触发为 `full`：`Next skill: rollback-units`
- 只需要轻量回撤证据：`Next skill: subagent-driven-development` 或 `executing-plans`，并把回撤摘要写入 `status.md`
- 安全审查尚未完成：`Next skill: security-reviewer` 或在 `status.md` 中补轻量安全结论

有 CRITICAL/HIGH 时：

```text
[HANDOFF]
Feature ID: <feature-id>
Level: <M|L>
Current gate: plan-review
Generated assets:
- <FEATURE_ROOT>/<feature-id>/status.md
- <REVIEW_ROOT>/YYYY-MM-DD-<feature-id>-plan-review.md
Next skill: plan-review
Next inputs:
- <FEATURE_ROOT>/<feature-id>/初步实现计划.md
Auto-continue: no
Stop reason: CRITICAL/HIGH findings need user decision or plan revision
[/HANDOFF]
```

## 注意事项

- 计划少于 100 字时，提示计划过于简略，建议先补充细节。
- 审查 Agent 输出 JSON，但向用户展示时用自然语言。
- 严禁编造不存在的问题；每条发现都要能指向计划、代码或规范事实。
- 不在审查报告中加入实现代码；这是计划审查，不是代码审查。
