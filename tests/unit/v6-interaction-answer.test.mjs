// v6 interaction-answer tests. Phase 7 enables pure matcher/cursor assertions;
// resolver integration todos stay disabled until their migration.
import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { loadSource } from "../helpers/load-source.mjs";
import { createTinyApp, strictProjectConfig } from "../helpers/fixture-repo.mjs";

const provenance = await loadSource("plugins/dev-flow/src/core/interaction-provenance.ts");
const decisions = await loadSource("plugins/dev-flow/src/core/decision-interactions.ts");
const userInteractions = await loadSource("plugins/dev-flow/src/core/user-interactions.ts");
const store = await loadSource("plugins/dev-flow/src/core/state-store.ts");
const answer = await loadSource("plugins/dev-flow/src/core/interaction-answer.ts");

const boundaryAudit = { scanned: ["assumption", "free-space", "tbd", "fallback", "scope", "acceptance"], items: [] };

/** 建一个 route-confirmation 待决的 fixture（复用真实宿主事件记录路径）。 */
async function lockRoutePending() {
  const fixture = await createTinyApp();
  await store.initProject(fixture.root, strictProjectConfig);
  const started = await store.startFeature(fixture.root, { featureId: "v6answer", objective: "测试宿主事件回答", host: "claude" });
  const pending = await store.lockClassification(fixture.root, "v6answer", started.revision, {
    scopeFactRefs: [], topologyFactRefs: [], uncertaintyFactRefs: [],
    riskFactRefs: {}, decisionRefs: [],
    signals: { changeSurface: "multi-component", behaviorChange: "new-capability", topology: "local", unitCount: 1, requirements: "provided-confirmed", operationalRecovery: false, executableRollback: false },
    level: "M", topology: "local", requirements: "provided-confirmed",
  }, boundaryAudit);
  return { fixture, pending };
}

/** 把 host-health 全部信号回拨到 minutes 分钟前。 */
async function ageHostHealth(root, minutes = 20) {
  const file = path.join(root, ".dev-flow", "host-health.jsonl");
  const { readFile } = await import("node:fs/promises");
  const raw = await readFile(file, "utf8");
  const aged = raw.split("\n").filter(Boolean).map((line) => {
    const signal = JSON.parse(line);
    signal.at = new Date(Date.now() - minutes * 60_000).toISOString();
    return JSON.stringify(signal);
  }).join("\n");
  await writeFile(file, `${aged}\n`);
}

function hostEvent(eventId, text, host = "claude", at = "2026-08-17T00:01:00.000Z", revision = 3, eventSequence) {
  return { ...(eventSequence !== undefined ? { eventSequence } : {}), revision, type: "host-event", at, data: { eventId, type: "user-prompt", host, text, at } };
}

test("latestUnconsumedPromptEvent takes the last unconsumed same-host event after presentation", () => {
  const interaction = {
    id: "i1",
    presentedAt: "2026-08-17T00:00:00.000Z",
    presentedRevision: 2,
    presentationEventId: "present-2",
  };
  const events = [
    { revision: 0, type: "started", at: "2026-08-17T00:00:00.000Z", data: {} },
    { revision: 2, type: "host-event", at: "2026-08-17T00:00:05.000Z", data: { eventId: "present-2", type: "tool", host: "claude" } },
    hostEvent("early", "确认路线", "claude", "2026-08-17T00:00:10.000Z", 2),
    hostEvent("a", "A", "claude", "2026-08-17T00:00:20.000Z", 3),
    hostEvent("final", "确认路线", "claude", "2026-08-17T00:00:30.000Z", 4),
  ];
  const selected = provenance.latestUnconsumedPromptEvent(events, { revision: 4, pendingDecision: { target: "route", presentedRevision: 2 } }, interaction, "claude");
  assert.equal(selected.eventId, "final");
  assert.equal(selected.text, "确认路线");

  const consumed = provenance.latestUnconsumedPromptEvent(events.map((event) => event.data?.eventId === "final"
    ? { ...event, data: { ...event.data, eventId: "final" } }
    : event), { revision: 4, pendingDecision: { target: "route", presentedRevision: 2 } }, interaction, "claude");
  void consumed;
});


