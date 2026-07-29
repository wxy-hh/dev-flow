# Dev Flow 追溯账本实施计划

> **面向智能体执行者：** 必需子技能：使用 `superpowers:subagent-driven-development`（推荐）或 `superpowers:executing-plans`，按任务顺序逐项实现。所有步骤使用复选框跟踪；每个任务先制造红灯，再做最小实现，绿灯后独立提交。

**目标：** 建立 `REQ/AC → TASK → TEST/RU` 的机器可审计追溯链，让路线合同、Core、MCP、宿主 Hook 和 Skills 共享同一套默认拒绝规则。

**架构：** Markdown 是人类叙述层，Core 从声明锚点计算节点区块哈希；调用方只提交单个 artifact 的完整节点集合。Trace 账本使用不可变内容寻址 snapshot，`state.json` 中的 `TraceabilityPointer` 是提交点；artifact registration、pointer 和下游失效在同一个 feature CAS 中提交。

**技术栈：** TypeScript 5.9、Node.js 20、Node.js 内置测试运行器、JSON Schema 2020-12、现有 MCP server、Claude Code/Codex 宿主适配器、esbuild。

## 全局约束

- 现有 active feature 按旧合同完成；缺少 `workflowCapabilities` 的 state 等价于 `{ trace: 0, review: 0, checkpoints: 0, rollbackExecution: 0 }`。
- 新 feature 固定保存 `SUPPORTED_WORKFLOW_CAPABILITIES = { trace: 1, review: 0, checkpoints: 0, rollbackExecution: 0 }`；插件升级不得改变已启动 feature 的能力。
- 只有 `traceEnforcementRequired(route, capabilities)` 为真时才强制 Trace；该谓词仅对 `trace: 1` 的 `standard-m`/`standard-l` 返回 true。
- `requiredArtifacts` 只包含人工编辑产物，`generatedArtifacts` 只包含 Core 生成产物；二者不得重叠。
- 本阶段把现有 `status` 迁入 generated artifact，但不迁移 `plan-review`；`review: 0` feature 继续使用旧 plan-review artifact/evidence。
- 调用方提交完整 `TraceDelta.nodes`，不得提交 `source*`、`verificationConfigSha256`、`status`、tombstone 或 `edges[]`。
- 同一来源 artifact 中未再次出现的旧 ID 由 Core 生成 tombstone；tombstone ID 永不复用。
- snapshot 路径固定为 `.dev-flow/features/<featureId>/traceability/snapshots/<sha256>.json`，文件不可覆盖、不可修改。
- `state.json` rename 是 Trace 登记的逻辑提交点；提交前失败不得改变 state pointer，提交后不得谎报为已回滚。
- 不新增运行时 npm 依赖；继续使用 Node.js 标准库和已有开发依赖。
- 代码标识符、错误码和命令保持英文；用户可见模板、Skills 和文档使用中文。
- 中间任务不运行 `npm run build`，避免产生跨任务 dist 改动；任务 8 统一更新并提交三个受版本控制的 bundle。
- 每个任务提交前必须通过该任务列出的测试、全量 source-based 单元回归和所有已受影响的 source-based 路线测试；不允许以“后续任务会修”为理由提交已知红灯。
- Task 7 的 MCP 协议测试把源码临时构建到测试临时目录，不写受版本控制的 `plugins/dev-flow/dist`；只有 Task 8 更新正式 bundle。
- 每完成一个步骤就把本计划对应复选框改为 `[x]`；本计划的进度变更随当前任务提交，不单独制造进度 commit。

## 文件职责

| 文件 | 单一职责 |
| --- | --- |
| `plugins/dev-flow/src/policy/types.ts` | workflow capability、路线 artifact 模式和 `repair-trace` 动作 |
| `plugins/dev-flow/src/policy/traceability.ts` | Trace ID、节点、delta、ledger、pointer、错误类型与纯常量 |
| `plugins/dev-flow/src/policy/contract.ts` | capability-aware 路线合同和唯一 Trace 强制谓词 |
| `plugins/dev-flow/src/core/artifact-templates.ts` | Trace 相关 artifact 的唯一运行时模板 |
| `plugins/dev-flow/src/core/traceability-anchors.ts` | 声明锚点解析、区块切分和区块 SHA-256 |
| `plugins/dev-flow/src/core/traceability.ts` | delta 替换、tombstone、edges、图校验、失效传播和 slice 校验 |
| `plugins/dev-flow/src/core/traceability-store.ts` | snapshot 规范序列化、内容寻址写入、pointer 校验和孤儿枚举 |
| `plugins/dev-flow/src/core/state-store.ts` | capability/pointer 持久化、start/reclassify 和 feature CAS 提交点 |
| `plugins/dev-flow/src/core/artifacts.ts` | scaffold、裸登记门禁和 artifact + Trace 原子登记 |
| `plugins/dev-flow/src/core/gate-basis.ts` | HUMAN GATE 对 artifact 与 Trace pointer 的稳定基线 |
| `plugins/dev-flow/src/core/feature-check.ts` | recordStep、feature-check、finalize 的 Trace 门禁 |
| `plugins/dev-flow/src/core/next.ts`、`status.ts`、`step-order.ts` | repair-trace 动作和可观察性 |
| `plugins/dev-flow/src/mcp/doctor.ts` | pointer 损坏与孤儿 snapshot 诊断 |
| `plugins/dev-flow/src/mcp/server.ts` | 两个 Trace MCP 工具及严格输入 Schema |
| `plugins/dev-flow/src/hosts/adapter-policy.ts` | 禁止 Agent 直接写 Trace 控制文件 |

---

## 任务 1：固化能力快照、Trace 类型和 editable/generated 路线合同

**文件：**

- 修改：`plugins/dev-flow/src/policy/types.ts`
- 新建：`plugins/dev-flow/src/policy/traceability.ts`
- 修改：`plugins/dev-flow/policy/contract.json`
- 修改：`plugins/dev-flow/src/policy/contract.ts`
- 修改：`plugins/dev-flow/src/core/state-store.ts`
- 新建：`tests/unit/traceability-policy.test.mjs`

**接口：**

```ts
export interface WorkflowCapabilities {
  trace: 0 | 1;
  review: 0 | 1;
  checkpoints: 0 | 1;
  rollbackExecution: 0 | 1;
}

export const ZERO_WORKFLOW_CAPABILITIES: WorkflowCapabilities;
export const SUPPORTED_WORKFLOW_CAPABILITIES: WorkflowCapabilities;

export interface RouteDefinition {
  orderedSteps: string[];
  requiredArtifacts: string[];
  generatedArtifacts?: string[];
  artifactSteps?: Record<string, string[]>;
  generatedArtifactSteps?: Record<string, string[]>;
  artifactTransitions?: Array<{
    artifact: string;
    capability: keyof WorkflowCapabilities;
    from: "editable" | "absent";
    to: "generated";
    steps: string[];
  }>;
  featureCheckRequired: boolean;
}

export function normalizeWorkflowCapabilities(
  value: WorkflowCapabilities | undefined,
): WorkflowCapabilities;

export function routeDefinitionForFeature(
  route: RouteId,
  capabilities: WorkflowCapabilities | undefined,
): RouteDefinition;

export function traceEnforcementRequired(
  route: RouteId,
  capabilities: WorkflowCapabilities | undefined,
): boolean;
```

在 `policy/traceability.ts` 定义并导出以下精确协议：

```ts
export type TraceStatus = "current" | "stale" | "tombstoned";
export type RequirementId = `REQ-${string}`;
export type AcceptanceCriterionId = `AC-${string}`;
export type TaskId = `TASK-${string}`;
export type TestId = `TEST-${string}`;
export type RollbackId = `RU-${string}`;
export type TraceId =
  | RequirementId
  | AcceptanceCriterionId
  | TaskId
  | TestId
  | RollbackId;

export type TraceArtifactKind =
  | "requirements"
  | "implementation-plan"
  | "coverage-matrix"
  | "rollback-units";

export interface TraceSource {
  sourceArtifact: TraceArtifactKind;
  sourceSha256: string;
  sourceAnchor: string;
  sourceBlockSha256: string;
  status: TraceStatus;
}

export interface RequirementNode extends TraceSource {
  kind: "requirement";
  id: RequirementId;
}

export interface AcceptanceCriterionNode extends TraceSource {
  kind: "acceptance-criterion";
  id: AcceptanceCriterionId;
  parentRequirement: RequirementId;
}

export interface TaskNode extends TraceSource {
  kind: "task";
  id: TaskId;
  covers: Array<RequirementId | AcceptanceCriterionId>;
  rollbackUnit: RollbackId;
}

export interface TestNode extends TraceSource {
  kind: "test";
  id: TestId;
  verifies: AcceptanceCriterionId[];
}

export interface RollbackNode extends TraceSource {
  kind: "rollback";
  id: RollbackId;
  tasks: TaskId[];
  dependsOn: RollbackId[];
  fileScope: string[];
  covers: Array<RequirementId | AcceptanceCriterionId>;
  forwardVerification: string[];
  rollbackVerification: string[];
  sourceArtifact: "implementation-plan" | "rollback-units";
  verificationConfigSha256: string;
}

export type TraceNode =
  | RequirementNode
  | AcceptanceCriterionNode
  | TaskNode
  | TestNode
  | RollbackNode;

export type TraceNodeInput =
  | { kind: "requirement"; id: RequirementId }
  | {
      kind: "acceptance-criterion";
      id: AcceptanceCriterionId;
      parentRequirement: RequirementId;
    }
  | {
      kind: "task";
      id: TaskId;
      covers: Array<RequirementId | AcceptanceCriterionId>;
      rollbackUnit: RollbackId;
    }
  | { kind: "test"; id: TestId; verifies: AcceptanceCriterionId[] }
  | {
      kind: "rollback";
      id: RollbackId;
      tasks: TaskId[];
      dependsOn: RollbackId[];
      fileScope: string[];
      covers: Array<RequirementId | AcceptanceCriterionId>;
      forwardVerification: string[];
      rollbackVerification: string[];
    };

export interface TraceDelta {
  nodes: TraceNodeInput[];
}

export interface TraceSummary {
  total: number;
  current: number;
  stale: number;
  tombstoned: number;
}

export interface TraceabilityPointer {
  path: `traceability/snapshots/${string}.json`;
  sha256: string;
  revision: number;
  summary: TraceSummary;
}

export interface TraceEdge {
  from: TraceId;
  type:
    | "parent"
    | "covers"
    | "verifies"
    | "rollback-unit"
    | "contains-task"
    | "depends-on";
  to: TraceId;
}

export interface TraceabilityLedger {
  schemaVersion: 1;
  featureId: string;
  revision: number;
  stateRevision: number;
  projectConfigSha256: string;
  nodes: Record<string, TraceNode>;
  edges: TraceEdge[];
  summary: TraceSummary;
}
```

