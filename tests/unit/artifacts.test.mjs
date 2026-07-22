import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { loadSource } from "../helpers/load-source.mjs";

const store = await loadSource("plugins/dev-flow/src/core/state-store.ts");
const artifacts = await loadSource("plugins/dev-flow/src/core/artifacts.ts");
const contract = await loadSource("plugins/dev-flow/src/policy/contract.ts");
const config = { schemaVersion: 1, verification: { commands: [{ id: "unit", command: "node", args: ["-e", "process.exit(0)"], cwd: "." }], behaviorCommands: [] }, enforcement: { mode: "strict", gitWriteRequiresLogicComplete: true, oneActiveFeature: true, requireExplicitHumanReply: true }, protectedRoots: ["src"] };

test("route asset requirements are exact and edited assets require re-registration", async () => {
  assert.deepEqual(contract.routeDefinition("xs").requiredArtifacts, []);
  assert.deepEqual(contract.routeDefinition("s").requiredArtifacts, []);
  assert.deepEqual(contract.routeDefinition("risk-minimal").requiredArtifacts, ["status", "risk-card"]);
  assert.deepEqual(contract.routeDefinition("light-m").requiredArtifacts, []);
  const root = await mkdtemp(path.join(os.tmpdir(), "dev-flow-artifact-"));
  try {
    await store.initProject(root, config);
    let state = await store.startFeature(root, { featureId: "f", host: "claude", level: "M", topology: "local", execution: "standard", requirements: "missing-or-unclear" });
    await assert.rejects(() => artifacts.scaffoldArtifact(root, "f", state.revision, "code-review"), /ARTIFACT_NOT_REQUIRED/);
    state = await artifacts.scaffoldArtifact(root, "f", state.revision, "requirements");
    const file = path.join(root, ".dev-flow", "features", "f", "requirements.md"); await writeFile(file, "# changed requirements\n");
    await assert.rejects(() => artifacts.assertArtifactIntegrity(root, "f"), /ARTIFACT_INTEGRITY_FAILED/);
    state = await artifacts.recordArtifact(root, "f", state.revision, "requirements");
    assert.ok(state.artifacts.requirements.sha256);
  } finally { await rm(root, { recursive: true, force: true }); }
});
