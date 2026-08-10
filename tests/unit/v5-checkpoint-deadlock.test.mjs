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

// multi-chain 拓扑的最小级别是 L；L 级同样启用 unit-chain checkpoint 与 Trace。
const routeInput = { level: "L", topology: "multi-chain", requirements: "provided-confirmed" };

/**
 * 死锁复现（vitejs 事故场景）：
 * 1. active implementation unit 期间修改验证命令定义 → verificationCommandHashes 失配
 * 2. checkpoint 被 TRACE_SLICE_STALE 挡（单元无法正常结束）
 * 3. 计划重登记（trace 重绑定的唯一途径）被 PLAN_REVISION_REQUIRES_QUIESCENT_UNIT 挡
 * 4. 需求重登记会刷新命令哈希，但把 TASK/TEST/RU 节点打 stale（局部修复反而恶化）
 * 5. 此后 checkpoint 报 IMPLEMENTATION_UNIT_UNKNOWN、begin 新单元被 trace gate 挡
 * 6. 单元保持 active、trace 保持 stale：无受支持的恢复出口
 */
test("config change during an active unit leaves no supported recovery path", { timeout: 120_000 }, async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "dev-flow-deadlock-"));
  try {
    await run("git", ["init", "--quiet"], { cwd: root });
    await run("git", ["-c", "user.name=Dev Flow Tests", "-c", "user.email=tests@example.invalid", "commit", "--allow-empty", "--quiet", "-m", "baseline"], { cwd: root });
    await mkdir(path.join(root, "src"), { recursive: true });
    await writeFile(path.join(root, "src", "main.js"), "export {}\n");
    await run("git", ["add", "."], { cwd: root });
    await run("git", ["-c", "user.name=Dev Flow Tests", "-c", "user.email=tests@example.invalid", "commit", "--quiet", "-m", "seed protected roots"], { cwd: root });
    await store.initProject(root, routeFlowConfig);
    await store.recordHostHealth(root, { host: "claude", kind: "session-start", eventId: "deadlock-health" });

    let state = await store.startFeature(root, { featureId: "deadlock", objective: "死锁复现", host: "claude", ...routeInput });
    const featureId = state.featureId;
    assert.equal(state.route, "l");
    assert.equal(state.classification.controls.checkpoints, "unit-chain");

    const driven = await driveUntil(root, featureId, state, {
      input: routeInput,
      stopAt: (action) => action.kind === "begin-implementation-unit",
    });
    state = driven.state;
    assert.equal(driven.action.kind, "begin-implementation-unit");
    const unitId = driven.action.unitId;

    state = await units.beginImplementationUnit(root, featureId, state.revision, unitId);
    assert.equal(state.implementationUnits.find((unit) => unit.unitId === unitId).status, "active");

    // 实现单元期间的正常改动（经 trusted write 记录所有权；写入会推进 revision）
    await store.recordTrustedWriteIntent(root, ["src/main.js"], "claude", `deadlock-write-${state.revision}`);
    await writeFile(path.join(root, "src", "main.js"), "export const m = 1;\n");
    await store.recordTrustedWriteOwnership(root, ["src/main.js"], "claude", `deadlock-write-${state.revision}`);
    state = await store.readState(root, featureId);

    // 修改验证命令定义（vitejs 事故：vitest 不可调用，把 unit 命令改为 npx vitest run）
    const raw = await readFile(path.join(root, ".dev-flow", "project.json"));
    const config = JSON.parse(raw);
    config.verification.commands[0].args = [...config.verification.commands[0].args, "--test-concurrency=1"];
    await store.updateProjectConfig(root, config, createHash("sha256").update(raw).digest("hex"));

    // 症状 1：checkpoint 被命令哈希失配挡死，单元无法正常结束
    await assert.rejects(
      () => checkpoints.checkpointImplementationUnit(root, featureId, state.revision, unitId),
      (error) => error.code === "TRACE_SLICE_STALE",
    );

    // 症状 2：计划重登记（刷新 trace 基线的受支持途径）被 active unit 挡死
    await assert.rejects(
      () => artifacts.recordArtifactWithTrace(root, featureId, state.revision, "implementation-plan", traceDeltaFor("implementation-plan", "l")),
      (error) => error.code === "PLAN_REVISION_REQUIRES_QUIESCENT_UNIT",
    );

    // 症状 3：重登记需求（编辑文档）成功并刷新命令哈希，但把 TASK/TEST/RU 节点打 stale，
    // 并把 implementation 及后续步骤重开（artifact 失效语义）
    const requirementsPath = path.join(root, ".dev-flow", "features", featureId, state.artifacts.requirements.path);
    const requirementsDoc = await readFile(requirementsPath, "utf8");
    await writeFile(requirementsPath, `${requirementsDoc}\n补充：死锁复现编辑。\n`);
    state = (await artifacts.recordArtifactWithTrace(root, featureId, state.revision, "requirements", traceDeltaFor("requirements", "l"))).state;
    let ledger = await traceStore.readTraceability(root, state);
    assert.equal(ledger.nodes["RU-001"].status, "stale");
    assert.equal(ledger.nodes["TASK-001"].status, "stale");
    assert.equal(ledger.nodes["TEST-001"].status, "stale");
    assert.equal(state.steps.implementation, undefined, "requirements re-registration reopens implementation");

    // 症状 4：checkpoint 依然无法结束单元（implementation 步骤已被重开）
    await assert.rejects(
      () => checkpoints.checkpointImplementationUnit(root, featureId, state.revision, unitId),
      (error) => error.code === "STEP_OUT_OF_ORDER",
    );

    // 症状 5：计划重登记（恢复 RU 节点 current 的唯一途径）依旧被 active unit 挡死
    await assert.rejects(
      () => artifacts.recordArtifactWithTrace(root, featureId, state.revision, "implementation-plan", traceDeltaFor("implementation-plan", "l")),
      (error) => error.code === "PLAN_REVISION_REQUIRES_QUIESCENT_UNIT",
    );

    // 症状 6：重新 begin 也被步骤顺序挡死
    await assert.rejects(
      () => units.beginImplementationUnit(root, featureId, state.revision, unitId),
      (error) => error.code === "STEP_OUT_OF_ORDER",
    );

    // 死锁终态：单元仍 active、trace 仍 stale、无任何受支持出口
    state = await store.readState(root, featureId);
    assert.equal(state.implementationUnits.find((unit) => unit.unitId === unitId).status, "active");
    ledger = await traceStore.readTraceability(root, state);
    assert.equal(ledger.nodes["RU-001"].status, "stale");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
