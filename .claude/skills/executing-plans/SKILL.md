---
name: executing-plans
description: 已有书面实现计划，需要在当前会话或无子代理环境中按任务执行时使用。先审计划和回撤单元，再逐项实现、验证、补齐 rollback-units 证据和收尾。
---

# 执行实现计划

按书面实现计划执行任务。优先使用 `subagent-driven-development`；如果当前环境没有可用子代理，或用户明确要求当前会话内执行，则使用本技能。

先读取项目适配层。Claude 环境默认读取 `.claude/rules/project-workflow.md`，从中获取 `<FEATURE_ROOT>`、`<REVIEW_ROOT>`、`<SDD_PROGRESS>` 和 context manifest 路径；写文件前再展开为真实路径。

开场说明：

```text
正在使用 executing-plans 按计划执行。
```

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

## HUMAN GATE 前置检查

标准 M/L 或任何 L 级计划在写业务代码前，必须读取 `<FEATURE_ROOT>/<feature-id>/status.md` 并确认：

- `dev_flow_status.human_gates.implementation_approval.required` 为 `true`。
- `dev_flow_status.human_gates.implementation_approval.status` 为 `confirmed`，或用户本轮明确说“跳过并接受风险”且已写入 `accepted_risks`。
- `plan-review` 已作为实现前门禁完成；实现后的 `code-review` 不能替代它。

如果缺失确认，立即输出以下内容并停止；不要修改源码、mock、配置或测试文件：

```text
[HUMAN GATE:implementation_approval]
实现前确认尚未完成。请确认是否按当前计划、回撤边界、风险接受情况开始实现。
[/HUMAN GATE]

[HANDOFF]
Feature ID: <feature-id>
Level: <M|L>
Current gate: executing-plans
Generated assets:
- <FEATURE_ROOT>/<feature-id>/status.md
Next skill: executing-plans
Next inputs:
- <FEATURE_ROOT>/<feature-id>/status.md
- <FEATURE_ROOT>/<feature-id>/初步实现计划.md
Auto-continue: no
Stop reason: human implementation approval required before writing code
[/HANDOFF]
```

## 流程

### 1. 读取并审计划

1. 读取计划、需求、覆盖矩阵和回撤清单。
2. 检查计划是否存在矛盾、缺少文件路径、缺少验证、任务过大或回撤边界不清。
3. 如果计划要求标准 M/L 门禁但没有 `rollback-units`，先使用或建议使用 `rollback-units` 补齐，不要硬做。
4. 如果存在 CRITICAL/HIGH 计划审查阻塞项且未处理，先停下。
5. 如果计划可执行，建立任务清单并继续。

### 2. 按任务执行

每个任务：

1. 标记为进行中。
2. 记录任务开始前的 git 基线 SHA；如不提交，准备 `<FEATURE_ROOT>/<feature-id>/patches/task-N.patch`。
3. 按计划步骤实现。
4. 运行计划指定验证。
5. 补齐该任务的回撤单元：涉及文件、产出物、被依赖关系、commit/diff/patch 范围、回撤顺序和回撤后验证。
6. 记录结果到进度台账 `<SDD_PROGRESS>`。
7. 更新 `<FEATURE_ROOT>/<feature-id>/status.md` 和 `dev_flow_status`；如果 context manifest 已存在，把任务报告或回撤证据追加到 `context/review.jsonl`。
8. 标记完成。

不要为了补齐回撤单元而自动提交。用户允许任务级 commit 时记录 commit；用户不希望提交时记录落盘 patch 策略：

- 基线 SHA：`git rev-parse HEAD`
- 已跟踪文件：`git diff --binary > <FEATURE_ROOT>/<feature-id>/patches/task-N.patch`
- 未跟踪文件：记录清单，必要时复制到 `<FEATURE_ROOT>/<feature-id>/patches/task-N-untracked/`
- 删除、重命名、二进制文件：说明是否已被 `--binary` 覆盖

### 3. 完成实现

所有任务完成后：

1. 确认没有 `pending` 的关键回撤信息。
2. 如果仍有缺失，运行或建议 `rollback-units` 审计模式补齐。
3. 汇总已完成任务、验证结果、回撤证据位置。
4. 更新 `status.md` 和 `dev_flow_status`。
5. 输出 `[HANDOFF]` 给 `rollback-units` 审计（full）或 `code-review`（light/none）。

## 何时停止

遇到以下情况立即停下：

- 计划指令不清。
- 缺少依赖或关键文件。
- 验证反复失败。
- 实现中发现计划与需求冲突。
- 实现中发现任务无法按原计划形成最小回撤单元。
- 继续执行会扩大风险。

停止时给出：已完成内容、阻塞点、推荐下一步，并输出 `Auto-continue: no` 的 `[HANDOFF]`。

## 交接格式

完成后：

```text
[HANDOFF]
Feature ID: <feature-id>
Level: <M|L>
Current gate: executing-plans
Generated assets:
- <SDD_PROGRESS>
- <FEATURE_ROOT>/<feature-id>/rollback-units.md
Next skill: rollback-units audit 或 code-review
Next inputs:
- <FEATURE_ROOT>/<feature-id>/需求说明书.md
- <FEATURE_ROOT>/<feature-id>/初步实现计划.md
- <FEATURE_ROOT>/<feature-id>/rollback-units.md
- <SDD_PROGRESS>
- <FEATURE_ROOT>/<feature-id>/context/review.jsonl
Auto-continue: yes
[/HANDOFF]
```

## 关联技能

- `writing-plans`：生成本技能要执行的计划。
- `rollback-units`：实现前定义回撤边界，任务后补齐真实回撤证据。
- `subagent-driven-development`：有子代理时优先用它。
- `code-review`：所有任务完成后的整体验收。
- `verification-before-completion`：代码审查通过后的证据门禁。
