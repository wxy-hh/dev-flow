# Dev Flow 真实项目使用问题清单

> 日期：2026-08-18  
> 样本：Svelte 与 TanStack Query 两次真实项目实践  
> 目的：把记录中的现象还原为可实施、可验收的问题清单，而不是直接沿用原审计日志中的归因。

## 1. 证据范围

- Svelte 会话记录：
  /Users/weixiaoyu/Desktop/practice/dev-flow-issue/sveltejs-svelte/2026-08-18-104204-this-session-is-being-continued-from-a-previous-c.txt
- Svelte 审计日志：
  /Users/weixiaoyu/Desktop/practice/dev-flow-issue/sveltejs-svelte/devflow-issues/audit-log.md
- TanStack Query 会话记录：
  /Users/weixiaoyu/Desktop/practice/dev-flow-issue/TanStack-query/2026-08-18-104243-this-session-is-being-continued-from-a-previous-c.txt
- TanStack Query 审计日志：
  /Users/weixiaoyu/Desktop/practice/dev-flow-issue/TanStack-query/devflow-issues/audit-log.md
- 两个项目的 .dev-flow 状态、事件与 review execution 记录
- 当前仓库中的 review execution、host adapter、write hook、route/control 与相关测试实现

证据等级：

- 已确认：能由会话、持久化状态/事件和当前实现相互印证。
- 外部因素：发生在模型提供方或宿主调度层，不应直接归为 Dev Flow 内部缺陷。
- 推断：符合现象，但目前记录不足以证明唯一因果关系。

## 2. 总结

两次实践暴露的主故障链相同：

1. start_review_execution 只创建 job，没有交付可直接派发的完整子智能体协议。
2. 调度者自行发明输出格式；子智能体没有返回宿主 adapter 要求的 marker 和 completion JSON。
3. SubagentStop 捕获失败被静默忽略，review execution 始终没有 envelope。
4. complete_review_execution 在零 envelope 时仍返回成功并增加 revision。
5. 批次保持 open，后续 planning 被 REVIEW_BATCH_INCOMPLETE 阻断。
6. 即使用户接受质量例外，当前 gate 也不能终止或绕过未完成 job。

除此之外还有三类独立的状态完整性问题：命令已提交却返回 INTERNAL_ERROR、Read 被当成 write 并污染 revision/ownership、路线控制组合允许出现 unit-chain 与 trace=false 的自相矛盾状态。

本清单共列出 11 项：P0 6 项、P1 3 项、P2 2 项。

## 3. 优先级总览

| ID | 优先级 | 问题 | 两项目 |
| --- | --- | --- | --- |
| DF-01 | P0 | 评审 job 缺少可执行的派发与回收协议 | Svelte、TanStack |
| DF-02 | P0 | 捕获失败静默，零结果 completion 伪成功 | Svelte、TanStack |
| DF-03 | P0 | 质量例外无法解除未完成评审批次 | Svelte |
| DF-04 | P0 | 状态已提交后仍向调用方返回失败 | Svelte |
| DF-05 | P0 | Read/no-op 被记为可信写入并推进 revision | Svelte |
| DF-06 | P0 | unit-chain、rollback 与 trace 的控制不变量失效 | Svelte |
| DF-07 | P1 | 评审批次没有完整的失败、放弃、替代生命周期 | Svelte、TanStack |
| DF-08 | P1 | record_step evidence schema 过宽，错误诊断不充分 | Svelte |
| DF-09 | P1 | 配额失败缺少 fail-fast、限流和可恢复重试 | Svelte、TanStack |
| DF-10 | P2 | repository facts 批量失败缺少定位信息 | Svelte |
| DF-11 | P2 | formal plan 路线暴露不可用的 validate_plan 动作 | Svelte |

优先级定义：

- P0：会造成工作流死锁、状态错误或调用方对提交结果产生错误认知。
- P1：显著削弱恢复能力，导致重复失败或高成本人工绕行。
- P2：不会直接破坏状态，但明显增加定位与操作成本。

## 4. P0 清单

### [ ] DF-01：评审 job 缺少可执行的派发与回收协议

已确认的现象：

