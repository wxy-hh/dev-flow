# dev-flow 双宿主插件设计

## 文档状态

- 状态：已批准，可进入实施
- 日期：2026-07-22
- 目标宿主：Claude Code、Codex CLI
- 发布源：`wxy-hh/dev-flow`
- Marketplace：`dev-flow-marketplace`
- 插件版本：`1.0.0`
- 状态 schema：v1

## 目标与边界

dev-flow 以一个 GitHub 托管的插件 marketplace 同时服务 Claude Code 和 Codex CLI。插件保留 XS / S / M / L、多拓扑、light / standard、requirements 路线以及规模轴与风险轴独立判断；不同 route 使用不同步骤和不同强制资产。

v1 的边界如下：

- 只通过宿主原生 marketplace 和 plugin 命令安装、升级。
- MCP 是 Skills 唯一的流程接口，负责分类、状态转换、HUMAN GATE、资产登记、feature-check 和 finalize。
- Claude Code 与 Codex CLI 共用同一组 Skills、policy、schema、模板和 MCP server。
- 两套 hooks 只负责宿主事件归一化、时序证据、写入门禁和 Git 门禁，不独立推进工作流。
- 项目内不注入宿主提示文件或宿主 settings；项目适配只使用机器可读的 `.dev-flow/project.json`。
- v1 不集成 OpenSpec。已有 OpenSpec 文件可作为普通需求输入读取，但插件不调用其命令、不解释其专有状态，也不声明集成能力。
- 不提供任何旧状态、旧安装形态或旧 schema 的迁移与兼容分支。

## 核心架构

```text
Shared skills
    │
    ▼
Local dev-flow MCP server ─── policy / deriveNext / state / assets
    ▲                                      │
    │                                      ▼
Claude hooks adapter                 .dev-flow/
Codex hooks adapter                  project state
```

### 职责分层

| 层 | 职责 | 禁止事项 |
|---|---|---|
| Skills | 理解任务、生成语义内容、调用 MCP tool | 直接改状态文件、绕过 MCP 推进步骤 |
| MCP | route、deriveNext、状态事务、资产校验、HUMAN GATE、feature-check、finalize | 依赖宿主私有对话格式 |
| Host adapters | 归一化 SessionStart、UserPromptSubmit、Pre/PostToolUse、Stop | 独立确认 gate、独立完成 step |
| Project state | 跨宿主持久化配置、active 指针、feature 状态与证据 | 保存宿主专属绝对安装路径 |

### 发布包自包含

发布包必须携带：

```text
plugins/dev-flow/dist/mcp-server.mjs
plugins/dev-flow/dist/claude-hook.mjs
plugins/dev-flow/dist/codex-hook.mjs
```

用户安装后不运行 `npm install`、`npm ci`、postinstall 或代码生成。开发依赖只在仓库构建阶段使用，并由 esbuild 打包进 `dist/`。CI 重建后必须确认 `dist/` 没有差异。

### 版本单一来源

根 `package.json#version` 是插件版本的唯一权威源。`scripts/sync-version.mjs` 提供 `--write` 和 `--check` 两种模式：

- `--write` 把根版本同步到 Claude/Codex 两份 plugin manifest；`build.mjs` 从同一根版本把版本注入三个 bundle 的确定性 banner/导出常量。
- `--check` 校验根版本、两份 manifest 和三个已构建 bundle 完全一致；任一缺失或漂移都失败。
- 两个 marketplace 不复制 version 字段；它们只指向插件 source，避免形成第四个版本权威。
- `build:check` 必须先执行 version check，再重建 `dist/` 并确认没有 diff。

发布时禁止手工分别修改 manifest 版本。版本升级固定为：修改根 `package.json#version` → `npm run version:sync` → 重建 bundle → `npm run build:check`。

## 最终仓库结构

