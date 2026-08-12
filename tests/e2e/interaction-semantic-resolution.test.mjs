// 切片 1（02-text-semantic-resolution）：文本凭证语义解析。
// 事件只证明"用户在展示后回答过"；回答内容按受控语义等价解析到选项，
// 不再与 agent 转述的 userReply 逐字比较。
// 正例基线：m-level-issue-8499 场景 B/C（带「（推荐）」后缀事件 + 精简/完整转述）。
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { createTinyApp, strictProjectConfig } from "../helpers/fixture-repo.mjs";
import { mcpCall } from "../helpers/host-runner.mjs";
import { buildTestBundles } from "../helpers/test-bundle.mjs";
import { loadSource } from "../helpers/load-source.mjs";

const store = await loadSource("plugins/dev-flow/src/core/state-store.ts");
const decisions = await loadSource("plugins/dev-flow/src/core/decision-interactions.ts");
const bundles = await buildTestBundles();
const server = bundles.pathFor("mcp-server");

const boundaryAudit = { scanned: ["assumption", "free-space", "tbd", "fallback", "scope", "acceptance"], items: [] };

/** 登记一条绑定已提交文件的仓库事实（v5 分类引用事实记录，ADR-0018）。 */
async function registerFixtureFact(root, featureId, revision) {
  await writeFile(path.join(root, "src", "semantic-fact.txt"), "single module evidence\n");
  execFileSync("git", ["add", "src/semantic-fact.txt"], { cwd: root });
  execFileSync("git", ["commit", "-qm", "semantic fact"], { cwd: root });
  const withFact = await store.registerRepositoryFact(root, featureId, revision, {
    assertion: "只改一个模块",
    location: { kind: "positive", path: "src/semantic-fact.txt" },
  }, "claude");
  return {
    factRef: withFact.governance.repositoryFacts[withFact.governance.repositoryFacts.length - 1].recordId,
    revision: withFact.revision,
  };
}

async function lockRouteConfirmation(fixture, featureId) {
  await store.initProject(fixture.root, strictProjectConfig);
  const started = await store.startFeature(fixture.root, { featureId, objective: "测试文本语义解析", host: "claude" });
  const { factRef, revision: afterFact } = await registerFixtureFact(fixture.root, featureId, started.revision);
  const pending = await store.lockClassification(fixture.root, featureId, afterFact, {
    scopeFactRefs: [factRef], topologyFactRefs: [factRef], uncertaintyFactRefs: [],
    riskFactRefs: {}, decisionRefs: [],
    signals: { changeSurface: "multi-component", behaviorChange: "new-capability", topology: "local", unitCount: 1, requirements: "provided-confirmed", operationalRecovery: false, executableRollback: false },
    level: "M", topology: "local", requirements: "provided-confirmed",
  }, boundaryAudit);
  assert.equal(decisions.pendingDecisionForState(pending).kind, "route-confirmation");
  return pending;
}

test("带后缀事件 + 精简 userReply 仍可确认路线（回归 m-level-issue-8499 场景 B）", async () => {
  const fixture = await createTinyApp();
  try {
    const pending = await lockRouteConfirmation(fixture, "route-sem-b");
    await store.recordHostEvent(fixture.root, { eventId: "answer-suffixed", type: "user-prompt", host: "claude", text: "确认这条路线（推荐）" });
    const routed = await store.confirmRouteClassification(fixture.root, pending.featureId, pending.revision, "确认这条路线", "claude");
    assert.equal(routed.mode, "routed");
    assert.equal(routed.route, "m");
    assert.equal(decisions.pendingDecisionForState(routed), undefined);
  } finally { await fixture.dispose(); }
});

test("带后缀 userReply 原样回传仍可确认路线（回归 m-level-issue-8499 场景 C）", async () => {
  const fixture = await createTinyApp();
  try {
    const pending = await lockRouteConfirmation(fixture, "route-sem-c");
    await store.recordHostEvent(fixture.root, { eventId: "answer-full", type: "user-prompt", host: "claude", text: "确认这条路线（推荐）" });
    const routed = await store.confirmRouteClassification(fixture.root, pending.featureId, pending.revision, "确认这条路线（推荐）", "claude");
    assert.equal(routed.mode, "routed");
  } finally { await fixture.dispose(); }
});

