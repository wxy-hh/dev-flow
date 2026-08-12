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

const planMarkdown = [
  "<!-- dev-flow:id=TASK-001 kind=task -->\n### TASK-001\n\n- covers: REQ-001, AC-001\n- implementation_unit: UNIT-001\n",
  "<!-- dev-flow:id=TEST-001 kind=test -->\n### TEST-001\n\n- 验证方法：\n",
  "<!-- dev-flow:id=UNIT-001 kind=implementation-unit -->\n### UNIT-001\n\n- tasks: TASK-001\n- depends_on: []\n- file_scope: src\n- covers: REQ-001, AC-001\n- forward_verification: unit\n",
  "<!-- dev-flow:id=REC-001 kind=recovery -->\n### REC-001：数据迁移补偿\n\n- step_ref: UNIT-001\n- recovery_kind: compensation\n- method: 从备份恢复 pre_migrate 快照\n- risk_ref: data\n",
].join("\n");

const planDelta = {
  nodes: [
    { kind: "task", id: "TASK-001", covers: ["REQ-001", "AC-001"], implementationUnit: "UNIT-001" },
    { kind: "test", id: "TEST-001", verifies: ["AC-001"] },
    { kind: "implementation-unit", id: "UNIT-001", tasks: ["TASK-001"], dependsOn: [], fileScope: ["src"], covers: ["REQ-001", "AC-001"], forwardVerification: ["unit"] },
    { kind: "recovery", id: "REC-001", stepRef: "UNIT-001", recoveryKind: "compensation", method: "从备份恢复 pre_migrate 快照", riskRef: "data" },
  ],
};

test("recovery nodes register as independent arrangements and project separately from implementation units", async () => {
  const { root, state } = await setupFormalFeature();
  try {
    await writeFile(path.join(root, ".dev-flow", "features", state.featureId, state.artifacts["implementation-plan"].path), planMarkdown);
    const result = await artifacts.validatePlan(root, state.featureId, "implementation-plan", planDelta);
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
    const registered = await artifacts.recordArtifactWithTrace(root, state.featureId, state.revision, "implementation-plan", planDelta);
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
    const bad = { nodes: [...planDelta.nodes.filter((node) => node.kind !== "recovery"), { kind: "recovery", id: "REC-001", stepRef: "UNIT-999", recoveryKind: "rollback", method: "回滚", riskRef: "external" }] };
    await writeFile(path.join(root, ".dev-flow", "features", state.featureId, state.artifacts["implementation-plan"].path), planMarkdown.replace("step_ref: UNIT-001", "step_ref: UNIT-999"));
    const result = await artifacts.validatePlan(root, state.featureId, "implementation-plan", bad);
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
    const recoveryOnly = { nodes: planDelta.nodes.filter((node) => node.kind !== "rollback" && node.kind !== "task" && node.kind !== "test") };
    await writeFile(path.join(root, ".dev-flow", "features", state.featureId, state.artifacts["implementation-plan"].path), "<!-- dev-flow:id=REC-001 kind=recovery -->\n### REC-001\n\n- step_ref: TASK-001\n- recovery_kind: rollback\n- method: 回滚\n- risk_ref: external\n");
    const result = await artifacts.validatePlan(root, state.featureId, "implementation-plan", recoveryOnly);
    // 图校验拒绝：task 缺失（complete 必需 kind）+ recovery stepRef 指向不存在的 task
    assert.equal(result.ok, false);
    assert.equal(result.implementationUnits, undefined);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
