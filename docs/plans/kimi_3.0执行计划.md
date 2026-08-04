# dev-flow 实测问题优化执行计划（kimi执行计划.md）

> **文档用途**：dev-flow 2.0.1 在 vitejs/vite 仓库 standard-m 路线实测所发现 13 个问题的完整修复执行计划，供人工逐条过审与后续执行（可交给执行代理独立施工，无需会话上下文）。
>
> **输入**：
> 1. `/Users/weixiaoyu/Desktop/practice/dev-flow-issue/vitejs-vite/dev-flow-standard-m-report.md`（2026-08-03，standard-m 实测，13 个问题）
> 2. `/Users/weixiaoyu/Desktop/practice/dev-flow-issue/dev-flow-run-record.md`（OpenCode 直连 MCP 实践记录，经复现确认的新缺陷 P1-1/P1-2 等，由 GPT5.6 计划引入）
>
> **目标仓库**：`/Users/weixiaoyu/Desktop/practice/dev-flow`。**真实源码在 `plugins/dev-flow/src/`；仓库根目录 `src/core/` 是空目录占位，不要在那里改任何东西。**
>
> **合并说明（v2，2026-08-03）**：本版吸收了 `docs/plans/执行计划.md`（GPT5.6）的评审结果。其中 **5 处升级了本会话已确认的原始决策**（见下方"合并升级点"），其余为纯增量。过审时请重点看这 5 处，不同意可点名回退。

## 合并升级点（对原始已确认决策的修订，需用户复核）

| # | 项 | 原决策 | 升级为 | 理由（已核实） |
|---|---|---|---|---|
| M1 | P1 分级建议 | topologyFacts 关键词匹配 + riskFacts 抬 level 下限 | **结构化 ClassificationSignals**（impactScope/sharedContract/independentChains/coordinatedRollback/requirements/formalControls）；**风险不抬 level**（只加义务） | `docs/architecture.md:11` 明文禁止 Policy 层"使用业务关键词"；CLAUDE.md 确立"规模与风险独立"。关键词方案违反本仓架构 |
| M2 | B3 忽略语义 | 手写 gitignore 子集解析器 + protectedRootsExclude | **`git ls-files --cached --others --exclude-standard` 权威枚举**（worktree 内 git 失败 fail-closed；非 git 仓回退递归遍历）；**保留** protectedRootsExclude 作显式补充 | ProjectConfig 强制 `gitWriteRequiresLogicComplete: true`，git 已是架构前提；权威语义覆盖嵌套 .gitignore/global excludes，消除手写解析器风险 |
| M3 | U3 grill 双轨 | request 自动写 front matter（in_progress + grill_question_id） | **状态权威化**：新模板只用 `not_required/pending/complete`，不再写 question_id；routed 前置=文档 current + grill_status pending；request 时双模式 upsert ledger，resolve 同一 CAS 闭环 | 从根上消除双轨，而非同步两条轨；parser 向后兼容旧 in_progress 文档 |
| M4 | B4 错误呈现 | error.message 附输出尾部摘要 | 摘要保留，且**统一改为 MCP `isError` CallToolResult + structuredContent {code,message,details}**（DevFlowError 不再走 JSON-RPC protocol error）；新增 **preflightCommands + CHECKPOINT_PREFLIGHT_FAILED**（phase 字段区分环境前置 vs 回归） | isError 才是 MCP 工具执行错误的正确语义，客户端必展示 content；preflight/forward 分离直接解决"环境前置与回归无法区分" |
| M5 | 范围 | 13 项 | **+U8（MCP 入参统一运行时校验）、+U9（宿主证据一致性）** | OpenCode 记录实锤：`revision` 误传被静默忽略后报误导性 STATE_REVISION_CONFLICT（P1-1）；classify 顶层 riskFacts 被静默忽略（P1-2）；`server.ts:693,783,786` 等多处 `host ?? "codex"` 默认致证据归因失真 |

**测试目录更正**：`scripts/run-tests-silently.mjs` 只收集 `tests/unit`、`tests/e2e/routes`、`tests/e2e/cross-host`、`tests/e2e`——**`tests/legacy-v1/` 已归档、不在收集范围、不可直接运行**。新测试一律放 `tests/unit/`（命名 `v2-*.test.mjs`）或对应 e2e 目录；legacy-v1 只作行为参考阅读，不作验收门槛。

---

## 执行者须知（交接给外部执行模型，施工前必读）

1. **行号以 2.0.1 基线为准，会随施工漂移**——一律按符号名定位（函数名/类型名/错误码），行号只作初始参考。
2. **字段名/枚举值以当前源码为准**：本文已核实 `RequirementsState = "missing-or-unclear" | "documented-unconfirmed" | "provided-confirmed"`（`policy/types.ts:4`）、grill front matter 字段为 `dev_flow:` 下的 `grill_status`/`grill_question_id`/`grill_response_hint`（`artifact-templates.ts:17,26`）。若施工中发现文档与源码冲突，**以源码为准并在交付报告中列出差异**，不得擅自按文档改源码迎合。
3. **按 Phase 分包执行**：每个 Phase 是独立交付单元（Phase 1+2 → 2.0.2；Phase 3 → 3.0.0），做完一个 Phase 跑完该阶段收尾验证再进下一个；不要跨 Phase 混改。
4. **基线先行**：开工先记录基线（`git status`、`npm run typecheck`、`npm run test:unit` 通过数）；发现基线与 §0-5 不符先报告，不得覆盖或回退用户已有改动。
5. **形状变更明细化**（易被低估，逐条核对）：
   - B2 静态告警：`record_artifact_with_trace` 响应从 `FeatureState` 变为 `{ state, warnings?: string[] }`（Phase 1 即变，测试同步）。
   - U5(b) `dev_flow_release_review_job` 是**新工具**：除 Core 实现外，必须在 `src/mcp/server.ts` 的 toolSchemas 注册 inputSchema、dispatch 增加 case、并在相关 skill 文档中说明。
   - U7 投影字段中的 `mode` 指 `"intake" | "routed"`（feature 未 lock 分类前为 intake）；`obligations` 为 `{pending,satisfied,stale}` 计数，`counters` 为其余计数，不要重复统计。
   - M4 的 isError 改造（Phase 1/B4）改变**全部** DevFlowError 的 MCP 呈现通道：`tests/helpers/host-runner.mjs` 与所有断言错误形状的测试须同批迁移。

