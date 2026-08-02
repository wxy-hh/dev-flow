# Dev Flow

Dev Flow 是面向 **Claude Code** 与 **Codex CLI** 的预构建双宿主插件。

它按**规模（XS/S/M/L）× 拓扑 × 执行方式（light/standard）× 需求状态 × 风险标签**选择路线，只强制该路线所需的步骤与证据；两端共用 `.dev-flow/` 状态，可在 Claude 开任务、Codex 收尾（或反向）。

- 安装与升级：仅宿主原生 marketplace / plugin 命令  
- 流程接口：本地 MCP（Skills 不得手改状态文件）  
- 不提供：复制安装、升级脚本、旧版迁移、CLAUDE.md 注入、OpenSpec 集成  

更细的契约见 [路线说明](docs/routes.md)、[架构](docs/architecture.md)、[发布](docs/publishing.md)。

## v2 可追溯性（2.0.0+）

标准 M/L 的需求与实施计划通过 `dev_flow_record_artifact_with_trace` 原子登记；`dev_flow_get_traceability` 只读查看 pointer、ledger、summary 与 blocker。Markdown 只用于叙述，内容寻址 snapshot 才是事实层，state pointer 是提交点。不要直接写 `.dev-flow/features/*/traceability/**`。

generated status 只由 Core scaffold/refresh；standard L 没有 status 文件，应读取 `dev_flow_status`。

**Review 2a / 4B**：新 standard M/L feature 使用不可变 review batch 与 Core 生成的只读 `plan-review` 投影。默认保证等级为 `multi-perspective`（多角色完成 ≠ 已证明多代理）。可选服务端采样可升至 `independent-sampling`；可选宿主 subagent attestation 最多 `multi-agent-attested`（不是 verified）。v2 的 checkpoint 由 Core 在所有路线的实现边界自动捕获：XS/S 使用单一基线，light M 默认单元，M/L 按事实和可验证切片增加边界，不要求 agent 手动推进。回撤执行仍走既有事务日志和显式恢复确认；checkpoint 是实现期恢复，finalize 的 delivery snapshot / feature 级反向 patch 仍是交付层回退证据，二者不可互相替代。

---

## 安装

### 先分清两件事

| 概念 | 是什么 | 落在哪里 |
|------|--------|----------|
| **插件安装** | 宿主加载 skills / hooks / MCP | Claude：user / project / local 范围 |
| **项目初始化** | 生成流程配置与状态目录 | 业务仓库里的 **`.dev-flow/`** |

插件装好 ≠ 项目已初始化。每个要用 Dev Flow 的业务仓库，还要在该仓库里跑一次 **`dev_flow_init_project`**（见下文「安装之后做什么」）。

本插件 **没有** 斜杠命令 `/dev_flow_init_project`。  
`dev_flow_init_project` 是 **MCP 工具名**；会话里用自然语言让 Claude 调用即可。

### Claude Code：安装范围

| 范围 | 命令参数 | 配置落点 | 适用场景 |
|------|----------|----------|----------|
| **user**（默认） | 不写或 `-s user` | 用户级配置 | 你自己所有项目都用 |
| **project** | `-s project` | 仓库 **`.claude/settings.json`**（可提交 git） | **团队共享，推荐项目级** |
| **local** | `-s local` | **`.claude/settings.local.json`**（通常 gitignore） | 仅本机本仓库，不共享给同事 |

marketplace 也可以按同样范围声明（`--scope`）。

### Claude Code：用户级安装（默认）

```bash
claude plugin marketplace add wxy-hh/dev-flow
claude plugin install dev-flow@dev-flow-marketplace
# 等价：claude plugin install dev-flow@dev-flow-marketplace --scope user
```

装好后，你在**任意**业务项目打开 Claude Code，只要插件已启用，就能用 Dev Flow 的 skills / MCP（仍需对该仓库做 `dev_flow_init_project`）。

### Claude Code：项目级安装（团队推荐）

在**业务项目仓库根目录**执行（不是在 dev-flow 源码仓，除非你要 dogfood 自己）：

```bash
cd /path/to/your-business-repo

# 1. 把 marketplace 记到项目（可选但推荐，方便同事 clone 后一致）
claude plugin marketplace add wxy-hh/dev-flow --scope project

# 2. 把插件装到项目
claude plugin install dev-flow@dev-flow-marketplace --scope project
# 简写
claude plugin install dev-flow@dev-flow-marketplace -s project
```

说明：

- 会改动/写入项目的 **`.claude/settings.json`**（以及 marketplace 相关项目配置）。  
- 请把需要共享的 `.claude/settings.json` **提交到 git**，同事 pull 后信任工作区并安装/启用同名插件。  
- 若只想自己用、不进 git：用 `-s local`。

### Claude Code：卸载

