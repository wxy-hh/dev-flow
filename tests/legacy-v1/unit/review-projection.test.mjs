import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { strictProjectConfig } from "../helpers/fixture-repo.mjs";
import { loadSource } from "../helpers/load-source.mjs";
import { registerTraceFixture } from "../helpers/trace-fixtures.mjs";

const artifacts = await loadSource("plugins/dev-flow/src/core/artifacts.ts");
const checks = await loadSource("plugins/dev-flow/src/core/feature-check.ts");
const gateBasis = await loadSource("plugins/dev-flow/src/core/gate-basis.ts");
const gates = await loadSource("plugins/dev-flow/src/core/human-gates.ts");
const next = await loadSource("plugins/dev-flow/src/core/next.ts");
const projection = await loadSource("plugins/dev-flow/src/core/review-projection.ts");
const reviewJobs = await loadSource("plugins/dev-flow/src/core/review-jobs.ts");
const reviewStore = await loadSource("plugins/dev-flow/src/core/review-store.ts");
const stateStore = await loadSource("plugins/dev-flow/src/core/state-store.ts");
const status = await loadSource("plugins/dev-flow/src/core/status.ts");

async function withRoot(run) {
  const root = await mkdtemp(path.join(os.tmpdir(), "dev-flow-review-projection-"));
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
  state = await stateStore.mutate(root, "f", state.revision, "implementation-plan-complete", (draft) => {
    draft.steps.implementation_plan = { status: "satisfied" };
  });
  state = await registerTraceFixture({ root, featureId: "f", state, kind: "coverage-matrix" });
  return stateStore.mutate(root, "f", state.revision, "coverage-complete", (draft) => {
    draft.steps.coverage_review = { status: "satisfied" };
    draft.steps.rollback_unit = { status: "satisfied" };
  });
}

function capability(job, suffix) {
  return `claim-${job.jobId}-review-projection-1234567890-${suffix}`;
}

function blockingFinding(role, claim = "A frozen review finding must stay isolated until all jobs submit.") {
  return {
    severity: "blocking",
    category: role,
    targets: ["src"],
    evidence: [{ path: "src/review-target.js", line: 1 }],
    claim,
    recommendation: "Update the evidence and submit a successor review.",
  };
}

async function submit(root, state, batch, job, completion, suffix) {
  const key = capability(job, suffix);
  const claimed = await reviewJobs.claimReviewJob(root, "f", state.revision, batch.batchId, job.jobId, key);
  return reviewJobs.submitReviewJob(root, "f", claimed.state.revision, batch.batchId, job.jobId, key, completion);
}

async function completeBatch(root, state, batch) {
  let current = state;
  for (const job of batch.jobs) {
    current = (await submit(root, current, batch, job, {
      coverageSummary: `${job.role} complete`, findings: [],
    }, job.role)).state;
  }
  return current;
}

test("review:1 standard M and L features receive a content-addressed Core projection at start", async () => {
  for (const input of [
    { featureId: "m", level: "M", topology: "local" },
    { featureId: "l", level: "L", topology: "multi-chain" },
  ]) {
    await withRoot(async (root) => {
      await stateStore.initProject(root, strictProjectConfig);
      const state = await stateStore.startFeature(root, {
        ...input, host: "codex", execution: "standard", requirements: "provided-confirmed",
      });
      assert.equal(state.workflowCapabilities.review, 1);
      assert.match(state.artifacts["plan-review"].path, /^review\/projections\/[a-f0-9]{64}\.md$/);
      const current = await projection.readReviewProjection(root, state);
      assert.equal(current.model.batch.status, "not-created");
      assert.equal(current.model.batch.visibility, "coarse");
      assert.match(current.markdown, /Waiting for all required jobs/);
    });
  }
});

test("review:1 rejects manual plan-review registration while a legacy review:0 feature keeps its editable contract", async () => {
  await withRoot(async (root) => {
    await stateStore.initProject(root, strictProjectConfig);
    let current = await stateStore.startFeature(root, {
      featureId: "current", host: "codex", level: "L", topology: "multi-chain", execution: "standard", requirements: "provided-confirmed",
    });
    await assert.rejects(
      () => artifacts.recordArtifact(root, "current", current.revision, "plan-review"),
      (error) => error.code === "GENERATED_ARTIFACT_READ_ONLY",
    );

    current = await stateStore.mutate(root, "current", current.revision, "legacy-review-contract", (draft) => {
      delete draft.workflowCapabilities;
      delete draft.review;
      for (const step of ["requirements", "requirement_confirmation", "implementation_plan", "coverage_review", "rollback_unit"]) {
        draft.steps[step] = { status: "satisfied" };
      }
    });
    current = await artifacts.scaffoldArtifact(root, "current", current.revision, "plan-review");
    const reviewPath = path.join(root, ".dev-flow", "features", "current", current.artifacts["plan-review"].path);
    await writeFile(reviewPath, "# Legacy editable plan review\n");
    current = await artifacts.recordArtifact(root, "current", current.revision, "plan-review");
    assert.equal(current.artifacts["plan-review"].path, "计划审核文档.md");
  });
});

