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

    // gate 是唯一归约：inspect 与推进门禁读到同一 findingIds 集合。
    const gate = await jobs.reviewGate(root, completed.state);
    assert.equal(gate.status, "blocking");
    assert.equal(gate.findingIds.length, 1);

    const view = await inspection.inspectFeature(root, state.featureId, "review");
    assert.equal(view.content.unresolvedBlockingCount, gate.findingIds.length);
    assert.equal(view.content.unresolvedBlockingCount, 1);
    await assert.rejects(
      () => jobs.requireReviewReady(root, completed.state),
      (error) => {
        assert.equal(error.code, "REVIEW_BLOCKING_FINDINGS");
        assert.deepEqual(error.details.findingIds, gate.findingIds);
        return true;
      },
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("unchanged role slices reuse every role and leave no unknown-diff diagnostic", async () => {
  const { root, state } = await setup("dev-flow-review-reuse-diag-", "reuse-diag");
  try {
    const first = await jobs.createReviewBatch(root, state.featureId, state.revision);
    let current = (await completeReviewJobs(root, state.featureId, first.state, first.batch)).state;
    // governed-root 字节变化不在任何角色语义切片内
    await writeFile(path.join(root, "src", "extra.js"), "export const extra = 1;\n");
    const second = await jobs.createReviewBatch(root, state.featureId, current.revision);
    assert.equal(second.batch.unknownDiffInfo, undefined);
    assert.ok(second.batch.jobs.length > 0);
    assert.ok(second.batch.jobs.every((job) => job.status === "reused" && job.reusedFrom !== undefined));
    assert.equal(second.batch.progress, "complete");
    const view = await inspection.inspectFeature(root, state.featureId, "review");
    assert.equal(view.content.unknownDiff, undefined);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
