import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import { loadSource } from "../helpers/load-source.mjs";
import { driveUntil, routeFlowConfig } from "../helpers/route-flow.mjs";

const run = promisify(execFile);
const store = await loadSource("plugins/dev-flow/src/core/state-store.ts");
const steps = await loadSource("plugins/dev-flow/src/core/feature-check.ts");
const quality = await loadSource("plugins/dev-flow/src/core/quality-exceptions.ts");
const fingerprintSource = await loadSource("plugins/dev-flow/src/core/fingerprint.ts");
const reviewJobs = await loadSource("plugins/dev-flow/src/core/review-jobs.ts");
const reviewAdapter = await loadSource("plugins/dev-flow/src/hosts/review-execution-adapter.ts");

/** M 路线（shared-contract + unitCount 2 → 独立代码审查）使用新分类合同。 */
async function setup(prefix) {
  const root = await mkdtemp(path.join(os.tmpdir(), prefix));
  await mkdir(path.join(root, "src"));
  await writeFile(path.join(root, "src", "main.js"), "export {}\n");
  await run("git", ["init", "--quiet"], { cwd: root });
  await run("git", ["add", "."], { cwd: root });
  await run("git", ["-c", "user.name=Dev Flow Tests", "-c", "user.email=tests@example.invalid", "commit", "--quiet", "-m", "seed"], { cwd: root });
  await store.initProject(root, routeFlowConfig);
  let state = await store.startFeature(root, { featureId: "iso", host: "codex" });
  state = await store.lockClassification(root, "iso", state.revision, {
    level: "M",
    topology: "shared-contract",
    scopeFactRefs: [],
    topologyFactRefs: [],
    uncertaintyFactRefs: [],
    riskFactRefs: {},
    decisionRefs: [],
    signals: {
      changeSurface: "multi-component",
      behaviorChange: "new-capability",
      topology: "shared-contract",
      unitCount: 2,
      requirements: "provided-confirmed",
      operationalRecovery: false,
      executableRollback: false,
    },
  }, { scanned: ["assumption", "free-space", "tbd", "fallback", "scope", "acceptance"], items: [] });
  await store.recordHostEvent(root, { eventId: `route-${state.revision}`, type: "user-prompt", host: "claude", text: "确认这条路线" });
  state = (await store.answer({ root, featureId: "iso", expectedRevision: state.revision, host: "claude", credential: { source: "text", userReply: "确认这条路线" } })).state;
  return { root, state };
}

/** 实现单元写入 + 可信归属记录（checkpoint 前要求工作区归属闭环）。 */
async function unitWriter(root, current) {
  const paths = ["src/main.js"];
  const contents = "export const m = 1;\n";
  await store.recordTrustedWriteIntent(root, paths, "codex", `write-${current.revision}`);
  await writeFile(path.join(root, "src", "main.js"), contents);
  await store.recordTrustedWriteOwnership(root, paths, "codex", `write-${current.revision}`);
  return store.readState(root, "iso");
}

const driveOptions = (extra = {}) => ({ input: {}, stopAt: (action) => action.kind === "done", unitWriter, ...extra });

