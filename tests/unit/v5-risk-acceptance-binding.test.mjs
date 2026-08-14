import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { loadSource } from "../helpers/load-source.mjs";

const store = await loadSource("plugins/dev-flow/src/core/state-store.ts");
const steps = await loadSource("plugins/dev-flow/src/core/feature-check.ts");
const verification = await loadSource("plugins/dev-flow/src/core/verification.ts");
const quality = await loadSource("plugins/dev-flow/src/core/quality-exceptions.ts");
const next = await loadSource("plugins/dev-flow/src/core/next.ts");
const inspection = await loadSource("plugins/dev-flow/src/core/inspection.ts");
const fingerprintSource = await loadSource("plugins/dev-flow/src/core/fingerprint.ts");
const invalidation = await loadSource("plugins/dev-flow/src/core/change-invalidation.ts");

const okCommand = { id: "unit-ok", command: process.execPath, args: ["-e", "process.exit(0)"], cwd: ".", provides: ["targeted", "behavior", "integration", "full"] };
const failCommand = { id: "unit-fail", command: process.execPath, args: ["-e", "process.exit(1)"], cwd: ".", provides: ["targeted", "behavior", "integration", "full"] };

const config = {
  schemaVersion: 2,
  verification: { commands: [okCommand, failCommand] },
  enforcement: { mode: "strict", gitWriteRequiresLogicComplete: true, oneActiveFeature: true, requireExplicitHumanReply: true },
  governedRoots: ["src"],
};

async function setupXS() {
  const root = await mkdtemp(path.join(os.tmpdir(), "dev-flow-risk-"));
  await mkdir(path.join(root, "src"));
  await store.initProject(root, config);
  let state = await store.startFeature(root, {
    featureId: "risk",
    host: "codex",
    level: "XS",
    topology: "local",
    scopeFacts: ["scope"],
    topologyFacts: ["topology"],
    uncertaintyFacts: [],
    riskFacts: {},
    decisionRefs: [],
  });
  state = await steps.recordStep(root, state.featureId, state.revision, "locate", {});
  state = await steps.recordStep(root, state.featureId, state.revision, "implementation", { files: [] });
  return { root, state };
}

async function changeContent(root, id, revision, file, contents) {
  await writeFile(path.join(root, file), contents);
  return store.mutate(root, id, revision, "test-content-change", (draft) => {
    draft.workspace.ownership[file] = "feature";
    draft.workspace.ownershipSource[file] = "test-hook";
    draft.workspace.unownedPaths = (draft.workspace.unownedPaths ?? []).filter((f) => f !== file);
  });
}

async function acceptVerificationRisk(root, state) {
  const fp = await fingerprintSource.fingerprintGovernedRoots(root, config);
  const presented = await quality.presentQualityException(root, state.featureId, state.revision, {
    kind: "verification",
    basisHash: "a".repeat(64),
    fingerprint: fp,
    riskSummary: "验证失败但风险可接受",
  });
  return (await store.answer({
    root, featureId: state.featureId, expectedRevision: presented.state.revision, host: "codex",
    credential: { source: "elicitation", action: "accept", comment: "接受验证风险" },
  })).state;
}

