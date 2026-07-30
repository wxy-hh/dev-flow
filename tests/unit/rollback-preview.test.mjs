import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rename, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { strictProjectConfig } from "../helpers/fixture-repo.mjs";
import { loadSource } from "../helpers/load-source.mjs";
import { registerTraceFixture } from "../helpers/trace-fixtures.mjs";

const stateStore = await loadSource("plugins/dev-flow/src/core/state-store.ts");
const contract = await loadSource("plugins/dev-flow/src/policy/contract.ts");
const units = await loadSource("plugins/dev-flow/src/core/implementation-units.ts");
const checkpoints = await loadSource("plugins/dev-flow/src/core/checkpoints.ts");
const rollback = await loadSource("plugins/dev-flow/src/core/rollback.ts");
const status = await loadSource("plugins/dev-flow/src/core/status.ts");
const next = await loadSource("plugins/dev-flow/src/core/next.ts");
const traceStore = await loadSource("plugins/dev-flow/src/core/traceability-store.ts");

const checkpointsOn = Object.freeze({ trace: 1, review: 0, checkpoints: 1, rollbackExecution: 0 });
const sha = (letter) => letter.repeat(64);

async function withRoot(run) {
  const root = await mkdtemp(path.join(os.tmpdir(), "dev-flow-rollback-preview-"));
  try {
    return await run(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

function satisfyPreImplementation(draft) {
  const definition = contract.routeDefinitionForFeature(draft.route, draft.workflowCapabilities);
  for (const step of definition.orderedSteps.slice(0, definition.orderedSteps.indexOf("implementation"))) {
    draft.steps[step] = { status: "satisfied" };
  }
  draft.humanGates.implementation_approval = { status: "confirmed" };
}

function threeClosurePlanDelta(scopes = {}) {
  const rollbackNode = (id, tasks, dependsOn, fileScope, covers) => ({
    kind: "rollback", id, tasks, dependsOn, fileScope, covers,
    forwardVerification: ["unit"], rollbackVerification: ["unit"],
  });
  return {
    nodes: [
      { kind: "task", id: "TASK-001", covers: ["REQ-001", "AC-001"], rollbackUnit: "RU-001" },
      { kind: "task", id: "TASK-002", covers: ["REQ-001", "AC-001"], rollbackUnit: "RU-002" },
      { kind: "task", id: "TASK-003", covers: ["REQ-001", "AC-001"], rollbackUnit: "RU-003" },
      rollbackNode("RU-001", ["TASK-001"], [], ["src/one"], ["REQ-001", "AC-001"]),
      rollbackNode("RU-002", ["TASK-002"], ["RU-001"], scopes.ru2 ?? ["src/two"], ["REQ-001", "AC-001"]),
      rollbackNode("RU-003", ["TASK-003"], ["RU-002"], scopes.ru3 ?? ["src/three"], ["REQ-001", "AC-001"]),
    ],
  };
}

function appendThirdTraceClosure(markdown) {
  const taskBlock = (id, ru) => `\n<!-- dev-flow:id=${id} kind=task -->\n### ${id}：实现任务\n\n- covers: REQ-001, AC-001\n- rollback_unit: ${ru}\n`;
  const ruBlock = (id, tasks, dependsOn, scope) =>
    `\n<!-- dev-flow:id=${id} kind=rollback -->\n### ${id}：回撤单元\n\n- tasks: ${tasks}\n- depends_on: ${dependsOn}\n- file_scope: ${scope}\n- covers: REQ-001, AC-001\n- forward_verification: unit\n- rollback_verification: unit\n`;
  return markdown
    + taskBlock("TASK-002", "RU-002")
    + taskBlock("TASK-003", "RU-003")
    + ruBlock("RU-002", "TASK-002", "RU-001", "src/two")
    + ruBlock("RU-003", "TASK-003", "RU-002", "src/three");
}

/** standard-m with three chained RUs; lands approved on the implementation step. */
async function threeUnitFeature(root, { scopes = {}, extraFiles = {} } = {}) {
  await stateStore.initProject(root, strictProjectConfig);
  await mkdir(path.join(root, "src/one"), { recursive: true });
  await mkdir(path.join(root, "src/two"), { recursive: true });
  await mkdir(path.join(root, "src/three"), { recursive: true });
  await mkdir(path.join(root, "src/shared"), { recursive: true });
  await mkdir(path.join(root, "test"), { recursive: true });
  await writeFile(path.join(root, "test/counter.test.js"), "const test = require('node:test');\ntest('fixture passes', () => {});\n");
  await writeFile(path.join(root, "src/one/a.txt"), "one v1\n");
  await writeFile(path.join(root, "src/two/b.txt"), "two v1\n");
  await writeFile(path.join(root, "src/two/untouched.txt"), "baseline file\n");
  await writeFile(path.join(root, "src/three/c.txt"), "three v1\n");
  await writeFile(path.join(root, "src/one/gone.txt"), "will be deleted\n");
  for (const [file, contents] of Object.entries(extraFiles)) {
    await mkdir(path.dirname(path.join(root, file)), { recursive: true });
    await writeFile(path.join(root, file), contents);
  }
  let state = await stateStore.startFeature(root, {
    featureId: "f", host: "codex", level: "M", topology: "local", execution: "standard", requirements: "provided-confirmed",
  });
  state = await stateStore.mutate(root, "f", state.revision, "preview-test-capabilities", (draft) => {
    draft.workflowCapabilities = { ...checkpointsOn };
  });
  state = await registerTraceFixture({ root, featureId: "f", state, kind: "requirements" });
  state = await stateStore.mutate(root, "f", state.revision, "preview-test-requirements", (draft) => {
    draft.steps.requirements = { status: "satisfied" };
    draft.steps.requirement_confirmation = { status: "satisfied" };
  });
  state = await registerTraceFixture({ root, featureId: "f", state, kind: "implementation-plan", delta: threeClosurePlanDelta(scopes), edit: appendThirdTraceClosure });
  state = await stateStore.mutate(root, "f", state.revision, "preview-test-plan", (draft) => {
    draft.steps.implementation_plan = { status: "satisfied" };
  });
  state = await registerTraceFixture({ root, featureId: "f", state, kind: "coverage-matrix" });
  return stateStore.mutate(root, "f", state.revision, "preview-test-approval", satisfyPreImplementation);
}

/** Runs all three units through begin → edit → checkpoint. */
async function checkpointAllUnits(root, state) {
  state = await units.beginImplementationUnit(root, "f", state.revision, "RU-001");
  await writeFile(path.join(root, "src/one/a.txt"), "one v2\n");
  await rm(path.join(root, "src/one/gone.txt"));
  state = (await checkpoints.checkpointImplementationUnit(root, "f", state.revision, "RU-001")).state;
  state = await units.beginImplementationUnit(root, "f", state.revision, "RU-002");
  await writeFile(path.join(root, "src/two/b.txt"), "two v2\n");
  await writeFile(path.join(root, "src/two/new.txt"), "two added\n");
  state = (await checkpoints.checkpointImplementationUnit(root, "f", state.revision, "RU-002")).state;
  state = await units.beginImplementationUnit(root, "f", state.revision, "RU-003");
  await writeFile(path.join(root, "src/three/c.txt"), "three v2\n");
  return (await checkpoints.checkpointImplementationUnit(root, "f", state.revision, "RU-003")).state;
}

test("preview of a legal suffix computes reverse order, the restored file plan, and a bound basis", async () => {
  await withRoot(async (root) => {
    const state = await checkpointAllUnits(root, await threeUnitFeature(root));
    const preview = await rollback.previewRollback(root, "f", "CP-001");
    assert.deepEqual(preview.undoOrder, ["RU-003", "RU-002"]);
    assert.deepEqual(preview.undoCheckpoints, ["CP-003", "CP-002"]);

    const plan = Object.fromEntries(preview.filePlan.map((action) => [action.path, action]));
    // RU-003 and RU-002 are undone: their files return to begin-time bytes.
    assert.equal(plan["src/three/c.txt"].action, "restore");
    assert.equal(plan["src/two/b.txt"].action, "restore");
    assert.equal(plan["src/two/new.txt"].action, "delete");
    // RU-001 stays: its after state is not part of the plan.
    assert.equal(plan["src/one/a.txt"], undefined);
    assert.equal(plan["src/one/gone.txt"], undefined);
    // Restores carry before blobs and before modes.
    const two = await checkpoints.readCheckpoint(root, "f", "CP-002");
    const twoRecord = two.files.find((record) => record.path === "src/two/b.txt");
    assert.equal(plan["src/two/b.txt"].blobSha256, twoRecord.beforeBlobSha256);
    assert.equal(plan["src/two/b.txt"].mode, twoRecord.beforeMode);

    // Rollback verification commands resolve in undo order with config binding.
    assert.deepEqual(preview.verificationCommands.map((command) => command.commandId), ["unit", "unit"]);
    assert.equal(preview.projectConfigSha256, two.projectConfigSha256);
    assert.match(preview.previewBasisHash, /^[a-f0-9]{64}$/);
    // The preview is a pure read: state and workspace stay untouched.
    assert.equal((await stateStore.readState(root, "f")).revision, state.revision);
  });
});

test("previewing the chain tip is a legal no-op and unknown targets are rejected", async () => {
  await withRoot(async (root) => {
    await checkpointAllUnits(root, await threeUnitFeature(root));
    const tip = await rollback.previewRollback(root, "f", "CP-003");
    assert.deepEqual(tip.undoOrder, []);
    assert.deepEqual(tip.filePlan, []);
    await assert.rejects(() => rollback.previewRollback(root, "f", "CP-009"), /ROLLBACK_TARGET_INVALID/);
    await assert.rejects(() => rollback.previewRollback(root, "f", "RU-001"), /ROLLBACK_TARGET_INVALID/);
  });
});

test("overlapping checkpoints fold to the state at the target, not the newest before", async () => {
  await withRoot(async (root) => {
    const scopes = { ru2: ["src/two", "src/shared"], ru3: ["src/three", "src/shared"] };
    let state = await threeUnitFeature(root, { scopes, extraFiles: { "src/shared/x.txt": "x v0\n" } });
    state = await units.beginImplementationUnit(root, "f", state.revision, "RU-001");
    await writeFile(path.join(root, "src/one/a.txt"), "one v2\n");
    await rm(path.join(root, "src/one/gone.txt"));
    state = (await checkpoints.checkpointImplementationUnit(root, "f", state.revision, "RU-001")).state;
    state = await units.beginImplementationUnit(root, "f", state.revision, "RU-002");
    await writeFile(path.join(root, "src/shared/x.txt"), "x v2\n");
    await writeFile(path.join(root, "src/shared/added.txt"), "added v1\n");
    state = (await checkpoints.checkpointImplementationUnit(root, "f", state.revision, "RU-002")).state;
    state = await units.beginImplementationUnit(root, "f", state.revision, "RU-003");
    await writeFile(path.join(root, "src/shared/x.txt"), "x v3\n");
    await writeFile(path.join(root, "src/shared/added.txt"), "added v2\n");
    state = (await checkpoints.checkpointImplementationUnit(root, "f", state.revision, "RU-003")).state;

    const preview = await rollback.previewRollback(root, "f", "CP-001");
    const plan = Object.fromEntries(preview.filePlan.map((action) => [action.path, action]));
    // Modified in both CP-002 and CP-003: the oldest suffix before wins, so the
    // file returns to the exact bytes it had at CP-001.
    assert.equal(plan["src/shared/x.txt"].action, "restore");
    const restored = await readFile(path.join(root, ".dev-flow/features/f", checkpoints.blobPath(plan["src/shared/x.txt"].blobSha256)), "utf8");
    assert.equal(restored, "x v0\n");
    // Added by CP-002 then modified by CP-003: it must not exist at the target.
    assert.equal(plan["src/shared/added.txt"].action, "delete");
  });
});

test("untouched baseline files inside a scope do not conflict; unregistered edits of them do", async () => {
  await withRoot(async (root) => {
    let state = await checkpointAllUnits(root, await threeUnitFeature(root));
    // src/two/untouched.txt is inside the RU-002 scope but was never modified.
    const preview = await rollback.previewRollback(root, "f", "CP-001");
    assert.deepEqual(preview.undoOrder, ["RU-003", "RU-002"]);
    let view = await status.readStatusView(root, "f");
    assert.deepEqual(view.rollback.conflicts, []);

    await writeFile(path.join(root, "src/two/untouched.txt"), "tampered\n");
    await assert.rejects(
      () => rollback.previewRollback(root, "f", "CP-001"),
      (error) => error.code === "ROLLBACK_CONFLICT"
        && error.details.conflicts.some((conflict) => conflict.path === "src/two/untouched.txt" && conflict.actual === "modified"),
    );
    view = await status.readStatusView(root, "f");
    assert.deepEqual(view.rollback.conflicts, [{ path: "src/two/untouched.txt", expected: "checkpointed", actual: "modified" }]);

    await rm(path.join(root, "src/two/untouched.txt"));
    await assert.rejects(
      () => rollback.previewRollback(root, "f", "CP-001"),
      (error) => error.code === "ROLLBACK_CONFLICT"
        && error.details.conflicts.some((conflict) => conflict.path === "src/two/untouched.txt" && conflict.actual === "missing"),
    );
    state = await stateStore.readState(root, "f");
    assert.equal(state.implementationUnits.every((unit) => unit.status === "checkpointed"), true);
  });
});

test("checkpoints whose rollback unit is no longer current are rejected and hidden from valid targets", async () => {
  // RU and its task tombstoned after checkpointing (plan removed the closure).
  await withRoot(async (root) => {
    let state = await checkpointAllUnits(root, await threeUnitFeature(root));
    state = await editLedger(root, state, (ledger) => {
      ledger.nodes["TASK-003"] = { ...ledger.nodes["TASK-003"], status: "tombstoned" };
      ledger.nodes["RU-003"] = { ...ledger.nodes["RU-003"], status: "tombstoned" };
    });
    await assert.rejects(
      () => rollback.previewRollback(root, "f", "CP-001"),
      (error) => error.code === "ROLLBACK_CHAIN_INVALID",
    );
    // Even the tip (a no-op undo) refuses: the chain itself is not current.
    await assert.rejects(() => rollback.previewRollback(root, "f", "CP-003"), /ROLLBACK_CHAIN_INVALID/);
    const view = await status.readStatusView(root, "f");
    assert.deepEqual(view.rollback.validTargets, []);
    assert.equal(view.rollback.enforced, true);
  });
  // RU definition stale after checkpointing (plan amended the unit block).
  await withRoot(async (root) => {
    let state = await checkpointAllUnits(root, await threeUnitFeature(root));
    state = await editLedger(root, state, (ledger) => {
      ledger.nodes["RU-002"] = { ...ledger.nodes["RU-002"], status: "stale" };
    });
    await assert.rejects(
      () => rollback.previewRollback(root, "f", "CP-001"),
      (error) => error.code === "ROLLBACK_CHAIN_INVALID",
    );
    const view = await status.readStatusView(root, "f");
    assert.deepEqual(view.rollback.validTargets, []);
  });
});

async function editLedger(root, state, edit) {
  const ledger = await traceStore.readTraceability(root, state);
  edit(ledger);
  const traceability = await loadSource("plugins/dev-flow/src/core/traceability.ts");
  ledger.edges = traceability.deriveTraceEdges(ledger.nodes);
  ledger.summary = traceability.traceSummary(ledger.nodes);
  const pointer = await traceStore.writeTraceSnapshot(root, ledger);
  return stateStore.mutate(root, "f", state.revision, "preview-test-ledger-edit", (draft) => {
    draft.traceability = pointer;
  });
}

test("recreating a path the chain deleted or renamed away conflicts as unregistered", async () => {
  // Deleted by the checkpoint, then recreated by the user.
  await withRoot(async (root) => {
    let state = await threeUnitFeature(root);
    state = await units.beginImplementationUnit(root, "f", state.revision, "RU-001");
    await rm(path.join(root, "src/one/gone.txt"));
    state = (await checkpoints.checkpointImplementationUnit(root, "f", state.revision, "RU-001")).state;
    await writeFile(path.join(root, "src/one/gone.txt"), "recreated after delete\n");
    await assert.rejects(
      () => rollback.previewRollback(root, "f", "CP-001"),
      (error) => error.code === "ROLLBACK_CONFLICT"
        && error.details.conflicts.some((conflict) => conflict.path === "src/one/gone.txt"
          && conflict.expected === "absent" && conflict.actual === "unregistered"),
    );
    const view = await status.readStatusView(root, "f");
    assert.deepEqual(view.rollback.conflicts, [{ path: "src/one/gone.txt", expected: "absent", actual: "unregistered" }]);
  });
  // Renamed away by the checkpoint, then the old path is recreated.
  await withRoot(async (root) => {
    let state = await threeUnitFeature(root);
    state = await units.beginImplementationUnit(root, "f", state.revision, "RU-001");
    await rename(path.join(root, "src/one/gone.txt"), path.join(root, "src/one/renamed.txt"));
    state = (await checkpoints.checkpointImplementationUnit(root, "f", state.revision, "RU-001")).state;
    await writeFile(path.join(root, "src/one/gone.txt"), "recreated after rename\n");
    await assert.rejects(
      () => rollback.previewRollback(root, "f", "CP-001"),
      (error) => error.code === "ROLLBACK_CONFLICT"
        && error.details.conflicts.some((conflict) => conflict.path === "src/one/gone.txt"
          && conflict.expected === "absent" && conflict.actual === "unregistered"),
    );
  });
});

test("a dependency hole in the checkpoint chain fails closed", async () => {  await withRoot(async (root) => {
    let state = await checkpointAllUnits(root, await threeUnitFeature(root));
    // Simulate corruption: RU-003 is checkpointed while its dependency RU-002 is not.
    state = await stateStore.mutate(root, "f", state.revision, "preview-test-hole", (draft) => {
      const unit = draft.implementationUnits.find((candidate) => candidate.unitId === "RU-002");
      unit.status = "pending";
      delete unit.checkpointId;
      delete unit.startedFingerprint;
    });
    await assert.rejects(() => rollback.previewRollback(root, "f", "CP-001"), /ROLLBACK_CHAIN_INVALID/);
  });
});

test("any unregistered modification after the chain tip fails the whole preview", async () => {
  await withRoot(async (root) => {
    let state = await checkpointAllUnits(root, await threeUnitFeature(root));
    await writeFile(path.join(root, "src/two/b.txt"), "user edit after checkpoint\n");
    await assert.rejects(
      () => rollback.previewRollback(root, "f", "CP-001"),
      (error) => error.code === "ROLLBACK_CONFLICT"
        && error.details.conflicts.some((conflict) => conflict.path === "src/two/b.txt" && conflict.actual === "modified"),
    );
    await writeFile(path.join(root, "src/two/b.txt"), "two v2\n");
    // An unregistered new file inside a checkpointed scope is also a conflict.
    await writeFile(path.join(root, "src/two/sneaky.txt"), "unregistered\n");
    await assert.rejects(
      () => rollback.previewRollback(root, "f", "CP-001"),
      (error) => error.code === "ROLLBACK_CONFLICT"
        && error.details.conflicts.some((conflict) => conflict.path === "src/two/sneaky.txt" && conflict.actual === "unregistered"),
    );
    await rm(path.join(root, "src/two/sneaky.txt"));
    // A deleted checkpointed file conflicts as well.
    await rm(path.join(root, "src/three/c.txt"));
    await assert.rejects(
      () => rollback.previewRollback(root, "f", "CP-001"),
      (error) => error.code === "ROLLBACK_CONFLICT"
        && error.details.conflicts.some((conflict) => conflict.path === "src/three/c.txt" && conflict.actual === "missing"),
    );
    state = await stateStore.readState(root, "f");
    assert.equal(state.implementationUnits.every((unit) => unit.status === "checkpointed"), true);
  });
});

test("stale project config digests and unknown rollback commands reject the preview", async () => {
  await withRoot(async (root) => {
    await checkpointAllUnits(root, await threeUnitFeature(root));
    const drifted = JSON.parse(JSON.stringify(strictProjectConfig));
    drifted.verification.commands = [{ id: "unit", command: process.execPath, args: ["--test", "test/other.test.js"], cwd: "." }];
    await stateStore.initProject(root, drifted);
    await assert.rejects(() => rollback.previewRollback(root, "f", "CP-001"), /ROLLBACK_BASIS_STALE/);
  });
  await withRoot(async (root) => {
    let state = await checkpointAllUnits(root, await threeUnitFeature(root));
    const ledger = await traceStore.readTraceability(root, state);
    ledger.nodes["RU-003"] = { ...ledger.nodes["RU-003"], rollbackVerification: ["missing-command"] };
    const pointer = await traceStore.writeTraceSnapshot(root, ledger);
    state = await stateStore.mutate(root, "f", state.revision, "preview-test-command-edit", (draft) => {
      draft.traceability = pointer;
    });
    await assert.rejects(() => rollback.previewRollback(root, "f", "CP-001"), /TRACE_VERIFICATION_COMMAND_UNKNOWN/);
  });
});

test("status exposes the checkpoint chain, legal targets, and a conflict digest", async () => {
  await withRoot(async (root) => {
    let state = await checkpointAllUnits(root, await threeUnitFeature(root));
    let view = await status.readStatusView(root, "f");
    assert.equal(view.rollback.enforced, true);
    assert.deepEqual(view.rollback.chain, [
      { checkpointId: "CP-001", unitId: "RU-001", sequence: 1 },
      { checkpointId: "CP-002", unitId: "RU-002", sequence: 2 },
      { checkpointId: "CP-003", unitId: "RU-003", sequence: 3 },
    ]);
    assert.deepEqual(view.rollback.validTargets, ["CP-001", "CP-002", "CP-003"]);
    assert.deepEqual(view.rollback.conflicts, []);

    await writeFile(path.join(root, "src/three/c.txt"), "after the fact\n");
    view = await status.readStatusView(root, "f");
    assert.deepEqual(view.rollback.conflicts, [{ path: "src/three/c.txt", expected: "checkpointed", actual: "modified" }]);

    // checkpoints:0 features do not compute rollback views.
    state = await stateStore.mutate(root, "f", state.revision, "preview-test-dormant", (draft) => {
      draft.workflowCapabilities = { trace: 1, review: 0, checkpoints: 0, rollbackExecution: 0 };
    });
    view = await status.readStatusView(root, "f");
    assert.equal(view.rollback.enforced, false);
  });
});

test("next surfaces the unit lifecycle during the implementation step", async () => {
  await withRoot(async (root) => {
    let state = await threeUnitFeature(root);
    assert.deepEqual(await next.nextAction(root, "f"), { kind: "begin-implementation-unit", unitId: "RU-001" });

    state = await units.beginImplementationUnit(root, "f", state.revision, "RU-001");
    assert.deepEqual(await next.nextAction(root, "f"), { kind: "checkpoint-implementation-unit", unitId: "RU-001" });

    await writeFile(path.join(root, "src/one/a.txt"), "one v2\n");
    await rm(path.join(root, "src/one/gone.txt"));
    state = (await checkpoints.checkpointImplementationUnit(root, "f", state.revision, "RU-001")).state;
    assert.deepEqual(await next.nextAction(root, "f"), { kind: "begin-implementation-unit", unitId: "RU-002" });

    state = await checkpointAllUnitsTail(root, state);
    const action = await next.nextAction(root, "f");
    assert.equal(action.kind, "run-step");
    assert.equal(action.step, "implementation");
  });
});

/** Completes RU-002 and RU-003 after RU-001 is already checkpointed. */
async function checkpointAllUnitsTail(root, state) {
  state = await units.beginImplementationUnit(root, "f", state.revision, "RU-002");
  await writeFile(path.join(root, "src/two/b.txt"), "two v2\n");
  await writeFile(path.join(root, "src/two/new.txt"), "two added\n");
  state = (await checkpoints.checkpointImplementationUnit(root, "f", state.revision, "RU-002")).state;
  state = await units.beginImplementationUnit(root, "f", state.revision, "RU-003");
  await writeFile(path.join(root, "src/three/c.txt"), "three v2\n");
  return (await checkpoints.checkpointImplementationUnit(root, "f", state.revision, "RU-003")).state;
}
