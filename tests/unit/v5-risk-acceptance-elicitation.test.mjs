import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { loadSource } from "../helpers/load-source.mjs";
import { claimCapability, prepareReviewReadyFeature, readCurrentReview } from "../helpers/route-flow.mjs";

const jobs = await loadSource("plugins/dev-flow/src/core/review-jobs.ts");

function riskInteractionId(state) {
  const id = Object.keys(state.interactions ?? {}).find((key) => state.interactions[key].kind === "risk-acceptance");
  assert.ok(id, "risk-acceptance interaction missing after presentation");
  return id;
}

/** Prepare an M feature whose review batch contains one blocking architecture finding. */
async function featureWithBlockingFinding(root, featureId) {
  let state = await prepareReviewReadyFeature(root, {
    level: "M",
    topology: "shared-contract",
    requirements: "provided-confirmed",
    scopeFacts: ["共享契约需求"],
    topologyFacts: ["共享契约"],
    uncertaintyFacts: [],
    riskFacts: {},
    decisionRefs: [],
  }, { featureId });
  const created = await jobs.createReviewBatch(root, state.featureId, state.revision);
  let current = created.state;
  let findingId;
  for (const job of created.batch.jobs) {
    const capability = claimCapability(job.jobId);
    const claimed = await jobs.claimReviewJob(root, state.featureId, current.revision, created.batch.batchId, job.jobId, capability);
    current = claimed.state;
    const completion = job.role === "architecture-testability"
      ? {
          coverageSummary: "发现边界测试缺口",
          findings: [{
            severity: "blocking",
            category: job.role,
            targets: ["src/main.js"],
            evidence: [{ path: "src/main.js", line: 1 }],
            claim: "缺少边界测试",
            recommendation: "补充边界测试",
          }],
        }
      : { coverageSummary: "审查通过", findings: [] };
    const submitted = await jobs.submitReviewJob(root, state.featureId, current.revision, created.batch.batchId, job.jobId, capability, completion);
    current = submitted.state;
    if (job.role === "architecture-testability") {
      findingId = submitted.batch.jobs.find((candidate) => candidate.role === job.role)?.submission?.findings[0]?.findingId;
    }
  }
  assert.ok(findingId);
  return { state: current, findingId };
}

test("elicitation accept records dispositions with the form comment and resolves the decision", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "dev-flow-risk-accept-elicitation-"));
  try {
    const { state, findingId } = await featureWithBlockingFinding(root, "risk");
    const presented = await jobs.presentReviewRiskAcceptance(root, "risk", state.revision, [findingId]);
    const interactionId = riskInteractionId(presented.state);
    const resolved = await jobs.resolveReviewRiskAcceptanceElicitation(root, "risk", presented.state.revision, interactionId, "accept", "已了解边界测试风险", "claude");
    assert.deepEqual(resolved.acceptedFindingIds, [findingId]);
    assert.equal(resolved.idempotent, false);
    assert.equal(resolved.state.interactions[interactionId].status, "resolved");
    assert.equal(resolved.state.interactions[interactionId].response.action, "accept");
    assert.equal(resolved.state.interactions[interactionId].response.comment, "已了解边界测试风险");
    assert.equal(resolved.state.pendingDecision, undefined);
    const { ledger } = await readCurrentReview(root, resolved.state);
    const current = ledger.batches.find((batch) => batch.validity === "current");
    assert.equal(current.dispositions[findingId].kind, "risk-accepted");
    assert.equal(current.dispositions[findingId].findingSetHash, ledger.findingEvents.find((event) => event.type === "risk-accepted")?.findingSetHash);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("elicitation accept without the required comment is rejected and stays pending", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "dev-flow-risk-accept-comment-"));
  try {
    const { state, findingId } = await featureWithBlockingFinding(root, "risk");
    const presented = await jobs.presentReviewRiskAcceptance(root, "risk", state.revision, [findingId]);
    const interactionId = riskInteractionId(presented.state);
    await assert.rejects(
      () => jobs.resolveReviewRiskAcceptanceElicitation(root, "risk", presented.state.revision, interactionId, "accept", undefined, "claude"),
      (error) => error.code === "INTERACTION_COMMENT_REQUIRED",
    );
    const pending = await readCurrentReview(root, presented.state);
    assert.equal(presented.state.interactions[interactionId].status, "pending");
    assert.equal(pending.ledger.batches.find((batch) => batch.validity === "current").dispositions?.[findingId], undefined);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("elicitation decline resolves without recording any acceptance", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "dev-flow-risk-decline-elicitation-"));
  try {
    const { state, findingId } = await featureWithBlockingFinding(root, "risk");
    const presented = await jobs.presentReviewRiskAcceptance(root, "risk", state.revision, [findingId]);
    const interactionId = riskInteractionId(presented.state);
    const resolved = await jobs.resolveReviewRiskAcceptanceElicitation(root, "risk", presented.state.revision, interactionId, "decline", undefined, "claude");
    assert.deepEqual(resolved.acceptedFindingIds, []);
    assert.equal(resolved.idempotent, false);
    assert.equal(resolved.state.interactions[interactionId].status, "resolved");
    assert.equal(resolved.state.interactions[interactionId].response.action, "decline");
    const { ledger } = await readCurrentReview(root, resolved.state);
    assert.equal(ledger.batches.find((batch) => batch.validity === "current").dispositions?.[findingId], undefined);
    assert.equal(ledger.findingEvents.filter((event) => event.type === "risk-accepted").length, 0);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("repeating the same elicitation accept is idempotent", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "dev-flow-risk-idempotent-"));
  try {
    const { state, findingId } = await featureWithBlockingFinding(root, "risk");
    const presented = await jobs.presentReviewRiskAcceptance(root, "risk", state.revision, [findingId]);
    const interactionId = riskInteractionId(presented.state);
    const first = await jobs.resolveReviewRiskAcceptanceElicitation(root, "risk", presented.state.revision, interactionId, "accept", "已了解边界测试风险", "claude");
    const again = await jobs.resolveReviewRiskAcceptanceElicitation(root, "risk", first.state.revision, interactionId, "accept", "已了解边界测试风险", "claude");
    assert.deepEqual(again.acceptedFindingIds, [findingId]);
    assert.equal(again.idempotent, true);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
