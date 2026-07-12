# status CLI 与写入授权

`dev-flow-status` 是 status.md 与 write-authorization 的唯一写入入口。实现路径：`.claude/skills/dev-flow/scripts/dev-flow-status.mjs`。

## 命令

```text
dev-flow-status authorize --level <XS|S> [--note <text>]
dev-flow-status init <feature-id> --level <XS|S|M|L> --profile <profile> \
  --topology <topology> --evidence-result <result> \
  [--note <text>] [--risk-labels a,b] [--lightweight-l]
dev-flow-status activate <feature-id>
dev-flow-status add-asset <feature-id> --path <repo-path> --kind <kind>
dev-flow-status complete-gate <feature-id> <gate> \
  [--evidence-file <repo-path> --heading <markdown-heading>]
dev-flow-status confirm-human <feature-id> <gate> \
  --status <confirmed|skipped> --evidence <user-evidence>
dev-flow-status record-validation <feature-id> --command <command>
dev-flow-status accept-risk <feature-id> --id <AR-xxx> \
  --step <manual-test-step-id> --reason <reason> --evidence <user-evidence>
dev-flow-status repair <feature-id>
```

写后立即跑 validator；失败恢复原文件。`repair` 只调整字段顺序，不发明事实。

## 授权分流

一个 worktree 仅一份 `.claude/runtime/dev-flow/write-authorization.json`。

| 场景 | CLI | status.md | authorization state |
|------|-----|-----------|---------------------|
| 无风险 XS/S | `authorize --level XS\|S` | 否 | `classified` |
| 风险 XS/S | `init … --profile risk-minimal` | 是 | `approval-pending` → 确认后 `approved` |
| 标准/轻量 M/L | `init … --profile standard` | 是 | `approval-pending` → `implementation_approval` 后 `approved` |

- `authorize` 不得接受 `--profile standard`。
- `activate` 切换活动功能前关闭旧授权；v0.7 不支持同一 worktree 并行两个进行中的 feature 授权。
- `state: closed` 或文件缺失：受保护路径按无授权处理。
- Path Card / 分类完成后同回合写入授权（XS/S 用 `authorize`，M/L 用 `init`+`activate`）。

字段：`feature_id`、`level`、`profile`、`state`（`classified|approval-pending|approved|closed`）、`protected_roots`、`created_at`、`approved_at`。

## 路径拦截模型 A

默认放行；仅当写入目标命中 `project-workflow.md` 的 `protected_write_roots` 时，才套用 `enforcement_mode`：

| 模式 | 无授权业务写入 | approval-pending / risk-minimal 未批 |
|------|----------------|--------------------------------------|
| `off` | allow | allow |
| `ask` | ask | ask |
| `strict` | deny + 可复制下一步 | deny |

永远不拦：`.claude/**`、`<feature_root>/**`、`<review_root>/**`、`openspec/**`。未命中 protected roots 的路径 allow。strict 且 roots 为空/不安全：`dev-flow-doctor --preflight` FAIL。未 onboarding（无 project-workflow.md）：静默 allow。

v0.7 只强制 Edit/Write/MultiEdit/NotebookEdit；Bash 写入拦截不是本版本承诺。严格模式是流程护栏而非安全边界。

## 新/旧项目默认

- 新项目 onboarding 默认 `enforcement_mode: strict`。
- 旧项目升级默认 `ask`，只有显式选择才升 `strict`。
