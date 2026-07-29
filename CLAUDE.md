# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 项目定位

Dev Flow 是面向 **Claude Code** 与 **Codex CLI** 的预构建双宿主开发流程插件。按 **规模（XS/S/M/L）× 拓扑 × 执行方式（light/standard）× 需求状态 × 风险标签** 选择路线，只强制该路线所需的步骤与证据；两端共用业务仓内的 `.dev-flow/` 状态，可跨宿主接力。

- 运行时 **零 npm 依赖**：用户安装插件后无需 `npm install`
- 流程状态 **只能** 经本地 MCP 变更；Skills **禁止** 手改状态文件
- 不提供：复制安装、升级脚本、旧版迁移、CLAUDE.md 注入、OpenSpec 集成

版本权威：根目录 `package.json#version`（当前 1.7.0）。Node **≥ 20**。

## 常用命令

```bash
npm ci

# 发布向完整验证（版本一致性 → build → typecheck → unit → e2e → dist 检查）
npm test

npm run typecheck          # 严格 TS 检查，不产出文件
npm run test:unit          # 基于源码的单元测试（node:test）
npm run test:routes        # 各路线 E2E
npm run test:interop       # Claude/Codex 跨宿主交接
npm run test:e2e           # 全部 e2e（含 routes / cross-host）
npm run test:host-e2e      # 真机 marketplace（需本机 claude + codex）；日常 npm test 跳过

npm run build              # esbuild 生成三个受版本控制的 dist bundle
npm run build:check        # 版本一致 + dist 与源码一致性
npm run version:sync       # 将 package.json 版本写入各 manifest
npm run version:check      # 仅检查版本是否同步
```

### 单测 / 定向跑法

测试文件为 `*.test.mjs`，由 `scripts/run-tests-silently.mjs` 收集后交给 Node 内置 test runner：

```bash
# 单个文件
node --test tests/unit/state-store.test.mjs

# 某一类
npm run test:unit
npm run test:routes
```

- 源码测试通过 `tests/helpers/load-source.mjs`（esbuild 即时 bundle）加载 **TS 源码**，**不得**依赖已生成的 `plugins/dev-flow/dist/`
- 测试环境会设置 `DEV_FLOW_DISABLE_ATTENTION=1`
- **中间改动不要跑 `npm run build`**，除非任务明确要求更新并提交 bundle（避免无意义 dist 噪声）

### 发布前（见 docs/publishing.md）

```bash
npm ci && npm test
claude plugin validate .
claude plugin validate ./plugins/dev-flow --strict
npm run test:host-e2e   # 真机
```

改版本后：`version:sync` → `build` → 将源码与 `plugins/dev-flow/dist/` **一并提交**。

## 仓库结构（大图）

| 路径 | 职责 |
| --- | --- |
| `plugins/dev-flow/` | **唯一**可分发插件包（自包含） |
| `plugins/dev-flow/src/core/` | 工作流状态、事务、门禁、验证、追溯账本等核心逻辑 |
| `plugins/dev-flow/src/policy/` | 路线合同、证据派生、校验（读 `policy/contract.json`） |
| `plugins/dev-flow/src/mcp/` | MCP server 与 tools 装配 |
| `plugins/dev-flow/src/hosts/` | Claude / Codex hook 适配器（事件归一化 + 门禁拦截） |
| `plugins/dev-flow/policy/` | JSON 契约与 schema（`contract.json` 为机器权威） |
| `plugins/dev-flow/skills/` | 各步骤 Skill（短 id，如 `task`、`plan`；斜杠 `/dev-flow:task`） |
| `plugins/dev-flow/templates/` | Markdown 资产模板 |
| `plugins/dev-flow/dist/` | **受版本控制** 的预构建入口：`mcp-server.mjs`、`claude-hook.mjs`、`codex-hook.mjs` |
| `plugins/dev-flow/hosts/{claude,codex}/hooks.json` | 宿主 hook 接线 |
| `scripts/` | build / 测试静默包装 / 版本同步 |
| `tests/unit`、`tests/e2e`、`tests/fixtures`、`tests/helpers` | 测试与 fixture |
| `docs/architecture.md`、`docs/routes.md`、`docs/publishing.md` | 架构 / 路线 / 发布权威说明 |
| `docs/plans/`、`docs/superpowers/plans/` | 设计与可执行实施计划 |
| `AGENTS.md` | 智能体仓库级规则（与本文件互补） |

Marketplace 元数据：根 `.claude-plugin/marketplace.json`、`.agents/plugins/marketplace.json`。

## 架构分层

四层职责严格分离（详见 `docs/architecture.md`）：

1. **Skills**：理解任务、写内容、**只通过 MCP** 推进；禁止直接改 `.dev-flow` 状态文件  
2. **MCP**（`src/mcp/server.ts` → 打包为 `dist/mcp-server.mjs`）：classify、`deriveNext`、状态事务、资产校验、HUMAN GATE、feature-check、finalize、doctor 等  
3. **Host adapters**（`claude-adapter` / `codex-adapter`）：SessionStart / UserPromptSubmit / Pre·PostToolUse / Stop 归一化；**绝不**自行推进工作流状态  
4. **项目状态**（业务仓 `.dev-flow/`）：跨宿主配置与 active feature；**禁止**存宿主专属绝对安装路径  

### 状态与事务

业务项目内：

