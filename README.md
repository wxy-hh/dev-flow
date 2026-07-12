# dev-flow

务实开发工作流，面向 Claude Code 的项目开发流程迁移包。

dev-flow 的目标是把一次开发请求先分级，再按风险选择最小足够流程：小改动快速实现和验证，复杂改动补齐需求固化、计划、覆盖审查、回撤单元、代码审查和完成前验证。

本迁移包保留轻量优先：无风险 XS/S 不创建流程文档；携带风险标签的 XS/S 使用最小 `status.md` 证据档案；轻量 M 默认不落盘。轻量 L 和标准 M/L 会维护机器可读 `status.md` 和可选局部规范引用，方便中断恢复、审查和验证；L 级和标准 M/L 的关键 HUMAN GATE 不能被自动跨过，两个 PreToolUse hooks（ask 模式）为此提供机制层护栏，但不会引入自动任务系统或自动提交。

## 适合场景

- 新功能、业务改动、bug 修复、重构、UI 修改。
- 登录、鉴权、订单、支付、数据删除、跨系统跳转等高风险链路。
- 希望把 Claude Code 的项目工作流迁移到多个项目，而不是每个项目手工复制提示词。

## 核心思路

```text
流程层可复制，项目适配层必须重新生成。
```

仓库里的 `.claude/skills`、`.claude/commands`、`.claude/agents` 和通用 rules 是流程层。每个业务项目自己的命令、路径、测试能力、OpenSpec 策略和版本管理边界，必须通过 onboarding 生成 `.claude/rules/project-workflow.md`，不要从旧项目直接复制。

## 包含内容

```text
.claude/
  agents/                         # security-reviewer、code-reviewer、build-error-resolver
  commands/                       # /dev-task、/onboard-dev-flow、/finish 等入口
  hooks/                          # dev-flow-gate-guard.sh、dev-flow-finish-guard.sh
  settings.json                   # 注册上述 hooks（ask 模式）
  rules/
    project-workflow.template.md  # 新项目适配模板
    git-workflow.md
    security.md
    specs/                        # 可选局部规范，M/L 命中 scope 时读取
    vue3.md                       # Vue 项目可选规则
  skills/
    dev-flow/                     # 默认开发入口，contract.json 为唯一权威契约
    req-probe/ grillme/ writing-plans/ requirements-coverage/ plan-review/
    rollback-units/ executing-plans/ code-review/
    verification-before-completion/ finishing-a-development-branch/
    openspec/ test-driven-development/ using-git-worktrees/
docs/
  claude-dev-flow-guide.md
  claude-dev-flow-smoke-test.md
templates/
  CLAUDE.dev-flow-snippet.md      # 可合并到目标项目 CLAUDE.md
```

## 快速迁移

在目标项目中复制本仓库的 `.claude/` 和 `docs/`，然后运行：

```text
/onboard-dev-flow
```

如果想同时做迁移烟测：

```text
/onboard-dev-flow --smoke-test
```

onboarding 会根据目标项目实际情况生成：

```text
.claude/rules/project-workflow.md
```

生成后再开始真实开发任务。

如果目标项目已有 `CLAUDE.md`，可以把 `templates/CLAUDE.dev-flow-snippet.md` 合并进去；如果没有，可以基于该片段新建一个项目说明文件，并补充目标项目自己的技术栈、命令和约束。

## 日常入口

```text
/dev-task <你的需求>
```

dev-flow 会先判断 XS / S / M / L：

- XS：直接修改并验证。
- S：轻量确认边界后实现。
- M：按轻量 M 或标准 M 分流。
- L：轻量 L 或标准 L 都必须先确认高风险边界；标准 M/L 需求确认后才写计划。标准 L 的固定骨架是 `writing-plans -> requirements-coverage -> plan-review -> implementation_approval`，之后才写代码。

## 迁移文档

- [使用指南](docs/claude-dev-flow-guide.md)
- [迁移后烟测说明](docs/claude-dev-flow-smoke-test.md)

## 静态自检

迁移或修改流程层后，可以先运行轻量 doctor：

```bash
.claude/skills/dev-flow/scripts/dev-flow-doctor
```

doctor 只做静态检查，分三类：结构（关键文件存在、脚本可执行、`contract.json` 可解析、hooks 已注册）、一致性（`risk-gates.md` 与 contract 风险标签同步、旧项目事实泄漏、行数预算、`workflow_version` 单源）、适配层（占位符残留、test 命令疑似 dev/watch）。它不运行业务测试，也不替代 smoke test。

单个标准 M/L、轻量 L 功能和携带风险标签的 XS/S 功能收尾前运行 feature evidence 检查：

```bash
.claude/skills/dev-flow/scripts/dev-flow-feature-check <feature-id> --finish
```

它检查验证报告、手动行为证据、风险标签的最低 gate 与证据、回撤闭环、`status.md` 的 `assets` 列表和验证新鲜度。doctor 负责流程包/项目适配层，feature-check 负责某个真实 feature 的执行产物；两者都通过后才能进入分支收尾。无风险 XS/S 与默认轻量 M（无 `status.md`）不强制 feature-check。

## 注意

- 不要把旧项目的 `.claude/rules/project-workflow.md` 复制到新项目。
- 不要提交 `.claude/runtime/`、`settings.local.json` 或一次性生成产物。
- 非 Vue 项目可以删除或替换 `.claude/rules/vue3.md`。
- 如果目标项目没有真实测试运行器，不要把 `npm test`、`pnpm test` 这类命令默认当成测试证据。
- 不要把局部规范或机器可读状态当成新仪式；它们只服务轻量 L 和标准 M/L 的恢复、审查和验证。
- 不要把实现后的 `code-review` 当成实现前 `plan-review`；出现 `[HUMAN GATE:*]` 或 `Auto-continue: no` 后必须停下等用户确认。
- 不要把 `requirements-coverage` 做成第二套验证系统；它只检查需求和计划是否覆盖，默认只把结论交给 `plan-review`。
- 完成功能后默认按 `dev_flow.artifacts.retention: compact` 收尾，长期只保留 `feature.md`、`completion.md` 和可复用的手测脚本；需要完整审计时才使用 `full` 归档原始资产。

## v0.7 执行闭环

- status 机器字段只通过 `.claude/skills/dev-flow/scripts/dev-flow-status.mjs` 更新（`init` / `authorize` / `confirm-human` / `accept-risk` 等）。
- 写入门禁：`enforcement_mode` + `protected_write_roots` + `.claude/runtime/dev-flow/write-authorization.json`（见 `dev-flow/references/status-cli.md`）。
- partial 验证：手测 `skipped` + `AR-xxx` + partial-acceptance 三方一致（见 `dev-flow/references/partial-verification.md`）。
- 受管升级：在源仓运行 `dev-flow-upgrade --target <abs-path> --check|--apply`；清单 `.claude/dev-flow.manifest.json`。
- 本地完整性：`dev-flow-doctor --preflight`。

