import assert from "node:assert/strict";
import test from "node:test";
import { createTinyApp, strictProjectConfig } from "../helpers/fixture-repo.mjs";
import { loadSource } from "../helpers/load-source.mjs";

const store = await loadSource("plugins/dev-flow/src/core/state-store.ts");
const projection = await loadSource("plugins/dev-flow/src/core/status-projection.ts");

test("compact status keeps user content short and control data separate", async () => {
  const fixture = await createTinyApp();
  try {
    await store.initProject(fixture.root, strictProjectConfig);
    const state = await store.startFeature(fixture.root, { featureId: "status", objective: "查看状态", host: "claude" });
    const view = await projection.readCompactStatus(fixture.root, state.featureId);
    const content = JSON.stringify(view.contentView);
    const structured = JSON.stringify(view.structuredContentView);
    assert.ok(content.length <= 800);
    assert.ok(structured.length <= 4096);
    for (const forbidden of ["DF-", "promptEventId", "interactionId", "basisHash", "expectedRevision", "requirements_alignment"]) {
      assert.doesNotMatch(content, new RegExp(forbidden));
    }
    assert.equal(view.structuredContentView.control.featureId, "status");
    assert.equal(view.structuredContentView.control.expectedRevision, state.revision);
  } finally {
    await fixture.dispose();
  }
});
