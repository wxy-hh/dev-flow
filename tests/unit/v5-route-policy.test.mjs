import test from "node:test";
import assert from "node:assert/strict";
import { loadSource } from "../helpers/load-source.mjs";

const route = await loadSource("plugins/dev-flow/src/policy/route.ts");

const signals = (overrides = {}) => ({
  changeSurface: "single-site",
  behaviorChange: "mechanical",
  topology: "local",
  unitCount: 1,
  requirements: "provided-confirmed",
  operationalRecovery: false,
  executableRollback: false,
  ...overrides,
});

const basis = (signalOverrides = {}, riskFactRefs = {}) => ({
  scopeFactRefs: ["FACT-1111111111111111"], topologyFactRefs: ["FACT-2222222222222222"], uncertaintyFactRefs: [], riskFactRefs, decisionRefs: [], signals: signals(signalOverrides),
});

test("v5 classification rejects caller-authored fact prose", () => {
  const preview = route.recommendClassification({
    scopeFacts: ["README.md:1"],
    topologyFacts: ["I checked call sites"],
    uncertaintyFacts: [],
    riskFacts: {},
    decisionRefs: [],
    signals: signals(),
  });
  assert.equal(preview.readyToLock, false);
  assert.equal(preview.issues[0].code, "CLASSIFICATION_BASIS_INVALID");
});

test("Core takes max of surface, behavior, topology and permits upward only", () => {
  assert.equal(route.recommendClassification(basis()).classification.level, "XS");
  assert.equal(route.recommendClassification(basis({ behaviorChange: "bounded-rule" })).classification.level, "S");
  assert.equal(route.recommendClassification(basis({ topology: "shared-contract" })).classification.level, "M");
  assert.equal(route.recommendClassification(basis({ topology: "multi-chain", unitCount: 2 })).classification.level, "L");
  assert.equal(route.recommendClassification(basis({ upwardLevel: "M" })).classification.level, "M");
});

test("dynamic controls are independent from level", () => {
  const plain = route.recommendClassification(basis({ changeSurface: "multi-component", behaviorChange: "bounded-rule" }));
  const governed = route.recommendClassification(basis({ changeSurface: "multi-component", behaviorChange: "bounded-rule", topology: "shared-contract", unitCount: 2, operationalRecovery: true }));
  assert.equal(plain.classification.level, "M");
  assert.equal(governed.classification.level, "M");
  assert.equal(plain.classification.controls.planReview, false);
  assert.equal(governed.classification.controls.planReview, true);
  assert.equal(governed.classification.controls.checkpoints, "unit-chain");
});

test("users can strengthen individual controls without inventing a risk or raising the level", () => {
  const preview = route.recommendClassification({
    ...basis(),
    controlEnhancements: {
      executionApproval: true,
      checkpoints: "unit-chain",
      codeReview: "full",
      verification: ["integration"],
    },
  });
  assert.equal(preview.classification.level, "XS");
  assert.equal(preview.classification.controls.executionApproval, true);
  assert.equal(preview.classification.controls.checkpoints, "unit-chain");
  assert.equal(preview.classification.controls.trace, true);
  assert.equal(preview.classification.controls.plan, "formal");
  assert.equal(preview.classification.controls.codeReview, "full");
  assert.deepEqual(preview.classification.controls.verification, ["targeted", "integration"]);
});

test("S plus executable rollback cannot lock unit-chain without Trace", () => {
  const preview = route.recommendClassification(basis({
    changeSurface: "single-component",
    behaviorChange: "bounded-rule",
    executableRollback: true,
  }));
  assert.equal(preview.classification.level, "S");
  assert.equal(preview.classification.controls.checkpoints, "unit-chain");
  assert.equal(preview.classification.controls.trace, true);
  assert.ok(preview.classification.controls.recovery.includes("executable-rollback"));
});

test("executable rollback enhancement still requires reversible facts", () => {
  assert.throws(() => route.recommendClassification({
    ...basis(),
    controlEnhancements: { recovery: ["executable-rollback"] },
  }), /CONTROL_ENHANCEMENT_UNSUPPORTED/);
});

test("boundary audit is a structured hard gate", () => {
  assert.throws(() => route.assertBoundaryAuditComplete({ scanned: [], items: [] }, []), /BOUNDARY_AUDIT_INCOMPLETE/);
  assert.throws(() => route.assertBoundaryAuditComplete({ scanned: ["assumption", "free-space", "tbd", "fallback", "scope", "acceptance"], items: [{ id: "a", kind: "tbd", disposition: "repository-fact", summary: "missing evidence" }] }, []), /BOUNDARY_AUDIT_UNRESOLVED/);
  assert.doesNotThrow(() => route.assertBoundaryAuditComplete({ scanned: ["assumption", "free-space", "tbd", "fallback", "scope", "acceptance"], items: [] }, []));
});
