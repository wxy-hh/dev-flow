import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { loadSource } from "../helpers/load-source.mjs";

const store = await loadSource("plugins/dev-flow/src/core/state-store.ts");
const decisions = await loadSource("plugins/dev-flow/src/core/decision-interactions.ts");
const provenance = await loadSource("plugins/dev-flow/src/core/interaction-provenance.ts");

const config = {
  schemaVersion: 2,
  verification: { commands: [{ id: "unit", command: process.execPath, args: ["-e", "process.exit(0)"], cwd: ".", provides: ["targeted", "behavior", "integration", "full"] }] },
  enforcement: { mode: "strict", gitWriteRequiresLogicComplete: true, oneActiveFeature: true, requireExplicitHumanReply: true },
  governedRoots: ["src"],
};

async function setup(prefix) {
  const root = await mkdtemp(path.join(os.tmpdir(), prefix));
  await mkdir(path.join(root, "src"));
  await store.initProject(root, config);
  const started = await store.startFeature(root, { featureId: "f", host: "codex" });
  return { root, state: started };
}

test("earlier chat text never becomes the current decision without a fresh trusted answer", async () => {
  const { root, state } = await setup("dev-flow-ratify-");
  try {
    // 历史消息里出现过相同文字（呈现之前的事件）：
    await store.recordHostEvent(root, { eventId: "old-answer", type: "user-prompt", host: "codex", text: "保留兼容行为" });
    const presented = await store.recordDecision(root, "f", state.revision, "是否保留兼容行为？", "历史兼容测试仍存在", "保留兼容行为", ["fact-1"], "codex");
    // 呈现后未落账：历史文字不能直接创建当前决定。
    assert.equal(presented.state.governance.decisions.length, 0);
    assert.equal(presented.state.governance.decisions.length, 0);
    assert.equal(decisions.pendingDecisionForState(presented.state).kind, "decision-ratification");

    // 呈现之前的事件不能完成追认。
    await assert.rejects(
      () => store.answer({ root, featureId: "f", expectedRevision: presented.state.revision, host: "codex", credential: { source: "text", userReply: "保留兼容行为" } }),
      (error) => error.code === "INTERACTION_PROVENANCE_UNAVAILABLE" || error.code === "DECISION_REPLY_NOT_RECOGNIZED",
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("a short confirmation after presentation ratifies; rejection leaves the decision state unchanged", async () => {
  const { root, state } = await setup("dev-flow-ratify-confirm-");
  try {
    const presented = await store.recordDecision(root, "f", state.revision, "是否保留兼容行为？", "历史兼容测试仍存在", "保留兼容行为", ["fact-1"], "codex");
    await store.recordHostEvent(root, { eventId: "ratify-ok", type: "user-prompt", host: "codex", text: "确认登记" });
    const ratified = await store.answer({ root, featureId: "f", expectedRevision: presented.state.revision, host: "codex", credential: { source: "text", userReply: "确认登记" } });
    assert.equal(ratified.state.governance.decisions.length, 1);
    assert.equal(ratified.state.governance.decisions[0].conclusion, "保留兼容行为");
    // 决策与凭证绑定同一可信事件。
    assert.equal(ratified.state.governance.decisions[0].basis.eventId, "ratify-ok");
    assert.equal(ratified.state.governance.decisions[0].credentialId, ratified.state.governance.credentials[0].recordId);

    // 新 feature：拒绝路径不改变决定状态。
    const root2 = await mkdtemp(path.join(os.tmpdir(), "dev-flow-ratify-reject-"));
    try {
      await mkdir(path.join(root2, "src"));
      await store.initProject(root2, config);
      const started = await store.startFeature(root2, { featureId: "g", host: "codex" });
      const p2 = await store.recordDecision(root2, "g", started.revision, "是否升级依赖？", "讨论中表示不升级", "不升级", [], "codex");
      await store.recordHostEvent(root2, { eventId: "ratify-no", type: "user-prompt", host: "codex", text: "不要登记" });
      const rejected = await store.answer({ root: root2, featureId: "g", expectedRevision: p2.state.revision, host: "codex", credential: { source: "text", userReply: "不要登记" } });
      assert.equal(rejected.state.governance.decisions.length, 0);
      assert.equal(rejected.state.governance.decisions.length, 0);
      assert.equal(decisions.pendingDecisionForState(rejected.state), undefined);
    } finally {
      await rm(root2, { recursive: true, force: true });
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("native form confirmation ratifies the decision and records a native credential", async () => {
  const { root, state } = await setup("dev-flow-ratify-native-");
  try {
    const presented = await store.recordDecision(root, "f", state.revision, "是否保留兼容行为？", "历史兼容测试仍存在", "保留兼容行为", [], "codex");
    const ratified = await store.answer({ root, featureId: "f", expectedRevision: presented.state.revision, host: "codex", credential: { source: "elicitation", action: "confirm" } });

    assert.equal(ratified.state.governance.decisions.length, 1);
    assert.equal(ratified.state.governance.decisions[0].conclusion, "保留兼容行为");
    assert.equal(ratified.state.governance.credentials.length, 1);
    assert.equal(ratified.state.governance.credentials[0].source, "native-form");
    assert.equal(ratified.state.governance.credentials[0].optionId, "confirm");
    assert.equal(ratified.state.governance.decisions[0].credentialId, ratified.state.governance.credentials[0].recordId);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("cross-host answers and replayed answers cannot ratify", async () => {
  const { root, state } = await setup("dev-flow-ratify-host-");
  try {
    const presented = await store.recordDecision(root, "f", state.revision, "是否保留兼容行为？", "历史兼容测试仍存在", "保留兼容行为", [], "codex");
    // 跨宿主回答被拒绝
    await store.recordHostEvent(root, { eventId: "other-host", type: "user-prompt", host: "claude", text: "确认登记" });
    await assert.rejects(
      () => store.answer({ root, featureId: "f", expectedRevision: presented.state.revision, host: "codex", credential: { source: "text", userReply: "确认登记" } }),
      (error) => error.code === "HOST_EVENT_HOST_MISMATCH",
    );
    const unchanged = await store.readState(root, "f");
    assert.equal(unchanged.governance.decisions.length, 0);
    assert.equal(decisions.pendingDecisionForState(unchanged).kind, "decision-ratification");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("replayed identical answers are ambiguous and cannot ratify", async () => {
  const { root, state } = await setup("dev-flow-ratify-replay-");
  try {
    const presented = await store.recordDecision(root, "f", state.revision, "是否保留兼容行为？", "历史兼容测试仍存在", "保留兼容行为", [], "codex");
    // 重放：同文本两个事件 → 歧义，不改变状态
    await store.recordHostEvent(root, { eventId: "ratify-1", type: "user-prompt", host: "codex", text: "确认登记" });
    await store.recordHostEvent(root, { eventId: "ratify-2", type: "user-prompt", host: "codex", text: "确认登记" });
    await assert.rejects(
      () => store.answer({ root, featureId: "f", expectedRevision: presented.state.revision, host: "codex", credential: { source: "text", userReply: "确认登记" } }),
      (error) => error.code === "INTERACTION_PROVENANCE_AMBIGUOUS",
    );
    const unchanged = await store.readState(root, "f");
    assert.equal(unchanged.governance.decisions.length, 0);
    assert.equal(decisions.pendingDecisionForState(unchanged).kind, "decision-ratification");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("native form answer ratifies even when the displayed question is reformulated and the agent passes a paraphrase", async () => {
  const { root, state } = await setup("dev-flow-ratify-reform-");
  try {
    // 展示问题被 agent 精简/改写（不再是交互问题的前缀），且 agent 按
    //「选中即信任」转述 userReply：结构化事件仍应以事件内容归属落账。
    const presented = await store.recordDecision(root, "f", state.revision, "本任务的交付物范围是什么？", "本任务交付物仅为实施计划文档（不写 Rust 代码、不改生产代码）", "仅产出计划", [], "codex");
    await store.recordHostEvent(root, {
      eventId: "ratify-reform", type: "user-prompt", host: "codex",
      text: "确认登记", question: "将“仅产出计划”登记为当前决定吗？",
    });
    const ratified = await store.answer({ root, featureId: "f", expectedRevision: presented.state.revision, host: "codex", credential: { source: "text", userReply: "就按这个登记" } });
    assert.equal(ratified.state.governance.decisions.length, 1);
    assert.equal(ratified.state.governance.decisions[0].conclusion, "仅产出计划");
    assert.equal(ratified.state.governance.decisions[0].basis.eventId, "ratify-reform");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("whole-sentence match on the latest unconsumed prompt auto-ratifies without an interaction", async () => {
  const { root, state } = await setup("dev-flow-auto-ratify-exact-");
  try {
    await store.recordHostEvent(root, { eventId: "scope-yes", type: "user-prompt", host: "codex", text: "全部解决一下" });
    const recorded = await store.recordDecision(root, "f", state.revision, "范围是什么？", "全部解决一下", "覆盖审查全部问题", [], "codex");
    assert.equal(recorded.interaction, undefined);
    assert.equal(recorded.ratifiedFrom, "scope-yes");
    assert.equal(recorded.state.governance.decisions.length, 1);
    assert.equal(recorded.state.governance.decisions[0].conclusion, "覆盖审查全部问题");
    assert.equal(recorded.state.governance.decisions[0].basis.eventId, "scope-yes");
    assert.equal(recorded.state.governance.credentials[0].basis.eventId, "scope-yes");
    assert.match(recorded.state.governance.credentials[0].recordId, /^CRED-auto-ratify-/);
    const events = await store.readFeatureEvents(root, "f");
    assert.equal(provenance.consumedPromptEventIds(events).has("scope-yes"), true);
    assert.equal(decisions.pendingDecisionForState(recorded.state), undefined);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("prefix or fragment evidence still presents a ratification interaction", async () => {
  const { root, state } = await setup("dev-flow-auto-ratify-fragment-");
  try {
    await store.recordHostEvent(root, { eventId: "full", type: "user-prompt", host: "codex", text: "全部解决一下，另外补测试" });
    const presented = await store.recordDecision(root, "f", state.revision, "范围是什么？", "全部解决一下", "覆盖全部问题", [], "codex");
    assert.equal(decisions.pendingDecisionForState(presented.state).kind, "decision-ratification");
    assert.ok(presented.interaction);
    assert.equal(presented.state.governance.decisions.length, 0);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("an older matching prompt is ignored when the latest unconsumed message differs", async () => {
  const { root, state } = await setup("dev-flow-auto-ratify-stale-");
  try {
    await store.recordHostEvent(root, { eventId: "old", type: "user-prompt", host: "codex", text: "全部解决一下" });
    await store.recordHostEvent(root, { eventId: "new", type: "user-prompt", host: "codex", text: "继续" });
    const presented = await store.recordDecision(root, "f", state.revision, "范围是什么？", "全部解决一下", "覆盖全部问题", [], "codex");
    assert.equal(decisions.pendingDecisionForState(presented.state).kind, "decision-ratification");
    assert.equal(presented.state.governance.decisions.length, 0);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("no unconsumed prompt still presents a ratification interaction", async () => {
  const { root, state } = await setup("dev-flow-auto-ratify-none-");
  try {
    const presented = await store.recordDecision(root, "f", state.revision, "范围是什么？", "全部解决一下", "覆盖全部问题", [], "codex");
    assert.equal(decisions.pendingDecisionForState(presented.state).kind, "decision-ratification");
    assert.ok(presented.interactionId);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("a pending interaction blocks auto-ratify and does not consume the matching prompt", async () => {
  const { root, state } = await setup("dev-flow-auto-ratify-pending-");
  try {
    const first = await store.recordDecision(root, "f", state.revision, "是否保留兼容？", "历史兼容测试仍存在", "保留兼容行为", [], "codex");
    await store.recordHostEvent(root, { eventId: "confirm-now", type: "user-prompt", host: "codex", text: "确认" });
    await assert.rejects(
      () => store.recordDecision(root, "f", first.state.revision, "范围是什么？", "确认", "覆盖全部问题", [], "codex"),
      (error) => error.code === "MULTIPLE_PENDING_DECISIONS",
    );
    const events = await store.readFeatureEvents(root, "f");
    assert.equal(provenance.consumedPromptEventIds(events).has("confirm-now"), false);
    assert.equal(decisions.pendingDecisionForState(await store.readState(root, "f")).kind, "decision-ratification");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
