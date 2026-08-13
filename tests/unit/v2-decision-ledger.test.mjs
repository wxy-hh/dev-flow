import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { mkdtemp, mkdir } from "node:fs/promises";
import { loadSource } from "../helpers/load-source.mjs";

const state = await loadSource("plugins/dev-flow/src/core/state-store.ts");
const grill = await loadSource("plugins/dev-flow/src/core/requirements-grill.ts");
const decisions = await loadSource("plugins/dev-flow/src/core/decision-interactions.ts");
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
      { id: "keep", label: "保留", description: "继续支持当前行为。" },
      { id: "remove", label: "移除", description: "删除当前兼容行为。" },
    ], recommendation: { optionId: "keep", reason: "避免在当前任务中引入额外破坏。", drawback: "会继续保留维护成本。", alternative: { optionId: "remove", condition: "如果后续版本允许破坏兼容行为" } }, host: "codex",
  });
  assert.equal(presented.state.mode, "intake");
  const resolved = await state.answer({ root, featureId: "f", expectedRevision: presented.state.revision, host: "codex", credential: { source: "elicitation", action: "keep" } });
  assert.equal(resolved.state.governance.decisions[0].recordId, "DEC-001");
});

test("recordDecision presents a ratification interaction; a second concurrent ratification is rejected", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "dev-flow-v2-parallel-decision-"));
  await mkdir(path.join(root, "src"));
  await state.initProject(root, config);
  const started = await state.startFeature(root, { featureId: "f", host: "codex" });
  await state.recordHostEvent(root, { eventId: "answer-a", type: "user-prompt", host: "codex", text: "结论 A" });
  await state.recordHostEvent(root, { eventId: "answer-b", type: "user-prompt", host: "codex", text: "结论 B" });
  const first = await state.recordDecision(root, "f", started.revision, "并行决策 A？", "已有项目记录 A", "结论 A", ["fact-a"], "codex");
  assert.equal(first.state.governance.decisions.length, 0, "ratification must not write the ledger before user confirmation");
  assert.equal(decisions.pendingDecisionForState(first.state).kind, "decision-ratification");
  // 同一 feature 只能存在一个待决问题：第二个追认被拒绝。
  await assert.rejects(
    () => state.recordDecision(root, "f", first.state.revision, "并行决策 B？", "已有项目记录 B", "结论 B", ["fact-b"], "codex"),
    (error) => error.code === "MULTIPLE_PENDING_DECISIONS",
  );
});

test("recordDecision exposes the content-addressed decisionId and ratifies after a short confirmation", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "dev-flow-v2-decision-id-"));
  await mkdir(path.join(root, "src"));
  await state.initProject(root, config);
  const started = await state.startFeature(root, { featureId: "f", host: "codex" });
  await state.recordHostEvent(root, { eventId: "answer", type: "user-prompt", host: "codex", text: "保留兼容行为" });
  const recorded = await state.recordDecision(root, "f", started.revision, "是否保留兼容行为？", "历史兼容测试仍存在", "保留兼容行为", ["fact-1"], "codex");
  assert.match(recorded.decisionId, /^DEC-[0-9a-f]{16}$/);
  assert.match(recorded.interaction.question, /较早对话中你表示/);
  assert.match(recorded.interaction.question, /保留兼容行为/);

  // 新的可信回答确认后落账；事件在呈现之后。
  await state.recordHostEvent(root, { eventId: "ratify-answer", type: "user-prompt", host: "codex", text: "确认登记" });
  const ratified = await state.answer({ root, featureId: "f", expectedRevision: recorded.state.revision, host: "codex", credential: { source: "text", userReply: "确认登记" } });
  assert.equal(ratified.state.governance.decisions[0].recordId, recorded.decisionId);
  assert.equal(ratified.state.governance.decisions[0].credentialId, `CRED-ratify-${recorded.interactionId}`);
  assert.equal(ratified.state.governance.credentials[0].basis.eventId, "ratify-answer");
});
