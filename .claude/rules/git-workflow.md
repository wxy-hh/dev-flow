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

## 功能实现工作流 (Feature Implementation Workflow)

1. **先分级再行动**
   - 按改动拓扑判断 XS / S / M / L，再独立识别真实风险标签
   - 普通 XS/S/M 保持轻量；L 使用一个 `work.md` 按可验证批次执行
   - 高风险任务在风险卡之后等待用户确认，不因文件少或“直接改”越过门禁

2. **验证贴合改动风险**
   - 先读取 `.claude/rules/project-workflow.md` 的验证配置
   - 文案、样式、配置改动：运行适配层定义的格式、搜索或局部检查
   - 源码或类型改动：运行适配层定义的类型检查和代码检查
   - 路由、接口、构建配置、关键页面改动：运行适配层定义的构建或集成验证
   - UI 行为改动：必要时启动适配层定义的开发服务并做浏览器验证

3. **代码评审 (Code Review)**
   - M/L 级改动完成后使用代码审查视角检查真实 diff
   - 优先解决会导致 Bug、安全风险、回归或缺少验证的问题
   - 结论写入对话或已有 `work.md`；对 XS/S 不制造审查文档

4. **提交与推送 (Commit & Push)**
   - 默认不执行 `git add`、`git commit`、`git push`、合并、回滚、丢弃或删除分支，只提示建议暂存文件和提交信息。
   - 用户明确要求“帮我提交”“帮我 commit”时，可以执行 `git add` 和 `git commit`；执行前先展示文件列表、验证结果和 commit message。
   - `git push`、merge/rebase、删除分支、discard/reset/checkout 覆盖文件等高风险动作必须二次确认；丢弃改动类操作使用精确确认词。
