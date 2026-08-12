import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import { loadSource } from "../helpers/load-source.mjs";
import { driveUntil, routeFlowConfig } from "../helpers/route-flow.mjs";
import { traceDeltaFor } from "../helpers/trace-fixtures.mjs";

const store = await loadSource("plugins/dev-flow/src/core/state-store.ts");
const artifacts = await loadSource("plugins/dev-flow/src/core/artifacts.ts");
const units = await loadSource("plugins/dev-flow/src/core/implementation-units.ts");
const checkpoints = await loadSource("plugins/dev-flow/src/core/checkpoints.ts");
const traceStore = await loadSource("plugins/dev-flow/src/core/traceability-store.ts");

const run = promisify(execFile);

const routeInput = { level: "L", topology: "multi-chain", requirements: "provided-confirmed" };

/**
 * 死锁出口回归（H1）：active unit + 验证配置变更后，abandon 单元 → 重登记计划 →
 * 重新走 implementation → begin → checkpoint，恢复序列必须完整可行。
 */
test("abandoning the active unit unblocks the config-change deadlock", { timeout: 120_000 }, async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "dev-flow-abandon-"));
  try {
    await run("git", ["init", "--quiet"], { cwd: root });
    await run("git", ["-c", "user.name=Dev Flow Tests", "-c", "user.email=tests@example.invalid", "commit", "--allow-empty", "--quiet", "-m", "baseline"], { cwd: root });
    await mkdir(path.join(root, "src"), { recursive: true });
    await mkdir(path.join(root, "test"), { recursive: true });
    await writeFile(path.join(root, "src", "main.js"), "export {}\n");
    // checkpoint 的 forward verification 会真实运行 node --test，提供可用的测试文件
    await writeFile(path.join(root, "test", "smoke.test.js"), "const { test } = require('node:test');\ntest('smoke passes', () => {});\n");
    await run("git", ["add", "."], { cwd: root });
    await run("git", ["-c", "user.name=Dev Flow Tests", "-c", "user.email=tests@example.invalid", "commit", "--quiet", "-m", "seed protected roots"], { cwd: root });
    await store.initProject(root, routeFlowConfig);
    await store.recordHostHealth(root, { host: "claude", kind: "session-start", eventId: "abandon-health" });

    let state = await store.startFeature(root, { featureId: "abandon", objective: "恢复序列", host: "claude", ...routeInput });
    const featureId = state.featureId;
    assert.equal(state.classification.controls.checkpoints, "unit-chain");

    const driven = await driveUntil(root, featureId, state, {
      input: routeInput,
      stopAt: (action) => action.kind === "begin-implementation-unit",
    });
    state = driven.state;
    const unitId = driven.action.unitId;

    // 到达死锁状态：begin → 配置变更 → 需求重登记（步骤重开、trace stale）
    state = await units.beginImplementationUnit(root, featureId, state.revision, unitId);
    await store.recordTrustedWriteIntent(root, ["src/main.js"], "claude", "abandon-write");
    await writeFile(path.join(root, "src", "main.js"), "export const m = 1;\n");
    await store.recordTrustedWriteOwnership(root, ["src/main.js"], "claude", "abandon-write");
    state = await store.readState(root, featureId);
    const raw = await readFile(path.join(root, ".dev-flow", "project.json"));
    const config = JSON.parse(raw);
    config.verification.commands[0].args = [...config.verification.commands[0].args, "--test-concurrency=1"];
    await store.updateProjectConfig(root, config, createHash("sha256").update(raw).digest("hex"));
    await assert.rejects(
      () => checkpoints.checkpointImplementationUnit(root, featureId, state.revision, unitId),
      (error) => error.code === "TRACE_SLICE_STALE",
    );
    const requirementsPath = path.join(root, ".dev-flow", "features", featureId, state.artifacts.requirements.path);
    const requirementsDoc = await readFile(requirementsPath, "utf8");
    await writeFile(requirementsPath, `${requirementsDoc}\n补充：死锁复现编辑。\n`);
    state = (await artifacts.recordArtifactWithTrace(root, featureId, state.revision, "requirements", traceDeltaFor("requirements", "l"))).state;
    await assert.rejects(
      () => checkpoints.checkpointImplementationUnit(root, featureId, state.revision, unitId),
      (error) => error.code === "STEP_OUT_OF_ORDER",
    );

    // H1 恢复路径 1：取消 active unit（工作区改动保留）
    state = await units.abandonImplementationUnit(root, featureId, state.revision, unitId, "验证命令变更后取消单元并重来", "claude");
    assert.equal(state.implementationUnits.find((unit) => unit.unitId === unitId).status, "pending");

    // H1 恢复路径 2：计划重登记不再被 quiescent 挡，trace 恢复 current 且命令哈希刷新
    state = (await artifacts.recordArtifactWithTrace(root, featureId, state.revision, "implementation-plan", traceDeltaFor("implementation-plan", "l"))).state;
    let ledger = await traceStore.readTraceability(root, state);
    assert.equal(ledger.nodes["UNIT-001"].status, "current");
    assert.equal(ledger.nodes["TASK-001"].status, "current");
    assert.equal(ledger.nodes["TEST-001"].status, "current");

    // H1 恢复路径 3：重新走 implementation 并 begin + checkpoint（新配置下验证通过）
    const redriven = await driveUntil(root, featureId, state, {
      input: routeInput,
      stopAt: (action) => action.kind === "begin-implementation-unit",
    });
    state = redriven.state;
    assert.equal(redriven.action.kind, "begin-implementation-unit");
    state = await units.beginImplementationUnit(root, featureId, state.revision, unitId);
    await store.recordTrustedWriteIntent(root, ["src/main.js"], "claude", "abandon-write-2");
    await writeFile(path.join(root, "src", "main.js"), "export const m = 2;\n");
    await store.recordTrustedWriteOwnership(root, ["src/main.js"], "claude", "abandon-write-2");
    state = await store.readState(root, featureId);
    const result = await checkpoints.checkpointImplementationUnit(root, featureId, state.revision, unitId);
    state = result.state;
    assert.equal(state.implementationUnits.find((unit) => unit.unitId === unitId).status, "checkpointed");
    assert.equal(result.manifest.unitId, unitId);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
