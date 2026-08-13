import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { loadSource } from "../helpers/load-source.mjs";
import { registerTraceFixture, traceDeltaFor } from "../helpers/trace-fixtures.mjs";

const store = await loadSource("plugins/dev-flow/src/core/state-store.ts");
const artifacts = await loadSource("plugins/dev-flow/src/core/artifacts.ts");
const steps = await loadSource("plugins/dev-flow/src/core/feature-check.ts");
const units = await loadSource("plugins/dev-flow/src/core/implementation-units.ts");
const checkpoints = await loadSource("plugins/dev-flow/src/core/checkpoints.ts");
const decisions = await loadSource("plugins/dev-flow/src/core/decision-interactions.ts");

const projectConfig = {
  schemaVersion: 2,
  verification: { commands: [{ id: "unit", command: process.execPath, args: ["-e", "process.exit(0)"], cwd: ".", provides: ["targeted", "behavior", "integration", "full"] }] },
  enforcement: { mode: "strict", gitWriteRequiresLogicComplete: true, oneActiveFeature: true, requireExplicitHumanReply: true },
  governedRoots: ["src"],
};

async function setupTraceM(prefix) {
  const root = await mkdtemp(path.join(os.tmpdir(), prefix));
  await mkdir(path.join(root, "src"));
  await store.initProject(root, projectConfig);
  let state = await store.startFeature(root, {
    featureId: "revise",
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
  "<!-- dev-flow:id=TASK-002 kind=task -->\n### TASK-002\n\n- covers: REQ-001, AC-001\n- implementation_unit: UNIT-002\n",
  "<!-- dev-flow:id=TEST-001 kind=test -->\n### TEST-001\n\n- 验证方法：\n",
  "<!-- dev-flow:id=UNIT-001 kind=implementation-unit -->\n### UNIT-001\n\n- tasks: [TASK-001]\n- depends_on: []\n- file_scope: src/a.ts\n- covers: REQ-001, AC-001\n- forward_verification: unit\n",
  "<!-- dev-flow:id=UNIT-002 kind=implementation-unit -->\n### UNIT-002\n\n- tasks: [TASK-002]\n- depends_on: []\n- file_scope: src/b.ts\n- covers: REQ-001, AC-001\n- forward_verification: unit\n",
].join("\n");

const planDelta = {
  nodes: [
    { kind: "task", id: "TASK-001", covers: ["REQ-001", "AC-001"], implementationUnit: "UNIT-001" },
    { kind: "task", id: "TASK-002", covers: ["REQ-001", "AC-001"], implementationUnit: "UNIT-002" },
    { kind: "test", id: "TEST-001", verifies: ["AC-001"] },
    { kind: "implementation-unit", id: "UNIT-001", tasks: ["TASK-001"], dependsOn: [], fileScope: ["src/a.ts"], covers: ["REQ-001", "AC-001"], forwardVerification: ["unit"] },
    { kind: "implementation-unit", id: "UNIT-002", tasks: ["TASK-002"], dependsOn: [], fileScope: ["src/b.ts"], covers: ["REQ-001", "AC-001"], forwardVerification: ["unit"] },
  ],
};

test("revising the plan during implementation pauses the step, shows the impact, and redoes only affected units", async () => {
  const { root, state } = await setupTraceM("dev-flow-plan-revise-");
  try {
    const id = state.featureId;
    const planPath = path.join(root, ".dev-flow", "features", id, state.artifacts["implementation-plan"].path);
    await writeFile(planPath, planMarkdown);
    let current = await artifacts.recordArtifactWithTrace(root, id, state.revision, "implementation-plan", planDelta);
    current = current.state;
    current = await steps.recordStep(root, id, current.revision, "planning", { reviewType: "plan" });
    // 完成 UNIT-001，UNIT-002 仍 pending
    const begun = await units.beginImplementationUnit(root, id, current.revision, "UNIT-001");
    const cp = await checkpoints.checkpointImplementationUnit(root, id, begun.revision, "UNIT-001");
    assert.equal(cp.state.implementationUnits.find((u) => u.unitId === "UNIT-001").status, "checkpointed");

    // 修订：RU-001 的 fileScope 变化 → 受影响
    const revisedDelta = {
      nodes: [
        { kind: "task", id: "TASK-001", covers: ["REQ-001", "AC-001"], implementationUnit: "UNIT-001" },
        { kind: "task", id: "TASK-002", covers: ["REQ-001", "AC-001"], implementationUnit: "UNIT-002" },
        { kind: "test", id: "TEST-001", verifies: ["AC-001"] },
        { kind: "implementation-unit", id: "UNIT-001", tasks: ["TASK-001"], dependsOn: [], fileScope: ["src/a.ts", "src/c.ts"], covers: ["REQ-001", "AC-001"], forwardVerification: ["unit"] },
        { kind: "implementation-unit", id: "UNIT-002", tasks: ["TASK-002"], dependsOn: [], fileScope: ["src/b.ts"], covers: ["REQ-001", "AC-001"], forwardVerification: ["unit"] },
      ],
    };
    await writeFile(planPath, planMarkdown.replace("file_scope: src/a.ts", "file_scope: src/a.ts, src/c.ts"));
    const preview = await store.revisePlanDuringImplementation(root, id, cp.state.revision, revisedDelta, "codex");
    assert.equal(decisions.pendingDecisionForState(preview.state).kind, "plan-revision");
    assert.deepEqual(preview.interaction.planRevision.affectedUnits, ["UNIT-001"]);
    assert.deepEqual(preview.interaction.planRevision.redoUnits, ["UNIT-001"]);

    // 取消：不改变任何状态
    await store.recordHostEvent(root, { eventId: "cancel", type: "user-prompt", host: "codex", text: "取消" });
    const cancelled = await store.answer({ root, featureId: id, expectedRevision: preview.state.revision, host: "codex", credential: { source: "text", userReply: "取消" } });
    assert.equal(cancelled.state.implementationUnits.find((u) => u.unitId === "UNIT-001").status, "checkpointed");
    assert.deepEqual(cancelled.state.review, cp.state.review);

    // 重新发起修订并确认：计划失效（需重新登记），UNIT-001 回 pending（重做），UNIT-002 保留
    const preview2 = await store.revisePlanDuringImplementation(root, id, cancelled.state.revision, revisedDelta, "codex");
    await store.recordHostEvent(root, { eventId: "confirm", type: "user-prompt", host: "codex", text: "确认修订" });
    const revised = await store.answer({ root, featureId: id, expectedRevision: preview2.state.revision, host: "codex", credential: { source: "text", userReply: "确认修订" } });
    assert.equal(revised.state.implementationUnits.find((u) => u.unitId === "UNIT-001").status, "pending");
    assert.equal(revised.state.implementationUnits.find((u) => u.unitId === "UNIT-002").status, "pending");
    assert.equal(revised.state.currentStage, "planning");
    assert.equal(revised.state.steps.planning, undefined);
    assert.ok(revised.state.traceability, "trace pointer stays until the revised plan is re-registered");
    // 重新登记修订后的计划并推进，重做受影响单元（implementation 步骤在单元完成后登记）
    let reRegistered = (await artifacts.recordArtifactWithTrace(root, id, revised.state.revision, "implementation-plan", revisedDelta)).state;
    reRegistered = await steps.recordStep(root, id, reRegistered.revision, "planning", { reviewType: "plan" });
    const rebegun = await units.beginImplementationUnit(root, id, reRegistered.revision, "UNIT-001");
    assert.equal(rebegun.implementationUnits.find((u) => u.unitId === "UNIT-001").status, "active");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("side-effect units are flagged, kept, and only re-run after explicit user confirmation", async () => {
  const { root, state } = await setupTraceM("dev-flow-plan-revise-side-");
  try {
    const id = state.featureId;
    const planPath = path.join(root, ".dev-flow", "features", id, state.artifacts["implementation-plan"].path);
    const withRecovery = planMarkdown + "<!-- dev-flow:id=REC-001 kind=recovery -->\n### REC-001\n\n- step_ref: TASK-001\n- recovery_kind: compensation\n- method: 从备份恢复\n- risk_ref: data\n";
    await writeFile(planPath, withRecovery);
    const deltaWithRecovery = { nodes: [...planDelta.nodes, { kind: "recovery", id: "REC-001", stepRef: "TASK-001", recoveryKind: "compensation", method: "从备份恢复", riskRef: "data" }] };
    let current = (await artifacts.recordArtifactWithTrace(root, id, state.revision, "implementation-plan", deltaWithRecovery)).state;
    current = await steps.recordStep(root, id, current.revision, "planning", { reviewType: "plan" });
    const begun = await units.beginImplementationUnit(root, id, current.revision, "UNIT-001");
    await checkpoints.checkpointImplementationUnit(root, id, begun.revision, "UNIT-001");

    const revisedDelta = { nodes: deltaWithRecovery.nodes.map((node) => node.kind === "implementation-unit" && node.id === "UNIT-001" ? { ...node, fileScope: ["src/a.ts", "src/c.ts"] } : node) };
    await writeFile(planPath, withRecovery.replace("file_scope: src/a.ts", "file_scope: src/a.ts, src/c.ts"));
    const currentState = await store.readState(root, id);
    const preview = await store.revisePlanDuringImplementation(root, id, currentState.revision, revisedDelta, "codex");
    assert.deepEqual(preview.interaction.planRevision.sideEffectUnits, ["UNIT-001"]);
    assert.match(preview.interaction.question, /有副作用的操作/);

    // 确认修订：副作用单元保持 checkpointed，不自动重跑；出现人工决定交互
    await store.recordHostEvent(root, { eventId: "confirm-side", type: "user-prompt", host: "codex", text: "确认修订" });
    const revised = await store.answer({ root, featureId: id, expectedRevision: preview.state.revision, host: "codex", credential: { source: "text", userReply: "确认修订" } });
    assert.equal(revised.state.implementationUnits.find((u) => u.unitId === "UNIT-001").status, "checkpointed");
    assert.equal(decisions.pendingDecisionForState(revised.state).kind, "side-effect-rerun");
    const rerun = Object.values(revised.state.interactions).find((value) => value.kind === "side-effect-rerun" && value.status === "pending");
    assert.ok(rerun, "side-effect-rerun interaction must be presented");
    assert.match(rerun.question, /有副作用的操作/);

    // 重新登记修订后的计划并推进到 implementation 后，未确认前 begin 仍被阻塞
    let reRegistered = (await artifacts.recordArtifactWithTrace(root, id, revised.state.revision, "implementation-plan", revisedDelta)).state;
    reRegistered = await steps.recordStep(root, id, reRegistered.revision, "planning", { reviewType: "plan" });
    await assert.rejects(
      () => units.beginImplementationUnit(root, id, reRegistered.revision, "UNIT-001"),
      (error) => error.code === "SIDE_EFFECT_UNIT_PENDING_CONFIRMATION",
    );

    // 拒绝重跑：单元保持 checkpointed（保留原结果），交互解决，不能 begin 已完成单元
    await store.recordHostEvent(root, { eventId: "keep-side", type: "user-prompt", host: "codex", text: "不重跑，保留原结果" });
    const kept = await store.answer({ root, featureId: id, expectedRevision: reRegistered.revision, host: "codex", credential: { source: "text", userReply: "不重跑，保留原结果" } });
    assert.equal(kept.state.implementationUnits.find((u) => u.unitId === "UNIT-001").status, "checkpointed");
    assert.equal(decisions.pendingDecisionForState(kept.state), undefined);
    await assert.rejects(
      () => units.beginImplementationUnit(root, id, kept.state.revision, "UNIT-001"),
      (error) => error.code === "IMPLEMENTATION_UNIT_NOT_PENDING",
    );

    // 再次修订并确认重跑：单元回 pending，可重新 begin 重做
    const revisedDelta2 = { nodes: revisedDelta.nodes.map((node) => node.kind === "implementation-unit" && node.id === "UNIT-001" ? { ...node, fileScope: ["src/a.ts", "src/c.ts", "src/d.ts"] } : node) };
    await writeFile(planPath, withRecovery.replace("file_scope: src/a.ts", "file_scope: src/a.ts, src/c.ts, src/d.ts"));
    const currentState2 = await store.readState(root, id);
    const preview2 = await store.revisePlanDuringImplementation(root, id, currentState2.revision, revisedDelta2, "codex");
    await store.recordHostEvent(root, { eventId: "confirm-side-2", type: "user-prompt", host: "codex", text: "确认修订" });
    const revised2 = await store.answer({ root, featureId: id, expectedRevision: preview2.state.revision, host: "codex", credential: { source: "text", userReply: "确认修订" } });
    const rerun2 = Object.values(revised2.state.interactions).find((value) => value.kind === "side-effect-rerun" && value.status === "pending");
    assert.ok(rerun2);
    let reRegistered2 = (await artifacts.recordArtifactWithTrace(root, id, revised2.state.revision, "implementation-plan", revisedDelta2)).state;
    reRegistered2 = await steps.recordStep(root, id, reRegistered2.revision, "planning", { reviewType: "plan" });
    await store.recordHostEvent(root, { eventId: "rerun-side", type: "user-prompt", host: "codex", text: "确认重跑" });
    const rerunConfirmed = await store.answer({ root, featureId: id, expectedRevision: reRegistered2.revision, host: "codex", credential: { source: "text", userReply: "确认重跑" } });
    assert.equal(rerunConfirmed.state.implementationUnits.find((u) => u.unitId === "UNIT-001").status, "pending");
    assert.equal(rerunConfirmed.state.steps.implementation, undefined);
    const rebegun = await units.beginImplementationUnit(root, id, rerunConfirmed.state.revision, "UNIT-001");
    assert.equal(rebegun.implementationUnits.find((u) => u.unitId === "UNIT-001").status, "active");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("plan revision confirmation rejects a preview whose plan file changed without a state revision", async () => {
  const { root, state } = await setupTraceM("dev-flow-plan-revise-stale-");
  try {
    const id = state.featureId;
    const planPath = path.join(root, ".dev-flow", "features", id, state.artifacts["implementation-plan"].path);
    await writeFile(planPath, planMarkdown);
    let current = (await artifacts.recordArtifactWithTrace(root, id, state.revision, "implementation-plan", planDelta)).state;
    current = await steps.recordStep(root, id, current.revision, "planning", { reviewType: "plan" });

    const revisedDelta = {
      nodes: planDelta.nodes.map((node) => node.kind === "implementation-unit" && node.id === "UNIT-001"
        ? { ...node, fileScope: ["src/a.ts", "src/c.ts"] }
        : node),
    };
    await writeFile(planPath, planMarkdown.replace("file_scope: src/a.ts", "file_scope: src/a.ts, src/c.ts"));
    const preview = await store.revisePlanDuringImplementation(root, id, current.revision, revisedDelta, "codex");

    // IDE edits do not change feature revision; confirmation must still detect the changed basis.
    await writeFile(planPath, `${planMarkdown.replace("file_scope: src/a.ts", "file_scope: src/a.ts, src/c.ts")}\n<!-- changed after preview -->\n`);
    await assert.rejects(
      () => store.answer({ root, featureId: id, expectedRevision: preview.state.revision, host: "codex", credential: { source: "elicitation", action: "confirm" } }),
      (error) => error.code === "PLAN_REVISION_STALE",
    );
    const unchanged = await store.readState(root, id);
    assert.equal(unchanged.currentStage, "implementation");
    assert.equal(unchanged.interactions[preview.interactionId].status, "pending");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
