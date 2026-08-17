// v6 plan revision transaction tests. Phase 4 enables the first atomic
// proposal/confirm assertions; remaining Phase 4 todos stay disabled.
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { loadSource } from "../helpers/load-source.mjs";
import { v6ImplementationPlanMarkdown, v6RecoveryBlock, v6RequirementsMarkdown } from "../helpers/v6-fixtures.mjs";

const store = await loadSource("plugins/dev-flow/src/core/state-store.ts");
const artifacts = await loadSource("plugins/dev-flow/src/core/artifacts.ts");
const steps = await loadSource("plugins/dev-flow/src/core/feature-check.ts");
const revision = await loadSource("plugins/dev-flow/src/core/plan-revision.ts");
const traceStore = await loadSource("plugins/dev-flow/src/core/traceability-store.ts");
const gates = await loadSource("plugins/dev-flow/src/core/traceability-gates.ts");
const next = await loadSource("plugins/dev-flow/src/core/next.ts");
const jobs = await loadSource("plugins/dev-flow/src/core/review-jobs.ts");
const units = await loadSource("plugins/dev-flow/src/core/implementation-units.ts");
const checkpoints = await loadSource("plugins/dev-flow/src/core/checkpoints.ts");
const decisions = await loadSource("plugins/dev-flow/src/core/decision-interactions.ts");

const projectConfig = {
  schemaVersion: 2,
  verification: { commands: [{ id: "unit", command: process.execPath, args: ["-e", "process.exit(0)"], cwd: ".", provides: ["targeted", "behavior", "integration", "full"] }] },
  enforcement: { mode: "strict", gitWriteRequiresLogicComplete: true, oneActiveFeature: true, requireExplicitHumanReply: true },
  governedRoots: ["src"],
};

async function setup({ planReview = false } = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), "dev-flow-v6-plan-rev-"));
  await mkdir(path.join(root, "src"));
  await store.initProject(root, projectConfig);
  let state = await store.startFeature(root, {
    featureId: "v6revise",
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
      controlEnhancements: { trace: true, ...(planReview ? { planReview: true } : {}) },
    },
  });
  state = await artifacts.scaffoldArtifact(root, state.featureId, state.revision, "requirements");
  await writeFile(path.join(root, ".dev-flow", "features", state.featureId, state.artifacts.requirements.path), v6RequirementsMarkdown());
  state = await artifacts.recordArtifactWithTrace(root, state.featureId, state.revision, "requirements", {
    nodes: [
      { kind: "requirement", id: "REQ-001" },
      { kind: "acceptance-criterion", id: "AC-001", parentRequirement: "REQ-001", verificationDisposition: { kind: "behavior-test" } },
    ],
  });
  state = state.state;
  state = await steps.recordStep(root, state.featureId, state.revision, "requirements_alignment", {});
  state = await artifacts.scaffoldArtifact(root, state.featureId, state.revision, "implementation-plan");
  return { root, state };
}

