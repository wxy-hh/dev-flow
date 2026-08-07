import assert from "node:assert/strict";
import test from "node:test";
import { loadSource } from "../helpers/load-source.mjs";

const artifacts = await loadSource("plugins/dev-flow/src/core/artifacts.ts");

function standardMState() {
  return {
    mode: "routed",
    route: "standard-m",
    workflowCapabilities: { trace: 1, review: 1, checkpoints: 1, rollbackExecution: 1 },
    steps: {
      requirements_alignment: { status: "satisfied" },
      planning: { status: "satisfied" },
      implementation: { status: "satisfied" },
      code_review: { status: "satisfied" },
      verification: { status: "satisfied" },
      finalize: { status: "satisfied" },
    },
    currentStage: "finalize",
    humanGates: {},
    obligations: [],
    featureCheck: { passed: true },
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
  assert.equal(state.currentStage, "planning");
  assert.equal(state.logicComplete, false);
});

test("non-review implementation-plan invalidation keeps the source step satisfied", () => {
  const state = {
    ...standardMState(),
    route: "light-m",
    workflowCapabilities: { trace: 0, review: 0, checkpoints: 0, rollbackExecution: 0 },
  };
  const result = artifacts.invalidateFromStep(state, "implementation-plan");

  assert.equal(result.planningReopened, false);
  assert.equal(state.steps.planning.status, "satisfied");
  assert.equal(state.steps.implementation, undefined);
  assert.equal(state.currentStage, "implementation");
});
