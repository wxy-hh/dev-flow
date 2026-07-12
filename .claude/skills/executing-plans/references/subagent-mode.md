# 子代理模式：子代理驱动开发

用"一个任务一个新上下文"的方式执行实现计划。控制者负责拆分、派发、审查和验证；实现子代理只负责当前任务。前置检查、资产读取优先级和 HUMAN GATE 见 [../SKILL.md](../SKILL.md)。

```text
新子代理实现单任务 -> 补齐任务回撤证据 -> 任务级审查 -> 必要时修复 -> 整体 code-review -> 完成前验证。
```

## 每个任务的流程

### 0. 调度可并行任务

```bash
<SKILL_ROOT>/executing-plans/scripts/task-schedule <PLAN_FILE> --done <completed-ids> --json
```

只派发 `ready` 列表中的任务；`Writes` 重叠或缺少 `Writes` 的任务不得并行。Phase 0 独占，集成检查通过后再派叶子任务。命令名是 `task-schedule`，不要使用已废弃的 `sdd-schedule`。

### 1. 生成任务简报

```bash
<SKILL_ROOT>/executing-plans/scripts/task-brief <PLAN_FILE> <TASK_NUMBER>
```

把输出路径作为任务需求唯一来源。不要把整份计划复制进子代理 prompt。

### 2. 派发实现子代理

实现子代理输入：任务简报路径、当前任务的 rollback unit 或需要补齐的回撤字段、需求编号和覆盖矩阵中对应行、必要的接口/上下文补充、报告文件路径；要求写代码、运行覆盖验证、提交或报告 diff，并在报告中写明回撤边界。模板：[../implementer-prompt.md](../implementer-prompt.md)。

实现子代理返回状态之一：`DONE` / `DONE_WITH_CONCERNS` / `NEEDS_CONTEXT` / `BLOCKED`。

### 3. 处理实现状态

- `DONE`：进入审查。
- `DONE_WITH_CONCERNS`：先阅读疑虑，若影响正确性则处理。
- `NEEDS_CONTEXT`：补上下文后重新派发。
- `BLOCKED`：判断是上下文不足、模型能力不足、任务过大还是计划错误；必要时请用户决定。

### 4. 生成审查包

记录任务开始前的 `BASE` 和完成后的 `HEAD`（同时用于审查包和当前任务的回撤证据）。用户不允许任务级 commit 时，改为记录基线 SHA 和落盘 patch 策略。

```bash
<SKILL_ROOT>/executing-plans/scripts/review-package <BASE> <HEAD>
```

不要用 `HEAD~1` 代替 `BASE`，否则多提交任务会丢 diff。

### 5. 派发任务审查

审查输入：任务简报文件、实现报告文件、审查包 diff 文件、计划的全局约束、当前任务的 rollback unit。审查模板：[../task-reviewer-prompt.md](../task-reviewer-prompt.md)。

审查结果：严重/重要问题（Critical / Important）派发修复并复审；次要问题（Minor）记录到进度台账，最终统一处理；"无法从 diff 验证"控制者亲自确认。

### 6. 更新台账和回撤证据

任务审查通过后：

1. 把任务状态追加到 `<SDD_PROGRESS>`。
2. 把 `BASE..HEAD`、diff 文件或等价 patch 策略写回 `<FEATURE_ROOT>/<feature-id>/rollback-units.md`。
3. 无 commit 时至少保存：基线 SHA（`git rev-parse HEAD`）、已跟踪文件 patch（`git diff --binary > <FEATURE_ROOT>/<feature-id>/patches/task-N.patch`）、未跟踪文件清单和必要的 `task-N-untracked/` 备份、删除/重命名/二进制文件覆盖说明。
4. 更新 `<FEATURE_ROOT>/<feature-id>/status.md` 和 `dev_flow_status`；把任务报告路径追加到 `assets`（`kind: "review"`）。

台账条目示例：`任务 N：完成（commits <base7>..<head7>，rollback unit 已补齐，审查通过，report: <path>）`

## 最终审查

所有任务完成后：

1. 检查所有任务的 rollback unit 都已从 `pending` 补成 commit、diff 范围或落盘 patch 策略。
2. 回撤门禁触发或仍有缺失时，先运行 `rollback-units` 审计模式，确认真实 diff/patch/commit 证据完整。
3. 用 `code-review` 做整体验收；Critical/Important 必须修复，或由用户明确接受风险。
4. 用 `verification-before-completion` 运行最终验证，并执行 `dev-flow-feature-check <feature-id> --finish`。

## 输出和交接

任务全部完成且回撤证据补齐后，按 `dev-flow/references/protocol.md` 的 `[HANDOFF]` 格式输出：`Current gate: executing-plans`，`Next skill: rollback-units 审计 或 code-review`，`Auto-continue: yes`。遇到阻塞时 `Auto-continue: no`，写清已完成任务、阻塞任务和推荐下一步。

## 文件交接原则

能用文件交接就不要粘贴大段文本：任务简报（`task-brief` 生成）、实现报告（实现子代理写入）、审查包（`review-package` 生成）、进度台账（`<SDD_PROGRESS>`）、回撤证据（写回 rollback unit 清单）。降低上下文占用，也方便从压缩或中断后恢复。

## 关联资源

- [../implementer-prompt.md](../implementer-prompt.md)
- [../task-reviewer-prompt.md](../task-reviewer-prompt.md)
- [../../code-review/references/code-reviewer.md](../../code-review/references/code-reviewer.md)
