import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import { loadSource } from "../helpers/load-source.mjs";
import { appendSecondTraceClosure, registerTraceFixture, twoClosureTraceDeltaFor } from "../helpers/trace-fixtures.mjs";

const stateStore = await loadSource("plugins/dev-flow/src/core/state-store.ts");
const artifacts = await loadSource("plugins/dev-flow/src/core/artifacts.ts");
const steps = await loadSource("plugins/dev-flow/src/core/feature-check.ts");
const run = promisify(execFile);

const projectConfig = {
  schemaVersion: 2,
  verification: { commands: [{ id: "unit", command: process.execPath, args: ["-e", "process.exit(0)"], cwd: ".", provides: ["targeted", "behavior", "integration", "full"] }] },
  enforcement: { mode: "strict", gitWriteRequiresLogicComplete: true, oneActiveFeature: true, requireExplicitHumanReply: true },
  governedRoots: ["src"],
};

/** M 路线 + data 风险（恢复安排必填）：分类使用结构化事实引用（新合同）。 */
async function setup() {
  const root = await mkdtemp(path.join(os.tmpdir(), "dev-flow-plan-complete-diag-"));
  await mkdir(path.join(root, "src"));
  await writeFile(path.join(root, "src", "main.js"), "export {}\n");
  await writeFile(path.join(root, "src", "migrate.js"), "export const migrate = () => {};\n");
  await run("git", ["init", "--quiet"], { cwd: root });
  await run("git", ["add", "."], { cwd: root });
  await run("git", ["-c", "user.name=Dev Flow Tests", "-c", "user.email=tests@example.invalid", "commit", "--quiet", "-m", "seed"], { cwd: root });
  await stateStore.initProject(root, projectConfig);
  let state = await stateStore.startFeature(root, { featureId: "diag", host: "codex" });
  // 登记 data 风险的事实依据（ADR-0018：引用必须是已登记的仓库事实）。
  const fact = await stateStore.registerRepositoryFact(root, "diag", state.revision, {
    assertion: "src/migrate.js 包含数据迁移入口",
    location: { kind: "positive", path: "src/migrate.js" },
  }, "codex");
  const factId = fact.recordId;
  state = fact.state;
  state = await stateStore.lockClassification(root, "diag", state.revision, {
    level: "M",
    topology: "shared-contract",
    scopeFactRefs: [],
    topologyFactRefs: [],
    uncertaintyFactRefs: [],
    riskFactRefs: { data: [factId] },
    decisionRefs: [],
    signals: {
      changeSurface: "multi-component",
      behaviorChange: "new-capability",
      topology: "shared-contract",
      unitCount: 2,
      requirements: "provided-confirmed",
      operationalRecovery: false,
      executableRollback: false,
    },
  }, { scanned: ["assumption", "free-space", "tbd", "fallback", "scope", "acceptance"], items: [] });
  await stateStore.recordHostEvent(root, { eventId: `route-${state.revision}`, type: "user-prompt", host: "claude", text: "确认这条路线" });
  state = await stateStore.confirmRouteClassification(root, "diag", state.revision, "确认这条路线", "claude");
  state = await registerTraceFixture({
    root, featureId: "diag", state, kind: "requirements",
    delta: twoClosureTraceDeltaFor("requirements", "m"),
    edit: (markdown) => appendSecondTraceClosure(markdown, "requirements", "m"),
  });
  state = await steps.recordStep(root, "diag", state.revision, "requirements_alignment", {});
  state = await artifacts.scaffoldArtifact(root, "diag", state.revision, "implementation-plan");
  return { root, state };
}

const markdownFor = (delta) => delta.nodes.map((node) => {
  if (node.kind === "task") {
    return `<!-- dev-flow:id=${node.id} kind=task -->\n### ${node.id}\n\n- covers: ${node.covers.join(", ")}\n- implementation_unit: ${node.implementationUnit}\n`;
  }
  if (node.kind === "implementation-unit") {
    return `<!-- dev-flow:id=${node.id} kind=implementation-unit -->\n### ${node.id}\n\n- tasks: ${node.tasks.join(", ")}\n- depends_on: [${node.dependsOn.join(", ")}]\n- file_scope: ${node.fileScope.join(", ")}\n- covers: ${node.covers.join(", ")}\n- forward_verification: ${node.forwardVerification.join(", ")}\n`;
  }
  throw new Error(`unsupported kind ${node.kind}`);
}).join("\n");

