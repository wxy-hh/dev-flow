import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { loadSource } from "../helpers/load-source.mjs";
import { registerTraceFixture } from "../helpers/trace-fixtures.mjs";

const store = await loadSource("plugins/dev-flow/src/core/state-store.ts");
const artifacts = await loadSource("plugins/dev-flow/src/core/artifacts.ts");
const gates = await loadSource("plugins/dev-flow/src/core/human-gates.ts");
const config = { schemaVersion: 1, verification: { commands: [{ id: "unit", command: "node", args: ["-e", "process.exit(0)"], cwd: "." }], behaviorCommands: [] }, enforcement: { mode: "strict", gitWriteRequiresLogicComplete: true, oneActiveFeature: true, requireExplicitHumanReply: true }, protectedRoots: ["src"] };

test("human confirmation is explicit, later, and tied to the artifact basis", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "dev-flow-gate-"));
  try {
    await store.initProject(root, config);
    let state = await store.startFeature(root, { featureId: "f", host: "claude", level: "M", topology: "local", execution: "standard", requirements: "missing-or-unclear" });
    await assert.rejects(() => gates.presentGate(root, "f", state.revision, "requirement_confirmation"), /STEP_OUT_OF_ORDER/);
    state = await artifacts.scaffoldArtifact(root, "f", state.revision, "requirements");
    const file = path.join(root, ".dev-flow", "features", "f", "需求文档.md");
    await writeFile(file, (await readFile(file, "utf8")).replace(/^  grill_status: pending$/m, "  grill_status: complete"));
    state = await registerTraceFixture({ root, featureId: "f", state, kind: "requirements" });
    state = await (await loadSource("plugins/dev-flow/src/core/feature-check.ts")).recordStep(root, "f", state.revision, "requirements", {});
    state = await gates.presentGate(root, "f", state.revision, "requirement_confirmation");
    await assert.rejects(() => gates.confirmGate(root, "f", state.revision, "requirement_confirmation", "", { promptEventId: "p1" }, "claude"), /HUMAN_GATE_REPLY_REQUIRED/);
    for (const rejected of [
      "不批准",
      "先等等",
      "确认需求，可以继续",
      "批准实现，但先别改",
      "这是普通问题",
      "批准实现",
    ]) {
      await assert.rejects(
        () => gates.confirmGate(root, "f", state.revision, "requirement_confirmation", rejected, { promptEventId: "p1" }, "claude"),
        (error) => error.code === "HUMAN_GATE_APPROVAL_NOT_EXPLICIT"
          && error.details.allowed.includes("LGTM"),
      );
      assert.equal((await store.readState(root, "f")).revision, state.revision);
    }
    await assert.rejects(() => gates.confirmGate(root, "f", state.revision, "requirement_confirmation", "approved", {}, "claude"), /HUMAN_GATE_PROVENANCE_UNAVAILABLE/);
    await store.recordHostEvent(root, { eventId: "p1", type: "user-prompt", host: "claude", text: "lgtm" });
    state = await gates.confirmGate(root, "f", state.revision, "requirement_confirmation", "lgtm", { promptEventId: "p1" }, "claude");
    assert.equal(state.steps.requirement_confirmation.status, "satisfied");
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("gate hints bind an exact later prompt automatically and dedupe retried host hooks", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "dev-flow-gate-auto-"));
  try {
    await store.initProject(root, config);
    let state = await store.startFeature(root, { featureId: "f", host: "claude", level: "M", topology: "local", execution: "standard", requirements: "missing-or-unclear" });
    state = await artifacts.scaffoldArtifact(root, "f", state.revision, "requirements");
    const file = path.join(root, ".dev-flow", "features", "f", "需求文档.md");
    await writeFile(file, (await readFile(file, "utf8")).replace(/^  grill_status: pending$/m, "  grill_status: complete"));
    state = await registerTraceFixture({ root, featureId: "f", state, kind: "requirements" });
    state = await (await loadSource("plugins/dev-flow/src/core/feature-check.ts")).recordStep(root, "f", state.revision, "requirements", {});

    state = await gates.presentGate(root, "f", state.revision, "requirement_confirmation");
    assert.match(state.gateReplyHint, /✅ 如需确认需求/);
    assert.equal(state.gateInteraction.options[0].label, "确认需求");
    const presented = (await store.readFeatureEvents(root, "f")).at(-1);
    assert.equal(presented.type, "gate-presented");
    assert.match(presented.data.replyHint, /✅ 如需确认需求/);
    assert.doesNotMatch(presented.data.replyHint, /DF-/);

    const prompt = { eventId: "p-auto", type: "user-prompt", host: "claude", text: "确认需求" };
    await store.recordHostEvent(root, prompt);
    await store.recordHostEvent(root, prompt);
    const hostEvents = (await store.readFeatureEvents(root, "f")).filter((event) => event.type === "host-event");
    assert.equal(hostEvents.length, 1);

    state = await gates.confirmGate(root, "f", state.revision, "requirement_confirmation", "确认需求", {}, "claude");
    assert.equal(state.humanGates.requirement_confirmation.confirmation.promptEventId, "p-auto");
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("native gate choices confirm directly, require feedback for changes, and retain text-token fallback", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "dev-flow-gate-interactions-"));
  try {
    await store.initProject(root, config);
    let state = await store.startFeature(root, { featureId: "f", host: "codex", level: "M", topology: "local", execution: "standard", requirements: "missing-or-unclear" });
    state = await artifacts.scaffoldArtifact(root, "f", state.revision, "requirements");
    const file = path.join(root, ".dev-flow", "features", "f", "需求文档.md");
    await writeFile(file, (await readFile(file, "utf8")).replace(/^  grill_status: pending$/m, "  grill_status: complete"));
    state = await registerTraceFixture({ root, featureId: "f", state, kind: "requirements" });
    state = await (await loadSource("plugins/dev-flow/src/core/feature-check.ts")).recordStep(root, "f", state.revision, "requirements", {});

    state = await gates.presentGate(root, "f", state.revision, "requirement_confirmation");
    await assert.rejects(
      () => gates.resolveGateElicitation(root, "f", state.revision, state.gateInteraction.id, "request-changes", undefined, "codex"),
      (error) => error.code === "INTERACTION_COMMENT_REQUIRED",
    );
    state = await gates.resolveGateElicitation(root, "f", state.revision, state.gateInteraction.id, "request-changes", "补充离线场景", "codex");
    assert.equal(state.steps.requirement_confirmation, undefined);
    assert.equal(state.humanGates.requirement_confirmation.status, "returned");
    assert.equal(state.humanGates.requirement_confirmation.lastResponse.comment, "补充离线场景");
    await assert.rejects(
      () => gates.confirmGate(root, "f", state.revision, "requirement_confirmation", "确认需求", { promptEventId: "unused" }, "codex"),
      (error) => error.code === "HUMAN_GATE_NOT_PENDING",
    );

    state = await registerTraceFixture({ root, featureId: "f", state, kind: "requirements" });
    state = await gates.presentGate(root, "f", state.revision, "requirement_confirmation");
    state = await gates.resolveGateElicitation(root, "f", state.revision, state.gateInteraction.id, "confirm", undefined, "codex");
    assert.equal(state.steps.requirement_confirmation.status, "satisfied");
    assert.equal(state.humanGates.requirement_confirmation.confirmation.source, "elicitation");

    state = await registerTraceFixture({ root, featureId: "f", state, kind: "requirements" });
    state = await gates.presentGate(root, "f", state.revision, "requirement_confirmation");
    const reply = state.gateInteraction.fallback.replies.find((candidate) => candidate.action === "confirm").reply;
    await store.recordHostEvent(root, { eventId: "token", type: "user-prompt", host: "codex", text: reply });
    state = await gates.resolveGateToken(root, "f", state.revision, state.gateInteraction.id, reply, {}, "codex");
    assert.equal(state.humanGates.requirement_confirmation.confirmation.source, "text-token");
    assert.equal(state.humanGates.requirement_confirmation.confirmation.promptEventId, "token");
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("natural-language approval phrases confirm gates through the interaction path", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "dev-flow-gate-phrase-"));
  try {
    await store.initProject(root, config);
    let state = await store.startFeature(root, { featureId: "f", host: "claude", level: "M", topology: "local", execution: "standard", requirements: "missing-or-unclear" });
    state = await artifacts.scaffoldArtifact(root, "f", state.revision, "requirements");
    const file = path.join(root, ".dev-flow", "features", "f", "需求文档.md");
    await writeFile(file, (await readFile(file, "utf8")).replace(/^  grill_status: pending$/m, "  grill_status: complete"));
    state = await registerTraceFixture({ root, featureId: "f", state, kind: "requirements" });
    state = await (await loadSource("plugins/dev-flow/src/core/feature-check.ts")).recordStep(root, "f", state.revision, "requirements", {});

    // 自然语言批准词（含大小写变体）直接确认，无需 token 行
    state = await gates.presentGate(root, "f", state.revision, "requirement_confirmation");
    await store.recordHostEvent(root, { eventId: "phrase", type: "user-prompt", host: "claude", text: "确认需求" });
    state = await gates.resolveGateToken(root, "f", state.revision, state.gateInteraction.id, "确认需求", {}, "claude");
    assert.equal(state.steps.requirement_confirmation.status, "satisfied");
    const confirmation = state.humanGates.requirement_confirmation.confirmation;
    assert.equal(confirmation.action, "confirm");
    assert.equal(confirmation.source, "text-token");
    assert.equal(confirmation.userReply, "确认需求");

    // 整句之外的自由文本仍拒绝（token 兜底通道不受影响）
    state = await registerTraceFixture({ root, featureId: "f", state, kind: "requirements" });
    state = await gates.presentGate(root, "f", state.revision, "requirement_confirmation");
    await store.recordHostEvent(root, { eventId: "phrase2", type: "user-prompt", host: "claude", text: "确认需求，可以" });
    await assert.rejects(
      () => gates.resolveGateToken(root, "f", state.revision, state.gateInteraction.id, "确认需求，可以", {}, "claude"),
      (error) => error.code === "INTERACTION_TOKEN_MISMATCH",
    );
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("provenance matching tolerates whitespace differences in the captured prompt", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "dev-flow-gate-whitespace-"));
  try {
    await store.initProject(root, config);
    let state = await store.startFeature(root, { featureId: "f", host: "claude", level: "M", topology: "local", execution: "standard", requirements: "missing-or-unclear" });
    state = await artifacts.scaffoldArtifact(root, "f", state.revision, "requirements");
    const file = path.join(root, ".dev-flow", "features", "f", "需求文档.md");
    await writeFile(file, (await readFile(file, "utf8")).replace(/^  grill_status: pending$/m, "  grill_status: complete"));
    state = await registerTraceFixture({ root, featureId: "f", state, kind: "requirements" });
    state = await (await loadSource("plugins/dev-flow/src/core/feature-check.ts")).recordStep(root, "f", state.revision, "requirements", {});

    // 捕获的事件文本带尾随空格与多余内部空格，userReply 为规范形式 → 归一化后匹配
    state = await gates.presentGate(root, "f", state.revision, "requirement_confirmation");
    await store.recordHostEvent(root, { eventId: "ws", type: "user-prompt", host: "claude", text: "  确认需求  " });
    state = await gates.resolveGateToken(root, "f", state.revision, state.gateInteraction.id, "确认需求", {}, "claude");
    assert.equal(state.humanGates.requirement_confirmation.confirmation.action, "confirm");
  } finally { await rm(root, { recursive: true, force: true }); }
});

