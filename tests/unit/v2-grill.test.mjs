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

test("requirements templates contain no grill control state", () => {
  const contents = templates.renderArtifactTemplate({ featureId: "f", route: "standard-m", requirementsState: "documented-unconfirmed" }, "requirements");
  assert.doesNotMatch(contents, /grill_status|grill_question_id|grill_response_hint|in_progress/);
});

test("grill decision rejects an unavailable code and accepts a complete option label", () => {
  const state = {
    interactions: {
      "i-1": {
        id: "i-1",
        kind: "grill",
        status: "pending",
        question: "如何处理需求边界？",
        options: [
          { id: "first", label: "保守处理", description: "保持当前边界。" },
          { id: "expand", label: "扩大范围", description: "纳入额外需求。" },
        ],
        recommendation: { optionId: "first", reason: "先保持改动边界稳定。" },
      },
    },
  };
  assert.throws(() => interactions.resolveTextInteraction(state, "i-1", "C", "codex", { promptEventId: "prompt" }), /DECISION_REPLY_NOT_RECOGNIZED/);
  const response = interactions.resolveTextInteraction(state, "i-1", "扩大范围", "codex", { promptEventId: "prompt" });
  assert.equal(response.action, "expand");
});

test("routed pending requirements can request grill directly and resolve interaction plus ledger together", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "dev-flow-grill-routed-"));
  try {
    await mkdir(path.join(root, "src"));
    await stateStore.initProject(root, {
      schemaVersion: 2,
      verification: { commands: [{ id: "unit", command: process.execPath, args: ["-e", "process.exit(0)"], cwd: ".", provides: ["targeted", "behavior", "integration", "full"] }] },
      enforcement: { mode: "strict", gitWriteRequiresLogicComplete: true, oneActiveFeature: true, requireExplicitHumanReply: true },
      governedRoots: ["src"],
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
      options: [
        { id: "answer", label: "保守处理", description: "保持当前边界。" },
        { id: "expand", label: "扩大范围", description: "纳入额外需求。" },
      ],
      recommendation: { optionId: "answer", reason: "改动范围更可控。" },
      host: "codex",
    });
    assert.equal(requested.state.decisionLedger.find((item) => item.id === "G-001").status, "open");
    const resolved = await grill.resolveGrillElicitation(root, state.featureId, requested.state.revision, requested.interactionId, "answer", undefined, "codex");
    assert.equal(resolved.state.decisionLedger.find((item) => item.id === "G-001").status, "resolved");
    assert.equal(resolved.state.interactions[requested.interactionId].status, "resolved");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("intake grill request reopens a previously resolved decision", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "dev-flow-grill-intake-reopen-"));
  try {
    await stateStore.initProject(root, {
      schemaVersion: 2,
      verification: { commands: [{ id: "unit", command: process.execPath, args: ["-e", "process.exit(0)"], cwd: ".", provides: ["targeted", "behavior", "integration", "full"] }] },
      enforcement: { mode: "strict", gitWriteRequiresLogicComplete: true, oneActiveFeature: true, requireExplicitHumanReply: true },
      governedRoots: ["src"],
    });
    let state = await stateStore.startFeature(root, { featureId: "grill-intake", host: "codex", objective: "intake" });
    const input = {
      questionId: "G-REOPEN",
      question: "再次确认",
      options: [
        { id: "yes", label: "确认", description: "按当前方案继续。" },
        { id: "no", label: "拒绝", description: "停止采用当前方案。" },
      ],
      recommendation: { optionId: "yes", reason: "当前方案已经完成前置澄清。" },
      host: "codex",
    };
    const first = await grill.requestGrillDecision(root, state.featureId, state.revision, input);
    const resolved = await grill.resolveGrillElicitation(root, state.featureId, first.state.revision, first.interactionId, "yes", undefined, "codex");
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
      schemaVersion: 2,
      verification: { commands: [{ id: "unit", command: process.execPath, args: ["-e", "process.exit(0)"], cwd: ".", provides: ["targeted", "behavior", "integration", "full"] }] },
      enforcement: { mode: "strict", gitWriteRequiresLogicComplete: true, oneActiveFeature: true, requireExplicitHumanReply: true },
      governedRoots: ["src"],
    });
    const state = await stateStore.startFeature(root, { featureId: "grill-intake-provenance", host: "codex", objective: "intake" });
    const input = {
      questionId: "G-PROVENANCE",
      question: "确认",
      options: [
        { id: "yes", label: "确认", description: "按当前方案继续。" },
        { id: "no", label: "拒绝", description: "停止采用当前方案。" },
      ],
      recommendation: { optionId: "yes", reason: "当前方案已经完成前置澄清。" },
      host: "codex",
    };
    const requested = await grill.requestGrillDecision(root, state.featureId, state.revision, input);
    const at = new Date(Date.now() + 1000).toISOString();
    await stateStore.recordHostEvent(root, { eventId: "prompt-wrong-host", type: "user-prompt", host: "claude", text: "确认", at });
    await assert.rejects(
      () => grill.resolveGrillAnswer(root, state.featureId, requested.state.revision, requested.interactionId, "确认", "codex"),
      (error) => error.code === "HOST_EVENT_HOST_MISMATCH",
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
