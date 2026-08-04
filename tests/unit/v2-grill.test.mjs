import assert from "node:assert/strict";
import test from "node:test";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { loadSource } from "../helpers/load-source.mjs";

const templates = await loadSource("plugins/dev-flow/src/core/artifact-templates.ts");
const grill = await loadSource("plugins/dev-flow/src/core/requirements-grill.ts");
const interactions = await loadSource("plugins/dev-flow/src/core/user-interactions.ts");
const stateStore = await loadSource("plugins/dev-flow/src/core/state-store.ts");
const artifacts = await loadSource("plugins/dev-flow/src/core/artifacts.ts");

test("new requirements templates use pending without a second question state", () => {
  const contents = templates.renderArtifactTemplate({ featureId: "f", route: "standard-m", requirementsState: "documented-unconfirmed" }, "requirements");
  assert.match(contents, /grill_status: pending/);
  assert.doesNotMatch(contents, /grill_question_id|grill_response_hint|in_progress/);
  assert.deepEqual(grill.parseGrillFrontMatter(contents), { status: "pending" });
});

test("legacy in_progress requirements remain parseable", () => {
  const contents = "---\ndev_flow:\n  grill_status: in_progress\n  grill_question_id: G-001\n  grill_response_hint: \"等待用户回答\"\n---\n";
  assert.deepEqual(grill.parseGrillFrontMatter(contents), {
    status: "in_progress",
    questionId: "G-001",
    responseHint: "等待用户回答",
  });
});

test("merge-remaining requires semantic id or complete label, not a letter, number, or recommendation", () => {
  const state = {
    interactions: {
      "i-1": {
        id: "i-1",
        kind: "grill",
        status: "pending",
        fallbackToken: "token",
        options: [
          { id: "first", label: "保守处理" },
          { id: "merge-remaining", label: "合并剩余（剩余问题按推荐答案一次确认）" },
        ],
      },
    },
  };
  assert.throws(() => interactions.resolveTokenInteraction(state, "i-1", "C", "codex", "prompt"), /INTERACTION_TOKEN_MISMATCH/);
  const response = interactions.resolveTokenInteraction(state, "i-1", "合并剩余（剩余问题按推荐答案一次确认）", "codex", "prompt");
  assert.equal(response.action, "merge-remaining");
});

test("routed pending requirements can request grill directly and resolve interaction plus ledger together", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "dev-flow-grill-routed-"));
  try {
    await mkdir(path.join(root, "src"));
    await stateStore.initProject(root, {
      schemaVersion: 1,
      verification: { commands: [{ id: "unit", command: process.execPath, args: ["-e", "process.exit(0)"], cwd: "." }], behaviorCommands: [] },
      enforcement: { mode: "strict", gitWriteRequiresLogicComplete: true, oneActiveFeature: true, requireExplicitHumanReply: true },
      protectedRoots: ["src"],
    });
    let state = await stateStore.startFeature(root, {
      featureId: "grill-routed",
      host: "codex",
      level: "M",
      topology: "shared-contract",
      execution: "standard",
      requirements: "documented-unconfirmed",
      scopeFacts: ["scope"],
      topologyFacts: ["topology"],
      uncertaintyFacts: ["unknown"],
      riskFacts: {},
      decisionRefs: [],
    });
    state = await artifacts.scaffoldArtifact(root, state.featureId, state.revision, "requirements");
    const registered = await artifacts.recordArtifactWithTrace(root, state.featureId, state.revision, "requirements", {
      nodes: [
        { kind: "requirement", id: "REQ-001" },
        { kind: "acceptance-criterion", id: "AC-001", parentRequirement: "REQ-001" },
      ],
    });
    state = registered.state;
    const requested = await grill.requestGrillDecision(root, state.featureId, state.revision, {
      questionId: "G-001",
      question: "选择需求边界",
      options: [{ id: "answer", label: "保守处理" }, { id: "other", label: "扩大范围" }],
      host: "codex",
    });
    assert.equal(requested.state.decisionLedger.find((item) => item.id === "G-001").status, "open");
    const resolved = await grill.resolveGrillElicitation(root, state.featureId, requested.state.revision, requested.interaction.id, "answer", undefined, "codex");
    assert.equal(resolved.state.decisionLedger.find((item) => item.id === "G-001").status, "resolved");
    assert.equal(resolved.state.interactions[requested.interaction.id].status, "resolved");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("intake grill request reopens a previously resolved decision", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "dev-flow-grill-intake-reopen-"));
  try {
    await stateStore.initProject(root, {
      schemaVersion: 1,
      verification: { commands: [{ id: "unit", command: process.execPath, args: ["-e", "process.exit(0)"], cwd: "." }], behaviorCommands: [] },
      enforcement: { mode: "strict", gitWriteRequiresLogicComplete: true, oneActiveFeature: true, requireExplicitHumanReply: true },
      protectedRoots: ["src"],
    });
    let state = await stateStore.startFeature(root, { featureId: "grill-intake", host: "codex", objective: "intake" });
    const input = { questionId: "G-REOPEN", question: "再次确认", options: [{ id: "yes", label: "确认" }, { id: "no", label: "拒绝" }], host: "codex" };
    const first = await grill.requestGrillDecision(root, state.featureId, state.revision, input);
    const resolved = await grill.resolveGrillElicitation(root, state.featureId, first.state.revision, first.interaction.id, "yes", undefined, "codex");
    const second = await grill.requestGrillDecision(root, state.featureId, resolved.state.revision, input);
    state = second.state;
    assert.equal(state.decisionLedger.find((item) => item.id === "G-REOPEN").status, "open");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("intake grill token requires a matching host user-prompt event", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "dev-flow-grill-intake-provenance-"));
  try {
    await stateStore.initProject(root, {
      schemaVersion: 1,
      verification: { commands: [{ id: "unit", command: process.execPath, args: ["-e", "process.exit(0)"], cwd: "." }], behaviorCommands: [] },
      enforcement: { mode: "strict", gitWriteRequiresLogicComplete: true, oneActiveFeature: true, requireExplicitHumanReply: true },
      protectedRoots: ["src"],
    });
    const state = await stateStore.startFeature(root, { featureId: "grill-intake-provenance", host: "codex", objective: "intake" });
    const input = { questionId: "G-PROVENANCE", question: "确认", options: [{ id: "yes", label: "确认" }, { id: "no", label: "拒绝" }], host: "codex" };
    const requested = await grill.requestGrillDecision(root, state.featureId, state.revision, input);
    const at = new Date(Date.now() + 1000).toISOString();
    await stateStore.recordHostEvent(root, { eventId: "prompt-wrong-host", type: "user-prompt", host: "claude", text: "确认", at });
    await assert.rejects(
      () => grill.resolveGrillToken(root, state.featureId, requested.state.revision, requested.interaction.id, "确认", "prompt-wrong-host", "codex"),
      (error) => error.code === "HOST_EVENT_HOST_MISMATCH",
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
