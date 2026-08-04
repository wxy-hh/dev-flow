---
name: status
description: 查看并接力 Dev Flow 2.0 状态、阶段能力与恢复动作。
---

调用 `dev_flow_status`，优先按 `stageCapabilities` 的阶段、能力、完成条件和恢复动作继续；`progress` 只用于查看验证证据和等待详情。禁止直接编辑 `.dev-flow`。intake 显示调查、决策和分类锁定结果（含 level、route）；routed 显示当前阶段、待完成义务、Execution Brief 和实际恢复动作。

`wait` 只在真实用户决策时出现：用自然语言复述事实、影响和推荐方案，不展示内部 ID、哈希或 token。技术错误应显示 retry、refresh-status、use-equivalent-operation、repair-current-unit、revise-plan 或 reclassify，而不是泛化成“流程停止”。

review、checkpoint、repair 等内部动作不会产生第二条路线或重复确认；相同 basis 的用户决策只呈现一次，出现新事实才重新询问。