test("basis changes atomically stale the projection and revoke an implementation approval", async () => {
  await withRoot(async (root) => {
    let state = await reviewReadyFeature(root);
    const created = await reviewJobs.createReviewBatch(root, "f", state.revision);
    state = await completeBatch(root, created.state, created.batch);
    state = await checks.recordStep(root, "f", state.revision, "plan_review", {});
    const presented = await gates.presentGate(root, "f", state.revision, "implementation_approval");
    const previousProjection = presented.artifacts["plan-review"];
    state = await registerTraceFixture({
      root,
      featureId: "f",
      state: presented,
      kind: "requirements",
      edit: (markdown) => `${markdown}\n- basis changed\n`,
    });
    assert.notEqual(state.artifacts["plan-review"].sha256, previousProjection.sha256);
    assert.equal(state.humanGates.implementation_approval, undefined);
    const current = await projection.readReviewProjection(root, state);
    assert.equal(current.model.batch.status, "not-created");
    assert.equal(current.model.staleBatches.length, 1);
  });
});

test("projection never enters ReviewBasis and a missing or altered projection fails closed", async () => {
  await withRoot(async (root) => {
    let state = await reviewReadyFeature(root);
    const created = await reviewJobs.createReviewBatch(root, "f", state.revision);
    state = await completeBatch(root, created.state, created.batch);
    const ledger = await reviewStore.readReviewLedger(root, state);
    assert.equal(ledger.batches[0].basis.artifacts.some((artifact) => artifact.kind === "plan-review"), false);

    const projectionPath = path.join(root, ".dev-flow", "features", "f", state.artifacts["plan-review"].path);
    await writeFile(projectionPath, `${await readFile(projectionPath, "utf8")}tampered\n`);
    await assert.rejects(
      () => artifacts.assertArtifactCurrent(root, "f", state, "plan-review"),
      (error) => error.code === "ARTIFACT_INTEGRITY_FAILED",
    );
    await assert.rejects(
      () => next.nextAction(root, "f"),
      (error) => error.code === "REVIEW_PROJECTION_INVALID",
    );
    await assert.rejects(
      () => checks.recordStep(root, "f", state.revision, "plan_review", {}),
      (error) => error.code === "REVIEW_PROJECTION_INVALID",
    );
  });
});

test("StatusView and Markdown use the same coarse-to-complete review visibility and bind gate basis to the review pointer", async () => {
  await withRoot(async (root) => {
    let state = await reviewReadyFeature(root);
    const created = await reviewJobs.createReviewBatch(root, "f", state.revision);
    const first = created.batch.jobs[0];
    const isolatedClaim = "This finding must not be visible until the other reviewer submits.";
    state = (await submit(root, created.state, created.batch, first, {
      coverageSummary: "First reviewer found a blocker.", findings: [blockingFinding(first.role, isolatedClaim)],
    }, "first")).state;
    let view = await status.readStatusView(root, "f");
    let current = await projection.readReviewProjection(root, state);
    assert.equal(view.reviewStatus.projection.batch.visibility, "coarse");
    assert.equal(view.reviewStatus.projection.batch.findings, undefined);
    assert.match(current.markdown, /Waiting for all required jobs/);
    assert.doesNotMatch(current.markdown, new RegExp(isolatedClaim));

    for (const job of created.batch.jobs.slice(1)) {
      state = (await submit(root, state, created.batch, job, {
        coverageSummary: `${job.role} complete`, findings: [],
      }, job.role)).state;
    }
    view = await status.readStatusView(root, "f");
    current = await projection.readReviewProjection(root, state);
    assert.equal(view.reviewStatus.projection.batch.visibility, "complete");
    assert.equal(view.reviewStatus.projection.batch.findings[0].claim, isolatedClaim);
    assert.match(current.markdown, new RegExp(isolatedClaim));
    assert.deepEqual(gateBasis.gateBasis(state, "implementation_approval").review, state.review);
  });
});
