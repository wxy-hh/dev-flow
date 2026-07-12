# 交接协议：HUMAN GATE / HANDOFF / 恢复 / status.md 契约

被 dev-flow `SKILL.md` 引用；只在需要交接细节、恢复中断流程或更新 `status.md` 时读取。

## HUMAN GATE 硬协议

所有需要用户确认的停顿点使用同一格式：

```text
[HUMAN GATE:<requirement_confirmation|implementation_approval>]
请确认 <需要确认的边界、计划或风险>。
确认后我会进入 <next step>。
[/HUMAN GATE]
```

规则：

- 一旦输出 `[HUMAN GATE:<gate-id>]` 或 `[HANDOFF]` 中 `Auto-continue: no`，当前回合必须停止；不得继续写计划、执行代码、运行后续门禁，或在同一回合把 `auto_continue: false` 改成 `true`。
- `implementation_approval` 确认前，实现任务列表、Todo 或子任务执行计划只能停留在"已列出"状态，不得标记为进行中或已完成——这是"没确认就直接改代码"的常见绕过方式。
- 只有用户后续明确回复"确认""继续""接受风险"或"跳过并接受风险"后，才能把 `human_gates.<gate-id>.status` 写为 `confirmed` 或 `skipped`，并把用户原话或接受风险理由写入 `evidence`。
- 标准 M/L 的 `requirement_confirmation` 和 `implementation_approval` 都是必需 gate；轻量 L 和 risk-minimal 只需 `implementation_approval`。同一条用户回复可以同时作为两个 gate 的证据，但必须明确覆盖两者。
- `plan-review` 是实现前计划审查，不能由实现后的 `code-review` 替代；`code-review` 只审查已写代码，不能倒填为计划门禁通过。

## 半自动门禁模式

标准 M/L 默认自动读取上一步产物、按风险维度自动推进已触发且无副作用的检查门禁，在关键决策点停下确认。

自动继续的场景：

- `writing-plans` 完成后按 `[HANDOFF]` 的 `Next skill` 继续；标准 L 默认下一跳 `requirements-coverage`。
- 需求覆盖无阻塞缺口时，至少继续到 `plan-review`。
- `plan-review` 无 CRITICAL/HIGH 时可自动进入实现前的回撤/安全检查；下一步要写业务代码前必须停在 `implementation_approval`。
- `rollback-units` 触发 `full` 时设计完成后停在实现前；`light` 时把证据写入 `status.md`。
- `rollback_units: full` 时实现完成后先审计再 `code-review`；无 Critical/Important 阻塞项时进入验证。

必须停下询问的场景：

- 任意 `[HUMAN GATE:<gate-id>]` 已输出，或上一段 `[HANDOFF]` 写了 `Auto-continue: no`。
- 需求边界固化后、进入 `writing-plans` 前；计划与实现前门禁完成后、写业务代码前。
- `requirements-coverage` 出现 `MISSING`/`CONFLICT`/`OUT_OF_SCOPE`，或 L 级出现未接受的 `PARTIAL`/`UNVERIFIABLE`。
- `plan-review` 出现 CRITICAL/HIGH；安全审查发现高风险残留；验证失败需要选择修复范围或接受风险。
- 需要提交、回滚、合并、推送、创建 PR、删除文件或其他改变分支状态的动作；中途重分级、跳过已触发门禁或接受高风险残留。

用户可覆盖默认衔接，例如"全自动继续到实现前""每一步都问我""只跑到 plan-review 停下""手动引用这些文件作为输入：..."。

## 资产读取优先级（恢复中断流程）

1. `<FEATURE_ROOT>/<feature-id>/status.md`：存在时先读 `dev_flow_status` frontmatter。
2. `status.md` 的 `assets` 列表：按 `kind` 定位需求、计划、研究、审查、验证、规范资产。
3. 上一段对话中的 `[HANDOFF]` 块，仅作最近一次交接的辅助线索。
4. 都没有时，按项目适配层的标准资产路径模板查找最近产物。

不要重跑已完成且仍然可信的步骤；`status.md` 不存在时才视为全新任务。

