# Claude dev-flow 迁移使用说明

## 目标

把当前 Claude dev-flow 沉淀成可迁移的工作流包。迁移时只复制流程层，项目事实必须在新项目中重新检测生成。

核心原则：

```text
流程层可复制，项目适配层必须重新生成。
```

## 迁移包内容

复制这些目录和文件到新项目：

```text
.claude/
  skills/
  commands/
  agents/
  rules/
    git-workflow.md
    security.md
    specs/README.md
    project-workflow.template.md
docs/
  claude-dev-flow-migration.md
  claude-dev-flow-smoke-test.md
templates/
  CLAUDE.dev-flow-snippet.md
```

按项目类型选择是否复制语言或框架规则：

```text
.claude/rules/vue3.md        # Vue 项目才复制
```

不要直接复制旧项目的成品适配文件：

```text
.claude/rules/project-workflow.md
```

该文件必须在新项目中由模板生成。

如果目标项目已有 `CLAUDE.md`，把 `templates/CLAUDE.dev-flow-snippet.md` 合并到合适位置；如果没有，可以基于该片段创建 `CLAUDE.md`，再补充目标项目自己的技术栈、常用命令和禁止事项。

## 推荐目录结构

迁移到新项目后，目标形态是：

```text
.claude/
  skills/
  commands/
    onboard-dev-flow.md
    dev-task.md
    finish.md
    review-diff.md
  agents/
  rules/
    project-workflow.template.md
    project-workflow.md
    git-workflow.md
    security.md
    specs/
      README.md
docs/
  claude-dev-flow-migration.md
  claude-dev-flow-smoke-test.md
```

`project-workflow.template.md` 是迁移模板；`project-workflow.md` 是当前项目真实配置。

## 迁移步骤

### 1. 复制流程层

从源项目复制 `.claude/skills`、`.claude/commands`、`.claude/agents` 和通用 rules。

如果新项目不是 Vue，不要复制 Vue 专属规则，或复制后重命名为对应技术栈规则。

### 2. 运行 onboarding

在新项目中运行：

```text
/onboard-dev-flow
```

如果希望同时验证迁移包：

```text
/onboard-dev-flow --smoke-test
```

onboarding 会根据 `.claude/rules/project-workflow.template.md` 检测并生成：

```text
.claude/rules/project-workflow.md
```

生成的 `project-workflow.md` 必须保留 frontmatter 中的 `dev_flow` 结构化配置块。该配置块是 doctor 和后续脚本的机器可读锚点，Markdown 表格是给人类阅读的说明；两者的路径、命令和能力值必须一致。

### 3. 检测项目事实

必须检测并写入这些内容：

| 类别 | 检测内容 |
|------|----------|
| 项目类型 | Vue / React / Next / Node backend / monorepo / other |
| 包管理器 | lock 文件、package manager 配置 |
| 脚本 | install、dev、build、type-check、lint、test、format |
| 测试能力 | test 是否是真测试运行器，是否有 Vitest/Jest/Playwright/Cypress |
| 浏览器验证 | 是否启用 webapp-testing，dev server 命令、协议和端口 |
| OpenSpec | 是否存在 openspec，是否维护 living baseline |
| 文档能力 | 是否有 CODEMAPS 或文档生成流程 |
| 局部规范 | 是否已有 `.claude/rules/specs/<scope>/index.md`，没有也可以保留为空能力 |
| Git 边界 | `.claude/` 和 `CLAUDE.md` 是本地配置还是仓库治理文件 |
| Agent 启用 | 哪些 agent 可作为默认门禁，哪些只在用户明确要求时使用 |

这些事实同时写入 `dev_flow` 配置：

```yaml
dev_flow:
  version: "0.2.0"
  project_kind: "<vue|react|next|node|monorepo|other>"
  package_manager: "<pnpm|npm|yarn|bun|other|none>"
  paths:
    runtime_root: .claude/runtime
    feature_root: docs/dev-flow/features
    review_root: docs/dev-flow/reviews
    scoped_spec_root: .claude/rules/specs
  verification:
    type_check: pnpm type-check
    lint: pnpm lint
    build: pnpm build
    test: none
    automated_tests: "<none|present>"
    webapp_testing: "<disabled|enabled>"
  openspec:
    living_baseline: false
  git:
    mode: "<local-config|repo-governed>"
```

### 轻量三件套接口

迁移后保留这些接口，但不要把它们变成所有任务的负担：

