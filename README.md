# Dev Flow

Dev Flow 4.0 是面向 **Claude Code** 与 **Codex CLI** 的预构建双宿主插件。

它按**规模（XS/S/M/L）× 拓扑 × 执行方式（light/standard）× 需求状态 × 风险标签**选择路线，只强制该路线所需的步骤与证据；两端共用 `.dev-flow/` 状态，可在 Claude 开任务、Codex 收尾（或反向）。

Dev Flow 的设计初衷不是把每个小任务都变成重流程，而是在任务规模与风险之间保持清晰边界：小任务不过度治理，高风险任务不能轻易越级；工作流规则通过结构化合同、纯策略与可回归测试长期维护，优先复用已有阶段和义务，避免规则随功能增加持续膨胀。

- 安装与升级：仅宿主原生 marketplace / plugin 命令  
- 流程接口：本地 MCP（Skills 不得手改状态文件）  
- 不提供：复制安装、升级脚本、旧版迁移、CLAUDE.md 注入、OpenSpec 集成  

更细的契约见 [路线说明](docs/routes.md)、[架构](docs/architecture.md)、[发布](docs/publishing.md);想从零了解设计与常见问题,见 [Dev Flow 入门教程与 FAQ](docs/dev-flow-guide.md)。

## 宿主支持矩阵

| 宿主 | 支持条件 | 证据与守卫 |
| --- | --- | --- |
| Claude Code | 支持；需同时安装插件 manifest、MCP 与 `claude-hook.mjs` | 支持写入守卫与可信用户事件 |
| Codex CLI | 支持；需同时安装插件 manifest、MCP 与 `codex-hook.mjs` | 支持写入守卫与可信用户事件 |
| 其他 MCP 客户端 | 未支持；直连仅用于诊断 | 不具备写入守卫与可信用户证据 |

不把仅 MCP happy path、模型代决或手工调 hook 当作宿主兼容证据；`doctor` 的静态检查也不等于第三方宿主兼容。新增宿主必须同步更新支持矩阵、manifest、hook 和分发合同测试。

## Hook 与宿主权限边界

Dev Flow 的 Bash target analyzer 只做工作流辅助分析，不是命令合法性裁判。它可以在可靠识别目标时判断 protected roots、`.dev-flow` 控制区、active feature 资产和 Git 写入门禁；命令使用 wrapper、解释器、管道、heredoc、变量展开或复杂重定向而无法静态解析时，默认继续执行，不返回 `DEV_FLOW_WRITE_TARGET_UNRESOLVED`。仓库外验证日志也交给 Claude Code / Codex 的原生 sandbox、permissions 和确认流处理。

Hook 仍会拒绝确定的 `.dev-flow` 控制文件写入、intake 或未批准阶段的 protected-root 写入、未登记的 feature 资产和开放恢复事务。implementation 获得授权后可按 feature ownership 审计本地 Git stage/commit；push 与历史改写仍禁止。每个 Dev Flow block 都包含原因、影响、具体解决方案、是否需要用户决定和解决后是否自动重试原操作。

普通风险的宿主确认成功且工具执行成功后，`PermissionRequest` / `PostToolUse` 会把授权记在当前 active feature 的 Core 事件账本中，只复用同一 feature 的 `task-reusable` 风险。切换、finalize 或 abandon feature 后不复用；publish、push、deploy、生产变更和云资源删除等 `always-confirm` 动作每次仍由宿主确认。bypass、dontAsk 等宿主模式关闭确认时，Dev Flow 不保证强制弹窗。Claude 的 block 使用 `hookSpecificOutput.permissionDecision = "deny"`，Codex 使用 `{ "decision": "block", "reason": "..." }`；两者允许且无 advisory 时均退出 0 且不输出 JSON，Codex PreToolUse 不使用 `continue`、`stopReason` 或伪造的 ask。

## v4 可追溯性与审查

标准 M/L 的需求与实施计划通过 `dev_flow_record_artifact_with_trace` 原子登记；`dev_flow_get_traceability` 只读查看 pointer、ledger、summary 与 blocker。Markdown 只用于叙述，内容寻址 snapshot 才是事实层，state pointer 是提交点。不要直接写 `.dev-flow/features/*/traceability/**`。

generated status 只由 Core scaffold/refresh；standard L 没有 status 文件，应读取 `dev_flow_status`。

**Review 3 / 4B**：standard M/L 使用不可变 review batch 与 Core 生成的只读 `plan-review` 投影。finding events 是唯一 blocker 归约源；successor 必须显式处置 carried findings。默认保证等级为 `multi-perspective`（多角色完成不等于已证明多代理）。checkpoint 由 Core 自动捕获，回撤执行走事务日志和显式确认；finalize 的 delivery snapshot 是交付层回退证据。

4.0 mutation 默认只返回中文用户视图；内部 revision、stage 和 action 只放 structured control。`dev_flow_status` 是 compact 日常入口，详细事实使用九个 topic 的 `dev_flow_inspect`。用户决定统一调用 `dev_flow_answer`，不要求 ID、hash 或 token。

### 4.0 生命周期要点

