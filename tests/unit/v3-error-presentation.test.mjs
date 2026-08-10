import assert from "node:assert/strict";
import test from "node:test";
import { loadSource } from "../helpers/load-source.mjs";

const errors = await loadSource("plugins/dev-flow/src/core/errors.ts");
const presentation = await loadSource("plugins/dev-flow/src/policy/presentation.ts");
const validation = await loadSource("plugins/dev-flow/src/policy/validation.ts");
const store = await loadSource("plugins/dev-flow/src/core/state-store.ts");

test("failure envelope is Chinese by default and keeps technical data separate", () => {
  const error = new errors.DevFlowError("STATE_REVISION_CONFLICT", "revision mismatch", { currentRevision: 4 });
  const failure = error.toFailure();
  assert.equal(failure.code, "STATE_REVISION_CONFLICT");
  assert.match(failure.userMessage, /当前动作/);
  assert.match(failure.recovery.instruction, /刷新/);
  assert.equal(failure.technical.currentRevision, 4);
  assert.equal(failure.technical.basisChanged, false);
  assert.equal(failure.technical.safeToRefresh, true);
  assert.doesNotMatch(failure.userMessage, /STATE_REVISION_CONFLICT|revision/);
});

test("route and stage presentation never leaks internal route codes as the only label", () => {
  assert.equal(presentation.routeLabel("l"), "L：大型变更（动态治理）");
  assert.equal(presentation.stageLabel("implementation"), "开发实现");
  assert.equal(presentation.lifecycleLabel("paused"), "已暂停");
});

test("policy validation failures surface with their code, not INTERNAL_ERROR", () => {
  const policyError = new validation.PolicyError(
    "BOUNDARY_AUDIT_UNRESOLVED",
    "every boundary item needs repository evidence or a resolved decision",
    { itemId: "scope-1" },
  );
  const failure = errors.failureFrom(policyError);
  assert.equal(failure.code, "BOUNDARY_AUDIT_UNRESOLVED");
  assert.equal(failure.recovery.kind, "retry");
  assert.equal(failure.recovery.requiresUserDecision, false);
  assert.equal(failure.recovery.retryOriginal, true);
  assert.equal(failure.technical.itemId, "scope-1");
  assert.doesNotMatch(failure.userMessage, /BOUNDARY_AUDIT_UNRESOLVED|INTERNAL_ERROR/);
});

test("lockClassification boundary mismatch yields an actionable failure instead of INTERNAL_ERROR", async () => {
  // Reproduces the reported incident: a scope item referencing a decisionRef
  // absent from the classification's decisionRefs used to surface as
  // INTERNAL_ERROR because PolicyError is not a DevFlowError.
  const facts = {
    level: "M",
    topology: "local",
    requirements: "missing-or-unclear",
    scopeFacts: ["dev_flow_start intake scope"],
    topologyFacts: ["single project"],
    uncertaintyFacts: ["mechanism choice open"],
    riskFacts: {},
    decisionRefs: [],
  };
  const audit = {
    scanned: ["assumption", "free-space", "tbd", "fallback", "scope", "acceptance"],
    items: [
      { id: "scope-1", kind: "scope", disposition: "resolved-decision", decisionRef: "dev_flow_start intake scope", summary: "intake scope" },
    ],
  };
  let thrown;
  try {
    await store.lockClassification("/tmp/dev-flow-error-presentation-root", "issue-23052-css-atimport-resolution", 1, facts, audit);
  } catch (error) {
    thrown = error;
  }
  assert.ok(thrown, "lockClassification must reject the unresolved boundary item");
  const failure = errors.failureFrom(thrown);
  assert.equal(failure.code, "BOUNDARY_AUDIT_UNRESOLVED");
  assert.equal(failure.technical.itemId, "scope-1");
  assert.notEqual(failure.code, "INTERNAL_ERROR");
});
