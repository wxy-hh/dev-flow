# Dev Flow 5.0 架构

## 分层

| 层 | 职责 |
| --- | --- |
| Skills | 调查、生成工件、按 MCP 合同执行动作 |
| Policy | 纯函数计算 level、控制、路线、义务与 evidence |
| Core/MCP | CAS 状态、决策、Trace、review、checkpoint、freshness、verification、delivery、repair |
| Host adapters | 可信用户事件、写入前后事件、阶段门禁和宿主协议归一化 |

## Schema 与状态

- FeatureState schema v4，project config v2，review ledger v2，checkpoint manifest v2。
- 旧 schema 返回 `UNSUPPORTED_*_SCHEMA`，没有迁移器。
- 所有 mutation 使用进程锁、revision CAS、fsync 和 atomic rename；原始事件与内容寻址 snapshot 是审计事实。
- `dev_flow_repair_feature` 只能重建派生 pointer/stage/freshness/projection。

## 动态治理

Policy 对 changeSurface、behaviorChange、topology 取最高下限，再派生 GovernanceControls。`routeDefinitionForFeature` 将控制编译为 operational steps；Classification 的 `orderedRoute` 还完整显示 plan-review 与 execution-approval 等 Core-owned gate。

`controlEnhancements` 在派生之后做单调合并，只允许用户增加治理。由此开启 plan-review、unit-chain 或 operational recovery 时，Policy 同步补齐 formal plan、Trace 等依赖控制，避免生成不可执行路线。

BoundaryAudit 是锁定硬门禁。M/L 或风险任务先持久化 route-confirmation；可信回答后，分类、Trace/review 初始 pointer、义务和步骤在同一 mutation 中锁定。首次 governed write 前可重算，之后单调加强。

## Governed 文件

`governedRoots` 是写门禁、ownership、fingerprint、checkpoint、verification 与 delivery 的单一范围，支持目录和精确文件。Exclude 先过滤。Git worktree 枚举以 `git ls-files --cached --others --exclude-standard` 为准。

可信 Hook 写入保存规范化路径、host、event 与 before/after 内容摘要，并自动归属。人工/IDE/未知变化创建 ownership decision。安全 symlink 以 link target blob 参与指纹和 checkpoint，不跟随读写目标；rollback 原子重建 symlink。

## Freshness 与恢复

Review 以 role basis，approval 以执行授权语义，checkpoint 以 unit scope/dependencies/content，verification 以 governed-root fingerprint 保存 basis。验证命令同时保留稳定 command id 与 hash：只比较 Trace/RU 实际引用的命令，未引用命令变化不会扩大失效范围。Reconcile 只更新 lineage、ownership 与受影响证据；字节未变不 stale，真实变化撤销最早受影响步骤和下游 finalize claim。

所有任务有自动 baseline 与 delivery reverse。Operational strategy 和 executable rollback 独立派生；不可逆变化只声明备份/预览/中止/补偿/full verification。

## Trace、Review、Verification

正式计划登记即执行完整 Trace 校验。Review v2 的 job 带 `roleBasisHash`，语义 diff 支持角色级 `reused`；未知 diff 全审。Finding target 只接受 governed path 或 frozen Trace ID，evidence 可引用 job 包冻结工件。

RU checkpoint 只运行 targeted forward verification。Final verification 用命令 `provides` 覆盖 guarantee 集并选择最小去重集合；preflight 不计 evidence。Finalize 内部完成所有完整性检查，不暴露 feature-check 工具。

## MCP 交互

原生 form elicitation 使用 `oneOf + const + title`。所有路线、ownership、grill、approval、risk、quality exception、rollback 和 task-switch 问题都落在同一个 interaction 账本；等待上限 60 秒，超时发送 cancellation 并熔断当前会话到文本；decline/cancel/协议错误保留 pending。普通决策的表单与文本回答经过同一语义匹配器，只接受唯一可判定的标签、简称或登记同义表达；approval 保留严格整句策略。回答由 append-only presentation cursor、同宿主和一次性消费共同证明，不能重建事件或手改状态。错误统一包含稳定 code、中文原因、影响、恢复动作和白名单安全细节。

开始任务、implementation 推进、checkpoint 和 finalize 前，Core 校验同宿主 15 分钟内的 hook 健康信号。doctor 按 session、prompt、tool 能力分别诊断 missing、stale、healthy，避免 SessionStart 掩盖 prompt/tool 局部断线。Host adapter 只归一化信号；失联后的首个恢复信号由 Core 触发活动工作区对账，未知路径自动进入正式 ownership interaction。
