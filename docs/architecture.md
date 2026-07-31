# 架构

Dev Flow 以**一个预构建插件包**同时服务 Claude Code 与 Codex CLI。两端加载同一套 Skills、policy 契约与本地 MCP server。宿主 adapter 只做 hook 事件归一化，以及 Git / 受保护路径门禁；**绝不**自行推进工作流状态。

## 分层

| 层 | 职责 | 禁止 |
| --- | --- | --- |
| Skills | 理解任务、写内容、调用 MCP | 直接改状态文件、绕过 MCP 推进步骤 |
| MCP | 分类、deriveNext、状态事务、资产校验、HUMAN GATE、feature-check、finalize | 依赖某宿主私有对话格式 |
| Host adapters | SessionStart / UserPromptSubmit / Pre·PostToolUse / Stop 归一化与拦截 | 独立确认 gate、独立完成 step |
| 项目状态 | 跨宿主配置、active 指针、feature 状态与证据 | 保存宿主专属绝对安装路径 |

## 项目状态

消费项目内状态在 `.dev-flow/`：

- `project.json`：strict 强制、允许的验证命令、受保护根目录  
- `active.json`：当前唯一 active feature  
- `features/<id>/state.json`：原子状态  
- `features/<id>/events.jsonl`：追加式事件账本  

状态库使用进程锁、revision CAS、fsync + 原子 rename。同一时刻只能有一个 feature 为 `active`，其余须显式 paused 等。

## 状态与资产

- 所有状态变更走 MCP。  
- 强制 Markdown 资产在 feature 目录内，按 SHA-256 登记。  
- `status.md` 为只读生成投影，与状态事务同批更新。  
- HUMAN GATE 的 basis 变化会使对应 gate 失效。  
- 验证只对配置的 protected roots 做业务指纹；指纹变化会使 verification、feature-check、logic-complete 失效。  
- 即使绕过 Skills 直接调 MCP，core 仍拒绝乱序步骤与「抢先」创建未来资产。

## Traceability 事实层（1.8.0+）

- Markdown artifact 是人类可读的**叙述层**；Trace snapshot 才是需求、任务、测试与回撤关系的 Core 事实层。
- snapshot 按内容寻址、不可变；`state.traceability` pointer 是唯一提交点。通过 `dev_flow_record_artifact_with_trace` 同一 CAS 更新 artifact hash 与 pointer。
- `dev_flow_get_traceability` 只读返回 pointer、ledger、有效摘要及当前步骤 blocker。任何人不得直接编辑 snapshot、pointer 或 state。
- generated `status` 由 Core scaffold/refresh，禁止人工 record；standard L 不生成 status 文件，应以 `StatusView` 为准。
- Host Hook 将 `features/<id>/traceability/**` 视为 MCP 控制路径；当前 pointer 损坏时，`.dev-flow` 与 protected roots 均 fail closed。
- rollback unit 只验证已登记的 Trace 关系；checkpoint 于第 3 阶段（1.7.0+）发布，可执行 rollback 于 1.7.0+ 的 Phase 4A 发布。

## Checkpoints 实现单元生命周期（1.7.0+，`checkpoints: 1`）

standard M/L 启用了 `checkpoints: 1` 后，implementation 步骤通过 **rollback unit** 管理文件写入：

- **写入权限**：`implementationUnitWriteBlock` 纯函数判断。非 implementation 阶段、approval 未确认、或无 active unit 时返回 `IMPLEMENTATION_UNIT_REQUIRED`；文件超出 unit 的 `fileScope` 时返回 `IMPLEMENTATION_UNIT_OUT_OF_SCOPE`。Host Hook 在 PreToolUse 中调用该函数拦截 protected 路径写操作。
- **开始单元**：`beginImplementationUnit` 校验 trace gate 当前、所有 trace artifact 最新、review complete（若 `review: 1`）、rollback node 存在、依赖已 checkpointed。成功后捕获 protected roots 基线指纹与内容快照。
- **检查点**：`checkpointImplementationUnit` 快照当前 protected roots 内容到 `.dev-flow/features/<id>/checkpoints/` 目录，创建内容寻址不可变检查点（SHA-256 命名），标记 unit 为 `checkpointed`。顺序编号 `CP-001`、`CP-002` ...
- **回撤预览**：`dev_flow_status` 的 StatusView 包含 `rollback.validTargets`（可回撤目标列表）、`rollback.chain`（CP 顺序记录）、`rollback.conflicts`（未登记修改）、`rollback.gateStatus`（门禁状态）和 `rollback.openTransaction`（进行中事务）。`validTargets` 为空表示无可回撤目标。仅 `checkpoints: 1` 即可预览；`dev_flow_preview_rollback` 为只读工具，不改工作区或状态。
- **状态投影**：`deriveNext` 在 implementation 步骤且 checkpoints 强制时，无 active unit → `begin-implementation-unit`，有 active 未 checkpointed → `checkpoint-implementation-unit`，所有 unit 已完成 → `run-step(implementation)`。
- **跨宿主安全**：checkpoints 目录受 adapter policy `isControlPath` 保护，禁止技能直接写。Host Hook 将 `features/<id>/checkpoints/**` 视为控制路径。

