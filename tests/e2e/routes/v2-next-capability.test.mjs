import assert from "node:assert/strict";
import test from "node:test";
import { loadSource } from "../../helpers/load-source.mjs";

const status = await loadSource("plugins/dev-flow/src/core/status.ts");

test("public next capability exposes a stage contract rather than a unique action", () => {
  const view = status.stageCapabilitiesForAction(
    { mode: "routed", route: "standard-m", currentStage: "implementation", lifecycle: "active", obligations: [] },
    { kind: "run-step", step: "implementation" },
  );
  assert.equal(view.stage, "implementation");
  assert.ok(view.allowedActions.includes("write"));
  assert.equal("kind" in view, false);
  assert.equal("step" in view, false);
});

test("public next capability carries blocking attention without exposing scheduler details", () => {
  const view = status.stageCapabilitiesForAction(
    { mode: "routed", route: "standard-m", currentStage: "implementation", lifecycle: "active", obligations: [] },
    { kind: "waiting-user", reason: "repair is ambiguous", recoveryAction: { kind: "ask-user", reason: "repair is ambiguous", facts: ["scope changed"], impact: "cannot continue safely", recommendation: "confirm scope" } },
  );
  assert.deepEqual(view.attention, { reason: "repair is ambiguous", required: true });
  assert.equal(view.recoveryAction?.kind, "ask-user");
  assert.equal("kind" in view, false);
});
