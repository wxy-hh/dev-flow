# Dev Flow 追溯账本、对抗审查与回撤单元设计

## 背景

Dev Flow v1.7.0 已经具备持久状态、路线顺序、Markdown 产物哈希、人工门禁、验证新鲜度、交付快照与宿主钩子门禁。当前限制是：

1. 需求、计划、覆盖与回撤的语义关系主要依赖智能体自觉，核心层只验证步骤、产物完整性与少量证据字段。
2. `plan_review` 是一个流程插槽，不会创建、隔离或审计多个审查者。
3. `rollback_unit` 是计划证据，不是实现期间可执行的检查点；现有反向补丁只在最终交付时生成，粒度为整个功能。

本设计采用“实用型工作流增强”：核心层保证结构、引用、基线、可验证的执行事实和回撤安全；智能体与人类继续负责语义质量。设计为未来更强的自动语义检查预留接口，但不在本阶段声称机器已经证明需求或计划正确。

## 目标

1. 建立 `REQ/AC → TASK → TEST/RU` 的可审计追溯链。
2. 让 `plan_review` 先成为可审计的多视角审查，并只在具备服务端证据时升级保证等级。
3. 让计划中的 rollback unit 成为实现阶段可确认、可预览、可安全执行的 checkpoint。
4. 保持 Claude Code 与 Codex CLI 双宿主、风险比例路线和现有 HUMAN GATE 语义。
5. 现有 active feature 可以按旧合同完成，不要求中途迁移。

文中协议字段、错误码、MCP 工具名和代码标识符保留英文，以便与源码精确对应；其余叙述统一使用中文。

## 非目标

- Core 不判断自然语言需求是否合理，也不判断某个测试是否足以证明业务语义。
- 不允许任意图回撤；首版只允许回到某个已确认检查点，并逆序撤销其后的完整后缀。
- 不要求所有宿主具备 subagent；能力不足时允许带降级标识的串行多视角审查。
- 不以 Git commit、`git reset --hard` 或修改用户当前分支作为实现 checkpoint。
- 不在本阶段把 TDD 变成新的全局路线步骤。

## P0：开放决策

以下决策是三份实施计划的共同合同，不再留给实现阶段临时选择：

| 主题 | 已确定决策 |
| --- | --- |
| feature 合同固定 | `startFeature` 把当时可用能力写入不可变 `workflowCapabilities`；插件升级不得把新门禁施加到已启动 feature |
| standard M 的 RU 来源 | 不新增独立文档；从 `implementation-plan` 中解析 RU，并生成统一的 `RollbackNode` |
| standard L 的 RU 来源 | 从 `rollback-units` 文档解析，使用与 standard M 相同的 `RollbackNode` |
| standard M 的 `rollback_unit` | 保留为无新 artifact 的校验步：断言 plan 来源的 RU slice current、DAG 合法，并继续执行现有风险 evidence 校验 |
| plan review 文档 | 终态为 Core 生成投影；迁移只在 Review 2a 对 `review: 1` 的新 feature 生效，Trace 阶段与旧 feature 仍使用现有可编辑 artifact/evidence |
| 路线契约 | `requiredArtifacts` 只表示人工编辑产物；`generatedArtifacts` 只表示 Core 生成产物；现有 `status` 在 Trace 阶段迁入生成产物 |
| Trace 模型 | 使用带 `kind` 判别字段的联合类型；RU 在 Trace 阶段就包含依赖、scope、验证和来源字段 |
| Trace delta | 调用方提交单个 artifact 的完整节点集合；Core 绑定来源、状态、区块哈希并派生 tombstone 与 edges |
| Trace 存储 | 使用不可变内容寻址快照 `traceability/snapshots/<sha256>.json`；`state.json` 中的 pointer 是提交点，不覆盖旧快照 |
| Trace 模板 | `core/artifact-templates.ts` 是 requirements/plan/coverage/rollback Trace 模板的唯一事实源；不保留未被运行时读取的同名空 Markdown 模板 |
| Trace 阶段强制力 | 只有 `traceEnforcementRequired(state)` 为真时才禁用裸登记并校验 trace slice；implementation 只要求全图完整且 basis current |
| Trace reclassify | light→standard 在同一 CAS 中懒创建或恢复 pointer；standard→light 保留只读账本但停止 Trace 强制 |
| Checkpoint 强制时机 | 仅 `checkpoints: 1` 的新 feature 要求全部 RU checkpoint、无 open transaction；无 active RU 禁写也从阶段 3 开始 |
| 唯一声明锚点 | 使用 `<!-- dev-flow:id=TASK-001 kind=task -->`；声明恰好一次、交叉引用可重复、`kind` 必须匹配节点 |
| 图的写入权威 | node 字段（如 `covers`、`parent`、`verifies`、`tasks`）是唯一写入权威；`edges[]` 由 Core 派生，只读且写盘前重算 |
| Review 2a 的默认保证 | 默认只声称 `multi-perspective`，不以调用方传入的 executor/context 字符串证明多代理 |
| 更高审查保证 | `independent-sampling` 仅由服务端签发的独立 sampling 请求证明；宿主声明只能达到 `multi-agent-attested`；可信宿主身份留作未来 `multi-agent-verified` |
| Rollback 第 3 阶段边界 | 只交付 unit lifecycle、scope Hook、checkpoint、preview/conflict；不暴露实际回撤执行 |
| Rollback 第 4A 阶段 | 完成事务日志、恢复、独立 HUMAN GATE 后才开放 `execute` |
| Review 第 4B 阶段 | 独立增加 sampling、身份与 provenance，不阻塞 Rollback 4A |

