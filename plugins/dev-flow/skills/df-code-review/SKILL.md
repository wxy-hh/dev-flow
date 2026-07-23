---
name: df-code-review
description: 通过 Dev Flow MCP 做实现后的 diff 审查。用户说代码审查、code-review、检查这次改动、写完帮我 review、df-code-review、dev-flow-code-review 时使用。当 dev_flow_next 返回 code_review 时使用。
---

仅使用 Dev Flow MCP。先调用 `dev_flow_next`，仅当它返回 `code_review` 时行动；以 `reviewType: "code"` 登记代码证据。code-review 与 plan-review 相互独立，不能互相顶替完成。