---

## 0. 全局约束（施工前必读）

1. **版本与交付节奏**：Phase 1 + Phase 2 → **2.0.2**；Phase 3 → **3.0.0**（U7 响应瘦身 + U8 入参收紧 + U9 host 显式化均为有意合同收紧，随 major 发布说明）。版本权威：根 `package.json`（当前 2.0.1）。
2. **禁止 git 操作**：全程不 `git commit` / `git push` / 不建 PR。每阶段完成后只报告变更与测试结果，用户手动提交。
3. **构建纪律**：中间任务**不跑** `npm run build`；仅阶段收尾 `version:sync` → `build` → `build:check`，源码与 `plugins/dev-flow/dist/` 一并备好。
4. **运行时零 npm 依赖**：Node 标准库 + 现有 devDependencies。B3 用 `git` 二进制（业务仓本就是 git 仓，见 M2）；U8 的 JSON Schema 验证器手写子集，不得引依赖。
5. **基线记录**：开工前先记录基线（工作树状态、`npm run typecheck`、`npm run test:unit` 通过数）；后续发现基线变化先记录差异并判断是否用户改动，**不得覆盖或回退用户改动**。
6. **测试纪律（TDD）**：每个任务**先写失败测试并确认其在修复前失败**，再改源码；然后 `npm run typecheck` → `npm run test:unit` → 受影响的 routes/interop。源码测试经 `tests/helpers/load-source.mjs` 加载 TS，**不得** import `plugins/dev-flow/dist/`（仅既有 bundle 验证 E2E 例外）。
7. **代码风格**：严格 TS ESM；两空格、双引号、分号；kebab-case 文件；错误码全大写；用户可见文案中文；策略层纯函数、I/O 在 core store。
8. **合同同步**：改路线步骤/资产/审查角色时同步 `policy/contract.json`、`docs/routes.md` 与测试。
9. **legacy 兼容**：旧 feature 无 `workflowCapabilities` 视为零能力；不得改已启动 feature 的能力位；状态 schema 变更字段级向后兼容，不升 schemaVersion。
10. **commit message**（用户提交时参考）：Conventional Commits，type/scope 英文，subject 与正文中文。

## 1. 问题清单与决策总表

| ID | 问题 | 修复决策 | 阶段 |
|---|---|---|---|
| B1 | 计划修订后 `REVIEW_BASIS_STALE` 死锁 | implementation-plan 变更且 review 强制时从 planning 起删步骤证据（重开）；复审后 re-record 重绑新批次；active unit 时拒绝登记计划 | 1 |
| B3 | protectedRoots 不感知 .gitignore | git 权威枚举（M2）+ protectedRootsExclude；回滚两侧统一过滤；写门禁不动 | 1 |
| B4 | 验证失败输出不可见；环境前置 vs 回归不分；命令粒度 | isError 结构化错误（M4）+ preflight/forward 分离 + forwardVerification 支持行内 `{command,args,cwd}` | 1 |
| B2 | 测试/修复跨 RU 死锁未前置发现 | standard-m 加 rollback-operability 角色 + 静态告警（仅 fileScope 结构，禁标题文本匹配）+ 模板/skill 提示 | 1 |
| U1 | attention 过早 approval-required | 仅实际 present/wait-human-gate 时出现；否则给缺失前置 | 2 |
| U2 | classify/lock schema 三连坑 | lock 兼容嵌套回显 + 冲突检测；schema 补描述；错误带字段路径/actualType | 2 |
| U4 | 批准词过窄 | 白名单补变体；提示语列可接受短语；归一化后整句精确匹配，拒条件句 | 2 |
| U5 | review job 细节 | 公开租约投影；release 工具；失败诊断（claimRetained 等）；scope 报错带 invalidPaths+allowedScopes；evidence 规则进 next；tombstone 清理并入 B1 | 2 |
| U6 | 文档一致性 | feature-check description 修正；routes.md 澄清；skill 合同测试 | 2 |
| — | CLAUDE.md 版本钉死 + 宿主支持矩阵缺失 | 去钉死化；README/architecture 补支持矩阵与禁止表述；分发合同测试 | 2 |
| P1 | classify 不建议级别 | ClassificationSignals + recommendClassification（M1）；readyToLock 联合类型；lock 不变 | 3 |
| U3 | grill 双轨/时序/merge 映射 | 状态权威化重设计（M3）；merge-remaining 退出字母/数字/推荐序号 | 3 |
| U7 | MCP 响应 50–120KB | mutation 默认 FeatureMutationSummary；attempts 32KB 输出外置磁盘 | 3 |
| U8 | 入参静默忽略/误导报错（OpenCode P1-1/P1-2） | tools/call dispatch 前统一 validateToolInput（inputSchema 单一权威）；INVALID_TOOL_INPUT | 3 |
| U9 | 宿主证据归因失真（`host ?? "codex"`） | host 必填语义审计；event.host===调用 host 校验，HOST_EVENT_HOST_MISMATCH fail-closed | 3 |

