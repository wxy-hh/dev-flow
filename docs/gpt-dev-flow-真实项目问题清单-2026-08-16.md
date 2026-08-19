# Dev Flow 真实项目问题清单（GPT 审计）

日期：2026-08-16  
审计对象：Dev Flow 5.1.4（仓库 HEAD `2c189b9`）在 Svelte 与 TanStack Query 两次 Claude Code 新需求会话中的实际行为。最终版已与 `v4flash-devflow-issue-analysis.md`、`v4pro-devflow-真实项目问题清单-2026-08-16.md` 逐项交叉验证。

## 结论

两份 `audit-log.md` 的主要痛点大体属实，但若按完整思考链、事件账本和最终工作区复核，根因需要重新归类：

- 确认需要修复：**12 个问题（P0×4、P1×5、P2×3）**。
- 最高优先级是：计划修订不原子、Trace 新鲜度门禁存在空集漏洞、计划文档可与机器 Trace 静默漂移、Claude 隔离审查证明无法按真实 hook schema 落账。
- TanStack 的高重复成本不是单一问题，而是“plan/code 共用一个 current review”“unknown diff 禁止角色复用”“reconcile 先删基准指针”三个机制叠加。
- 有些审计结论不是 Dev Flow 缺陷：route confirmation 首次失败是 Claude 改写用户原话；第三次 checkpoint 失败实际抓到了代码回归；Playwright 缺失、`full-ci` 过宽属于环境或项目配置。

建议不要直接按原 audit-log 或模型清单投票式修补。优先处理本清单中的 GPT-001～GPT-009，再做 GPT-010～GPT-012。

## 证据范围与验证方法

输入记录：

- Svelte 完整会话：`/Users/weixiaoyu/Desktop/practice/dev-flow-issue/sveltejs-svelte/2026-08-16-224853-local-command-caveatcaveat-the-messages-below.txt`
- Svelte 审计：`/Users/weixiaoyu/Desktop/practice/dev-flow-issue/sveltejs-svelte/devflow-issues/audit-log.md`
- TanStack 完整会话：`/Users/weixiaoyu/Desktop/practice/dev-flow-issue/TanStack-query/packages/query-core/2026-08-16-225155-local-command-caveatcaveat-the-messages-below.txt`
- TanStack 审计：`/Users/weixiaoyu/Desktop/practice/dev-flow-issue/TanStack-query/devflow-issues/audit-log.md`

交叉验证还读取了两边 `.dev-flow/features/*/{state.json,events.jsonl,traceability,review,checkpoints}`，并对照当前源码与发布缓存。仓库 `dist/mcp-server.mjs` 和 Claude 5.1.4 缓存 bundle 的 SHA-256 完全一致，故下述行为不是“本地源码与已安装版本不一致”造成的。

定向回归测试：

```text
node --test \
  tests/unit/v5-plan-revision.test.mjs \
  tests/unit/v5-review-gate.test.mjs \
  tests/unit/v5-review-isolation-gate.test.mjs \
  tests/unit/v2-verification-attempts.test.mjs \
  tests/unit/v5-plan-preflight.test.mjs \
  tests/unit/v2-input-validation.test.mjs \
  tests/unit/v5-unified-review-state.test.mjs \
  tests/unit/v2-host-event-provenance.test.mjs

46 tests passed, 0 failed
```

覆盖 plan revision、review gate、isolation gate、verification attempts、plan preflight、MCP input validation、unified review state、host provenance。测试全绿说明若干问题是被现有测试明确固化的行为，或是现有 fixture 没有覆盖真实宿主数据，并非偶发状态损坏。

本轮交叉验证的两个关键最小信号：

```text
真实 Svelte artifact/Trace 对照：exit 1
RED: plan artifact and machine Trace carry different execution semantics

真实 Trace rev6/rev7 直接计算：
impact {"affectedIds":["UNIT-003"]}
```

前者确认新增 GPT-003；后者反证另外清单提出的“JSON 键序导致 UNIT-001/002 误判”。

实战量化：

| 指标 | Svelte | TanStack Query |
|---|---:|---:|
| 最终 state revision | 175 | 213 |
| review batch | 5 | 12（plan 7、code 5） |
| review job claim / submit | 20 / 16 | 38 / 38 |
| stale / current review batch | 4 / 1 | 11 / 1 |
| implementation checkpoint | 2 | 10（5 个单元被完整重跑两轮） |
| `.dev-flow` 体积 | 48 MB | 27 MB |
| feature 文件数 | 8,213 | 2,161 |

