---
paths:
  - ".claude/**"
  - "CLAUDE.md"
  - "<feature-root>/**"
  - "<review-root>/**"
  - "<plan-root>/**"
dev_flow:
  version: "0.6.0"
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
  label_hints: []
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

`project-workflow.md` 必须保留 frontmatter 中的 `dev_flow` 配置块，并把所有 `<detect...>` 占位符替换成当前项目真实值；`dev_flow.paths.*`/`dev_flow.verification.*` 必须分别与下方「路径别名」「项目能力」「验证配置」保持一致，不确定的能力写 `none` 而不是猜测。`dev_flow` 是给 doctor、onboarding 和后续脚本读取的机器可读锚点，脚本只依赖其稳定字段，不解析自然语言段落。

## 版本管理边界

模式：`<local-config|repo-governed>`（`<detect .claude and CLAUDE.md git tracking/ignore state>`）。本地配置模式下 `.claude/` 和 `CLAUDE.md` 可被忽略，验收以文件内容检查为准；仓库治理模式下只提交需要共享的治理文件，继续忽略 runtime、本地设置和一次性产物。

## 读取顺序

Claude 工作流入口依次读取 `.claude/rules/project-workflow.md`、`CLAUDE.md`、相关源码/已有需求产物/上一段 `[HANDOFF]`；除非用户显式提供路径，不把其它智能体入口说明当作事实来源。

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

## 写入门禁

`dev_flow` frontmatter 必须包含：

```yaml
enforcement_mode: "<strict|ask|off>"   # 新项目默认 strict；旧项目升级默认 ask
protected_write_roots:
  - "<detect，如 src/** 或 apps/** 或 packages/**>"
```

- 模型 A：默认放行；仅命中 `protected_write_roots` 的业务路径才套用 off/ask/strict。
- 永远不拦：`.claude/**`、`<FEATURE_ROOT>/**`、`<REVIEW_ROOT>/**`、`openspec/**`。
- 授权文件：`.claude/runtime/dev-flow/write-authorization.json`（每 worktree 一份）。细则见 `dev-flow/references/status-cli.md`。
- `strict` 且 roots 为空或不安全时，`dev-flow-doctor --preflight` 失败。

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

### 资产保留

完成收尾后，`dev_flow.artifacts.retention: compact`（默认）只保留 `feature.md`、`completion.md` 和可复用的 `manual-test.md`；取值 `full` 时把需求、计划、覆盖、审查、回撤和验证等中间资产移动到 feature 目录下带时间戳的 `archive/`。`completion.md` frontmatter 字段的唯一来源是 `dev-flow/references/protocol.md`。

## 局部规范

局部规范是可选能力，用于把某个包、模块、页面或技术层的工程约定放到 `<SCOPED_SPEC_ROOT>/<scope>/index.md`。每个 `index.md` 必须包含 `Pre-Development Checklist` 和 `Quality Check`。

读取规则：

- XS/S 不因为局部规范存在而升级，也不为了读取局部规范创建额外产物。
- M/L 只有在计划、改动路径或用户输入明确命中某个 scope 时才读取对应局部规范。
- 找不到匹配 scope 时不报错，继续使用项目适配层和通用 rules。

## 状态文件

标准 M/L、轻量 L 和任何需要跨技能交接的任务都维护 `<FEATURE_ROOT>/<feature-id>/status.md`。schema、字段取值、更新规则和恢复中断流程的唯一来源是 `dev-flow/references/protocol.md` 与 `contract.json`；**创建与更新一律使用** `dev-flow-status` CLI，本文件不维护字段副本。

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

固定三个：`security-reviewer`、`code-reviewer`、`build-error-resolver`。本节只记录本项目的例外：

- `<detect-not-applicable-agent>`：`<reason，如无构建步骤>`

## Claude 项目 onboarding

首次复制到新项目或发现本文件缺失时，先做能力检测，再生成或更新本文件：

1. 检查包管理器和 lock 文件。
2. 读取项目脚本，识别 install、dev、build、type-check、lint、test、format、preview。
3. 判断 test 是否是真测试运行器，还是仅启动开发/测试模式。
4. 判断是否存在 OpenSpec、浏览器测试、单元测试、代码映射或文档生成流程。
5. 判断 git 是否可用，以及 `.claude/` / `CLAUDE.md` 是否被忽略。
6. 检查是否已有 `<SCOPED_SPEC_ROOT>`；没有也可以保留为空的可选能力。
7. 安装并验证 `.claude/settings.json` 中的 hooks 注册（`dev-flow-gate-guard`、`dev-flow-finish-guard`），确认脚本可执行。
8. 写入 `enforcement_mode`（新项目 `strict`）与 `protected_write_roots`（按源码根目录 glob，如 `src/**`）。
9. 按目录结构生成 `dev_flow.label_hints` 初始猜测（可选）。
10. 写入项目能力、测试策略、OpenSpec 策略、启用 agents、路径别名和 feature/review 等资产路径。
11. 运行 `dev-flow-doctor --preflight` 确认本地安装完整性。

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

风险标签定义、最低门禁映射、gate 形态（none/light/full）、`risk_evidence` 填写方式和登录/鉴权/SSO 验证矩阵的唯一来源是 `dev-flow/references/risk-gates.md`（与 `contract.json` 同步）。风险标签不提升规模等级；本节不复制其内容，只记录本项目的路径→风险提示。

### label_hints（可选）

`dev_flow.label_hints` 把项目路径模式映射到建议风险标签，分级时作为提示，不是强制规则，也不能替代实际风险判断：

```yaml
label_hints:
  - glob: "<detect，如 src/auth/**>"
    labels: ["security"]
  - glob: "<detect，如 src/payment/**>"
    labels: ["money"]
```

onboarding 时按目录结构生成初始猜测；分级发现遗漏时随时补充，不必等待重新 onboarding。
