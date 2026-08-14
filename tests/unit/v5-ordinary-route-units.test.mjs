import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { loadSource } from "../helpers/load-source.mjs";

const store = await loadSource("plugins/dev-flow/src/core/state-store.ts");
const artifacts = await loadSource("plugins/dev-flow/src/core/artifacts.ts");
const steps = await loadSource("plugins/dev-flow/src/core/feature-check.ts");
const units = await loadSource("plugins/dev-flow/src/core/implementation-units.ts");
const checkpoints = await loadSource("plugins/dev-flow/src/core/checkpoints.ts");
const jobs = await loadSource("plugins/dev-flow/src/core/review-jobs.ts");
const stepOrder = await loadSource("plugins/dev-flow/src/core/step-order.ts");

const config = {
  schemaVersion: 2,
  verification: { commands: [{ id: "unit", command: process.execPath, args: ["-e", "process.exit(0)"], cwd: ".", provides: ["targeted", "behavior", "integration", "full"] }] },
  enforcement: { mode: "strict", gitWriteRequiresLogicComplete: true, oneActiveFeature: true, requireExplicitHumanReply: true },
  governedRoots: ["src"],
};

const planMarkdown = [
  "<!-- dev-flow:id=TASK-001 kind=task -->\n### TASK-001\n\n- covers: REQ-001\n- implementation_unit: UNIT-001\n",
  "<!-- dev-flow:id=TASK-002 kind=task -->\n### TASK-002\n\n- covers: REQ-001\n- implementation_unit: UNIT-002\n",
  "<!-- dev-flow:id=UNIT-001 kind=implementation-unit -->\n### UNIT-001\n\n- tasks: [TASK-001]\n- depends_on: []\n- file_scope: src\n- covers: REQ-001\n- forward_verification: unit\n",
  "<!-- dev-flow:id=UNIT-002 kind=implementation-unit -->\n### UNIT-002\n\n- tasks: [TASK-002]\n- depends_on: [UNIT-001]\n- file_scope: src\n- covers: REQ-001\n- forward_verification: unit\n",
].join("\n");

async function setupOrdinaryM() {
  const root = await mkdtemp(path.join(os.tmpdir(), "dev-flow-ordinary-"));
  await mkdir(path.join(root, "src"));
  await store.initProject(root, config);
  let state = await store.startFeature(root, {
    featureId: "ordinary",
    host: "codex",
    level: "M",
    topology: "local",
    scopeFacts: ["scope"],
    topologyFacts: ["topology"],
    uncertaintyFacts: [],
    riskFacts: {},
    decisionRefs: [],
  });
  assert.equal(state.mode, "routed");
  state = await artifacts.scaffoldArtifact(root, state.featureId, state.revision, "requirements");
  state = await artifacts.recordArtifact(root, state.featureId, state.revision, "requirements");
  state = await steps.recordStep(root, state.featureId, state.revision, "requirements_alignment", {});
  state = await artifacts.scaffoldArtifact(root, state.featureId, state.revision, "implementation-plan");
  const planPath = path.join(root, ".dev-flow", "features", state.featureId, state.artifacts["implementation-plan"].path);
  await writeFile(planPath, planMarkdown);
  state = await artifacts.recordArtifact(root, state.featureId, state.revision, "implementation-plan");
  state = await steps.recordStep(root, state.featureId, state.revision, "planning", { reviewType: "plan" });
  return { root, state };
}