`NextAction` 增加：

```ts
| {
    kind: "repair-trace";
    step: string;
    code: "TRACE_SLICE_INCOMPLETE" | "TRACE_SLICE_STALE";
    details: Record<string, unknown>;
  }
```

**步骤：**

- [x] **步骤 1：写路线合同红灯测试。** 在 `tests/unit/traceability-policy.test.mjs` 断言：

```js
import assert from "node:assert/strict";
import test from "node:test";
import { loadSource } from "../helpers/load-source.mjs";

const contract = await loadSource("plugins/dev-flow/src/policy/contract.ts");

test("capability-aware contract derives modes without mutating the base contract", () => {
  const base = contract.routeDefinition("standard-m");
  const legacy = contract.routeDefinitionForFeature("standard-m", undefined);
  assert.ok(base.requiredArtifacts.includes("status"));
  assert.deepEqual(legacy.generatedArtifacts, ["status"]);
  assert.ok(!legacy.requiredArtifacts.includes("status"));
  assert.ok(legacy.requiredArtifacts.includes("implementation-plan"));
  assert.equal(
    legacy.requiredArtifacts.some((kind) => legacy.generatedArtifacts.includes(kind)),
    false,
  );
});

test("Trace stage preserves legacy plan-review modes and predeclares Review 2a transition", () => {
  const traceOnly = { trace: 1, review: 0, checkpoints: 0, rollbackExecution: 0 };
  const review = { ...traceOnly, review: 1 };
  assert.ok(!contract.routeDefinitionForFeature("standard-m", traceOnly)
    .requiredArtifacts.includes("plan-review"));
  assert.ok(contract.routeDefinitionForFeature("standard-l", traceOnly)
    .requiredArtifacts.includes("plan-review"));
  assert.ok(contract.routeDefinitionForFeature("standard-m", review)
    .generatedArtifacts.includes("plan-review"));
  assert.ok(contract.routeDefinitionForFeature("standard-l", review)
    .generatedArtifacts.includes("plan-review"));
});

test("trace enforcement is route and capability dependent", () => {
  const trace = { trace: 1, review: 0, checkpoints: 0, rollbackExecution: 0 };
  assert.equal(contract.traceEnforcementRequired("standard-m", trace), true);
  assert.equal(contract.traceEnforcementRequired("standard-l", trace), true);
  assert.equal(contract.traceEnforcementRequired("light-m", trace), false);
  assert.equal(contract.traceEnforcementRequired("standard-m", undefined), false);
});
```

- [x] **步骤 2：运行红灯。**

```bash
node --test tests/unit/traceability-policy.test.mjs
```

预期：FAIL，原因是 `routeDefinitionForFeature` 或 `traceEnforcementRequired` 尚未导出。

- [x] **步骤 3：实现非破坏性的能力与路线合同。** `normalizeWorkflowCapabilities(undefined)` 返回冻结的零能力副本；原始 `routeDefinition` 保留当前兼容基线，不直接搬移数组。`routeDefinitionForFeature` 深拷贝基线、应用 capability/global transition，并验证 editable/generated 不重叠；它把 risk-minimal 和 standard M 的 status 派生到 `generatedArtifacts/generatedArtifactSteps`。在 contract 中预声明两条 Review 2a transition：standard M 的 plan-review 为 `absent → generated`，standard L 为 `editable → generated`；本阶段 `review: 0` 不触发。`FeatureState` 先增加可选 `workflowCapabilities?: WorkflowCapabilities` 供消费方编译，但只有任务 4 的 `startFeature` 才开始持久化。任何持有 `FeatureState` 的消费方最终必须使用有效合同，但本任务不在 capability 尚未进入 state 前制造半迁移调用链。

- [x] **步骤 4：补全 Trace 类型编译检查。** 在测试中构造最小 `TraceDelta` 和 `TraceabilityLedger`，并运行：

```bash
npm run typecheck
```

预期：PASS。

- [x] **步骤 5：运行策略与现有合同回归。**

```bash
node --test tests/unit/traceability-policy.test.mjs tests/unit/derive-next.test.mjs
npm run test:unit
```

预期：PASS；既有 base contract 消费方行为不变，没有已知单元回归。

- [x] **步骤 6：提交任务 1。**

```bash
git add plugins/dev-flow/src/policy/types.ts \
  plugins/dev-flow/src/policy/traceability.ts \
  plugins/dev-flow/policy/contract.json \
  plugins/dev-flow/src/policy/contract.ts \
  plugins/dev-flow/src/core/state-store.ts \
  tests/unit/traceability-policy.test.mjs
git add docs/superpowers/plans/2026-07-28-dev-flow-traceability-ledger.md
git commit -m "feat(dev-flow): define traceability contract"
```

---

## 任务 2：建立 TypeScript 模板唯一事实源和声明区块解析器

**文件：**

- 新建：`plugins/dev-flow/src/core/artifact-templates.ts`
- 新建：`plugins/dev-flow/src/core/traceability-anchors.ts`
- 修改：`plugins/dev-flow/src/core/artifacts.ts`
- 修改：`tests/unit/artifacts.test.mjs`
- 删除：`plugins/dev-flow/templates/implementation-plan.md`
- 删除：`plugins/dev-flow/templates/coverage-matrix.md`
- 删除：`plugins/dev-flow/templates/rollback-units.md`
- 新建：`tests/unit/traceability-templates.test.mjs`

**接口：**

```ts
export interface ArtifactTemplateContext {
  featureId: string;
  route: RouteId;
  requirementsState?: RequirementsState;
}

export function renderArtifactTemplate(
  context: ArtifactTemplateContext,
  kind: string,
): string;

export type TraceAnchorKind =
  | "requirement"
  | "acceptance-criterion"
  | "task"
  | "test"
  | "rollback";

export interface TraceSourceBlock {
  id: TraceId;
  kind: TraceAnchorKind;
  sourceAnchor: string;
  sourceBlockSha256: string;
}

export function parseTraceSourceBlocks(markdown: string): TraceSourceBlock[];
```

**模板合同：**

`renderArtifactTemplate` 对四个 Trace artifact 生成以下声明，front matter 继续包含 `schema_version`、`feature_id`、`route`、`kind`；requirements 继续包含现有 `grill_status`：

```md
<!-- dev-flow:id=REQ-001 kind=requirement -->
### REQ-001：需求

<!-- dev-flow:id=AC-001 kind=acceptance-criterion -->
#### AC-001：验收条件（parent: REQ-001）
```

```md
<!-- dev-flow:id=TASK-001 kind=task -->
### TASK-001：实现任务

<!-- dev-flow:id=RU-001 kind=rollback -->
### RU-001：回撤单元
```

```md
<!-- dev-flow:id=TEST-001 kind=test -->
### TEST-001：验证场景（verifies: AC-001）
```

standard L 的 `rollback-units` 使用同一个 RU 区块；`forwardVerification` 和 `rollbackVerification` 填 command ID，不出现任意 shell 命令。

**generated artifact 合同：**

- Core `scaffoldArtifact` 可以按 `generatedArtifactSteps` 首次创建并登记 generated artifact。
- scaffold 后的每次 state mutation 由 Core 生成投影内容并更新登记 SHA-256。
- `recordArtifact` 和后续 `recordArtifactWithTrace` 对 generated artifact 一律返回 `GENERATED_ARTIFACT_READ_ONLY`。
- integrity 校验读取 effective editable/generated 并集；Skill 不能编辑或登记 generated 内容。
- standard L 没有 status artifact，只使用 `StatusView`，测试不得假造或 scaffold status 文件。

**步骤：**

- [ ] **步骤 1：写真实 scaffold 红灯测试。**

