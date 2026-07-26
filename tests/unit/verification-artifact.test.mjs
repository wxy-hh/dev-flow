import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { loadSource } from "../helpers/load-source.mjs";

const store = await loadSource("plugins/dev-flow/src/core/state-store.ts");
const artifacts = await loadSource("plugins/dev-flow/src/core/artifacts.ts");
const checks = await loadSource("plugins/dev-flow/src/core/feature-check.ts");
const gates = await loadSource("plugins/dev-flow/src/core/human-gates.ts");
const next = await loadSource("plugins/dev-flow/src/core/next.ts");
const verification = await loadSource("plugins/dev-flow/src/core/verification.ts");

const config = {
  schemaVersion: 1,
  verification: {
    commands: [{ id: "unit", command: "node", args: ["-e", "process.exit(0)"], cwd: "." }],
    behaviorCommands: [],
  },
  enforcement: { mode: "strict", gitWriteRequiresLogicComplete: true, oneActiveFeature: true, requireExplicitHumanReply: true },
  protectedRoots: ["src"],
};

async function verifiedLightL(root) {
  await mkdir(path.join(root, "src"));
  await writeFile(path.join(root, "src", "app.js"), "export const value = 1;\n");
  await store.initProject(root, config);
  let state = await store.startFeature(root, {
    featureId: "f", host: "codex", level: "L", topology: "multi-chain", execution: "light",
  });
  state = await artifacts.scaffoldArtifact(root, "f", state.revision, "boundary-card");
  state = await checks.recordStep(root, "f", state.revision, "boundary", {});
  state = await artifacts.scaffoldArtifact(root, "f", state.revision, "rollback-safety");
  state = await checks.recordStep(root, "f", state.revision, "rollback_safety", {});
  state = await gates.presentGate(root, "f", state.revision, "implementation_approval");
  await store.recordHostEvent(root, {
    eventId: "approval", type: "user-prompt", host: "codex", text: "批准实现",
  });
  state = await gates.confirmGate(
    root, "f", state.revision, "implementation_approval", "批准实现", { promptEventId: "approval" }, "codex",
  );
  state = await checks.recordStep(root, "f", state.revision, "implementation", {});
  state = await checks.recordStep(root, "f", state.revision, "code_review", { reviewType: "code" });
  state = await artifacts.scaffoldArtifact(root, "f", state.revision, "verification");
  return verification.runVerification(root, "f", state.revision, "codex");
}

test("recorded verification narrative keeps commands fresh and reopens feature-check only", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "dev-flow-verification-narrative-"));
  try {
    let state = await verifiedLightL(root);
    state = await checks.featureCheck(root, "f", state.revision);
    const fingerprint = state.verification.verifiedFingerprint;
    const file = path.join(root, ".dev-flow", "features", "f", "verification.md");
    await writeFile(file, `${await readFile(file, "utf8")}\nBrowser scenario: accepted.\n`);
    state = await artifacts.recordArtifact(root, "f", state.revision, "verification");

    assert.equal(state.steps.verification.status, "satisfied");
    assert.equal(state.verification.verifiedFingerprint, fingerprint);
    assert.equal(state.steps.feature_check, undefined);
    assert.equal(state.steps.finalize, undefined);
    assert.equal((await verification.readVerificationFreshness(root, state)).status, "fresh");
    assert.deepEqual(await next.nextAction(root, "f"), {
      kind: "feature-check",
      requiredEvidence: { fields: {}, checks: [], verificationKinds: ["targeted"] },
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("unregistered verification narrative edit fails artifact integrity", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "dev-flow-verification-dirty-"));
  try {
    const state = await verifiedLightL(root);
    const file = path.join(root, ".dev-flow", "features", "f", "verification.md");
    await writeFile(file, `${await readFile(file, "utf8")}\nunregistered edit\n`);
    await assert.rejects(
      () => checks.featureCheck(root, "f", state.revision),
      (error) => error.code === "ARTIFACT_INTEGRITY_FAILED",
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("feature-check and finalize continue to report stale verification after invalidation", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "dev-flow-verification-stale-final-"));
  try {
    let state = await verifiedLightL(root);
    await writeFile(path.join(root, "src", "app.js"), "export const value = 2;\n");
    await assert.rejects(
      () => checks.featureCheck(root, "f", state.revision),
      (error) => error.code === "VERIFICATION_STALE",
    );
    state = await store.readState(root, "f");
    await assert.rejects(
      () => checks.finalize(root, "f", state.revision),
      (error) => error.code === "VERIFICATION_STALE",
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
