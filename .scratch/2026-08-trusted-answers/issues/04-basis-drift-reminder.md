# 04 — 依据偏移提醒

**What to build:** 已落账的决定在其依据变化时，呈现"依据已变化"并请求对变化本身的一致性确认，而非让用户重答原决定。

**Blocked by:** 03。

**Status:** implemented; ready-for-review

- [x] 路线确认的 stale 校验语义保留并明确为"依据偏移提醒"（ROUTE_CONFIRMATION_STALE，回归测试覆盖）。
- [x] 执行批准依据偏移时确认被拒并提示重新呈现（APPROVAL_BASIS_CHANGED，已有实现；无关变化复用由 audit journey 2 覆盖）。
- [x] 偏移拒绝不推进状态、问题保持待回答等待重新呈现。
