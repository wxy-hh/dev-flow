---
name: feature-check
description: 确定性完备性检查。触发：完备性检查、feature-check、能不能收尾、df-feature-check、dev-flow-feature-check。当 dev_flow_next 返回 feature-check 时使用。
---

仅使用 Dev Flow MCP。调用 `dev_flow_next`；仅当它返回 `feature-check` 时调用 `dev_flow_feature_check`。不得编造缺失证据。