test("ordinary M tasks use implementation units with work scope and dependencies, no recovery required", async () => {
  const { root, state } = await setupOrdinaryM();
  try {
    const id = state.featureId;
    // 依赖未完成的前置单元不能开始
    await assert.rejects(
      () => units.beginImplementationUnit(root, id, state.revision, "UNIT-002"),
      (error) => error.code === "IMPLEMENTATION_UNIT_DEPENDENCY_INCOMPLETE",
    );
    // 按依赖顺序执行：begin UNIT-001 → checkpoint → begin UNIT-002 → checkpoint
    const first = await units.beginImplementationUnit(root, id, state.revision, "UNIT-001");
    assert.equal(first.implementationUnits.find((u) => u.unitId === "UNIT-001").status, "active");
    assert.deepEqual(first.implementationUnits.find((u) => u.unitId === "UNIT-001").tasks, ["TASK-001"]);
    const cp1 = await checkpoints.checkpointImplementationUnit(root, id, first.revision, "UNIT-001");
    assert.ok(cp1.manifest.checkpointId.startsWith("CP-"));
    assert.equal(cp1.state.implementationUnits.find((u) => u.unitId === "UNIT-001").status, "checkpointed");

    const second = await units.beginImplementationUnit(root, id, cp1.state.revision, "UNIT-002");
    assert.equal(second.implementationUnits.find((u) => u.unitId === "UNIT-002").status, "active");
    const cp2 = await checkpoints.checkpointImplementationUnit(root, id, second.revision, "UNIT-002");
    assert.equal(cp2.state.implementationUnits.find((u) => u.unitId === "UNIT-002").status, "checkpointed");
    // 同一工作区顺序执行：任何时候只有一个 active 单元
    assert.equal(cp2.state.implementationUnits.filter((u) => u.status === "active").length, 0);
    // 单元全部 checkpoint 后完成 implementation 步骤
    await steps.recordStep(root, id, cp2.state.revision, "implementation", { files: [] });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("a cyclic or dangling unit graph is rejected at plan registration with stable diagnostics", async () => {
  const { root, state } = await setupOrdinaryM();
  try {
    const planPath = path.join(root, ".dev-flow", "features", state.featureId, state.artifacts["implementation-plan"].path);
    // 循环依赖
    const cyclic = planMarkdown.replace("depends_on: [UNIT-001]", "depends_on: [UNIT-002]");
    await writeFile(planPath, cyclic);
    await assert.rejects(
      () => artifacts.recordArtifact(root, state.featureId, state.revision, "implementation-plan"),
      (error) => error.code === "PLAN_TASK_GRAPH_INVALID",
    );
    // 缺失引用
    await writeFile(planPath, planMarkdown.replace("depends_on: [UNIT-001]", "depends_on: [UNIT-999]"));
    await assert.rejects(
      () => artifacts.recordArtifact(root, state.featureId, state.revision, "implementation-plan"),
      (error) => error.code === "PLAN_TASK_GRAPH_INVALID",
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

/** 完成 code 审查批次：每个 job 记录 review-execution 事件并携带隔离声明（ADR-0017）。 */
async function completeCodeReviewBatch(root, state) {
  const id = state.featureId;
  const created = await jobs.createReviewBatch(root, id, state.revision);
  assert.equal(created.batch.phase, "code");
  let current = created.state;
  for (const job of created.batch.jobs) {
    const capability = `${job.role}-capability-1234567890`;
    const claimed = await jobs.claimReviewJob(root, id, current.revision, created.batch.batchId, job.jobId, capability);
    current = claimed.state;
    const eventId = `review-execution-${created.batch.batchId}-${job.jobId}`;
    await store.recordReviewExecutionEvent(root, {
      eventId, type: "review-execution", host: "codex",
      text: `隔离审查 ${job.role}`, batchId: created.batch.batchId, jobId: job.jobId,
      executionId: `execution-${job.jobId}`, sourceId: `source-${job.jobId}`,
      contextId: `review-context-${job.jobId}`, implementationContextId: "implementation-context",
    });
    const submitted = await jobs.submitReviewJob(
      root, id, current.revision, created.batch.batchId, job.jobId, capability,
      { coverageSummary: `${job.role} checked`, findings: [] },
      {
        host: "codex",
        agentId: `agent-${job.jobId}`,
        issuedAt: new Date().toISOString(),
        raw: `raw-${job.jobId}`,
        hostEventId: eventId,
        isolated: true,
      },
    );
    current = submitted.state;
  }
  return current;
}

test("ordinary tasks keep the original stages and verification guarantees", async () => {
  const { root, state } = await setupOrdinaryM();
  try {
    const id = state.featureId;
    assert.equal(state.steps.planning.status, "satisfied");
    assert.equal(stepOrder.currentOpenStep(state), "implementation");
    // verification 保证不变：仍需 targeted/behavior/integration
    assert.deepEqual(state.classification.controls.verification, ["targeted", "behavior", "integration"]);
    // 推进到 verification 不因实现单元而减少
    const first = await units.beginImplementationUnit(root, id, state.revision, "UNIT-001");
    const cp = await checkpoints.checkpointImplementationUnit(root, id, first.revision, "UNIT-001");
    const second = await units.beginImplementationUnit(root, id, cp.state.revision, "UNIT-002");
    const cp2 = await checkpoints.checkpointImplementationUnit(root, id, second.revision, "UNIT-002");
    const implemented = await steps.recordStep(root, id, cp2.state.revision, "implementation", { files: [] });
    const reviewedBatch = await completeCodeReviewBatch(root, implemented);
    const reviewed = await steps.recordStep(root, id, reviewedBatch.revision, "code_review", {
      reviewType: "code",
      coverage: ["quality", "fidelity"],
      findings: [],
    });
    const verification = await loadSource("plugins/dev-flow/src/core/verification.ts");
    const verified = await verification.runVerification(root, id, reviewed.revision, "codex", ["unit"]);
    assert.equal(verified.steps.verification.status, "satisfied");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
