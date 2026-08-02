---
name: rollback-safety
description: 作为 planning、checkpoint 和 repair 的内部回滚保障能力。
---

回滚策略由 Core 根据 classificationBasis、obligations、实际 diff 和自动 checkpoint 生成。不要创建额外路线步骤、单独 Markdown 或逐单元用户确认。需要显式恢复时才调用低层 rollback MCP；事务、冲突和验证失败都必须保留现场并返回可续办动作。
