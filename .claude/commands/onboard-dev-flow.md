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
   - 项目脚本：install、dev、build、build-only、type-check、lint、lint_changed、test、format、preview。
   - test 是否是真测试运行器。
   - 是否存在 OpenSpec、Playwright/Cypress、Vitest/Jest、代码映射或文档生成流程。
   - git 是否可用，`.claude/` 和 `CLAUDE.md` 是否被忽略。
   - 项目类型：Vue、React、Next、Node backend、monorepo 或其它。
   - 是否已有 `.claude/rules/specs/<scope>/index.md` 局部规范；没有也可以保留为空能力。
3. 根据检测结果生成或更新 `.claude/rules/project-workflow.md`，并填充 frontmatter 中的 `dev_flow` 结构化配置。
4. 确认 `.claude/settings.json` 已注册 `dev-flow-gate-guard`、`dev-flow-finish-guard` 两个 hooks，`.claude/hooks/*` 可执行；缺失可执行位时补上而不是跳过。按项目目录结构（如 `src/auth/**`、`src/payment/**`）生成 `dev_flow.label_hints` 初始猜测，没有明显敏感路径时留空数组。
5. 输出适配摘要：
   - 验证命令矩阵。
   - test strategy。
   - OpenSpec 策略。
   - scoped spec 路径。
   - label_hints 初始猜测。
   - hooks 注册状态。
   - HUMAN GATE 字段和标准 M/L 停顿边界。
   - 启用 / 禁用 agents。
   - 版本管理边界。
   - 资产保留策略，默认 `dev_flow.artifacts.retention: compact`。
6. 运行 `.claude/skills/dev-flow/scripts/dev-flow-doctor` 做静态自检。
7. 如果用户传入 `--smoke-test`，按 `docs/claude-dev-flow-smoke-test.md` 跑迁移后 smoke test。

## 输出要求

- 不修改业务代码。
- 不自动提交。
- 不复用旧项目的 `project-workflow.md` 事实。
- 发现无法判断的命令或能力时，写成 `none` 或 `needs-confirmation`，不要猜。
- `project-workflow.md` 必须保留 `dev_flow` 配置块，且配置值要与 Markdown 表格一致。
- `dev_flow.paths.scoped_spec_root` 默认写 `.claude/rules/specs`；不要因为没有真实 scope 就生成空规范。
- 标准资产表不复制 `status.md` 的字段结构；schema、`human_gates`、`risk_evidence` 和更新规则统一指向 `dev-flow/references/protocol.md`。
- `dev_flow.label_hints` 是可选提示，允许留空数组，不强制每个项目都能猜出敏感路径，也不能替代实际风险判断。
- 生成后的说明必须写清：标准 M/L 需求确认前不写计划，实现前确认前不写代码；标准 L 计划后先跑 `requirements-coverage` 再跑 `plan-review`；`code-review` 不能替代 `plan-review`。
- 生成后运行项目适配层中的文档/技能自检命令。
- 生成后确认 `.claude/rules/project-workflow.md` 包含 `artifacts.retention`；标准 M/L、轻量 L 与 risk-minimal 功能收尾时再运行 `dev-flow-feature-check`。

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
- hooks:
- label_hints:

验证：
- dev-flow doctor：通过/失败
- <check>：通过/失败
```
