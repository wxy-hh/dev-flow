import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { loadSource } from "../helpers/load-source.mjs";

// ADR-0020：首次锁定只有一处写入 seam —— applyLock。测试主打 applyLock
// （经测试用 mutatePrepared 承接 prepare 身体），lockClassification 与
// answer 各留一条接线，从而没有第二套字段赋值。

const store = await loadSource("plugins/dev-flow/src/core/state-store.ts");
const routeWorkflow = await loadSource("plugins/dev-flow/src/core/route-workflow.ts");
const route = await loadSource("plugins/dev-flow/src/policy/route.ts");
const stepOrder = await loadSource("plugins/dev-flow/src/core/step-order.ts");
const decisions = await loadSource("plugins/dev-flow/src/core/decision-interactions.ts");

const fullConfig = {
  schemaVersion: 2,
  verification: { commands: [{ id: "unit", command: process.execPath, args: ["-e", "process.exit(0)"], cwd: ".", provides: ["targeted", "behavior", "integration", "full"] }] },
  enforcement: { mode: "strict", gitWriteRequiresLogicComplete: true, oneActiveFeature: true, requireExplicitHumanReply: true },
  governedRoots: ["src"],
};

const boundaryAudit = { scanned: ["assumption", "free-space", "tbd", "fallback", "scope", "acceptance"], items: [] };

function xsFacts() {
  return {
    level: "XS", topology: "local", requirements: "provided-confirmed",
    scopeFactRefs: [], topologyFactRefs: [], uncertaintyFactRefs: [], riskFactRefs: {}, decisionRefs: [],
    signals: { changeSurface: "single-site", behaviorChange: "mechanical", topology: "local", unitCount: 1, requirements: "provided-confirmed", operationalRecovery: false, executableRollback: false },
  };
}

// M + shared-contract + unitCount2：plan_review / execution_approval 出现在
// orderedRoute（可见预览），但不可作为可 record 步骤；同时开启 trace 与 review。
function gatedFacts() {
  return {
    level: "M", topology: "shared-contract", requirements: "provided-confirmed",
    scopeFactRefs: [], topologyFactRefs: [], uncertaintyFactRefs: [], riskFactRefs: {}, decisionRefs: [],
    signals: { changeSurface: "multi-component", behaviorChange: "new-capability", topology: "shared-contract", unitCount: 2, requirements: "provided-confirmed", operationalRecovery: false, executableRollback: false },
  };
}

async function setup(prefix, config = fullConfig) {
  const root = await mkdtemp(path.join(os.tmpdir(), prefix));
  await mkdir(path.join(root, "src"));
  await store.initProject(root, config);
  const started = await store.startFeature(root, { featureId: "f", host: "codex" });
  return { root, state: started };
}

function basisHashFor(facts) {
  const selected = route.selectBaseRoute(facts);
  return createHash("sha256").update(JSON.stringify({ facts, route: selected.classification.orderedRoute, controls: selected.classification.controls })).digest("hex");
}

/** 首次锁定写入的同一套 draft 字段（ADR-0020）。 */
const lockFields = (state) => ({
  schemaVersion: state.schemaVersion,
  mode: state.mode,
  route: state.route,
  classification: state.classification,
  classificationBasis: state.classificationBasis,
  obligations: state.obligations,
  workflowCapabilities: state.workflowCapabilities,
  steps: state.steps,
  humanGates: state.humanGates,
  artifacts: state.artifacts,
  verification: state.verification,
  logicComplete: state.logicComplete,
  traceability: state.traceability,
  review: state.review,
});

