import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { loadSource } from "../helpers/load-source.mjs";

const store = await loadSource("plugins/dev-flow/src/core/state-store.ts");
const artifacts = await loadSource("plugins/dev-flow/src/core/artifacts.ts");
const steps = await loadSource("plugins/dev-flow/src/core/feature-check.ts");
const jobs = await loadSource("plugins/dev-flow/src/core/review-jobs.ts");
const units = await loadSource("plugins/dev-flow/src/core/implementation-units.ts");
const checkpoints = await loadSource("plugins/dev-flow/src/core/checkpoints.ts");
const verification = await loadSource("plugins/dev-flow/src/core/verification.ts");

const okCommand = { id: "unit-ok", command: process.execPath, args: ["-e", "process.exit(0)"], cwd: ".", provides: ["targeted", "behavior", "integration", "full"] };
const failCommand = { id: "unit-fail", command: process.execPath, args: ["-e", "process.exit(1)"], cwd: ".", provides: ["targeted", "behavior", "integration", "full"] };

const config = {
  schemaVersion: 2,
  verification: { commands: [okCommand, failCommand] },
  enforcement: { mode: "strict", gitWriteRequiresLogicComplete: true, oneActiveFeature: true, requireExplicitHumanReply: true },
  governedRoots: ["src"],
};

const planMarkdown = [
  "<!-- dev-flow:id=TASK-001 kind=task -->\n### TASK-001\n\n- covers: REQ-001\n- implementation_unit: UNIT-001\n",
  "<!-- dev-flow:id=TASK-002 kind=task -->\n### TASK-002\n\n- covers: REQ-001\n- implementation_unit: UNIT-002\n",
  "<!-- dev-flow:id=UNIT-001 kind=implementation-unit -->\n### UNIT-001\n\n- tasks: [TASK-001]\n- depends_on: []\n",
  "<!-- dev-flow:id=UNIT-002 kind=implementation-unit -->\n### UNIT-002\n\n- tasks: [TASK-002]\n- depends_on: [UNIT-001]\n",
].join("\n");

const dualAxisReview = {
  reviewType: "code",
  coverage: ["quality", "fidelity"],
  findings: [],
};

