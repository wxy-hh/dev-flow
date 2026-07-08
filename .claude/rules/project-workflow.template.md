---
paths:
  - ".claude/**"
  - "CLAUDE.md"
  - "<feature-root>/**"
  - "<review-root>/**"
  - "<plan-root>/**"
dev_flow:
  version: "0.1.0"
  project_kind: "<detect>"
  package_manager: "<detect>"
  paths:
    workflow_root: ".claude"
    runtime_root: "<detect-runtime-root>"
    feature_root: "<detect-feature-root>"
    review_root: "<detect-review-root>"
    plan_root: "<detect-plan-root>"
    sdd_progress: "<detect-sdd-progress-path>"
  verification:
    install: "<detect-or-none>"
    dev: "<detect-or-none>"
    build: "<detect-or-none>"
    build_only: "<detect-or-none>"
    type_check: "<detect-or-none>"
    lint: "<detect-or-none>"
    format: "<detect-or-none>"
    test: "<detect-or-none>"
    automated_tests: "<none|present>"
    runtime_verification: "<required-for-L-behavior|optional|custom>"
    webapp_testing: "<disabled|enabled>"
    codemaps: "<disabled|enabled>"
  openspec:
    living_baseline: "<false|true>"
  git:
    mode: "<local-config|repo-governed>"
---

# Claude 项目工作流适配模板

复制 Claude dev-flow 到新项目后，用本模板生成 `.claude/rules/project-workflow.md`。不要把旧项目的 `project-workflow.md` 直接当成新项目事实。

## 迁移规则

- 流程层可复制：`.claude/skills/`、`.claude/commands/`、`.claude/agents/`、通用 rules。
- 项目适配层必须重新检测生成：包管理器、验证命令、测试策略、OpenSpec 策略、路径和版本边界都按新项目填写。
- 生成后删除或保留本模板均可；实际工作流只读取 `.claude/rules/project-workflow.md`。

## 结构化配置

`project-workflow.md` 必须保留 frontmatter 中的 `dev_flow` 配置块，并把所有 `<detect...>`、`<none|present>`、`<false|true>` 之类占位符替换成当前项目真实值。Markdown 表格是给人读的说明；`dev_flow` 是给 doctor、onboarding 和后续脚本读取的机器可读锚点。

规则：

- `dev_flow.paths.*` 必须与下方「路径别名」表一致。
- `dev_flow.verification.*` 必须与下方「项目能力」和「验证配置」一致。
- 不确定的能力写 `none` 或 `needs-confirmation`，不要猜测。
- 任何脚本或 doctor 只依赖 `dev_flow` 的稳定字段，不解析长段自然语言。

## 版本管理边界

当前项目采用：

- 模式：`<local-config|repo-governed>`
- 说明：`<detect .claude and CLAUDE.md git tracking/ignore state>`

规则：

- 本地配置模式：`.claude/` 和 `CLAUDE.md` 可被忽略，验收以文件内容检查为准。
- 仓库治理模式：只提交需要共享的治理文件，继续忽略 runtime、本地设置和一次性产物。

## 读取顺序

Claude 工作流入口先读取：

1. `.claude/rules/project-workflow.md`
2. `CLAUDE.md`
3. 相关源码、已有需求产物和上一段 `[HANDOFF]`

除非用户显式提供路径，不读取其它智能体入口说明作为事实来源。

## 路径别名

| 别名 | 当前项目取值 | 用途 |
|------|--------------|------|
| `<WORKFLOW_ROOT>` | `.claude` | Claude 工作流根目录 |
| `<SKILL_ROOT>` | `.claude/skills` | Claude 技能目录 |
| `<COMMAND_ROOT>` | `.claude/commands` | Claude 命令目录 |
| `<RULE_ROOT>` | `.claude/rules` | Claude 规则目录 |
| `<RUNTIME_ROOT>` | `<detect-runtime-root>` | 运行时台账和临时交接目录 |
| `<SDD_PROGRESS>` | `<detect-sdd-progress-path>` | 子任务执行进度台账 |
| `<FEATURE_ROOT>` | `<detect-feature-root>` | 需求、计划、覆盖和回撤资产目录 |
| `<REVIEW_ROOT>` | `<detect-review-root>` | 审查和验证报告目录 |
| `<PLAN_ROOT>` | `<detect-plan-root>` | 设计和计划类文档目录 |

