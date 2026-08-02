import test from "node:test";
import assert from "node:assert/strict";
import { loadSource } from "../helpers/load-source.mjs";

const stages = await loadSource("plugins/dev-flow/src/policy/stages.ts");

test("intake exposes investigation and lock actions without a route", () => {
  const view = stages.deriveStageCapabilities({ mode: "intake" });
  assert.equal(view.stage, "intake");
  assert.ok(view.allowedActions.includes("lock-classification"));
});

test("implementation capability allows equivalent writes and repair", () => {
  const view = stages.deriveStageCapabilities({ route: "standard-m", mode: "routed", currentStage: "implementation", obligations: [] });
  assert.ok(view.allowedActions.includes("write"));
  assert.ok(view.allowedActions.includes("repair-current-unit"));
});

