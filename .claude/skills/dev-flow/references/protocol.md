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
- 已输出 HUMAN GATE 时，只有用户后续明确回复“确认”“继续”或“接受风险并继续”，才能把 `human_gates.<gate-id>.status` 写为 `confirmed`。尚未输出需求确认门禁、但用户当前消息已明确指定某份需求为确认基线且无未决问题时，可按下方“外部已确认需求”规则直接登记；两种情况都必须保存用户原话或接受风险理由作为 `evidence`。
- 标准 M/L 的 `requirement_confirmation` 和 `implementation_approval` 都是必需 gate（`required: true`）。
- 轻量 L 和 risk-minimal 只需 `implementation_approval`（`required: true`）；`requirement_confirmation.required` 必须为 `false`。完成检查按声明的 `required` 字段区分轻量/标准，不再仅凭 `level: L` 强制两门。
- 标准 M/L 的两个 HUMAN GATE 发生在计划前后不同阶段，不能复用同一条回复；implementation approval 必须基于已完成的计划与实现前审查另行确认。
- `plan-review` 是实现前计划审查，不能由实现后的 `code-review` 替代；`code-review` 只审查已写代码，不能倒填为计划门禁通过。

## 半自动门禁模式

标准 M/L 默认自动读取上一步产物、按风险维度自动推进已触发且无副作用的检查门禁，在关键决策点停下确认。

自动继续的场景：

- `writing-plans` 完成后按 `[HANDOFF]` 的 `Next skill` 继续；标准 L 默认下一跳 `requirements-coverage`。
- 需求覆盖无阻塞缺口时，至少继续到 `plan-review`。
- `plan-review` 无 CRITICAL/HIGH 时可自动进入实现前的回撤/安全检查；下一步要写业务代码前必须停在 `implementation_approval`。
- `rollback-units` 触发 `full` 时设计完成后停在实现前；`light` 时把证据写入 `status.md`。
- `rollback_units: full` 时实现完成后先审计再 `code-review`；无 CRITICAL/HIGH 阻塞项时进入验证。
- light 路线 code-review 用 `gate_evidence.code_review`（path+heading）；标准 L 始终独立报告。

必须停下询问的场景：

- 任意 `[HUMAN GATE:<gate-id>]` 已输出，或上一段 `[HANDOFF]` 写了 `Auto-continue: no`。
- 需求边界固化后、进入 `writing-plans` 前；计划与实现前门禁完成后、写业务代码前。
- `requirements-coverage` 出现 `MISSING`/`CONFLICT`/`OUT_OF_SCOPE`，或 L 级出现未接受的 `PARTIAL`/`UNVERIFIABLE`。
- `plan-review` 出现 CRITICAL/HIGH；安全审查发现高风险残留；验证失败需要选择修复范围或接受风险。
- finalizer dry-run 输出 `[ASSET FINALIZATION]` 后，当前回合必须停止；只接受精确回复 `compact` / `retain full` / `not now`。
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
| `req-probe`/`openspec`（标准 M/L 链路） | 待压测的需求说明书或 `openspec/changes/<change-id>/` | 不输出 HUMAN GATE；`Auto-continue: yes` 进入 `grillme` |
| `grillme`（标准 M/L 链路） | 已合并 Decision Log 的需求资产 | 输出唯一一次 `[HUMAN GATE:requirement_confirmation]` 并停止；用户确认后进入 `writing-plans` |
| `writing-plans` | 实现计划、`status.md` | 自动进入已触发的 `requirements-coverage` |
| `requirements-coverage` | 覆盖矩阵或 `status.md` 轻量结论 | 标准 M/L 通过后至少进入 `plan-review` |
| `plan-review` | 计划审查报告或轻量结论 | 无 CRITICAL/HIGH 后进入实现前门禁；写代码前必须 `[HUMAN GATE:implementation_approval]` |
| `security-reviewer` | 安全审查报告或轻量结论 | 高风险残留需停下确认 |
| `rollback-units`（实现前） | 回撤单元设计 | `full` 时停下询问是否开始实现 |
| `executing-plans` | 任务报告、回撤证据 | 仅在 `implementation_approval.status` 为 `confirmed` 后执行；接受残留风险也必须登记为 `confirmed` + evidence |
| `rollback-units`（审计） | 补齐提交/diff/patch 证据 | 无未解释 `pending` 后进入 `code-review` |
| `code-review` | 代码审查报告 | 无阻塞后进入 `verification-before-completion` |
| `verification-before-completion` | 验证报告，必要时 manual-test | `complete-verification` 后进入 feature-check / finalization |
| `finishing-a-development-branch` | final assets、dry-run、精确 finalization 回复、Git 选项 | 见 ASSET FINALIZATION |

