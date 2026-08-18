import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { loadSource } from "../helpers/load-source.mjs";
import { appendSecondTraceClosure, registerTraceFixture, twoClosureTraceDeltaFor } from "../helpers/trace-fixtures.mjs";
import { v6ImplementationPlanMarkdown } from "../helpers/v6-fixtures.mjs";

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
    const planPath = path.join(root, ".dev-flow", "features", featureId, current.artifacts["implementation-plan"].path);
    await writeFile(planPath, [
      v6ImplementationPlanMarkdown({ includeTest: false, tdd: "direct" }),
      v6ImplementationPlanMarkdown({ taskId: "TASK-002", testId: "TEST-002", unitId: "UNIT-002", covers: ["REQ-002", "AC-002"], includeTest: false, tdd: "direct" }),
    ].join("\n"));

    const before = await stateStore.readState(root, featureId);
    const result = await artifacts.validatePlanFromMarkdown(root, featureId, "implementation-plan");
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
    const planPath = path.join(root, ".dev-flow", "features", featureId, current.artifacts["implementation-plan"].path);
    await writeFile(planPath, v6ImplementationPlanMarkdown({ unitId: "UNIT-999", includeTest: false, tdd: "direct" }));
    const preflight = await artifacts.validatePlanFromMarkdown(root, featureId, "implementation-plan");
    assert.equal(preflight.ok, false);
    await assert.rejects(
      () => artifacts.recordArtifactFromMarkdown(root, featureId, current.revision, "implementation-plan"),
      (error) => {
        assert.equal(error.code, "PLAN_INVALID");
        assert.deepEqual(error.details.diagnostics, preflight.diagnostics, "registration must surface the same diagnostics as preflight");
        return true;
      },
    );
    await assert.rejects(
      () => planRevision.revisePlanFromMarkdown(root, featureId, current.revision, "codex"),
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
    const planPath = path.join(root, ".dev-flow", "features", featureId, current.artifacts["implementation-plan"].path);
    await writeFile(planPath, [
      v6ImplementationPlanMarkdown({ fileScope: ["src/one.ts"] }),
      v6ImplementationPlanMarkdown({ taskId: "TASK-002", testId: "TEST-002", unitId: "UNIT-002", fileScope: ["src/two.ts"], covers: ["REQ-002", "AC-002"], verifies: ["AC-002"] }),
    ].join("\n"));
    const preflight = await artifacts.validatePlanFromMarkdown(root, featureId, "implementation-plan");
    assert.equal(preflight.ok, true, JSON.stringify(preflight.diagnostics));
    assert.deepEqual(preflight.diagnostics, []);
    const registered = await artifacts.recordArtifactFromMarkdown(root, featureId, current.revision, "implementation-plan");
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
    await artifacts.validatePlanFromMarkdown(root, featureId, "implementation-plan");
    const bumped = await stateStore.mutate(root, featureId, current.revision, "test-bump", (draft) => {
      draft.resumeSummary = "concurrent change";
    });
    void bumped;
    await assert.rejects(
      () => artifacts.recordArtifactFromMarkdown(root, featureId, current.revision, "implementation-plan"),
      (error) => error.code === "STATE_REVISION_CONFLICT",
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("formal plan without Trace does structural preflight and never throws TRACE_NOT_ENFORCED", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "dev-flow-plan-notrace-"));
  try {
    await mkdir(path.join(root, "src"));
    await stateStore.initProject(root, projectConfig);
    let state = await stateStore.startFeature(root, {
      featureId: "notrace",
      host: "codex",
      level: "S",
      topology: "local",
      classificationBasis: {
        scopeFacts: ["scope"],
        topologyFacts: ["topology"],
        uncertaintyFacts: [],
        riskFacts: {},
        decisionRefs: [],
        signals: {
          changeSurface: "single-component",
          behaviorChange: "bounded-rule",
          topology: "local",
          unitCount: 1,
          requirements: "provided-confirmed",
          operationalRecovery: false,
          executableRollback: false,
        },
        controlEnhancements: { plan: "formal" },
      },
    });
    assert.equal(state.classification.controls.plan, "formal");
    assert.equal(state.classification.controls.trace, false);
    state = await artifacts.scaffoldArtifact(root, state.featureId, state.revision, "implementation-plan");
    const planPath = path.join(root, ".dev-flow", "features", state.featureId, state.artifacts["implementation-plan"].path);
    await writeFile(planPath, "# 实施计划\n\n没有合法锚点。\n");
    const result = await artifacts.validatePlanFromMarkdown(root, state.featureId, "implementation-plan");
    assert.equal(result.applicable, true);
    assert.equal(result.coverageChecked, false);
    assert.equal(result.nextStep, "dev_flow_record_artifact");
    assert.ok(result.diagnostics.every((item) => item.code === "TRACE_MARKDOWN_INVALID"));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
