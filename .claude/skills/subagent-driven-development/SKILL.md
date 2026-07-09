---
name: subagent-driven-development
description: 有书面实现计划且任务可拆分时使用。为每个任务派发独立实现子代理，任务后审查并补齐 rollback-units 回撤证据，最后做整体验收；适合 M/L 级功能和复杂改动。
---

# 子代理驱动开发

用“一个任务一个新上下文”的方式执行实现计划。控制者负责拆分、派发、审查和验证；实现子代理只负责当前任务。

先读取项目适配层。Claude 环境默认读取 `.claude/rules/project-workflow.md`，从中获取 `<SKILL_ROOT>`、`<FEATURE_ROOT>`、`<REVIEW_ROOT>`、`<SDD_PROGRESS>` 和 context manifest 路径；执行脚本或写文件前再展开为真实路径。

核心原则：

```text
新子代理实现单任务 -> 补齐任务回撤证据 -> 任务级审查 -> 必要时修复 -> 整体 code-review -> 完成前验证。
```

## 适用条件

使用本技能：

- 已有实现计划。
- 计划任务相对独立。
- 当前平台支持子代理。
- 改动较复杂，需要避免上下文污染。

不适用：

- 没有实现计划，先用 `writing-plans`。
- 标准 M/L 或任何 L 级任务尚未获得 `implementation_approval`，先停在 HUMAN GATE。
- 任务高度耦合，适合当前会话连续实现。
- 平台没有子代理能力，改用 `executing-plans`。

## 资产读取

输入优先级：

1. 用户当前消息中手动引用的计划、需求、覆盖矩阵、回撤清单或审查报告。
2. 上一步 `[HANDOFF]` 的 `Next inputs`。
3. `<FEATURE_ROOT>/<feature-id>/context/implement.jsonl` 中登记的上下文文件。
4. 当前 feature 目录的约定文件：
   - `<FEATURE_ROOT>/<feature-id>/需求说明书.md`
   - `<FEATURE_ROOT>/<feature-id>/初步实现计划.md`
   - `<FEATURE_ROOT>/<feature-id>/requirements-coverage.md`
   - `<FEATURE_ROOT>/<feature-id>/rollback-units.md`
5. 无明确 feature 时，查找最近修改的 `<FEATURE_ROOT>/*/初步实现计划.md`。

## 前置检查

执行前：

1. 读取计划、需求、覆盖矩阵、计划审查报告和 rollback unit 清单。
2. 读取 `<FEATURE_ROOT>/<feature-id>/status.md`，确认 `dev_flow_status.human_gates.implementation_approval.status` 为 `confirmed`，或用户本轮明确说“跳过并接受风险”且已写入 `accepted_risks`。
3. 确认 `plan-review` 已作为实现前门禁完成；实现后的 `code-review` 不能替代它。
4. 记录全局约束。
5. 检查计划是否自相矛盾、缺少验证或任务过大。
6. 标准 M/L 计划缺少回撤单元时，先补齐或报告阻塞。
7. 如果存在 CRITICAL/HIGH 计划审查阻塞项且未处理，先停下。
8. 检查 `<SDD_PROGRESS>`；已完成任务不要重复派发。

如果缺失实现前确认，立即输出以下内容并停止；不要派发实现子代理：

```text
[HUMAN GATE:implementation_approval]
实现前确认尚未完成。请确认是否按当前计划、回撤边界、风险接受情况开始实现。
[/HUMAN GATE]

[HANDOFF]
Feature ID: <feature-id>
Level: <M|L>
Current gate: subagent-driven-development
Generated assets:
- <FEATURE_ROOT>/<feature-id>/status.md
Next skill: subagent-driven-development
Next inputs:
- <FEATURE_ROOT>/<feature-id>/status.md
- <FEATURE_ROOT>/<feature-id>/初步实现计划.md
Auto-continue: no
Stop reason: human implementation approval required before dispatching implementation agents
[/HANDOFF]
```

## 每个任务的流程

### 1. 生成任务简报

使用脚本：

```bash
<SKILL_ROOT>/subagent-driven-development/scripts/task-brief <PLAN_FILE> <TASK_NUMBER>
```

把输出路径作为任务需求唯一来源。不要把整份计划复制进子代理 prompt。

### 2. 派发实现子代理

实现子代理输入：

- 任务简报路径。
- 当前任务的 rollback unit 或需要补齐的回撤字段。
- 需求编号和覆盖矩阵中对应行。
- 必要的接口/上下文补充。
- 报告文件路径。
- 要求它写代码、运行覆盖验证、提交或报告 diff，并在报告中写明回撤边界。