**范围必须与安装时一致**，否则卸错层。

```bash
# 卸项目级
claude plugin uninstall dev-flow@dev-flow-marketplace --scope project

# 卸用户级
claude plugin uninstall dev-flow@dev-flow-marketplace --scope user

# 卸本机项目级
claude plugin uninstall dev-flow@dev-flow-marketplace --scope local
```

可选：

```bash
# 保留插件持久数据目录时
claude plugin uninstall dev-flow@dev-flow-marketplace --scope project --keep-data
```

卸载插件 **不会** 自动删除业务仓里的 `.dev-flow/`（状态与配置会留下）。若要彻底清理项目侧：

```bash
# 在业务仓库根目录，确认后手动删除
rm -rf .dev-flow
# 并检查 .gitignore / .claude/settings.json 里是否还引用 dev-flow
```

marketplace 若只给本项目用、也要去掉：

```bash
claude plugin marketplace list
# 按列表中的名称移除，例如：
claude plugin marketplace remove dev-flow-marketplace
# 若 add 时用了 --scope project，remove 时注意是否支持/是否需在同一项目下操作（以 claude plugin marketplace --help 为准）
```

### Claude Code：升级

```bash
claude plugin marketplace update
# 或指定 marketplace 名
claude plugin update dev-flow@dev-flow-marketplace
```

升级后 **新开会话** 或 `/reload-plugins`。  
**没有** `dev-flow-upgrade` 命令。

### Codex CLI

```bash
codex plugin marketplace add wxy-hh/dev-flow
codex plugin add dev-flow@dev-flow-marketplace
```

Codex 当前 **没有** 与 Claude 对等的 `--scope project` 安装参数；一般为用户级配置。  
团队共享仍靠：每人安装插件 + 仓库内提交 **`.dev-flow/`**（及约定）。  
升级：`codex plugin marketplace upgrade` 等原生命令（以 `codex plugin --help` 为准）。

### 安装之后应该做什么（逐步）

以下在**业务项目仓库**中操作。

#### 1. 确认插件已加载

```bash
claude plugin list
```

在 Claude Code 会话中：

1. **新开**一个会话，或执行 `/reload-plugins`。  
2. 打开 `/plugin`，确认 **dev-flow** 为已安装且 **enabled**。  
3. 打开 `/mcp`，确认存在 **dev-flow** 服务器，且工具列表里有例如：  
   `dev_flow_init_project`、`dev_flow_start`、`dev_flow_next`、`dev_flow_status`、`dev_flow_doctor` 等。  
4. 若 hooks 提示未信任：按宿主 UI **审核并信任** dev-flow 的 hooks（未信任则门禁不生效）。

**没有** `/dev_flow_init_project` 或 `/dev-flow:init` 之类斜杠命令是正常的。

#### 2. 初始化本仓库（每个业务仓一次）

在对话中明确要求调用 MCP，例如：

```text
请用 Dev Flow 的 MCP 工具 dev_flow_init_project 初始化当前仓库：
- 检测包管理器与常用脚本
- 生成 .dev-flow/project.json
- protected roots 设为所有需要归属、指纹、checkpoint 与交付的 feature-owned 目录（例如 src、tests、配置或脚本目录；临时日志和构建输出不要加入）
- enforcement 使用 strict
- 登记 unit/lint 等验证命令（按本项目真实脚本填写）
```

成功标志：

```text
.dev-flow/
  project.json          # 必须存在且可被 doctor 读过
```

未执行本步时，**不能** `dev_flow_start`。

需要用户确认的 grill/approval 交互依赖宿主 hooks 捕获提示与回复事件；若宿主尚未信任或加载 hooks，Core 会拒绝无来源的确认，而不是绕过审计。请先按上面的宿主提示完成信任，再重试当前交互。

#### 3. 自检

```text
请调用 dev_flow_doctor，汇报 project / active / 插件文件与接线是否正常
```

或自然语言：「跑一下 Dev Flow doctor」。

#### 4. 开始第一个任务

```text
用 /dev-flow:task（或：用 Dev Flow 开始任务）：
功能是 ……；请先创建 intake，再调查事实、classify 并锁定分类。
```

之后固定习惯：

1. 先 `dev_flow_start` 创建 intake，再用 `dev_flow_classify` 预览并用 `dev_flow_lock_classification` 原子锁定事实分类。
2. 按 `dev_flow_next` 返回的阶段能力推进；阶段内等价操作可以自由安排，不必为每个工具动作停下来确认。
3. 动态 approval obligation、重大偏航、未解决 blocking finding 或不可恢复错误才需要用户决策；展示后等待用户下一条消息，再确认或修改。
4. **logic-complete 之前**，hooks 会拦截 Git 写操作（add/commit/push 等）。

#### 5. 日常与收尾

