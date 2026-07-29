# Dev Flow 追溯账本实施计划

> **执行要求：** 按任务顺序实施；每个任务先写失败测试，再做最小实现，并在任务末执行指定验证。

**目标：** 建立 `REQ/AC → TASK → TEST/RU` 的机器可审计追溯链，让路线合同、核心层、MCP、宿主钩子和技能共享同一套默认拒绝规则。

**架构：** Markdown 继续作为人类叙述层，`traceability.json` 作为核心层管理的机器事实源。人工产物与追溯增量通过一个 CAS 事务原子登记；生成产物由核心层投影，不能手工登记。

**技术栈：** TypeScript、Node.js 内置测试运行器、JSON Schema、现有 MCP server 与宿主适配器。

## 全局约束

- 现有 active feature 按旧合同完成；只对新 standard M/L feature 启用 `workflowCapabilities.trace: 1` 和 schema v1 追溯账本。
- 新 standard M/L 在启动时固定 `workflowCapabilities: { trace: 1, review: 0, checkpoints: 0, rollbackExecution: 0 }`；后续插件升级不改变该 feature 的合同。
- 不在 `FeatureState` 内嵌完整账本，只保存路径、SHA-256、revision 与摘要。
- 所有写入使用现有锁、CAS、临时文件、fsync 与 atomic rename。
- 代码标识符、错误码、CLI 命令保持英文；用户可见说明、模板和文档使用中文。
- 每个任务只提交本任务文件；不要顺手重构无关代码。

### 任务 1：固化路线产物模式、节点类型与数据模式

**文件：**

- 修改：`plugins/dev-flow/src/policy/types.ts`
- 修改：`plugins/dev-flow/policy/contract.json`
- 修改：`plugins/dev-flow/src/policy/contract.ts`
- 新建：`plugins/dev-flow/policy/traceability.schema.json`
- 新建：`tests/unit/traceability-policy.test.mjs`

**跨阶段接口：**

```ts
interface WorkflowCapabilities {
  trace: 0 | 1;
  review: 0 | 1;
  checkpoints: 0 | 1;
  rollbackExecution: 0 | 1;
}

export const SUPPORTED_WORKFLOW_CAPABILITIES: WorkflowCapabilities = {
  trace: 1,
  review: 0,
  checkpoints: 0,
  rollbackExecution: 0,
};

interface RouteDefinition {
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

type TraceNode =
  | RequirementNode
  | AcceptanceCriterionNode
  | TaskNode
  | TestNode
  | RollbackNode;

interface RollbackNode {
  kind: "rollback";
  id: `RU-${string}`;
  tasks: string[];
  dependsOn: string[];
  fileScope: string[];
  covers: string[];
  forwardVerification: string[];
  rollbackVerification: string[];
  sourceArtifact: "implementation-plan" | "rollback-units";
  sourceSha256: string;
  sourceAnchor: string;
  status: "current" | "stale" | "tombstoned";
}
```

`RollbackNode.status` 只表示追溯定义的新鲜度。实现期生命周期由 Rollback 计划中的 `ImplementationUnitState` 保存，并通过同一个 RU ID 关联；不得在后续阶段复制或扩写一份新的 RU 定义。

**路线决策：**

- standard M 从 `implementation-plan` 解析 RU。
- standard L 从 `rollback-units` 解析 RU。
- 两条路线生成相同的 `RollbackNode`，后续 checkpoint 代码不区分来源。
- standard M 的 `rollback_unit` 保留为无新 artifact 的校验步，验证 plan 来源的 RU slice 与现有风险 evidence。
- 本阶段只给 `RouteDefinition` 增加 generated artifact 表达能力，不把 `plan-review` 迁入 `generatedArtifacts`；该迁移由 Review 2a 完成。
- trace delta 只接受 node 字段；`edges[]` 由 Core 确定性派生，调用方不得提交。

**步骤：**

