# Dev Flow 对抗审查任务实施计划

> **执行要求：** 先交付可验证的审查 2a，再独立实施审查 4B。不得把“多角色”直接描述成已经证明的“多代理”。

**目标：** 用不可变批次、结构化审查发现、处置结果、生成投影和阻塞门禁替代 `plan_review` 标记，并让保证等级只由可审计证据计算。

**架构：** MCP/核心层是批次、任务、审查发现、处置结果与保证等级证据的事实源。第 2a 阶段默认执行多视角审查；第 4B 阶段才增加服务端采样、宿主证明和身份来源证明。

**技术栈：** TypeScript、Node.js 内置测试运行器、JSON Schema、现有 MCP server 与 HUMAN GATE。

## 全局约束

- review batch 绑定 requirements、plan、coverage、rollback、traceability、路线、分类、scope 与 protected-root fingerprint。
- review batch 同时绑定 `.dev-flow/project.json` SHA-256，避免验证命令配置变化后复用旧审查。
- reviewer 只能读取 immutable package；提交前不能读取同 batch 的其他 findings。
- 调用方不能写 `assuranceLevel`，也不能用任意字符串把等级升级。
- `review: 1` 的 standard M/L 使用 Core 生成的 `plan-review.md`，它不是可编辑事实源。
- blocking finding 未解决或未接受风险时，Core 必须拒绝 `recordStep(plan_review)`。
- 只有启动时固定 `workflowCapabilities.review === 1` 的 feature 使用本合同；`review: 0` 的 active feature 继续走旧 plan-review artifact/evidence。

## P0 已确定决策（对抗审查收口）

- **唯一 basis：** Core 定义 `ReviewBasis` canonical JSON，`basisHash = sha256(canonicalJson)`。它包含 feature ID、route、冻结 capability、分类/risk labels、`reviewBasisArtifacts`、trace pointer/ledger revision、`project.json` 原始字节 hash、scope manifest hash 和 protected-root fingerprint。调用方不得传入或填充 `basisHash`、`assuranceLevel`、roles 或 depth；`recordStep(plan_review)` 从当前可用 batch 自动派生 evidence。
- **basis artifact 白名单：** 仅 requirements、implementation-plan、coverage-matrix 和 standard L 的 rollback-units 参与。显式排除 status、plan-review、review package/ledger、job 输出和后续 implementation/verification artifacts，防止生成投影自失效；risk-card 若成为审查输入，必须显式纳入白名单并有 stale 测试。
- **不可变存储与失效：** package 和 review ledger/event snapshot 均内容寻址、不可覆盖；state 只经 CAS 保存 current review pointer/索引。claim、submit、stale、risk acceptance 和 successor batch 先写 snapshot 再更新 pointer。所有改变 basis 的 Core 写路径必须在同一 CAS 标 stale；读取和门禁再次 fail-closed 校验。
- **状态与重试：** batch 使用正交字段 `validity: current | stale` 与 `progress: open | complete`；job 为 `pending → claimed → submitted`。claim 租约固定 60 分钟，过期回收为 pending 并使旧 capability 失效。create 按 current basis 幂等，submit 按 job capability + canonical payload hash 幂等，claim 使用高熵 `claimRequestId` 重试键；风险接受 interaction token 单次消费且可幂等重试。
- **角色、隔离与可见性：** Core 从 route、冻结 capability、规范化 risk labels 派生有序去重的 roles/depth；`critical_correctness` 只将全部必需 job 设为 full。claim 签发仅存 hash 的高熵 capability；`get_review_job`/`submit_review_job` 必须出示它。job 未全部提交前，所有无 capability 的读取面只能返回粗粒度进度，不能泄露 sibling findings 或诊断；完成后才公开投影。
- **finding 与风险接受：** Core 生成 scope manifest（current Trace 的 RU `fileScope` 与规范化 protected roots）；拒绝 root 外、遍历、未知或无 evidence 的 blocking finding。finding 在原 batch 不可变；修复后由 successor batch 中相同 role 引用旧 finding 并提交 resolution evidence。风险接受绑定 batch、basis 和排序后的 finding ID+内容 hash 集合，任一变化即失效；不提供“接受全部风险”。
- **路线与投影：** `next` 对 review:1 的 `plan_review` 先导出 `create-review-batch`，随后导出待 claim/submit 状态；仅 current + complete + 无未处置 blocking finding 时导出 `run-step(plan_review)`。create 对同 basis 幂等。`plan-review.md` 永不参与 basis；所有 review mutation 根据 pending state 生成投影，Core review state 是门禁权威，投影故障 fail-closed。