test("accepted risk lets finalize complete while the failed verification stays pending", async () => {
  const { root, state } = await setupXS();
  try {
    const id = state.featureId;
    const failed = await verification.runVerification(root, id, state.revision, "codex", ["unit-fail"]);
    assert.equal(failed.steps.verification.status, "pending");
    const accepted = await acceptVerificationRisk(root, failed);
    assert.equal(accepted.governance.authorizations.length, 1);
    // next 与门禁使用相同结论：验证不再阻塞推进
    const action = await next.nextAction(root, id);
    assert.equal(action.kind, "finalize");
    const finalized = await steps.finalize(root, id, accepted.revision);
    assert.equal(finalized.lifecycle, "finalized");
    // 失败检查不被改写为通过：steps.verification 仍是 pending
    assert.equal(finalized.steps.verification.status, "pending");
    // 报告显示“风险已接受”而非“验证通过”
    assert.ok(finalized.deliverySnapshot.qualityExceptions.includes("verification"));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("content changes stale the accepted risk and reopen verification", async () => {
  const { root, state } = await setupXS();
  try {
    const id = state.featureId;
    const failed = await verification.runVerification(root, id, state.revision, "codex", ["unit-fail"]);
    const accepted = await acceptVerificationRisk(root, failed);
    // 内容变化 → finalize 门禁拦截：旧接受 stale，验证重新打开
    await writeFile(path.join(root, "src", "app.js"), "export const value = 1;\n");
    await assert.rejects(
      () => steps.finalize(root, id, accepted.revision),
      (error) => error.code === "WORKSPACE_CHANGED",
    );
    const after = await store.readState(root, id);
    assert.equal(quality.hasCurrentQualityException(after, "verification"), false);
    assert.equal(after.governance.authorizations.length, 1);
    assert.equal(after.steps.verification.status, "pending");
    // 内容变化后 next 回到验证步骤
    const action = await next.nextAction(root, id);
    assert.equal(action.kind, "run-step");
    assert.equal(action.step, "verification");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("auto-recheck passing after content changes needs no second acceptance", async () => {
  const { root, state } = await setupXS();
  try {
    const id = state.featureId;
    const failed = await verification.runVerification(root, id, state.revision, "codex", ["unit-fail"]);
    const accepted = await acceptVerificationRisk(root, failed);
    // 内容变化自动传播失效（不要求用户再次接受风险）：旧接受变 stale
    const changed = await changeContent(root, id, accepted.revision, "src/app.js", "export const value = 2;\n");
    assert.ok(await invalidation.invalidateAffectedClaims(root, id, changed.revision));
    const reopened = await store.readState(root, id);
    assert.equal(quality.hasCurrentQualityException(reopened, "verification"), false);
    // 问题消失：重新验证通过 → finalize 成功，不再询问
    const verified = await verification.runVerification(root, id, reopened.revision, "codex", ["unit-ok"]);
    assert.equal(verified.steps.verification.status, "satisfied");
    const finalized = await steps.finalize(root, id, verified.revision);
    assert.equal(finalized.lifecycle, "finalized");
    assert.equal(quality.hasCurrentQualityException(finalized, "verification"), false);
    assert.equal(finalized.governance.authorizations.length, 1);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("re-failing verification on new content creates a fresh acceptance interaction", async () => {
  const { root, state } = await setupXS();
  try {
    const id = state.featureId;
    const failed = await verification.runVerification(root, id, state.revision, "codex", ["unit-fail"]);
    const accepted = await acceptVerificationRisk(root, failed);
    const changed = await changeContent(root, id, accepted.revision, "src/app.js", "export const value = 3;\n");
    assert.ok(await invalidation.invalidateAffectedClaims(root, id, changed.revision));
    const reopened = await store.readState(root, id);
    assert.equal(quality.hasCurrentQualityException(reopened, "verification"), false);
    // 同一问题在新内容上仍存在：再次验证失败 → 可以再次接受（新交互）
    const refailed = await verification.runVerification(root, id, reopened.revision, "codex", ["unit-fail"]);
    const reAccepted = await acceptVerificationRisk(root, refailed);
    assert.equal(reAccepted.governance.authorizations.length, 2);
    assert.equal(quality.hasCurrentQualityException(reAccepted, "verification"), true);
    const finalized = await steps.finalize(root, id, reAccepted.revision);
    assert.equal(finalized.lifecycle, "finalized");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("accepting a risk is rejected when verification already passed the same content", async () => {
  const { root, state } = await setupXS();
  try {
    const id = state.featureId;
    const verified = await verification.runVerification(root, id, state.revision, "codex", ["unit-ok"]);
    assert.equal(verified.steps.verification.status, "satisfied");
    await assert.rejects(
      () => quality.presentQualityException(root, id, verified.revision, {
        kind: "verification",
        basisHash: "a".repeat(64),
        fingerprint: verified.verification.verifiedFingerprint,
        riskSummary: "没有真实风险",
      }),
      (error) => error.code === "QUALITY_EXCEPTION_NOT_NEEDED",
    );
    const after = await store.readState(root, id);
    assert.equal(after.governance.authorizations.length, 0);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("inspect shows the same current risk acceptance conclusion as gates", async () => {
  const { root, state } = await setupXS();
  try {
    const id = state.featureId;
    const failed = await verification.runVerification(root, id, state.revision, "codex", ["unit-fail"]);
    const accepted = await acceptVerificationRisk(root, failed);
    const current = await inspection.inspectFeature(root, id, "verification");
    assert.equal(current.content.riskAcceptance[0].status, "current");
    assert.equal(current.content.passed, false);
    // 内容变化后同一 inspect 展示 stale 结论（与门禁一致）
    const changed = await changeContent(root, id, accepted.revision, "src/app.js", "export const value = 4;\n");
    assert.ok(await invalidation.invalidateAffectedClaims(root, id, changed.revision));
    const reopened = await store.readState(root, id);
    assert.equal(quality.hasCurrentQualityException(reopened, "verification"), false);
    const staleView = await inspection.inspectFeature(root, id, "verification");
    assert.equal(staleView.content.riskAcceptance[0].status, "stale");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
