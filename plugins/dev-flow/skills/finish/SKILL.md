---
name: finish
description: 完成验证与 finalize，生成交付快照。
---

只在 `dev_flow_next` 的 stage 为 finalize 且能力合同允许时调用 finalize。Finalize 会重新校验实际 diff、验证新鲜度、风险义务、审查结论和交付快照；失败时按 RecoveryAction 修复并继续，不假装完成。只有 logic-complete 后才允许 Git 写入。