```js
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import {
  createTinyApp,
  strictProjectConfig,
} from "../helpers/fixture-repo.mjs";
import { loadSource } from "../helpers/load-source.mjs";

const store = await loadSource("plugins/dev-flow/src/core/state-store.ts");
const artifacts = await loadSource("plugins/dev-flow/src/core/artifacts.ts");
const anchors = await loadSource(
  "plugins/dev-flow/src/core/traceability-anchors.ts",
);

test("standard M scaffold comes from the runtime renderer", async (t) => {
  const fixture = await createTinyApp();
  t.after(fixture.dispose);
  const { root } = fixture;
  await store.initProject(root, strictProjectConfig);
  let state = await store.startFeature(root, {
    featureId: "m",
    level: "M",
    topology: "local",
    execution: "standard",
    requirements: "provided-confirmed",
    host: "codex",
  });
  state = await artifacts.scaffoldArtifact(root, "m", state.revision, "requirements");
  const text = await readFile(
    path.join(root, ".dev-flow/features/m/需求文档.md"),
    "utf8",
  );
  assert.match(text, /dev-flow:id=REQ-001 kind=requirement/);
  assert.match(text, /dev-flow:id=AC-001 kind=acceptance-criterion/);
});
```

- [ ] **步骤 2：写锚点解析红灯测试。**

```js
test("anchor parser hashes exact adjacent blocks and rejects duplicate ids", () => {
  const blocks = anchors.parseTraceSourceBlocks([
    "<!-- dev-flow:id=REQ-001 kind=requirement -->",
    "### first",
    "<!-- dev-flow:id=AC-001 kind=acceptance-criterion -->",
    "### second",
  ].join("\n"));
  assert.deepEqual(blocks.map(({ id, kind }) => ({ id, kind })), [
    { id: "REQ-001", kind: "requirement" },
    { id: "AC-001", kind: "acceptance-criterion" },
  ]);
  assert.throws(
    () => anchors.parseTraceSourceBlocks(
      "<!-- dev-flow:id=REQ-001 kind=requirement -->\n"
      + "<!-- dev-flow:id=REQ-001 kind=requirement -->\n",
    ),
    /TRACE_SOURCE_ANCHOR_INVALID/,
  );
});
```

- [ ] **步骤 3：写 generated 生命周期红灯测试。** standard M/risk-minimal 在正确步骤可以 scaffold status、随后 state mutation 刷新其 hash，手工 record 被拒绝；standard L scaffold status 返回 `ARTIFACT_NOT_REQUIRED`。同时断言 stateful artifact API 只读取 `routeDefinitionForFeature(state.route, state.workflowCapabilities)` 的 editable/generated 并集。

- [ ] **步骤 4：运行红灯。**

```bash
node --test tests/unit/traceability-templates.test.mjs
```

预期：FAIL，原因是 renderer/parser 模块不存在或 scaffold 仍输出旧通用标题。

- [ ] **步骤 5：实现 renderer 和 artifact 模式。** `artifacts.ts` 对 requirements、implementation-plan、coverage-matrix、rollback-units 调用 `renderArtifactTemplate`；其他既有 artifact 保持现有通用模板，不在本任务重构。scaffold、record 和 integrity 都读取 effective contract：scaffold/integrity 使用 editable/generated 并集，record 只接受 editable。同步把 `tests/unit/artifacts.test.mjs` 的 risk-minimal 断言更新为 effective editable `risk-card`、generated `status`，并覆盖 standard L 无 status。

- [ ] **步骤 6：实现严格锚点解析。** 只接受精确注释格式：

```ts
const TRACE_ANCHOR =
  /<!-- dev-flow:id=(REQ|AC|TASK|TEST|RU)-([0-9]{3,}) kind=(requirement|acceptance-criterion|task|test|rollback) -->/g;
```

前缀与 kind 必须匹配；区块范围从当前声明开始到下一个声明开始，区块正文按原始 UTF-8 计算 SHA-256。front matter 位于第一个声明之外，因此 grill 字段变化不会改变 REQ/AC 区块 hash。零声明、重复 ID、同一前缀错误 kind 均抛 `TRACE_SOURCE_ANCHOR_INVALID`。

- [ ] **步骤 7：删除三个静态空模板并运行测试。**

```bash
node --test tests/unit/traceability-templates.test.mjs tests/unit/requirements-grill.test.mjs tests/unit/artifacts.test.mjs
npm run typecheck
npm run test:unit
npm run test:routes
```

预期：PASS；artifact 模式迁移没有留下已知 source-based 回归。

- [ ] **步骤 8：提交任务 2。**

```bash
git add plugins/dev-flow/src/core/artifact-templates.ts \
  plugins/dev-flow/src/core/traceability-anchors.ts \
  plugins/dev-flow/src/core/artifacts.ts \
  tests/unit/artifacts.test.mjs \
  plugins/dev-flow/templates/implementation-plan.md \
  plugins/dev-flow/templates/coverage-matrix.md \
  plugins/dev-flow/templates/rollback-units.md \
  tests/unit/traceability-templates.test.mjs
git add docs/superpowers/plans/2026-07-28-dev-flow-traceability-ledger.md
git commit -m "feat(dev-flow): render trace-aware artifacts"
```

---

## 任务 3：实现完整 delta 替换、图校验、edges 和精确失效传播

**文件：**

- 新建：`plugins/dev-flow/policy/traceability.schema.json`
- 新建：`plugins/dev-flow/src/core/traceability.ts`
- 新建：`tests/unit/traceability-graph.test.mjs`
- 新建：`tests/unit/traceability-schema-contract.test.mjs`

**接口：**

```ts
export interface ApplyTraceDeltaInput {
  current: TraceabilityLedger;
  route: RouteId;
  artifactKind: TraceArtifactKind;
  artifactSha256: string;
  sourceBlocks: TraceSourceBlock[];
  delta: TraceDelta;
  projectConfigSha256: string;
  verificationCommandIds: string[];
  nextStateRevision: number;
}

export function emptyTraceabilityLedger(
  featureId: string,
  stateRevision: number,
  projectConfigSha256: string,
): TraceabilityLedger;

export function applyTraceDelta(input: ApplyTraceDeltaInput): TraceabilityLedger;
export function deriveTraceEdges(nodes: Record<string, TraceNode>): TraceEdge[];
export function validateTraceDelta(value: unknown): asserts value is TraceDelta;
export function validateTraceGraph(
  ledger: TraceabilityLedger,
  route: RouteId,
  mode: "partial" | "complete",
): void;
export function traceSummary(nodes: Record<string, TraceNode>): TraceSummary;
export function assertTraceSliceCurrent(
  ledger: TraceabilityLedger,
  route: RouteId,
  step: string,
  currentProjectConfigSha256: string,
): void;
export function assertTraceabilityComplete(
  ledger: TraceabilityLedger,
  route: RouteId,
  currentProjectConfigSha256: string,
): void;
```

**完整替换规则：**

```ts
export const ALLOWED_TRACE_KINDS = {
  requirements: ["requirement", "acceptance-criterion"],
  "implementation-plan": ["task", "rollback"],
  "coverage-matrix": ["test"],
  "rollback-units": ["rollback"],
} as const;
```

- standard M 的 implementation-plan 必须同时提供 TASK/RU；standard L 的 implementation-plan 禁止 RU，rollback-units 只允许 RU。
- standard L 的 TASK 可以在 partial 图中先引用后续 rollback-units 才定义的 RU；这是唯一允许的 deferred reference。`rollback_unit` 及其后步骤必须要求 TASK↔RU 两端存在、current 且对称。
- `sourceBlocks` 的 ID 集合必须与 `delta.nodes` 完全相等。
- Core 为输入节点绑定 `sourceArtifact`、`sourceSha256`、`sourceAnchor`、`sourceBlockSha256`、`status: "current"`；RU 同时绑定 `verificationConfigSha256`。
- 当前来源中旧 snapshot 存在但新 delta 缺失的 ID 转为 tombstoned。
- 输入包含任意历史 tombstoned ID 时返回 `TRACE_GRAPH_INVALID`。
- 区块哈希或调用方可提交的结构字段发生变化时，仅沿 `parent/covers/verifies/rollback-unit/contains-task/depends-on` 的反向依赖闭包传播 stale。
- 同一 artifact 中区块哈希、关系字段、scope 和验证 command ID 均未变化的节点，更新 `sourceSha256` 后保持 current。
- `edges` 按 `from/type/to` 排序后落盘；读取时重新派生并要求深度相等。partial 图可以保存 standard L TASK→未来 RU 的 deferred edge，其他 edge 两端必须存在。
- `TraceSummary` 只统计 total/current/stale/tombstoned。未覆盖、孤立和悬空关系不持久化为含义模糊的 orphan 计数，而由 graph/slice 校验返回稳定错误与 details；orphan snapshot 属于 store/doctor 的独立概念。
- TypeScript 的 `validateTraceDelta`/`validateTraceGraph` 是运行时权威；`traceability.schema.json` 是协议文档和跨语言契约，不引入 Ajv 等运行时依赖。契约测试读取 JSON Schema，核对 node variants、禁用字段与手写校验器接受/拒绝的 fixture。

**步骤：**

- [ ] **步骤 1：写 delta 来源绑定和 tombstone 红灯测试。**