test("code review without isolation proof stays blocked on independent-review routes (issue 19)", async () => {
  const { root, state } = await setup("dev-flow-iso-gate-");
  try {
    await assert.rejects(
      () => driveUntil(root, "iso", state, driveOptions({ codeIsolation: false })),
      (error) => {
        assert.equal(error.code, "REVIEW_ISOLATION_REQUIRED");
        assert.ok(error.details.jobIds.length >= 1, "missing isolation job ids must be listed");
        assert.ok(error.details.recoveryHint, "recovery hint must explain the recovery paths");
        return true;
      },
    );
    // 门禁失败不推进步骤：code_review 仍未满足，批次保持已提交但审查未完成。
    const after = await store.readState(root, "iso");
    assert.notEqual(after.steps.code_review?.status, "satisfied");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("a current code batch without isolation proof is not idempotently returned; a new pending batch can be created", async () => {
  const { root, state } = await setup("dev-flow-iso-new-batch-");
  try {
    await assert.rejects(
      () => driveUntil(root, "iso", state, driveOptions({ codeIsolation: false })),
      (error) => error.code === "REVIEW_ISOLATION_REQUIRED",
    );
    const blocked = await store.readState(root, "iso");
    const recreated = await reviewJobs.createReviewBatch(root, "iso", blocked.revision);
    assert.equal(recreated.created, true, "missing-isolation current batch must not block a fresh pending batch");
    assert.equal(recreated.batch.phase, "code");
    assert.equal(recreated.batch.progress, "open");
    for (const job of recreated.batch.jobs) {
      assert.equal(job.status, "pending");
      assert.equal(job.reusedFrom, undefined);
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("host review-execution events satisfy the isolation requirement and the route completes", async () => {
  const { root, state } = await setup("dev-flow-iso-pass-");
  try {
    // route-flow helper 默认扮演合规宿主：为每个 code job 记录 review-execution 事件。
    const driven = await driveUntil(root, "iso", state, driveOptions());
    assert.equal(driven.action.kind, "done");
    const done = await store.readState(root, "iso");
    assert.equal(done.steps.code_review.status, "satisfied");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("an accepted review quality exception lets the user proceed without isolation (risk-acceptance recovery)", async () => {
  const { root, state } = await setup("dev-flow-iso-risk-");
  try {
    // 先按无隔离驱动到 code_review 门禁失败。
    await assert.rejects(
      () => driveUntil(root, "iso", state, driveOptions({ codeIsolation: false })),
      (error) => error.code === "REVIEW_ISOLATION_REQUIRED",
    );
    const blocked = await store.readState(root, "iso");
    // 明确接受独立性风险（ADR-0017 恢复路径）：质量例外绑定当前交付内容。
    const fp = await fingerprintSource.fingerprintGovernedRoots(root, routeFlowConfig);
    const presented = await quality.presentQualityException(root, "iso", blocked.revision, {
      kind: "review",
      basisHash: "a".repeat(64),
      fingerprint: fp,
      riskSummary: "宿主无法提供隔离上下文，接受独立性风险继续",
    });
    await store.recordHostEvent(root, { eventId: "accept-risk", type: "user-prompt", host: "codex", text: "接受风险" });
    await store.answer({
      root, featureId: "iso", expectedRevision: presented.state.revision, host: "codex",
      credential: { source: "elicitation", action: "accept", comment: "接受独立性风险，宿主暂无法提供隔离上下文" },
    });
    // 风险接受后 code_review 门禁放行；失败检查本身保持未完成（不改写为通过）。
    const accepted = await store.readState(root, "iso");
    const passed = await steps.recordStep(root, "iso", accepted.revision, "code_review", {});
    assert.equal(passed.steps.code_review.status, "satisfied");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("code review role basis changes with feature-owned content; plan roles do not", () => {
  const baseBasis = {
    featureId: "basis",
    route: "m",
    workflowCapabilities: { trace: 0, review: 1, checkpoints: 0, rollbackExecution: 0 },
    classification: { level: "M", topology: "shared-contract", riskLabels: [] },
    artifacts: [],
    projectConfigSha256: "project",
    scopeManifestSha256: "scope",
    governedRootsFingerprint: "governed",
    featureOwnedFingerprint: "owned-1",
  };
  const codeHash1 = reviewJobs.roleBasisHash(baseBasis, [], undefined, "code-quality");
  const codeHash2 = reviewJobs.roleBasisHash(
    { ...baseBasis, featureOwnedFingerprint: "owned-2" },
    [],
    undefined,
    "code-quality",
  );
  assert.notEqual(codeHash1, codeHash2, "code review basis must bind feature-owned content");

  const planHash1 = reviewJobs.roleBasisHash(baseBasis, [], undefined, "requirements-coverage");
  const planHash2 = reviewJobs.roleBasisHash(
    { ...baseBasis, featureOwnedFingerprint: "owned-2" },
    [],
    undefined,
    "requirements-coverage",
  );
  assert.equal(planHash1, planHash2, "plan review basis must not depend on feature-owned content");
});

test("reused jobs require an isolation proof on their original submission", () => {
  const submissionWithProof = { payloadSha256: "p", findings: [], isolationProof: { mode: "subagent" } };
  const submissionWithoutProof = { payloadSha256: "p", findings: [] };
  const submittedWithProof = { jobId: "with", status: "submitted", submission: submissionWithProof };
  const submittedWithoutProof = { jobId: "without", status: "submitted", submission: submissionWithoutProof };
  const reusedWithProof = { jobId: "reused-with", status: "reused", reusedFrom: { batchId: "b", jobId: "with" } };
  const reusedWithoutProof = { jobId: "reused-without", status: "reused", reusedFrom: { batchId: "b", jobId: "without" } };
  const ledger = {
    batches: [
      { batchId: "b", jobs: [submittedWithProof, submittedWithoutProof] },
      { batchId: "c", jobs: [reusedWithProof, reusedWithoutProof] },
    ],
  };
  assert.equal(reviewJobs.jobHasEffectiveIsolationProof(ledger, submittedWithProof), true);
  assert.equal(reviewJobs.jobHasEffectiveIsolationProof(ledger, submittedWithoutProof), false);
  assert.equal(reviewJobs.jobHasEffectiveIsolationProof(ledger, reusedWithProof), true);
  assert.equal(reviewJobs.jobHasEffectiveIsolationProof(ledger, reusedWithoutProof), false);
});



test("SubagentStop hook records review-execution only for a declared job with distinct context ids", async () => {
  const { root, state } = await setup("dev-flow-subagent-proof-");
  try {
    const declarationId = "decl-1234567890";
    await store.appendFeatureEvent(root, "iso", state.revision, "review-execution-declared", {
      type: "review-execution-declared",
      declarationId,
      batchId: "batch-1",
      jobId: "job-1",
      executionId: "execution-1",
      host: "claude",
      declaredAt: new Date().toISOString(),
    });

    const missingIds = await reviewAdapter.recordSubagentReviewOutput(root, {
      hook_event_name: "SubagentStop",
      prompt: `dev-flow:isolated-review:${declarationId}`,
      tool_input: {},
    }, "claude");
    assert.equal(missingIds.recorded, false);
    assert.equal(missingIds.reason, "missing-context-ids");

    const completion = JSON.stringify({ coverageSummary: "isolated review complete", findings: [] });
    const recorded = await reviewAdapter.recordSubagentReviewOutput(root, {
      hook_event_name: "SubagentStop",
      prompt: `dev-flow:isolated-review:${declarationId}`,
      session_id: "implementation-session",
      agent_id: "review-subagent-1",
      agent_transcript_path: "/nonexistent/transcript.jsonl",
      last_assistant_message: `dev-flow:isolated-review:${declarationId}\n${completion}`,
      tool_input: {},
    }, "claude");
    assert.equal(recorded.recorded, true);
    assert.equal(recorded.eventId, `${declarationId}:complete`);

    const events = await store.readFeatureEvents(root, "iso");
    const proof = events.find((item) => item.type === "review-execution"
      && (item.data || {}).eventId === `${declarationId}:complete`);
    assert.ok(proof, "host proof event must be persisted");
    assert.equal(proof.data.contextId, "review-subagent-1");
    assert.equal(proof.data.implementationContextId, "implementation-session");
    assert.equal(proof.data.text, `dev-flow:isolated-review:${declarationId}\n${completion}`);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("review-execution events are not exposed as an agent-callable MCP tool (no self-attestation)", async () => {
  // 隔离证明只能来自宿主捕获或受控采样；agent 不得通过公开工具自证隔离。
  // v6 合同已删除全部逐 job 公开 review mutation：start/complete execution 是
  // 唯二状态变更入口，proof event 只由 host adapter 内部 seam 写入。
  const { readFile } = await import("node:fs/promises");
  const serverSource = await readFile(path.join(process.cwd(), "plugins/dev-flow/src/mcp/dispatch.ts"), "utf8");
  for (const name of [
    "dev_flow_claim_review_job",
    "dev_flow_release_review_job",
    "dev_flow_start_isolated_review",
    "dev_flow_submit_review_job",
    "dev_flow_sample_review_job",
    "dev_flow_record_review_execution_event",
  ]) {
    assert.doesNotMatch(serverSource, new RegExp(`${name}: \\{`), `${name} must not be a tool declaration`);
    assert.doesNotMatch(serverSource, new RegExp(`case "${name}"`), `${name} must not have a dispatch handler`);
  }
});