- TanStack 第一次派发要求子智能体写入 .dev-flow 下的 envelope Markdown，并以 DONE 结束。
- 当前 v6 宿主协议实际要求 SubagentStop 输出同时包含 dev-flow:isolated-review:<declarationId> marker 和符合 completion schema 的 JSON。
- 第二次派发虽然改为直接返回 JSON，但仍没有 marker，而且 JSON 字段也不是 adapter 的标准 completion 结构。
- 写 envelope 文件被 ARTIFACT_NOT_REQUIRED 或 DEV_FLOW_ARTIFACT_NOT_REGISTERED 阻止，本身符合当前“由宿主捕获、智能体不直接写内部状态”的设计。
- start_review_execution 返回 jobId、role、capability、declarationId 和 packageSha256，却没有返回可以原样交给子智能体的 dispatch prompt 或输出契约。
- plan-review skill 只描述“并行派发、宿主捕获”，没有给出 marker、JSON schema、禁止写文件等关键操作细节。

诊断：

这不是“应该放开 .dev-flow/review 文件写入”的问题，而是评审协议跨越 MCP、skill、宿主和子智能体四层，却没有一个机器可执行的单一交接物。调用者只能猜协议。

整改清单：

- [ ] start_review_execution 为每个 job 返回可原样派发的 dispatchPrompt，或返回等价的结构化 dispatch payload。
- [ ] 派发内容必须包含精确 marker、角色、冻结输入、completion JSON schema 和“不得写任何文件”。
- [ ] completion schema 只在一个核心模块定义，由 MCP 返回、skill 文档和 host adapter 共同引用。
- [ ] 避免父智能体手工拼接整份 review package；返回最小的角色切片或不可误解的 opaque handle。
- [ ] plan-review skill 加入一份完整、可复制的 happy-path 示例。
- [ ] 明确 capability 的使用边界；如果仅供内部回收，不应要求调度者理解或转抄。

验收标准：

- [ ] 对 start_review_execution 返回的 dispatchPrompt 不做任何加工，子智能体完成后即可被 SubagentStop adapter 捕获。
- [ ] 增加从“创建 job → 派发提示 → SubagentStop → envelope → complete batch”的端到端测试。
- [ ] 回归测试证明评审子智能体无需、也不能通过写 .dev-flow 文件提交结果。

建议落点：

- plugins/dev-flow/src/core/review-execution.ts
- plugins/dev-flow/src/hosts/review-execution-adapter.ts
- plugins/dev-flow/skills/plan-review/SKILL.md

### [ ] DF-02：捕获失败静默，零结果 completion 伪成功

已确认的现象：

- adapter 能识别 missing-marker、unknown-declaration、missing-context-ids、same-context、invalid-completion 等失败原因。
- hook-adapter 调用 recordSubagentReviewOutput 后忽略其返回值；只有抛异常时才记录错误。
- 两个项目的 review execution 都长期保持 envelopes: []、leases: leased。
- TanStack 多次调用 complete_review_execution，均以 submittedJobIds: [] 返回成功。
- Svelte 也出现相同行为；每次“完成”都会生成新记录或推进 revision，但没有产生评审结果。
- 调度者因此曾在实际 job 尚未完成、结果也未进入 ledger 时宣布评审完成。

诊断：

系统对最关键的跨进程回收失败采取了 fail-closed，但没有 fail-visible；随后又允许空 completion 以成功形式提交。这同时破坏了可诊断性和操作语义。

整改清单：

- [ ] 所有 capture rejection 都持久化，至少包含 jobId、declarationId、host event id、reason 和时间。
- [ ] inspect/doctor/status 展示每个 job 的最近捕获失败与明确修复建议。
- [ ] complete_review_execution 在零 envelope 时返回 REVIEW_EXECUTION_EMPTY，且不写 snapshot、不增加 revision。
- [ ] 当 job 仍处于 running/leased 时，complete 返回“仍在运行”，不得与“已完成但无结果”混为一谈。
- [ ] 对 invalid-completion 返回字段级 schema 差异，而非仅返回通用错误。
- [ ] 成功响应必须报告 captured、submitted、pending、failed 的明确计数。

