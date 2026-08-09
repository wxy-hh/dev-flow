import assert from "node:assert/strict";
import test from "node:test";
import { createTinyApp, strictProjectConfig } from "../helpers/fixture-repo.mjs";
import { loadSource } from "../helpers/load-source.mjs";

const store = await loadSource("plugins/dev-flow/src/core/state-store.ts");
const decisions = await loadSource("plugins/dev-flow/src/core/decision-interactions.ts");
const quality = await loadSource("plugins/dev-flow/src/core/quality-exceptions.ts");

test("quality exception requires one later host answer and records accepted risk", async () => {
  const fixture = await createTinyApp();
  try {
    await store.initProject(fixture.root, strictProjectConfig);
    const started = await store.startFeature(fixture.root, { featureId: "quality", host: "codex" });
    const presented = await quality.presentQualityException(fixture.root, "quality", started.revision, {
      kind: "verification",
      basisHash: "a".repeat(64),
      fingerprint: "b".repeat(64),
      riskSummary: "验证证据需要用户明确接受。",
    });
    await store.recordHostEvent(fixture.root, { eventId: "quality-answer", type: "user-prompt", host: "codex", text: "接受风险：我已了解验证风险", at: new Date(Date.now() + 1000).toISOString() });
    const accepted = await quality.resolveQualityExceptionAnswer(fixture.root, "quality", presented.state.revision, presented.interactionId, "接受风险：我已了解验证风险", "codex");
    assert.equal(accepted.qualityExceptions.length, 1);
    assert.equal(accepted.qualityExceptions[0].status, "current");
  } finally {
    await fixture.dispose();
  }
});

test("elicitation accept records the risk with the form comment and resolves the decision", async () => {
  const fixture = await createTinyApp();
  try {
    await store.initProject(fixture.root, strictProjectConfig);
    const started = await store.startFeature(fixture.root, { featureId: "quality", host: "codex" });
    const presented = await quality.presentQualityException(fixture.root, "quality", started.revision, {
      kind: "verification",
      basisHash: "a".repeat(64),
      fingerprint: "b".repeat(64),
      riskSummary: "验证证据需要用户明确接受。",
    });
    const accepted = await quality.resolveQualityExceptionElicitation(fixture.root, "quality", presented.state.revision, presented.interactionId, "accept", "已了解验证风险", "codex");
    assert.equal(accepted.qualityExceptions.length, 1);
    assert.equal(accepted.qualityExceptions[0].status, "current");
    assert.equal(accepted.qualityExceptions[0].userEvidence, "已了解验证风险");
    assert.equal(accepted.pendingDecision, undefined);
    assert.equal(Object.values(accepted.interactions)[0].status, "resolved");
  } finally {
    await fixture.dispose();
  }
});

test("elicitation accept without the required comment is rejected and stays pending", async () => {
  const fixture = await createTinyApp();
  try {
    await store.initProject(fixture.root, strictProjectConfig);
    const started = await store.startFeature(fixture.root, { featureId: "quality", host: "codex" });
    const presented = await quality.presentQualityException(fixture.root, "quality", started.revision, {
      kind: "verification",
      basisHash: "a".repeat(64),
      fingerprint: "b".repeat(64),
      riskSummary: "验证证据需要用户明确接受。",
    });
    await assert.rejects(
      () => quality.resolveQualityExceptionElicitation(fixture.root, "quality", presented.state.revision, presented.interactionId, "accept", undefined, "codex"),
      (error) => error.code === "INTERACTION_COMMENT_REQUIRED",
    );
    const state = await store.readState(fixture.root, "quality");
    assert.equal(decisions.pendingDecisionForState(state).kind, "quality-exception");
    assert.equal(Object.values(state.interactions)[0].status, "pending");
  } finally {
    await fixture.dispose();
  }
});

test("elicitation decline resolves the interaction without recording acceptance", async () => {
  const fixture = await createTinyApp();
  try {
    await store.initProject(fixture.root, strictProjectConfig);
    const started = await store.startFeature(fixture.root, { featureId: "quality", host: "codex" });
    const presented = await quality.presentQualityException(fixture.root, "quality", started.revision, {
      kind: "verification",
      basisHash: "a".repeat(64),
      fingerprint: "b".repeat(64),
      riskSummary: "验证证据需要用户明确接受。",
    });
    const declined = await quality.resolveQualityExceptionElicitation(fixture.root, "quality", presented.state.revision, presented.interactionId, "decline", undefined, "codex");
    assert.equal(declined.qualityExceptions.length, 0);
    assert.equal(declined.pendingDecision, undefined);
    assert.equal(Object.values(declined.interactions)[0].status, "resolved");
    assert.equal(Object.values(declined.interactions)[0].response.action, "decline");
  } finally {
    await fixture.dispose();
  }
});

test("elicitation with an unknown option id is rejected", async () => {
  const fixture = await createTinyApp();
  try {
    await store.initProject(fixture.root, strictProjectConfig);
    const started = await store.startFeature(fixture.root, { featureId: "quality", host: "codex" });
    const presented = await quality.presentQualityException(fixture.root, "quality", started.revision, {
      kind: "verification",
      basisHash: "a".repeat(64),
      fingerprint: "b".repeat(64),
      riskSummary: "验证证据需要用户明确接受。",
    });
    await assert.rejects(
      () => quality.resolveQualityExceptionElicitation(fixture.root, "quality", presented.state.revision, presented.interactionId, "maybe", undefined, "codex"),
      (error) => error.code === "INTERACTION_ACTION_INVALID",
    );
  } finally {
    await fixture.dispose();
  }
});
