import { createHash } from "node:crypto";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execSync } from "node:child_process";
import test from "node:test";
import { loadSource } from "../../helpers/load-source.mjs";
import { registerTraceFixture } from "../../helpers/trace-fixtures.mjs";

function initGit(root) {
  execSync("git init", { cwd: root, stdio: "pipe" });
  execSync("git add -A", { cwd: root, stdio: "pipe" });
  execSync('git commit -m "initial"', { cwd: root, stdio: "pipe" });
}

const hash = (value) => createHash("sha256").update(value).digest("hex");

const store = await loadSource("plugins/dev-flow/src/core/state-store.ts");
const contract = await loadSource("plugins/dev-flow/src/policy/contract.ts");
const units = await loadSource("plugins/dev-flow/src/core/implementation-units.ts");
const checkpoints = await loadSource("plugins/dev-flow/src/core/checkpoints.ts");
const status = await loadSource("plugins/dev-flow/src/core/status.ts");
const verification = await loadSource("plugins/dev-flow/src/core/verification.ts");
const rollback = await loadSource("plugins/dev-flow/src/core/rollback.ts");
const checks = await loadSource("plugins/dev-flow/src/core/feature-check.ts");
const next = await loadSource("plugins/dev-flow/src/core/next.ts");
const reviewJobs = await loadSource("plugins/dev-flow/src/core/review-jobs.ts");

const config = {
  schemaVersion: 1,
  verification: {
    commands: [
      { id: "unit", command: process.execPath, args: ["--test", "test/counter.test.js"], cwd: "." },
      { id: "rollback-check", command: process.execPath, args: ["-e", "process.exit(0)"], cwd: "." },
    ],
    behaviorCommands: [],
  },
  enforcement: { mode: "strict", gitWriteRequiresLogicComplete: true, oneActiveFeature: true, requireExplicitHumanReply: true },
  protectedRoots: ["src", "test"],
};

const statusArtifactName = "状态文档.md";

function statusArtifactContent(featureId, route) {
  return `---\ndev_flow:\n  schema_version: 1\n  feature_id: ${featureId}\n  route: ${route}\n  kind: status\n---\n\n# status\n\n`;
}

async function writeStatusArtifact(root, featureId, route) {
  const name = statusArtifactName;
  const content = statusArtifactContent(featureId, route);
  await writeFile(path.join(root, ".dev-flow", "features", featureId, name), content);
  return hash(content);
}

/** Three RU closures for the implementation plan trace. */
function threeClosurePlanDelta() {
  const rollbackNode = (id, tasks, dependsOn, fileScope, covers) => ({
    kind: "rollback", id, tasks, dependsOn, fileScope, covers,
    forwardVerification: ["unit"], rollbackVerification: ["rollback-check"],
  });
  return {
    nodes: [
      { kind: "task", id: "TASK-001", covers: ["REQ-001", "AC-001"], rollbackUnit: "RU-001" },
      { kind: "task", id: "TASK-002", covers: ["REQ-001", "AC-001"], rollbackUnit: "RU-002" },
      { kind: "task", id: "TASK-003", covers: ["REQ-001", "AC-001"], rollbackUnit: "RU-003" },
      rollbackNode("RU-001", ["TASK-001"], [], ["src/one"], ["REQ-001", "AC-001"]),
      rollbackNode("RU-002", ["TASK-002"], ["RU-001"], ["src/two"], ["REQ-001", "AC-001"]),
      rollbackNode("RU-003", ["TASK-003"], ["RU-002"], ["src/three"], ["REQ-001", "AC-001"]),
    ],
  };
}

function appendSecondTraceClosure(markdown) {
  const taskBlock = (id, ru) => `\n<!-- dev-flow:id=${id} kind=task -->\n### ${id}：实现任务\n\n- covers: REQ-001, AC-001\n- rollback_unit: ${ru}\n`;
  const ruBlock = (id, tasks, dependsOn, scope) =>
    `\n<!-- dev-flow:id=${id} kind=rollback -->\n### ${id}：回撤单元\n\n- tasks: ${tasks}\n- depends_on: ${dependsOn}\n- file_scope: ${scope}\n- covers: REQ-001, AC-001\n- forward_verification: unit\n- rollback_verification: unit\n`;
  return markdown
    + taskBlock("TASK-002", "RU-002")
    + ruBlock("RU-002", "TASK-002", "RU-001", "src/two");
}