```js
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { loadSource } from "../helpers/load-source.mjs";

const trace = await loadSource("plugins/dev-flow/src/core/traceability.ts");
const digest = (value) => createHash("sha256").update(value).digest("hex");

function requirementsInput(
  nodes,
  current = trace.emptyTraceabilityLedger("f", 0, "a".repeat(64)),
) {
  return {
    current,
    route: "standard-m",
    artifactKind: "requirements",
    artifactSha256: "b".repeat(64),
    sourceBlocks: nodes.map((node) => ({
      id: node.id,
      kind: node.kind,
      sourceAnchor: `<!-- dev-flow:id=${node.id} kind=${node.kind} -->`,
      sourceBlockSha256: digest(JSON.stringify(node)),
    })),
    delta: { nodes },
    projectConfigSha256: "a".repeat(64),
    verificationCommandIds: ["unit"],
    nextStateRevision: current.stateRevision + 1,
  };
}

test("delta is a complete source replacement and caller cannot reuse tombstones", () => {
  const first = trace.applyTraceDelta(requirementsInput([
    { kind: "requirement", id: "REQ-001" },
    {
      kind: "acceptance-criterion",
      id: "AC-001",
      parentRequirement: "REQ-001",
    },
  ]));
  const second = trace.applyTraceDelta(requirementsInput(
    [{ kind: "requirement", id: "REQ-001" }],
    first,
  ));
  assert.equal(second.nodes["AC-001"].status, "tombstoned");
  assert.throws(
    () => trace.applyTraceDelta(requirementsInput([
      { kind: "requirement", id: "REQ-001" },
      {
        kind: "acceptance-criterion",
        id: "AC-001",
        parentRequirement: "REQ-001",
      },
    ], second)),
    /TRACE_GRAPH_INVALID/,
  );
});
```

- [ ] **步骤 2：写精确失效红灯测试。** 独立 `test()` 构造两个 REQ/AC、两个 TASK/TEST/RU；只改变 `REQ-001` 区块，断言关联 TASK/TEST/RU stale，而 `REQ-002` 的闭包保持 current。

- [ ] **步骤 3：写不变量、slice 与 Schema 契约红灯测试。** 把 tombstone、stale、graph invariants 和 slice 分成独立 `test()`；覆盖错误前缀、重复 ID、悬空 parent/covers/verifies、孤儿 TASK、TASK 缺 RU、RU task 不对称、RU DAG 环、未知 command ID、调用方 edges/source/status 字段和 project config digest 变化。另断言 standard L 的 TASK→RU deferred reference 在 partial 模式合法、在 complete 模式返回 `TRACE_GRAPH_INVALID`。Schema 契约测试核对五种 node variant、`additionalProperties: false` 和调用方禁用字段，不把 JSON Schema 当运行时第二校验器。

- [ ] **步骤 4：运行红灯。**

```bash
node --test tests/unit/traceability-graph.test.mjs \
  tests/unit/traceability-schema-contract.test.mjs
```

预期：FAIL，原因是 `core/traceability.ts` 不存在。

- [ ] **步骤 5：实现纯函数。** `applyTraceDelta` 不执行文件 I/O；先验证输入集合与锚点，再生成 candidate nodes、tombstone 和 stale 闭包，最后调用 `validateTraceGraph`、派生排序 edges 与 summary。任何异常都不修改传入 ledger。

- [ ] **步骤 6：实现阶段 slice。** 使用下表作为唯一映射：

| step | 要求 |
| --- | --- |
| `requirements`、`requirement_confirmation` | REQ/AC 声明 current，AC parent 唯一 |
| `implementation_plan` | REQ/AC/TASK current；standard M 的 RU current 且 DAG 合法；standard L 仅允许 TASK→未来 RU deferred |
| `coverage_review` | REQ/AC/TASK/TEST current；每个 current AC 至少一个 current TEST；standard L 仍只允许上述 deferred RU |
| `rollback_unit` | REQ/AC/TASK/TEST/RU current；M 校验 plan RU；L 校验 rollback-units RU；禁止 deferred |
| `plan_review`、`implementation_approval`、`implementation`、`feature_check`、`finalize` | 全图 complete/current |

RU 的 `verificationConfigSha256` 与当前 project config 不同，统一作为 `TRACE_SLICE_STALE`。

- [ ] **步骤 7：运行测试和类型检查。**

```bash
node --test tests/unit/traceability-graph.test.mjs
node --test tests/unit/traceability-schema-contract.test.mjs
npm run typecheck
npm run test:unit
```

预期：PASS。

- [ ] **步骤 8：提交任务 3。**

```bash
git add plugins/dev-flow/policy/traceability.schema.json \
  plugins/dev-flow/src/core/traceability.ts \
  tests/unit/traceability-graph.test.mjs \
  tests/unit/traceability-schema-contract.test.mjs
git add docs/superpowers/plans/2026-07-28-dev-flow-traceability-ledger.md
git commit -m "feat(dev-flow): validate traceability graph"
```

---

## 任务 4：实现内容寻址 snapshot、state pointer 和双向 reclassify

**文件：**

- 新建：`plugins/dev-flow/src/core/traceability-store.ts`
- 修改：`plugins/dev-flow/src/core/state-store.ts`
- 修改：`plugins/dev-flow/src/core/next.ts`
- 修改：`plugins/dev-flow/src/core/status.ts`
- 修改：`plugins/dev-flow/src/core/step-order.ts`
- 修改：`plugins/dev-flow/src/core/feature-check.ts`
- 修改：`plugins/dev-flow/src/core/human-gates.ts`
- 修改：`plugins/dev-flow/policy/state.schema.json`
- 修改：`tests/unit/state-store.test.mjs`
- 修改：`tests/unit/reclassify.test.mjs`
- 新建：`tests/unit/traceability-store.test.mjs`
- 新建：`tests/unit/state-schema-contract.test.mjs`
- 新建：`tests/unit/route-contract-consumers.test.mjs`

**接口：**

```ts
export type TraceStoreFaultPoint =
  | "before-temp-write"
  | "after-temp-fsync"
  | "after-snapshot-rename";

export interface TraceStoreOptions {
  fault?: (point: TraceStoreFaultPoint) => void | Promise<void>;
}

export interface PreparedMutationOptions {
  fault?: (
    point: "before-state-commit" | "after-state-commit",
  ) => void | Promise<void>;
}

export function canonicalTraceJson(ledger: TraceabilityLedger): string;

export async function writeTraceSnapshot(
  root: string,
  ledger: TraceabilityLedger,
  options?: TraceStoreOptions,
): Promise<TraceabilityPointer>;

export async function readTraceability(
  root: string,
  state: FeatureState,
): Promise<TraceabilityLedger>;

export async function listOrphanTraceSnapshots(
  root: string,
  state: FeatureState,
): Promise<string[]>;

export interface PreparedFeatureMutation {
  mutate: (draft: FeatureState) => void | Promise<void>;
  eventData?: unknown;
}

export async function mutatePrepared(
  root: string,
  featureId: string,
  expectedRevision: number,
  operation: string,
  prepare: (
    current: Readonly<FeatureState>,
    nextStateRevision: number,
  ) => Promise<PreparedFeatureMutation>,
  options?: PreparedMutationOptions,
): Promise<FeatureState>;

export async function readProjectConfigSnapshot(
  root: string,
): Promise<{ config: ProjectConfig; sha256: string }>;
```

`FeatureState` 增加：

```ts
workflowCapabilities?: WorkflowCapabilities;
traceability?: TraceabilityPointer;
```

字段对旧 state 可选；所有新 state 必须持久化 `workflowCapabilities`。`validateFeatureState` 的规则是：

- capability 缺失：legacy，允许无 pointer。
- `traceEnforcementRequired(...) === true`：pointer 必须存在且字段合法。
- 非标准路线：pointer 可缺失；存在时作为只读历史保留。

**统一提交与合同入口：**

- 继续复用唯一的项目级 `.dev-flow/.lock`；参数中的 feature ID 只是 owner 诊断信息，不引入 per-feature 锁。
- `mutate()` 是 `mutatePrepared()` 的无额外 prepared asset 薄封装，二者共享 revision/CAS、state commit 和投影错误处理。
- mutator 完成后先计算 status 投影字节及 hash，并把 hash 放入待提交 draft；snapshot 等不可变资产也在此阶段准备。
- `state.json` rename 是提交点；提交成功后才写 status 文件、event 和 active pointer。任一投影失败汇总为 `STATE_COMMITTED_PROJECTION_FAILED`，不得重试 state mutation 或声称回滚。
- 所有持有 `FeatureState` 的消费者统一调用 `routeDefinitionForFeature(state.route, state.workflowCapabilities)`。纯 route 分类/风险策略可以继续读取 base definition，不复制 artifact 模式转换。
- `applyRouteTransition` 分别用转换前后的 effective editable/generated 并集保留 artifact，防止 status 或未来 plan-review 投影登记被误删。
- `state.schema.json` 是协议文档；`validateFeatureState` 是运行时权威。契约测试核对 capability/pointer 关键字段，不新增运行时 Schema 依赖。

**snapshot 协议：**

1. 对对象 key 排序、数组按协议顺序排序后生成带结尾换行的规范 JSON。
2. SHA-256 同时作为文件名与 pointer.sha256。
3. 临时文件使用 `wx`、file fsync、rename、directory fsync。
4. 目标已存在时读取并验证内容相同，不覆盖。
5. snapshot 写完后才能把 pointer 放进待提交 state。
6. `readProjectConfigSnapshot` 对 `.dev-flow/project.json` 的原始 UTF-8 字节计算 SHA-256，并同时返回经过现有校验器规范化的 config；Trace、Review 和 Rollback 后续阶段复用这一接口。

**步骤：**

- [ ] **步骤 1：写 snapshot 红灯测试。**