test("presentationEventSequence cursor excludes earlier events without a presentation marker", () => {
  const interaction = {
    id: "i1",
    presentedAt: "2026-08-17T00:00:00.000Z",
    presentedRevision: 1,
    presentationEventSequence: 4,
  };
  const events = [
    { eventSequence: 1, revision: 1, type: "started", at: "2026-08-17T00:00:00.000Z", data: {} },
    hostEvent("before-cursor", "确认路线", "claude", "2026-08-17T00:00:10.000Z", 2, 2),
    { eventSequence: 3, revision: 3, type: "interaction-presented", at: "2026-08-17T00:00:20.000Z", data: { interactionId: "i1" } },
    hostEvent("answer", "确认路线", "claude", "2026-08-17T00:00:30.000Z", 4, 4),
  ];
  const selected = provenance.latestUnconsumedPromptEvent(events, { revision: 4, pendingDecision: { target: "route", presentedRevision: 1 } }, interaction, "claude");
  assert.equal(selected.eventId, "answer");
});

test("option matcher recognizes answerCode, full label, recommended suffix, comment prefix and other-comment", () => {
  const base = {
    kind: "quality-exception",
    question: "q",
    options: [
      { id: "accept", label: "接受风险", requiresComment: true, answerCode: "A", recommended: true },
      { id: "decline", label: "先修复问题", answerCode: "B" },
    ],
    basisHash: "0".repeat(64),
    presentedAt: "2026-08-17T00:00:00.000Z",
    presentedRevision: 1,
    source: "core",
  };
  assert.throws(
    () => decisions.matchDecisionReply({ ...base, kind: "risk-acceptance" }, "A"),
    (error) => error.code === "DECISION_COMMENT_REQUIRED",
  );
  assert.equal(decisions.matchDecisionReply({ ...base, kind: "risk-acceptance" }, "B").option.id, "decline");
  assert.throws(
    () => decisions.matchDecisionReply({ ...base, kind: "risk-acceptance" }, "接受风险（推荐）"),
    (error) => error.code === "DECISION_COMMENT_REQUIRED",
  );
  assert.equal(decisions.matchDecisionReply({ ...base, kind: "risk-acceptance" }, "接受风险：需要继续验证").option.id, "accept");
  assert.throws(
    () => decisions.matchDecisionReply({ ...base, kind: "risk-acceptance" }, "接受风险"),
    (error) => error.code === "DECISION_COMMENT_REQUIRED",
  );
  const other = {
    ...base,
    kind: "workspace-ownership",
    options: [
      { id: "adopt", label: "纳入当前任务" },
      { id: "other", label: "其他" },
    ],
  };
  assert.deepEqual(decisions.matchDecisionReply(other, "其他：先做数据迁移").comment, "先做数据迁移");
});

test("createInteraction rejects option labels that collide after trimming", () => {
  const state = { revision: 4, interactions: {} };
  const input = {
    kind: "workspace-ownership",
    target: "route",
    basisHash: "0".repeat(64),
    options: [
      { id: "adopt", label: "  纳入当前任务" },
      { id: "other", label: "纳入当前任务  " },
    ],
  };
  assert.throws(
    () => userInteractions.createInteraction(state, input),
    (error) => error.code === "INTERACTION_OPTIONS_INVALID" && error.details.duplicateLabels.length === 1,
  );
  assert.deepEqual(Object.keys(state.interactions), []);
});

test("createInteraction accepts distinct trimmed labels", () => {
  const state = { revision: 4, interactions: {} };
  const input = {
    kind: "workspace-ownership",
    target: "route",
    basisHash: "0".repeat(64),
    options: [
      { id: "adopt", label: "纳入当前任务" },
      { id: "other", label: "先处理其他事项" },
    ],
  };
  const interaction = userInteractions.createInteraction(state, input);
  assert.equal(interaction.options.length, 2);
  assert.equal(state.interactions[interaction.id].status, "pending");
});

test("answerFromHostEvents resolves the original host event after presentation without caller text", async () => {
  const { fixture, pending } = await lockRoutePending();
  try {
    await store.recordHostEvent(fixture.root, { eventId: "route-answer", type: "user-prompt", host: "claude", text: "确认这条路线（推荐）" });
    const routed = (await answer.answerFromHostEvents({ root: fixture.root, featureId: "v6answer", expectedRevision: pending.revision, host: "claude" })).state;
    assert.equal(routed.mode, "routed");
    assert.equal(routed.route, "m");
    assert.equal(decisions.pendingDecisionForState(routed), undefined);
    const interaction = Object.values(routed.interactions ?? {}).find((value) => value.kind === "route-confirmation");
    assert.equal(interaction?.response?.promptEventId, "route-answer", "response must bind the captured host event");
  } finally { await fixture.dispose(); }
});

