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
const inspection = await loadSource("plugins/dev-flow/src/core/inspection.ts");

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
  await writeFile(path.join(root, "src", "excluded.js"), "export const excluded = true;\n");
  await run("git", ["init", "--quiet"], { cwd: root });
  await run("git", ["add", "src"], { cwd: root });
  await run("git", ["-c", "user.name=Dev Flow Tests", "-c", "user.email=tests@example.invalid", "commit", "--quiet", "-m", "baseline"], { cwd: root });
  return root;
}

async function startWithExcluded(root) {
  await store.initProject(root, config);
  // 启动前让被排除路径处于脏状态：scope.outOfScope 会把启动脏路径归属为 excluded。
  await writeFile(path.join(root, "src", "excluded.js"), "export const excluded = false;\n");
  let state = await store.startFeature(root, {
    featureId: "f",
    host: "codex",
    level: "XS",
    topology: "local",
    scope: { inScope: ["src/app.js"], outOfScope: ["src/excluded.js"] },
  });
  assert.equal(state.workspace.ownership["src/excluded.js"], "excluded");
  state = await checks.recordStep(root, "f", state.revision, "locate", {});
  await store.recordTrustedWriteIntent(root, ["src/app.js"], "codex", "write-1");
  await writeFile(path.join(root, "src", "app.js"), "export const value = 2;\n");
  await store.recordTrustedWriteOwnership(root, ["src/app.js"], "codex", "write-1");
  state = await store.readState(root, "f");
  return checks.recordStep(root, "f", state.revision, "implementation", {});
}

test("finalize reports excluded paths that still have changes without blocking or including them in the patch", async () => {
  const root = await createGitRoot("dev-flow-non-delivery-");
  try {
    let state = await startWithExcluded(root);
    // 被排除路径在 finalize 前仍有变化（不属于当前任务，但应被报告）。
    await writeFile(path.join(root, "src", "excluded.js"), "export const excluded = false;\n");
    state = await verification.runVerification(root, "f", state.revision, "codex", ["pass"]);
    const finalized = await checks.finalize(root, "f", state.revision);

    assert.equal(finalized.lifecycle, "finalized");
    const snapshot = finalized.deliverySnapshot;
    assert.deepEqual(snapshot.excludedChangedPaths, ["src/excluded.js"]);
    assert.equal(snapshot.files.includes("src/excluded.js"), false, "excluded path must not enter the delivery patch");
    assert.equal(snapshot.files.includes("src/app.js"), true);

    const manifest = await readFile(path.join(root, snapshot.manifestPath), "utf8");
    assert.match(manifest, /## 非交付改动/);
    assert.match(manifest, /- src\/excluded\.js/);
    assert.match(manifest, /不会进入交付 patch，也不会阻塞完成/);

    const patch = await readFile(path.join(root, snapshot.patchPath), "utf8");
    assert.equal(patch.includes("excluded.js"), false);

    // delivery inspect 保留同一份列表
    const deliveryView = await inspection.inspectFeature(root, finalized.featureId, "delivery");
    assert.deepEqual(deliveryView.content.excludedChangedPaths, ["src/excluded.js"]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("without excluded changes the report omits the non-delivery section entirely", async () => {
  const root = await createGitRoot("dev-flow-non-delivery-clean-");
  try {
    let state = await startWithExcluded(root);
    // 把启动时已脏的 excluded 路径恢复干净：不再有变化 → 报告省略该段落。
    await writeFile(path.join(root, "src", "excluded.js"), "export const excluded = true;\n");
    state = await verification.runVerification(root, "f", state.revision, "codex", ["pass"]);
    const finalized = await checks.finalize(root, "f", state.revision);
    const snapshot = finalized.deliverySnapshot;
    assert.equal(snapshot.excludedChangedPaths, undefined);
    const manifest = await readFile(path.join(root, snapshot.manifestPath), "utf8");
    assert.equal(manifest.includes("非交付改动"), false);
    const deliveryView = await inspection.inspectFeature(root, finalized.featureId, "delivery");
    assert.equal("excludedChangedPaths" in deliveryView.content, false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