## 回撤执行（1.7.0+，Phase 4A，`checkpoints: 1` + `rollbackExecution: 1`）

`rollbackExecution: 1` 在 `checkpoints: 1` 之上增加完整的回撤确认门禁与执行能力：

- **回撤确认门禁**：`dev_flow_present_rollback_gate` 为目标 checkpoint 重新计算预览与 basis hash，创建 `rollback-confirmation` 交互，等待用户确认。basis 过期或工作区冲突时门禁自动清除，提示重新展示。确认后 `rollbackGate.status === "confirmed"`。必须等用户下一条消息，不可同回合自批。
- **回撤执行**：`dev_flow_execute_rollback` 以可续办事务日志执行回撤：备份 → 文件恢复 → 回撤验证 → 状态提交。事务分为 `prepared` / `backing-up` / `rolling-back` / `verifying` / `committed` / `compensating` / `compensated` 七个阶段。任何阶段中断可续办；验证失败自动补偿恢复到回撤前状态。
- **事务安全**：journal 写入先于任何工作区字节移动；完整备份先于首条 rename；commit intent 先于 state CAS。补偿从备份恢复、多余文件移至 trash——字节绝不中途删除。
- **跨版本 driver lease**：事务未完成时同时维护 sidecar lease 与 recovery 目录内的 legacy mirror；旧宿主只能读取后者。终态先清理备份内容、写入 `completedAt`，再释放两份 lease，避免滚动升级期间出现锁盲区。
- **gate / step 联动**：成功回撤后将目标之后的 RU 标记 `rolled_back`，最早撤销 RU 变回 `pending`（可重新 begin）。下游步骤（code review、verification、feature-check、finalize）与 logic-complete 失效，需重新走完路线。
- **两类反向能力**：unit checkpoint 只用于 implementation 期间的局部、事务化恢复；finalize 产生的 delivery snapshot / feature 级反向 patch 仍是整个功能的交付层回退证据，二者不可互相替代。
- **doctor 集成**：`dev_flow_doctor` 检测 open transaction，报告 phase、target、undoOrder、blocked 状态与 verification/compensation attempt ID。任一 open transaction 阻止所有 feature mutation。

## Review 2a 多视角审查（`review: 1`）

- 新 feature 在 `startFeature` 时固定 `workflowCapabilities.review === 1`；已启动的 `review: 0` feature 继续旧 `plan_review` 合同，不会中途迁移。
- MCP/Core 是批次、任务、findings、dispositions 与 assurance 的事实源。`plan-review` Markdown 是内容寻址只读投影，永不进入 `ReviewBasis`。
- `dev_flow_next` 对 `plan_review` 依次导出 `create-review-batch` → `review-jobs-pending` → 仅在 current + complete + 无未处置 blocking finding 时导出 `run-step(plan_review)`。
- 默认保证等级为 `multi-perspective`：同一不可变 package 上完成多个必需角色。跨宿主分别领取不同 role job 验证的是协作与隔离，**不是**已证明的多代理身份；不得把 2a 叙述成 `multi-agent-attested` 或 `multi-agent-verified`。
- incomplete batch 的 status / next / 无 capability 读取面只暴露粗粒度 job 进度，不泄露 sibling findings；claim 使用高熵 capability 与 60 分钟租约。
- Host Hook 将 `features/<id>/review/**` 视为控制路径；当前 review pointer 损坏时 fail closed。

## Review 4B：采样与宿主证明

