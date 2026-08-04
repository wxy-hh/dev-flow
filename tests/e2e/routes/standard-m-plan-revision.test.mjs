import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { loadSource } from "../../helpers/load-source.mjs";
import { prepareReviewReadyFeature } from "../../helpers/route-flow.mjs";

const store = await loadSource("plugins/dev-flow/src/core/state-store.ts");
const artifacts = await loadSource("plugins/dev-flow/src/core/artifacts.ts");
const reviews = await loadSource("plugins/dev-flow/src/core/review-jobs.ts");
const reviewStore = await loadSource("plugins/dev-flow/src/core/review-store.ts");
const units = await loadSource("plugins/dev-flow/src/core/implementation-units.ts");
const checkpoints = await loadSource("plugins/dev-flow/src/core/checkpoints.ts");
const approvals = await loadSource("plugins/dev-flow/src/core/approval-interactions.ts");
const checks = await loadSource("plugins/dev-flow/src/core/feature-check.ts");
const verification = await loadSource("plugins/dev-flow/src/core/verification.ts");
const config = {
  schemaVersion: 1,
  verification: {
    commands: [{ id: "unit", command: process.execPath, args: ["-e", "process.exit(0)"], cwd: "." }],
    behaviorCommands: [],
  },
  enforcement: {
    mode: "strict",
    gitWriteRequiresLogicComplete: true,
    oneActiveFeature: true,
    requireExplicitHumanReply: true,
  },
  protectedRoots: ["src"],
};

const input = {
  level: "M",
  topology: "shared-contract",
  execution: "standard",
  requirements: "provided-confirmed",
  scopeFacts: ["计划修订验收"],
  topologyFacts: ["共享契约"],
  uncertaintyFacts: [],
  riskFacts: {},
  decisionRefs: [],
};

async function completeReviewBatch(root, state, batch) {
  let current = state;
  for (const job of batch.jobs) {
    const capability = `claim-${job.jobId}-1234567890abcdef`;
    const claimed = await reviews.claimReviewJob(root, current.featureId, current.revision, batch.batchId, job.jobId, capability);
    const submitted = await reviews.submitReviewJob(root, current.featureId, claimed.state.revision, batch.batchId, job.jobId, capability, {
      coverageSummary: "review complete",
      findings: [],
    });
    current = submitted.state;
  }
  return current;
}

async function confirmApproval(root, state) {
  const approval = state.obligations.find((item) => item.kind === "approval" && item.status !== "satisfied");
  const presentation = await approvals.presentApproval(root, state.featureId, state.revision, approval.id);
  const eventId = `approval-${presentation.revision}`;
  await store.recordHostEvent(root, { eventId, type: "user-prompt", host: "claude", text: "批准实现" });
  return approvals.confirmApproval(root, state.featureId, presentation.revision, approval.id, "批准实现", { promptEventId: eventId }, "claude");
}

test("standard-m plan revision reopens planning and recovers without REVIEW_BASIS_STALE", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "dev-flow-standard-m-plan-revision-"));
  try {
    await mkdir(path.join(root, "src"), { recursive: true });
    let state = await prepareReviewReadyFeature(root, input, { config, featureId: "revision" });
    let created = await reviews.createReviewBatch(root, state.featureId, state.revision);
    state = await completeReviewBatch(root, created.state, created.batch);
    state = await checks.recordStep(root, state.featureId, state.revision, "planning", {});
    state = await confirmApproval(root, state);

    state = await units.beginImplementationUnit(root, state.featureId, state.revision, "RU-001");
    await writeFile(path.join(root, "src", "one.js"), "export const one = 1;\n");
    state = (await checkpoints.checkpointImplementationUnit(root, state.featureId, state.revision, "RU-001")).state;

    const planPath = path.join(root, ".dev-flow", "features", state.featureId, state.artifacts["implementation-plan"].path);
    const originalPlan = await readFile(planPath, "utf8");
    const revisedPlan = originalPlan.replaceAll("TASK-001", "TASK-002").replaceAll("TEST-001", "TEST-002").replaceAll("RU-001", "RU-002");
    await writeFile(planPath, revisedPlan);
    const revisedDelta = {
      nodes: [
        { kind: "task", id: "TASK-002", covers: ["REQ-001", "AC-001"], rollbackUnit: "RU-002" },
        { kind: "test", id: "TEST-002", verifies: ["AC-001"] },
        { kind: "rollback", id: "RU-002", tasks: ["TASK-002"], dependsOn: [], fileScope: ["src"], covers: ["REQ-001", "AC-001"], forwardVerification: ["unit"], rollbackVerification: ["unit"] },
      ],
    };
    const revised = await artifacts.recordArtifactWithTrace(root, state.featureId, state.revision, "implementation-plan", revisedDelta);
    state = revised.state;
    assert.equal(state.steps.planning, undefined);
    assert.equal(state.currentStage, "planning");
    assert.equal(state.implementationUnits.some((unit) => unit.unitId === "RU-001" && unit.status === "checkpointed"), true);

    const ledger = await reviewStore.readReviewLedger(root, state);
    assert.equal(ledger.batches.filter((batch) => batch.validity === "stale").length, 1);
    created = await reviews.createReviewBatch(root, state.featureId, state.revision);
    state = await completeReviewBatch(root, created.state, created.batch);
    state = await checks.recordStep(root, state.featureId, state.revision, "planning", {});
    state = await confirmApproval(root, state);

    state = await units.beginImplementationUnit(root, state.featureId, state.revision, "RU-002");
    await writeFile(path.join(root, "src", "two.js"), "export const two = 2;\n");
    state = (await checkpoints.checkpointImplementationUnit(root, state.featureId, state.revision, "RU-002")).state;
    state = await checks.recordStep(root, state.featureId, state.revision, "implementation", { files: ["src/one.js", "src/two.js"] });
    state = await checks.recordStep(root, state.featureId, state.revision, "code_review", { reviewType: "code" });
    state = await verification.runVerification(root, state.featureId, state.revision, "claude", ["unit"]);
    state = await checks.finalize(root, state.featureId, state.revision);
    assert.equal(state.lifecycle, "finalized");
    assert.equal(state.logicComplete, true);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
