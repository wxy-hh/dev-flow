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
   - 默认按照项目 `dev-flow` 判断 XS / S / M / L
   - XS/S 走轻量实现和相关验证
   - M/L 先固化需求、写计划，再按风险维度触发覆盖、审查、回撤、安全和行为验证门禁

2. **验证贴合改动风险**
   - 先读取 `.claude/rules/project-workflow.md` 的验证配置
   - 文案、样式、配置改动：运行适配层定义的格式、搜索或局部检查
   - Vue/TypeScript 改动：运行适配层定义的类型检查和代码检查
   - 路由、接口、构建配置、关键页面改动：运行适配层定义的构建或集成验证
   - UI 行为改动：必要时启动适配层定义的开发服务并做浏览器验证

3. **代码评审 (Code Review)**
   - M/L 级改动完成后使用代码审查视角检查 diff
   - 优先解决会导致 Bug、安全风险、回归或缺少验证的问题
   - 对 XS/S 改动保持轻量，避免为了流程制造无关文档

4. **提交与推送 (Commit & Push)**
   - **严禁自动提交**：所有代码修改完成后，由用户手动执行 git commit 和 git push
   - 可以提示用户需要提交的文件和建议的提交信息，但不能自动执行提交操作
