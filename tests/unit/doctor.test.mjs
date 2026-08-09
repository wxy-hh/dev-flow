import assert from "node:assert/strict";
import { copyFile, mkdir, readFile, rm, writeFile } from "node:fs/promises";
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

test("doctor reports host hook health independently of active features", async () => {
  const fixture = await createTinyApp();
  try {
    await store.initProject(fixture.root, strictProjectConfig);
    await store.recordHostHealth(fixture.root, {
      host: "codex", kind: "session-start", eventId: "codex-session", at: new Date().toISOString(),
    });
    const report = await collectDoctorReport(fixture.root, pluginRoot, "5.0.0", ["dev_flow_doctor"]);
    assert.equal(report.hookHealth.find((item) => item.host === "codex").status, "partial");
    assert.equal(report.hookHealth.find((item) => item.host === "codex").capabilities.session.status, "healthy");
    assert.equal(report.hookHealth.find((item) => item.host === "codex").capabilities.prompt.status, "missing");
    assert.equal(report.hookHealth.find((item) => item.host === "claude").status, "missing");
    assert.ok(report.diagnostics.some((item) => item.code === "HOOK_HEALTH_PARTIAL"));
    assert.ok(report.diagnostics.some((item) => item.code === "HOOK_HEALTH_MISSING"));

    await store.recordHostHealth(fixture.root, {
      host: "claude", kind: "session-start", eventId: "claude-old", at: new Date(Date.now() - 16 * 60 * 1000).toISOString(),
    });
    const stale = await collectDoctorReport(fixture.root, pluginRoot, "5.0.0", ["dev_flow_doctor"]);
    assert.equal(stale.hookHealth.find((item) => item.host === "claude").status, "stale");
    assert.ok(stale.diagnostics.some((item) => item.code === "HOOK_HEALTH_STALE"));
  } finally { await fixture.dispose(); }
});

test("doctor does not let a recent SessionStart mask a stale prompt channel", async () => {
  const fixture = await createTinyApp();
  try {
    await store.initProject(fixture.root, strictProjectConfig);
    await store.recordHostHealth(fixture.root, {
      host: "codex", kind: "user-prompt-submit", eventId: "old-prompt", at: new Date(Date.now() - 16 * 60 * 1000).toISOString(),
    });
    await store.recordHostHealth(fixture.root, {
      host: "codex", kind: "session-start", eventId: "fresh-session", at: new Date().toISOString(),
    });
    const report = await collectDoctorReport(fixture.root, pluginRoot, "5.0.0", ["dev_flow_doctor"]);
    const codex = report.hookHealth.find((item) => item.host === "codex");
    assert.equal(codex.status, "partial");
    assert.equal(codex.capabilities.session.status, "healthy");
    assert.equal(codex.capabilities.prompt.status, "stale");
    assert.ok(report.diagnostics.some((item) => item.code === "HOOK_PROMPT_HEALTH_STALE"));
    assert.equal(report.diagnostics.some((item) => item.code === "HOOK_HEALTH_HEALTHY" && /codex/.test(item.message)), false);
  } finally { await fixture.dispose(); }
});

test("critical progression gates fail closed when host hook health is missing or stale", async () => {
  const fixture = await createTinyApp();
  try {
    await store.initProject(fixture.root, strictProjectConfig);
    await assert.rejects(
      () => store.assertHostHealth(fixture.root, "codex", "checkpoint"),
      (error) => error.code === "HOOK_HEALTH_REQUIRED",
    );
    await store.recordHostHealth(fixture.root, {
      host: "codex", kind: "session-start", eventId: "codex-stale", at: new Date(Date.now() - 16 * 60 * 1000).toISOString(),
    });
    await assert.rejects(
      () => store.assertHostHealth(fixture.root, "codex", "checkpoint"),
      (error) => error.code === "HOOK_HEALTH_STALE",
    );
    await store.recordHostHealth(fixture.root, {
      host: "codex", kind: "user-prompt-submit", eventId: "codex-fresh", at: new Date().toISOString(),
    });
    await assert.doesNotReject(() => store.assertHostHealth(fixture.root, "codex", "checkpoint"));
  } finally { await fixture.dispose(); }
});

test("doctor reports schema v3 active features as not ready for schema v4", async () => {
  const fixture = await createTinyApp();
  try {
    await store.initProject(fixture.root, strictProjectConfig);
    const directory = path.join(fixture.root, ".dev-flow", "features", "legacy-v3");
    await mkdir(directory, { recursive: true });
    await writeFile(path.join(directory, "state.json"), JSON.stringify({ schemaVersion: 3, lifecycle: "active" }));
    const report = await collectDoctorReport(fixture.root, pluginRoot, "5.0.0", ["dev_flow_doctor"]);
    assert.equal(report.v4Ready, false);
    assert.deepEqual(report.legacyFeatures, ["legacy-v3"]);
    assert.equal(report.diagnostics.some((item) => item.code === "V4_NOT_READY"), true);
    assert.equal("v3Ready" in report, false);
  } finally { await fixture.dispose(); }
});

test("doctor fails closed for a missing or corrupt current Trace pointer and only warns for orphan snapshots", async () => {
  const fixture = await createTinyApp();
  try {
    await store.initProject(fixture.root, strictProjectConfig);
    const state = await store.startFeature(fixture.root, {
      featureId: "feature", host: "claude", level: "M", topology: "shared-contract", requirements: "provided-confirmed",
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

test("doctor distinguishes an untraced local M from a traced shared-contract M", async () => {
  const local = await createTinyApp();
  const shared = await createTinyApp();
  try {
    await store.initProject(local.root, strictProjectConfig);
    await store.startFeature(local.root, { featureId: "local", host: "codex", level: "M", topology: "local" });
    const localReport = await collectDoctorReport(local.root, pluginRoot, "1.0.0", ["dev_flow_doctor"]);
    assert.ok(localReport.diagnostics.some((item) => item.code === "TRACE_NOT_REQUIRED" && item.status === "ok"));

    await store.initProject(shared.root, strictProjectConfig);
    await store.startFeature(shared.root, {
      featureId: "shared", host: "codex", level: "M", topology: "shared-contract", requirements: "provided-confirmed",
    });
    const sharedReport = await collectDoctorReport(shared.root, pluginRoot, "1.0.0", ["dev_flow_doctor"]);
    assert.ok(sharedReport.diagnostics.some((item) => item.code === "TRACE_POINTER_VALID" && item.status === "ok"));
  } finally {
    await local.dispose();
    await shared.dispose();
  }
});

test("doctor validates an enforced review pointer and preserves orphan snapshots as diagnostics", async () => {
  const fixture = await createTinyApp();
  try {
    await store.initProject(fixture.root, strictProjectConfig);
    let state = await store.startFeature(fixture.root, {
      featureId: "review", host: "codex", level: "M", topology: "shared-contract", requirements: "provided-confirmed",
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