## 需要解决的问题

优先级定义：P0 会让核心保证无法兑现或产生错误证据链；P1 会造成确定性的重复劳动/公开合同失配；P2 是并发与长期运维问题。

| ID | 优先级 | 问题摘要 |
|---|---|---|
| GPT-001 | P0 | plan revision 确认没有原子登记已编译 Trace 提案 |
| GPT-002 | P0 | stale-only plan Trace 被空集检查误判为 current |
| GPT-003 | P0 | Markdown 计划与机器 Trace 可静默承载不同语义 |
| GPT-004 | P0 | Claude SubagentStop 真实 schema 无法生成隔离证明 |
| GPT-005 | P1 | plan/code review 共用唯一 current batch，阶段互相失效 |
| GPT-006 | P1 | unknown diff 在所有角色 hash 相等时仍禁止全部复用 |
| GPT-007 | P1 | reconcile/风险接受丢失逐文件基准，退化为全单元重开 |
| GPT-008 | P1 | MCP schema 与 Core 的 `task.tdd` 合同分裂 |
| GPT-009 | P1 | targeted verification 校验过晚且可由 inline 写法绕过 |
| GPT-010 | P2 | parallel-safe 与全局 revision CAS 冲突 |
| GPT-011 | P2 | live state/历史证据缺少体积预算与分层 |
| GPT-012 | P2 | 交互失败原因与可见提示不精确，制造无效重试 |

### GPT-001（P0）计划修订不是原子事务，编译通过的 Trace 提案在确认时被丢弃

状态：**属实，且是 Svelte 重复审查链路的首要根因。**

证据：

- `plan-revision.ts:20-26` 和 `:125` 的注释声称确认时会在同一 CAS 中重登记计划；实际 `applyPlanRevision`（`:126-155`）只更新 implementation-plan artifact SHA、重开单元和步骤，没有写入 Trace pointer，也没有保存预检得到的 `newLedger`。
- 现有 `v5-plan-revision.test.mjs:119-127` 反而把“确认后 Trace 仍旧，必须再次 `recordArtifactWithTrace`”写成期望行为。
- Svelte 真实事件：revision 54 `plan-revised` 后，revision 55～63 创建并完成 4 个 review job；revision 64 才重登记 Trace，使刚完成的 batch 失效；revision 65～73 又完整审查一次。
- 第三次修订交互持久化了“UNIT-001/002/003 全受影响”，但最终登记的 Trace rev6→rev7 语义差异只有 UNIT-003 的 `forwardVerification`。由于 `revise_plan` 的输入 delta/newLedger 没有持久化，事后无法证明预览和登记用的是同一提案。这既是原子性问题，也是审计证据缺口。

修复要求：

- `revise_plan` 预检后将 proposed ledger/delta 的内容寻址快照与 basis 一并保存到 interaction。
- 用户确认时在一个事务中同时更新 artifact、Trace pointer、implementation-unit 投影和精确失效集；不再要求 agent 手动重放 `record_artifact_with_trace`。
- 回答时校验计划、项目配置、旧 Trace 和 proposed snapshot 均未漂移；失败则整体不落账。
- 新增集成测试：确认修订后立即 `create_review_batch`，不得出现中间 stale Trace；预览影响集必须等于最终登记图的实际 diff。

### GPT-002（P0）Trace 新鲜度检查把“没有 current plan 节点”误判为通过，且 next 先调度 review 再检查 Trace

状态：**属实，可最小复现。**

证据：

- `traceability-gates.ts:79-81` 只检查 `status === "current"` 的 implementation-plan 节点 SHA；当所有 plan 节点已经是 stale 时，候选集合为空，函数直接通过。
- 最小构造一个只有 stale implementation-plan 节点的 ledger，调用 `assertImplementationPlanTraceCurrent`，当前实现输出：`BUG: stale implementation-plan node was accepted`。
- Svelte 在 requirements 重登记后，Trace rev4 为 current 13 / stale 20；旧 plan 节点全 stale。于是 plan revision 后 `create_review_batch` 被放行，完整审查结束后重登记 Trace 又将该批次失效。
- `next.ts:183-199` 在 planning/implementation 路径中先执行 `reviewPlanAction`，之后才执行 `inspectTraceGate`，调度顺序进一步放大了漏洞。

