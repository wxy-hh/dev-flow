# Claude dev-flow 使用指南

覆盖迁移到新项目、日常任务描述和产物/维护规则。核心原则：

```text
流程层可复制，项目适配层必须重新生成。
```

`.claude/skills`、`.claude/commands`、`.claude/agents`、`.claude/hooks`、`.claude/settings.json` 和通用 rules 是流程层，直接复制。`.claude/rules/project-workflow.md` 是项目适配层，必须由模板在新项目里重新检测生成，不要复制旧项目的成品。

## 包含内容

```text
.claude/
  skills/      dev-flow、req-probe、grillme、writing-plans、requirements-coverage、
               plan-review、rollback-units、executing-plans、code-review、
               verification-before-completion、finishing-a-development-branch、
               openspec、test-driven-development、using-git-worktrees
  agents/      security-reviewer、code-reviewer、build-error-resolver
  commands/    dev-task、onboard-dev-flow、finish、commit、review-diff、fix-build
  hooks/       dev-flow-gate-guard.sh、dev-flow-finish-guard.sh
  settings.json  注册上述 hooks（ask 模式）
  rules/       git-workflow.md、security.md、specs/README.md、
               project-workflow.template.md
docs/
  claude-dev-flow-guide.md（本文件）
  claude-dev-flow-smoke-test.md
templates/
  CLAUDE.dev-flow-snippet.md
```

不要复制 `.claude/rules/project-workflow.md`、`.claude/runtime/`、`.claude/settings.local.json` 或任何一次性生成产物。框架/栈规则由目标项目自建，不随包分发。

## 迁移步骤

1. 复制上方「包含内容」到新项目；需要的框架约定写入目标项目自己的 rules 或 `CLAUDE.md`。
2. 如果目标项目已有 `CLAUDE.md`，合并 `templates/CLAUDE.dev-flow-snippet.md`；没有则基于该片段新建，并补充项目自己的技术栈和禁止事项。
3. 运行 `/onboard-dev-flow`（或 `/onboard-dev-flow --smoke-test` 同时验证迁移包）。它会检测项目事实、生成 `.claude/rules/project-workflow.md`、确认 hooks 已注册且可执行、生成 `dev_flow.label_hints` 初始猜测。
4. 检测清单：项目类型、包管理器、install/dev/build/type-check/lint/test 脚本、test 是否为真测试运行器、是否有浏览器测试/OpenSpec/代码映射、局部规范是否存在、git 边界（本地配置/仓库治理）、agent 例外。这些事实写入 `project-workflow.md` frontmatter 的 `dev_flow` 配置块（结构见 `project-workflow.template.md`），机器可读锚点与下方 Markdown 表格必须一致。
5. 决定版本管理边界：本地配置模式下 `.claude/` 可以继续被忽略，验收看文件内容；仓库治理模式下提交需要共享的治理文件，继续忽略 runtime、本地设置和一次性产物。
6. 运行 `.claude/skills/dev-flow/scripts/dev-flow-doctor`，再按 [smoke test](./claude-dev-flow-smoke-test.md) 执行。通过后才开始真实业务任务；标准 M/L、轻量 L 功能收尾时另跑 `dev-flow-feature-check <feature-id> --finish`。

## 核心资产与风险标签

| 接口 | 路径 | 使用边界 |
|------|------|----------|
| 机器可读状态 | `<FEATURE_ROOT>/<feature-id>/status.md` 的 `dev_flow_status` frontmatter | 轻量 L、标准 M/L、需要跨技能恢复的任务 |
| HUMAN GATE | `dev_flow_status.human_gates.{requirement_confirmation,implementation_approval}` | 标准 M/L 两者都必需；轻量 L 和风险标签 XS/S 只需 `implementation_approval` |
| 最终资产 | `<FEATURE_ROOT>/<feature-id>/{feature.md,completion.md}` | 完成后默认保留；中间资产按 `dev_flow.artifacts.retention` 压缩或归档 |
| 局部规范 | `<SCOPED_SPEC_ROOT>/<scope>/index.md` | 可选；M/L 明确命中 scope 时读取 |

`status.md` 的 schema、`assets` 列表规则和恢复中断流程唯一来源是 `dev-flow/references/protocol.md`；本指南不维护副本。