```text
dev-flow/
├── .agents/plugins/marketplace.json
├── .claude-plugin/marketplace.json
├── .github/workflows/
│   ├── ci.yml
│   └── release-smoke.yml
├── docs/
│   ├── architecture.md
│   ├── publishing.md
│   ├── routes.md
│   └── plans/
│       ├── 2026-07-22-dev-flow-dual-host-plugin-design.md
│       └── 2026-07-22-dev-flow-dual-host-plugin-implementation-plan.md
├── plugins/dev-flow/
│   ├── .claude-plugin/plugin.json
│   ├── .codex-plugin/plugin.json
│   ├── .mcp.json
│   ├── LICENSE
│   ├── README.md
│   ├── dist/
│   │   ├── claude-hook.mjs
│   │   ├── codex-hook.mjs
│   │   └── mcp-server.mjs
│   ├── hosts/
│   │   ├── claude/hooks.json
│   │   └── codex/hooks.json
│   ├── policy/
│   │   ├── artifact.schema.json
│   │   ├── contract.json
│   │   ├── event.schema.json
│   │   ├── project.schema.json
│   │   └── state.schema.json
│   ├── skills/
│   │   ├── dev-flow-task/{SKILL.md,agents/openai.yaml}
│   │   ├── dev-flow-status/{SKILL.md,agents/openai.yaml}
│   │   ├── dev-flow-requirements/{SKILL.md,agents/openai.yaml}
│   │   ├── dev-flow-risk-review/{SKILL.md,agents/openai.yaml}
│   │   ├── dev-flow-plan/{SKILL.md,agents/openai.yaml}
│   │   ├── dev-flow-coverage-review/{SKILL.md,agents/openai.yaml}
│   │   ├── dev-flow-rollback-safety/{SKILL.md,agents/openai.yaml}
│   │   ├── dev-flow-plan-review/{SKILL.md,agents/openai.yaml}
│   │   ├── dev-flow-implement/{SKILL.md,agents/openai.yaml}
│   │   ├── dev-flow-code-review/{SKILL.md,agents/openai.yaml}
│   │   ├── dev-flow-verify/{SKILL.md,agents/openai.yaml}
│   │   ├── dev-flow-feature-check/{SKILL.md,agents/openai.yaml}
│   │   ├── dev-flow-finish/{SKILL.md,agents/openai.yaml}
│   │   └── dev-flow-doctor/{SKILL.md,agents/openai.yaml}
│   ├── src/
│   │   ├── core/
│   │   │   ├── artifacts.ts
│   │   │   ├── errors.ts
│   │   │   ├── feature-check.ts
│   │   │   ├── fingerprint.ts
│   │   │   ├── git-policy.ts
│   │   │   ├── human-gates.ts
│   │   │   └── state-store.ts
│   │   ├── hosts/
│   │   │   ├── claude-adapter.ts
│   │   │   └── codex-adapter.ts
│   │   ├── mcp/
│   │   │   ├── server.ts
│   │   │   └── tools/
│   │   │       ├── artifacts.ts
│   │   │       ├── classify.ts
│   │   │       ├── evidence.ts
│   │   │       ├── feature.ts
│   │   │       ├── finish.ts
│   │   │       ├── inspect.ts
│   │   │       └── project.ts
│   │   └── policy/
│   │       ├── contract.ts
│   │       ├── derive-next.ts
│   │       ├── route.ts
│   │       ├── types.ts
│   │       └── validation.ts
│   └── templates/
│       ├── boundary-card.md
│       ├── code-review.md
│       ├── coverage-matrix.md
│       ├── implementation-plan.md
│       ├── plan-review.md
│       ├── requirements.md
│       ├── risk-card.md
│       ├── rollback-safety.md
│       ├── rollback-units.md
│       ├── status.md
│       └── verification.md
├── scripts/
│   ├── build.mjs
│   ├── generate-routes-doc.mjs
│   └── sync-version.mjs
├── tests/
│   ├── e2e/
│   │   ├── cross-host/{claude-to-codex.test.mjs,codex-to-claude.test.mjs}
│   │   ├── routes/
│   │   │   ├── xs.test.mjs
│   │   │   ├── s.test.mjs
│   │   │   ├── risk-minimal-xs.test.mjs
│   │   │   ├── risk-minimal-s.test.mjs
│   │   │   ├── risk-minimal-m.test.mjs
│   │   │   ├── light-m.test.mjs
│   │   │   ├── standard-m.test.mjs
│   │   │   ├── light-l.test.mjs
│   │   │   └── standard-l.test.mjs
│   │   ├── forbidden-legacy.test.mjs
│   │   ├── native-install-upgrade.test.mjs
│   │   └── strict-human-gate.test.mjs
│   ├── fixtures/
│   │   ├── hooks/
│   │   │   ├── claude-pretool-git.json
│   │   │   ├── claude-plugin-root-with-spaces.json
│   │   │   └── codex-pretool-git.json
│   │   └── tiny-app/
│   │       ├── package.json
│   │       ├── src/counter.js
│   │       └── test/counter.test.js
│   ├── helpers/{fixture-repo.mjs,host-runner.mjs}
│   └── unit/
│       ├── artifacts.test.mjs
│       ├── classify.test.mjs
│       ├── derive-next.test.mjs
│       ├── feature-check.test.mjs
│       ├── git-policy.test.mjs
│       ├── human-gates.test.mjs
│       ├── host-paths.test.mjs
│       ├── mcp-server.test.mjs
│       ├── project-config.test.mjs
│       ├── reclassify.test.mjs
│       ├── routes-doc.test.mjs
│       ├── skills.test.mjs
│       ├── state-store.test.mjs
│       └── version-sync.test.mjs
├── LICENSE
├── README.md
├── package-lock.json
├── package.json
└── tsconfig.json
```

## 项目配置与运行态

### `.dev-flow/project.json`

该文件是 hooks、验证命令和 fingerprint 的唯一项目配置来源，应该提交到项目仓库。命令使用 exec 形式，不接受 shell 拼接字符串。

```json
{
  "schemaVersion": 1,
  "verification": {
    "commands": [
      {
        "id": "unit",
        "command": "npm",
        "args": ["test"],
        "cwd": "."
      }
    ],
    "behaviorCommands": []
  },
  "enforcement": {
    "mode": "strict",
    "gitWriteRequiresLogicComplete": true,
    "oneActiveFeature": true,
    "requireExplicitHumanReply": true
  },
  "protectedRoots": ["src/", "test/"]
}
```

约束：

