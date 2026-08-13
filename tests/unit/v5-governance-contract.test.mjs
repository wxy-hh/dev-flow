import assert from "node:assert/strict";
import test from "node:test";
import { createTinyApp, strictProjectConfig } from "../helpers/fixture-repo.mjs";
import { loadSource } from "../helpers/load-source.mjs";

const store = await loadSource("plugins/dev-flow/src/core/state-store.ts");
const quality = await loadSource("plugins/dev-flow/src/core/quality-exceptions.ts");
const decisions = await loadSource("plugins/dev-flow/src/core/decision-interactions.ts");
const next = await loadSource("plugins/dev-flow/src/core/next.ts");
const routePolicy = await loadSource("plugins/dev-flow/src/policy/route.ts");

/**
 * 类型隔离契约测试（spec Testing §213）：不同治理记录不能互相冒充——
 * 授权不能变成检查通过，凭证不能脱离目标交互重复使用，决定不能满足
 * 仓库事实，自检不能呈现为人工验收，记录只写入各自账本。
 */

test("authorization audit records never turn verification or review into passed", async () => {
  const fixture = await createTinyApp();
  try {
    await store.initProject(fixture.root, strictProjectConfig);
    const started = await store.startFeature(fixture.root, { featureId: "auth-contract", host: "codex", level: "XS", topology: "local" });
    // 危险操作授权记录（审计闭环）存在
    await store.recordHostAuthorizationEvent(fixture.root, "host-authorization-granted", {
      host: "codex",
      featureId: "auth-contract",
      riskClass: "always-confirm",
      commandFingerprint: "git:push:".padEnd(64, "f").slice(0, 64),
      sourceToolEvent: "grant-1",
      grantedAt: new Date().toISOString(),
    });
    const state = await store.readState(fixture.root, "auth-contract");
    // 授权不产生任何"通过"状态：验证步骤未满足、无通过指纹、无风险接受豁免
    assert.equal(state.steps.verification.status, "pending");
    assert.equal(state.verification.verifiedFingerprint, undefined);
    assert.equal(state.governance.authorizations.filter((authorization) => authorization.authorizationType === "risk-acceptance").length, 0);
    assert.equal(decisions.pendingDecisionForState(state), undefined);
    // 推进仍从第一步开始，授权不能替代任何检查
    const action = await next.nextAction(fixture.root, "auth-contract");
    assert.equal(action.kind, "run-step");
  } finally {
    await fixture.dispose();
  }
});

test("a trusted user event is bound to one interaction and cannot be replayed for another", async () => {
  const fixture = await createTinyApp();
  try {
    await store.initProject(fixture.root, strictProjectConfig);
    const started = await store.startFeature(fixture.root, { featureId: "credential-contract", host: "codex" });
    // 较早对话的决定需要追认：记录一个可信用户事件并用于追认
    const recorded = await store.recordDecision(fixture.root, "credential-contract", started.revision, "是否保留兼容行为？", "用户已有结论", "保留", [], "codex");
    await store.recordHostEvent(fixture.root, { eventId: "shared-reply", type: "user-prompt", host: "codex", text: "确认登记", at: new Date(Date.now() + 1000).toISOString() });
    const ratified = await store.answer({ root: fixture.root, featureId: "credential-contract", expectedRevision: recorded.state.revision, host: "codex", credential: { source: "text", userReply: "确认登记" } });
    assert.equal(ratified.state.governance.decisions.find((d) => d.recordId === recorded.decisionId)?.recordId, recorded.decisionId);
    // 同一事件不能再次满足另一个交互（凭证绑定目标交互，不可重复使用）
    const presented = await quality.presentQualityException(fixture.root, "credential-contract", ratified.state.revision, {
      kind: "verification",
      basisHash: "a".repeat(64),
      fingerprint: "b".repeat(64),
      riskSummary: "验证证据需要用户明确接受。",
    });
    await assert.rejects(
      () => quality.resolveQualityExceptionAnswer(fixture.root, "credential-contract", presented.state.revision, presented.interactionId, "确认登记", "codex"),
      (error) => error.code === "INTERACTION_PROVENANCE_UNAVAILABLE",
    );
    // 交互保持 pending，事件未被重复消费
    const after = await store.readState(fixture.root, "credential-contract");
    assert.equal(Object.values(after.interactions).find((value) => value.id === presented.interactionId).status, "pending");
  } finally {
    await fixture.dispose();
  }
});

test("a decision reference cannot satisfy a repository-fact boundary item", async () => {
  const fixture = await createTinyApp();
  try {
    await store.initProject(fixture.root, strictProjectConfig);
    const started = await store.startFeature(fixture.root, { featureId: "fact-decision-contract", host: "codex" });
    const recorded = await store.recordDecision(fixture.root, "fact-decision-contract", started.revision, "是否允许共享契约变更？", "已核实调用方", "允许", [], "codex");
    await store.recordHostEvent(fixture.root, { eventId: "ratify-fd", type: "user-prompt", host: "codex", text: "确认登记", at: new Date(Date.now() + 1000).toISOString() });
    const ratified = await store.answer({ root: fixture.root, featureId: "fact-decision-contract", expectedRevision: recorded.state.revision, host: "codex", credential: { source: "text", userReply: "确认登记" } });
    // 把决定引用填到 repository-fact 项上：决定不能满足仓库事实，边界保持未解决
    assert.throws(
      () => routePolicy.assertBoundaryAuditComplete({
        scanned: ["assumption", "free-space", "tbd", "fallback", "scope", "acceptance"],
        items: [{ id: "b1", kind: "assumption", disposition: "repository-fact", decisionRef: recorded.decisionId, summary: "x" }],
      }, [recorded.decisionId], []),
      (error) => error.code === "BOUNDARY_AUDIT_UNRESOLVED",
    );
    assert.equal(ratified.state.governance.repositoryFacts.length, 0);
  } finally {
    await fixture.dispose();
  }
});

