import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { loadSource } from "../helpers/load-source.mjs";

const store = await loadSource("plugins/dev-flow/src/core/state-store.ts");
const artifacts = await loadSource("plugins/dev-flow/src/core/artifacts.ts");
const steps = await loadSource("plugins/dev-flow/src/core/feature-check.ts");
const jobs = await loadSource("plugins/dev-flow/src/core/review-jobs.ts");

const config = {
  schemaVersion: 2,
  verification: { commands: [{ id: "unit", command: process.execPath, args: ["-e", "process.exit(0)"], cwd: ".", provides: ["targeted", "behavior", "integration", "full"] }] },
  enforcement: { mode: "strict", gitWriteRequiresLogicComplete: true, oneActiveFeature: true, requireExplicitHumanReply: true },
  governedRoots: ["src"],
};

async function setup(prefix) {
  const root = await mkdtemp(path.join(os.tmpdir(), prefix));
  await mkdir(path.join(root, "src"));
  await store.initProject(root, config);
  let state = await store.startFeature(root, { featureId: "dual", host: "codex", level: "M", topology: "local", scopeFacts: ["s"], topologyFacts: ["t"], uncertaintyFacts: [], riskFacts: {}, decisionRefs: [] });
  state = await artifacts.scaffoldArtifact(root, "dual", state.revision, "requirements");
  state = await artifacts.recordArtifact(root, "dual", state.revision, "requirements");
  state = await steps.recordStep(root, "dual", state.revision, "requirements_alignment", {});
  state = await artifacts.scaffoldArtifact(root, "dual", state.revision, "implementation-plan");
  const planPath = path.join(root, ".dev-flow", "features", "dual", state.artifacts["implementation-plan"].path);
  const { writeFile } = await import("node:fs/promises");
  await writeFile(planPath, [
    "<!-- dev-flow:id=TASK-001 kind=task -->\n### TASK-001\n\n- covers: REQ-001\n- implementation_unit: UNIT-001\n",
    "<!-- dev-flow:id=UNIT-001 kind=implementation-unit -->\n### UNIT-001\n\n- tasks: [TASK-001]\n- depends_on: []\n",
  ].join("\n"));
  state = await artifacts.recordArtifact(root, "dual", state.revision, "implementation-plan");
  state = await steps.recordStep(root, "dual", state.revision, "planning", { reviewType: "plan" });
  state = await steps.recordStep(root, "dual", state.revision, "implementation", { files: [] });
  return { root, state };
}

async function completeCodeReview(root, state, completionByRole = {}) {
  const created = await jobs.createReviewBatch(root, "dual", state.revision);
  assert.equal(created.batch.phase, "code");
  assert.deepEqual(created.batch.jobs.map((job) => job.role).sort(), ["code-quality", "requirement-fidelity"]);
  let current = created.state;
  for (const job of created.batch.jobs) {
    const capability = `${job.role}-capability-1234567890`;
    const claimed = await jobs.claimReviewJob(root, "dual", current.revision, created.batch.batchId, job.jobId, capability);
    current = claimed.state;
    // 独立代码审查隔离证明（ADR-0017）：helper 扮演合规宿主——记录
    // review-execution 事件并随提交携带隔离声明（contextId != implementationContextId）。
    const eventId = `review-execution-${created.batch.batchId}-${job.jobId}`;
    await store.recordReviewExecutionEvent(root, {
      eventId, type: "review-execution", host: "codex",
      text: `隔离审查 ${job.role}`, batchId: created.batch.batchId, jobId: job.jobId,
      executionId: `execution-${job.jobId}`, sourceId: `source-${job.jobId}`,
      contextId: `review-context-${job.jobId}`, implementationContextId: "implementation-context",
    });
    const submitted = await jobs.submitReviewJob(
      root,
      "dual",
      current.revision,
      created.batch.batchId,
      job.jobId,
      capability,
      completionByRole[job.role] ?? { coverageSummary: `${job.role} checked`, findings: [] },
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

test("code_review rejects caller evidence and requires both ledger-owned review axes", async () => {
  const { root, state } = await setup("dev-flow-dual-axis-");
  try {
    await assert.rejects(
      () => steps.recordStep(root, "dual", state.revision, "code_review", { coverage: ["quality", "fidelity"], findings: [] }),
      (error) => error.code === "REVIEW_BATCH_REQUIRED",
    );
    const reviewed = await completeCodeReview(root, state);
    const passed = await steps.recordStep(root, "dual", reviewed.revision, "code_review", {});
    assert.equal(passed.steps.code_review.status, "satisfied");
    assert.equal(typeof passed.steps.code_review.evidence.batchId, "string");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("a blocking finding in either review axis keeps code_review blocked", async () => {
  const { root, state } = await setup("dev-flow-dual-axis-resolved-");
  try {
    const reviewed = await completeCodeReview(root, state, {
      "requirement-fidelity": {
        coverageSummary: "checked all requirements",
        findings: [{ category: "requirement-fidelity", severity: "blocking", targets: ["src"], evidence: [{ path: "src" }], claim: "AC-001 未实现", recommendation: "补实现" }],
      },
    });
    await assert.rejects(
      () => steps.recordStep(root, "dual", reviewed.revision, "code_review", {}),
      (error) => error.code === "REVIEW_BLOCKING_FINDINGS",
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