test("applyLock 直锁：事实 + hash 进去，routed 出来，steps 为编译出的可 record 序列", async () => {
  const { root, state } = await setup("dev-flow-apply-ok-");
  try {
    const facts = xsFacts();
    const routed = await store.mutatePrepared(root, "f", state.revision, "classification-locked", routeWorkflow.applyLock({ root, facts, basisHash: basisHashFor(facts) }));
    assert.equal(routed.mode, "routed");
    assert.equal(routed.route, "xs");
    assert.equal(routed.revision, state.revision + 1);
    assert.deepEqual(Object.keys(routed.steps), ["locate", "implementation", "verification", "finalize"]);
    assert.ok(Object.values(routed.steps).every((step) => step.status === "pending"));
    assert.equal(stepOrder.currentOpenStep(routed), "locate");
    assert.deepEqual(routed.humanGates, {});
    assert.deepEqual(routed.verification, { attempts: [] });
    assert.equal(routed.logicComplete, false);
    assert.ok(!("plan_review" in routed.steps) && !("execution_approval" in routed.steps));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("applyLock 直锁：hash 漂移拒绝且不推进 revision", async () => {
  const { root, state } = await setup("dev-flow-apply-hash-");
  try {
    const facts = xsFacts();
    await assert.rejects(
      () => store.mutatePrepared(root, "f", state.revision, "classification-locked", routeWorkflow.applyLock({ root, facts, basisHash: "0".repeat(64) })),
      (error) => {
        assert.equal(error.code, "ROUTE_CONFIRMATION_STALE");
        return true;
      },
    );
    const unchanged = await store.readState(root, "f");
    assert.equal(unchanged.revision, state.revision, "hash 漂移失败不得推进 revision");
    assert.equal(unchanged.mode, "intake");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("applyLock 直锁：需要确认的路线无 pending 时拒绝（无门禁 apply）", async () => {
  const { root, state } = await setup("dev-flow-apply-gate-");
  try {
    const facts = gatedFacts();
    await assert.rejects(
      () => store.mutatePrepared(root, "f", state.revision, "classification-locked", routeWorkflow.applyLock({ root, facts, basisHash: basisHashFor(facts) })),
      (error) => {
        assert.equal(error.code, "ROUTE_CONFIRMATION_REQUIRED");
        return true;
      },
    );
    const unchanged = await store.readState(root, "f");
    assert.equal(unchanged.revision, state.revision);
    assert.equal(unchanged.mode, "intake");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("applyLock 直锁：保证缺失拒绝且不推进 revision（确认仍 pending）", async () => {
  const { root, state } = await setup("dev-flow-apply-guarantee-");
  try {
    const facts = gatedFacts();
    const presented = await store.lockClassification(root, "f", state.revision, facts, boundaryAudit);
    assert.equal(decisions.pendingDecisionForState(presented).kind, "route-confirmation");
    // 确认前削弱配置：路线需要 behavior/integration，配置只剩 targeted。
    const raw = await readFile(path.join(root, ".dev-flow", "project.json"), "utf8");
    const weakened = structuredClone(fullConfig);
    weakened.verification.commands[0].provides = ["targeted"];
    await store.updateProjectConfig(root, weakened, createHash("sha256").update(raw).digest("hex"));
    const confirmation = presented.routeConfirmation;
    await assert.rejects(
      () => store.mutatePrepared(root, "f", presented.revision, "classification-locked", routeWorkflow.applyLock({ root, facts: confirmation.facts, basisHash: confirmation.basisHash })),
      (error) => {
        assert.equal(error.code, "VERIFICATION_GUARANTEE_UNCONFIGURED");
        assert.ok(Array.isArray(error.details.missingGuarantees));
        return true;
      },
    );
    const unchanged = await store.readState(root, "f");
    assert.equal(unchanged.revision, presented.revision, "保证缺失失败不得推进 revision");
    assert.equal(unchanged.mode, "intake");
    assert.equal(decisions.pendingDecisionForState(unchanged).kind, "route-confirmation");
    assert.ok(unchanged.routeConfirmation, "路线确认必须保留，等待补配置后重试");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("applyLock 直锁：已 routed 再锁拒绝且不推进 revision", async () => {
  const { root, state } = await setup("dev-flow-apply-relock-");
  try {
    const facts = xsFacts();
    const routed = await store.mutatePrepared(root, "f", state.revision, "classification-locked", routeWorkflow.applyLock({ root, facts, basisHash: basisHashFor(facts) }));
    await assert.rejects(
      () => store.mutatePrepared(root, "f", routed.revision, "classification-locked", routeWorkflow.applyLock({ root, facts, basisHash: basisHashFor(facts) })),
      (error) => {
        assert.equal(error.code, "CLASSIFICATION_ALREADY_LOCKED");
        return true;
      },
    );
    const unchanged = await store.readState(root, "f");
    assert.equal(unchanged.revision, routed.revision);
    assert.equal(unchanged.mode, "routed");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("lockClassification 无门禁直锁经 applyLock 落账", async () => {
  const { root, state } = await setup("dev-flow-lock-ungated-");
  try {
    const routed = await store.lockClassification(root, "f", state.revision, xsFacts(), boundaryAudit);
    assert.equal(routed.mode, "routed");
    assert.equal(routed.route, "xs");
    assert.deepEqual(Object.keys(routed.steps), ["locate", "implementation", "verification", "finalize"]);
    assert.equal(decisions.pendingDecisionForState(routed), undefined);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("重分类重呈现的路线经 answer 确认走重分类转换（不是 applyLock）", async () => {
  const { root, state } = await setup("dev-flow-apply-reclass-confirm-");
  try {
    const sFacts = {
      level: "S", topology: "local", requirements: "provided-confirmed",
      scopeFactRefs: [], topologyFactRefs: [], uncertaintyFactRefs: [], riskFactRefs: {}, decisionRefs: [],
      signals: { changeSurface: "single-component", behaviorChange: "bounded-rule", topology: "local", unitCount: 1, requirements: "provided-confirmed", operationalRecovery: false, executableRollback: false },
    };
    const routed = await store.lockClassification(root, "f", state.revision, sFacts, boundaryAudit);
    assert.equal(routed.route, "s");
    const reclassified = await store.reclassifyFeature(root, "f", routed.revision, {
      level: "M",
      classificationBasis: {
        scopeFactRefs: [], topologyFactRefs: [], uncertaintyFactRefs: [], riskFactRefs: {}, decisionRefs: [],
        signals: { changeSurface: "multi-component", behaviorChange: "new-capability", topology: "shared-contract", unitCount: 2, requirements: "provided-confirmed", operationalRecovery: false, executableRollback: false },
      },
    }, "发现共享契约跨组件新能力");
    assert.equal(decisions.pendingDecisionForState(reclassified).kind, "route-confirmation");
    assert.equal(reclassified.mode, "routed");
    await store.recordHostEvent(root, { eventId: "route-reclass", type: "user-prompt", host: "codex", text: "确认这条路线" });
    const confirmed = (await store.answer({ root, featureId: "f", expectedRevision: reclassified.revision, host: "codex", credential: { source: "text", userReply: "确认这条路线" } })).state;
    assert.equal(confirmed.mode, "routed");
    assert.equal(confirmed.route, "m");
    assert.equal(decisions.pendingDecisionForState(confirmed), undefined);
    assert.equal(confirmed.routeConfirmation, undefined);
    // 重分类转换不改写 record 步骤语义：plan_review / execution_approval 不进入 steps。
    assert.ok(confirmed.classification.orderedRoute.includes("plan_review"));
    assert.ok(!("plan_review" in confirmed.steps));
    assert.ok(!("execution_approval" in confirmed.steps));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("路线确认经 answer 锁定：字段与直锁同一套，steps 不含计划审查/执行批准，pointer 同 revision", async () => {
  const facts = gatedFacts();
  // 直锁基准：同一份事实在 pending 门禁存在时直接走 applyLock。
  const { root: rootA, state: stateA } = await setup("dev-flow-lock-direct-");
  let directRouted;
  try {
    const presented = await store.lockClassification(rootA, "f", stateA.revision, facts, boundaryAudit);
    const confirmation = presented.routeConfirmation;
    directRouted = await store.mutatePrepared(rootA, "f", presented.revision, "classification-locked", routeWorkflow.applyLock({ root: rootA, facts: confirmation.facts, basisHash: confirmation.basisHash }));
  } finally {
    await rm(rootA, { recursive: true, force: true });
  }

  const { root, state } = await setup("dev-flow-lock-confirm-");
  try {
    const presented = await store.lockClassification(root, "f", state.revision, facts, boundaryAudit);
    assert.equal(presented.routeConfirmation.basisHash.length, 64);
    await store.recordHostEvent(root, { eventId: "route-ok", type: "user-prompt", host: "codex", text: "确认这条路线" });
    const confirmed = (await store.answer({ root, featureId: "f", expectedRevision: presented.revision, host: "codex", credential: { source: "text", userReply: "确认这条路线" } })).state;
    assert.equal(confirmed.mode, "routed");
    assert.equal(confirmed.route, "m");
    assert.equal(decisions.pendingDecisionForState(confirmed), undefined);
    // 门禁在 orderedRoute 中可见，但不可作为可 record 步骤。
    assert.ok(confirmed.classification.orderedRoute.includes("plan_review"));
    assert.ok(confirmed.classification.orderedRoute.includes("execution_approval"));
    assert.ok(!("plan_review" in confirmed.steps));
    assert.ok(!("execution_approval" in confirmed.steps));
    // 追溯与审查 pointer 落在同一 revision：快照内的 stateRevision 与状态 revision 一致。
    assert.equal(confirmed.revision, presented.revision + 1);
    if (confirmed.traceability) {
      const traceSnapshot = JSON.parse(await readFile(path.join(root, ".dev-flow", "features", "f", confirmed.traceability.path), "utf8"));
      assert.equal(traceSnapshot.stateRevision, confirmed.revision);
    }
    if (confirmed.review) {
      const reviewSnapshot = JSON.parse(await readFile(path.join(root, ".dev-flow", "features", "f", confirmed.review.path), "utf8"));
      assert.equal(reviewSnapshot.stateRevision, confirmed.revision);
    }
    // 确认路径的 draft 与直锁同一套字段。
    assert.deepEqual(lockFields(confirmed), lockFields(directRouted));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
