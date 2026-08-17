import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { loadSource } from "../helpers/load-source.mjs";

const stateStore = await loadSource("plugins/dev-flow/src/core/state-store.ts");
const approvals = await loadSource("plugins/dev-flow/src/core/approval-interactions.ts");
const { answerFromHostEvents } = await loadSource("plugins/dev-flow/src/core/interaction-answer.ts");
const provenance = await loadSource("plugins/dev-flow/src/core/interaction-provenance.ts");

const config = {
  schemaVersion: 2,
  verification: { commands: [{ id: "unit", command: process.execPath, args: ["-e", "process.exit(0)"], cwd: ".", provides: ["targeted", "behavior", "integration", "full"] }] },
  enforcement: { mode: "strict", gitWriteRequiresLogicComplete: true, oneActiveFeature: true, requireExplicitHumanReply: true },
  governedRoots: ["src"],
};

test("presentation ledger order permits a same-revision prompt and rejects prompts before it", () => {
  const events = [
    { revision: 1, type: "host-event", at: "2026-01-01T00:00:01.000Z", data: { eventId: "old", type: "user-prompt", host: "codex", text: "纳入当前任务", at: "2026-01-01T00:00:01.000Z" } },
    { revision: 0, type: "started", at: "2026-01-01T00:00:02.000Z", data: { presentationEventId: "present-1" } },
    { revision: 0, type: "host-event", at: "2026-01-01T00:00:03.000Z", data: { eventId: "answer", type: "user-prompt", host: "codex", text: "纳入当前任务", at: "2026-01-01T00:00:03.000Z" } },
  ];
  const resolved = provenance.resolvePromptEvent(events, {
    host: "codex", userReply: "纳入当前任务", presentedAt: "2026-01-01T00:00:02.500Z", presentedRevision: 0, presentationEventId: "present-1",
  });
  assert.equal(resolved.eventId, "answer");
});

test("a legacy interaction without a presentation id derives same-revision order from the ledger", () => {
  const events = [
    { revision: 0, type: "host-event", at: "2026-08-01T00:00:01.000Z", data: { eventId: "before", type: "user-prompt", host: "codex", text: "确认", at: "2026-08-01T00:00:01.000Z" } },
    { revision: 0, type: "approval-presented", at: "2026-08-01T00:00:02.000Z", data: { approvalId: "approval:legacy" } },
    { revision: 0, type: "host-event", at: "2026-08-01T00:00:03.000Z", data: { eventId: "after", type: "user-prompt", host: "codex", text: "确认", at: "2026-08-01T00:00:03.000Z" } },
  ];
  assert.equal(provenance.resolvePromptEvent(events, {
    host: "codex",
    userReply: "确认",
    presentedAt: "2026-08-01T00:00:02.000Z",
    presentedRevision: 0,
  }).eventId, "after");
});

test("a consumed prompt remains unavailable even when its ledger position is valid", () => {
  let captured;
  assert.throws(
    () => provenance.resolvePromptEvent([
      { revision: 0, type: "started", at: "2026-01-01T00:00:00.000Z", data: { presentationEventId: "present-1" } },
      { revision: 0, type: "host-event", at: "2026-01-01T00:00:01.000Z", data: { eventId: "answer", type: "user-prompt", host: "codex", text: "确认", at: "2026-01-01T00:00:01.000Z" } },
    ], {
      host: "codex", userReply: "确认", presentedAt: "2026-01-01T00:00:00.500Z", presentedRevision: 0, presentationEventId: "present-1", consumedEventIds: ["answer"],
    }),
    (error) => {
      captured = error;
      return error.code === "INTERACTION_PROVENANCE_UNAVAILABLE";
    },
  );
  assert.match(captured.details.recoveryInstruction, /不要让用户改写或重复同一答案/);
  assert.match(captured.details.recoveryInstruction, /dev_flow_doctor/);
});

test("two later matching prompts remain ambiguous instead of guessing", () => {
  assert.throws(
    () => provenance.resolvePromptEvent([
      { revision: 0, type: "started", at: "2026-01-01T00:00:00.000Z", data: { presentationEventId: "present-1" } },
      { revision: 0, type: "host-event", at: "2026-01-01T00:00:01.000Z", data: { eventId: "answer-1", type: "user-prompt", host: "codex", text: "确认", at: "2026-01-01T00:00:01.000Z" } },
      { revision: 0, type: "host-event", at: "2026-01-01T00:00:02.000Z", data: { eventId: "answer-2", type: "user-prompt", host: "codex", text: "确认", at: "2026-01-01T00:00:02.000Z" } },
    ], {
      host: "codex", userReply: "确认", presentedAt: "2026-01-01T00:00:00.500Z", presentedRevision: 0, presentationEventId: "present-1",
    }),
    (error) => error.code === "INTERACTION_PROVENANCE_AMBIGUOUS",
  );
});


test("exact prompt text wins over shared-prefix historical messages", () => {
  const events = [
    { revision: 0, type: "started", at: "2026-01-01T00:00:00.000Z", data: { presentationEventId: "present-1" } },
    { revision: 0, type: "host-event", at: "2026-01-01T00:00:01.000Z", data: { eventId: "short", type: "user-prompt", host: "codex", text: "接受风险", at: "2026-01-01T00:00:01.000Z" } },
    { revision: 0, type: "host-event", at: "2026-01-01T00:00:02.000Z", data: { eventId: "long", type: "user-prompt", host: "codex", text: "接受风险：TASK-007 已覆盖", at: "2026-01-01T00:00:02.000Z" } },
  ];
  const resolved = provenance.resolvePromptEvent(events, {
    host: "codex",
    userReply: "接受风险：TASK-007 已覆盖",
    presentedAt: "2026-01-01T00:00:00.500Z",
    presentedRevision: 0,
    presentationEventId: "present-1",
  });
  assert.equal(resolved.eventId, "long");
});


test("a prompt event captured by another host cannot be consumed by approval", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "dev-flow-host-provenance-"));
  try {
    await mkdir(path.join(root, "src"));
    await stateStore.initProject(root, config);
    let state = await stateStore.startFeature(root, {
      featureId: "host",
      host: "claude",
      level: "XS",
      topology: "local",
      riskLabels: ["security"],
    });
    state = await stateStore.mutate(root, state.featureId, state.revision, "step-recorded", (draft) => {
      draft.steps.locate = { status: "satisfied" };
    });
    const approval = state.obligations.find((item) => item.kind === "approval");
    const presentation = await approvals.presentApproval(root, state.featureId, state.revision);
    const presentedState = await stateStore.readState(root, state.featureId);
    const interaction = presentedState.interactions[presentation.interactionId];
    const presentedEvent = (await stateStore.readFeatureEvents(root, state.featureId)).find((event) => event.type === "approval-presented");
    assert.equal(presentedEvent.data.presentationEventId, interaction.presentationEventId);
    await stateStore.recordHostEvent(root, { eventId: "prompt-claude", type: "user-prompt", host: "claude", text: "批准实现" });
    await assert.rejects(
      () => answerFromHostEvents({ root, featureId: state.featureId, expectedRevision: presentation.state.revision, host: "codex" }),
      (error) => error.code === "INTERACTION_EVENT_MISSING",
    );
    const pending = await stateStore.readState(root, state.featureId);
    assert.equal(pending.humanGates[approval.id].status, "pending");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
