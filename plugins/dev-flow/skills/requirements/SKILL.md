---
name: requirements
description: 在 intake 或需求对齐阶段调查事实、调用 grillme 澄清用户决策并维护需求证据。
---

使用 Dev Flow MCP；禁止手改 `.dev-flow` 控制文件。`grillme` 是跨路线独立能力：需求不清时先查仓库，再只问用户必须决定的边界、优先级和取舍，每回合只呈现一个问题。

XS、S、light M 不强制生成需求文档。若路线为 standard M/L，按 Core 返回的 artifact 动作创建并登记 `需求文档.md`；需求文档不再保存 grill 控制字段。调用 `dev_flow_request_grill_decision` 后只通过 `dev_flow_answer` 逐题回答，所有问题、答案和证据引用写入 decision ledger。

每次完成调查或澄清后调用 `dev_flow_classify` 预览，确认 classificationBasis 完整且风险标签有对应事实，再调用 `dev_flow_lock_classification`。锁定前存在影响范围、拓扑、风险或验收的 open decision 时，Core 会拒绝并返回待解决 ID。

完成后读取 `dev_flow_status`。没有真实决策缺口时自动推进；不要重复创建确认、需求资产或交互。