## 第 2a 阶段：批次、审查发现、保证等级、投影与阻塞

### 任务 1：定义审查角色、数据模式与保证等级

**文件：**

- 修改：`plugins/dev-flow/src/policy/types.ts`
- 修改：`plugins/dev-flow/policy/contract.json`
- 修改：`plugins/dev-flow/src/policy/contract.ts`
- 修改：`plugins/dev-flow/src/policy/evidence.ts`
- 新建：`plugins/dev-flow/policy/review.schema.json`
- 新建：`tests/unit/review-policy.test.mjs`
- 修改：`tests/unit/risk-evidence.test.mjs`
- 修改：`tests/unit/next-evidence.test.mjs`

**类型：**

```ts
export type ReviewAssurance =
  | "multi-perspective"
  | "independent-sampling"
  | "multi-agent-attested"
  | "multi-agent-verified";

export type ReviewExecutionMode =
  | "isolated-sequential"
  | "mcp-sampling"
  | "native-subagent";

export type ReviewRole =
  | "requirements-coverage"
  | "architecture-testability"
  | "rollback-operability"
  | "security"
  | "data-irreversibility";

export type ReviewDepth = "standard" | "full";
export type ReviewFindingSeverity = "blocking" | "warning" | "note";
```

**语义：**

| 等级 | 证明条件 |
| --- | --- |
| `multi-perspective` | 同一不可变 package 上完成多个必需角色 |
| `independent-sampling` | 服务端为不同 job 签发不可复用的 sampling request ID |
| `multi-agent-attested` | 宿主提交不同 subagent 的原始 attestation |
| `multi-agent-verified` | 未来可信宿主提供可验证 identity/provenance |

第 2a 阶段只产生 `multi-perspective`。先定义完整枚举是为了 Schema 前向兼容，但不得在 2a 代码中伪造更高等级。

**角色与深度策略：**

- standard M：`requirements-coverage`、`architecture-testability`。
- standard L：上述角色加 `rollback-operability`。
- `security`：增加 `security`。
- `data`、`money`、`irreversible_consequence`：增加 `data-irreversibility`。
- `critical_correctness`：不增加新角色；所有必需 job 使用 `reviewDepth: "full"`，2a assurance 仍为 `multi-perspective`。
- 每个 job 必须提交结构化完成记录、覆盖摘要和 review depth；`findings: []` 合法，不强迫 reviewer 虚构问题。

**plan-review 合同迁移：**

- Task 1 只定义 capability-aware 合同，唯一发布常量暂保持 `{ trace: 1, review: 0, checkpoints: 0, rollbackExecution: 0 }`；Task 2 在能原子创建不可变 review pointer 时才把 `review` 升为 `1`。`startFeature` 始终复制当时常量，绝不回写旧 feature。
- standard M：`plan-review` 从 `absent` 转为 `generated`。
- standard L：`plan-review` 从 `editable` 转为 `generated`。
- `routeDefinitionForFeature` 只对 `review: 1` 应用 transition；旧 feature 继续原合同。
- `requiredEvidenceForStep(plan_review)` 对 `review: 0` 仍要求 `{ reviewType: "plan" }`；对 `review: 1` 要求 `{ batchId, basisHash, assuranceLevel }`。

现有 evidence API 扩展为：

```ts
interface RequiredEvidence {
  fields: {
    reviewType?: "plan" | "code";
    reviewDepth?: "full";
    reviewBatch?: true;
  };
  checks: string[];
  verificationKinds: VerificationKind[];
}

requiredEvidenceForStep(route, riskLabels, step, workflowCapabilities): RequiredEvidence;
```

当 `reviewBatch: true` 时，调用方不提供 batch evidence；Core 仅从 current batch 派生 `{ batchId, basisHash, assuranceLevel }`。`assertReviewComplete` 必须验证 `validity === "current"`、`progress === "complete"`、basis 仍匹配且不存在未处置 blocking finding，不能只做字符串形状检查。

**步骤：**

