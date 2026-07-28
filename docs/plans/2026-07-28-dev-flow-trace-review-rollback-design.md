# Dev Flow 追溯账本、对抗审查与回撤单元设计

## 背景

Dev Flow v1.7.0 已经具备持久状态、路线顺序、Markdown artifact 哈希、HUMAN GATE、验证新鲜度、交付快照与宿主 Hook 门禁。当前限制是：

1. requirements、plan、coverage 与 rollback 的语义关系主要依赖 Agent 自觉，Core 只验证步骤、artifact 完整性与少量 evidence 字段。
2. `plan_review` 是一个流程插槽，不会创建、隔离或审计多个 reviewer。
3. `rollback_unit` 是计划证据，不是实现期间可执行的 checkpoint；现有反向 patch 只在 finalize 时生成，粒度为整个 feature。

本设计采用“实用型工作流增强”：Core 保证结构、引用、基线、独立执行事实和回撤安全；Agent 与人类继续负责语义质量。设计为未来更强的自动语义检查预留接口，但不在本阶段声称机器已经证明需求或计划正确。

## 目标

1. 建立 `REQ/AC → TASK → TEST/RU` 的可审计追溯链。
2. 让 `plan_review` 在宿主能力允许时成为真实多代理审查，并在能力不足时明确降级为多视角审查。
3. 让计划中的 rollback unit 成为实现阶段可确认、可预览、可安全执行的 checkpoint。
4. 保持 Claude Code 与 Codex CLI 双宿主、风险比例路线和现有 HUMAN GATE 语义。
5. 现有 active feature 可以按旧合同完成，不要求中途迁移。

## 非目标

- Core 不判断自然语言需求是否合理，也不判断某个测试是否足以证明业务语义。
- 不允许 arbitrary graph rollback；首版只允许回到某个已确认 checkpoint，并逆序撤销其后的完整后缀。
- 不要求所有宿主具备 subagent；能力不足时允许带降级标识的串行多视角审查。
- 不以 Git commit、`git reset --hard` 或修改用户当前分支作为实现 checkpoint。
- 不在本阶段把 TDD 变成新的全局路线步骤。

## 总体架构

保留现有 Markdown artifact 作为人类叙述层，新增 MCP 管理的机器追溯账本：

```text
requirements.md ─┐
plan.md           ├─→ traceability.json
coverage.md       │      REQ → TASK → TEST → RU
review reports  ──┘      TASK → review jobs/findings
                         RU → checkpoint/patch/verification
```

`traceability.json` 只能由 MCP 更新。每个机器节点都绑定来源 artifact 及其 SHA-256。Markdown 更新后，Core 依据来源哈希传播 stale，而不是删除历史结果。

为避免双主状态，人工维护的 artifact 与其 trace index 必须在同一个 MCP 事务中登记。

## 一、需求固化链

### 标识符

| 类型 | 格式 | 含义 |
| --- | --- | --- |
| Requirement | `REQ-001` | 功能或约束需求 |
| Acceptance Criterion | `AC-001` | 隶属于某个 REQ 的验收条件 |
| Plan Task | `TASK-001` | 实现计划任务 |
| Test Scenario | `TEST-001` | 自动或人工验证场景 |
| Rollback Unit | `RU-001` | 一个可 checkpoint 的计划任务集合 |

ID 在一个 feature 内稳定且不可复用。删除节点保留 tombstone，防止旧 evidence 在新含义下重新生效。

### 账本模型

示意：

```json
{
  "schemaVersion": 1,
  "featureId": "feature-id",
  "revision": 3,
  "nodes": {
    "TASK-001": {
      "kind": "task",
      "sourceArtifact": "implementation-plan",
      "sourceSha256": "sha256",
      "covers": ["REQ-001", "AC-001"],
      "rollbackUnit": "RU-001",
      "status": "current"
    }
  },
  "edges": [
    { "from": "TASK-001", "type": "covers", "to": "REQ-001" }
  ]
}
```

Feature state 只保存 traceability 文件路径、SHA-256、revision 与摘要，不复制完整图。

### 原子登记

新增等价于下列语义的 MCP 操作：

```text
dev_flow_record_artifact_with_trace
```

输入包含 artifact kind、expected revision 和结构化 trace delta。事务必须：

1. 读取当前已 scaffold 的 artifact。
2. 计算当前 SHA-256。
3. 校验 ID 格式、唯一性、tombstone 与引用。
4. 校验每个声明的 ID 在当前 Markdown 中恰好出现一次。
5. 将 artifact registration 与 traceability 更新原子提交。
6. 传播 gate、review、checkpoint 与下游 step 的 stale 状态。

