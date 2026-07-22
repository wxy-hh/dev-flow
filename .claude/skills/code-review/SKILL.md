---
name: code-review
description: 完成任务、实现重要功能、合并前或用户要求代码审查时使用。用户说 code-review、代码审查、检查这次改动、写完帮我 review、requesting code review、完成后审查和自验时使用。通过独立审查视角检查需求覆盖、回归风险、代码质量、项目规范和缺失验证。
---

# 代码审查

在代码完成后发起审查。审查者只接收明确输入：本次改动说明、需求/计划来源、代码差异范围、回撤证据和验证结果；不要把当前长对话历史直接交给审查者。

先读取项目适配层。Claude 环境默认读取 `.claude/rules/project-workflow.md`，从中获取 `<FEATURE_ROOT>`、`<REVIEW_ROOT>`、`<SDD_PROGRESS>` 路径。

核心原则：早审查，常审查；**severity 识别属于本 skill**（CRITICAL/HIGH 由本 skill 与 reviewer 判定）。严重和重要问题（CRITICAL / HIGH）必须处理，或由用户明确接受风险。代码审查只审查已完成实现，不能替代实现前 `plan-review`，也不能把缺失的 `plan-review` 倒填为通过。`rollback_units: full` 且实现已完成时，先确认 `rollback-units` 审计模式已补齐 commit/diff/patch；缺失时退回审计，不直接输出通过。

**code-review 不是 contract risk gate**：不调用、也不允许 `promote-gate code-review`。发现 CRITICAL/HIGH 时创建独立 review 报告，用 `complete-gate code-review --evidence-file ...` 登记；阻塞 finding 处置完成前不得 complete gate。CLI 不扫描自然语言 severity。标准 L 始终要求独立 code-review 报告。

## 何时使用

必须使用：完成 M/L 级功能后；每个子任务完成后（`executing-plans` 子代理模式）；合并到主分支或创建 PR 前。
适合使用：修复复杂 bug 后、重构后、卡住时需要新视角。

## 资产读取

按 `dev-flow/references/protocol.md` 的资产读取优先级；本技能额外读取：

- feature-scoped `<SDD_PROGRESS>`（`.claude/runtime/sdd/<feature-id>/progress.md`）和 `<RUNTIME_ROOT>/sdd/<feature-id>/reports/*.md`（`executing-plans` 子代理模式的任务报告）。不读取裸 `sdd/` 下的 legacy shared 文件。
- 当前 `git status`、`git diff --stat`、相关 diff 或 commit range。
- 轻量 M 若没有落盘资产，用对话内需求摘要、涉及文件、`git diff --stat` 和已运行验证证据作为等价输入，不为审查新建资产记录。

## 审查输入

```text
DESCRIPTION: 本次完成了什么
PLAN_OR_REQUIREMENTS: 需求或计划来源路径
LIGHTWEIGHT_CONTEXT: 轻量 M 可填写对话内需求摘要、边界和不做范围
ROLLBACK_UNITS: 回撤清单路径
BASE_SHA / HEAD_SHA: 改动起止提交或工作区
VALIDATION: 已运行的验证命令和结果
STATUS: 当前 status.md 路径和状态
```

不能取得 SHA 时，至少提供 `git diff --stat`、涉及文件列表、需求/计划路径、回撤单元路径和已运行验证。

## 审查方式

1. 读取 [references/code-reviewer.md](references/code-reviewer.md)。
2. 按模板填入本次任务信息，发起独立审查；没有子代理时在当前会话按同一模板审查。
3. 处理反馈：CRITICAL 立即修复；HIGH 继续前修复或请用户明确接受风险；MEDIUM/LOW 记录，可合并处理。
4. 修复后重新审查受影响范围。报告只写 **findings + evidence + disposition + remaining risks**，不重贴 diff 或完整实现。

## 输出格式（findings-only）

```markdown
# 代码审查报告

## 结论
- 通过 / 需修改 / 阻塞

## 统计
- CRITICAL: N 条
- HIGH: N 条
- MEDIUM: N 条
- LOW: N 条

## 输入资产
- 需求 / 计划 / 回撤清单 / Diff range / 验证证据：（路径指针，不粘贴全文）

## Findings

### C1. [标题] — CRITICAL
- **Evidence**：文件路径+最短必要片段
- **Impact**：影响范围
- **Suggestion**：可操作改进（禁止完整实现 dump）
- **Disposition**：待用户决定 / 已修复 / 已反驳 / 已接受风险

## Remaining risks
- ...
```

小功能可以只在对话中输出；L 级与 CRITICAL/HIGH 保存到 `<REVIEW_ROOT>/<feature-id>-code-review.md`。light 无阻塞项时可用 inline 或已有报告 heading，不创建空报告。

保存报告后，更新 `status.md`：把报告路径追加到 `assets`（`kind: "review"`），用 `complete-gate code-review --evidence-file ...`（或 light 的 `gate_evidence`）登记；标准 M/L 和轻量 L 同时保留在 `assets` 便于后续恢复。

## 交接规则

对话输出开头先给 3-5 行用户决策摘要：结论、阻塞项、需要决定的事项和下一步；完整发现、证据和修复建议写入报告。

`[HANDOFF]` 格式见 `dev-flow/references/protocol.md`。无 CRITICAL/HIGH 阻塞项时，`Current gate: code-review`，`Next skill: verification-before-completion`，`Auto-continue: yes`；控制者必须在同一会话直接进入 verification，不能把 `/finish` 留给用户记忆。存在 CRITICAL/HIGH 时，`Next skill: code-review`，`Auto-continue: no`，`Stop reason` 写明需要修复或用户明确接受风险的问题。
