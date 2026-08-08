import assert from "node:assert/strict";
import test from "node:test";
import { createTinyApp, strictProjectConfig } from "../../helpers/fixture-repo.mjs";
import { loadSource } from "../../helpers/load-source.mjs";

const route = await loadSource("plugins/dev-flow/src/policy/route.ts");
const store = await loadSource("plugins/dev-flow/src/core/state-store.ts");

const boundaryAudit = { scanned: ["assumption", "free-space", "tbd", "fallback", "scope", "acceptance"], items: [] };

function basis(signals, riskFacts = {}) {
  return { scopeFacts: ["repository evidence"], topologyFacts: ["call graph evidence"], uncertaintyFacts: [], riskFacts, decisionRefs: [], signals };
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

test("5.0 classification matrix derives four levels and risk only adds controls", () => {
  assert.equal(route.recommendClassification(basis(signals())).classification.level, "XS");
  assert.equal(route.recommendClassification(basis(signals({ changeSurface: "single-component", behaviorChange: "bounded-rule" }))).classification.level, "S");
  assert.equal(route.recommendClassification(basis(signals({ changeSurface: "multi-component", behaviorChange: "new-capability" }))).classification.level, "M");
  assert.equal(route.recommendClassification(basis(signals({ changeSurface: "system-wide", behaviorChange: "systemic-change" }))).classification.level, "L");
  const risky = route.recommendClassification(basis(signals(), { security: ["auth boundary"] }));
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
    const classificationBasis = basis(signals({ changeSurface: "multi-component", behaviorChange: "new-capability" }));
    const pending = await store.lockClassification(fixture.root, intake.featureId, intake.revision, {
      ...classificationBasis,
      level: "M",
      topology: "local",
      requirements: "provided-confirmed",
    }, boundaryAudit);
    assert.equal(pending.mode, "intake");
    assert.equal(pending.pendingDecision.kind, "route-confirmation");
    await store.recordHostEvent(fixture.root, { eventId: "route-confirm-user", type: "user-prompt", host: "codex", text: "确认这条路线" });
    const routed = await store.confirmRouteClassification(fixture.root, pending.featureId, pending.revision, "确认这条路线", "codex");
    assert.equal(routed.mode, "routed");
    assert.equal(routed.route, "m");
    assert.equal(routed.pendingDecision, undefined);
  } finally {
    await fixture.dispose();
  }
});
