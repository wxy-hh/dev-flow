import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { loadSource } from "../helpers/load-source.mjs";
import { completeReviewJobs, prepareReviewReadyFeature } from "../helpers/route-flow.mjs";

const jobs = await loadSource("plugins/dev-flow/src/core/review-jobs.ts");
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

test("inspect and the advance gate read the same unresolved blocking set", async () => {
  const { root, state } = await setup("dev-flow-review-unified-", "unified");
  try {
    const created = await jobs.createReviewBatch(root, state.featureId, state.revision);
    const blockingFinding = {
      severity: "blocking",
      category: "requirements-coverage",
      targets: ["REQ-001"],
      evidence: [{ path: "需求文档.md", line: 3 }],
      claim: "AC-001 缺少行为验证覆盖",
      recommendation: "补充测试或显式验证处置",
    };
    const completed = await completeReviewJobs(root, state.featureId, created.state, created.batch, {
      completions: { "requirements-coverage": { coverageSummary: "reviewed", findings: [blockingFinding] } },
    });
    const ledger = await (await loadSource("plugins/dev-flow/src/core/review-store.ts")).readReviewLedger(root, completed.state);
    const current = ledger.batches.find((batch) => batch.validity === "current");
    const unresolved = jobs.currentUnresolvedBlocking(ledger, current, completed.state);

    // inspect 与门禁一致：同一集合、同一数量。
    const view = await inspection.inspectFeature(root, state.featureId, "review");
    assert.equal(view.content.unresolvedBlockingCount, unresolved.length);
    assert.equal(view.content.unresolvedBlockingCount, 1);
    await assert.rejects(
      () => jobs.assertReviewComplete(root, completed.state),
      (error) => {
        assert.equal(error.code, "REVIEW_BLOCKING_FINDINGS");
        assert.deepEqual(error.details.findingIds, unresolved.map((finding) => finding.findingId));
        return true;
      },
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("unknown diff records changed fields and the full-re-review decision, visible to inspect", async () => {
  const { root, state } = await setup("dev-flow-review-unknown-diag-", "unknown-diag");
  try {
    const first = await jobs.createReviewBatch(root, state.featureId, state.revision);
    let current = (await completeReviewJobs(root, state.featureId, first.state, first.batch)).state;
    // governed-root 字节变化不在任何角色切片内
    await writeFile(path.join(root, "src", "extra.js"), "export const extra = 1;\n");
    const second = await jobs.createReviewBatch(root, state.featureId, current.revision);
    assert.ok(second.batch.unknownDiffInfo, "unknown diff must record a diagnostic");
    assert.ok(second.batch.unknownDiffInfo.changedFields.length > 0, JSON.stringify(second.batch.unknownDiffInfo));
    assert.match(second.batch.unknownDiffInfo.reason, /完整重审/);
    const view = await inspection.inspectFeature(root, state.featureId, "review");
    assert.deepEqual(view.content.unknownDiff, second.batch.unknownDiffInfo);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
