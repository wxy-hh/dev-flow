# dev-flow

务实开发工作流，面向 Claude Code 的项目开发流程迁移包。

dev-flow 的目标是把一次开发请求先分级，再按风险选择最小足够流程：小改动快速实现和验证，复杂改动补齐需求固化、计划、覆盖审查、回撤单元、代码审查和完成前验证。

本迁移包保留轻量优先：无风险 XS/S 与轻量 M 不创建流程文档；携带风险标签的 XS/S/M 使用最小 `status.md` 证据档案。轻量 L 和标准 M/L 维护机器可读状态，方便中断恢复、审查和验证；关键 HUMAN GATE 不能自动跨过。

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

## 安装与升级（手把手）

下面用两个路径举例，**请换成你本机的真实路径**：

```text
本仓库（最新流程包 / 源包）:
  /Users/weixiaoyu/Desktop/practice/dev-flow

业务项目（要安装或升级的目标）:
  /Users/weixiaoyu/Desktop/practice/AI-aggregation
```

先分清你属于哪种情况：

| 情况 | 判断 | 走哪一节 |
|------|------|----------|
| 情况 1 | 业务项目**从未**装过 dev-flow（没有这套 skills/commands，或没有 `project-workflow.md`） | [情况 1：首次安装](#情况-1业务项目还没使用过dev-flow首次安装) |
| 情况 2 | 业务项目**已经**在用旧版 dev-flow，要升到本仓库最新版 | [情况 2：升级到最新版](#情况-2业务项目已经在用要升级到最新版) |

更细的说明、完成标准和常见坑见 [使用指南 · 安装与升级](docs/claude-dev-flow-guide.md#安装与升级手把手)。

### 情况 1：业务项目还没使用过 dev-flow（首次安装）

#### 第 1 步：进入本仓库，拉到最新

```bash
cd /Users/weixiaoyu/Desktop/practice/dev-flow
git pull
```

#### 第 2 步：仍在本仓库，把流程层装进业务项目

`--target` 必须是业务项目的**绝对路径**。

```bash
cd /Users/weixiaoyu/Desktop/practice/dev-flow

.claude/skills/dev-flow/scripts/dev-flow-upgrade \
  --target /Users/weixiaoyu/Desktop/practice/AI-aggregation \
  --check

.claude/skills/dev-flow/scripts/dev-flow-upgrade \
  --target /Users/weixiaoyu/Desktop/practice/AI-aggregation \
  --apply
```

#### 第 3 步：仍在本仓库，复制文档和 CLAUDE 片段（推荐）

```bash
cd /Users/weixiaoyu/Desktop/practice/dev-flow

mkdir -p /Users/weixiaoyu/Desktop/practice/AI-aggregation/docs
cp docs/claude-dev-flow-guide.md \
   docs/claude-dev-flow-smoke-test.md \
   /Users/weixiaoyu/Desktop/practice/AI-aggregation/docs/

mkdir -p /Users/weixiaoyu/Desktop/practice/AI-aggregation/templates
cp templates/CLAUDE.dev-flow-snippet.md \
   /Users/weixiaoyu/Desktop/practice/AI-aggregation/templates/
```

#### 第 4 步：进入业务项目，处理 CLAUDE.md

```bash
cd /Users/weixiaoyu/Desktop/practice/AI-aggregation
```

- 已有 `CLAUDE.md`：把 `templates/CLAUDE.dev-flow-snippet.md` 的内容合并进去  
- 没有 `CLAUDE.md`：可基于该片段新建，并补上本项目技术栈与约束  

#### 第 5 步：仍在业务项目，在 Claude Code 里生成适配层

打开业务项目，在 Claude 对话中输入：

```text
/onboard-dev-flow
```

需要顺带烟测时：

```text
/onboard-dev-flow --smoke-test
```

这步会生成：

```text
.claude/rules/project-workflow.md
```

**不要**从别的项目复制这份文件。

#### 第 6 步：仍在业务项目终端，跑自检

```bash
cd /Users/weixiaoyu/Desktop/practice/AI-aggregation

.claude/skills/dev-flow/scripts/dev-flow-doctor --preflight
.claude/skills/dev-flow/scripts/dev-flow-doctor
```

两条都通过后，才开始真实业务任务。日常入口：

```text
/dev-task <你的需求>
```

### 情况 2：业务项目已经在用，要升级到最新版

#### 第 0 步：在业务项目里先收尾进行中的任务

```bash
cd /Users/weixiaoyu/Desktop/practice/AI-aggregation
```

- 用 `/finish` 结束进行中的 feature，或删掉/归档未完成的 feature 目录  
- **只要** `feature_root` 下还存在任意 `status.md`，升级会**零修改拒绝**  
- 建议工作区干净或先 `git commit` / 备份  

#### 第 1 步：进入本仓库，拉到最新

```bash
cd /Users/weixiaoyu/Desktop/practice/dev-flow
git pull
```

#### 第 2 步：仍在本仓库，先检查再升级

```bash
cd /Users/weixiaoyu/Desktop/practice/dev-flow

.claude/skills/dev-flow/scripts/dev-flow-upgrade \
  --target /Users/weixiaoyu/Desktop/practice/AI-aggregation \
  --check

.claude/skills/dev-flow/scripts/dev-flow-upgrade \
  --target /Users/weixiaoyu/Desktop/practice/AI-aggregation \
  --apply
```

`--apply` 成功后会：

- 用本仓库最新流程层覆盖业务项目受管文件  
- **保留**业务项目的 `project-workflow.md`（只同步版本号等契约字段）  
- 合并 hooks，删除已弃用路径（如 `vue3.md`）  
- 自动 backup；失败会回滚  
- 作废旧的 `write-authorization.json` 和 `*.check-ok`  

#### 第 3 步：进入业务项目，刷新适配层

```bash
cd /Users/weixiaoyu/Desktop/practice/AI-aggregation
```

在 Claude 对话中输入：

```text
/onboard-dev-flow
```

升级**不会**替你按新项目事实重写适配层，这一步必须做。

#### 第 4 步：仍在业务项目，跑自检

```bash
cd /Users/weixiaoyu/Desktop/practice/AI-aggregation

.claude/skills/dev-flow/scripts/dev-flow-doctor --preflight
.claude/skills/dev-flow/scripts/dev-flow-doctor
```

通过后即可继续 `/dev-task`。

### 安装 / 升级时不要做的事

- 不要只在业务项目里跑旧版脚本，指望它自己变成最新版  
- 不要手工半份拷贝几个 skill 文件  
- 不要把别的项目的 `project-workflow.md` 拷过来当适配层  
- 不要在还有活动 `status.md` 时强行 `--apply`

## 日常入口

```text
/dev-task <你的需求>
```

dev-flow 会先判断 XS / S / M / L：

| 路线 | 实现步骤速查 |
|------|--------------|
| XS | 定位 → 最小修改 → 验证 → 完成 |
| S | 边界确认 → 实现 → 验证 → 完成 |
| risk-minimal XS/S/M | 风险卡 → 风险门禁 → **实现确认** → 实现 → 审查/行为验证 → feature-check |
| 轻量 M | 边界确认 → 短计划 → 实现 → code-review → 验证 |
| 标准 M | 需求固化 → **需求确认** → 计划 → plan-review → **实现确认** → 实现 → code-review → 验证 → feature-check |
| 轻量 L | 边界卡 → 回撤/风险检查 → **实现确认** → 实现 → full 行为验证 → code-review → feature-check |
| 标准 L | 需求固化 → **需求确认** → 计划 → coverage → plan-review → 回撤/风险检查 → **实现确认** → 分批实现 → full 审查/验证 → feature-check |

风险标签不改变 XS/S/M/L 规模，只给原路线增加必要门禁。表中的“需求确认”和“实现确认”都是必须停下等待用户回复的 HUMAN GATE。标准 M 的 coverage 只在风险维度触发，标准 L 的 coverage 是固定步骤。

完整路线、每一步的含义以及“当前进行到哪里”的判断方法见[各级别实现路线](docs/claude-dev-flow-guide.md#各级别实现路线与进度判断)。

## 迁移文档

- [使用指南 · 安装与升级手把手](docs/claude-dev-flow-guide.md#安装与升级手把手)
- [使用指南全文](docs/claude-dev-flow-guide.md)
- [迁移后烟测说明](docs/claude-dev-flow-smoke-test.md)

## 静态自检

迁移或修改流程层后，可以先运行轻量 doctor：

```bash
.claude/skills/dev-flow/scripts/dev-flow-doctor
```

doctor 只做静态检查，分三类：结构（关键文件存在、脚本可执行、`contract.json` 可解析、hooks 已注册）、一致性（`risk-gates.md` 与 contract 风险标签同步、旧项目事实泄漏、行数预算、`workflow_version` 单源）、适配层（占位符残留、test 命令疑似 dev/watch）。`workflow_version` 单源只约束包表面硬编码；`completion.md` 里的版本戳记是 feature  provenance，不参与单源失败。它不运行业务测试，也不替代 smoke test。

维护流程包时，使用统一入口运行七组回归和 doctor；它会继续执行后续组并在最后汇总失败：

```bash
.claude/skills/dev-flow/scripts/dev-flow-test
```

单个标准 M/L、轻量 L 和 risk-minimal（XS/S/M）功能收尾前运行 feature evidence 检查：

```bash
.claude/skills/dev-flow/scripts/dev-flow-feature-check <feature-id> --finish
```

它检查验证报告、手动行为证据、风险标签的最低 gate 与证据、回撤闭环、`status.md` 的 `assets` 列表和验证新鲜度。doctor 负责流程包/项目适配层，feature-check 负责某个真实 feature 的执行产物；两者都通过后才能进入分支收尾。无风险 XS/S 与默认轻量 M（无 `status.md`）不强制 feature-check。

## 注意

- 不要把旧项目的 `.claude/rules/project-workflow.md` 复制到新项目。
- 不要提交 `.claude/runtime/`、`settings.local.json` 或一次性生成产物。
- 框架/栈规则由目标项目自建，不随迁移包分发；升级会删除已弃用的 `vue3.md`。
- 如果目标项目没有真实测试运行器，不要把 `npm test`、`pnpm test` 这类命令默认当成测试证据。
- 不要把局部规范或机器可读状态当成新仪式；它们只服务轻量 L 和标准 M/L 的恢复、审查和验证。
- 不要把实现后的 `code-review` 当成实现前 `plan-review`；出现 `[HUMAN GATE:*]` 或 `Auto-continue: no` 后必须停下等用户确认。
- 不要把 `requirements-coverage` 做成第二套验证系统；它只检查需求和计划是否覆盖，默认只把结论交给 `plan-review`。
- 完成功能后默认按 `dev_flow.artifacts.retention: compact` 收尾，长期只保留 `feature.md`、`completion.md` 和可复用的手测脚本；需要完整审计时才使用 `full` 归档原始资产。

## v1.0.1 执行闭环

- 分类统一从 `node .claude/skills/dev-flow/scripts/dev-flow-status.mjs start <feature-id> …`（在仓库根目录执行）进入；XS/S 自动 light，M/L 显式选择 execution，topology 硬约束 multi-chain/coordinated rollback 为 L。`next` 每次只给一个可执行 blocker。
- status schema 4 记录 normal/retrospective、启动基线和 existing diff disposition；normal 在 implementation approval 前要求当前业务 hash 等于基线，批准后以最终 hash 判断验证新鲜度。
- write authorization schema 2 延续既有 approval basis，绑定 process/baseline/route/risk/protected roots/前置资产，不新增 diff manifest。
- gate evidence 复用 inline/report；full 只接受登记报告。风险接受用 HANDOFF + 一次性 token，通用“继续/确认”不能消费。
- partial 验证：手测七列 + 可选 `method`；`skipped` + `AR-xxx` + partial-acceptance 三方一致（见 `dev-flow/references/partial-verification.md`）。static-review 不得冒充 runtime passed。
- **logic-complete**：feature-check + feature/completion 有效 → **可 Git**；compact/full 可选。
- `/finish`：先 `next`，每次推进一个 blocker；再按 verification → feature-check → final assets → logic-complete → finalizer dry-run。禁止同回合 `--confirm`；`not now` **不阻塞 Git**。
- compact **删除**中间资产（含 feature-owned reviews）；有 untracked 删除时须 `--confirm-untracked "DELETE-UNTRACKED:<inventory-sha>:<count>"`。full **归档**到 `archive/`。
- 受管升级：在**源包**执行 `dev-flow-upgrade --target <目标绝对路径> --check|--apply`；**活动 status 存在时零修改拒绝**；清单 `.claude/dev-flow.manifest.json`。完整步骤见上文「安装与升级」。
- 本地完整性：在**目标项目**跑 `dev-flow-doctor --preflight`；包维护回归：`dev-flow-test`。