修复要求：

- 启用 plan Trace 的路线必须至少存在一组 current implementation-plan 节点；“零 current 节点”应返回 `TRACE_SLICE_STALE` 或更明确的 `TRACE_SLICE_MISSING`。
- 同时检测同源 stale 节点、artifact SHA 和 current slice 完整性，不能用过滤空集代表成功。
- `next` 必须先给出 `repair-trace`，Trace 当前后才能创建/复用 review batch。
- 加入“requirements 重登记使 plan 节点 stale → revise plan → next/create batch 必须阻断”的真实序列测试。

### GPT-003（P0）Markdown 计划与机器 Trace 可以在同一 artifact SHA 下静默承载不同语义

状态：**属实，是另外两份清单中最重要且我初版遗漏的问题。**

证据：

- Svelte 最终 implementation-plan artifact SHA 为 `1ef770...`，Trace rev7 的所有 plan 节点也声称来源于该 SHA，Core 因而把二者视为同一份当前证据。
- 实际 Markdown 的 UNIT-001 `file_scope` 没有 `branches.js`、`each.js` 和两个 legacy `_config.js`，Trace 却包含这 4 个路径；Markdown 的 UNIT-001/002 仍引用 named verification，Trace 已改为 inline；Markdown 的 UNIT-003 仍是 `svelte-full-tests, svelte-check`，Trace 已改成排除 `runtime-browser` 的两条 inline command。
- 真实事件多次出现 `artifactChanged:false, traceChanged:true`。这不是措辞差异，而是人工审查计划与机器执行计划发生实质分叉。
- `traceability-anchors.ts:43-71` 只提取 block 的 ID/kind 和整块 hash；`traceability.ts:348-363` 只要求 delta 与 block 的 ID/kind 集合一致，不解析或核对 `tasks/file_scope/covers/forward_verification` 等字段。因此同一个未修改 block 可以挂载任意调用方提供的机器语义。

修复要求：

- 消除“双输入源”：优先从规范化 Markdown/YAML block 直接编译 Trace；或者由机器 Trace 生成只读 Markdown 投影，不能继续让 agent 同时手写两份独立语义。
- 若短期仍接受 traceDelta，必须解析 block 的结构化字段并逐字段核对；任何语义变化都要求 artifact 内容/SHA 同步变化。
- plan revision interaction 持久化 proposed artifact 与 proposed Trace 的共同 basis，确认时原子登记；不得出现 `artifactChanged:false, traceChanged:true` 的计划语义变更。
- 增加真实回归测试：只改 delta、不改对应 Markdown block 时必须拒绝；人工计划和 checkpoint 最终执行命令必须来自同一份规范化值。

### GPT-004（P0）Claude `SubagentStop` 适配器读取了宿主不存在的父上下文字段，隔离审查证明无法落账

状态：**属实；当前单测使用了虚构 schema，形成假绿。**

证据：

