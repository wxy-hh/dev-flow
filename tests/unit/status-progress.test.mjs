import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { loadSource } from "../helpers/load-source.mjs";
import { registerTraceFixture } from "../helpers/trace-fixtures.mjs";

const store = await loadSource("plugins/dev-flow/src/core/state-store.ts");
const artifacts = await loadSource("plugins/dev-flow/src/core/artifacts.ts");
const status = await loadSource("plugins/dev-flow/src/core/status.ts");
const checks = await loadSource("plugins/dev-flow/src/core/feature-check.ts");
const gates = await loadSource("plugins/dev-flow/src/core/human-gates.ts");
const reviewJobs = await loadSource("plugins/dev-flow/src/core/review-jobs.ts");
const verification = await loadSource("plugins/dev-flow/src/core/verification.ts");
const grill = await loadSource("plugins/dev-flow/src/core/requirements-grill.ts");
const config = {
  schemaVersion: 1,
  verification: { commands: [{ id: "unit", command: "node", args: ["-e", "process.exit(0)"], cwd: "." }], behaviorCommands: [] },
  enforcement: { mode: "strict", gitWriteRequiresLogicComplete: true, oneActiveFeature: true, requireExplicitHumanReply: true },
  protectedRoots: ["src"],
};

async function createCurrentReviewBatch(root) {
  await store.initProject(root, config);
  let state = await store.startFeature(root, {
    featureId: "f", host: "codex", level: "M", topology: "local", execution: "standard", requirements: "provided-confirmed",
  });
  state = await artifacts.scaffoldArtifact(root, "f", state.revision, "requirements");
  state = await registerTraceFixture({ root, featureId: "f", state, kind: "requirements" });
  state = await checks.recordStep(root, "f", state.revision, "requirements", {});
  state = await store.mutate(root, "f", state.revision, "status-review-confirmation", (draft) => {
    draft.steps.requirement_confirmation = { status: "satisfied" };
  });
  state = await artifacts.scaffoldArtifact(root, "f", state.revision, "implementation-plan");
  state = await registerTraceFixture({ root, featureId: "f", state, kind: "implementation-plan" });
  state = await checks.recordStep(root, "f", state.revision, "implementation_plan", {});
  state = await artifacts.scaffoldArtifact(root, "f", state.revision, "coverage-matrix");
  state = await registerTraceFixture({ root, featureId: "f", state, kind: "coverage-matrix" });
  state = await checks.recordStep(root, "f", state.revision, "coverage_review", {});
  state = await checks.recordStep(root, "f", state.revision, "rollback_unit", {});
  const created = await reviewJobs.createReviewBatch(root, "f", state.revision);
  state = created.state;
  for (const job of created.batch.jobs) {
    const capability = `claim-status-review-${job.jobId}-abcdefghijklmnop`;
    const claimed = await reviewJobs.claimReviewJob(root, "f", state.revision, created.batch.batchId, job.jobId, capability);
    state = (await reviewJobs.submitReviewJob(
      root, "f", claimed.state.revision, created.batch.batchId, job.jobId, capability,
      { coverageSummary: `${job.role} complete`, findings: [] },
    )).state;
  }
  return { ...created, state };
}

