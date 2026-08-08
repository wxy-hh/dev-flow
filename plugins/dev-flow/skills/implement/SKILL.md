---
name: implement
description: 在 Dev Flow 5.0 可信写入归属和自动 checkpoint 保护下实现变更。
---

只在 status 显示 implementation 且审批义务已满足时写 governed 文件。Hook 会为每次允许的智能体写入记录规范化路径、宿主、事件及前后摘要，并自动标为 feature-owned；调用 implementation record-step 时不要提供 `evidence.files`，先用 inspect implementation 查看 Core 派生文件预览。

所有任务都有自动 baseline。`controls.checkpoints=unit-chain` 且存在 Trace RU 时按 Core 的 begin/checkpoint 动作推进；每个 RU 只跑计划声明的 targeted forward verification。code-review 修复产生的新可信写入也自动进入交付。

IDE、人工或无法归因的变更必须 reconcile 并逐个回答唯一 ownership decision；绝不因文件位于 scope/governedRoots 内而静默接纳。不要自动 stash/reset、删除缓存或手改 checkpoint。缓存清理只运行项目显式配置的 preflight。
