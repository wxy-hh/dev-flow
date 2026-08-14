import test from "node:test";
import assert from "node:assert/strict";
import { loadSource } from "../helpers/load-source.mjs";

const stages = await loadSource("plugins/dev-flow/src/policy/stages.ts");

test("intake exposes investigation and lock actions without a route", () => {
  const view = stages.deriveStageCapabilities({ mode: "intake" });
  assert.equal(view.stage, "intake");
  assert.ok(view.allowedActions.includes("lock-classification"));
});

test("implementation capability allows equivalent writes and repair", () => {
  const view = stages.deriveStageCapabilities({
    route: "m",
    mode: "routed",
    steps: { requirements_alignment: { status: "satisfied" }, planning: { status: "satisfied" }, implementation: { status: "pending" } },
    obligations: [],
    classification: {
      controls: {
        requirements: true,
        plan: "formal",
        trace: true,
        planReview: true,
        reviewRoles: [],
        executionApproval: true,
        checkpoints: "unit-chain",
        recovery: [],
        codeReview: "independent",
        verification: ["targeted"],
        reasons: {},
      },
    },
  });
  assert.ok(view.allowedActions.includes("write"));
  assert.ok(view.allowedActions.includes("repair-current-unit"));
  assert.equal(view.requiredEvidence.fields.files, "governed-root-paths");
});

test("pending approval obligations do not imply an immediate approval attention", () => {
  const view = stages.deriveStageCapabilities({
    route: "m",
    mode: "routed",
    lifecycle: "active",
    steps: { requirements_alignment: { status: "pending" } },
    obligations: [{ id: "approval:1", kind: "approval", status: "pending", reason: "later" }],
  });

  assert.equal(view.attention, undefined);
});

test("stage capability derives verification and terminal stages from lifecycle evidence", () => {
  const verification = stages.deriveStageCapabilities({
    route: "m",
    mode: "routed",
    lifecycle: "active",
    steps: {
      requirements_alignment: { status: "satisfied" },
      planning: { status: "satisfied" },
      implementation: { status: "satisfied" },
      code_review: { status: "satisfied" },
      verification: { status: "pending" },
      finalize: { status: "pending" },
    },
    obligations: [],
  });
  assert.equal(verification.stage, "verification");

  const complete = stages.deriveStageCapabilities({
    route: "m",
    mode: "routed",
    lifecycle: "finalized",
    obligations: [],
  });
  assert.equal(complete.stage, "complete");
  assert.deepEqual(complete.allowedActions, ["read", "refresh-status"]);
  assert.deepEqual(complete.completionCriteria, ["feature-finalized"]);
  assert.equal(complete.attention, undefined);
});