**范围外（施工红线）**：不改仓根空占位 `src/core/`；不改 Vite 修复代码；不用领域关键词/LLM/联网服务做分级；不降低 approval token、promptEventId、时间序、一次性交互校验；不允许 finding 引用 scope 外路径；不允许 implementation 主 files 绕过 protectedRoots；**不为第三方 MCP 客户端（OpenCode 等）增加无 hook 批准旁路、不把模型代决/手工调 hook 当兼容证据、不宣称其受支持**；lease 不引入单调时钟、不开放 capability 查询/抢占；doctor 不猜第三方宿主事件链、不推断项目测试覆盖；不迁移/手编 `.dev-flow` 控制文件。

---

## 2. Phase 1 — 阻塞修复（2.0.2，顺序：B1 → B3 → B4 → B2）

### 任务 B1：REVIEW_BASIS_STALE 死锁

**根因链（已核实）**：`record_step(planning)` 经 `assertReviewComplete`（`review-jobs.ts:1046`）写入 `{batchId,basisHash,assuranceLevel}` 证据（`feature-check.ts:123-125`）；修订计划 → `prepareReviewInvalidation`（`review-store.ts:304`，设计保留）标批次 stale；`invalidateArtifactDependents`（`artifacts.ts:73-94`）的 `afterStep:"planning"` 只删 planning 之后的步骤，证据永绑旧批次；`currentBatchWithBasis`（`review-jobs.ts:861-879`）对新批次回退 live basis（含 `protectedRootsFingerprint`，:171,187）比对 → checkpoint 改指纹后 `beginImplementationUnit`（`implementation-units.ts:129`）必死；re-record 被拒 `STEP_OUT_OF_ORDER`。

**实现**：
1. `artifacts.ts`：`artifactInvalidations` 规则结构改为**支持两种语义**（不要整体替换）：
   - `requirements`：**保持现行** `{ afterStep: "requirements_alignment" }`（只删源步骤之后的步骤，不重开 requirements_alignment——其无批次绑定问题，此处有意偏离 GPT 方案）；
   - `implementation-plan`：当 `reviewEnforcementRequired(state.route, state.workflowCapabilities)` 为真时按 **fromStep 语义**——`delete state.steps.planning` 及其后全部步骤（planning 重开）；非 review 强制路线（如 light-l）保持现行 afterStep 行为。
   - 函数末尾重算 `state.currentStage`（第一个未 satisfied 的 route step）；eventData 加 `planningReopened`。
2. **静止单元门禁**：登记 implementation-plan（recordArtifact/recordArtifactWithTrace）前若存在 `status==="active"` 的 implementation unit → 抛 `PLAN_REVISION_REQUIRES_QUIESCENT_UNIT`，details 带 `activeUnitId` 与 hint（"先 checkpoint 或 rollback 再修订计划"）。不自动 checkpoint/rollback。
3. **implementationUnits 协调**（trace 更新成功后，同 CAS）：删除已 tombstone/不存在且 `pending` 的 unit；保留 `checkpointed`/`rolled_back` 历史；不自动创建 pending unit（仍由 begin 懒生成）。**U5(d) 并入此步**。
4. `review-jobs.ts:875` `REVIEW_BASIS_STALE` details 加 recoveryHint（重建批次→重交 jobs→re-record planning）。保留 `currentBatchWithBasis` 原则：planning 绑定当前批次后实现写入不再触发 live 比对。
5. 恢复链：修订 → planning 重开+批次 stale+批准作废 → create-review-batch → 重交 jobs → `record_step(planning)` 经 `assertReviewComplete` 绑新批次 → 重批准 → begin 免疫 checkpoint 漂移。

**测试**：
- 新增 `tests/e2e/routes/standard-m-plan-revision.test.mjs`：plan v1→审查→批准→begin RU-001→checkpoint→**修订（RU-002 tombstone+新 RU 登记）**→断言 planning 重开/currentStage="planning"/批次 stale/tombstoned pending unit 清除→重建批次+重交→re-record 绑新批次→重批→begin 新 RU 无 REVIEW_BASIS_STALE→finalize 全通。
- 单测：invalidateFromStep 两种路线行为；active unit 时登记被拒（错误码+activeUnitId）；implementationUnits 协调（tombstone pending 删、历史保留、不自动建新）。

### 任务 B3：Git 权威枚举 + protectedRootsExclude

**实现**：
1. `fingerprint.ts` 建唯一枚举器 `enumerateProtectedFiles(root, config)`：
   - **Git 模式**（root 在可读 git worktree）：`git ls-files --cached --others --exclude-standard -z -- <protectedRoots>` → NFC 规范化、去重（重叠 roots）、排序；逐项 lstat，符号链接仍抛 `UNSAFE_PROTECTED_ROOT`；**tracked-but-ignored 保留，untracked-ignored 排除**；worktree 内 git 命令意外失败**不得静默回退**，抛 `PROTECTED_ROOT_ENUMERATION_FAILED`。
   - **非 Git 模式**：现递归遍历（继续忽略 `.git/.dev-flow/node_modules`）+ `protectedRootsExclude` glob 过滤。
