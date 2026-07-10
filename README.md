# dev-flow

务实开发工作流，面向 Claude Code 的项目开发流程迁移包。

dev-flow 的目标是把一次开发请求先分级，再按风险选择最小足够流程：小改动快速实现和验证，复杂改动补齐需求固化、计划、覆盖审查、回撤单元、代码审查和完成前验证。

本迁移包保留轻量优先：XS/S 不创建流程文档；轻量 M 默认不落盘。轻量 L 和标准 M/L 会维护机器可读 `status.md`、上下文清单和可选局部规范引用，方便中断恢复、审查和验证；L 级和标准 M/L 的关键 HUMAN GATE 不能被自动跨过，但不会引入自动任务系统、hook 或自动提交。

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
  agents/                         # 计划、审查、安全、测试等辅助 agent
  commands/                       # /dev-task、/onboard-dev-flow、/finish 等入口
  rules/
    project-workflow.template.md  # 新项目适配模板
    git-workflow.md
    security.md
    specs/                        # 可选局部规范，M/L 命中 scope 时读取
    vue3.md                       # Vue 项目可选规则
  skills/
    dev-flow/                     # 默认开发入口
    req-probe/
    writing-plans/
    requirements-coverage/
    plan-review/
    rollback-units/
    code-review/
    verification-before-completion/
    ...
docs/
  claude-dev-flow-migration.md
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

- [迁移使用说明](docs/claude-dev-flow-migration.md)
- [迁移后烟测说明](docs/claude-dev-flow-smoke-test.md)
- [迁移后日常使用说明](docs/claude-dev-flow-post-migration-usage.md)

## 静态自检

迁移或修改流程层后，可以先运行轻量 doctor：

```bash
.claude/skills/dev-flow/scripts/dev-flow-doctor
```

doctor 只做静态检查：结构化配置、HUMAN GATE 约束、旧项目事实泄漏、审查 prompt 激励、安全审查权限、runtime 忽略规则和脚本可执行性。它不运行业务测试，也不替代 smoke test。

## 注意

- 不要把旧项目的 `.claude/rules/project-workflow.md` 复制到新项目。
- 不要提交 `.claude/runtime/`、`settings.local.json` 或一次性生成产物。
- 非 Vue 项目可以删除或替换 `.claude/rules/vue3.md`。
- 如果目标项目没有真实测试运行器，不要把 `npm test`、`pnpm test` 这类命令默认当成测试证据。
- 不要把局部规范、上下文清单或机器可读状态当成新仪式；它们只服务轻量 L 和标准 M/L 的恢复、审查和验证。
- 不要把实现后的 `code-review` 当成实现前 `plan-review`；出现 `[HUMAN GATE:*]` 或 `Auto-continue: no` 后必须停下等用户确认。
- 不要把 `requirements-coverage` 做成第二套验证系统；它只检查需求和计划是否覆盖，默认只把结论交给 `plan-review`。
