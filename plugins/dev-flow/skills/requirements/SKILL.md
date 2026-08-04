---
name: requirements
description: 在 intake 或需求对齐阶段调查事实、调用 grillme 澄清用户决策并维护需求证据。
---

使用 Dev Flow MCP；禁止手改 `.dev-flow` 控制文件。`grillme` 是跨路线独立能力：需求不清时先查仓库，再只问用户必须决定的边界、优先级和取舍，可连续提问直到决策树收敛。

XS、S、light M 不强制生成需求文档。若路线为 standard M/L，按 Core 返回的 artifact 动作创建并登记 `需求文档.md`；文件内容是证据投影，不是调用 grillme 的前置门槛。需求文档只使用 `not_required/pending/complete` 三态；登记 current 且为 pending 后，调用 `dev_flow_request_grill_decision` 会自动打开 ledger 项，再由 resolve 同一 CAS 同步关闭 interaction 与 ledger。所有问题、答案、证据引用写入 decision ledger。

每次完成调查或澄清后调用 `dev_flow_classify` 预览，确认 classificationBasis 完整且风险标签有对应事实，再调用 `dev_flow_lock_classification`。锁定前存在影响范围、拓扑、风险或验收的 open decision 时，Core 会拒绝并返回待解决 ID。

完成后调用 `dev_flow_next`。不要因为没有生成需求文档而停顿；也不要重复创建确认、需求资产或交互。只有能力合同出现 `attention: approval-required` 且确有新的 approval obligation basis 时才向用户确认。
