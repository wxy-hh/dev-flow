import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { loadSource } from "../helpers/load-source.mjs";
import { registerTraceFixture, traceDeltaFor } from "../helpers/trace-fixtures.mjs";

const stateStore = await loadSource("plugins/dev-flow/src/core/state-store.ts");
const artifacts = await loadSource("plugins/dev-flow/src/core/artifacts.ts");
const steps = await loadSource("plugins/dev-flow/src/core/feature-check.ts");
const inspection = await loadSource("plugins/dev-flow/src/core/inspection.ts");

const projectConfig = {
  schemaVersion: 2,
  verification: { commands: [{ id: "unit", command: process.execPath, args: ["-e", "process.exit(0)"], cwd: ".", provides: ["targeted", "behavior", "integration", "full"] }] },
  enforcement: { mode: "strict", gitWriteRequiresLogicComplete: true, oneActiveFeature: true, requireExplicitHumanReply: true },
  governedRoots: ["src"],
};

const planMarkdown = (withRecovery) => [
  "<!-- dev-flow:id=TASK-001 kind=task -->\n### TASK-001\n\n- covers: REQ-001, AC-001\n- implementation_unit: UNIT-001\n",
  "<!-- dev-flow:id=TEST-001 kind=test -->\n### TEST-001\n\n- 验证方法：\n",
  "<!-- dev-flow:id=UNIT-001 kind=implementation-unit -->\n### UNIT-001\n\n- tasks: [TASK-001]\n- depends_on: []\n- file_scope: src\n- covers: REQ-001, AC-001\n- forward_verification: unit\n",
  ...(withRecovery ? [
    "<!-- dev-flow:id=REC-001 kind=recovery -->\n### REC-001\n\n- step_ref: UNIT-001\n- recovery_kind: compensation\n- method: 从备份恢复迁移前快照\n- risk_ref: data\n",
  ] : []),
].join("\n");

function planDelta(withRecovery) {
  const nodes = [
    { kind: "task", id: "TASK-001", covers: ["REQ-001", "AC-001"], implementationUnit: "UNIT-001" },
    { kind: "test", id: "TEST-001", verifies: ["AC-001"] },
    { kind: "implementation-unit", id: "UNIT-001", tasks: ["TASK-001"], dependsOn: [], fileScope: ["src"], covers: ["REQ-001", "AC-001"], forwardVerification: ["unit"] },
  ];
  if (withRecovery) nodes.push({ kind: "recovery", id: "REC-001", stepRef: "UNIT-001", recoveryKind: "compensation", method: "从备份恢复迁移前快照", riskRef: "data" });
  return { nodes };
}

async function setupHighRisk(prefix) {
  const root = await mkdtemp(path.join(os.tmpdir(), prefix));
  await mkdir(path.join(root, "src"));
  await stateStore.initProject(root, projectConfig);
  let state = await stateStore.startFeature(root, {
    featureId: "risk",
    host: "codex",
    level: "M",
    topology: "local",
    classificationBasis: {
      scopeFacts: ["scope"],
      topologyFacts: ["topology"],
      uncertaintyFacts: [],
      riskFacts: { data: ["数据迁移"] },
      decisionRefs: [],
      signals: { changeSurface: "multi-component", behaviorChange: "new-capability", topology: "local", unitCount: 1, requirements: "provided-confirmed", operationalRecovery: false, executableRollback: false },
      controlEnhancements: { trace: true },
    },
    riskLabels: ["data"],
  });
  assert.ok(state.classification.riskLabels.includes("data"));
  state = await registerTraceFixture({ root, featureId: state.featureId, state, kind: "requirements", delta: traceDeltaFor("requirements", "m") });
  state = await steps.recordStep(root, state.featureId, state.revision, "requirements_alignment", {});
  state = await artifacts.scaffoldArtifact(root, state.featureId, state.revision, "implementation-plan");
  return { root, state };
}

test("a high-risk plan without any recovery arrangement fails preflight and registration with a recovery hint", async () => {
  const { root, state } = await setupHighRisk("dev-flow-recovery-required-");
  try {
    await writeFile(path.join(root, ".dev-flow", "features", state.featureId, state.artifacts["implementation-plan"].path), planMarkdown(false));
    const result = await artifacts.validatePlan(root, state.featureId, "implementation-plan", planDelta(false));
    assert.equal(result.ok, false);
    assert.ok(result.diagnostics.some((d) => d.code === "PLAN_RECOVERY_REQUIRED" && d.recoveryHint), JSON.stringify(result.diagnostics));
    await assert.rejects(
      () => artifacts.recordArtifactWithTrace(root, state.featureId, state.revision, "implementation-plan", planDelta(false)),
      (error) => error.code === "PLAN_INVALID",
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("an effective recovery arrangement tied to the protected step satisfies the requirement", async () => {
  const { root, state } = await setupHighRisk("dev-flow-recovery-present-");
  try {
    await writeFile(path.join(root, ".dev-flow", "features", state.featureId, state.artifacts["implementation-plan"].path), planMarkdown(true));
    const result = await artifacts.validatePlan(root, state.featureId, "implementation-plan", planDelta(true));
    assert.equal(result.ok, true, JSON.stringify(result.diagnostics));
    assert.equal(result.recoveryArrangements.length, 1);
    assert.equal(result.recoveryArrangements[0].stepRef, "UNIT-001");
    assert.equal(result.recoveryArrangements[0].riskRef, "data");
    const registered = await artifacts.recordArtifactWithTrace(root, state.featureId, state.revision, "implementation-plan", planDelta(true));
    const view = await inspection.inspectFeature(root, state.featureId, "trace");
    assert.equal(view.content.recovery.required, true);
    assert.deepEqual(view.content.recovery.arrangements.map((a) => a.id), ["REC-001"]);
    void registered;
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("ordinary low-risk plans keep working without recovery arrangements", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "dev-flow-recovery-ordinary-"));
  await mkdir(path.join(root, "src"));
  await stateStore.initProject(root, projectConfig);
  let state = await stateStore.startFeature(root, {
    featureId: "ordinary",
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
  try {
    assert.deepEqual(state.classification.riskLabels, []);
    state = await registerTraceFixture({ root, featureId: state.featureId, state, kind: "requirements", delta: traceDeltaFor("requirements", "m") });
    state = await steps.recordStep(root, state.featureId, state.revision, "requirements_alignment", {});
    state = await artifacts.scaffoldArtifact(root, state.featureId, state.revision, "implementation-plan");
    await writeFile(path.join(root, ".dev-flow", "features", state.featureId, state.artifacts["implementation-plan"].path), planMarkdown(false));
    const result = await artifacts.validatePlan(root, state.featureId, "implementation-plan", planDelta(false));
    assert.equal(result.ok, true, JSON.stringify(result.diagnostics));
    assert.equal(result.recoveryArrangements.length, 0);
    const view = await inspection.inspectFeature(root, state.featureId, "trace");
    assert.equal(view.content.recovery.required, false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
