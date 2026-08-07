import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { loadSource } from "../helpers/load-source.mjs";

const state = await loadSource("plugins/dev-flow/src/core/state-store.ts");
const config = {
  schemaVersion: 1,
  verification: { commands: [{ id: "unit", command: process.execPath, args: ["-e", "process.exit(0)"], cwd: "." }], behaviorCommands: [] },
  enforcement: { mode: "strict", gitWriteRequiresLogicComplete: true, oneActiveFeature: true, requireExplicitHumanReply: true },
  protectedRoots: ["src"],
};
const facts = {
  level: "M", topology: "local", execution: "standard", requirements: "provided-confirmed",
  scopeFacts: ["只改一个模块"], topologyFacts: ["没有共享契约"], uncertaintyFacts: [], riskFacts: {}, decisionRefs: [],
};

test("start creates intake and lock atomically creates routed v3 state", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "dev-flow-v2-state-"));
  await mkdir(path.join(root, "src"));
  await state.initProject(root, config);
  const intake = await state.startFeature(root, { featureId: "f", objective: "调整模块行为", scope: { inScope: ["src/需求a\u0301"], outOfScope: [] }, host: "codex" });
  assert.equal(intake.schemaVersion, 3);
  assert.equal(intake.mode, "intake");
  assert.equal(intake.route, undefined);
  assert.deepEqual(intake.scope.inScope, ["src/需求á"]);
  const routed = await state.lockClassification(root, "f", intake.revision, facts);
  assert.equal(routed.mode, "routed");
  assert.equal(routed.route, "standard-m");
  assert.equal(routed.schemaVersion, 3);
  assert.ok(routed.classificationBasis);
});

test("v1 state is rejected with an actionable hard-cut error", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "dev-flow-v2-legacy-"));
  await mkdir(path.join(root, ".dev-flow", "features", "legacy"), { recursive: true });
  await writeFile(path.join(root, ".dev-flow", "features", "legacy", "state.json"), JSON.stringify({ schemaVersion: 1 }));
  await assert.rejects(() => state.readState(root, "legacy"), /LEGACY_STATE_UNSUPPORTED/);
});

test("lock with contradictory classification args reports a readable contradiction", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "dev-flow-v2-lock-contradiction-"));
  await mkdir(path.join(root, "src"));
  await state.initProject(root, config);
  const intake = await state.startFeature(root, { featureId: "f", host: "codex" });
  await assert.rejects(
    () => state.lockClassification(root, "f", intake.revision, {
      level: "M", topology: "local", // 缺 execution：M/L 必须指定
      scopeFacts: ["只改一个模块"], topologyFacts: ["没有共享契约"], uncertaintyFacts: [],
      riskFacts: {}, decisionRefs: [],
    }),
    (error) => {
      assert.equal(error.code, "CLASSIFICATION_CONTRADICTION");
      assert.match(error.userMessage, /分类参数/);
      assert.doesNotMatch(error.cause, /条件尚未满足/);
      return true;
    },
  );
});
