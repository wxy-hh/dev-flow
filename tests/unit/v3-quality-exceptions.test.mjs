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
    const accepted = await store.answer({
      root: fixture.root, featureId: "quality", expectedRevision: presented.state.revision, host: "codex",
      credential: { source: "text", userReply: "接受风险：我已了解验证风险" },
    });
    assert.equal(accepted.state.governance.authorizations.length, 1);
    assert.equal(accepted.state.governance.authorizations[0].authorizationType, "risk-acceptance");
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
    const accepted = await store.answer({
      root: fixture.root, featureId: "quality", expectedRevision: presented.state.revision, host: "codex",
      credential: { source: "elicitation", action: "accept", comment: "已了解验证风险" },
    });
    assert.equal(accepted.state.governance.authorizations.length, 1);
    assert.equal(accepted.state.governance.authorizations[0].target, "verification");
    assert.equal(accepted.state.governance.credentials[0].rawText, "已了解验证风险");
    assert.equal(Object.values(accepted.state.interactions)[0].status, "resolved");
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
      () => store.answer({
        root: fixture.root, featureId: "quality", expectedRevision: presented.state.revision, host: "codex",
        credential: { source: "elicitation", action: "accept" },
      }),
      (error) => error.code === "INTERACTION_COMMENT_REQUIRED",
    );
    const state = await store.readState(fixture.root, "quality");
    assert.equal(state.revision, presented.state.revision, "失败不得推进 revision");
    assert.equal(Object.values(state.interactions)[0].kind, "quality-exception");
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
    const declined = await store.answer({
      root: fixture.root, featureId: "quality", expectedRevision: presented.state.revision, host: "codex",
      credential: { source: "elicitation", action: "decline" },
    });
    assert.equal(declined.state.governance.authorizations.length, 0);
    assert.equal(Object.values(declined.state.interactions)[0].status, "resolved");
    assert.equal(Object.values(declined.state.interactions)[0].response.action, "decline");
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
      () => store.answer({
        root: fixture.root, featureId: "quality", expectedRevision: presented.state.revision, host: "codex",
        credential: { source: "elicitation", action: "maybe" },
      }),
      (error) => error.code === "INTERACTION_ACTION_INVALID",
    );
  } finally {
    await fixture.dispose();
  }
});