async function setupOrdinaryM() {
  const root = await mkdtemp(path.join(os.tmpdir(), "dev-flow-changes-"));
  await mkdir(path.join(root, "src"));
  await store.initProject(root, config);
  let state = await store.startFeature(root, {
    featureId: "changes",
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

async function trustedWrite(root, id, file, contents, host = "codex") {
  const nonce = `write-${file}-${Date.now()}`;
  await store.recordTrustedWriteIntent(root, [file], host, nonce);
  await writeFile(path.join(root, file), contents);
  await store.recordTrustedWriteOwnership(root, [file], host, nonce);
  return store.readState(root, id);
}

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

/** 两个单元分别写入 a.js/b.js 并全部 checkpoint，完成 code_review（双轴）。 */
async function driveToReviewed(root, state) {
  const id = state.featureId;
  let current = state;
  const first = await units.beginImplementationUnit(root, id, current.revision, "UNIT-001");
  current = first;
  current = await trustedWrite(root, id, "src/a.js", "export const a = 1;\n");
  const cp1 = await checkpoints.checkpointImplementationUnit(root, id, current.revision, "UNIT-001");
  current = cp1.state;
  const second = await units.beginImplementationUnit(root, id, current.revision, "UNIT-002");
  current = second;
  current = await trustedWrite(root, id, "src/b.js", "export const b = 2;\n");
  const cp2 = await checkpoints.checkpointImplementationUnit(root, id, current.revision, "UNIT-002");
  current = cp2.state;
  assert.equal(current.implementationUnits.filter((u) => u.status === "checkpointed").length, 2);
  const implemented = await steps.recordStep(root, id, current.revision, "implementation", { files: [] });
  current = implemented;
  current = await completeCodeReviewBatch(root, current);
  const reviewed = await steps.recordStep(root, id, current.revision, "code_review", dualAxisReview);
  current = reviewed;
  assert.equal(current.steps.code_review.status, "satisfied");
  return current;
}

test("changes after code review reopen the affected unit, review, and step chain", async () => {
  const { root, state } = await setupOrdinaryM();
  try {
    const id = state.featureId;
    const reviewed = await driveToReviewed(root, state);
    assert.equal(reviewed.steps.code_review.status, "satisfied");
    // 审查后修改 UNIT-001 写入的交付文件
    const written = await trustedWrite(root, id, "src/a.js", "export const a = 2;\n");
    await assert.rejects(
      () => verification.runVerification(root, id, written.revision, "codex", ["unit-ok"]),
      (error) => error.code === "WORKSPACE_CHANGED",
    );
    const after = await store.readState(root, id);
    // 双轴审查重开
    assert.equal(after.steps.code_review, undefined);
    // 受影响单元 UNIT-001 重开；未受影响 UNIT-002 保留
    const statusByUnit = new Map(after.implementationUnits.map((u) => [u.unitId, u.status]));
    assert.equal(statusByUnit.get("UNIT-001"), "pending");
    assert.equal(statusByUnit.get("UNIT-002"), "checkpointed");
    assert.equal(after.steps.implementation, undefined);
    assert.equal(after.currentStage, "implementation");
    assert.equal(after.lastInvalidation.reopenedUnits.length, 1);
    assert.equal(after.lastInvalidation.reopenedUnits[0], "UNIT-001");
    assert.ok(after.lastInvalidation.changedFiles.includes("src/a.js"));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("changes to a different unit's files reopen only that unit", async () => {
  const { root, state } = await setupOrdinaryM();
  try {
    const id = state.featureId;
    const reviewed = await driveToReviewed(root, state);
    const written = await trustedWrite(root, id, "src/b.js", "export const b = 3;\n");
    await assert.rejects(
      () => verification.runVerification(root, id, written.revision, "codex", ["unit-ok"]),
      (error) => error.code === "WORKSPACE_CHANGED",
    );
    const after = await store.readState(root, id);
    const statusByUnit = new Map(after.implementationUnits.map((u) => [u.unitId, u.status]));
    assert.equal(statusByUnit.get("UNIT-001"), "checkpointed");
    assert.equal(statusByUnit.get("UNIT-002"), "pending");
    assert.equal(after.steps.code_review, undefined);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("fixes after a failed verification cannot jump straight back to verification", async () => {
  const { root, state } = await setupOrdinaryM();
  try {
    const id = state.featureId;
    const reviewed = await driveToReviewed(root, state);
    // 验证失败 → verification 回到 pending
    const failed = await verification.runVerification(root, id, reviewed.revision, "codex", ["unit-fail"]);
    assert.equal(failed.steps.verification.status, "pending");
    // 为修复代码而变更 → 自动回到相同闭环：审查与受影响单元重开
    const written = await trustedWrite(root, id, "src/a.js", "export const a = 4;\n");
    await assert.rejects(
      () => verification.runVerification(root, id, written.revision, "codex", ["unit-ok"]),
      (error) => error.code === "WORKSPACE_CHANGED",
    );
    const after = await store.readState(root, id);
    assert.equal(after.steps.code_review, undefined);
    assert.equal(after.implementationUnits.find((u) => u.unitId === "UNIT-001").status, "pending");
    assert.equal(after.steps.verification.status, "pending");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("non-delivery changes do not invalidate the review or expand scope", async () => {
  const { root, state } = await setupOrdinaryM();
  try {
    const id = state.featureId;
    const reviewed = await driveToReviewed(root, state);
    // governed roots 之外的内容变化（docs/ 不在 src/ 内）
    await mkdir(path.join(root, "docs"), { recursive: true });
    await writeFile(path.join(root, "docs", "notes.md"), "unrelated\n");
    const verified = await verification.runVerification(root, id, reviewed.revision, "codex", ["unit-ok"]);
    assert.equal(verified.steps.verification.status, "satisfied");
    assert.equal(verified.steps.code_review.status, "satisfied");
    assert.equal(verified.lastInvalidation, undefined);
    assert.equal(verified.steps.implementation.status, "satisfied");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("unlocatable changes fall back to full redo and record the diagnosis", async () => {
  const { root, state } = await setupOrdinaryM();
  try {
    const id = state.featureId;
    const reviewed = await driveToReviewed(root, state);
    // 新增 src/other.js：不属于任何单元的实际写入集 → 无法定位 → 完整回退
    const written = await trustedWrite(root, id, "src/other.js", "export const other = 1;\n");
    await assert.rejects(
      () => verification.runVerification(root, id, written.revision, "codex", ["unit-ok"]),
      (error) => error.code === "WORKSPACE_CHANGED",
    );
    const after = await store.readState(root, id);
    assert.equal(after.lastInvalidation.fallback, true);
    assert.ok(after.lastInvalidation.reason.includes("无法定位"));
    assert.ok(after.lastInvalidation.changedFiles.includes("src/other.js"));
    // 完整回退：全部单元重开
    assert.equal(after.implementationUnits.filter((u) => u.status === "checkpointed").length, 0);
    assert.equal(after.implementationUnits.filter((u) => u.status === "pending").length, 2);
    assert.equal(after.steps.code_review, undefined);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("finalize gate confirms the final content matches the review and verification records", async () => {
  const { root, state } = await setupOrdinaryM();
  try {
    const id = state.featureId;
    const reviewed = await driveToReviewed(root, state);
    const verified = await verification.runVerification(root, id, reviewed.revision, "codex", ["unit-ok"]);
    assert.equal(verified.steps.verification.status, "satisfied");
    // 全部依据当前内容一致时可完成
    await steps.finalize(root, id, verified.revision);
    const finalized = await store.readState(root, id);
    assert.equal(finalized.lifecycle, "finalized");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("finalize rejects when governed content changed after verification", async () => {
  const { root, state } = await setupOrdinaryM();
  try {
    const id = state.featureId;
    const reviewed = await driveToReviewed(root, state);
    const verified = await verification.runVerification(root, id, reviewed.revision, "codex", ["unit-ok"]);
    // 验证后再改动交付内容 → finalize 门禁拦截并传播失效
    const written = await trustedWrite(root, id, "src/a.js", "export const a = 9;\n");
    await assert.rejects(
      () => steps.finalize(root, id, written.revision),
      (error) => error.code === "WORKSPACE_CHANGED",
    );
    const after = await store.readState(root, id);
    assert.equal(after.steps.code_review, undefined);
    assert.equal(after.steps.verification.status, "pending");
    assert.equal(after.verification.verifiedFingerprint, undefined);
    assert.equal(after.steps.finalize, undefined);
    assert.equal(after.implementationUnits.find((u) => u.unitId === "UNIT-001").status, "pending");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
