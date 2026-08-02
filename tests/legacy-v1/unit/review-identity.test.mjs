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
const projection = await loadSource("plugins/dev-flow/src/core/review-projection.ts");
const reviewPolicy = await loadSource("plugins/dev-flow/src/policy/review.ts");

async function withRoot(run) {
  const root = await mkdtemp(path.join(os.tmpdir(), "dev-flow-review-identity-"));
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
  state = await registerTraceFixture({ root, featureId: "f", state, kind: "requirements" });
  state = await stateStore.mutate(root, "f", state.revision, "requirements-complete", (draft) => {
    draft.steps.requirements = { status: "satisfied" };
    draft.steps.requirement_confirmation = { status: "satisfied" };
  });
  state = await registerTraceFixture({ root, featureId: "f", state, kind: "implementation-plan" });
  state = await stateStore.mutate(root, "f", state.revision, "plan-complete", (draft) => {
    draft.steps.implementation_plan = { status: "satisfied" };
  });
  state = await registerTraceFixture({ root, featureId: "f", state, kind: "coverage-matrix" });
  return stateStore.mutate(root, "f", state.revision, "coverage-complete", (draft) => {
    draft.steps.coverage_review = { status: "satisfied" };
    draft.steps.rollback_unit = { status: "satisfied" };
  });
}

function capability(jobId, suffix) {
  return `claim-${jobId}-identity-1234567890-${suffix}`;
}

function attestation(agentId, raw, host = "codex") {
  return {
    host,
    agentId,
    issuedAt: "2026-07-30T00:00:00.000Z",
    raw,
  };
}

async function submitWithAttestation(root, state, batch, job, agentId, raw, suffix = "a") {
  const key = capability(job.jobId, suffix);
  const claimed = await reviewJobs.claimReviewJob(root, "f", state.revision, batch.batchId, job.jobId, key);
  return reviewJobs.submitReviewJob(
    root, "f", claimed.state.revision, batch.batchId, job.jobId, key,
    { coverageSummary: `${job.role} complete`, findings: [] },
    attestation(agentId, raw),
  );
}

test("two distinct host attestations raise multi-agent-attested and never verified by default", async () => {
  await withRoot(async (root) => {
    let state = await reviewReadyFeature(root);
    const created = await reviewJobs.createReviewBatch(root, "f", state.revision);
    const [first, second] = created.batch.jobs;
    state = (await submitWithAttestation(root, created.state, created.batch, first, "agent-a", "raw-proof-a", "a")).state;
    const complete = await submitWithAttestation(root, state, created.batch, second, "agent-b", "raw-proof-b", "b");
    assert.equal(complete.batch.assuranceLevel, "multi-agent-attested");
    assert.equal(complete.batch.executionMode, "native-subagent");
    assert.notEqual(complete.batch.assuranceLevel, "multi-agent-verified");
    const view = await projection.readReviewProjection(root, complete.state);
    assert.equal(view.model.assurance.level, "multi-agent-attested");
    assert.deepEqual(view.model.assurance.evidenceSources, ["role-jobs", "host-attestation"]);
    assert.match(view.markdown, /multi-agent-attested is host subagent proof, not multi-agent-verified identity/);
  });
});

test("identical attestation raw cannot be reused across jobs and unknown hosts are rejected", async () => {
  await withRoot(async (root) => {
    let state = await reviewReadyFeature(root);
    const created = await reviewJobs.createReviewBatch(root, "f", state.revision);
    const [first, second] = created.batch.jobs;
    state = (await submitWithAttestation(root, created.state, created.batch, first, "agent-a", "shared-raw", "a")).state;
    const key = capability(second.jobId, "reuse");
    const claimed = await reviewJobs.claimReviewJob(root, "f", state.revision, created.batch.batchId, second.jobId, key);
    await assert.rejects(
      () => reviewJobs.submitReviewJob(
        root, "f", claimed.state.revision, created.batch.batchId, second.jobId, key,
        { coverageSummary: "second", findings: [] },
        attestation("agent-b", "shared-raw"),
      ),
      /REVIEW_ATTESTATION_REUSED/,
    );
    await assert.rejects(
      () => reviewJobs.submitReviewJob(
        root, "f", claimed.state.revision, created.batch.batchId, second.jobId, key,
        { coverageSummary: "second", findings: [] },
        { host: "unknown-host", agentId: "x", issuedAt: "2026-07-30T00:00:00.000Z", raw: "proof" },
      ),
      /REVIEW_PROTOCOL_INVALID|INVALID/,
    );
  });
});

test("caller-reported verified or assurance fields cannot raise multi-agent-verified", async () => {
  await withRoot(async (root) => {
    let state = await reviewReadyFeature(root);
    const created = await reviewJobs.createReviewBatch(root, "f", state.revision);
    const [first, second] = created.batch.jobs;
    const key = capability(first.jobId, "verified");
    const claimed = await reviewJobs.claimReviewJob(root, "f", created.state.revision, created.batch.batchId, first.jobId, key);
    await assert.rejects(
      () => reviewJobs.submitReviewJob(
        root, "f", claimed.state.revision, created.batch.batchId, first.jobId, key,
        { coverageSummary: "first", findings: [] },
        {
          host: "codex", agentId: "agent-a", issuedAt: "2026-07-30T00:00:00.000Z", raw: "raw-a",
          verified: true, assuranceLevel: "multi-agent-verified",
        },
      ),
      /REVIEW_PROTOCOL_INVALID/,
    );
    // Same claim capability can still submit a clean attestation after the rejected self-report.
    state = (await reviewJobs.submitReviewJob(
      root, "f", claimed.state.revision, created.batch.batchId, first.jobId, key,
      { coverageSummary: "first", findings: [] },
      attestation("agent-a", "raw-a"),
    )).state;
    const complete = await submitWithAttestation(root, state, created.batch, second, "agent-b", "raw-b", "ok-b");
    assert.equal(complete.batch.assuranceLevel, "multi-agent-attested");
    assert.equal(
      reviewPolicy.assuranceForReviewBatch(complete.batch, reviewPolicy.defaultReviewIdentityVerifier),
      "multi-agent-attested",
    );
    assert.equal(
      reviewPolicy.assuranceForReviewBatch(complete.batch, { verify: () => ({ trusted: true }) }),
      "multi-agent-verified",
    );
  });
});

