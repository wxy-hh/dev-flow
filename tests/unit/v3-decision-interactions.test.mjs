import assert from "node:assert/strict";
import test from "node:test";
import { loadSource } from "../helpers/load-source.mjs";

const interactions = await loadSource("plugins/dev-flow/src/core/user-interactions.ts");

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
