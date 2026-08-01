---
name: doctor
description: 诊断插件、MCP、hook 与项目配置。触发：诊断、配置坏了、MCP 不通、doctor、df-doctor、dev-flow-doctor、dev_flow_doctor。
---

仅使用 Dev Flow MCP：`dev_flow_doctor`、`dev_flow_status` 与 `dev_flow_next`。不改工作流状态，也不直接编辑状态文件。

向用户复述诊断结论与恢复步骤时使用中文自然话术，不向用户展示 `transactionId`、`phase` 枚举、`CP-`/`RU-` id 或 sha 摘要；`dev_flow_doctor` 返回的诊断细节与恢复输入由你内部消化后执行。
