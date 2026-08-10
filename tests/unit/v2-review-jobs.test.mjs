import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { loadSource } from "../helpers/load-source.mjs";
import { completeReviewJobs, prepareReviewReadyFeature } from "../helpers/route-flow.mjs";
import { registerTraceFixture } from "../helpers/trace-fixtures.mjs";

const review = await loadSource("plugins/dev-flow/src/policy/review.ts");
const jobs = await loadSource("plugins/dev-flow/src/core/review-jobs.ts");
const reviewStore = await loadSource("plugins/dev-flow/src/core/review-store.ts");

test("review store hard-rejects the 4.x ledger schema", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "dev-flow-review-v1-"));
  try {
    const contents = `${JSON.stringify({ schemaVersion: 1, featureId: "legacy" })}\n`;
    const sha256 = createHash("sha256").update(contents).digest("hex");
    const relative = `review/snapshots/${sha256}.json`;
    await mkdir(path.join(root, ".dev-flow", "features", "legacy", "review", "snapshots"), { recursive: true });
    await writeFile(path.join(root, ".dev-flow", "features", "legacy", relative), contents);
    await assert.rejects(
      () => reviewStore.readReviewLedger(root, {
        featureId: "legacy",
        revision: 1,
        review: { path: relative, sha256, revision: 0, summary: { batches: 0, current: 0, stale: 0, open: 0, complete: 0 } },
      }),
      (error) => error.code === "UNSUPPORTED_REVIEW_SCHEMA",
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

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

test("risk acceptance evidence requires matching host, compatible reply, and later timestamp", () => {
  const interaction = { presentedAt: "2026-08-04T10:00:00.000Z" };
  const event = {
    revision: 4,
    at: "2026-08-04T10:01:00.000Z",
    data: { eventId: "prompt-1", host: "codex", type: "user-prompt", text: "接受风险" },
  };
  assert.doesNotThrow(() => jobs.assertReviewRiskAcceptanceEvidence(event, interaction, "prompt-1", "接受风险", "codex"));
  assert.doesNotThrow(() => jobs.assertReviewRiskAcceptanceEvidence(event, interaction, "prompt-1", "接受风险 ", "codex"), "归一化后相等（尾随空格）应兼容");
  assert.doesNotThrow(() => jobs.assertReviewRiskAcceptanceEvidence(event, interaction, "prompt-1", "接受风险（推荐）", "codex"), "展示后缀应兼容");
  assert.throws(() => jobs.assertReviewRiskAcceptanceEvidence(event, interaction, "prompt-1", "不接受风险", "codex"), /REVIEW_RISK_ACCEPTANCE_REPLY_MISMATCH/, "否定前缀不得被误判为兼容");
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

test("a requirements-only semantic diff reuses unaffected architecture and rollback roles", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "dev-flow-review-role-reuse-"));
  try {
    let state = await prepareReviewReadyFeature(root, {
      level: "M",
      topology: "shared-contract",
      requirements: "provided-confirmed",
      scopeFacts: ["共享契约需求"],
      topologyFacts: ["共享契约"],
      uncertaintyFacts: [],
      riskFacts: {},
      decisionRefs: [],
    }, { featureId: "reuse" });
    const first = await jobs.createReviewBatch(root, state.featureId, state.revision);
    state = (await completeReviewJobs(root, state.featureId, first.state, first.batch)).state;

    state = await registerTraceFixture({
      root,
      featureId: state.featureId,
      state,
      kind: "requirements",
      edit: (markdown) => `${markdown}\n补充说明：不改变任务、测试、契约或恢复语义。\n`,
    });
    const second = await jobs.createReviewBatch(root, state.featureId, state.revision);
    const byRole = Object.fromEntries(second.batch.jobs.map((job) => [job.role, job]));
    assert.equal(byRole["requirements-coverage"].status, "pending");
    assert.equal(byRole["architecture-testability"].status, "reused");
    assert.equal(byRole["rollback-operability"].status, "reused");
    assert.equal(second.batch.executionMode, "parallel-safe");
    assert.ok(byRole["architecture-testability"].reusedFrom);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