2. `project-config.ts`：`protectedRootsExclude?: string[]`（非空字符串、相对 glob、拒 `..`）；`policy/project.schema.json` 声明；两种模式都在枚举后追加 exclude 过滤（显式用户排除优先）。
3. `snapshotProtectedRoots`/`fingerprintProtectedRoots` 共用枚举器；调用面改造：`checkpoints.ts:310`、`rollback.ts`（多处）、`status.ts`(drift)、`implementation-units.ts`(baseline)、`delivery-snapshot.ts`、`review-jobs.ts`(basis)。**不动** `hosts/adapter-policy.ts` 写门禁。
4. 回滚两侧一致过滤；老 manifest 中命中排除的条目惰性跳过。
5. 文档：`docs/architecture.md` 补枚举语义小节（git 权威 + 非 git 回退 + exclude 优先级 + symlink 拒绝）。

**测试**：新增 `tests/unit/fingerprint.test.mjs`——untracked gitignored dist 不进快照；tracked-but-ignored 保留；**嵌套 .gitignore 生效**（git 权威语义天然覆盖）；非 git fixture 可指纹；symlink 拒绝；worktree 内 git 失败不静默回退；exclude glob 生效。rollback：两侧排除一致；老 manifest 排除条目跳过。`project-config.test.mjs` 校验用例。

**验收**：vite 场景复测——dist 产物下 checkpoint 差异文件数降为真实业务文件数。

### 任务 B4：isError 结构化错误 + preflight/forward 分离 + 行内命令

**实现**：
1. **MCP 错误通道统一**：`server.ts:374-379` `failure()` 改造——DevFlowError 不再转 JSON-RPC protocol error，改返回 `isError: true` 的 CallToolResult（content 文本含结构化错误 JSON + `structuredContent: {code,message,details}`）；仅协议级错误（未知 method、不可解析消息）继续 JSON-RPC error。**同步更新 `tests/helpers/host-runner.mjs`** 识别 isError 并保留 structuredContent；受影响 e2e/单测断言迁移。
2. **preflightCommands**：`ProjectConfig.verification` 增可选 `preflightCommands?: string[]`（元素必须引用 `verification.commands` 已配置 id；去重保序；缺省=空；schemaVersion 保持 1）。checkpoint 顺序：preflight → 任一失败抛 **`CHECKPOINT_PREFLIGHT_FAILED`**（RU 保持 active、不建 manifest）→ 全过才跑 RU.forwardVerification（失败仍 `CHECKPOINT_VERIFICATION_FAILED`）。成功 manifest 的 `verificationAttempts` 增 `phase: "preflight"|"forward"`（**解析器接受旧 manifest 缺 phase**，§兼容）。`dev_flow_verify` 同样先 preflight，失败作为普通 attempt 持久化但标明 phase。
3. **失败诊断固定字段**：checkpoint/rollback 验证失败 details 固定含 `unitId,attemptId,phase,commandId,command,cwd,exitCode,outputTail(≤4000),recoveryHint`；content 文本/message 附尾部摘要（~1500 字符）。`rollback.ts:1189-1200` 同法。
4. **行内命令**：`policy/traceability.ts:52-63` `forwardVerification`/`rollbackVerification` 元素扩展为 `string | {command,args?,cwd?}`（`traceability.schema.json` `oneOf`；旧 `string[]` 快照合法）；`checkpoints.ts:235-246` 解析：string→命令池（现逻辑），object→校验（command 非空、args 字符串数组、cwd 相对拒 `..`）直转 VerificationCommand，attempt commandId 稳定派生 `inline:<ruId>:<index>`。执行复用 `verification.ts:49-65`。计划模板引导：forwardVerification 填聚焦命令/行内命令，全量命令留最终 verification。
5. **红线**：Core **不分析命令输出文本**猜环境问题——只有显式配置为 preflight 的失败才用 PREFLIGHT 错误码。

**测试**：isError 形状与 structuredContent 保留（含 outputTail 可读）；preflight 失败不执行 forward、phase 标注、旧 manifest 兼容；行内命令解析/非法/逃逸拒绝；e2e 行内聚焦命令 checkpoint 通过；host-runner 识别 isError。

### 任务 B2：standard-m 前置发现跨 RU 死锁

**实现**：
1. `policy/review.ts:301-302`：standard-m 也加 `rollback-operability`；角色排序保持 `requirements-coverage, architecture-testability, rollback-operability`，风险角色按 `reviewRoles` 权威顺序追加。`policy/obligations.ts:66-69` 同步；`docs/routes.md:20` 改 3 角色；**批量更新既有 2 角色断言**（grep 找全）。
2. 静态告警（纯函数 `detectRollbackSplitWarning(nodes)`，放 `src/policy/`）：RU-A `fileScope` 全中测试模式（`__tests__`、`(^|/)tests?/`、`(^|/)fixtures?/`、`\.test\.`、`\.spec\.`）且 RU-B `depends_on` 含 A 且 B 的 fileScope 含非测试路径 → 非阻塞 warning（"测试与实现拆为不同回撤单元，A 的前向验证红测试期必失败死锁；建议合并原子单元"）。呈现：record 响应 `warnings?: string[]` + 事件账本；**绝不阻断**。**只基于 fileScope 结构与 depends_on，禁止任务标题/文本关键词检查**（architecture.md:11）。
3. 模板/skill：`artifact-templates.ts` 实施计划模板加 RU 原子性说明（**测试与使其通过的实现默认同 RU；红测试允许作为 RU 内临时状态，不允许成为 checkpoint 边界；forwardVerification 必须在本 RU+已 checkpoint 依赖状态下通过**）；`skills/plan/SKILL.md` 同义补充；`skills/plan-review/SKILL.md` 给 rollback-operability 角色明确检查清单。