```js
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import {
  createTinyApp,
  strictProjectConfig,
} from "../helpers/fixture-repo.mjs";
import { loadSource } from "../helpers/load-source.mjs";

const trace = await loadSource("plugins/dev-flow/src/core/traceability.ts");
const traceStore = await loadSource(
  "plugins/dev-flow/src/core/traceability-store.ts",
);
const stateStore = await loadSource("plugins/dev-flow/src/core/state-store.ts");
const fileSha256 = async (file) =>
  createHash("sha256").update(await readFile(file)).digest("hex");

test("snapshot is immutable and addressed by canonical content", async (t) => {
  const fixture = await createTinyApp();
  t.after(fixture.dispose);
  const { root } = fixture;
  const featureDir = path.join(root, ".dev-flow/features/f");
  await mkdir(featureDir, { recursive: true });
  const ledger = trace.emptyTraceabilityLedger("f", 0, "a".repeat(64));
  const first = await traceStore.writeTraceSnapshot(root, ledger);
  const second = await traceStore.writeTraceSnapshot(root, ledger);
  assert.deepEqual(second, first);
  assert.match(first.path, /^traceability\\/snapshots\\/[a-f0-9]{64}\\.json$/);
  assert.equal(
    await fileSha256(path.join(featureDir, first.path)),
    first.sha256,
  );
});
```

- [ ] **步骤 2：写提交点与非 Trace 金丝雀红灯测试。** 在三个 `TraceStoreFaultPoint` 和两个 prepared mutation fault point 逐一注入错误；`before-state-commit` 以前 state revision/pointer 不变，`after-snapshot-rename` 允许既有 feature 出现孤儿 snapshot；`after-state-commit` 必须返回 `STATE_COMMITTED_PROJECTION_FAILED`，且 details 精确包含 `{ committed: true, currentRevision }`，不得声称回滚。另用普通 `mutate()` 断言 revision、status hash、event 和 active pointer 与提交 state revision 一致，并注入 status/event/active 投影失败验证 state 已提交且错误列出精确 `failedProjections`。standard start 在 state 首次提交前失败时必须清理本次新建的 feature 目录和 snapshot，不能留下没有 state 的 feature。

- [ ] **步骤 3：写 start/reclassify 红灯测试。**

```js
test("standard starts with a pointer while light creates it lazily", async (t) => {
  const fixture = await createTinyApp();
  t.after(fixture.dispose);
  const { root } = fixture;
  await stateStore.initProject(root, strictProjectConfig);
  const standard = await stateStore.startFeature(root, {
    featureId: "standard",
    level: "M",
    topology: "local",
    execution: "standard",
    requirements: "provided-confirmed",
    activation: "paused",
    host: "codex",
  });
  assert.equal(standard.workflowCapabilities.trace, 1);
  assert.ok(standard.traceability);

  let light = await stateStore.startFeature(root, {
    featureId: "light",
    level: "M",
    topology: "local",
    execution: "light",
    host: "codex",
  });
  assert.equal(light.workflowCapabilities.trace, 1);
  assert.equal(light.traceability, undefined);
  light = await stateStore.reclassifyFeature(
    root,
    "light",
    light.revision,
    {
      level: "M",
      topology: "local",
      execution: "standard",
      requirements: "provided-confirmed",
    },
    "risk increased",
  );
  assert.ok(light.traceability);
});
```

另写 standard→light 保留相同 pointer、停止强制；legacy 无 capability state 进入任何现有路径都不被升级门禁锁死。测试必须直接断言 `reclassifyFeature` 后 legacy state 仍没有 `workflowCapabilities`，而不是只断言 Trace 门禁恰好未触发。

- [ ] **步骤 4：写 state Schema 与调用点收口红灯测试。** `state-schema-contract` 核对 JSON Schema 的 capability/pointer 字段与 `validateFeatureState` fixture；`route-contract-consumers` 静态检查 artifacts、state-store、next、status、step-order、feature-check、human-gates，禁止 stateful 分支重新调用裸 `routeDefinition(state.route)`。

- [ ] **步骤 5：运行红灯。**

```bash
node --test tests/unit/traceability-store.test.mjs \
  tests/unit/state-store.test.mjs \
  tests/unit/reclassify.test.mjs \
  tests/unit/state-schema-contract.test.mjs \
  tests/unit/route-contract-consumers.test.mjs
```

预期：FAIL，原因是 snapshot store 和 state 字段尚不存在。

- [ ] **步骤 6：实现 snapshot store。** `readTraceability` 校验安全相对路径、文件 hash、schemaVersion、featureId、`pointer.revision === ledger.revision`、`ledger.stateRevision <= state.revision`、pointer/ledger summary 与派生 edges；写入时 `ledger.stateRevision` 必须等于即将提交的 state revision。任一不一致抛 `TRACEABILITY_INTEGRITY_FAILED`。

- [ ] **步骤 7：重构统一 CAS 提交。** 在 `state-store.ts` 增加仅供 Core 使用的 locked prepared mutation helper；现有 `mutate` 调用它。status 内容/hash 在提交前确定但文件在提交后写入，snapshot 在项目级锁内准备，`state.json` 最后提交。提交前失败保持旧 state；提交后 status/event/active 问题统一抛 `STATE_COMMITTED_PROJECTION_FAILED`，details 为 `{ committed: true, currentRevision, failedProjections }`。

- [ ] **步骤 8：实现 start/reclassify 与有效合同收口。** 只有 `startFeature` 为新 feature 固定 capability；`reclassifyFeature` 不给 legacy state 补 stamp。standard 启动和 trace:1 light→standard 先准备空 snapshot，再提交 route/pointer；legacy trace:0 升到 standard 仍不创建 pointer。standard 首次 state 提交前失败时，只清理本次调用新建的 feature 目录；不得删除调用前已存在的路径。standard→light 不删 snapshot/pointer。同步迁移所有 stateful contract 消费方，并让 `applyRouteTransition` 使用前后 effective artifact 并集。

- [ ] **步骤 9：运行测试。**

```bash
node --test tests/unit/traceability-store.test.mjs \
  tests/unit/state-store.test.mjs \
  tests/unit/reclassify.test.mjs \
  tests/unit/state-recovery.test.mjs \
  tests/unit/state-schema-contract.test.mjs \
  tests/unit/route-contract-consumers.test.mjs
npm run typecheck
npm run test:unit
npm run test:routes
npm run test:interop
```

预期：PASS；capability 开始落盘时，所有 stateful route 消费方已经切到有效合同，普通 mutation 与全部现有 source-based 路线没有已知回归。

- [ ] **步骤 10：提交任务 4。**

```bash
git add plugins/dev-flow/src/core/traceability-store.ts \
  plugins/dev-flow/src/core/state-store.ts \
  plugins/dev-flow/src/core/next.ts \
  plugins/dev-flow/src/core/status.ts \
  plugins/dev-flow/src/core/step-order.ts \
  plugins/dev-flow/src/core/feature-check.ts \
  plugins/dev-flow/src/core/human-gates.ts \
  plugins/dev-flow/policy/state.schema.json \
  tests/unit/state-store.test.mjs \
  tests/unit/reclassify.test.mjs \
  tests/unit/traceability-store.test.mjs \
  tests/unit/state-schema-contract.test.mjs \
  tests/unit/route-contract-consumers.test.mjs
git add docs/superpowers/plans/2026-07-28-dev-flow-traceability-ledger.md
git commit -m "feat(dev-flow): persist trace snapshots"
```

---

## 任务 5：实现 artifact + Trace 原子登记和精确下游失效

**文件：**

- 修改：`plugins/dev-flow/src/core/artifacts.ts`
- 修改：`plugins/dev-flow/src/core/gate-basis.ts`
- 修改：`plugins/dev-flow/src/core/state-store.ts`
- 新建：`tests/helpers/trace-fixtures.mjs`
- 修改：`tests/helpers/route-flow.mjs`
- 修改：`tests/unit/artifacts.test.mjs`
- 修改：`tests/unit/requirements-grill.test.mjs`
- 修改：`tests/unit/human-gates.test.mjs`
- 修改：`tests/unit/status-progress.test.mjs`
- 修改：`tests/unit/mcp-server.test.mjs`
- 新建：`tests/unit/traceability-artifacts.test.mjs`

**接口：**

```ts
export async function recordArtifactWithTrace(
  root: string,
  featureId: string,
  expectedRevision: number,
  artifactKind: TraceArtifactKind,
  traceDelta: TraceDelta,
): Promise<FeatureState>;
```

测试只共享结构化 delta fixture，不允许共享内部 state 注入：

```js
export function traceDeltaFor(kind, route) {
  if (kind === "requirements") {
    return {
      nodes: [
        { kind: "requirement", id: "REQ-001" },
        {
          kind: "acceptance-criterion",
          id: "AC-001",
          parentRequirement: "REQ-001",
        },
      ],
    };
  }
  if (kind === "implementation-plan" && route === "standard-m") {
    return {
      nodes: [
        {
          kind: "task",
          id: "TASK-001",
          covers: ["REQ-001", "AC-001"],
          rollbackUnit: "RU-001",
        },
        {
          kind: "rollback",
          id: "RU-001",
          tasks: ["TASK-001"],
          dependsOn: [],
          fileScope: ["src"],
          covers: ["REQ-001", "AC-001"],
          forwardVerification: ["unit"],
          rollbackVerification: ["unit"],
        },
      ],
    };
  }
  if (kind === "implementation-plan" && route === "standard-l") {
    return {
      nodes: [{
        kind: "task",
        id: "TASK-001",
        covers: ["REQ-001", "AC-001"],
        rollbackUnit: "RU-001",
      }],
    };
  }
  if (kind === "coverage-matrix") {
    return {
      nodes: [{ kind: "test", id: "TEST-001", verifies: ["AC-001"] }],
    };
  }
  if (kind === "rollback-units" && route === "standard-l") {
    return {
      nodes: [{
        kind: "rollback",
        id: "RU-001",
        tasks: ["TASK-001"],
        dependsOn: [],
        fileScope: ["src"],
        covers: ["REQ-001", "AC-001"],
        forwardVerification: ["unit"],
        rollbackVerification: ["unit"],
      }],
    };
  }
  throw new Error(`no trace fixture for ${route}:${kind}`);
}
```

