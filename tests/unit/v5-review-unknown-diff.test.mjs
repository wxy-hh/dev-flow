import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { loadSource } from "../helpers/load-source.mjs";
import { registerTraceFixture } from "../helpers/trace-fixtures.mjs";
import { completeReviewJobs, prepareReviewReadyFeature } from "../helpers/route-flow.mjs";

const jobs = await loadSource("plugins/dev-flow/src/core/review-jobs.ts");

test("unknown diff outside all role slices forces a full conservative re-review", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "dev-flow-review-unknown-diff-"));
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
    }, { featureId: "unknown" });
    const first = await jobs.createReviewBatch(root, state.featureId, state.revision);
    state = (await completeReviewJobs(root, state.featureId, first.state, first.batch)).state;

    // governed-root 字节变化不在任何角色切片内（artifacts/trace/project config 均未变）
    await writeFile(path.join(root, "src", "extra.js"), "export const extra = 1;\n");

    const second = await jobs.createReviewBatch(root, state.featureId, state.revision);
    assert.notEqual(second.batch.basisHash, first.batch.basisHash);
    assert.equal(second.batch.progress, "open");
    assert.ok(second.batch.jobs.length > 0);
    for (const job of second.batch.jobs) {
      assert.equal(job.status, "pending");
      assert.equal(job.reusedFrom, undefined);
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("unchanged basis returns the same current batch idempotently", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "dev-flow-review-idempotent-"));
  try {
    const state = await prepareReviewReadyFeature(root, {
      level: "M",
      topology: "shared-contract",
      requirements: "provided-confirmed",
      scopeFacts: ["scope"],
      topologyFacts: ["topology"],
      uncertaintyFacts: [],
      riskFacts: {},
      decisionRefs: [],
    }, { featureId: "idempotent" });
    const first = await jobs.createReviewBatch(root, state.featureId, state.revision);
    const again = await jobs.createReviewBatch(root, state.featureId, first.state.revision);
    assert.equal(again.created, false);
    assert.equal(again.batch.batchId, first.batch.batchId);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("specialty roles reuse unless their risk label slice changes", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "dev-flow-review-specialty-"));
  try {
    let state = await prepareReviewReadyFeature(root, {
      level: "M",
      topology: "shared-contract",
      requirements: "provided-confirmed",
      scopeFacts: ["共享契约需求"],
      topologyFacts: ["共享契约"],
      uncertaintyFacts: [],
      riskLabels: ["security"],
      decisionRefs: [],
    }, { featureId: "specialty" });
    const first = await jobs.createReviewBatch(root, state.featureId, state.revision);
    const firstRoles = first.batch.jobs.map((job) => job.role);
    assert.ok(firstRoles.includes("security"), `expected security role in ${firstRoles.join(",")}`);
    state = (await completeReviewJobs(root, state.featureId, first.state, first.batch)).state;

    // 与安全无关的 requirements 语义变化：coverage 重审，security 复用
    state = await registerTraceFixture({
      root,
      featureId: state.featureId,
      state,
      kind: "requirements",
      edit: (markdown) => `${markdown}\n补充说明：与安全无关的文案调整。\n`,
    });
    const second = await jobs.createReviewBatch(root, state.featureId, state.revision);
    const byRole = Object.fromEntries(second.batch.jobs.map((job) => [job.role, job]));
    assert.equal(byRole["requirements-coverage"].status, "pending");
    assert.equal(byRole["security"].status, "reused");
    assert.ok(byRole["security"].reusedFrom);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
