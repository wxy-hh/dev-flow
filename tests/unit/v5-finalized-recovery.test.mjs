import assert from "node:assert/strict";
import { rm, writeFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { createTinyApp, strictProjectConfig } from "../helpers/fixture-repo.mjs";
import { loadSource } from "../helpers/load-source.mjs";

const store = await loadSource("plugins/dev-flow/src/core/state-store.ts");
const next = await loadSource("plugins/dev-flow/src/core/next.ts");

test("real drift revokes a finalized claim and atomically restores the active pointer", async () => {
  const fixture = await createTinyApp();
  try {
    await store.initProject(fixture.root, strictProjectConfig);
    let state = await store.startFeature(fixture.root, { featureId: "final-drift", host: "codex", level: "XS", topology: "local" });
    state = await store.mutate(fixture.root, state.featureId, state.revision, "test-finalized", (draft) => {
      for (const step of Object.keys(draft.steps)) draft.steps[step] = { status: "satisfied" };
      draft.verification = { attempts: [{ id: 1 }], satisfiedByAttemptId: 1, verifiedFingerprint: draft.businessFingerprint };
      draft.deliverySnapshot = { test: true };
      draft.lifecycle = "finalized";
      draft.logicComplete = true;
      draft.currentStage = "complete";
    });
    assert.equal(await store.readActive(fixture.root), undefined);
    await writeFile(path.join(fixture.root, "src", "counter.js"), "export const count = 9;\n");
    state = await store.reconcileWorkspace(fixture.root, state.featureId, state.revision, "codex");
    assert.equal(state.lifecycle, "active");
    assert.equal(state.logicComplete, false);
    assert.equal(state.deliverySnapshot, undefined);
    assert.equal(state.currentStage, "verification");
    assert.equal((await store.readActive(fixture.root)).featureId, state.featureId);
    assert.equal((await next.nextAction(fixture.root, state.featureId)).kind, "run-step");
  } finally {
    await fixture.dispose();
  }
});

test("repair reconstructs a missing active pointer without rewriting primary evidence", async () => {
  const fixture = await createTinyApp();
  try {
    await store.initProject(fixture.root, strictProjectConfig);
    const state = await store.startFeature(fixture.root, { featureId: "repair-pointer", host: "claude", level: "XS", topology: "local" });
    const beforeLedger = structuredClone(state.decisionLedger);
    await rm(path.join(fixture.root, ".dev-flow", "active.json"));
    const repaired = await store.repairFeature(fixture.root, state.featureId, state.revision, "claude");
    assert.equal((await store.readActive(fixture.root)).revision, repaired.revision);
    assert.deepEqual(repaired.decisionLedger, beforeLedger);
    assert.equal(repaired.currentStage, "locate");
  } finally {
    await fixture.dispose();
  }
});

test("repair rebuilds checkpoint freshness from immutable checkpoint and reconciliation events", async () => {
  const fixture = await createTinyApp();
  try {
    await store.initProject(fixture.root, strictProjectConfig);
    let state = await store.startFeature(fixture.root, { featureId: "repair-freshness", host: "codex", level: "XS", topology: "local" });
    state = await store.mutate(fixture.root, state.featureId, state.revision, "automatic-checkpoint-captured", (draft) => {
      draft.checkpoints = [{ checkpointId: "AUTO-aaaaaaaaaa", stage: "implementation", capturedAt: new Date().toISOString(), fingerprint: "a".repeat(64), files: ["src/counter.js"], basisHash: "b".repeat(64) }];
      draft.evidenceFreshness.checkpoint = "current";
    });
    await writeFile(path.join(fixture.root, "src", "counter.js"), "export const count = 10;\n");
    state = await store.reconcileWorkspace(fixture.root, state.featureId, state.revision, "codex");
    assert.equal(state.evidenceFreshness.checkpoint, "stale");
    state = await store.mutate(fixture.root, state.featureId, state.revision, "test-corrupt-derived-freshness", (draft) => {
      draft.evidenceFreshness.checkpoint = "current";
    });
    const repaired = await store.repairFeature(fixture.root, state.featureId, state.revision, "codex");
    assert.equal(repaired.evidenceFreshness.checkpoint, "stale");
  } finally {
    await fixture.dispose();
  }
});