验收标准：

- [ ] 缺 marker 的真实 SubagentStop fixture 会产生可查询诊断。
- [ ] 零 envelope completion 不改变 feature revision。
- [ ] 只有至少一个合法 envelope 被提交，或批次被显式终止/豁免时，completion 才能形成终态。

### [ ] DF-03：质量例外无法解除未完成评审批次

已确认的现象：

- Svelte 用户接受了 review 质量例外，authorization 与对应 review obligation 均已满足。
- 随后 planning 仍被 REVIEW_BATCH_INCOMPLETE 阻断。
- 当前 reviewGate 先检查 batch.progress 是否 complete，只有批次完成后才检查 quality exception 对 isolation/blocking findings 的覆盖。
- 现有测试只覆盖“已完成批次 + 质量例外”，没有覆盖“job 无法完成 + 用户接受风险”。

诊断：

产品允许用户执行一个名为“接受风险并继续”的动作，但该动作无法改变真正的阻塞条件。这是治理语义断裂，不是单纯提示文案问题。

整改清单：

- [ ] 为 review batch 增加 waived 终态，保留原 job、lease 和失败历史。
- [ ] 接受与当前 basis/batch 绑定的 review 质量例外后，将对应批次显式终止为 waived，或让 gate 以等价且可审计的方式放行。
- [ ] 快照和 status 必须显示“风险已接受”，不得伪装成 review passed。
- [ ] 例外过期、basis 变化或 scope 变化时自动失效。
- [ ] 如果产品不允许豁免未完成 job，就不要在此状态展示“继续”选项。
- [ ] 首次展示选项时同时收集必需 comment，避免用户选择后再次询问。

验收标准：

- [ ] open jobs + accepted quality exception 可成功记录 planning。
- [ ] ledger 仍能还原哪些 job 未完成、为什么被豁免、谁接受了风险。
- [ ] basis 变化后旧例外不能继续放行。

### [ ] DF-04：状态已提交后仍向调用方返回失败

已确认的现象：

- Svelte 的 record_step requirements_alignment 返回 INTERNAL_ERROR，但事件中已经出现 step-recorded，状态也已满足。
- dev_flow_pause 返回 INTERNAL_ERROR，但事件中已经出现 feature-paused；之后 feature 可以正常 resume。
- 当前实现会先写入状态，再执行 maybeSealFeatureEvents。后置封存失败会把整个命令表现为失败。

诊断：

这是通用的“提交后报错”原子性问题。调用方收到失败后会安全地重试，但重试可能制造冲突、重复动作或错误恢复。

整改清单：

- [ ] 明确每个 mutation 的事务边界：状态与必要事件应一起提交，或采用可回滚的两阶段写入。
- [ ] 如果核心状态已提交而仅后置动作失败，返回 committed-with-warning，并包含 currentRevision、lifecycle 和失败的后置动作。
- [ ] 错误消息不得再声称“系统动作未完成”。
- [ ] retry token/idempotency key 能识别已提交的同一命令。
- [ ] inspect/doctor 能发现并补做失败的 event sealing。

验收标准：

- [ ] 注入 seal failure 后，调用者可以无歧义地知道 mutation 是否已提交。
- [ ] record_step、pause、resume 等主要 mutation 都有 fault-injection 测试。
- [ ] 相同命令重试不会重复推进状态或产生误导性冲突。

### [ ] DF-05：Read/no-op 被记为可信写入并推进 revision

已确认的现象：

- hook-adapter 对成功的 Pre/PostToolUse 普遍调用 trusted write 逻辑，没有先限定为真实写工具。
- 非 Bash 工具会从 directTargets 提取 file_path；因此 Claude Read 也可能被视为写入目标。
- Svelte v2 事件中出现 19 次 trusted-write-owned。
- 多次读取 implementation plan 和 devflow-issues/audit-log.md 都增加了 revision，即使 before/after hash 相同。
- 该 feature 的实际工作流在 artifact recorded 后已经到 revision 8，后续审计操作把 revision 推进到 25。
- 被读取的文件还会进入 ownership，污染后续 scope 和冲突判断。

诊断：

