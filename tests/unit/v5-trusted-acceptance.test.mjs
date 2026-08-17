import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { loadSource } from "../helpers/load-source.mjs";

const store = await loadSource("plugins/dev-flow/src/core/state-store.ts");
const artifacts = await loadSource("plugins/dev-flow/src/core/artifacts.ts");
const checks = await loadSource("plugins/dev-flow/src/core/feature-check.ts");
const units = await loadSource("plugins/dev-flow/src/core/implementation-units.ts");
const checkpoints = await loadSource("plugins/dev-flow/src/core/checkpoints.ts");
const verification = await loadSource("plugins/dev-flow/src/core/verification.ts");
const acceptance = await loadSource("plugins/dev-flow/src/core/acceptance.ts");
const inspection = await loadSource("plugins/dev-flow/src/core/inspection.ts");
const reviewJobs = await loadSource("plugins/dev-flow/src/core/review-jobs.ts");
const { registerTraceFixture } = await import("../helpers/trace-fixtures.mjs");
import { v6ImplementationPlanMarkdown, v6RequirementsMarkdown } from "../helpers/v6-fixtures.mjs";

const config = {
  schemaVersion: 2,
  verification: { commands: [{ id: "pass", command: process.execPath, args: ["-e", "process.exit(0)"], cwd: ".", provides: ["targeted", "behavior", "integration", "full"] }] },
  enforcement: { mode: "strict", gitWriteRequiresLogicComplete: true, oneActiveFeature: true, requireExplicitHumanReply: true },
  governedRoots: ["src"],
};

const requirementsMarkdown = v6RequirementsMarkdown().replace(
  "- parent_requirement: REQ-001\n- verification_kind: behavior-test",
  "- parent_requirement: REQ-001\n- verification_kind: human-acceptance\n- verification_reason: 用户确认页面结果",
);
const planMarkdown = v6ImplementationPlanMarkdown({ commandId: "pass", tdd: "direct" });