- [ ] 写合同测试，断言可编辑 artifact 与生成 artifact 不重叠，且各自绑定合法步骤。
- [ ] 写 standard M/L 的 RU 来源、M `rollback_unit` 校验步和 `generatedArtifacts` 默认为空的合同测试。
- [ ] 写调用方提交 `edges[]` 被拒绝、Core 可从 node 字段派生相同 edges 的测试。
- [ ] 写判别联合、ID 格式、来源字段、RU DAG 与必填字段的 Schema 失败用例。
- [ ] 运行 `node --test tests/unit/traceability-policy.test.mjs`，确认红灯。
- [ ] 最小修改类型、合同与解析器，使测试通过。
- [ ] 运行 `npm run typecheck`，再运行 `npm test`。
- [ ] 提交：`feat(dev-flow): define traceability route contract`

### 任务 2：更新中文模板并规定唯一声明锚点

**文件：**

- 修改：`plugins/dev-flow/templates/implementation-plan.md`
- 修改：`plugins/dev-flow/templates/coverage-matrix.md`
- 修改：`plugins/dev-flow/templates/rollback-units.md`
- 修改：`plugins/dev-flow/src/core/artifacts.ts`
- 新建：`tests/unit/traceability-templates.test.mjs`

**模板规则：**

- requirements 模板包含 `REQ-*` 与 `AC-*` 的唯一声明标记。
- implementation plan 包含 `TASK-*`；standard M 同时包含 `RU-*` 区块。
- coverage matrix 包含 `TEST-*` 及其 `AC-*` 关联。
- standard L 的 rollback 模板包含完整 RU 字段。
- 交叉引用可以出现多次，但声明锚点必须恰好出现一次。
- RU 的 `forwardVerification`、`rollbackVerification` 只填写 `.dev-flow/project.json` 中已配置的 command ID，不允许内嵌 shell 命令。

建议声明格式：

```md
<!-- dev-flow:id=TASK-001 kind=task -->
```

**步骤：**

- [ ] 写模板渲染测试，覆盖 standard M 与 standard L。
- [ ] 写声明缺失、声明重复、kind 不匹配的失败测试。
- [ ] 写未知 verification command ID 和把命令文本当 ID 的失败测试。
- [ ] 运行 `node --test tests/unit/traceability-templates.test.mjs`，确认红灯。
- [ ] 更新模板与 scaffold 逻辑。
- [ ] 验证所有模板生成的 Markdown 可被下一任务的解析器读取。
- [ ] 提交：`feat(dev-flow): add trace-aware artifact templates`

### 任务 3：实现账本校验、持久化与失效传播

**文件：**

- 新建：`plugins/dev-flow/src/core/traceability.ts`
- 修改：`plugins/dev-flow/src/core/state-store.ts`
- 新建：`tests/unit/traceability-store.test.mjs`

**必须实现：**

- `readTraceability`
- `validateTraceDelta`
- `validateSourceAnchors`
- `validateTraceGraph`
- `assertTraceSliceCurrent`
- `propagateTraceStaleness`
- `writeTraceabilityAtomic`
- `deriveTraceEdges`

**Core 不变量：**

- 每个 current `REQ` 至少被一个 current `TASK` 覆盖。
- 每个 current `AC` 隶属一个 current `REQ`，且至少关联一个 current `TEST`。
- 每个 `TASK` 至少引用一个 `REQ` 或 `AC`。
- standard M/L 的每个 `TASK` 都关联一个 `RU`。
- RU 依赖无环，引用两端存在、current 且来源 hash 最新。
- tombstone ID 永不复用。
- 落盘 `edges[]` 必须等于从 node 字段派生的结果。

**步骤：**

- [ ] 写 ID、悬空引用、孤儿节点、DAG、tombstone 与 hash mismatch 测试。
- [ ] 写 requirements/plan 变化后的精确 stale 传播测试。
- [ ] 写 sidecar 缺失、损坏、hash 不一致必须 fail closed 的测试。
- [ ] 写 `startFeature` 为 `trace: 1` feature 原子创建空账本和 state pointer 的测试；任一写入失败时二者都不存在。
- [ ] 写 standard→light reclassify 保留账本只读审计、停止 trace enforcement 和 with-trace 登记的测试。
- [ ] 写 verification command ID 不存在，以及 project config digest 变化使相关 RU basis stale 的测试。
- [ ] 运行 `node --test tests/unit/traceability-store.test.mjs`，确认红灯。
- [ ] 复用 state store 的锁与原子 JSON 写入，不复制一套 fsync 逻辑。
- [ ] 运行单元测试并检查错误保持 revision 与文件一致。
- [ ] 提交：`feat(dev-flow): implement traceability ledger`

