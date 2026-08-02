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
const config = {
  schemaVersion: 1,
  verification: { commands: [{ id: "pass", command: "node", args: ["-e", "process.exit(0)"], cwd: "." }], behaviorCommands: [] },
  enforcement: { mode: "strict", gitWriteRequiresLogicComplete: true, oneActiveFeature: true, requireExplicitHumanReply: true },
  protectedRoots: ["src"],
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

async function startXs(root) {
  await store.initProject(root, config);
  let state = await store.startFeature(root, { featureId: "f", host: "codex", level: "XS", topology: "local" });
  state = await checks.recordStep(root, "f", state.revision, "locate", {});
  return state;
}

async function verifyAndFinalize(root, state) {
  state = await verification.runVerification(root, "f", state.revision, "codex", ["pass"]);
  return checks.finalize(root, "f", state.revision);
}

test("finalize requires a Git baseline even when implementation has no files", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "dev-flow-snapshot-no-git-"));
  try {
    await mkdir(path.join(root, "src"));
    await writeFile(path.join(root, "src", "app.js"), "export const value = 1;\n");
    let state = await startXs(root);
    state = await checks.recordStep(root, "f", state.revision, "implementation", { files: [] });
    state = await verification.runVerification(root, "f", state.revision, "codex", ["pass"]);
    await assert.rejects(
      () => checks.finalize(root, "f", state.revision),
      (error) => error.code === "DELIVERY_SNAPSHOT_GIT_REQUIRED",
    );
    const active = await store.readState(root, "f");
    assert.equal(active.lifecycle, "active");
    assert.equal(active.deliverySnapshot, undefined);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("a Git-backed zero-file feature still records an empty delivery snapshot", async () => {
  const root = await createGitRoot("dev-flow-snapshot-empty-");
  try {
    let state = await startXs(root);
    state = await checks.recordStep(root, "f", state.revision, "implementation", { files: [] });
    state = await verifyAndFinalize(root, state);
    assert.ok(state.deliverySnapshot);
    assert.equal(await readFile(path.join(root, state.deliverySnapshot.patchPath), "utf8"), "");
    assert.match(await readFile(path.join(root, state.deliverySnapshot.manifestPath), "utf8"), /交付快照/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("protected roots are canonicalized before implementation files are validated", async () => {
  const root = await createGitRoot("dev-flow-snapshot-root-normalization-");
  const trailingSlashConfig = { ...config, protectedRoots: ["src/"] };
  try {
    await store.initProject(root, trailingSlashConfig);
    assert.deepEqual((await store.readProjectConfig(root)).protectedRoots, ["src"]);
    let state = await store.startFeature(root, { featureId: "f", host: "codex", level: "XS", topology: "local" });
    state = await checks.recordStep(root, "f", state.revision, "locate", {});
    state = await checks.recordStep(root, "f", state.revision, "implementation", { files: ["src/app.js"] });
    assert.deepEqual(state.steps.implementation.evidence.files, ["src/app.js"]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("implementation paths use NFC across Chinese, decomposed Unicode, and Windows separators", () => {
  const decomposed = "src/需求a\u0301.js";
  const composed = "src/需求á.js";
  assert.deepEqual(delivery.implementationFiles({ files: [decomposed, "src\\配置\\入口.js"] }), ["src/配置/入口.js", composed]);
});

test("implementation registration accepts existing files and Git-tracked deletions", async () => {
  const existingRoot = await createGitRoot("dev-flow-snapshot-existence-ok-");
  try {
    let state = await startXs(existingRoot);
    state = await checks.recordStep(existingRoot, "f", state.revision, "implementation", { files: ["src/app.js"] });
    assert.equal(state.steps.implementation.status, "satisfied");
  } finally {
    await rm(existingRoot, { recursive: true, force: true });
  }

  // 删除场景必须在首次（唯一一次）登记前删文件：已关闭的步骤无法再次登记。
  const deletedRoot = await createGitRoot("dev-flow-snapshot-existence-rm-");
  try {
    let state = await startXs(deletedRoot);
    await rm(path.join(deletedRoot, "src", "app.js"));
    state = await checks.recordStep(deletedRoot, "f", state.revision, "implementation", { files: ["src/app.js"] });
    assert.equal(state.steps.implementation.status, "satisfied");
  } finally {
    await rm(deletedRoot, { recursive: true, force: true });
  }

  const missingRoot = await createGitRoot("dev-flow-snapshot-existence-missing-");
  try {
    const state = await startXs(missingRoot);
    await assert.rejects(
      () => checks.recordStep(missingRoot, "f", state.revision, "implementation", { files: ["src/never-created.js"] }),
      (error) => error.code === "INVALID_IMPLEMENTATION_FILE"
        && /纯路径/.test(error.details.recoveryHint),
    );
  } finally {
    await rm(missingRoot, { recursive: true, force: true });
  }
});

test("implementation evidence accepts only normalized paths inside protected roots", async () => {
  const root = await createGitRoot("dev-flow-snapshot-paths-");
  try {
    const state = await startXs(root);
    await assert.rejects(
      () => checks.recordStep(root, "f", state.revision, "implementation", { files: ["README.md"] }),
      (error) => error.code === "INVALID_IMPLEMENTATION_FILE",
    );
    await assert.rejects(
      () => checks.recordStep(root, "f", state.revision, "implementation", { files: ["src/../outside.js"] }),
      (error) => error.code === "INVALID_IMPLEMENTATION_FILE",
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("finalize writes a reversible snapshot for registered tracked and untracked files", async () => {
  const root = await createGitRoot("dev-flow-snapshot-");
  try {
    let state = await startXs(root);
    await writeFile(path.join(root, "src", "app.js"), "export const value = 2;\n");
    await writeFile(path.join(root, "src", "new.js"), "export const added = true;\n");
    state = await checks.recordStep(root, "f", state.revision, "implementation", { files: ["src/app.js", "src/new.js"] });
    state = await verifyAndFinalize(root, state);

    assert.equal(state.lifecycle, "finalized");
    assert.deepEqual(state.deliverySnapshot.files, ["src/app.js", "src/new.js"]);
    const patch = await readFile(path.join(root, state.deliverySnapshot.patchPath), "utf8");
    const manifest = await readFile(path.join(root, state.deliverySnapshot.manifestPath), "utf8");
    assert.match(patch, /src\/new\.js/);
    assert.match(manifest, /Base Git HEAD:/);
    assert.match(manifest, /git apply -R --binary/);

    await run("git", ["apply", "-R", "--binary", state.deliverySnapshot.patchPath], { cwd: root });
    assert.equal(await readFile(path.join(root, "src", "app.js"), "utf8"), "export const value = 1;\n");
    await assert.rejects(() => readFile(path.join(root, "src", "new.js"), "utf8"), { code: "ENOENT" });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("finalize rejects feature ownership of an initially dirty protected file", async () => {
  const root = await createGitRoot("dev-flow-snapshot-dirty-");
  try {
    await writeFile(path.join(root, "src", "app.js"), "export const value = 2;\n");
    let state = await startXs(root);
    state = await checks.recordStep(root, "f", state.revision, "implementation", { files: ["src/app.js"] });
    state = await verification.runVerification(root, "f", state.revision, "codex", ["pass"]);
    await assert.rejects(
      () => checks.finalize(root, "f", state.revision),
      (error) => error.code === "DELIVERY_FILE_PREEXISTING_DIRTY",
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("finalize rejects protected changes absent from implementation evidence", async () => {
  const root = await createGitRoot("dev-flow-snapshot-unregistered-");
  try {
    let state = await startXs(root);
    await writeFile(path.join(root, "src", "app.js"), "export const value = 2;\n");
    state = await checks.recordStep(root, "f", state.revision, "implementation", { files: [] });
    state = await verification.runVerification(root, "f", state.revision, "codex", ["pass"]);
    await assert.rejects(
      () => checks.finalize(root, "f", state.revision),
      (error) => error.code === "DELIVERY_FILE_UNREGISTERED",
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("finalize rejects a committed protected change after the feature baseline", async () => {
  const root = await createGitRoot("dev-flow-snapshot-head-drift-");
  try {
    let state = await startXs(root);
    await writeFile(path.join(root, "src", "app.js"), "export const value = 2;\n");
    state = await checks.recordStep(root, "f", state.revision, "implementation", { files: ["src/app.js"] });
    await run("git", ["add", "src/app.js"], { cwd: root });
    await run("git", ["-c", "user.name=Dev Flow Tests", "-c", "user.email=tests@example.invalid", "commit", "--quiet", "-m", "intervening change"], { cwd: root });
    state = await verification.runVerification(root, "f", state.revision, "codex", ["pass"]);

    await assert.rejects(
      () => checks.finalize(root, "f", state.revision),
      (error) => error.code === "DELIVERY_BASELINE_CHANGED",
    );
    const active = await store.readState(root, "f");
    assert.equal(active.lifecycle, "active");
    assert.equal(active.deliverySnapshot, undefined);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