- [x] 写角色派生、未知角色、重复角色和 Schema 附加字段拒绝测试。
- [x] 写 severity 只能为 `blocking | warning | note` 的闭集测试；中文映射留给 Task 5 生成投影。
- [x] 写 `critical_correctness` 不新增角色、所有 job depth 为 full、空 findings 仍可完成的测试。
- [x] 写 standard M/L 的 plan-review transition 和 active `review: 0` feature 保持旧合同的测试。
- [x] 写 `requiredEvidenceForStep` / `missingRequiredEvidence` 按 review capability 切换字段的测试。
- [x] 写合成 `review: 1` 合同与 `review: 0` active feature 保持旧合同、不可隐式升级的测试；Task 2 再覆盖发布后新 feature 固定 `review: 1`。
- [x] 写 2a 无论提交多少 executor/context 字符串都只能得到 `multi-perspective` 的测试。
- [x] 写调用方不能传入/伪造 roles、depth、basisHash 或 assuranceLevel，且 Core 派生 roles/depth 的测试。
- [x] 运行 `node --test tests/unit/review-policy.test.mjs`，确认红灯。
- [x] 最小实现合同、类型与解析器。
- [x] 提交：`feat(dev-flow): define review jobs and assurance vocabulary`

### 任务 2：实现不可变批次与审查任务生命周期

**文件：**

- 新建：`plugins/dev-flow/src/core/review-jobs.ts`
- 新建：`plugins/dev-flow/src/core/review-store.ts`
- 修改：`plugins/dev-flow/src/core/state-store.ts`
- 修改：`plugins/dev-flow/src/core/artifacts.ts`
- 修改：`plugins/dev-flow/policy/state.schema.json`
- 修改：`plugins/dev-flow/src/hosts/adapter-policy.ts`
- 修改：`plugins/dev-flow/src/mcp/doctor.ts`
- 新建：`tests/unit/review-jobs.test.mjs`
- 修改：`tests/unit/adapter-policy.test.mjs`
- 修改：`tests/unit/doctor.test.mjs`
- 修改：`tests/unit/state-store.test.mjs`
- 修改：`tests/unit/state-schema-contract.test.mjs`

**状态：**

```text
batch.validity: current | stale
batch.progress: open | complete
job: pending → claimed → submitted
finding: open → resolved-in-successor | risk-accepted
```

每个 batch 保存 Core 计算的完整 `ReviewBasis` hash；每个 job 保存 role、review depth、job package hash、结构化完成记录、状态、租约和诊断元数据。package 与 ledger/event 都是内容寻址不可变 snapshot；state 只保存 CAS current pointer/索引。`executorId`、`contextId` 只用于排障，不参与 2a assurance 计算。

**步骤：**

- [ ] 写 immutable package、hash/feature/batch/revision 校验、job 不读取 sibling findings、basis mismatch 与 CAS 测试。
- [ ] 写发布后新 feature 固定 `review: 1`、legacy `review: 0` 可省略 pointer、`review: 1` 缺失或形状错误 pointer fail-closed 的测试。
- [ ] 写重复 create/claim/submit 的幂等语义、claim 60 分钟租约回收、跨 batch job ID 和 stale batch 测试。
- [ ] 运行 `node --test tests/unit/review-jobs.test.mjs`，确认红灯。
- [ ] 实现 batch 创建、job claim/submit 与原子持久化。
- [ ] 从 artifact、with-trace 登记和 reclassify/state 变化调用统一失效准备器；验证任一 basis 写入在同一 CAS 使整批 stale，读取/门禁仍 fail-closed 复核。
- [ ] 让 Hook 与 doctor 读取、校验 review pointer；current snapshot 缺失/篡改必须 fail-closed，未引用 snapshot 仅诊断 warning。
- [ ] 提交：`feat(dev-flow): implement immutable review batches`

### 任务 3：暴露 2a 阶段 MCP 工具，默认执行多视角审查

**文件：**

- 修改：`plugins/dev-flow/src/mcp/server.ts`
- 修改：`tests/unit/mcp-server.test.mjs`

**2a 工具：**

- `dev_flow_create_review_batch`
- `dev_flow_get_review_job`
- `dev_flow_claim_review_job`
- `dev_flow_submit_review_job`

**明确不包含：**

- 不调用 `sampling/createMessage`。
- 不根据 client capability 自动声称独立执行。
- 不允许请求参数包含 `assuranceLevel`。
- 不允许请求参数包含 basis、roles、depth、scope 或 protected roots；claim 仅接受高熵 `claimRequestId`，后续读取/提交必须携带 claim 返回的 capability。

**步骤：**

- [ ] 写工具发现、严格输入 Schema、只读/写入边界与错误映射测试。
- [ ] 写 capability 隔离、claimRequestId 重试、未完成 batch 的旁路读取不泄露 sibling findings，以及拒绝 caller-supplied basis/assurance/roles/depth 测试。
- [ ] 写恶意传入不同 `executorId/contextId` 仍不能升级 assurance 的测试。
- [ ] 运行 `node --test tests/unit/mcp-server.test.mjs`，确认红灯。
- [ ] 接入 Core API；默认 `executionMode` 为 `isolated-sequential`。
- [ ] 提交：`feat(dev-flow): expose review batch tools`

