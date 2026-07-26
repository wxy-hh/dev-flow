import assert from "node:assert/strict";
import test from "node:test";
import { loadSource } from "../helpers/load-source.mjs";

const approval = await loadSource("plugins/dev-flow/src/core/gate-approval.ts");

test("gate approvals accept only normalized whole-phrase matches", () => {
  assert.equal(approval.isExplicitGateApproval("requirement_confirmation", "确认需求"), true);
  assert.equal(approval.isExplicitGateApproval("requirement_confirmation", "  lgtm  "), true);
  assert.equal(approval.isExplicitGateApproval("implementation_approval", "APPROVED"), true);
  assert.equal(approval.isExplicitGateApproval("requirement_confirmation", "确认需求，可以"), false);
  assert.equal(approval.isExplicitGateApproval("implementation_approval", "LGTM, please proceed"), false);
});

test("gate reply hints preserve the canonical LGTM display form", () => {
  assert.match(approval.gateReplyHint("requirement_confirmation"), /LGTM/);
  assert.doesNotMatch(approval.gateReplyHint("requirement_confirmation"), /lgtm/);
});
