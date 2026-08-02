import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { loadSource } from "../../helpers/load-source.mjs";
import { claimCapability, prepareReviewReadyFeature } from "../../helpers/route-flow.mjs";

const store = await loadSource("plugins/dev-flow/src/core/state-store.ts");
const gates = await loadSource("plugins/dev-flow/src/core/human-gates.ts");
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

test("Codex creates a light L feature and Claude consumes later approval", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "dev-flow-interop-"));
  try {
    await store.initProject(root, config);
    let s = await store.startFeature(root, { featureId: "f", level: "L", topology: "multi-chain", execution: "light", host: "codex" });
    const artifacts = await loadSource("plugins/dev-flow/src/core/artifacts.ts");
    s = await artifacts.scaffoldArtifact(root, "f", s.revision, "boundary-card");
    s = await checks.recordStep(root, "f", s.revision, "boundary", {});
    s = await artifacts.scaffoldArtifact(root, "f", s.revision, "rollback-safety");
    s = await checks.recordStep(root, "f", s.revision, "rollback_safety", {});
    s = await gates.presentGate(root, "f", s.revision, "implementation_approval");
    await store.recordHostEvent(root, { eventId: "claude-turn-2", type: "turn-boundary", host: "claude" });
    s = await gates.confirmGate(root, "f", s.revision, "implementation_approval", "批准实现", { turnBoundaryEventId: "claude-turn-2" }, "claude");
    assert.equal(s.humanGates.implementation_approval.confirmation.host, "claude");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("Codex and Claude split standard M review jobs without sibling finding leakage", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "dev-flow-interop-codex-claude-"));
  try {
    await mkdir(path.join(root, "src"), { recursive: true });
    await writeFile(path.join(root, "src", "main.js"), "export {}\n");
    let state = await prepareReviewReadyFeature(root, {
      level: "M", topology: "local", execution: "standard", requirements: "provided-confirmed",
    }, { featureId: "f", host: "codex", config });
    const created = await reviewJobs.createReviewBatch(root, "f", state.revision);
    state = created.state;
    const [codexJob, claudeJob] = created.batch.jobs;
    const codexCap = claimCapability(codexJob.jobId, "codex");
    const claudeCap = claimCapability(claudeJob.jobId, "claude");

    let claimed = await reviewJobs.claimReviewJob(root, "f", state.revision, created.batch.batchId, codexJob.jobId, codexCap);
    state = (await reviewJobs.submitReviewJob(
      root, "f", claimed.state.revision, created.batch.batchId, codexJob.jobId, codexCap,
      {
        coverageSummary: "Codex role complete",
        findings: [{
          severity: "note",
          category: codexJob.role,
          targets: ["src"],
          evidence: [{ path: "src/main.js", line: 1 }],
          claim: "Optional note from Codex role.",
          recommendation: "No action required.",
        }],
      },
    )).state;

    // Claude must not learn Codex findings from next/status while the batch is open.
    const midStatus = await status.readStatusView(root, "f");
    assert.equal(midStatus.reviewStatus.projection.batch.visibility, "coarse");
    assert.equal(midStatus.reviewStatus.projection.batch.findings, undefined);
    assert.equal(midStatus.progress.nextAction.kind, "review-jobs-pending");
    assert.equal(
      midStatus.progress.nextAction.jobs.every((job) => !("findings" in job) && !("submission" in job)),
      true,
    );
    await assert.rejects(
      () => reviewJobs.getReviewJob(root, "f", created.batch.batchId, codexJob.jobId, claudeCap),
      /REVIEW_JOB_CAPABILITY_INVALID/,
    );

    claimed = await reviewJobs.claimReviewJob(root, "f", state.revision, created.batch.batchId, claudeJob.jobId, claudeCap);
    // MCP-style retry with the same capability and payload is idempotent.
    const payload = { coverageSummary: "Claude role complete", findings: [] };
    let submitted = await reviewJobs.submitReviewJob(
      root, "f", claimed.state.revision, created.batch.batchId, claudeJob.jobId, claudeCap, payload,
    );
    state = submitted.state;
    submitted = await reviewJobs.submitReviewJob(
      root, "f", state.revision, created.batch.batchId, claudeJob.jobId, claudeCap, payload,
    );
    assert.equal(submitted.idempotent, true);
    state = submitted.state;

    const complete = await projection.readReviewProjection(root, state);
    assert.equal(complete.model.batch.visibility, "complete");
    assert.equal(complete.model.assurance.level, "multi-perspective");
    assert.equal(complete.model.batch.findings.length, 1);
    assert.equal(complete.model.batch.findings[0].severity, "note");
    // Dual-host job execution is collaboration evidence only, never multi-agent attestation.
    assert.notEqual(complete.model.assurance.level, "multi-agent-attested");
    state = await checks.recordStep(root, "f", state.revision, "plan_review", {});
    assert.deepEqual(state.steps.plan_review.evidence.assuranceLevel, "multi-perspective");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
