---
name: using-git-worktrees
description: 开始较大功能、执行实现计划前，需要隔离当前工作区时使用。先检测是否已在隔离工作区，再优先使用平台原生能力，最后才使用 git worktree。
---

# 使用 Git Worktree

目标：让较大功能在隔离空间中开发，避免污染用户当前分支。

核心原则：

```text
先检测现状 → 优先平台原生能力 → 再考虑 git worktree → 不和宿主环境抢控制权。
```

## 第 0 步：检测是否已隔离

运行：

```bash
git rev-parse --git-dir
git rev-parse --git-common-dir
git branch --show-current
git rev-parse --show-superproject-working-tree
```

判断：

- `git-dir != git-common-dir` 且不是 submodule：已经在 worktree，不要再创建。
- detached HEAD：视为宿主管理的隔离环境，完成时再决定是否建分支。
- 普通仓库：询问用户是否需要隔离，除非用户或计划已明确要求。

## 第 1 步：创建隔离工作区

优先顺序：

1. 如果平台有原生 worktree/分支工具，优先使用。
2. 如果没有原生工具，使用 git worktree。
3. 目录优先级：用户指定目录 → 已存在 `.worktrees/` → 已存在 `worktrees/` → 默认 `.worktrees/`。

创建项目前，确保工作区目录被忽略：

```bash
git check-ignore -q .worktrees || git check-ignore -q worktrees
```

如果未被忽略，先把目录加入 `.gitignore`。

## 第 2 步：项目准备

先读取项目适配层和项目说明，确认包管理器和安装命令。没有明确配置时，根据 lock 文件选择包管理器。

## 第 3 步：基线验证

执行项目适配层定义的轻量基线验证。

如果失败，报告失败并询问是否继续或先修复。

## 汇报格式

```text
工作区：<path>
分支：<branch 或 detached HEAD>
基线验证：通过 / 失败（摘要）
下一步：可以执行 <feature/plan>
```

## 禁止事项

- 不要在已经隔离的 worktree 里再建 worktree。
- 不要在平台有原生 worktree 工具时强行 `git worktree add`。
- 不要把 `.worktrees/` 内容提交进仓库。
- 基线验证失败时不要假装干净。
