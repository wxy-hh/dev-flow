# Git 工作流 (Git Workflow)

## 提交信息格式 (Commit Message Format)

```
<type>: <description>

<optional body>
```

类型 (Types): feat, fix, refactor, docs, test, chore, perf, ci

提交归因、签名和用户身份以当前 Git/Claude 环境配置为准；项目规则不假设本机全局设置。

## 拉取请求工作流 (Pull Request Workflow)

创建 PR 时：
1. 分析完整的提交历史（不仅是最近一次提交）
2. 使用 `git diff [base-branch]...HEAD` 查看所有变更
3. 起草详尽的 PR 摘要
4. 包含实际执行过或计划执行的测试说明，避免占位项
5. 如果是新分支，使用 `-u` 参数推送

## 提交与推送边界 (Commit & Push Boundaries)

- 默认不执行 `git add`、`git commit`、`git push`、合并、回滚、丢弃或删除分支，只提示建议暂存文件和提交信息。
- 用户明确要求“帮我提交”“帮我 commit”时，可以执行 `git add` 和 `git commit`；执行前先展示文件列表、验证结果和 commit message。
- `git push`、merge/rebase、删除分支、discard/reset/checkout 覆盖文件等高风险动作必须二次确认；丢弃改动类操作使用精确确认词。

## 功能实现工作流

分级、验证矩阵选择和代码评审的唯一来源是 `.claude/skills/dev-flow/SKILL.md` 及其 `references/`；本文件不重复维护副本。
