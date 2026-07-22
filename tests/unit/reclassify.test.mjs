import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { loadSource } from "../helpers/load-source.mjs";
const store = await loadSource("plugins/dev-flow/src/core/state-store.ts");
const config = { schemaVersion: 1, verification: { commands: [{ id: "unit", command: "node", args: ["--test"], cwd: "." }], behaviorCommands: [] }, enforcement: { mode: "strict", gitWriteRequiresLogicComplete: true, oneActiveFeature: true, requireExplicitHumanReply: true }, protectedRoots: ["src"] };
test("reclassification only becomes stricter and invalidates downstream evidence", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "dev-flow-reclassify-"));
  try { await store.initProject(root, config); const feature = await store.startFeature(root, { featureId: "m", level: "M", topology: "local", execution: "light", host: "claude" });
    const raised = await store.reclassifyFeature(root, "m", feature.revision, { level: "M", topology: "local", execution: "light", riskLabels: ["security"] }, "security impact found");
    assert.equal(raised.route, "risk-minimal"); assert.equal(raised.logicComplete, false);
    await assert.rejects(() => store.reclassifyFeature(root, "m", raised.revision, { level: "XS", topology: "local" }, "downgrade"), /RECLASSIFICATION_NOT_STRICTER/);
  } finally { await rm(root, { recursive: true, force: true }); }
});
