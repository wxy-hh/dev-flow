import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { loadSource } from "../helpers/load-source.mjs";
import { driveUntil, completeReviewJobs, prepareReviewReadyFeature, routeFlowConfig } from "../helpers/route-flow.mjs";
import { registerTraceFixture, traceDeltaFor } from "../helpers/trace-fixtures.mjs";

const store = await loadSource("plugins/dev-flow/src/core/state-store.ts");
const artifacts = await loadSource("plugins/dev-flow/src/core/artifacts.ts");
const steps = await loadSource("plugins/dev-flow/src/core/feature-check.ts");
const jobs = await loadSource("plugins/dev-flow/src/core/review-jobs.ts");
const reviewStore = await loadSource("plugins/dev-flow/src/core/review-store.ts");
const next = await loadSource("plugins/dev-flow/src/core/next.ts");
const units = await loadSource("plugins/dev-flow/src/core/implementation-units.ts");
const quality = await loadSource("plugins/dev-flow/src/core/quality-exceptions.ts");
const inspection = await loadSource("plugins/dev-flow/src/core/inspection.ts");
const fingerprintSource = await loadSource("plugins/dev-flow/src/core/fingerprint.ts");
const stepOrder = await loadSource("plugins/dev-flow/src/core/step-order.ts");

const codeReviewConfig = {
  schemaVersion: 2,
  verification: { commands: [{ id: "unit", command: process.execPath, args: ["-e", "process.exit(0)"], cwd: ".", provides: ["targeted", "behavior", "integration", "full"] }] },
  enforcement: { mode: "strict", gitWriteRequiresLogicComplete: true, oneActiveFeature: true, requireExplicitHumanReply: true },
  governedRoots: ["src"],
};

const planMarkdown = [
  "<!-- dev-flow:id=TASK-001 kind=task -->\n### TASK-001\n\n- covers: REQ-001\n- implementation_unit: UNIT-001\n",
  "<!-- dev-flow:id=UNIT-001 kind=implementation-unit -->\n### UNIT-001\n\n- tasks: [TASK-001]\n- depends_on: []\n",
].join("\n");

const blockingFinding = {
  severity: "blocking",
  category: "requirements-coverage",
  targets: ["REQ-001"],
  evidence: [{ path: "需求文档.md", line: 3 }],
  claim: "AC-001 缺少行为验证覆盖",
  recommendation: "补充测试或显式验证处置",
};

const warningFinding = {
  severity: "warning",
  category: "requirements-coverage",
  targets: ["TEST-001"],
  evidence: [{ path: "实施计划.md", line: 10 }],
  claim: "测试命名可以更明确",
  recommendation: "后续批量优化，不阻塞当前路线",
};

async function setupPlanReview(root, featureId) {
  return prepareReviewReadyFeature(root, {
    level: "M",
    topology: "shared-contract",
    requirements: "provided-confirmed",
    scopeFacts: ["共享契约需求"],
    topologyFacts: ["共享契约"],
    uncertaintyFacts: [],
    riskFacts: {},
    decisionRefs: [],
  }, { featureId });
}

/** M local 路线：无计划审查（planReview=false）、独立代码审查。默认登记到 code_review 前一步。 */
async function setupCodeReviewRoute(prefix, options = {}) {
  const { recordImplementation = true } = options;
  const root = await mkdtemp(path.join(os.tmpdir(), prefix));
  await mkdir(path.join(root, "src"));
  await writeFile(path.join(root, "src", "main.js"), "export {}\n");
  await store.initProject(root, codeReviewConfig);
  let state = await store.startFeature(root, {
    featureId: "gate",
    host: "codex",
    level: "M",
    topology: "local",
    scopeFacts: ["s"],
    topologyFacts: ["t"],
    uncertaintyFacts: [],
    riskFacts: {},
    decisionRefs: [],
  });
  assert.equal(state.mode, "routed");
  assert.equal(state.classification.controls.planReview, false);
  assert.equal(state.classification.controls.codeReview, "independent");
  state = await artifacts.scaffoldArtifact(root, "gate", state.revision, "requirements");
  state = await artifacts.recordArtifact(root, "gate", state.revision, "requirements");
  state = await steps.recordStep(root, "gate", state.revision, "requirements_alignment", {});
  state = await artifacts.scaffoldArtifact(root, "gate", state.revision, "implementation-plan");
  const planPath = path.join(root, ".dev-flow", "features", "gate", state.artifacts["implementation-plan"].path);
  await writeFile(planPath, planMarkdown);
  state = await artifacts.recordArtifact(root, "gate", state.revision, "implementation-plan");
  state = await steps.recordStep(root, "gate", state.revision, "planning", { reviewType: "plan" });
  if (recordImplementation) {
    // M local 无 unit-chain checkpoint：直接登记 implementation，进入 code_review 步骤。
    state = await steps.recordStep(root, "gate", state.revision, "implementation", { files: [] });
    assert.equal(stepOrder.currentOpenStep(state), "code_review");
  }
  return { root, state };
}