实现子代理返回状态：

- `DONE`：任务完成。
- `DONE_WITH_CONCERNS`：完成但有疑虑。
- `NEEDS_CONTEXT`：缺上下文。
- `BLOCKED`：无法完成。

### 3. 处理实现状态

- `DONE`：进入审查。
- `DONE_WITH_CONCERNS`：先阅读疑虑，若影响正确性则处理。
- `NEEDS_CONTEXT`：补上下文后重新派发。
- `BLOCKED`：判断是上下文不足、模型能力不足、任务过大还是计划错误；必要时请用户决定。

### 4. 生成审查包

记录任务开始前的 `BASE` 和完成后的 `HEAD`。这两个值同时用于审查包和当前任务的回撤证据。用户不允许任务级 commit 时，改为记录基线 SHA 和落盘 patch 策略。使用：

```bash
<SKILL_ROOT>/subagent-driven-development/scripts/review-package <BASE> <HEAD>
```

不要用 `HEAD~1` 代替 `BASE`，否则多提交任务会丢 diff。

### 5. 派发任务审查

审查输入：

- 任务简报文件。
- 实现报告文件。
- 审查包 diff 文件。
- 计划的全局约束。
- 当前任务的 rollback unit。

审查模板：`task-reviewer-prompt.md`。

审查结果：

- 严重/重要问题（Critical / Important）：派发修复并复审。
- 次要问题（Minor）：记录到进度台账，最终统一处理。
- “无法从 diff 验证”：控制者亲自确认。

### 6. 更新台账和回撤证据

任务审查通过后：

1. 把任务状态追加到 `<SDD_PROGRESS>`。
2. 把 `BASE..HEAD`、diff 文件或等价 patch 策略写回 `<FEATURE_ROOT>/<feature-id>/rollback-units.md`。
3. 无 commit 时至少保存：
   - 基线 SHA：`git rev-parse HEAD`
   - 已跟踪文件 patch：`git diff --binary > <FEATURE_ROOT>/<feature-id>/patches/task-N.patch`
   - 未跟踪文件清单和必要的 `task-N-untracked/` 备份
   - 删除、重命名、二进制文件覆盖说明
4. 更新 `<FEATURE_ROOT>/<feature-id>/status.md` 和 `dev_flow_status`。
5. 记录任务报告路径。
6. 如果 context manifest 已存在，把任务报告、审查包或回撤证据追加到 `context/review.jsonl`。

台账条目示例：

```text
任务 N：完成（commits <base7>..<head7>，rollback unit 已补齐，审查通过，report: <path>）
```

## 最终审查

所有任务完成后：

1. 检查所有任务的 rollback unit 都已从 `pending` 补成 commit、diff 范围或落盘 patch 策略。
2. 如果仍有缺失，先运行 `rollback-units` 审计模式。
3. 用 `requesting-code-review` 或 `code-review` 做整体验收。
4. 严重/重要问题（Critical / Important）必须修复，或由用户明确接受风险。
5. 使用 `verification-before-completion` 运行最终验证。

## 输出和交接

任务全部完成且回撤证据补齐后输出：

```text
[HANDOFF]
Feature ID: <feature-id>
Level: <M|L>
Current gate: subagent-driven-development
Generated assets:
- <SDD_PROGRESS>
- <FEATURE_ROOT>/<feature-id>/rollback-units.md
Next skill: code-review
Next inputs:
- <FEATURE_ROOT>/<feature-id>/需求说明书.md
- <FEATURE_ROOT>/<feature-id>/初步实现计划.md
- <FEATURE_ROOT>/<feature-id>/rollback-units.md
- <SDD_PROGRESS>
- <FEATURE_ROOT>/<feature-id>/context/review.jsonl
Auto-continue: yes
[/HANDOFF]
```

遇到阻塞时输出 `Auto-continue: no`，并写清已完成任务、阻塞任务和推荐下一步。

## 文件交接原则

能用文件交接就不要粘贴大段文本：

- 任务简报：`task-brief` 生成。
- 实现报告：实现子代理写入。
- 审查包：`review-package` 生成。
- 进度台账：`<SDD_PROGRESS>`。
- 回撤证据：写回 rollback unit 清单或在进度台账中记录对应位置。

这样可以降低上下文占用，也方便从压缩或中断后恢复。

## 关联资源

- [implementer-prompt.md](implementer-prompt.md)
- [task-reviewer-prompt.md](task-reviewer-prompt.md)
- [../requesting-code-review/code-reviewer.md](../requesting-code-review/code-reviewer.md)
