---
name: finishing-a-development-branch
description: 实现完成且需要决定如何收尾时使用：先验证，再 dry-run 资产 finalization 并停等精确回复，再给出合并、推送 PR、保留或丢弃的选项。
---

# 完成开发分支

用于实现完成后的收尾。不要在验证前提供"完成"结论，也不要在用户未精确确认前压缩或删除中间资产。

先读取项目适配层。Claude 环境默认读取 `.claude/rules/project-workflow.md`，从中获取验证配置、OpenSpec baseline 策略和当前项目的分支收尾约束。按 `dev-flow/references/protocol.md` 的资产读取优先级找验证报告和 `status.md`；如果已有新鲜验证报告，也要核对当前工作区没有新的未验证改动，有新改动时重新验证。

如果项目适配层声明 `living-baseline: true`，收尾前必须检查对应 OpenSpec change 是否已经 archive 并回写 baseline。当前项目为 `living-baseline: false` 时，不做 baseline 回写，只在收尾摘要中说明 OpenSpec 是 point-in-time 记录。

## 第 1 步：完成前验证（状态 A）

根据改动风险运行项目适配层定义的验证命令或检查。不要把当前项目的命令复制到本技能正文；迁移项目时只更新适配层。

如果验证失败，停止收尾，报告失败摘要。不要合并、推送或删除分支。

## 第 1.5 步：feature evidence 检查

完成前验证报告生成后，先用 status CLI 原子登记验证资产、实际命令、fingerprint 和 gate，再单独运行 feature-check：

```bash
.claude/skills/dev-flow/scripts/dev-flow-status.mjs complete-verification <feature-id> \
  --command "<actual verification command>" \
  --report <verification-report> [--manual-test <manual-test-report>]
.claude/skills/dev-flow/scripts/dev-flow-feature-check <feature-id> --finish
```

`complete-verification` 只调用 validator/fingerprint，不调用 feature-check、不生成 check-ok；不得手改 status 或把两条命令封装成脚本互调。

检查失败时停止收尾，不能提供「验证通过」的合并、推送或 PR 选项。`outcome: partial`（手测 skipped + 已接受 AR + partial-acceptance 三方一致）允许继续资产 dry-run，但文案必须是 partial，并展示未验证步骤与风险摘要，禁止写成「验证通过」。

无风险 XS/S 与默认轻量 M（无 `status.md`）跳过本步与资产 finalization，直接进入 Git 选项。

## 第 2 步：最终资产与 dry-run（状态 B）

检查通过后，生成或更新两个最终资产：

```text
<FEATURE_ROOT>/<feature-id>/feature.md
<FEATURE_ROOT>/<feature-id>/completion.md
```

`feature.md` 汇总最终需求边界、非目标、Requirement IDs、最终方案、依赖关系和计划偏差；`completion.md` 汇总 gate 结果、代码/安全审查、验证命令与人工实测、accepted risks、commit/PR 和业务 diff fingerprint，frontmatter 结构见 `dev-flow/references/protocol.md`，并写入当前 contract 的 `workflow_version`。风险标签任务必须保留风险标签、审批证据和验证结论摘要。`outcome: partial` 时，每个 `accepted_risks` ID 必须有且只有一个 `## AR-xxx` 段，包含有意义的 `reason` 与 `evidence`；`verified` 不写 AR 段。不可复用的手测结果写入 `completion.md`，只有明确标记为 `reusable: true` 的脚本保留为长期 `manual-test.md`。

读取项目适配层的 `dev_flow.artifacts.retention` 作为默认策略，运行 dry-run（**禁止同回合 `--confirm`**）：

```bash
.claude/skills/dev-flow/scripts/dev-flow-feature-finalize <feature-id> --retention=<compact|full>
```

输出清单、统计和 inventory hash 后，必须输出停止协议并**立即停止当前回合**：

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

禁止：

- 同回合自动运行 `--confirm`。
- 把用户之前的 implementation approval 当 finalization 确认。
- 把“继续”“好的”“完成吧”等模糊回复视为删除/归档授权。
- 未收到精确选择时进入 Git 收尾。

## 第 2.5 步：用户精确选择（状态 C/D/E）

仅接受精确回复（整行匹配，不模糊）：

### `compact`（状态 C）

```bash
.claude/skills/dev-flow/scripts/dev-flow-feature-finalize <feature-id> \
  --retention=compact --confirm --inventory <sha256>
```

compact：清理中间资产；保留 `feature.md`、`completion.md`、可复用 `manual-test.md`；本轮不新建 archive。

### `retain full`（状态 D）

使用**同一** inventory（无需第二次 dry-run）：

```bash
.claude/skills/dev-flow/scripts/dev-flow-feature-finalize <feature-id> \
  --retention=full --confirm --inventory <sha256>
```

full：把中间资产复制到 `<FEATURE_ROOT>/<feature-id>/archive/<timestamp>-<nonce>/{reviews,feature}/`；review-root 当前 feature 残留必须为 0。

### `not now`（状态 E）

- 不调用 finalizer。
- status、feature、completion 和中间资产保持原样；check-ok 保留。
- 只能声明“验证已完成/partial，但资产尚未 finalized”；禁止“可提交”“已收尾”。
- finish-guard 对 git commit/push/merge 返回 ask（verified-unfinalized）。
- doctor 输出 ready-to-finalize WARN。
- 业务代码再改会使 fingerprint 变化、check-ok 自动 stale。
- 再次 `/finish`：fingerprint 未变可复用验证；已变必须重跑 verification + feature-check；无论是否复用都重新 dry-run 生成 inventory。

`--confirm` 必须带 `--inventory <sha256>`。hash 漂移时 finalizer 零修改失败，要求重新 dry-run 并再次停等。

资产处理成功后再次运行 `dev-flow-feature-check <feature-id> --finish`，确认 finalized 形态通过，再进入 Git 分支选项。

## 第 3 步：判断环境

检查：

```bash
git rev-parse --git-dir
git rev-parse --git-common-dir
git branch --show-current
```

判断：普通仓库或 worktree + 命名分支显示标准 4 选项；detached HEAD 显示 3 选项，不提供本地合并。

## 第 4 步：找基线分支

优先尝试 `git merge-base HEAD main` / `git merge-base HEAD master`；不确定时询问用户。

## 第 5 步：给用户选项

仅在 finalization 成功（或无 status 的 XS/S 路径）后展示。普通仓库或命名 worktree：

```text
实现已闭环（outcome: verified|partial），feature evidence 已通过 feature-check，资产已 finalized。partial 时不得宣称「验证通过」。请选择：

1. 本地合并回 <base-branch>
2. 推送并创建 Pull Request
3. 保留当前分支，我稍后处理
4. 丢弃这次工作
```

detached HEAD：

```text
实现已通过验证。当前是 detached HEAD：

1. 推送为新分支并创建 Pull Request
2. 保留当前状态，我稍后处理
3. 丢弃这次工作
```

## 第 6 步：执行选择

- 合并：先切回基线分支、更新、合并，再验证。合并成功后再清理 worktree 和删除分支。
- PR：推送分支，不清理 worktree，方便处理反馈。
- 保留：只报告分支和路径。
- 丢弃：必须要求用户输入精确确认词 `discard`，再删除。

## 清理规则

只清理我们创建且位于 `.worktrees/` 或 `worktrees/` 下的 worktree。宿主管理的工作区不要删除。
