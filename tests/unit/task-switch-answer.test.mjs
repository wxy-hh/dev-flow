import assert from "node:assert/strict";
import test from "node:test";
import { createTinyApp, strictProjectConfig } from "../helpers/fixture-repo.mjs";
import { loadSource } from "../helpers/load-source.mjs";

const store = await loadSource("plugins/dev-flow/src/core/state-store.ts");
const decisions = await loadSource("plugins/dev-flow/src/core/decision-interactions.ts");
const next = await loadSource("plugins/dev-flow/src/core/next.ts");

/** 旧任务 active 时开始新任务 → TASK_SWITCH_REQUIRED，旧任务被呈现 task-switch 交互。 */
async function startCollision(fixture) {
  await store.initProject(fixture.root, strictProjectConfig);
  await store.startFeature(fixture.root, { featureId: "old", host: "codex" });
  await assert.rejects(
    () => store.startFeature(fixture.root, { featureId: "new", objective: "新任务", host: "codex" }),
    (error) => error.code === "TASK_SWITCH_REQUIRED",
  );
  const old = await store.readState(fixture.root, "old");
  assert.equal(decisions.pendingDecisionForState(old).kind, "task-switch");
  return old;
}

/** 文本凭证的 later-turn 证明：呈现之后来自同一宿主的 user-prompt 事件。 */
async function replyPrompt(fixture, eventId, text) {
  await store.recordHostEvent(fixture.root, {
    eventId,
    type: "user-prompt",
    host: "claude",
    text,
    at: new Date().toISOString(),
  });
}

test("pause-old answer pauses the old feature, releases the active pointer, and unblocks the new start", async () => {
  const fixture = await createTinyApp();
  try {
    const old = await startCollision(fixture);
    await replyPrompt(fixture, "switch-reply-pause", "暂停当前任务后开始新任务");
    const result = await store.answer({
      root: fixture.root, featureId: "old", expectedRevision: old.revision, host: "claude",
      credential: { source: "text", userReply: "暂停当前任务后开始新任务" },
    });
    assert.equal(result.action, "pause-old");
    assert.equal(result.state.lifecycle, "paused");
    assert.equal(await store.readActive(fixture.root), undefined);
    assert.equal(decisions.pendingDecisionForState(result.state), undefined);
    const events = await store.readFeatureEvents(fixture.root, "old");
    const answered = events.find((event) => event.type === "task-switch-answered");
    assert.equal(answered.data.action, "pause-old");
    assert.equal(answered.data.targetFeatureId, "new");
    const started = await store.startFeature(fixture.root, { featureId: "new", objective: "新任务", host: "codex" });
    assert.equal(started.lifecycle, "active");
    assert.equal((await store.readActive(fixture.root)).featureId, "new");
  } finally {
    await fixture.dispose();
  }
});

test("return-old resolves the pending question and keeps the old feature active", async () => {
  const fixture = await createTinyApp();
  try {
    const old = await startCollision(fixture);
    await replyPrompt(fixture, "switch-reply-return", "返回当前任务");
    const result = await store.answer({
      root: fixture.root, featureId: "old", expectedRevision: old.revision, host: "claude",
      credential: { source: "text", userReply: "返回当前任务" },
    });
    assert.equal(result.action, "return-old");
    assert.equal(result.state.lifecycle, "active");
    assert.equal((await store.readActive(fixture.root)).featureId, "old");
    assert.equal(decisions.pendingDecisionForState(result.state), undefined);
    const action = await next.nextAction(fixture.root, "old");
    assert.equal(action.activity, "investigate");
  } finally {
    await fixture.dispose();
  }
});

test("finish-old resolves the pending question without changing lifecycle", async () => {
  const fixture = await createTinyApp();
  try {
    const old = await startCollision(fixture);
    await replyPrompt(fixture, "switch-reply-finish", "先完成当前任务");
    const result = await store.answer({
      root: fixture.root, featureId: "old", expectedRevision: old.revision, host: "claude",
      credential: { source: "text", userReply: "先完成当前任务" },
    });
    assert.equal(result.action, "finish-old");
    assert.equal(result.state.lifecycle, "active");
    assert.equal((await store.readActive(fixture.root)).featureId, "old");
    assert.equal(decisions.pendingDecisionForState(result.state), undefined);
  } finally {
    await fixture.dispose();
  }
});

test("elicitation credential answers a task-switch through the same entry", async () => {
  const fixture = await createTinyApp();
  try {
    const old = await startCollision(fixture);
    const result = await store.answer({
      root: fixture.root, featureId: "old", expectedRevision: old.revision, host: "claude",
      credential: { source: "elicitation", action: "pause-old" },
    });
    assert.equal(result.action, "pause-old");
    assert.equal(result.state.lifecycle, "paused");
    assert.equal(await store.readActive(fixture.root), undefined);
  } finally {
    await fixture.dispose();
  }
});

test("an unrecognized reply fails closed and consumes neither revision nor interaction", async () => {
  const fixture = await createTinyApp();
  try {
    const old = await startCollision(fixture);
    await replyPrompt(fixture, "switch-reply-garbage", "随便说说");
    await assert.rejects(
      () => store.answer({
        root: fixture.root, featureId: "old", expectedRevision: old.revision, host: "claude",
        credential: { source: "text", userReply: "随便说说" },
      }),
      (error) => error.code === "DECISION_REPLY_NOT_RECOGNIZED",
    );
    const after = await store.readState(fixture.root, "old");
    assert.equal(after.revision, old.revision);
    assert.equal(decisions.pendingDecisionForState(after).kind, "task-switch");
  } finally {
    await fixture.dispose();
  }
});