## 总体架构

保留现有 Markdown artifact 作为人类叙述层，新增 MCP 管理的机器追溯账本：

```text
requirements.md ─┐
plan.md           ├─→ traceability/snapshots/<sha256>.json
coverage.md       │      REQ → TASK → TEST → RU
review reports  ──┘                 ↑
                         state.json pointer（提交点）
                         TASK → review jobs/findings
                         RU → checkpoint/patch/verification
```

Trace snapshot 只能由 MCP 写入。每个机器节点都绑定来源 artifact、整个 artifact 的 SHA-256 和由声明锚点切分出的区块 SHA-256。Markdown 更新后，Core 依据区块哈希精确传播 stale；删除节点保留 tombstone，不复用旧 ID。

为避免双主状态，人工维护的 artifact registration 与 trace pointer 必须在同一个 MCP CAS 中登记。新 snapshot 先完整落盘，`state.json` pointer 最后提交；提交前失败最多留下不被引用的孤儿 snapshot。

路线合同必须显式描述可编辑与生成 artifact：

```ts
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
```

`routeDefinitionForFeature(route, workflowCapabilities)` 根据 capability 计算有效合同。Trace 阶段先把现有 `status` 从 `requiredArtifacts` 迁入 `generatedArtifacts`；Review 2a 再为 standard-M 声明 plan-review 从 `absent` 转为 `generated`，为 standard-L 声明从 `editable` 转为 `generated`；`review: 0` 仍得到旧合同。有效 `generatedArtifacts` 只能由 Core 生成、刷新和登记，Skill 可以请求刷新，但不能提交其内容。

每个 feature 在启动时固定能力版本：

```ts
interface WorkflowCapabilities {
  trace: 0 | 1;
  review: 0 | 1;
  checkpoints: 0 | 1;
  rollbackExecution: 0 | 1;
}
```

缺少该字段的旧 feature 等价于全部为 `0`。能力默认不可在 active feature 中途升级；若未来支持迁移，必须提供显式、可回滚的 MCP 迁移事务。

每个发布阶段更新 Core 的单一常量 `SUPPORTED_WORKFLOW_CAPABILITIES`；`startFeature` 复制该值进入 feature state，后续读取不得用当前插件常量覆盖已保存值。

Trace 门禁只使用一个谓词：

```ts
function traceEnforcementRequired(state: FeatureState): boolean {
  return state.workflowCapabilities.trace === 1
    && (state.route === "standard-m" || state.route === "standard-l");
}
```

不能只检查 `workflowCapabilities.trace`，否则 standard→light 后会错误保留 Trace 门禁。

## 一、需求固化链

### 标识符

| 类型 | 格式 | 含义 |
| --- | --- | --- |
| 需求 | `REQ-001` | 功能或约束需求 |
| 验收条件 | `AC-001` | 隶属于某个 REQ 的验收条件 |
| 计划任务 | `TASK-001` | 实现计划任务 |
| 测试场景 | `TEST-001` | 自动或人工验证场景 |
| 回撤单元 | `RU-001` | 一个可 checkpoint 的计划任务集合 |

ID 在一个 feature 内稳定且不可复用。删除节点保留 tombstone，防止旧 evidence 在新含义下重新生效。

### 运行时模板与声明锚点

`core/artifact-templates.ts` 是 Trace 相关 artifact scaffold 的唯一事实源，负责动态 front matter、feature ID、route、grill status 和以下节点区块：

