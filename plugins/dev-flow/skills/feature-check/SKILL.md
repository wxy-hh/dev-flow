---
name: feature-check
description: 在 finalize 前执行 Core 自动完备性检查。
---

2.0 中 feature-check 已并入 finalize 的 Core 完整性校验，不是用户可见路线步骤。通常只需读取 `dev_flow_next` 的 finalize 能力并调用对应 MCP；不要编造 evidence、手动关闭义务或为常规检查发通知。验证 stale、偏航或未解决 blocking finding 时按恢复动作处理。
