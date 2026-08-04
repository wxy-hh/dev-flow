import test from "node:test";
import assert from "node:assert/strict";
import { loadSource } from "../helpers/load-source.mjs";

const route = await loadSource("plugins/dev-flow/src/policy/route.ts");

const facts = (overrides = {}) => ({
  level: "M",
  topology: "local",
  execution: "standard",
  requirements: "provided-confirmed",
  scopeFacts: ["仅影响一个模块"],
  topologyFacts: ["调用链不跨共享契约"],
  uncertaintyFacts: [],
  riskFacts: {},
  decisionRefs: [],
  ...overrides,
});

test("v2 facts select one of six base routes and risk never creates a route", () => {
  assert.equal(route.selectBaseRoute(facts({ level: "XS", execution: undefined })).route, "xs");
  assert.equal(route.selectBaseRoute(facts({ level: "S", execution: undefined })).route, "s");
  assert.equal(route.selectBaseRoute(facts({ execution: "light" })).route, "light-m");
  assert.equal(route.selectBaseRoute(facts({ execution: "standard" })).route, "standard-m");
  assert.equal(route.selectBaseRoute(facts({ level: "L", topology: "multi-chain", execution: "light" })).route, "light-l");
  assert.equal(route.selectBaseRoute(facts({ level: "L", topology: "multi-chain", execution: "standard" })).route, "standard-l");
  const withRisk = route.selectBaseRoute(facts({ riskLabels: ["security"], riskFacts: { security: ["认证边界会改变"] } }));
  assert.equal(withRisk.route, "standard-m");
  assert.ok(withRisk.obligations.some((item) => item.kind === "approval"));
});

test("a risk label without factual evidence is rejected", () => {
  assert.throws(() => route.selectBaseRoute(facts({ riskLabels: ["security"] })), /RISK_BASIS_REQUIRED/);
});

test("topology minimum and execution contradictions are explicit", () => {
  assert.throws(() => route.selectBaseRoute(facts({ level: "S", topology: "shared-contract", execution: undefined })), /TOPOLOGY_LEVEL_MISMATCH/);
  assert.ok(route.selectBaseRoute(facts({ level: "M", execution: undefined })).contradictions.length > 0);
});

test("classification basis validation identifies the exact path and actual type", () => {
  assert.throws(() => route.selectBaseRoute(facts({ riskFacts: { security: "not-an-array" } })), (error) => {
    assert.equal(error.code, "CLASSIFICATION_BASIS_INVALID");
    assert.equal(error.details.path, "$.classificationBasis.riskFacts.security");
    assert.equal(error.details.actualType, "string");
    return true;
  });
});

function signals(overrides = {}) {
  return {
    impactScope: "single-location",
    sharedContract: false,
    independentChains: 1,
    coordinatedRollback: false,
    requirements: "provided-confirmed",
    formalControls: [],
    ...overrides,
  };
}

function recommended(overrides = {}) {
  return {
    scopeFacts: ["repository inspection"],
    topologyFacts: ["call graph inspection"],
    uncertaintyFacts: [],
    riskFacts: {},
    decisionRefs: [],
    signals: signals(),
    ...overrides,
  };
}

test("structured signals recommend size and topology without letting risk inflate level", () => {
  assert.equal(route.recommendClassification(recommended()).classification.level, "XS");
  assert.equal(route.recommendClassification(recommended({ signals: signals({ impactScope: "single-module" }) })).classification.level, "S");
  assert.equal(route.recommendClassification(recommended({ signals: signals({ impactScope: "cross-module" }) })).classification.level, "M");
  assert.equal(route.recommendClassification(recommended({ signals: signals({ impactScope: "single-module", sharedContract: true }) })).classification.level, "M");
  assert.equal(route.recommendClassification(recommended({ signals: signals({ impactScope: "cross-module", independentChains: 2 }) })).classification.level, "L");
  assert.equal(route.recommendClassification(recommended({ signals: signals({ impactScope: "cross-module", coordinatedRollback: true }) })).classification.level, "L");
  const risky = route.recommendClassification(recommended({ riskFacts: { security: ["auth boundary"] }, signals: signals({ impactScope: "cross-module" }) }));
  assert.equal(risky.classification.level, "M");
  assert.deepEqual(risky.classification.riskLabels, ["security"]);
});

test("structured controls determine M/L execution and contradictions are structured issues", () => {
  const light = route.recommendClassification(recommended({ signals: signals({ impactScope: "cross-module" }) }));
  assert.equal(light.classification.execution, "light");
  const standard = route.recommendClassification(recommended({ signals: signals({ impactScope: "cross-module", formalControls: ["trace"] }) }));
  assert.equal(standard.classification.execution, "standard");
  const contradiction = route.recommendClassification(recommended({ signals: signals({ sharedContract: true }) }));
  assert.equal(contradiction.readyToLock, false);
  assert.equal(contradiction.issues[0].code, "CLASSIFICATION_SIGNALS_CONTRADICTORY");
});