| 目的 | 怎么说 / 用什么 |
|------|------------------|
| 看状态 | `/dev-flow:status` /「Dev Flow 状态」 |
| 诊断 | `dev_flow_doctor` / `/dev-flow:doctor` |
| 收尾 | `/dev-flow:finish` |
| 需求拷问 | 标准 M/L 自动进 `/dev-flow:grillme`，或显式说 grillme / 拷问 |

### 安装后常见问题

| 现象 | 处理 |
|------|------|
| 找不到 `/dev_flow_init_project` | 正常。用自然语言让模型调 **MCP 工具** `dev_flow_init_project` |
| `/mcp` 里没有 dev-flow | 检查 `plugin list` 是否 enabled；reload；确认 install 的 scope 是否装在当前环境 |
| 换项目后没有插件 | user 范围应全局有；若当时用了 project/local，只在对应仓库生效 |
| 同事 clone 后没有插件 | project 范围需提交 `.claude/settings.json`，同事执行同 scope 的 install 或按团队文档安装 |
| 卸了插件但 `.dev-flow` 还在 | 预期行为；需手动删 `.dev-flow` |
| hooks 一直不拦/乱拦 | 确认已信任 hooks；并已 `init_project`；只读 Bash 与写保护策略见架构说明 |

### 宿主基线

2.0 经 release-smoke 验证的最低组合：

| 组件 | 版本 |
|------|------|
| Claude Code | **2.1.215** |
| Codex CLI | **0.144.4** |
| Node.js | **≥ 20**（仅开发/构建；用户安装插件无需 `npm install`） |

本机真机安装与跨宿主接力（可选）：

```bash
npm run test:host-e2e
```

日常 `npm test` 会跳过该层，仍覆盖全路线、资产、义务与 adapter；发布前另跑 `npm run test:host-e2e`。

---

## 第一次使用（摘要）

1. 按上文完成 **插件安装**（user 或 project）。  
2. 在业务仓调用 **`dev_flow_init_project`** → 得到 `.dev-flow/project.json`。  
3. **`dev_flow_doctor`** 确认健康。  
4. **`/dev-flow:task`** 创建 intake，调查事实并记录用户决策。
5. `dev_flow_classify` 预览、`dev_flow_lock_classification` 锁定；随后始终参考 `dev_flow_next` 的阶段能力。
6. 所有路线由 Core 自动捕获实现 checkpoint；approval obligation 或真实偏航需要用户决策时才停等确认，最后 finalize；logic-complete 后才 Git 写。

需求确认不等于需求拷问：需求不清晰时先停留在 intake，`grillme` 只收敛用户拥有的决策并写入 Decision Ledger；不要求先生成需求文档。明确事实可直接锁定分类，`provided-confirmed` 也仍可显式调用 `/dev-flow:grillme`。

**1.3.0+ 等待与恢复**：`dev_flow_status` 返回 `progress`（当前步骤、是否等人、Q-id/gate 提示），不会修改 revision；用户说「继续」时先 status，再按 wait 提示回复——合法等待不是失败。损坏的 active state 用 `dev_flow_doctor` + `dev_flow_recover_corrupt_feature`（备份 abandon）；若 pointer 本身损坏，必须使用 doctor 给出的 `activeSha256`、目标 feature 与证据续办，禁止手改 `.dev-flow`。agent 只能编辑 MCP 已登记的 artifact；控制文件仅 MCP 可写。同 level 的 `standard → light` 可在用户明确要求、无 protected-root 变更、且实现门禁从未展示时 `dev_flow_reclassify`（需 `userEvidence`）。
**2.0 事实覆盖层**：分类依据必须来自仓库事实与决策台账；风险只增加 review、verification、rollback、checkpoint 或 approval 义务，不创建额外路线。实现期普通写入按真实影响审计，控制路径继续拒绝；验证失败保留工作并进入 repair loop，有进展自动修复，连续无进展才请求用户。

项目侧状态（示意）：

```text
.dev-flow/
  project.json
  active.json
  features/<feature-id>/
    state.json
    events.jsonl
    <路线要求的 Markdown 资产>
```

---

## 分级与路线（必读摘要）

**规模与风险独立**：风险标签**不抬高** level，只加强该路线内的证据；拓扑不满足时**拒绝启动**并建议级别，不静默升级。

| 路线 | 何时（简要） | 主要阶段 | 强制 Markdown |
|------|----------------|----------|---------------|---------------|
| **XS** | 局部、local | 定位 → 实现 → 验证 → 收尾 | 无 |
| **S** | 单模块、local | 边界 → 实现 → 验证 → 收尾 | 无 |
| **light M** | M + light | 计划 → 实现 → 代码审查 → 验证 → 收尾 | 无 |
| **standard M** | M + standard | 需求对齐 → 计划 → 实现 → 代码审查 → 验证 → 收尾 | `需求文档.md`、`实施计划.md` |
| **light L** | L + light | 计划 → 实现 → 代码审查 → 验证 → 收尾 | `实施计划.md` |
| **standard L** | L + standard | 需求对齐 → 计划 → 实现 → 代码审查 → 验证 → 收尾 | `需求文档.md`、`实施计划.md` |

