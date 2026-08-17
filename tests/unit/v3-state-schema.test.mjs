import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { createTinyApp, strictProjectConfig } from "../helpers/fixture-repo.mjs";
import { loadSource } from "../helpers/load-source.mjs";

const store = await loadSource("plugins/dev-flow/src/core/state-store.ts");

test("new features are v5 states with lineage and independently tracked freshness", async () => {
  const fixture = await createTinyApp();
  try {
    await store.initProject(fixture.root, strictProjectConfig);
    const state = await store.startFeature(fixture.root, { featureId: "v3", objective: "更新行为", host: "codex" });
    assert.equal(state.schemaVersion, 6);
    assert.equal(state.workspace.baseHead.length, 40);
    assert.equal(state.workspace.reconciliationStatus, "current");
    assert.deepEqual(state.governance.authorizations, []);
    assert.deepEqual(state.evidenceFreshness, { review: "missing", verification: "missing", checkpoint: "missing", implementation: "current" });
  } finally {
    await fixture.dispose();
  }
});

test("pre-v4 state is hard-rejected without a runtime migration path", async () => {
  const fixture = await createTinyApp();
  try {
    await store.initProject(fixture.root, strictProjectConfig);
    await store.startFeature(fixture.root, { featureId: "legacy", host: "claude" });
    const file = path.join(fixture.root, ".dev-flow", "features", "legacy", "state.json");
    const current = JSON.parse(await readFile(file, "utf8"));
    current.schemaVersion = 2;
    await writeFile(file, JSON.stringify(current));
    await assert.rejects(() => store.readState(fixture.root, "legacy"), (error) => error.code === "UNSUPPORTED_FEATURE_SCHEMA");
  } finally {
    await fixture.dispose();
  }
});
