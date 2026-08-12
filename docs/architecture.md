# Dev Flow 架构

## 分层

| 层 | 职责 |
| --- | --- |
| Skills | 调查、生成工件、按 MCP 合同执行动作 |
| Policy | 纯函数计算 level、控制、路线、义务与 evidence |
| Core/MCP | CAS 状态、决策、Trace、review、checkpoint、freshness、verification、delivery、repair |
| Host adapters | 可信用户事件、写入前后事件、阶段门禁和宿主协议归一化 |

## Schema 与状态

- FeatureState 运行态 schema v5（仅当前 5.0 schema v4 active state 在加载入口转换），project config v2，review ledger v2，checkpoint manifest v2。
- 旧 schema 返回 `UNSUPPORTED_*_SCHEMA`，没有迁移器。
- 所有 mutation 使用进程锁、revision CAS、fsync 和 atomic rename；原始事件与内容寻址 snapshot 是审计事实。
- `dev_flow_repair_feature` 只能重建派生 pointer/stage/freshness/projection。

## 动态治理

Policy 对 changeSurface、behaviorChange、topology 取最高下限，再派生 GovernanceControls。`routeDefinitionForFeature` 将控制编译为 operational steps；Classification 的 `orderedRoute` 还完整显示 plan-review 与 execution-approval 等 Core-owned gate。

`controlEnhancements` 在派生之后做单调合并，只允许用户增加治理。由此开启 plan-review、unit-chain 或 operational recovery 时，Policy 同步补齐 formal plan、Trace 等依赖控制，避免生成不可执行路线。

BoundaryAudit 是锁定硬门禁。M/L 或风险任务先持久化 route-confirmation；可信回答后，分类、Trace/review 初始 pointer、义务和步骤在同一 mutation 中锁定。首次 governed write 前可重算，之后单调加强。

需求阶段（`requirements_alignment`）由 `requirements` 技能生成或复用需求证据；grill 决策在登记前逐项收敛。登记 `需求文档.md` 后，技能向用户展示范围、目标、非目标与验收条件摘要及决策记录，用户确认或提出修改（修改需重新登记）后才执行 record_step 进入 planning。该确认是技能层约定：Core 的步骤满足仍以 grill 已收敛、需求 Trace slice current 为准，不设独立门禁。

## Governed 文件

`governedRoots` 是写门禁、ownership、fingerprint、checkpoint、verification 与 delivery 的单一范围，支持目录和精确文件。Exclude 先过滤。Git worktree 枚举以 `git ls-files --cached --others --exclude-standard` 为准。

可信 Hook 写入保存规范化路径、host、event 与 before/after 内容摘要，并自动归属。人工/IDE/未知变化创建 ownership decision。安全 symlink 以 link target blob 参与指纹和 checkpoint，不跟随读写目标；rollback 原子重建 symlink。

## Freshness 与恢复

Review 以 role basis，approval 以执行授权语义，checkpoint 以 unit scope/dependencies/content，verification 以 governed-root fingerprint 保存 basis。验证命令同时保留稳定 command id 与 hash：只比较 Trace/RU 实际引用的命令，未引用命令变化不会扩大失效范围。Reconcile 只更新 lineage、ownership 与受影响证据；字节未变不 stale，真实变化撤销最早受影响步骤和下游 finalize claim。

实现单元是 unit-chain 的最小交付粒度：begin 快照 baseline 并激活单元，checkpoint 只运行 targeted forward verification 后固化 diff 与证据，rollback 以 checkpoint 为回撤目标。验证命令定义变化会使 Trace/RU 的 `verificationCommandHashes` 失配（`TRACE_SLICE_STALE`），而计划重登记要求单元 quiescent（`PLAN_REVISION_REQUIRES_QUIESCENT_UNIT`）；两者互锁时由 `dev_flow_abandon_implementation_unit` 提供出口：取消 active 单元（工作区改动保留、单元回 pending）→ 重登记计划刷新 Trace 基线 → 重新 begin。取消不还原代码、不伪造 checkpoint 证据，事件以 reason 记录审计。

所有任务有自动 baseline 与 delivery reverse。Operational strategy 和 executable rollback 独立派生；不可逆变化只声明备份/预览/中止/补偿/full verification。

## Trace、Review、Verification

正式计划登记即执行完整 Trace 校验。Review v2 的 job 带 `roleBasisHash`，语义 diff 支持角色级 `reused`；未知 diff 全审。Finding target 只接受 governed path 或 frozen Trace ID，evidence 可引用 job 包冻结工件。

RU checkpoint 只运行 targeted forward verification。Final verification 用命令 `provides` 覆盖 guarantee 集并选择最小去重集合；preflight 不计 evidence。Finalize 内部完成所有完整性检查，不暴露 feature-check 工具。

实现遵循测试先行：每个 RU 内先写该单元测试并看到失败（红灯），再实现至通过（绿灯），最后运行 targeted forward verification 过 checkpoint；计划已声明无法 TDD 的任务（文档、类型导出、机械重构等）直接实现。该约定由 `implement`/`plan` 技能下发，Core 只要求验证命令最终为绿，不感知测试与实现的先后。

## MCP 交互

`grill-interaction.ts` 是 grill 的深模块接缝。它验证 2–3 个带说明的正式选项与唯一推荐理由，按不可变选项顺序派生 A/B/C，并生成文本、表单标题和状态投影共同使用的 presentation。Core 不把“第一项”隐式当推荐，也不把 `other` 保存成第四个正式选项。

同一模块确定性归一回答：代码字母、带选择语义的句子和唯一完整标签落为 `{ kind: "option", answerCode, selectedOptionId, rawReply }`；带实质方案的其他回答落为 `{ kind: "other", rawReply, comment }`。歧义、多选、单纯否定或缺少说明保持 pending，不调用模型猜测。approval 不经过该宽松入口，仍执行严格整句策略。

能稳定消费原生 form elicitation 的客户端使用 `oneOf + const + title`。Claude Code 当前会把这种选择渲染成需要展开、空格选择和额外焦点导航的多步表单，因此 Core 识别其 `clientInfo.name` 后立即使用同一份可信文本 presentation，不等待 60 秒超时。所有路线、ownership、grill、approval、risk、quality exception、rollback 和 task-switch 问题仍落在同一个 interaction 账本；其他客户端表单超时会发送 cancellation 并熔断当前会话到文本，decline/cancel/协议错误保留 pending。回答由 append-only presentation cursor、同宿主和一次性消费共同证明，不能重建事件或手改状态。错误统一包含稳定 code、中文原因、影响、恢复动作和白名单安全细节。

Claude `AskUserQuestion` 的成功 `PostToolUse` 会把宿主实际展示问题对应的选择记为可信 user-prompt；Core 不接受未展示问题的伪造答案。因此模型可在一次原生选择后直接调用 `dev_flow_answer`，不再让用户切换到文本重复确认。

开始任务、implementation 推进、checkpoint 和 finalize 前，Core 校验同宿主 15 分钟内的 hook 健康信号。doctor 按 session、prompt、tool 能力分别诊断 missing、stale、healthy，避免 SessionStart 掩盖 prompt/tool 局部断线。Host adapter 只归一化信号；失联后的首个恢复信号由 Core 触发活动工作区对账，未知路径自动进入正式 ownership interaction。
