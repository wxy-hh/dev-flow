import test from "node:test";
import assert from "node:assert/strict";
import { loadSource } from "../helpers/load-source.mjs";

const policy = await loadSource("plugins/dev-flow/src/core/write-policy.ts");

test("normal implementation writes are allowed or audited by semantic stage", () => {
  assert.equal(policy.judgeWrite({ mode: "routed", stage: "implementation", controlPath: false, protectedPath: true, impactResolved: true }).decision, "allow");
  assert.equal(policy.judgeWrite({ mode: "routed", stage: "implementation", controlPath: false, protectedPath: true, impactResolved: false }).decision, "audit");
});

test("control and intake writes remain blocked with recovery actions", () => {
  assert.equal(policy.judgeWrite({ mode: "routed", stage: "implementation", controlPath: true, protectedPath: true, impactResolved: true }).decision, "block");
  assert.equal(policy.judgeWrite({ mode: "intake", controlPath: false, protectedPath: true, impactResolved: false }).decision, "block");
});

