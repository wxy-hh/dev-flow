import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { mkdtemp, mkdir } from "node:fs/promises";
import { loadSource } from "../helpers/load-source.mjs";

const state = await loadSource("plugins/dev-flow/src/core/state-store.ts");
const grill = await loadSource("plugins/dev-flow/src/core/requirements-grill.ts");
const config = {
  schemaVersion: 2,
  verification: { commands: [{ id: "unit", command: process.execPath, args: ["-e", "process.exit(0)"], cwd: ".", provides: ["targeted", "behavior", "integration", "full"] }] },
  enforcement: { mode: "strict", gitWriteRequiresLogicComplete: true, oneActiveFeature: true, requireExplicitHumanReply: true },
  governedRoots: ["src"],
};

test("grillme in intake records and resolves a decision without a requirements document", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "dev-flow-v2-grill-"));
  await mkdir(path.join(root, "src"));
  await state.initProject(root, config);
  const started = await state.startFeature(root, { featureId: "f", objective: "澄清一个需求", host: "codex" });
  const presented = await grill.requestGrillDecision(root, "f", started.revision, {
    questionId: "DEC-001", question: "是否保留现有兼容行为？", options: [
      { id: "keep", label: "保留" }, { id: "remove", label: "移除" },
    ], host: "codex",
  });
  assert.equal(presented.state.mode, "intake");
  const resolved = await grill.resolveGrillElicitation(root, "f", presented.state.revision, presented.interactionId, "keep", undefined, "codex");
  assert.equal(resolved.state.decisionLedger[0].status, "resolved");
});

test("parallel record_decision with the same expectedRevision both succeed (conflict-tolerant retry)", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "dev-flow-v2-parallel-decision-"));
  await mkdir(path.join(root, "src"));
  await state.initProject(root, config);
  const started = await state.startFeature(root, { featureId: "f", host: "codex" });
  await state.recordHostEvent(root, { eventId: "answer-a", type: "user-prompt", host: "codex", text: "结论 A" });
  await state.recordHostEvent(root, { eventId: "answer-b", type: "user-prompt", host: "codex", text: "结论 B" });
  const results = await Promise.all([
    state.recordDecision(root, "f", started.revision, "并行决策 A？", "已有项目记录 A", "结论 A", ["fact-a"], "codex"),
    state.recordDecision(root, "f", started.revision, "并行决策 B？", "已有项目记录 B", "结论 B", ["fact-b"], "codex"),
  ]);
  assert.ok(results.length === 2 && results.every((result) => result.state.schemaVersion === 4));
  const final = await state.readState(root, "f");
  assert.equal(final.decisionLedger.length, 2);
});

test("recordDecision exposes the content-addressed decisionId it stores", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "dev-flow-v2-decision-id-"));
  await mkdir(path.join(root, "src"));
  await state.initProject(root, config);
  const started = await state.startFeature(root, { featureId: "f", host: "codex" });
  await state.recordHostEvent(root, { eventId: "answer", type: "user-prompt", host: "codex", text: "保留兼容行为" });
  const recorded = await state.recordDecision(root, "f", started.revision, "是否保留兼容行为？", "历史兼容测试仍存在", "保留兼容行为", ["fact-1"], "codex");
  assert.match(recorded.decisionId, /^DEC-[0-9a-f]{16}$/);
  assert.equal(recorded.decisionId, recorded.state.decisionLedger[0].id);
});
