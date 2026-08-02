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