`<feature-id>` 按项目适配层命名，默认 `YYYY-MM-DD-<short-kebab-name>`；已有产物或 OpenSpec change id 已明确时沿用。

## ASSET FINALIZATION 停等

`/finish` 在 feature-check 通过并生成 final assets 后，读取 `dev_flow.artifacts.retention` 作为本次 dry-run 的默认 `compact|full`，只做 finalizer dry-run（**禁止同回合 `--confirm`**），输出：

```text
[ASSET FINALIZATION]
Feature: <feature-id>
Verification: verified|partial
Inventory: <sha256>
Working set: <files/bytes>
Long-term keep: <files/bytes>

Reply exactly:
- compact
- retain full
- not now
[/ASSET FINALIZATION]

Auto-continue: no
```

当前回合必须停止。仅精确整行回复有效：

| 回复 | 动作 |
|------|------|
| `compact` | `--retention=compact --confirm --inventory <sha256>`；**删除**中间资产，保留 feature/completion/可复用 manual-test；若存在 untracked 删除候选，普通 confirm 被拒，须额外 `--confirm-untracked "DELETE-UNTRACKED:<inventory-sha>:<count>"`（与 dry-run 输出的 exact token 一致） |
| `retain full` | 同一 inventory 下 `--retention=full --confirm`；中间资产**归档**到 `archive/<timestamp>-<nonce>/{reviews,feature}/`（移动而非删除，无需 untracked token） |
| `not now` | 不调用 finalizer；status/feature/completion/中间资产与 check-ok 保留；**不阻塞 Git**（logic-complete 已满足时 finish-guard 放行） |

**logic-complete（v0.9）**：`feature-check --finish` 成功 + 有效 `feature.md`/`completion.md` + 新鲜 check-ok 即逻辑完成，**允许进入 Git**；compact/full 只是可选资产维护，不是 Git 前置。

禁止把 implementation approval 或「继续/好的/完成吧」当 finalization 授权。`--confirm` 必须带 `--inventory`；hash 漂移或 untracked token 不匹配则零修改失败并要求重新 dry-run。状态机细节见 `finish.md` 与 finishing skill。

## status.md v3 更新契约

