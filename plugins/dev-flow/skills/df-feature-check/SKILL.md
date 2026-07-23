---
name: df-feature-check
description: 运行确定性的 Dev Flow 完备性检查。用户说完备性检查、feature-check、能不能收尾、df-feature-check、dev-flow-feature-check 时使用。当 dev_flow_next 返回 feature-check 时使用。
---

仅使用 Dev Flow MCP。调用 `dev_flow_next`；仅当它返回 `feature-check` 时调用 `dev_flow_feature_check`。不得编造缺失证据。