function appendThirdTraceClosure(markdown) {
  const taskBlock = (id, ru) => `\n<!-- dev-flow:id=${id} kind=task -->\n### ${id}：实现任务\n\n- covers: REQ-001, AC-001\n- rollback_unit: ${ru}\n`;
  const ruBlock = (id, tasks, dependsOn, scope) =>
    `\n<!-- dev-flow:id=${id} kind=rollback -->\n### ${id}：回撤单元\n\n- tasks: ${tasks}\n- depends_on: ${dependsOn}\n- file_scope: ${scope}\n- covers: REQ-001, AC-001\n- forward_verification: unit\n- rollback_verification: rollback-check\n`;
  return markdown
    + taskBlock("TASK-002", "RU-002")
    + taskBlock("TASK-003", "RU-003")
    + ruBlock("RU-002", "TASK-002", "RU-001", "src/two")
    + ruBlock("RU-003", "TASK-003", "RU-002", "src/three");
}

function satisfyPreImplementation(draft) {
  const definition = contract.routeDefinitionForFeature(draft.route, draft.workflowCapabilities);
  for (const step of definition.orderedSteps.slice(0, definition.orderedSteps.indexOf("implementation"))) {
    draft.steps[step] = { status: "satisfied", ...(step === "plan_review" ? { evidence: { reviewType: "plan" } } : {}) };
  }
  draft.humanGates.implementation_approval = { status: "confirmed" };
}

function satisfyPreReview(draft) {
  const definition = contract.routeDefinitionForFeature(draft.route, draft.workflowCapabilities);
  for (const step of definition.orderedSteps.slice(0, definition.orderedSteps.indexOf("plan_review"))) {
    draft.steps[step] = { status: "satisfied" };
  }
}

async function completeReviewBatch(root, state) {
  const created = await reviewJobs.createReviewBatch(root, "f", state.revision);
  let current = created.state;
  for (const [index, job] of created.batch.jobs.entries()) {
    const capability = `claim-rollback-review-${index + 1}-abcdefghijklmnopqrstuv`;
    const claimed = await reviewJobs.claimReviewJob(root, "f", current.revision, created.batch.batchId, job.jobId, capability);
    current = (await reviewJobs.submitReviewJob(
      root, "f", claimed.state.revision, created.batch.batchId, job.jobId, capability,
      { coverageSummary: `${job.role} complete`, findings: [] },
    )).state;
  }
  return { state: current, batch: created.batch };
}

/**
 * Standard M feature with rollbackExecution:1, three RUs all checkpointed.
 * CP-001 (RU-001), CP-002 (RU-002), CP-003 (RU-003).
 */
