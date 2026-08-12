import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { loadSource } from "../helpers/load-source.mjs";
import { claimCapability, completeReviewJobs, prepareReviewReadyFeature } from "../helpers/route-flow.mjs";

const jobs = await loadSource("plugins/dev-flow/src/core/review-jobs.ts");
const review = await loadSource("plugins/dev-flow/src/policy/review.ts");
const store = await loadSource("plugins/dev-flow/src/core/state-store.ts");
const inspection = await loadSource("plugins/dev-flow/src/core/inspection.ts");

async function setup(prefix, featureId) {
  const root = await mkdtemp(path.join(os.tmpdir(), prefix));
  const state = await prepareReviewReadyFeature(root, {
    level: "M",
    topology: "shared-contract",
    requirements: "provided-confirmed",
    scopeFacts: ["共享契约需求"],
    topologyFacts: ["共享契约"],
    uncertaintyFacts: [],
    riskFacts: {},
    decisionRefs: [],
  }, { featureId });
  return { root, state };
}

function attestation(host, agentId, raw, hostEventId) {
  return { host, agentId, issuedAt: new Date().toISOString(), raw, ...(hostEventId ? { hostEventId } : {}) };
}

test("free-text attestations without source proof never produce a multi-agent label", async () => {
  const { root, state } = await setup("dev-flow-assurance-honest-", "honest");
  try {
    const created = await jobs.createReviewBatch(root, state.featureId, state.revision);
    const roles = created.batch.jobs.map((job) => job.role);
    const completions = Object.fromEntries(roles.map((role, index) => [role, {
      coverageSummary: "reviewed",
      findings: [],
    }]));
    const completed = await completeReviewJobs(root, state.featureId, created.state, created.batch, {
      completions,
      jobHosts: Object.fromEntries(roles.map((role, index) => [role, `host-${index}`])),
    });
    // 无 attestation：多视角，正常推进。
    const ledger = await (await loadSource("plugins/dev-flow/src/core/review-store.ts")).readReviewLedger(root, completed.state);
    const current = ledger.batches.find((batch) => batch.validity === "current");
    assert.equal(current.assuranceLevel, "multi-perspective");
    await jobs.assertReviewComplete(root, completed.state);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("attestations with distinct agentIds and raw hashes but no real host event stay multi-perspective", async () => {
  const { root, state } = await setup("dev-flow-assurance-fake-", "fake-attest");
  try {
    const created = await jobs.createReviewBatch(root, state.featureId, state.revision);
    let current = created.state;
    for (const job of created.batch.jobs) {
      const capability = claimCapability(job.jobId, `host-${job.role}`);
      const claimed = await jobs.claimReviewJob(root, state.featureId, current.revision, created.batch.batchId, job.jobId, capability);
      current = claimed.state;
      const fakeEventId = `fake-event-${job.role}`;
      const submitted = await jobs.submitReviewJob(
        root, state.featureId, current.revision, created.batch.batchId, job.jobId, capability,
        { coverageSummary: "reviewed", findings: [] },
        attestation(job.role === "requirements-coverage" ? "claude" : "codex", `agent-${job.role}`, `raw-${job.role}`, fakeEventId),
      );
      assert.equal(submitted.batch.jobs.find((candidate) => candidate.jobId === job.jobId).submission.attestationSourceVerified, undefined);
      current = submitted.state;
    }
    const ledger = await (await loadSource("plugins/dev-flow/src/core/review-store.ts")).readReviewLedger(root, current);
    const batch = ledger.batches.find((candidate) => candidate.validity === "current");
    // 两个 attestation 但来源未验证：不升档（独立采样也没有）→ 多视角。
    assert.equal(batch.assuranceLevel, "multi-perspective");
    const view = await inspection.inspectFeature(root, state.featureId, "review");
    assert.ok(view.content.currentBatch);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("attestations tied to real host events remain diagnostic without trusted identity verification", async () => {
  const { root, state } = await setup("dev-flow-assurance-real-", "real-attest");
  try {
    const created = await jobs.createReviewBatch(root, state.featureId, state.revision);
    // 只有专用 review-execution 事件能证明审查来源；普通 user-prompt 不再充当凭证。
    const eventByRole = Object.fromEntries(created.batch.jobs.map((job) => [job.role, `real-event-${job.role}`]));
    for (const job of created.batch.jobs) {
      await store.recordReviewExecutionEvent(root, {
        eventId: eventByRole[job.role], type: "review-execution",
        host: job.role === "requirements-coverage" ? "claude" : "codex",
        text: `审查者 ${job.role} 开始审查`, batchId: created.batch.batchId, jobId: job.jobId,
        executionId: `execution-${job.role}`, sourceId: `source-${job.role}`,
        contextId: `context-${job.role}`, implementationContextId: "implementation-context",
      });
    }
    const current0 = await store.readState(root, state.featureId);
    let current = current0;
    for (const job of created.batch.jobs) {
      const capability = claimCapability(job.jobId, `host-${job.role}`);
      const claimed = await jobs.claimReviewJob(root, state.featureId, current.revision, created.batch.batchId, job.jobId, capability);
      current = claimed.state;
      const submitted = await jobs.submitReviewJob(
        root, state.featureId, current.revision, created.batch.batchId, job.jobId, capability,
        { coverageSummary: "reviewed", findings: [] },
        attestation(job.role === "requirements-coverage" ? "claude" : "codex", `agent-${job.role}`, `raw-${job.role}`, eventByRole[job.role]),
      );
      current = submitted.state;
    }
    const ledger = await (await loadSource("plugins/dev-flow/src/core/review-store.ts")).readReviewLedger(root, current);
    const batch = ledger.batches.find((candidate) => candidate.validity === "current");
    const verifiedJobs = batch.jobs.filter((job) => job.submission?.attestationSourceVerified);
    assert.equal(verifiedJobs.length, created.batch.jobs.length);
    assert.equal(batch.assuranceLevel, "multi-perspective");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("isolation proof requires a real host event; free-text isolated claims stay unproven", async () => {
  const { root, state } = await setup("dev-flow-isolation-", "isolation");
  try {
    const created = await jobs.createReviewBatch(root, state.featureId, state.revision);
    const isolatedJob = created.batch.jobs.find((job) => job.role === "requirements-coverage");
    await store.recordReviewExecutionEvent(root, {
      eventId: "isolation-event", type: "review-execution", host: "claude", text: "独立审查者开始",
      batchId: created.batch.batchId, jobId: isolatedJob.jobId, executionId: "isolation-execution",
      sourceId: "isolation-source", contextId: "review-context", implementationContextId: "implementation-context",
    });
    const current0 = await store.readState(root, state.featureId);
    let current = created.state;
    for (const job of created.batch.jobs) {
      const capability = claimCapability(job.jobId, `host-${job.role}`);
      const claimed = await jobs.claimReviewJob(root, state.featureId, current.revision, created.batch.batchId, job.jobId, capability);
      current = claimed.state;
      const realEvent = job.role === "requirements-coverage";
      const submitted = await jobs.submitReviewJob(
        root, state.featureId, current.revision, created.batch.batchId, job.jobId, capability,
        { coverageSummary: "reviewed", findings: [] },
        {
          host: job.role === "requirements-coverage" ? "claude" : "codex",
          agentId: `agent-${job.role}`,
          issuedAt: new Date().toISOString(),
          raw: `raw-${job.role}`,
          hostEventId: realEvent ? "isolation-event" : "fake-isolation-event",
          isolated: true,
        },
      );
      const submission = submitted.batch.jobs.find((candidate) => candidate.jobId === job.jobId).submission;
      if (realEvent) {
        assert.deepEqual(submission.isolationProof, { mode: "subagent", hostEventId: "isolation-event" });
      } else {
        assert.equal(submission.isolationProof, undefined, "fake event cannot prove isolation");
      }
      current = submitted.state;
    }
    const ledger = await (await loadSource("plugins/dev-flow/src/core/review-store.ts")).readReviewLedger(root, current);
    const batch = ledger.batches.find((candidate) => candidate.validity === "current");
    const isolatedJobs = batch.jobs.filter((job) => job.submission?.isolationProof);
    assert.equal(isolatedJobs.length, 1, "only the job tied to the real host event is isolated");
    // 隔离维度与多来源维度独立：1 个隔离 + 1 个未隔离 → 不能升多智能体档。
    assert.equal(batch.assuranceLevel, "multi-perspective");
    const view = await inspection.inspectFeature(root, state.featureId, "review");
    assert.equal(view.content.independence.isolatedJobs.length, 1);
    assert.equal(view.content.independence.assuranceLevel, "multi-perspective");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
