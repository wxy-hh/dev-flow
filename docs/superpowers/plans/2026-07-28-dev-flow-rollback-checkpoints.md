# Dev Flow 检查点与回撤实施计划

> **执行要求：** 第 3 阶段只交付回撤就绪能力；事务恢复完成前，不得注册或暴露实际回撤执行工具。

**目标：** 把追溯阶段定义的 RU 变成实现期可确认、可预览、可检测冲突的检查点，并在第 4A 阶段加入可恢复事务后安全执行后缀回撤。

**架构：** 路线仍只有一个 `implementation` 步骤，核心层在内部管理 RU 子状态机。检查点保存内容寻址数据块与前后元数据；回撤只允许恢复到已确认边界，并逆序撤销其后的完整后缀。

**技术栈：** TypeScript、Node.js 内置测试运行器、现有 MCP server、宿主 Hook、JSON Schema、文件系统原子操作。

## 全局约束

- 直接消费 Trace 账本中的 `RollbackNode`，不得再定义一份字段不同的 RU。
- standard M 的 RU 来源是 `implementation-plan`，standard L 的来源是 `rollback-units`；生命周期代码不区分来源。
- 只有启动时固定 `workflowCapabilities.checkpoints === 1` 的新 feature 启用 unit lifecycle、scope Hook 和 implementation checkpoint 门禁；旧 active feature 不在升级中途迁移。
- 不使用 Git commit、`git reset --hard` 或修改用户分支作为 checkpoint。
- 当前 hash 与 checkpoint chain tip 不一致时返回 `ROLLBACK_CONFLICT`，绝不覆盖用户未登记修改。
- checkpoint、blob、transaction 与 recovery 文件均为 MCP 所有的控制文件。
- 第 3 阶段不包含 `dev_flow_present_rollback_gate` 和 `dev_flow_execute_rollback`。
- RU 的 forward/rollback verification 字段是 `.dev-flow/project.json` command ID；checkpoint 与 preview basis 必须绑定 project config SHA-256 和解析后的命令定义摘要。

## 第 3 阶段：检查点与回撤就绪最小版本

### 任务 1：定义实现单元与检查点数据模式

**文件：**

- 修改：`plugins/dev-flow/src/policy/types.ts`
- 新建：`plugins/dev-flow/policy/checkpoint.schema.json`
- 新建：`tests/unit/rollback-policy.test.mjs`

**消费：** Trace 计划中已经稳定的 `RollbackNode`。

**新增状态：**

```ts
interface ImplementationUnitState {
  unitId: string;
  status: "pending" | "active" | "verified" | "checkpointed" | "rolled_back";
  basisHash: string;
  startedFingerprint?: string;
  checkpointId?: string;
}
```

`CheckpointManifest` 至少包含 checkpoint/unit ID、顺序、basis hash、开始/结束 fingerprint、文件元数据、blob/patch hash、verification attempts 与时间戳。

`RollbackNode.status` 继续表示定义的新鲜度；`ImplementationUnitState.status` 才表示运行时生命周期。两套状态通过 `unitId` 关联，不能相互覆盖。

**步骤：**

- [x] 写缺失 RU 字段、无效状态转换、重复 checkpoint ID 和未知 unit 测试。
- [x] 写 standard M/L 的同构 `RollbackNode` 都能生成 `ImplementationUnitState` 的测试。
- [x] 运行 `node --test tests/unit/rollback-policy.test.mjs`，确认红灯。
- [x] 添加状态和 checkpoint Schema，不复制 RU interface。
- [x] 提交：`feat(dev-flow): define implementation checkpoint schema`

### 任务 2：实现单元生命周期，并在核心层和宿主钩子层限制写入

**文件：**

- 新建：`plugins/dev-flow/src/core/implementation-units.ts`
- 修改：`plugins/dev-flow/src/core/state-store.ts`
- 修改：`plugins/dev-flow/src/core/feature-check.ts`
- 修改：`plugins/dev-flow/src/core/step-order.ts`
- 修改：`plugins/dev-flow/src/hosts/adapter-policy.ts`
- 新建：`tests/unit/implementation-units.test.mjs`
- 修改：`tests/unit/adapter-policy.test.mjs`

**状态转换：**

```text
pending → active → verified → checkpointed
                       └────→ active（验证失败）
checkpointed → rolled_back（仅第 4A）
```

**fail-closed 规则：**