- `schema_version` 固定 `"3"`；字段取值见 contract.json 的 `asset_kinds`/`risk_labels`/`risk_gates`/`classification_topologies`/`classification_evidence_results`。
- **所有 status 创建/更新只通过** `dev-flow-status` CLI（`init`/`authorize`/`activate`/`add-asset`/`complete-gate`/`promote-gate`/`record-risk-evidence`/`confirm-human`/`record-validation`/`complete-verification`/`accept-risk`/`repair`）；写后自动跑 validator，失败恢复原文件。`repair` 只重排确定性字段，不生成审批/验证/风险接受事实。
- `implementation_approval` 的 candidate 与 `activate` 共用 validator approval stage：标准 M/L 的路线骨架及所有已触发实现前 gate 未完成时拒绝授权。所有 required HUMAN GATE **仅 `confirmed` 才完成**；implementation approval 确认后才写 approved 授权。用户说“接受风险并继续”仍记为 `confirmed` 并保留原话 evidence。
- 标准 M/L 外部需求统一路由，并在分类同回合通过 `init --entry-gate` 落盘：已有完整但未确认的需求文档用 `grillme`；需求模糊或没有文档用 `req-probe`（OpenSpec 路线用 `openspec`）并自动进入 `grillme`；用户已明确确认需求基线且无未决问题时用 `writing-plans`，再以当前消息和需求文档执行 `confirm-human requirement_confirmation --status confirmed`。主动告知用户跳过 `req-probe`/`grillme`，**不得**因文档标题/frontmatter 含 confirmed 而自动确认。每个 process gate 完成后调用 `complete-gate`，由 CLI 更新可恢复的 `next_action`；`plan-review` 与 `implementation_approval` 在三条路线中都不省略。
- 保留已有 `completed_gates`，只追加新完成 gate，不删除历史。
- `assets` 只追加已存在或本次明确生成的真实路径，每项 `{path, kind}`，禁止 `path#heading`。
- 可选 `gate_evidence`（仍为 schema v3）：`requirements_coverage: light` 或 light 路线 `code-review` 的证据在已有文件章节时，`complete-gate` 写入 `path` + 唯一 `heading`；validator 校验文件存在、位于 feature/review 根、标题恰好一次。
- 每次更新设置 `current_gate`、`next_action`、`auto_continue`；恢复时 `current_gate` 表示最近进入/完成的稳定 gate，`next_action` 是 CLI 按路线派生的下一步。
- 验证门禁用 `complete-verification`（或 `record-validation`）记录命令与报告；`complete-verification` 不 stamp，check-ok 只由 feature-check 写。
- 携带风险标签时，`risk_evidence` 每个标签一项（`mode`/`conclusion`/`verification`/`report`），对应最低 gate 升为 `full` 时必须用 `report` 模式。
- `risk-minimal` 只适用于带风险标签且 `risk_labels` 非空的 XS/S；带风险标签的 M/L 用 `profile: "standard"`。
- 只有用户明确确认、继续或接受风险并继续，才能 `confirm-human` 把 HUMAN GATE 写为 `confirmed`，原话或理由写入 `evidence`。
- `accepted_risks` 仅保存已接受的 `AR-xxx`；partial 三方一致规则见 `partial-verification.md`（手测步骤、`accepted_risks`、partial-acceptance）。
- 写入门禁与 `write-authorization.json` 见 `status-cli.md`。

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
  workflow_version: "<current contract workflow_version; required for new completion>"
  risk_labels: []
  risk_approval_evidence: ""
  risk_verification_summary: ""
  business_diff_fingerprint: "<git-hash>"
  commits: []
  pull_request: "none"
  accepted_risks: []
---
```

`dev_flow_completion.schema_version` 恒为 `"1"`，是独立 schema（不是 status v3）。有 active `status.md` 的新 completion 必须写当前 `contract.workflow_version` 和模板全部字段并通过严格校验；`risk_labels`、`accepted_risks` 必须分别与 active status 精确一致，`completed_at` 必须是 ISO-8601 时间。无 status 的历史 finalized completion 可省略版本，按最小旧契约校验并输出 WARN。`risk_labels` 非空时，`risk_approval_evidence` 和 `risk_verification_summary` 必填。

`outcome: verified` 要求 `accepted_risks: []`，不写 accepted-risk 段。`outcome: partial` 必须列出已接受风险，不得写成「验证通过」，并在 frontmatter 后为每个 ID 恰好保留一个长期事实段；段的 ID 集合必须与 `accepted_risks` 一致：

```markdown
## AR-001
- reason: <用户接受的剩余风险原因>
- evidence: <明确用户证据或可审计证据>
```

新 completion 缺段、重复段、空 reason/evidence 或额外 AR 段均 FAIL。历史 finalized partial 缺少该段只 WARN，不倒填事实。