**测试**：standard-m 3 角色（新期望）；告警矩阵（纯测试被依赖→告警/混合 scope→不告警/无 depends_on→不告警/多跳→一次）；e2e 批次 3 jobs；blocking rollback-operability finding 未解决时 planning 不可满足。

**Phase 1 顺序与收尾**：B1 → B3 → B4 → B2。收尾（与 Phase 2 合并后）：见 §3 末尾。

---

## 3. Phase 2 — 可用性微修（并入 2.0.2）

| 任务 | 实现细节 | 测试 |
|---|---|---|
| **U1** | `deriveStageCapabilities` 不再因有 pending approval 义务就加 attention；`stageCapabilitiesForAction` 仅在实际 `present-human-gate`/`wait-human-gate` 时给 `approval-required`（`stages.ts:75-86`、`status.ts:87-88`）；未就绪时在 next 信息中给缺失前置（如 `planning 未完成`）；义务列表始终可见但不误导为立即操作 | `tests/unit/v2-stage-capabilities.test.mjs`：requirements_alignment 阶段不误标；就绪后正确标 |
| **U2** | lock handler（`server.ts:696-701`）归一化：首选嵌套 `classification.classificationBasis`；嵌套与平铺并存且一致→规范化接受，**不一致→`CLASSIFICATION_BASIS_CONFLICT` 列冲突字段路径**；schema description 写明 riskFacts 为 label-keyed 对象；`route.ts:46-52` `validateBasis` 每个错误带 `path`+`actualType`/`invalidValue`；riskFacts 只接受 contract 合法 label key | classify 输出原样回显 lock 成功；旧平铺仍成功（一周期兼容）；冲突被拒路径准确；顶层误传 riskFacts 的错误指向正确 path |
| **U4** | `approval.ts:9-20` 增补：`开始执行`、`确认开始执行`、`同意开始执行`、`批准执行`、`同意执行`；trim/空白折叠/大小写归一化后**整句精确匹配**；带附加条件的句子不算批准；提示语四处附可接受短语清单 | 新短语通过；条件句/近似句拒绝负例 |
| **U5** | (a) `PublicReviewLease{claimedAt,leaseExpiresAt}`/`PublicReviewJob`（Omit claim；claimed 必带 lease，**永不返回 requestSha256**）用于 claim/get/只读视图；(b) **新增 `dev_flow_release_review_job`**：仅 current batch 中 `claimed` 且 capability 哈希匹配的 job 可原子释放回 pending；submitted/sampling/未 claim/错误 capability 各给稳定错误码且不泄露租约信息；ledger 中仍同一 claim 时即使已过期原持有者也可释放，其他调用方走既有过期回收重新 claim；(c) 提交诊断：MCP schema 失败→`mutationApplied:false`；capability 通过后的 completion/scope/attestation 失败→details 带 `claimRetained:true,leaseExpiresAt,retryHint`，**不清 claim**；`REVIEW_JOB_LEASE_EXPIRED` 带 leaseExpiresAt+recoveryHint；**注入时钟测试**（过期后新 claim 立即恢复；禁单调时钟）；(d) `REVIEW_FINDING_SCOPE_INVALID` details 带 `invalidPaths`+`allowedScopes`；(e) `RequiredEvidence.fields` 增 `files:"protected-root-paths"`，implementation 阶段 `dev_flow_next` 主动展示该要求；`INVALID_IMPLEMENTATION_FILE` 保留 protectedRoots+修复提示，不放宽范围 | `tests/unit/v2-review-jobs.test.mjs`（新建，**不复用已归档 legacy-v1**）：公开租约/无效提交后同 capability 租约内修正重试成功/过期回收/持有者 release/无 capability 不得释放；scope 报错字段；next 展示 files 要求 |
| **U6** | (a) `skills/feature-check/SKILL.md:3` description 改为"已并入 finalize，常规流程无需单独调用"类措辞；(b) `docs/routes.md` 补：standard-m"独立审查"=planning 内 plan-review jobs；code_review 步骤是 `record_step(reviewType:"code")` 轻量证据 | **新增 `tests/unit/v2-skill-contract.test.mjs`**：feature-check 必述并入 finalize；plan-review 必述 planning 内部；code-review 必述对应 code_review 阶段；standard-m 文档必列 rollback-operability |
| **附带** | (a) 根 `CLAUDE.md` 去钉死化："版本权威：根目录 package.json#version（以该文件为准）"；(b) `README.md`、`plugins/dev-flow/README.md`、`docs/architecture.md` 增**宿主支持矩阵**：Claude Code（支持，需 manifest+MCP+claude-hook 共同安装）/ Codex CLI（同）/ 其他 MCP 客户端（**未支持**，直连仅诊断，不具备写入守卫与可信用户证据）；(c) 明确禁止的兼容表述：模型代决、手工调 hook、仅 MCP happy path、doctor 静态检查≠宿主兼容；(d) doctor 文档注明边界 | 分发合同测试：锁定仅 `claude-hook.mjs`/`codex-hook.mjs`+两宿主 manifest，新增宿主必须显式更新矩阵与测试 |

**Phase 1+2 收尾（发布 2.0.2）**：`sync-version.mjs --write`（→2.0.2）→ `npm run build && npm run build:check` → `npm test` 全量 → `claude plugin validate . && claude plugin validate ./plugins/dev-flow --strict`（可用时）→ 按 §6 交付清单报告，用户手动提交。

---

## 4. Phase 3 — 功能与兼容变更（3.0.0，顺序：P1 → U3 → U8 → U9 → U7）

