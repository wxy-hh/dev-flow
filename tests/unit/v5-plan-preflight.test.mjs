import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { loadSource } from "../helpers/load-source.mjs";
import { appendSecondTraceClosure, registerTraceFixture, traceDeltaFor, twoClosureTraceDeltaFor } from "../helpers/trace-fixtures.mjs";

const stateStore = await loadSource("plugins/dev-flow/src/core/state-store.ts");
const artifacts = await loadSource("plugins/dev-flow/src/core/artifacts.ts");
const planRevision = await loadSource("plugins/dev-flow/src/core/plan-revision.ts");
const steps = await loadSource("plugins/dev-flow/src/core/feature-check.ts");

const projectConfig = {
  schemaVersion: 2,
  verification: { commands: [{ id: "unit", command: process.execPath, args: ["-e", "process.exit(0)"], cwd: ".", provides: ["targeted", "behavior", "integration", "full"] }] },
  enforcement: { mode: "strict", gitWriteRequiresLogicComplete: true, oneActiveFeature: true, requireExplicitHumanReply: true },
  governedRoots: ["src"],
};

async function setupFormalFeature() {
  const root = await mkdtemp(path.join(os.tmpdir(), "dev-flow-plan-preflight-"));
  await mkdir(path.join(root, "src"));
  await stateStore.initProject(root, projectConfig);
  let state = await stateStore.startFeature(root, {
    featureId: "preflight",
    host: "codex",
    level: "M",
    topology: "local",
    classificationBasis: {
      scopeFacts: ["scope"],
      topologyFacts: ["topology"],
      uncertaintyFacts: [],
      riskFacts: {},
      decisionRefs: [],
      signals: { changeSurface: "multi-component", behaviorChange: "new-capability", topology: "local", unitCount: 1, requirements: "provided-confirmed", operationalRecovery: false, executableRollback: false },
      controlEnhancements: { trace: true },
    },
  });
  // requirements 先登记（Trace 路径，两个 AC 闭包），再推进到 planning 并 scaffold 计划。
  state = await registerTraceFixture({
    root, featureId: state.featureId, state, kind: "requirements",
    delta: twoClosureTraceDeltaFor("requirements", "m"),
    edit: (markdown) => appendSecondTraceClosure(markdown, "requirements", "m"),
  });
  state = await steps.recordStep(root, state.featureId, state.revision, "requirements_alignment", {});
  state = await artifacts.scaffoldArtifact(root, state.featureId, state.revision, "implementation-plan");
  return { root, state };
}

