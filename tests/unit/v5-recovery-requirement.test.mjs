import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { loadSource } from "../helpers/load-source.mjs";
import { registerTraceFixture, traceDeltaFor } from "../helpers/trace-fixtures.mjs";
import { v6ImplementationPlanMarkdown, v6RecoveryBlock } from "../helpers/v6-fixtures.mjs";

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

const planMarkdown = (withRecovery) => v6ImplementationPlanMarkdown({
  extra: withRecovery
    ? v6RecoveryBlock().replace("重建受影响的交付文件并重新执行该 UNIT 的 forward_verification", "从备份恢复迁移前快照")
    : "",
});

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
    const result = await artifacts.validatePlanFromMarkdown(root, state.featureId, "implementation-plan");
    assert.equal(result.ok, false);
    assert.ok(result.diagnostics.some((d) => d.code === "PLAN_RECOVERY_REQUIRED" && d.recoveryHint), JSON.stringify(result.diagnostics));
    await assert.rejects(
      () => artifacts.recordArtifactFromMarkdown(root, state.featureId, state.revision, "implementation-plan"),
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
    const result = await artifacts.validatePlanFromMarkdown(root, state.featureId, "implementation-plan");
    assert.equal(result.ok, true, JSON.stringify(result.diagnostics));
    assert.equal(result.recoveryArrangements.length, 1);
    assert.equal(result.recoveryArrangements[0].stepRef, "UNIT-001");
    assert.equal(result.recoveryArrangements[0].riskRef, "data");
    const registered = await artifacts.recordArtifactFromMarkdown(root, state.featureId, state.revision, "implementation-plan");
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
    const result = await artifacts.validatePlanFromMarkdown(root, state.featureId, "implementation-plan");
    assert.equal(result.ok, true, JSON.stringify(result.diagnostics));
    assert.equal(result.recoveryArrangements.length, 0);
    const view = await inspection.inspectFeature(root, state.featureId, "trace");
    assert.equal(view.content.recovery.required, false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