async function checkpointedFeature(root, { review = false } = {}) {
  await store.initProject(root, config);
  await mkdir(path.join(root, "src/one"), { recursive: true });
  await mkdir(path.join(root, "src/two"), { recursive: true });
  await mkdir(path.join(root, "src/three"), { recursive: true });
  await mkdir(path.join(root, "test"), { recursive: true });
  await writeFile(path.join(root, "test/counter.test.js"), "const test = require('node:test');\ntest('fixture passes', () => {});\n");
  await writeFile(path.join(root, "src/one/a.txt"), "one v1\n");
  await writeFile(path.join(root, "src/two/b.txt"), "two v1\n");
  await writeFile(path.join(root, "src/three/c.txt"), "three v1\n");
  initGit(root);

  let state = await store.startFeature(root, {
    featureId: "f", host: "claude", level: "M", topology: "local", execution: "standard", requirements: "provided-confirmed",
  });
  if (!review) {
    // Most rollback cases isolate checkpoint mechanics; the dedicated test below
    // keeps review enabled to exercise the successor-batch recovery path.
    state = await store.mutate(root, "f", state.revision, "rb-e2e-capabilities", (draft) => {
      draft.workflowCapabilities = { trace: 1, review: 0, checkpoints: 1, rollbackExecution: 1 };
    });
  }
  assert.equal(state.workflowCapabilities.rollbackExecution, 1);

  // Advance through requirements, plan, coverage, approval.
  state = await registerTraceFixture({ root, featureId: "f", state, kind: "requirements" });
  state = await store.mutate(root, "f", state.revision, "rb-e2e-req", (draft) => {
    draft.steps.requirements = { status: "satisfied" };
    draft.steps.requirement_confirmation = { status: "satisfied" };
  });
  state = await registerTraceFixture({ root, featureId: "f", state, kind: "implementation-plan", delta: threeClosurePlanDelta(), edit: appendThirdTraceClosure });
  state = await store.mutate(root, "f", state.revision, "rb-e2e-plan", (draft) => {
    draft.steps.implementation_plan = { status: "satisfied" };
  });
  state = await registerTraceFixture({ root, featureId: "f", state, kind: "coverage-matrix" });
  const statusSha = await writeStatusArtifact(root, "f", state.route);
  if (review) {
    state = await store.mutate(root, "f", state.revision, "rb-e2e-pre-review", satisfyPreReview);
    state = (await completeReviewBatch(root, state)).state;
    state = await checks.recordStep(root, "f", state.revision, "plan_review", {});
    state = await store.mutate(root, "f", state.revision, "rb-e2e-review-approval", (draft) => {
      draft.steps.implementation_approval = { status: "satisfied" };
      draft.humanGates.implementation_approval = { status: "confirmed" };
      draft.artifacts.status = { path: statusArtifactName, sha256: statusSha };
    });
  } else {
    state = await store.mutate(root, "f", state.revision, "rb-e2e-approval", (draft) => {
      satisfyPreImplementation(draft);
      draft.artifacts.status = { path: statusArtifactName, sha256: statusSha };
    });
  }

  // Checkpoint RU-001: modify src/one/a.txt.
  state = await units.beginImplementationUnit(root, "f", state.revision, "RU-001");
  await writeFile(path.join(root, "src/one/a.txt"), "one v2\n");
  state = (await checkpoints.checkpointImplementationUnit(root, "f", state.revision, "RU-001")).state;

  // Checkpoint RU-002: modify src/two/b.txt, add new file.
  state = await units.beginImplementationUnit(root, "f", state.revision, "RU-002");
  await writeFile(path.join(root, "src/two/b.txt"), "two v2\n");
  await writeFile(path.join(root, "src/two/new.txt"), "two added\n");
  state = (await checkpoints.checkpointImplementationUnit(root, "f", state.revision, "RU-002")).state;

  // Checkpoint RU-003: modify src/three/c.txt.
  state = await units.beginImplementationUnit(root, "f", state.revision, "RU-003");
  await writeFile(path.join(root, "src/three/c.txt"), "three v2\n");
  state = (await checkpoints.checkpointImplementationUnit(root, "f", state.revision, "RU-003")).state;

  return state;
}