test("status progress reports grill wait without changing revision", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "dev-flow-status-"));
  try {
    await store.initProject(root, config);
    let state = await store.startFeature(root, {
      featureId: "f", host: "claude", level: "M", topology: "local", execution: "standard", requirements: "missing-or-unclear",
    });
    state = await artifacts.scaffoldArtifact(root, "f", state.revision, "requirements");
    state = await registerTraceFixture({
      root, featureId: "f", state, kind: "requirements",
      edit: (markdown) => markdown.replace(
        /^  grill_status: pending$/m,
        "  grill_status: in_progress\n  grill_question_id: Q-002\n  grill_response_hint: \"回复 A / B / C\"",
      ),
    });
    const before = state.revision;
    const view = await status.readStatusView(root, "f");
    assert.equal(view.revision, before);
    assert.equal(view.reviewStatus.enforced, true);
    assert.equal(view.reviewStatus.projection.batch.visibility, "coarse");
    assert.equal(view.progress.wait.kind, "grill");
    assert.equal(view.progress.wait.questionId, "Q-002");
    assert.equal("questionLimit" in view.progress.wait, false);
    assert.match(view.progress.wait.responseHint, /A \/ B \/ C/);
    const decision = await grill.requestGrillDecision(root, "f", state.revision, {
      questionId: "Q-002",
      question: "选择同步方案",
      options: [{ id: "hosted", label: "托管同步" }, { id: "other", label: "其他 / 补充", requiresComment: true }],
      host: "claude",
    });
    const withInteraction = await status.readStatusView(root, "f");
    assert.equal(withInteraction.progress.wait.interaction.id, decision.interaction.id);
    assert.match(withInteraction.progress.wait.responseHint, /^托管同步: DF-/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("status progress reports human gates", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "dev-flow-status-gate-"));
  try {
    await store.initProject(root, config);
    let state = await store.startFeature(root, {
      featureId: "f", host: "claude", level: "M", topology: "local", execution: "standard", requirements: "provided-confirmed",
    });
    state = await artifacts.scaffoldArtifact(root, "f", state.revision, "requirements");
    state = await registerTraceFixture({ root, featureId: "f", state, kind: "requirements" });
    state = await checks.recordStep(root, "f", state.revision, "requirements", {});
    state = await gates.presentGate(root, "f", state.revision, "requirement_confirmation");
    const view = await status.readStatusView(root, "f");
    assert.equal(view.progress.wait.kind, "human-gate");
    assert.equal(view.progress.wait.gate, "requirement_confirmation");
    assert.match(view.progress.wait.replyHint, /^确认需求: DF-/);
    assert.equal(view.progress.wait.interaction.options[0].label, "确认需求");
    state = await gates.resolveGateElicitation(root, "f", state.revision, state.gateInteraction.id, "request-changes", "补充边界条件", "claude");
    const returned = await status.readStatusView(root, "f");
    assert.match(returned.progress.wait.replyHint, /已记录修改意见/);
    assert.equal(returned.progress.wait.feedback, "补充边界条件");
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("status explains how to recover from an unregistered review basis edit", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "dev-flow-status-review-basis-"));
  try {
    const created = await createCurrentReviewBatch(root);
    const requirements = path.join(root, ".dev-flow", "features", "f", created.state.artifacts.requirements.path);
    await writeFile(requirements, `${await readFile(requirements, "utf8")}\n- unregistered basis edit\n`);
    await assert.rejects(
      () => status.readStatusView(root, "f"),
      (error) => error.code === "ARTIFACT_INTEGRITY_FAILED"
        && error.details.kind === "requirements"
        && error.details.recoveryHint === "Re-register the edited requirements artifact with the latest feature revision known before the edit.",
    );
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("status and next report stale verification without changing revision", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "dev-flow-status-stale-"));
  try {
    await store.initProject(root, config);
    await mkdir(path.join(root, "src"));
    await writeFile(path.join(root, "src", "app.js"), "changed\n");
    const state = await store.startFeature(root, { featureId: "f", host: "codex", level: "XS", topology: "local" });
    const file = path.join(root, ".dev-flow", "features", "f", "state.json");
    const raw = JSON.parse(await readFile(file, "utf8"));
    raw.steps = { locate: { status: "satisfied" }, implementation: { status: "satisfied" }, verification: { status: "satisfied" } };
    raw.verification = { attempts: [], verifiedFingerprint: "obsolete", satisfiedByAttemptId: 1 };
    raw.businessFingerprint = "obsolete";
    await writeFile(file, `${JSON.stringify(raw, null, 2)}\n`);
    const eventsFile = path.join(root, ".dev-flow", "features", "f", "events.jsonl");
    const eventsSize = (await stat(eventsFile)).size;
    const view = await status.readStatusView(root, "f");
    assert.equal(view.revision, state.revision);
    assert.equal((await stat(eventsFile)).size, eventsSize);
    assert.deepEqual(view.progress.nextAction, {
      kind: "run-step",
      step: "verification",
      requiredEvidence: { fields: {}, checks: [], verificationKinds: ["targeted"] },
    });
    assert.equal(view.progress.requiredEvidence.verificationKinds[0], "targeted");
    assert.equal(view.progress.verificationFreshness.status, "stale");
    assert.equal(view.progress.verificationFreshness.reasonCode, "VERIFICATION_STALE");
    assert.equal(view.progress.verificationFreshness.recoveryHint, "Protected files changed; rerun verification before feature-check or finalize");
    assert.equal(view.progress.currentStep, "verification");
    assert.ok(view.progress.remainingSteps.includes("verification"));
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("status reports missing and fresh verification without mutation", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "dev-flow-status-freshness-"));
  try {
    await store.initProject(root, config);
    await mkdir(path.join(root, "src"));
    await writeFile(path.join(root, "src", "app.js"), "export const value = 1;\n");
    let state = await store.startFeature(root, { featureId: "f", host: "codex", level: "XS", topology: "local" });
    const missing = await status.readStatusView(root, "f");
    assert.equal(missing.progress.verificationFreshness.status, "missing");
    state = await checks.recordStep(root, "f", state.revision, "locate", {});
    state = await checks.recordStep(root, "f", state.revision, "implementation", { files: [] });
    state = await verification.runVerification(root, "f", state.revision, "codex");
    const eventsFile = path.join(root, ".dev-flow", "features", "f", "events.jsonl");
    const revision = state.revision;
    const eventsSize = (await stat(eventsFile)).size;
    const fresh = await status.readStatusView(root, "f");
    assert.equal(fresh.revision, revision);
    assert.equal((await stat(eventsFile)).size, eventsSize);
    assert.equal(fresh.progress.verificationFreshness.status, "fresh");
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("status exposes optional acceptance assistance without making it a blocker", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "dev-flow-status-acceptance-assist-"));
  try {
    await store.initProject(root, config);
    await mkdir(path.join(root, "src"));
    await writeFile(path.join(root, "src", "app.js"), "export const value = 1;\n");
    await store.startFeature(root, {
      featureId: "f", host: "codex", level: "XS", topology: "local", manualAcceptanceRequired: true,
    });
    const view = await status.readStatusView(root, "f");
    assert.deepEqual(view.progress.acceptanceAssist, { suggested: true, blocking: false });
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("status surfaces incomplete in-progress grill metadata", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "dev-flow-status-grill-invalid-"));
  try {
    await store.initProject(root, config);
    let state = await store.startFeature(root, {
      featureId: "f", host: "claude", level: "M", topology: "local", execution: "standard", requirements: "missing-or-unclear",
    });
    state = await artifacts.scaffoldArtifact(root, "f", state.revision, "requirements");
    state = await registerTraceFixture({
      root, featureId: "f", state, kind: "requirements",
      edit: (markdown) => markdown.replace(/^  grill_status: pending$/m, "  grill_status: in_progress"),
    });
    await assert.rejects(() => status.readStatusView(root, "f"), (error) => error.code === "GRILL_STATUS_INVALID");
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("status does not crash on corrupted trace snapshot during implementation with checkpoints", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "dev-flow-status-corrupt-trace-"));
  try {
    await mkdir(path.join(root, "src"));
    await mkdir(path.join(root, "test"));
    await writeFile(path.join(root, "src", "app.js"), "export const value = 1;\n");
    await writeFile(path.join(root, "test", "app.test.js"), "const test = require('node:test');\ntest('fixture passes', () => {});\n");
    await store.initProject(root, {
      schemaVersion: 1,
      verification: { commands: [{ id: "unit", command: "node", args: ["--test"], cwd: "." }], behaviorCommands: [] },
      enforcement: { mode: "strict", gitWriteRequiresLogicComplete: true, oneActiveFeature: true, requireExplicitHumanReply: true },
      protectedRoots: ["src", "test"],
    });
    const contract = await loadSource("plugins/dev-flow/src/policy/contract.ts");
    const { registerTraceFixture } = await import("../helpers/trace-fixtures.mjs");
    let state = await store.startFeature(root, {
      featureId: "f", host: "codex", level: "M", topology: "local", execution: "standard", requirements: "provided-confirmed",
    });
    state = await store.mutate(root, "f", state.revision, "corrupt-trace-caps", (draft) => {
      draft.workflowCapabilities = { trace: 1, review: 0, checkpoints: 1, rollbackExecution: 0 };
    });
    state = await registerTraceFixture({ root, featureId: "f", state, kind: "requirements" });
    state = await store.mutate(root, "f", state.revision, "corrupt-trace-reqs", (draft) => {
      draft.steps.requirements = { status: "satisfied" };
      draft.steps.requirement_confirmation = { status: "satisfied" };
    });
    state = await registerTraceFixture({ root, featureId: "f", state, kind: "implementation-plan" });
    state = await store.mutate(root, "f", state.revision, "corrupt-trace-plan", (draft) => {
      draft.steps.implementation_plan = { status: "satisfied" };
    });
    state = await registerTraceFixture({ root, featureId: "f", state, kind: "coverage-matrix" });
    state = await store.mutate(root, "f", state.revision, "corrupt-trace-approval", (draft) => {
      const definition = contract.routeDefinitionForFeature(draft.route, draft.workflowCapabilities);
      for (const step of definition.orderedSteps.slice(0, definition.orderedSteps.indexOf("implementation"))) {
        draft.steps[step] = { status: "satisfied" };
      }
      draft.humanGates.implementation_approval = { status: "confirmed" };
    });

    // Corrupt the trace snapshot so readTraceability throws
    const snapshotPath = path.join(root, ".dev-flow", "features", "f", state.traceability.path);
    await writeFile(snapshotPath, "garbage data, not valid JSON\n");

    // readStatusView must not crash; it should return a valid view with trace blockers
    const view = await status.readStatusView(root, "f");
    assert.equal(view.implementation.enforced, true);
    assert.equal(view.implementation.activeUnitId, undefined);
    assert.equal(view.implementation.lastCheckpointId, undefined);
    assert.deepEqual(view.implementation.remainingUnitIds, []);
    assert.equal(view.trace.enforced, true);
    assert.equal(view.trace.blockers.length, 1);
    assert.equal(view.trace.blockers[0].code, "TRACE_SLICE_INCOMPLETE");
    assert.equal(view.trace.blockers[0].step, "implementation");
    assert.equal(view.trace.blockers[0].details.cause, "TRACEABILITY_INTEGRITY_FAILED");
    // nextAction should be repair-trace, not a crash
    assert.equal(view.progress.nextAction.kind, "repair-trace");
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("status exposes unit lifecycle progress and rollback preview targets", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "dev-flow-status-units-"));
  try {
    await mkdir(path.join(root, "src"));
    await mkdir(path.join(root, "test"));
    await writeFile(path.join(root, "src", "app.js"), "export const value = 1;\n");
    await writeFile(path.join(root, "test", "app.test.js"), "const test = require('node:test');\ntest('fixture passes', () => {});\n");
    await store.initProject(root, {
      schemaVersion: 1,
      verification: { commands: [{ id: "unit", command: "node", args: ["--test"], cwd: "." }], behaviorCommands: [] },
      enforcement: { mode: "strict", gitWriteRequiresLogicComplete: true, oneActiveFeature: true, requireExplicitHumanReply: true },
      protectedRoots: ["src", "test"],
    });
    const contract = await loadSource("plugins/dev-flow/src/policy/contract.ts");
    const units = await loadSource("plugins/dev-flow/src/core/implementation-units.ts");
    const checkpoints = await loadSource("plugins/dev-flow/src/core/checkpoints.ts");
    const { registerTraceFixture } = await import("../helpers/trace-fixtures.mjs");
    let state = await store.startFeature(root, {
      featureId: "f", host: "codex", level: "M", topology: "local", execution: "standard", requirements: "provided-confirmed",
    });
    state = await store.mutate(root, "f", state.revision, "status-units-capabilities", (draft) => {
      draft.workflowCapabilities = { trace: 1, review: 0, checkpoints: 1, rollbackExecution: 0 };
    });
    state = await registerTraceFixture({ root, featureId: "f", state, kind: "requirements" });
    state = await store.mutate(root, "f", state.revision, "status-units-requirements", (draft) => {
      draft.steps.requirements = { status: "satisfied" };
      draft.steps.requirement_confirmation = { status: "satisfied" };
    });
    state = await registerTraceFixture({ root, featureId: "f", state, kind: "implementation-plan" });
    state = await store.mutate(root, "f", state.revision, "status-units-plan", (draft) => {
      draft.steps.implementation_plan = { status: "satisfied" };
    });
    state = await registerTraceFixture({ root, featureId: "f", state, kind: "coverage-matrix" });
    state = await store.mutate(root, "f", state.revision, "status-units-approval", (draft) => {
      const definition = contract.routeDefinitionForFeature(draft.route, draft.workflowCapabilities);
      for (const step of definition.orderedSteps.slice(0, definition.orderedSteps.indexOf("implementation"))) {
        draft.steps[step] = { status: "satisfied" };
      }
      draft.humanGates.implementation_approval = { status: "confirmed" };
    });

    let view = await status.readStatusView(root, "f");
    assert.equal(view.implementation.enforced, true);
    assert.equal(view.implementation.activeUnitId, undefined);
    assert.equal(view.implementation.lastCheckpointId, undefined);
    assert.deepEqual(view.implementation.remainingUnitIds, ["RU-001"]);
    assert.deepEqual(view.rollback.validTargets, []);

    state = await units.beginImplementationUnit(root, "f", state.revision, "RU-001");
    view = await status.readStatusView(root, "f");
    assert.equal(view.implementation.activeUnitId, "RU-001");
    assert.deepEqual(view.implementation.remainingUnitIds, ["RU-001"]);

    await writeFile(path.join(root, "src", "app.js"), "export const value = 2;\n");
    state = (await checkpoints.checkpointImplementationUnit(root, "f", state.revision, "RU-001")).state;
    view = await status.readStatusView(root, "f");
    assert.equal(view.implementation.activeUnitId, undefined);
    assert.equal(view.implementation.lastCheckpointId, "CP-001");
    assert.deepEqual(view.implementation.remainingUnitIds, []);
    // The lone checkpoint is the live chain tip: nothing to undo, no target.
    assert.deepEqual(view.rollback.validTargets, []);
    assert.deepEqual(view.rollback.chain, [{ checkpointId: "CP-001", unitId: "RU-001", sequence: 1 }]);
  } finally { await rm(root, { recursive: true, force: true }); }
});
