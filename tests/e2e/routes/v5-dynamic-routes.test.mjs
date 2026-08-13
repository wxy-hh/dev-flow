import assert from "node:assert/strict";
import test from "node:test";
import { execFile } from "node:child_process";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { createTinyApp, strictProjectConfig } from "../../helpers/fixture-repo.mjs";
import { loadSource } from "../../helpers/load-source.mjs";

const run = promisify(execFile);

const route = await loadSource("plugins/dev-flow/src/policy/route.ts");
const store = await loadSource("plugins/dev-flow/src/core/state-store.ts");
const decisions = await loadSource("plugins/dev-flow/src/core/decision-interactions.ts");

const boundaryAudit = { scanned: ["assumption", "free-space", "tbd", "fallback", "scope", "acceptance"], items: [] };

// v5 分类引用已登记的仓库事实记录（ADR-0018），不接受调用方自写事实散文；
// 纯函数测试只需引用形状合法，集成测试用 registerFixtureFacts 登记真实事实。
function basis(signals, riskFacts = {}) {
  return {
    scopeFactRefs: ["fact-scope"],
    topologyFactRefs: ["fact-topology"],
    uncertaintyFactRefs: [],
    riskFactRefs: Object.fromEntries(Object.keys(riskFacts).map((label) => [label, [`fact-${label}`]])),
    decisionRefs: [],
    signals,
  };
}

function signals(overrides = {}) {
  return {
    changeSurface: "single-site",
    behaviorChange: "mechanical",
    topology: "local",
    unitCount: 1,
    requirements: "provided-confirmed",
    operationalRecovery: false,
    executableRollback: false,
    ...overrides,
  };
}

/** 登记一条绑定已提交文件的仓库事实，返回其后继状态与 recordId。 */
async function registerFixtureFacts(root, featureId, revision) {
  const factPath = "src/classification-facts.txt";
  await writeFile(path.join(root, factPath), "fixture classification facts\n");
  await run("git", ["add", "--", factPath], { cwd: root });
  await run("git", ["-c", "user.name=Dev Flow Tests", "-c", "user.email=tests@example.invalid", "commit", "--quiet", "-m", "fixture classification facts", "--", factPath], { cwd: root });
  const registered = await store.registerRepositoryFact(root, featureId, revision, {
    assertion: "fixture classification facts",
    location: { kind: "positive", path: factPath },
  }, "codex");
  return { state: registered.state, factRef: registered.recordId };
}

test("5.0 classification matrix derives four levels and risk only adds controls", () => {
  assert.equal(route.recommendClassification(basis(signals())).classification.level, "XS");
  assert.equal(route.recommendClassification(basis(signals({ changeSurface: "single-component", behaviorChange: "bounded-rule" }))).classification.level, "S");
  assert.equal(route.recommendClassification(basis(signals({ changeSurface: "multi-component", behaviorChange: "new-capability" }))).classification.level, "M");
  assert.equal(route.recommendClassification(basis(signals({ changeSurface: "system-wide", behaviorChange: "systemic-change" }))).classification.level, "L");
  const risky = route.recommendClassification(basis(signals(), { security: ["fact-security"] }));
  assert.equal(risky.classification.level, "XS");
  assert.equal(risky.classification.controls.executionApproval, true);
  assert.deepEqual(risky.classification.controls.verification, ["targeted", "behavior"]);
});

test("same M level compiles different deterministic routes from controls", () => {
  const local = route.recommendClassification(basis(signals({ changeSurface: "multi-component", behaviorChange: "bounded-rule" })));
  const shared = route.recommendClassification(basis(signals({ changeSurface: "multi-component", behaviorChange: "bounded-rule", topology: "shared-contract" })));
  assert.equal(local.route, "m");
  assert.equal(shared.route, "m");
  assert.equal(local.classification.controls.planReview, false);
  assert.equal(shared.classification.controls.planReview, true);
  assert.notDeepEqual(local.classification.orderedRoute, shared.classification.orderedRoute);
});

test("M route confirmation atomically locks through a trusted later host event", async () => {
  const fixture = await createTinyApp();
  try {
    await store.initProject(fixture.root, strictProjectConfig);
    const intake = await store.startFeature(fixture.root, { featureId: "route-confirm", host: "codex" });
    const { state: withFact, factRef } = await registerFixtureFacts(fixture.root, intake.featureId, intake.revision);
    const pending = await store.lockClassification(fixture.root, intake.featureId, withFact.revision, {
      ...basis(signals({ changeSurface: "multi-component", behaviorChange: "new-capability" })),
      scopeFactRefs: [factRef],
      topologyFactRefs: [factRef],
      level: "M",
      topology: "local",
      requirements: "provided-confirmed",
    }, boundaryAudit);
    assert.equal(pending.mode, "intake");
    assert.equal(decisions.pendingDecisionForState(pending).kind, "route-confirmation");
    await store.recordHostEvent(fixture.root, { eventId: "route-confirm-user", type: "user-prompt", host: "codex", text: "确认这条路线" });
    const routed = await store.confirmRouteClassification(fixture.root, pending.featureId, pending.revision, "确认这条路线", "codex");
    assert.equal(routed.mode, "routed");
    assert.equal(routed.route, "m");
    assert.equal(decisions.pendingDecisionForState(routed), undefined);
  } finally {
    await fixture.dispose();
  }
});

test("route lock rejects missing non-preflight guarantees before creating route state", async () => {
  const fixture = await createTinyApp();
  try {
    await store.initProject(fixture.root, {
      ...strictProjectConfig,
      verification: {
        commands: [{ ...strictProjectConfig.verification.commands[0], provides: ["targeted"] }],
      },
    });
    const intake = await store.startFeature(fixture.root, { featureId: "missing-guarantee", host: "codex" });
    const { state: withFact, factRef } = await registerFixtureFacts(fixture.root, intake.featureId, intake.revision);
    await assert.rejects(
      () => store.lockClassification(fixture.root, intake.featureId, withFact.revision, {
        ...basis(signals({ changeSurface: "multi-component", behaviorChange: "new-capability" })),
        scopeFactRefs: [factRef],
        topologyFactRefs: [factRef],
        level: "M", topology: "local", requirements: "provided-confirmed",
      }, boundaryAudit),
      (error) => error.code === "VERIFICATION_GUARANTEE_UNCONFIGURED" && error.details.missingGuarantees.includes("behavior"),
    );
    const state = await store.readState(fixture.root, intake.featureId);
    assert.equal(state.mode, "intake");
    assert.equal(decisions.pendingDecisionForState(state), undefined);
  } finally {
    await fixture.dispose();
  }
});