- 第 3 阶段把唯一发布常量更新为 `{ trace: 1, review: 1, checkpoints: 1, rollbackExecution: 0 }`；只影响此后启动的 feature。
- `begin` 前校验依赖 RU 已 checkpoint、trace/review/approval basis 最新，且不存在其他 active RU；`review: 1` 的“review 最新”表示存在 current complete batch，`multi-perspective` 已足够。
- Core 在 implementation approval 后没有 active RU 时返回 `IMPLEMENTATION_UNIT_REQUIRED`；宿主 Hook 映射为 `DEV_FLOW_IMPLEMENTATION_UNIT_REQUIRED`。
- Core 在 active RU 范围外写入时返回 `IMPLEMENTATION_UNIT_OUT_OF_SCOPE`；宿主 Hook 映射为 `DEV_FLOW_IMPLEMENTATION_UNIT_OUT_OF_SCOPE`。
- `recordStep(implementation)` 在任一 RU 未 checkpoint 时返回 `IMPLEMENTATION_UNITS_INCOMPLETE`。
- CLI、MCP、Claude Hook 与 Codex Hook 必须调用同一 Core 判断。
- 上述规则仅在 `checkpoints: 1` 时启用；`checkpoints: 0` feature 继续使用旧 implementation 合同。

**步骤：**

- [x] 写依赖未完成、双 active、basis stale、无 active RU 写入和越界写入测试。
- [x] 写直接调用 Core 的旁路测试，证明规则不依赖 implement Skill。
- [x] 写阶段 3 发布前已启动的 `checkpoints: 0` feature 在升级后仍可不创建 unit 状态完成 implementation 的测试。
- [x] 写阶段 3 发布后新 feature 固定 `checkpoints: 1`，旧 feature capability 不变且不可隐式升级的测试。
- [x] 运行相关单元测试，确认红灯。
- [x] 实现 `beginImplementationUnit`、状态转换与 Hook policy。
- [x] 验证 legacy feature 与 approval 前写入规则不回归。
- [x] 提交：`feat(dev-flow): enforce implementation unit lifecycle`

### 任务 3：创建内容寻址检查点

**文件：**

- 新建：`plugins/dev-flow/src/core/checkpoints.ts`
- 修改：`plugins/dev-flow/src/core/implementation-units.ts`
- 修改：`plugins/dev-flow/src/core/verification.ts`
- 新建：`tests/unit/checkpoints.test.mjs`
- 修改：`tests/unit/verification-artifact.test.mjs`

**接口：**

- `checkpointImplementationUnit`
- `readCheckpoint`
- `checkpointChain`
- `blobPath`

Blob 路径：

```text
.dev-flow/features/<id>/checkpoints/blobs/<sha256>
```

**记录内容：**

- 开始与结束 fingerprint。
- 新增、修改、删除、重命名和权限变化。
- 每个文件的 before/after SHA-256 与内容 blob。
- forward/reverse patch hash。
- forward verification 命令、attempt ID 与结果。
- requirements、plan、traceability 与 approval basis hash。
- `.dev-flow/project.json` SHA-256、实际解析的 command ID 与命令定义摘要。

**步骤：**

- [x] 写文本、二进制、新增、删除、重命名、chmod 与相同 blob 去重测试。
- [x] 写 scope 外改动、验证失败、写 manifest 中断和 hash mismatch 测试。
- [x] 写未知 command ID、同 ID 命令定义变化和 project config digest 变化导致 checkpoint 拒绝的测试。
- [x] 运行 `node --test tests/unit/checkpoints.test.mjs`，确认红灯。
- [x] 复用 verification command runner；失败时 unit 保持 active 且不产生 confirmed manifest。
- [x] 使用临时文件、fsync 与 atomic rename 写 blob/manifest。
- [x] 运行 checkpoint 与 verification 回归测试。
- [x] 提交：`feat(dev-flow): create content addressed checkpoints`

### 任务 4：实现回撤预览与冲突检测

**文件：**

- 新建：`plugins/dev-flow/src/core/rollback.ts`
- 修改：`plugins/dev-flow/src/core/status.ts`
- 修改：`plugins/dev-flow/src/core/next.ts`
- 新建：`tests/unit/rollback-preview.test.mjs`

**预览规则：**

- 目标必须是 confirmed checkpoint。
- 只允许撤销目标后的完整后缀，不允许抽掉中间依赖。
- 撤销顺序为确定性的逆拓扑序。
- 折叠 checkpoint file records，计算每个文件的最终恢复状态。
- 逐文件校验当前状态等于 chain tip；任一冲突使整个预览失败。
- 校验当前 project config SHA-256 和命令定义摘要与 checkpoint basis 一致。
- 生成 preview basis hash，但第 3 阶段不创建 HUMAN GATE。

示例：RU-001、RU-002、RU-003 均已确认，预览回到 RU-001 时，撤销顺序必须是 `[RU-003, RU-002]`。

**步骤：**

