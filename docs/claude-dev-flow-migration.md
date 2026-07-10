# Claude dev-flow 迁移说明

## 原则

```text
流程层可以复制，项目事实必须重新检测。
```

dev-flow 0.4 只需要一个项目适配文件和一个可选任务工作文件。迁移不复制旧项目的路径、命令、测试能力或 Git 决策。

## 复制范围

复制：

```text
.claude/
  skills/
  commands/
  agents/
  rules/
    project-workflow.template.md
    git-workflow.md
    security.md
    specs/README.md
docs/
  claude-dev-flow-migration.md
  claude-dev-flow-smoke-test.md
templates/
  CLAUDE.dev-flow-snippet.md
```

语言规则按项目选择，例如 Vue 项目才复制 `.claude/rules/vue3.md`。

不要复制旧项目生成的 `.claude/rules/project-workflow.md`。目标项目必须从模板重新生成。

## 迁移步骤

### 1. 合并入口

把 `templates/CLAUDE.dev-flow-snippet.md` 合并进目标项目 `CLAUDE.md`。保留目标项目已有的技术栈、命令和禁止事项。

### 2. 运行 onboarding

```text
/onboard-dev-flow
```

或：

```text
/onboard-dev-flow --smoke-test
```

### 3. 检测项目事实

必须实际确认：

- 项目类型与 monorepo 边界。
- package manager 和 lock 文件。
- install、dev、build、type-check、lint、format、test 命令。
- test 是否为真实测试运行器。
- 浏览器或其它运行时验证能力。
- Git 是本地配置还是仓库治理。
- 已存在的局部工程规则。

无法确认时写 `none` 或 `needs-confirmation`，不能猜。

### 4. 生成 0.4 配置

示例：

```yaml
dev_flow:
  version: "0.4.0"
  project_kind: "next"
  package_manager: "pnpm"
  paths:
    feature_root: "docs/dev-flow/features"
    scoped_spec_root: ".claude/rules/specs"
  verification:
    install: "pnpm install"
    dev: "pnpm dev"
    build: "pnpm build"
    build_only: "none"
    type_check: "pnpm typecheck"
    lint: "pnpm lint"
    lint_changed: "none"
    format: "none"
    test: "pnpm test"
    automated_tests: "present"
    runtime_verification: "required"
    webapp_testing: "enabled"
  git:
    mode: "repo-governed"
```

frontmatter 是唯一配置事实源，不在正文复制命令矩阵。

### 5. 运行静态与场景检查

```bash
.claude/skills/dev-flow/scripts/dev-flow-doctor
.claude/skills/dev-flow/scripts/tests/dev-flow-feature-check-test
```

然后按 [smoke test](./claude-dev-flow-smoke-test.md) 验证五种代表场景。

## 0.3 升级到 0.4

这是任务资产契约变更：

- 新任务只使用 `<feature_root>/<feature-id>/work.md`。
- 已完成的旧任务记录保持原样，不批量转换。
- 正在执行的旧任务建议先用旧版本完成；必须升级时，只把仍有效的 Boundary、未完成批次、风险、回撤和验证摘要到一个新 `work.md`。
- 不复制历史报告全文，也不维护两套进度事实。

## 不同项目的适配重点

### SPA / SSR

- 区分页面、客户端状态、服务端路由、中间件和共享层。
- UI 行为需要浏览器或明确人工证据。
- 跨三个以上层、共享路由/状态或多入口一致性通常是 L。

### Node 后端

- API、队列、Worker、数据库和外部系统按真实调用链判断。
- 事务、数据完整性、计费和权限分别触发风险标签。
- 有集成测试时明确配置，不把服务启动命令当测试。

### Monorepo

- `feature_root` 放在仓库级稳定目录。
- 计划批次说明影响的 package 和共享契约。
- 跨 Web/API/Queue/Worker/Shared 的协议传播是 L 强信号，不以文件数降级。

## Git 模式

- `local-config`：工作流仅个人使用，`.claude/` 可以忽略。
- `repo-governed`：团队共享必要规则，仍忽略本地设置和密钥。

onboarding 不自动提交。是否加入版本控制由用户或团队明确决定。

## 迁移完成标准

- 配置由当前项目检测生成，没有未解析占位符。
- `feature_root` 是仓库内安全相对路径。
- 验证命令真实可运行，测试能力没有夸大。
- doctor 与 checker 测试通过。
- 五个 smoke 场景路由符合预期。
- 普通小任务不会生成流程文件，高风险任务不能在风险卡后无确认继续。
