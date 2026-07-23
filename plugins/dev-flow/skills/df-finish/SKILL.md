---
name: df-finish
description: 在任何 Git 写入前完成 Dev Flow feature 收尾。用户说收尾、finish、finalize、完成分支、df-finish、dev-flow-finish 时使用。当 dev_flow_next 返回 finalize 时使用。
---

仅使用 Dev Flow MCP。调用 `dev_flow_next`；仅当它返回 `finalize` 时使用 `dev_flow_finalize`。只有 logic-complete 之后才可考虑 Git 写入操作。
