# Commands

这些命令是日常使用 Claude Code 的推荐入口。它们负责把“我要做什么”转换成稳定流程，避免每次都靠临时提示词。

## 推荐入口

| 命令 | 用途 | 何时使用 |
|------|------|----------|
| `/dev-task` | 新需求入口，先判断 XS/S/M/L | 新功能、bug 修复、业务改动、UI 修改 |
| `/onboard-dev-flow` | 新项目适配 Claude dev-flow | 复制迁移包到新项目后 |
| `/fix-build` | 修复类型检查或构建错误 | 项目适配层定义的类型检查或构建验证失败 |
| `/review-diff` | 审查当前工作区改动 | 写完代码后、提交前、合并前 |
| `/finish` | 收尾检查和验证汇总 | 准备结束一个任务时 |
| `/commit` | 生成提交建议 | 已完成验证，需要整理 commit message 时 |

## 使用原则

- 小改动走 `/dev-task` 后直接实现和验证，不生成额外文档。
- XS/S 和默认轻量 M 不因为 `status.md`、context manifest 或局部规范机制而增加流程产物。
- 迁移到新项目后先运行 `/onboard-dev-flow`，不要直接复用旧项目的 `project-workflow.md`。
- M/L 级改动交给 `dev-flow` 串联需求、计划、覆盖、审查、回撤和验证。
- `/review-diff` 只报告真实风险，不输出风格偏好。
- `/finish` 必须有新鲜验证证据，验证失败时不能给出“完成”结论。
- Git 提交和推送默认由用户确认后再执行。