async function setup() {
  const root = await mkdtemp(path.join(os.tmpdir(), "dev-flow-acceptance-authority-"));
  await mkdir(path.join(root, "src"));
  await store.initProject(root, config);
  let state = await store.startFeature(root, {
    featureId: "acceptance",
    host: "codex",
    level: "M",
    topology: "local",
    classificationBasis: {
      scopeFacts: ["scope"], topologyFacts: ["topology"], uncertaintyFacts: [], riskFacts: {}, decisionRefs: [],
      signals: { changeSurface: "multi-component", behaviorChange: "new-capability", topology: "local", unitCount: 1, requirements: "provided-confirmed", operationalRecovery: false, executableRollback: false },
      controlEnhancements: { trace: true },
    },
  });
  state = await registerTraceFixture({ root, featureId: state.featureId, state, kind: "requirements", edit: () => requirementsMarkdown });
  state = await checks.recordStep(root, "acceptance", state.revision, "requirements_alignment", {});
  state = await artifacts.scaffoldArtifact(root, "acceptance", state.revision, "implementation-plan");
  const planPath = path.join(root, ".dev-flow", "features", "acceptance", state.artifacts["implementation-plan"].path);
  await writeFile(planPath, planMarkdown);
  state = (await artifacts.recordArtifactFromMarkdown(root, "acceptance", state.revision, "implementation-plan")).state;
  state = await checks.recordStep(root, "acceptance", state.revision, "planning", { reviewType: "plan" });
  const begun = await units.beginImplementationUnit(root, "acceptance", state.revision, "UNIT-001");
  state = (await checkpoints.checkpointImplementationUnit(root, "acceptance", begun.revision, "UNIT-001")).state;
  state = await checks.recordStep(root, "acceptance", state.revision, "implementation", { files: [] });
  // 独立代码审查隔离证明（ADR-0017）：code 批次每个 job 记录 review-execution
  // 事件并携带隔离声明后再登记 code_review 步骤证据。
  const created = await reviewJobs.createReviewBatch(root, "acceptance", state.revision);
  assert.equal(created.batch.phase, "code");
  state = created.state;
  for (const job of created.batch.jobs) {
    const capability = `${job.role}-capability-1234567890`;
    const claimed = await reviewJobs.claimReviewJob(root, "acceptance", state.revision, created.batch.batchId, job.jobId, capability);
    state = claimed.state;
    const eventId = `review-execution-${created.batch.batchId}-${job.jobId}`;
    await store.recordReviewExecutionEvent(root, {
      eventId, type: "review-execution", host: "codex",
      text: `隔离审查 ${job.role}`, batchId: created.batch.batchId, jobId: job.jobId,
      executionId: `execution-${job.jobId}`, sourceId: `source-${job.jobId}`,
      contextId: `review-context-${job.jobId}`, implementationContextId: "implementation-context",
    });
    const submitted = await reviewJobs.submitReviewJob(
      root, "acceptance", state.revision, created.batch.batchId, job.jobId, capability,
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
    state = submitted.state;
  }
  state = await checks.recordStep(root, "acceptance", state.revision, "code_review", { reviewType: "code", coverage: ["quality", "fidelity"], findings: [] });
  return { root, state };
}

const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64");

test("命令成功但人工验收没有可信记录时，验证仍保持待处理", async () => {
  const { root, state } = await setup();
  try {
    const result = await verification.runVerification(root, "acceptance", state.revision, "codex", ["pass"]);
    assert.equal(result.steps.verification.status, "pending");
    assert.deepEqual(result.steps.verification.evidence.pendingAcceptanceCriteria, ["AC-001"]);
    assert.equal(result.verification.satisfiedByAttemptId, undefined);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("普通 user-prompt 不能冒充浏览器操作，伪截图也不能登记", async () => {
  const { root, state } = await setup();
  try {
    await store.recordHostEvent(root, { eventId: "prompt", type: "user-prompt", host: "codex", text: "页面正常" });
    await assert.rejects(
      () => acceptance.recordAcceptanceEvidence(root, "acceptance", state.revision, { acceptanceCriterionId: "AC-001", host: "codex", evidence: { kind: "browser-operation", eventId: "prompt" } }),
      (error) => error.code === "INVALID_ACCEPTANCE_EVIDENCE",
    );
    const current = await store.readState(root, "acceptance");
    await writeFile(path.join(root, "src", "fake.png"), Buffer.from("fake-png"));
    await store.recordHostEvent(root, { eventId: "browser", type: "tool", host: "codex", toolName: "browser_click", text: "click" });
    await assert.rejects(
      () => acceptance.recordAcceptanceEvidence(root, "acceptance", current.revision, { acceptanceCriterionId: "AC-001", host: "codex", evidence: { kind: "screenshot", path: "src/fake.png", sourceEventId: "browser" } }),
      (error) => error.code === "INVALID_ACCEPTANCE_EVIDENCE",
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("真实浏览器事件和截图可形成当前验收记录", async () => {
  const { root, state } = await setup();
  try {
    await store.recordHostEvent(root, {
      eventId: "browser",
      type: "tool",
      host: "codex",
      toolName: "browser_click",
      executionId: "browser-execution",
      result: "success",
      resultSummary: "button clicked",
      text: "click",
    });
    await writeFile(path.join(root, "screenshot.png"), png);
    let current = await acceptance.recordAcceptanceEvidence(root, "acceptance", state.revision, { acceptanceCriterionId: "AC-001", host: "codex", evidence: { kind: "screenshot", path: "screenshot.png", sourceEventId: "browser" } });
    const verified = await verification.runVerification(root, "acceptance", current.revision, "codex", ["pass"]);
    assert.equal(verified.steps.verification.status, "satisfied");
    const view = await inspection.inspectFeature(root, "acceptance", "verification");
    assert.equal(view.content.latestAttempt.exitReason, "success");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("可信用户确认绑定当前依据且只能消费一次", async () => {
  const { root, state } = await setup();
  try {
    const presented = await acceptance.presentAcceptanceConfirmation(root, "acceptance", state.revision, ["AC-001"]);
    await store.recordHostEvent(root, { eventId: "accept-prompt", type: "user-prompt", host: "codex", text: "确认验收" });
    const confirmed = await store.answerFromHostEvents({
      root, featureId: "acceptance", expectedRevision: presented.state.revision, host: "codex",
    });
    assert.equal(confirmed.action, "confirm");
    await assert.rejects(
      () => store.answerFromHostEvents({
        root, featureId: "acceptance", expectedRevision: confirmed.state.revision, host: "codex",
      }),
      (error) => error.code === "INTERACTION_NOT_PENDING",
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
