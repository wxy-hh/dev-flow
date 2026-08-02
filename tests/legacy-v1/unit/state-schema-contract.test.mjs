import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { loadSource } from "../helpers/load-source.mjs";

const store = await loadSource("plugins/dev-flow/src/core/state-store.ts");

test("state schema and runtime validation document Trace capability and pointer fields", async () => {
  const schema = JSON.parse(await readFile(path.join(process.cwd(), "plugins/dev-flow/policy/state.schema.json"), "utf8"));
  assert.equal(schema.properties.workflowCapabilities.additionalProperties, false);
  assert.deepEqual(schema.properties.workflowCapabilities.required, ["trace", "review", "checkpoints", "rollbackExecution"]);
  assert.equal(schema.properties.traceability.properties.sha256.pattern, "^[a-f0-9]{64}$");
  const state = {
    schemaVersion: 1, featureId: "f", revision: 0, lifecycle: "active", route: "standard-m", classification: { level: "M", topology: "local", execution: "standard", riskLabels: [], acceptanceAssistSuggested: false },
    scope: { inScope: [], outOfScope: [] }, steps: {}, humanGates: {}, artifacts: {}, verification: { attempts: [] }, featureCheck: {}, blockingFindings: [], logicComplete: false,
    lastUpdatedBy: { host: "codex", pluginVersion: "test" }, workflowCapabilities: { trace: 1, review: 0, checkpoints: 0, rollbackExecution: 0 },
  };
  assert.throws(() => store.validateFeatureState(state), /INVALID_STATE_SCHEMA/);
  state.traceability = { path: `traceability/snapshots/${"a".repeat(64)}.json`, sha256: "a".repeat(64), revision: 0, summary: { total: 0, current: 0, stale: 0, tombstoned: 0 } };
  assert.doesNotThrow(() => store.validateFeatureState(state));
});
