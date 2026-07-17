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
- XS/S 和默认轻量 M 不因为 `status.md` 或局部规范机制而增加流程产物。
- 迁移到新项目后先运行 `/onboard-dev-flow`，不要直接复用旧项目的 `project-workflow.md`。
- M/L 级改动交给 `dev-flow` 串联需求、计划、覆盖、审查、回撤和验证。
- 标准 M/L 和携带风险标签的任务的关键 HUMAN GATE 不能被自动跨过；`code-review` 不能替代实现前 `plan-review`。
- 标准 L 中，`writing-plans` 后要先跑 `requirements-coverage`，覆盖通过后再跑 `plan-review`；不要用对话里的实现计划替代正式计划文档。
- `/review-diff` 只报告真实风险，不输出风格偏好。
- `/finish` 先调用 `dev-flow-status next`，一次推进一个 blocker；必须有新鲜验证证据。1.0 中 logic-complete 后可 Git，`not now` 不阻塞，compact 含 untracked 删除时须 exact token。
- Git 提交和推送默认由用户确认后再执行。