revision 不再表示业务状态变更，ownership 也不再表示实际修改。这会制造虚假 revision conflict，并降低所有并发控制的可信度。

整改清单：

- [ ] 仅对 isRelevantPreToolUse 判定为写操作的工具执行 trusted write intent/ownership。
- [ ] Read、Glob、Grep、List、Search 等只读工具永远不能生成 trusted-write-owned。
- [ ] PostToolUse 比较 before/after hash；内容未变化时不推进 revision、不改变 ownership。
- [ ] 将 .dev-flow/**、devflow-issues/** 等运行/审计路径排除出交付文件 ownership，或提供显式 governedRootsExclude。
- [ ] 对 audit 文档的真实写入另记 operational/audit event，不与实现 ownership 混用。
- [ ] 提供一次性 projection 修复工具，清理历史上由只读事件造成的错误 ownership；原始事件保留。

验收标准：

- [ ] Read 任意受管文件前后 revision 和 ownership 均不变。
- [ ] 写工具但 hash 未变化时 revision 不变。
- [ ] 真正内容变化仍被正确记录，且现有 write gate 不回退。

建议落点：

- plugins/dev-flow/src/hosts/hook-adapter.ts
- plugins/dev-flow/src/hosts/bash-syntax.ts
- plugins/dev-flow/src/core/state-store.ts
- 对应 PreToolUse/PostToolUse 单元与宿主互操作测试

### [ ] DF-06：unit-chain、rollback 与 trace 的控制不变量失效

已确认的现象：

- Svelte S 路线锁定结果同时包含：plan=formal、trace=false、checkpoints=unit-chain、recovery 含 executable-rollback。
- checkpointsEnforcementRequired 只有在 checkpoints=unit-chain 且 trace=true 时才启用。
- rollbackExecutionAllowed 又依赖 checkpointsEnforcementRequired。
- 最终状态中 implementationUnits 和 traceability 均为空，因此路线宣称的 unit-chain 与 executable rollback 实际未被执行。
- 控制增强逻辑会为 unit-chain/operational recovery 强制 trace，但基础 deriveGovernanceControls 可以先生成上述矛盾组合。

诊断：

路线锁定允许声明一个无法被执行器兑现的控制组合。UI/状态显示“已要求”，实际 gate 却等价于“未启用”。

整改清单：

- [ ] 定义并集中校验控制不变量：unit-chain 必须蕴含 trace=true。
- [ ] executable-rollback 必须蕴含 trace、implementation units 和可验证 checkpoint。
- [ ] 若 S 路线不应升级 trace，则自动降级 checkpoints/recovery，而不是保留不可执行声明。
- [ ] lock_route 前拒绝矛盾 controls，并展示 declared 与 effective controls 差异。
- [ ] snapshot 只展示执行器真正会强制的 controls。

验收标准：

- [ ] 使用本次 Svelte 的真实分类输入，不能再生成 unit-chain + trace=false。
- [ ] 所有可枚举 control 组合通过 property/invariant test。
- [ ] route 锁定结果与后续 gate 的实际行为一致。

## 5. P1 清单

### [ ] DF-07：评审批次没有完整的失败、放弃、替代生命周期

已确认的现象：

- TanStack 最终存在 current、stale、open 多个 batch，但 complete 为 0。
- Svelte L 路线也留下 stale 与 current 两个 open batch。
- 新 basis 产生后，旧 batch 变为 stale，但其 lifecycle 仍显示 open。
- rebuild_review_projection 可以重建投影，却无法创造从未被捕获的 envelope；记录和提示没有清楚说明这一限制。
- 缺少显式 failed、waived、superseded，以及针对单个 job 的重试/替换动作。

整改清单：

- [ ] batch lifecycle 至少区分 pending、running、complete、failed、waived、superseded。
- [ ] 新 basis 创建 successor 时，旧 batch 自动进入 superseded，而不是继续计入 open。
- [ ] 支持在同一 batch 中重试失败 job，保留 attempt 与失败原因。
- [ ] 提供显式 abort/waive 操作，并与 quality exception 绑定。
- [ ] status 将“当前可操作批次”和“历史批次”分开统计。
- [ ] rebuild_review_projection 明确声明只能修复投影，不能恢复未捕获输出。

验收标准：

- [ ] 任一 batch 最终都能进入唯一终态，不会永久 open。
- [ ] status 的 open 数量只包含当前仍可推进的批次。
- [ ] retry、supersede、waive 均有事件链和回归测试。

### [ ] DF-08：record_step evidence schema 过宽，错误诊断不充分

已确认的现象：

- Svelte S 路线无需创建 review batch，只要求 planning evidence 的顶层 reviewType=plan。
- 多次失败调用都把 evidence 传成了 JSON 字符串，而不是对象；另有尝试把 reviewType 放入 fields。
- 当前 MCP schema 将 evidence 声明为宽泛的空 schema，因此字符串能通过入口校验。
- 领域校验只报告 REVIEW_TYPE_MISMATCH，没有显示实际类型，也没有给出标准对象示例。
- 当前单元测试使用的正确形态是对象，其中顶层包含 reviewType。

诊断：

原审计把它归因于“批次逻辑死锁”并不准确。核心缺陷是工具契约允许错误类型进入领域层，而错误提示不足以帮助智能体纠正参数。

整改清单：

- [ ] MCP schema 将 evidence 至少约束为 object。
- [ ] 对 planning evidence 定义可发现的 discriminated schema，明确顶层 reviewType。
- [ ] 错误返回 actualType、receivedShape、expectedPath 和一份最小正确示例。
- [ ] skill 和工具描述明确“传对象，不要传序列化 JSON 字符串”。
- [ ] 如需兼容旧客户端，只能在边界做一次带警告的安全解析，不把双形态扩散进领域模型。

验收标准：

- [ ] 字符串 evidence 在 schema 边界立即失败。
- [ ] 错误信息足以让调用者一次修正。
- [ ] S route 的正确对象 evidence 可直接通过，不创建 review batch。

### [ ] DF-09：配额失败缺少 fail-fast、限流和可恢复重试

已确认的现象：

- Svelte 同时启动 5 个评审智能体，均因模型提供方 429 配额失败。
- TanStack 首次也遇到 429；切换模型后新的智能体可以产生评审内容，但由于 DF-01/DF-02 没有进入 ledger。
- 429 本身是外部资源失败，不是 Dev Flow 内部算法错误。

谨慎推断：

并发派发会提高瞬时请求和 token 压力，可能放大配额问题，但现有记录不能证明“并发本身导致月度配额耗尽”。

整改清单：

- [ ] plan review 支持可配置 maxConcurrency，默认值结合 provider 能力设置。
- [ ] 首个明确 quota/resource failure 后停止继续派发或取消尚未开始的 job。
- [ ] execution/job 记录 provider、model、attempt 和标准化 resource failure reason。
- [ ] 模型切换后支持只重试失败 job，不必新建整批或重做已完成角色。
- [ ] 对允许串行的路线提供 serial fallback。
- [ ] 不使用超时自动“通过”评审；超时应进入 failed，之后由重试或显式 waiver 处理。

验收标准：

- [ ] 模拟 429 时不会继续无界启动剩余角色。
- [ ] 切换模型后可以从失败 job 恢复，并保留前一 attempt。
- [ ] 外部资源错误与协议捕获错误在 status 中有不同分类。

## 6. P2 清单

### [ ] DF-10：repository facts 批量失败缺少定位信息

已确认的现象：

- Svelte 连续多次提交 repository observations；每次只有一个 observation 不满足精确 occurrence 要求，整个 batch 原子失败。
- 内部错误数据已经包含 path、text、expectedOccurrence、actualOccurrence。
- 对外格式主要展示 path 和通用 recoveryHint，没有 observation index、kind、目标文本或实际计数。
- 调用者最终只能拆成单条调用逐个探测。

整改清单：

- [ ] 错误路径包含 observations[i]。
- [ ] 返回 kind、path、anchor/text、expectedOccurrence、actualOccurrence。
- [ ] 增加 preflight/dry-run，或一次返回所有无效 observation；正式写入仍保持原子性。
- [ ] 对 symbol-present 与 text-present 给出不同的修复建议。

验收标准：

- [ ] 含多个错误 observation 的请求能一次指出全部问题。
- [ ] 调用者无需拆成单条请求即可修正 batch。

### [ ] DF-11：formal plan 路线暴露不可用的 validate_plan 动作

已确认的现象：

- Svelte S 路线要求 formal plan，但 trace=false。
- 调用 dev_flow_validate_plan(kind=implementation-plan) 返回 TRACE_NOT_ENFORCED。
- 从工具名称和流程位置看，它像通用 plan preflight；实际上被 trace 开关完全禁用。

整改清单：

- [ ] 将结构校验与 trace 校验拆开：formal plan 至少能做结构性 validation。
- [ ] 若当前路线确实不适用，status/skill 不应推荐该动作。
- [ ] 不适用时返回 not-applicable 和正确 next action，不使用看似故障的错误语义。

验收标准：

- [ ] formal + trace=false 路线不会把用户引向必然失败的动作。
- [ ] trace=true 路线仍执行完整 implementation unit 与 coverage 校验。

## 7. 对原审计结论的纠偏

以下现象不应继续作为互相独立的根因重复建单：

- REVIEW_BATCH_INCOMPLETE、evidenceFreshness 缺失、submittedJobIds 为空，主要是 DF-01 与 DF-02 的下游症状。
- Svelte S 路线的 REVIEW_TYPE_MISMATCH 不是“必须先完成评审批次”的死锁，而是字符串 evidence 通过宽松 schema 后在领域层失败。
- envelope Markdown 写入被阻止符合当前 v6 架构；不应通过放开 review 目录写权限来修复。
- 429 是外部模型资源失败。Dev Flow 需要的是限流、fail-fast 和恢复协议，而不是把配额不足包装成内部一致性错误。
- 切换模型可以帮助新的智能体 attempt，但不会自动修复已经 leased、未捕获的旧 execution。
- “定时自动关闭批次”如果等价于自动通过，会破坏治理语义；正确终态应是 failed、waived 或 superseded。

## 8. 建议实施顺序

### 第一阶段：先恢复评审闭环

- [ ] DF-01 可执行派发协议
- [ ] DF-02 捕获诊断与零结果保护
- [ ] DF-07 batch/job 生命周期
- [ ] DF-03 质量例外与 waived 终态

完成标准：在 Claude 宿主中跑通一次真实的多角色 review，所有结果自动进入 ledger；失败时能在 status 中直接看见原因并恢复。

### 第二阶段：修复状态可信度

- [ ] DF-04 mutation 原子性
- [ ] DF-05 Read/no-op revision 污染
- [ ] DF-06 control invariant

完成标准：revision 只随真实状态变化，命令返回与持久化结果一致，路线显示的 controls 都会被实际执行。

### 第三阶段：降低误用与操作成本

- [ ] DF-08 evidence schema
- [ ] DF-09 配额恢复
- [ ] DF-10 repository facts 诊断
- [ ] DF-11 validate_plan 路线适配

## 9. 最小回归矩阵

- [ ] 标准 review dispatch 可被 SubagentStop 自动捕获。
- [ ] missing marker、same context、invalid JSON 都产生持久化诊断。
- [ ] 零 envelope completion 不推进 revision。
- [ ] open review + accepted exception 进入 waived 并允许 planning，且不显示为 passed。
- [ ] Read 工具不改变 revision/ownership。
- [ ] no-op write 不改变 revision/ownership。
- [ ] seal failure 后调用者能确认 mutation 已提交或已回滚。
- [ ] unit-chain 永远不会与 trace=false 共存。
- [ ] evidence 字符串在 MCP schema 边界失败并给出对象示例。
- [ ] repository observation 错误包含 index、expected 和 actual。
- [ ] formal + trace=false 不会暴露必然失败的 validate_plan 路径。

## 10. 非目标

- 不把外部模型配额不足本身列为 Dev Flow 缺陷。
- 不通过允许子智能体直接修改 .dev-flow 内部文件绕过宿主回收协议。
- 不把超时、空结果或用户豁免伪装成“评审通过”。
- 不因本次文档分析直接改动插件源码、生成 dist 或发布变更。
