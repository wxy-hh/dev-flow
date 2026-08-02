import assert from "node:assert/strict";
import test from "node:test";
import { runRoute } from "../../helpers/route-flow.mjs";
import { loadSource } from "../../helpers/load-source.mjs";
import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  assertNext,
  claimCapability,
  prepareReviewReadyFeature,
  readCurrentReview,
} from "../../helpers/route-flow.mjs";
import { registerTraceFixture } from "../../helpers/trace-fixtures.mjs";

const checks = await loadSource("plugins/dev-flow/src/core/feature-check.ts");
const gates = await loadSource("plugins/dev-flow/src/core/human-gates.ts");
const next = await loadSource("plugins/dev-flow/src/core/next.ts");
const reviewJobs = await loadSource("plugins/dev-flow/src/core/review-jobs.ts");
const store = await loadSource("plugins/dev-flow/src/core/state-store.ts");
const projection = await loadSource("plugins/dev-flow/src/core/review-projection.ts");
const reviewStore = await loadSource("plugins/dev-flow/src/core/review-store.ts");

test("standard M closes with Trace + multi-perspective review projection", async () => {
  const state = await runRoute(
    { level: "M", topology: "local", execution: "standard", requirements: "missing-or-unclear" },
    "standard-m",
    {
      expectedReviewRoles: ["requirements-coverage", "architecture-testability"],
      implementationFiles: { "src/main.js": "export const m = 1;\n" },
    },
  );
  assert.ok(state.traceability);
  assert.deepEqual(state.traceability.summary, { total: 5, current: 5, stale: 0, tombstoned: 0 });
  assert.equal(state.workflowCapabilities.review, 1);
  assert.equal(state.steps.plan_review.evidence.assuranceLevel, "multi-perspective");
  assert.match(state.artifacts["plan-review"].path, /^review\/projections\/[a-f0-9]{64}\.md$/);
  assert.equal(state.artifacts["plan-review"].path, `review/projections/${state.artifacts["plan-review"].sha256}.md`);
  assert.ok(state.review);
  assert.match(state.review.path, /^review\/snapshots\/[a-f0-9]{64}\.json$/);
});

