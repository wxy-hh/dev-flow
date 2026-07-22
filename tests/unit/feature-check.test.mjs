import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { loadSource } from "../helpers/load-source.mjs";

const store = await loadSource("plugins/dev-flow/src/core/state-store.ts");
const verification = await loadSource("plugins/dev-flow/src/core/verification.ts");
const checks = await loadSource("plugins/dev-flow/src/core/feature-check.ts");
const config = { schemaVersion: 1, verification: { commands: [{ id: "pass", command: "node", args: ["-e", "process.exit(0)"], cwd: "." }, { id: "fail", command: "node", args: ["-e", "process.exit(2)"], cwd: "." }], behaviorCommands: [] }, enforcement: { mode: "strict", gitWriteRequiresLogicComplete: true, oneActiveFeature: true, requireExplicitHumanReply: true }, protectedRoots: ["src"] };

test("verification retains failed attempts and invalidates a changed business fingerprint", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "dev-flow-verify-"));
  try {
    await mkdir(path.join(root, "src")); await writeFile(path.join(root, "src", "app.js"), "export const x = 1;\n"); await store.initProject(root, config);
    let state = await store.startFeature(root, { featureId: "f", host: "codex", level: "XS", topology: "local" });
    state = await checks.recordStep(root, "f", state.revision, "locate", {}); state = await checks.recordStep(root, "f", state.revision, "implementation", {});
    state = await verification.runVerification(root, "f", state.revision, "codex", ["fail"]);
    assert.equal(state.verification.attempts.length, 1); assert.equal(state.steps.verification.status, "pending");
    state = await verification.runVerification(root, "f", state.revision, "codex", ["pass"]);
    assert.equal(state.verification.attempts.length, 2); assert.equal(state.steps.verification.status, "satisfied");
    await writeFile(path.join(root, "src", "app.js"), "export const x = 2;\n");
    state = await verification.invalidateStaleVerification(root, "f", state.revision);
    assert.equal(state.steps.verification.status, "pending"); assert.equal(state.verification.attempts.length, 2);
  } finally { await rm(root, { recursive: true, force: true }); }
});
