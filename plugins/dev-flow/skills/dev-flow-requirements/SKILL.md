---
name: dev-flow-requirements
description: Capture, pressure-test, and confirm requirements when Dev Flow requests them.
---

Use Dev Flow MCP as the only workflow authority. Read `dev_flow_status`, then call `dev_flow_next` and perform only its unique action.

For the standard M/L `requirements` step:

1. Scaffold `requirements.md` only when MCP requests it.
2. If `classification.requirements` is `missing-or-unclear` or `documented-unconfirmed`, delegate to `dev-flow-grillme`. On later turns, resume its existing Decision Log and first unresolved `Q-...`; do not restart the interview.
3. After every integrated grillme update, immediately call `dev_flow_record_artifact` for `requirements`. This is the only skill allowed to register the artifact, record the `requirements` step, or present/confirm `requirement_confirmation`.
4. Only after `dev_flow.grill_status` is `complete` and the current contents are registered may you call `dev_flow_record_step` for `requirements`. Then call `dev_flow_next`; when it requests `requirement_confirmation`, present that HUMAN GATE and stop until a later user reply.

For `provided-confirmed`, do not automatically invoke grillme; scaffold or snapshot the requirements and proceed with `grill_status: not_required`. An explicit grillme handoff may change it to `complete`, after which this skill must register the edited artifact and re-present the invalidated requirement gate.

Never bypass the MCP grill-status checks or create a second requirements artifact, requirement gate, or workflow state file.
