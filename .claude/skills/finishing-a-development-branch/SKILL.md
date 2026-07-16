---
name: finishing-a-development-branch
description: 实现完成且需要决定如何收尾时使用：先验证与 feature-check，再 logic-complete（可 Git）；可选 dry-run 资产 finalization 并停等精确回复；再给出合并、推送 PR、保留或丢弃的选项。
---

# 完成开发分支

实现完成后的收尾。验证前不给「完成」结论；用户未精确确认前不删除/压缩中间资产。

先读 `.claude/rules/project-workflow.md`（验证配置、OpenSpec baseline、分支约束）与 `dev-flow/references/protocol.md` 资产优先级。有新鲜验证时仍须核对工作区无新未验证改动。`living-baseline: true` 时收尾前 archive change 并回写 baseline；`false` 时只在摘要说明 OpenSpec 为 point-in-time。

## 第 1 步：完成前验证（状态 A）

按适配层验证命令运行；失败则停止，不合并/推送/删分支。命令不复制进本技能。

## 第 1.5 步：feature evidence

```bash
.claude/skills/dev-flow/scripts/dev-flow-status.mjs complete-verification <feature-id> \
  --command "<actual verification command>" \
  --report <verification-report> [--manual-test <manual-test-report>]
.claude/skills/dev-flow/scripts/dev-flow-feature-check <feature-id> --finish
```

`complete-verification` 不 stamp、不调 feature-check。失败则不得给「验证通过」的 Git 选项。`outcome: partial` 可继续但文案必须 partial。无风险 XS/S 与默认轻量 M（无 status）跳过本步与 finalization，直接 Git 选项。

## 第 2 步：logic-complete 与可选 dry-run（状态 B）

生成/更新：

```text
<FEATURE_ROOT>/<feature-id>/feature.md
<FEATURE_ROOT>/<feature-id>/completion.md
```

frontmatter 见 protocol.md；partial 时每个 AR 有唯一 `## AR-xxx`。**logic-complete**：feature-check + 有效 feature/completion + 新鲜 check-ok → **可 Git**。compact/full 可选；`not now` **不阻塞** add/commit/push/merge。

```bash
.claude/skills/dev-flow/scripts/dev-flow-feature-finalize <feature-id> --retention=<compact|full>
```

dry-run 标注 `[keep]` / `[delete][tracked|untracked]` / `[archive]`。untracked 删除时输出 `DELETE-UNTRACKED:<inventory-sha>:<count>`；普通 confirm 拒绝。输出后停等（也可 logic-complete 后直接给 Git 选项）：

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

禁止同回合 `--confirm`；禁止模糊回复当 finalization 授权；禁止 token 不匹配时删 untracked。

## 第 2.5 步：精确选择（C/D/E）

### `compact`（C）

```bash
# 无 untracked 删除
.claude/skills/dev-flow/scripts/dev-flow-feature-finalize <feature-id> \
  --retention=compact --confirm --inventory <sha256>
# 有 untracked（token 与 dry-run 一致）
.claude/skills/dev-flow/scripts/dev-flow-feature-finalize <feature-id> \
  --retention=compact --confirm --inventory <sha256> \
  --confirm-untracked "DELETE-UNTRACKED:<sha256>:<count>"
```

删除中间资产；保留 feature/completion/可复用 manual-test。

### `retain full`（D）

```bash
.claude/skills/dev-flow/scripts/dev-flow-feature-finalize <feature-id> \
  --retention=full --confirm --inventory <sha256>
```

归档到 `archive/<timestamp>-<nonce>/{reviews,feature}/`；review_root 当前 feature 残留为 0。

### `not now`（E）

不 finalizer；保留 check-ok 与中间资产；**Git 不阻塞**。可声明「已验证、未 compact/full」。fingerprint 变则 check-ok stale，须重跑验证。

`--confirm` 必带 `--inventory`。成功 compact/full 后可再 `feature-check --finish`（finalized）。

## 第 3–4 步：环境与基线

```bash
git rev-parse --git-dir
git rev-parse --git-common-dir
git branch --show-current
```

命名分支 4 选项；detached 3 选项。基线优先 `merge-base HEAD main|master`。

## 第 5 步：Git 选项

**logic-complete 后即可展示**（不必等 finalization）。XS/S 无 status 同样直接展示。

```text
实现已 logic-complete（outcome: verified|partial）。finalization 可选；not now 不阻塞 Git。
partial 时不得宣称「验证通过」。请选择：
1. 本地合并回 <base-branch>
2. 推送并创建 Pull Request
3. 保留当前分支，我稍后处理
4. 丢弃这次工作
```

detached：推送新分支 PR / 保留 / 丢弃。

## 第 6 步与清理

合并：切回基线、更新、合并、再验证，再清理 worktree。PR：推送不删 worktree。丢弃：须精确词 `discard`。只清理我们创建的 `.worktrees/` / `worktrees/`。
