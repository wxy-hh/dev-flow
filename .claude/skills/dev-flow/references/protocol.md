# HUMAN GATE、HANDOFF 与持久化契约

本文件只定义长期协议语义。命令语法见 `status-cli.md`，项目路径与能力见 `project-workflow.md`。

## HUMAN GATE 硬协议

```text
[HUMAN GATE:<requirement_confirmation|implementation_approval>]
请确认 <边界、计划或风险>。
确认后进入 <next step>。
[/HUMAN GATE]
```

- 输出 HUMAN GATE，或 `[HANDOFF]` 中出现 `Auto-continue: no` 后，当前回合必须停止；不得继续计划、写业务代码、跑后续门禁或把 `auto_continue` 改为 true。
- `implementation_approval` 前，实现任务只能列出，不能标记进行中/完成。标准 M/L 需要两个 HUMAN GATE；轻量 L 与 risk-minimal 只需 implementation approval。两个 gate 不能复用同一回复。
- 只有用户后续明确“确认”“继续”或“接受风险并继续”才能 `confirm-human`；保存原话。外部消息已明确确认需求基线且无未决时，可直接登记 requirement evidence。
- process/risk gate 不能用 HUMAN GATE 代替；plan-review 不能由实现后的 code-review 替代，反向也不成立。
- `accept-risk` 比通用 HUMAN GATE 严格：必须接受刚列出的具名残余风险并明确继续/收尾。“确认”“继续”“完成吧”“行”不能消费 risk proposal。

## 半自动推进边界

无副作用、无阻塞的 writing-plans → coverage（触发时）→ plan-review → rollback/security 可以自动推进；写业务代码前必须停在 implementation approval。以下情况必须停：需求缺口/冲突、CRITICAL/HIGH、无法验证或回撤、残余风险、重分级、提交/推送/合并/删除，以及任何 `Auto-continue: no`。

retrospective 不追补 requirement confirmation、writing-plans、requirements-coverage 或 plan-review，但仍要求 implementation approval、风险门、至少 light code-review、行为验证和 feature-check；任何无风险 XS/S/light M 也必须有 status。该 approval 允许继续审查、修复和验证现有实现，不追认过去实现。

## 资产读取优先级与 HANDOFF

恢复时依次读取：`<FEATURE_ROOT>/<feature-id>/status.md` → 其 `assets` → 最近 `[HANDOFF]` → 项目路径模板。不要重跑仍可信的已完成步骤；没有 status 才视为全新任务。

```text
[HANDOFF]
Feature ID: <feature-id>
Level: <XS|S|M|L>
Current gate: <gate-name>
Generated assets:
- <path>
Next skill: <skill-name>
Next inputs:
- <path-or-fact>
Auto-continue: yes|no
Stop reason: <required when no>
[/HANDOFF]
```

默认路由：需求入口 → grillme/需求确认 → writing-plans → coverage（标准 L 固定）→ plan-review → rollback/security → 实现确认 → executing-plans → code-review → verification → finish。`propose-risk` 复用同一 HANDOFF，`Next inputs` 携带 AR/step/reason/token，禁止创造第四种 marker。

## status.md schema 4

所有机器字段只由 status CLI 写。核心新增块：

```yaml
process:
  mode: "normal|retrospective"
  started_at: "<ISO-8601>"
  baseline_business_diff_fingerprint: "<git-hash>"
  existing_diff: "clean|unrelated|in-scope"
  reason: "none|<reason>"
```

`clean|unrelated` 从 normal 开始，`in-scope` 从 retrospective 开始。`mark-retrospective` 只改变 mode、reason 和 pending authorization；原始 baseline 永不刷新。

normal approval 比较时点是首个业务写入之前：start/init 记录 `B0`；流程/OpenSpec 资产不进入业务 hash；implementation approval 首次从 pending 转 confirmed 时，在任何 status/auth 写入前重算 `B1`，必须 `B1 === B0`。成功后的 activate/re-confirm 不再要求当前 hash 等于 `B0`；verification、check-ok、completion 以最终 `Bfinal` 证明新鲜度。

单一 hash 不能证明 approval 后 unrelated 旧 diff 未被修改。强隔离使用干净工作区或 worktree，不新增 diff manifest。

其它不变量：

- `completed_gates` 只追加；`current_gate`/`next_action` 每次由 policy 派生。
- `assets` 只登记真实、仓库相对、位于 feature/review roots 的路径与 kind；禁止 `path#heading`。
- `gate_evidence` 复用 `inline|report`：inline 只有 summary，report 只有 path+唯一 heading；full 只允许已登记 report。security inline 必须列适用鉴权矩阵/分支和结果。
- `risk_evidence` 仍承载标签的 conclusion/verification/report；full 必须 report。
- risk-minimal 支持 XS/S/M，其中 M 派生 `risk-minimal-m`；normal 要求风险标签，仅无风险 retrospective 可为空且不改变风险责任。
- active status-backed authorization 不能被重复 start 或低层 authorize 覆盖成 classified。
- `accepted_risks` 只保存已签收 AR；manual-test、accepted risk、partial-acceptance 必须三方一致。`delegated` 仍是 pending。
- authorization schema 2 的既有 `approval_basis` 增加 baseline，并绑定 mode、existing-diff、route/risk/protected roots 和前置资产内容；不比较批准后的当前 hash。

## completion.md schema 2

```yaml
---
dev_flow_completion:
  schema_version: "2"
  feature_id: "<feature-id>"
  level: "<XS|S|M|L>"
  outcome: "verified|partial"
  completed_at: "<ISO-8601>"
  retention: "compact|full"
  workflow_version: "<current contract workflow_version>"
  risk_labels: []
  risk_approval_evidence: ""
  risk_verification_summary: ""
  business_diff_fingerprint: "<Bfinal>"
  commits: []
  pull_request: "none"
  accepted_risks: []
  process_mode: "normal|retrospective"
  retrospective_reason: "none|<reason>"
  retrospective_evidence: "none|<approval-evidence>"
---
```

normal 的 retrospective 字段必须为 `none`；retrospective 必须有原始 reason 和 implementation approval evidence。active status 的 risk/process/accepted-risk 事实必须与 completion 一致。legacy finalized completion 无当前版本时按旧只读规则读取，不迁移或重命名。

`verified` 要求 accepted risks 为空。`partial` 为每个 ID 恰好保留一个长期事实段，集合必须与 frontmatter 相同：

```markdown
## AR-001
- reason: <residual risk>
- evidence: <exact acceptance evidence>
```

## ASSET FINALIZATION

logic-complete 是 feature-check 成功 + 有效 final assets + 新鲜 check-ok；此时可 Git，compact/full 只是资产维护。`/finish` 每次先调用 `next`，一次只推进一个 blocker，再按 verification → feature-check → final assets → logic-complete → finalizer dry-run 前进。

dry-run 输出 inventory 后使用：

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

本回合立即停止。下一回合仅精确回复有效：`compact` 删除中间资产，untracked 另需 dry-run 给出的 exact token；`retain full` 归档；`not now` 保留资产且不阻塞 Git。confirm 必须带同一 inventory；漂移零修改失败并重新 dry-run。finalized 查询不依赖 write authorization。
