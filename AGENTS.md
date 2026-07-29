# 仓库指南

## 项目结构与模块组织

Dev Flow 插件位于 `plugins/dev-flow/`。TypeScript 代码按职责划分：`src/core/` 负责工作流状态与执行约束，`src/policy/` 定义合同，`src/mcp/` 暴露工具。宿主适配器在 `src/hosts/` 与 `hosts/`；技能和清单在 `skills/`、`.claude-plugin/`、`.codex-plugin/`。生成的 bundle 位于 `plugins/dev-flow/dist/` 且受版本控制，只能通过构建脚本更新。测试分别位于 `tests/unit/`、`tests/e2e/`、`tests/e2e/routes/`，共享 fixture 与辅助工具在 `tests/fixtures/`、`tests/helpers/`。

## 构建、测试与开发命令

- `npm run typecheck`：运行严格 TypeScript 检查，不生成文件。
- `npm run test:unit`：通过 Node 测试运行器执行基于源码的单元测试。
- `npm run test:routes`：验证每条受支持的工作流路线。
- `npm run test:interop`：验证 Claude 与 Codex 的交接行为。
- `npm run build`：重新生成三个受版本控制的插件 bundle。
- `npm test`：执行面向发布的完整验证序列。

除非任务明确需要更新 bundle，否则中间修改不要运行 `npm run build`。

## 代码风格与命名约定

使用严格类型的 TypeScript ESM、两个空格缩进、双引号、分号，以及用于跨模块合同的显式导出接口。沿用既有命名：文件使用 kebab-case（如 `state-store.ts`），函数使用 camelCase，类型使用 PascalCase，错误码使用全大写（如 `TRACE_GRAPH_INVALID`）。策略判断保持纯函数；文件 I/O 放在 `core/` 的 store 中。

## 测试指南

每次行为变更都要新增或更新聚焦的 `*.test.mjs` 测试。单元测试使用 `node:test`、`node:assert/strict` 和 `tests/helpers/load-source.mjs`。先运行目标测试，再运行 `npm run typecheck`、`npm run test:unit`，以及受影响的路线或交互测试。源码测试不得依赖生成的 `dist/`。

## 提交与 Pull Request 规范

近期历史采用带 scope 的 Conventional Commit 风格，例如 `feat(dev-flow): validate traceability graph`、`docs(dev-flow): update routes`。提交应保持聚焦并说明行为变化。PR 应说明工作流影响、列出验证命令、关联相关 issue 或计划；仅在用户可见 UI 变更时附截图。

## 智能体专属规则

智能体不得运行 `git commit`、`git push`、创建 PR 或以其他方式发布变更。完成验证后，只报告变更文件和测试结果供用户审核。所有 Git 提交和发布均由用户本人审核后手动执行。