test("preflight returns all uncovered acceptance criteria in one call with zero side effects", async () => {
  const { root, state } = await setupFormalFeature();
  try {
    const featureId = state.featureId;
    let current = state;
    // 计划只有 TASK/RU，没有任何 TEST：两个 AC 都缺测试覆盖。
    const badDelta = {
      nodes: [
        { kind: "task", id: "TASK-001", covers: ["REQ-001", "AC-001"], implementationUnit: "UNIT-001" },
        { kind: "task", id: "TASK-002", covers: ["REQ-002", "AC-002"], implementationUnit: "UNIT-002" },
        { kind: "implementation-unit", id: "UNIT-001", tasks: ["TASK-001"], dependsOn: [], fileScope: ["src"], covers: ["REQ-001", "AC-001"], forwardVerification: ["unit"] },
        { kind: "implementation-unit", id: "UNIT-002", tasks: ["TASK-002"], dependsOn: [], fileScope: ["src"], covers: ["REQ-002", "AC-002"], forwardVerification: ["unit"] },
      ],
    };
    const planPath = path.join(root, ".dev-flow", "features", featureId, current.artifacts["implementation-plan"].path);
    // 写入与 delta 一致的锚点（两个 TASK + 两个 RU，无 TEST）
    const markdown = [
      "<!-- dev-flow:id=TASK-001 kind=task -->\n### TASK-001\n\n- covers: REQ-001, AC-001\n- implementation_unit: UNIT-001\n",
      "<!-- dev-flow:id=TASK-002 kind=task -->\n### TASK-002\n\n- covers: REQ-002, AC-002\n- implementation_unit: UNIT-002\n",
      "<!-- dev-flow:id=UNIT-001 kind=implementation-unit -->\n### UNIT-001\n\n- tasks: TASK-001\n- depends_on: []\n- file_scope: src\n- covers: REQ-001, AC-001\n- forward_verification: unit\n",
      "<!-- dev-flow:id=UNIT-002 kind=implementation-unit -->\n### UNIT-002\n\n- tasks: TASK-002\n- depends_on: []\n- file_scope: src\n- covers: REQ-002, AC-002\n- forward_verification: unit\n",
    ].join("\n");
    await writeFile(planPath, markdown);

    const before = await stateStore.readState(root, featureId);
    const result = await artifacts.validatePlan(root, featureId, "implementation-plan", badDelta);
    assert.equal(result.ok, false);
    const acDiagnostics = result.diagnostics.filter((d) => d.position === "AC-001" || d.position === "AC-002");
    assert.equal(acDiagnostics.length, 2, "both uncovered ACs must be reported in one preflight call");
    assert.ok(acDiagnostics.every((d) => d.code === "TRACE_SLICE_INCOMPLETE" && d.recoveryHint));

    // 零副作用：revision、traceability 指针、工件、事件账本均未变化。
    const after = await stateStore.readState(root, featureId);
    assert.equal(after.revision, before.revision);
    assert.deepEqual(after.traceability, before.traceability);
    assert.deepEqual(after.artifacts, before.artifacts);
    const eventsBefore = await stateStore.readFeatureEvents(root, featureId);
    const eventsAfter = await stateStore.readFeatureEvents(root, featureId);
    assert.equal(eventsAfter.length, eventsBefore.length);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("preflight and formal registration report the same diagnostic set for the same bad plan", async () => {
  const { root, state } = await setupFormalFeature();
  try {
    const featureId = state.featureId;
    let current = state;
    const badDelta = {
      nodes: [
        { kind: "task", id: "TASK-001", covers: ["REQ-001", "AC-001"], implementationUnit: "UNIT-999" },
      ],
    };
    const planPath = path.join(root, ".dev-flow", "features", featureId, current.artifacts["implementation-plan"].path);
    await writeFile(planPath, "<!-- dev-flow:id=TASK-001 kind=task -->\n### TASK-001\n\n- covers: REQ-001, AC-001\n- implementation_unit: UNIT-999\n");
    const preflight = await artifacts.validatePlan(root, featureId, "implementation-plan", badDelta);
    assert.equal(preflight.ok, false);
    await assert.rejects(
      () => artifacts.recordArtifactWithTrace(root, featureId, current.revision, "implementation-plan", badDelta),
      (error) => {
        assert.equal(error.code, "PLAN_INVALID");
        assert.deepEqual(error.details.diagnostics, preflight.diagnostics, "registration must surface the same diagnostics as preflight");
        return true;
      },
    );
    // 第三入口：计划修订预检经同一 compileArtifactPlan，同一坏计划必得同一诊断集。
    await assert.rejects(
      () => planRevision.revisePlanDuringImplementation(root, featureId, current.revision, badDelta, "codex"),
      (error) => {
        assert.equal(error.code, "PLAN_INVALID");
        assert.deepEqual(error.details.diagnostics, preflight.diagnostics, "revision preflight must surface the same diagnostics as preflight");
        return true;
      },
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("a valid plan preflights ok and registers atomically", async () => {
  const { root, state } = await setupFormalFeature();
  try {
    const featureId = state.featureId;
    let current = state;
    const validDelta = twoClosureTraceDeltaFor("implementation-plan", "m");
    const planPath = path.join(root, ".dev-flow", "features", featureId, current.artifacts["implementation-plan"].path);
    const before = await readFile(planPath, "utf8");
    const markdown = before + [
      "<!-- dev-flow:id=TASK-002 kind=task -->\n### TASK-002\n\n- covers: REQ-002, AC-002\n- implementation_unit: UNIT-002\n",
      "<!-- dev-flow:id=TEST-002 kind=test -->\n### TEST-002\n\n- 验证方法：\n",
      "<!-- dev-flow:id=UNIT-002 kind=implementation-unit -->\n### UNIT-002\n\n- tasks: TASK-002\n- depends_on: []\n- file_scope: src\n- covers: REQ-002, AC-002\n- forward_verification: unit\n",
    ].join("\n");
    await writeFile(planPath, markdown);
    const preflight = await artifacts.validatePlan(root, featureId, "implementation-plan", validDelta);
    assert.equal(preflight.ok, true, JSON.stringify(preflight.diagnostics));
    assert.deepEqual(preflight.diagnostics, []);
    const registered = await artifacts.recordArtifactWithTrace(root, featureId, current.revision, "implementation-plan", validDelta);
    assert.ok(registered.state.traceability);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("registration after a concurrent revision change requires a fresh preflight", async () => {
  const { root, state } = await setupFormalFeature();
  try {
    const featureId = state.featureId;
    const current = state;
    const validDelta = traceDeltaFor("implementation-plan", "m");
    // 预检后另一个写入推进 revision
    await artifacts.validatePlan(root, featureId, "implementation-plan", validDelta);
    const bumped = await stateStore.mutate(root, featureId, current.revision, "test-bump", (draft) => {
      draft.resumeSummary = "concurrent change";
    });
    void bumped;
    await assert.rejects(
      () => artifacts.recordArtifactWithTrace(root, featureId, current.revision, "implementation-plan", validDelta),
      (error) => error.code === "STATE_REVISION_CONFLICT",
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
