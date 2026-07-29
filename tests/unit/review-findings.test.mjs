import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { strictProjectConfig } from "../helpers/fixture-repo.mjs";
import { loadSource } from "../helpers/load-source.mjs";
import { registerTraceFixture } from "../helpers/trace-fixtures.mjs";

const checks = await loadSource("plugins/dev-flow/src/core/feature-check.ts");
const gates = await loadSource("plugins/dev-flow/src/core/human-gates.ts");
const reviewJobs = await loadSource("plugins/dev-flow/src/core/review-jobs.ts");
const reviewStore = await loadSource("plugins/dev-flow/src/core/review-store.ts");
const stateStore = await loadSource("plugins/dev-flow/src/core/state-store.ts");

async function withRoot(run) {
  const root = await mkdtemp(path.join(os.tmpdir(), "dev-flow-review-findings-"));
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
  assert.equal(state.workflowCapabilities.review, 1);
  assert.ok(state.review);
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

function capability(jobId, suffix = "a") {
  return `claim-${jobId}-capability-1234567890-${suffix}`;
}

function finding(role, overrides = {}) {
  return {
    severity: "blocking",
    category: role,
    targets: ["src"],
    evidence: [{ path: "src/counter.js", line: 1 }],
    claim: "The stated obligation is not demonstrably satisfied.",
    recommendation: "Add the missing evidence and re-review the affected scope.",
    ...overrides,
  };
}

async function submit(root, state, batch, job, completion, suffix = "a") {
  const key = capability(job.jobId, suffix);
  const claimed = await reviewJobs.claimReviewJob(root, "f", state.revision, batch.batchId, job.jobId, key);
  return reviewJobs.submitReviewJob(root, "f", claimed.state.revision, batch.batchId, job.jobId, key, completion);
}

async function completeBatch(root, state, batch, completions) {
  let current = state;
  for (const job of batch.jobs) {
    const completion = completions[job.role] ?? { coverageSummary: `${job.role} complete`, findings: [] };
    current = (await submit(root, current, batch, job, completion, job.role)).state;
  }
  return current;
}

test("findings reject traversal/out-of-scope paths and missing blocking evidence", async () => {
  await withRoot(async (root) => {
    let state = await reviewReadyFeature(root);
    const batch = await reviewJobs.createReviewBatch(root, "f", state.revision);
    state = batch.state;
    const job = batch.batch.jobs[0];
    const key = capability(job.jobId, "scope");
    const claimed = await reviewJobs.claimReviewJob(root, "f", state.revision, batch.batch.batchId, job.jobId, key);
    state = claimed.state;

    await assert.rejects(
      () => reviewJobs.submitReviewJob(root, "f", state.revision, batch.batch.batchId, job.jobId, key, { findings: [] }),
      /REVIEW_PROTOCOL_INVALID/,
    );
    await assert.rejects(
      () => reviewJobs.submitReviewJob(root, "f", state.revision, batch.batch.batchId, job.jobId, key, {
        coverageSummary: "bad traversal", findings: [finding(job.role, { targets: ["../src"], evidence: [{ path: "src/counter.js" }] })],
      }),
      /REVIEW_FINDING_SCOPE_INVALID/,
    );
    await assert.rejects(
      () => reviewJobs.submitReviewJob(root, "f", state.revision, batch.batch.batchId, job.jobId, key, {
        coverageSummary: "outside root", findings: [finding(job.role, { evidence: [{ path: "package.json" }] })],
      }),
      /REVIEW_FINDING_SCOPE_INVALID/,
    );
    await assert.rejects(
      () => reviewJobs.submitReviewJob(root, "f", state.revision, batch.batch.batchId, job.jobId, key, {
        coverageSummary: "missing evidence", findings: [finding(job.role, { evidence: [] })],
      }),
      /REVIEW_PROTOCOL_INVALID/,
    );
    const submitted = await reviewJobs.submitReviewJob(root, "f", state.revision, batch.batch.batchId, job.jobId, key, {
      coverageSummary: "deduplicate without downgrade",
      findings: [
        finding(job.role, { severity: "note" }),
        finding(job.role, { severity: "blocking" }),
      ],
    });
    assert.equal(submitted.batch.jobs.find((candidate) => candidate.jobId === job.jobId).submission.findings.length, 1);
    assert.equal(submitted.batch.jobs.find((candidate) => candidate.jobId === job.jobId).submission.findings[0].severity, "blocking");
  });
});

test("only a same-role successor resolution disposes a prior blocking finding", async () => {
  await withRoot(async (root) => {
    let state = await reviewReadyFeature(root);
    const first = await reviewJobs.createReviewBatch(root, "f", state.revision);
    state = await completeBatch(root, first.state, first.batch, {
      "requirements-coverage": { coverageSummary: "found blocker", findings: [finding("requirements-coverage")] },
    });
    const firstLedger = await reviewStore.readReviewLedger(root, state);
    const findingId = firstLedger.batches[0].jobs[0].submission.findings[0].findingId;

    state = await registerTraceFixture({
      root, featureId: "f", state, kind: "requirements", edit: (markdown) => `${markdown}\n- successor basis\n`,
    });
    const successor = await reviewJobs.createReviewBatch(root, "f", state.revision);
    state = successor.state;
    const wrongRole = successor.batch.jobs.find((job) => job.role !== "requirements-coverage");
    const wrongKey = capability(wrongRole.jobId, "wrong-role");
    const wrongClaim = await reviewJobs.claimReviewJob(root, "f", state.revision, successor.batch.batchId, wrongRole.jobId, wrongKey);
    await assert.rejects(
      () => reviewJobs.submitReviewJob(root, "f", wrongClaim.state.revision, successor.batch.batchId, wrongRole.jobId, wrongKey, {
        coverageSummary: "outside resolution evidence", findings: [],
        resolutions: [{ findingId, evidence: [{ path: "../outside.js" }], note: "Invalid path." }],
      }),
      /REVIEW_FINDING_SCOPE_INVALID/,
    );
    await assert.rejects(
      () => reviewJobs.submitReviewJob(root, "f", wrongClaim.state.revision, successor.batch.batchId, wrongRole.jobId, wrongKey, {
        coverageSummary: "wrong role", findings: [], resolutions: [{ findingId, evidence: [{ path: "src/counter.js" }], note: "Not the producing role." }],
      }),
      /REVIEW_RESOLUTION_ROLE_MISMATCH/,
    );

    state = (await reviewJobs.submitReviewJob(root, "f", wrongClaim.state.revision, successor.batch.batchId, wrongRole.jobId, wrongKey, {
      coverageSummary: "No separate findings.", findings: [],
    })).state;
    const rightRole = successor.batch.jobs.find((job) => job.role === "requirements-coverage");
    state = (await submit(root, state, successor.batch, rightRole, {
      coverageSummary: "resolved prior blocker",
      findings: [],
      resolutions: [{ findingId, evidence: [{ path: "src/counter.js", line: 1 }], note: "The successor plan supplies the missing evidence." }],
    }, "right-role")).state;
    assert.deepEqual(await reviewJobs.assertReviewComplete(root, state), {
      batchId: successor.batch.batchId,
      basisHash: successor.batch.basisHash,
      assuranceLevel: "multi-perspective",
    });
  });
});

test("cross-batch blockers cannot disappear through an empty successor or a forged disposition", async () => {
  await withRoot(async (root) => {
    let state = await reviewReadyFeature(root);
    const first = await reviewJobs.createReviewBatch(root, "f", state.revision);
    state = await completeBatch(root, first.state, first.batch, {
      "requirements-coverage": { coverageSummary: "found blocker", findings: [finding("requirements-coverage")] },
    });
    const oldLedger = await reviewStore.readReviewLedger(root, state);
    const findingId = oldLedger.batches[0].jobs[0].submission.findings[0].findingId;
    state = await registerTraceFixture({
      root, featureId: "f", state, kind: "requirements", edit: (markdown) => `${markdown}\n- successor basis\n`,
    });
    await assert.rejects(() => reviewJobs.assertReviewComplete(root, state), /REVIEW_BATCH_REQUIRED/);
    const successor = await reviewJobs.createReviewBatch(root, "f", state.revision);
    state = await completeBatch(root, successor.state, successor.batch, {});
    await assert.rejects(() => reviewJobs.assertReviewComplete(root, state), /REVIEW_BLOCKING_FINDINGS/);

    const ledger = await reviewStore.readReviewLedger(root, state);
    const forged = {
      ...ledger,
      revision: ledger.revision + 1,
      stateRevision: state.revision + 1,
      batches: ledger.batches.map((batch) => batch.batchId === successor.batch.batchId ? {
        ...batch,
        dispositions: {
          [findingId]: {
            kind: "resolved-in-successor",
            successorBatchId: successor.batch.batchId,
            resolutionJobId: successor.batch.jobs[0].jobId,
            resolvedAt: new Date().toISOString(),
          },
        },
      } : batch),
    };
    forged.summary = reviewStore.reviewSummary(forged.batches);
    const pointer = await reviewStore.writeReviewSnapshot(root, forged);
    state = await stateStore.mutate(root, "f", state.revision, "forged-disposition", (draft) => { draft.review = pointer; });
    await assert.rejects(() => reviewJobs.assertReviewComplete(root, state), /REVIEW_BLOCKING_FINDINGS/);
  });
});

test("a basis change invalidates an already presented implementation gate", async () => {
  await withRoot(async (root) => {
    let state = await reviewReadyFeature(root);
    const created = await reviewJobs.createReviewBatch(root, "f", state.revision);
    state = await completeBatch(root, created.state, created.batch, {});
    state = await checks.recordStep(root, "f", state.revision, "plan_review", {});
    const presented = await gates.presentGate(root, "f", state.revision, "implementation_approval");
    state = await registerTraceFixture({
      root, featureId: "f", state: presented, kind: "requirements", edit: (markdown) => `${markdown}\n- approval basis changed\n`,
    });
    await assert.rejects(
      () => gates.resolveGateElicitation(root, "f", state.revision, presented.gateInteraction.id, "confirm", undefined, "codex"),
      /INTERACTION_NOT_FOUND|HUMAN_GATE_NOT_PENDING|HUMAN_GATE_BASIS_CHANGED/,
    );
  });
});

test("risk acceptance is one-time and binds the current batch, basis, and exact finding set", async () => {
  await withRoot(async (root) => {
    let state = await reviewReadyFeature(root);
    const batch = await reviewJobs.createReviewBatch(root, "f", state.revision);
    state = await completeBatch(root, batch.state, batch.batch, Object.fromEntries(batch.batch.jobs.map((job) => [job.role, {
      coverageSummary: `${job.role} found blocker`, findings: [finding(job.role)],
    }])));
    const ledger = await reviewStore.readReviewLedger(root, state);
    const findingIds = ledger.batches.at(-1).jobs.map((job) => job.submission.findings[0].findingId).sort();
    const firstOnly = [findingIds[0]];
    const presented = await reviewJobs.presentReviewRiskAcceptance(root, "f", state.revision, firstOnly);
    assert.equal(presented.idempotent, false);
    const token = presented.interaction.fallback.token;
    await assert.rejects(
      () => reviewJobs.resolveReviewRiskAcceptanceToken(root, "f", presented.state.revision, presented.interaction.id, `${token} accept`, "prompt-1", "codex"),
      /INTERACTION_COMMENT_REQUIRED/,
    );
    const accepted = await reviewJobs.resolveReviewRiskAcceptanceToken(
      root, "f", presented.state.revision, presented.interaction.id, `${token} accept 用户接受第一个风险`, "prompt-1", "codex",
    );
    assert.deepEqual(accepted.acceptedFindingIds, firstOnly);
    await assert.rejects(() => reviewJobs.assertReviewComplete(root, accepted.state), /REVIEW_BLOCKING_FINDINGS/);
    const replay = await reviewJobs.resolveReviewRiskAcceptanceToken(
      root, "f", accepted.state.revision, presented.interaction.id, `${token} accept 用户接受第一个风险`, "prompt-1", "codex",
    );
    assert.equal(replay.idempotent, true);
    assert.equal(replay.state.revision, accepted.state.revision);
    await assert.rejects(
      () => reviewJobs.presentReviewRiskAcceptance(root, "f", replay.state.revision, findingIds),
      /REVIEW_RISK_ACCEPTANCE_INVALID/,
    );
  });
});

test("plan_review evidence remains Core-owned and rejects missing jobs or blocking findings", async () => {
  await withRoot(async (root) => {
    let state = await reviewReadyFeature(root);
    await assert.rejects(
      () => checks.recordStep(root, "f", state.revision, "plan_review", { reviewBatch: "forged", basisHash: "forged" }),
      /REVIEW_BATCH_REQUIRED/,
    );
    const batch = await reviewJobs.createReviewBatch(root, "f", state.revision);
    state = batch.state;
    await assert.rejects(() => checks.recordStep(root, "f", state.revision, "plan_review", {}), /REVIEW_BATCH_INCOMPLETE/);
    state = await completeBatch(root, state, batch.batch, {
      "requirements-coverage": { coverageSummary: "found blocker", findings: [finding("requirements-coverage")] },
    });
    await assert.rejects(() => checks.recordStep(root, "f", state.revision, "plan_review", {}), /REVIEW_BLOCKING_FINDINGS/);

    await withRoot(async (emptyRoot) => {
      const empty = await reviewReadyFeature(emptyRoot);
      const emptyBatch = await reviewJobs.createReviewBatch(emptyRoot, "f", empty.revision);
      const completed = await completeBatch(emptyRoot, emptyBatch.state, emptyBatch.batch, {});
      const recorded = await checks.recordStep(emptyRoot, "f", completed.revision, "plan_review", { reviewBatch: "forged" });
      assert.deepEqual(recorded.steps.plan_review.evidence, {
        batchId: emptyBatch.batch.batchId,
        basisHash: emptyBatch.batch.basisHash,
        assuranceLevel: "multi-perspective",
      });
    });
  });
});