```text
.dev-flow/
  project.json              # enforcement、验证命令、protected roots
  active.json               # 当前唯一 active feature
  features/<id>/
    state.json              # 原子状态（revision CAS）
    events.jsonl            # 追加事件账本
    <路线要求的 Markdown 资产>
    traceability/snapshots/ # 追溯账本内容寻址快照（若启用）
```

- 状态库：进程锁、revision CAS、fsync + 原子 rename  
- 同一时刻只能有一个 feature 为 `active`  
- 强制 Markdown 资产按 SHA-256 登记；`status.md` 为只读生成投影  
- 即使绕过 Skills 直调 MCP，core 仍拒绝乱序步骤与抢先创建未来资产  

### 构建入口

`scripts/build.mjs` 用 esbuild 打包三个入口（Node 20 ESM）：

| 输出 | 源入口 |
| --- | --- |
| `dist/mcp-server.mjs` | `src/mcp/server.ts` |
| `dist/claude-hook.mjs` | `src/hosts/claude-adapter.ts` |
| `dist/codex-hook.mjs` | `src/hosts/codex-adapter.ts` |

`__DEV_FLOW_VERSION__` 由构建注入。

## 路线与合同（核心概念）

- **唯一**路线选择器：`dev_flow_classify`  
- 规模与风险 **独立**：拓扑决定最低规模；风险只加证据义务，**不**静默改 level  
- 机器权威：`plugins/dev-flow/policy/contract.json`（`docs/routes.md` 与其一致性由 `tests/unit/routes-doc.test.mjs` 核对）  
- 主要路线 id：`xs`、`s`、`risk-minimal`、`light-m`、`standard-m`、`light-l`、`standard-l`  
- `plan_review` 与 `code_review` 证据不兼容，不可互替  
- standard M/L **必须** feature-check；XS/S 与 light M **不**强制  
- HUMAN GATE：仅接受 status `replyHint` 整句批准词；present 后必须等用户下一条消息，不可同回合确认  
- reclassify：升严始终允许；降级仅同 level 的 **standard → light**（有严格前置条件，见 routes 文档）  

### grill 子流程（1.1.0+）

- **不**新增独立 route step / MCP tool / HUMAN GATE  
- `requirements` Skill：唯一编排与 MCP 写入  
- `grillme` Skill：逐题拷问；可写 `requirements.md` 的 Decision Log / Open Questions / `grill_status`；**禁止** mutation/gate  
- `missing-or-unclear` / `documented-unconfirmed` 须 `grill_status: complete` 后才能 `recordStep(requirements)` / present 需求确认门禁  

### Hooks 门禁要点

- logic-complete **之前**拒绝 Git 写（add/commit/push 等）  
- `implementation_approval` 未确认前，拒绝 protected roots 上的 Write/Edit/MultiEdit/apply_patch  
- 仅允许编辑 active feature **已登记** 的非 status Markdown；控制文件始终拒绝  
- active state 损坏时 fail closed；恢复用 `dev_flow_recover_corrupt_feature`  

## Traceability（追溯账本，分支进行中）

standard-m / standard-l 且 `workflowCapabilities.trace === 1` 时强制 `REQ/AC → TASK → TEST/RU` 可审计图：

- 类型与策略：`src/policy/traceability.ts`、`policy/traceability.schema.json`  
- 图校验与切片：`src/core/traceability.ts`  
- Markdown 锚点解析：`src/core/traceability-anchors.ts`  
- 快照路径：`.dev-flow/features/<id>/traceability/snapshots/<sha256>.json`（不可变）  
- 旧 feature 无 `workflowCapabilities` 时视为零能力；插件升级不得改已启动 feature 的能力位  
- 实施计划：`docs/superpowers/plans/2026-07-28-dev-flow-traceability-ledger.md`  

错误码示例：`TRACE_GRAPH_INVALID`、`TRACE_SLICE_INCOMPLETE`、`TRACE_SLICE_STALE`、`TRACE_SOURCE_ANCHOR_INVALID`。

## 代码风格与约定

- 严格 TypeScript ESM；`tsconfig`：`module`/`moduleResolution` = NodeNext，`strict`  
- 两个空格、双引号、分号；跨模块合同用显式导出接口  
- 文件 kebab-case（如 `state-store.ts`）；函数 camelCase；类型 PascalCase；错误码全大写  
- 策略判断保持纯函数；文件 I/O 放在 `core/` 的 store  
- 运行时不新增 npm 依赖；仅用 Node 标准库 + 现有 devDependencies（esbuild、typescript、@types/node）  
- 代码标识符 / 错误码 / 命令用英文；用户可见模板、Skills、文档用中文  

## 行为变更时的验证习惯

1. 新增或更新聚焦的 `*.test.mjs`  
2. 先跑目标单测，再 `npm run typecheck`、`npm run test:unit`，以及受影响的 routes / interop  
3. 仅在需要交付 bundle 时 `build` + `build:check`  

近期提交风格：带 scope 的 Conventional Commits，例如 `feat(dev-flow): validate traceability graph`、`docs(dev-flow): update routes`。

## 智能体约束（必须遵守）

- **不得** `git commit`、`git push`、创建 PR 或发布；完成后只报告变更文件与测试结果，由用户审核后手动提交  
- 中间任务不跑 `npm run build`，除非计划/用户明确要求统一更新 dist  
- 修改路线步骤或资产要求时，同步 `policy/contract.json`、`docs/routes.md` 与相关测试  
- 深入契约以 `docs/architecture.md`、`docs/routes.md`、`plugins/dev-flow/policy/contract.json` 为准，勿臆造路线或风险标签  