test("standard M rollback: three RUs → rollback to RU-001 → re-implement → finalize", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "dev-flow-s-m-rollback-"));
  try {
    let state = await checkpointedFeature(root);

    // ── Verify checkpoint chain ──
    let view = await status.readStatusView(root, "f");
    assert.equal(view.implementation.enforced, true);
    assert.equal(view.implementation.activeUnitId, undefined);
    assert.deepEqual(view.implementation.remainingUnitIds, []);
    assert.deepEqual(view.rollback.validTargets, ["CP-001", "CP-002"]);
    assert.equal(view.rollback.chain.length, 3);

    // ── Preview rollback to RU-001 ──
    const preview = await rollback.previewRollback(root, "f", "CP-001");
    assert.equal(preview.targetUnitId, "RU-001");
    assert.deepEqual(preview.undoOrder, ["RU-003", "RU-002"]);
    assert.equal(preview.filePlan.length > 0, true);

    // ── Present gate and confirm ──
    const presented = await rollback.presentRollbackGate(root, "f", state.revision, "CP-001");
    assert.equal(presented.preview.targetUnitId, "RU-001");
    assert.equal(presented.interaction.kind, "rollback-confirmation");
    assert.equal(presented.interaction.status, "pending");

    state = await rollback.resolveRollbackGateElicitation(
      root, "f", presented.state.revision, presented.interaction.id, "confirm", undefined, "claude",
    );
    assert.equal(state.rollbackGate.status, "confirmed");

    // ── Execute rollback ──
    const result = await rollback.executeRollback(root, "f", state.revision, "CP-001");
    assert.equal(result.outcome, "committed");
    state = result.state;

    // ── Verify files were rolled back ──
    assert.equal(await readFile(path.join(root, "src/one/a.txt"), "utf8"), "one v2\n", "RU-001 output survives");
    assert.equal(await readFile(path.join(root, "src/two/b.txt"), "utf8"), "two v1\n", "RU-002 undone");
    await assert.rejects(readFile(path.join(root, "src/two/new.txt"), "utf8"), { code: "ENOENT" }, "RU-002 addition should be removed");
    assert.equal(await readFile(path.join(root, "src/three/c.txt"), "utf8"), "three v1\n", "RU-003 undone");

    // ── Verify unit states after rollback ──
    const ru1 = (state.implementationUnits ?? []).find((u) => u.unitId === "RU-001");
    const ru2 = (state.implementationUnits ?? []).find((u) => u.unitId === "RU-002");
    const ru3 = (state.implementationUnits ?? []).find((u) => u.unitId === "RU-003");
    assert.equal(ru1.status, "checkpointed");
    assert.equal(ru2.status, "pending", "earliest undone unit becomes pending");
    assert.equal(ru3.status, "rolled_back", "later undone unit stays rolled_back");

    // ── Verify downstream steps are invalidated ──
    assert.equal(state.logicComplete, false);
    assert.equal(state.steps.implementation, undefined);
    assert.equal(state.steps.code_review, undefined);
    assert.equal(state.steps.verification, undefined);
    assert.equal(state.steps.feature_check, undefined);
    assert.equal(state.steps.finalize, undefined);

    // ── Re-implement RU-002 ──
    state = await units.beginImplementationUnit(root, "f", state.revision, "RU-002");
    await writeFile(path.join(root, "src/two/b.txt"), "two v3\n");
    state = (await checkpoints.checkpointImplementationUnit(root, "f", state.revision, "RU-002")).state;

    // ── Re-implement RU-003 ──
    state = await units.beginImplementationUnit(root, "f", state.revision, "RU-003");
    await writeFile(path.join(root, "src/three/c.txt"), "three v3\n");
    state = (await checkpoints.checkpointImplementationUnit(root, "f", state.revision, "RU-003")).state;

    view = await status.readStatusView(root, "f");
    assert.deepEqual(view.implementation.remainingUnitIds, []);

    // ── Complete the route: record implementation, code review, verification, feature check, finalize ──
    state = await checks.recordStep(root, "f", state.revision, "implementation", { files: ["src/one/a.txt", "src/two/b.txt", "src/three/c.txt"] });
    state = await checks.recordStep(root, "f", state.revision, "code_review", { reviewType: "code" });
    // Record a passing manual verification to satisfy the step.
    state = await verification.runVerification(root, "f", state.revision, "claude", ["rollback-check"], { mode: "code-path-audit", source: "manual", scenarios: [{ name: "verify after rollback", evidence: "all tests pass" }] });
    state = await checks.featureCheck(root, "f", state.revision);
    state = await checks.finalize(root, "f", state.revision);
    assert.equal(state.logicComplete, true);

  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("standard M rollback: stale review directs a successor batch before re-beginning a unit", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "dev-flow-s-m-rollback-review-"));
  try {
    let state = await checkpointedFeature(root, { review: true });
    const presented = await rollback.presentRollbackGate(root, "f", state.revision, "CP-001");
    state = await rollback.resolveRollbackGateElicitation(
      root, "f", presented.state.revision, presented.interaction.id, "confirm", undefined, "claude",
    );
    state = (await rollback.executeRollback(root, "f", state.revision, "CP-001")).state;

    assert.deepEqual(await next.nextAction(root, "f"), { kind: "create-review-batch", step: "plan_review" });
    state = (await completeReviewBatch(root, state)).state;
    assert.deepEqual(await next.nextAction(root, "f"), { kind: "begin-implementation-unit", unitId: "RU-002" });

    state = await units.beginImplementationUnit(root, "f", state.revision, "RU-002");
    assert.equal(state.implementationUnits.find((unit) => unit.unitId === "RU-002").status, "active");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("standard M rollback: rollbackExecution:0 feature cannot present gate or execute", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "dev-flow-s-m-noexec-"));
  try {
    await store.initProject(root, config);
    await mkdir(path.join(root, "src/one"), { recursive: true });
    await mkdir(path.join(root, "src/two"), { recursive: true });
    await mkdir(path.join(root, "test"), { recursive: true });
    await writeFile(path.join(root, "test/counter.test.js"), "const test = require('node:test');\ntest('fixture passes', () => {});\n");
    await writeFile(path.join(root, "src/one/a.txt"), "one v1\n");
    await writeFile(path.join(root, "src/two/b.txt"), "two v1\n");
    initGit(root);

    let state = await store.startFeature(root, {
      featureId: "f", host: "claude", level: "M", topology: "local", execution: "standard", requirements: "provided-confirmed",
    });
    // Override to rollbackExecution:0 (checkpoints:1 but no execution).
    state = await store.mutate(root, "f", state.revision, "noexec-capabilities", (draft) => {
      draft.workflowCapabilities = { trace: 1, review: 0, checkpoints: 1, rollbackExecution: 0 };
    });

    state = await registerTraceFixture({ root, featureId: "f", state, kind: "requirements" });
    state = await store.mutate(root, "f", state.revision, "noexec-req", (draft) => {
      draft.steps.requirements = { status: "satisfied" };
      draft.steps.requirement_confirmation = { status: "satisfied" };
    });
    const singleRuDelta = {
      nodes: [
        { kind: "task", id: "TASK-001", covers: ["REQ-001", "AC-001"], rollbackUnit: "RU-001" },
        { kind: "task", id: "TASK-002", covers: ["REQ-001", "AC-001"], rollbackUnit: "RU-002" },
        { kind: "rollback", id: "RU-001", tasks: ["TASK-001"], dependsOn: [], fileScope: ["src/one"], covers: ["REQ-001", "AC-001"], forwardVerification: ["unit"], rollbackVerification: ["unit"] },
        { kind: "rollback", id: "RU-002", tasks: ["TASK-002"], dependsOn: ["RU-001"], fileScope: ["src/two"], covers: ["REQ-001", "AC-001"], forwardVerification: ["unit"], rollbackVerification: ["unit"] },
      ],
    };
    state = await registerTraceFixture({ root, featureId: "f", state, kind: "implementation-plan", delta: singleRuDelta, edit: appendSecondTraceClosure });
    state = await store.mutate(root, "f", state.revision, "noexec-plan", (draft) => {
      draft.steps.implementation_plan = { status: "satisfied" };
    });
    state = await registerTraceFixture({ root, featureId: "f", state, kind: "coverage-matrix" });
    const statusSha = await writeStatusArtifact(root, "f", state.route);
    state = await store.mutate(root, "f", state.revision, "noexec-approval", (draft) => {
      satisfyPreImplementation(draft);
      draft.artifacts.status = { path: statusArtifactName, sha256: statusSha };
    });

    // Checkpoint RU-001.
    state = await units.beginImplementationUnit(root, "f", state.revision, "RU-001");
    await writeFile(path.join(root, "src/one/a.txt"), "one v2\n");
    state = (await checkpoints.checkpointImplementationUnit(root, "f", state.revision, "RU-001")).state;

    // Checkpoint RU-002 so CP-001 is not the chain tip.
    state = await units.beginImplementationUnit(root, "f", state.revision, "RU-002");
    await writeFile(path.join(root, "src/two/b.txt"), "two v2\n");
    state = (await checkpoints.checkpointImplementationUnit(root, "f", state.revision, "RU-002")).state;

    // Preview still works (checkpoints:1).
    const preview = await rollback.previewRollback(root, "f", "CP-001");
    assert.equal(preview.targetUnitId, "RU-001");

    // Gate is rejected.
    await assert.rejects(
      () => rollback.presentRollbackGate(root, "f", state.revision, "CP-001"),
      (error) => error.code === "ROLLBACK_EXECUTION_NOT_ALLOWED",
    );

    // Execute is rejected.
    await assert.rejects(
      () => rollback.executeRollback(root, "f", state.revision, "CP-001"),
      (error) => error.code === "ROLLBACK_EXECUTION_NOT_ALLOWED",
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("standard M rollback: open transaction blocks concurrent mutation", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "dev-flow-s-m-txn-block-"));
  try {
    const state = await checkpointedFeature(root);

    // Confirm gate for CP-001.
    const presented = await rollback.presentRollbackGate(root, "f", state.revision, "CP-001");
    const confirmed = await rollback.resolveRollbackGateElicitation(
      root, "f", presented.state.revision, presented.interaction.id, "confirm", undefined, "claude",
    );

    // Execute with fault after journal write: the journal is now durable.
    const FAULT = (point) => { if (point === "after-journal-write") throw new Error("injected:after-journal-write"); };
    await assert.rejects(
      () => rollback.executeRollback(root, "f", confirmed.revision, "CP-001", { fault: FAULT }),
      (error) => error.message.includes("injected:after-journal-write"),
    );

    // Open transaction blocks all feature mutations.
    let current = await store.readState(root, "f");
    await assert.rejects(
      () => store.mutate(root, "f", current.revision, "rb-e2e-noop", (draft) => {}),
      (error) => error.code === "ROLLBACK_TRANSACTION_OPEN",
    );

    // Resume and complete the open transaction to clean up.
    const result = await rollback.executeRollback(root, "f", current.revision, "CP-001");
    assert.equal(result.outcome, "committed");

    // After the transaction finishes, mutations work again.
    current = result.state;
    current = await store.mutate(root, "f", current.revision, "rb-e2e-noop", (draft) => {});
    assert.ok(current.revision > confirmed.revision);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("standard M rollback: status view shows gate and open transaction after fault", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "dev-flow-s-m-status-txn-"));
  try {
    const state = await checkpointedFeature(root);

    // Confirm gate for CP-001.
    const presented = await rollback.presentRollbackGate(root, "f", state.revision, "CP-001");
    const confirmed = await rollback.resolveRollbackGateElicitation(
      root, "f", presented.state.revision, presented.interaction.id, "confirm", undefined, "claude",
    );

    // Execute with fault after journal write so transaction is left open.
    const FAULT = (point) => { if (point === "after-journal-write") throw new Error("injected:after-journal-write"); };
    await assert.rejects(
      () => rollback.executeRollback(root, "f", confirmed.revision, "CP-001", { fault: FAULT }),
      (error) => error.message.includes("injected:after-journal-write"),
    );

    // Status view must show the open transaction.
    const view = await status.readStatusView(root, "f");
    assert.ok(view.rollback.openTransaction);
    assert.equal(view.rollback.openTransaction.phase, "prepared");
    assert.equal(view.rollback.openTransaction.targetCheckpointId, "CP-001");

    // The view must project the confirmed gate, not just raw state.
    assert.equal(view.rollback.gateStatus.status, "confirmed");
    assert.equal(view.rollback.gateStatus.targetCheckpointId, "CP-001");

    // Gate is still present (the execution used it but didn't consume it due to crash before CAS).
    const current = await store.readState(root, "f");
    assert.equal(current.rollbackGate.status, "confirmed");

    // Doctor reports the open transaction.
    const doctor = await loadSource("plugins/dev-flow/src/mcp/doctor.ts");
    const report = await doctor.collectDoctorReport(root, path.resolve("plugins/dev-flow"), "1.7.0", [
      "dev_flow_begin_implementation_unit", "dev_flow_checkpoint_implementation_unit", "dev_flow_preview_rollback",
      "dev_flow_present_rollback_gate", "dev_flow_execute_rollback",
    ]);
    assert.ok(report.rollbackTransactions.some((txn) => txn.phase === "prepared"), "rollback transaction visible in doctor");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
