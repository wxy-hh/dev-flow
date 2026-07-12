---
paths:
  - ".claude/**"
  - "CLAUDE.md"
  - "<feature-root>/**"
  - "<review-root>/**"
  - "<plan-root>/**"
dev_flow:
  version: "0.5.0"
  project_kind: "<detect>"
  package_manager: "<detect>"
  paths:
    workflow_root: ".claude"
    runtime_root: "<detect-runtime-root>"
    feature_root: "<detect-feature-root>"
    review_root: "<detect-review-root>"
    plan_root: "<detect-plan-root>"
    sdd_progress: "<detect-sdd-progress-path>"
    scoped_spec_root: ".claude/rules/specs"
  verification:
    install: "<detect-or-none>"
    dev: "<detect-or-none>"
    build: "<detect-or-none>"
    build_only: "<detect-or-none>"
    type_check: "<detect-or-none>"
    lint: "<detect-or-none>"
    lint_changed: "<detect-or-none>"
    format: "<detect-or-none>"
    test: "<detect-or-none>"
    automated_tests: "<none|present>"
    runtime_verification: "<required-for-L-behavior|optional|custom>"
    webapp_testing: "<disabled|enabled>"
    codemaps: "<disabled|enabled>"
  artifacts:
    retention: "compact"
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
| `<SCOPED_SPEC_ROOT>` | `.claude/rules/specs` | 可选的局部工程规范目录 |

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
| 最终功能说明 | `<FEATURE_ROOT>/<feature-id>/feature.md` |
| 最终完成报告 | `<FEATURE_ROOT>/<feature-id>/completion.md` |
| 安全审查 | `<REVIEW_ROOT>/YYYY-MM-DD-<feature-id>-security-review.md` |
| 子任务台账 | `<SDD_PROGRESS>` |
| 实现上下文清单 | `<FEATURE_ROOT>/<feature-id>/context/implement.jsonl` |
| 审查上下文清单 | `<FEATURE_ROOT>/<feature-id>/context/review.jsonl` |
| 验证上下文清单 | `<FEATURE_ROOT>/<feature-id>/context/verify.jsonl` |

## completion.md frontmatter

```yaml
---
dev_flow_completion:
  schema_version: "1"
  feature_id: "<feature-id>"
  level: "<XS|S|M|L>"
  outcome: "verified|partial"
  completed_at: "<timestamp>"
  retention: "compact|full"
  risk_labels: []
  risk_approval_evidence: ""
  risk_verification_summary: ""
  business_diff_fingerprint: "<git-hash>"
  commits: []
  pull_request: "none"
  accepted_risks: []
---
```

risk_labels、risk_approval_evidence、risk_verification_summary 在 risk_labels 非空时为必填。completed_at 填写 ISO 8601 时间戳。

## 局部规范和上下文清单

局部规范是可选能力，用于把某个包、模块、页面或技术层的工程约定放到 `<SCOPED_SPEC_ROOT>/<scope>/index.md`。每个 `index.md` 必须包含：

- `Pre-Development Checklist`
- `Quality Check`

读取规则：

- XS/S 不因为局部规范存在而升级，也不为了读取局部规范创建额外产物。
- M/L 只有在计划、改动路径或用户输入明确命中某个 scope 时才读取对应局部规范。
- 找不到匹配 scope 时，不报错；继续使用项目适配层和通用 rules。

上下文清单是协作辅助资产，不替代需求、计划、审查报告、验证报告或 `status.md`。JSONL 每行格式：

```json
{"file":"repo-relative-path","kind":"spec|requirement|plan|research|review|verification","reason":"why this file matters"}
```

规则：

- 只登记需求、计划、局部规范、研究、审查和验证等上下文文件；不要登记源码文件。
- 轻量 L 和标准 M/L 必须维护 `context/implement.jsonl`、`context/review.jsonl` 和 `context/verify.jsonl`。
- 轻量 M 只有已经产生落盘需求、计划、审查或验证资产时才维护上下文清单。
- XS/S 不维护上下文清单。
- `requirements-coverage` 的主产物是覆盖结论；默认只追加到 `context/review.jsonl` 供 `plan-review` 读取，不追加到 `context/verify.jsonl`。只有覆盖报告新增了后续验证必须读取、且计划或验证脚本里没有的明确验证义务时，才追加到 verify manifest。