### 任务 4：聚合审查发现、处理处置结果并阻塞阶段推进

**文件：**

- 修改：`plugins/dev-flow/src/core/review-jobs.ts`
- 修改：`plugins/dev-flow/src/core/user-interactions.ts`
- 修改：`plugins/dev-flow/src/core/human-gates.ts`
- 修改：`plugins/dev-flow/src/core/feature-check.ts`
- 修改：`plugins/dev-flow/src/core/step-order.ts`
- 新建：`tests/unit/review-findings.test.mjs`

**Finding 最小字段：**

```ts
interface ReviewFinding {
  findingId: string;
  jobId: string;
  severity: "blocking" | "warning" | "note";
  category: ReviewFindingCategory;
  targets: string[];
  evidence: Array<{ path: string; line?: number }>;
  claim: string;
  recommendation: string;
}
```

**关闭 blocking finding 的唯一方式：**

1. 修改 basis，创建 successor batch；同一 role 的新 job 引用旧 finding ID 并提交 resolution evidence。
2. 用户通过独立风险接受交互确认，并保存当前 batch/basis/finding 内容 provenance。

原 batch 的 finding 不可原地改写；任何 basis、finding 或 disposition 变化都会使旧风险接受失效。

**步骤：**

- [ ] 写去重不降级 severity、scope manifest 外 target/路径遍历/缺 evidence、伪造 disposition 和旧 gate response 测试。
- [ ] 写 successor batch resolution evidence、风险接受绑定精确 finding 集合且不可重放/扩展的测试。
- [ ] 写 findings 为空但结构化完成记录完整时 job 可提交；缺完成记录时不可提交的测试。
- [ ] 写 `recordStep(plan_review)` 在缺角色、batch stale 或存在 blocking finding 时拒绝的测试。
- [ ] 运行 `node --test tests/unit/review-findings.test.mjs`，确认红灯。
- [ ] 实现聚合、disposition、风险接受交互与 `assertReviewComplete`。
- [ ] 将 `{ batchId, basisHash, assuranceLevel }` 作为 plan review evidence。
- [ ] 提交：`feat(dev-flow): gate plan review on structured findings`

### 任务 5：生成只读计划审查投影并同步状态

**文件：**

- 修改：`plugins/dev-flow/src/core/artifacts.ts`
- 修改：`plugins/dev-flow/src/core/status.ts`
- 修改：`plugins/dev-flow/src/core/next.ts`
- 修改：`plugins/dev-flow/src/core/gate-basis.ts`
- 修改：`plugins/dev-flow/src/policy/types.ts`
- 修改：`plugins/dev-flow/src/policy/derive-next.ts`
- 新建：`plugins/dev-flow/src/core/review-projection.ts`
- 修改：`plugins/dev-flow/skills/plan-review/SKILL.md`
- 修改：`plugins/dev-flow/skills/status/SKILL.md`
- 删除：`plugins/dev-flow/templates/plan-review.md`（生成投影不读取静态模板）
- 修改：`tests/unit/status-progress.test.mjs`
- 修改：`tests/unit/skills.test.mjs`
- 修改：`tests/unit/derive-next.test.mjs`
- 修改：`tests/unit/next-evidence.test.mjs`

**投影内容：**

- batch ID 与 basis hash。
- 当前 assurance 及其证据类型。
- 必需角色、job 状态和诊断执行信息。
- findings、dispositions 与未解决 blocking 数量。
- 降级说明和 stale 状态。

**步骤：**

- [ ] 写 `review: 1` 的 standard M/L 都自动生成投影的测试。
- [ ] 写 `review: 1` 手工 `recordArtifact(plan-review)` 返回 `GENERATED_ARTIFACT_READ_ONLY`，而 `review: 0` active feature 仍可按旧合同登记的测试。
- [ ] 写 basis 变化后投影和 approval 同时 stale 的测试。
- [ ] 写投影不进入 ReviewBasis、review state 为门禁权威且投影故障 fail-closed 的测试。
- [ ] 写 next 依次导出 `create-review-batch`、待 claim/submit 状态，并只在 current+complete+无未处置 blocking 时导出 `run-step(plan_review)` 的测试。
- [ ] 写 `StatusView`/Markdown 的预完成粗粒度可见性、完成后的完整投影，以及 gate basis 绑定 current review pointer 的测试。
- [ ] 更新 Skills：只编排 job，不手写投影、不自行判断保证等级。
- [ ] 运行 status、Skills 与 artifact 测试。
- [ ] 提交：`feat(dev-flow): generate review projection and status`

