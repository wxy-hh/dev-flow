// v6 evidence maintenance tests. Phase 8 keeps the bounded GC seam explicit
// until every root-producing contract has migrated to evidence refs.
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { loadSource } from "../helpers/load-source.mjs";
import { createTinyApp, strictProjectConfig } from "../helpers/fixture-repo.mjs";

const maintenance = await loadSource("plugins/dev-flow/src/core/evidence-maintenance.ts");
const evidenceStore = await loadSource("plugins/dev-flow/src/core/evidence-store.ts");
const segments = await loadSource("plugins/dev-flow/src/core/event-segments.ts");
const stateStore = await loadSource("plugins/dev-flow/src/core/state-store.ts");
const hostRecovery = await loadSource("plugins/dev-flow/src/core/host-recovery.ts");

async function featureRoot() {
  const root = await mkdtemp(path.join(os.tmpdir(), "dev-flow-v6-maintenance-"));
  await mkdir(path.join(root, ".dev-flow", "features", "f"), { recursive: true });
  return root;
}

test("evidenceRootSet protects archive pointers, governance baselines and pending proposals", async () => {
  const root = await featureRoot();
  try {
    const archiveRef = (await evidenceStore.putEvidenceObject(root, "f", "workspace-lineage", "workspace")).ref;
    const baselineRef = (await evidenceStore.putEvidenceObject(root, "f", "evidence-baseline", "baseline")).ref;
    const proposalRef = (await evidenceStore.putEvidenceObject(root, "f", "trace", "proposal")).ref;
    const state = {
      featureId: "f",
      archivedCollections: {
        schemaVersion: 1,
        featureId: "f",
        pointer: { catalogSha256: "0".repeat(64), objectCount: 0, packCount: 0 },
        workspaceLineage: archiveRef,
      },
      governance: {
        authorizations: [{ recordId: "AUTH-1", kind: "authorization", authorizationType: "risk-acceptance", target: "risk", baselineRef }],
      },
      interactions: {
        pending: { id: "pending", kind: "plan-revision", target: "plan", basisHash: "0".repeat(64), options: [], status: "pending", planRevisionProposal: proposalRef },
      },
    };
    const roots = maintenance.evidenceRootSet(state);
    assert.equal(roots.length, 3);
    assert.deepEqual(new Set(roots.map((ref) => ref.sha256)), new Set([archiveRef.sha256, baselineRef.sha256, proposalRef.sha256]));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("runBoundedEvidenceMaintenance deletes unreachable packs without reading cold payloads", async () => {
  const root = await featureRoot();
  try {
    const keep = await evidenceStore.putEvidenceObject(root, "f", "workspace-lineage", "keep");
    const orphan = await evidenceStore.putEvidenceObject(root, "f", "event-segment", "orphan");
    const state = {
      featureId: "f",
      archivedCollections: {
        schemaVersion: 1,
        featureId: "f",
        pointer: keep.pointer,
        workspaceLineage: keep.ref,
      },
    };
    const result = await maintenance.runBoundedEvidenceMaintenance(root, "f", state, { packBudget: 1 });
    assert.equal(result.roots, 1);
    assert.equal(result.deletedPacks, 1);
    assert.deepEqual(await evidenceStore.readEvidenceObject(root, "f", keep.ref), Buffer.from("keep"));
    await assert.rejects(evidenceStore.readEvidenceObject(root, "f", orphan.ref), /EVIDENCE_STORE_INTEGRITY_FAILED/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("runBoundedEvidenceMaintenance protects sealed event-segment index roots", async () => {
  const root = await featureRoot();
  try {
    const hot = path.join(root, ".dev-flow", "features", "f", "events.jsonl");
    await writeFile(hot, `${JSON.stringify({ revision: 1, type: "started", at: new Date().toISOString(), data: {} })}\n`);
    await segments.sealFeatureEvents(root, "f");
    const orphan = await evidenceStore.putEvidenceObject(root, "f", "event-segment", "orphan");
    const segmentRoot = (await segments.eventSegmentRootRefs(root, "f"))[0];
    assert.ok(segmentRoot);
    const result = await maintenance.runBoundedEvidenceMaintenance(root, "f", { featureId: "f" }, { packBudget: 1 });
    assert.equal(result.deletedPacks, 1);
    const segmentBytes = await evidenceStore.readEvidenceObject(root, "f", segmentRoot);
    const parsedSegment = JSON.parse(segmentBytes.toString("utf8"));
    assert.equal(parsedSegment.schemaVersion, 1);
    assert.equal(parsedSegment.records[0].eventSequence, 1);
    await assert.rejects(evidenceStore.readEvidenceObject(root, "f", orphan.ref), /EVIDENCE_STORE_INTEGRITY_FAILED/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("a successful feature mutation runs one bounded evidence GC round", async () => {
  const fixture = await createTinyApp();
  try {
    await stateStore.initProject(fixture.root, strictProjectConfig);
    const state = await stateStore.startFeature(fixture.root, { featureId: "feature", host: "claude", level: "XS", topology: "local" });
    const orphan = await evidenceStore.putEvidenceObject(fixture.root, "feature", "event-segment", "mutation-gc-orphan");
    const next = await stateStore.mutate(fixture.root, "feature", state.revision, "evidence-maintenance-probe", (draft) => { draft.objective = "maintained"; });
    assert.equal(next.objective, "maintained");
    await assert.rejects(evidenceStore.readEvidenceObject(fixture.root, "feature", orphan.ref), /EVIDENCE_STORE_INTEGRITY_FAILED/);
  } finally { await fixture.dispose(); }
});

test("SessionStart runs bounded evidence maintenance without advancing revision", async () => {
  const fixture = await createTinyApp();
  try {
    await stateStore.initProject(fixture.root, strictProjectConfig);
    const state = await stateStore.startFeature(fixture.root, { featureId: "feature", host: "claude", level: "XS", topology: "local" });
    const orphan = await evidenceStore.putEvidenceObject(fixture.root, "feature", "event-segment", "session-gc-orphan");
    await hostRecovery.observeHostRecovery(fixture.root, { host: "claude", kind: "session-start", eventId: "session-maintenance", at: new Date().toISOString() });
    await assert.rejects(evidenceStore.readEvidenceObject(fixture.root, "feature", orphan.ref), /EVIDENCE_STORE_INTEGRITY_FAILED/);
    assert.equal((await stateStore.readState(fixture.root, "feature")).revision, state.revision);
  } finally { await fixture.dispose(); }
});
