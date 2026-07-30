import assert from "node:assert/strict";
import { copyFile, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { createTinyApp, strictProjectConfig } from "../helpers/fixture-repo.mjs";
import { loadSource } from "../helpers/load-source.mjs";

const store = await loadSource("plugins/dev-flow/src/core/state-store.ts");
const reviewStore = await loadSource("plugins/dev-flow/src/core/review-store.ts");
const { collectDoctorReport } = await loadSource("plugins/dev-flow/src/mcp/doctor.ts");
const pluginRoot = path.resolve("plugins/dev-flow");

test("doctor reports project, active state, bundles and wiring without mutating state", async () => {
  const fixture = await createTinyApp();
  try {
    await store.initProject(fixture.root, strictProjectConfig);
    await store.startFeature(fixture.root, { featureId: "feature", host: "claude", level: "XS", topology: "local" });
    const report = await collectDoctorReport(fixture.root, pluginRoot, "1.0.0", ["dev_flow_doctor"]);
    assert.equal(report.project.valid, true);
    assert.deepEqual(report.activeFeature, { present: true, featureId: "feature", valid: true });
    assert.equal(report.mcp.server, "running");
    assert.ok(report.diagnostics.some((item) => item.code === "PLUGIN_WIRING_VALID" && item.status === "ok"));
  } finally { await fixture.dispose(); }
});

test("doctor fails closed for a missing or corrupt current Trace pointer and only warns for orphan snapshots", async () => {
  const fixture = await createTinyApp();
  try {
    await store.initProject(fixture.root, strictProjectConfig);
    const state = await store.startFeature(fixture.root, {
      featureId: "feature", host: "claude", level: "M", topology: "local", execution: "standard", requirements: "provided-confirmed",
    });
    const stateFile = path.join(fixture.root, ".dev-flow", "features", "feature", "state.json");
    const before = await readFile(stateFile, "utf8");
    const snapshot = path.join(fixture.root, ".dev-flow", "features", "feature", state.traceability.path);
    const snapshotContents = await readFile(snapshot, "utf8");

    await rm(snapshot);
    let report = await collectDoctorReport(fixture.root, pluginRoot, "1.0.0", ["dev_flow_doctor"]);
    assert.ok(report.diagnostics.some((item) => item.code === "TRACE_POINTER_INVALID" && item.status === "error"));
    assert.equal(await readFile(stateFile, "utf8"), before);

    await writeFile(snapshot, "not a Trace snapshot\n");
    report = await collectDoctorReport(fixture.root, pluginRoot, "1.0.0", ["dev_flow_doctor"]);
    assert.ok(report.diagnostics.some((item) => item.code === "TRACE_POINTER_INVALID" && item.status === "error"));

    await writeFile(snapshot, snapshotContents);
    const orphan = path.join(path.dirname(snapshot), `${"b".repeat(64)}.json`);
    await copyFile(snapshot, orphan);
    report = await collectDoctorReport(fixture.root, pluginRoot, "1.0.0", ["dev_flow_doctor"]);
    assert.ok(report.diagnostics.some((item) => item.code === "TRACE_ORPHAN_SNAPSHOTS" && item.status === "warning"));
    assert.equal(await readFile(stateFile, "utf8"), before);
  } finally { await fixture.dispose(); }
});

test("doctor distinguishes legacy, light, and valid trace-enforced standard features", async () => {
  const legacy = await createTinyApp();
  const light = await createTinyApp();
  const standard = await createTinyApp();
  try {
    await store.initProject(legacy.root, strictProjectConfig);
    let legacyState = await store.startFeature(legacy.root, {
      featureId: "legacy", host: "codex", level: "M", topology: "local", execution: "standard", requirements: "provided-confirmed",
    });
    legacyState = await store.mutate(legacy.root, "legacy", legacyState.revision, "legacy-fixture", (draft) => {
      delete draft.workflowCapabilities;
      delete draft.traceability;
    });
    const legacyReport = await collectDoctorReport(legacy.root, pluginRoot, "1.0.0", ["dev_flow_doctor"]);
    assert.ok(legacyReport.diagnostics.some((item) => item.code === "TRACE_LEGACY_FEATURE" && item.status === "ok"));

    await store.initProject(light.root, strictProjectConfig);
    await store.startFeature(light.root, { featureId: "light", host: "codex", level: "M", topology: "local", execution: "light" });
    const lightReport = await collectDoctorReport(light.root, pluginRoot, "1.0.0", ["dev_flow_doctor"]);
    assert.ok(lightReport.diagnostics.some((item) => item.code === "TRACE_NOT_REQUIRED" && item.status === "ok"));

    await store.initProject(standard.root, strictProjectConfig);
    await store.startFeature(standard.root, {
      featureId: "standard", host: "codex", level: "M", topology: "local", execution: "standard", requirements: "provided-confirmed",
    });
    const standardReport = await collectDoctorReport(standard.root, pluginRoot, "1.0.0", ["dev_flow_doctor"]);
    assert.ok(standardReport.diagnostics.some((item) => item.code === "TRACE_POINTER_VALID" && item.status === "ok"));
  } finally {
    await legacy.dispose();
    await light.dispose();
    await standard.dispose();
  }
});

test("doctor validates an enforced review pointer and preserves orphan snapshots as diagnostics", async () => {
  const fixture = await createTinyApp();
  try {
    await store.initProject(fixture.root, strictProjectConfig);
    let state = await store.startFeature(fixture.root, {
      featureId: "review", host: "codex", level: "M", topology: "local", execution: "standard", requirements: "provided-confirmed",
    });
    const pointer = await reviewStore.writeReviewSnapshot(fixture.root, reviewStore.emptyReviewLedger("review", state.revision + 1));
    state = await store.mutate(fixture.root, "review", state.revision, "review-pointer-fixture", (draft) => {
      draft.workflowCapabilities = { trace: 1, review: 1, checkpoints: 0, rollbackExecution: 0 };
      draft.review = pointer;
    });
    let report = await collectDoctorReport(fixture.root, pluginRoot, "1.0.0", ["dev_flow_doctor"]);
    assert.ok(report.diagnostics.some((item) => item.code === "REVIEW_POINTER_VALID" && item.status === "ok"));
    const snapshot = path.join(fixture.root, ".dev-flow", "features", "review", state.review.path);
    await rm(snapshot);
    report = await collectDoctorReport(fixture.root, pluginRoot, "1.0.0", ["dev_flow_doctor"]);
    assert.ok(report.diagnostics.some((item) => item.code === "REVIEW_POINTER_INVALID" && item.status === "error"));
  } finally { await fixture.dispose(); }
});

const rollbackJournal = (featureId, overrides = {}) => ({
  schemaVersion: 1,
  transactionId: "txn-doctor-1",
  featureId,
  phase: "verifying",
  targetCheckpointId: "CP-001",
  targetUnitId: "RU-001",
  undoOrder: ["RU-002", "RU-001"],
  previewBasisHash: "a".repeat(64),
  stateRevision: 3,
  backupDirectory: "checkpoints/recovery/txn-doctor-1",
  nextFileIndex: 2,
  filePlan: [],
  verificationAttemptIds: ["attempt-v1"],
  projectConfigSha256: "b".repeat(64),
  startedAt: new Date().toISOString(),
  ...overrides,
});

test("doctor reports an open rollback transaction with its resume input", async () => {
  const fixture = await createTinyApp();
  try {
    await store.initProject(fixture.root, strictProjectConfig);
    await store.startFeature(fixture.root, { featureId: "feature", host: "codex", level: "XS", topology: "local" });
    let report = await collectDoctorReport(fixture.root, pluginRoot, "1.0.0", ["dev_flow_doctor"]);
    assert.deepEqual(report.rollbackTransactions, []);
    assert.ok(!report.diagnostics.some((item) => item.code.startsWith("ROLLBACK_")));

    await store.writeRollbackTransaction(fixture.root, "feature", rollbackJournal("feature"));
    report = await collectDoctorReport(fixture.root, pluginRoot, "1.0.0", ["dev_flow_doctor"]);
    const diagnostic = report.diagnostics.find((item) => item.code === "ROLLBACK_TRANSACTION_OPEN");
    assert.equal(diagnostic?.status, "error");
    assert.match(diagnostic?.recoveryHint ?? "", /CP-001/);
    assert.equal(report.rollbackTransactions.length, 1);
    const entry = report.rollbackTransactions[0];
    assert.equal(entry.featureId, "feature");
    assert.equal(entry.phase, "verifying");
    assert.equal(entry.blocked, false);
    assert.deepEqual(entry.undoOrder, ["RU-002", "RU-001"]);
  } finally { await fixture.dispose(); }
});

test("doctor reports a blocked rollback recovery with both attempt id groups", async () => {
  const fixture = await createTinyApp();
  try {
    await store.initProject(fixture.root, strictProjectConfig);
    const state = await store.startFeature(fixture.root, { featureId: "feature", host: "codex", level: "XS", topology: "local" });
    await store.writeRollbackTransaction(fixture.root, "feature", rollbackJournal("feature", {
      phase: "compensating",
      error: "rollback backup bytes failed their digest check",
      verificationAttemptIds: ["attempt-v1", "attempt-c1"],
    }));
    await store.appendFeatureEvent(fixture.root, "feature", state.revision, "rollback-verification-attempt", {
      attemptId: "attempt-v1", transactionId: "txn-doctor-1", status: "failed",
    });
    await store.appendFeatureEvent(fixture.root, "feature", state.revision, "rollback-compensation-attempt", {
      attemptId: "attempt-c1", transactionId: "txn-doctor-1", status: "failed", reason: "backup-corrupt",
    });
    // An attempt from another transaction never leaks into this one's groups.
    await store.appendFeatureEvent(fixture.root, "feature", state.revision, "rollback-verification-attempt", {
      attemptId: "attempt-old", transactionId: "txn-other", status: "passed",
    });

    const report = await collectDoctorReport(fixture.root, pluginRoot, "1.0.0", ["dev_flow_doctor"]);
    const diagnostic = report.diagnostics.find((item) => item.code === "ROLLBACK_RECOVERY_BLOCKED");
    assert.equal(diagnostic?.status, "error");
    assert.match(diagnostic?.message ?? "", /digest check/);
    assert.equal(report.rollbackTransactions.length, 1);
    const entry = report.rollbackTransactions[0];
    assert.equal(entry.blocked, true);
    assert.equal(entry.error, "rollback backup bytes failed their digest check");
    assert.deepEqual(entry.verificationAttemptIds, ["attempt-v1"]);
    assert.deepEqual(entry.compensationAttemptIds, ["attempt-c1"]);
  } finally { await fixture.dispose(); }
});

test("doctor reports a completed rollback transaction as audit and an unreadable journal as an error", async () => {
  const fixture = await createTinyApp();
  try {
    await store.initProject(fixture.root, strictProjectConfig);
    await store.startFeature(fixture.root, { featureId: "feature", host: "codex", level: "XS", topology: "local" });
    await store.writeRollbackTransaction(fixture.root, "feature", rollbackJournal("feature", {
      phase: "committed",
      completedAt: new Date().toISOString(),
    }));
    let report = await collectDoctorReport(fixture.root, pluginRoot, "1.0.0", ["dev_flow_doctor"]);
    assert.ok(report.diagnostics.some((item) => item.code === "ROLLBACK_TRANSACTION_COMPLETED" && item.status === "ok"));
    assert.equal(report.rollbackTransactions[0].blocked, false);

    await writeFile(path.join(fixture.root, ".dev-flow", "features", "feature", "rollback-transaction.json"), "not json");
    report = await collectDoctorReport(fixture.root, pluginRoot, "1.0.0", ["dev_flow_doctor"]);
    assert.ok(report.diagnostics.some((item) => item.code === "ROLLBACK_TRANSACTION_UNREADABLE" && item.status === "error"));
    assert.deepEqual(report.rollbackTransactions, [], "an unreadable journal is only a diagnostic, never a parsed entry");
  } finally { await fixture.dispose(); }
});
