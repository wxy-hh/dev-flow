import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { loadSource } from "../helpers/load-source.mjs";

const stepOrder = await loadSource("plugins/dev-flow/src/core/step-order.ts");
const contract = await loadSource("plugins/dev-flow/src/policy/contract.ts");

test("stateful route consumers use the capability-aware route contract", async () => {
  const files = ["artifacts.ts", "state-store.ts", "next.ts", "status.ts", "step-order.ts", "feature-check.ts", "human-gates.ts"];
  for (const file of files) {
    const source = await readFile(path.join(process.cwd(), "plugins/dev-flow/src/core", file), "utf8");
    assert.match(source, /routeDefinitionForFeature/);
    assert.doesNotMatch(source, /routeDefinition\(state\.route\)/);
    if (file === "next.ts" || file === "step-order.ts") {
      assert.match(source, /generatedArtifactSteps/);
    }
  }
});

test("gate helpers include prior generated artifact steps from the effective contract", () => {
  const caps = { trace: 1, review: 0, checkpoints: 0, rollbackExecution: 0 };
  const standard = contract.routeDefinitionForFeature("standard-m", caps);
  assert.deepEqual(standard.generatedArtifactSteps?.implementation_approval, ["status"]);
  assert.ok(!standard.artifactSteps?.implementation_approval?.includes("status"));

  // status is bound to the risk_controls step, so it is required before implementation_approval.
  const riskState = {
    schemaVersion: 1,
    featureId: "risk",
    revision: 0,
    lifecycle: "active",
    route: "risk-minimal",
    classification: {
      level: "M",
      topology: "local",
      execution: "light",
      riskLabels: ["money"],
      acceptanceAssistSuggested: false,
    },
    scope: { inScope: [], outOfScope: [] },
    steps: {},
    humanGates: {},
    artifacts: {},
    verification: { attempts: [] },
    featureCheck: {},
    blockingFindings: [],
    logicComplete: false,
    lastUpdatedBy: { host: "codex", pluginVersion: "test" },
    workflowCapabilities: caps,
  };
  assert.ok(stepOrder.artifactsRequiredBeforeGate(riskState, "implementation_approval").includes("status"));
  assert.ok(stepOrder.artifactsRequiredBeforeGate(riskState, "implementation_approval").includes("risk-card"));
});
