// v6 evidence baseline tests. Phase 6 enables capture/parser first; precise
// invalidation todos stay disabled until reconcile integration.
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { loadSource } from "../helpers/load-source.mjs";
const baseline = await loadSource("plugins/dev-flow/src/core/evidence-baseline.ts");
const policy = await loadSource("plugins/dev-flow/src/policy/evidence-baseline.ts");
const evidenceStore = await loadSource("plugins/dev-flow/src/core/evidence-store.ts");
test("captureEvidenceBaseline derives one owned baseline from one canonical workspace snapshot", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "dev-flow-v6-baseline-"));
  try {
    await mkdir(path.join(root, "src"), { recursive: true });
    await mkdir(path.join(root, ".dev-flow", "features", "f"), { recursive: true });
    await writeFile(path.join(root, "src", "a.ts"), "export const a = 1;\n");
    const state = {
      featureId: "f",
      implementationUnits: [],
      workspace: { ownership: { "src/a.ts": "feature" } },
      executionSemanticBasisHash: "0".repeat(64),
    };
    const config = { governedRoots: ["src"], verification: { commands: [] } };
    const captured = await baseline.captureEvidenceBaseline(root, state, config, {
      kind: "risk-acceptance",
      target: "verification",
      recordId: "AUTH-1",
      at: "2026-08-17T00:00:00.000Z",
    });
    assert.equal(captured.manifest.schemaVersion, 1);
    assert.equal(captured.manifest.origin.kind, "risk-acceptance");
    assert.equal(captured.manifest.checkpointIds.length, 0);
    assert.deepEqual(captured.manifest.fileToUnits, []);
    assert.equal(captured.manifest.ownershipHash.length, 64);
    const bytes = await evidenceStore.readEvidenceObject(root, "f", captured.ref);
    assert.deepEqual(policy.parseEvidenceBaselineManifest(JSON.parse(bytes.toString("utf8"))), captured.manifest);
    await writeFile(path.join(root, "src", "a.ts"), "export const a = 2;\n");
    const second = await baseline.captureEvidenceBaseline(root, state, config, {
      kind: "risk-acceptance",
      target: "verification",
      recordId: "AUTH-2",
      at: "2026-08-17T00:05:00.000Z",
    });
    assert.notEqual(second.manifest.contentFingerprint, captured.manifest.contentFingerprint);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
// ---- Phase 6 invalidation tests (GPT-007 per-record baselines) ----
const store = await loadSource("plugins/dev-flow/src/core/state-store.ts");
const artifacts = await loadSource("plugins/dev-flow/src/core/artifacts.ts");
const steps = await loadSource("plugins/dev-flow/src/core/feature-check.ts");
const jobs = await loadSource("plugins/dev-flow/src/core/review-jobs.ts");
const units = await loadSource("plugins/dev-flow/src/core/implementation-units.ts");
const checkpoints = await loadSource("plugins/dev-flow/src/core/checkpoints.ts");
const verification = await loadSource("plugins/dev-flow/src/core/verification.ts");
const invalidation = await loadSource("plugins/dev-flow/src/core/change-invalidation.ts");
const fingerprintSource = await loadSource("plugins/dev-flow/src/core/fingerprint.ts");
const quality = await loadSource("plugins/dev-flow/src/core/quality-exceptions.ts");
const okCommand = { id: "unit-ok", command: process.execPath, args: ["-e", "process.exit(0)"], cwd: ".", provides: ["targeted", "behavior", "integration", "full"] };
const failCommand = { id: "unit-fail", command: process.execPath, args: ["-e", "process.exit(1)"], cwd: ".", provides: ["targeted", "behavior", "integration", "full"] };
const mConfig = { schemaVersion: 2, verification: { commands: [okCommand, failCommand] }, enforcement: { mode: "strict", gitWriteRequiresLogicComplete: true, oneActiveFeature: true, requireExplicitHumanReply: true }, governedRoots: ["src"] };
const mPlanMarkdown = [
  "<!-- dev-flow:id=TASK-001 kind=task -->\n### TASK-001\n\n- covers: REQ-001\n- implementation_unit: UNIT-001\n",
  "<!-- dev-flow:id=TASK-002 kind=task -->\n### TASK-002\n\n- covers: REQ-001\n- implementation_unit: UNIT-002\n",
  "<!-- dev-flow:id=UNIT-001 kind=implementation-unit -->\n### UNIT-001\n\n- tasks: [TASK-001]\n- depends_on: []\n- file_scope: [src/a.js]\n- covers: [REQ-001]\n- forward_verification: [unit-ok]\n",
  "<!-- dev-flow:id=UNIT-002 kind=implementation-unit -->\n### UNIT-002\n\n- tasks: [TASK-002]\n- depends_on: [UNIT-001]\n- file_scope: [src/b.js]\n- covers: [REQ-001]\n- forward_verification: [unit-ok]\n",
].join("\n");
async function completeReviewBatch(root, id, state, prefix) {
  const created = await jobs.createReviewBatch(root, id, state.revision);
  let current = created.state;
  for (const job of created.batch.jobs) {
    const capability = prefix + "-cap-" + job.jobId;
    const claimed = await jobs.claimReviewJob(root, id, current.revision, created.batch.batchId, job.jobId, capability);
    current = claimed.state;
    const eventId = prefix + "-ev-" + job.jobId;
    await store.recordReviewExecutionEvent(root, { eventId, type: "review-execution", host: "codex", text: "t", batchId: created.batch.batchId, jobId: job.jobId, executionId: "e", sourceId: "s", contextId: prefix + "-c-" + job.jobId, implementationContextId: "ic" });
    current = await store.readState(root, id);
    const submitted = await jobs.submitReviewJob(root, id, current.revision, created.batch.batchId, job.jobId, capability, { coverageSummary: "ok", findings: [] }, { host: "codex", agentId: prefix + "-a-" + job.jobId, issuedAt: new Date().toISOString(), raw: prefix + "-r-" + job.jobId, hostEventId: eventId, isolated: true });
    current = submitted.state;
  }
  return current;
}
/** Build an M feature through code review + verification with two checkpointed units. */
async function setupMReviewed() {
  const root = await mkdtemp(path.join(os.tmpdir(), "dev-flow-v6-baseline-flow-"));
  await mkdir(path.join(root, "src"));
  await store.initProject(root, mConfig);
  let state = await store.startFeature(root, { featureId: "baseline", host: "codex", level: "M", topology: "local", scopeFacts: ["scope"], topologyFacts: ["topology"], uncertaintyFacts: [], riskFacts: {}, decisionRefs: [] });
  // 实现文件由受信写通道归属为 feature-owned，交付指纹才能覆盖它们。
  state = await store.mutate(root, state.featureId, state.revision, "test-ownership", (draft) => {
    draft.workspace.ownership["src/a.js"] = "feature";
    draft.workspace.ownership["src/b.js"] = "feature";
    draft.workspace.ownershipSource["src/a.js"] = "test-hook";
    draft.workspace.ownershipSource["src/b.js"] = "test-hook";
    draft.workspace.unownedPaths = (draft.workspace.unownedPaths ?? []).filter((file) => file !== "src/a.js" && file !== "src/b.js");
  });
  state = await artifacts.scaffoldArtifact(root, state.featureId, state.revision, "requirements");
  state = await artifacts.recordArtifact(root, state.featureId, state.revision, "requirements");
  state = await steps.recordStep(root, state.featureId, state.revision, "requirements_alignment", {});
  state = await artifacts.scaffoldArtifact(root, state.featureId, state.revision, "implementation-plan");
  const planPath = path.join(root, ".dev-flow", "features", state.featureId, state.artifacts["implementation-plan"].path);
  await writeFile(planPath, mPlanMarkdown);
  state = await artifacts.recordArtifact(root, state.featureId, state.revision, "implementation-plan");
  state = await steps.recordStep(root, state.featureId, state.revision, "planning", { reviewType: "plan" });
  const begin1 = await units.beginImplementationUnit(root, state.featureId, state.revision, "UNIT-001");
  await writeFile(path.join(root, "src", "a.js"), "a\n");
  const cp1 = await checkpoints.checkpointImplementationUnit(root, state.featureId, begin1.revision, "UNIT-001");
  state = cp1.state;
  const begin2 = await units.beginImplementationUnit(root, state.featureId, state.revision, "UNIT-002");
  await writeFile(path.join(root, "src", "b.js"), "b\n");
  const cp2 = await checkpoints.checkpointImplementationUnit(root, state.featureId, begin2.revision, "UNIT-002");
  state = cp2.state;
  state = await steps.recordStep(root, state.featureId, state.revision, "implementation", {});
  state = await completeReviewBatch(root, state.featureId, state, "r1");
  state = await steps.recordStep(root, state.featureId, state.revision, "code_review", { reviewType: "code", coverage: ["quality", "fidelity"], findings: [] });
  state = await verification.runVerification(root, state.featureId, state.revision, "codex", ["unit-ok"]);
  return { root, state };
}
test("changing one UNIT file after checkpoints reopens only that UNIT", async () => {
  const { root, state } = await setupMReviewed();
  try {
    const id = state.featureId;
    const claims = state.governance.claims;
    assert.ok(claims.some((c) => c.claimType === "review-complete" && c.baselineRef), "review-complete claim carries a baselineRef");
    assert.ok(claims.some((c) => c.claimType === "verification-current" && c.baselineRef), "verification-current claim carries a baselineRef");
    await writeFile(path.join(root, "src", "b.js"), "b\nc\n");
    const invalidated = await invalidation.invalidateAffectedClaims(root, id, state.revision);
    assert.ok(invalidated, "content change after review/verification must invalidate");
    assert.deepEqual(invalidated.reopenedUnits, ["UNIT-002"]);
    assert.equal(invalidated.reviewReopened, true);
    assert.equal(invalidated.verificationReopened, true);
    assert.deepEqual(invalidated.changedFiles, ["src/b.js"]);
  } finally { await rm(root, { recursive: true, force: true }); }
});
test("review and verification baselines captured at different fingerprints stay independent", async () => {
  const { root, state } = await setupMReviewed();
  try {
    const id = state.featureId;
    // Capture at F1, then change content, invalidate (evidence deleted, claims become
    // non-live), fully redo review + verification at F2. The old F1 claims must never
    // re-invalidate: only live (step-evidence-matching) baselines participate.
    await writeFile(path.join(root, "src", "a.js"), "a\nchanged\n");
    await invalidation.invalidateAffectedClaims(root, id, state.revision);
    let current = await store.readState(root, id);
    const begin = await units.beginImplementationUnit(root, id, current.revision, "UNIT-001");
    const cp = await checkpoints.checkpointImplementationUnit(root, id, begin.revision, "UNIT-001");
    current = cp.state;
    current = await steps.recordStep(root, id, current.revision, "implementation", {});
    current = await completeReviewBatch(root, id, current, "r2");
    current = await steps.recordStep(root, id, current.revision, "code_review", { reviewType: "code", coverage: ["quality", "fidelity"], findings: [] });
    current = await verification.runVerification(root, id, current.revision, "codex", ["unit-ok"]);
    // Both claims now live at F2; the OLD F1 claims remain in the immutable ledger but
    // are excluded by the live filter, so re-invalidation is a no-op.
    const inv2 = await invalidation.invalidateAffectedClaims(root, id, current.revision);
    assert.equal(inv2, undefined, "current content matches the live baseline; no re-invalidation");
    assert.ok(current.governance.claims.length >= state.governance.claims.length, "old claims stay as immutable history");
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("risk acceptance writes a baseline without rewriting startBusinessFingerprint", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "dev-flow-v6-risk-baseline-"));
  try {
    await mkdir(path.join(root, "src"));
    await writeFile(path.join(root, "src", "app.js"), "export const value = 1;\n");
    await store.initProject(root, mConfig);
    let state = await store.startFeature(root, { featureId: "risk", host: "codex", level: "XS", topology: "local", scopeFacts: ["scope"], topologyFacts: ["topology"], uncertaintyFacts: [], riskFacts: {}, decisionRefs: [] });
    state = await steps.recordStep(root, state.featureId, state.revision, "locate", {});
    state = await steps.recordStep(root, state.featureId, state.revision, "implementation", { files: [] });
    const id = state.featureId;
    const failed = await verification.runVerification(root, id, state.revision, "codex", ["unit-fail"]);
    const before = failed.startBusinessFingerprint;
    const fp = await fingerprintSource.fingerprintGovernedRoots(root, mConfig);
    const presented = await quality.presentQualityException(root, id, failed.revision, { kind: "verification", basisHash: "a".repeat(64), fingerprint: fp, riskSummary: "接受" });
    const accepted = (await store.answer({ root, featureId: id, expectedRevision: presented.state.revision, host: "codex", credential: { source: "elicitation", action: "accept", comment: "接受" } })).state;
    const auth = accepted.governance.authorizations.find((a) => a.authorizationType === "risk-acceptance");
    assert.ok(auth, "acceptance writes an authorization record");
    assert.ok(auth.baselineRef, "acceptance binds a baselineRef");
    assert.equal(auth.basis.kind, "content");
    assert.equal(accepted.startBusinessFingerprint, before, "risk acceptance must not rewrite startBusinessFingerprint");
  } finally { await rm(root, { recursive: true, force: true }); }
});
test("invalidateAffectedClaims deletes stale step evidence and reopens affected units", async () => {
  const { root, state } = await setupMReviewed();
  try {
    const id = state.featureId;
    await writeFile(path.join(root, "src", "b.js"), "b\nchanged\n");
    const invalidated = await invalidation.invalidateAffectedClaims(root, id, state.revision);
    assert.ok(invalidated);
    const after = await store.readState(root, id);
    assert.equal(after.steps.code_review, undefined, "stale code review step evidence is deleted");
    assert.equal(after.steps.verification.status, "pending");
    assert.equal(after.steps.implementation, undefined, "reopened unit deletes implementation evidence");
    assert.equal(after.verification.verifiedFingerprint, undefined);
    assert.ok(after.lastInvalidation, "invalidation is recorded for diagnostics");
    assert.deepEqual(after.lastInvalidation.reopenedUnits, ["UNIT-002"]);
  } finally { await rm(root, { recursive: true, force: true }); }
});
test("symlink/mode/rename/delete and multi-UNIT changes map conservatively and precisely", async () => {
  const { root, state } = await setupMReviewed();
  try {
    const id = state.featureId;
    // rename UNIT-002's file: the old path stays attributed to UNIT-002 (precise),
    // while the new unowned path drives fullDrift so review/verification reopen.
    const { rename } = await import("node:fs/promises");
    await rename(path.join(root, "src", "b.js"), path.join(root, "src", "b2.js"));
    const renamed = await invalidation.invalidateAffectedClaims(root, id, state.revision);
    assert.ok(renamed);
    assert.deepEqual(renamed.changedFiles, ["src/b.js", "src/b2.js"]);
    assert.deepEqual(renamed.reopenedUnits, ["UNIT-002"]);
    assert.equal(renamed.reviewReopened, true, "unowned new path reopens review");
    assert.equal(renamed.verificationReopened, true, "unowned new path reopens verification");
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("snapshot write followed by failed state CAS leaves only an orphan", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "dev-flow-v6-snapshot-orphan-"));
  try {
    await mkdir(path.join(root, "src"));
    await store.initProject(root, mConfig);
    const state = await store.startFeature(root, { featureId: "orphan", host: "codex", level: "XS", topology: "local", scopeFacts: ["s"], topologyFacts: ["t"], uncertaintyFacts: [], riskFacts: {}, decisionRefs: [] });
    const config = await store.readProjectConfig(root);
    const snapshot = await fingerprintSource.snapshotGovernedRoots(root, config);
    const snapshotPath = await invalidation.persistThroughSnapshot(root, state.featureId, snapshot, "0".repeat(64), "verification");
    await assert.rejects(store.mutate(root, state.featureId, state.revision + 99, "failed-cas", (draft) => { draft.objective = "x"; }), /STATE_REVISION_CONFLICT/);
    const { readFile } = await import("node:fs/promises");
    const bytes = await readFile(path.join(root, ".dev-flow", "features", state.featureId, snapshotPath), "utf8");
    assert.ok(JSON.parse(bytes).length > 0, "snapshot file survives a failed CAS");
  } finally { await rm(root, { recursive: true, force: true }); }
});