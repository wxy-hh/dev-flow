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
   - 是否已有 `.claude/rules/specs/<scope>/index.md` 局部规范；没有也可以保留为空能力。
3. 根据检测结果生成或更新 `.claude/rules/project-workflow.md`，并填充 frontmatter 中的 `dev_flow` 结构化配置。
4. 输出适配摘要：
   - 验证命令矩阵。
   - test strategy。
   - OpenSpec 策略。
   - scoped spec 和 context manifest 路径。
   - HUMAN GATE 字段和标准 M/L 停顿边界。
   - 启用 / 禁用 agents。
   - 版本管理边界。
5. 运行 `.claude/skills/dev-flow/scripts/dev-flow-doctor` 做静态自检。
6. 如果用户传入 `--smoke-test`，按 `docs/claude-dev-flow-smoke-test.md` 跑迁移后 smoke test。

## 输出要求

- 不修改业务代码。
- 不自动提交。
- 不复用旧项目的 `project-workflow.md` 事实。
- 发现无法判断的命令或能力时，写成 `none` 或 `needs-confirmation`，不要猜。
- `project-workflow.md` 必须保留 `dev_flow` 配置块，且配置值要与 Markdown 表格一致。
- `dev_flow.paths.scoped_spec_root` 默认写 `.claude/rules/specs`；不要因为没有真实 scope 就生成空规范。
- 标准资产中必须包含 `status.md` 的 `dev_flow_status`、`human_gates` 结构和 context manifest 路径。
- 生成后的说明必须写清：标准 M/L 需求确认前不写计划，实现前确认前不写代码；`code-review` 不能替代 `plan-review`。
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
- dev-flow doctor：通过/失败
- <check>：通过/失败
```
