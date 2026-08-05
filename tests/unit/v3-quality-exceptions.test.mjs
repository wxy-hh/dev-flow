import assert from "node:assert/strict";
import test from "node:test";
import { createTinyApp, strictProjectConfig } from "../helpers/fixture-repo.mjs";
import { loadSource } from "../helpers/load-source.mjs";

const store = await loadSource("plugins/dev-flow/src/core/state-store.ts");
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
