import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { chmod, mkdir, mkdtemp, readFile, rename, rm, writeFile } from "node:fs/promises";
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

const checkpointsOn = Object.freeze({ trace: 1, review: 0, checkpoints: 1, rollbackExecution: 0 });

async function withRoot(run) {
  const root = await mkdtemp(path.join(os.tmpdir(), "dev-flow-checkpoints-"));
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

/** standard-m, one RU, approval confirmed, verification command "unit" passes. */
async function beginReadyFeature(root, { fileScope = ["src"], projectConfig = strictProjectConfig } = {}) {
  await stateStore.initProject(root, projectConfig);
  await mkdir(path.join(root, "src"), { recursive: true });
  await mkdir(path.join(root, "test"), { recursive: true });
  await writeFile(path.join(root, "test/counter.test.js"), "const test = require('node:test');\ntest('fixture passes', () => {});\n");
  await writeFile(path.join(root, "src/base.txt"), "base\n");
  await writeFile(path.join(root, "src/to-delete.txt"), "delete me\n");
  await writeFile(path.join(root, "src/old-name.txt"), "rename me\n");
  await writeFile(path.join(root, "src/dup-a.txt"), "same content\n");
  await writeFile(path.join(root, "src/dup-b.txt"), "same content\n");
  await writeFile(path.join(root, "src/script.sh"), "#!/bin/sh\nexit 0\n");
  let state = await stateStore.startFeature(root, {
    featureId: "f", host: "codex", level: "M", topology: "local", execution: "standard", requirements: "provided-confirmed",
  });
  state = await stateStore.mutate(root, "f", state.revision, "checkpoint-test-capabilities", (draft) => {
    draft.workflowCapabilities = { ...checkpointsOn };
  });
  state = await registerTraceFixture({ root, featureId: "f", state, kind: "requirements" });
  state = await stateStore.mutate(root, "f", state.revision, "checkpoint-test-requirements", (draft) => {
    draft.steps.requirements = { status: "satisfied" };
    draft.steps.requirement_confirmation = { status: "satisfied" };
  });
  const planDelta = {
    nodes: [
      { kind: "task", id: "TASK-001", covers: ["REQ-001", "AC-001"], rollbackUnit: "RU-001" },
      {
        kind: "rollback", id: "RU-001", tasks: ["TASK-001"], dependsOn: [], fileScope, covers: ["REQ-001", "AC-001"],
        forwardVerification: ["unit"], rollbackVerification: ["unit"],
      },
    ],
  };
  state = await registerTraceFixture({ root, featureId: "f", state, kind: "implementation-plan", delta: planDelta });
  state = await stateStore.mutate(root, "f", state.revision, "checkpoint-test-plan", (draft) => {
    draft.steps.implementation_plan = { status: "satisfied" };
  });
  state = await registerTraceFixture({ root, featureId: "f", state, kind: "coverage-matrix" });
  state = await stateStore.mutate(root, "f", state.revision, "checkpoint-test-approval", satisfyPreImplementation);
  return units.beginImplementationUnit(root, "f", state.revision, "RU-001");
}

/** Applies the standard change set after begin. */
async function applyChangeSet(root) {
  await writeFile(path.join(root, "src/base.txt"), "base v2\n");
  await writeFile(path.join(root, "src/added.bin"), Buffer.from([0, 255, 1, 2, 254]));
  await rm(path.join(root, "src/to-delete.txt"));
  await rename(path.join(root, "src/old-name.txt"), path.join(root, "src/new-name.txt"));
  await chmod(path.join(root, "src/script.sh"), 0o755);
  // Identical new file pair exercises content-addressed blob dedup.
  await rm(path.join(root, "src/dup-a.txt"));
  await rm(path.join(root, "src/dup-b.txt"));
  await writeFile(path.join(root, "src/dup-x.txt"), "duplicate\n");
  await writeFile(path.join(root, "src/dup-y.txt"), "duplicate\n");
}

test("checkpoint captures text, binary, added, deleted, renamed, and chmod changes with blob dedup", async () => {
  await withRoot(async (root) => {
    let state = await beginReadyFeature(root);
    await applyChangeSet(root);
    const result = await checkpoints.checkpointImplementationUnit(root, "f", state.revision, "RU-001");
    state = result.state;

    const unit = state.implementationUnits.find((candidate) => candidate.unitId === "RU-001");
    assert.equal(unit.status, "checkpointed");
    assert.equal(unit.checkpointId, result.manifest.checkpointId);

    const files = Object.fromEntries(result.manifest.files.map((record) => [record.path, record]));
    assert.deepEqual(files["src/base.txt"].change, "modified");
    assert.deepEqual(files["src/added.bin"].change, "added");
    assert.deepEqual(files["src/to-delete.txt"].change, "deleted");
    assert.deepEqual(files["src/new-name.txt"].change, "renamed");
    assert.equal(files["src/new-name.txt"].renamedFrom, "src/old-name.txt");
    assert.equal(files["src/new-name.txt"].beforeSha256, files["src/new-name.txt"].afterSha256);
    assert.equal(files["src/script.sh"].change, "mode-changed");
    assert.equal(files["src/script.sh"].beforeMode, "644");
    assert.equal(files["src/script.sh"].afterMode, "755");
    // The identical added pair shares one content-addressed blob.
    assert.equal(files["src/dup-x.txt"].afterBlobSha256, files["src/dup-y.txt"].afterBlobSha256);

    // Basis and verification evidence are fully recorded.
    assert.equal(result.manifest.unitId, "RU-001");
    assert.equal(result.manifest.sequence, 1);
    assert.equal(result.manifest.projectConfigSha256.length, 64);
    assert.deepEqual(result.manifest.verificationCommands.map((command) => command.commandId), ["unit"]);
    assert.equal(result.manifest.verificationAttempts.length, 1);
    assert.equal(result.manifest.verificationAttempts[0].status, "passed");
    assert.equal(result.manifest.verificationAttempts[0].commandId, "unit");
    assert.equal(result.manifest.startedFingerprint, unit.startedFingerprint);
    assert.notEqual(result.manifest.startedFingerprint, result.manifest.completedFingerprint);

    // Blobs and the manifest round-trip through the content-addressed store.
    for (const record of result.manifest.files) {
      for (const blobSha of [record.beforeBlobSha256, record.afterBlobSha256].filter(Boolean)) {
        const blob = await readFile(path.join(root, ".dev-flow/features/f", checkpoints.blobPath(blobSha)));
        assert.equal(digestOf(blob), blobSha);
      }
    }
    const manifest = await checkpoints.readCheckpoint(root, "f", result.manifest.checkpointId);
    assert.deepEqual(manifest, result.manifest);
    const chain = await checkpoints.checkpointChain(root, "f", state);
    assert.deepEqual(chain.map((entry) => entry.checkpointId), [result.manifest.checkpointId]);
  });
});

function digestOf(buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}

test("checkpoint rejects out-of-scope changes, verification failures, manifest interruptions, and hash drift", async (t) => {
  await t.test("out-of-scope change keeps the unit active without a manifest", async () => {
    await withRoot(async (root) => {
      const state = await beginReadyFeature(root);
      // "test" is a protected root but outside this unit's fileScope ["src"].
      await writeFile(path.join(root, "test/counter.test.js"), "const test = require('node:test');\ntest('changed', () => {});\n");
      await assert.rejects(
        () => checkpoints.checkpointImplementationUnit(root, "f", state.revision, "RU-001"),
        /IMPLEMENTATION_UNIT_OUT_OF_SCOPE/,
      );
      const after = await stateStore.readState(root, "f");
      assert.equal(after.implementationUnits[0].status, "active");
      assert.equal(after.implementationUnits[0].checkpointId, undefined);
    });
  });

  await t.test("failing forward verification keeps the unit active without a confirmed manifest", async () => {
    await withRoot(async (root) => {
      const failingConfig = JSON.parse(JSON.stringify(strictProjectConfig));
      failingConfig.verification.commands = [{ id: "unit", command: process.execPath, args: ["-e", "process.exit(1)"], cwd: "." }];
      const state = await beginReadyFeature(root, { projectConfig: failingConfig });
      await writeFile(path.join(root, "src/change.txt"), "change\n");
      await assert.rejects(
        () => checkpoints.checkpointImplementationUnit(root, "f", state.revision, "RU-001"),
        /CHECKPOINT_VERIFICATION_FAILED/,
      );
      const after = await stateStore.readState(root, "f");
      assert.equal(after.implementationUnits[0].status, "active");
      assert.equal(after.implementationUnits[0].checkpointId, undefined);
      await assert.rejects(() => checkpoints.readCheckpoint(root, "f", "CP-001"), /CHECKPOINT_NOT_FOUND/);
    });
  });

  await t.test("manifest interruption leaves an active unit and no confirmed checkpoint", async () => {
    await withRoot(async (root) => {
      let state = await beginReadyFeature(root);
      await writeFile(path.join(root, "src/change.txt"), "change\n");
      await assert.rejects(
        () => checkpoints.checkpointImplementationUnit(root, "f", state.revision, "RU-001", {
          fault: (point) => { if (point === "before-manifest-rename") throw new Error("injected manifest failure"); },
        }),
        /injected manifest failure/,
      );
      state = await stateStore.readState(root, "f");
      assert.equal(state.implementationUnits[0].status, "active");
      assert.equal(state.implementationUnits[0].checkpointId, undefined);
    });
  });

  await t.test("a state CAS conflict after the manifest lands retries idempotently", async () => {
    await withRoot(async (root) => {
      // The verification command records every execution; a correct retry
      // reuses the orphan manifest and never runs it a second time.
      await mkdir(path.join(root, "scripts"), { recursive: true });
      await writeFile(
        path.join(root, "scripts/count.mjs"),
        "import { appendFileSync } from 'node:fs'; appendFileSync('count.log', 'run\\n');\n",
      );
      const countConfig = JSON.parse(JSON.stringify(strictProjectConfig));
      countConfig.verification.commands = [{ id: "unit", command: process.execPath, args: ["scripts/count.mjs"], cwd: "." }];
      let state = await beginReadyFeature(root, { projectConfig: countConfig });
      await writeFile(path.join(root, "src/change.txt"), "change\n");
      // Land the manifest, then let an unrelated mutation win the revision race.
      const first = checkpoints.checkpointImplementationUnit(root, "f", state.revision, "RU-001", {
        fault: async (point) => {
          if (point === "after-manifest-rename") {
            const current = await stateStore.readState(root, "f");
            await stateStore.mutate(root, "f", current.revision, "checkpoint-test-cas-conflict", () => {});
          }
        },
      });
      await assert.rejects(first, /STATE_REVISION_CONFLICT/);
      state = await stateStore.readState(root, "f");
      assert.equal(state.implementationUnits[0].status, "active");
      const orphan = await checkpoints.readCheckpoint(root, "f", "CP-001");
      assert.equal((await readFile(path.join(root, "count.log"), "utf8")).trim().split("\n").length, 1);

      const retried = await checkpoints.checkpointImplementationUnit(root, "f", state.revision, "RU-001");
      // The orphan is reused verbatim: verification ran exactly once and the
      // recorded attempts keep their original identities.
      assert.equal((await readFile(path.join(root, "count.log"), "utf8")).trim().split("\n").length, 1);
      assert.equal(retried.manifest.checkpointId, "CP-001");
      assert.equal(retried.manifest.verificationAttempts[0].attemptId, orphan.verificationAttempts[0].attemptId);
      assert.deepEqual(retried.manifest, orphan);
      assert.equal(retried.state.implementationUnits[0].status, "checkpointed");
      assert.equal(retried.state.implementationUnits[0].checkpointId, "CP-001");
      const chain = await checkpoints.checkpointChain(root, "f", retried.state);
      assert.deepEqual(chain.map((entry) => entry.checkpointId), ["CP-001"]);
    });
  });

  await t.test("an orphan manifest that no longer matches the workspace is a conflict", async () => {
    await withRoot(async (root) => {
      let state = await beginReadyFeature(root);
      await writeFile(path.join(root, "src/change.txt"), "change\n");
      const first = checkpoints.checkpointImplementationUnit(root, "f", state.revision, "RU-001", {
        fault: async (point) => {
          if (point === "after-manifest-rename") {
            const current = await stateStore.readState(root, "f");
            await stateStore.mutate(root, "f", current.revision, "checkpoint-test-cas-conflict", () => {});
          }
        },
      });
      await assert.rejects(first, /STATE_REVISION_CONFLICT/);
      state = await stateStore.readState(root, "f");
      await writeFile(path.join(root, "src/change.txt"), "changed again\n");
      await assert.rejects(
        () => checkpoints.checkpointImplementationUnit(root, "f", state.revision, "RU-001"),
        /CHECKPOINT_CONFLICT/,
      );
      assert.equal((await stateStore.readState(root, "f")).implementationUnits[0].status, "active");
    });
  });

  await t.test("files changed by the verification command itself are rejected as drift", async () => {
    await withRoot(async (root) => {
      await mkdir(path.join(root, "scripts"), { recursive: true });
      await writeFile(
        path.join(root, "scripts/drift.mjs"),
        "import { appendFileSync } from 'node:fs'; appendFileSync('src/change.txt', 'drift\\n');\n",
      );
      const driftConfig = JSON.parse(JSON.stringify(strictProjectConfig));
      driftConfig.verification.commands = [{ id: "unit", command: process.execPath, args: ["scripts/drift.mjs"], cwd: "." }];
      const state = await beginReadyFeature(root, { projectConfig: driftConfig });
      await writeFile(path.join(root, "src/change.txt"), "initial\n");
      await assert.rejects(
        () => checkpoints.checkpointImplementationUnit(root, "f", state.revision, "RU-001"),
        /CHECKPOINT_HASH_MISMATCH/,
      );
      const after = await stateStore.readState(root, "f");
      assert.equal(after.implementationUnits[0].status, "active");
    });
  });
});

test("checkpoint rejects unknown command IDs and stale project config digests", async (t) => {
  await t.test("unknown forward verification command ID", async () => {
    await withRoot(async (root) => {
      let state = await beginReadyFeature(root);
      // A hand-edited ledger cannot re-register; corrupt the RU node's command list in place.
      state = await corruptLedgerRollbackNode(root, state, (node) => ({ ...node, forwardVerification: ["missing-command"] }));
      await writeFile(path.join(root, "src/change.txt"), "change\n");
      await assert.rejects(
        () => checkpoints.checkpointImplementationUnit(root, "f", state.revision, "RU-001"),
        /TRACE_VERIFICATION_COMMAND_UNKNOWN/,
      );
    });
  });

  await t.test("same command ID with a changed definition is stale", async () => {
    await withRoot(async (root) => {
      let state = await beginReadyFeature(root);
      const config = JSON.parse(JSON.stringify(strictProjectConfig));
      config.verification.commands = [{ id: "unit", command: process.execPath, args: ["--test", "test/other.test.js"], cwd: "." }];
      await stateStore.initProject(root, config);
      state = await stateStore.readState(root, "f");
      await writeFile(path.join(root, "src/change.txt"), "change\n");
      await assert.rejects(
        () => checkpoints.checkpointImplementationUnit(root, "f", state.revision, "RU-001"),
        /TRACE_SLICE_STALE/,
      );
    });
  });
});

async function corruptLedgerRollbackNode(root, state, edit) {
  const store = await loadSource("plugins/dev-flow/src/core/traceability-store.ts");
  const ledger = await store.readTraceability(root, state);
  const node = ledger.nodes["RU-001"];
  ledger.nodes["RU-001"] = edit(node);
  ledger.edges = [];
  const traceability = await loadSource("plugins/dev-flow/src/core/traceability.ts");
  ledger.edges = traceability.deriveTraceEdges(ledger.nodes);
  const pointer = await store.writeTraceSnapshot(root, ledger);
  return stateStore.mutate(root, "f", state.revision, "checkpoint-test-ledger-edit", (draft) => {
    draft.traceability = pointer;
  });
}

test("checkpoint requires an active unit and a checkpoints:1 feature", async () => {
  await withRoot(async (root) => {
    let state = await beginReadyFeature(root);
    await assert.rejects(
      () => checkpoints.checkpointImplementationUnit(root, "f", state.revision, "RU-009"),
      /IMPLEMENTATION_UNIT_UNKNOWN/,
    );
    state = await stateStore.mutate(root, "f", state.revision, "checkpoint-test-complete", (draft) => {
      const unit = draft.implementationUnits.find((candidate) => candidate.unitId === "RU-001");
      unit.status = "checkpointed";
      unit.checkpointId = "CP-001";
    });
    await assert.rejects(
      () => checkpoints.checkpointImplementationUnit(root, "f", state.revision, "RU-001"),
      /IMPLEMENTATION_UNIT_NOT_ACTIVE/,
    );
  });
  await withRoot(async (root) => {
    let state = await beginReadyFeature(root);
    state = await stateStore.mutate(root, "f", state.revision, "checkpoint-test-dormant", (draft) => {
      draft.workflowCapabilities = { trace: 1, review: 0, checkpoints: 0, rollbackExecution: 0 };
    });
    await assert.rejects(
      () => checkpoints.checkpointImplementationUnit(root, "f", state.revision, "RU-001"),
      /IMPLEMENTATION_UNITS_NOT_ENFORCED/,
    );
  });
});
