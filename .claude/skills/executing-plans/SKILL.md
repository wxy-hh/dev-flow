---
name: executing-plans
description: 已有书面实现计划，需要按任务执行时使用。用户说 subagent-driven-development、子代理驱动开发、按计划执行、执行实现计划时使用。支持两种模式：当前会话逐任务实现，或为每个任务派发独立实现子代理（子代理驱动开发，适合 M/L 级和可拆分的复杂改动）；先审计划和回撤单元，再实现、验证、补齐 rollback-units 证据和收尾。
---

# 执行实现计划

按书面实现计划执行任务。控制者负责审计、拆分、验证；实现工作按下面两种模式之一进行。

先读取项目适配层。Claude 环境默认读取 `.claude/rules/project-workflow.md`，从中获取 `<SKILL_ROOT>`、`<FEATURE_ROOT>`、`<REVIEW_ROOT>`、`<RUNTIME_ROOT>` 路径。

## Feature-scoped SDD（v0.8）

运行时 SDD 只按 feature 隔离：

```text
.claude/runtime/sdd/<feature-id>/
  checkpoint.json   # sdd-checkpoint 机器状态
  progress.md       # 人类可读进度台账
  task-*-brief.md
  review-*.diff
  reports/
```

- 所有 SDD 读写必须带 `feature-id`（参数或 `DEV_FLOW_FEATURE_ID`）。
- **禁止**读取裸 `.claude/runtime/sdd/` 下的 legacy shared 文件（`task-*.md`、`progress.*`、`review-*.diff`）。
- 进度恢复：`sdd-checkpoint <feature-id> show`；计划变更后 fingerprint 变 stale，需 `refresh-plan` 或重新 `init`。
- finalizer 成功后只删除当前 feature 的 SDD 目录。

路径别名：

| 别名 | 取值 |
|------|------|
| `<SDD_WORKSPACE>` | `.claude/runtime/sdd/<feature-id>/`（`scripts/sdd-workspace <feature-id>`） |
| `<SDD_PROGRESS>` | `<SDD_WORKSPACE>/progress.md`（由 sdd-checkpoint 维护） |

## 选择模式

- **当前会话模式**（本文件）：默认模式，或用户明确要求当前会话内执行时使用。
- **子代理模式**（[references/subagent-mode.md](references/subagent-mode.md)）：已有实现计划、任务相对独立、当前平台支持子代理、改动较复杂需要避免上下文污染时优先使用；任务高度耦合或平台无子代理能力时改回当前会话模式。

两种模式共享本文件的 HUMAN GATE 前置检查、资产读取优先级和交接格式。

## 资产读取

按 `dev-flow/references/protocol.md` 的资产读取优先级；当前 feature 目录的约定文件另见 `需求说明书.md`、`初步实现计划.md`、`requirements-coverage.md`、`rollback-units.md`。无明确 feature 时查找最近修改的 `<FEATURE_ROOT>/*/初步实现计划.md`。

## HUMAN GATE 前置检查

标准 M/L 或任何 L 级计划在写业务代码、或派发实现子代理前，必须读取 `<FEATURE_ROOT>/<feature-id>/status.md` 并确认：

- `dev_flow_status.human_gates.implementation_approval.required` 为 `true`。
- `.status` 为 `confirmed`，或用户本轮明确说"跳过并接受风险"且已写入 `accepted_risks`。
- `plan-review` 已作为实现前门禁完成；实现后的 `code-review` 不能替代它。

缺失确认时立即输出并停止，不修改源码、mock、配置或测试文件，也不派发实现子代理：

```text
[HUMAN GATE:implementation_approval]
实现前确认尚未完成。请确认是否按当前计划、回撤边界、风险接受情况开始实现。
[/HUMAN GATE]
```

`[HANDOFF]` 格式见 `dev-flow/references/protocol.md`；`Current gate: executing-plans`，`Next skill: executing-plans`，`Auto-continue: no`。

## 当前会话模式：按任务执行

前置：读取计划、需求、覆盖矩阵、计划审查报告和回撤单元清单；检查计划是否自相矛盾、缺少验证或任务过大；标准 M/L 计划缺少回撤单元时先补齐或报告阻塞；存在未处理的 CRITICAL/HIGH 计划审查阻塞项时先停下。

初始化 / 恢复 checkpoint：

```bash
scripts/sdd-checkpoint <feature-id> init --plan <PLAN_FILE>
scripts/sdd-checkpoint <feature-id> show
scripts/sdd-checkpoint <feature-id> check-plan   # stale 时 exit 3
```

已完成任务从 `done-list` 读取，不重复执行；计划 fingerprint stale 时先 `refresh-plan` 再继续。

调度：用 `scripts/task-schedule <plan> --feature <feature-id> [--json]`（或显式 `--done …`）根据 `Depends on` 与 `Writes` 计算可并行任务；重叠 Writes 串行，缺少 Writes 不得派发。Phase 0（Task 0 / 冻结共享类型与接口）由 integrator 独占，项目 typecheck 通过后再派发叶子任务。每批结束后运行适配层定义的集成检查。

每个任务：

1. `sdd-checkpoint <feature-id> mark-progress <N>`；记录任务开始前的 git 基线 SHA，不提交时准备 `<FEATURE_ROOT>/<feature-id>/patches/task-N.patch`。
2. 按计划步骤实现，运行计划指定验证。
3. 补齐该任务回撤单元：涉及文件、产出物、被依赖关系、commit/diff/patch 范围、回撤顺序和回撤后验证。
4. `sdd-checkpoint <feature-id> mark-done <N> [--base SHA] [--head SHA]`；用 `dev-flow-status` 更新 `status.md`（勿手改机器字段）。
5. `review-package <BASE> <HEAD> --feature <feature-id>` 必须包含 staged、unstaged 与 untracked 的完整审查输入。

不为了补齐回撤单元自动提交：用户允许任务级 commit 时记录 commit；不希望提交时记录基线 SHA + `git diff --binary` patch + 未跟踪文件清单/备份 + 删除重命名二进制文件说明。

所有任务完成后：确认没有 `pending` 的关键回撤信息，缺失时运行或建议 `rollback-units` 审计模式；汇总已完成任务、验证结果、回撤证据位置；更新 `status.md`；输出 `[HANDOFF]` 给 `rollback-units` 审计（full）或 `code-review`（light/none）。

## 何时停止

计划指令不清、缺少依赖或关键文件、验证反复失败、实现中发现计划与需求冲突、任务无法形成最小回撤单元、继续会扩大风险、plan fingerprint stale 且未 refresh 时立即停下，给出已完成内容、阻塞点、推荐下一步，并输出 `Auto-continue: no`。

## 关联技能

- `writing-plans`：生成本技能要执行的计划。
- `rollback-units`：实现前定义回撤边界，任务后补齐真实回撤证据。
- [references/subagent-mode.md](references/subagent-mode.md)：子代理驱动开发模式的完整编排。
- `code-review`：所有任务完成后的整体验收。
- `verification-before-completion`：代码审查通过后的证据门禁。