## Feature ID

新功能默认使用：

```text
YYYY-MM-DD-<short-kebab-name>
```

如果用户、OpenSpec 变更或既有产物已经给出 feature id，继续沿用已有值，不重新命名。

## 标准资产

| 资产 | 路径模板 |
|------|----------|
| 状态文件 | `<FEATURE_ROOT>/<feature-id>/status.md` |
| 需求说明书 | `<FEATURE_ROOT>/<feature-id>/需求说明书.md` |
| 初步实现计划 | `<FEATURE_ROOT>/<feature-id>/初步实现计划.md` |
| 需求覆盖矩阵 | `<FEATURE_ROOT>/<feature-id>/requirements-coverage.md` |
| 回撤单元 | `<FEATURE_ROOT>/<feature-id>/rollback-units.md` |
| 计划审查 | `<REVIEW_ROOT>/YYYY-MM-DD-<feature-id>-plan-review.md` |
| 代码审查 | `<REVIEW_ROOT>/YYYY-MM-DD-<feature-id>-code-review.md` |
| 完成前验证 | `<REVIEW_ROOT>/YYYY-MM-DD-<feature-id>-verification.md` |
| 手动行为验证脚本 | `<REVIEW_ROOT>/YYYY-MM-DD-<feature-id>-manual-test.md` |
| 安全审查 | `<REVIEW_ROOT>/YYYY-MM-DD-<feature-id>-security-review.md` |
| 子任务台账 | `<SDD_PROGRESS>` |

## 状态文件规则

标准 M/L、轻量 L 和任何需要跨技能交接的任务，都维护 `<FEATURE_ROOT>/<feature-id>/status.md`。

状态文件至少包含：

```markdown
# <feature-id> 状态

- Level:
- Current gate:
- Completed gates:
- Next action:
- Auto-continue:
- Assets:
- Last updated:
- Base SHA:
- Head SHA:
- Working tree dirty:
- Diff stat hash:
- Last validation at:
- Last validation commands:
- Accepted risks:
```

恢复中断流程时，先读 `status.md`，再读其中列出的资产；`[HANDOFF]` 只作为最近一次对话的辅助线索。

### status.md 更新契约

任何 skill 更新 `status.md` 时遵守以下规则：

- 保留已有 `Completed gates`，只追加新完成的 gate，不删除历史 gate。
- `Assets` 只追加已经存在或本次明确生成的路径。
- 每次更新必须设置 `Current gate`、`Next action`、`Auto-continue` 和 `Last updated`。
- 如果 git 可用，每次更新同时记录 `Base SHA`、`Head SHA`、`Working tree dirty` 和 `Diff stat hash`；没有 git 时写 `unknown` 并说明原因。
- 验证门禁完成后必须记录 `Last validation at` 和 `Last validation commands`。验证后如果 `Head SHA`、`Working tree dirty` 或 `Diff stat hash` 发生变化，已有验证证据视为过期，完成前必须重新验证。
- 如果任务包含风险门禁，维护一个 `Risk Gates` 表，列出每个 gate 的 `none` / `light` / `full` 形态和证据路径。
- 如果验证失败或用户接受风险，在 `Next action` 和 `Accepted risks` 中写清阻塞点或接受风险依据。

## 项目能力