## [HANDOFF] 格式与路由表

```text
[HANDOFF]
Feature ID: <feature-id>
Level: <XS|S|M|L>
Current gate: <gate-name>
Generated assets:
- <path>
Next skill: <skill-name>
Next inputs:
- <path>
Auto-continue: yes/no
Stop reason: <only when Auto-continue is no>
[/HANDOFF]
```

| 阶段 | 默认产物 | 下一步 |
|------|----------|--------|
| `req-probe`/`openspec` | 需求说明书或 `openspec/changes/<change-id>/` | 输出 `[HUMAN GATE:requirement_confirmation]` 并停止 |
| `grillme` | 需求/设计压测结论 | 用户确认后进入 `writing-plans` |
| `writing-plans` | 初步实现计划、`status.md` | 自动进入已触发的 `requirements-coverage` |
| `requirements-coverage` | 覆盖矩阵或 `status.md` 轻量结论 | 标准 M/L 通过后至少进入 `plan-review` |
| `plan-review` | 计划审查报告或轻量结论 | 无 CRITICAL/HIGH 后进入实现前门禁；写代码前必须 `[HUMAN GATE:implementation_approval]` |
| `security-reviewer` | 安全审查报告或轻量结论 | 高风险残留需停下确认 |
| `rollback-units`（实现前） | 回撤单元设计 | `full` 时停下询问是否开始实现 |
| `executing-plans` | 任务报告、回撤证据 | 仅在 `implementation_approval.status` 为 `confirmed`（或用户明确跳过并接受风险）后执行 |
| `rollback-units`（审计） | 补齐提交/diff/patch 证据 | 无未解释 `pending` 后进入 `code-review` |
| `code-review` | 代码审查报告 | 无阻塞后进入 `verification-before-completion` |
| `verification-before-completion` | 验证报告，必要时 manual-test | 停下询问分支收尾方式 |
| `finishing-a-development-branch` | 分支收尾动作和最终验证结论 | 按用户选择合并/推送/保留/丢弃 |

`<feature-id>` 按项目适配层命名，默认 `YYYY-MM-DD-<short-kebab-name>`；已有产物或 OpenSpec change id 已明确时沿用。

## status.md v3 更新契约

- `schema_version` 固定 `"3"`；字段取值见 contract.json 的 `asset_kinds`/`risk_labels`/`risk_gates`/`classification_topologies`/`classification_evidence_results`。
- 保留已有 `completed_gates`，只追加新完成 gate，不删除历史。
- `assets` 只追加已存在或本次明确生成的路径，每项 `{path, kind}`，`kind` 取值见 contract.json `asset_kinds`。
- 每次更新设置 `current_gate`、`next_action`、`auto_continue`。
- 验证门禁完成后记录 `validation.last_at` 和 `validation.commands`；`business_diff_fingerprint` 用 `dev-flow-fingerprint` 脚本重新计算并写入。
- 携带风险标签时，`risk_evidence` 每个标签一项（`mode`/`conclusion`/`verification`/`report`），对应最低 gate 升为 `full` 时必须用 `report` 模式。
- `risk-minimal` 只适用于带风险标签且 `risk_labels` 非空的 XS/S；带风险标签的 M/L 用 `profile: "standard"`。
- 只有用户明确确认、继续、接受风险或跳过并接受风险，才能把 `human_gates.<gate>.status` 写为 `confirmed`/`skipped`，理由写入 `evidence`。

## completion.md frontmatter

```yaml
---
dev_flow_completion:
  schema_version: "1"
  feature_id: "<feature-id>"
  level: "<XS|S|M|L>"
  outcome: "verified|partial"
  completed_at: "<ISO 8601>"
  retention: "compact|full"
  risk_labels: []
  risk_approval_evidence: ""
  risk_verification_summary: ""
  business_diff_fingerprint: "<git-hash>"
  commits: []
  pull_request: "none"
  accepted_risks: []
---
```

`risk_labels` 非空时，`risk_approval_evidence` 和 `risk_verification_summary` 必填。