test("revise_plan preview freezes a proposal and confirm registers artifact and Trace without a second registration", async () => {
  const { root, state } = await setup();
  try {
    const id = state.featureId;
    const planPath = path.join(root, ".dev-flow", "features", id, state.artifacts["implementation-plan"].path);
    await writeFile(planPath, v6ImplementationPlanMarkdown());
    let current = (await artifacts.recordArtifactFromMarkdown(root, id, state.revision, "implementation-plan")).state;
    const originalPlanSha = current.artifacts["implementation-plan"].sha256;

    await writeFile(planPath, v6ImplementationPlanMarkdown({ fileScope: ["src/a.ts"] }));
    const presented = await revision.revisePlanFromMarkdown(root, id, current.revision, "codex");
    assert.equal(presented.interaction.kind, "plan-revision");
    const internal = Object.values(presented.state.interactions ?? {}).find((item) => item.status === "pending");
    assert.ok(internal?.planRevisionProposal, "preview must persist a content-addressed proposal ref");
    assert.deepEqual(presented.interaction.planRevision?.affectedUnits, ["UNIT-001"]);

    const eventId = `revise-confirm-${presented.state.revision}`;
    await store.recordHostEvent(root, { eventId, type: "user-prompt", host: "codex", text: "确认修订" });
    const applied = (await store.answer({
      root,
      featureId: id,
      expectedRevision: presented.state.revision,
      host: "codex",
      credential: { source: "text", userReply: "确认修订" },
    })).state;

    assert.notEqual(applied.artifacts["implementation-plan"].sha256, originalPlanSha);
    const ledger = await traceStore.readTraceability(root, applied);
    const unit = ledger.nodes["UNIT-001"];
    assert.equal(unit.kind, "implementation-unit");
    assert.equal(unit.status, "current");
    assert.deepEqual(unit.fileScope, ["src/a.ts"]);
    assert.equal(unit.sourceSha256, applied.artifacts["implementation-plan"].sha256);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("zero current implementation-plan nodes fail closed as MISSING or STALE", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "dev-flow-v6-zero-slice-"));
  try {
    const state = { artifacts: { "implementation-plan": { path: "实施计划.md", sha256: "0".repeat(64) } } };
    const ledger = { schemaVersion: 1, featureId: "f", revision: 0, stateRevision: 0, projectConfigSha256: "0".repeat(64), nodes: {}, edges: [], summary: { total: 0, current: 0, stale: 0, tombstoned: 0 } };
    await assert.rejects(
      gates.assertImplementationPlanTraceCurrent(root, state, ledger),
      (error) => error.code === "TRACE_SLICE_MISSING",
    );
    ledger.nodes["UNIT-001"] = {
      kind: "implementation-unit", id: "UNIT-001", status: "stale", sourceArtifact: "implementation-plan",
      sourceSha256: "0".repeat(64), sourceAnchor: "anchor", sourceBlockSha256: "0".repeat(64),
      tasks: [], dependsOn: [], fileScope: [], covers: [], forwardVerification: [], verificationConfigSha256: "0".repeat(64),
    };
    await assert.rejects(
      gates.assertImplementationPlanTraceCurrent(root, state, ledger),
      (error) => error.code === "TRACE_SLICE_STALE",
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("confirm rejects a preview whose plan file changed again without a state revision", async () => {
  const { root, state } = await setup();
  try {
    const id = state.featureId;
    const planPath = path.join(root, ".dev-flow", "features", id, state.artifacts["implementation-plan"].path);
    await writeFile(planPath, v6ImplementationPlanMarkdown());
    let current = (await artifacts.recordArtifactFromMarkdown(root, id, state.revision, "implementation-plan")).state;
    await writeFile(planPath, v6ImplementationPlanMarkdown({ fileScope: ["src/a.ts"] }));
    const presented = await revision.revisePlanFromMarkdown(root, id, current.revision, "codex");
    await writeFile(planPath, v6ImplementationPlanMarkdown({ fileScope: ["src/b.ts"] }));
    const eventId = `revise-stale-${presented.state.revision}`;
    await store.recordHostEvent(root, { eventId, type: "user-prompt", host: "codex", text: "确认修订" });
    await assert.rejects(
      store.answer({ root, featureId: id, expectedRevision: presented.state.revision, host: "codex", credential: { source: "text", userReply: "确认修订" } }),
      (error) => error.code === "PLAN_REVISION_STALE",
    );
    const after = await store.readState(root, id);
    assert.equal(after.revision, presented.state.revision);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("confirm-after-preview leaves no intermediate stale Trace and the next create_review_batch succeeds", async () => {
  const { root, state } = await setup({ planReview: true });
  try {
    const id = state.featureId;
    const planPath = path.join(root, ".dev-flow", "features", id, state.artifacts["implementation-plan"].path);
    await writeFile(planPath, v6ImplementationPlanMarkdown());
    const current = (await artifacts.recordArtifactFromMarkdown(root, id, state.revision, "implementation-plan")).state;
    await writeFile(planPath, v6ImplementationPlanMarkdown({ fileScope: ["src/a.ts"] }));
    const presented = await revision.revisePlanFromMarkdown(root, id, current.revision, "codex");
    await store.recordHostEvent(root, { eventId: "confirm-batch", type: "user-prompt", host: "codex", text: "确认修订" });
    const applied = (await store.answer({ root, featureId: id, expectedRevision: presented.state.revision, host: "codex", credential: { source: "text", userReply: "确认修订" } })).state;
    // 确认后无需再次登记：slice 全部 current，assertImplementationPlanTraceCurrent 不抛
    const ledger = await traceStore.readTraceability(root, applied);
    await gates.assertImplementationPlanTraceCurrent(root, applied, ledger);
    // 下一步可直接创建 review batch（无中间 stale Trace）
    const batch = await jobs.createReviewBatch(root, id, applied.revision);
    assert.ok(batch.batch, "createReviewBatch must succeed without an intermediate stale Trace");
    assert.ok(batch.batch.batchId);
    assert.equal(batch.batch.phase, "plan");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("preview impact equals the final old/new compiled projection diff", async () => {
  const { root, state } = await setup();
  try {
    const id = state.featureId;
    const planPath = path.join(root, ".dev-flow", "features", id, state.artifacts["implementation-plan"].path);
    await writeFile(planPath, v6ImplementationPlanMarkdown());
    const current = (await artifacts.recordArtifactFromMarkdown(root, id, state.revision, "implementation-plan")).state;
    await writeFile(planPath, v6ImplementationPlanMarkdown({ fileScope: ["src/a.ts"] }));
    const presented = await revision.revisePlanFromMarkdown(root, id, current.revision, "codex");
    const oldLedger = await traceStore.readTraceability(root, presented.state);
    await store.recordHostEvent(root, { eventId: "impact-confirm", type: "user-prompt", host: "codex", text: "确认修订" });
    const applied = (await store.answer({ root, featureId: id, expectedRevision: presented.state.revision, host: "codex", credential: { source: "text", userReply: "确认修订" } })).state;
    const newLedger = await traceStore.readTraceability(root, applied);
    const impact = revision.computePlanRevisionImpact(oldLedger, newLedger);
    assert.deepEqual(
      [...impact.affectedIds].sort(),
      [...presented.interaction.planRevision.affectedUnits].sort(),
      "preview impact must equal the final old/new compiled projection diff",
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("requirements re-registration stales the plan slice and blocks next and direct plan batch creation", async () => {
  const { root, state } = await setup({ planReview: true });
  try {
    const id = state.featureId;
    const reqPath = path.join(root, ".dev-flow", "features", id, state.artifacts.requirements.path);
    const planPath = path.join(root, ".dev-flow", "features", id, state.artifacts["implementation-plan"].path);
    await writeFile(planPath, v6ImplementationPlanMarkdown());
    let current = (await artifacts.recordArtifactFromMarkdown(root, id, state.revision, "implementation-plan")).state;
    // 重登记 requirements（REQ-001 块内容变化 → block sha 变化 → 计划节点下游变 stale）
    await writeFile(reqPath, v6RequirementsMarkdown().replace("需求正文不参与机器语义。", "需求正文已变更。"));
    current = (await artifacts.recordArtifactFromMarkdown(root, id, current.revision, "requirements")).state;
    const ledger = await traceStore.readTraceability(root, current);
    await assert.rejects(
      gates.assertImplementationPlanTraceCurrent(root, current, ledger),
      (error) => error.code === "TRACE_SLICE_STALE",
    );
    // next 必须先给出 repair-trace，不能先调度 review
    const action = await next.nextAction(root, id);
    assert.equal(action.kind, "repair-trace");
    // 直接创建 plan batch 同样阻断
    await assert.rejects(
      jobs.createReviewBatch(root, id, current.revision),
      (error) => error.code === "TRACE_SLICE_STALE",
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("side-effect checkpointed units keep explicit rerun confirmation after atomic revision", async () => {
  const { root, state } = await setup();
  try {
    const id = state.featureId;
    const planPath = path.join(root, ".dev-flow", "features", id, state.artifacts["implementation-plan"].path);
    const planWithRecovery = v6ImplementationPlanMarkdown() + "\n" + v6RecoveryBlock();
    await writeFile(planPath, planWithRecovery);
    let current = (await artifacts.recordArtifactFromMarkdown(root, id, state.revision, "implementation-plan")).state;
    current = await steps.recordStep(root, id, current.revision, "planning", { reviewType: "plan" });
    const begun = await units.beginImplementationUnit(root, id, current.revision, "UNIT-001");
    await checkpoints.checkpointImplementationUnit(root, id, begun.revision, "UNIT-001");
    // 修订 UNIT-001（fileScope 变化）：副作用单元保持 checkpointed 并出现显式重跑确认
    await writeFile(planPath, planWithRecovery.replace("- file_scope: [src]", "- file_scope: [src, src/a.ts]"));
    const presented = await revision.revisePlanFromMarkdown(root, id, (await store.readState(root, id)).revision, "codex");
    assert.deepEqual(presented.interaction.planRevision.sideEffectUnits, ["UNIT-001"]);
    assert.match(presented.interaction.question, /有副作用的操作/);
    await store.recordHostEvent(root, { eventId: "side-confirm", type: "user-prompt", host: "codex", text: "确认修订" });
    const revised = await store.answer({ root, featureId: id, expectedRevision: presented.state.revision, host: "codex", credential: { source: "text", userReply: "确认修订" } });
    assert.equal(revised.state.implementationUnits.find((unit) => unit.unitId === "UNIT-001").status, "checkpointed");
    assert.equal(decisions.pendingDecisionForState(revised.state).kind, "side-effect-rerun");
    const rerun = Object.values(revised.state.interactions).find((value) => value.kind === "side-effect-rerun" && value.status === "pending");
    assert.ok(rerun, "side-effect-rerun interaction must be presented after atomic revision");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
