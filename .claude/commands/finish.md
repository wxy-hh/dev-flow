# /finish — 收尾检查

1. 查看 `git status --short`、diff 范围和本轮目标。
2. 从 `.claude/rules/project-workflow.md` 选择能证明结果的验证：
   - 文档/规则：文本和脚本自检。
   - 源码/类型：相关 type-check、lint、test。
   - 构建/接口/关键页面：build、集成或运行时验证。
3. 基于真实 diff 做一次代码审查，处理阻塞问题后重跑受影响验证。
4. 若任务存在 `work.md`，确认所有批次已完成、State 与实际一致，并运行：

```bash
.claude/skills/dev-flow/scripts/dev-flow-feature-check <feature-id> --finish
```

5. 汇报改动、实际验证结果和残留风险。没有新鲜证据或检查器失败时，不得声称完成或可提交。

不自动生成总结文档，不自动归档/删除资产，也不自动执行 Git 提交、推送、合并或回滚。
