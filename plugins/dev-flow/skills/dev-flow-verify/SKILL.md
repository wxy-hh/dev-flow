---
name: dev-flow-verify
description: Run only project-configured Dev Flow verification.
---

Use only Dev Flow MCP. Call `dev_flow_next`; only when it returns `verification` use `dev_flow_verify`. Never execute an unregistered verification command; record attempts through MCP.
