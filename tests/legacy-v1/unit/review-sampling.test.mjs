import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { strictProjectConfig } from "../helpers/fixture-repo.mjs";
import { loadSource } from "../helpers/load-source.mjs";
import { registerTraceFixture } from "../helpers/trace-fixtures.mjs";

const reviewStore = await loadSource("plugins/dev-flow/src/core/review-store.ts");
const stateStore = await loadSource("plugins/dev-flow/src/core/state-store.ts");
const reviewJobs = await loadSource("plugins/dev-flow/src/core/review-jobs.ts");

async function withRoot(run) {
  const root = await mkdtemp(path.join(os.tmpdir(), "dev-flow-review-sampling-"));
  try {
    return await run(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

async function reviewReadyFeature(root) {
  await stateStore.initProject(root, strictProjectConfig);
  let state = await stateStore.startFeature(root, {
    featureId: "f", host: "codex", level: "M", topology: "local", execution: "standard", requirements: "provided-confirmed",
  });
  const pointer = await reviewStore.writeReviewSnapshot(root, reviewStore.emptyReviewLedger("f", state.revision + 1));
  state = await stateStore.mutate(root, "f", state.revision, "review-sampling-pointer", (draft) => {
    draft.workflowCapabilities = { trace: 1, review: 1, checkpoints: 0, rollbackExecution: 0 };
    draft.review = pointer;
  });
  state = await registerTraceFixture({ root, featureId: "f", state, kind: "requirements" });
  state = await stateStore.mutate(root, "f", state.revision, "review-sampling-requirements", (draft) => {
    draft.steps.requirements = { status: "satisfied" };
    draft.steps.requirement_confirmation = { status: "satisfied" };
  });
  state = await registerTraceFixture({ root, featureId: "f", state, kind: "implementation-plan" });
  state = await stateStore.mutate(root, "f", state.revision, "review-sampling-plan", (draft) => {
    draft.steps.implementation_plan = { status: "satisfied" };
  });
  return registerTraceFixture({ root, featureId: "f", state, kind: "coverage-matrix" });
}

const completion = (summary) => ({ coverageSummary: summary, findings: [] });

test("server sampling owns one job, rejects replays, and derives independent-sampling only from two persisted attempts", async () => {
  await withRoot(async (root) => {
    const initial = await reviewReadyFeature(root);
    const created = await reviewJobs.createReviewBatch(root, "f", initial.revision);
    const [firstJob, secondJob] = created.batch.jobs;
    const at = new Date("2026-07-30T00:00:00.000Z");

    const first = await reviewJobs.beginReviewSampling(root, "f", created.state.revision, created.batch.batchId, firstJob.jobId, at);
    assert.equal(first.job.status, "sampling");
    assert.equal("claim" in first.job, false);
    assert.equal(first.package.jobId, firstJob.jobId);
    await assert.rejects(
      () => reviewJobs.claimReviewJob(root, "f", first.state.revision, created.batch.batchId, firstJob.jobId, "claim-1234567890-sampling-mutex-capability", at),
      /REVIEW_JOB_SAMPLING_IN_PROGRESS/,
    );
    await assert.rejects(
      () => reviewJobs.completeReviewSampling(root, "f", first.state.revision, created.batch.batchId, secondJob.jobId, first.requestId, completion("wrong job"), at),
      /REVIEW_SAMPLING_REQUEST_REPLAY/,
    );

    const firstSubmitted = await reviewJobs.completeReviewSampling(
      root, "f", first.state.revision, created.batch.batchId, firstJob.jobId, first.requestId, completion("requirements covered"), at,
    );
    assert.equal(firstSubmitted.batch.executionMode, "mcp-sampling");
    assert.equal(firstSubmitted.batch.assuranceLevel, "multi-perspective");
    await assert.rejects(
      () => reviewJobs.completeReviewSampling(root, "f", firstSubmitted.state.revision, created.batch.batchId, firstJob.jobId, first.requestId, completion("requirements covered"), at),
      /REVIEW_SAMPLING_REQUEST_REPLAY/,
    );

    const second = await reviewJobs.beginReviewSampling(root, "f", firstSubmitted.state.revision, created.batch.batchId, secondJob.jobId, at);
    const complete = await reviewJobs.completeReviewSampling(
      root, "f", second.state.revision, created.batch.batchId, secondJob.jobId, second.requestId, completion("architecture covered"), at,
    );
    assert.equal(complete.batch.progress, "complete");
    assert.equal(complete.batch.assuranceLevel, "independent-sampling");
    const persisted = await reviewStore.readReviewLedger(root, complete.state);
    assert.equal(JSON.stringify(persisted).includes(first.requestId), false, "plaintext sampling request must not enter a snapshot");
    assert.equal(persisted.batches.at(-1).jobs.every((job) => job.submission?.samplingProvenance), true);
  });
});

test("failed and expired sampling attempts burn their request, return pending, and cannot upgrade a manual submission", async () => {
  await withRoot(async (root) => {
    const initial = await reviewReadyFeature(root);
    const created = await reviewJobs.createReviewBatch(root, "f", initial.revision);
    const [firstJob, secondJob] = created.batch.jobs;
    const at = new Date("2026-07-30T00:00:00.000Z");

    const failedStart = await reviewJobs.beginReviewSampling(root, "f", created.state.revision, created.batch.batchId, firstJob.jobId, at);
    const afterFailure = await reviewJobs.failReviewSampling(
      root, "f", failedStart.state.revision, created.batch.batchId, firstJob.jobId, failedStart.requestId, "invalid-response", at,
    );
    let ledger = await reviewStore.readReviewLedger(root, afterFailure);
    let failedJob = ledger.batches.at(-1).jobs.find((job) => job.jobId === firstJob.jobId);
    assert.equal(failedJob.status, "pending");
    assert.equal(failedJob.samplingAttempts.at(-1).failureCode, "invalid-response");
    await assert.rejects(
      () => reviewJobs.failReviewSampling(root, "f", afterFailure.revision, created.batch.batchId, firstJob.jobId, failedStart.requestId, "client-error", at),
      /REVIEW_SAMPLING_REQUEST_REPLAY/,
    );

    const claimed = await reviewJobs.claimReviewJob(
      root, "f", afterFailure.revision, created.batch.batchId, firstJob.jobId, "claim-1234567890-manual-after-sampling-failure", at,
    );
    const manual = await reviewJobs.submitReviewJob(
      root, "f", claimed.state.revision, created.batch.batchId, firstJob.jobId, claimed.capability, completion("manual review"), at,
    );
    assert.equal(manual.batch.assuranceLevel, "multi-perspective");
    assert.equal(manual.batch.jobs.find((job) => job.jobId === firstJob.jobId).submission.samplingProvenance, undefined);

    const timed = await reviewJobs.beginReviewSampling(root, "f", manual.state.revision, created.batch.batchId, secondJob.jobId, at);
    const recovered = await reviewJobs.beginReviewSampling(
      root, "f", timed.state.revision, created.batch.batchId, secondJob.jobId, new Date(at.getTime() + 120_001),
    );
    assert.notEqual(recovered.requestId, timed.requestId);
    ledger = await reviewStore.readReviewLedger(root, recovered.state);
    failedJob = ledger.batches.at(-1).jobs.find((job) => job.jobId === secondJob.jobId);
    assert.equal(failedJob.samplingAttempts.some((attempt) => attempt.requestSha256 === recovered.job.samplingAttempts.at(-2).requestSha256 && attempt.failureCode === "timeout"), true);
    await assert.rejects(
      () => reviewJobs.completeReviewSampling(root, "f", recovered.state.revision, created.batch.batchId, secondJob.jobId, timed.requestId, completion("late response"), at),
      /REVIEW_SAMPLING_REQUEST_REPLAY/,
    );
  });
});

test("forged or cross-batch sampling request IDs can never complete a job", async () => {
  await withRoot(async (root) => {
    let state = await reviewReadyFeature(root);
    const created = await reviewJobs.createReviewBatch(root, "f", state.revision);
    const job = created.batch.jobs[0];
    const at = new Date("2026-07-30T00:00:00.000Z");
    const started = await reviewJobs.beginReviewSampling(root, "f", created.state.revision, created.batch.batchId, job.jobId, at);
    await assert.rejects(
      () => reviewJobs.completeReviewSampling(root, "f", started.state.revision, created.batch.batchId, job.jobId, "forged-server-request-id", completion("forged"), at),
      /REVIEW_SAMPLING_REQUEST_REPLAY/,
    );
    state = await registerTraceFixture({
      root,
      featureId: "f",
      state: started.state,
      kind: "requirements",
      edit: (markdown) => `${markdown}\n- stale sampling batch\n`,
    });
    await assert.rejects(
      () => reviewJobs.completeReviewSampling(root, "f", state.revision, created.batch.batchId, job.jobId, started.requestId, completion("cross batch"), at),
      /REVIEW_SAMPLING_REQUEST_REPLAY/,
    );
  });
});
