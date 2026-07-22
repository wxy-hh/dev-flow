---
name: dev-flow-grillme
description: 对需求、方案或实现计划做一问一答式拷问。用户说 grillme、grill me、grilling、拷问、压测方案、挑战计划或找隐含假设时使用。
---

# Dev Flow Grillme

Use Dev Flow MCP only for read-only `dev_flow_status` and `dev_flow_next` when an active feature exists. This skill is never allowed to call an MCP mutation, register an artifact, record a step, or present/confirm a HUMAN GATE.

## Integrated requirements mode

Use this mode only when the active feature is standard M/L and its current route step is `requirements`.

1. Read the relevant code, configuration, and `requirements.md` before asking. Resolve repository-verifiable facts yourself.
2. Change `dev_flow.grill_status` from `pending` to `in_progress` before the first unresolved question. Ask exactly one blocking question per turn; include the recommended answer, options, and impact.
3. Maintain only the `## Decision Log` and `## Open Questions` sections of `requirements.md`. Use stable `Q-001...` and `D-001...` IDs. Preserve prior decisions and resume the first unresolved question whenever status is `in_progress` or an open question exists.
4. Ask at most five blocking questions. You may extend to eight only for a new architectural branch, irreversible risk, or quota/cost decision.
5. When no blocking question remains, set `dev_flow.grill_status` to `complete`, set `## Open Questions` to `- None`, and hand off to `dev-flow-requirements`. Do not write scope, acceptance criteria, or any MCP state transition.

## Explicit consultation mode

If there is no compatible active requirements step, pressure-test the supplied requirement or plan in conversation only. Do not edit files, mutate Dev Flow state, or replace `dev-flow-plan-review`.

An explicit invocation on a `provided-confirmed` requirements step uses integrated mode. `dev-flow-requirements` must register every edit so the existing requirement confirmation hash is invalidated when needed.
