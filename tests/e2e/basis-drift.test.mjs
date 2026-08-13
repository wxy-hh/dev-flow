// 切片 3（04-basis-drift-reminder）：依据偏移提醒。
// 已落账/待决决定在其依据偏移时提示变化并要求重新呈现，而非让用户重答。
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { createTinyApp, strictProjectConfig } from "../helpers/fixture-repo.mjs";
import { loadSource } from "../helpers/load-source.mjs";

const store = await loadSource("plugins/dev-flow/src/core/state-store.ts");
const decisions = await loadSource("plugins/dev-flow/src/core/decision-interactions.ts");

const boundaryAudit = { scanned: ["assumption", "free-space", "tbd", "fallback", "scope", "acceptance"], items: [] };

/** 登记一条绑定已提交文件的仓库事实（v5 分类引用事实记录，ADR-0018）。 */
async function registerFixtureFact(root, featureId, revision) {
  await writeFile(path.join(root, "src", "drift-fact.txt"), "single module evidence\n");
  execFileSync("git", ["add", "src/drift-fact.txt"], { cwd: root });
  execFileSync("git", ["commit", "-qm", "drift fact"], { cwd: root });
  const withFact = await store.registerRepositoryFact(root, featureId, revision, {
    assertion: "只改一个模块",
    location: { kind: "positive", path: "src/drift-fact.txt" },
  }, "claude");
  return {
    factRef: withFact.recordId,
    revision: withFact.state.revision,
  };
}

async function statePath(fixture, featureId) {
  return path.join(fixture.root, ".dev-flow", "features", featureId, "state.json");
}

test("路线确认依据偏移时拒绝落账并提示重新呈现（依据偏移提醒）", async () => {
  const fixture = await createTinyApp();
  try {
    await store.initProject(fixture.root, strictProjectConfig);
    const started = await store.startFeature(fixture.root, { featureId: "drift-route", objective: "测试依据偏移提醒", host: "claude" });
    const { factRef, revision: afterFact } = await registerFixtureFact(fixture.root, "drift-route", started.revision);
    const pending = await store.lockClassification(fixture.root, "drift-route", afterFact, {
      scopeFactRefs: [factRef], topologyFactRefs: [factRef], uncertaintyFactRefs: [],
      riskFactRefs: {}, decisionRefs: [],
      signals: { changeSurface: "multi-component", behaviorChange: "new-capability", topology: "local", unitCount: 1, requirements: "provided-confirmed", operationalRecovery: false, executableRollback: false },
      level: "M", topology: "local", requirements: "provided-confirmed",
    }, boundaryAudit);
    assert.equal(decisions.pendingDecisionForState(pending).kind, "route-confirmation");

    // 模拟呈现后分类依据被另一会话/更新改变（basisHash 偏移）。
    const file = await statePath(fixture, "drift-route");
    const state = JSON.parse(await readFile(file, "utf8"));
    state.routeConfirmation.basisHash = "0".repeat(64);
    await writeFile(file, JSON.stringify(state, null, 2));

    await store.recordHostEvent(fixture.root, { eventId: "drift-answer", type: "user-prompt", host: "claude", text: "确认这条路线" });
    await assert.rejects(
      () => store.answer({ root: fixture.root, featureId: "drift-route", expectedRevision: pending.revision, host: "claude", credential: { source: "text", userReply: "确认这条路线" } }),
      (error) => {
        assert.equal(error.code, "ROUTE_CONFIRMATION_STALE");
        assert.match(error.message, /依据已变化/);
        return true;
      },
    );
    const unchanged = await store.readState(fixture.root, "drift-route");
    assert.equal(unchanged.mode, "intake");
    assert.equal(unchanged.revision, pending.revision, "偏移拒绝不得推进状态");
    assert.equal(decisions.pendingDecisionForState(unchanged).kind, "route-confirmation", "问题保持待回答，等待重新呈现");
  } finally { await fixture.dispose(); }
});
