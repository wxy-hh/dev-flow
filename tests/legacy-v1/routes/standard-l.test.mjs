import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { runRoute, assertNext, claimCapability, prepareReviewReadyFeature } from "../../helpers/route-flow.mjs";
import { loadSource } from "../../helpers/load-source.mjs";
import { registerTraceFixture } from "../../helpers/trace-fixtures.mjs";

const checks = await loadSource("plugins/dev-flow/src/core/feature-check.ts");
const gates = await loadSource("plugins/dev-flow/src/core/human-gates.ts");
const reviewJobs = await loadSource("plugins/dev-flow/src/core/review-jobs.ts");
const projection = await loadSource("plugins/dev-flow/src/core/review-projection.ts");
const store = await loadSource("plugins/dev-flow/src/core/state-store.ts");

test("standard L closes with Trace, rollback-operability role, and multi-perspective projection", async () => {
  const state = await runRoute(
    { level: "L", topology: "coordinated-rollback", execution: "standard", requirements: "provided-confirmed" },
    "standard-l",
    {
      expectedReviewRoles: ["requirements-coverage", "architecture-testability", "rollback-operability"],
      implementationFiles: { "src/main.js": "export const l = 1;\n" },
    },
  );
  assert.ok(state.traceability);
  assert.equal(state.artifacts.status, undefined);
  assert.deepEqual(state.traceability.summary, { total: 5, current: 5, stale: 0, tombstoned: 0 });
  assert.equal(state.workflowCapabilities.review, 1);
  assert.equal(state.steps.plan_review.evidence.assuranceLevel, "multi-perspective");
  assert.equal(state.steps.plan_review.evidence.batchId.length > 0, true);
  assert.match(state.artifacts["plan-review"].path, /^review\/projections\/[a-f0-9]{64}\.md$/);
  assert.ok(state.review);
});

test("standard L basis change stales batch, projection, and implementation approval", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "dev-flow-standard-l-stale-"));
  try {
    await mkdir(path.join(root, "src"), { recursive: true });
    await writeFile(path.join(root, "src", "main.js"), "export {}\n");
    let state = await prepareReviewReadyFeature(root, {
      level: "L", topology: "coordinated-rollback", execution: "standard", requirements: "provided-confirmed",
    });
    assert.equal(state.route, "standard-l");
    await assertNext(root, "feature", { kind: "create-review-batch", step: "plan_review" });
    const created = await reviewJobs.createReviewBatch(root, "feature", state.revision);
    state = created.state;
    assert.deepEqual(created.batch.jobs.map((job) => job.role), [
      "requirements-coverage", "architecture-testability", "rollback-operability",
    ]);
    for (const job of created.batch.jobs) {
      const capability = claimCapability(job.jobId, "l-stale");
      const claimed = await reviewJobs.claimReviewJob(root, "feature", state.revision, created.batch.batchId, job.jobId, capability);
      state = (await reviewJobs.submitReviewJob(
        root, "feature", claimed.state.revision, created.batch.batchId, job.jobId, capability,
        { coverageSummary: `${job.role} complete`, findings: [] },
      )).state;
    }
    state = await checks.recordStep(root, "feature", state.revision, "plan_review", {});
    const presented = await gates.presentGate(root, "feature", state.revision, "implementation_approval");
    const previousProjection = presented.artifacts["plan-review"];
    state = await registerTraceFixture({
      root,
      featureId: "feature",
      state: presented,
      kind: "implementation-plan",
      edit: (markdown) => `${markdown}\n- L plan revision\n`,
    });
    assert.notEqual(state.artifacts["plan-review"].sha256, previousProjection.sha256);
    assert.equal(state.humanGates.implementation_approval, undefined);
    const current = await projection.readReviewProjection(root, state);
    assert.equal(current.model.batch.status, "not-created");
    assert.equal(current.model.staleBatches.some((batch) => batch.batchId === created.batch.batchId), true);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("standard L successor batch can resolve a prior blocking finding from the same role", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "dev-flow-standard-l-resolve-"));
  try {
    await mkdir(path.join(root, "src"), { recursive: true });
    await writeFile(path.join(root, "src", "main.js"), "export {}\n");
    let state = await prepareReviewReadyFeature(root, {
      level: "L", topology: "coordinated-rollback", execution: "standard", requirements: "provided-confirmed",
    });
    const first = await reviewJobs.createReviewBatch(root, "feature", state.revision);
    state = first.state;
    const coverageJob = first.batch.jobs.find((job) => job.role === "requirements-coverage");
    for (const job of first.batch.jobs) {
      const capability = claimCapability(job.jobId, "resolve-1");
      const claimed = await reviewJobs.claimReviewJob(root, "feature", state.revision, first.batch.batchId, job.jobId, capability);
      const completion = job.jobId === coverageJob.jobId
        ? {
            coverageSummary: "found gap",
            findings: [{
              severity: "blocking",
              category: job.role,
              targets: ["src"],
              evidence: [{ path: "src/main.js", line: 1 }],
              claim: "Coverage matrix does not prove AC-001.",
              recommendation: "Tighten coverage evidence.",
            }],
          }
        : { coverageSummary: `${job.role} clean`, findings: [] };
      state = (await reviewJobs.submitReviewJob(
        root, "feature", claimed.state.revision, first.batch.batchId, job.jobId, capability, completion,
      )).state;
    }
    await assert.rejects(
      () => checks.recordStep(root, "feature", state.revision, "plan_review", {}),
      /REVIEW_BLOCKING_FINDINGS/,
    );
    const ledger = await (await loadSource("plugins/dev-flow/src/core/review-store.ts")).readReviewLedger(root, state);
    const findingId = ledger.batches[0].jobs
      .flatMap((job) => job.submission?.findings ?? [])
      .find((finding) => finding.severity === "blocking").findingId;

    // Repairing the finding invalidates later steps (including plan_review), so the
    // successor batch must re-satisfy plan_review on the new basis.
    state = await registerTraceFixture({
      root, featureId: "feature", state, kind: "coverage-matrix",
      edit: (markdown) => `${markdown}\n- tightened coverage evidence\n`,
    });
    assert.equal(state.steps.plan_review, undefined);
    const successor = await reviewJobs.createReviewBatch(root, "feature", state.revision);
    state = successor.state;
    for (const job of successor.batch.jobs) {
      const capability = claimCapability(job.jobId, "resolve-2");
      const claimed = await reviewJobs.claimReviewJob(root, "feature", state.revision, successor.batch.batchId, job.jobId, capability);
      const completion = job.role === "requirements-coverage"
        ? {
            coverageSummary: "resolved prior gap",
            findings: [],
            resolutions: [{
              findingId,
              evidence: [{ path: "src/main.js", line: 1 }],
              note: "Coverage now proves AC-001 with explicit mapping.",
            }],
          }
        : { coverageSummary: `${job.role} clean on successor`, findings: [] };
      state = (await reviewJobs.submitReviewJob(
        root, "feature", claimed.state.revision, successor.batch.batchId, job.jobId, capability, completion,
      )).state;
    }
    // Coverage re-registration leaves coverage_review satisfied and reopens later steps.
    state = await checks.recordStep(root, "feature", state.revision, "rollback_unit", {});
    state = await checks.recordStep(root, "feature", state.revision, "plan_review", {});
    assert.equal(state.steps.plan_review.evidence.batchId, successor.batch.batchId);
    assert.equal(state.steps.plan_review.evidence.assuranceLevel, "multi-perspective");
    const current = await projection.readReviewProjection(root, state);
    assert.equal(current.model.batch.unresolvedBlockingFindingIds.length, 0);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