### 任务 4：实现产物与追溯信息的原子登记并禁用裸接口

**文件：**

- 修改：`plugins/dev-flow/src/core/artifacts.ts`
- 修改：`plugins/dev-flow/src/core/gate-basis.ts`
- 修改：`plugins/dev-flow/src/core/state-store.ts`
- 修改：`plugins/dev-flow/src/mcp/doctor.ts`
- 新建：`tests/unit/traceability-artifacts.test.mjs`

**新增操作：**

```ts
recordArtifactWithTrace({
  featureId,
  expectedRevision,
  artifactKind,
  traceDelta,
});
```

事务顺序必须是：加锁 → 校验 revision → 读取 scaffold → 计算 hash → 校验声明与图 → 写 sidecar → 更新 state pointer → 原子提交。任一步失败都不得留下半登记状态。

**强制规则：**

- `workflowCapabilities.trace === 1` 的 feature 对 requirements、plan、coverage、rollback 调用裸 `recordArtifact` 时返回 `TRACE_AWARE_REGISTRATION_REQUIRED`。
- 只有当前 feature 合同已把某产物列入 `generatedArtifacts` 时，人工登记才返回 `GENERATED_ARTIFACT_READ_ONLY`；`review: 0` feature 的旧 plan-review 仍可编辑。
- `doctor` 能区分 legacy feature、完整新 feature和损坏的新 feature。

**步骤：**

- [ ] 写裸登记、生成投影覆盖、CAS 冲突和中途写入失败测试。
- [ ] 运行 `node --test tests/unit/traceability-artifacts.test.mjs`，确认红灯。
- [ ] 实现事务与回滚清理。
- [ ] 验证失败后 state revision、artifact registration 与 sidecar 完全不变。
- [ ] 提交：`feat(dev-flow): register artifacts and trace atomically`

### 任务 5：让所有阶段入口在核心层默认拒绝

**文件：**

- 修改：`plugins/dev-flow/src/core/human-gates.ts`
- 修改：`plugins/dev-flow/src/core/feature-check.ts`
- 修改：`plugins/dev-flow/src/core/status.ts`
- 修改：`plugins/dev-flow/src/core/next.ts`
- 修改：`plugins/dev-flow/src/core/step-order.ts`
- 新建：`tests/unit/traceability-gates.test.mjs`
- 修改：`tests/unit/status-progress.test.mjs`

**规则：**

- 每次 `recordStep` 调用 `assertTraceSliceCurrent(step)`，而不是只在首次 approval 检查。
- implementation approval 前校验完整 `REQ/AC → TASK → TEST/RU`。
- 本阶段的 `recordStep(implementation)` 只校验全图完整且 basis current，不读取 `ImplementationUnitState`，也不要求 checkpoint。
- feature-check/finalize 再检查完整 basis，防止旧状态或跨宿主旁路。
- status 显示 total/current/stale/orphan 数量与具体阻塞原因。

**步骤与最低 trace slice：**

| 步骤 | 必须满足 |
| --- | --- |
| `requirements` | REQ/AC 声明合法；每个 AC 有且仅有一个 current parent REQ |
| `implementation_plan` | TASK 不孤立；standard M 的 RU 字段完整、command ID 存在且 DAG 合法 |
| `coverage_review` | 每个 current AC 已由至少一个 current TEST 覆盖；本步不允许 pending coverage |
| `rollback_unit` | M 校验 implementation-plan 来源 RU；L 校验 rollback-units 来源 RU |
| `plan_review`、`implementation_approval`、`feature_check`、`finalize` | `assertTraceabilityComplete` 校验全图 |
| `implementation` | 只校验全图完整与 basis current；checkpoint 约束由阶段 3 添加 |

**步骤：**

- [ ] 写 CLI/Core 直接调用也无法绕过的测试。
- [ ] 写旧 requirements hash、旧 coverage 和不完整 trace 图的失败测试。
- [ ] 写 RU 尚无任何实现期状态时，Trace-only feature 仍可合法记录 implementation 的回归测试。
- [ ] 写 legacy feature 不受影响的回归测试。
- [ ] 运行相关单元测试，确认红灯后实现。
- [ ] 验证 `next`、status 与 HUMAN GATE 给出同一阻塞原因。
- [ ] 提交：`feat(dev-flow): enforce trace slices at phase boundaries`

