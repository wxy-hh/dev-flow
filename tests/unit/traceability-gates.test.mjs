import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { loadSource } from "../helpers/load-source.mjs";
import { registerTraceFixture } from "../helpers/trace-fixtures.mjs";

const store = await loadSource("plugins/dev-flow/src/core/state-store.ts");
const artifacts = await loadSource("plugins/dev-flow/src/core/artifacts.ts");
const checks = await loadSource("plugins/dev-flow/src/core/feature-check.ts");
const gates = await loadSource("plugins/dev-flow/src/core/human-gates.ts");
const next = await loadSource("plugins/dev-flow/src/core/next.ts");
const status = await loadSource("plugins/dev-flow/src/core/status.ts");
const traceStore = await loadSource("plugins/dev-flow/src/core/traceability-store.ts");
const verification = await loadSource("plugins/dev-flow/src/core/verification.ts");
const reviewJobs = await loadSource("plugins/dev-flow/src/core/review-jobs.ts");
const config = {
  schemaVersion: 1,
  verification: { commands: [{ id: "unit", command: "node", args: ["-e", "process.exit(0)"], cwd: "." }], behaviorCommands: [] },
  enforcement: { mode: "strict", gitWriteRequiresLogicComplete: true, oneActiveFeature: true, requireExplicitHumanReply: true },
  protectedRoots: ["src"],
};

async function standardRoot(prefix) {
  const root = await mkdtemp(path.join(os.tmpdir(), prefix));
  await mkdir(path.join(root, "src"));
  await writeFile(path.join(root, "src", "app.js"), "export const value = 1;\n");
  await store.initProject(root, config);
  return root;
}

async function confirmRequirement(root, state) {
  state = await gates.presentGate(root, "f", state.revision, "requirement_confirmation");
  return gates.resolveGateElicitation(root, "f", state.revision, state.gateInteraction.id, "confirm", undefined, "codex");
}

async function confirmImplementation(root, state) {
  state = await gates.presentGate(root, "f", state.revision, "implementation_approval");
  return gates.resolveGateElicitation(root, "f", state.revision, state.gateInteraction.id, "confirm", undefined, "codex");
}

async function standardThroughCoverage(root, { registerCoverage = true } = {}) {
  let state = await store.startFeature(root, {
    featureId: "f", host: "codex", level: "M", topology: "local", execution: "standard", requirements: "provided-confirmed",
  });
  state = await artifacts.scaffoldArtifact(root, "f", state.revision, "requirements");
  state = await registerTraceFixture({ root, featureId: "f", state, kind: "requirements" });
  state = await checks.recordStep(root, "f", state.revision, "requirements", {});
  state = await confirmRequirement(root, state);
  state = await artifacts.scaffoldArtifact(root, "f", state.revision, "implementation-plan");
  state = await registerTraceFixture({ root, featureId: "f", state, kind: "implementation-plan" });
  state = await checks.recordStep(root, "f", state.revision, "implementation_plan", {});
  state = await artifacts.scaffoldArtifact(root, "f", state.revision, "coverage-matrix");
  if (registerCoverage) state = await registerTraceFixture({ root, featureId: "f", state, kind: "coverage-matrix" });
  return state;
}

async function standardThroughVerification(root) {
  let state = await standardThroughCoverage(root);
  state = await checks.recordStep(root, "f", state.revision, "coverage_review", {});
  state = await checks.recordStep(root, "f", state.revision, "rollback_unit", {});
  state = await completePlanReview(root, state);
  state = await artifacts.scaffoldArtifact(root, "f", state.revision, "status");
  state = await confirmImplementation(root, state);
  state = await checks.recordStep(root, "f", state.revision, "implementation", { files: [] });
  assert.deepEqual(state.steps.implementation.evidence, { files: [] });
  state = await checks.recordStep(root, "f", state.revision, "code_review", { reviewType: "code" });
  return verification.runVerification(root, "f", state.revision, "codex", ["unit"]);
}

async function completePlanReview(root, state) {
  const created = await reviewJobs.createReviewBatch(root, "f", state.revision);
  state = created.state;
  for (const job of created.batch.jobs) {
    const capability = `claim-${job.jobId}-trace-gates-1234567890`;
    const claimed = await reviewJobs.claimReviewJob(root, "f", state.revision, created.batch.batchId, job.jobId, capability);
    state = (await reviewJobs.submitReviewJob(
      root, "f", claimed.state.revision, created.batch.batchId, job.jobId, capability,
      { coverageSummary: `${job.role} review complete`, findings: [] },
    )).state;
  }
  return checks.recordStep(root, "f", state.revision, "plan_review", {});
}

