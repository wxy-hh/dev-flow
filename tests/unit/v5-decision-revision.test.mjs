import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { loadSource } from "../helpers/load-source.mjs";

const store = await loadSource("plugins/dev-flow/src/core/state-store.ts");
const artifacts = await loadSource("plugins/dev-flow/src/core/artifacts.ts");
const decisions = await loadSource("plugins/dev-flow/src/core/decision-interactions.ts");

const config = {
  schemaVersion: 2,
  verification: { commands: [{ id: "unit", command: process.execPath, args: ["-e", "process.exit(0)"], cwd: ".", provides: ["targeted", "behavior", "integration", "full"] }] },
  enforcement: { mode: "strict", gitWriteRequiresLogicComplete: true, oneActiveFeature: true, requireExplicitHumanReply: true },
  governedRoots: ["src"],
};

const facts = {
  level: "M", topology: "local", requirements: "provided-confirmed",
  scopeFactRefs: [], topologyFactRefs: [], uncertaintyFactRefs: [], riskFactRefs: {}, decisionRefs: ["DEC-ratify-me"],
  signals: { changeSurface: "multi-component", behaviorChange: "new-capability", topology: "local", unitCount: 1, requirements: "provided-confirmed", operationalRecovery: false, executableRollback: false },
};
const boundaryAudit = { scanned: ["assumption", "free-space", "tbd", "fallback", "scope", "acceptance"], items: [] };

async function setup(prefix, withRatifiedDecision = true) {
  const root = await mkdtemp(path.join(os.tmpdir(), prefix));
  await mkdir(path.join(root, "src"));
  await store.initProject(root, config);
  let state = await store.startFeature(root, { featureId: "f", host: "codex" });
  if (withRatifiedDecision) {
    const presented = await store.recordDecision(root, "f", state.revision, "是否保留兼容行为？", "历史兼容测试仍存在", "保留兼容行为", ["fact-1"], "codex");
    await store.recordHostEvent(root, { eventId: "ratify", type: "user-prompt", host: "codex", text: "确认登记" });
    state = (await store.answer({ root, featureId: "f", expectedRevision: presented.state.revision, host: "codex", credential: { source: "text", userReply: "确认登记" } })).state;
  }
  return { root, state };
}

