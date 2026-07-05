---
name: requesting-code-review
description: 完成任务、实现重要功能、合并前或用户要求代码审查时使用。通过独立审查视角检查需求覆盖、回归风险、代码质量、项目规范和缺失验证。
---

# 发起代码审查

在代码完成后发起审查。审查者只接收明确输入：本次改动说明、需求/计划来源、代码差异范围、回撤证据和验证结果；不要把当前长对话历史直接交给审查者。

先读取项目适配层。Claude 环境默认读取 `.claude/rules/project-workflow.md`，从中获取 `<FEATURE_ROOT>`、`<REVIEW_ROOT>` 和 `<SDD_PROGRESS>`；写文件前再展开为真实路径。

核心原则：早审查，常审查；严重和重要问题（Critical / Important）必须处理，或由用户明确接受风险。

## 何时使用

必须使用：

- 完成 M/L 级功能后。
- 每个子任务完成后，如果使用 `subagent-driven-development`。
- 合并到主分支或创建 PR 前。

适合使用：

- 修复复杂 bug 后。
- 重构后。
- 你卡住时需要新视角。

## 资产读取

输入优先级：

1. 用户当前消息中手动引用的需求、计划、回撤清单、进度台账、审查包或 diff 范围。
2. 上一步 `[HANDOFF]` 的 `Next inputs`。
3. 轻量 M 若没有落盘资产，读取对话内需求摘要、涉及文件、`git diff --stat` 和已运行验证证据作为等价输入。
4. 当前 feature 目录的约定文件：
   - `<FEATURE_ROOT>/<feature-id>/status.md`
   - `<FEATURE_ROOT>/<feature-id>/需求说明书.md`
   - `<FEATURE_ROOT>/<feature-id>/初步实现计划.md`
   - `<FEATURE_ROOT>/<feature-id>/requirements-coverage.md`
   - `<FEATURE_ROOT>/<feature-id>/rollback-units.md`
5. 进度和任务报告：
   - `<SDD_PROGRESS>`
   - `<RUNTIME_ROOT>/sdd/reports/*.md`
6. 当前 `git status`、`git diff --stat`、相关 diff 或 commit range。

## 审查输入

准备以下信息：

```text
DESCRIPTION: 本次完成了什么
PLAN_OR_REQUIREMENTS: 需求或计划来源路径
LIGHTWEIGHT_CONTEXT: 轻量 M 可填写对话内需求摘要、边界和不做范围
ROLLBACK_UNITS: 回撤清单路径
BASE_SHA: 改动开始前的提交或 diff checkpoint
HEAD_SHA: 当前提交或当前工作区
VALIDATION: 已运行的验证命令和结果
STATUS: 当前 status.md 路径和状态
```

如果不能取得 SHA，至少提供：

- `git diff --stat`
- 涉及文件列表
- 需求/计划路径
- 轻量 M 的对话内需求摘要和边界
- 回撤单元路径
- 已运行的验证命令和结果

## 审查方式

1. 读取 [code-reviewer.md](code-reviewer.md)。
2. 按模板填入本次任务信息。
3. 发起独立审查；没有子代理时，在当前会话按同一模板审查。
4. 处理反馈：
   - Critical：立即修复。
   - Important：继续前修复，或请用户明确接受风险。
   - Minor：记录，可合并处理。
5. 修复后重新审查受影响范围。

## 输出格式

```markdown
# 代码审查报告

## 结论
- 通过 / 需修改 / 阻塞

## 输入资产
- 需求：
- 计划：
- 回撤清单：
- Diff / commit range：
- 验证证据：

## 严重问题（Critical）
...

## 重要问题（Important）
...

## 次要问题（Minor）
...

## 需求覆盖
...

## 回撤完整性
...

## 验证缺口
...
```

小功能可以只在对话中输出；L 级必须保存到：

```text
<REVIEW_ROOT>/YYYY-MM-DD-<feature-id>-code-review.md
```

保存报告后，同步更新 `<FEATURE_ROOT>/<feature-id>/status.md`。

## 交接规则

无 Critical/Important 阻塞项时，自动进入完成前验证：

```text
[HANDOFF]
Feature ID: <feature-id>
Level: <M|L>
Current gate: code-review
Generated assets:
- <FEATURE_ROOT>/<feature-id>/status.md
- <REVIEW_ROOT>/YYYY-MM-DD-<feature-id>-code-review.md
Next skill: verification-before-completion
Next inputs:
- <FEATURE_ROOT>/<feature-id>/status.md
- <FEATURE_ROOT>/<feature-id>/需求说明书.md
- <FEATURE_ROOT>/<feature-id>/初步实现计划.md
- <FEATURE_ROOT>/<feature-id>/rollback-units.md
- <REVIEW_ROOT>/YYYY-MM-DD-<feature-id>-code-review.md
Auto-continue: yes
[/HANDOFF]
```

存在 Critical/Important 时：

```text
[HANDOFF]
Feature ID: <feature-id>
Level: <M|L>
Current gate: code-review
Generated assets:
- <FEATURE_ROOT>/<feature-id>/status.md
- <REVIEW_ROOT>/YYYY-MM-DD-<feature-id>-code-review.md
Next skill: code-review
Next inputs:
- <REVIEW_ROOT>/YYYY-MM-DD-<feature-id>-code-review.md
Auto-continue: no
Stop reason: Critical/Important review findings need fixes or explicit risk acceptance
[/HANDOFF]
```
