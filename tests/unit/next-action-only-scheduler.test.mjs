import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { loadSource } from "../helpers/load-source.mjs";

const store = await loadSource("plugins/dev-flow/src/core/state-store.ts");
const next = await loadSource("plugins/dev-flow/src/core/next.ts");
const status = await loadSource("plugins/dev-flow/src/core/status.ts");
const projection = await loadSource("plugins/dev-flow/src/core/status-projection.ts");

const config = {
  schemaVersion: 2,
  verification: { commands: [{ id: "unit", command: process.execPath, args: ["-e", "process.exit(0)"], cwd: ".", provides: ["targeted", "behavior", "integration", "full"] }] },
  enforcement: { mode: "strict", gitWriteRequiresLogicComplete: true, oneActiveFeature: true, requireExplicitHumanReply: true },
  governedRoots: ["src"],
};

async function routedFeature(level, topology) {
  const root = await mkdtemp(path.join(os.tmpdir(), "dev-flow-next-only-"));
  await mkdir(path.join(root, "src"));
  await store.initProject(root, config);
  const state = await store.startFeature(root, { featureId: "feature", host: "codex", level, topology });
  return { root, state, dispose: () => rm(root, { recursive: true, force: true }) };
}

test("deriveNext 不再是公开合同：独立模块已移除", async () => {
  await assert.rejects(() => loadSource("plugins/dev-flow/src/policy/derive-next.ts"));
});

test("无待决 routed：胖 status 与 CompactStatus 的 next 都来自同一次 nextAction", async () => {
  const fixture = await routedFeature("XS", "local");
  try {
    const action = await next.nextAction(fixture.root, "feature");
    assert.deepEqual(action, { kind: "run-step", step: "locate" });
    const view = await status.readStatusView(fixture.root, "feature");
    assert.deepEqual(view.progress.nextAction, action);
    const compact = await projection.readCompactStatus(fixture.root, "feature");
    assert.equal(compact.contentView["需要用户决定"], false);
    assert.ok(compact.contentView["下一步"].length > 0);
    assert.equal(compact.structuredContentView.control.nextAction.kind, "run-step");
  } finally {
    await fixture.dispose();
  }
});

test("缺工件时 nextAction 是 scaffold-artifact（结构断言，不锁中文）", async () => {
  const fixture = await routedFeature("L", "multi-chain");
  try {
    const action = await next.nextAction(fixture.root, "feature");
    assert.deepEqual(action, { kind: "scaffold-artifact", step: "requirements" });
    const compact = await projection.readCompactStatus(fixture.root, "feature");
    assert.equal(compact.structuredContentView.control.nextAction.kind, "scaffold-artifact");
    assert.ok(compact.contentView["下一步"].length > 0);
  } finally {
    await fixture.dispose();
  }
});
