import assert from "node:assert/strict";
import test from "node:test";
import { loadSource } from "../helpers/load-source.mjs";

const brief = await loadSource("plugins/dev-flow/src/core/execution-brief.ts");

test("mutation summary derives stage from steps and keeps obligation counts separate", () => {
  const summary = brief.buildFeatureMutationSummary({
    schemaVersion: 5,
    mode: "routed",
    featureId: "f",
    revision: 7,
    lifecycle: "active",
    route: "m",
    classification: { level: "M", topology: "local", riskLabels: [], orderedRoute: ["requirements_alignment", "planning", "implementation", "code_review", "verification", "finalize"], acceptanceAssistSuggested: false },
    obligations: [
      { id: "a", kind: "approval", source: "route", basisHash: "a".repeat(64), status: "pending", reason: "a" },
      { id: "b", kind: "review", source: "route", basisHash: "b".repeat(64), status: "satisfied", reason: "b" },
      { id: "c", kind: "checkpoint", source: "route", basisHash: "c".repeat(64), status: "stale", reason: "c" },
    ],
    steps: { requirements_alignment: { status: "satisfied" }, planning: { status: "pending" } },
    humanGates: {},
    artifacts: {},
    verification: { attempts: [] },
    interactions: { one: { status: "pending" }, two: { status: "resolved" } },
    checkpoints: [{ checkpointId: "AUTO-1234567890", stage: "planning", capturedAt: "now", fingerprint: "d".repeat(64), files: [], basisHash: "e".repeat(64) }],
    implementationUnits: [
      { unitId: "RU-001", status: "checkpointed", basisHash: "f".repeat(64), startedFingerprint: "1".repeat(64), checkpointId: "CP-001" },
      { unitId: "RU-002", status: "active", basisHash: "f".repeat(64), startedFingerprint: "1".repeat(64) },
    ],
    blockingFindings: [{ blocking: true, message: "x" }, { blocking: false, message: "y" }],
    logicComplete: false,
    lastUpdatedBy: { host: "codex", pluginVersion: "test" },
  });

  assert.equal(summary.stage, "planning");
  assert.deepEqual(summary.obligations, { pending: 1, satisfied: 1, stale: 1 });
  assert.deepEqual(summary.counters, { checkpoints: 1, unitsDone: 1, unitsTotal: 2, openInteractions: 1, blockingFindings: 1 });
});