test("zero or one attestation stays multi-perspective; sampling ladder still works without attestation", async () => {
  await withRoot(async (root) => {
    let state = await reviewReadyFeature(root);
    const created = await reviewJobs.createReviewBatch(root, "f", state.revision);
    const [first, second] = created.batch.jobs;
    state = (await submitWithAttestation(root, created.state, created.batch, first, "agent-a", "only-one", "one")).state;
    const key = capability(second.jobId, "plain");
    const claimed = await reviewJobs.claimReviewJob(root, "f", state.revision, created.batch.batchId, second.jobId, key);
    const complete = await reviewJobs.submitReviewJob(
      root, "f", claimed.state.revision, created.batch.batchId, second.jobId, key,
      { coverageSummary: "plain complete", findings: [] },
    );
    assert.equal(complete.batch.assuranceLevel, "multi-perspective");
    assert.deepEqual(reviewPolicy.evidenceSourcesForReviewBatch(complete.batch), ["role-jobs", "host-attestation"]);
  });
});

test("attestation raw cannot be reused on a successor batch after basis change", async () => {
  await withRoot(async (root) => {
    let state = await reviewReadyFeature(root);
    const firstBatch = await reviewJobs.createReviewBatch(root, "f", state.revision);
    const [firstJob, secondJob] = firstBatch.batch.jobs;
    state = (await submitWithAttestation(root, firstBatch.state, firstBatch.batch, firstJob, "agent-a", "raw-proof-a", "old-a")).state;
    state = (await submitWithAttestation(root, state, firstBatch.batch, secondJob, "agent-b", "raw-proof-b", "old-b")).state;
    assert.equal(state.steps?.plan_review, undefined);
    // Force a basis change so the first batch becomes stale and a successor is created.
    state = await registerTraceFixture({
      root,
      featureId: "f",
      state,
      kind: "requirements",
      edit: (markdown) => `${markdown}\n- successor basis for attestation reuse\n`,
    });
    const successor = await reviewJobs.createReviewBatch(root, "f", state.revision);
    assert.equal(successor.created, true);
    const [nextFirst, nextSecond] = successor.batch.jobs;
    const key = capability(nextFirst.jobId, "succ-a");
    const claimed = await reviewJobs.claimReviewJob(root, "f", successor.state.revision, successor.batch.batchId, nextFirst.jobId, key);
    await assert.rejects(
      () => reviewJobs.submitReviewJob(
        root, "f", claimed.state.revision, successor.batch.batchId, nextFirst.jobId, key,
        { coverageSummary: "reuse old raw", findings: [] },
        attestation("agent-a", "raw-proof-a"),
      ),
      /REVIEW_ATTESTATION_REUSED/,
    );
    // Fresh raws on the successor still work.
    state = (await reviewJobs.submitReviewJob(
      root, "f", claimed.state.revision, successor.batch.batchId, nextFirst.jobId, key,
      { coverageSummary: "fresh a", findings: [] },
      attestation("agent-a", "fresh-raw-a"),
    )).state;
    const complete = await submitWithAttestation(root, state, successor.batch, nextSecond, "agent-b", "fresh-raw-b", "succ-b");
    assert.equal(complete.batch.assuranceLevel, "multi-agent-attested");
  });
});

test("failed sampling then manual attestation can still reach multi-agent-attested", async () => {
  await withRoot(async (root) => {
    let state = await reviewReadyFeature(root);
    const created = await reviewJobs.createReviewBatch(root, "f", state.revision);
    const [first, second] = created.batch.jobs;
    const at = new Date("2026-07-30T00:00:00.000Z");
    const started = await reviewJobs.beginReviewSampling(root, "f", created.state.revision, created.batch.batchId, first.jobId, at);
    state = await reviewJobs.failReviewSampling(
      root, "f", started.state.revision, created.batch.batchId, first.jobId, started.requestId, "invalid-response", at,
    );
    const ledger = await reviewStore.readReviewLedger(root, state);
    assert.equal(ledger.batches.at(-1).executionMode, "mcp-sampling");
    state = (await submitWithAttestation(root, state, created.batch, first, "agent-a", "after-sampling-a", "post-a")).state;
    const complete = await submitWithAttestation(root, state, created.batch, second, "agent-b", "after-sampling-b", "post-b");
    assert.equal(complete.batch.executionMode, "mcp-sampling");
    assert.equal(complete.batch.assuranceLevel, "multi-agent-attested");
    const view = await projection.readReviewProjection(root, complete.state);
    assert.deepEqual(view.model.assurance.evidenceSources, ["role-jobs", "host-attestation"]);
  });
});