- [x] 写合法后缀、非法目标、依赖中洞、文件冲突和旧 basis 测试。
- [x] 运行 `node --test tests/unit/rollback-preview.test.mjs`，确认红灯。
- [x] 实现 `previewRollback`，只返回计划，不修改工作区或状态。
- [x] status 显示合法目标、冲突摘要和 checkpoint chain。
- [x] 提交：`feat(dev-flow): preview checkpoint rollback`

### 任务 5：只暴露第 3 阶段安全工具并更新技能

**文件：**

- 修改：`plugins/dev-flow/src/mcp/server.ts`
- 修改：`plugins/dev-flow/skills/implement/SKILL.md`
- 修改：`plugins/dev-flow/skills/rollback-safety/SKILL.md`
- 修改：`plugins/dev-flow/skills/status/SKILL.md`
- 修改：`tests/unit/mcp-server.test.mjs`
- 修改：`tests/unit/status-progress.test.mjs`
- 修改：`tests/unit/skills.test.mjs`

**第 3 阶段工具：**

- `dev_flow_begin_implementation_unit`
- `dev_flow_checkpoint_implementation_unit`
- `dev_flow_preview_rollback`

三个工具都必须拒绝 `checkpoints: 0` feature；该 feature 继续通过旧 `dev_flow_record_step(implementation)` 完成路线。

**负向合同：**

- 工具列表中不存在 `dev_flow_present_rollback_gate`。
- 工具列表中不存在 `dev_flow_execute_rollback`。
- rollback-safety Skill 只能预览并说明当前尚不可执行，不能通过 Bash 自行恢复文件。

**步骤：**

- [x] 写工具发现、严格输入 Schema、状态输出和 execute 工具不存在的测试。
- [x] 更新 implement Skill：begin → 仅改 scope → checkpoint → 下一 RU → 全部完成后 record implementation。
- [x] 更新 status：显示 active RU、最近 checkpoint、剩余 units 与合法预览目标。
- [x] 运行 MCP、status 与 Skills 测试。
- [x] 提交：`feat(dev-flow): expose rollback readiness workflow`

### 任务 6：保护控制文件并验收第 3 阶段

**文件：**

- 修改：`plugins/dev-flow/src/hosts/adapter-policy.ts`
- 修改：`tests/unit/adapter-policy.test.mjs`
- 新建：`tests/e2e/routes/standard-m-checkpoints.test.mjs`
- 新建：`tests/e2e/cross-host/checkpoint-preview.test.mjs`
- 修改：`docs/architecture.md`
- 修改：`docs/routes.md`
- 修改：`README.md`

**验收场景：**

- 三个 RU 依次 begin/checkpoint，未 begin 写入和 scope 外写入均失败。
- Claude checkpoint RU-001，Codex 读取同一 revision 并 checkpoint RU-002。
- 回撤预览准确列出后缀与文件，但任何宿主都找不到 execute 工具。
- 直接或 Bash 写 checkpoint manifests、blobs 和控制目录返回 `DEV_FLOW_STATE_MUTATION_FORBIDDEN`。
- 阶段 3 发布前已启动的 feature 升级后仍按 `checkpoints: 0` 完成，不触发无 active RU 门禁。

**步骤：**

- [x] 增加双路线/跨宿主 E2E 与 Hook 负向测试。
- [x] 更新中文文档，明确第 3 阶段是”回撤就绪”而非”可执行回撤”。
- [x] 运行全量测试、类型检查、构建与 `git diff --check`。
- [x] 提交：`feat(dev-flow): complete checkpoint readiness mvp`

## 第 4A 阶段：事务回撤与恢复加固

第 4A 发布后启动的新 feature 固定 `rollbackExecution: 1`。此前已经启动的 `rollbackExecution: 0` feature 可以继续 checkpoint 和 preview，但不能在升级中途获得 execute 权限；未来若需要迁移，必须设计显式 MCP 迁移事务。

本阶段把唯一发布常量更新为 `{ trace: 1, review: 1, checkpoints: 1, rollbackExecution: 1 }`。

### 任务 7：定义回撤事务、独立 HUMAN GATE 与恢复协议

**文件：**

- 新建：`plugins/dev-flow/policy/rollback-transaction.schema.json`
- 修改：`plugins/dev-flow/src/core/rollback.ts`
- 修改：`plugins/dev-flow/src/core/state-store.ts`
- 修改：`plugins/dev-flow/src/core/user-interactions.ts`
- 修改：`plugins/dev-flow/src/core/gate-basis.ts`
- 新建：`tests/unit/rollback-gate.test.mjs`

**规则：**

- 先根据当前 chain 重新生成 preview 与 basis hash。
- 只有 `checkpoints: 1` 且 `rollbackExecution: 1` 才能展示或确认回撤门禁。
- 展示独立 `ROLLBACK_CONFIRMATION` HUMAN GATE。
- 用户响应必须来自后续交互，且绑定 feature、target、preview basis 与 revision。
- 旧响应、其他 gate 响应、修改后的工作区和过期 preview 均不能执行。