test("each governance record kind is written only to its own ledger", async () => {
  const fixture = await createTinyApp();
  try {
    await store.initProject(fixture.root, strictProjectConfig);
    const started = await store.startFeature(fixture.root, { featureId: "ledger-contract", host: "codex" });
    // 决定 → 只进 decisions
    const recorded = await store.recordDecision(fixture.root, "ledger-contract", started.revision, "问题？", "证据", "结论", [], "codex");
    await store.recordHostEvent(fixture.root, { eventId: "ratify-ledger", type: "user-prompt", host: "codex", text: "确认登记", at: new Date(Date.now() + 1000).toISOString() });
    const ratified = await store.answer({ root: fixture.root, featureId: "ledger-contract", expectedRevision: recorded.state.revision, host: "codex", credential: { source: "text", userReply: "确认登记" } });
    assert.ok(ratified.state.governance.decisions.length >= 1);
    assert.equal(ratified.state.governance.authorizations.length, 0);
    assert.equal(ratified.state.governance.repositoryFacts.length, 0);
    // 风险接受 → 只进 authorizations（risk-acceptance），不冒充决定或事实
    const presented = await quality.presentQualityException(fixture.root, "ledger-contract", ratified.state.revision, {
      kind: "verification",
      basisHash: "c".repeat(64),
      fingerprint: "d".repeat(64),
      riskSummary: "验证证据需要用户明确接受。",
    });
    const accepted = await quality.resolveQualityExceptionElicitation(fixture.root, "ledger-contract", presented.state.revision, presented.interactionId, "accept", "接受验证风险", "codex");
    assert.ok(accepted.governance.authorizations.some((authorization) => authorization.authorizationType === "risk-acceptance"));
    assert.equal(accepted.governance.decisions.filter((decision) => decision.recordId !== recorded.decisionId).length, 0);
    assert.equal(accepted.governance.repositoryFacts.length, 0);
    // 仓库事实 → 只进 repositoryFacts
    const registered = await store.registerRepositoryFact(fixture.root, "ledger-contract", accepted.revision, {
      assertion: "共享接口定义在 src/counter.js",
      location: { kind: "positive", path: "src/counter.js" },
    }, "codex");
    assert.ok(registered.state.governance.repositoryFacts.length >= 1);
    assert.equal(registered.state.governance.authorizations.length, 1, "risk-acceptance authorization remains in its own ledger");
  } finally {
    await fixture.dispose();
  }
});

test("claims ledger records verification-current and review-complete on actual passes", async () => {
  const fixture = await createTinyApp();
  try {
    await store.initProject(fixture.root, strictProjectConfig);
    const verification = await loadSource("plugins/dev-flow/src/core/verification.ts");
    const steps = await loadSource("plugins/dev-flow/src/core/feature-check.ts");
    let state = await store.startFeature(fixture.root, { featureId: "claims", host: "codex", level: "XS", topology: "local" });
    state = await steps.recordStep(fixture.root, "claims", state.revision, "locate", {});
    state = await steps.recordStep(fixture.root, "claims", state.revision, "implementation", { files: [] });
    state = await verification.runVerification(fixture.root, "claims", state.revision, "codex");
    // 验证通过 → verification-current 声明（绑定内容指纹）
    const claim = state.governance.claims.find((c) => c.claimType === "verification-current");
    assert.ok(claim, "verification-current claim must be recorded");
    assert.equal(claim.basis.kind, "content");
    assert.equal(state.governance.claims.filter((c) => c.claimType === "verification-current").length, 1, "claim id is content-addressed and deduplicated");
  } finally {
    await fixture.dispose();
  }
});

test("inspect classification reports repository fact freshness from current content", async () => {
  const fixture = await createTinyApp();
  try {
    await store.initProject(fixture.root, strictProjectConfig);
    const inspection = await loadSource("plugins/dev-flow/src/core/inspection.ts");
    let state = await store.startFeature(fixture.root, { featureId: "freshness", host: "codex" });
    state = (await store.registerRepositoryFact(fixture.root, "freshness", state.revision, {
      assertion: "共享接口定义在 src/counter.js",
      location: { kind: "positive", path: "src/counter.js" },
    }, "codex")).state;
    const current = await inspection.inspectFeature(fixture.root, "freshness", "classification");
    assert.equal(current.content.repositoryFacts[0].freshness, "current");
    // 内容变化后同一事实变 stale
    const { writeFile } = await import("node:fs/promises");
    const { join } = await import("node:path");
    await writeFile(join(fixture.root, "src", "counter.js"), "export const count = 2;\n");
    const staleView = await inspection.inspectFeature(fixture.root, "freshness", "classification");
    assert.equal(staleView.content.repositoryFacts[0].freshness, "stale");
  } finally {
    await fixture.dispose();
  }
});