风险标签独立于规模，命中时触发最小门禁但不抬高等级：`security`、`data`、`money`、`external`、`availability`、`critical_correctness`、`irreversible_consequence`。定义、最低门禁映射和 `risk_evidence` 填写方式唯一来源是 `dev-flow/references/risk-gates.md`。携带风险标签的 XS/S 用 `profile: "risk-minimal"`（只需 classification、risk_labels、risk_evidence、`implementation_approval`、验证记录、accepted_risks，不要求需求说明书/实现计划/`requirements-coverage`）；M/L 即使携带风险标签也保持 `profile: "standard"`。

标准 M/L 需求确认前不得写实现计划，实现前确认前不得写业务代码；`code-review` 不能替代 `plan-review`。标准 L 计划后固定骨架是 `requirements-coverage -> plan-review`。

## 按项目类型适配

- **Vue/React SPA**：组件、路由、状态、API 改动通常是 M 或 L；没有 E2E 时 L 级行为验证要有手动测试脚本。
- **Next/SSR**：区分 client/server/route handler/middleware；鉴权 middleware、session、redirect 命中 `security` 标签，规模按实际契约和链路拓扑判断，不因为触碰 middleware 就默认 L。
- **Node 后端**：API、数据库、权限、数据删除通常是 M/L；有集成测试时 `automated-tests: present`；行为验证可以是 API 脚本而非浏览器。
- **Monorepo**：`<FEATURE_ROOT>`/`<REVIEW_ROOT>` 可放仓库根；验证矩阵按 package 分层；任务需明确影响的 package；可按 package 建局部规范，仅在团队愿意维护时创建。

## 迁移完成标准

`project-workflow.md` 由模板生成（非旧项目复制品）；验证矩阵命令在新项目可解释；test strategy 和 OpenSpec 策略明确写出取值；agent 例外有理由；核心资产路径已写入 `dev_flow.paths` 和标准资产表；`dev-flow-doctor` 和 smoke test 都通过。

常见错误：直接复制旧 `project-workflow.md`；把 `npm test`/`pnpm test` 默认当真测试；浏览器验证写 enabled 但项目没有对应能力；忘记 `.claude/` 被 ignore 导致看不到迁移结果；把旧包里的 `vue3.md` 当通用规则继续分发；让 XS/S 或轻量 M 强制生成 `status.md` 等流程产物；没跑 smoke test 就开始真实 L 级任务。

先用一个真实但低风险的 M 级任务试跑，再用一个轻量 L 场景验证 HUMAN GATE、安全审查、行为验证和回撤证据，确认无摩擦后再作为团队默认入口。

## 日常入口

```text
/dev-task <需求描述>     # 新需求/bug/改动入口，先分级
/finish                  # 收尾、验证汇总
/commit                  # 整理提交信息
/review-diff             # 独立审查当前 diff
/fix-build                # 修类型/构建错误
```

默认不自动提交或推送；用户明确要求"帮我提交"时才执行 `git add`/`git commit`；push/merge/删除分支/discard 等必须二次确认。

## 任务描述示例

| 级别 | 示例 | 预期行为要点 |
|------|------|--------------|
| XS/S | "把设置页按钮文案从『保存』改成『保存设置』" | 不生成额外产物，直接改并验证 |
| 轻量 M | "订单列表增加『仅看异常订单』筛选，复用现有接口和状态" | 先复述边界，实现后审查+验证，不强制需求书/计划/`status.md` |
| 标准 M | "新增发票抬头管理，涉及增删改和默认抬头规则，按标准 M" | 需求边界确认后才写计划；至少 `plan_review: light` 并等待确认 |
| 轻量 L | "调整登录过期跳转兜底，只改一处 guard，携带 security 标签(S+risk-minimal)" | 先出边界确认卡，确认前不写 `status.md`/代码；保留安全审查+行为验证+回撤 |
| risk-minimal S | "修正 token 过期清理逻辑，只改一处工具函数，携带 security 标签" | 最小风险卡；停在 `implementation_approval`；`risk_evidence.security` 记录结论 |
| 标准 L | "重构支付回跳和订单状态同步，跨系统入口+状态+异常兜底" | 需求确认 → 计划 → coverage → plan-review → 实现前确认，全部落地 |

## 产物位置

具体路径以 `project-workflow.md` 的 `dev_flow.paths` 和路径别名表为准。

| 产物 | 用途 |
|------|------|
| `status.md` | 当前 gate、资产列表、验证新鲜度、风险证据、accepted_risks |
| `需求说明书.md` / `初步实现计划.md` | 标准 M/L 的需求边界与实现计划 |
| `requirements-coverage.md` | 需求到任务/验证的覆盖关系，供 `plan-review` 读取，不是完成前验证报告 |
| `rollback-units.md` | 最小回撤单元和回撤顺序 |
| `*-code-review.md` / `*-verification.md` / `*-manual-test.md` | 代码审查、完成前验证、手动行为验证证据 |
| `feature.md` / `completion.md` | 完成后的边界摘要与审查/验证/风险/回撤事实源 |