普通非追溯 artifact 可以继续使用原 `record_artifact`；参与追溯的 artifact 在新 feature 上必须使用原子接口。

### Core 不变量

进入 implementation approval 前必须满足：

- 每个 current `REQ` 至少被一个 current `TASK` 覆盖。
- 每个 current `AC` 隶属一个 current `REQ`，并至少对应一个 current `TEST`。
- 每个 `TASK` 至少引用一个 `REQ` 或 `AC`，不存在孤儿任务。
- standard M/L 的每个 `TASK` 都关联一个 `RU`。
- 所有边的两端存在、current 且基于当前 artifact hash。
- 不存在重复 ID、悬空引用或 stale coverage。

Feature-check 在 finalize 前再次检查同一组不变量，防止旧状态或旁路调用绕过首次校验。

### 失效传播

失效采用“保留历史、标记 stale”：

```text
requirements hash 变化
→ requirement gate stale
→ 引用相关 REQ/AC 的 TASK、TEST、RU stale
→ coverage review / plan review stale
→ implementation approval stale
```

计划或 rollback artifact 变化不反向使 requirements gate stale，但会使相应 coverage、review、approval 和尚未执行的 checkpoint stale。

## 二、能力自适应的多代理对抗审查

### Review batch

`plan_review` 开始时，MCP 创建不可变 review batch。Basis 包含：

- requirements、implementation plan、coverage 与 rollback artifact SHA-256
- traceability SHA-256
- route、classification、risk labels 与 scope
- protected-root fingerprint

每个 review job 记录：

```json
{
  "jobId": "PRJ-ARCH-001",
  "role": "architecture",
  "basisHash": "sha256",
  "status": "pending",
  "executionMode": "native-subagent",
  "executorId": null,
  "contextId": null
}
```

Reviewer 在提交前只能读取 immutable review package，不能读取同 batch 的其他 findings。

### 角色选择

角色按路线与风险派生，不固定启动四个 reviewer：

| 条件 | 必需角色 |
| --- | --- |
| standard M | requirement coverage、architecture/testability |
| standard L | 上述角色 + rollback/operability |
| `security` | security |
| `data` / `money` / `irreversible_consequence` | data and irreversible consequences |
| `critical_correctness` | full independent review |

角色映射应进入 policy contract，Skill 不复制风险映射。

### 能力自适应

执行优先级：

1. MCP client sampling：由 MCP 发起隔离 reviewer 调用。
2. 宿主 subagent：Skill 按 job 分派独立 Agent。
3. 无上述能力：基于不可变 package 串行执行多视角审查。

只有至少两个 job 由不同 `executorId/contextId` 完成时，batch 才能标记：

```text
assuranceLevel: multi-agent
```

否则必须标记：

```text
assuranceLevel: multi-perspective
```

路线可以在能力不足时继续，但 status、plan review 投影和最终交付必须显示降级，不得声称完成多代理审查。

### Findings

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

聚合器可以去重，但不能降低 blocking 严重度。Blocking finding 只能通过以下路径关闭：

1. 修改 basis artifact，生成新 basis 并重审。
2. 原 reviewer 或同角色新 reviewer 对修订明确标记 resolved。
3. 用户通过独立风险接受交互确认，保存 provenance。

### 状态转换

```text
create batch
→ execute independent jobs
→ submit findings
→ aggregate
→ resolve/accept blocking findings
→ record plan_review
→ present implementation approval
```

首版中任一 basis artifact 改变会使整批 stale。局部 reviewer 复用留作后续优化。

`plan-review.md` 改为生成投影；机器权威为 batch、jobs、findings 与 dispositions。

## 三、计划任务级 checkpoint 与精确回撤

### Rollback unit 定义

每个 RU 至少包含：

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

### Implementation 子状态机

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
- `dev_flow_present_rollback_gate`
- `dev_flow_execute_rollback`

开始单元前校验其依赖、basis 和 approval。Checkpoint 前校验实际修改文件属于 RU 的 `fileScope`；超出范围必须修改计划并重新完成受影响的 coverage、review 与 approval。

### Checkpoint 内容

每个 checkpoint 保存：

- 开始与结束 fingerprint
- 实际修改文件
- before/after SHA-256
- 新增、删除、重命名、权限变化
- 内容寻址的 before/after blobs
- forward/reverse patch
- verification attempts
- requirements、plan 与 traceability basis hash