- `review-execution-adapter.ts:87-104` 用 `agent_id` 等字段取子上下文，却只从 `parent_agent_id`、`parent_session_id` 等字段取父上下文。
- Claude Code 的真实 `SubagentStop` 事件提供公共 `session_id`，以及 `agent_id`、`agent_type`、`agent_transcript_path`、`last_assistant_message`；没有适配器所依赖的 `parent_session_id`。参见 [Claude Code hooks 官方文档](https://code.claude.com/docs/en/hooks)。
- `v5-review-isolation-gate.test.mjs:223-239` 手工构造 `tool_input.subagent_session_id` 和 `parent_session_id`，并非真实事件形状。
- TanStack 事件账本有 4 次 `review-execution-declared`、真实 Agent 调用及 submission，但 `review-execution` 为 0，最终两次被迫走 quality exception。
- hook 对 `{ recorded:false, reason:"missing-context-ids" }` 没有可见诊断，agent 只能反复重试。

修复要求：

- 对真实 `SubagentStop`：`session_id` 作为 implementation/parent context，`agent_id` 作为 isolated child context；marker 从 `agent_transcript_path` 恢复。
- 用官方真实 payload fixture 替换虚构字段测试，并增加端到端“declare → SubagentStop → submit → record code_review”测试。
- hook 必须把 `missing-marker`、`unknown-declaration`、`missing-context-ids` 等结果写入诊断事件/doctor，而不是静默丢弃。
- 明确会话启动前后的 hook 装载要求；旧会话未加载新 hook 时返回可执行的恢复说明。

### GPT-005（P1）plan review 与 code review 共用唯一 current batch，两个阶段相互打成 stale

状态：**属实，是 TanStack 审查风暴的结构性根因。**

证据：

- `review-jobs.ts:711-713` 创建任何新批次时，把所有 `validity === "current"` 的批次标为 stale，不区分 `phase`。
- 当代码修复重开 implementation 后，`next.ts:183-185` 会再次调用 plan review 调度；此时原 plan batch 已被 code batch 标 stale，即使 `steps.planning` 仍 satisfied、计划和 Trace 没变，也会要求新 plan batch。
- TanStack 最终有 12 个完整 batch：plan 7、code 5；只有最后一个 current，11 个 stale；38 个 job 全部重新提交。
- 最终 `steps.planning.evidence.batchId` 仍是已 stale 的 `175b2c18...`，而 current plan batch 已是 `dae470e0...`。流程继续运行，但 state 对“planning 由哪个批次满足”给出自相矛盾的答案。

修复要求：

- ledger 支持每个 phase 各自一个 current batch，创建 code batch 不应使 plan batch stale，反之亦然。
- planning evidence 绑定 plan-phase batch；code_review evidence 绑定 code-phase batch；各门禁只查询对应 phase。
- 新 plan batch 成为 current 时，必须原子重开或重新 stamp planning evidence；状态校验/doctor 应拒绝或报告 evidence 指向 stale/non-plan batch。
- implementation 内容变化只失效 code review/verification；只有计划 artifact、Trace、相关验证命令或分类语义变化才失效 plan review。
- 增加“plan 通过 → implementation → code review → 修代码 → implementation”测试，期望 plan batch 保留并只重做受影响 code job。

### GPT-006（P1）`unknownDiff` 在所有角色 basis 都相等时反而禁止全部复用

状态：**属实；安全兜底的粒度设计错误。**

证据：

- `review-jobs.ts:630-638` 在“所有角色都找到了可复用 job，但全局 basisHash 变化”时设置 `unknownDiff`，随后通过 `unknownDiff ? undefined : reusable` 主动丢弃所有复用结果。
- plan 角色 hash 不绑定实现内容 fingerprint（`:275-343`）；全局 basis 却绑定 `governedRootsFingerprint` 和 `featureOwnedFingerprint`（`:226-248`）。因此纯代码变化会造成“每个 plan 角色语义都没变，但四个角色全部重审”。
- TanStack 三个 plan batch 记录了 `unknownDiffInfo`，changedFields 包括 `governedRootsFingerprint`、`featureOwnedFingerprint` 等；没有一个 job 被标记为 `reused`。

修复要求：

- 角色 basis 相等时保留复用；未知的全局字段应映射到一个明确的 cross-cutting/scope job，或明确归入受影响角色，不能抹掉已证明相等的角色切片。
- plan phase 不应把纯 feature-owned 源码变化作为未知 plan diff。
- 测试至少覆盖：纯源码变化、项目验证命令变化、governed root 新增未归属文件，并分别断言精确重审角色。

### GPT-007（P1）`reconcile_workspace` 与 risk acceptance 没有保住逐文件基准，失效传播只能全量重开 checkpoint

状态：**属实；audit-log 的“缺少快照”描述对，但根因是指针被提前删除，不是磁盘没有快照。**

证据：

- `recordStep(code_review)` 会写逐文件快照并把 `fingerprint/snapshotPath` 存入 `steps.code_review.evidence`（`feature-check.ts:134-144`）。
- `reconcileWorkspace` 在 `ownership-workflow.ts:278-282` 检测到 checkpointAffected 后先 `delete draft.steps.code_review`。
- `invalidateAffectedClaims` 只能从 `steps.verification` 或 `steps.code_review` 找 baseline（`change-invalidation.ts:33-51`）；指针已删时，risk acceptance 只剩 aggregate fingerprint，没有 snapshotPath，于是 `:128-134` 退化为完整重开。
- `quality-exceptions.ts:132-156` 在接受风险时只保存 feature-owned aggregate SHA，并重置 full-workspace fingerprint，不写逐文件 snapshot；即使没有“先删 code_review”这条路径，单独依赖 risk acceptance 作为最近基准时也无法精确定位后续变化。
- TanStack revision 154 已登记 code_review，磁盘存在 `review/snapshot-059e...json`；revision 165 reconcile 后，revision 166 仍报告“缺少逐文件基准快照”，重开 UNIT-001～005。revision 212 再次完整重开。

修复要求：

- 把“最近一次成功审查/验证基准”作为独立、不可因步骤重开而删除的 state pointer；step evidence 只表示门禁状态。
- risk acceptance 落账时也保存逐文件内容寻址快照及 pointer，使接受风险后的下一次变化仍可做精确 diff。
- reconcile 应先基于旧 evidence 计算精确 diff，再原子传播失效，不能先删证据后再让另一入口推断。
- 可用各 checkpoint manifest/baseline 辅助定位；只有快照文件确实损坏或变化文件无法映射时才全量回退。
- 回归测试：五个 checkpoint 完成并 code_review 通过，只修改 UNIT-003 文件后 reconcile，必须只重开 UNIT-003。

### GPT-008（P1）MCP JSON Schema 拒绝 Core 已支持且 skill 要求的 `task.tdd`

状态：**完全属实，是公开工具合同分裂。**

证据：

- `policy/traceability.ts:68-75,147-152` 定义 `tdd?: "test-first" | "direct"`。
- `core/traceability.ts:56-63,165-170` 接受并校验该字段；`plan-compiler.ts:163-184` 使用它执行 TDD 约束。
- `mcp/dispatch.ts:140` 的 task schema 只声明 `kind/id/covers/implementationUnit`；object 默认拒绝 additional properties，真实会话因此得到 `INVALID_TOOL_INPUT unknownField=tdd`。
- plan/implement skill 又要求声明并遵守该字段，agent 被迫把 TDD 信息只留在人类文档中，机器 Trace 丢失。

修复要求：

- MCP task schema 增加 `tdd: { enum: ["test-first", "direct"] }`，并保证所有 traceDelta 工具复用同一 schema 源。
- 增加“公开 MCP schema → dispatch → Core validator → compiler”契约测试，避免手写 schema 再漂移。

### GPT-009（P1）forward verification 的 targeted 校验过晚，且 inline 写法可以绕过同一保证

状态：**属实，Svelte 实战已触发。**

证据：

- Trace 登记只检查 command ID 是否存在（`traceability.ts:374-384`）。
- plan compiler 没有检查 `provides`。
- checkpoint 才在 `checkpoints.ts:264-276` 对每条命令逐一检查 `provides.includes("targeted")`，并在第一条违规引用处抛 `TRACE_VERIFICATION_COMMAND_NOT_TARGETED`。
- 同一个命令改写成 inline object 后会在 `checkpoints.ts:255-262` 被无条件赋予 `provides:["targeted"]`；inline schema 又没有 `provides` 字段。于是宽泛的 full/integration 命令只要换一种表示法就能绕过 named-command 门禁，机器并没有验证它真的 targeted。
- Svelte 的计划 `validate_plan` 返回 `ok:true`，UNIT-001 开始执行后才失败，被迫 abandon active unit、修订计划、重审和重新批准。

修复要求：

- compile/validate plan 时根据 project config 聚合报告所有 `{unitId, commandId}` 的非 targeted 引用。
- named 与 inline command 使用同一保证合同：inline 至少显式声明并校验 `provides`，更稳妥的是先登记为 project command 后再引用；禁止“换写法即自动 targeted”。
- 正式登记与预检共用同一诊断，checkpoint 保留防御性校验。
- recoveryHint 修正“在 RU 中改用”为“在 implementation unit 的 forwardVerification 中改用”。

### GPT-010（P2）batch 宣称 `parallel-safe`，但 job claim/submit 使用全局 revision CAS，真实并行必然冲突

状态：**属实，属于并发合同与 API 形态不一致。**

证据：

- Svelte 首轮 4 个子代理并行时，多个 `claim_review_job` 使用同一个 expectedRevision，除第一个外出现 `STATE_REVISION_CONFLICT`，随后被迫串行重试。
- 每次 claim/submit 都推进 feature 全局 revision；子代理若各自独立提交，同样无法真正并行写回。
- skill 看到 `executionMode=parallel-safe` 会“并行优先”，但 API 没有提供一次性 claim 或 job 级 CAS。

修复要求：

- 提供原子 `claim_review_jobs` 批量领取，或改为 job lease/version，使不同 job 的写入可独立合并。
- 若暂不支持并行 mutation，公开字段和 skill 必须明确“review execution 可并行，claim/submit 需协调器串行”，并自动处理 revision 刷新。

### GPT-011（P2）长任务状态与不可变证据缺少体积预算、压缩和面向用户的历史分层

状态：**属实，但不是当前阻断流程的 correctness bug。**

证据：

- 两次未完成任务已产生 75 MB、10,374 个 feature 文件。
- Svelte checkpoint blobs 8,080 个、state 2.2 MB；TanStack checkpoint blobs 1,889 个、state 2.3 MB。
- TanStack `state.repair.attempts` 两条 `progressEvidence` 合计约 1.4 MB；Svelte `workspace.observedPathFingerprints` 约 1.39 MB、8,790 条。
- stale review/Trace snapshot 作为不可变审计事实有价值，不能简单删除；问题是 live state、历史证据和 doctor 展示没有清晰分层，也没有显式 retention/compaction 工具。

修复要求：

- state 只保留 pointer、摘要和有界 output tail；大块 repair/verification 证据落独立内容寻址文件。
- doctor 默认展示 live blocker，历史/stale/orphan 进入单独统计与按需展开。
- 提供安全的 archive/compact 命令：保持审计 hash 链和当前恢复所需证据，清理可证明不可达的重复投影；定义体积与文件数基准测试。

### GPT-012（P2）交互失败原因和用户可见提示不精确，制造无效 doctor/重答循环

状态：**部分属实；fail-closed 本身正确，问题在诊断分支和可见合同。**

证据：

- Svelte route confirmation 时，宿主已经捕获用户原文“确认路线”，但 Claude 向工具传“确认这条路线”。`resolvePromptEvent` 能看到同宿主候选却没有文本匹配，最后仍统一抛“宿主没有捕获消息”，recoveryInstruction 要求先运行 doctor；doctor 实际没有修复任何东西，改传原文才成功。
- `interaction-provenance.ts:117` 的恢复说明没有区分“零候选/hook 缺失”“存在候选但调用方改写”“多个候选歧义”。三种根因需要不同恢复动作。
- quality exception 的 option 内部有 `requiresComment:true`，但 `quality-exceptions.ts:85` 的公开 question 只问“是否接受”；TanStack 第二次用户直接回复“接受风险”后才收到 `INTERACTION_COMMENT_REQUIRED`，多耗费一轮。

修复要求：

- provenance 错误按候选状态分型：hook/事件缺失才建议 doctor；存在唯一未消费候选但文本不匹配时，明确要求工具调用使用捕获到的原始消息，不要求用户重答。
- 需要 comment 的交互把要求和示例格式写进公开 question/presentation，而不只藏在 option 元数据。
- 保持 fail-closed 和原始事件唯一消费约束，不采用宽松语义猜测来“修复”此问题。

## 与 v4flash / v4pro 清单的交叉验证结果

| 外部清单主张 | 复核结论 | 最终版处理 |
|---|---|---|
| v4pro-004：计划文档与 Trace 静默漂移 | **新增且提升为 P0** | 新增 GPT-003；真实 Svelte 文件和 Trace 已直接证明语义分叉。 |
| v4pro-003 / v4flash-001：JSON 键序使 UNIT-001/002 误判 | **反证** | 不新增；真实 rev6/rev7 经当前函数计算只返回 UNIT-003。 |
| v4pro-007：risk acceptance 缺逐文件快照 | **属实** | 并入 GPT-007，与 reconcile 提前删除 code-review pointer 共同构成全量 fallback 根因。 |
| v4pro-011：planning evidence 指向 stale batch | **属实** | 并入 GPT-005；补充 phase-scoped current 之外的 evidence invariant。 |
| v4flash-006：inline command 自动获得 targeted | **属实** | 并入 GPT-009；不仅要前置校验，还要消除 named/inline 保证不对等。 |
| v4flash-008/013：provenance recovery 与 comment 提示 | **部分属实** | 新增 GPT-012；保留 fail-closed，只修错误分型和用户可见提示。 |
| v4pro-012 / v4flash-014：TanStack checkpoint 疑似 cwd | **已完成缺失复现并反证** | 不列 Core cwd bug；原命令实际跑全套并抓到 569/570 的真实代码回归。 |
| v4flash-009～012、015 / v4pro-014～015 的审查质量、TDD、基线、环境、初始化观察 | **多为 agent、计划、项目配置或改进建议** | 保留在非问题/改进说明，不与已证实的 Core correctness 问题混排。 |

## 原审计中不应当作为 Dev Flow 缺陷处理的事项

| 原观察 | 复核结论 | 理由 |
|---|---|---|
| route confirmation 首次 `INTERACTION_PROVENANCE_UNAVAILABLE` | 拒绝动作不是缺陷 | 用户原话是“确认路线”，Claude 首次向工具传“确认这条路线”；fail-closed 正确拒绝改写文本。第二次传原文即成功。错误分型和 recovery 误导另见 GPT-012。 |
| plan 修订后 execution approval 失效 | 当前案例中属预期安全约束 | 两次修订改变执行/验证语义，不是纯排版；重新批准合理。可在 GPT-001 原子化后减少中间重复，但不应移除语义 basis 绑定。 |
| “JSON 对象键序导致 Svelte UNIT-001/002 被误判 affected” | 已反证 | 直接读取真实 Trace rev6/rev7：UNIT-001/002 的 `JSON.stringify(forwardVerification)` 分别完全相等；把两个完整 ledger 传给当前 `computePlanRevisionImpact` 得到 `affectedIds:["UNIT-003"]`。第三次预览全量只能说明 `revise_plan` 当时收到的未持久化 delta 与最终登记图不同，归入 GPT-001，不能归因于键序。 |
| 所有 plan revision 都必然重开全部 unit | 结论过度泛化 | 当前算法和单测支持局部 UNIT diff；真实 rev6→rev7 也只影响 UNIT-003。全量预览的输入因 GPT-001 未持久化，无法事后重建。 |
| TanStack 最后 checkpoint 是 cwd/路径问题 | 不属实 | 原命令 `pnpm --filter ... test:lib -- --run ...` 实际展开为 `vitest -- --run ...`，跑了 25 个文件并真实失败 1 项（569/570），错误为同步 queryFn 返回 undefined 后读取 `.then`。正确命令 `pnpm --filter @tanstack/query-core exec vitest run src/__tests__/queryScheduler.test.tsx` 才是 1 文件 10/10。Dev Flow 此处阻断正确。 |
| TanStack 最终“代码正确，570/570” | 不属实 | 复跑最终工作区为 569/570；Claude 的最终总结早于/忽略了后续回归。 |
| `full-ci` 超时、Angular 既有/跨包失败 | 项目配置与真实集成发现混合 | `full-ci` 覆盖 99 个项目，超出本 feature 的合理主反馈环；应调整 project config。与此同时它确实抓到了同步 queryFn 时序回归，不能一概视为噪音。 |
| Playwright chromium 缺失 | 环境问题 | 需要依赖预检或项目命令调整，不是状态机错误。 |
| quality exception 要求用户评论 | 预期行为 | 风险接受必须由用户提供理由并绑定当前内容；不能由 agent 代填。可见提示不足另见 GPT-012。 |
| review finding 误判、TDD 红灯前提不成立 | agent/计划质量问题 | Dev Flow 能强制证据流程，但不能保证审查者的领域判断正确。可改进 review package 指令，不应归因于 Core 状态损坏。 |
| 实现写出 `file_scope` 外文件 | 当前是计划偏差，不是门禁失效 | `implementation-units.ts`/`checkpoints.ts` 明确把 fileScope 定义为 anticipated scope，而非写入 allowlist；实际文件集会写入 checkpoint。可增加 warning，但不能把现有非阻断行为描述成 bug。 |
| 缺少性能 pre-change 基线 | 计划质量问题 | 计划写了对比目标却没编排前置采集任务；可由 plan review/模板改进，不是 Core 状态损坏。 |

## 建议实施顺序

1. **先止住错误证据链**：GPT-001～GPT-004。
2. **消除审查与 checkpoint 风暴**：GPT-005～GPT-007。
3. **修复公开合同与前置诊断**：GPT-008、GPT-009。
4. **改善并发、交互与长期运维**：GPT-010～GPT-012。

第一阶段完成前，不建议继续通过 skill 文案承诺“人工计划与机器 Trace 一致”“语义 diff 精确复用”或“Claude 子代理自动形成隔离证明”，因为当前实现尚不能稳定兑现这些保证。