test("no review obligation returns ready without reading the ledger", async () => {
  const { root, state } = await setupCodeReviewRoute("dev-flow-gate-noob-", { recordImplementation: false });
  try {
    // M local：当前 open step 是 implementation（非 code_review），默认相位为 plan，
    // 无计划审查义务 → 直接 ready 且不读账本。但 code 相位有独立审查义务。
    // 删掉 review 快照文件：若 gate 在本应跳过时读账本，会因读取失败而抛错。
    assert.notEqual(stepOrder.currentOpenStep(state), "code_review");
    const relative = state.review.path;
    const snapshot = path.join(root, ".dev-flow", "features", state.featureId, relative);
    await rm(snapshot, { force: true });
    const gate = await jobs.reviewGate(root, state);
    assert.deepEqual(gate, { status: "ready" });
    assert.equal(gate.stamp, undefined);
    // code 相位有义务：此时读账本会因快照缺失而 fail-closed。
    await assert.rejects(
      () => jobs.reviewGate(root, state, { phase: "code" }),
      (error) => error.code === "REVIEW_INTEGRITY_FAILED",
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("missing batch is a structured need-batch and next/recordStep agree", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "dev-flow-gate-missing-"));
  try {
    const state = await setupPlanReview(root, "missing");
    const gate = await jobs.reviewGate(root, state);
    assert.deepEqual(gate, { status: "need-batch", cause: "missing" });
    assert.deepEqual(await next.nextAction(root, state.featureId), { kind: "create-review-batch", step: "planning" });
    await assert.rejects(
      () => steps.recordStep(root, state.featureId, state.revision, "planning", {}),
      (error) => error.code === "REVIEW_BATCH_REQUIRED",
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("stale basis is a structured need-batch and next/recordStep agree", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "dev-flow-gate-stale-"));
  try {
    const { createHash } = await import("node:crypto");
    let state = await setupPlanReview(root, "stale");
    const created = await jobs.createReviewBatch(root, state.featureId, state.revision);
    state = (await completeReviewJobs(root, state.featureId, created.state, created.batch)).state;
    const raw = await readFile(path.join(root, ".dev-flow", "project.json"));
    const config = JSON.parse(raw);
    config.verification.commands[0].args = ["--test", "--changed"];
    await store.updateProjectConfig(root, config, createHash("sha256").update(raw).digest("hex"));
    const gate = await jobs.reviewGate(root, state);
    assert.equal(gate.status, "need-batch");
    assert.equal(gate.cause, "stale");
    assert.equal(gate.batchId, created.batch.batchId);
    const nextAfter = await next.nextAction(root, state.featureId);
    assert.equal(nextAfter.kind, "repair-trace");
    assert.equal(nextAfter.code, "TRACE_SLICE_STALE");
    assert.equal(nextAfter.step, "implementation_plan");
    // recordStep/begin 内部的 gate 调用听到同一句“依据过期”。
    // （完整 recordStep 会先被 trace 门禁拦截：验证命令变更同时使 trace 切片过期。）
    await assert.rejects(
      () => jobs.requireReviewReady(root, state),
      (error) => error.code === "REVIEW_BASIS_STALE",
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("phase mismatch is a structured need-batch (query carries the phase)", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "dev-flow-gate-phase-"));
  try {
    const state = await setupPlanReview(root, "phase");
    const created = await jobs.createReviewBatch(root, state.featureId, state.revision);
    assert.equal(created.batch.phase, "plan");
    // 当前批次是 plan 批次，问 code：不是缺批次，而是相位不对。
    const gate = await jobs.reviewGate(root, created.state, { phase: "code" });
    assert.equal(gate.status, "need-batch");
    assert.equal(gate.cause, "phase");
    assert.equal(gate.batchId, created.batch.batchId);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("open jobs are listed on the gate and next/recordStep agree", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "dev-flow-gate-jobs-"));
  try {
    const state = await setupPlanReview(root, "jobs");
    const created = await jobs.createReviewBatch(root, state.featureId, state.revision);
    const gate = await jobs.reviewGate(root, created.state);
    assert.equal(gate.status, "jobs-open");
    assert.equal(gate.batchId, created.batch.batchId);
    assert.deepEqual(gate.jobs.map((job) => job.jobId).sort(), created.batch.jobs.map((job) => job.jobId).sort());
    assert.ok(gate.jobs.every((job) => job.status !== "submitted"));
    const pending = await next.nextAction(root, state.featureId);
    assert.equal(pending.kind, "review-jobs-pending");
    assert.equal(pending.batchId, created.batch.batchId);
    assert.deepEqual(pending.jobs.map((job) => job.jobId).sort(), gate.jobs.map((job) => job.jobId).sort());
    await assert.rejects(
      () => steps.recordStep(root, state.featureId, created.state.revision, "planning", {}),
      (error) => error.code === "REVIEW_BATCH_INCOMPLETE",
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("unresolved blocking findings surface as findingIds on gate, next, and recordStep", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "dev-flow-gate-blocking-"));
  try {
    const state = await setupPlanReview(root, "blocking");
    const created = await jobs.createReviewBatch(root, state.featureId, state.revision);
    const completed = await completeReviewJobs(root, state.featureId, created.state, created.batch, {
      completions: { "requirements-coverage": { coverageSummary: "reviewed", findings: [blockingFinding] } },
    });
    const gate = await jobs.reviewGate(root, completed.state);
    assert.equal(gate.status, "blocking");
    assert.equal(gate.batchId, created.batch.batchId);
    assert.equal(gate.findingIds.length, 1);
    const pending = await next.nextAction(root, state.featureId);
    assert.equal(pending.kind, "review-jobs-pending");
    assert.equal(pending.batchId, created.batch.batchId);
    assert.deepEqual(pending.findingIds, gate.findingIds);
    assert.equal(pending.jobs, undefined);
    await assert.rejects(
      () => steps.recordStep(root, state.featureId, completed.state.revision, "planning", {}),
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

test("missing isolation surfaces as jobIds on the gate and code_review blocks", async () => {
  const { root, state } = await setupCodeReviewRoute("dev-flow-gate-isolation-");
  try {
    const id = state.featureId;
    const created = await jobs.createReviewBatch(root, id, state.revision);
    assert.equal(created.batch.phase, "code");
    const completed = await completeReviewJobs(root, id, created.state, created.batch, {
      codeIsolation: false,
      skipPendingAssert: true,
    });
    const gate = await jobs.reviewGate(root, completed.state, { phase: "code" });
    assert.equal(gate.status, "isolation");
    assert.equal(gate.batchId, created.batch.batchId);
    assert.ok(gate.jobIds.length >= 1, "missing isolation job ids must be listed");
    assert.ok(gate.jobIds.every((jobId) => created.batch.jobs.some((job) => job.jobId === jobId)));
    // next 不再 throw-through：code_review 步骤返回 run-step，隔离由 recordStep 门禁执行。
    const action = await next.nextAction(root, id);
    assert.equal(action.kind, "run-step");
    assert.equal(action.step, "code_review");
    await assert.rejects(
      () => steps.recordStep(root, id, completed.state.revision, "code_review", {}),
      (error) => {
        assert.equal(error.code, "REVIEW_ISOLATION_REQUIRED");
        assert.deepEqual(error.details.jobIds, gate.jobIds);
        return true;
      },
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("a review quality exception clears blocking and isolation to ready", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "dev-flow-gate-exception-"));
  try {
    const id = "exception";
    let state = await setupPlanReview(root, id);
    const created = await jobs.createReviewBatch(root, id, state.revision);
    state = (await completeReviewJobs(root, id, created.state, created.batch, {
      completions: { "requirements-coverage": { coverageSummary: "reviewed", findings: [blockingFinding] } },
    })).state;
    assert.equal((await jobs.reviewGate(root, state)).status, "blocking");
    const fp = await fingerprintSource.fingerprintGovernedRoots(root, routeFlowConfig);
    const presented = await quality.presentQualityException(root, id, state.revision, {
      kind: "review",
      basisHash: "a".repeat(64),
      fingerprint: fp,
      riskSummary: "接受阻断发现风险继续",
    });
    await store.recordHostEvent(root, { eventId: "accept-review-risk", type: "user-prompt", host: "codex", text: "接受风险" });
    state = (await store.answer({
      root, featureId: id, expectedRevision: presented.state.revision, host: "codex",
      credential: { source: "elicitation", action: "accept", comment: "接受" },
    })).state;
    const gate = await jobs.reviewGate(root, state);
    assert.equal(gate.status, "ready");
    assert.equal(gate.stamp.batchId, created.batch.batchId);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("an accepted quality exception also clears the code isolation gate", async () => {
  const { root, state } = await setupCodeReviewRoute("dev-flow-gate-iso-exc-");
  try {
    const id = state.featureId;
    const created = await jobs.createReviewBatch(root, id, state.revision);
    let current = (await completeReviewJobs(root, id, created.state, created.batch, { codeIsolation: false, skipPendingAssert: true })).state;
    assert.equal((await jobs.reviewGate(root, current, { phase: "code" })).status, "isolation");
    const fp = await fingerprintSource.fingerprintGovernedRoots(root, codeReviewConfig);
    const presented = await quality.presentQualityException(root, id, current.revision, {
      kind: "review",
      basisHash: "a".repeat(64),
      fingerprint: fp,
      riskSummary: "宿主无法提供隔离上下文，接受独立性风险继续",
    });
    await store.recordHostEvent(root, { eventId: "accept-iso-risk", type: "user-prompt", host: "codex", text: "接受风险" });
    current = (await store.answer({
      root, featureId: id, expectedRevision: presented.state.revision, host: "codex",
      credential: { source: "elicitation", action: "accept", comment: "接受" },
    })).state;
    const gate = await jobs.reviewGate(root, current, { phase: "code" });
    assert.equal(gate.status, "ready");
    const passed = await steps.recordStep(root, id, current.revision, "code_review", {});
    assert.equal(passed.steps.code_review.status, "satisfied");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("inspect shows unresolved blocking findings even while the batch is open", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "dev-flow-gate-openblock-"));
  try {
    const id = "openblock";
    const state = await setupPlanReview(root, id);
    const created = await jobs.createReviewBatch(root, id, state.revision);
    const target = created.batch.jobs[0];
    const capability = `cap-${target.jobId}`;
    let current = (await jobs.claimReviewJob(root, id, created.state.revision, created.batch.batchId, target.jobId, capability)).state;
    current = (await jobs.submitReviewJob(root, id, current.revision, created.batch.batchId, target.jobId, capability, {
      coverageSummary: "发现 blocker",
      findings: [{ ...blockingFinding, category: target.role }],
    })).state;
    // 作业未齐 → gate 判 jobs-open；inspect 仍与门禁共用同一归约，如实显示 1 个未解 blocking。
    const gate = await jobs.reviewGate(root, current);
    assert.equal(gate.status, "jobs-open");
    const view = await inspection.inspectFeature(root, id, "review");
    assert.equal(view.content.unresolvedBlockingCount, 1);
    assert.equal(view.content.nonBlockingFindingCount, 0);
    assert.match(view.content.readyWhen, /warning\/note 不阻塞/);
    // 全部提交后 gate 才升级为 blocking，inspect 与 gate 的 findingIds 一致。
    for (const job of created.batch.jobs) {
      if (job.jobId === target.jobId) continue;
      const jobCapability = `cap-${job.jobId}`;
      current = (await jobs.claimReviewJob(root, id, current.revision, created.batch.batchId, job.jobId, jobCapability)).state;
      current = (await jobs.submitReviewJob(root, id, current.revision, created.batch.batchId, job.jobId, jobCapability, {
        coverageSummary: "审查通过",
        findings: [],
      })).state;
    }
    const blockingGate = await jobs.reviewGate(root, current);
    assert.equal(blockingGate.status, "blocking");
    const after = await inspection.inspectFeature(root, id, "review");
    assert.equal(after.content.unresolvedBlockingCount, blockingGate.findingIds.length);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("warning-only findings do not block plan review and inspect states convergence", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "dev-flow-gate-warning-"));
  try {
    const id = "warning";
    const state = await setupPlanReview(root, id);
    const created = await jobs.createReviewBatch(root, id, state.revision);
    const warningRole = created.batch.jobs[0].role;
    const completed = await completeReviewJobs(root, id, created.state, created.batch, {
      completions: {
        [warningRole]: {
          coverageSummary: "发现非阻塞 warning",
          findings: [{ ...warningFinding, category: warningRole }],
        },
      },
    });
    const gate = await jobs.reviewGate(root, completed.state);
    assert.equal(gate.status, "ready", `warning-only plan review should be ready, got ${gate.status}`);
    const view = await inspection.inspectFeature(root, id, "review");
    assert.equal(view.content.unresolvedBlockingCount, 0);
    assert.equal(view.content.nonBlockingFindingCount, 1);
    assert.match(view.content.readyWhen, /unresolvedBlockingCount === 0/);
    const recorded = await steps.recordStep(root, id, completed.state.revision, "planning", {});
    assert.equal(recorded.steps.planning.status, "satisfied");
    assert.notEqual(stepOrder.currentOpenStep(recorded), "planning");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("begin's plan gate agrees with next and the gate at the implementation boundary", async () => {
  const { execFile } = await import("node:child_process");
  const { promisify } = await import("node:util");
  const run = promisify(execFile);
  const root = await mkdtemp(path.join(os.tmpdir(), "dev-flow-gate-begin-"));
  try {
    await mkdir(path.join(root, "src"));
    await writeFile(path.join(root, "src", "main.js"), "export {}\n");
    await run("git", ["init", "--quiet"], { cwd: root });
    await run("git", ["add", "."], { cwd: root });
    await run("git", ["-c", "user.name=Dev Flow Tests", "-c", "user.email=tests@example.invalid", "commit", "--quiet", "-m", "seed"], { cwd: root });
    await store.initProject(root, routeFlowConfig);
    let state = await store.startFeature(root, { featureId: "begin", host: "codex" });
    state = await store.lockClassification(root, "begin", state.revision, {
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
    state = (await store.answer({ root, featureId: "begin", expectedRevision: state.revision, host: "claude", credential: { source: "text", userReply: "确认这条路线" } })).state;

    async function unitWriter(root, current) {
      const paths = ["src/main.js"];
      const contents = "export const m = 1;\n";
      await store.recordTrustedWriteIntent(root, paths, "codex", `write-${current.revision}`);
      await writeFile(path.join(root, "src", "main.js"), contents);
      await store.recordTrustedWriteOwnership(root, paths, "codex", `write-${current.revision}`);
      return store.readState(root, "begin");
    }

    const driven = await driveUntil(root, "begin", state, {
      input: {},
      stopAt: (action) => action.kind === "begin-implementation-unit",
      unitWriter,
    });
    assert.equal(driven.action.kind, "begin-implementation-unit");
    // 计划审查已就绪：begin 读同一 gate 拿到的 stamp 有 batchId/basisHash/assuranceLevel。
    const stamp = await jobs.requireReviewReady(root, driven.state, { phase: "plan" });
    assert.equal(typeof stamp.batchId, "string");
    assert.equal(typeof stamp.basisHash, "string");
    assert.equal(typeof stamp.assuranceLevel, "string");
    assert.deepEqual(await next.nextAction(root, "begin"), { kind: "begin-implementation-unit", unitId: driven.action.unitId });
    // 验证命令变更 → 审查依据过期。begin 的 gate 调用与 gate/next 听到同一句“依据过期”
    //（完整 begin 会先被 trace 门禁以 TRACE_SLICE_STALE 拦截——trace 在 begin 内先于审查求值）。
    const raw = await readFile(path.join(root, ".dev-flow", "project.json"));
    const config = JSON.parse(raw);
    config.verification.commands[0].args = ["--test", "--changed"];
    await store.updateProjectConfig(root, config, createHash("sha256").update(raw).digest("hex"));
    state = await store.readState(root, "begin");
    const gate = await jobs.reviewGate(root, state);
    assert.equal(gate.status, "need-batch");
    assert.equal(gate.cause, "stale");
    const nextAfter = await next.nextAction(root, "begin");
    assert.equal(nextAfter.kind, "repair-trace");
    assert.equal(nextAfter.code, "TRACE_SLICE_STALE");
    assert.equal(nextAfter.step, "implementation");
    await assert.rejects(
      () => jobs.requireReviewReady(root, state, { phase: "plan" }),
      (error) => error.code === "REVIEW_BASIS_STALE",
    );
    // begin 不会开始单元：完整 begin 内 trace 门禁先于审查求值，仍以门禁错误拒绝。
    await assert.rejects(
      () => units.beginImplementationUnit(root, "begin", state.revision, driven.action.unitId),
      (error) => error.code === "TRACE_SLICE_STALE" || error.code === "REVIEW_BASIS_STALE",
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("plan review accepts recovery nodes in the scope manifest", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "dev-flow-gate-recovery-"));
  try {
    await mkdir(path.join(root, "src"));
    await writeFile(path.join(root, "src", "main.js"), "export {}\n");
    await store.initProject(root, routeFlowConfig);
    let state = await store.startFeature(root, {
      featureId: "recovery-plan",
      host: "claude",
      level: "M",
      topology: "shared-contract",
      requirements: "provided-confirmed",
      scopeFacts: ["共享契约需求"],
      topologyFacts: ["共享契约"],
      uncertaintyFacts: [],
      riskFacts: {},
      decisionRefs: [],
    });
    assert.equal(state.classification.controls.planReview, true);
    state = await registerTraceFixture({
      root, featureId: state.featureId, state, kind: "requirements",
      delta: traceDeltaFor("requirements", "m"),
    });
    state = await steps.recordStep(root, state.featureId, state.revision, "requirements_alignment", {});
    state = await artifacts.scaffoldArtifact(root, state.featureId, state.revision, "implementation-plan");
    const planMarkdown = [
      "<!-- dev-flow:id=TASK-001 kind=task -->\n### TASK-001\n\n- covers: [REQ-001, AC-001]\n- implementation_unit: UNIT-001\n- tdd: test-first\n",
      "<!-- dev-flow:id=TEST-001 kind=test -->\n### TEST-001\n\n- verifies: [AC-001]\n",
      "<!-- dev-flow:id=UNIT-001 kind=implementation-unit -->\n### UNIT-001\n\n- tasks: [TASK-001]\n- depends_on: []\n- file_scope: [src]\n- covers: [REQ-001, AC-001]\n- forward_verification: [unit]\n",
      "<!-- dev-flow:id=REC-001 kind=recovery -->\n### REC-001\n\n- step_ref: UNIT-001\n- recovery_kind: compensation\n- method: 从备份恢复迁移前快照\n- risk_ref: data\n",
    ].join("\n");
    const planDelta = {
      nodes: [
        { kind: "task", id: "TASK-001", covers: ["REQ-001", "AC-001"], implementationUnit: "UNIT-001" },
        { kind: "test", id: "TEST-001", verifies: ["AC-001"] },
        { kind: "implementation-unit", id: "UNIT-001", tasks: ["TASK-001"], dependsOn: [], fileScope: ["src"], covers: ["REQ-001", "AC-001"], forwardVerification: ["unit"] },
        { kind: "recovery", id: "REC-001", stepRef: "UNIT-001", recoveryKind: "compensation", method: "从备份恢复迁移前快照", riskRef: "data" },
      ],
    };
    state = await registerTraceFixture({
      root, featureId: state.featureId, state, kind: "implementation-plan",
      delta: planDelta, edit: () => planMarkdown,
    });
    // 恢复节点是 current trace 节点，必须进入审查 scope manifest 的 traceIds，
    // 且提交审查时不得被 REVIEW_INTEGRITY_FAILED 拒绝（修复前死锁）。
    const created = await jobs.createReviewBatch(root, state.featureId, state.revision);
    assert.equal(created.batch.phase, "plan");
    const job = created.batch.jobs[0];
    const reviewPackage = await reviewStore.readReviewPackage(root, state.featureId, job.packageSha256);
    assert.ok(
      Array.isArray(reviewPackage.scopeManifest.traceIds)
        && reviewPackage.scopeManifest.traceIds.includes("REC-001"),
      JSON.stringify(reviewPackage.scopeManifest),
    );
    const completed = await completeReviewJobs(root, state.featureId, created.state, created.batch);
    const ledger = await reviewStore.readReviewLedger(root, completed.state);
    const currentBatch = ledger.batches.find((batch) => batch.batchId === created.batch.batchId);
    assert.equal(currentBatch.progress, "complete");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