### 任务 6：完成 2a 路线与跨宿主验收

**文件：**

- 修改：`tests/helpers/route-flow.mjs`
- 修改：`tests/e2e/routes/standard-m.test.mjs`
- 修改：`tests/e2e/routes/standard-l.test.mjs`
- 修改：`tests/e2e/cross-host/claude-to-codex.test.mjs`
- 修改：`tests/e2e/cross-host/codex-to-claude.test.mjs`
- 修改：`docs/architecture.md`
- 修改：`docs/routes.md`
- 修改：`README.md`

**验收场景：**

- standard M/L 自动派生不同角色集合。
- 不同宿主可领取不同 job，但 2a 投影仍准确标为 `multi-perspective`。
- blocking finding 阻止 approval，修订或风险接受后可继续。
- requirements/plan/trace hash 变化使 batch、投影和 approval 一起 stale。
- 不完整 batch 的跨宿主读取不泄露 sibling findings；claim 超时和 MCP 重试不会重复提交或永久阻塞路线。
- Review 2a 发布前已启动的 `review: 0` feature 在升级后仍使用旧 plan-review artifact 和 `{ reviewType: "plan" }` 完成，不发生中途迁移。

**步骤：**

- [ ] 更新路线 helper，禁止直接注入完成状态。
- [ ] 运行两条路线与双向跨宿主 E2E。
- [ ] 更新中文文档，明确“多视角不等于已证明多代理”。
- [ ] 运行全量测试、类型检查、构建和 `git diff --check`。
- [ ] 提交：`feat(dev-flow): complete review phase 2a`

## 第 4B 阶段：采样、身份与来源证明增强

### 任务 7：增加服务端采样证据

**文件：**

- 修改：`plugins/dev-flow/src/mcp/server.ts`
- 修改：`plugins/dev-flow/src/core/review-jobs.ts`
- 修改：`plugins/dev-flow/policy/review.schema.json`
- 新建：`tests/unit/review-sampling.test.mjs`

**规则：**

- Core 为每个 job 签发 server-owned、单次使用的 request ID。
- 每次 `sampling/createMessage` 只包含该 job 的 immutable package，不包含 sibling 输出。
- 响应通过与普通 submit 相同的 finding validator。
- 至少两个不同 job 具有有效且不同的 sampling request provenance 时，计算为 `independent-sampling`。
- sampling 失败时 job 保持 pending，不静默标记完成。

**步骤：**

- [ ] 写 request ID 重放、伪造、跨 batch 复用和部分失败测试。
- [ ] 写 caller-supplied request ID 不能升级 assurance 的测试。
- [ ] 实现 sampling 请求、provenance 持久化与等级计算。
- [ ] 提交：`feat(dev-flow): add independently sampled reviews`

### 任务 8：增加宿主证明，并为可信身份留接口

**文件：**

- 修改：`plugins/dev-flow/src/hosts/adapter-policy.ts`
- 修改：`plugins/dev-flow/src/core/review-jobs.ts`
- 修改：`plugins/dev-flow/src/core/status.ts`
- 新建：`tests/unit/review-identity.test.mjs`
- 修改：`docs/architecture.md`
- 修改：`README.md`

**规则：**

- 普通宿主提供的 subagent 证明最多得到 `multi-agent-attested`。
- 原始 attestation、宿主类型、签发时间与关联 job 必须持久化。
- `multi-agent-verified` 仅预留 verifier 接口；没有可信 verifier 时不可产生该值。
- 最终投影同时显示 assurance 和证据来源，避免把 attested 写成 verified。

**步骤：**

- [ ] 写相同 attestation 重用、调用方自报 verified 和未知宿主测试。
- [ ] 实现 attestation validator 与投影。
- [ ] 运行 2a 全量回归，确认无 sampling/attestation 时仍可按 `multi-perspective` 工作。
- [ ] 运行全量测试、构建与 `git diff --check`。
- [ ] 提交：`feat(dev-flow): attest review agent provenance`

## 完成条件

- Review 2a 独立可发布，默认且诚实地报告 `multi-perspective`。
- plan-review 的 editable/absent→generated 迁移只作用于 `review: 1` feature，旧 active feature 不受影响。
- 角色、review depth、severity 和 required evidence 均有唯一协议枚举与合同测试。
- batch、findings、dispositions、blocking 和生成投影均由 Core 强制。
- 任意 caller 字符串都不能提升 assurance。
- 4B 的 sampling 与 attestation 有服务端证据、重放保护和清晰的等级边界。
