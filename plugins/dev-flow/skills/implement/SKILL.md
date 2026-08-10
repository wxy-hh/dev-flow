---
name: implement
description: 在 Dev Flow 可信写入归属和自动 checkpoint 保护下实现变更。
---

只在 status 显示 implementation 且审批义务已满足时写 governed 文件。Hook 会为每次允许的智能体写入记录规范化路径、宿主、事件及前后摘要，并自动标为 feature-owned；调用 implementation record-step 时不要提供 `evidence.files`，先用 inspect implementation 查看 Core 派生文件预览。

所有任务都有自动 baseline。`controls.checkpoints=unit-chain` 且存在 Trace RU 时按 Core 的 begin/checkpoint 动作推进；每个 RU 只跑计划声明的 targeted forward verification。code-review 修复产生的新可信写入也自动进入交付。

实现单元生命周期：begin 激活单元，checkpoint 结束单元（记录 diff 与 targeted 验证证据），rollback 以 checkpoint 为回撤目标。验证命令定义或 Trace 基线变更使 checkpoint 报 `TRACE_SLICE_STALE`、计划重登记报 `PLAN_REVISION_REQUIRES_QUIESCENT_UNIT` 时，用 `dev_flow_abandon_implementation_unit` 取消当前 active 单元（工作区改动保留、单元回 pending），重登记计划刷新 Trace 基线后重新 begin。不要通过改回旧配置或手改 ledger 绕过 stale 检查。

每个 RU 内按测试先行执行：先写该单元测试并看到失败（红灯），再实现至通过（绿灯），最后运行计划声明的 targeted forward verification 过 checkpoint。项目配置了 tdd 技能时按其红-绿-重构流程执行；计划已声明无法 TDD 的任务（文档、类型导出、机械重构等）直接实现，不强制造测试。

IDE、人工或无法归因的变更必须 reconcile 并回答唯一 ownership interaction；多路径先确认完整清单，可选择全部纳入、全部排除或逐个确认，绝不因文件位于 scope/governedRoots 内而静默接纳。开始实现、每个 checkpoint 前确认同宿主 hook 健康仍在 15 分钟窗口内。不要自动 stash/reset、删除缓存、手改 checkpoint 或 trace ledger。缓存清理只运行项目显式配置的 preflight。
