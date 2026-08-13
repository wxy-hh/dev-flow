import assert from "node:assert/strict";
import test from "node:test";
import { createTinyApp, strictProjectConfig } from "../helpers/fixture-repo.mjs";
import { loadSource } from "../helpers/load-source.mjs";

const store = await loadSource("plugins/dev-flow/src/core/state-store.ts");
const journal = await loadSource("plugins/dev-flow/src/core/rollback-journal.ts");

const rollbackJournal = (featureId, overrides = {}) => ({
  schemaVersion: 1,
  transactionId: "txn-gate-1",
  featureId,
  phase: "verifying",
  targetCheckpointId: "CP-001",
  targetUnitId: "UNIT-001",
  undoOrder: ["UNIT-001"],
  previewBasisHash: "a".repeat(64),
  stateRevision: 0,
  backupDirectory: "checkpoints/recovery/txn-gate-1",
  nextFileIndex: 0,
  filePlan: [{ action: "delete", path: "src/x" }],
  verificationAttemptIds: [],
  projectConfigSha256: "b".repeat(64),
  startedAt: new Date().toISOString(),
  ...overrides,
});

test("an open rollback journal blocks every feature mutation but not reads or the owning transaction", async () => {
  const fixture = await createTinyApp();
  try {
    await store.initProject(fixture.root, strictProjectConfig);
    const state = await store.startFeature(fixture.root, { featureId: "feature", host: "codex", level: "XS", topology: "local" });
    const transactionId = "txn-gate-1";
    await journal.writeRollbackTransaction(fixture.root, "feature", rollbackJournal("feature", {
      transactionId,
      stateRevision: state.revision,
      backupDirectory: `checkpoints/recovery/${transactionId}`,
    }));

    // A plain mutation on the same feature is rejected while the journal is open.
    await assert.rejects(
      () => store.mutate(fixture.root, "feature", state.revision, "blocked-op", (draft) => { draft.blockingFindings = []; }),
      (error) => error.code === "ROLLBACK_TRANSACTION_OPEN"
        && error.details?.transactionId === transactionId
        && error.details?.phase === "verifying",
    );

    // Reads stay available for status/doctor.
    assert.equal((await store.readState(fixture.root, "feature")).featureId, "feature");

    // Project-wide: a new feature start is also refused while any journal is open.
    await assert.rejects(
      () => store.startFeature(fixture.root, { featureId: "sibling", host: "codex", level: "XS", topology: "local" }),
      (error) => error.code === "ROLLBACK_TRANSACTION_OPEN",
    );

    // The owning rollback transaction's own mutation passes through its id.
    const committed = await store.mutatePrepared(fixture.root, "feature", state.revision, "rollback-executed", async () => ({
      mutate: (draft) => { draft.blockingFindings = []; },
    }), { allowRollbackTransaction: transactionId });
    assert.equal(committed.revision, state.revision + 1);
  } finally { await fixture.dispose(); }
});

test("a completed rollback journal clears the mutation gate", async () => {
  const fixture = await createTinyApp();
  try {
    await store.initProject(fixture.root, strictProjectConfig);
    const state = await store.startFeature(fixture.root, { featureId: "feature", host: "codex", level: "XS", topology: "local" });
    const transactionId = "txn-gate-2";
    await journal.writeRollbackTransaction(fixture.root, "feature", rollbackJournal("feature", {
      transactionId,
      stateRevision: state.revision,
      backupDirectory: `checkpoints/recovery/${transactionId}`,
    }));
    await assert.rejects(
      () => store.mutate(fixture.root, "feature", state.revision, "blocked-op", (draft) => { draft.blockingFindings = []; }),
      (error) => error.code === "ROLLBACK_TRANSACTION_OPEN",
    );

    await journal.writeRollbackTransaction(fixture.root, "feature", rollbackJournal("feature", {
      transactionId,
      stateRevision: state.revision,
      backupDirectory: `checkpoints/recovery/${transactionId}`,
      phase: "committed",
      completedAt: new Date().toISOString(),
    }));

    const after = await store.readState(fixture.root, "feature");
    await assert.doesNotReject(() => store.mutate(fixture.root, "feature", after.revision, "after-done", (draft) => { draft.blockingFindings = []; }));
  } finally { await fixture.dispose(); }
});