fixture 只能编辑 runtime scaffold 的现有文本，不能手写第二套 Markdown 模板：

```js
import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { loadSource } from "./load-source.mjs";

const artifacts = await loadSource("plugins/dev-flow/src/core/artifacts.ts");
const anchors = await loadSource(
  "plugins/dev-flow/src/core/traceability-anchors.ts",
);

export async function registerTraceFixture({
  root,
  featureId,
  state,
  kind,
  edit = (markdown) => markdown,
}) {
  let current = state;
  if (!current.artifacts[kind]) {
    current = await artifacts.scaffoldArtifact(
      root,
      featureId,
      current.revision,
      kind,
    );
  }
  const target = path.join(
    root,
    ".dev-flow/features",
    featureId,
    current.artifacts[kind].path,
  );
  const before = await readFile(target, "utf8");
  const after = edit(before);
  if (after !== before) await writeFile(target, after);
  const delta = traceDeltaFor(kind, current.route);
  assert.deepEqual(
    anchors.parseTraceSourceBlocks(after).map(({ id }) => id).sort(),
    delta.nodes.map(({ id }) => id).sort(),
  );
  return artifacts.recordArtifactWithTrace(
    root,
    featureId,
    current.revision,
    kind,
    delta,
  );
}
```

**登记顺序：**

```text
现有项目级 .dev-flow/.lock
→ revision/lifecycle/effective route 校验
→ 读取已 scaffold artifact 和旧 snapshot
→ 计算 artifact/project config hash
→ parseTraceSourceBlocks
→ applyTraceDelta
→ writeTraceSnapshot
→ 同一 state commit 写 artifact hash + pointer + gate/step 失效
```

人工编辑的 artifact 文件本身不是事务输出：登记失败时文件可以保持“已编辑但未登记”，但 state 中旧 artifact hash、旧 pointer 和旧 revision 必须保持不变。

**强制规则：**

- effective route 的 generated artifact 调用 `recordArtifact` 或 `recordArtifactWithTrace` 都返回 `GENERATED_ARTIFACT_READ_ONLY`。
- `traceEnforcementRequired(...)` 为真的 requirements、implementation-plan、coverage-matrix、rollback-units 调用裸 `recordArtifact` 返回 `TRACE_AWARE_REGISTRATION_REQUIRED`。
- standard M 的 `rollback_unit` 不创建 artifact；其 RU 已随 implementation-plan 登记。
- state 的 `gateBasis(implementation_approval)` 必须包含 `traceability` pointer。
- requirements 变化使 requirement confirmation、相关下游 steps 和 implementation approval 失效；plan/coverage/rollback 变化不反向撤销 requirement confirmation。
- trace delta 变化但 artifact hash 不变仍必须依据新 pointer 撤销受影响的下游证据。

**步骤：**

- [ ] **步骤 1：写裸登记与生成产物红灯测试。**

```js
await assert.rejects(
  () => artifacts.recordArtifact(root, "f", state.revision, "requirements"),
  /TRACE_AWARE_REGISTRATION_REQUIRED/,
);
await assert.rejects(
  () => artifacts.recordArtifact(root, "f", state.revision, "status"),
  /GENERATED_ARTIFACT_READ_ONLY/,
);
```

- [ ] **步骤 2：写原子登记红灯测试。** 覆盖成功登记、旧 expectedRevision、锚点不匹配、未知 command ID、snapshot 写失败和 state commit 失败；失败后重新读取 state，断言 revision、artifact registration、pointer 和 gate basis 未变化。

- [ ] **步骤 3：写精确失效红灯测试。** 两组独立 REQ→TASK→TEST/RU 已批准后，只改变第一组区块；断言第一组 stale、coverage/plan-review/approval 失效，第二组节点保持 current，requirement gate 仅在 requirements 变化时失效。

- [ ] **步骤 4：交付真实 artifact fixture 并迁移裸登记调用点。** `trace-fixtures.mjs` 只读取/编辑 Task 2 runtime scaffold，校验锚点 ID 与 delta 完全一致，再调用 with-trace；不得从零生成 Markdown 或注入 ledger/state。`route-flow` 从本任务开始使用该 helper。`artifacts.test.mjs` 保留一条“裸登记必须拒绝”的断言；requirements-grill、human-gates、status-progress 和 mcp-server 中的新 standard feature 都改用真实 with-trace。grill 测试必须证明只改 front matter 时 REQ/AC block hash 保持不变、gate basis 按 artifact hash 失效，但 Trace 节点不误 stale。

- [ ] **步骤 5：运行红灯。**

```bash
node --test tests/unit/traceability-artifacts.test.mjs
```

预期：FAIL，原因是 `recordArtifactWithTrace` 不存在。

- [ ] **步骤 6：实现原子登记。** 所有 I/O 和 delta 计算在现有项目级 `.dev-flow/.lock` 内完成；调用任务 3/4 的纯函数和 snapshot store，不在 `artifacts.ts` 复制图规则或文件原子写入代码。

- [ ] **步骤 7：实现统一失效表。** artifact kind 到 gate/step 的映射只保留一份；删除受影响的 step、gate interaction、featureCheck、logicComplete/finalize，并把失效原因保存到 event data。

- [ ] **步骤 8：运行回归。**

```bash
node --test tests/unit/traceability-artifacts.test.mjs \
  tests/unit/artifacts.test.mjs \
  tests/unit/requirements-grill.test.mjs \
  tests/unit/human-gates.test.mjs \
  tests/unit/status-progress.test.mjs \
  tests/unit/mcp-server.test.mjs
npm run typecheck
npm run test:unit
npm run test:routes
```

预期：PASS；启用裸登记拒绝后，仓库中已执行的 standard source 测试不再依赖旧登记路径。

- [ ] **步骤 9：提交任务 5。**

```bash
git add plugins/dev-flow/src/core/artifacts.ts \
  plugins/dev-flow/src/core/gate-basis.ts \
  plugins/dev-flow/src/core/state-store.ts \
  tests/helpers/trace-fixtures.mjs \
  tests/helpers/route-flow.mjs \
  tests/unit/artifacts.test.mjs \
  tests/unit/requirements-grill.test.mjs \
  tests/unit/human-gates.test.mjs \
  tests/unit/status-progress.test.mjs \
  tests/unit/mcp-server.test.mjs \
  tests/unit/traceability-artifacts.test.mjs
git add docs/superpowers/plans/2026-07-28-dev-flow-traceability-ledger.md
git commit -m "feat(dev-flow): register artifacts with trace"
```

---

## 任务 6：让 Core 阶段入口、status、next 和 doctor 默认拒绝

**文件：**

- 修改：`plugins/dev-flow/src/core/human-gates.ts`
- 修改：`plugins/dev-flow/src/core/feature-check.ts`
- 修改：`plugins/dev-flow/src/core/next.ts`
- 修改：`plugins/dev-flow/src/core/status.ts`
- 修改：`plugins/dev-flow/src/core/step-order.ts`
- 修改：`plugins/dev-flow/src/core/state-store.ts`
- 修改：`plugins/dev-flow/src/mcp/doctor.ts`
- 新建：`tests/unit/traceability-gates.test.mjs`
- 修改：`tests/unit/next-evidence.test.mjs`
- 修改：`tests/unit/risk-evidence.test.mjs`
- 修改：`tests/unit/status-progress.test.mjs`
- 修改：`tests/unit/doctor.test.mjs`
- 修改：`tests/e2e/cross-host/claude-to-codex.test.mjs`

**Core 行为：**

- `recordStep(step)` 在 mutator 内读取 current snapshot，并调用 `assertTraceSliceCurrent`。
- `presentGate(requirement_confirmation)` 校验 requirements slice。
- `presentGate(implementation_approval)` 和确认 gate 时都校验全图与 pointer basis。
- `featureCheck`、`finalize` 在最终 state commit 前再次校验全图。
- 本阶段的 `recordStep(implementation)` 只校验全图，不读取 `ImplementationUnitState`，不要求 checkpoint。
- `nextAction` 对需要修复的 current trace step 返回唯一 `repair-trace` 动作；legacy/light route 保持既有动作。
- `StatusView` 增加 `trace`：

```ts
trace?: {
  enforced: boolean;
  pointer?: TraceabilityPointer;
  effectiveSummary?: TraceSummary;
  blockers: Array<{
    code: "TRACE_SLICE_INCOMPLETE" | "TRACE_SLICE_STALE";
    step: string;
    details: Record<string, unknown>;
  }>;
};
```

- status Markdown 投影显示相同 summary/blocker，不复制图。
- doctor 区分：
  - legacy/no-trace feature；
  - 不要求 pointer 的 light feature；
  - 完整 standard feature；
  - 缺失/损坏 pointer 的 standard feature；
  - 不被 pointer 引用的 orphan snapshots。

**步骤：**

- [ ] **步骤 1：写 Core 旁路红灯测试。** 直接调用 `recordStep`、`presentGate`、`featureCheck`、`finalize`，分别断言缺失、stale、损坏 Trace 无法绕过；同时断言 legacy feature 和 Trace-only implementation 不要求 checkpoint。

- [ ] **步骤 2：写 next/status 红灯测试。**

