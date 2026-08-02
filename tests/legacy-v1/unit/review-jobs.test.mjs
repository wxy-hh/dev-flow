import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { strictProjectConfig } from "../helpers/fixture-repo.mjs";
import { loadSource } from "../helpers/load-source.mjs";
import { registerTraceFixture } from "../helpers/trace-fixtures.mjs";

const reviewStore = await loadSource("plugins/dev-flow/src/core/review-store.ts");
const stateStore = await loadSource("plugins/dev-flow/src/core/state-store.ts");
const reviewJobs = await loadSource("plugins/dev-flow/src/core/review-jobs.ts");
const digest = (value) => createHash("sha256").update(value).digest("hex");

async function withRoot(run) {
  const root = await mkdtemp(path.join(os.tmpdir(), "dev-flow-review-jobs-"));
  try {
    return await run(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

test("review ledger snapshots are immutable and content addressed", async () => {
  await withRoot(async (root) => {
    await mkdir(path.join(root, ".dev-flow/features/f"), { recursive: true });
    const ledger = reviewStore.emptyReviewLedger("f", 0);
    const first = await reviewStore.writeReviewSnapshot(root, ledger);
    const second = await reviewStore.writeReviewSnapshot(root, ledger);
    assert.deepEqual(second, first);
    assert.match(first.path, /^review\/snapshots\/[a-f0-9]{64}\.json$/);
    assert.equal(digest(await readFile(path.join(root, ".dev-flow/features/f", first.path))), first.sha256);
  });
});

test("Task 4 starts new standard features with a review:1 pointer while snapshots remain integrity checked", async () => {
  await withRoot(async (root) => {
    await stateStore.initProject(root, strictProjectConfig);
    const state = await stateStore.startFeature(root, {
      featureId: "standard",
      host: "codex",
      level: "M",
      topology: "local",
      execution: "standard",
      requirements: "provided-confirmed",
    });
    assert.equal(state.workflowCapabilities.review, 1);
    assert.ok(state.review);
    const ledger = await reviewStore.readReviewLedger(root, state);
    assert.deepEqual(ledger, reviewStore.emptyReviewLedger("standard", state.revision));
    await assert.rejects(
      () => reviewStore.readReviewLedger(root, { ...state, review: { ...state.review, sha256: "b".repeat(64) } }),
      /REVIEW_INTEGRITY_FAILED/,
    );
    assert.throws(
      () => stateStore.validateFeatureState({ ...state, review: undefined }),
      /review-enabled standard feature requires a review pointer/,
    );
  });
});

test("legacy and light features do not require a review pointer", async () => {
  await withRoot(async (root) => {
    await stateStore.initProject(root, strictProjectConfig);
    const light = await stateStore.startFeature(root, { featureId: "light", host: "codex", level: "M", topology: "local", execution: "light" });
    assert.equal(light.review, undefined);
    const legacy = { ...light, route: "standard-m", workflowCapabilities: undefined };
    assert.doesNotThrow(() => stateStore.validateFeatureState(legacy));
  });
});

async function reviewReadyFeature(root) {
  await stateStore.initProject(root, strictProjectConfig);
  let state = await stateStore.startFeature(root, {
    featureId: "f", host: "codex", level: "M", topology: "local", execution: "standard", requirements: "provided-confirmed",
  });
  const pointer = await reviewStore.writeReviewSnapshot(root, reviewStore.emptyReviewLedger("f", state.revision + 1));
  state = await stateStore.mutate(root, "f", state.revision, "review-test-pointer", (draft) => {
    draft.workflowCapabilities = { trace: 1, review: 1, checkpoints: 0, rollbackExecution: 0 };
    draft.review = pointer;
  });
  state = await registerTraceFixture({ root, featureId: "f", state, kind: "requirements" });
  state = await stateStore.mutate(root, "f", state.revision, "review-test-requirements", (draft) => {
    draft.steps.requirements = { status: "satisfied" };
    draft.steps.requirement_confirmation = { status: "satisfied" };
  });
  state = await registerTraceFixture({ root, featureId: "f", state, kind: "implementation-plan" });
  state = await stateStore.mutate(root, "f", state.revision, "review-test-plan", (draft) => {
    draft.steps.implementation_plan = { status: "satisfied" };
  });
  return registerTraceFixture({ root, featureId: "f", state, kind: "coverage-matrix" });
}

test("Core creates an immutable basis-bound batch, isolates packages, and creates idempotently", async () => {
  await withRoot(async (root) => {
    const state = await reviewReadyFeature(root);
    const first = await reviewJobs.createReviewBatch(root, "f", state.revision);
    assert.equal(first.created, true);
    assert.equal(first.batch.assuranceLevel, "multi-perspective");
    assert.deepEqual(first.batch.jobs.map((job) => job.role), ["requirements-coverage", "architecture-testability"]);
    assert.match(first.batch.basisHash, /^[a-f0-9]{64}$/);
    const retried = await reviewJobs.createReviewBatch(root, "f", first.state.revision);
    assert.equal(retried.created, false);
    assert.equal(retried.batch.batchId, first.batch.batchId);
    await assert.rejects(
      () => reviewJobs.getReviewJob(root, "f", first.batch.batchId, first.batch.jobs[0].jobId, "not-a-capability"),
      /REVIEW_JOB_CAPABILITY_INVALID/,
    );
  });
});

test("claim and submit use opaque capabilities, expire leases, and are idempotent by canonical payload", async () => {
  await withRoot(async (root) => {
    let state = await reviewReadyFeature(root);
    const created = await reviewJobs.createReviewBatch(root, "f", state.revision);
    state = created.state;
    const job = created.batch.jobs[0];
    const capability = "claim-1234567890-abcdefghijklmnopqrstuv";
    const at = new Date("2026-07-29T00:00:00.000Z");
    const claimed = await reviewJobs.claimReviewJob(root, "f", state.revision, created.batch.batchId, job.jobId, capability, at);
    state = claimed.state;
    assert.equal(claimed.idempotent, false);
    const jobView = await reviewJobs.getReviewJob(root, "f", created.batch.batchId, job.jobId, capability);
    assert.equal(jobView.package.role, job.role);
    const retriedClaim = await reviewJobs.claimReviewJob(root, "f", state.revision, created.batch.batchId, job.jobId, capability, at);
    assert.equal(retriedClaim.idempotent, true);
    const payload = { findings: [], coverageSummary: "Reviewed current requirements and plan." };
    const submitted = await reviewJobs.submitReviewJob(root, "f", retriedClaim.state.revision, created.batch.batchId, job.jobId, capability, payload, at);
    assert.equal(submitted.idempotent, false);
    const retriedSubmit = await reviewJobs.submitReviewJob(root, "f", submitted.state.revision, created.batch.batchId, job.jobId, capability, { coverageSummary: payload.coverageSummary, findings: [] }, at);
    assert.equal(retriedSubmit.idempotent, true);
    const pending = created.batch.jobs[1];
    const firstClaim = await reviewJobs.claimReviewJob(root, "f", retriedSubmit.state.revision, created.batch.batchId, pending.jobId, "claim-1234567890-zyxwvutsrqponmlkjihgfedc", at);
    await assert.rejects(
      () => reviewJobs.submitReviewJob(root, "f", firstClaim.state.revision, created.batch.batchId, job.jobId, "claim-1234567890-zyxwvutsrqponmlkjihgfedc", payload, at),
      (error) => error.code === "REVIEW_JOB_CAPABILITY_INVALID",
    );
    await assert.rejects(
      () => reviewJobs.submitReviewJob(root, "f", firstClaim.state.revision, created.batch.batchId, pending.jobId, "claim-1234567890-zyxwvutsrqponmlkjihgfedc", payload, new Date(at.getTime() + 60 * 60 * 1000)),
      /REVIEW_JOB_LEASE_EXPIRED/,
    );
    const recovered = await reviewJobs.claimReviewJob(root, "f", firstClaim.state.revision, created.batch.batchId, pending.jobId, "claim-1234567890-newcapabilityabcdefghijkl", new Date(at.getTime() + 60 * 60 * 1000 + 1));
    assert.equal(recovered.idempotent, false);
  });
});

test("job packages freeze artifact and project bytes, and their digest is bound to the job", async () => {
  await withRoot(async (root) => {
    const state = await reviewReadyFeature(root);
    const created = await reviewJobs.createReviewBatch(root, "f", state.revision);
    const job = created.batch.jobs[0];
    const capability = "claim-1234567890-frozenpackagebytesabcdef";
    const claimed = await reviewJobs.claimReviewJob(root, "f", created.state.revision, created.batch.batchId, job.jobId, capability);
    const requirements = path.join(root, ".dev-flow", "features", "f", created.state.artifacts.requirements.path);
    const frozenRequirements = await readFile(requirements, "utf8");
    await writeFile(requirements, `${frozenRequirements}\n- live mutation after batch creation\n`);
    const view = await reviewJobs.getReviewJob(root, "f", created.batch.batchId, job.jobId, capability);
    const packageFile = path.join(root, ".dev-flow", "features", "f", "review", "packages", `${job.packageSha256}.json`);
    assert.equal(digest(await readFile(packageFile)), job.packageSha256);
    assert.equal(view.package.jobId, job.jobId);
    assert.equal(view.package.batchId, created.batch.batchId);
    assert.equal(view.package.basisHash, created.batch.basisHash);
    assert.equal(view.package.frozenArtifacts.find((artifact) => artifact.kind === "requirements").contents, frozenRequirements);
    assert.equal(digest(view.package.projectConfig.contents), created.batch.basis.projectConfigSha256);
    assert.equal(claimed.state.revision, created.state.revision + 1);
  });
});

test("a Trace-backed basis change stales the current batch in the artifact CAS", async () => {
  await withRoot(async (root) => {
    let state = await reviewReadyFeature(root);
    const created = await reviewJobs.createReviewBatch(root, "f", state.revision);
    state = await registerTraceFixture({
      root, featureId: "f", state: created.state, kind: "requirements",
      edit: (markdown) => `${markdown}\n- Review basis revision\n`,
    });
    const ledger = await reviewStore.readReviewLedger(root, state);
    assert.equal(ledger.batches.find((batch) => batch.batchId === created.batch.batchId).validity, "stale");
    await assert.rejects(
      () => reviewJobs.claimReviewJob(root, "f", state.revision, created.batch.batchId, created.batch.jobs[0].jobId, "claim-1234567890-stalebatchcapabilityxyz"),
      /REVIEW_BATCH_STALE/,
    );
    const successor = await reviewJobs.createReviewBatch(root, "f", state.revision);
    assert.equal(successor.created, true);
    assert.notEqual(successor.batch.batchId, created.batch.batchId);
    const successorLedger = await reviewStore.readReviewLedger(root, successor.state);
    assert.deepEqual(successorLedger.summary, { batches: 2, current: 1, stale: 1, open: 2, complete: 0 });
  });
});
