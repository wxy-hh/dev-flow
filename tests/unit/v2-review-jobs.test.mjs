import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { loadSource } from "../helpers/load-source.mjs";
import { prepareReviewReadyFeature } from "../helpers/route-flow.mjs";

const review = await loadSource("plugins/dev-flow/src/policy/review.ts");
const jobs = await loadSource("plugins/dev-flow/src/core/review-jobs.ts");

test("public review jobs expose lease timestamps but never capability hashes", () => {
  const job = review.toPublicReviewJob({
    jobId: "job",
    role: "rollback-operability",
    reviewDepth: "standard",
    packageSha256: "a".repeat(64),
    status: "claimed",
    claim: { requestSha256: "b".repeat(64), claimedAt: "2026-08-03T00:00:00.000Z", leaseExpiresAt: "2026-08-03T01:00:00.000Z" },
    samplingAttempts: [{ requestSha256: "c".repeat(64), issuedAt: "2026-08-03T00:00:00.000Z", leaseExpiresAt: "2026-08-03T00:01:00.000Z", status: "submitted" }],
    submission: {
      payloadSha256: "d".repeat(64),
      coverageSummary: "ok",
      findings: [],
      resolutions: [],
      submittedAt: "2026-08-03T00:02:00.000Z",
      samplingProvenance: { requestSha256: "e".repeat(64), issuedAt: "2026-08-03T00:00:00.000Z", completedAt: "2026-08-03T00:02:00.000Z" },
    },
  });

  assert.deepEqual(job.lease, { claimedAt: "2026-08-03T00:00:00.000Z", leaseExpiresAt: "2026-08-03T01:00:00.000Z" });
  assert.equal("claim" in job, false);
  assert.equal("requestSha256" in job, false);
  assert.equal("requestSha256" in job.samplingAttempts[0], false);
  assert.equal("requestSha256" in job.submission.samplingProvenance, false);
});

test("risk acceptance evidence requires matching host, exact reply, and later timestamp", () => {
  const interaction = { presentedAt: "2026-08-04T10:00:00.000Z" };
  const event = {
    revision: 4,
    at: "2026-08-04T10:01:00.000Z",
    data: { eventId: "prompt-1", host: "codex", type: "user-prompt", text: "接受风险" },
  };
  assert.doesNotThrow(() => jobs.assertReviewRiskAcceptanceEvidence(event, interaction, "prompt-1", "接受风险", "codex"));
  assert.throws(() => jobs.assertReviewRiskAcceptanceEvidence(event, interaction, "prompt-1", "接受风险 ", "codex"), /REVIEW_RISK_ACCEPTANCE_REPLY_MISMATCH/);
  assert.throws(() => jobs.assertReviewRiskAcceptanceEvidence(event, interaction, "prompt-1", "接受风险", "claude"), /HOST_EVENT_HOST_MISMATCH/);
  assert.throws(() => jobs.assertReviewRiskAcceptanceEvidence({ ...event, at: "2026-08-04T09:59:00.000Z" }, interaction, "prompt-1", "接受风险", "codex"), /REVIEW_RISK_ACCEPTANCE_SAME_TURN/);
});

test("the original capability can release a claimed job and a new claim can recover it", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "dev-flow-review-release-"));
  try {
    const state = await prepareReviewReadyFeature(root, {
      level: "M",
      topology: "shared-contract",
      execution: "standard",
      requirements: "provided-confirmed",
      scopeFacts: ["scope"],
      topologyFacts: ["topology"],
      uncertaintyFacts: [],
      riskFacts: {},
      decisionRefs: [],
    }, { featureId: "release" });
    const created = await jobs.createReviewBatch(root, state.featureId, state.revision);
    const job = created.batch.jobs[0];
    const capability = "claim-release-capability-1234567890";
    const claimed = await jobs.claimReviewJob(root, state.featureId, created.state.revision, created.batch.batchId, job.jobId, capability);
    assert.ok(claimed.job.lease);
    const released = await jobs.releaseReviewJob(root, state.featureId, claimed.state.revision, created.batch.batchId, job.jobId, capability);
    assert.equal(released.job.status, "pending");
    assert.equal(released.job.lease, undefined);
    const reclaimed = await jobs.claimReviewJob(root, state.featureId, released.state.revision, created.batch.batchId, job.jobId, "claim-new-capability-1234567890");
    assert.equal(reclaimed.job.status, "claimed");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
