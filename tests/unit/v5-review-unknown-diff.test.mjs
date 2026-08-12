import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { loadSource } from "../helpers/load-source.mjs";
import { registerTraceFixture, traceDeltaFor } from "../helpers/trace-fixtures.mjs";
import { completeReviewJobs, prepareReviewReadyFeature } from "../helpers/route-flow.mjs";

const jobs = await loadSource("plugins/dev-flow/src/core/review-jobs.ts");
const store = await loadSource("plugins/dev-flow/src/core/state-store.ts");

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

test("a referenced verification command change rebuilds only affected review roles", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "dev-flow-review-command-change-"));
  try {
    let state = await prepareReviewReadyFeature(root, {
      level: "M",
      topology: "shared-contract",
      requirements: "provided-confirmed",
      scopeFacts: ["scope"],
      topologyFacts: ["topology"],
      uncertaintyFacts: [],
      riskFacts: {},
      decisionRefs: [],
    }, { featureId: "command-change" });
    const first = await jobs.createReviewBatch(root, state.featureId, state.revision);
    state = (await completeReviewJobs(root, state.featureId, first.state, first.batch)).state;

    const raw = await readFile(path.join(root, ".dev-flow", "project.json"));
    const config = JSON.parse(raw);
    config.verification.commands[0].args = ["--test", "--changed"];
    const updated = await store.updateProjectConfig(root, config, createHash("sha256").update(raw).digest("hex"));
    assert.deepEqual(updated.affectedEvidence.traceNodeIds, ["UNIT-001"]);
    assert.deepEqual(updated.affectedEvidence.reviewRoles, ["rollback-operability"]);

    await assert.rejects(
      () => jobs.assertReviewComplete(root, state),
      (error) => error.code === "REVIEW_BASIS_STALE",
    );
    const rebuilt = await jobs.createReviewBatch(root, state.featureId, state.revision);
    assert.equal(rebuilt.created, true);
    assert.notEqual(rebuilt.batch.batchId, first.batch.batchId);
    const byRole = Object.fromEntries(rebuilt.batch.jobs.map((job) => [job.role, job]));
    assert.equal(byRole["requirements-coverage"].status, "reused");
    assert.equal(byRole["architecture-testability"].status, "pending");
    assert.equal(byRole["rollback-operability"].status, "pending");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("specialty roles reuse a requirements-only documentation change", async () => {
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

    // 与专项角色无关的纯文档变化不能退化为全量专项重审。
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
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("specialty roles re-review a related structured execution change", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "dev-flow-review-specialty-related-"));
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
    }, { featureId: "specialty-related" });
    const first = await jobs.createReviewBatch(root, state.featureId, state.revision);
    state = (await completeReviewJobs(root, state.featureId, first.state, first.batch)).state;

    const traceDelta = traceDeltaFor("implementation-plan", "m");
    const unit = traceDelta.nodes.find((node) => node.kind === "implementation-unit");
    unit.fileScope = ["src/security"];
    state = await registerTraceFixture({
      root,
      featureId: state.featureId,
      state,
      kind: "implementation-plan",
      delta: traceDelta,
      edit: (markdown) => `${markdown}\n补充安全边界：实现限制为 src/security。\n`,
    });
    const second = await jobs.createReviewBatch(root, state.featureId, state.revision);
    const byRole = Object.fromEntries(second.batch.jobs.map((job) => [job.role, job]));
    assert.equal(byRole.security.status, "pending");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
