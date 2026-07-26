import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { loadSource } from "../helpers/load-source.mjs";

const store = await loadSource("plugins/dev-flow/src/core/state-store.ts");
const verification = await loadSource("plugins/dev-flow/src/core/verification.ts");
const checks = await loadSource("plugins/dev-flow/src/core/feature-check.ts");
const config = {
  schemaVersion: 1,
  verification: {
    commands: [
      { id: "pass", command: "node", args: ["-e", "process.exit(0)"], cwd: "." },
      { id: "fail", command: "node", args: ["-e", "process.exit(2)"], cwd: "." },
    ],
    behaviorCommands: [],
  },
  enforcement: { mode: "strict", gitWriteRequiresLogicComplete: true, oneActiveFeature: true, requireExplicitHumanReply: true },
  protectedRoots: ["src"],
};

test("Windows verification invokes cmd.exe for package-manager command wrappers", () => {
  assert.deepEqual(
    verification.verificationInvocation(
      { command: "npm", args: ["test", "--", "a test with spaces"] },
      "win32",
      "C:\\Windows\\System32\\cmd.exe",
    ),
    {
      executable: "C:\\Windows\\System32\\cmd.exe",
      args: ["/d", "/s", "/c", "npm test -- \"a test with spaces\""],
    },
  );
  assert.deepEqual(
    verification.verificationInvocation({ command: "node", args: ["--test"] }, "darwin"),
    { executable: "node", args: ["--test"] },
  );
});

async function startXs(root) {
  await mkdir(path.join(root, "src"));
  await writeFile(path.join(root, "src", "app.js"), "export const x = 1;\n");
  await store.initProject(root, config);
  let state = await store.startFeature(root, { featureId: "f", host: "codex", level: "XS", topology: "local" });
  state = await checks.recordStep(root, "f", state.revision, "locate", {});
  return checks.recordStep(root, "f", state.revision, "implementation", {});
}

test("verification retains failed attempts and never inherits manual acceptance", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "dev-flow-verify-"));
  try {
    let state = await startXs(root);
    assert.equal((await verification.readVerificationFreshness(root, state)).status, "missing");
    state = await verification.runVerification(root, "f", state.revision, "codex", ["fail"], {
      mode: "browser",
      source: "local browser",
      scenarios: [{ name: "submit", evidence: "form rendered" }],
    });
    assert.equal(state.verification.attempts.length, 1);
    assert.equal(state.steps.verification.status, "pending");
    assert.equal(state.verification.attempts[0].manualAcceptance.mode, "browser");
    assert.equal(state.steps.verification.evidence.manualAcceptance, undefined);

    state = await verification.runVerification(root, "f", state.revision, "codex", ["pass"]);
    assert.equal(state.verification.attempts.length, 2);
    assert.equal(state.steps.verification.status, "satisfied");
    assert.equal(state.verification.attempts[1].manualAcceptance, undefined);
    assert.equal(state.steps.verification.evidence.manualAcceptance, undefined);
    assert.equal((await verification.readVerificationFreshness(root, state)).status, "fresh");

    await writeFile(path.join(root, "src", "app.js"), "export const x = 2;\n");
    state = await verification.invalidateStaleVerification(root, "f", state.revision);
    assert.equal(state.steps.verification.status, "pending");
    assert.equal(state.verification.attempts.length, 2);
    state = await verification.runVerification(root, "f", state.revision, "codex", ["pass"]);
    assert.equal(state.verification.attempts[2].manualAcceptance, undefined);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("successful user signoff is stored in the attempt and satisfied verification evidence", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "dev-flow-signoff-"));
  try {
    let state = await startXs(root);
    state = await verification.runVerification(root, "f", state.revision, "codex", ["pass"], {
      mode: "user-signoff",
      source: "user reply 42",
      scenarios: [{ name: "mobile navigation", evidence: "user confirmed navigation works" }],
    });
    assert.equal(state.verification.attempts[0].manualAcceptance.mode, "user-signoff");
    assert.equal(state.steps.verification.evidence.manualAcceptance.source, "user reply 42");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("invalid manual acceptance fails before commands and does not mutate revision", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "dev-flow-signoff-invalid-"));
  try {
    const state = await startXs(root);
    await assert.rejects(
      () => verification.runVerification(root, "f", state.revision, "codex", ["pass"], {
        mode: "browser", source: "browser", scenarios: [],
      }),
      (error) => error.code === "INVALID_MANUAL_ACCEPTANCE",
    );
    const after = await store.readState(root, "f");
    assert.equal(after.revision, state.revision);
    assert.equal(after.verification.attempts.length, 0);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