### 任务 6：暴露 MCP 工具并让技能只做编排

**文件：**

- 修改：`plugins/dev-flow/src/mcp/server.ts`
- 修改：`plugins/dev-flow/skills/requirements/SKILL.md`
- 修改：`plugins/dev-flow/skills/plan/SKILL.md`
- 修改：`plugins/dev-flow/skills/coverage-review/SKILL.md`
- 修改：`plugins/dev-flow/skills/rollback-safety/SKILL.md`
- 修改：`plugins/dev-flow/skills/status/SKILL.md`
- 修改：`tests/unit/mcp-server.test.mjs`
- 修改：`tests/unit/skills.test.mjs`

**工具：**

- `dev_flow_record_artifact_with_trace`
- `dev_flow_get_traceability`

**步骤：**

- [ ] 写工具发现、输入 Schema、CAS、错误映射与只读查询测试。
- [ ] 明确 Skills 不得手改 `traceability.json`，也不得自行复制路线风险映射。
- [ ] standard M 的 plan Skill 提交 plan 内 RU；standard L 的 rollback-safety Skill 提交 rollback artifact RU。
- [ ] standard M 到达 `rollback_unit` 时，rollback-safety Skill 只调用 Core 校验步，不 scaffold 新 artifact；现有 rollback/full-rollback evidence 仍按 `requiredEvidenceForStep` 提交。
- [ ] plan-review Skill 在本阶段继续执行旧 `recordArtifact`（仅路线要求时）和 `{ reviewType: "plan" }` evidence，不调用 Review batch 工具。
- [ ] 即使 Skill 误用裸接口，MCP/Core 测试仍断言拒绝。
- [ ] 运行 MCP 与 Skills 测试。
- [ ] 提交：`feat(dev-flow): expose traceability through mcp`

### 任务 7：保护旁路账本并完成路线验收

**文件：**

- 修改：`plugins/dev-flow/src/hosts/adapter-policy.ts`
- 修改：`tests/unit/adapter-policy.test.mjs`
- 修改：`tests/helpers/route-flow.mjs`
- 修改：`tests/e2e/routes/standard-m.test.mjs`
- 修改：`tests/e2e/routes/standard-l.test.mjs`
- 修改：`docs/architecture.md`
- 修改：`docs/routes.md`
- 修改：`README.md`

**验收场景：**

- standard M：requirements → plan（含 RU）→ coverage → `rollback_unit` 校验步 → 旧 plan_review → approval。
- standard L：requirements → plan → coverage → rollback-units → 旧 plan_review artifact/evidence → approval。
- Claude 与 Codex 跨宿主登记时共享 revision/CAS，不能覆盖对方更新。
- Agent 直接写 trace sidecar 时被 Hook 拒绝。
- 缺覆盖、旧 hash、裸登记、缺 RU 任一情况都不能进入 approval。
- 没有 review batch 和 ImplementationUnitState 时，两条路线仍能完成 implementation、verification、feature-check 与 finalize。

**步骤：**

- [ ] 写 Hook 与两条路线端到端失败测试。
- [ ] 更新测试 helper，禁止用内部状态注入绕过真实工具。
- [ ] 更新中文架构、路线和 README 说明。
- [ ] 运行单元测试、两条路线 E2E、类型检查与构建。
- [ ] 运行 `git diff --check`。
- [ ] 提交：`feat(dev-flow): complete traceability enforcement`

## 完成条件

- 路线合同明确区分 editable/generated artifact。
- standard M/L 生成同构 RU，Trace 与 Rollback 不再有字段裂缝。
- 裸登记、阶段旁路和直接写 sidecar 均由 Core/Hook 拒绝。
- 本阶段不迁移 plan-review，不要求 checkpoint；单独发布后 standard M/L 可完整闭环。
- 空账本创建、standard→light reclassify 和 feature 能力固定均有测试。
- 所有新增错误码都有失败原子性测试。
- 中文模板、README 与架构文档和实际合同一致。