- requirements：`REQ-*` 与 `AC-*`
- implementation-plan：`TASK-*`，standard M 同时包含 `RU-*`
- coverage-matrix：`TEST-* → AC-*`
- rollback-units：standard L 的完整 `RU-*`

声明统一使用 `<!-- dev-flow:id=TASK-001 kind=task -->`。Core 以相邻声明锚点切分区块并计算 `sourceBlockSha256`；交叉引用可以重复，声明必须恰好一次。现有未被运行时读取的 `templates/implementation-plan.md`、`templates/coverage-matrix.md` 与 `templates/rollback-units.md` 删除，测试只断言 MCP 实际 scaffold 的文件。

### 账本模型

账本节点使用带 `kind` 的判别联合类型，避免 Trace 与 Rollback 阶段各自定义一份不兼容的 RU：

```ts
type TraceStatus = "current" | "stale" | "tombstoned";
type RequirementId = `REQ-${string}`;
type AcceptanceCriterionId = `AC-${string}`;
type TaskId = `TASK-${string}`;
type TestId = `TEST-${string}`;
type RollbackId = `RU-${string}`;
type TraceId = RequirementId | AcceptanceCriterionId | TaskId | TestId | RollbackId;
type TraceArtifactKind =
  | "requirements"
  | "implementation-plan"
  | "coverage-matrix"
  | "rollback-units";

interface TraceSource {
  sourceArtifact: TraceArtifactKind;
  sourceSha256: string;
  sourceAnchor: string;
  sourceBlockSha256: string;
  status: TraceStatus;
}

interface RequirementNode extends TraceSource {
  kind: "requirement";
  id: RequirementId;
}

interface AcceptanceCriterionNode extends TraceSource {
  kind: "acceptance-criterion";
  id: AcceptanceCriterionId;
  parentRequirement: RequirementId;
}

interface TaskNode extends TraceSource {
  kind: "task";
  id: TaskId;
  covers: Array<RequirementId | AcceptanceCriterionId>;
  rollbackUnit: RollbackId;
}

interface TestNode extends TraceSource {
  kind: "test";
  id: TestId;
  verifies: AcceptanceCriterionId[];
}

type TraceNode =
  | RequirementNode
  | AcceptanceCriterionNode
  | TaskNode
  | TestNode
  | RollbackNode;

interface RollbackNode {
  kind: "rollback";
  id: RollbackId;
  tasks: TaskId[];
  dependsOn: RollbackId[];
  fileScope: string[];
  covers: Array<RequirementId | AcceptanceCriterionId>;
  forwardVerification: string[];
  rollbackVerification: string[];
  sourceArtifact: "implementation-plan" | "rollback-units";
  sourceSha256: string;
  sourceAnchor: string;
  sourceBlockSha256: string;
  status: TraceStatus;
}

type TraceNodeInput =
  | { kind: "requirement"; id: RequirementId }
  | { kind: "acceptance-criterion"; id: AcceptanceCriterionId; parentRequirement: RequirementId }
  | { kind: "task"; id: TaskId; covers: Array<RequirementId | AcceptanceCriterionId>; rollbackUnit: RollbackId }
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

interface TraceDelta {
  nodes: TraceNodeInput[];
}

interface TraceSummary {
  total: number;
  current: number;
  stale: number;
  tombstoned: number;
  orphanNodes: number;
}

interface TraceabilityPointer {
  path: `traceability/snapshots/${string}.json`;
  sha256: string;
  revision: number;
  summary: TraceSummary;
}

interface TraceEdge {
  from: TraceId;
  type: "parent" | "covers" | "verifies" | "rollback-unit" | "contains-task" | "depends-on";
  to: TraceId;
}

interface TraceabilityLedger {
  schemaVersion: 1;
  featureId: string;
  revision: number;
  stateRevision: number;
  projectConfigSha256: string;
  nodes: Record<TraceId, TraceNode>;
  edges: TraceEdge[];
  summary: TraceSummary;
}
```

`RollbackNode.status` 表示定义是否 current/stale/tombstoned；实现期的 pending/active/checkpointed/rolled_back 属于独立的 `ImplementationUnitState`。两者引用同一个 RU ID，避免把计划定义的新鲜度与运行时生命周期混成一个状态机。

调用方每次提交一个 artifact 的完整节点集合，不接受 `source*`、`status`、tombstone 或 `edges[]`。Core 按 artifact/route 限制合法 kind，绑定来源和区块哈希；同一来源中消失的旧 ID 由 Core 生成 tombstone。Core 校验引用后确定性派生 edges，并在读取时验证派生结果与落盘内容一致；不一致视为账本损坏。

