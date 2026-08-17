import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { loadSource } from "../helpers/load-source.mjs";
import { claimCapability, prepareReviewReadyFeature, readCurrentReview } from "../helpers/route-flow.mjs";

const jobs = await loadSource("plugins/dev-flow/src/core/review-jobs.ts");
const interactionAnswer = await loadSource("plugins/dev-flow/src/core/interaction-answer.ts");
const store = await loadSource("plugins/dev-flow/src/core/state-store.ts");

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
    const resolved = await store.answer({
      root, featureId: "risk", expectedRevision: presented.state.revision, host: "claude",
      credential: { source: "elicitation", action: "accept", comment: "已了解边界测试风险" },
    });
    assert.equal(resolved.action, "accept");
    assert.equal(resolved.comment, "已了解边界测试风险");
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
      () => store.answer({
        root, featureId: "risk", expectedRevision: presented.state.revision, host: "claude",
        credential: { source: "elicitation", action: "accept" },
      }),
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
    const resolved = await store.answer({
      root, featureId: "risk", expectedRevision: presented.state.revision, host: "claude",
      credential: { source: "elicitation", action: "decline" },
    });
    assert.equal(resolved.action, "decline");
    assert.equal(resolved.state.interactions[interactionId].status, "resolved");
    assert.equal(resolved.state.interactions[interactionId].response.action, "decline");
    const { ledger } = await readCurrentReview(root, resolved.state);
    assert.equal(ledger.batches.find((batch) => batch.validity === "current").dispositions?.[findingId], undefined);
    assert.equal(ledger.findingEvents.filter((event) => event.type === "risk-accepted").length, 0);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("repeating the same elicitation accept replays idempotently without advancing revision", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "dev-flow-risk-idempotent-"));
  try {
    const { state, findingId } = await featureWithBlockingFinding(root, "risk");
    const presented = await jobs.presentReviewRiskAcceptance(root, "risk", state.revision, [findingId]);
    const interactionId = riskInteractionId(presented.state);
    const first = await store.answer({
      root, featureId: "risk", expectedRevision: presented.state.revision, host: "claude",
      credential: { source: "elicitation", action: "accept", comment: "已了解边界测试风险" },
    });
    assert.equal(first.action, "accept");
    // 模拟 5.0 早期残留：pendingDecision 已删除但宿主重放了同一回答，
    // answer 经 pendingDecision 的 target fallback 定位到已 resolved 的交互。
    const interaction = first.state.interactions[interactionId];
    const restaged = await store.mutate(root, "risk", first.state.revision, "restage-pending-decision", (draft) => {
      draft.pendingDecision = {
        kind: "review-risk",
        target: interaction.target,
        question: interaction.question,
        options: interaction.options.map((option) => ({ ...option })),
        basisHash: interaction.basisHash,
        presentedAt: interaction.presentedAt,
        presentedRevision: interaction.presentedRevision,
        source: "core",
      };
    });
    const again = await store.answer({
      root, featureId: "risk", expectedRevision: restaged.revision, host: "claude",
      credential: { source: "elicitation", action: "accept", comment: "已了解边界测试风险" },
    });
    assert.equal(again.action, "accept");
    assert.equal(again.state.revision, restaged.revision, "幂等重放不推进 revision");
    assert.equal(again.state.interactions[interactionId].response.comment, "已了解边界测试风险");
    const { ledger } = await readCurrentReview(root, again.state);
    const current = ledger.batches.find((batch) => batch.validity === "current");
    assert.equal(current.dispositions[findingId].kind, "risk-accepted");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("host-event text accept consumes the captured risk reason without caller reply", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "dev-flow-risk-accept-host-event-"));
  try {
    const { state, findingId } = await featureWithBlockingFinding(root, "risk");
    const presented = await jobs.presentReviewRiskAcceptance(root, "risk", state.revision, [findingId]);
    const interactionId = riskInteractionId(presented.state);
    await store.recordHostEvent(root, { eventId: "risk-accept-host", type: "user-prompt", host: "claude", text: "接受风险：已了解边界测试风险" });
    const resolved = await interactionAnswer.answerFromHostEvents({ root, featureId: "risk", expectedRevision: presented.state.revision, host: "claude" });
    assert.equal(resolved.action, "accept");
    assert.equal(resolved.comment, "已了解边界测试风险");
    assert.equal(resolved.state.interactions[interactionId].response.promptEventId, "risk-accept-host");
    const { ledger } = await readCurrentReview(root, resolved.state);
    const current = ledger.batches.find((batch) => batch.validity === "current");
    assert.equal(current.dispositions[findingId].kind, "risk-accepted");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