- v1 只接受 `schemaVersion: 1` 和 `enforcement.mode: strict`。
- `command` 与 `args` 通过 `execFile` 执行，不经过 shell。
- `cwd` 必须是项目内相对路径，禁止 `..` 和绝对路径。
- `protectedRoots` 必须是项目内相对目录；业务 fingerprint 只覆盖这些目录并排除 `.dev-flow/`。
- feature 只保存要运行的 command ID，不允许在 feature state 中注入任意命令。
- 缺少配置时，`dev_flow_start` 返回 `PROJECT_NOT_INITIALIZED`，由 `dev_flow_init_project` 创建并验证配置后重试。

### 单 active feature

```text
.dev-flow/
├── project.json
├── active.json
└── features/
    ├── feature-a/
    │   ├── state.json
    │   └── events.jsonl
    └── feature-b/
        ├── state.json
        └── events.jsonl
```

- feature 目录可以有多个，但一个工作区最多一个 `active` feature；其余未终态 feature 必须是 `paused`，不存在两个可同时推进的 in-progress feature。
- `active.json` 只保存 `featureId`、state revision 和更新时间。
- 工作流推进类 mutation 只允许修改 active feature；生命周期管理工具 `switch_active`/`abandon` 可按下述规则事务性修改 paused feature；读取工具可以显式读取历史 feature。
- `dev_flow_start` 的 activation 默认为 `active`；存在 active feature 时，再启动 active feature 返回 `ACTIVE_FEATURE_CONFLICT`。显式 `activation: "paused"` 只创建不可推进的 paused feature且不改 active pointer，用于之后的切换。
- `dev_flow_switch_active` 必须记录原因。
- feature 生命周期固定为 `active | paused | finalized | abandoned`；`finalized`、`abandoned` 是不可逆终态。
- `dev_flow_switch_active` 只能切到 `paused` feature，并在同一事务内把当前 `active` 改为 `paused`、目标改为 `active`、更新 `active.json` 和两边事件账本；任一步失败时全部回滚。
- `dev_flow_abandon` 只接受 `active` 或 `paused` feature，必须保存原因、用户证据和时间；放弃 active feature 时在同一事务中清除 `active.json`。
- `finalized` feature 不允许 abandon，`abandoned` feature 不允许恢复或重新激活；确需重启时必须使用新 feature ID。
- finalize 后原子清除 `active.json`；paused feature 保持可读但不能被 mutation tool 推进。
- logic-complete 前 Git 写操作被阻止；finalize 清除 active 指针后才允许进入 Git 阶段。

## 分类与 Route Policy

### 分类类型

```ts
type Level = "XS" | "S" | "M" | "L";
type Topology =
  | "local"
  | "shared-contract"
  | "multi-chain"
  | "coordinated-rollback";
type Execution = "light" | "standard";
type RequirementsState =
  | "missing-or-unclear"
  | "documented-unconfirmed"
  | "provided-confirmed";
type RiskLabel =
  | "security"
  | "data"
  | "money"
  | "external"
  | "availability"
  | "critical_correctness"
  | "irreversible_consequence";
```

### Topology 最低级别

| topology | 最低 level |
|---|---|
| `local` | XS |
| `shared-contract` | M |
| `multi-chain` | L |
| `coordinated-rollback` | L |

低于最低级别时拒绝启动并返回建议级别，不静默升级。

### Route 选择

```ts
if (level === "XS" || level === "S") {
  rejectExplicitExecution();
  return riskLabels.length ? "risk-minimal" : level.toLowerCase();
}

requireExecution();

if (level === "M") {
  if (execution === "light") {
    return riskLabels.length ? "risk-minimal" : "light-m";
  }
  requireRequirementsState();
  return "standard-m";
}

if (execution === "light") return "light-l";
requireRequirementsState();
return "standard-l";
```

风险轴不修改 level。风险 XS/S 和风险轻量 M 进入 `risk-minimal`；标准 M/L 和轻量 L 保持原 route，由风险标签提升证据强度。

requirements 状态只决定标准 M/L 的需求入口：

- `missing-or-unclear`：需求探查、澄清、固化。
- `documented-unconfirmed`：规范化现有需求。
- `provided-confirmed`：快照现有需求基线。

三者最终都必须输出正式 `requirement_confirmation`，并等待后续用户消息。

### 风险增强

| 风险 | 强制增强 |
|---|---|
| security | 安全检查 + 行为验证 |
| data / money | 回撤检查 + 行为验证 |
| external / availability | 集成行为验证 |
| critical_correctness | full code-review + full verification |
| irreversible_consequence | full rollback + full code-review + full verification |

这张映射必须直接编码在 `policy/contract.json`，不是 Skill 提示词约定。多标签取要求并集，并采用更严格的证据强度；例如 `security + data` 同时要求安全检查、回撤检查和行为验证。风险不得为 risk-minimal 增加 plan-review；标准 M/L 已有独立 plan-review。

## Route 与强制资产

`state.json`、`events.jsonl` 和临时 `active.json` 是系统状态，不属于强制 Markdown 资产。