Checkpoint 资产位于 feature 目录内，由 MCP 生成和管理，Agent 不可直接编辑。

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
| `TRACE_ID_INVALID` | ID 格式非法 |
| `TRACE_ID_DUPLICATE` | ID 重复或 tombstone 被复用 |
| `TRACE_REFERENCE_DANGLING` | 引用不存在 |
| `TRACE_COVERAGE_INCOMPLETE` | REQ/AC/TASK/TEST/RU 不变量不满足 |
| `TRACE_BASIS_STALE` | 来源 artifact 已变化 |
| `REVIEW_CAPABILITY_DEGRADED` | 只能完成多视角审查 |
| `REVIEW_JOB_BASIS_MISMATCH` | reviewer 提交基于旧 package |
| `REVIEW_BLOCKING_FINDINGS` | 仍有未处理 blocking finding |
| `IMPLEMENTATION_UNIT_OUT_OF_SCOPE` | 修改文件超出 RU fileScope |
| `CHECKPOINT_VERIFICATION_FAILED` | 单元验证失败 |
| `ROLLBACK_TARGET_INVALID` | 目标不是合法 checkpoint |
| `ROLLBACK_CONFLICT` | 当前文件存在未登记修改 |
| `ROLLBACK_TRANSACTION_OPEN` | 上次回撤事务需要恢复或续办 |

所有失败必须保持 revision、artifact registration 和文件系统的一致性；涉及文件恢复的错误必须可由 doctor 报告并续办。

## 状态与 Schema 演进

- 现有 active feature 保持 legacy 模式并按旧合同完成。
- 新启动的 standard M/L feature 写入 `traceabilityVersion: 1`。
- 不在原 FeatureState 中内嵌完整 trace/review/checkpoint 数据，只保存路径、SHA-256、revision 和摘要。
- traceability、review batch、checkpoint 和 rollback transaction 各自有独立 JSON schema。
- 状态读取必须区分 legacy feature、完整新 feature 和损坏的新 feature；缺失必要 sidecar 时 fail closed。

## Hooks

Hooks 继续只做强制策略，不推进工作流：

- implementation approval 前继续拦 protected-root 写入。
- active RU 存在时，受保护写入目标必须属于其 `fileScope`。
- checkpoint 与 rollback 控制文件始终禁止 Agent 直接修改。
- Git 写仍在 logic-complete 前拦截。
- 回撤由 MCP 内部受控文件事务执行，不通过宿主 Bash 绕过 Hook。

## 可观察性

`dev_flow_status` 增加：

- trace coverage：total/current/stale/orphan counts
- review：batch、assurance level、pending jobs、blocking findings
- implementation：active RU、最近 checkpoint、剩余 units
- rollback：合法目标、是否存在 open transaction

`status.md`、`plan-review.md` 和交付 manifest 是只读投影，不作为机器事实源。

## 测试策略

### 单元测试

- ID、引用、DAG、tombstone 和 coverage 不变量。
- artifact + trace 原子登记与 CAS 冲突。
- 精确 stale 传播和 gate basis 更新。
- review capability negotiation、executor 独立性与 assurance level。
- reviewer basis mismatch、finding 去重、blocking disposition。
- RU fileScope、checkpoint blob/patch、rollback suffix 计算。
- rollback conflict、事务中断与恢复。

### 路线测试

- standard M/L 在缺失任意 REQ/AC 覆盖时不能进入 approval。
- multi-agent 与 multi-perspective 两种能力路径都能完成，但产生不同 assurance。
- 风险标签派生正确 reviewer roles。
- 多 RU 实现、checkpoint、回到中间 checkpoint、重新实现并 finalize。

### 双宿主测试

- Claude 创建需求和计划，Codex 完成 review jobs 或反向。
- 一端创建 checkpoint，另一端读取 status 并执行合法回撤。
- 两端对同一 revision 的并发 mutation 触发 CAS。

### 文件系统故障测试

- 在 rollback transaction 的每个 fsync/rename 阶段注入失败。
- 二进制、新增、删除、重命名和权限变化。
- 用户在 checkpoint 后追加未登记修改时绝不覆盖。

## 分阶段交付

1. **Traceability**：结构化 ID、sidecar、原子登记、coverage 与 stale 传播。
2. **Review jobs**：review batch、能力自适应、findings、assurance 与 gate 集成。
3. **Rollback checkpoints**：implementation units、内容快照、事务回撤与恢复。

每个阶段独立发布并保持上一阶段的路线可用；不以三个子系统同时完成作为首次交付前提。
