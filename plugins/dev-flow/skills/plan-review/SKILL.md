---
name: plan-review
description: 执行或独立调用实施计划审查；它是 planning 的内部保障，不是额外路线步骤。
---

审查前先读取仓库事实和不可变计划 basis。Core 创建 review batch 并按角色隔离 job；审查者只能提交 coverageSummary、findings 和 resolutions，不能自报 assurance、basisHash 或“已验证模型身份”。

blocking finding 必须自动修复并对受影响角色增量复审；仍未解决时才返回用户决策。warning/note 不阻塞。完整结果通过 `dev_flow_status.reviewStatus` 和只读 plan-review 投影查看，禁止编辑或登记投影。

宿主没有异构模型能力时如实显示隔离视角或独立采样，不把同一模型自审伪称多模型。审查完成后读取 `dev_flow_next` 的阶段能力；只有新的 approval obligation basis 才需要用户确认。