| Route | 完整步骤 | 强制 Markdown 资产 | feature-check |
|---|---|---|---|
| XS | 分类 → 定位 → 最小修改 → 定向验证 → logic-complete | 无 | 否 |
| S | 分类 → 边界复述 → 小范围实现 → 相关测试 → 自审 → logic-complete | 无 | 否 |
| risk-minimal XS/S/M | 风险卡 → 风险门禁 → implementation approval → 实现 → code-review → 风险匹配验证 → feature-check → finalize | `status.md`、`risk-card.md` | 是 |
| 轻量 M | 边界与短计划 → 实现 → code-review → 验证 → logic-complete | 无；code-review 证据写入 state | 否 |
| 标准 M | 需求固化 → requirement confirmation → 计划 → coverage → rollback unit → plan-review → implementation approval → 实现 → code-review → 验证 → feature-check → finalize | `requirements.md`、`implementation-plan.md`、`status.md`、`coverage-matrix.md` | 是 |
| 轻量 L | 边界卡 → 回撤/安全 → implementation approval → 分批实现 → code-review → full verification → feature-check → finalize | `boundary-card.md`、`rollback-safety.md`、`verification.md` | 是 |
| 标准 L | 需求固化 → requirement confirmation → 计划 → coverage → rollback units → plan-review → implementation approval → 分批实现 → code-review → full verification → feature-check → finalize | `requirements.md`、`implementation-plan.md`、`coverage-matrix.md`、`rollback-units.md`、`plan-review.md`、`code-review.md`、`verification.md` | 是 |

产品决定：轻量 M 强制执行 code-review，但不强制生成 `code-review.md`。审查结论保存在结构化 state 中；发现阻塞问题、触发重分级或用户要求留档时才生成报告。

标准 M 的 rollback、plan-review、code-review、verification 都是硬步骤，但默认把结构化证据同步进 `status.md`，不扩大其四类强制独立文件集合。

## 状态与 deriveNext

### 核心状态

```ts
interface FeatureState {
  schemaVersion: 1;
  featureId: string;
  revision: number;
  lifecycle: "active" | "paused" | "finalized" | "abandoned";
  route: RouteId;
  classification: Classification;
  scope: { inScope: string[]; outOfScope: string[] };
  steps: Record<StepId, StepState>;
  humanGates: Record<HumanGateId, HumanGateState>;
  artifacts: Record<ArtifactKind, ArtifactRecord>;
  verification: VerificationState;
  featureCheck: FeatureCheckState;
  businessFingerprint: string;
  blockingFindings: Finding[];
  logicComplete: boolean;
  lastUpdatedBy: { host: "claude" | "codex"; pluginVersion: string };
}

interface VerificationState {
  attempts: VerificationAttempt[];
  satisfiedByAttemptId?: number;
  verifiedFingerprint?: string;
}
```

每次写状态时必须：

1. 获取以项目根 hash 命名的进程间文件锁；默认等待上限 5 秒，每 50 ms 加抖动重试。
2. 校验 expected revision。
3. 写入同目录临时文件并 `fsync`。
4. 原子 rename 到 `state.json`。
5. 追加一条带 revision 的 `events.jsonl`。
6. 同步刷新 route 要求的 `status.md` 投影。

锁文件记录 `pid`、`hostname`、`acquiredAt`、`featureId` 和 `operation`。30 秒只定义为 stale 候选阈值：同机 owner PID 仍存活时不得抢锁；仅 owner 已死亡且锁已 stale 时才允许接管。等待超时返回 `STATE_LOCK_TIMEOUT`，expected revision 冲突单独返回 `STATE_REVISION_CONFLICT`。

### deriveNext

```ts
function deriveNext(state, hostEvents) {
  validateSchemaV1(state);
  assertActiveFeature(state.featureId);
  ingestHostEvents(state, hostEvents);

  if (state.lifecycle === "finalized") return done();

  if (fingerprintChangedAfterVerification(state)) {
    invalidate(state, ["verification", "feature-check", "logic-complete"]);
  }

  if (classificationViolatesTopology(state)) {
    return stop("reclassification-required");
  }

  if (state.blockingFindings.length) {
    return stop("resolve-blocking-findings");
  }

  for (const step of route(state.route).orderedSteps) {
    if (stepIsSatisfied(state, step)) continue;

    if (step.kind === "human-gate") {
      if (!step.presented) return action("present-human-gate", step);
      if (!step.confirmed) return wait(step.name);
    }

    if (missingRequiredArtifact(state, step)) {
      return action("scaffold-artifact", step);
    }

    return action("run-step", step);
  }

  if (route(state.route).featureCheckRequired && !freshFeatureCheck(state)) {
    return action("feature-check");
  }

  if (!state.logicComplete) return action("finalize");
  return done();
}
```

`deriveNext` 每次只返回一个 action。任何失败、阻塞 finding、验证失效、重分级或 HUMAN GATE 都停止自动推进。

### 重分级

`dev_flow_reclassify` 只允许单调升严，不允许降级、删风险或绕回更轻 route：

- level 只能保持或上升；topology 不能降低；风险标签只能增加；execution 只能从 `light` 提升为 `standard`。
- reclassify 的 topology 严格序固定为 `local < shared-contract < multi-chain < coordinated-rollback`；这只用于升严判断，不改变 route selector 的最低 level 表。
- 根据新分类重新运行唯一 route selector，调用方不能直接指定任意目标 route。
- 已有证据只在 step ID、evidence schema 和 basis hash 均仍有效时保留；从第一个新增或变化的 obligation 起，后续 step、verification、feature-check 和 logic-complete 全部失效。
- 任何成功重分级都使 `implementation_approval` 失效。若目标变为 standard M/L，还必须生成或刷新需求基线并重新通过 `requirement_confirmation`。
- `finalized`、`abandoned` feature 禁止重分级；失败时不增加 revision。

