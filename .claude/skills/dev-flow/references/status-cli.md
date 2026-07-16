# status CLI 与写入授权

`dev-flow-status` 是 status.md 与 write-authorization 的唯一写入入口。实现路径：`.claude/skills/dev-flow/scripts/dev-flow-status.mjs`。

## 命令

```text
dev-flow-status authorize --level <XS|S> [--note <text>]
dev-flow-status init <feature-id> --level <XS|S|M|L> --profile <profile> \
  --topology <topology> --evidence-result <result> \
  [--entry-gate <req-probe|openspec|grillme|writing-plans>] \
  [--note <text>] [--risk-labels a,b] [--lightweight-l]
dev-flow-status activate <feature-id>
dev-flow-status add-asset <feature-id> --path <repo-path> --kind <kind>
dev-flow-status complete-gate <feature-id> <gate> \
  [--evidence-file <repo-path> --heading <markdown-heading>]
dev-flow-status promote-gate <feature-id> <risk-gate> --to <light|full> --reason <text>
dev-flow-status record-risk-evidence <feature-id> <label> \
  [--mode <inline|report>] [--conclusion <text>] [--verification <text>] [--report <path>]
dev-flow-status confirm-human <feature-id> <gate> \
  --status confirmed --evidence <user-evidence>
dev-flow-status record-validation <feature-id> --command <command>
dev-flow-status complete-verification <feature-id> --command <command> \
  [--report <path>] [--manual-test <path>]
dev-flow-status accept-risk <feature-id> --id <AR-xxx> \
  --step <manual-test-step-id> --reason <reason> --evidence <user-evidence>
dev-flow-status repair <feature-id>
```

写后立即跑 validator；失败恢复原文件。`repair` 只调整字段顺序，不发明事实。

### approval 与 gate 名称

`confirm-human … implementation_approval` 在 candidate status 上运行 `--stage approval`；`activate` 复用同一检查。标准 M/L 必须先完成路线要求的 writing-plans、coverage（触发时）和 plan-review，已触发 rollback/security 也必须完成；process gate 不能用 HUMAN GATE 代替。**所有 required HUMAN GATE 仅 `confirmed` 才算完成**；implementation approval 的确认会生成绑定 approval_basis（route/risk/protected roots + 前置资产路径与内容哈希）的 approved 授权。用户「接受风险并继续」仍记 `confirmed`，原话保存在 evidence。`complete-gate` 可兼容输入风险 gate 的 snake_case 别名，但 `current_gate`/`completed_gates` 永远落盘为 contract `known_gates` 的连字符名称（如 `plan-review`、`rollback-units`）。独立 code-review 报告在 `complete-gate` 成功后若尚未 `add-asset`，CLI 会提示可复制的 `add-asset … --kind review` 命令。HUMAN GATE 只能用 `confirm-human`，验证 gate 只能用 `complete-verification`，不得借通用命令旁路。

### init 与 risk labels

- 标准 M/L 必须显式传 `--entry-gate`：模糊/无文档为 `req-probe`，OpenSpec 路线为 `openspec`，完整未确认文档为 `grillme`，已明确确认且无未决为 `writing-plans`；轻量 L/risk-minimal 不传。
- 携带风险标签且某 required gate 已为 full 时，**approval/finish** 阶段 `risk_evidence` 须用 report 模式指向真实报告；**init/current** 允许 pending inline 证据（stage-aware）。
- 标签相对路线无 gate 增量时 init 输出 INFO（不自动剥标签）。
- 只读校验：`dev-flow-validate.mjs approval-basis` / `authorization`。

### promote-gate

只接受 contract `risk_gates`：`requirements_coverage` / `plan_review` / `rollback_units` / `security_review` / `behavior_verification`。拒绝 `code-review` 等非 risk gate。只做 `none → light → full` 单调提升，并把 `--reason` 追加到现有 `classification.note`（不扩 schema）；不扫描 Markdown severity，不自动 promote。severity 由 skill 判定，skill 在 light 出现 CRITICAL/HIGH 时调用本命令。

### complete-verification

登记验证命令与报告，并在同一原子写入后执行 finish/active validator；路线要求 code-review 时必须已经完成并具备匹配 evidence，full behavior verification 必须有独立 verification 资产。**不**写 check-ok stamp、**不**调用 feature-check/finalizer、**不**生成 feature/completion。stamp 只由随后独立执行的 `dev-flow-feature-check --finish` 写入。

### record-risk-evidence

按标签写入 `risk_evidence`（`mode`/`conclusion`/`verification`/`report`）；对应最低 gate 为 `full` 时用 `report` 模式。

## 授权分流

一个 worktree 仅一份 `.claude/runtime/dev-flow/write-authorization.json`。

| 场景 | CLI | status.md | authorization state |
|------|-----|-----------|---------------------|
| 无风险 XS/S | `authorize --level XS\|S` | 否 | `classified` |
| 风险 XS/S | `init … --profile risk-minimal` | 是 | `approval-pending` → 确认后 `approved` |
| 标准/轻量 M/L | `init … --profile standard` | 是 | `approval-pending` → `implementation_approval` 后 `approved` |

- `authorize` 不得接受 `--profile standard`。
- `activate` 切换活动功能前关闭旧授权；同一 worktree 不支持并行两个进行中的 feature 授权。
- `state: closed` 或文件缺失：受保护路径按无授权处理。
- Path Card / 分类完成后同回合写入授权（XS/S 用 `authorize`，M/L 用 `init`+`activate`）。

字段：`schema_version`、`workflow_version`、`feature_id`、`level`、`profile`、`state`（`classified|approval-pending|approved|closed`）、`protected_roots`、`approval_basis`、`created_at`、`approved_at`、`closed_at`。approved 必须有当前 schema/workflow version、active status 和匹配当前 workflow roots/前置资产的 approval_basis；finalizer 成功后保留同 feature 的 `closed` 记录供 Git 收尾定位。

## 路径拦截模型 A

默认放行；仅当写入目标命中 `project-workflow.md` 的 `protected_write_roots` 时，才套用 `enforcement_mode`：

| 模式 | 无授权业务写入 | approval-pending / risk-minimal 未批 |
|------|----------------|--------------------------------------|
| `off` | allow | allow |
| `ask` | ask | ask |
| `strict` | deny + 可复制下一步 | deny |

永远不拦：`.claude/**`、`<feature_root>/**`、`<review_root>/**`、`openspec/**`。未命中 protected roots 的路径 allow。strict 且 roots 为空/不安全：`dev-flow-doctor --preflight` FAIL。未 onboarding（无 project-workflow.md）：静默 allow。

只强制 Edit/Write/MultiEdit/NotebookEdit；Bash 写入拦截不是本版本承诺。严格模式是流程护栏而非安全边界。

## 新/旧项目默认

- 新项目 onboarding 默认 `enforcement_mode: strict`。
- 旧项目升级默认 `ask`，只有显式选择才升 `strict`。