**步骤：**

- [x] 写同消息自批、响应重放、basis 改变和 target 替换测试。
- [x] 写第 4A 发布后新 feature 固定 `rollbackExecution: 1`，既有 `rollbackExecution: 0` feature 仍不能展示 gate 的测试。
- [x] 定义 transaction phases 与恢复所需全部字段。
- [x] 实现 `presentRollbackGate`，仍不修改文件。
- [x] 提交：`feat(dev-flow): gate checkpoint rollback execution`

### 任务 8：实现可续办的文件事务与补偿恢复

**文件：**

- 修改：`plugins/dev-flow/src/core/rollback.ts`
- 修改：`plugins/dev-flow/src/core/state-store.ts`
- 修改：`plugins/dev-flow/src/mcp/doctor.ts`
- 新建：`tests/unit/rollback-transaction.test.mjs`
- 修改：`tests/unit/doctor.test.mjs`

**事务顺序：**

1. 写 `rollback-transaction.json` 并 fsync。
2. 将所有当前文件 bytes/mode 备份到 recovery。
3. 对每个目标使用同目录临时文件、fsync、chmod 与 atomic rename。
4. 删除目标不直接 unlink，先移动到 recovery。
5. 执行 rollback verification。
6. 成功后原子提交状态；失败时从 recovery 补偿恢复。
7. 补偿验证也失败时，doctor 报告 blocking recovery 和两组 attempt ID。

事务保存 `nextFileIndex`、preview basis、backup directory、target checkpoint、phase 与 verification attempt IDs，确保每个阶段都可续办。

**步骤：**

- [x] 在 prepare、backup、首个 rename、verification、state commit 前后注入故障。
- [x] 断言每个故障点均可 resume，且不会丢失回撤前 bytes/mode。
- [x] 运行 `node --test tests/unit/rollback-transaction.test.mjs`，确认红灯。
- [x] 实现事务、补偿与 doctor recovery。
- [x] 成功后将撤销 units 标记 `rolled_back`，首个撤销 unit 变回 pending。
- [x] 使 code review、verification、feature-check、logic-complete 与 finalize stale；basis 未变时保留 implementation approval。
- [x] 提交：`feat(dev-flow): execute resumable checkpoint rollback`

### 任务 9：开放执行工具并完成端到端验收

**文件：**

- 修改：`plugins/dev-flow/src/mcp/server.ts`
- 修改：`plugins/dev-flow/src/core/status.ts`
- 修改：`plugins/dev-flow/skills/rollback-safety/SKILL.md`
- 修改：`tests/unit/mcp-server.test.mjs`
- 新建：`tests/e2e/routes/standard-m-rollback.test.mjs`
- 新建：`tests/e2e/cross-host/checkpoint-rollback.test.mjs`
- 修改：`docs/architecture.md`
- 修改：`docs/routes.md`
- 修改：`README.md`

**第 4A 新工具：**

- `dev_flow_present_rollback_gate`
- `dev_flow_execute_rollback`

**验收场景：**

- 三个 RU checkpoint 后预览回到 RU-001，后续用户确认，再执行撤销 RU-003/RU-002。
- 重新实现两个 RU 后可完成 code review、verification、feature-check 和 finalize。
- 跨宿主读取同一 transaction/revision，CAS 防止并发重复执行。
- 任一 open transaction 阻止其他 feature mutation，doctor 给出 resume/compensate 指引。

**步骤：**

- [ ] 先写工具只在 transaction schema/doctor 就绪后注册的合同测试。
- [ ] 运行回撤路线、跨宿主、故障注入和控制文件 Hook 测试。
- [ ] 更新中文文档，区分 unit checkpoint 与 finalize 的 feature 级反向 patch。
- [ ] 运行全量测试、类型检查、构建和 `git diff --check`。
- [ ] 提交：`feat(dev-flow): complete transactional checkpoint rollback`

## 完成条件

- Trace 与 Rollback 共用同一个 RU 数据模型。
- 无 active RU、越界写入和未完成 implementation 都由 Core/Hook 拒绝。
- 上述门禁只作用于 `checkpoints: 1`，插件升级不会锁死旧 active feature。
- 第 3 阶段只读预览且独立可发布，不存在半成品 execute 入口。
- 第 4A 的 gate、事务、补偿、doctor 与故障注入全部通过后才开放回撤执行。
- verification command ID、project config digest 和命令定义摘要贯穿 RU、checkpoint、preview 与 transaction basis。
- 冲突时不修改任何文件，故障时始终保留可恢复证据。