Feature state 只保存 `TraceabilityPointer`，不复制完整图。snapshot 文件名是其规范 JSON 内容的 SHA-256；旧 snapshot 不覆盖、不修改。

### 原子登记

新增等价于下列语义的 MCP 操作：

```text
dev_flow_record_artifact_with_trace
```

输入包含 artifact kind、expected revision 和结构化 trace delta。事务必须：

1. 加 feature 锁并校验 expected revision。
2. 读取当前已 scaffold 的 artifact、旧 snapshot 与 project config。
3. 计算 artifact SHA-256，校验 ID、完整替换集合、tombstone、引用、锚点和 command ID。
4. 依据 `sourceBlockSha256` 精确传播 stale，并确定性派生 edges。
5. 将规范 JSON 写入临时 snapshot，fsync 后 rename 为 `traceability/snapshots/<sha256>.json`。
6. 最后原子 rename `state.json`，在同一个 state revision 中提交 artifact registration、Trace pointer、gate/step 失效和摘要。
7. 更新 status、event 与 active pointer 等派生投影。

`state.json` rename 是逻辑提交点。提交前失败时 state、artifact registration 和 pointer 均不变化；已写 snapshot 可能成为无害孤儿。提交后操作视为成功，派生投影失败不得谎报为“已回滚”，而应由 doctor 报告并在安全入口修复。当前 pointer 缺失、hash 不匹配或 snapshot 非法必须 fail closed；孤儿 snapshot 只报警，不阻塞路线。

普通非追溯 artifact 可以继续使用原 `record_artifact`；参与追溯的 artifact 在新 feature 上必须使用原子接口。新 feature 对 requirements、plan、coverage、rollback 直接调用裸 `record_artifact` 时，Core 必须返回 `TRACE_AWARE_REGISTRATION_REQUIRED`，不能只靠 Skill 提醒。

### 核心层不变量

进入 implementation approval 前必须满足：

- 每个 current `REQ` 至少被一个 current `TASK` 覆盖。
- 每个 current `AC` 隶属一个 current `REQ`，并至少对应一个 current `TEST`。
- 每个 `TASK` 至少引用一个 `REQ` 或 `AC`，不存在孤儿任务。
- standard M/L 的每个 `TASK` 都关联一个 `RU`。
- 所有边的两端存在、current 且基于当前 artifact hash。
- 不存在重复 ID、悬空引用或 stale coverage。

Feature-check 在 finalize 前再次检查同一组不变量，防止旧状态或旁路调用绕过首次校验。

此外，每次 `recordStep` 都必须验证当前阶段所消费的 trace slice 和 basis hash。Trace 阶段的 `recordStep(implementation)` 只检查全图完整且 basis current；只有 `workflowCapabilities.checkpoints === 1` 时，阶段 3 才追加“所有 RU 已 checkpoint、无 open rollback transaction”的约束。这样各阶段可以独立发布，也不会在插件升级时锁死旧 feature。

standard M 的 `rollback_unit` 不创建新文档或新 RU。该步骤调用 `assertTraceSliceCurrent("rollback_unit")` 校验 implementation-plan 中的 RU 定义、DAG 和引用，并继续执行 `requiredEvidenceForStep` 已派生的 rollback/full-rollback 风险检查。

最低 trace slice 固定如下：

| 步骤 | 必须满足 |
| --- | --- |
| `requirements` | REQ/AC 声明合法；每个 AC 有且仅有一个 current parent REQ |
| `implementation_plan` | TASK 不孤立；standard M 的 RU 字段完整且 DAG 合法 |
| `coverage_review` | 每个 current AC 已由至少一个 current TEST 覆盖，本步不允许 pending coverage |
| `rollback_unit` | standard M 校验 plan 来源 RU；standard L 校验 rollback-units 来源 RU |
| `plan_review`、`implementation_approval`、`feature_check`、`finalize` | `assertTraceabilityComplete` 校验全图 |
| `implementation` | Trace/Review feature 校验全图；`checkpoints: 1` 时再校验实现单元状态 |

### 失效传播

失效采用“保留历史、标记 stale”。整个 artifact hash 只证明登记基线，节点是否发生语义变化由声明区块的 `sourceBlockSha256` 判断：

```text
某个 REQ/AC 区块哈希变化
→ requirement gate stale
→ 引用相关 REQ/AC 的 TASK、TEST、RU stale
→ coverage review / plan review stale
→ implementation approval stale
```

同一 artifact 中区块哈希未变化的节点更新 `sourceSha256` 后保持 current，其无关下游不失效。计划或回撤产物变化不反向使需求门禁失效，但会使相应覆盖审查、计划审查、批准和尚未执行的检查点失效。