- 状态 schema 为 v3，旧状态硬拒绝，不提供运行时迁移。
- 同一 feature 最多一个 pending decision；每回合只呈现一个中文问题和 2-3 个选项。
- 启动允许脏树，但范围相交的预存路径必须逐题归属；系统不自动 stash、reset 或还原用户文件。
- WIP/manual commit 可存在；`dev_flow_reconcile_workspace` 自动对账，只有内容变化才标记相关 evidence stale。
- `dev_flow_pause` 不要求提交、验证或 finalize；resume 先对账。质量例外只适用于流程质量问题，完整性阻塞不能伪装成功。

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
claude plugin update dev-flow@dev-flow-marketplace(用户级)
claude plugin update dev-flow@dev-flow-marketplace --scope project(项目级)
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
   `dev_flow_init_project`、`dev_flow_start`、`dev_flow_status`、`dev_flow_inspect`、`dev_flow_answer`、`dev_flow_doctor` 等。  
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
2. 按 `dev_flow_status` 的中文下一步推进；需要事实细节时按主题调用 `dev_flow_inspect`。
3. 动态 approval obligation、重大偏航、未解决 blocking finding 或不可恢复错误才需要用户决策；展示后等待用户下一条消息，再确认或修改。
4. implementation 获得授权后本地 stage/commit 仍须经过 ownership 审计；本仓库禁止智能体实际 commit，push 始终由用户审核发布。

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

4.0 经协议测试验证的最低组合：

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
5. `dev_flow_classify` 预览、`dev_flow_lock_classification` 锁定；随后读取 `dev_flow_status`。
6. 所有路线由 Core 自动捕获实现 checkpoint；用户决定统一通过 `dev_flow_answer`，最后 finalize；WIP/manual commit 和 pause/resume 均可恢复。

需求确认不等于需求拷问：需求不清晰时先停留在 intake，`grillme` 只收敛用户拥有的决策并写入 Decision Ledger；不要求先生成需求文档。明确事实可直接锁定分类，`provided-confirmed` 也仍可显式调用 `/dev-flow:grillme`。

**4.0 等待与恢复**：`dev_flow_status` 返回 compact 中文状态和唯一待决问题；详细信息用 `dev_flow_inspect`。损坏的 active state 用 `dev_flow_doctor` + `dev_flow_recover_corrupt_feature`，禁止手改 `.dev-flow`。agent 只能编辑 MCP 已登记的 artifact；控制文件仅 MCP 可写。旧 active feature 与新任务冲突时只呈现一个 task-switch decision。
**4.0 事实覆盖层**：分类依据必须来自仓库事实与决策台账；风险只增加 review、verification、rollback、checkpoint 或 approval 义务，不创建额外路线。实现期普通写入按真实影响审计，控制路径继续拒绝；验证失败保留工作并进入 repair loop，有进展自动修复，连续无进展才请求用户。

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

### 完整流程（直白版）

**任何路线开工前，都先走同一道"需求固化"前置（intake）——这一步六条路线全有：**

1. 用 `/dev-flow:task` 开任务，`dev_flow_start` 建一个 feature（处于"调查"状态，还没定路线）。
2. **先查仓库事实**：读代码、文档、测试、diff，能自己查明的绝不问人。
3. 只剩真正需要你拍板的边界/优先级/取舍时，才用 `/dev-flow:grillme` **逐题提问**，每个答案记入决策台账。问题可以无限轮，直到影响目标、范围、验收的决策都收敛。
4. 决策收敛后，`dev_flow_lock_classification` **原子锁定路线**。

这就是"需求固化"：**动手之前，需求被事实和决策台账钉死**，而不是停在对话记忆里。light 路线能省掉后面的"需求对齐"阶段，正是因为在这一步已经锁死了范围、接口、回滚和验收。

**六条路线在锁定后的各自步骤：**

| 路线 | 锁定后的流程 | 说明 |
|------|--------------|------|
| **XS** | 定位 → 实现 → 验证 → 收尾 | 最轻：定位改动点，直接实现，验证，收尾；不产任何文档 |
| **S** | 边界 → 实现 → 验证 → 收尾 | 先划清改动边界，再实现；仍不产文档 |
| **light M** | 计划 → 实现 → 代码审查 → 验证 → 收尾 | 写轻量计划（不强制文档），实现后代码审查把关 |
| **standard M** | 需求对齐 → 计划 → 实现 → 代码审查 → 验证 → 收尾 | 先把需求固化成 `需求文档.md`，计划要写 `实施计划.md` 并接受独立计划审查 |
| **light L** | 计划 → 实现 → 代码审查 → 验证 → 收尾 | 必须写 `实施计划.md`；计划里每个任务要声明回撤单元（`rollback_unit`）、每个回撤单元要声明 `depends_on`，登记时 Core 校验任务间关系（引用闭合、无环），不合格会被拒 |
| **standard L** | 需求对齐 → 计划 → 实现 → 代码审查 → 验证 → 收尾 | 最重：需求文档 + 实施计划 + 独立计划审查；回滚可操作性按路线合同强制 |

**两条轴记牢：** 前置的需求固化人人有；后面的阶段，light 看"需求是否已锁死"、standard 看"要不要正式文档和独立审查"，拓扑只决定落到 M 还是 L，不决定严格度。

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
| 状态 / 接力 | `status` | `/dev-flow:status` | `df-status`、`dev-flow-status` | compact status / topic inspect |
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

`requirements` 是需求链唯一编排者与 MCP 写入者；`grillme` 只做逐题压测，需求文档不保存 grill 控制字段，**禁止**手改 mutation/gate。触发词含 grillme、拷问、压测方案等。执行批准不是固定阶段，而是当 approval obligation 仍待确认且实现前置条件满足时动态呈现的一次用户决策。

**工作流命中不依赖技能长名**：状态机只认 MCP（`dev_flow_status` 的中文阶段和 `structuredContent.control`）。技能 description 同时写明对应阶段，模型可在能力合同内选择等价工具。

状态只通过 MCP（如 `dev_flow_start`、`dev_flow_status`、`dev_flow_answer`、`dev_flow_pause`、`dev_flow_finalize` 等）变更。

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
