---
name: finish
description: Git 写入前完成 feature 收尾。触发：收尾、finish、finalize、完成分支、df-finish、dev-flow-finish。当 dev_flow_next 返回 finalize 时使用。
---

仅使用 Dev Flow MCP。调用 `dev_flow_status` / `dev_flow_next`；仅当返回 `finalize` 时使用 `dev_flow_finalize`。

若 progress 显示 verification stale、requiredEvidence 未满足，或任务材料明确要求的人工/UI 验收没有 manualAcceptance / 已登记 verification narrative，停止并回到 verify；不得假装浏览器验收已完成。Core 不新增 UI gate。只有 logic-complete 后才可考虑 Git 写入。