### 验证尝试

每次验证都追加不可变的 `VerificationAttempt`，attempt ID 在 feature 内单调递增。exit code 非 0 的尝试保留 command ID、fingerprint、起止时间、exit code 和截断输出，verification 保持未满足，`deriveNext` 只能返回重试 verification，不能进入后续步骤。允许以同一 command ID 重跑；后续在当前 fingerprint 上全部通过的 fresh attempt 可以满足 verification，但历史失败记录不得删除。业务 fingerprint 变化会清除 `satisfiedByAttemptId` 并使 verification、feature-check 和 logic-complete 失效，旧 attempts 仍保留用于审计。

## HUMAN GATE

### Gate 状态

```ts
interface HumanGateState {
  required: boolean;
  status: "not-presented" | "pending" | "confirmed";
  presentedRevision?: number;
  presentedAt?: string;
  challenge?: string;
  basisHash?: string;
  confirmation?: {
    userReply: string;
    promptEventId?: string;
    turnBoundaryEventId?: string;
    confirmedAt: string;
    host: "claude" | "codex";
    provenance: "matched-host-event" | "matched-turn-boundary";
  };
}
```

`dev_flow_confirm_gate` 必须显式接收用户原文：

```ts
{
  featureId: string;
  gate: "requirement_confirmation" | "implementation_approval";
  userReply: string;
  promptEventId?: string;
  turnBoundaryEventId?: string;
}
```

规则：

- `userReply` 必填并原样保存；不接受 `confirmed: true` 或代理转述。
- gate 必须已在更早 revision 中进入 pending。
- hook 捕获到对应用户消息时，`userReply` 必须与事件原文一致，且事件时间晚于 present；这是首选 provenance。
- 若某次宿主运行没有可消费的 `UserPromptSubmit` 事件，MCP 可接受 adapter 提供的、能够证明 present 之后已跨到新用户回合的 session/turn boundary，并记录为 `matched-turn-boundary`。
- 显式 `userReply` 是必要条件但不是时序证据。既没有匹配 prompt event、也没有可信后续 turn boundary 时，返回 `HUMAN_GATE_PROVENANCE_UNAVAILABLE` 并 fail closed，不能仅凭原文确认。
- 缺少显式原文、basis hash 漂移、时序 provenance 不足或能证明同回合确认时失败且不修改状态。
- requirement confirmation 绑定需求资产 hash。
- implementation approval 绑定 route、in/out scope、计划、coverage、rollback/safety 和风险证据 hash。
- 两个 HUMAN GATE 不能复用同一用户回复。

## MCP Tools

| Tool | 读写 | 职责 |
|---|---|---|
| `dev_flow_init_project` | 写 | 创建并验证 `project.json` |
| `dev_flow_classify` | 读 | 纯计算 route、步骤、资产、门禁 |
| `dev_flow_start` | 写 | 创建 feature state/event ledger；默认 active，也可显式创建 paused feature |
| `dev_flow_status` | 读 | 读取 active 或指定 feature |
| `dev_flow_next` | 读 | 返回唯一下一步 |
| `dev_flow_switch_active` | 写 | 原子 pause 当前 feature、activate 目标 feature 并记录原因 |
| `dev_flow_scaffold_artifact` | 写 | 在当前步骤允许时创建模板 |
| `dev_flow_record_step` | 写 | 登记非 HUMAN GATE 步骤与结构化证据 |
| `dev_flow_present_gate` | 写 | 生成 challenge 并登记 pending gate |
| `dev_flow_confirm_gate` | 写 | 保存用户原文并确认 gate |
| `dev_flow_reclassify` | 写 | 按单调升严规则重算 route、记录原因并失效受影响证据 |
| `dev_flow_feature_check` | 写 | 检查步骤、资产、hash、gate 和验证新鲜度 |
| `dev_flow_finalize` | 写 | 设置 logic-complete、把 lifecycle 置为 finalized 并清除 active |
| `dev_flow_abandon` | 写 | 终态放弃 active/paused feature；必要时清除 active |
| `dev_flow_doctor` | 读 | 检查配置、MCP、hooks、状态和 marketplace |

Skills 不调用隐藏 CLI，不直接读写 `state.json`，也不自行判断某个 gate 已完成。

## Host Adapters 与路径

### Claude Code

Claude manifest 使用：

```json
{
  "mcpServers": {
    "dev-flow": {
      "command": "node",
      "args": ["${CLAUDE_PLUGIN_ROOT}/dist/mcp-server.mjs"]
    }
  },
  "hooks": "./hosts/claude/hooks.json"
}
```

Claude hooks 使用 command form：

```json
{
  "type": "command",
  "command": "node \"${CLAUDE_PLUGIN_ROOT}/dist/claude-hook.mjs\""
}
```

Claude command hook 的官方 schema 只有 shell `command` 字段；路径必须使用上述双引号包裹的 `${CLAUDE_PLUGIN_ROOT}/dist/claude-hook.mjs`，不得回退到 cwd 相对路径。fixture 必须在包含空格的模拟 plugin root 下验证该 command 仍能正确定位 bundle。