### 任务 P1：ClassificationSignals + recommendClassification（M1）

**实现**：
1. `policy/types.ts`：
   ```ts
   export interface ClassificationSignals {
     impactScope: "single-location" | "single-module" | "cross-module";
     sharedContract: boolean;
     independentChains: number;            // 整数 ≥1
     coordinatedRollback: boolean;
     requirements: RequirementsState;
     formalControls: Array<"trace" | "independent-review" | "multiple-rollback-units">;
   }
   // ClassificationBasis 增可选 signals?: ClassificationSignals（旧 state 可读）
   ```
2. `policy/route.ts` 新纯函数 `recommendClassification(basis)`（禁文件 I/O、禁关键词表）：
   - topology：`coordinatedRollback` → coordinated-rollback；否则 `independentChains≥2` → multi-chain；否则 `sharedContract` → shared-contract；否则 local。
   - scope 基础 level：single-location→XS / single-module→S / cross-module→M；最终 level = max（基础， topologyMinimumLevel）。
   - riskLabels = riskFacts 中至少一条非空事实的合法 key（排序去重）；**风险不提高 level**（只加义务）。
   - M/L execution：requirements ≠ provided-confirmed 或 formalControls 非空 → standard；否则 light。XS/S 不返回 execution。
   - 非法 riskFacts key、空事实、矛盾 signals → 结构化 `ClassificationIssue{code,path,message,recoveryHint}`；理由 `ClassificationReason{field,value,basisPaths,message}`。