test("standard M basis changes stale batch, projection, and approval together", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "dev-flow-standard-m-stale-"));
  try {
    await mkdir(path.join(root, "src"), { recursive: true });
    await writeFile(path.join(root, "src", "main.js"), "export {}\n");
    let state = await prepareReviewReadyFeature(root, {
      level: "M", topology: "local", execution: "standard", requirements: "provided-confirmed",
    });
    await assertNext(root, "feature", { kind: "create-review-batch", step: "plan_review" });
    const created = await reviewJobs.createReviewBatch(root, "feature", state.revision);
    state = created.state;
    for (const job of created.batch.jobs) {
      const capability = claimCapability(job.jobId, "stale");
      const claimed = await reviewJobs.claimReviewJob(root, "feature", state.revision, created.batch.batchId, job.jobId, capability);
      state = (await reviewJobs.submitReviewJob(
        root, "feature", claimed.state.revision, created.batch.batchId, job.jobId, capability,
        { coverageSummary: `${job.role} complete`, findings: [] },
      )).state;
    }
    state = await checks.recordStep(root, "feature", state.revision, "plan_review", {});
    const presented = await gates.presentGate(root, "feature", state.revision, "implementation_approval");
    const previousProjection = presented.artifacts["plan-review"];
    const previousReview = presented.review;
    state = await registerTraceFixture({
      root,
      featureId: "feature",
      state: presented,
      kind: "requirements",
      edit: (markdown) => `${markdown}\n- e2e basis change\n`,
    });
    assert.notEqual(state.artifacts["plan-review"].sha256, previousProjection.sha256);
    assert.notEqual(state.review.sha256, previousReview.sha256);
    assert.equal(state.humanGates.implementation_approval, undefined);
    const current = await projection.readReviewProjection(root, state);
    assert.equal(current.model.batch.status, "not-created");
    assert.equal(current.model.staleBatches.length, 1);
    assert.equal(current.model.staleBatches[0].batchId, created.batch.batchId);
    // requirements change reopens earlier steps; after restoring them via real
    // re-registration next asks for a successor batch.
    state = await registerTraceFixture({
      root,
      featureId: "feature",
      state,
      kind: "requirements",
      // content already changed above; ensure trace re-registers current bytes
    });
    // Satisfy the reopened pre-review path with real gates/steps rather than mutate.
    const drivenHost = "claude";
    // requirement_confirmation is reopened; present/confirm again.
    state = await gates.presentGate(root, "feature", state.revision, "requirement_confirmation");
    await store.recordHostEvent(root, {
      eventId: "req-reconfirm", type: "user-prompt", host: drivenHost, text: "确认需求",
    });
    state = await gates.confirmGate(
      root, "feature", state.revision, "requirement_confirmation", "确认需求",
      { promptEventId: "req-reconfirm" }, drivenHost,
    );
    // Plan/coverage/rollback remain cleared; re-register and re-record through Core.
    state = await registerTraceFixture({ root, featureId: "feature", state, kind: "implementation-plan" });
    state = await checks.recordStep(root, "feature", state.revision, "implementation_plan", {});
    state = await registerTraceFixture({ root, featureId: "feature", state, kind: "coverage-matrix" });
    state = await checks.recordStep(root, "feature", state.revision, "coverage_review", {});
    state = await checks.recordStep(root, "feature", state.revision, "rollback_unit", {});
    await assertNext(root, "feature", { kind: "create-review-batch", step: "plan_review" });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("standard M blocking finding blocks plan_review until risk acceptance covers the exact set", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "dev-flow-standard-m-risk-"));
  try {
    await mkdir(path.join(root, "src"), { recursive: true });
    await writeFile(path.join(root, "src", "main.js"), "export {}\n");
    let state = await prepareReviewReadyFeature(root, {
      level: "M", topology: "local", execution: "standard", requirements: "provided-confirmed",
    });
    const created = await reviewJobs.createReviewBatch(root, "feature", state.revision);
    state = created.state;
    const [first, second] = created.batch.jobs;
    const firstCap = claimCapability(first.jobId, "risk");
    const secondCap = claimCapability(second.jobId, "risk");
    let claimed = await reviewJobs.claimReviewJob(root, "feature", state.revision, created.batch.batchId, first.jobId, firstCap);
    state = (await reviewJobs.submitReviewJob(
      root, "feature", claimed.state.revision, created.batch.batchId, first.jobId, firstCap,
      {
        coverageSummary: "blocker",
        findings: [{
          severity: "blocking",
          category: first.role,
          targets: ["src"],
          evidence: [{ path: "src/main.js", line: 1 }],
          claim: "Missing coverage evidence for the stated obligation.",
          recommendation: "Add the missing evidence and re-review.",
        }],
      },
    )).state;
    claimed = await reviewJobs.claimReviewJob(root, "feature", state.revision, created.batch.batchId, second.jobId, secondCap);
    state = (await reviewJobs.submitReviewJob(
      root, "feature", claimed.state.revision, created.batch.batchId, second.jobId, secondCap,
      { coverageSummary: "clean", findings: [] },
    )).state;
    await assert.rejects(
      () => checks.recordStep(root, "feature", state.revision, "plan_review", {}),
      /REVIEW_BLOCKING_FINDINGS/,
    );
    const ledger = await reviewStore.readReviewLedger(root, state);
    const findingId = ledger.batches.at(-1).jobs
      .flatMap((job) => job.submission?.findings ?? [])
      .find((finding) => finding.severity === "blocking").findingId;
    const presented = await reviewJobs.presentReviewRiskAcceptance(root, "feature", state.revision, [findingId]);
    const token = presented.interaction.fallback.token;
    await store.recordHostEvent(root, {
      eventId: "risk-accept-prompt", type: "user-prompt", host: "claude", text: `${token} accept 接受该阻断风险`,
    });
    const accepted = await reviewJobs.resolveReviewRiskAcceptanceToken(
      root, "feature", presented.state.revision, presented.interaction.id,
      `${token} accept 接受该阻断风险`, "risk-accept-prompt", "claude",
    );
    state = accepted.state;
    state = await checks.recordStep(root, "feature", state.revision, "plan_review", {});
    assert.equal(state.steps.plan_review.evidence.assuranceLevel, "multi-perspective");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("legacy review:0 standard M keeps { reviewType: plan } evidence after plugin upgrade", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "dev-flow-standard-m-legacy-"));
  try {
    await mkdir(path.join(root, "src"), { recursive: true });
    await writeFile(path.join(root, "src", "main.js"), "export {}\n");
    await store.initProject(root, {
      schemaVersion: 1,
      verification: { commands: [{ id: "unit", command: "node", args: ["--test"], cwd: "." }], behaviorCommands: [] },
      enforcement: { mode: "strict", gitWriteRequiresLogicComplete: true, oneActiveFeature: true, requireExplicitHumanReply: true },
      protectedRoots: ["src"],
    });
    let state = await store.startFeature(root, {
      featureId: "legacy", host: "claude", level: "M", topology: "local", execution: "standard", requirements: "provided-confirmed",
    });
    // Simulate a pre-Review-2a stamp that remains frozen after the plugin opens review:1.
    state = await store.mutate(root, "legacy", state.revision, "strip-review-capability", (draft) => {
      draft.workflowCapabilities = { trace: 1, review: 0, checkpoints: 0, rollbackExecution: 0 };
      delete draft.review;
      delete draft.artifacts["plan-review"];
    });
    assert.equal(state.workflowCapabilities.review, 0);
    assert.equal(state.review, undefined);

    state = await registerTraceFixture({ root, featureId: "legacy", state, kind: "requirements" });
    state = await checks.recordStep(root, "legacy", state.revision, "requirements", {});
    state = await gates.presentGate(root, "legacy", state.revision, "requirement_confirmation");
    await store.recordHostEvent(root, {
      eventId: "legacy-req", type: "user-prompt", host: "claude", text: "确认需求",
    });
    state = await gates.confirmGate(
      root, "legacy", state.revision, "requirement_confirmation", "确认需求",
      { promptEventId: "legacy-req" }, "claude",
    );
    state = await registerTraceFixture({ root, featureId: "legacy", state, kind: "implementation-plan" });
    state = await checks.recordStep(root, "legacy", state.revision, "implementation_plan", {});
    state = await registerTraceFixture({ root, featureId: "legacy", state, kind: "coverage-matrix" });
    state = await checks.recordStep(root, "legacy", state.revision, "coverage_review", {});
    state = await checks.recordStep(root, "legacy", state.revision, "rollback_unit", {});

    const action = await next.nextAction(root, "legacy");
    assert.equal(action.kind, "run-step");
    assert.equal(action.step, "plan_review");
    assert.equal(action.requiredEvidence.fields.reviewType, "plan");
    assert.equal(action.requiredEvidence.fields.reviewBatch, undefined);
    state = await checks.recordStep(root, "legacy", state.revision, "plan_review", { reviewType: "plan" });
    assert.deepEqual(state.steps.plan_review.evidence, { reviewType: "plan" });
    assert.equal(state.artifacts["plan-review"], undefined);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});