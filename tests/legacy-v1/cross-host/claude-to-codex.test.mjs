import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { loadSource } from "../../helpers/load-source.mjs";
import { registerTraceFixture } from "../../helpers/trace-fixtures.mjs";
import { assertNext, claimCapability, prepareReviewReadyFeature } from "../../helpers/route-flow.mjs";

const store = await loadSource("plugins/dev-flow/src/core/state-store.ts");
const gates = await loadSource("plugins/dev-flow/src/core/human-gates.ts");
const artifacts = await loadSource("plugins/dev-flow/src/core/artifacts.ts");
const checks = await loadSource("plugins/dev-flow/src/core/feature-check.ts");
const reviewJobs = await loadSource("plugins/dev-flow/src/core/review-jobs.ts");
const projection = await loadSource("plugins/dev-flow/src/core/review-projection.ts");
const status = await loadSource("plugins/dev-flow/src/core/status.ts");
const config = {
  schemaVersion: 1,
  verification: { commands: [{ id: "unit", command: "node", args: ["--test"], cwd: "." }], behaviorCommands: [] },
  enforcement: { mode: "strict", gitWriteRequiresLogicComplete: true, oneActiveFeature: true, requireExplicitHumanReply: true },
  protectedRoots: ["src"],
};

test("Claude creates a standard M feature and Codex confirms the next user turn after multi-perspective review", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "dev-flow-interop-"));
  try {
    await mkdir(path.join(root, "src"), { recursive: true });
    await writeFile(path.join(root, "src", "main.js"), "export {}\n");
    await store.initProject(root, config);
    let state = await store.startFeature(root, {
      featureId: "f", level: "M", topology: "local", execution: "standard", requirements: "provided-confirmed", host: "claude",
    });
    state = await artifacts.scaffoldArtifact(root, "f", state.revision, "requirements");
    state = await registerTraceFixture({ root, featureId: "f", state, kind: "requirements" });
    state = await checks.recordStep(root, "f", state.revision, "requirements", {});
    state = await gates.presentGate(root, "f", state.revision, "requirement_confirmation");
    await store.recordHostEvent(root, { eventId: "claude-later-turn", type: "user-prompt", host: "claude", text: "确认需求" });
    state = await gates.confirmGate(root, "f", state.revision, "requirement_confirmation", "确认需求", { promptEventId: "claude-later-turn" }, "claude");
    state = await artifacts.scaffoldArtifact(root, "f", state.revision, "implementation-plan");
    state = await registerTraceFixture({ root, featureId: "f", state, kind: "implementation-plan" });
    state = await checks.recordStep(root, "f", state.revision, "implementation_plan", {});
    state = await artifacts.scaffoldArtifact(root, "f", state.revision, "coverage-matrix");
    state = await registerTraceFixture({ root, featureId: "f", state, kind: "coverage-matrix" });
    state = await checks.recordStep(root, "f", state.revision, "coverage_review", {});
    state = await checks.recordStep(root, "f", state.revision, "rollback_unit", {});

    await assertNext(root, "f", { kind: "create-review-batch", step: "plan_review" });
    const batch = await reviewJobs.createReviewBatch(root, "f", state.revision);
    state = batch.state;
    // Dual-host collaboration: Claude and Codex each claim a different role.
    // This proves cross-host job handoff, not multi-agent identity attestation.
    const [claudeJob, codexJob] = batch.batch.jobs;
    const claudeCap = claimCapability(claudeJob.jobId, "claude");
    const codexCap = claimCapability(codexJob.jobId, "codex");
    let claimed = await reviewJobs.claimReviewJob(root, "f", state.revision, batch.batch.batchId, claudeJob.jobId, claudeCap);
    state = (await reviewJobs.submitReviewJob(
      root, "f", claimed.state.revision, batch.batch.batchId, claudeJob.jobId, claudeCap,
      { coverageSummary: `${claudeJob.role} review complete on Claude`, findings: [] },
    )).state;
    // Incomplete batch must not leak sibling findings through status/projection.
    const mid = await status.readStatusView(root, "f");
    assert.equal(mid.reviewStatus.projection.batch.visibility, "coarse");
    assert.equal(mid.reviewStatus.projection.batch.findings, undefined);
    assert.equal(mid.progress.nextAction.kind, "review-jobs-pending");
    for (const job of mid.progress.nextAction.jobs) {
      assert.equal("findings" in job, false);
      assert.equal("submission" in job, false);
    }
    await assert.rejects(
      () => reviewJobs.getReviewJob(root, "f", batch.batch.batchId, codexJob.jobId, claudeCap),
      /REVIEW_JOB_CAPABILITY_INVALID/,
    );

    claimed = await reviewJobs.claimReviewJob(root, "f", state.revision, batch.batch.batchId, codexJob.jobId, codexCap);
    // Submit retry is idempotent and must not permanently block the route.
    const payload = { coverageSummary: `${codexJob.role} review complete on Codex`, findings: [] };
    let submitted = await reviewJobs.submitReviewJob(
      root, "f", claimed.state.revision, batch.batch.batchId, codexJob.jobId, codexCap, payload,
    );
    state = submitted.state;
    submitted = await reviewJobs.submitReviewJob(
      root, "f", state.revision, batch.batch.batchId, codexJob.jobId, codexCap, payload,
    );
    assert.equal(submitted.idempotent, true);
    state = submitted.state;

    const completeProjection = await projection.readReviewProjection(root, state);
    assert.equal(completeProjection.model.assurance.level, "multi-perspective");
    assert.equal(completeProjection.model.batch.visibility, "complete");
    assert.notEqual(completeProjection.model.assurance.level, "multi-agent-attested");
    assert.notEqual(completeProjection.model.assurance.level, "multi-agent-verified");

    state = await checks.recordStep(root, "f", state.revision, "plan_review", {});
    state = await artifacts.scaffoldArtifact(root, "f", state.revision, "status");
    state = await gates.presentGate(root, "f", state.revision, "implementation_approval");
    await store.recordHostEvent(root, { eventId: "codex-later-turn", type: "user-prompt", host: "codex", text: "批准实现" });
    state = await gates.confirmGate(root, "f", state.revision, "implementation_approval", "批准实现", { promptEventId: "codex-later-turn" }, "codex");
    assert.equal(state.lastUpdatedBy.host, "codex");
    assert.equal(state.humanGates.implementation_approval.confirmation.host, "codex");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("cross-host claim timeout recovers without leaking sibling packages", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "dev-flow-interop-lease-"));
  try {
    await mkdir(path.join(root, "src"), { recursive: true });
    await writeFile(path.join(root, "src", "main.js"), "export {}\n");
    let state = await prepareReviewReadyFeature(root, {
      level: "M", topology: "local", execution: "standard", requirements: "provided-confirmed",
    }, { featureId: "f", host: "claude", config });
    const created = await reviewJobs.createReviewBatch(root, "f", state.revision);
    state = created.state;
    const job = created.batch.jobs[0];
    const sibling = created.batch.jobs[1];
    const at = new Date("2026-07-29T00:00:00.000Z");
    const claudeCap = claimCapability(job.jobId, "claude-expired");
    const claimed = await reviewJobs.claimReviewJob(root, "f", state.revision, created.batch.batchId, job.jobId, claudeCap, at);
    state = claimed.state;
    // Sibling host cannot read Claude's package with a foreign capability.
    await assert.rejects(
      () => reviewJobs.getReviewJob(root, "f", created.batch.batchId, job.jobId, claimCapability(sibling.jobId, "codex")),
      /REVIEW_JOB_CAPABILITY_INVALID/,
    );
    await assert.rejects(
      () => reviewJobs.submitReviewJob(
        root, "f", state.revision, created.batch.batchId, job.jobId, claudeCap,
        { coverageSummary: "late", findings: [] },
        new Date(at.getTime() + 60 * 60 * 1000),
      ),
      /REVIEW_JOB_LEASE_EXPIRED/,
    );
    // After lease expiry, Codex can reclaim and continue the route.
    const codexCap = claimCapability(job.jobId, "codex-reclaim");
    const recovered = await reviewJobs.claimReviewJob(
      root, "f", state.revision, created.batch.batchId, job.jobId, codexCap,
      new Date(at.getTime() + 60 * 60 * 1000 + 1),
    );
    assert.equal(recovered.idempotent, false);
    state = (await reviewJobs.submitReviewJob(
      root, "f", recovered.state.revision, created.batch.batchId, job.jobId, codexCap,
      { coverageSummary: "recovered on Codex", findings: [] },
      new Date(at.getTime() + 60 * 60 * 1000 + 1),
    )).state;
    const otherCap = claimCapability(sibling.jobId, "claude-other");
    const otherClaim = await reviewJobs.claimReviewJob(root, "f", state.revision, created.batch.batchId, sibling.jobId, otherCap);
    state = (await reviewJobs.submitReviewJob(
      root, "f", otherClaim.state.revision, created.batch.batchId, sibling.jobId, otherCap,
      { coverageSummary: "sibling complete", findings: [] },
    )).state;
    const view = await projection.readReviewProjection(root, state);
    assert.equal(view.model.batch.progress, "complete");
    assert.equal(view.model.assurance.level, "multi-perspective");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