3. 返回可判别联合 `ClassificationPreview`：`{readyToLock:true, classification(含嵌套 classificationBasis), route, obligations, reasons, issues:[]}` | `{readyToLock:false, classification?, route?, reasons, issues}`。**M/L 缺 execution 时不再返回看似有效的 route**，而是 `readyToLock:false`+missingFields issue（顺手修 U2-3）。
4. `server.ts:156-169` classify 二选一输入：**推荐模式**（只传 classificationBasis 且含 signals）/**兼容模式**（旧字段，继续支持）；`policy/stages.ts:46` preview-classification 挂点对接 intake。
5. lock：首选 classify 输出原样形状（含嵌套 basis）；旧平铺兼容一个发布周期；冲突检测见 U2。lock 持久化完整 basis（含 signals）；`policy/state.schema.json` signals 可选（旧 state 不补、行为不变）。
6. skills（task/requirements）引导优先推荐模式；`docs/routes.md` 补分级说明："建议仅供参考，signals 由操作者经仓库调查提供，lock 由操作者负责"。

**测试**（`tests/unit/v2-route-policy.test.mjs`）：规则矩阵（single-location/local→XS；single-module→S；cross-module→M；sharedContract 抬下限 M；independentChains≥2→L；coordinatedRollback→L；formalControls/需求未确认→standard 否则 light；risk 不抬 level）；classify 输出原样 lock；嵌套平铺冲突拒绝；矛盾 signals 结构化 issue。

### 任务 U3：grill 状态权威化（M3）

**实现**：
1. `requirements-grill.ts`：`requestGrillDecision` 在 **intake 与 routed 双模式**都 upsert DecisionRecord（open）；routed 前置放宽为：**requirements artifact 已登记+内容 current+`grill_status: pending`**——不再要求预写 `in_progress`/`grill_question_id`（消除三连坑）。
2. `resolveGrillDecision` 双模式**同一 state CAS** 原子更新 interaction + Decision Ledger（闭环 open 项，关联 questionId 与选项）。
3. 新需求文档模板只用 `not_required/pending/complete` 三态（**不再生成 in_progress/grill_question_id**）；parser 兼容旧文档的 in_progress/questionId/grill_response_hint；旧文档有 pending interaction 时 status 以 state interaction 为权威。
4. `assertRequirementsGrillSatisfied`：文档 complete **且**无 pending grill interaction **且**无相关 open decision。
5. merge-remaining 保留，但退出 `user-interactions.ts:161-174` 的字母/数字/**"推荐"**序号映射（只以语义 id/完整 label 命中）；fallbackHint 单独显示完整语义标签。
6. `skills/grillme`、`skills/requirements` 补时序（scaffold→request 自动开 ledger→用户回答→同 CAS 闭环）。

**测试**（`tests/unit/v2-decision-ledger.test.mjs` 等）：routed 文档 pending 时可直接 request（无需先改 front matter）；request 自动开 ledger；resolve 同 CAS 闭环（账本与 interaction 一次 revision）；文档 complete 但有 open grill decision 时不可 record_step；回 "C" 命中第三实质选项；回完整"合并剩余"标签命中语义项；旧 in_progress 文档兼容。

### 任务 U8：MCP 入参统一运行时校验（新，OpenCode P1-1/P1-2）

**实现**：
1. 新增 `src/mcp/input-validation.ts`：**纯 JSON 值验证器**（禁 I/O、禁 handler 调用），完整支持本仓 inputSchema 已用关键字：`type(object/array/string/integer/boolean)`、`required`、`properties`、`additionalProperties`（boolean|子 schema）、`items/minItems/maxItems/uniqueItems`、`enum/const/oneOf`、`minLength/minimum/pattern`；空 schema `{}` 接受任意值。
2. tools/call dispatch 最外层统一 `validateToolInput(toolName, args)`，**直接以 `toolSchemas[toolName].inputSchema` 为唯一权威**（禁另建字段表）；失败走 isError：`INVALID_TOOL_INPUT`，details 含 `tool, issues[{path,keyword,message}]`（按 path+keyword 稳定排序）、未知字段附 `unknownField`+`allowedFields`、`mutationApplied:false`。
3. schema 构造器审计：`featureMutation` 等 helper 支持 requiredExtras——approvalId/host/completion 等语义必填必须进 required；**逐个对照 handler 解构字段**确保无默认值字段都在 required；object 默认 `additionalProperties:false`（字典须显式 value schema）。迁移/删除被统一验证覆盖的局部校验（如 assertExactToolInput），Core 专属语义校验保留。
4. 回归 OpenCode 两个误用场景（原始 JSON-RPC 级）：record_decision 传 `revision`→同时报 `$.expectedRevision` 缺失与 `$.revision` 未知，不进 state CAS；classify 顶层传 `riskFacts`→指向 `$.classificationBasis.riskFacts`；completion/traceDelta 嵌套未知字段同样拒绝。
5. 合同测试：`tools/list` 暴露 schema 与运行时验证同一对象（防漂移）；每个 schema 样例过验证器；删任一 required/加未知字段稳定失败。

### 任务 U9：宿主证据一致性（新，OpenCode 审计实锤 `host ?? "codex"`）

**实现**：
1. 审计全部带 host 的 MCP schema（`server.ts:693,783,786` 等）：**需要写 lastUpdatedBy 或解析用户证据的调用，host 必填**（不得默认 codex）；仅纯展示类可保留可选。§7.6 收紧同步进发布说明。
2. approval、grill、review risk-acceptance、rollback gate、user-signoff 引用 host-event 时校验 **`event.host === 本次调用 host`**；不匹配抛 `HOST_EVENT_HOST_MISMATCH`（details：`expectedHost,actualHost,eventId`），**不消费 interaction/token**（fail-closed）。自动回溯最近 user-prompt 时只在同 host 事件中查找。
3. 保持合法交接：Claude→Codex 接力由完成当前动作的宿主捕获事件并把同一宿主值传给 Core（`tests/e2e/native-cross-host.test.mjs` 覆盖）。
4. 持久化 state 的 host 仍只接受 `"claude"|"codex"`，**不新增第三方枚举**。

**测试**：新增 `tests/unit/v2-host-event-provenance.test.mjs`——错误 host 不能复用另一宿主捕获的 promptEventId；跨宿主合法交接仍通过；不匹配不消费交互；host 缺失的必填场景给 INVALID_TOOL_INPUT（与 U8 联动）。

### 任务 U7：MCP 响应瘦身 + attempts 外置

**实现**：
1. `FeatureMutationSummary`（新投影，`core/` 新文件或扩展 execution-brief.ts）：`{featureId, revision, mode, lifecycle, route?, stage, logicComplete, obligations:{pending,satisfied,stale}, counters:{checkpoints,unitsDone,unitsTotal,openInteractions,blockingFindings}}`。**stage 用 `effectiveStage` 派生计算，不信任 currentStage 存储投影**；**禁止用"先 stringify 完整 state 再删字段"的方式实现**。
2. `server.ts:683-937` 逐个改造：原返回 FeatureState 的 mutation → summary；interaction envelope 顶层摘要+保留 interaction/outcome/response；checkpoint→`{state:summary, manifest}`；review submission→state 换 summary（batch/job 不变）。**不压缩**：rollback preview、get_review_job、get traceability 等专用只读返回；`dev_flow_status` 完整 StatusView；`dev_flow_next` StageCapabilityView 不变。
3. attempts 外置（用户决策，GPT 计划无此项）：`verification.ts:257-268` 新 attempt 完整输出写 `.dev-flow/features/<id>/verification/<attemptId>.log`，state 存 `{outputTail(4KB), outputPath}`；读路径兼容旧内联 output；state-schema-contract 按字段级兼容更新（不升 schemaVersion）。
4. 迁移：e2e（`result.state.*` 断言）→ summary 或显式 `dev_flow_status`；skills 文档改"完整状态走 dev_flow_status"；host 适配器不受影响（`adapter-policy.ts:4,450-453` 直接 readState）但跑 interop 确认。
5. **响应大小测试**：构造含大 checkpoint/review manifest 的 state——普通 mutation 响应 JSON **<10KB**；status 完整；get_review_job 等专用大包不受限。
6. release notes 草稿：mutation 不再返回完整 FeatureState，迁移方式=dev_flow_status。

**测试**：summary 投影单测（effectiveStage 正确性、counters）；各工具形状断言批量更新；attempts 新旧格式读写；大小测试；全量 e2e+interop。

**Phase 3 收尾（3.0.0）**：version:sync（→3.0.0）→ build+build:check → `npm test` 全量 → plugin validate →（可选 host-e2e）→ §6 交付清单报告，用户手动提交。

---

## 5. 验证与交付

**每任务**：写失败测试→确认红→最小改动→目标测试绿→`npm run typecheck`→`npm run test:unit`→（涉路线）`test:routes`→（涉 MCP/跨宿主/schema）`test:interop`+受影响 e2e。
**每阶段收尾**：`npm run version:check && npm run typecheck && npm run test:unit && npm run test:routes && npm run test:interop && npm run test:e2e && npm run build && npm run build:check && npm test`。
**发布前**：+ `claude plugin validate . && claude plugin validate ./plugins/dev-flow --strict`；3.0.0 前可选 `npm run test:host-e2e`。
**B1 硬验收**：`tests/e2e/routes/standard-m-plan-revision.test.mjs` 全绿。

**最终交付清单（每阶段报告模板）**：①按问题编号的行为变化；②公共 MCP/schema/type 兼容说明；③全部修改文件；④dist 三 bundle 是否由 build 更新；⑤每条验证命令退出码与通过数；⑥未解决问题（无则写"无"）；⑦`git status --short` 供人工审核。

## 6. 风险与注意

1. **B1**：升级前已卡死的 in-flight feature 不自动解救（recoveryHint 兜底）；`requirements` 保持 afterStep 现行语义（不随 GPT 方案重开 requirements_alignment）。
2. **B3**：git 枚举结果须再做项目相对路径/NFC/symlink 校验与去重；worktree 内 git 失败 fail-closed（防忽略策略悄然变化）；非 git 仓才用递归回退。
3. **B2**：job 2→3 的既有期望批量更新；静态告警只基于 fileScope 结构，有误报容忍（非阻塞），禁文本关键词。
4. **B4**：preflight 误分类红线（Core 不分析输出文本）；isError 通道变更需 host-runner 与受影响断言同批迁移。
5. **P1**：Core 只按结构化 signals 推导，不判断自然语言事实真伪；reasons 必须引用 basis path，不得声称语义证明。
6. **U8**：既往被忽略的未知字段变为 INVALID_TOOL_INPUT 是**有意 fail-fast 收紧**（随 3.0.0 发布说明：revision→expectedRevision、顶层 riskFacts→classificationBasis.riskFacts、host 显式化）；内置 skills/fixture 先迁移，不得为保留错误调用放宽 additionalProperties。
7. **U9**：host 必填化收紧同上；缺可信 host-event 保持 fail-closed，不得为第三方客户端通过率降低门禁。
8. **U7**：破坏响应兼容→major；attempts 外置字段级向后兼容；适配器不受影响（readState 读盘）。
9. **租约安全**：capability 丢失≠可查询/抢占；只能持有者 release 或过期后新 claim 回收；invalid completion 保持原 claim；UTC 时间戳+注入时钟测试，禁单调时钟。
10. **纪律**：不 git commit；中间不 build；基线变化先记录归属；不覆盖用户改动。

## 7. 兼容与数据处理

- **signals**：`ClassificationBasis.signals` 可选，旧 state 可读不补；只有 basis-only classify 要求 signals。
- **checkpoint manifest**：`verificationAttempts.phase` 可选读；新写必含；不重写历史 manifest。
- **requirements front matter**：旧 `in_progress/grill_question_id/grill_response_hint` 继续识别；新模板不再生成；pending interaction 时以 state 为权威。
- **mutation 响应**：有意的 MCP 输出合同调整（3.0.0）；skills/测试同批适配；外部迁移=dev_flow_status；README 升级说明写明。
- **入参严格化**：见 §6-6。
- **宿主与租约**：state host 仍仅 claude/codex；省略 host 默认 codex 的证据型调用须显式传（有意收紧）；旧 review ledger claim 已含 claimedAt/leaseExpiresAt 无需迁移，PublicReviewJob 只改投影；release 为新增工具不改现有 capability/幂等语义。

## 8. 附录：关键代码锚点速查

- **B1**：`artifacts.ts:73-94,178`；`review-store.ts:304-319`；`review-jobs.ts:854-879,376-413,1046`；`implementation-units.ts:129,131-177`；`feature-check.ts:123-125`；`step-order.ts:5,9-11`
- **B2**：`policy/review.ts:296-311`；`policy/obligations.ts:66-69`；`docs/routes.md:20,22`；`checkpoints.ts:398-407`
- **B3**：`fingerprint.ts:7,9-25`；`project-config.ts:6-11,29-36`；`policy/project.schema.json`；调用面 checkpoints/rollback/status/implementation-units/delivery-snapshot/review-jobs
- **B4**：`checkpoints.ts:398-407,235-246`；`rollback.ts:1189-1200`；`verification.ts:49-65`；`policy/traceability.ts:52-63`+schema；`mcp/server.ts:374-379`；`tests/helpers/host-runner.mjs`
- **U1**：`policy/stages.ts:75-86`；`core/approval-interactions.ts:62-68`；`core/status.ts:87-88`
- **U2**：`mcp/server.ts:156-191,696-701`；`policy/route.ts:46-52,74-116`
- **U3**：`core/requirements-grill.ts:36-44,114-121,123-173,200-253,281-300`；`core/user-interactions.ts:76-87,161-174`；`core/artifact-templates.ts:24-27`
- **U4**：`core/approval.ts:9-29`；提示语 `approval.ts:22-23`/`approval-interactions.ts:39`/`user-interactions.ts:311`/`mcp/attention.ts:25`
- **U5**：`core/review-jobs.ts:41,216-226,317-336,465-470`；`core/feature-check.ts:97-107`；`core/delivery-snapshot.ts:64-87`；`policy/evidence.ts`
- **U6**：`skills/feature-check/SKILL.md:3`；`docs/routes.md:10,42`
- **P1**：`policy/types.ts:19-25`；`policy/route.ts:22-30,74-93,104-116`；`mcp/server.ts:156-169`；`policy/stages.ts:46`；`policy/state.schema.json`
- **U8**：`mcp/server.ts`（dispatch、toolSchemas、featureMutation helper）；新增 `src/mcp/input-validation.ts`
- **U9**：`mcp/server.ts:693,783,786,798`（`host ?? "codex"` 现状）；`core/approval-interactions.ts`、`core/requirements-grill.ts`、`core/review-jobs.ts`、`core/rollback.ts`（host-event 消费点）
- **U7**：`mcp/server.ts:362-372,683-937`；`core/verification.ts:257-268`；`core/execution-brief.ts`；`core/status.ts:61-94`；`hosts/adapter-policy.ts:4,450-453`