| 接口 | 路径 | 使用边界 |
|------|------|----------|
| 机器可读状态 | `<FEATURE_ROOT>/<feature-id>/status.md` frontmatter 的 `dev_flow_status` | 轻量 L、标准 M/L、需要跨技能恢复的任务 |
| HUMAN GATE | `dev_flow_status.human_gates.{requirement_confirmation,implementation_approval}` | 标准 M/L 必须维护；轻量 L 必须记录边界确认和实现前确认 |
| 上下文清单 | `<FEATURE_ROOT>/<feature-id>/context/{implement,review,verify}.jsonl` | 轻量 L 和标准 M/L 必须维护；轻量 M 仅在已有落盘资产时维护 |
| 局部规范 | `<SCOPED_SPEC_ROOT>/<scope>/index.md` | 可选；M/L 明确命中 scope 时读取 |

XS/S 不创建 `status.md` 或 context manifest；轻量 M 默认也不创建。不要为了启用三件套而改变任务分级。
标准 M/L 在需求确认前不得写实现计划，在实现前确认前不得写业务代码；实现后的 `code-review` 不能替代实现前 `plan-review`。

### 4. 生成验证矩阵

按新项目能力生成验证矩阵。不要把源项目命令带过去。

示例结构：

```markdown
| 改动类型 | 默认验证 |
|----------|----------|
| UI 页面/模板 | <detected command/check> |
| 逻辑、状态、路由、接口 | <detected command/check> |
| 样式 | <detected command/check> |
| 配置、构建脚本、依赖 | <detected command/check> |
| 文档、技能说明 | 检查目标文件；有可用校验脚本时运行校验 |
```

### 5. 决定版本管理边界

二选一：

| 模式 | 适用情况 | 处理 |
|------|----------|------|
| 本地配置模式 | 个人工作流、本地试用 | `.claude/` 可继续 ignored，验收看文件内容 |
| 仓库治理模式 | 团队共享、跨人复用 | 放开需要共享的治理文件，继续忽略 runtime、本地设置和一次性产物 |

不要在没有决策时默认提交 `.claude/`。

### 6. 跑迁移后 smoke test

先运行静态自检：

```bash
.claude/skills/dev-flow/scripts/dev-flow-doctor
```

按 [claude-dev-flow-smoke-test.md](./claude-dev-flow-smoke-test.md) 执行。

smoke test 通过后，再开始真实业务任务。

## 适配不同项目的判断

### Vue / React 单页应用

- 通常需要 UI 行为验证。
- 如果没有 E2E，L 级行为验证必须有手动测试脚本。
- 组件、路由、状态和 API 改动通常是 M 或 L。

### Next / SSR 项目

- 区分 client / server / route handler / middleware。
- 鉴权 middleware、session、redirect 通常是 L。
- 构建验证和运行时验证都很重要。

### Node 后端

- API、数据库、权限、数据删除和事务通常是 M/L。
- 如果有集成测试，`automated-tests` 应为 `present`。
- 行为验证可以是 API 调用脚本，而不一定是浏览器。

### Monorepo

- `<FEATURE_ROOT>` 和 `<REVIEW_ROOT>` 可以放仓库根。
- 验证矩阵要按 package/workspace 分层。
- `dev-flow` 任务必须明确影响的 package。
- 可以按 package 增加 `.claude/rules/specs/<package>/index.md`，但只有当团队愿意维护具体规则时才创建。

## 迁移完成标准

满足以下条件才算迁移完成：

- `.claude/rules/project-workflow.md` 已由模板生成，不是旧项目复制品。
- 验证矩阵里的命令能在新项目解释清楚。
- test strategy 明确是 `none` 还是 `present`。
- OpenSpec 策略明确是 `living-baseline: false` 还是 `true`。
- 启用/禁用 agents 有理由。
- 三件套路径已写入 `dev_flow.paths` 和标准资产表；没有实际局部规范时也说明为空能力。
- `dev-flow doctor` 通过。
- smoke test 通过。

## 常见错误

- 直接复制旧项目的 `project-workflow.md`。
- 把 `npm test`、`pnpm test` 等命令默认当成真实测试。
- 把浏览器验证能力写成 enabled，但项目没有 dev server 或 Playwright/Browser 能力。
- `.claude/` 被 ignored，却以为 git diff 能看到迁移结果。
- 在非 Vue 项目里保留 Vue 专属规则。
- 为了三件套让 XS/S 或轻量 M 也强制生成流程产物。
- 在没有真实局部约定时创建空的 scope 规范。
- 没有跑 smoke test 就开始真实 L 级任务。

## 迁移后建议

先用一个真实但低风险的 M 级任务试跑，再用一个轻量 L 场景验证 HUMAN GATE、安全审查、行为验证和回撤证据。确认没有流程摩擦后，再把迁移包作为团队默认入口。

迁移完成后的日常使用方式、任务描述示例、产物位置和维护规则，见 [迁移后使用说明](./claude-dev-flow-post-migration-usage.md)。
