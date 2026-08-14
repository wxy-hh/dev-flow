import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import { loadSource } from "../helpers/load-source.mjs";
import { driveUntil, routeFlowConfig } from "../helpers/route-flow.mjs";

const state = await loadSource("plugins/dev-flow/src/core/state-store.ts");
const gate = await loadSource("plugins/dev-flow/src/core/write-gate.ts");
const artifacts = await loadSource("plugins/dev-flow/src/core/artifacts.ts");

const run = promisify(execFile);

const config = {
  schemaVersion: 2,
  verification: { commands: [{ id: "unit", command: process.execPath, args: ["-e", "process.exit(0)"], cwd: ".", provides: ["targeted", "behavior", "integration", "full"] }] },
  enforcement: { mode: "strict", gitWriteRequiresLogicComplete: true, oneActiveFeature: true, requireExplicitHumanReply: true },
  governedRoots: ["src"],
};

const routeInput = { level: "L", topology: "multi-chain", requirements: "provided-confirmed" };

async function initRepo(root, seedDirty) {
  await run("git", ["init", "--quiet"], { cwd: root });
  await run("git", ["-c", "user.name=Dev Flow Tests", "-c", "user.email=tests@example.invalid", "commit", "--allow-empty", "--quiet", "-m", "baseline"], { cwd: root });
  await mkdir(path.join(root, "src"), { recursive: true });
  if (seedDirty) await writeFile(path.join(root, "src", "pre-existing.js"), "export const old = 1;\n");
  await writeFile(path.join(root, "src", "main.js"), "export {}\n");
  await run("git", ["add", "."], { cwd: root });
  await run("git", ["-c", "user.name=Dev Flow Tests", "-c", "user.email=tests@example.invalid", "commit", "--quiet", "-m", "seed"], { cwd: root });
  if (seedDirty) await writeFile(path.join(root, "src", "pre-existing.js"), "export const old = 2;\n");
}

async function startIntake(featureId) {
  const root = await mkdtemp(path.join(os.tmpdir(), `dev-flow-gate-intake-${featureId}-`));
  await mkdir(path.join(root, "src"), { recursive: true });
  await state.initProject(root, config);
  await state.startFeature(root, { featureId, objective: "验证门禁", scope: { inScope: ["src/feature.txt"], outOfScope: [] }, host: "codex" });
  return root;
}

/** L 路线驱动到 implementation 步骤、批准已确认、尚无 active unit。 */
async function startImplementation(featureId, seedDirty = false) {
  const root = await mkdtemp(path.join(os.tmpdir(), `dev-flow-gate-impl-${featureId}-`));
  await initRepo(root, seedDirty);
  await state.initProject(root, routeFlowConfig);
  let current = await state.startFeature(root, { featureId, objective: "验证实现写", scope: { inScope: ["src/main.js"], outOfScope: [] }, ...routeInput, host: "codex" });
  const driven = await driveUntil(root, featureId, current, {
    input: routeInput,
    stopAt: (action) => action.kind === "begin-implementation-unit",
  });
  current = await state.readState(root, featureId);
  assert.equal((current.implementationUnits ?? []).some((unit) => unit.status === "active"), false, "fixture must start with no active unit");
  return root;
}

function activeUnits(rootState) {
  return (rootState.implementationUnits ?? []).filter((unit) => unit.status === "active");
}