- **服务端采样**（`dev_flow_sample_review_job`）：Core 签发一次性 request（snapshot 只存 hash）；MCP 在客户端声明 `sampling` 后调用 `sampling/createMessage`；≥2 个不同 job 的有效 sampling provenance → `independent-sampling`。
- **宿主 attestation**（`dev_flow_submit_review_job` 可选 `attestation`）：普通宿主 subagent 证明最多 `multi-agent-attested`（≥2 不同 job × 不同 `agentId` × 不同 raw）。相同 raw 不可跨 job 复用；调用方自报 `verified` / `assuranceLevel` 无效。
- **`multi-agent-verified`** 仅经可信 `ReviewIdentityVerifier` 接口；默认 verifier 恒不信任，**永不**仅凭宿主字段产生 verified。
- 投影与 status 同时展示 `assurance.level` 与 `evidenceSources`（`role-jobs` / `server-sampling` / `host-attestation`），禁止把 attested 写成 verified。
- 无 sampling/attestation 时行为与 Review 2a 相同，仍为 `multi-perspective`。

## 需求拷问（grillme，1.1.0+）

标准 M/L 的 `requirements` **步骤内**可含强制 grill 子流程（**不**新增 route step / MCP tool / HUMAN GATE）：

| 角色 | 职责 |
| --- | --- |
| `requirements`（斜杠 `/dev-flow:requirements`；兼容 `df-requirements` / `dev-flow-requirements`） | 唯一编排与状态写入：scaffold、`record_artifact`、`record_step(requirements)`、`present/confirm` 需求确认门禁 |
| `grillme`（斜杠 `/dev-flow:grillme`；兼容 `df-grillme` / `dev-flow-grillme`） | 唯一逐题压测：可改 `requirements.md` 的 Decision Log、Open Questions 与 front matter 中的 `grill_status`；**禁止**任何 MCP mutation / gate |

- 机器字段（front matter）：`grill_status: not_required | pending | in_progress | complete`。  
- `missing-or-unclear` / `documented-unconfirmed`：脚手架 `pending`，须达到 `complete` 且已登记 artifact 后，core 才允许 `recordStep(requirements)` 与 `presentGate(requirement_confirmation)`。  
- `provided-confirmed`：脚手架 `not_required`，默认可不拷问；显式 grillme 压测后须为 `complete` 并重新登记。  
- 校验失败返回 `GRILL_INCOMPLETE` / `GRILL_STATUS_INVALID` 等，不写 step、不建 gate、不递增 revision。  
- 非 requirements 阶段的显式 grillme 为**咨询模式**：不写文件、不改 MCP 状态。

## Hooks 与诊断

- 对非写入类工具快速放行。  
- 相关 PreToolUse：在 **logic-complete 之前**拒绝 Git 写；在 **implementation_approval 未确认**前，拒绝受保护路径上的 `Write` / `Edit` / `MultiEdit` / `apply_patch`（含 Bash 内 `apply_patch`、无法解析的 patch 保守拒绝）。  
- `dev_flow_doctor` 只读：报告项目配置、active 有效性、corrupt feature digest、manifest、bundle、hook/MCP JSON 接线与可用性。
- **1.3.0+ hooks**：仅允许编辑 active feature 已登记的非 status Markdown artifact；控制文件始终拒绝；Bash 按解析出的写目标判定，不扫描 heredoc 正文；active state 损坏时 fail closed。
- **1.3.0+ status**：`dev_flow_status` 返回 `StatusView = state + progress`（不改 state schema）。
- **1.4.0+ evidence policy**：统一派生逐步 RequiredEvidence；recordStep 首检、feature-check 回读二检；`full-code-review` 转换为 reviewDepth。
- **1.4.0+ status**：progress 增加当前 requiredEvidence 与 verificationFreshness；均为只读投影，FeatureState schemaVersion 仍为 1。
- **1.4.0+ manual acceptance**：只扩展 verification attempts/step evidence 的内部形状；是否声明 UI 验收由 Skills 判断，Core 不新增关键词 gate。
- **1.3.0+ recovery**：`dev_flow_recover_corrupt_feature` 将损坏 feature 目录备份到 `.dev-flow/recovered/` 并清除 active，不重建业务流程。

发布包自包含 `dist/mcp-server.mjs`、`dist/claude-hook.mjs`、`dist/codex-hook.mjs`，用户安装后无需 `npm install`。