恢复中断任务时先读 `status.md` 的 `assets` 列表定位需求、计划、审查、验证资产；`[HANDOFF]` 只作辅助线索（详见 `protocol.md`）。

## 验证新鲜度

完成前必须有新鲜验证证据。`status.md` 的 `validation.last_at`、`validation.commands` 和 `business_diff_fingerprint` 用于判断验证是否过期：验证后代码又变化、或当前 fingerprint 与记录不一致时，不能复用旧结论，必须重新验证。验证结论以最新命令输出、人工测试记录、验证报告和 `feature-check` 为准；完成后默认按 `retention: compact` 清理中间资产。

## 何时跑 doctor / feature-check

`dev-flow-doctor` 时机：onboarding 后；修改 `.claude/skills`/`commands`/`agents`/`rules`/`hooks` 后；调整 `project-workflow.md` 的路径/验证命令/Git 边界后；smoke test 前；升级迁移包后。它只做静态检查，不替代业务测试或 smoke test。

`dev-flow-feature-check <feature-id> --finish`：标准 M/L、轻量 L 和携带风险标签的 XS/S 功能收尾前运行，检查验证报告、手动行为证据、风险标签最低 gate 与证据、回撤闭环、资产路径和验证新鲜度。无风险 XS/S 与默认轻量 M（无 `status.md`）不强制。doctor 管流程包/适配层，feature-check 管单个 feature 的执行产物；对强制路径，两者都通过才能进入分支收尾。

## 维护规则

流程层可复制，项目事实只写进 `project-workflow.md`/`CLAUDE.md`/可选 stack rule；不要把某个项目的路径、端口、mock 或测试命令写进通用 skill/command/agent。新增脚本优先读 `dev_flow.paths`，不要硬编码 runtime 目录。`.claude/rules/specs/<scope>/index.md` 只在有真实局部约定时创建。HUMAN GATE 是硬停顿：`[HUMAN GATE:*]` 或 `Auto-continue: no` 后不能同回合继续写计划/代码或把 `auto_continue` 改回 `true`。安全审查默认只读，需要修复时由主流程或用户确认后的任务执行代码修改。

## 常见问题

**doctor 提示缺少 project-workflow.md**：源迁移包仓库中是正常 warning；业务项目应先跑 `/onboard-dev-flow`。

**没有自动化测试怎么办**：`automated-tests` 写 `none`，不要把 dev/watch 命令当测试证据；L 级运行时行为改动仍需手动测试脚本或其它可复查证据。

**想跳过某个门禁**：XS/S 默认轻量不强行生成文档；标准 M/L 跳过需求确认/计划审查/实现前确认/回撤/安全审查需要说明风险，L 级跳过高风险门禁必须用户明确确认并写入 `accepted_risks`。

**可以让 Claude 直接提交吗**：默认不提交；用户明确要求后才执行 `git add`/`git commit`；push/合并/删除分支/丢弃改动必须二次确认。

## status CLI、finish 与 partial（v0.8）

所有 `status.md` 创建/更新走 `dev-flow-status` CLI，禁止手改机器字段。无风险 XS/S 用 `authorize`；M/L 与风险 XS/S 用 `init` + `confirm-human`。`promote-gate` 只接受 contract risk gates 且单调提升；`complete-verification` 登记验证但不写 check-ok。`outcome: partial` 允许正常 Git 操作，但 completion / check-ok stamp / 收尾文案必须为 partial，禁止写「验证通过」。

`/finish` 在 dry-run 后输出 `[ASSET FINALIZATION]`，只接受精确回复 `compact` / `retain full` / `not now`；禁止同回合 `--confirm`。详情见 `dev-flow/references/status-cli.md`、`partial-verification.md` 与 `protocol.md`。

受管文件升级使用源仓中的 `dev-flow-upgrade --target <abs> --check|--apply`，不要手工半份拷贝 skill。升级会：删除 `deprecated_paths`（含 `vue3.md`）、把 shared SDD 顶层文件隔离到 `upgrade-backup-*/legacy-sdd/`、失效旧 `write-authorization.json` 与全部 `*.check-ok`；在途 feature 的 status/completion/archive 一律保留。失败时从 backup 完整回滚。升级不是 onboarding：栈规则由目标项目自建，upgrade 不管理。