test("Core rejects missing and corrupt Trace instead of allowing step or gate bypasses", async () => {
  const root = await standardRoot("dev-flow-trace-gates-missing-");
  try {
    let state = await store.startFeature(root, {
      featureId: "f", host: "codex", level: "M", topology: "local", execution: "standard", requirements: "provided-confirmed",
    });
    state = await artifacts.scaffoldArtifact(root, "f", state.revision, "requirements");
    const before = state.revision;
    await assert.rejects(
      () => checks.recordStep(root, "f", state.revision, "requirements", {}),
      (error) => error.code === "TRACE_SLICE_INCOMPLETE",
    );
    assert.equal((await store.readState(root, "f")).revision, before);

    state = await registerTraceFixture({ root, featureId: "f", state, kind: "requirements" });
    state = await checks.recordStep(root, "f", state.revision, "requirements", {});
    const snapshot = path.join(root, ".dev-flow", "features", "f", state.traceability.path);
    await writeFile(snapshot, "corrupt snapshot\n");
    await assert.rejects(
      () => gates.presentGate(root, "f", state.revision, "requirement_confirmation"),
      (error) => error.code === "TRACE_SLICE_INCOMPLETE" && error.details.cause === "TRACEABILITY_INTEGRITY_FAILED",
    );
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("Core rejects stale Trace at the next stage while preserving legacy compatibility", async () => {
  const root = await standardRoot("dev-flow-trace-gates-stale-");
  try {
    let state = await standardThroughCoverage(root);
    state = await registerTraceFixture({
      root, featureId: "f", state, kind: "requirements",
      edit: (markdown) => markdown.replace("- 描述：", "- 描述：changed"),
    });
    state = await confirmRequirement(root, state);
    await assert.rejects(
      () => checks.recordStep(root, "f", state.revision, "implementation_plan", {}),
      (error) => error.code === "TRACE_SLICE_STALE",
    );

    const legacyRoot = await standardRoot("dev-flow-trace-gates-legacy-");
    try {
      let legacy = await store.startFeature(legacyRoot, {
        featureId: "f", host: "codex", level: "M", topology: "local", execution: "standard", requirements: "provided-confirmed",
      });
      legacy = await store.mutate(legacyRoot, "f", legacy.revision, "legacy-fixture", (draft) => {
        delete draft.workflowCapabilities;
        delete draft.traceability;
      });
      legacy = await artifacts.scaffoldArtifact(legacyRoot, "f", legacy.revision, "requirements");
      legacy = await artifacts.recordArtifact(legacyRoot, "f", legacy.revision, "requirements");
      legacy = await checks.recordStep(legacyRoot, "f", legacy.revision, "requirements", {});
      assert.equal(legacy.steps.requirements.status, "satisfied");
    } finally { await rm(legacyRoot, { recursive: true, force: true }); }
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("next and status return the same repair-trace action after an artifact is scaffolded", async () => {
  const root = await standardRoot("dev-flow-trace-gates-next-");
  try {
    await standardThroughCoverage(root, { registerCoverage: false });
    const action = await next.nextAction(root, "f");
    assert.equal(action.kind, "repair-trace");
    assert.equal(action.step, "coverage_review");
    assert.equal(action.code, "TRACE_SLICE_INCOMPLETE");
    const view = await status.readStatusView(root, "f");
    assert.deepEqual(view.progress.nextAction, action);
    assert.equal(view.trace.enforced, true);
    assert.equal(view.trace.blockers[0].code, action.code);
    assert.equal(view.trace.blockers[0].step, action.step);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("next scaffolds a missing artifact before suggesting Trace repair", async () => {
  const root = await standardRoot("dev-flow-trace-gates-scaffold-");
  try {
    await store.startFeature(root, {
      featureId: "f", host: "codex", level: "M", topology: "local", execution: "standard", requirements: "provided-confirmed",
    });
    assert.deepEqual(await next.nextAction(root, "f"), { kind: "scaffold-artifact", step: "requirements" });
    const view = await status.readStatusView(root, "f");
    assert.equal(view.progress.nextAction.kind, "scaffold-artifact");
    assert.equal(view.trace.blockers[0].code, "TRACE_SLICE_INCOMPLETE");
    assert.equal(view.trace.blockers[0].step, "requirements");
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("gate confirmation rejects corrupt and stale Trace after presentation", async () => {
  const root = await standardRoot("dev-flow-trace-gates-confirm-");
  try {
    let state = await store.startFeature(root, {
      featureId: "f", host: "codex", level: "M", topology: "local", execution: "standard", requirements: "provided-confirmed",
    });
    state = await artifacts.scaffoldArtifact(root, "f", state.revision, "requirements");
    state = await registerTraceFixture({ root, featureId: "f", state, kind: "requirements" });
    state = await checks.recordStep(root, "f", state.revision, "requirements", {});
    state = await gates.presentGate(root, "f", state.revision, "requirement_confirmation");
    await store.recordHostEvent(root, { eventId: "approve-requirements", type: "user-prompt", host: "codex", text: "确认需求" });
    const snapshot = path.join(root, ".dev-flow", "features", "f", state.traceability.path);
    const snapshotContents = await readFile(snapshot, "utf8");
    await writeFile(snapshot, "corrupt snapshot\n");
    await assert.rejects(
      () => gates.confirmGate(root, "f", state.revision, "requirement_confirmation", "确认需求", {}, "codex"),
      (error) => error.code === "TRACE_SLICE_INCOMPLETE" && error.details.cause === "TRACEABILITY_INTEGRITY_FAILED",
    );

    await writeFile(snapshot, snapshotContents);
    const ledger = await traceStore.readTraceability(root, state);
    ledger.nodes["REQ-001"].status = "stale";
    ledger.summary = { total: 2, current: 1, stale: 1, tombstoned: 0 };
    const pointer = await traceStore.writeTraceSnapshot(root, ledger);
    state = await store.mutate(root, "f", state.revision, "test-stale-trace", (draft) => { draft.traceability = pointer; });
    await store.recordHostEvent(root, { eventId: "approve-stale-requirements", type: "user-prompt", host: "codex", text: "确认需求" });
    await assert.rejects(
      () => gates.confirmGate(root, "f", state.revision, "requirement_confirmation", "确认需求", {}, "codex"),
      (error) => error.code === "TRACE_SLICE_STALE",
    );
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("StatusView and generated status Markdown share the current Trace blocker", async () => {
  const root = await standardRoot("dev-flow-trace-gates-projection-");
  try {
    let state = await standardThroughCoverage(root);
    state = await checks.recordStep(root, "f", state.revision, "coverage_review", {});
    state = await checks.recordStep(root, "f", state.revision, "rollback_unit", {});
    state = await completePlanReview(root, state);
    state = await artifacts.scaffoldArtifact(root, "f", state.revision, "status");
    await writeFile(path.join(root, ".dev-flow", "features", "f", state.traceability.path), "corrupt snapshot\n");
    state = await store.mutate(root, "f", state.revision, "refresh-status-projection", () => {});
    const view = await status.readStatusView(root, "f");
    const markdown = await readFile(path.join(root, ".dev-flow", "features", "f", state.artifacts.status.path), "utf8");
    const blocker = view.trace.blockers[0];
    assert.equal(blocker.code, "TRACE_SLICE_INCOMPLETE");
    assert.equal(blocker.step, "implementation_approval");
    assert.match(markdown, new RegExp(`- Blocker: ${blocker.code} \\(${blocker.step}\\)`));
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("feature check and finalize recheck complete Trace immediately before their claims", async () => {
  const featureCheckRoot = await standardRoot("dev-flow-trace-gates-feature-check-");
  const finalizeRoot = await standardRoot("dev-flow-trace-gates-finalize-");
  try {
    let state = await standardThroughVerification(featureCheckRoot);
    const snapshot = path.join(featureCheckRoot, ".dev-flow", "features", "f", state.traceability.path);
    await writeFile(snapshot, "corrupt snapshot\n");
    const beforeFeatureCheck = state.revision;
    await assert.rejects(
      () => checks.featureCheck(featureCheckRoot, "f", state.revision),
      (error) => error.code === "TRACE_SLICE_INCOMPLETE" && error.details.cause === "TRACEABILITY_INTEGRITY_FAILED",
    );
    assert.equal((await store.readState(featureCheckRoot, "f")).revision, beforeFeatureCheck);

    state = await standardThroughVerification(finalizeRoot);
    state = await checks.featureCheck(finalizeRoot, "f", state.revision);
    const finalizeSnapshot = path.join(finalizeRoot, ".dev-flow", "features", "f", state.traceability.path);
    await writeFile(finalizeSnapshot, "corrupt snapshot\n");
    const beforeFinalize = state.revision;
    await assert.rejects(
      () => checks.finalize(finalizeRoot, "f", state.revision),
      (error) => error.code === "TRACE_SLICE_INCOMPLETE" && error.details.cause === "TRACEABILITY_INTEGRITY_FAILED",
    );
    assert.equal((await store.readState(finalizeRoot, "f")).revision, beforeFinalize);
  } finally {
    await rm(featureCheckRoot, { recursive: true, force: true });
    await rm(finalizeRoot, { recursive: true, force: true });
  }
});
