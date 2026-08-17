import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { loadSource } from "../helpers/load-source.mjs";
import { createTinyApp, strictProjectConfig } from "../helpers/fixture-repo.mjs";

const archive = await loadSource("plugins/dev-flow/src/core/state-archive.ts");
const evidenceStore = await loadSource("plugins/dev-flow/src/core/evidence-store.ts");
const stateStore = await loadSource("plugins/dev-flow/src/core/state-store.ts");

test("archiveLargeStateCollections freezes unbounded state collections as logical refs without mutating state", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "dev-flow-v6-archive-"));
  try {
    await mkdir(path.join(root, ".dev-flow", "features", "f"), { recursive: true });
    const state = {
      featureId: "f",
      workspace: { ownership: { "src/a.ts": "feature" }, observedPathFingerprints: { "src/a.ts": "a".repeat(64) } },
      interactions: {
        i1: { id: "i1", status: "pending", kind: "route-confirmation", target: "t", basisHash: "b".repeat(64), options: [] },
        i2: { id: "i2", status: "resolved", kind: "route-confirmation", target: "t", basisHash: "b".repeat(64), options: [] },
      },
      governance: { decisions: [{ recordId: "DEC-1", kind: "decision", question: "q", conclusion: "c" }], claims: [], authorizations: [], credentials: [], repositoryFacts: [] },
      verification: { attempts: [{ id: 1, commandIds: ["unit"] }] },
      repair: { status: "completed", attempts: [{ id: 2, outcome: "ok" }], maxAttempts: 3 },
    };
    const archived = await archive.archiveLargeStateCollections(root, state);
    assert.ok(archived.workspaceLineage);
    assert.ok(archived.interactionLedger);
    assert.ok(archived.governanceLedger);
    assert.ok(archived.verificationLedger);
    assert.ok(archived.repairLedger);
    const workspace = JSON.parse((await evidenceStore.readEvidenceObject(root, "f", archived.workspaceLineage)).toString("utf8"));
    assert.equal(workspace.ownership["src/a.ts"], "feature");
    const interactions = JSON.parse((await evidenceStore.readEvidenceObject(root, "f", archived.interactionLedger)).toString("utf8"));
    assert.deepEqual(Object.keys(interactions), ["i2"]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("mutation persists v6 pointer state and readState hydrates the full in-memory shape", async () => {
  const fixture = await createTinyApp();
  try {
    await stateStore.initProject(fixture.root, strictProjectConfig);
    const routed = await stateStore.startFeature(fixture.root, { featureId: "feature", host: "claude", level: "XS", topology: "local" });
    const raw = JSON.parse(await readFile(path.join(fixture.root, ".dev-flow", "features", "feature", "state.json"), "utf8"));
    assert.equal(raw.schemaVersion, 6);
    assert.equal(raw.workspace, undefined);
    assert.equal(raw.governance, undefined);
    assert.equal(raw.verification.attempts, undefined);
    assert.ok(raw.archivedCollections.workspaceLineage);
    assert.ok(raw.archivedCollections.governanceLedger);

    const hydrated = await stateStore.readState(fixture.root, "feature");
    assert.equal(hydrated.schemaVersion, 6);
    assert.equal(hydrated.revision, routed.revision);
    assert.equal(hydrated.featureId, "feature");
    assert.deepEqual(hydrated.workspace.ownership, routed.workspace.ownership);
    assert.deepEqual(hydrated.governance, routed.governance);
    assert.deepEqual(hydrated.verification.attempts, []);
    assert.equal(hydrated.mode, "routed");
  } finally { await fixture.dispose(); }
});

test("persisted v6 state stays under the 512 KiB budget with 10k owned paths and large histories", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "dev-flow-v6-budget-"));
  try {
    await mkdir(path.join(root, ".dev-flow", "features", "f"), { recursive: true });
    const ownership = {};
    for (let i = 0; i < 10_000; i += 1) ownership[`src/module-${i}/index.ts`] = "feature";
    const resolvedInteractions = {};
    for (let i = 0; i < 200; i += 1) {
      const id = `i-${i}`;
      resolvedInteractions[id] = { id, kind: "route-confirmation", target: "route", basisHash: "0".repeat(64), options: [{ id: "confirm", label: "确认" }], status: "resolved", presentedAt: "2026-08-17T00:00:00.000Z", presentedRevision: 1, response: { action: "confirm", source: "text", host: "claude", respondedAt: "2026-08-17T00:00:01.000Z" } };
    }
    const state = {
      schemaVersion: 6,
      featureId: "f",
      workspace: {
        baseHead: "a".repeat(40),
        baseBranch: "main",
        observedHead: "a".repeat(40),
        lastWorkspaceFingerprint: "b".repeat(64),
        reconciliationStatus: "current",
        ownership,
        observedPathFingerprints: ownership,
        observedCommits: [],
        startedDirty: {},
        ownershipSource: {},
      },
      interactions: resolvedInteractions,
      governance: { decisions: [], claims: [], authorizations: [], credentials: [], repositoryFacts: [] },
      verification: { attempts: Array.from({ length: 100 }, (_, i) => ({ id: i + 1, commandIds: ["unit-ok"], status: "passed", output: `output-${i}` })) },
      repair: { status: "completed", maxAttempts: 3, attempts: Array.from({ length: 50 }, (_, i) => ({ id: i + 1, outcome: "ok", note: `attempt-${i}` })) },
    };
    const persisted = await archive.persistableFeatureState(root, state);
    const stateFile = path.join(root, ".dev-flow", "features", "f", "state.json");
    await stateStore.writeAtomic(stateFile, persisted);
    const bytes = await readFile(stateFile);
    assert.ok(bytes.length < 512 * 1024, `state.json ${bytes.length}B exceeds the 512KiB budget`);

    const hydrated = await archive.hydrateFeatureState(root, JSON.parse(bytes.toString("utf8")));
    assert.equal(Object.keys(hydrated.workspace.ownership).length, 10_000);
    assert.equal(Object.values(hydrated.interactions).filter((item) => item.status === "resolved").length, 200);
    assert.equal(hydrated.verification.attempts.length, 100);
    assert.equal(hydrated.repair.attempts.length, 50);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("hydrateFeatureState fail-closes on a structurally invalid workspace archive", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "dev-flow-v6-hydrate-"));
  try {
    await mkdir(path.join(root, ".dev-flow", "features", "f"), { recursive: true });
    const stored = await evidenceStore.putEvidenceObject(root, "f", "workspace-lineage", Buffer.from("{}\n"));
    await assert.rejects(
      () => archive.hydrateFeatureState(root, {
        schemaVersion: 6,
        featureId: "f",
        archivedCollections: {
          schemaVersion: 1,
          featureId: "f",
          workspaceLineage: stored.ref,
          pointer: stored.pointer,
        },
      }),
      (error) => error instanceof TypeError && /workspace lineage/.test(error.message),
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