/** 同时含图错误（UNIT 循环依赖）、未覆盖 AC（无 TEST、无处置）与缺失恢复安排的坏计划。 */
function badDelta() {
  return {
    nodes: [
      { kind: "task", id: "TASK-001", covers: ["REQ-001", "AC-001"], implementationUnit: "UNIT-001" },
      { kind: "task", id: "TASK-002", covers: ["REQ-002", "AC-002"], implementationUnit: "UNIT-002" },
      { kind: "implementation-unit", id: "UNIT-001", tasks: ["TASK-001"], dependsOn: ["UNIT-002"], fileScope: ["src"], covers: ["REQ-001", "AC-001"], forwardVerification: ["unit"] },
      { kind: "implementation-unit", id: "UNIT-002", tasks: ["TASK-002"], dependsOn: ["UNIT-001"], fileScope: ["src"], covers: ["REQ-002", "AC-002"], forwardVerification: ["unit"] },
    ],
  };
}

test("preflight returns graph, uncovered-AC and recovery diagnostics together in one call", async () => {
  const { root, state } = await setup();
  try {
    const featureId = state.featureId;
    const delta = badDelta();
    const planPath = path.join(root, ".dev-flow", "features", featureId, state.artifacts["implementation-plan"].path);
    await writeFile(planPath, markdownFor(delta));

    const before = await stateStore.readState(root, featureId);
    const result = await artifacts.validatePlan(root, featureId, "implementation-plan", delta);
    assert.equal(result.ok, false);
    // 图错误不再吞掉其他诊断：一次返回 图错误 + 两个未覆盖 AC + 缺失恢复安排。
    const codes = result.diagnostics.map((d) => d.code);
    assert.ok(codes.includes("PLAN_TASK_GRAPH_INVALID") || codes.includes("TRACE_GRAPH_INVALID"),
      `expected a graph diagnostic, got ${codes.join(", ")}`);
    assert.ok(codes.includes("PLAN_RECOVERY_REQUIRED"), `expected recovery diagnostic, got ${codes.join(", ")}`);
    const acDiagnostics = result.diagnostics.filter((d) => d.position === "AC-001" || d.position === "AC-002");
    assert.equal(acDiagnostics.length, 2, `both uncovered ACs must be reported, got ${acDiagnostics.length}`);
    // 每条诊断都有稳定代码、具体位置、说明与单一恢复动作。
    for (const diagnostic of result.diagnostics) {
      assert.ok(diagnostic.code && diagnostic.position && diagnostic.message && diagnostic.recoveryHint, JSON.stringify(diagnostic));
    }
    // 顺序稳定：图错误（阶段 2）→ 恢复安排（阶段 3）→ 未覆盖 AC（收集阶段）。
    assert.equal(result.diagnostics[0].position, "plan-graph");

    // 零副作用：预检不写快照、不推进 revision、不改变状态。
    const after = await stateStore.readState(root, featureId);
    assert.equal(after.revision, before.revision);
    assert.deepEqual(after.traceability, before.traceability);
    assert.deepEqual(after.artifacts, before.artifacts);
    assert.equal((await stateStore.readFeatureEvents(root, featureId)).length, (await stateStore.readFeatureEvents(root, featureId)).length);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("formal registration surfaces the same complete diagnostic set as preflight", async () => {
  const { root, state } = await setup();
  try {
    const featureId = state.featureId;
    const delta = badDelta();
    const planPath = path.join(root, ".dev-flow", "features", featureId, state.artifacts["implementation-plan"].path);
    await writeFile(planPath, markdownFor(delta));

    const preflight = await artifacts.validatePlan(root, featureId, "implementation-plan", delta);
    await assert.rejects(
      () => artifacts.recordArtifactWithTrace(root, featureId, state.revision, "implementation-plan", delta),
      (error) => {
        assert.equal(error.code, "PLAN_INVALID");
        assert.deepEqual(error.details.diagnostics, preflight.diagnostics,
          "registration must surface the same diagnostic set as preflight");
        return true;
      },
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
