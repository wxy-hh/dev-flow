import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { loadSource } from "./load-source.mjs";
const store = await loadSource("plugins/dev-flow/src/core/state-store.ts");
const artifacts = await loadSource("plugins/dev-flow/src/core/artifacts.ts");
const checks = await loadSource("plugins/dev-flow/src/core/feature-check.ts");
const verification = await loadSource("plugins/dev-flow/src/core/verification.ts");
const gates = await loadSource("plugins/dev-flow/src/core/human-gates.ts");
const definitions = await loadSource("plugins/dev-flow/src/policy/contract.ts");
const routes = await loadSource("plugins/dev-flow/src/policy/route.ts");
const config = { schemaVersion: 1, verification: { commands: [{ id: "unit", command: "node", args: ["--test"], cwd: "." }], behaviorCommands: [] }, enforcement: { mode: "strict", gitWriteRequiresLogicComplete: true, oneActiveFeature: true, requireExplicitHumanReply: true }, protectedRoots: ["src"] };
export async function runRoute(input, expectedRoute) {
  const root = await mkdtemp(path.join(os.tmpdir(), "dev-flow-route-"));
  try {
    await store.initProject(root, config); let state = await store.startFeature(root, { ...input, featureId: "feature", host: "claude" });
    assert.equal(state.route, expectedRoute); const def = definitions.routeDefinition(expectedRoute);
    for (const step of def.orderedSteps) {
      if (["feature_check", "finalize"].includes(step)) continue;
      for (const kind of def.artifactSteps?.[step] ?? []) state = await artifacts.scaffoldArtifact(root, "feature", state.revision, kind);
      if (["requirement_confirmation", "implementation_approval"].includes(step)) { state = await gates.presentGate(root, "feature", state.revision, step); await store.recordHostEvent(root, { eventId: `${step}-prompt`, type: "user-prompt", host: "claude", text: `approve ${step}` }); state = await gates.confirmGate(root, "feature", state.revision, step, `approve ${step}`, { promptEventId: `${step}-prompt` }, "claude"); }
      else if (step === "verification") state = await verification.runVerification(root, "feature", state.revision, "claude");
      else {
        const risk = routes.deriveRiskRequirements(input.riskLabels ?? []);
        const evidence = { reviewType: step === "plan_review" ? "plan" : step === "code_review" ? "code" : undefined, reviewDepth: step === "code_review" && risk.checks.includes("full-code-review") ? "full" : undefined, checks: step === "risk_controls" ? risk.checks.filter((check) => check !== "full-code-review") : undefined };
        state = await checks.recordStep(root, "feature", state.revision, step, evidence);
      }
    }
    if (def.featureCheckRequired) state = await checks.featureCheck(root, "feature", state.revision);
    state = await checks.finalize(root, "feature", state.revision); assert.equal(state.logicComplete, true); assert.equal(state.lifecycle, "finalized"); return state;
  } finally { await rm(root, { recursive: true, force: true }); }
}