## 状态文件规则

标准 M/L、轻量 L 和任何需要跨技能交接的任务，都维护 `<FEATURE_ROOT>/<feature-id>/status.md`。

状态文件至少包含 `dev_flow_status` frontmatter 和人类可读摘要：

```markdown
---
dev_flow_status:
  schema_version: "2"
  workflow_version: "0.5.0"
  feature_id: "<feature-id>"
  level: "<XS|S|M|L>"
  profile: "standard"
  risk_labels: []
  risk_evidence: {}
  classification:
    schema_version: "1"
    topology: "local"
    target_files: []
    symbols: []
    search_required: false
    evidence_result: "not-applicable"
    external_references: []
    scope_note: ""
  current_gate: "<gate-name>"
  completed_gates: []
  next_action: "<next-action>"
  auto_continue: false
  assets: []
  context_manifests:
    implement: "<FEATURE_ROOT>/<feature-id>/context/implement.jsonl"
    review: "<FEATURE_ROOT>/<feature-id>/context/review.jsonl"
    verify: "<FEATURE_ROOT>/<feature-id>/context/verify.jsonl"
  human_gates:
    requirement_confirmation:
      required: false
      status: "pending"
      evidence: "not required"
    implementation_approval:
      required: false
      status: "pending"
      evidence: "not required"
  risk_gates:
    requirements_coverage: "none"
    plan_review: "none"
    rollback_units: "none"
    security_review: "none"
    behavior_verification: "none"
  validation:
    base_sha: "unknown"
    head_sha: "unknown"
    working_tree_dirty: "unknown"
    diff_stat_hash: "unknown"
    business_diff_fingerprint: "unknown" # 覆盖未暂存和已暂存的业务改动；排除 dev-flow 资产
    last_validation_at: "none"
    last_validation_commands: []
  accepted_risks: []
---

# <feature-id> 状态

- Level:
- Profile:
- Risk labels:
- Risk evidence:
- Current gate:
- Completed gates:
- Human gates:
- Next action:
- Auto-continue:
- Assets:
- Last updated:
- Base SHA:
- Head SHA:
- Working tree dirty:
- Diff stat hash:
- Business diff fingerprint:
- Last validation at:
- Last validation commands:
- Accepted risks:
- Classification topology:
- Classification evidence:

完成收尾后，默认将中间资产压缩为 `feature.md`、`completion.md` 和可复用的 `manual-test.md`。`dev_flow.artifacts.retention: full` 时，把原始需求、计划、覆盖、审查、回撤、验证和 context 资产移动到 feature 目录下的带时间戳 `archive/`；默认 `compact` 不保留这些中间资产。
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
- 标准 L 默认 `requirements_coverage: "full"`。命中 security 风险标签且计划跨模块或共享状态时，默认 `plan_review: "full"`。
- 标准 M/L 的 `human_gates.requirement_confirmation` 和 `human_gates.implementation_approval` 必须为 `required: true`。轻量 L 也必须要求边界确认和实现前确认；如果用户一次明确确认边界和轻量 L 路径，可以用同一条用户回复作为两个 gate 的 `evidence`。XS/S 和默认轻量 M 不要求这些 gate。risk-minimal profile（风险 XS/S）必须要求 `implementation_approval` 为 `required: true`。
- 一旦输出 `[HUMAN GATE:<gate-id>]` 或 `[HANDOFF]` 中 `Auto-continue: no`，当前回合必须停止；不得在同一回合把 `auto_continue: false` 改成 `true` 或继续写计划/源码。
- 只有用户后续明确确认、继续、接受风险或跳过并接受风险，才能把对应 `human_gates.<gate>.status` 写成 `confirmed` 或 `skipped`，并把原话或接受风险理由写入 `evidence`。
- 如果验证失败或用户接受风险，在 `Next action` 和 `Accepted risks` 中写清阻塞点或接受风险依据。
- 同步维护 frontmatter 中的 `dev_flow_status`；机器可读字段和人类可读摘要不一致时，以最新明确验证证据和已有资产为准并立即修正摘要。
- `risk-minimal` 只适用于带风险标签的 XS/S；`risk-minimal` 必须有非空 `risk_labels`。带风险标签的 M/L 使用 `profile: "standard"`。
- `risk-minimal` profile 必填：feature_id、level、classification、risk_labels、risk_evidence、风险理由、实现前审批证据、验证记录、accepted_risks。
- `risk-minimal` profile 不要求：需求说明书、实现计划、context manifest、requirements-coverage。
- `classification` 字段记录拓扑证据：topology（local|shared-contract|multi-chain|coordinated-rollback）、target_files、symbols、search_required、evidence_result（verified|partial|not-applicable）、external_references、scope_note。
- v2 状态只要 `risk_labels` 非空，就必须维护 `risk_evidence`。每个标签一项；`mode: "inline"` 需要非空 `conclusion` 和 `verification`，`mode: "report"` 还需要仓库内、非符号链接的 `report` 路径。

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
6. 检查是否已有 `<SCOPED_SPEC_ROOT>`；没有也可以保留为空的可选能力。
7. 写入项目能力、测试策略、OpenSpec 策略、启用 agents、路径别名和三件套路径。

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

风险标签不提升规模等级；只有 XS/S 携带风险标签时使用 `risk-minimal` profile，M/L 保持 `profile: "standard"`。多个标签取最低门禁的并集：

| 标签 | 最低风险门禁 |
|---|---|
| `security` | `security_review: light`、`behavior_verification: light` |
| `data` | `rollback_units: light`、`behavior_verification: light` |
| `money` | `rollback_units: light`、`behavior_verification: light` |
| `external` | `behavior_verification: light` |
| `availability` | `behavior_verification: light` |
| `critical_correctness` | `behavior_verification: light` |
| `irreversible_consequence` | `rollback_units: light`、`behavior_verification: light` |

每个风险标签都在 `risk_evidence` 中写一项：

```yaml
risk_evidence:
  security:
    mode: "inline|report"
    conclusion: "审查或验证结论"
    verification: "命令、检查或可定位引用"
    report: "<repo-relative-path，report 模式必填>"
