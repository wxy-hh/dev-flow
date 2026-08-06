import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { loadSource } from "../helpers/load-source.mjs";

const stateStore = await loadSource("plugins/dev-flow/src/core/state-store.ts");
const approvals = await loadSource("plugins/dev-flow/src/core/approval-interactions.ts");

const config = {
  schemaVersion: 1,
  verification: { commands: [{ id: "unit", command: process.execPath, args: ["-e", "process.exit(0)"], cwd: "." }], behaviorCommands: [] },
  enforcement: { mode: "strict", gitWriteRequiresLogicComplete: true, oneActiveFeature: true, requireExplicitHumanReply: true },
  protectedRoots: ["src"],
};

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
      draft.currentStage = "implementation";
    });
    const approval = state.obligations.find((item) => item.kind === "approval");
    const presentation = await approvals.presentApproval(root, state.featureId, state.revision, approval.id);
    await stateStore.recordHostEvent(root, { eventId: "prompt-claude", type: "user-prompt", host: "claude", text: "批准实现" });
    await assert.rejects(
      () => approvals.confirmApproval(root, state.featureId, presentation.revision, approval.id, "批准实现", { promptEventId: "prompt-claude" }, "codex"),
      (error) => error.code === "HOST_EVENT_HOST_MISMATCH",
    );
    const pending = await stateStore.readState(root, state.featureId);
    assert.equal(pending.humanGates[approval.id].status, "pending");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("kimi prompt events are consumable by kimi confirmations only", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "dev-flow-host-provenance-kimi-"));
  try {
    await mkdir(path.join(root, "src"));
    await stateStore.initProject(root, config);
    let state = await stateStore.startFeature(root, {
      featureId: "host",
      host: "kimi",
      level: "XS",
      topology: "local",
      riskLabels: ["security"],
    });
    state = await stateStore.mutate(root, state.featureId, state.revision, "step-recorded", (draft) => {
      draft.steps.locate = { status: "satisfied" };
      draft.currentStage = "implementation";
    });
    const approval = state.obligations.find((item) => item.kind === "approval");
    const presentation = await approvals.presentApproval(root, state.featureId, state.revision, approval.id);
    await stateStore.recordHostEvent(root, { eventId: "prompt-claude", type: "user-prompt", host: "claude", text: "批准实现" });
    await assert.rejects(
      () => approvals.confirmApproval(root, state.featureId, presentation.revision, approval.id, "批准实现", { promptEventId: "prompt-claude" }, "kimi"),
      (error) => error.code === "HOST_EVENT_HOST_MISMATCH",
    );
    await stateStore.recordHostEvent(root, { eventId: "prompt-kimi", type: "user-prompt", host: "kimi", text: "批准实现" });
    const confirmed = await approvals.confirmApproval(root, state.featureId, presentation.revision, approval.id, "批准实现", { promptEventId: "prompt-kimi" }, "kimi");
    assert.equal(confirmed.humanGates[approval.id].status, "confirmed");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