```js
const action = await next.nextAction(root, "f");
assert.equal(action.kind, "repair-trace");
assert.equal(action.step, "coverage_review");
assert.equal(action.code, "TRACE_SLICE_INCOMPLETE");

const view = await status.readStatusView(root, "f");
assert.deepEqual(view.progress.nextAction, action);
assert.equal(view.trace.blockers[0].code, action.code);
```

- [ ] **步骤 3：写 doctor 红灯测试。** 删除当前 snapshot、篡改 snapshot、复制一个未引用 snapshot；前两种是 error/fail closed，后一种是 warning 且不改变 state。

- [ ] **步骤 4：迁移既有 standard 流程测试。** `status-progress`、`risk-evidence`、`next-evidence` 和 Claude→Codex source-based 跨宿主流程必须使用 Task 5 helper、真实 artifact 内容和 `recordArtifactWithTrace` 建立当前 Trace，再测试阶段门禁、风险 evidence、next/status 一致性和跨宿主确认。route-flow 已在 Task 5 接入 helper，本任务用全路线回归证明门禁开启后仍可闭环。只有明确标注“legacy compatibility”的用例可以删除 `workflowCapabilities` 模拟旧 feature；不得给普通新 feature 直接写 steps 或 ledger 来绕过 Trace。

- [ ] **步骤 5：运行红灯。**

```bash
node --test tests/unit/traceability-gates.test.mjs \
  tests/unit/next-evidence.test.mjs \
  tests/unit/risk-evidence.test.mjs \
  tests/unit/status-progress.test.mjs \
  tests/unit/doctor.test.mjs
```

预期：FAIL，原因是阶段入口和 StatusView 尚未接入 Trace。

- [ ] **步骤 6：实现统一读取入口。** 所有 Core 门禁调用同一个 `readTraceability`/slice API；禁止在 human-gates、feature-check、next、status 中分别实现图判断。

- [ ] **步骤 7：实现 repair-trace 和投影。** `nextAction` 只有在 artifact 已 scaffold、但本步骤 Trace slice 不满足时返回 repair-trace；缺 artifact 时继续返回 scaffold-artifact。status JSON 和 status Markdown 使用同一计算结果。

- [ ] **步骤 8：实现 doctor。** orphan snapshot 只产生 warning；当前 pointer 错误产生 error 和明确恢复提示，不自动选择或修改 snapshot。

- [ ] **步骤 9：运行回归。**

```bash
node --test tests/unit/traceability-gates.test.mjs \
  tests/unit/next-evidence.test.mjs \
  tests/unit/risk-evidence.test.mjs \
  tests/unit/status-progress.test.mjs \
  tests/unit/doctor.test.mjs \
  tests/unit/feature-check.test.mjs \
  tests/unit/strict-orchestration.test.mjs
npm run typecheck
npm run test:unit
npm run test:routes
npm run test:interop
```

预期：PASS。

- [ ] **步骤 10：提交任务 6。**

```bash
git add plugins/dev-flow/src/core/human-gates.ts \
  plugins/dev-flow/src/core/feature-check.ts \
  plugins/dev-flow/src/core/next.ts \
  plugins/dev-flow/src/core/status.ts \
  plugins/dev-flow/src/core/step-order.ts \
  plugins/dev-flow/src/core/state-store.ts \
  plugins/dev-flow/src/mcp/doctor.ts \
  tests/unit/traceability-gates.test.mjs \
  tests/unit/next-evidence.test.mjs \
  tests/unit/risk-evidence.test.mjs \
  tests/unit/status-progress.test.mjs \
  tests/unit/doctor.test.mjs \
  tests/e2e/cross-host/claude-to-codex.test.mjs
git add docs/superpowers/plans/2026-07-28-dev-flow-traceability-ledger.md
git commit -m "feat(dev-flow): enforce trace phase gates"
```

---

## 任务 7：暴露 Trace MCP 工具并让 Skills 只负责编排

**文件：**

- 修改：`plugins/dev-flow/src/mcp/server.ts`
- 修改：`plugins/dev-flow/src/mcp/tools/artifacts.ts`
- 修改：`plugins/dev-flow/src/mcp/tools/inspect.ts`
- 修改：`plugins/dev-flow/skills/requirements/SKILL.md`
- 修改：`plugins/dev-flow/skills/plan/SKILL.md`
- 修改：`plugins/dev-flow/skills/coverage-review/SKILL.md`
- 修改：`plugins/dev-flow/skills/rollback-safety/SKILL.md`
- 修改：`plugins/dev-flow/skills/status/SKILL.md`
- 新建：`tests/helpers/test-bundle.mjs`
- 修改：`tests/unit/mcp-server.test.mjs`
- 修改：`tests/unit/skills.test.mjs`

**MCP 工具：**

```text
dev_flow_record_artifact_with_trace
dev_flow_get_traceability
```

`dev_flow_record_artifact_with_trace` 输入：

```json
{
  "featureId": "feature-id",
  "expectedRevision": 3,
  "kind": "implementation-plan",
  "traceDelta": {
    "nodes": [
      {
        "kind": "task",
        "id": "TASK-001",
        "covers": ["REQ-001", "AC-001"],
        "rollbackUnit": "RU-001"
      }
    ]
  }
}
```

Schema 必须 `additionalProperties: false`；`kind` 只允许四种 `TraceArtifactKind`；每个 node variant 使用 `oneOf` 和 variant-specific required fields。Schema 不接受 `edges`、`status`、`sourceSha256`、`sourceAnchor`、`sourceBlockSha256`、`verificationConfigSha256`。

`dev_flow_get_traceability` 只接受 `featureId`，标记 `readOnlyHint: true`，返回 pointer、ledger、effective summary 和当前 project config 下的 blockers；不得写 revision。

MCP 测试不得启动受版本控制的旧 dist。测试 helper 复用现有 `scripts/build.mjs` 的 `DEV_FLOW_DIST_DIR`：

```js
import { execFile } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const run = promisify(execFile);

export async function buildTestBundles() {
  const directory = await mkdtemp(path.join(os.tmpdir(), "dev-flow-dist-"));
  await run(process.execPath, ["scripts/build.mjs"], {
    cwd: path.resolve("."),
    env: { ...process.env, DEV_FLOW_DIST_DIR: directory },
  });
  return {
    pathFor: (name) => path.join(directory, `${name}.mjs`),
    dispose: () => rm(directory, { recursive: true, force: true }),
  };
}
```

`mcp-server.test.mjs` 在文件级构建一次、通过 `after(bundle.dispose)` 清理，并把所有 spawn 路径改为 `bundle.pathFor("mcp-server")`。不得运行会覆盖正式 `plugins/dev-flow/dist` 的 build。

**Skill 流程：**

```text
dev_flow_next
→ scaffold-artifact
→ Read 已登记 artifact
→ 编辑
→ dev_flow_record_artifact_with_trace
→ dev_flow_record_step
→ dev_flow_next
```

- requirements Skill 提交 REQ/AC。
- plan Skill：standard M 提交 TASK/RU，standard L 只提交 TASK。
- coverage-review Skill 提交 TEST→AC。
- rollback-safety Skill：standard L 提交 rollback-units RU；standard M 的 rollback_unit 只调用 recordStep 校验已有 RU 和风险 evidence。
- plan-review Skill 本阶段不调用 review batch，继续旧 `{ reviewType: "plan" }`。
- 所有 Skill 禁止直接编辑 snapshot、state pointer 或复制路线/风险映射。

**步骤：**

- [ ] **步骤 1：写临时 bundle helper 和 MCP interface 红灯测试。** 测试从源码构建临时 mcp-server，断言两个工具被发现、输入严格、get 为只读、非法 source/edge 字段在协议层拒绝、业务错误保留稳定 code；同时断言受版本控制的 dist 没有发生变化。

- [ ] **步骤 2：写 MCP CAS 红灯测试。** 用同一 expectedRevision 连续提交两个 delta，断言第二个返回 `STATE_REVISION_CONFLICT`，胜出的 pointer 可由 get 读取。

- [ ] **步骤 3：写 Skills 红灯测试。** 断言五个 Skill 包含 with-trace 流程、不再要求 Trace artifact 裸 `record_artifact`，并明确 standard M/L RU 来源差异。

- [ ] **步骤 4：运行红灯。**

```bash
node --test tests/unit/mcp-server.test.mjs tests/unit/skills.test.mjs
```

预期：FAIL，原因是工具未注册且 Skill 仍使用裸登记。

- [ ] **步骤 5：实现 MCP Schema 和 dispatch。** server 只做协议解析和错误映射，业务逻辑调用任务 5/6 的 Core API；同步更新 tools barrel export。

- [ ] **步骤 6：更新 Skills。** 所有路线/风险决定来自 `dev_flow_next`、StatusView 和 Core 错误，不在 Markdown 中复制 `traceEnforcementRequired` 或 risk label 映射。

- [ ] **步骤 7：运行回归。**

```bash
node --test tests/unit/mcp-server.test.mjs tests/unit/skills.test.mjs
npm run typecheck
npm run test:unit
git diff --exit-code -- plugins/dev-flow/dist
```

预期：PASS；协议测试运行源码临时 bundle，正式 dist 无 diff。

- [ ] **步骤 8：提交任务 7。**

```bash
git add plugins/dev-flow/src/mcp/server.ts \
  plugins/dev-flow/src/mcp/tools/artifacts.ts \
  plugins/dev-flow/src/mcp/tools/inspect.ts \
  plugins/dev-flow/skills/requirements/SKILL.md \
  plugins/dev-flow/skills/plan/SKILL.md \
  plugins/dev-flow/skills/coverage-review/SKILL.md \
  plugins/dev-flow/skills/rollback-safety/SKILL.md \
  plugins/dev-flow/skills/status/SKILL.md \
  tests/helpers/test-bundle.mjs \
  tests/unit/mcp-server.test.mjs \
  tests/unit/skills.test.mjs
git add docs/superpowers/plans/2026-07-28-dev-flow-traceability-ledger.md
git commit -m "feat(dev-flow): expose traceability through mcp"
```

