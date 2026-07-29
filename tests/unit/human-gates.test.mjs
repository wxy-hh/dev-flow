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
    assert.match(state.gateReplyHint, /^确认需求: DF-/);
    assert.equal(state.gateInteraction.options[0].label, "确认需求");
    const presented = (await store.readFeatureEvents(root, "f")).at(-1);
    assert.equal(presented.type, "gate-presented");
    assert.match(presented.data.replyHint, /^确认需求: DF-/);

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