### Codex CLI

Codex `.mcp.json` 使用插件根变量，不依赖 cwd：

```json
{
  "mcpServers": {
    "dev-flow": {
      "command": "node",
      "args": ["${PLUGIN_ROOT}/dist/mcp-server.mjs"]
    }
  }
}
```

Codex hooks 从 `$PLUGIN_ROOT/dist/codex-hook.mjs` 启动。最低支持版本必须在 release smoke 中真实验证变量展开；不支持该变量的宿主版本不进入支持矩阵。

MCP server 和 hooks 启动后，所有包内文件都通过入口模块的 `import.meta.url` 自定位，禁止使用 `process.cwd()` 查找模板、policy 或 schema。`process.cwd()` 只代表当前消费项目。

### Hook 事件

| 事件 | 行为 |
|---|---|
| SessionStart | 发现 active feature，注入恢复摘要和唯一 next action |
| UserPromptSubmit | 宿主提供时追加用户原文、session/turn marker 和时间戳，不推进状态 |
| PreToolUse | 阻止未批准的 protected-root 写入、同回合 gate 确认和过早 Git 写操作 |
| PostToolUse | 记录业务写入事件；后续 MCP 调用据此刷新 fingerprint 并失效验证 |
| Stop | HUMAN GATE/阻塞时允许停止；无阻塞且 action 可自动推进时返回恢复提示 |

严格 HUMAN GATE 不假设每个宿主、每个版本都一定发出 `UserPromptSubmit`。adapter 应尽可能收集该事件；缺失时只能使用宿主可验证的后续 turn boundary。两类时序证据都没有时确认失败，而不是降级为“只相信 `confirm_gate.userReply`”。跨宿主 E2E 必须覆盖 prompt event 路径、turn-boundary 路径和 provenance 全缺失的拒绝路径。

### Git Policy

logic-complete 前阻止：

```text
git add
git commit
git push
git merge
git rebase
git tag
git cherry-pick
git reset
```

只读白名单按子命令和 flag 精确匹配：

- 无条件只读：`status`、`diff`、`log`、`show`、`rev-parse`、`ls-files`、`ls-tree`、`cat-file`、`name-rev`。
- 条件只读：`branch` 仅允许无参数、`--list`、`--show-current`、`-a`、`-r`、`-v`、`-vv`；`remote` 仅允许 `-v`、`show`、`get-url`；`config` 仅允许 `--get`、`--get-all`、`--list`；`worktree` 仅允许 `list`；`stash` 仅允许 `list`、`show`。
- `git branch` 不是整体白名单；创建、删除、移动或修改分支的 flag 在 logic-complete 前仍拒绝。
- 未识别的子命令、flag、wrapper 或复杂 shell 组合在 strict mode 下 fail closed。

Git 解析必须按 argv/token 解析，不使用简单子串匹配，并正确处理 `git -C <path>` 等全局参数。

### 宿主版本支持线

开发初始资格基线为本设计确认时本机已验证的 Claude Code `2.1.215` 和 Codex CLI `0.144.4`，这不是未经测试向下兼容的承诺。首次 release smoke 必须记录两宿主实际版本和 plugin root/hook 能力；README 的最低支持版本取“已通过完整原生安装、hooks、MCP 与双向接力 smoke 的最低版本”。以后若要降低最低版本，必须新增该版本的兼容性 job，不能只改文档。

## Skills

| Skill | 边界 |
|---|---|
| dev-flow-task | 默认入口、分类、start、next |
| dev-flow-status | 只读状态与跨宿主恢复 |
| dev-flow-requirements | 需求探查、规范化、基线固化 |
| dev-flow-risk-review | 风险卡和标签证据 |
| dev-flow-plan | 短计划或标准计划 |
| dev-flow-coverage-review | 需求—任务—验证—回撤覆盖 |
| dev-flow-rollback-safety | 回撤单元、安全边界和回撤后验证 |
| dev-flow-plan-review | 实现前的计划审查 |
| dev-flow-implement | 授权后实现 |
| dev-flow-code-review | 实现后的 diff 审查 |
| dev-flow-verify | 执行 project.json 中登记的验证命令 |
| dev-flow-feature-check | 确定性流程完整性检查 |
| dev-flow-finish | 推进至 logic-complete |
| dev-flow-doctor | 插件与项目诊断 |

plan-review 与 code-review 使用不同 step ID、输入、模板和 evidence schema。任一 Skill 都不能用另一种 review 的结果完成自己。

## Manifest 与 Marketplace

### Claude manifest

`plugins/dev-flow/.claude-plugin/plugin.json`

```json
{
  "$schema": "https://json.schemastore.org/claude-code-plugin-manifest.json",
  "name": "dev-flow",
  "displayName": "Dev Flow",
  "version": "1.0.0",
  "description": "Risk-aware multi-route development orchestration for Claude Code and Codex CLI.",
  "author": {
    "name": "wxy-hh",
    "url": "https://github.com/wxy-hh"
  },
  "homepage": "https://github.com/wxy-hh/dev-flow",
  "repository": "https://github.com/wxy-hh/dev-flow",
  "license": "MIT",
  "keywords": ["development", "workflow", "review", "verification"],
  "skills": "./skills/",
  "hooks": "./hosts/claude/hooks.json",
  "mcpServers": {
    "dev-flow": {
      "command": "node",
      "args": ["${CLAUDE_PLUGIN_ROOT}/dist/mcp-server.mjs"]
    }
  }
}
```

