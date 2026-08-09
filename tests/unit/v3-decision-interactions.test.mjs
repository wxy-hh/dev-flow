import assert from "node:assert/strict";
import test from "node:test";
import { loadSource } from "../helpers/load-source.mjs";

const interactions = await loadSource("plugins/dev-flow/src/core/user-interactions.ts");
const decisions = await loadSource("plugins/dev-flow/src/core/decision-interactions.ts");

test("new interactions keep one pending truth and derive the legacy decision projection on read", () => {
  const state = { revision: 7, interactions: {} };
  const created = interactions.createInteraction(state, {
    kind: "approval",
    target: "approval:single-truth",
    basisHash: "c".repeat(64),
    question: "是否开始执行？",
    options: [{ id: "confirm", label: "确认开始执行" }, { id: "request-changes", label: "提出修改意见" }],
  });
  assert.equal(state.pendingDecision, undefined);
  assert.equal(Object.values(state.interactions).filter((item) => item.status === "pending").length, 1);
  assert.deepEqual(decisions.pendingDecisionForState(state), {
    kind: "approval",
    question: "是否开始执行？",
    options: [
      { id: "confirm", label: "确认开始执行", recommended: true },
      { id: "request-changes", label: "提出修改意见", recommended: false },
    ],
    basisHash: "c".repeat(64),
    presentedAt: created.presentedAt,
    presentedRevision: 7,
    source: "core",
    target: "approval:single-truth",
    presentationEventId: created.presentationEventId,
  });
});

test("a pending interaction wins over a drifted legacy pendingDecision copy", () => {
  const state = {
    revision: 9,
    interactions: {},
    pendingDecision: {
      kind: "approval",
      question: "过期副本",
      options: [{ id: "confirm", label: "错误选项" }],
      basisHash: "0".repeat(64),
      presentedAt: "2026-01-01T00:00:00.000Z",
      presentedRevision: 1,
      source: "core",
    },
  };
  const interaction = interactions.createInteraction(state, {
    kind: "approval",
    target: "approval:authoritative",
    basisHash: "d".repeat(64),
    question: "是否按当前依据执行？",
    options: [{ id: "confirm", label: "确认开始执行" }, { id: "request-changes", label: "提出修改意见" }],
  });
  const projected = decisions.pendingDecisionForState(state);
  assert.equal(projected.question, "是否按当前依据执行？");
  assert.equal(projected.basisHash, "d".repeat(64));
  assert.equal(projected.presentedRevision, interaction.presentedRevision);
});

test("public decisions expose Chinese options without internal ids or fallback tokens", () => {
  const state = { interactions: {} };
  const created = interactions.createInteraction(state, {
    kind: "approval",
    target: "approval:internal",
    basisHash: "a".repeat(64),
    question: "是否开始执行？",
    options: [{ id: "confirm", label: "确认开始执行" }, { id: "request-changes", label: "提出修改意见", requiresComment: true }],
  });
  const view = interactions.toPublicInteraction(created);
  assert.equal(view.id, undefined);
  assert.equal(view.fallback, undefined);
  assert.doesNotMatch(JSON.stringify(view), /DF-|promptEventId|basisHash/);
});

test("conditional approval text cannot be mistaken for exact approval", () => {
  const state = { interactions: {} };
  const created = interactions.createInteraction(state, {
    kind: "approval",
    target: "approval:internal",
    basisHash: "b".repeat(64),
    question: "是否开始执行？",
    options: [{ id: "confirm", label: "确认开始执行" }, { id: "request-changes", label: "提出修改意见", requiresComment: true }],
  });
  assert.throws(() => interactions.resolveTextInteraction(state, created.id, "如果测试通过就执行", "claude", { promptEventId: "event" }), /DECISION_REPLY_NOT_RECOGNIZED/);
});

test("a unique semantic shorthand resolves the same option without asking again", () => {
  const state = { revision: 0, interactions: {} };
  const created = interactions.createInteraction(state, {
    kind: "workspace-ownership",
    target: "workspace-ownership:batch",
    basisHash: "e".repeat(64),
    question: "这些路径如何归属？",
    options: [
      { id: "adopt-all", label: "全部纳入当前任务" },
      { id: "exclude-all", label: "全部排除并先处理" },
      { id: "one-by-one", label: "逐个确认" },
    ],
  });
  const response = interactions.resolveTextInteraction(
    state,
    created.id,
    "全部纳入",
    "codex",
    { promptEventId: "semantic-answer" },
  );
  assert.equal(response.action, "adopt-all");
  assert.equal(created.status, "resolved");
});

test("common ownership paraphrases resolve only when they identify one option", () => {
  for (const [reply, action] of [
    ["这些都算当前任务的", "adopt-all"],
    ["都先排除", "exclude-all"],
    ["一个个来", "one-by-one"],
  ]) {
    const state = { revision: 0, interactions: {} };
    const created = interactions.createInteraction(state, {
      kind: "workspace-ownership",
      target: `workspace-ownership:${action}`,
      basisHash: "f".repeat(64),
      options: [
        { id: "adopt-all", label: "全部纳入当前任务" },
        { id: "exclude-all", label: "全部排除并先处理" },
        { id: "one-by-one", label: "逐个确认" },
      ],
    });
    assert.equal(interactions.resolveTextInteraction(state, created.id, reply, "codex", {}).action, action);
  }
});

test("ambiguous fragments do not choose an option for the user", () => {
  const state = { revision: 0, interactions: {} };
  const created = interactions.createInteraction(state, {
    kind: "grill",
    target: "grill:ambiguous",
    basisHash: "a".repeat(64),
    options: [
      { id: "first", label: "接受第一项方案" },
      { id: "second", label: "接受第二项方案" },
    ],
  });
  assert.throws(
    () => interactions.resolveTextInteraction(state, created.id, "接受", "codex", {}),
    /DECISION_REPLY_NOT_RECOGNIZED/,
  );
  assert.equal(created.status, "pending");
});
