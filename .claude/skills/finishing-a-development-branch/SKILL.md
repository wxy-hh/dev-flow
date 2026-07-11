---
name: finishing-a-development-branch
description: 实现完成且需要决定如何收尾时使用：先验证，再判断环境，再给出合并、推送 PR、保留或丢弃的选项。
---

# 完成开发分支

用于实现完成后的收尾。不要在验证前提供“完成”结论，也不要在 feature evidence 未闭环前压缩或删除中间资产。

先读取项目适配层。Claude 环境默认读取 `.claude/rules/project-workflow.md`，从中获取验证配置、OpenSpec baseline 策略和当前项目的分支收尾约束。

开场说明：

```text
正在使用 finishing-a-development-branch 完成收尾。
```

优先读取用户手动引用的验证报告、`<FEATURE_ROOT>/<feature-id>/status.md`、`<FEATURE_ROOT>/<feature-id>/context/verify.jsonl` 或上一步 `[HANDOFF]` 的 `Next inputs`。如果已有新鲜验证报告，也要核对当前工作区没有新的未验证改动；有新改动时重新验证。

如果项目适配层声明 `living-baseline: true`，收尾前必须检查对应 OpenSpec change 是否已经 archive 并回写 baseline。当前项目为 `living-baseline: false` 时，不做 baseline 回写，只在收尾摘要中说明 OpenSpec 是 point-in-time 记录。

## 第 1 步：完成前验证

根据改动风险运行项目适配层定义的验证命令或检查。不要把当前项目的命令复制到本技能正文；迁移项目时只更新适配层。

如果验证失败，停止收尾，报告失败摘要。不要合并、推送或删除分支。

## 第 1.5 步：feature evidence 检查

完成前验证报告生成后，运行：

```bash
.claude/skills/dev-flow/scripts/dev-flow-feature-check <feature-id> --finish
```

检查失败时停止收尾，不能提供“验证通过”的合并、推送或 PR 选项。用户若明确接受风险，只能把结果标记为 `partial` 并保留当前分支。

## 第 2 步：资产收尾

检查通过后，读取项目适配层的 `dev_flow.artifacts.retention`，生成两个最终资产：

```text
<FEATURE_ROOT>/<feature-id>/feature.md
<FEATURE_ROOT>/<feature-id>/completion.md
```

`feature.md` 汇总最终需求边界、非目标、Requirement IDs、最终方案、依赖关系和计划偏差；`completion.md` 汇总 gate 结果、代码/安全审查、验证命令与人工实测、accepted risks、commit/PR 和业务 diff fingerprint。风险标签任务必须保留风险标签、审批证据和验证结论摘要。不可复用的手测结果写入 `completion.md`，只有明确标记为 `reusable: true` 的脚本保留为长期 `manual-test.md`。

`completion.md` 必须以以下机器可读 frontmatter 开头：

```yaml
---
dev_flow_completion:
  schema_version: "1"
  feature_id: "<feature-id>"
  level: "<M|L>"
  outcome: "verified|partial"
  risk_labels: []
  risk_approval_evidence: ""
  risk_verification_summary: ""
  completed_at: "<timestamp>"
  retention: "compact|full"
  business_diff_fingerprint: "<git-hash>"
  commits: []
  pull_request: "none"
  accepted_risks: []
---
```

risk-summary fields required when risk_labels is non-empty.

- `compact`：最终资产写入并通过检查后，清理原始需求/计划、coverage、review、rollback、verification、status 和 context manifest。
- `full`：不删除原始资产，将它们移动到 `<FEATURE_ROOT>/<feature-id>/archive/YYYYMMDD-HHMMSS/`；主目录仍只展示最终资产。
- 删除或移动前，在现有分支收尾提示中展示清单；用户未选择覆盖策略时使用 `compact`。
风险标签任务的 `completion.md` 是长期可查事实源；compact 收尾必须保留其中的风险摘要字段。

确认资产策略后执行对应命令：

```bash
.claude/skills/dev-flow/scripts/dev-flow-feature-finalize <feature-id> --retention=compact --confirm
.claude/skills/dev-flow/scripts/dev-flow-feature-finalize <feature-id> --retention=full --confirm
```

不带 `--confirm` 时脚本只输出 dry-run 清单，不修改文件。

资产处理完成后再次运行 `dev-flow-feature-check <feature-id> --finish`，确认 finalized 形态通过，再进入 Git 分支选项。

## 第 3 步：判断环境

检查：

```bash
git rev-parse --git-dir
git rev-parse --git-common-dir
git branch --show-current
```

判断：

- 普通仓库：显示标准 4 选项。
- worktree + 命名分支：显示标准 4 选项。
- detached HEAD：显示 3 选项，不提供本地合并。

## 第 4 步：找基线分支

优先尝试：

```bash
git merge-base HEAD main
git merge-base HEAD master
```

不确定时询问用户。

## 第 5 步：给用户选项

普通仓库或命名 worktree：

```text
实现已通过验证，feature evidence 已闭环，默认资产策略为 `compact`。如需保留完整原始资产，请先回复 `retain full`。请选择：

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