test("intake 写 governed 文件拦为实现批准", async () => {
  const root = await startIntake("governed");
  try {
    const verdict = await gate.writeGate(root, { kind: "file", paths: ["src/feature.txt"] });
    assert.equal(verdict.decision, "block");
    if (verdict.decision !== "block") return;
    assert.equal(verdict.block.code, "IMPLEMENTATION_APPROVAL_REQUIRED");
    assert.equal(verdict.block.detail?.variant, "intake");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("intake 写非 governed 普通文件允许", async () => {
  const root = await startIntake("docs");
  try {
    const verdict = await gate.writeGate(root, { kind: "file", paths: ["docs/notes.md"] });
    assert.equal(verdict.decision, "allow");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("没有 active feature 时控制区文件仍被拦，普通文件允许", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "dev-flow-gate-noactive-"));
  try {
    await mkdir(path.join(root, "src"), { recursive: true });
    await state.initProject(root, config);
    const control = await gate.writeGate(root, { kind: "file", paths: [".dev-flow/active.json"] });
    assert.equal(control.decision, "block");
    if (control.decision !== "block") return;
    assert.equal(control.block.code, "CONTROL_MUTATION_FORBIDDEN");
    assert.equal((await gate.writeGate(root, { kind: "file", paths: ["src/notes.js"] })).decision, "allow");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("未登记 feature 资产被拦，登记后允许", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "dev-flow-gate-artifact-"));
  try {
    await mkdir(path.join(root, "src"), { recursive: true });
    await state.initProject(root, config);
    let current = await state.startFeature(root, {
      featureId: "artifact",
      objective: "验证资产门禁",
      level: "M",
      topology: "local",
      execution: "standard",
      requirements: "provided-confirmed",
      host: "codex",
    });
    const target = ".dev-flow/features/artifact/需求文档.md";
    const unregistered = await gate.writeGate(root, { kind: "file", paths: [target] });
    assert.equal(unregistered.decision, "block");
    if (unregistered.decision !== "block") return;
    assert.equal(unregistered.block.code, "ARTIFACT_NOT_REGISTERED");
    current = await artifacts.scaffoldArtifact(root, "artifact", current.revision, "requirements");
    assert.equal((await gate.writeGate(root, { kind: "file", paths: [target] })).decision, "allow");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("intake 状态 Git 写仍是未满足阶段门禁", async () => {
  const root = await startIntake("git-intake");
  try {
    const verdict = await gate.writeGate(root, { kind: "git", paths: ["src/feature.txt"] });
    assert.equal(verdict.decision, "block");
    if (verdict.decision !== "block") return;
    assert.equal(verdict.block.code, "GIT_GUARD");
    assert.equal(verdict.block.detail?.variant, "not-eligible");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("批准增强信息的事件账本损坏时保持 unreadable，不 fail-open protected 写入", async () => {
  const root = await startIntake("corrupt-events");
  try {
    await writeFile(path.join(root, ".dev-flow", "features", "corrupt-events", "events.jsonl"), "{not-json\n");
    const verdict = await gate.writeGate(root, { kind: "file", paths: ["src/feature.txt"] });
    assert.equal(verdict.decision, "block");
    if (verdict.decision !== "block") return;
    assert.equal(verdict.block.code, "WORKFLOW_STATE_UNREADABLE");
    assert.match(verdict.block.detail?.unreadableReason ?? "", /events\.jsonl/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("实现已批准、无 active 单元时，governed 文件写在门禁内 begin 再 allow", { timeout: 120_000 }, async () => {
  const root = await startImplementation("lazy-begin");
  try {
    const verdict = await gate.writeGate(root, { kind: "file", paths: ["src/main.js"] });
    assert.equal(verdict.decision, "allow");
    const current = await state.readState(root, "lazy-begin");
    assert.equal(activeUnits(current).length, 1, "writeGate must lazily begin an implementation unit");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("git 写永不 begin 单元；publish/unbounded/具名 paths 三种形态可区分", { timeout: 120_000 }, async () => {
  const root = await startImplementation("git-forms");
  try {
    const publish = await gate.writeGate(root, { kind: "git", form: "publish" });
    assert.equal(publish.decision, "block");
    if (publish.decision === "block") {
      assert.equal(publish.block.code, "GIT_GUARD");
      assert.equal(publish.block.detail?.variant, "publish");
    }
    const unbounded = await gate.writeGate(root, { kind: "git", form: "unbounded" });
    assert.equal(unbounded.decision, "block");
    if (unbounded.decision === "block") {
      assert.equal(unbounded.block.code, "GIT_GUARD");
      assert.equal(unbounded.block.detail?.variant, "unbounded");
    }
    const named = await gate.writeGate(root, { kind: "git", paths: ["src/main.js"] });
    assert.equal(named.decision, "allow");
    const current = await state.readState(root, "git-forms");
    assert.equal(activeUnits(current).length, 0, "git write must never begin an implementation unit");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("用户排除或未知路径的 git 写被拦", { timeout: 120_000 }, async () => {
  const root = await startImplementation("git-ownership");
  try {
    await writeFile(path.join(root, "src", "unknown.js"), "export const u = 1;\n");
    const unknown = await gate.writeGate(root, { kind: "git", paths: ["src/unknown.js"] });
    assert.equal(unknown.decision, "block");
    if (unknown.decision === "block") {
      assert.equal(unknown.block.code, "GIT_GUARD");
      assert.equal(unknown.block.detail?.variant, "paths");
    }
    let current = await state.readState(root, "git-ownership");
    await state.mutate(root, "git-ownership", current.revision, "test-ownership", (draft) => {
      draft.workspace.ownership["src/user-excluded.js"] = "excluded";
    });
    const excluded = await gate.writeGate(root, { kind: "git", paths: ["src/user-excluded.js"] });
    assert.equal(excluded.decision, "block");
    if (excluded.decision === "block") {
      assert.equal(excluded.block.code, "GIT_GUARD");
      assert.equal(excluded.block.detail?.variant, "paths");
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("启动排除的预存脏文件 git 写为 audit（提示不拦）", { timeout: 120_000 }, async () => {
  const root = await startImplementation("git-startup-excluded", true);
  try {
    let current = await state.readState(root, "git-startup-excluded");
    assert.equal(current.workspace.ownership["src/pre-existing.js"], "excluded");
    assert.equal(current.workspace.startedDirty["src/pre-existing.js"] !== undefined, true);
    const verdict = await gate.writeGate(root, { kind: "git", paths: ["src/pre-existing.js"] });
    assert.equal(verdict.decision, "audit");
    if (verdict.decision === "audit") {
      assert.equal(verdict.block.code, "GIT_STARTUP_EXCLUDED");
      assert.deepEqual(verdict.block.paths, ["src/pre-existing.js"]);
    }
    assert.equal(activeUnits(current).length, 0);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});


test("begin 前置失败时门禁返回带原因码的结构化诊断且状态不半推进", { timeout: 120_000 }, async () => {
  const root = await startImplementation("begin-blocked");
  try {
    // 篡改已登记工件：begin 的 trace/工件时效前置必然失败；assess 应给出原始原因码。
    const current = await state.readState(root, "begin-blocked");
    const planPath = path.join(root, ".dev-flow", "features", "begin-blocked", current.artifacts["implementation-plan"].path);
    await writeFile(planPath, "被篡改的计划内容\n");
    const verdict = await gate.writeGate(root, { kind: "file", paths: ["src/main.js"] });
    assert.equal(verdict.decision, "block");
    if (verdict.decision !== "block") return;
    assert.equal(verdict.block.code, "IMPLEMENTATION_UNIT_REQUIRED");
    assert.match(verdict.block.detail?.beginFailed ?? "", /^[A-Z][A-Z0-9_]+: /, "beginFailed must keep the original error code");
    const after = await state.readState(root, "begin-blocked");
    assert.equal(after.revision, current.revision, "blocked begin must not advance the revision");
    assert.equal(activeUnits(after).length, 0);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
