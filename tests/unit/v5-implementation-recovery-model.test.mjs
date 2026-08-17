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

const projectConfig = {
  schemaVersion: 2,
  verification: { commands: [{ id: "unit", command: process.execPath, args: ["-e", "process.exit(0)"], cwd: ".", provides: ["targeted", "behavior", "integration", "full"] }] },
  enforcement: { mode: "strict", gitWriteRequiresLogicComplete: true, oneActiveFeature: true, requireExplicitHumanReply: true },
  governedRoots: ["src"],
};

async function setupFormalFeature() {
  const root = await mkdtemp(path.join(os.tmpdir(), "dev-flow-unit-recovery-"));
  await mkdir(path.join(root, "src"));
  await stateStore.initProject(root, projectConfig);
  let state = await stateStore.startFeature(root, {
    featureId: "model",
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
  state = await registerTraceFixture({ root, featureId: state.featureId, state, kind: "requirements", delta: traceDeltaFor("requirements", "m") });
  state = await steps.recordStep(root, state.featureId, state.revision, "requirements_alignment", {});
  state = await artifacts.scaffoldArtifact(root, state.featureId, state.revision, "implementation-plan");
  return { root, state };
}

const planMarkdown = v6ImplementationPlanMarkdown({
  extra: v6RecoveryBlock().replace("重建受影响的交付文件并重新执行该 UNIT 的 forward_verification", "从备份恢复 pre_migrate 快照"),
});

test("recovery nodes register as independent arrangements and project separately from implementation units", async () => {
  const { root, state } = await setupFormalFeature();
  try {
    await writeFile(path.join(root, ".dev-flow", "features", state.featureId, state.artifacts["implementation-plan"].path), planMarkdown);
    const result = await artifacts.validatePlanFromMarkdown(root, state.featureId, "implementation-plan");
    assert.equal(result.ok, true, JSON.stringify(result.diagnostics));
    // 独立投影：实现单元不含回撤语义，恢复安排不含工作范围。
    assert.equal(result.implementationUnits.length, 1);
    assert.deepEqual(result.implementationUnits[0], {
      unitId: "UNIT-001",
      tasks: ["TASK-001"],
      dependsOn: [],
      fileScope: ["src"],
      forwardVerification: ["unit"],
    });
    assert.equal(result.recoveryArrangements.length, 1);
    assert.deepEqual(result.recoveryArrangements[0], {
      arrangementId: "REC-001",
      stepRef: "UNIT-001",
      recoveryKind: "compensation",
      method: "从备份恢复 pre_migrate 快照",
      riskRef: "data",
    });
    // 类型隔离：实现单元上没有 recovery 字段，恢复安排上没有 tasks/fileScope。
    assert.equal("recoveryKind" in result.implementationUnits[0], false);
    assert.equal("tasks" in result.recoveryArrangements[0], false);

    // 登记后 ledger 保留 recovery 节点
    const registered = await artifacts.recordArtifactFromMarkdown(root, state.featureId, state.revision, "implementation-plan");
    const store = await loadSource("plugins/dev-flow/src/core/traceability-store.ts");
    const ledger = await store.readTraceability(root, registered.state);
    assert.equal(ledger.nodes["REC-001"].kind, "recovery");
    assert.equal(ledger.nodes["REC-001"].recoveryKind, "compensation");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("a recovery arrangement referencing a missing step is rejected by preflight", async () => {
  const { root, state } = await setupFormalFeature();
  try {
    await writeFile(path.join(root, ".dev-flow", "features", state.featureId, state.artifacts["implementation-plan"].path), planMarkdown.replace("step_ref: UNIT-001", "step_ref: UNIT-999"));
    const result = await artifacts.validatePlanFromMarkdown(root, state.featureId, "implementation-plan");
    assert.equal(result.ok, false);
    assert.ok(result.diagnostics.some((d) => d.code === "TRACE_GRAPH_INVALID"), JSON.stringify(result.diagnostics));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("a recovery node cannot satisfy an implementation unit requirement and vice versa", async () => {
  const { root, state } = await setupFormalFeature();
  try {
    // 只有 recovery 节点、没有 rollback 节点：实现单元投影为空——恢复安排
    // 不能伪装成实现单元满足执行需求。
    await writeFile(path.join(root, ".dev-flow", "features", state.featureId, state.artifacts["implementation-plan"].path), v6RecoveryBlock({ stepRef: "TASK-001" }).replace("compensation", "rollback").replace("data", "external").replace("重建受影响的交付文件并重新执行该 UNIT 的 forward_verification", "回滚"));
    const result = await artifacts.validatePlanFromMarkdown(root, state.featureId, "implementation-plan");
    // 图校验拒绝：task 缺失（complete 必需 kind）+ recovery stepRef 指向不存在的 task
    assert.equal(result.ok, false);
    assert.equal(result.implementationUnits, undefined);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