```

- `inline`：只写入 `status.md`，不创建独立报告。
- `report`：`report` 必须指向仓库内现有文件；标签所需任一 gate 为 `full` 时必须使用该模式。
- 标签对应的最低 gate 不得降为 `none`；项目或任务可以将其升为 `full`。

### 登录 / 鉴权 / SSO 验证矩阵

涉及登录、鉴权、SSO、token/session、权限守卫、HTTP 401/403 或跨系统回跳时，验证计划至少覆盖：

| 路径 | 必查点 |
|------|--------|
| SSO 入口 | URL 参数存在、缺失、重复或非法时的处理 |
| token 交换 | 请求参数、成功返回 token 写入、失败兜底跳转 |
| 本地登录 | 原 `/login` 独立登录能力不被破坏 |
| 路由守卫 | 已登录放行、未登录拦截、被动 token 失效后的去向 |
| HTTP 拦截器 | Authorization 注入、401/403 处理、错误信息不泄露敏感数据 |
| 显式登出 | 清理登录态、SSO 来源标记和跳转目标符合需求 |
| 跨系统回跳 | 认证中心地址占位符、回跳循环和来源判断 |
| 现有登录副作用 | license、门户、菜单、报表或项目已有登录后置流程是否保留 |

计划或验证报告应记录 `/login` 跳转点扫描结果。可按项目语言调整命令，基础扫描示例：

```bash
rg -n "router\\.(push|replace)\\(['\\\"]/login['\\\"]\\)|window\\.location\\.(href|replace)\\s*=\\s*['\\\"]/login['\\\"]|next\\(['\\\"]/login['\\\"]\\)" src
```