## 二、可证明保证等级的对抗审查

### 审查批次

`plan_review` 开始时，MCP 创建不可变审查批次。基线包含：

- 需求、实现计划、覆盖矩阵与回撤产物的 SHA-256
- 追溯账本 SHA-256
- route、classification、risk labels 与 scope
- protected-root fingerprint
- `.dev-flow/project.json` SHA-256

每个 review job 记录：

```json
{
  "jobId": "PRJ-ARCH-001",
  "role": "architecture",
  "basisHash": "sha256",
  "status": "pending",
  "executionMode": "isolated-sequential",
  "executorId": null,
  "contextId": null
}
```

审查者在提交前只能读取不可变审查包，不能读取同批次的其他审查发现。

### 角色选择

角色按路线与风险派生，不固定启动四个 reviewer：

| 条件 | 必需角色 |
| --- | --- |
| standard M | `requirements-coverage`、`architecture-testability` |
| standard L | 上述角色 + `rollback-operability` |
| `security` | `security` |
| `data` / `money` / `irreversible_consequence` | `data-irreversibility` |
| `critical_correctness` | 不新增角色；所有必需 job 使用 `reviewDepth: "full"` |

角色映射应进入 policy contract，Skill 不复制风险映射。

`reviewDepth: "full"` 要求每个 job 提交结构化覆盖证明和完成记录，但 `findings` 可以为空；禁止为了证明“审查过”而强迫 reviewer 虚构 finding。第 2a 阶段的 assurance 仍为 `multi-perspective`。

### 保证等级与证据

审查的“角色数量”和“执行独立性”分开记录。第 2a 阶段默认创建多个角色 job，但无论 Skill 串行执行还是宿主声称使用 subagent，都只根据可验证证据升级保证等级：

| 保证等级 | 可接受证据 | 当前阶段 |
| --- | --- | --- |
| `multi-perspective` | 同一不可变 package 上完成多个角色 job | 2a 默认 |
| `independent-sampling` | Core 为每个 job 签发不同 sampling request，并关联不可复用的服务端 request ID | 4B |
| `multi-agent-attested` | 宿主声明 job 由不同 subagent 执行，并保存原始 attestation | 4B |
| `multi-agent-verified` | 可信宿主提供可验证的 agent identity 与 provenance | 未来 |

调用方传入的 `executorId`、`contextId`、agent 名称或任意字符串只能作为诊断元数据，不能升级 assurance。聚合器根据服务端持有的证据计算等级，调用方不能直接写入 `assuranceLevel`。

路线可以在 `multi-perspective` 下继续，但 status、plan review 投影和最终交付必须准确显示等级，不得把“多角色”叙述成已证明的“多代理”。

### 审查发现

Finding 必须结构化：

```json
{
  "findingId": "F-001",
  "jobId": "PRJ-ARCH-001",
  "severity": "blocking",
  "category": "module-boundary",
  "targets": ["TASK-003", "REQ-002"],
  "evidence": [{ "path": "src/example.ts", "line": 42 }],
  "claim": "描述",
  "recommendation": "建议"
}
```

协议层严重度固定为 `blocking | warning | note`；中文投影分别显示为“阻塞 / 警告 / 备注”，不得再引入 `important | advisory` 等第二套协议值。

聚合器可以去重，但不能降低 blocking 严重度。Blocking finding 只能通过以下路径关闭：

1. 修改 basis artifact，生成新 basis 并重审。
2. 原 reviewer 或同角色新 reviewer 对修订明确标记 resolved。
3. 用户通过独立风险接受交互确认，保存 provenance。

### 状态转换

```text
创建批次
→ 执行必需角色任务
→ 提交审查发现
→ 聚合
→ 解决或接受阻塞项风险
→ 记录 plan_review
→ 展示实现批准门禁
```

首版中任一 basis artifact 改变会使整批 stale。局部 reviewer 复用留作后续优化。

当 Review 2a 发布后，`workflowCapabilities.review === 1` 的 standard M/L feature 使用 Core 生成的 `plan-review.md`；机器权威为 batch、jobs、findings、dispositions 与 assurance evidence。Review 2a 负责把路线合同迁入 `generatedArtifacts`，并把 plan-review evidence 从 `{ reviewType: "plan" }` 改为 `{ batchId, basisHash, assuranceLevel }`。`review: 0` 的已启动 feature 继续按旧可编辑合同完成。

## 三、计划任务级 checkpoint 与精确回撤

### 回撤单元定义

