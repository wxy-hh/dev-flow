---
name: rollback-units
description: 为实现计划或已完成改动生成、审计和补齐最小回撤单元。dev-flow 在标准 M/L 实现前定义回撤边界、执行后补齐 commit 或 diff 信息时使用；用户说"回撤单元""只做回撤单元设计""补回撤清单""检查能不能按任务回退""rollback units"时使用。
---

# 最小回撤单元

用这个技能让每个计划任务都能被未来按边界回退。默认只设计或审计回撤方案；除非用户明确要求并确认，不执行真实回滚。

先读取项目适配层。Claude 环境默认读取 `.claude/rules/project-workflow.md`，从中获取 `<FEATURE_ROOT>`、`<REVIEW_ROOT>`、`<SDD_PROGRESS>` 路径。

## 核心规则

- 不默认提交代码，不默认回滚代码。
- 不用 `git reset --hard`、`git checkout --` 等破坏性命令，除非用户明确要求该操作。
- 优先用任务级 commit 作为回撤边界；用户不希望提交时，记录落盘 patch 文件或清晰 patch 策略。
- 回撤单元必须包含回撤后验证，不允许只写"删掉代码"。
- 发现任务依赖不清时，先报告阻塞，不猜测回撤顺序。
- L 级最终产物里不允许保留未解释的 `pending`。
- 不预写完整实现；清单只写边界、顺序、验证与风险。
- **severity 识别属于本 skill**：无法形成单一回撤边界、缺回撤顺序、共享接口无回撤后验证等阻塞态由本 skill 判定；CLI 不扫描自然语言、不自动 promote。light 执行中一旦产生 CRITICAL/HIGH，必须先调用 `dev-flow-status promote-gate rollback_units --to full --reason <text>`，再落盘 full 报告；即使随后修复，也保留 full 证据与 disposition。

## 资产读取

按 `dev-flow/references/protocol.md` 的资产读取优先级；本技能额外读取相关审查报告（`<REVIEW_ROOT>/YYYY-MM-DD-<feature-id>-plan-review.md`/`-code-review.md`）；执行后审计时读取当前 `git status`、相关 diff、commit range、任务报告和进度台账。

## 模式

### 设计模式

在实现前使用。输入是需求、实现计划、需求覆盖矩阵、计划审查结论和已知代码范围。输出每个任务的预期回撤边界。`full` 必须保存到 `<FEATURE_ROOT>/<feature-id>/rollback-units.md`；`light` 可把摘要写入 `status.md` 或计划内嵌 heading，不创建空报告，并写 `gate_evidence.rollback_units`（`path` + 唯一 `heading`）。

### 审计模式

在任务执行后或代码已经写完后使用。输入是实现计划、已有回撤清单、git diff/commit、实现报告、任务审查报告和验证结果。输出补齐后的真实回撤清单，把 `Commit / Diff range` 从 `pending` 补成 commit、range、diff 文件或等价 patch 策略。

无 commit 前提下的 patch 策略：

1. 记录基线 SHA：`git rev-parse HEAD`。
2. 保存已跟踪文件 diff：`git diff --binary > <FEATURE_ROOT>/<feature-id>/patches/task-N.patch`。
3. 记录未跟踪文件清单；必要时把新增文件复制到 `<FEATURE_ROOT>/<feature-id>/patches/task-N-untracked/`。
4. 明确删除、重命名和二进制文件是否已被 `--binary` 覆盖。
5. 在 `rollback-units.md` 的 `Commit / Diff range` 字段写 patch 文件路径、基线 SHA 和未跟踪文件保存策略。

### 回撤模式

用户明确要求回退某个任务时使用。先输出回撤方案、影响范围和验证命令，等待用户确认后再执行修改。不要把"生成回撤方案"和"执行回撤"合并成一步。

## 回撤单元模板

```markdown
### Task <id> Rollback Unit
- Purpose:
- Requirement IDs:
- Files:
- Produces:
- Consumed by:
- Commit / Diff range:
- Revert order:
- Revert command or patch strategy:
- Post-revert verification:
- Risks:
```

字段要求：`Files` 列主要文件或文件组，不要只写"相关文件"；`Produces`/`Consumed by` 写清接口、组件、状态、路由、配置或数据结构及其依赖方；`Commit / Diff range` 实现前可写 `pending`，实现后必须补为 commit、range、diff 文件或等价描述；`Revert command or patch strategy` 写明无 commit 时如何应用或反向应用 patch；`Revert order` 有依赖时必须写顺序；`Post-revert verification` 写具体命令或人工检查点。

## 阻塞条件（CRITICAL/HIGH）

- 一个任务横跨多个不相关功能，无法形成单一回撤边界。
- 后续任务依赖当前任务，但没有回撤顺序。
- 修改共享接口、状态、权限、路由、数据结构，却没有回撤后验证。
- L 级任务执行后没有 commit、diff 范围或等价回撤策略，或最终清单仍有未解释的 `pending`。
- 无 commit 的 L 级任务只有口头 diff 描述，没有落盘 patch、基线 SHA 或未跟踪文件策略。
- 用户要求回撤，但当前工作区有不相关未提交改动且会被影响。

## 输出和交接

输出顺序：模式（设计/审计/回撤）、一句话结论（可回撤/需要补边界/当前不能安全回撤）、阻塞项和风险、回撤单元清单或报告路径、下一步建议、`[HANDOFF]`。

输出任何落盘报告后，同步更新 `status.md` 和 `dev_flow_status`，把 `rollback-units.md` 追加到 `assets`（`kind: "review"`），用 `complete-gate rollback-units --evidence-file ...`（或 light 的 `gate_evidence`）登记。

设计模式通过后停在实现前，先输出 `[HUMAN GATE:implementation_approval]`（"回撤单元已准备好。请确认是否按当前计划、回撤边界和风险接受情况开始实现。"），再按 `dev-flow/references/protocol.md` 输出 `[HANDOFF]`：`Current gate: rollback-units`，`Next skill: executing-plans`，`Auto-continue: no`。标准 M/L 必须保持 `human_gates.implementation_approval.required: true`，用户确认前保持 `status: pending`。

审计模式通过后进入代码审查；审计模式是实现后 `code-review` 前的强制闭环，不得只在报告里建议"稍后补齐"。`Current gate: rollback-units-audit`，`Next skill: code-review`，`Auto-continue: yes`。有 CRITICAL/HIGH：`Next skill: rollback-units`，`Auto-continue: no`，`Stop reason` 写明需要补边界或用户接受风险。
