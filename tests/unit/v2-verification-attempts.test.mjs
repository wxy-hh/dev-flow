import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { loadSource } from "../helpers/load-source.mjs";

const store = await loadSource("plugins/dev-flow/src/core/state-store.ts");
const checks = await loadSource("plugins/dev-flow/src/core/feature-check.ts");
const verification = await loadSource("plugins/dev-flow/src/core/verification.ts");

test("new verification attempts keep a tail in state and write full output externally", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "dev-flow-verification-attempt-"));
  try {
    await mkdir(path.join(root, "src"));
    const config = {
      schemaVersion: 1,
      verification: { commands: [{ id: "pass", command: process.execPath, args: ["-e", "process.stdout.write('full-output')"], cwd: "." }], behaviorCommands: [] },
      enforcement: { mode: "strict", gitWriteRequiresLogicComplete: true, oneActiveFeature: true, requireExplicitHumanReply: true },
      protectedRoots: ["src"],
    };
    await store.initProject(root, config);
    let state = await store.startFeature(root, { featureId: "f", host: "codex", level: "XS", topology: "local" });
    state = await checks.recordStep(root, "f", state.revision, "locate", {});
    state = await checks.recordStep(root, "f", state.revision, "implementation", { files: [] });
    state = await verification.runVerification(root, "f", state.revision, "codex", ["pass"]);
    const attempt = state.verification.attempts[0];
    assert.equal("output" in attempt, false);
    assert.equal(attempt.outputTail.includes("full-output"), true);
    assert.equal(attempt.outputPath, "verification/1.log");
    assert.equal(await readFile(path.join(root, ".dev-flow", "features", "f", attempt.outputPath), "utf8"), "[pass] full-output");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("verification records a failed preflight attempt without running forward commands", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "dev-flow-verification-preflight-"));
  try {
    await mkdir(path.join(root, "src"));
    const config = {
      schemaVersion: 1,
      verification: {
        commands: [
          { id: "preflight", command: process.execPath, args: ["-e", "process.exit(3)"], cwd: "." },
          { id: "forward", command: process.execPath, args: ["-e", "process.stdout.write('forward')"], cwd: "." },
        ],
        behaviorCommands: [],
        preflightCommands: ["preflight"],
      },
      enforcement: { mode: "strict", gitWriteRequiresLogicComplete: true, oneActiveFeature: true, requireExplicitHumanReply: true },
      protectedRoots: ["src"],
    };
    await store.initProject(root, config);
    let state = await store.startFeature(root, { featureId: "f", host: "codex", level: "XS", topology: "local" });
    state = await checks.recordStep(root, "f", state.revision, "locate", {});
    state = await checks.recordStep(root, "f", state.revision, "implementation", { files: [] });
    state = await verification.runVerification(root, "f", state.revision, "codex", ["forward"]);
    assert.equal(state.verification.attempts.at(-1).phase, "preflight");
    assert.equal(state.verification.attempts.at(-1).exitCode, 3);
    assert.equal(state.steps.verification.status, "pending");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