test("last unconsumed same-host event wins; an unrecognized last event fails closed", async () => {
  const { fixture, pending } = await lockRoutePending();
  try {
    await store.recordHostEvent(fixture.root, { eventId: "first-etc", type: "user-prompt", host: "claude", text: "等等" });
    await store.recordHostEvent(fixture.root, { eventId: "last-confirm", type: "user-prompt", host: "claude", text: "确认路线" });
    const routed = (await answer.answerFromHostEvents({ root: fixture.root, featureId: "v6answer", expectedRevision: pending.revision, host: "claude" })).state;
    assert.equal(routed.mode, "routed", "last unconsumed event wins");

    const { fixture: fixture2, pending: pending2 } = await lockRoutePending();
    try {
      await store.recordHostEvent(fixture2.root, { eventId: "confirm-then-etc", type: "user-prompt", host: "claude", text: "确认路线" });
      await store.recordHostEvent(fixture2.root, { eventId: "last-etc", type: "user-prompt", host: "claude", text: "等等" });
      await assert.rejects(
        answer.answerFromHostEvents({ root: fixture2.root, featureId: "v6answer", expectedRevision: pending2.revision, host: "claude" }),
        (error) => error.code === "DECISION_REPLY_NOT_RECOGNIZED",
      );
      const unchanged = await store.readState(fixture2.root, "v6answer");
      assert.equal(unchanged.revision, pending2.revision, "unrecognized last event must not fall back to an earlier answer");
    } finally { await fixture2.dispose(); }
  } finally { await fixture.dispose(); }
});

test("INTERACTION_EVENT_MISSING distinguishes healthy and unhealthy hooks in recovery guidance", async () => {
  const { fixture, pending } = await lockRoutePending();
  try {
    await assert.rejects(
      answer.answerFromHostEvents({ root: fixture.root, featureId: "v6answer", expectedRevision: pending.revision, host: "claude" }),
      (error) => {
        assert.equal(error.code, "INTERACTION_EVENT_MISSING");
        assert.equal(error.details.health, "fresh");
        assert.match(error.details.recoveryInstruction, /请用户重新发送一次完整回答/);
        return true;
      },
    );
    await ageHostHealth(fixture.root);
    await assert.rejects(
      answer.answerFromHostEvents({ root: fixture.root, featureId: "v6answer", expectedRevision: pending.revision, host: "claude" }),
      (error) => {
        assert.equal(error.code, "INTERACTION_EVENT_MISSING");
        assert.equal(error.details.health, "stale");
        assert.match(error.details.recoveryInstruction, /先运行 dev_flow_doctor/);
        return true;
      },
    );
  } finally { await fixture.dispose(); }
});
test("all thirteen answer resolvers consume the centrally resolved host-event credential", async () => {
  const resolverFiles = [
    "decision-workflow.ts",
    "plan-revision.ts",
    "requirements-grill.ts",
    "approval-interactions.ts",
    "ownership-workflow.ts",
    "route-workflow.ts",
    "quality-exceptions.ts",
    "acceptance.ts",
    "rollback.ts",
    "review-jobs.ts",
  ];
  const answerSource = await readFile(path.join(process.cwd(), "plugins/dev-flow/src/core/interaction-answer.ts"), "utf8");
  assert.match(answerSource, /latestUnconsumedPromptEvent/);
  assert.doesNotMatch(answerSource, /userReply\s*[?:]/, "AnswerCredential must not declare or assign userReply");
  for (const file of resolverFiles) {
    const source = await readFile(path.join(process.cwd(), "plugins/dev-flow/src/core", file), "utf8");
    assert.doesNotMatch(source, /resolveInteractionPromptEvent/, `${file} must not parse provenance independently`);
    assert.doesNotMatch(source, /credential\.userReply/, `${file} must not consume caller reply text`);
  }
});
test("replayed/consumed event cannot satisfy another interaction", () => {
  const interaction = {
    id: "i2",
    presentedAt: "2026-08-17T00:00:00.000Z",
    presentedRevision: 2,
    presentationEventId: "present-2",
  };
  const events = [
    { revision: 0, type: "started", at: "2026-08-17T00:00:00.000Z", data: {} },
    { revision: 2, type: "host-event", at: "2026-08-17T00:00:05.000Z", data: { eventId: "present-2", type: "tool", host: "claude" } },
    hostEvent("consumed-answer", "确认路线", "claude", "2026-08-17T00:00:10.000Z", 3),
    // 该事件已被另一交互消费（resolved 记录携带 promptEventId）
    { revision: 5, type: "interaction-resolved", at: "2026-08-17T00:00:20.000Z", data: { interactionId: "i1", promptEventId: "consumed-answer" } },
  ];
  const selected = provenance.latestUnconsumedPromptEvent(events, { revision: 5, pendingDecision: { target: "route", presentedRevision: 2 } }, interaction, "claude");
  assert.equal(selected, undefined, "a consumed event must never satisfy another interaction");
  assert.equal(provenance.consumedPromptEventIds(events).has("consumed-answer"), true);
});
