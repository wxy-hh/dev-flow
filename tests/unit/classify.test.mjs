import assert from "node:assert/strict";
import test from "node:test";
import { loadSource } from "../helpers/load-source.mjs";

const { selectRoute, deriveRiskRequirements } = await loadSource("plugins/dev-flow/src/policy/route.ts");

test("classifies each required route", () => {
  assert.equal(selectRoute({ level: "XS", topology: "local" }).route, "xs");
  assert.equal(selectRoute({ level: "S", topology: "local" }).route, "s");
  assert.equal(selectRoute({ level: "XS", topology: "local", riskLabels: ["security"] }).route, "risk-minimal");
  assert.equal(selectRoute({ level: "M", topology: "shared-contract", execution: "light", riskLabels: ["external"] }).route, "risk-minimal");
  assert.equal(selectRoute({ level: "M", topology: "local", execution: "light" }).route, "light-m");
  assert.equal(selectRoute({ level: "M", topology: "local", execution: "standard", requirements: "missing-or-unclear" }).route, "standard-m");
  assert.equal(selectRoute({ level: "L", topology: "multi-chain", execution: "light" }).route, "light-l");
  assert.equal(selectRoute({ level: "L", topology: "coordinated-rollback", execution: "standard", requirements: "provided-confirmed" }).route, "standard-l");
});

test("rejects invalid topology and execution combinations", () => {
  assert.throws(
    () => selectRoute({ level: "S", topology: "multi-chain" }),
    (error) => error.code === "TOPOLOGY_LEVEL_MISMATCH" && error.details.suggestedLevel === "L",
  );
  assert.throws(() => selectRoute({ level: "XS", topology: "local", execution: "light" }), /EXECUTION_NOT_ALLOWED/);
  assert.throws(() => selectRoute({ level: "M", topology: "local" }), /EXECUTION_REQUIRED/);
  assert.throws(() => selectRoute({ level: "L", topology: "local", execution: "standard" }), /REQUIREMENTS_REQUIRED/);
});

test("risk enhancements are contract-derived, unioned, and never add plan-review", () => {
  const requirements = deriveRiskRequirements(["security", "data", "critical_correctness"]);
  assert.deepEqual(requirements.checks, ["full-code-review", "rollback", "security"]);
  assert.deepEqual(requirements.verification, ["behavior", "full"]);
  assert.equal(requirements.checks.includes("plan-review"), false);
});
