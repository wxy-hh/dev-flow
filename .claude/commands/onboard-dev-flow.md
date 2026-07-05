# /onboard-dev-flow — 新项目适配 Claude dev-flow

用于把 Claude dev-flow 迁移到一个新项目后，生成或刷新 `.claude/rules/project-workflow.md`。

## 使用

```text
/onboard-dev-flow
```

可选：

```text
/onboard-dev-flow --repo-governed
/onboard-dev-flow --local-config
/onboard-dev-flow --smoke-test
```

## 流程

1. 读取 `.claude/rules/project-workflow.template.md`。
2. 检查当前项目：
   - 包管理器和 lock 文件。
   - 项目脚本：install、dev、build、type-check、lint、test、format、preview。
   - test 是否是真测试运行器。
   - 是否存在 OpenSpec、Playwright/Cypress、Vitest/Jest、代码映射或文档生成流程。
   - git 是否可用，`.claude/` 和 `CLAUDE.md` 是否被忽略。
   - 项目类型：Vue、React、Next、Node backend、monorepo 或其它。
3. 根据检测结果生成或更新 `.claude/rules/project-workflow.md`。
4. 输出适配摘要：
   - 验证命令矩阵。
   - test strategy。
   - OpenSpec 策略。
   - 启用 / 禁用 agents。
   - 版本管理边界。
5. 如果用户传入 `--smoke-test`，按 `docs/claude-dev-flow-smoke-test.md` 跑迁移后 smoke test。

## 输出要求

- 不修改业务代码。
- 不自动提交。
- 不复用旧项目的 `project-workflow.md` 事实。
- 发现无法判断的命令或能力时，写成 `none` 或 `needs-confirmation`，不要猜。
- 生成后运行项目适配层中的文档/技能自检命令。

## 完成格式

```text
已生成/更新 .claude/rules/project-workflow.md。
检测结果：
- package-manager:
- build:
- type-check:
- lint:
- automated-tests:
- webapp-testing:
- living-baseline:
- version boundary:

验证：
- <check>：通过/失败
```
