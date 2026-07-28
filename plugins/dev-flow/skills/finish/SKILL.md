---
name: finish
description: Git 写入前完成 feature 收尾。触发：收尾、finish、finalize、完成分支、df-finish、dev-flow-finish。当 dev_flow_next 返回 finalize 时使用。
---

仅使用 Dev Flow MCP。调用 `dev_flow_status` / `dev_flow_next`；仅当返回 `finalize` 时使用 `dev_flow_finalize`。

若 progress 显示 verification stale、机器验证失败、requiredEvidence 未满足或 feature-check 未通过，停止并回到相应步骤；不得假装浏览器验收已完成。浏览器/用户签收是可选审计信息，缺失、拒绝或未回复都不阻塞 finalize。finalize 会校验 implementation 登记的文件清单并生成交付快照；只有 logic-complete 后才可考虑 Git 写入。
