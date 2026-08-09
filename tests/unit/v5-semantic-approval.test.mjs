import assert from "node:assert/strict";
import { readFile, writeFile, mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { loadSource } from "../helpers/load-source.mjs";
import { completeReviewJobs, driveUntil, prepareReviewReadyFeature } from "../helpers/route-flow.mjs";
import { traceDeltaFor } from "../helpers/trace-fixtures.mjs";

const artifacts = await loadSource("plugins/dev-flow/src/core/artifacts.ts");
const jobs = await loadSource("plugins/dev-flow/src/core/review-jobs.ts");

test("a plan-only documentation change preserves an execution approval with unchanged semantics", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "dev-flow-semantic-approval-"));
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
    }, { featureId: "semantic-approval" });
    const created = await jobs.createReviewBatch(root, state.featureId, state.revision);
    state = (await completeReviewJobs(root, state.featureId, created.state, created.batch)).state;
    state = (await driveUntil(root, state.featureId, state, {
      input: { requirements: "provided-confirmed" },
      stopAt: (_action, current) => Object.values(current.humanGates).some((gate) => gate.status === "confirmed"),
    })).state;

    const approvalId = Object.keys(state.humanGates).find((id) => state.humanGates[id].status === "confirmed");
    assert.ok(approvalId);
    const beforeBasis = state.humanGates[approvalId].basisHash;
    const plan = state.artifacts["implementation-plan"];
    const target = path.join(root, ".dev-flow", "features", state.featureId, plan.path);
    await writeFile(target, `${await readFile(target, "utf8")}\n补充说明：仅调整文档措辞，不改变 TASK、RU 或执行范围。\n`);

    state = (await artifacts.recordArtifactWithTrace(
      root,
      state.featureId,
      state.revision,
      "implementation-plan",
      traceDeltaFor("implementation-plan", state.route),
    )).state;

    assert.equal(state.humanGates[approvalId].status, "confirmed");
    assert.equal(state.humanGates[approvalId].basisHash, beforeBasis);
    assert.equal(state.obligations.find((item) => item.id === approvalId).status, "satisfied");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
