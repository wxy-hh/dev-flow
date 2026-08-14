import assert from "node:assert/strict";
import test from "node:test";
import { loadSource } from "../helpers/load-source.mjs";

const artifacts = await loadSource("plugins/dev-flow/src/core/artifacts.ts");
const stepOrder = await loadSource("plugins/dev-flow/src/core/step-order.ts");

function standardMState() {
  return {
    mode: "routed",
    route: "m",
    classification: { controls: { requirements: true, plan: "formal", trace: true, planReview: true, reviewRoles: [], executionApproval: true, checkpoints: "unit-chain", recovery: ["delivery-reverse", "operational-strategy", "executable-rollback"], codeReview: "independent", verification: ["targeted"] } },
    workflowCapabilities: { trace: 1, review: 1, checkpoints: 1, rollbackExecution: 1 },
    steps: {
      requirements_alignment: { status: "satisfied" },
      planning: { status: "satisfied" },
      implementation: { status: "satisfied" },
      code_review: { status: "satisfied" },
      verification: { status: "satisfied" },
      finalize: { status: "satisfied" },
    },
    humanGates: {},
    obligations: [],
    logicComplete: true,
    implementationUnits: [{ unitId: "RU-001", status: "pending" }],
  };
}

test("review-enforced implementation-plan invalidation reopens planning and downstream steps", () => {
  const state = standardMState();
  const result = artifacts.invalidateFromStep(state, "implementation-plan");

  assert.equal(result.planningReopened, true);
  assert.equal(state.steps.planning, undefined);
  assert.equal(state.steps.implementation, undefined);
  assert.equal(state.steps.finalize, undefined);
  assert.equal(stepOrder.currentOpenStep(state), "planning");
  assert.equal(state.logicComplete, false);
});

test("non-review implementation-plan invalidation keeps the source step satisfied", () => {
  const state = {
    ...standardMState(),
    route: "m",
    classification: { controls: { requirements: true, plan: "formal", trace: false, planReview: false, reviewRoles: [], executionApproval: false, checkpoints: "baseline", recovery: ["delivery-reverse"], codeReview: "independent", verification: ["targeted"] } },
    workflowCapabilities: { trace: 0, review: 0, checkpoints: 0, rollbackExecution: 0 },
  };
  const result = artifacts.invalidateFromStep(state, "implementation-plan");

  assert.equal(result.planningReopened, false);
  assert.equal(state.steps.planning.status, "satisfied");
  assert.equal(state.steps.implementation, undefined);
  assert.equal(stepOrder.currentOpenStep(state), "implementation");
});