每个 RU 在 Trace 阶段就必须包含以下字段，而不是等到 Rollback 阶段再补充：

```json
{
  "id": "RU-002",
  "tasks": ["TASK-003", "TASK-004"],
  "dependsOn": ["RU-001"],
  "fileScope": ["src/api/**", "src/types/**"],
  "covers": ["REQ-002", "AC-003"],
  "forwardVerification": ["unit", "typecheck"],
  "rollbackVerification": ["unit", "typecheck"]
}
```

RU 依赖必须构成 DAG。首版的执行顺序必须是 DAG 的一个确定性拓扑序。

`forwardVerification` 与 `rollbackVerification` 保存 `.dev-flow/project.json` 中的 command ID，而不是任意 shell 命令。Trace 登记时校验 ID 存在；review、checkpoint 与 rollback preview 的 basis 都包含 project config SHA-256，防止同一 ID 在配置变更后静默指向不同命令。

### 实现子状态机

路线仍保留一个 `implementation` step，其内部增加：

```text
pending unit
→ active unit
→ verified unit
→ checkpointed unit
```

建议 MCP 接口语义：

- `dev_flow_begin_implementation_unit`
- `dev_flow_checkpoint_implementation_unit`
- `dev_flow_preview_rollback`

开始单元前校验其依赖、basis 和 approval。Checkpoint 前校验实际修改文件属于 RU 的 `fileScope`；超出范围必须修改计划并重新完成受影响的 coverage、review 与 approval。

仅对 `workflowCapabilities.checkpoints === 1` 的 feature，Core 和 Hook 才启用实现单元门禁：进入 implementation 后，如果不存在 active RU，Core 返回 `IMPLEMENTATION_UNIT_REQUIRED`，宿主 Hook 映射为 `DEV_FLOW_IMPLEMENTATION_UNIT_REQUIRED`。该规则不能仅由 Skill 的操作顺序保证。

### 检查点内容

每个 checkpoint 保存：

- 开始与结束 fingerprint
- 实际修改文件
- before/after SHA-256
- 新增、删除、重命名、权限变化
- 内容寻址的 before/after blobs
- forward/reverse patch
- verification attempts
- requirements、plan 与 traceability basis hash
- project config SHA-256 与解析后的 verification command 定义摘要

Checkpoint 资产位于 feature 目录内，由 MCP 生成和管理，Agent 不可直接编辑。

### 第 3 阶段：检查点与回撤就绪最小版本

第 3 阶段只实现 unit lifecycle、scope Hook、checkpoint、rollback preview 与 conflict 检查。预览可以计算回撤后缀、文件影响和验证命令，但不得暴露 `present_rollback_gate` 或 `execute_rollback`。这样可先独立发布 checkpoint 数据模型，而不会在事务安全尚未完成时提供危险的半成品执行入口。

### 第 4A 阶段：事务回撤与恢复

第 4A 阶段新增：

- `dev_flow_present_rollback_gate`
- `dev_flow_execute_rollback`

只有事务日志、崩溃恢复、doctor 检测、独立 HUMAN GATE 和故障注入测试均完成后，Core 才注册这两个工具。

### 回撤规则

首版只支持恢复到一个已确认 checkpoint。目标之后的 checkpoint 必须按逆拓扑顺序完整撤销。不支持保留依赖者并抽掉中间 RU。

执行前：

1. 预览将撤销的 RU、文件和验证命令。
2. 为预览生成 basis hash。
3. 展示独立 HUMAN GATE，并等待后续用户响应。
4. 逐文件校验当前 hash 等于 checkpoint chain 预期 after hash。
5. 任一文件出现未登记修改时返回 `ROLLBACK_CONFLICT`，不执行任何恢复。

不使用 `git reset --hard`。恢复采用事务日志：

1. 写入 `rollback-transaction.json` 并 fsync。
2. 将当前文件备份到 recovery 目录。
3. 通过临时文件与 atomic rename 恢复 before blobs。
4. 执行 rollback verification。
5. 成功后提交状态；失败时依据事务日志恢复到回撤前状态。
6. 被撤销 checkpoint 保留并标记 `rolled_back`。

### 下游失效

成功回撤后：

- `implementation` 回到目标 checkpoint 之后的首个 pending RU。
- code review、verification、feature-check、logic-complete 与 finalize 失效。
- requirements/plan basis 未变化时保留 implementation approval。
- 若回撤导致计划修订，则按 traceability 传播规则重新审查与批准。

现有 finalize 交付快照继续作为 feature 级最终反向 patch；unit checkpoint 只负责实现期间的安全局部恢复。

