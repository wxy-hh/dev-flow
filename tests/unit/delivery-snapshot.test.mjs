import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import { loadSource } from "../helpers/load-source.mjs";

const run = promisify(execFile);
const store = await loadSource("plugins/dev-flow/src/core/state-store.ts");
const checks = await loadSource("plugins/dev-flow/src/core/feature-check.ts");
const verification = await loadSource("plugins/dev-flow/src/core/verification.ts");
const delivery = await loadSource("plugins/dev-flow/src/core/delivery-snapshot.ts");
const lineage = await loadSource("plugins/dev-flow/src/core/git-reconciliation.ts");
const config = {
  schemaVersion: 2,
  verification: { commands: [{ id: "pass", command: "node", args: ["-e", "process.exit(0)"], cwd: ".", provides: ["targeted"] }] },
  enforcement: { mode: "strict", gitWriteRequiresLogicComplete: true, oneActiveFeature: true, requireExplicitHumanReply: true },
  governedRoots: ["src"],
};

async function createGitRoot(prefix) {
  const root = await mkdtemp(path.join(os.tmpdir(), prefix));
  await mkdir(path.join(root, "src"));
  await writeFile(path.join(root, "src", "app.js"), "export const value = 1;\n");
  await run("git", ["init", "--quiet"], { cwd: root });
  await run("git", ["add", "src/app.js"], { cwd: root });
  await run("git", ["-c", "user.name=Dev Flow Tests", "-c", "user.email=tests@example.invalid", "commit", "--quiet", "-m", "baseline"], { cwd: root });
  return root;
}

async function startXs(root, projectConfig = config) {
  await store.initProject(root, projectConfig);
  let state = await store.startFeature(root, { featureId: "f", host: "codex", level: "XS", topology: "local" });
  return checks.recordStep(root, "f", state.revision, "locate", {});
}

async function trustedWrite(root, state, files, change, eventId) {
  await store.recordTrustedWriteIntent(root, files, "codex", eventId);
  await change();
  await store.recordTrustedWriteOwnership(root, files, "codex", eventId);
  return store.readState(root, state.featureId);
}

async function verifyAndFinalize(root, state) {
  state = await verification.runVerification(root, "f", state.revision, "codex", ["pass"]);
  return checks.finalize(root, "f", state.revision);
}

test("5.0 requires Git lineage when a feature starts", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "dev-flow-no-git-"));
  try {
    await mkdir(path.join(root, "src"));
    await assert.rejects(
      () => lineage.captureWorkspaceLineage(root, config),
      (error) => error.code === "GIT_LINEAGE_UNAVAILABLE",
    );
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("governed roots are canonical and implementation files are Core-derived", async () => {
  const root = await createGitRoot("dev-flow-derived-files-");
  try {
    let state = await startXs(root, { ...config, governedRoots: ["src/"] });
    assert.deepEqual((await store.readProjectConfig(root)).governedRoots, ["src"]);
    state = await checks.recordStep(root, "f", state.revision, "implementation", { files: ["README.md", "src/never-created.js"] });
    assert.deepEqual(state.steps.implementation.evidence, { derivedBy: "core", files: [] });
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("trusted writes are automatically owned and included in the reversible snapshot", async () => {
  const root = await createGitRoot("dev-flow-trusted-snapshot-");
  try {
    let state = await startXs(root);
    state = await trustedWrite(root, state, ["src/app.js", "src/new.js"], async () => {
      await writeFile(path.join(root, "src", "app.js"), "export const value = 2;\n");
      await writeFile(path.join(root, "src", "new.js"), "export const added = true;\n");
    }, "write-1");
    state = await checks.recordStep(root, "f", state.revision, "implementation", {});
    assert.deepEqual(state.steps.implementation.evidence.files, ["src/app.js", "src/new.js"]);
    state = await verifyAndFinalize(root, state);
    assert.deepEqual(state.deliverySnapshot.files, ["src/app.js", "src/new.js"]);
    const patch = await readFile(path.join(root, state.deliverySnapshot.patchPath), "utf8");
    assert.match(patch, /src\/new\.js/);
    await run("git", ["apply", "-R", "--binary", state.deliverySnapshot.patchPath], { cwd: root });
    assert.equal(await readFile(path.join(root, "src", "app.js"), "utf8"), "export const value = 1;\n");
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("unattributed IDE changes are rejected with exact ownership recovery", async () => {
  const root = await createGitRoot("dev-flow-unknown-ownership-");
  try {
    const state = await startXs(root);
    await writeFile(path.join(root, "src", "app.js"), "export const value = 2;\n");
    await assert.rejects(
      () => checks.recordStep(root, "f", state.revision, "implementation", {}),
      (error) => error.code === "DELIVERY_OWNERSHIP_UNRESOLVED"
        && error.details.files.includes("src/app.js")
        && /reconcile_workspace/.test(error.details.recoveryHint),
    );
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("implementation path normalization remains NFC and platform independent", () => {
  const decomposed = "src/需求a\u0301.js";
  assert.deepEqual(delivery.implementationFiles({ files: [decomposed, "src\\配置\\入口.js"] }), ["src/配置/入口.js", "src/需求á.js"]);
});