### Codex manifest

`plugins/dev-flow/.codex-plugin/plugin.json`

```json
{
  "name": "dev-flow",
  "version": "1.0.0",
  "description": "Risk-aware multi-route development orchestration for Claude Code and Codex CLI.",
  "author": {
    "name": "wxy-hh",
    "url": "https://github.com/wxy-hh"
  },
  "homepage": "https://github.com/wxy-hh/dev-flow",
  "repository": "https://github.com/wxy-hh/dev-flow",
  "license": "MIT",
  "keywords": ["development", "workflow", "review", "verification"],
  "skills": "./skills/",
  "hooks": "./hosts/codex/hooks.json",
  "mcpServers": "./.mcp.json",
  "interface": {
    "displayName": "Dev Flow",
    "shortDescription": "Route development work by size and risk.",
    "longDescription": "A dual-host development workflow with strict human gates, route-specific assets, review separation, verification, and safe Git finalization.",
    "developerName": "wxy-hh",
    "category": "Productivity",
    "capabilities": ["Interactive", "Write"],
    "defaultPrompt": [
      "Classify and start this development task with Dev Flow.",
      "Resume the active Dev Flow feature.",
      "Finish the active feature through verification."
    ],
    "brandColor": "#2563EB"
  }
}
```

### Claude marketplace

```json
{
  "name": "dev-flow-marketplace",
  "owner": { "name": "wxy-hh" },
  "plugins": [
    {
      "name": "dev-flow",
      "source": "./plugins/dev-flow",
      "description": "Risk-aware multi-route development orchestration for Claude Code and Codex CLI."
    }
  ]
}
```

### Codex marketplace

```json
{
  "name": "dev-flow-marketplace",
  "interface": { "displayName": "Dev Flow Marketplace" },
  "plugins": [
    {
      "name": "dev-flow",
      "source": {
        "source": "local",
        "path": "./plugins/dev-flow"
      },
      "policy": {
        "installation": "AVAILABLE",
        "authentication": "ON_INSTALL"
      },
      "category": "Productivity"
    }
  ]
}
```

## 安装、升级与发布

安装：

```bash
claude plugin marketplace add wxy-hh/dev-flow
claude plugin install dev-flow@dev-flow-marketplace

codex plugin marketplace add wxy-hh/dev-flow
codex plugin add dev-flow@dev-flow-marketplace
```

升级：

```bash
claude plugin marketplace update dev-flow-marketplace
claude plugin update dev-flow@dev-flow-marketplace

codex plugin marketplace upgrade dev-flow-marketplace
codex plugin add dev-flow@dev-flow-marketplace
```

发布要求：

- 根 `package.json#version`、两份 plugin manifest 和三个 bundle 的版本必须由 `sync-version` 校验一致；marketplace 不保存冗余 version。
- `dist/` 必须由当前源码重建且没有 diff。
- Claude plugin validate 必须通过。
- Codex 必须在隔离 HOME 中完成 marketplace add、plugin add 和 MCP 初始化。
- release smoke 必须完成 Claude → Codex 与 Codex → Claude 双向接力。
- 用户安装路径不允许出现额外依赖安装步骤。

`docs/routes.md` 的 route 表由 `policy/contract.json` 生成。生成器只改标记区间，`docs:routes:check` 重生成到内存并逐字比较；手写叙述可以保留，但步骤、gate、资产、风险增强和 feature-check 字段不得形成第二份权威。

## 验收矩阵