## 错误处理

新增错误至少包括：

| 错误 | 含义 |
| --- | --- |
| `TRACEABILITY_REQUIRED` | 当前 standard feature 缺少 Trace pointer |
| `TRACEABILITY_INTEGRITY_FAILED` | pointer、snapshot hash、feature ID、revision 或派生 edges 不一致 |
| `TRACE_DELTA_INVALID` | 节点类型、字段、来源 artifact 或完整替换集合非法 |
| `TRACE_SOURCE_ANCHOR_INVALID` | 声明缺失、重复、kind 不匹配或无法切分区块 |
| `TRACE_GRAPH_INVALID` | ID、悬空引用、孤儿节点、RU DAG 或 tombstone 复用非法 |
| `TRACE_SLICE_INCOMPLETE` | 当前阶段要求的 REQ/AC/TASK/TEST/RU 覆盖不完整 |
| `TRACE_SLICE_STALE` | 当前阶段消费了 stale 节点或旧 basis |
| `TRACE_VERIFICATION_COMMAND_UNKNOWN` | RU 引用了 project config 中不存在的 command ID |
| `TRACE_AWARE_REGISTRATION_REQUIRED` | 追溯 artifact 试图通过裸接口登记 |
| `GENERATED_ARTIFACT_READ_ONLY` | 当前 feature 合同中的生成产物被人工登记 |
| `REVIEW_JOB_BASIS_MISMATCH` | reviewer 提交基于旧 package |
| `REVIEW_BLOCKING_FINDINGS` | 仍有未处理 blocking finding |
| `IMPLEMENTATION_UNIT_REQUIRED` | 实现期写入时不存在 active RU |
| `IMPLEMENTATION_UNIT_OUT_OF_SCOPE` | 修改文件超出 RU fileScope |
| `IMPLEMENTATION_UNITS_INCOMPLETE` | `checkpoints: 1` feature 尚有未 checkpoint 的 RU |
| `CHECKPOINT_VERIFICATION_FAILED` | 单元验证失败 |
| `ROLLBACK_TARGET_INVALID` | 目标不是合法 checkpoint |
| `ROLLBACK_CONFLICT` | 当前文件存在未登记修改 |
| `ROLLBACK_TRANSACTION_OPEN` | 上次回撤事务需要恢复或续办 |

所有提交点之前的失败必须保持 revision、artifact registration 和 Trace pointer 不变；已写入但未被 pointer 引用的 snapshot 是可诊断孤儿。提交点之后的派生投影错误必须报告“已提交、待修复”，不能把已提交状态描述成已回滚。

错误码采用两层约定：

- Core/MCP 业务错误使用无前缀短码，例如 `IMPLEMENTATION_UNIT_REQUIRED`。
- 宿主 Hook 将对应拒绝映射为 `DEV_FLOW_IMPLEMENTATION_UNIT_REQUIRED`、`DEV_FLOW_IMPLEMENTATION_UNIT_OUT_OF_SCOPE` 等 `DEV_FLOW_*` 稳定码。

`multi-perspective` 是 Review 2a 的正常保证等级，不是 capability degradation 错误。只有未来某条路线显式要求更高最低 assurance 且证据不足时，才应引入独立的 assurance shortfall 错误。

## 状态与模式演进

- 现有 active feature 保持 legacy 模式并按旧合同完成。
- `startFeature` 为所有新 feature 写入当时可用的 `workflowCapabilities`；只有新 standard M/L 同时创建空内容寻址 snapshot 与 state pointer。
- light→standard 时，`trace: 1` feature 在 reclassify 的同一个 CAS 中懒创建空 pointer，或恢复已有只读 pointer；旧来源不会因此自动变为 current。
- standard→light 保留账本和 pointer 作为只读审计记录，但 `traceEnforcementRequired(state)` 返回 false，不再调用 with-trace 登记接口。
- 缺少能力字段的旧 feature 等价于全部为 `0`；legacy feature 即使 reclassify 也不得被插件升级中途施加 Trace 门禁。
- 不在原 FeatureState 中内嵌完整 trace/review/checkpoint 数据，只保存路径、SHA-256、revision 和摘要。
- traceability、review batch、checkpoint 和 rollback transaction 各自有独立 JSON schema。
- 状态读取必须区分 legacy feature、不需 Trace 的 light feature、完整 standard feature 和损坏的 standard feature；当前 pointer 缺失或损坏时 fail closed。

## 宿主钩子

Hooks 继续只做强制策略，不推进工作流：

