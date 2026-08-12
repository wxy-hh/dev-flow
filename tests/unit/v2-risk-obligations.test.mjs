import test from "node:test";
import assert from "node:assert/strict";
import { loadSource } from "../helpers/load-source.mjs";

const policy = await loadSource("plugins/dev-flow/src/policy/obligations.ts");
const evidence = await loadSource("plugins/dev-flow/src/policy/evidence.ts");
const basis = {
  scopeFactRefs: ["FACT-scope"], topologyFactRefs: ["FACT-topology"], uncertaintyFactRefs: [], decisionRefs: [],
  riskFactRefs: { security: ["FACT-security"], external: ["FACT-external"] },
};

test("obligations are additive, deduplicated, and basis-addressed", () => {
  const obligations = policy.deriveObligations("m", basis);
  assert.ok(obligations.some((item) => item.kind === "review"));
  assert.ok(obligations.some((item) => item.kind === "approval"));
  assert.equal(new Set(obligations.map((item) => item.id)).size, obligations.length);
  assert.ok(obligations.every((item) => /^[a-f0-9]{64}$/.test(item.basisHash)));
});

test("decision basis hashes are stable regardless of object key order", () => {
  assert.equal(policy.decisionBasisHash({ b: 2, a: 1 }), policy.decisionBasisHash({ a: 1, b: 2 }));
});

test("risk overlays expose stable evidence checks at the existing route stage", () => {
  const xs = evidence.requiredEvidenceForStep("xs", ["security"], "verification");
  assert.deepEqual(xs.checks, ["risk-review", "security-boundary"]);
  const lightL = evidence.requiredEvidenceForStep("l", ["irreversible_consequence"], "planning");
  assert.deepEqual(lightL.checks, ["backup-preview-abort-compensation", "rollback-strategy"]);
  const lightLReview = evidence.requiredEvidenceForStep("l", ["irreversible_consequence"], "code_review");
  assert.deepEqual(lightLReview.checks, ["risk-review"]);
});
