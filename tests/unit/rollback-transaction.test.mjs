import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { access, chmod, mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { loadSource } from "../helpers/load-source.mjs";
import { registerTraceFixture } from "../helpers/trace-fixtures.mjs";

const stateStore = await loadSource("plugins/dev-flow/src/core/state-store.ts");
const contract = await loadSource("plugins/dev-flow/src/policy/contract.ts");
const units = await loadSource("plugins/dev-flow/src/core/implementation-units.ts");
const checkpoints = await loadSource("plugins/dev-flow/src/core/checkpoints.ts");
const rollback = await loadSource("plugins/dev-flow/src/core/rollback.ts");
const fingerprint = await loadSource("plugins/dev-flow/src/core/fingerprint.ts");
const traceStore = await loadSource("plugins/dev-flow/src/core/traceability-store.ts");
const traceability = await loadSource("plugins/dev-flow/src/core/traceability.ts");

const sha = (letter) => letter.repeat(64);

/**
 * Two verification commands: "unit" always passes (forward verification at
 * checkpoint time); "rollback-check" is steered by rollback-mode.txt at the
 * repository root (unprotected, freely writable by tests) so rollback
 * verification can be forced to pass, fail, or drift the workspace.
 */
const projectConfig = {
  schemaVersion: 1,
  verification: {
    commands: [
      { id: "unit", command: process.execPath, args: ["--test", "test/counter.test.js"], cwd: "." },
      {
        id: "rollback-check",
        command: process.execPath,
        args: ["-e", "const fs=require('node:fs');const m=fs.readFileSync('rollback-mode.txt','utf8').trim();if(m==='drift'){fs.writeFileSync('src/three/drift.txt','drift\\n');process.exit(0);}process.exit(m==='pass'?0:1);"],
        cwd: ".",
      },
    ],
    behaviorCommands: [],
  },
  enforcement: { mode: "strict", gitWriteRequiresLogicComplete: true, oneActiveFeature: true, requireExplicitHumanReply: true },
  protectedRoots: ["src", "test"],
};

async function withRoot(run) {
  const root = await mkdtemp(path.join(os.tmpdir(), "dev-flow-rollback-txn-"));
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

/** Lands on the implementation step with RU-001..RU-003 checkpointed (CP-001..CP-003). */
async function checkpointedFeature(root, { rollbackExecution = 1 } = {}) {
  await stateStore.initProject(root, projectConfig);
  await mkdir(path.join(root, "src/one"), { recursive: true });
  await mkdir(path.join(root, "src/two"), { recursive: true });
  await mkdir(path.join(root, "src/three"), { recursive: true });
  await mkdir(path.join(root, "test"), { recursive: true });
  await writeFile(path.join(root, "test/counter.test.js"), "const test = require('node:test');\ntest('fixture passes', () => {});\n");
  await writeFile(path.join(root, "rollback-mode.txt"), "pass\n");
  await writeFile(path.join(root, "src/one/a.txt"), "one v1\n");
  await writeFile(path.join(root, "src/two/b.txt"), "two v1\n");
  await writeFile(path.join(root, "src/three/c.txt"), "three v1\n");
  await writeFile(path.join(root, "src/one/gone.txt"), "will be deleted\n");

  let state = await stateStore.startFeature(root, {
    featureId: "f", host: "codex", level: "M", topology: "local", execution: "standard", requirements: "provided-confirmed",
  });
  state = await stateStore.mutate(root, "f", state.revision, "txn-test-capabilities", (draft) => {
    draft.workflowCapabilities = { trace: 1, review: 0, checkpoints: 1, rollbackExecution };
  });
  state = await registerTraceFixture({ root, featureId: "f", state, kind: "requirements" });
  state = await stateStore.mutate(root, "f", state.revision, "txn-test-requirements", (draft) => {
    draft.steps.requirements = { status: "satisfied" };
    draft.steps.requirement_confirmation = { status: "satisfied" };
  });
  state = await registerTraceFixture({ root, featureId: "f", state, kind: "implementation-plan", delta: threeClosurePlanDelta(), edit: appendThirdTraceClosure });
  state = await stateStore.mutate(root, "f", state.revision, "txn-test-plan", (draft) => {
    draft.steps.implementation_plan = { status: "satisfied" };
  });
  state = await registerTraceFixture({ root, featureId: "f", state, kind: "coverage-matrix" });
  state = await stateStore.mutate(root, "f", state.revision, "txn-test-approval", satisfyPreImplementation);

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
  await chmod(path.join(root, "src/three/c.txt"), 0o755);
  return (await checkpoints.checkpointImplementationUnit(root, "f", state.revision, "RU-003")).state;
}

/** Present the gate for CP-001 and confirm it via elicitation. */
async function confirmedGate(root, state, targetCheckpointId = "CP-001") {
  const presented = await rollback.presentRollbackGate(root, "f", state.revision, targetCheckpointId);
  return rollback.resolveRollbackGateElicitation(root, "f", presented.state.revision, presented.interaction.id, "confirm", undefined, "codex");
}

const journalPath = (root) => path.join(root, ".dev-flow", "features", "f", "rollback-transaction.json");
const featureDirectory = (root) => path.join(root, ".dev-flow", "features", "f");

async function readJournal(root) {
  return JSON.parse(await readFile(journalPath(root), "utf8"));
}

async function pathExists(file) {
  try { await access(file); return true; } catch { return false; }
}

async function workspaceSnapshot(root) {
  return fingerprint.snapshotProtectedRoots(root, projectConfig.protectedRoots);
}

function unitById(state, unitId) {
  return (state.implementationUnits ?? []).find((unit) => unit.unitId === unitId);
}

/** The final state every successful execution/resume must converge to. */
async function assertRolledBackToCp001(root, state) {
  assert.equal(await readFile(path.join(root, "src/one/a.txt"), "utf8"), "one v2\n", "RU-001 output survives");
  assert.equal(await pathExists(path.join(root, "src/one/gone.txt")), false, "RU-001 deletion stays deleted");
  assert.equal(await readFile(path.join(root, "src/two/b.txt"), "utf8"), "two v1\n", "RU-002 modification undone");
  assert.equal(await pathExists(path.join(root, "src/two/new.txt")), false, "RU-002 addition removed");
  assert.equal(await readFile(path.join(root, "src/three/c.txt"), "utf8"), "three v1\n", "RU-003 content undone");
  assert.equal((await stat(path.join(root, "src/three/c.txt"))).mode & 0o777, 0o644, "RU-003 mode undone");

  const ru1 = unitById(state, "RU-001");
  const ru2 = unitById(state, "RU-002");
  const ru3 = unitById(state, "RU-003");
  assert.equal(ru1.status, "checkpointed");
  assert.equal(ru1.checkpointId, "CP-001");
  assert.equal(ru2.status, "pending", "earliest undone unit goes back to pending");
  assert.equal(ru2.checkpointId, undefined);
  assert.equal(ru2.startedFingerprint, undefined);
  assert.equal(ru3.status, "rolled_back", "later undone unit stays rolled_back for audit");
  assert.equal(ru3.checkpointId, "CP-003");

  assert.equal(state.rollbackGate, undefined, "gate is consumed");

  const journal = await readJournal(root);
  assert.equal(journal.phase, "committed");
  assert.equal(typeof journal.completedAt, "string");
  // A clean success has one id per undo command; a resume after a failed
  // drift-guard may retain earlier failed attempt ids as well.
  assert.ok(journal.verificationAttemptIds.length >= 2, "at least one attempt per undone unit command");
  const recoveryDir = path.join(featureDirectory(root), "checkpoints", "recovery", journal.transactionId);
  assert.equal(await pathExists(recoveryDir), false, "backup directory is cleaned after commit");
}

const INJECTED = (point) => (candidate) => {
  if (candidate === point) throw new Error(`injected:${point}`);
};

// ─── Fresh-execution validation chain ────────────────────────────────────────

test("execute requires a confirmed rollback gate", async () => {
  await withRoot(async (root) => {
    const state = await checkpointedFeature(root);
    await assert.rejects(
      () => rollback.executeRollback(root, "f", state.revision, "CP-001"),
      (error) => error.code === "ROLLBACK_GATE_NOT_CONFIRMED",
    );
  });
});

test("a pending gate is not enough to execute", async () => {
  await withRoot(async (root) => {
    const state = await checkpointedFeature(root);
    const presented = await rollback.presentRollbackGate(root, "f", state.revision, "CP-001");
    await assert.rejects(
      () => rollback.executeRollback(root, "f", presented.state.revision, "CP-001"),
      (error) => error.code === "ROLLBACK_GATE_NOT_CONFIRMED",
    );
  });
});

test("execute rejects target substitution", async () => {
  await withRoot(async (root) => {
    const state = await checkpointedFeature(root);
    const confirmed = await confirmedGate(root, state, "CP-001");
    await assert.rejects(
      () => rollback.executeRollback(root, "f", confirmed.revision, "CP-002"),
      (error) => error.code === "ROLLBACK_GATE_TARGET_MISMATCH",
    );
  });
});

test("execute rejects a workspace that changed after confirmation and clears the gate", async () => {
  await withRoot(async (root) => {
    const state = await checkpointedFeature(root);
    const confirmed = await confirmedGate(root, state);
    await writeFile(path.join(root, "src/two/b.txt"), "tampered\n");
    await assert.rejects(
      () => rollback.executeRollback(root, "f", confirmed.revision, "CP-001"),
      (error) => error.code === "ROLLBACK_GATE_BASIS_CHANGED" && error.details?.originalError === "ROLLBACK_CONFLICT",
    );
    assert.equal((await stateStore.readState(root, "f")).rollbackGate, undefined);
  });
});

test("execute rejects a non-active feature", async () => {
  await withRoot(async (root) => {
    let state = await checkpointedFeature(root);
    state = await confirmedGate(root, state);
    state = await stateStore.mutate(root, "f", state.revision, "txn-test-pause", (draft) => {
      draft.lifecycle = "paused";
    });
    await assert.rejects(
      () => rollback.executeRollback(root, "f", state.revision, "CP-001"),
      (error) => error.code === "INVALID_LIFECYCLE",
    );
  });
});

test("execute rejects a rollbackExecution:0 feature", async () => {
  await withRoot(async (root) => {
    const state = await checkpointedFeature(root, { rollbackExecution: 0 });
    await assert.rejects(
      () => rollback.executeRollback(root, "f", state.revision, "CP-001"),
      (error) => error.code === "ROLLBACK_EXECUTION_NOT_ALLOWED",
    );
  });
});

// ─── Success path ─────────────────────────────────────────────────────────────

test("success: workspace, units, gate, journal and events converge", async () => {
  await withRoot(async (root) => {
    const state = await checkpointedFeature(root);
    const confirmed = await confirmedGate(root, state);

    const result = await rollback.executeRollback(root, "f", confirmed.revision, "CP-001");
    assert.equal(result.outcome, "committed");
    await assertRolledBackToCp001(root, result.state);

    const events = await stateStore.readFeatureEvents(root, "f");
    const attempts = events.filter((event) => event.type === "rollback-verification-attempt");
    assert.equal(attempts.length, 2);
    assert.ok(attempts.every((event) => event.data.status === "passed" && event.data.commandId === "rollback-check"));
    const committed = events.filter((event) => event.type === "rollback-executed");
    assert.equal(committed.length, 1);
    assert.deepEqual(committed[0].data.undoOrder, ["RU-003", "RU-002"]);
    assert.equal(committed[0].data.targetCheckpointId, "CP-001");
  });
});

test("success resets downstream steps, freshness and logic-complete", async () => {
  await withRoot(async (root) => {
    let state = await checkpointedFeature(root);
    state = await stateStore.mutate(root, "f", state.revision, "txn-test-downstream", (draft) => {
      for (const step of ["implementation", "code_review", "verification", "feature_check", "finalize"]) {
        draft.steps[step] = { status: "satisfied" };
      }
      draft.logicComplete = true;
      draft.featureCheck = { passed: true, fingerprint: sha("f") };
      draft.verification.attempts = [{ id: 1, commandIds: ["unit"], kinds: ["targeted"], startedAt: "t", finishedAt: "t", exitCode: 0, output: "", fingerprint: sha("v"), host: "codex" }];
      draft.verification.satisfiedByAttemptId = 1;
      draft.verification.verifiedFingerprint = sha("v");
    });
    const confirmed = await confirmedGate(root, state);

    const result = await rollback.executeRollback(root, "f", confirmed.revision, "CP-001");
    for (const step of ["implementation", "code_review", "verification", "feature_check", "finalize"]) {
      assert.equal(result.state.steps[step], undefined, `${step} must be reset`);
    }
    assert.equal(result.state.logicComplete, false);
    assert.deepEqual(result.state.featureCheck, {});
    assert.equal(result.state.verification.satisfiedByAttemptId, undefined);
    assert.equal(result.state.verification.verifiedFingerprint, undefined);
    assert.equal(result.state.verification.attempts.length, 1, "attempt history is preserved");
  });
});

test("implementation approval is kept when the basis is unchanged", async () => {
  await withRoot(async (root) => {
    const state = await checkpointedFeature(root);
    const confirmed = await confirmedGate(root, state);
    const result = await rollback.executeRollback(root, "f", confirmed.revision, "CP-001");
    assert.equal(result.state.humanGates.implementation_approval?.status, "confirmed");
  });
});

test("implementation approval is dropped when the plan drifted from the target boundary", async () => {
  await withRoot(async (root) => {
    let state = await checkpointedFeature(root);
    // Amend the plan AFTER the checkpoints: new closure TASK-004/RU-004 changes
    // the traceability pointer, so the approval no longer covers CP-001's basis.
    state = await stateStore.mutatePrepared(root, "f", state.revision, "txn-test-amend-plan", async (current, nextStateRevision) => {
      const ledger = await traceStore.readTraceability(root, current);
      const nodes = {
        ...ledger.nodes,
        "TASK-004": {
          ...ledger.nodes["TASK-003"], id: "TASK-004", rollbackUnit: "RU-004",
          sourceAnchor: "<!-- dev-flow:id=TASK-004 kind=task -->",
        },
        "RU-004": {
          ...ledger.nodes["RU-003"], id: "RU-004", tasks: ["TASK-004"], dependsOn: ["RU-003"], fileScope: ["src/four"],
          sourceAnchor: "<!-- dev-flow:id=RU-004 kind=rollback -->",
        },
      };
      const pointer = await traceStore.writeTraceSnapshot(root, {
        ...ledger,
        nodes,
        edges: traceability.deriveTraceEdges(nodes),
        summary: traceability.traceSummary(nodes),
        revision: ledger.revision + 1,
        stateRevision: nextStateRevision,
      });
      return { mutate: (draft) => { draft.traceability = pointer; } };
    });
    const confirmed = await confirmedGate(root, state);

    const result = await rollback.executeRollback(root, "f", confirmed.revision, "CP-001");
    assert.equal(result.state.humanGates.implementation_approval, undefined, "approval must be re-earned");
    assert.equal(unitById(result.state, "RU-004").status, "pending", "untouched new unit stays pending");
    await assert.rejects(
      () => units.beginImplementationUnit(root, "f", result.state.revision, "RU-002"),
      (error) => error.code === "DEV_FLOW_IMPLEMENTATION_APPROVAL_REQUIRED",
    );
  });
});

test("redo: pending RU-002 checkpoints as CP-004, rolled_back RU-003 re-begins as CP-005", async () => {
  await withRoot(async (root) => {
    let state = await checkpointedFeature(root);
    state = await confirmedGate(root, state);
    state = (await rollback.executeRollback(root, "f", state.revision, "CP-001")).state;

    state = await units.beginImplementationUnit(root, "f", state.revision, "RU-002");
    assert.equal(unitById(state, "RU-002").status, "active");
    await writeFile(path.join(root, "src/two/b.txt"), "two v3\n");
    state = (await checkpoints.checkpointImplementationUnit(root, "f", state.revision, "RU-002")).state;
    assert.equal(unitById(state, "RU-002").checkpointId, "CP-004", "redo takes the next free on-disk sequence");

    state = await units.beginImplementationUnit(root, "f", state.revision, "RU-003");
    assert.equal(unitById(state, "RU-003").status, "active", "rolled_back unit can re-begin once dependencies are re-checkpointed");
    assert.equal(unitById(state, "RU-003").checkpointId, undefined, "re-begin clears the historical checkpoint reference");
    await writeFile(path.join(root, "src/three/c.txt"), "three v3\n");
    state = (await checkpoints.checkpointImplementationUnit(root, "f", state.revision, "RU-003")).state;
    assert.equal(unitById(state, "RU-003").checkpointId, "CP-005");

    const chain = (await rollback.rollbackChainView(root, state)).chain.map((entry) => entry.checkpointId);
    // The view is unit-derived: CP-003 stayed visible while RU-003 was
    // rolled_back, and drops out once the redo checkpoints CP-005. The CP-003
    // manifest itself stays on disk as immutable audit history.
    assert.deepEqual(chain, ["CP-001", "CP-004", "CP-005"], "the live chain follows current unit state");
    const preview = await rollback.previewRollback(root, "f", "CP-004");
    assert.deepEqual(preview.undoOrder, ["RU-003"]);
  });
});

test("live chain: rolled_back history is excluded from preview targets and conflicts", async () => {
  await withRoot(async (root) => {
    let state = await checkpointedFeature(root);
    state = await confirmedGate(root, state);
    state = (await rollback.executeRollback(root, "f", state.revision, "CP-001")).state;

    const view = await rollback.rollbackChainView(root, state);
    assert.deepEqual(view.chain.map((entry) => entry.checkpointId), ["CP-001", "CP-003"], "rolled_back history stays visible");
    assert.deepEqual(view.validTargets, [], "the live chain tip cannot be targeted; nothing remains to undo");
    assert.deepEqual(view.conflicts, [], "conflicts are computed against the live chain tip");

    await assert.rejects(
      () => rollback.previewRollback(root, "f", "CP-003"),
      (error) => error.code === "ROLLBACK_TARGET_INVALID",
    );
    await assert.rejects(
      () => rollback.previewRollback(root, "f", "CP-001"),
      (error) => error.code === "ROLLBACK_TARGET_INVALID" && /tip/.test(error.message),
    );
    await assert.rejects(
      () => rollback.previewRollback(root, "f", "CP-002"),
      (error) => error.code === "ROLLBACK_TARGET_INVALID",
    );
  });
});

// ─── Fault injection and resume ───────────────────────────────────────────────

const FAULT_POINTS = [
  "before-journal-write",
  "after-journal-write",
  "during-backup",
  "before-first-rename",
  "after-first-rename",
  "before-verification",
  "before-state-cas",
  "after-state-cas",
];

for (const point of FAULT_POINTS) {
  test(`fault at ${point}: resume completes and never loses pre-rollback bytes`, async () => {
    await withRoot(async (root) => {
      let state = await checkpointedFeature(root);
      state = await confirmedGate(root, state);
      const preRollback = await workspaceSnapshot(root);

      await assert.rejects(
        () => rollback.executeRollback(root, "f", state.revision, "CP-001", { fault: INJECTED(point) }),
        (error) => error.message === `injected:${point}`,
      );

      // Pre-rollback bytes/mode must still exist somewhere recoverable until
      // the transaction reaches its terminal cleanup.
      const journalExists = await pathExists(journalPath(root));
      if (point !== "before-journal-write") {
        assert.ok(journalExists, "journal must exist once prepare ran");
        const journal = await readJournal(root);
        const backupManifest = path.join(featureDirectory(root), journal.backupDirectory, "backup-manifest.json");
        if (await pathExists(backupManifest)) {
          const backup = JSON.parse(await readFile(backupManifest, "utf8"));
          for (const file of preRollback) {
            const recorded = backup.files.find((candidate) => candidate.path === file.path);
            assert.ok(recorded, `backup manifest must record ${file.path}`);
            assert.equal(recorded.sha256, file.sha256);
            assert.equal(recorded.mode, file.mode);
            assert.ok(await pathExists(path.join(featureDirectory(root), journal.backupDirectory, "files", file.sha256)), `backup bytes for ${file.path}`);
          }
        }
      } else {
        assert.equal(journalExists, false, "no journal may exist before prepare");
      }

      const current = await stateStore.readState(root, "f");
      const result = await rollback.executeRollback(root, "f", current.revision, "CP-001");
      assert.equal(result.outcome, "committed");
      await assertRolledBackToCp001(root, result.state);
    });
  });
}

test("crash between journal phases leaves a resumable journal snapshot", async () => {
  await withRoot(async (root) => {
    let state = await checkpointedFeature(root);
    state = await confirmedGate(root, state);

    await assert.rejects(
      () => rollback.executeRollback(root, "f", state.revision, "CP-001", { fault: INJECTED("after-first-rename") }),
    );
    const journal = await readJournal(root);
    assert.equal(journal.phase, "rolling-back");
    assert.equal(journal.nextFileIndex, 1, "exactly one file action was applied");
    assert.equal(journal.targetCheckpointId, "CP-001");
    assert.deepEqual(journal.undoOrder, ["RU-003", "RU-002"]);
    // The first filePlan entry (sorted paths: src/three/c.txt restore) is already applied.
    assert.equal(await readFile(path.join(root, "src/three/c.txt"), "utf8"), "three v1\n");
    assert.equal(await readFile(path.join(root, "src/two/b.txt"), "utf8"), "two v2\n", "later files are untouched");

    const current = await stateStore.readState(root, "f");
    const result = await rollback.executeRollback(root, "f", current.revision, "CP-001");
    await assertRolledBackToCp001(root, result.state);
  });
});

test("resume with a mismatched target is rejected", async () => {
  await withRoot(async (root) => {
    let state = await checkpointedFeature(root);
    state = await confirmedGate(root, state);
    await assert.rejects(
      () => rollback.executeRollback(root, "f", state.revision, "CP-001", { fault: INJECTED("before-verification") }),
    );
    const current = await stateStore.readState(root, "f");
    await assert.rejects(
      () => rollback.executeRollback(root, "f", current.revision, "CP-002"),
      (error) => error.code === "ROLLBACK_TRANSACTION_MISMATCH",
    );
  });
});

test("workspace drift after a mid-backup crash is rejected, never absorbed into the backup", async () => {
  await withRoot(async (root) => {
    let state = await checkpointedFeature(root);
    state = await confirmedGate(root, state);
    await assert.rejects(
      () => rollback.executeRollback(root, "f", state.revision, "CP-001", { fault: INJECTED("during-backup") }),
    );
    assert.equal((await readJournal(root)).phase, "backing-up");

    // Post-confirmation drift on a file the file plan would restore: the old
    // code re-captured it into the "pre-rollback" backup, then the commit
    // cleanup deleted the only copy.
    await writeFile(path.join(root, "src/two/b.txt"), "user's new work\n");

    const current = await stateStore.readState(root, "f");
    await assert.rejects(
      () => rollback.executeRollback(root, "f", current.revision, "CP-001"),
      (error) => error.code === "ROLLBACK_HASH_MISMATCH"
        && Array.isArray(error.details?.conflicts)
        && error.details.conflicts.some((conflict) => conflict.path === "src/two/b.txt"),
    );
    // Fail closed: the drift stays in place and no backup absorbs it.
    assert.equal(await readFile(path.join(root, "src/two/b.txt"), "utf8"), "user's new work\n");
    assert.equal((await readJournal(root)).phase, "backing-up");
    const journal = await readJournal(root);
    const manifestFile = path.join(featureDirectory(root), journal.backupDirectory, "backup-manifest.json");
    assert.equal(await pathExists(manifestFile), false, "no backup manifest was recreated from drifted bytes");

    // Reverting the drift unblocks the resume.
    await writeFile(path.join(root, "src/two/b.txt"), "two v2\n");
    const result = await rollback.executeRollback(root, "f", current.revision, "CP-001");
    await assertRolledBackToCp001(root, result.state);
  });
});

test("workspace drift before any backup is rejected on resume", async () => {
  await withRoot(async (root) => {
    let state = await checkpointedFeature(root);
    state = await confirmedGate(root, state);
    await assert.rejects(
      () => rollback.executeRollback(root, "f", state.revision, "CP-001", { fault: INJECTED("after-journal-write") }),
    );
    assert.equal((await readJournal(root)).phase, "prepared");

    await writeFile(path.join(root, "src/two/b.txt"), "user's new work\n");

    const current = await stateStore.readState(root, "f");
    await assert.rejects(
      () => rollback.executeRollback(root, "f", current.revision, "CP-001"),
      (error) => error.code === "ROLLBACK_HASH_MISMATCH",
    );
    assert.equal(await readFile(path.join(root, "src/two/b.txt"), "utf8"), "user's new work\n");
    assert.equal((await readJournal(root)).phase, "backing-up", "the phase advanced but no file was captured or applied");

    await writeFile(path.join(root, "src/two/b.txt"), "two v2\n");
    const result = await rollback.executeRollback(root, "f", current.revision, "CP-001");
    await assertRolledBackToCp001(root, result.state);
  });
});

test("two concurrent resumes on the same open journal: only one drives", async () => {
  await withRoot(async (root) => {
    let state = await checkpointedFeature(root);
    state = await confirmedGate(root, state);
    // Land the journal and pause before verification so both resumes race on drive.
    await assert.rejects(
      () => rollback.executeRollback(root, "f", state.revision, "CP-001", { fault: INJECTED("before-verification") }),
    );
    const journal = await readJournal(root);
    assert.equal(journal.phase, "verifying");
    const current = await stateStore.readState(root, "f");

    const outcomes = await Promise.allSettled([
      rollback.executeRollback(root, "f", current.revision, "CP-001"),
      rollback.executeRollback(root, "f", current.revision, "CP-001"),
    ]);
    const fulfilled = outcomes.filter((item) => item.status === "fulfilled");
    const rejected = outcomes.filter((item) => item.status === "rejected");
    assert.equal(fulfilled.length, 1, "exactly one resume commits");
    assert.equal(rejected.length, 1, "the other resume is rejected");
    // Loser is BUSY while the winner still drives; if the winner already finished
    // by claim time, the open journal is gone → MISMATCH (or fresh-path gate miss).
    assert.ok(
      ["ROLLBACK_TRANSACTION_BUSY", "ROLLBACK_TRANSACTION_MISMATCH", "ROLLBACK_GATE_NOT_CONFIRMED"].includes(rejected[0].reason.code),
      `unexpected loser code: ${rejected[0].reason.code}`,
    );
    await assertRolledBackToCp001(root, fulfilled[0].value.state);

    // Verification attempts must not be doubled by a second driver.
    const events = await stateStore.readFeatureEvents(root, "f");
    const attempts = events.filter((event) =>
      event.type === "rollback-verification-attempt"
      && event.data?.transactionId === journal.transactionId
      && event.data?.status === "passed"
      && event.data?.commandId !== "drift-guard");
    assert.equal(attempts.length, 2, "one passed attempt per undone unit command");
  });
});

test("a fresh local drive heartbeat prevents an old acquisition timestamp from being reclaimed", async () => {
  await withRoot(async (root) => {
    let state = await checkpointedFeature(root);
    state = await confirmedGate(root, state);
    await assert.rejects(
      () => rollback.executeRollback(root, "f", state.revision, "CP-001", { fault: INJECTED("before-verification") }),
    );
    const journal = await readJournal(root);
    const leaseFile = path.join(featureDirectory(root), journal.backupDirectory, "drive-lease.json");
    const oldTimestamp = new Date(Date.now() - 31_000).toISOString();
    await writeFile(leaseFile, `${JSON.stringify({
      schemaVersion: 1,
      transactionId: journal.transactionId,
      featureId: "f",
      ownerId: "live-owner",
      pid: process.pid,
      hostname: os.hostname(),
      acquiredAt: oldTimestamp,
      heartbeatAt: new Date().toISOString(),
    })}\n`);

    await assert.rejects(
      () => stateStore.claimRollbackDriveLease(root, "f", journal.transactionId),
      (error) => error.code === "ROLLBACK_TRANSACTION_BUSY",
    );
  });
});

test("a stale local drive heartbeat is reclaimable even when its pid is wedged", async () => {
  await withRoot(async (root) => {
    let state = await checkpointedFeature(root);
    state = await confirmedGate(root, state);
    await assert.rejects(
      () => rollback.executeRollback(root, "f", state.revision, "CP-001", { fault: INJECTED("before-verification") }),
    );
    const journal = await readJournal(root);
    const leaseFile = path.join(featureDirectory(root), journal.backupDirectory, "drive-lease.json");
    const oldTimestamp = new Date(Date.now() - 31_000).toISOString();
    await writeFile(leaseFile, `${JSON.stringify({
      schemaVersion: 1,
      transactionId: journal.transactionId,
      featureId: "f",
      ownerId: "wedged-owner",
      pid: process.pid,
      hostname: os.hostname(),
      acquiredAt: oldTimestamp,
      heartbeatAt: oldTimestamp,
    })}\n`);

    const replacement = await stateStore.claimRollbackDriveLease(root, "f", journal.transactionId);
    assert.notEqual(replacement.ownerId, "wedged-owner");
    await stateStore.releaseRollbackDriveLease(root, "f", replacement);
  });
});

test("a fresh remote drive heartbeat prevents a stale acquisition timestamp from being reclaimed", async () => {
  await withRoot(async (root) => {
    let state = await checkpointedFeature(root);
    state = await confirmedGate(root, state);
    await assert.rejects(
      () => rollback.executeRollback(root, "f", state.revision, "CP-001", { fault: INJECTED("before-verification") }),
    );
    const journal = await readJournal(root);
    const leaseFile = path.join(featureDirectory(root), journal.backupDirectory, "drive-lease.json");
    await writeFile(leaseFile, `${JSON.stringify({
      schemaVersion: 1,
      transactionId: journal.transactionId,
      featureId: "f",
      ownerId: "remote-owner",
      pid: 12345,
      hostname: "other-host",
      acquiredAt: new Date(Date.now() - 31_000).toISOString(),
      heartbeatAt: new Date().toISOString(),
    })}\n`);

    await assert.rejects(
      () => stateStore.claimRollbackDriveLease(root, "f", journal.transactionId),
      (error) => error.code === "ROLLBACK_TRANSACTION_BUSY",
    );
  });
});

test("drift after the first rename is fail-closed and never compensated", async () => {
  await withRoot(async (root) => {
    let state = await checkpointedFeature(root);
    state = await confirmedGate(root, state);
    const drifted = "user work after first rename\n";
    await assert.rejects(
      () => rollback.executeRollback(root, "f", state.revision, "CP-001", {
        fault: async (point) => {
          if (point === "after-first-rename") {
            // External edit on a path the plan already restored — must not be
            // overwritten by compensation when the drift guard fires later.
            await writeFile(path.join(root, "src/three/c.txt"), drifted);
          }
        },
      }),
      (error) => error.code === "ROLLBACK_HASH_MISMATCH"
        && error.details?.source === "post-plan",
    );
    assert.equal(await readFile(path.join(root, "src/three/c.txt"), "utf8"), drifted, "user bytes must survive");
    const journal = await readJournal(root);
    assert.notEqual(journal.phase, "compensated");
    assert.notEqual(journal.phase, "committed");
    assert.equal(typeof journal.completedAt, "undefined");
    // Backup scene stays so resume can continue after the user restores the path.
    const backupDir = path.join(featureDirectory(root), journal.backupDirectory);
    assert.equal(await pathExists(backupDir), true);
    assert.equal(await pathExists(path.join(backupDir, "backup-manifest.json")), true);

    await writeFile(path.join(root, "src/three/c.txt"), "three v1\n");
    await chmod(path.join(root, "src/three/c.txt"), 0o644);
    const current = await stateStore.readState(root, "f");
    const result = await rollback.executeRollback(root, "f", current.revision, "CP-001");
    await assertRolledBackToCp001(root, result.state);
  });
});

test("an open transaction blocks a fresh execute on another feature", async () => {
  await withRoot(async (root) => {
    let stateF = await checkpointedFeature(root);
    // Second feature with its own confirmed gate; open journal on F must block G's fresh execute.
    let stateG = await stateStore.startFeature(root, {
      featureId: "g", host: "codex", level: "M", topology: "local", execution: "standard", requirements: "provided-confirmed", activation: "paused",
    });
    // Minimal path: plant a confirmed-looking gate is heavy; instead open F's journal mid-flight
    // and assert prepare/begin refuses even when G has no journal of its own.
    stateF = await confirmedGate(root, stateF);
    await assert.rejects(
      () => rollback.executeRollback(root, "f", stateF.revision, "CP-001", { fault: INJECTED("after-journal-write") }),
    );
    assert.equal((await readJournal(root)).phase, "prepared");

    // Fresh begin for any other feature id is rejected project-wide (atomic prepare).
    await assert.rejects(
      () => stateStore.prepareRollbackTransaction(root, "g", stateG.revision, {
        schemaVersion: 1,
        transactionId: "should-not-land",
        featureId: "g",
        phase: "prepared",
        targetCheckpointId: "CP-001",
        targetUnitId: "RU-001",
        undoOrder: ["RU-002"],
        previewBasisHash: "a".repeat(64),
        stateRevision: stateG.revision,
        backupDirectory: "checkpoints/recovery/should-not-land",
        nextFileIndex: 0,
        filePlan: [{ action: "delete", path: "src/x" }],
        verificationAttemptIds: [],
        projectConfigSha256: "b".repeat(64),
        startedAt: new Date().toISOString(),
      }),
      (error) => error.code === "ROLLBACK_TRANSACTION_OPEN",
    );
    assert.equal(await pathExists(path.join(root, ".dev-flow", "features", "g", "rollback-transaction.json")), false);
  });
});

test("drift after backup and before the first rename is rejected, not overwritten", async () => {
  await withRoot(async (root) => {
    let state = await checkpointedFeature(root);
    state = await confirmedGate(root, state);
    const drifted = "user work after backup\n";
    await assert.rejects(
      () => rollback.executeRollback(root, "f", state.revision, "CP-001", {
        fault: async (point) => {
          if (point === "before-first-rename") {
            // No throw: simulate an external editor while the transaction is open.
            await writeFile(path.join(root, "src/three/c.txt"), drifted);
          }
        },
      }),
      (error) => error.code === "ROLLBACK_HASH_MISMATCH"
        && error.details?.path === "src/three/c.txt",
    );
    assert.equal(await readFile(path.join(root, "src/three/c.txt"), "utf8"), drifted, "user bytes must survive");
    const journal = await readJournal(root);
    assert.equal(journal.phase, "rolling-back");
    assert.equal(journal.nextFileIndex, 0, "no file action applied");

    await writeFile(path.join(root, "src/three/c.txt"), "three v2\n");
    await chmod(path.join(root, "src/three/c.txt"), 0o755);
    const current = await stateStore.readState(root, "f");
    const result = await rollback.executeRollback(root, "f", current.revision, "CP-001");
    await assertRolledBackToCp001(root, result.state);
  });
});

test("an open transaction blocks every feature's mutations but not reads", async () => {
  await withRoot(async (root) => {
    let state = await checkpointedFeature(root);
    // A paused sibling created BEFORE the transaction opens.
    await stateStore.startFeature(root, {
      featureId: "g", host: "codex", level: "XS", topology: "local", requirements: "provided-confirmed", activation: "paused",
    });
    state = await confirmedGate(root, state);
    await assert.rejects(
      () => rollback.executeRollback(root, "f", state.revision, "CP-001", { fault: INJECTED("before-verification") }),
    );
    const journal = await readJournal(root);

    const current = await stateStore.readState(root, "f");
    await assert.rejects(
      () => stateStore.mutate(root, "f", current.revision, "should-be-blocked", (draft) => {
        draft.blockingFindings = [];
      }),
      (error) => error.code === "ROLLBACK_TRANSACTION_OPEN"
        && error.details?.transactionId === journal.transactionId
        && error.details?.phase === "verifying",
    );
    // Reads stay available for status/doctor.
    await stateStore.readState(root, "f");

    // Project-wide (plan: 任一 open transaction 阻止其他 feature mutation):
    // the paused sibling cannot mutate, and no new feature can be started.
    const paused = await stateStore.readState(root, "g");
    await assert.rejects(
      () => stateStore.mutate(root, "g", paused.revision, "cross-feature-blocked", (draft) => {
        draft.blockingFindings = [];
      }),
      (error) => error.code === "ROLLBACK_TRANSACTION_OPEN"
        && error.details?.transactionId === journal.transactionId,
    );
    await assert.rejects(
      () => stateStore.startFeature(root, {
        featureId: "h", host: "codex", level: "XS", topology: "local", requirements: "provided-confirmed", activation: "paused",
      }),
      (error) => error.code === "ROLLBACK_TRANSACTION_OPEN",
    );

    // switchActive is a feature mutation too and must be blocked.
    await assert.rejects(
      () => stateStore.switchActive(root, "f", "g", "try to escape the transaction"),
      (error) => error.code === "ROLLBACK_TRANSACTION_OPEN",
    );

    const result = await rollback.executeRollback(root, "f", current.revision, "CP-001");
    await assertRolledBackToCp001(root, result.state);
  });
});

test("an unreadable journal fails closed on mutations and execution", async () => {
  await withRoot(async (root) => {
    let state = await checkpointedFeature(root);
    state = await confirmedGate(root, state);
    await stateStore.startFeature(root, {
      featureId: "g", host: "codex", level: "XS", topology: "local", requirements: "provided-confirmed", activation: "paused",
    });
    await writeFile(journalPath(root), "not json");
    await assert.rejects(
      () => stateStore.mutate(root, "f", state.revision, "blocked", (draft) => {
        draft.blockingFindings = [];
      }),
      (error) => error.code === "ROLLBACK_TRANSACTION_UNREADABLE",
    );
    // Fail closed project-wide: the corrupt journal blocks other features too.
    const paused = await stateStore.readState(root, "g");
    await assert.rejects(
      () => stateStore.mutate(root, "g", paused.revision, "cross-feature-blocked", (draft) => {
        draft.blockingFindings = [];
      }),
      (error) => error.code === "ROLLBACK_TRANSACTION_UNREADABLE",
    );
    await assert.rejects(
      () => stateStore.startFeature(root, {
        featureId: "h", host: "codex", level: "XS", topology: "local", requirements: "provided-confirmed", activation: "paused",
      }),
      (error) => error.code === "ROLLBACK_TRANSACTION_UNREADABLE",
    );
    await assert.rejects(
      () => rollback.executeRollback(root, "f", state.revision, "CP-001"),
      (error) => error.code === "ROLLBACK_TRANSACTION_UNREADABLE",
    );
    await stateStore.readState(root, "f");
  });
});

// ─── Compensation and blocking ────────────────────────────────────────────────

test("verification failure compensates the workspace byte-identically and consumes the gate", async () => {
  await withRoot(async (root) => {
    let state = await checkpointedFeature(root);
    state = await confirmedGate(root, state);
    const preRollback = await workspaceSnapshot(root);
    await writeFile(path.join(root, "rollback-mode.txt"), "fail\n");

    await assert.rejects(
      () => rollback.executeRollback(root, "f", state.revision, "CP-001"),
      (error) => error.code === "ROLLBACK_EXECUTION_FAILED" && error.details?.compensated === true,
    );

    const after = await workspaceSnapshot(root);
    assert.deepEqual(after, preRollback, "compensation restores every byte and mode");

    const current = await stateStore.readState(root, "f");
    for (const unitId of ["RU-001", "RU-002", "RU-003"]) {
      assert.equal(unitById(current, unitId).status, "checkpointed", "compensation means the rollback never happened");
    }
    assert.equal(current.rollbackGate, undefined, "the one-shot confirmation is consumed");

    const journal = await readJournal(root);
    assert.equal(journal.phase, "compensated");
    assert.equal(typeof journal.completedAt, "string");
    const recoveryDir = path.join(featureDirectory(root), "checkpoints", "recovery", journal.transactionId);
    assert.equal(await pathExists(recoveryDir), false, "backup and trash are cleaned after compensation");

    const events = await stateStore.readFeatureEvents(root, "f");
    assert.equal(events.filter((event) => event.type === "rollback-verification-attempt").length, 1, "stops at the first failed command");
    const compensationAttempts = events.filter((event) => event.type === "rollback-compensation-attempt");
    assert.equal(compensationAttempts.length, 1);
    assert.equal(compensationAttempts[0].data.status, "passed");
  });
});

test("verification commands that drift protected files compensate from the pre-rollback backup", async () => {
  await withRoot(async (root) => {
    let state = await checkpointedFeature(root);
    state = await confirmedGate(root, state);
    const preRollback = await workspaceSnapshot(root);
    await writeFile(path.join(root, "rollback-mode.txt"), "drift\n");

    await assert.rejects(
      () => rollback.executeRollback(root, "f", state.revision, "CP-001"),
      (error) => error.code === "ROLLBACK_EXECUTION_FAILED"
        && error.details?.cause === "ROLLBACK_VERIFICATION_FAILED"
        && error.details?.compensated === true,
    );
    assert.deepEqual(await workspaceSnapshot(root), preRollback, "compensation restores the full pre-rollback workspace");
    assert.equal(await pathExists(path.join(root, "src/three/drift.txt")), false, "verification drift is removed by compensation");
    const journal = await readJournal(root);
    assert.equal(journal.phase, "compensated");
    assert.equal(typeof journal.completedAt, "string");
    assert.equal(await pathExists(path.join(featureDirectory(root), journal.backupDirectory)), false);
  });
});

test("a crash mid-compensation is resumable and finishes the restore", async () => {
  await withRoot(async (root) => {
    let state = await checkpointedFeature(root);
    state = await confirmedGate(root, state);
    const preRollback = await workspaceSnapshot(root);
    await writeFile(path.join(root, "rollback-mode.txt"), "fail\n");

    await assert.rejects(
      () => rollback.executeRollback(root, "f", state.revision, "CP-001", { fault: INJECTED("during-compensation") }),
      (error) => error.message === "injected:during-compensation",
    );
    const journal = await readJournal(root);
    assert.equal(journal.phase, "compensating");
    assert.equal(journal.error, undefined, "a mid-compensation crash stays resumable, not blocked");

    const current = await stateStore.readState(root, "f");
    await assert.rejects(
      () => rollback.executeRollback(root, "f", current.revision, "CP-001"),
      (error) => error.code === "ROLLBACK_EXECUTION_FAILED" && error.details?.compensated === true,
    );
    assert.deepEqual(await workspaceSnapshot(root), preRollback);
    const finalJournal = await readJournal(root);
    assert.equal(finalJournal.phase, "compensated");
    assert.equal(typeof finalJournal.completedAt, "string");
  });
});

test("corrupt backup bytes during compensation block recovery and preserve the scene", async () => {
  await withRoot(async (root) => {
    let state = await checkpointedFeature(root);
    state = await confirmedGate(root, state);
    await writeFile(path.join(root, "rollback-mode.txt"), "fail\n");

    // Stop after the backup is complete, then corrupt one backup blob.
    await assert.rejects(
      () => rollback.executeRollback(root, "f", state.revision, "CP-001", { fault: INJECTED("before-first-rename") }),
    );
    const journal = await readJournal(root);
    const backupDir = path.join(featureDirectory(root), journal.backupDirectory);
    const backup = JSON.parse(await readFile(path.join(backupDir, "backup-manifest.json"), "utf8"));
    const victim = backup.files.find((file) => file.path === "src/two/b.txt");
    await writeFile(path.join(backupDir, "files", victim.sha256), "corrupted\n");

    const current = await stateStore.readState(root, "f");
    await assert.rejects(
      () => rollback.executeRollback(root, "f", current.revision, "CP-001"),
      (error) => error.code === "ROLLBACK_RECOVERY_BLOCKED",
    );

    const blockedJournal = await readJournal(root);
    assert.equal(blockedJournal.phase, "compensating");
    assert.equal(typeof blockedJournal.error, "string", "blocking records the failure");
    assert.ok(await pathExists(backupDir), "backup scene is preserved while blocked");
    assert.ok(blockedJournal.verificationAttemptIds.length >= 2, "both attempt groups are referenced");

    // A second attempt keeps blocking deterministically; nothing is overwritten.
    const again = await stateStore.readState(root, "f");
    await assert.rejects(
      () => rollback.executeRollback(root, "f", again.revision, "CP-001"),
      (error) => error.code === "ROLLBACK_RECOVERY_BLOCKED",
    );
  });
});