test("短答「可以」确认当前唯一待决的路线", async () => {
  const fixture = await createTinyApp();
  try {
    const pending = await lockRouteConfirmation(fixture, "route-sem-short");
    await store.recordHostEvent(fixture.root, { eventId: "answer-short", type: "user-prompt", host: "claude", text: "可以" });
    const routed = await store.confirmRouteClassification(fixture.root, pending.featureId, pending.revision, "可以", "claude");
    assert.equal(routed.mode, "routed");
  } finally { await fixture.dispose(); }
});

test("无确认语义文本「等等」拒绝且不改变状态", async () => {
  const fixture = await createTinyApp();
  try {
    const pending = await lockRouteConfirmation(fixture, "route-sem-neg");
    await store.recordHostEvent(fixture.root, { eventId: "answer-neg", type: "user-prompt", host: "claude", text: "等等" });
    await assert.rejects(
      () => store.confirmRouteClassification(fixture.root, pending.featureId, pending.revision, "等等", "claude"),
      (error) => error.code === "DECISION_REPLY_NOT_RECOGNIZED",
    );
    const unchanged = await store.readState(fixture.root, pending.featureId);
    assert.equal(unchanged.mode, "intake");
    assert.equal(unchanged.revision, pending.revision, "拒绝不得推进 revision");
    assert.equal(decisions.pendingDecisionForState(unchanged).kind, "route-confirmation");
  } finally { await fixture.dispose(); }
});

test("否定前缀文本不与肯定事件兼容（拒绝不能被误判为确认）", async () => {
  const fixture = await createTinyApp();
  try {
    const pending = await lockRouteConfirmation(fixture, "route-sem-negprefix");
    await store.recordHostEvent(fixture.root, { eventId: "answer-affirm", type: "user-prompt", host: "claude", text: "确认这条路线" });
    await assert.rejects(
      () => store.confirmRouteClassification(fixture.root, pending.featureId, pending.revision, "不确认这条路线", "claude"),
      (error) => error.code === "INTERACTION_PROVENANCE_UNAVAILABLE",
    );
    await store.recordHostEvent(fixture.root, { eventId: "answer-affirm-short", type: "user-prompt", host: "claude", text: "可以" });
    await assert.rejects(
      () => store.confirmRouteClassification(fixture.root, pending.featureId, pending.revision, "不可以", "claude"),
      (error) => error.code === "INTERACTION_PROVENANCE_UNAVAILABLE",
    );
    const unchanged = await store.readState(fixture.root, pending.featureId);
    assert.equal(unchanged.mode, "intake");
  } finally { await fixture.dispose(); }
});

test("确认语义词不误伤多意图问题（workspace-ownership「可以」仍拒绝）", async () => {
  const fixture = await createTinyApp();
  try {
    await store.initProject(fixture.root, strictProjectConfig);
    const { mkdir, writeFile } = await import("node:fs/promises");
    for (const file of ["src/extra-a.ts", "src/extra-b.ts"]) {
      const target = new URL(`file://${fixture.root}/${file}`);
      await mkdir(new URL(".", target), { recursive: true });
      await writeFile(target, `// ${file}\n`);
    }
    const started = await store.startFeature(fixture.root, { featureId: "route-sem-own", objective: "测试归属问题语义边界", host: "claude" });
    await store.recordHostEvent(fixture.root, { eventId: "own-can", type: "user-prompt", host: "claude", text: "可以" });
    await assert.rejects(
      () => mcpCall(server, fixture.root, "dev_flow_answer", {
        featureId: "route-sem-own", expectedRevision: started.revision, userReply: "可以", host: "claude",
      }),
      (error) => error.code === "DECISION_REPLY_NOT_RECOGNIZED",
    );
    const unchanged = await store.readState(fixture.root, "route-sem-own");
    assert.equal(unchanged.revision, started.revision);
  } finally { await fixture.dispose(); }
});