- implementation approval 前继续拦 protected-root 写入。
- 仅 `workflowCapabilities.checkpoints === 1` 时：implementation approval 后若没有 active RU，继续拦截受保护路径写入。
- 仅 `workflowCapabilities.checkpoints === 1` 时：active RU 存在时，受保护写入目标必须属于其 `fileScope`。
- checkpoint 与 rollback 控制文件始终禁止 Agent 直接修改。
- Git 写仍在 logic-complete 前拦截。
- 回撤由 MCP 内部受控文件事务执行，不通过宿主 Bash 绕过 Hook。

## 可观察性

`dev_flow_status` 增加：

- trace coverage：total/current/stale/tombstoned/orphan-node counts；doctor 另列 orphan snapshot
- review：batch、assurance level、pending jobs、blocking findings
- implementation：active RU、最近 checkpoint、剩余 units
- rollback：合法目标、是否存在 open transaction

`status.md` 和交付 manifest 始终是只读投影；`plan-review.md` 仅在 `review: 1` 时是只读生成投影，`review: 0` 的旧 feature 仍按可编辑 artifact 合同完成。

## 测试策略

### 单元测试

- ID、引用、DAG、tombstone 和 coverage 不变量。
- 完整 delta 替换、Core 来源绑定、声明区块哈希与精确 stale 传播。
- 内容寻址 snapshot、artifact + pointer 原子登记、CAS 冲突和提交点前后故障注入。
- `workflowCapabilities` 启动时固定，插件升级不改变旧 feature 合同。
- standard→light、light→standard 与 legacy reclassify。
- TypeScript renderer 的真实 scaffold 输出，以及 editable/generated artifact 互斥。
- pointer 损坏 fail closed、孤儿 snapshot 仅报警和 gate basis 更新。
- review assurance 证据计算、调用方伪造身份不升级保证等级。
- 审查者基线不匹配、审查发现去重、阻塞项处置。
- RU fileScope、checkpoint blob/patch、rollback suffix 计算。
- rollback conflict、事务中断与恢复。

### 路线测试

- standard M/L 在缺失任意 REQ/AC 覆盖时不能进入 approval。
- Trace-only、Review 2a 和 Checkpoint 三个能力组合分别可以独立闭环。
- Trace-only standard M/L 在没有 review batch 和 ImplementationUnitState 时仍可 finalize。
- 默认多视角审查可完成；服务端 sampling 与宿主 attestation 分别产生不同 assurance。
- 风险标签派生正确 reviewer roles。
- 多 RU 实现、checkpoint、回到中间 checkpoint、重新实现并 finalize。

### 双宿主测试

- Claude 与 Codex 对同一 Trace revision 的并发 mutation 触发 CAS，胜出的 snapshot/pointer 可由另一宿主继续读取。
- Claude 创建需求和计划，Codex 完成 review jobs 或反向。
- 一端创建 checkpoint，另一端读取 status 并执行合法回撤。
- 两端对同一 revision 的并发 mutation 触发 CAS。

### 文件系统故障测试

- 在 Trace snapshot 写入、fsync、rename、state 提交前后注入失败；提交前不改变 pointer，提交后不伪报回滚。
- 在 rollback transaction 的每个 fsync/rename 阶段注入失败。
- 二进制、新增、删除、重命名和权限变化。
- 用户在 checkpoint 后追加未登记修改时绝不覆盖。

## 分阶段交付

0. **开放决策**：先把路线产物模式、RU 来源、生成投影、核心层强制边界和保证等级词汇固化进总设计与合同测试。
1. **追溯**：为新 feature 固定 `trace: 1, review: 0, checkpoints: 0`；交付 TypeScript 模板、结构化 ID、同构 RU、内容寻址 snapshot、原子 pointer、禁用裸登记、覆盖与精确失效传播；plan-review 仍走旧合同。
2. **审查 2a**：新 feature 固定 `review: 1`；本阶段迁移 plan-review 合同，交付批次、任务、审查发现、处置、生成投影和阻塞门禁；默认保证等级为 `multi-perspective`。
3. **检查点与回撤就绪最小版本**：新 feature 固定 `checkpoints: 1`；此时才启用实现单元完成门禁、无 active RU/范围钩子、内容快照、预览与冲突；不注册回撤执行工具。
4. **4A — 回撤加固**：事务日志、恢复、诊断、独立门禁、执行与故障注入。
5. **4B — 审查增强**：服务端采样、宿主证明、身份/来源与更高保证等级。

4A 与 4B 可以独立排期；每个阶段独立发布并保持上一阶段路线可用，不以三个子系统同时完成作为首次交付前提。