/** Standard-m feature with the requirement gate presented and waiting for confirmation. */
async function readyRequirementGate(root) {
  await store.initProject(root, config);
  let state = await store.startFeature(root, { featureId: "f", host: "claude", level: "M", topology: "local", execution: "standard", requirements: "missing-or-unclear" });
  state = await artifacts.scaffoldArtifact(root, "f", state.revision, "requirements");
  const file = path.join(root, ".dev-flow", "features", "f", "需求文档.md");
  await writeFile(file, (await readFile(file, "utf8")).replace(/^  grill_status: pending$/m, "  grill_status: complete"));
  state = await registerTraceFixture({ root, featureId: "f", state, kind: "requirements" });
  state = await (await loadSource("plugins/dev-flow/src/core/feature-check.ts")).recordStep(root, "f", state.revision, "requirements", {});
  return gates.presentGate(root, "f", state.revision, "requirement_confirmation");
}

test("dual event ids confirm the gate when each id matches its own event", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "dev-flow-gate-dual-ok-"));
  try {
    let state = await readyRequirementGate(root);
    await store.recordHostEvent(root, { eventId: "p1", type: "user-prompt", host: "claude", text: "lgtm" });
    await store.recordHostEvent(root, { eventId: "t1", type: "turn-boundary", host: "claude" });
    state = await gates.confirmGate(root, "f", state.revision, "requirement_confirmation", "lgtm", { promptEventId: "p1", turnBoundaryEventId: "t1" }, "claude");
    assert.equal(state.steps.requirement_confirmation.status, "satisfied");
    assert.equal(state.humanGates.requirement_confirmation.confirmation.promptEventId, "p1");
    assert.equal(state.humanGates.requirement_confirmation.confirmation.turnBoundaryEventId, "t1");
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("a turn-boundary id pointing at a user-prompt event is rejected", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "dev-flow-gate-dual-mislabel-"));
  try {
    const state = await readyRequirementGate(root);
    await store.recordHostEvent(root, { eventId: "p2", type: "user-prompt", host: "claude", text: "lgtm" });
    await assert.rejects(
      () => gates.confirmGate(root, "f", state.revision, "requirement_confirmation", "lgtm", { promptEventId: "p2", turnBoundaryEventId: "p2" }, "claude"),
      (error) => error.code === "HUMAN_GATE_PROVENANCE_UNAVAILABLE",
    );
    assert.equal((await store.readState(root, "f")).revision, state.revision);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("a turn-boundary earlier than the gate presentation is rejected", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "dev-flow-gate-dual-early-"));
  try {
    await store.initProject(root, config);
    let state = await store.startFeature(root, { featureId: "f", host: "claude", level: "M", topology: "local", execution: "standard", requirements: "missing-or-unclear" });
    state = await artifacts.scaffoldArtifact(root, "f", state.revision, "requirements");
    await writeFile(path.join(root, ".dev-flow", "features", "f", "需求文档.md"), (await readFile(path.join(root, ".dev-flow", "features", "f", "需求文档.md"), "utf8")).replace(/^  grill_status: pending$/m, "  grill_status: complete"));
    state = await registerTraceFixture({ root, featureId: "f", state, kind: "requirements" });
    state = await (await loadSource("plugins/dev-flow/src/core/feature-check.ts")).recordStep(root, "f", state.revision, "requirements", {});
    await store.recordHostEvent(root, { eventId: "t0", type: "turn-boundary", host: "claude" });
    state = await gates.presentGate(root, "f", state.revision, "requirement_confirmation");
    await store.recordHostEvent(root, { eventId: "p3", type: "user-prompt", host: "claude", text: "lgtm" });
    await assert.rejects(
      () => gates.confirmGate(root, "f", state.revision, "requirement_confirmation", "lgtm", { promptEventId: "p3", turnBoundaryEventId: "t0" }, "claude"),
      (error) => error.code === "HUMAN_GATE_SAME_TURN",
    );
    assert.equal((await store.readState(root, "f")).revision, state.revision);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("a prompt text that does not match userReply is rejected", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "dev-flow-gate-dual-text-"));
  try {
    const state = await readyRequirementGate(root);
    await store.recordHostEvent(root, { eventId: "p4", type: "user-prompt", host: "claude", text: "改天再说" });
    await assert.rejects(
      () => gates.confirmGate(root, "f", state.revision, "requirement_confirmation", "lgtm", { promptEventId: "p4" }, "claude"),
      (error) => error.code === "HUMAN_GATE_REPLY_MISMATCH",
    );
    assert.equal((await store.readState(root, "f")).revision, state.revision);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("resolveGateToken validates dual event ids through the interaction path", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "dev-flow-gate-token-dual-"));
  try {
    let state = await readyRequirementGate(root);
    await store.recordHostEvent(root, { eventId: "p1", type: "user-prompt", host: "claude", text: "确认需求" });
    await store.recordHostEvent(root, { eventId: "t1", type: "turn-boundary", host: "claude" });
    state = await gates.resolveGateToken(root, "f", state.revision, state.gateInteraction.id, "确认需求", { promptEventId: "p1", turnBoundaryEventId: "t1" }, "claude");
    assert.equal(state.steps.requirement_confirmation.status, "satisfied");
    assert.equal(state.humanGates.requirement_confirmation.confirmation.source, "text-token");
    assert.equal(state.humanGates.requirement_confirmation.confirmation.promptEventId, "p1");
    assert.equal(state.humanGates.requirement_confirmation.confirmation.turnBoundaryEventId, "t1");
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("an event id consumed by another gate cannot be replayed", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "dev-flow-gate-replay-"));
  try {
    let state = await readyRequirementGate(root);
    // 另一门禁已确认并消费了 turn-boundary t1
    state = await store.mutate(root, "f", state.revision, "replay-other-gate", (draft) => {
      draft.humanGates.implementation_approval = {
        status: "confirmed",
        basisHash: "b".repeat(64),
        presentedAt: new Date().toISOString(),
        confirmation: { userReply: "批准实现", promptEventId: "p0", turnBoundaryEventId: "t1", host: "claude", confirmedAt: new Date().toISOString() },
      };
    });
    await store.recordHostEvent(root, { eventId: "p1", type: "user-prompt", host: "claude", text: "lgtm" });
    await store.recordHostEvent(root, { eventId: "t1", type: "turn-boundary", host: "claude" });
    await assert.rejects(
      () => gates.confirmGate(root, "f", state.revision, "requirement_confirmation", "lgtm", { promptEventId: "p1", turnBoundaryEventId: "t1" }, "claude"),
      (error) => error.code === "HUMAN_GATE_EVENT_CONSUMED" && /t1/.test(error.message),
    );
    assert.equal((await store.readState(root, "f")).revision, state.revision);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("resolveGateToken rejects an event id consumed by another gate", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "dev-flow-gate-replay-token-"));
  try {
    let state = await readyRequirementGate(root);
    const interactionId = state.gateInteraction.id;
    state = await store.mutate(root, "f", state.revision, "replay-token-other-gate", (draft) => {
      draft.humanGates.implementation_approval = {
        status: "confirmed",
        basisHash: "b".repeat(64),
        presentedAt: new Date().toISOString(),
        confirmation: { userReply: "批准实现", promptEventId: "p0", turnBoundaryEventId: "t1", host: "claude", confirmedAt: new Date().toISOString() },
      };
    });
    await store.recordHostEvent(root, { eventId: "p1", type: "user-prompt", host: "claude", text: "确认需求" });
    await store.recordHostEvent(root, { eventId: "t1", type: "turn-boundary", host: "claude" });
    await assert.rejects(
      () => gates.resolveGateToken(root, "f", state.revision, interactionId, "确认需求", { promptEventId: "p1", turnBoundaryEventId: "t1" }, "claude"),
      (error) => error.code === "HUMAN_GATE_EVENT_CONSUMED" && /t1/.test(error.message),
    );
    assert.equal((await store.readState(root, "f")).revision, state.revision);
  } finally { await rm(root, { recursive: true, force: true }); }
});
