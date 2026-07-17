# /finish — 收尾与完成前检查

用于在任务结束前确认改动、验证证据、最终资产和剩余风险。状态机见 `finishing-a-development-branch` 技能与 `dev-flow/references/protocol.md`。

## 使用

```text
/finish
```

第一步固定运行：

```bash
.claude/skills/dev-flow/scripts/dev-flow-status.mjs next [feature-id]
```

每次调用只推进输出中的一条 `command`；若仍有 blocker，执行后停止并让下一次 `/finish` 重新 `next`。不得一次跨过多个 gate。已 finalized 时只读返回，不依赖 write authorization。

## 状态机

### 状态 A：需要验证

条件：check-ok 不存在、fingerprint 过期，或 verification 尚未闭环。

1. 查看工作区变更和本轮修改范围。
2. 读取 `.claude/rules/project-workflow.md`，根据改动类型选择验证：
   - 文档、规则、命令：做适配层定义的文本检查
   - 源码或类型改动：运行适配层定义的类型检查和代码检查
   - 构建配置、路由、接口、关键页面：运行适配层定义的构建或集成验证
   - UI 行为：必要时启动适配层定义的开发服务并浏览器验证
3. 阅读验证输出和退出码。
4. 对标准 M/L、轻量 L 和 risk-minimal（XS/S/M），先由 status CLI 原子登记验证资产、命令、fingerprint 与 gate，再单独运行 feature-check：

```bash
.claude/skills/dev-flow/scripts/dev-flow-status.mjs complete-verification <feature-id> \
  --command "<actual verification command>" \
  --report <verification-report> [--manual-test <manual-test-report>]
.claude/skills/dev-flow/scripts/dev-flow-feature-check <feature-id> --finish
```

`complete-verification` 只调用 validator/fingerprint，不调用 feature-check、不生成 check-ok；禁止手改 status 代替它。

无风险 XS/S 与默认轻量 M（无 `status.md`）不强制该检查。feature-check 成功后进入状态 B。

### 状态 B：logic-complete（可 Git；finalization 可选）

1. 生成或更新精简 `feature.md`；用 `dev-flow-status scaffold <feature-id> --asset completion [--refresh]` 生成 schema 2 `completion.md`。`partial` 按 protocol 为每个 accepted risk 保留一个 AR 段。
2. `completion.md` frontmatter 写入当前 contract 的 `workflow_version`（字段见 protocol.md）。
3. 报告 **logic-complete**：feature-check 通过 + 有效 `feature.md`/`completion.md` + 新鲜 check-ok 时即可进入 Git；compact/full 只是可选资产维护。
4. 读取 `.claude/rules/project-workflow.md` 的 `dev_flow.artifacts.retention` 到 `RETENTION`（仅 `compact|full`），按该项目默认值运行 finalizer dry-run（禁止同回合 `--confirm`）：

```bash
.claude/skills/dev-flow/scripts/dev-flow-feature-finalize <feature-id> --retention="$RETENTION"
```

5. dry-run 会标注 `[keep]` / `[delete][tracked|untracked]` / `[archive]`。compact 若含 untracked 删除，输出 exact token `DELETE-UNTRACKED:<inventory-sha>:<count>`；普通 `--confirm --inventory` 会被拒绝。
6. 输出清单、统计和 inventory hash，并输出停止协议：

```text
[ASSET FINALIZATION]
Feature: <feature-id>
Verification: verified|partial
Inventory: <sha256>
Working set: <files/bytes>
Long-term keep: <files/bytes>
Semantics: compact=delete intermediate; full=archive; not now=skip without blocking Git

Reply exactly:
- compact
- retain full
- not now
[/ASSET FINALIZATION]

Auto-continue: no
```

7. **当前回合必须立即停止。** 不得同回合运行 `--confirm`，不得把 implementation approval 或模糊回复（继续/好的/完成吧）当 finalization 授权。logic-complete 后用户也可直接走 Git（不必先 finalization）；若用户选择 compact/full，则下一回合再 `--confirm`。

### 状态 C：用户精确回复 `compact`

下一回合。若 dry-run **没有** untracked 删除候选：

```bash
.claude/skills/dev-flow/scripts/dev-flow-feature-finalize <feature-id> \
  --retention=compact --confirm --inventory <sha256>
```

若 dry-run 输出了 `Untracked delete token: DELETE-UNTRACKED:<sha>:<count>`，必须带同一 token（普通 confirm 零修改失败）：

```bash
.claude/skills/dev-flow/scripts/dev-flow-feature-finalize <feature-id> \
  --retention=compact --confirm --inventory <sha256> \
  --confirm-untracked "DELETE-UNTRACKED:<sha256>:<count>"
```

成功后运行 `dev-flow-feature-check <feature-id> --finish`（finalized 形态），再进入 Git 收尾选项（若尚未提交）。

### 状态 D：用户精确回复 `retain full`

使用**同一** inventory hash（full 为归档，无需 untracked token）：

```bash
.claude/skills/dev-flow/scripts/dev-flow-feature-finalize <feature-id> \
  --retention=full --confirm --inventory <sha256>
```

成功后同样运行 `dev-flow-feature-check <feature-id> --finish`（finalized 形态），再进入 Git 收尾选项。

### 状态 E：用户精确回复 `not now`

- 不调用 finalizer；status、feature、completion 和中间资产保持原样；check-ok 保留。
- **不阻塞 Git**：logic-complete 已满足时 finish-guard 对 add/commit/push/merge **放行**。
- 可声明「验证已完成/partial，资产尚未 compact/full」；不得把「未 finalization」说成「未验证」。
- doctor 可输出 ready-to-finalize WARN（可选归档提示），不挡 Git。
- 业务 diff 变化会使 check-ok 自动 stale；同 feature 可重跑 verification → feature-check → 更新 completion。
- 再次 `/finish`：fingerprint 未变可复用验证；已变必须重跑；无论是否复用都重新 dry-run 生成 inventory。

## 精确回复（唯一合法）

| 回复 | 动作 |
|------|------|
| `compact` | confirm + retention=compact + inventory；有 untracked 删除时另需 `--confirm-untracked "DELETE-UNTRACKED:<sha>:<count>"` |
| `retain full` | confirm + retention=full + inventory |
| `not now` | 不 finalizer；保留 check-ok；**Git 不阻塞** |

禁止模糊匹配。`--confirm` 必须带 `--inventory <sha256>`，且不得与 dry-run 同回合。

## 输出要求

- 没有新鲜验证证据时，不要说“完成”“通过”“可提交”。
- 验证失败时，报告失败命令、关键错误和下一步。
- logic-complete 后可进入 Git；finalization 可选。
- 不自动提交；只给出建议暂存文件和 commit message。
- 重复 `/finish` 必须幂等：每轮先 `next`，已完成 gate 不重写；finalizer confirm 前始终重新核对 inventory。