---

## 任务 8：保护控制文件并完成路线、双宿主、文档和构建验收

**文件：**

- 修改：`plugins/dev-flow/src/hosts/adapter-policy.ts`
- 修改：`tests/unit/adapter-policy.test.mjs`
- 修改：`tests/helpers/route-flow.mjs`
- 修改：`tests/e2e/routes/standard-m.test.mjs`
- 修改：`tests/e2e/routes/standard-l.test.mjs`
- 修改：`tests/e2e/routes/reclassify-standard-to-light.test.mjs`
- 修改：`tests/e2e/cross-host/claude-to-codex.test.mjs`
- 修改：`tests/e2e/cross-host/codex-to-claude.test.mjs`
- 修改：`tests/e2e/strict-human-gate.test.mjs`
- 新建：`tests/e2e/traceability-cross-host.test.mjs`
- 修改：`docs/architecture.md`
- 修改：`docs/routes.md`
- 修改：`README.md`
- 修改：`plugins/dev-flow/README.md`
- 修改：`plugins/dev-flow/dist/mcp-server.mjs`
- 修改：`plugins/dev-flow/dist/claude-hook.mjs`
- 修改：`plugins/dev-flow/dist/codex-hook.mjs`

**Hook 规则：**

- `.dev-flow/features/*/traceability/**` 始终属于 MCP 控制文件。
- Direct Write/Edit/Patch 和可解析 Bash 写入都返回 `DEV_FLOW_STATE_MUTATION_FORBIDDEN`。
- snapshot 当前 pointer 损坏时，Hook 对 `.dev-flow` 与 protected roots 继续 fail closed。
- Hook 不推进 Trace、不创建 snapshot、不解释 delta。

**E2E 矩阵：**

```text
standard M:
requirements(REQ/AC)
→ requirement gate
→ plan(TASK/RU)
→ coverage(TEST)
→ rollback_unit 校验
→ legacy plan_review
→ approval
→ implementation（无 ImplementationUnitState）
→ verification/feature-check/finalize

standard L:
requirements(REQ/AC)
→ requirement gate
→ plan(TASK)
→ coverage(TEST)
→ rollback-units(RU)
→ legacy plan_review artifact/evidence
→ approval
→ implementation（无 ImplementationUnitState）
→ verification/feature-check/finalize
```

双宿主必须覆盖：

- Claude 写 requirements，Codex 用返回 revision 写 plan/coverage 并完成路线。
- Codex 写 requirements，Claude 写 plan/coverage/rollback 并完成路线。
- 两端使用相同 expectedRevision 并发提交时只有一个成功；失败方重新读取 pointer 后可以继续。
- 一端创建的 snapshot/pointer 可由另一端验证，不依赖宿主路径或上下文。

**步骤：**

- [ ] **步骤 1：写 Hook 红灯测试。**

```js
const target = ".dev-flow/features/feature/traceability/snapshots/"
  + `${"a".repeat(64)}.json`;
assert.match(
  await adapter.preToolBlockReason(root, {
    tool_name: "write",
    tool_input: { file_path: target },
  }),
  /^DEV_FLOW_STATE_MUTATION_FORBIDDEN:/,
);
```

- [ ] **步骤 2：写路线、reclassify 与双宿主红灯测试。** standard M/L 各自声明完整成功路径，以及缺 AC coverage、缺 RU、stale source、裸登记四类失败；另声明 standard→light pointer 保留、light→standard pointer 懒创建、legacy trace:0、双向跨宿主和同 revision CAS。

- [ ] **步骤 3：运行红灯。**

```bash
node --test tests/unit/adapter-policy.test.mjs \
  tests/e2e/routes/standard-m.test.mjs \
  tests/e2e/routes/standard-l.test.mjs \
  tests/e2e/routes/reclassify-standard-to-light.test.mjs \
  tests/e2e/strict-human-gate.test.mjs \
  tests/e2e/traceability-cross-host.test.mjs
```

预期：FAIL，至少包含 Trace snapshot 未被 Hook 识别、正式 dist 尚未包含新 MCP 工具，或新增失败矩阵尚未满足；基础 route helper 已在任务 5 接入 with-trace，不应在本任务第一次发明登记方式。

- [ ] **步骤 4：实现 Hook 并扩展最终路线矩阵。** `adapter-policy.ts` 把整个 traceability 子树作为控制路径；route helper 继续复用任务 5 的 scaffold+with-trace helper，只补缺 AC coverage、缺 RU、stale source、裸登记与并发 CAS 场景，禁止直接修改 state 或注入 ledger。用任务 1–7 已交付的 API 让 standard/reclassify/双宿主测试通过。

  `strict-human-gate` 的 standard M 路径也必须在 `record_step(requirements)` 前通过 MCP 登记真实 REQ/AC Trace；测试仍只验证跨 turn 人工确认语义，不能因为 Trace 门禁而改成 legacy/light 路线。

- [ ] **步骤 5：更新中文文档。** 明确：

```text
Markdown 是叙述层
Trace snapshot 是 Core 事实层
state pointer 是提交点
阶段 1 不提供 review batch 或可执行 rollback
generated status 由 Core scaffold/refresh，禁止人工 record
standard L 没有 status 文件，以 StatusView 为准
```

- [ ] **步骤 6：构建受版本控制的 bundles。**

```bash
npm run build
npm run build:check
```

预期：PASS，且三个 `plugins/dev-flow/dist/*.mjs` 与源码一致。

- [ ] **步骤 7：运行针对性验收。**

```bash
node --test tests/unit/adapter-policy.test.mjs \
  tests/e2e/routes/standard-m.test.mjs \
  tests/e2e/routes/standard-l.test.mjs \
  tests/e2e/routes/reclassify-standard-to-light.test.mjs \
  tests/e2e/traceability-cross-host.test.mjs \
  tests/e2e/strict-human-gate.test.mjs \
  tests/e2e/cross-host/claude-to-codex.test.mjs \
  tests/e2e/cross-host/codex-to-claude.test.mjs
```

预期：PASS。

- [ ] **步骤 8：运行全量验收。**

```bash
npm test
git diff --check
```

预期：所有单元与 E2E 测试通过；仅既有环境条件测试允许以明确原因 skip；`git diff --check` 无输出。

- [ ] **步骤 9：检查最终范围。**

```bash
git status --short
git diff --stat
```

预期：只包含本计划列出的 Trace、测试、文档和 dist 文件；不存在临时 snapshot、fixture 仓库或未登记生成文件。

- [ ] **步骤 10：提交任务 8。**

```bash
git add plugins/dev-flow/src/hosts/adapter-policy.ts \
  tests/unit/adapter-policy.test.mjs \
  tests/helpers/route-flow.mjs \
  tests/e2e/routes/standard-m.test.mjs \
  tests/e2e/routes/standard-l.test.mjs \
  tests/e2e/routes/reclassify-standard-to-light.test.mjs \
  tests/e2e/cross-host/claude-to-codex.test.mjs \
  tests/e2e/cross-host/codex-to-claude.test.mjs \
  tests/e2e/strict-human-gate.test.mjs \
  tests/e2e/traceability-cross-host.test.mjs \
  docs/architecture.md \
  docs/routes.md \
  README.md \
  plugins/dev-flow/README.md \
  plugins/dev-flow/dist/mcp-server.mjs \
  plugins/dev-flow/dist/claude-hook.mjs \
  plugins/dev-flow/dist/codex-hook.mjs
git add docs/superpowers/plans/2026-07-28-dev-flow-traceability-ledger.md
git commit -m "feat(dev-flow): complete traceability ledger"
```

## 完成条件

- 路线合同明确区分 editable/generated artifact，现有 status 由 Core 生成。
- 所有 stateful 合同消费者使用 effective route；standard L 不生成 status 文件。
- requirements/plan/coverage/rollback scaffold 只有 TypeScript renderer 一个事实源。
- Trace input 与 persisted node 分离，调用方不能伪造来源、状态、配置 basis 或 edges。
- 同一 artifact 使用完整替换语义；删除生成 tombstone，区块哈希支持精确 stale 传播。
- snapshot 内容寻址且不可变，state pointer 是提交点，提交前失败不改变 revision/pointer。
- standard M/L 生成同构 RU；Trace 与后续 Rollback 阶段不再存在字段裂缝。
- standard→light、light→standard、legacy trace:0 和 capability 固定均有测试。
- 裸登记、阶段旁路和直接写 snapshot 均由 Core/Hook 拒绝。
- 本阶段不迁移 plan-review，不要求 checkpoint；没有 review batch/ImplementationUnitState 时 standard M/L 仍可完整闭环。
- 双宿主共享 snapshot/revision/CAS，不能覆盖对方更新。
- doctor 对当前 pointer 损坏 fail closed，对孤儿 snapshot 只报警。
- TypeScript 手写校验器是运行时权威，JSON Schema 有契约漂移测试且不引入新运行时依赖。
- 每个任务提交时不存在已知 source-based 回归；MCP 源码测试使用临时 bundle，正式 dist 只在任务 8 更新。
- 中文 README、架构、路线、Skills、MCP Schema 和实际合同一致。
- `npm test`、`npm run build:check`、`git diff --check` 全部通过。
