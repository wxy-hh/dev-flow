import assert from "node:assert/strict";
import test from "node:test";
import { loadSource } from "../helpers/load-source.mjs";

const contract = await loadSource("plugins/dev-flow/src/policy/contract.ts");

test("capability-aware contract derives modes without mutating the base contract", () => {
  const base = contract.routeDefinition("standard-m");
  const legacy = contract.routeDefinitionForFeature("standard-m", undefined);
  assert.ok(base.requiredArtifacts.includes("status"));
  assert.deepEqual(legacy.generatedArtifacts, ["status"]);
  assert.ok(!legacy.requiredArtifacts.includes("status"));
  assert.ok(legacy.requiredArtifacts.includes("implementation-plan"));
  assert.equal(
    legacy.requiredArtifacts.some((kind) => legacy.generatedArtifacts.includes(kind)),
    false,
  );
});

test("Trace stage preserves legacy plan-review modes and predeclares Review 2a transition", () => {
  const traceOnly = { trace: 1, review: 0, checkpoints: 0, rollbackExecution: 0 };
  const review = { ...traceOnly, review: 1 };
  assert.ok(!contract.routeDefinitionForFeature("standard-m", traceOnly)
    .requiredArtifacts.includes("plan-review"));
  assert.ok(contract.routeDefinitionForFeature("standard-l", traceOnly)
    .requiredArtifacts.includes("plan-review"));
  assert.ok(contract.routeDefinitionForFeature("standard-m", review)
    .generatedArtifacts.includes("plan-review"));
  assert.ok(contract.routeDefinitionForFeature("standard-l", review)
    .generatedArtifacts.includes("plan-review"));
});

test("trace enforcement is route and capability dependent", () => {
  const trace = { trace: 1, review: 0, checkpoints: 0, rollbackExecution: 0 };
  assert.equal(contract.traceEnforcementRequired("standard-m", trace), true);
  assert.equal(contract.traceEnforcementRequired("standard-l", trace), true);
  assert.equal(contract.traceEnforcementRequired("light-m", trace), false);
  assert.equal(contract.traceEnforcementRequired("standard-m", undefined), false);
});

test("normalizes capabilities into a frozen independent snapshot", () => {
  const input = { trace: 1, review: 0, checkpoints: 0, rollbackExecution: 0 };
  const normalized = contract.normalizeWorkflowCapabilities(input);
  assert.notEqual(normalized, input);
  assert.equal(Object.isFrozen(normalized), true);
  input.trace = 0;
  assert.equal(normalized.trace, 1);
});
