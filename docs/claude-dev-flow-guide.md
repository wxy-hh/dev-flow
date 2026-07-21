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

## 安装与升级（手把手）

把 dev-flow 装到业务项目、或把旧版升到本仓库最新版，按下面两种情况做。  
**先分清你是哪种，再按「第 1 步、第 2 步…」原样执行。**

下面路径请换成你本机真实路径：

```text
本仓库（最新流程包，下文叫「源包」）:
  /Users/weixiaoyu/Desktop/practice/dev-flow

业务项目（要安装或升级的目标，下文叫「目标项目」）:
  /Users/weixiaoyu/Desktop/practice/AI-aggregation
```

| 情况 | 你怎么判断 | 走哪一节 |
|------|------------|----------|
| 情况 1 | 目标项目**从未**用过 dev-flow | [情况 1：首次安装](#情况-1业务项目还没使用过dev-flow首次安装) |
| 情况 2 | 目标项目**已经**有旧版 dev-flow，要升到最新 | [情况 2：已使用旧版要升级到最新](#情况-2业务项目已经使用了旧版要升级到最新) |

核心规则（两种情况都适用）：

```text
1. 升级/安装命令必须在「源包」目录里执行，--target 指向「目标项目」绝对路径
2. 业务项目自己不能 magically 变成最新版
3. 装完或升完后，必须在「目标项目」里跑 /onboard-dev-flow 生成或刷新适配层
4. 不要复制别的项目的 project-workflow.md
```

---

### 情况 1：业务项目还没使用过 dev-flow（首次安装）

#### 第 1 步：打开终端，进入源包，拉最新代码

```bash
cd /Users/weixiaoyu/Desktop/practice/dev-flow
git pull
```

确认你就在源包根目录（该目录下能看到 `.claude/skills/dev-flow/`）。

#### 第 2 步：仍在源包，把流程层安装到目标项目

先检查，再安装（`--target` 必须是绝对路径）：

```bash
cd /Users/weixiaoyu/Desktop/practice/dev-flow

.claude/skills/dev-flow/scripts/dev-flow-upgrade \
  --target /Users/weixiaoyu/Desktop/practice/AI-aggregation \
  --check

.claude/skills/dev-flow/scripts/dev-flow-upgrade \
  --target /Users/weixiaoyu/Desktop/practice/AI-aggregation \
  --apply
```

这一步会把源包里的受管流程层（skills、commands、agents、hooks、通用 rules、manifest 等）写入目标项目。  
**不要**手工只拷几个 skill 文件。

#### 第 3 步：仍在源包，复制使用文档和 CLAUDE 片段（推荐）

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

#### 第 4 步：进入目标项目，处理 CLAUDE.md

```bash
cd /Users/weixiaoyu/Desktop/practice/AI-aggregation
```

- **已有** `CLAUDE.md`：把 `templates/CLAUDE.dev-flow-snippet.md` 合并进去  
- **没有** `CLAUDE.md`：可基于该片段新建，并写上本项目技术栈、命令和禁止事项  
- 框架/栈规则写进目标项目自己的 rules 或 `CLAUDE.md`，不要指望源包代管  

#### 第 5 步：仍在目标项目，用 Claude 生成项目适配层

在 **目标项目** 的 Claude Code 对话里输入：

```text
/onboard-dev-flow
```

若要同时跑迁移烟测：

```text
/onboard-dev-flow --smoke-test
```

onboarding 会检测包管理器、脚本、测试能力、OpenSpec、hooks、label_hints 等，并生成：

```text
.claude/rules/project-workflow.md
```

其中 `dev_flow` 配置块必须与正文表格一致。  
本地配置模式下 `.claude/` 可被 git ignore；仓库治理模式下只提交需要共享的治理文件，继续忽略 runtime、settings.local 和一次性产物。

#### 第 6 步：仍在目标项目终端，跑 doctor

```bash
cd /Users/weixiaoyu/Desktop/practice/AI-aggregation

.claude/skills/dev-flow/scripts/dev-flow-doctor --preflight
.claude/skills/dev-flow/scripts/dev-flow-doctor
```

#### 第 7 步（可选）：按 smoke test 验收

见 [claude-dev-flow-smoke-test.md](./claude-dev-flow-smoke-test.md)。  
通过后再开始真实业务任务；日常入口：

```text
/dev-task <需求描述>
```

标准 M/L、轻量 L、risk-minimal 收尾时另跑：

```bash
.claude/skills/dev-flow/scripts/dev-flow-feature-check <feature-id> --finish
```

---

### 情况 2：业务项目已经使用了旧版，要升级到最新

#### 第 0 步：在目标项目收尾进行中的 feature

```bash
cd /Users/weixiaoyu/Desktop/practice/AI-aggregation
```

必须做到：

1. 进行中的任务用 `/finish` 收尾，或手动清理未完成 feature  
2. `project-workflow.md` 里配置的 `feature_root` 下**不再有**任何 `status.md`  
3. 工作区干净，或先提交 / 备份  

有活动 `status.md` 时，`--apply` 会**零修改拒绝**，不会动任何文件。

#### 第 1 步：进入源包，拉最新代码
先拉取本项目
git clone https://github.com/wxy-hh/dev-flow.git
比如源码拉取了本地的/Users/weixiaoyu/Desktop/practice/dev-flow位置
```bash
cd /Users/weixiaoyu/Desktop/practice/dev-flow
git pull
```

#### 第 2 步：仍在源包，先 check 再 apply

```bash
cd /Users/weixiaoyu/Desktop/practice/dev-flow

.claude/skills/dev-flow/scripts/dev-flow-upgrade \
  --target /Users/weixiaoyu/Desktop/practice/AI-aggregation \
  --check
```

看输出里的 `MISSING` / `DRIFT` / `DEPRECATED_PRESENT`，确认目标路径无误后：

```bash
cd /Users/weixiaoyu/Desktop/practice/dev-flow

.claude/skills/dev-flow/scripts/dev-flow-upgrade \
  --target /Users/weixiaoyu/Desktop/practice/AI-aggregation \
  --apply
```

`--apply` 会自动：

- 备份到目标项目  
  `.claude/runtime/dev-flow/upgrade-backup-<时间戳>/`  
- 用源包最新受管文件覆盖流程层  
- **保留**目标项目的 `project-workflow.md`（只同步 `dev_flow.version`；缺省时补旧项目友好的 `enforcement_mode: ask`）  
- 合并 `settings.json` 里的 dev-flow hooks（保留你项目其它 hook）  
- 删除 `deprecated_paths`（含已弃用的 `vue3.md`）  
- 隔离旧 shared SDD 顶层文件到 backup 的 `legacy-sdd/`  
- 跑目标项目 `dev-flow-doctor --preflight`；失败则从 backup 完整回滚  
- 成功后作废旧 `write-authorization.json` 与全部 `*.check-ok`  

升级**不是** onboarding：栈规则仍由目标项目自建，upgrade 不管理。

#### 第 3 步：进入目标项目，刷新适配层

```bash
cd /Users/weixiaoyu/Desktop/practice/AI-aggregation
```

在 Claude 对话里输入：

```text
/onboard-dev-flow
```

旧版 `project-workflow.md` 的路径、验证命令、能力探测往往过期，这一步按**当前项目事实**刷新。  
可选：

```text
/onboard-dev-flow --smoke-test
```

#### 第 4 步：仍在目标项目终端，跑 doctor

```bash
cd /Users/weixiaoyu/Desktop/practice/AI-aggregation

.claude/skills/dev-flow/scripts/dev-flow-doctor --preflight
.claude/skills/dev-flow/scripts/dev-flow-doctor
```

#### 第 5 步：升级后立刻要知道的事

| 项 | 你要做什么 |
|----|------------|
| 旧 write-authorization | 已失效，写业务代码前需重新激活 |
| 旧 `*.check-ok` | 已失效，收尾须重新 `feature-check` |
| 旧 gate 别名 | 可按提示 `dev-flow-status repair` |
| 自定义 skill / 栈规则 | 一般会保留；栈规则继续项目自建 |
| 进行中 feature | 升级前就该清掉，upgrade 不会帮你迁活动任务 |

通过后再用 `/dev-task` 做真实需求。

---

### 两种情况对照

| 步骤 | 情况 1 首次安装 | 情况 2 升级旧版 |
|------|-----------------|-----------------|
| 在哪执行 upgrade | **源包**目录 | **源包**目录 |
| `--target` | 目标项目绝对路径 | 目标项目绝对路径 |
| 升级前清活动 status | 通常无 | **必须** |
| `/onboard-dev-flow` | 目标项目里，**必做** | 目标项目里，**必做** |
| doctor | 目标项目里 | 目标项目里 |
| 复制 docs/templates | 推荐 | 可选（需要新文档时再拷） |

### 明确不要做

1. 不要只在目标项目里执行旧脚本，指望它自己升级成最新  
2. 不要 `cp -r` 半份 skill 覆盖  
3. 不要把 A 项目的 `project-workflow.md` 拷到 B 项目  
4. 不要在有活动 `status.md` 时强行 `--apply`  
5. 不要把 upgrade 当成 onboard：装完/升完后适配层仍要 `/onboard-dev-flow`

## 核心资产与风险标签

| 接口 | 路径 | 使用边界 |
|------|------|----------|
| 机器可读状态 | `<FEATURE_ROOT>/<feature-id>/status.md` 的 `dev_flow_status` frontmatter | 轻量 L、标准 M/L、需要跨技能恢复的任务 |
| HUMAN GATE | `dev_flow_status.human_gates.{requirement_confirmation,implementation_approval}` | 标准 M/L 两者都必需；轻量 L 和 risk-minimal（XS/S/M）只需 `implementation_approval` |
| 最终资产 | `<FEATURE_ROOT>/<feature-id>/{feature.md,completion.md}` | 完成后默认保留；中间资产按 `dev_flow.artifacts.retention` 压缩或归档 |
| 局部规范 | `<SCOPED_SPEC_ROOT>/<scope>/index.md` | 可选；M/L 明确命中 scope 时读取 |

`status.md` 的 schema、`assets` 列表规则和恢复中断流程唯一来源是 `dev-flow/references/protocol.md`；本指南不维护副本。

风险标签独立于规模：`security`、`data`、`money`、`external`、`availability`、`critical_correctness`、`irreversible_consequence`。normal 的 XS/S 和 light M 命中标签时用 `profile: "risk-minimal"`，M 派生 `risk-minimal-m`；无风险 `in-scope` retrospective 也复用这两条 status 路线。standard M/L 仍可携带标签。risk-minimal 不要求需求书、实现计划、coverage 或 plan-review，但不减少实现确认、风险门、code-review 和行为验证。

标准 M/L 共用同一需求固化路由，并在分类同回合以 `--entry-gate` 写入 status：完整但未确认的需求文档走 `grillme`；需求模糊或没有文档走 `req-probe -> grillme`；用户已明确确认需求基线且无未决问题时，登记 evidence 后跳过两者进入 `writing-plans`。每个 process gate 用 `complete-gate` 更新可恢复的 `next_action`。需求固化阶段只确认一次，由 `grillme` 在文档更新后触发；确认前不得写实现计划。实现前确认前不得写业务代码；`code-review` 不能替代 `plan-review`。标准 L 计划后固定骨架是 `requirements-coverage -> plan-review`，标准 M 的 coverage 仅在风险维度触发时执行。

## 各级别实现路线与进度判断

dev-flow 先判断规模与拓扑，再独立判断风险。`local` 允许 XS/S/M；`shared-contract` 最低 M，破坏共享契约时为 L；`multi-chain`、`coordinated-rollback` 必须 L。同一功能的匿名/账号/OAuth 行为分支是验证矩阵，不是 multi-chain。文件数量不决定等级。

### 开始前路线速查

| 路线 | 适用情况 | 完整路线 | 强制停顿 | 收尾要求 |
|------|----------|----------|----------|----------|
| XS | 单点、私有或局部、契约稳定 | 定位 → 最小修改 → 验证 | 无 | 新鲜验证 |
| S | 单模块局部变化、边界清楚、可独立回滚 | 边界确认 → 实现 → 验证 | 最多一个阻塞问题 | 新鲜验证 |
| risk-minimal XS/S/M | normal 命中标签，或无风险 in-scope retrospective | 风险卡 → 风险门禁 → 实现确认 → 实现 → code-review → 行为验证 | `implementation_approval` | verification + feature-check |
| 轻量 M | 功能内多步骤，但需求和共享契约稳定 | 边界确认 → 短计划 → 实现 → code-review → 验证 | 无固定 HUMAN GATE | verification；无 status 时不强制 feature-check |
| 标准 M | 需求分支、状态、错误路径或契约存在不确定性 | 需求固化 → 需求确认 → 计划 → 可选 coverage → plan-review → 风险检查 → 实现确认 → 实现 → code-review → 验证 | `requirement_confirmation`、`implementation_approval` | verification + feature-check |
| 轻量 L | 跨层，但边界清楚、设计自明、验证方式明确 | 边界卡 → 回撤/风险检查 → 实现确认 → 实现 → full 行为验证 → code-review | `implementation_approval` | verification + feature-check |
| 标准 L | 跨层且有共享契约、多链路、方案取舍或协调回滚 | 需求固化 → 需求确认 → 计划 → coverage → plan-review → 回撤/风险检查 → 实现确认 → 分批实现 → 回撤审计 → full code-review → full 验证 | `requirement_confirmation`、`implementation_approval` | verification + feature-check + finalization |

表中的“需求确认”和“实现确认”在实际输出中写成 `[HUMAN GATE:<gate-id>]`。一旦出现 HUMAN GATE 或 `Auto-continue: no`，本回合必定停止；用户明确回复确认、继续或接受风险并继续后，流程才会进入下一段。

### XS：直接修改路线

```text
读取直接相关文件
→ 判断为 XS 且无风险标签
→ 写入有限授权
→ 最小修改
→ 运行最相关验证
→ 汇报文件和验证结果
```

这条路线不创建需求、计划或 `status.md`，也不强制 code-review 和 feature-check。

### S：边界确认路线

```text
读取相关实现
→ 复述需求和关键边界
→ 必要时最多询问一个阻塞问题
→ 写入有限授权
→ 实现
→ 运行相关验证
→ 汇报结果
```

无风险 S 默认不创建流程资产。用户明确要求保留需求、计划或审查记录时才生成相应文档。

### risk-minimal：XS/S/M 的最小状态路线

```text
输出最小风险卡
→ `node .claude/skills/dev-flow/scripts/dev-flow-status.mjs start <feature-id> …`（在仓库根目录执行）创建 risk-minimal status.md（M 派生 risk-minimal-m）
→ 完成标签派生的 rollback/security 等实现前门禁
→ [HUMAN GATE:implementation_approval]
→ 用户确认
→ 实现
→ code-review
→ 标签要求的行为验证
→ verification-before-completion
→ dev-flow-feature-check --finish
→ completion / 收尾
```

这条路线不要求需求说明书、`req-probe`、`grillme`、`writing-plans`、coverage 或 plan-review。它表达“小/中而高风险”；风险本身不把规模升级为 L。

### 轻量 M：对话内短计划路线

```text
复述需求边界和不做范围
→ 必要时轻量 req-probe
→ 对话内短计划
→ 实现
→ code-review
→ verification-before-completion
→ 汇报结果
```

轻量 M 默认没有 `status.md`，因此不强制 feature-check。出现契约不确定、重要方案分支、需要正式恢复点或用户要求留档时，应转入标准 M/L。

### 标准 M：需求和计划双确认路线

标准 M/L 的需求固化只有以下三种入口，整个需求阶段只确认一次：

```text
完整但尚未确认的需求 → grillme → requirement_confirmation
模糊或没有需求文档   → req-probe/openspec → grillme → requirement_confirmation
用户已明确确认基线   → 记录确认原话 → 直接 writing-plans
```

取得需求确认后的主路线：

```text
writing-plans
→ requirements-coverage（仅在风险维度触发）
→ plan-review（至少 light）
→ rollback/security 等已触发的实现前检查
→ [HUMAN GATE:implementation_approval]
→ 用户确认
→ 按批准计划实现
→ rollback 审计（rollback_units: full 时）
→ code-review
→ verification-before-completion
→ dev-flow-feature-check --finish
→ final assets / 收尾
```

需求确认只授权创建实现计划；实现确认必须基于已经完成的计划和实现前审查另行取得，两次确认不能共用同一条回复。

### 轻量 L：跨层但设计自明路线

```text
输出边界确认卡
→ 创建并激活 lightweight-L status.md
→ rollback light
→ 标签派生的安全/风险检查
→ [HUMAN GATE:implementation_approval]
→ 用户确认
→ 实现
→ full 行为验证
→ code-review（至少 light）
→ verification-before-completion
→ dev-flow-feature-check --finish
→ final assets / 收尾
```

轻量 L 的 `requirement_confirmation.required` 为 `false`，不强制 grillme、完整计划、coverage 或 plan-review。实现中一旦发现新需求分支、接口不明、多方案取舍、共享状态变化或难回撤，立即停止并升级标准 L。

### 标准 L：完整跨层路线

进入标准 L 前先运行 `dev-flow-doctor`。需求入口与标准 M 相同，需求确认后的固定实现前骨架不能跳过：

```text
writing-plans
→ requirements-coverage（通常 full）
→ plan-review（至少 light；复杂跨层通常 full）
→ rollback-units / security review
→ [HUMAN GATE:implementation_approval]
```

用户确认后的实现和收尾路线：

```text
按可验证批次实现
→ rollback 审计
→ code-review（固定 full 独立报告）
→ 最强相关自动化和运行时验证
→ complete-verification
→ dev-flow-feature-check --finish
→ feature.md / completion.md
→ logic-complete（此时可进入 Git）
→ finalizer dry-run
→ [ASSET FINALIZATION]
→ 用户选择 compact / retain full / not now
```

`compact` 删除中间资产并保留长期摘要；`retain full` 归档全部资产；`not now` 保持现状且不阻塞 Git。finalizer dry-run 后必须等待用户精确选择，不能在同一回合自动确认。

### 风险标签如何叠加

| 风险标签 | 最低附加门禁 |
|----------|--------------|
| `security` | security review light + behavior verification light |
| `data` | rollback light + behavior verification light |
| `money` | rollback light + behavior verification light |
| `external` | behavior verification light |
| `availability` | behavior verification light |
| `critical_correctness` | behavior verification full + code-review full |
| `irreversible_consequence` | rollback full + behavior verification full + code-review full |

多个标签取门禁并集。风险标签只增加证明义务，不把 S 自动改成 L；携带风险的 M/L 保持原有轻量/标准分流，但 status profile 仍为 `standard`。

### 执行中如何知道进行到哪一步

按以下顺序判断当前进度：

1. 先看最近一次回复中的“我判断这是 `<level>`，我会走 `<route>`”，确定级别和路线。
2. 有 `status.md` 时，以 `dev_flow_status.current_gate` 和 `next_action` 为准；`assets` 显示已经生成的需求、计划、审查和验证产物。
3. 看到 `[HUMAN GATE:requirement_confirmation]`，表示需求已整理完，正在等待允许创建实现计划。
4. 看到 `[HUMAN GATE:implementation_approval]`，表示计划和实现前检查已完成，正在等待允许写业务代码。
5. 看到 `[HANDOFF]` 时，`Current gate` 是刚完成的阶段，`Next skill` 是下一步；`Auto-continue: no` 表示必须等待用户。
6. 看到验证报告和 feature-check 通过，表示功能达到 logic-complete；看到 `[ASSET FINALIZATION]`，表示只剩资产压缩、归档或暂不处理的选择。

无 `status.md` 的 XS、S 和默认轻量 M 通过对话中的边界确认、实现、审查和验证汇报判断进度。不要为获得“进度条”而给这些轻量路线额外制造流程资产。

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
| 轻量 L | "调整登录过期后的前端 guard、路由恢复和会话清理，跨三层但方案唯一，按轻量 L" | 先出边界确认卡并创建 approval-pending `status.md`；完成回撤/安全证据后停在实现确认，行为验证 full |
| risk-minimal S | "修正 token 过期清理逻辑，只改一处工具函数，携带 security 标签" | 最小风险卡；停在 `implementation_approval`；`risk_evidence.security` 记录结论 |
| 标准 L | "重构支付回跳和订单状态同步，跨系统入口+状态+异常兜底" | 需求确认 → 计划 → coverage → plan-review → 实现前确认，全部落地 |

## 产物位置

具体路径以 `project-workflow.md` 的 `dev_flow.paths` 和路径别名表为准。

| 产物 | 用途 |
|------|------|
| `status.md` | 当前 gate、资产列表、验证新鲜度、风险证据、accepted_risks |
| `需求说明书.md` / `实现计划.md` | 标准 M/L 的需求边界与实现计划 |
| `requirements-coverage.md` | 需求到任务/验证的覆盖关系，供 `plan-review` 读取，不是完成前验证报告 |
| `rollback-units.md` | 最小回撤单元和回撤顺序 |
| `*-code-review.md` / `*-verification.md` / `*-manual-test.md` | 代码审查、完成前验证、手动行为验证证据 |
| `feature.md` / `completion.md` | 完成后的边界摘要与审查/验证/风险/回撤事实源 |

恢复中断任务时先读 `status.md` 的 `assets` 列表定位需求、计划、审查、验证资产；`[HANDOFF]` 只作辅助线索（详见 `protocol.md`）。

## 验证新鲜度

完成前必须有新鲜验证证据。`status.md` 的 `validation.last_at`、`validation.commands` 和 `business_diff_fingerprint` 用于判断验证是否过期：验证后代码又变化、或当前 fingerprint 与记录不一致时，不能复用旧结论，必须重新验证。验证结论以最新命令输出、人工测试记录、验证报告和 `feature-check` 为准。logic-complete 后即可 Git；默认 `retention: compact` 仅在用户选择后删除中间资产（full 则归档）。

## 何时跑 doctor / feature-check

`dev-flow-doctor` 时机：onboarding 后；修改 `.claude/skills`/`commands`/`agents`/`rules`/`hooks` 后；调整 `project-workflow.md` 的路径/验证命令/Git 边界后；smoke test 前；升级迁移包后。它只做静态检查，不替代业务测试或 smoke test。

`dev-flow-feature-check <feature-id> --finish`：标准 M/L、轻量 L 和 risk-minimal（XS/S/M）收尾前运行，检查验证、风险门、回撤、资产和新鲜度。仅 normal 无风险 XS/S 与默认轻量 M（无 status）不强制；in-scope retrospective 始终强制。

## 维护规则

流程层可复制，项目事实只写进 `project-workflow.md`/`CLAUDE.md`/可选 stack rule；不要把某个项目的路径、端口、mock 或测试命令写进通用 skill/command/agent。新增脚本优先读 `dev_flow.paths`，不要硬编码 runtime 目录。`.claude/rules/specs/<scope>/index.md` 只在有真实局部约定时创建。HUMAN GATE 是硬停顿：`[HUMAN GATE:*]` 或 `Auto-continue: no` 后不能同回合继续写计划/代码或把 `auto_continue` 改回 `true`。安全审查默认只读，需要修复时由主流程或用户确认后的任务执行代码修改。

## 常见问题

**doctor 提示缺少 project-workflow.md**：源迁移包仓库中是正常 warning；业务项目应先跑 `/onboard-dev-flow`。

**没有自动化测试怎么办**：`automated-tests` 写 `none`，不要把 dev/watch 命令当测试证据；L 级运行时行为改动仍需手动测试脚本或其它可复查证据。

**想跳过某个门禁**：XS/S 默认轻量不为未触发的门禁生成文档。已触发的 process/risk gate 必须形成对应证据；所有 required HUMAN GATE 只能 `confirmed`，不能用 `skipped` 绕过。用户接受残余风险时，把原话写入 `accepted_risks` 和确认 evidence，但这不等于把已触发门禁伪装为完成。

**可以让 Claude 直接提交吗**：默认不提交；用户明确要求后才执行 `git add`/`git commit`；push/合并/删除分支/丢弃改动必须二次确认。

## status CLI、finish 与 partial（v1.0）

分类统一运行 `node .claude/skills/dev-flow/scripts/dev-flow-status.mjs start <feature-id> …`（在仓库根目录执行）：XS/S 自动 light，M/L 显式选择 execution，standard 声明 requirements；dirty workspace 声明 unrelated/in-scope 和原因。normal 在 implementation approval 前要求业务 hash 等于启动基线；已提前实现时用 `mark-retrospective`，原基线不刷新。所有机器字段禁止手改；`next` 每次只给一条后续命令。

approval basis 沿用既有结构并绑定 process/baseline；批准后不再与启动基线比较，最终验证使用 `Bfinal`。gate evidence light 可 inline/report，full 只接受登记报告。`propose-risk` 的一次性 token 只接受明确“接受具名残余风险并继续/收尾”的后续回复。

**logic-complete**：feature-check + 有效 feature/completion → **可 Git**；compact/full 可选。`/finish` dry-run 后输出 `[ASSET FINALIZATION]`，只接受 `compact` / `retain full` / `not now`；禁止同回合 `--confirm`；**`not now` 不阻塞 Git**。compact 含 untracked 删除时须 `--confirm-untracked "DELETE-UNTRACKED:<inventory-sha>:<count>"`。详情见 `dev-flow/references/status-cli.md`、`partial-verification.md` 与 `protocol.md`。

受管文件升级的完整逐步命令见上文 [安装与升级（手把手）](#安装与升级手把手)。摘要：在**源包**目录执行 `dev-flow-upgrade --target <目标绝对路径> --check|--apply`，不要手工半份拷贝 skill；活动 `status.md` 存在时零修改拒绝；失败从 backup 回滚；升完后在**目标项目**跑 `/onboard-dev-flow` 与 doctor。
