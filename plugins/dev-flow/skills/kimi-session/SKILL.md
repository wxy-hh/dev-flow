---
name: kimi-session
description: Kimi Code 会话引导：仅在 dev-flow MCP 工具可用时提示推进 active feature，不强制启动。
---

仅当当前会话可用的工具中包含 dev-flow 的 `dev_flow_*` MCP 工具时执行以下引导：

- 先调用 `dev_flow_status` 检查是否存在 active feature。
- 若无 active feature，调用 `dev_flow_start` 开始一个 feature（拿不准路线时先 `dev_flow_classify`）。
- 若用户只是普通提问，不主动推进 dev-flow。

当可用工具中不包含 `dev_flow_*` 时，忽略本引导，正常回答用户即可。禁止直接编辑 `.dev-flow`。
