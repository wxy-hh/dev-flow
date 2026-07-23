import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile, access } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import test from "node:test";
import { loadSource } from "../helpers/load-source.mjs";

const store = await loadSource("plugins/dev-flow/src/core/state-store.ts");
const doctor = await loadSource("plugins/dev-flow/src/mcp/doctor.ts");
const config = {
  schemaVersion: 1,
  verification: { commands: [{ id: "unit", command: "node", args: ["-e", "process.exit(0)"], cwd: "." }], behaviorCommands: [] },
  enforcement: { mode: "strict", gitWriteRequiresLogicComplete: true, oneActiveFeature: true, requireExplicitHumanReply: true },
  protectedRoots: ["src"],
};

test("invalid scope does not create active feature or state", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "dev-flow-scope-"));
  try {
    await store.initProject(root, config);
    await assert.rejects(
      () => store.startFeature(root, { featureId: "bad", host: "claude", level: "XS", topology: "local", scope: { note: "x" } }),
      (error) => error.code === "INVALID_START_INPUT",
    );
    await assert.rejects(() => readFile(path.join(root, ".dev-flow", "active.json")));
    await assert.rejects(() => access(path.join(root, ".dev-flow", "features", "bad")));
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("doctor reports corrupt active feature digest and recovery abandons safely", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "dev-flow-recover-"));
  try {
    await store.initProject(root, config);
    await store.startFeature(root, { featureId: "c", host: "claude", level: "XS", topology: "local" });
    const stateFile = path.join(root, ".dev-flow", "features", "c", "state.json");
    const corrupt = "{broken";
    await writeFile(stateFile, corrupt);
    const digest = createHash("sha256").update(corrupt).digest("hex");
    const report = await doctor.collectDoctorReport(root, root, "test", ["dev_flow_doctor"]);
    assert.equal(report.corruptFeature?.featureId, "c");
    assert.equal(report.corruptFeature?.stateSha256, digest);

    await assert.rejects(
      () => store.recoverCorruptFeature(root, {
        featureId: "c", stateSha256: "wrong", action: "abandon", reason: "r", userEvidence: "user ok", host: "claude",
      }),
      (error) => error.code === "RECOVERY_DIGEST_MISMATCH",
    );

    const result = await store.recoverCorruptFeature(root, {
      featureId: "c", stateSha256: digest, action: "abandon", reason: "corrupt", userEvidence: "please abandon and reopen", host: "claude",
    });
    assert.ok(result.recoveredTo.includes(`${path.sep}recovered${path.sep}`));
    await assert.rejects(() => readFile(path.join(root, ".dev-flow", "active.json")));
    const next = await store.startFeature(root, { featureId: "n", host: "claude", level: "XS", topology: "local" });
    assert.equal(next.featureId, "n");
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("recovery rejects valid state and missing evidence", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "dev-flow-recover-valid-"));
  try {
    await store.initProject(root, config);
    await store.startFeature(root, { featureId: "v", host: "claude", level: "XS", topology: "local" });
    const digest = await store.stateFileSha256(root, "v");
    await assert.rejects(
      () => store.recoverCorruptFeature(root, {
        featureId: "v", stateSha256: digest, action: "abandon", reason: "r", userEvidence: "e", host: "claude",
      }),
      (error) => error.code === "RECOVERY_STATE_VALID",
    );
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("open recovery journal resumes safely and blocks new starts", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "dev-flow-recover-resume-"));
  try {
    await store.initProject(root, config);
    await store.startFeature(root, { featureId: "r", host: "claude", level: "XS", topology: "local" });
    const stateFile = path.join(root, ".dev-flow", "features", "r", "state.json");
    await writeFile(stateFile, "{broken");
    const digest = createHash("sha256").update("{broken").digest("hex");
    const recoveredTo = path.join(root, ".dev-flow", "recovered", "r-resume");
    await (await import("node:fs/promises")).mkdir(path.dirname(recoveredTo), { recursive: true });
    await writeFile(path.join(root, ".dev-flow", "recovery-transaction.json"), JSON.stringify({
      schemaVersion: 1, transactionId: "resume-test", phase: "prepared", featureId: "r", stateSha256: digest, recoveredTo,
      reason: "corrupt", userEvidence: "abandon it", host: "claude", at: new Date().toISOString(),
    }));
    await assert.rejects(
      () => store.startFeature(root, { featureId: "blocked", host: "claude", level: "XS", topology: "local" }),
      (error) => error.code === "RECOVERY_TRANSACTION_OPEN",
    );
    const result = await store.recoverCorruptFeature(root, {
      featureId: "r", stateSha256: digest, action: "abandon", reason: "corrupt", userEvidence: "abandon it", host: "claude",
    });
    assert.equal(result.recoveredTo, recoveredTo);
    await access(path.join(recoveredTo, "state.json"));
    await assert.rejects(() => readFile(path.join(root, ".dev-flow", "active.json")));
    assert.equal(await store.readRecoveryTransaction(root), undefined);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("corrupt active pointer requires digest and backs up only the user-selected feature", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "dev-flow-pointer-recover-"));
  try {
    await store.initProject(root, config);
    await store.startFeature(root, { featureId: "p", host: "claude", level: "XS", topology: "local" });
    const active = path.join(root, ".dev-flow", "active.json");
    const corruptPointer = "{broken-pointer";
    await writeFile(active, corruptPointer);
    const activeSha256 = createHash("sha256").update(corruptPointer).digest("hex");
    const stateSha256 = await store.stateFileSha256(root, "p");
    const report = await doctor.collectDoctorReport(root, root, "test", ["dev_flow_doctor"]);
    assert.equal(report.corruptActivePointer?.activeSha256, activeSha256);
    assert.ok(report.corruptActivePointer?.candidates.some((candidate) => candidate.featureId === "p"));
    const result = await store.recoverCorruptFeature(root, {
      featureId: "p", stateSha256, activeSha256, action: "abandon", reason: "pointer corrupt", userEvidence: "abandon p", host: "claude",
    });
    await access(path.join(result.recoveredTo, "active.json"));
    await assert.rejects(() => readFile(active));
  } finally { await rm(root, { recursive: true, force: true }); }
});