test("reviseDecision previews old decision, new conclusion, and affected work; cancel changes nothing", async () => {
  const { root, state } = await setup("dev-flow-revise-preview-");
  try {
    const decisionId = state.governance.decisions[0].recordId;
    const preview = await store.reviseDecision(root, "f", state.revision, decisionId, "不再保留兼容行为", "用户改变主意", "codex");
    assert.match(preview.interaction.question, /将把“是否保留兼容行为？”的当前决定“保留兼容行为”修订为“不再保留兼容行为”/);
    assert.match(preview.interaction.question, /原因：用户改变主意/);
    assert.equal(preview.interaction.revision.oldConclusion, "保留兼容行为");
    assert.equal(preview.interaction.revision.newConclusion, "不再保留兼容行为");
    assert.equal(decisions.pendingDecisionForState(preview.state).kind, "decision-revision");

    // 取消：决定、阶段与已有工作均不改变。
    await store.recordHostEvent(root, { eventId: "cancel", type: "user-prompt", host: "codex", text: "取消" });
    const cancelled = await store.answer({ root, featureId: "f", expectedRevision: preview.state.revision, host: "codex", credential: { source: "text", userReply: "取消" } });
    assert.equal(cancelled.state.governance.decisions[0].supersededBy, undefined);
    assert.equal(cancelled.state.governance.decisions.length, 1);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("confirming a revision appends the successor, supersedes the old record, and binds the trusted credential", async () => {
  const { root, state } = await setup("dev-flow-revise-confirm-");
  try {
    const decisionId = state.governance.decisions[0].recordId;
    const preview = await store.reviseDecision(root, "f", state.revision, decisionId, "不再保留兼容行为", "用户改变主意", "codex");
    await store.recordHostEvent(root, { eventId: "revise-ok", type: "user-prompt", host: "codex", text: "确认修订" });
    const revised = await store.answer({ root, featureId: "f", expectedRevision: preview.state.revision, host: "codex", credential: { source: "text", userReply: "确认修订" } });

    assert.equal(revised.state.governance.decisions.length, 2);
    assert.match(revised.state.governance.decisions[0].supersededBy, /^DEC-/);
    const successor = revised.state.governance.decisions[1];
    assert.equal(successor.conclusion, "不再保留兼容行为");
    assert.notEqual(successor.recordId, decisionId, "successor must have its own content-addressed id");
    // governance 层同步修订链 + 凭证绑定
    const govOld = revised.state.governance.decisions.find((d) => d.recordId === decisionId);
    assert.equal(govOld.supersededBy, successor.recordId);
    const govNew = revised.state.governance.decisions.find((d) => d.recordId === successor.recordId);
    assert.equal(govNew.credentialId, `CRED-rev-${preview.interactionId}`);
    assert.equal(govNew.basis.eventId, "revise-ok");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("native form confirmation appends the revised decision instead of only resolving the interaction", async () => {
  const { root, state } = await setup("dev-flow-revise-native-");
  try {
    const decisionId = state.governance.decisions[0].recordId;
    const preview = await store.reviseDecision(root, "f", state.revision, decisionId, "不再保留兼容行为", "用户改变主意", "codex");
    const revised = await store.answer({ root, featureId: "f", expectedRevision: preview.state.revision, host: "codex", credential: { source: "elicitation", action: "confirm" } });

    assert.equal(revised.state.governance.decisions.length, 2);
    assert.equal(revised.state.governance.decisions[1].conclusion, "不再保留兼容行为");
    assert.equal(revised.state.governance.credentials.at(-1).source, "native-form");
    assert.equal(revised.state.governance.credentials.at(-1).optionId, "confirm");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("revising a decision that does not affect classification keeps the confirmed route without re-asking", async () => {
  const { root, state } = await setup("dev-flow-revise-route-keep-");
  try {
    // 锁定路线但 decisionRefs 不引用该决定（决定不影响分类依据）
    const locked = await store.lockClassification(root, "f", state.revision, { ...facts, decisionRefs: [] }, boundaryAudit);
    await store.recordHostEvent(root, { eventId: "route-ok", type: "user-prompt", host: "codex", text: "确认这条路线" });
    const routed = (await store.answer({ root, featureId: "f", expectedRevision: locked.revision, host: "codex", credential: { source: "text", userReply: "确认这条路线" } })).state;
    assert.equal(routed.mode, "routed");
    const decisionId = state.governance.decisions[0].recordId;
    const preview = await store.reviseDecision(root, "f", routed.revision, decisionId, "不再保留兼容行为", "用户改变主意", "codex");
    // 范围/风险/可见路线不变：affected 不含 classification
    assert.ok(!preview.interaction.revision.affected.includes("classification"));
    await store.recordHostEvent(root, { eventId: "revise-keep", type: "user-prompt", host: "codex", text: "确认修订" });
    const revised = await store.answer({ root, featureId: "f", expectedRevision: preview.state.revision, host: "codex", credential: { source: "text", userReply: "确认修订" } });
    // 路线与分类保留，不重复确认路线
    assert.equal(revised.state.mode, "routed");
    assert.equal(revised.state.route, "m");
    assert.equal(revised.state.routeConfirmation, undefined, "已确认的路线确认状态保持消费后形态");
    assert.equal(revised.state.governance.decisions.length, 2);
    assert.ok(revised.state.governance.decisions[0].supersededBy);
    assert.equal(revised.state.currentStage, "requirements_alignment");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("revising a classification-referenced decision invalidates classification and plan artifacts, keeping unrelated work", async () => {
  const { root, state } = await setup("dev-flow-revise-class-");
  try {
    // 锁定分类（decisionRefs 引用已追认决策）并确认路线
    const decisionId = state.governance.decisions.find((d) => d.question === "是否保留兼容行为？").recordId;
    const classificationFacts = { ...facts, decisionRefs: [decisionId] };
    const locked = await store.lockClassification(root, "f", state.revision, classificationFacts, boundaryAudit);
    await store.recordHostEvent(root, { eventId: "route-ok", type: "user-prompt", host: "codex", text: "确认这条路线" });
    const routed = (await store.answer({ root, featureId: "f", expectedRevision: locked.revision, host: "codex", credential: { source: "text", userReply: "确认这条路线" } })).state;
    assert.equal(routed.mode, "routed");
    // 模拟已登记需求与计划工件
    const withArtifacts = await store.mutate(root, "f", routed.revision, "test-artifacts", (draft) => {
      draft.artifacts.requirements = { path: "requirements.md", sha256: "a".repeat(64) };
      draft.artifacts["implementation-plan"] = { path: "plan.md", sha256: "b".repeat(64) };
    });

    const preview = await store.reviseDecision(root, "f", withArtifacts.revision, decisionId, "不再保留兼容行为", "范围调整", "codex");
    assert.deepEqual(preview.interaction.revision.affected, ["classification", "requirements", "plan"]);
    assert.match(preview.interaction.question, /预计影响：分类/);

    await store.recordHostEvent(root, { eventId: "revise-ok", type: "user-prompt", host: "codex", text: "确认修订" });
    const revised = await store.answer({ root, featureId: "f", expectedRevision: preview.state.revision, host: "codex", credential: { source: "text", userReply: "确认修订" } });
    // 分类失效：回到 intake，保留决策记录；路线确认被清除，走正常确认流程。
    assert.equal(revised.state.mode, "intake");
    assert.equal(revised.state.route, undefined);
    assert.equal(revised.state.routeConfirmation, undefined);
    assert.equal(revised.state.governance.decisions.length, 2);
    // 需求与计划工件失效：需要重新登记。
    assert.equal(revised.state.artifacts.requirements, undefined);
    assert.equal(revised.state.artifacts["implementation-plan"], undefined);
    // 无关工作保留：历史决策仍在账本中（superseded 链完整）。
    assert.ok(revised.state.governance.decisions[0].supersededBy);
    assert.equal(revised.state.governance.decisions.find((d) => d.recordId === decisionId).supersededBy, preview.decisionId);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("a superseded decision reference fails boundary audit at lock time", async () => {
  const { root, state } = await setup("dev-flow-revise-superseded-");
  try {
    const decisionId = state.governance.decisions[0].recordId;
    // 修订并确认：旧决定 superseded
    const preview = await store.reviseDecision(root, "f", state.revision, decisionId, "不再保留兼容行为", "用户改变主意", "codex");
    await store.recordHostEvent(root, { eventId: "revise-sup", type: "user-prompt", host: "codex", text: "确认修订" });
    const revised = await store.answer({ root, featureId: "f", expectedRevision: preview.state.revision, host: "codex", credential: { source: "text", userReply: "确认修订" } });
    assert.ok(revised.state.governance.decisions.find((d) => d.recordId === decisionId).supersededBy);
    // 引用已被取代的决定锁定分类 → 边界未解决
    await assert.rejects(
      () => store.lockClassification(root, "f", revised.state.revision, { ...facts, decisionRefs: [decisionId] }, boundaryAudit),
      (error) => error.code === "BOUNDARY_DECISION_SUPERSEDED",
    );
    // 引用修订后的当前决定（supersededBy 指向的记录）→ 正常锁定
    const successorId = revised.state.governance.decisions.find((d) => d.recordId === decisionId).supersededBy;
    const locked = await store.lockClassification(root, "f", revised.state.revision, { ...facts, decisionRefs: [successorId] }, boundaryAudit);
    assert.ok(locked.routeConfirmation);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