| Case | 输入 | 验收重点 |
|---|---|---|
| XS | XS + local + 无风险 | 无 Markdown、status、plan-review、feature-check |
| S | S + local + 无风险 | 只走边界、实现、测试、自审 |
| risk XS | XS + local + security | risk-minimal；status+risk card；implementation gate；feature-check |
| risk S | S + local + data | risk-minimal；风险卡含回撤；无需求书和 plan-review |
| risk M | M + shared-contract + light + external | risk-minimal；不误入 light-m；集成行为验证和 feature-check 必须完成 |
| light M | M + local + light + 无风险 | 强制 code-review step；不强制 review Markdown、status、HUMAN GATE、feature-check |
| standard M | M + local + standard + missing requirements | 完整标准链；两个 HUMAN GATE；仅四类独立资产 |
| light L | L + multi-chain + light | 边界卡、回撤/安全、implementation gate、full verification、feature-check |
| standard L | L + coordinated-rollback + standard | 完整标准 L；七类资产；两个 HUMAN GATE |
| topology rejection | S + multi-chain | 拒绝并建议 L，不静默升级 |
| single active | active A 存在时默认 start active B | 拒绝；显式创建 paused B 后，switch 可原子暂停 A 并激活 B |
| switch terminal | 尝试切到 finalized/abandoned B | 拒绝且 A、B、active pointer 均不变 |
| abandon | abandon active/paused feature | 记录原因与用户证据；终态不可恢复；finalized 不可 abandon |
| reclassify | light M 增加风险或提升到 standard/L | 只升严；保留仍有效证据；approval 和受影响后续证据失效 |
| review separation | 用 code-review 完成 plan-review | schema 拒绝，反向亦然 |
| strict gate | 同回合 present+confirm | adapter/MCP 拒绝；userReply 必填 |
| missing gate provenance | 有 userReply 但无 prompt event/turn boundary | `HUMAN_GATE_PROVENANCE_UNAVAILABLE`，revision 不变 |
| project config | 缺 project.json 或命令引用不存在 | start/verify 失败且不修改 feature |
| Git guard | logic-complete 前执行 Git 写操作 | 拒绝；只读 Git 允许 |
| stale verification | 验证后修改 protected root | verification、feature-check、logic-complete 失效 |
| verification retry | 同一 command 先失败再通过 | 失败 attempt 保留并阻塞后续；fresh pass 可满足 verification |
| asset integrity | 删除或篡改强制资产 | feature-check 失败 |
| Claude → Codex | Claude 创建标准 M，Codex 接续 | 同一 revision；不重复 gate；Codex finalize |
| Codex → Claude | Codex 创建轻量 L，Claude 接续 | 同一 state、资产 hash 和事件序列 |
| native install | 两个隔离 HOME 原生安装 | Skills、MCP、hooks 均发现 |
| native upgrade | 1.0.0 → 1.0.1 原生升级 | v1 active feature 可继续，无安装脚本 |
| version drift | 根版本、manifest 或 bundle 任一不一致 | `version:check`/`build:check` 失败 |
| lock contention | 活 owner 持锁超过 5 秒 | 返回 `STATE_LOCK_TIMEOUT`，不得抢锁或部分写入 |

## 失败处理

- 所有策略错误使用稳定错误码，工具返回失败时不得部分写状态。
- schema 非 v1 返回 `UNSUPPORTED_STATE_SCHEMA`，不尝试转换。
- project 配置无效返回 `INVALID_PROJECT_CONFIG`。
- active 冲突返回 `ACTIVE_FEATURE_CONFLICT`。
- 锁等待超过 5 秒返回 `STATE_LOCK_TIMEOUT`；只允许接管 owner 已死亡且超过 30 秒的 stale lock。
- revision 冲突返回 `STATE_REVISION_CONFLICT`，调用方重新读取状态。
- HUMAN GATE 缺原文、basis 漂移、同回合确认或缺少时序 provenance 返回对应 gate 错误；provenance 不足固定为 `HUMAN_GATE_PROVENANCE_UNAVAILABLE`。
- 验证命令失败保持 verification pending，追加失败 attempt 并阻止后续步骤；同一命令允许重跑，成功不会删除历史失败。
- 非单调重分级返回 `RECLASSIFICATION_NOT_STRICTER`；终态重分级或恢复返回 lifecycle 错误且不修改状态。
- feature-check 只报告缺口，不自动补资产、确认 gate 或接受风险。

## 最终产品决定

1. `.dev-flow/project.json` 是必需项目配置，承载验证命令、strict enforcement 和 protected roots。
2. `confirm_gate` 必须显式携带并保存用户原文，同时必须匹配 prompt event 或可信后续 turn boundary；任一都不是可省略的替代品。
3. Codex MCP/hooks 使用 `PLUGIN_ROOT`，包内资源使用 `import.meta.url` 自定位，不依赖 cwd。
4. 一个工作区只允许一个 active feature；switch 原子 pause/activate，历史和暂停 feature 目录可以并存，abandoned/finalized 不可恢复。
5. 发布包必须提交预构建 `dist/`，用户安装后不安装 npm 依赖。
6. 轻量 M 强制 code-review step，但不强制 `code-review.md`。
7. OpenSpec integration is out of scope for v1。
8. 根 `package.json#version` 是版本唯一权威；manifest 和 bundle 由脚本同步，marketplace 不复制版本。
9. HUMAN GATE 缺失可验证的后续用户回合 provenance 时 fail closed；显式原文本身不足以确认。
10. 风险增强、route obligation 和 reclassify 升严关系全部进入机器 contract 并由生成文档/测试核对。
11. verification 采用 append-only attempts；失败阻塞、允许重跑、历史不删除。
12. Git 只读能力使用精确 command/flag 白名单，未知形式在 strict mode 下拒绝。
13. state lock 默认 5 秒超时、50 ms 加抖动重试、30 秒 stale 候选阈值，并区分 lock timeout 与 revision conflict。

## 1.1.0 补充：grillme

自 **1.1.0** 起（不改 route/MCP 工具/HUMAN GATE 数量）：

- 公开技能 `dev-flow-grillme`：标准 M/L 的 `requirements` 步骤内逐题压测；`dev-flow-requirements` 仍是唯一编排与状态写入者。
- `missing-or-unclear` / `documented-unconfirmed` 强制 grill；`provided-confirmed` 默认 `grill_status: not_required`，可显式拷问。
- `requirements.md` front matter 字段 `grill_status` 为 core 唯一强制枚举；`recordStep(requirements)` 与 `presentGate(requirement_confirmation)` 在自动态未 `complete` 时拒绝。
- 详述见根 README、`docs/routes.md`、`docs/architecture.md`。
