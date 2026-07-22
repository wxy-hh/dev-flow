import assert from "node:assert/strict";
import test from "node:test";
import { loadSource } from "../helpers/load-source.mjs";

const { deriveNext } = await loadSource("plugins/dev-flow/src/policy/derive-next.ts");

function state(overrides = {}) {
  return {
    schemaVersion: 1,
    lifecycle: "active",
    route: "standard-m",
    steps: {},
    ...overrides,
  };
}

test("deriveNext returns exactly one route-ordered action", () => {
  assert.deepEqual(deriveNext(state()), { kind: "run-step", step: "requirements" });
  assert.deepEqual(
    deriveNext(state({ steps: { requirements: { status: "satisfied" } } })),
    { kind: "present-human-gate", step: "requirement_confirmation" },
  );
  assert.deepEqual(
    deriveNext(state({ steps: { requirements: { status: "satisfied" }, requirement_confirmation: { status: "pending", artifactReady: true } } })),
    { kind: "wait-human-gate", step: "requirement_confirmation" },
  );
});

test("deriveNext honors blockers, fresh feature check, and final lifecycle", () => {
  assert.deepEqual(deriveNext(state({ classificationViolatesTopology: true })), { kind: "stop", reason: "reclassification-required" });
  assert.deepEqual(deriveNext(state({ blockingFindings: [{ blocking: true }] })), { kind: "stop", reason: "resolve-blocking-findings" });
  assert.deepEqual(deriveNext(state({ lifecycle: "finalized" })), { kind: "done" });

  const completeSteps = Object.fromEntries([
    "requirements", "requirement_confirmation", "implementation_plan", "coverage_review", "rollback_unit", "plan_review", "implementation_approval", "implementation", "code_review", "verification", "feature_check", "finalize",
  ].map((step) => [step, { status: "satisfied" }]));
  assert.deepEqual(deriveNext(state({ steps: completeSteps })), { kind: "feature-check" });
  assert.deepEqual(deriveNext(state({ steps: completeSteps, featureCheckFresh: true })), { kind: "finalize" });
  assert.deepEqual(deriveNext(state({ steps: completeSteps, featureCheckFresh: true, logicComplete: true })), { kind: "done" });
});
