import { createHash } from "node:crypto";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execSync } from "node:child_process";
import test from "node:test";
import { loadSource } from "../../helpers/load-source.mjs";
import { appendSecondTraceClosure, registerTraceFixture, twoClosureTraceDeltaFor } from "../../helpers/trace-fixtures.mjs";

function initGit(root) {
  execSync("git init", { cwd: root, stdio: "pipe" });
  execSync("git add -A", { cwd: root, stdio: "pipe" });
  execSync('git commit -m "initial"', { cwd: root, stdio: "pipe" });
}

const hash = (value) => createHash("sha256").update(value).digest("hex");

const store = await loadSource("plugins/dev-flow/src/core/state-store.ts");
const checks = await loadSource("plugins/dev-flow/src/core/feature-check.ts");
const units = await loadSource("plugins/dev-flow/src/core/implementation-units.ts");
const checkpoints = await loadSource("plugins/dev-flow/src/core/checkpoints.ts");
const status = await loadSource("plugins/dev-flow/src/core/status.ts");
const verification = await loadSource("plugins/dev-flow/src/core/verification.ts");
const contract = await loadSource("plugins/dev-flow/src/policy/contract.ts");

const config = {
  schemaVersion: 1,
  verification: { commands: [{ id: "unit", command: "node", args: ["--test"], cwd: "." }], behaviorCommands: [] },
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

/**
 * Register trace fixtures one at a time, satisfying the preceding step
 * after each registration. The final mutate lands the feature at
 * implementation step with implementation_approval confirmed and the
 * status artifact registered.
 * Review is disabled (review: 0) — checkpoints tests do not exercise
 * the review-batch cycle.
 */
async function advanceToImplementation(root, featureId, state) {
  state = await store.mutate(root, featureId, state.revision, "cp-capabilities", (draft) => {
    draft.workflowCapabilities = { trace: 1, review: 0, checkpoints: 1, rollbackExecution: 0 };
  });
  state = await registerTraceFixture({ root, featureId, state, kind: "requirements" });
  state = await store.mutate(root, featureId, state.revision, "cp-adv-req", (draft) => {
    draft.steps.requirements = { status: "satisfied" };
    draft.steps.requirement_confirmation = { status: "satisfied" };
  });
  state = await registerTraceFixture({ root, featureId, state, kind: "implementation-plan" });
  state = await store.mutate(root, featureId, state.revision, "cp-adv-plan", (draft) => {
    draft.steps.implementation_plan = { status: "satisfied" };
  });
  state = await registerTraceFixture({ root, featureId, state, kind: "coverage-matrix" });
  const statusSha = await writeStatusArtifact(root, featureId, state.route);
  return store.mutate(root, featureId, state.revision, "cp-adv-final", (draft) => {
    const defn = contract.routeDefinitionForFeature(draft.route, draft.workflowCapabilities);
    for (const step of defn.orderedSteps.slice(0, defn.orderedSteps.indexOf("implementation"))) {
      draft.steps[step] = { status: "satisfied", ...(step === "plan_review" ? { evidence: { reviewType: "plan" } } : {}) };
    }
    draft.humanGates.implementation_approval = { status: "confirmed" };
    draft.artifacts.status = { path: statusArtifactName, sha256: statusSha };
  });
}

async function advanceToImplementationTwoClosures(root, featureId, state) {
  state = await store.mutate(root, featureId, state.revision, "cp-capabilities", (draft) => {
    draft.workflowCapabilities = { trace: 1, review: 0, checkpoints: 1, rollbackExecution: 0 };
  });
  state = await registerTraceFixture({
    root, featureId, state, kind: "requirements",
    delta: twoClosureTraceDeltaFor("requirements", "standard-m"),
    edit: (markdown) => appendSecondTraceClosure(markdown, "requirements", "standard-m"),
  });
  state = await store.mutate(root, featureId, state.revision, "cp-adv-req", (draft) => {
    draft.steps.requirements = { status: "satisfied" };
    draft.steps.requirement_confirmation = { status: "satisfied" };
  });
  state = await registerTraceFixture({
    root, featureId, state, kind: "implementation-plan",
    delta: twoClosureTraceDeltaFor("implementation-plan", "standard-m"),
    edit: (markdown) => appendSecondTraceClosure(markdown, "implementation-plan", "standard-m"),
  });
  state = await store.mutate(root, featureId, state.revision, "cp-adv-plan", (draft) => {
    draft.steps.implementation_plan = { status: "satisfied" };
  });
  state = await registerTraceFixture({
    root, featureId, state, kind: "coverage-matrix",
    delta: twoClosureTraceDeltaFor("coverage-matrix", "standard-m"),
    edit: (markdown) => appendSecondTraceClosure(markdown, "coverage-matrix", "standard-m"),
  });
  const statusSha = await writeStatusArtifact(root, featureId, state.route);
  return store.mutate(root, featureId, state.revision, "cp-adv-final", (draft) => {
    const defn = contract.routeDefinitionForFeature(draft.route, draft.workflowCapabilities);
    for (const step of defn.orderedSteps.slice(0, defn.orderedSteps.indexOf("implementation"))) {
      draft.steps[step] = { status: "satisfied", ...(step === "plan_review" ? { evidence: { reviewType: "plan" } } : {}) };
    }
    draft.humanGates.implementation_approval = { status: "confirmed" };
    draft.artifacts.status = { path: statusArtifactName, sha256: statusSha };
  });
}

test("standard M checkpoints:1 walks two rollback units and completes the full route", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "dev-flow-s-m-checkpoints-"));
  try {
    await mkdir(path.join(root, "src"), { recursive: true });
    await mkdir(path.join(root, "test"), { recursive: true });
    await writeFile(path.join(root, "src", "one.ts"), "export const a = 1;\n");
    await writeFile(path.join(root, "src", "two.ts"), "export const b = 2;\n");
    await store.initProject(root, config);
    initGit(root);

    let state = await store.startFeature(root, {
      featureId: "f", host: "claude", level: "M", topology: "local", execution: "standard", requirements: "provided-confirmed",
    });
    assert.equal(state.workflowCapabilities.checkpoints, 1);

    state = await advanceToImplementationTwoClosures(root, "f", state);

    // === Implementation phase ===
    const next = await loadSource("plugins/dev-flow/src/core/next.ts");
    let action = await next.nextAction(root, "f");
    assert.equal(action.kind, "begin-implementation-unit");
    assert.equal(action.unitId, "RU-001");

    state = await units.beginImplementationUnit(root, "f", state.revision, "RU-001");
    action = await next.nextAction(root, "f");
    assert.equal(action.kind, "checkpoint-implementation-unit");
    assert.equal(action.unitId, "RU-001");

    let view = await status.readStatusView(root, "f");
    assert.equal(view.implementation.activeUnitId, "RU-001");
    assert.deepEqual(view.implementation.remainingUnitIds, ["RU-001", "RU-002"]);

    await writeFile(path.join(root, "src", "one.ts"), "export const a = 2;\n");
    state = (await checkpoints.checkpointImplementationUnit(root, "f", state.revision, "RU-001")).state;

    action = await next.nextAction(root, "f");
    assert.equal(action.kind, "begin-implementation-unit");
    assert.equal(action.unitId, "RU-002");

    view = await status.readStatusView(root, "f");
    assert.equal(view.implementation.activeUnitId, undefined);
    assert.equal(view.implementation.lastCheckpointId, "CP-001");
    assert.deepEqual(view.implementation.remainingUnitIds, ["RU-002"]);
    assert.deepEqual(view.rollback.validTargets, ["CP-001"]);

    state = await units.beginImplementationUnit(root, "f", state.revision, "RU-002");
    action = await next.nextAction(root, "f");
    assert.equal(action.kind, "checkpoint-implementation-unit");
    assert.equal(action.unitId, "RU-002");

    await writeFile(path.join(root, "src", "two.ts"), "export const b = 3;\n");
    state = (await checkpoints.checkpointImplementationUnit(root, "f", state.revision, "RU-002")).state;

    view = await status.readStatusView(root, "f");
    assert.equal(view.implementation.activeUnitId, undefined);
    assert.equal(view.implementation.lastCheckpointId, "CP-002");
    assert.deepEqual(view.implementation.remainingUnitIds, []);
    assert.deepEqual(view.rollback.validTargets, ["CP-001", "CP-002"]);
    assert.deepEqual(view.rollback.chain, [
      { checkpointId: "CP-001", unitId: "RU-001", sequence: 1 },
      { checkpointId: "CP-002", unitId: "RU-002", sequence: 2 },
    ]);

    action = await next.nextAction(root, "f");
    assert.equal(action.kind, "run-step");
    assert.equal(action.step, "implementation");
    state = await checks.recordStep(root, "f", state.revision, "implementation", { files: ["src/one.ts", "src/two.ts"] });

    // Satisfy the interim code_review step so verification becomes the next open step.
    state = await store.mutate(root, "f", state.revision, "cp-code-review", (draft) => {
      draft.steps.code_review = { status: "satisfied", evidence: { reviewType: "code" } };
    });
    state = await verification.runVerification(root, "f", state.revision, "claude");
    state = await checks.featureCheck(root, "f", state.revision);
    state = await checks.finalize(root, "f", state.revision);
    assert.equal(state.lifecycle, "finalized");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("standard M checkpoints:1 rejects unbegun writes and out-of-scope writes", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "dev-flow-s-m-scope-"));
  try {
    await mkdir(path.join(root, "src"), { recursive: true });
    await writeFile(path.join(root, "src", "one.ts"), "export const a = 1;\n");
    await writeFile(path.join(root, "src", "two.ts"), "export const b = 2;\n");
    await store.initProject(root, config);
    initGit(root);

    let state = await store.startFeature(root, {
      featureId: "f", host: "claude", level: "M", topology: "local", execution: "standard", requirements: "provided-confirmed",
    });
    state = await advanceToImplementationTwoClosures(root, "f", state);

    const traceStore = await loadSource("plugins/dev-flow/src/core/traceability-store.ts");
    const ledger = await traceStore.readTraceability(root, state);
    const implUnits = await loadSource("plugins/dev-flow/src/core/implementation-units.ts");
    assert.equal(implUnits.implementationUnitWriteBlock(state, ledger, "src/one.ts").code, "IMPLEMENTATION_UNIT_REQUIRED");

    state = await units.beginImplementationUnit(root, "f", state.revision, "RU-001");
    const activeLedger = await traceStore.readTraceability(root, state);
    assert.equal(implUnits.implementationUnitWriteBlock(state, activeLedger, "src/one.ts"), undefined);

    const outOfScope = implUnits.implementationUnitWriteBlock(state, activeLedger, "src/two.ts");
    assert.equal(outOfScope.code, "IMPLEMENTATION_UNIT_OUT_OF_SCOPE");
    assert.equal(outOfScope.details.unitId, "RU-001");
    assert.deepEqual(outOfScope.details.fileScope, ["src/one.ts"]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