| 能力 | 当前取值 | 说明 |
|------|----------|------|
| project-kind | `<detect>` | 例如 Vue、React、Next、Node backend、monorepo |
| package-manager | `<detect>` | lock 文件或项目配置 |
| install | `<detect-or-none>` | 安装依赖命令 |
| dev | `<detect-or-none>` | 开发服务命令、协议和端口 |
| build | `<detect-or-none>` | 构建命令 |
| build-only | `<detect-or-none>` | 仅构建命令 |
| type-check | `<detect-or-none>` | 类型检查命令 |
| lint | `<detect-or-none>` | 代码检查命令 |
| format | `<detect-or-none>` | 格式化命令 |
| test | `<detect-or-none>` | 测试命令 |
| automated-tests | `<none|present>` | 是否存在真实应用测试运行器 |
| runtime-verification | `<required-for-L-behavior|optional|custom>` | 运行时验证策略 |
| webapp-testing | `<disabled|enabled>` | 是否启用浏览器自动化验证 |
| codemaps | `<disabled|enabled>` | 是否有代码映射或文档生成流程 |

## 测试策略

- `automated-tests: none` 时，不要求 TDD，不把非测试型命令当成单元测试或覆盖率证据。
- `automated-tests: present` 时，M/L 实现阶段默认加入 `test-driven-development`，并把测试命令纳入验证矩阵。
- `webapp-testing: disabled` 时，L 级运行时行为验证使用手动脚本。
- `webapp-testing: enabled` 时，L 级关键路径优先使用 `webapp-testing`，并把截图、trace 或操作记录写入验证报告。

## OpenSpec 策略

- `living-baseline: <false|true>`
- `false`：OpenSpec 只作为 point-in-time 需求和变更固化，不维护活 baseline。
- `true`：收尾阶段必须 archive change，并把 delta 合并回 baseline specs。

## 启用的 Claude agents

启用：

- `<detect-enabled-agent>`

当前未启用为默认门禁：

- `<detect-disabled-agent>`：`<reason>`

## Claude 项目 onboarding

首次复制到新项目或发现本文件缺失时，先做能力检测，再生成或更新本文件：

1. 检查包管理器和 lock 文件。
2. 读取项目脚本，识别 install、dev、build、type-check、lint、test、format、preview。
3. 判断 test 是否是真测试运行器，还是仅启动开发/测试模式。
4. 判断是否存在 OpenSpec、浏览器测试、单元测试、代码映射或文档生成流程。
5. 判断 git 是否可用，以及 `.claude/` / `CLAUDE.md` 是否被忽略。
6. 写入项目能力、测试策略、OpenSpec 策略、启用 agents 和路径别名。

## 验证配置

按改动风险选择，混合改动取并集。

| 改动类型 | 默认验证 |
|----------|----------|
| UI 页面/模板 | `<detect>` |
| 逻辑、状态、路由、接口 | `<detect>` |
| 样式 | `<detect>` |
| 配置、构建脚本、依赖 | `<detect>` |
| 文档、技能说明 | 检查目标文件；有可用校验脚本时运行校验 |

文档和技能改动的基础检查：

```bash
.claude/skills/dev-flow/scripts/dev-flow-doctor
CLAUDE_CHECK_TARGETS=(.claude/skills .claude/commands .claude/agents .claude/rules CLAUDE.md)
rg -u -n "TBD|TODO|implement later|fill in details|稍后实现|适当处理" <changed-files>
rg -u -n "project-config|\\.agents/runtime|1-2 个文件|~/.claude/settings|AGENTS.md" "${CLAUDE_CHECK_TARGETS[@]}" --glob '!project-workflow.md' --glob '!project-workflow.template.md'
rg -u -n "<detect-feature-root>|<detect-review-root>|\\.claude/runtime/sdd/progress\\.md" "${CLAUDE_CHECK_TARGETS[@]}" --glob '!project-workflow.md' --glob '!project-workflow.template.md'
```

## 高风险门禁

涉及登录、鉴权、token/session、权限守卫、订单、支付、数据删除、跨系统入口或数据完整性的 L 级任务，默认在实现前和完成前加入安全审查。

安全审查形态由风险决定：

- `light`：结论写入 `status.md`、计划审查或最终代码审查。
- `full`：保存到 `<REVIEW_ROOT>/YYYY-MM-DD-<feature-id>-security-review.md`。