分类顺序固定为 topology → 具体风险后果 → light/standard 未决策程度 → standard requirements。范围、接口、回滚和验收均已锁定时优先 light；multi-chain 仍为 L，但可使用 light-L。风险标签以 [`policy/contract.json`](plugins/dev-flow/policy/contract.json) 和 `dev_flow_classify` / `dev_flow_start` 的 MCP schema 为唯一权威；禁止堆叠“相关”标签或发明领域标签。

分类输入要点：
- XS/S：**不要**传 `execution`  
- M/L：**必须** `execution: light | standard`  
- standard M/L：**必须** `requirements`：`missing-or-unclear` / `documented-unconfirmed` / `provided-confirmed`  
- 拓扑：`local` 最低 XS；`shared-contract` 最低 M；`multi-chain` / `coordinated-rollback` 必须 L  

完整步骤名、资产 kind、`planning`≠`code_review` 等以 [docs/routes.md](docs/routes.md) 与 `plugins/dev-flow/policy/contract.json` 为准。

---

## 入口与 Skills

技能 id 为**短名**（无 `dev-flow-` / `df-` 前缀）。Claude 斜杠形式为 **`/dev-flow:<skill>`**，例如 `/dev-flow:task`。  
description 仍保留 `df-*`、`dev-flow-*` 旧名作匹配兼容。

| 用途 | Skill id | 斜杠 | 旧名兼容 | 主要 next 动作 / 场景 |
|------|----------|------|----------|----------------------|
| 开任务 / 分类 | `task` | `/dev-flow:task` | `df-task`、`dev-flow-task` | classify + `dev_flow_start` |
| 状态 / 接力 | `status` | `/dev-flow:status` | `df-status`、`dev-flow-status` | 只读 status / next |
| 诊断 | `doctor` | `/dev-flow:doctor` | `df-doctor`、`dev-flow-doctor` | `dev_flow_doctor` |
| 需求采集与登记 | `requirements` | `/dev-flow:requirements` | `df-requirements`、`dev-flow-requirements` | `requirements` / `requirements_alignment` |
| 需求/方案逐题拷问 | `grillme` | `/dev-flow:grillme` | `df-grillme`、`dev-flow-grillme` | requirements 内 grill 子流程 |
| 写计划 | `plan` | `/dev-flow:plan` | `df-plan`、`dev-flow-plan` | plan 相关 step |
| 覆盖审查 | `coverage-review` | `/dev-flow:coverage-review` | `df-coverage-review`… | coverage |
| 回撤安全 | `rollback-safety` | `/dev-flow:rollback-safety` | `df-rollback-safety`… | rollback / safety |
| 计划审查 | `plan-review` | `/dev-flow:plan-review` | `df-plan-review`… | `planning` |
| 实现 | `implement` | `/dev-flow:implement` | `df-implement`… | `implementation` |
| 代码审查 | `code-review` | `/dev-flow:code-review` | `df-code-review`… | `code_review` |
| 验证 | `verify` | `/dev-flow:verify` | `df-verify`… | `verification` |
| 完备检查 | `feature-check` | `/dev-flow:feature-check` | `df-feature-check`… | `feature-check` |
| 收尾 | `finish` | `/dev-flow:finish` | `df-finish`… | `finalize` |

`requirements` 是需求链唯一编排者与 MCP 写入者；`grillme` 只做逐题压测（可写需求草稿的 Decision Log / Open Questions / `grill_status`，**禁止** mutation/gate）。触发词含 grillme、拷问、压测方案等。执行批准不是固定阶段，而是当 approval obligation 仍待确认且实现前置条件满足时动态呈现的一次用户决策。

**工作流命中不依赖技能长名**：状态机只认 MCP（`dev_flow_next` 返回的 stage、能力类别、完成条件和义务）。技能 description 同时写明对应 stage（如 `planning`、`code_review`、`implementation`），模型可在能力合同内选择等价工具。

状态只通过 MCP（如 `dev_flow_start`、`dev_flow_next`、`dev_flow_confirm_approval`、`dev_flow_finalize` 等）变更。

---

## 开发本仓库

```bash
npm ci
npm test                 # typecheck + 单测 + 路线 E2E + dist/版本检查
npm run test:host-e2e   # 真机 marketplace（需本机 claude/codex）
```

插件运行时为零 npm 依赖；`dist/*.mjs` 随包发布。

---

## 许可

MIT。详见 [LICENSE](./LICENSE)。
