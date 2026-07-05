---
name: finishing-a-development-branch
description: 实现完成且需要决定如何收尾时使用：先验证，再判断环境，再给出合并、推送 PR、保留或丢弃的选项。
---

# 完成开发分支

用于实现完成后的收尾。不要在验证前提供“完成”结论。

先读取项目适配层。Claude 环境默认读取 `.claude/rules/project-workflow.md`，从中获取验证配置、OpenSpec baseline 策略和当前项目的分支收尾约束。

开场说明：

```text
正在使用 finishing-a-development-branch 完成收尾。
```

优先读取用户手动引用的验证报告、`<FEATURE_ROOT>/<feature-id>/status.md` 或上一步 `[HANDOFF]` 的 `Next inputs`。如果已有新鲜验证报告，也要核对当前工作区没有新的未验证改动；有新改动时重新验证。

如果项目适配层声明 `living-baseline: true`，收尾前必须检查对应 OpenSpec change 是否已经 archive 并回写 baseline。当前项目为 `living-baseline: false` 时，不做 baseline 回写，只在收尾摘要中说明 OpenSpec 是 point-in-time 记录。

## 第 1 步：完成前验证

根据改动风险运行项目适配层定义的验证命令或检查。不要把当前项目的命令复制到本技能正文；迁移项目时只更新适配层。

如果验证失败，停止收尾，报告失败摘要。不要合并、推送或删除分支。

## 第 2 步：判断环境

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

## 第 3 步：找基线分支

优先尝试：

```bash
git merge-base HEAD main
git merge-base HEAD master
```

不确定时询问用户。

## 第 4 步：给用户选项

普通仓库或命名 worktree：

```text
实现已通过验证。请选择：

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

## 第 5 步：执行选择

- 合并：先切回基线分支、更新、合并，再验证。合并成功后再清理 worktree 和删除分支。
- PR：推送分支，不清理 worktree，方便处理反馈。
- 保留：只报告分支和路径。
- 丢弃：必须要求用户输入精确确认词 `discard`，再删除。

## 清理规则

只清理我们创建且位于 `.worktrees/` 或 `worktrees/` 下的 worktree。宿主管理的工作区不要删除。
