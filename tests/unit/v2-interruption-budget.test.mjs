import test from "node:test";
import assert from "node:assert/strict";
import { loadSource } from "../helpers/load-source.mjs";

const policy = await loadSource("plugins/dev-flow/src/policy/obligations.ts");

test("the same decision basis is represented by one deterministic hash", () => {
  assert.equal(policy.decisionBasisHash({ route: "standard-m", plan: "p" }), policy.decisionBasisHash({ plan: "p", route: "standard-m" }));
});
