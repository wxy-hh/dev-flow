import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { strictProjectConfig } from "../helpers/fixture-repo.mjs";
import { loadSource } from "../helpers/load-source.mjs";
import { appendSecondTraceClosure, registerTraceFixture, twoClosureTraceDeltaFor } from "../helpers/trace-fixtures.mjs";

const stateStore = await loadSource("plugins/dev-flow/src/core/state-store.ts");
const featureCheck = await loadSource("plugins/dev-flow/src/core/feature-check.ts");
const units = await loadSource("plugins/dev-flow/src/core/implementation-units.ts");
const traceabilityStore = await loadSource("plugins/dev-flow/src/core/traceability-store.ts");
const contract = await loadSource("plugins/dev-flow/src/policy/contract.ts");

const sha = (letter) => letter.repeat(64);
const checkpointsOn = Object.freeze({ trace: 1, review: 0, checkpoints: 1, rollbackExecution: 0 });
const checkpointsOff = Object.freeze({ trace: 1, review: 0, checkpoints: 0, rollbackExecution: 0 });
const reviewAndCheckpoints = Object.freeze({ trace: 1, review: 1, checkpoints: 1, rollbackExecution: 0 });

async function withRoot(run) {
  const root = await mkdtemp(path.join(os.tmpdir(), "dev-flow-units-"));
  try {
    return await run(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

function satisfyPreImplementation(draft) {
  const definition = contract.routeDefinitionForFeature(draft.route, draft.workflowCapabilities);
  for (const step of definition.orderedSteps.slice(0, definition.orderedSteps.indexOf("implementation"))) {
    draft.steps[step] = { status: "satisfied" };
  }
  draft.humanGates.implementation_approval = { status: "confirmed" };
}

/** Registers the full standard-m trace graph and lands the feature on the implementation step. */
async function implementationReadyFeature(root, { capabilities = checkpointsOn, twoClosures = false, dependency = false } = {}) {
  await stateStore.initProject(root, strictProjectConfig);
  await mkdir(path.join(root, "src"));
  await writeFile(path.join(root, "src", "one.ts"), "export const one = 1;\n");
  let state = await stateStore.startFeature(root, {
    featureId: "f", host: "codex", level: "M", topology: "local", execution: "standard", requirements: "provided-confirmed",
  });
  state = await stateStore.mutate(root, "f", state.revision, "units-test-capabilities", (draft) => {
    draft.workflowCapabilities = { ...capabilities };
  });
  state = await registerTraceFixture({
    root, featureId: "f", state, kind: "requirements",
    ...(twoClosures ? {
      delta: twoClosureTraceDeltaFor("requirements", "standard-m"),
      edit: (markdown) => appendSecondTraceClosure(markdown, "requirements", "standard-m"),
    } : {}),
  });
  state = await stateStore.mutate(root, "f", state.revision, "units-test-requirements", (draft) => {
    draft.steps.requirements = { status: "satisfied" };
    draft.steps.requirement_confirmation = { status: "satisfied" };
  });
  let planDelta;
  if (twoClosures) {
    planDelta = twoClosureTraceDeltaFor("implementation-plan", "standard-m");
    if (dependency) planDelta = { nodes: planDelta.nodes.map((node) => node.id === "RU-002" ? { ...node, dependsOn: ["RU-001"] } : node) };
  }
  state = await registerTraceFixture({
    root, featureId: "f", state, kind: "implementation-plan",
    ...(twoClosures ? {
      delta: planDelta,
      edit: (markdown) => appendSecondTraceClosure(markdown, "implementation-plan", "standard-m"),
    } : {}),
  });
  state = await stateStore.mutate(root, "f", state.revision, "units-test-plan", (draft) => {
    draft.steps.implementation_plan = { status: "satisfied" };
  });
  state = await registerTraceFixture({
    root, featureId: "f", state, kind: "coverage-matrix",
    ...(twoClosures ? {
      delta: twoClosureTraceDeltaFor("coverage-matrix", "standard-m"),
      edit: (markdown) => appendSecondTraceClosure(markdown, "coverage-matrix", "standard-m"),
    } : {}),
  });
  return stateStore.mutate(root, "f", state.revision, "units-test-approval", satisfyPreImplementation);
}

async function readLedger(root, state) {
  return traceabilityStore.readTraceability(root, state);
}

test("new features are stamped with checkpoints:1 and the predicate requires trace and a standard route", async () => {
  await withRoot(async (root) => {
    await stateStore.initProject(root, strictProjectConfig);
    const state = await stateStore.startFeature(root, { featureId: "fresh", host: "codex", level: "M", topology: "local", execution: "standard", requirements: "provided-confirmed" });
    assert.equal(state.workflowCapabilities.checkpoints, 1);
  });
  assert.equal(contract.checkpointsEnforcementRequired("standard-m", checkpointsOn), true);
  assert.equal(contract.checkpointsEnforcementRequired("standard-l", checkpointsOn), true);
  assert.equal(contract.checkpointsEnforcementRequired("light-m", checkpointsOn), false);
  assert.equal(contract.checkpointsEnforcementRequired("standard-m", checkpointsOff), false);
  assert.equal(contract.checkpointsEnforcementRequired("standard-m", { trace: 0, review: 0, checkpoints: 1, rollbackExecution: 0 }), false);
});

test("begin derives pending units from the ledger, activates the requested unit, and binds basis plus fingerprint", async () => {
  await withRoot(async (root) => {
    let state = await implementationReadyFeature(root, { twoClosures: true });
    state = await units.beginImplementationUnit(root, "f", state.revision, "RU-001");
    assert.equal(state.implementationUnits.length, 2);
    const active = state.implementationUnits.find((unit) => unit.unitId === "RU-001");
    assert.equal(active.status, "active");
    assert.match(active.basisHash, /^[a-f0-9]{64}$/);
    assert.match(active.startedFingerprint, /^[a-f0-9]{64}$/);
    const pending = state.implementationUnits.find((unit) => unit.unitId === "RU-002");
    assert.equal(pending.status, "pending");
    assert.equal(pending.startedFingerprint, undefined);
    assert.equal(pending.checkpointId, undefined);
  });
});

test("begin rejects unknown units, double active units, and incomplete dependencies", async () => {
  await withRoot(async (root) => {
    let state = await implementationReadyFeature(root, { twoClosures: true, dependency: true });
    await assert.rejects(() => units.beginImplementationUnit(root, "f", state.revision, "RU-009"), /IMPLEMENTATION_UNIT_UNKNOWN/);
    await assert.rejects(() => units.beginImplementationUnit(root, "f", state.revision, "RU-002"), /IMPLEMENTATION_UNIT_DEPENDENCY_INCOMPLETE/);
    state = await units.beginImplementationUnit(root, "f", state.revision, "RU-001");
    await assert.rejects(() => units.beginImplementationUnit(root, "f", state.revision, "RU-002"), /IMPLEMENTATION_UNIT_ALREADY_ACTIVE/);
    state = await stateStore.mutate(root, "f", state.revision, "units-test-checkpointed", (draft) => {
      const unit = draft.implementationUnits.find((candidate) => candidate.unitId === "RU-001");
      unit.status = "checkpointed";
      unit.checkpointId = "CP-001";
    });
    state = await units.beginImplementationUnit(root, "f", state.revision, "RU-002");
    assert.equal(state.implementationUnits.find((unit) => unit.unitId === "RU-002").status, "active");
    assert.equal(state.implementationUnits.find((unit) => unit.unitId === "RU-001").status, "checkpointed");
  });
});

test("begin requires the implementation step, a current trace basis, and a complete review batch", async () => {
  await withRoot(async (root) => {
    let state = await implementationReadyFeature(root);
    state = await stateStore.mutate(root, "f", state.revision, "units-test-early", (draft) => {
      delete draft.steps.plan_review;
      delete draft.steps.implementation_approval;
      draft.humanGates = {};
    });
    await assert.rejects(() => units.beginImplementationUnit(root, "f", state.revision, "RU-001"), /STEP_OUT_OF_ORDER/);
  });
  await withRoot(async (root) => {
    const state = await implementationReadyFeature(root);
    const requirements = path.join(root, ".dev-flow", "features", "f", state.artifacts.requirements.path);
    await writeFile(requirements, `${await import("node:fs/promises").then((fs) => fs.readFile(requirements, "utf8"))}\n未经登记的修改\n`);
    await assert.rejects(() => units.beginImplementationUnit(root, "f", state.revision, "RU-001"), /ARTIFACT_INTEGRITY_FAILED/);
  });
  await withRoot(async (root) => {
    const state = await implementationReadyFeature(root, { capabilities: reviewAndCheckpoints });
    await assert.rejects(() => units.beginImplementationUnit(root, "f", state.revision, "RU-001"), /REVIEW_/);
  });
  await withRoot(async (root) => {
    const state = await implementationReadyFeature(root, { capabilities: checkpointsOff });
    await assert.rejects(() => units.beginImplementationUnit(root, "f", state.revision, "RU-001"), /IMPLEMENTATION_UNITS_NOT_ENFORCED/);
  });
});

test("begin merges pending units with the current ledger after re-registration and preserves checkpointed units", async () => {
  await withRoot(async (root) => {
    let state = await implementationReadyFeature(root, { twoClosures: true });
    state = await units.beginImplementationUnit(root, "f", state.revision, "RU-001");
    const originalBasis = state.implementationUnits.find((unit) => unit.unitId === "RU-001").basisHash;
    state = await stateStore.mutate(root, "f", state.revision, "units-test-checkpointed", (draft) => {
      const unit = draft.implementationUnits.find((candidate) => candidate.unitId === "RU-001");
      unit.status = "checkpointed";
      unit.checkpointId = "CP-001";
    });
    state = await registerTraceFixture({
      root, featureId: "f", state, kind: "requirements",
      delta: twoClosureTraceDeltaFor("requirements", "standard-m"),
      edit: (markdown) => markdown.replace("<!-- dev-flow:id=REQ-001", "补充一段不改变声明区块的说明。\n\n<!-- dev-flow:id=REQ-001"),
    });
    state = await stateStore.mutate(root, "f", state.revision, "units-test-reapproval", satisfyPreImplementation);
    state = await units.beginImplementationUnit(root, "f", state.revision, "RU-002");
    const checkpointed = state.implementationUnits.find((unit) => unit.unitId === "RU-001");
    assert.equal(checkpointed.status, "checkpointed");
    assert.equal(checkpointed.basisHash, originalBasis);
    const activated = state.implementationUnits.find((unit) => unit.unitId === "RU-002");
    assert.equal(activated.status, "active");
    assert.notEqual(activated.basisHash, originalBasis);
  });
});

test("Core write judgment blocks protected writes without an active unit and outside the active unit scope", async () => {
  await withRoot(async (root) => {
    let state = await implementationReadyFeature(root, { twoClosures: true });
    let ledger = await readLedger(root, state);
    assert.equal(units.implementationUnitWriteBlock(state, ledger, "src/one.ts").code, "IMPLEMENTATION_UNIT_REQUIRED");

    state = await units.beginImplementationUnit(root, "f", state.revision, "RU-001");
    ledger = await readLedger(root, state);
    assert.equal(units.implementationUnitWriteBlock(state, ledger, "src/one.ts"), undefined);
    const outOfScope = units.implementationUnitWriteBlock(state, ledger, "src/two.ts");
    assert.equal(outOfScope.code, "IMPLEMENTATION_UNIT_OUT_OF_SCOPE");
    assert.equal(outOfScope.details.unitId, "RU-001");
    assert.deepEqual(outOfScope.details.fileScope, ["src/one.ts"]);

    // The judgment ignores non-enforced features, unapproved features, and other steps.
    const legacy = { ...state, workflowCapabilities: { ...checkpointsOff } };
    assert.equal(units.implementationUnitWriteBlock(legacy, ledger, "src/two.ts"), undefined);
    const unapproved = { ...state, humanGates: {} };
    assert.equal(units.implementationUnitWriteBlock(unapproved, ledger, "src/two.ts"), undefined);
    const pastImplementation = { ...state, steps: { ...state.steps, implementation: { status: "satisfied" } } };
    assert.equal(units.implementationUnitWriteBlock(pastImplementation, ledger, "src/two.ts"), undefined);
    // A missing ledger must fail closed, never open.
    assert.equal(units.implementationUnitWriteBlock(state, undefined, "src/one.ts").code, "IMPLEMENTATION_UNIT_OUT_OF_SCOPE");
  });
});

test("recordStep(implementation) requires every rollback unit checkpointed only when checkpoints are enforced", async () => {
  await withRoot(async (root) => {
    let state = await implementationReadyFeature(root);
    await assert.rejects(
      () => featureCheck.recordStep(root, "f", state.revision, "implementation", { files: ["src/one.ts"] }),
      /IMPLEMENTATION_UNITS_INCOMPLETE/,
    );
    state = await units.beginImplementationUnit(root, "f", state.revision, "RU-001");
    await assert.rejects(
      () => featureCheck.recordStep(root, "f", state.revision, "implementation", { files: ["src/one.ts"] }),
      /IMPLEMENTATION_UNITS_INCOMPLETE/,
    );
    state = await stateStore.mutate(root, "f", state.revision, "units-test-checkpointed", (draft) => {
      const unit = draft.implementationUnits.find((candidate) => candidate.unitId === "RU-001");
      unit.status = "checkpointed";
      unit.checkpointId = "CP-001";
    });
    state = await featureCheck.recordStep(root, "f", state.revision, "implementation", { files: ["src/one.ts"] });
    assert.equal(state.steps.implementation.status, "satisfied");
  });
});

test("a checkpoints:0 feature started before phase 3 still completes implementation without unit state", async () => {
  await withRoot(async (root) => {
    let state = await implementationReadyFeature(root, { capabilities: checkpointsOff });
    state = await featureCheck.recordStep(root, "f", state.revision, "implementation", { files: ["src/one.ts"] });
    assert.equal(state.steps.implementation.status, "satisfied");
    assert.equal(state.implementationUnits, undefined);
  });
});

test("validateFeatureState rejects invalid unit shapes and checkpoints without trace", async () => {
  await withRoot(async (root) => {
    const state = await implementationReadyFeature(root);
    assert.doesNotThrow(() => stateStore.validateFeatureState({
      ...state,
      implementationUnits: [{ unitId: "RU-001", status: "pending", basisHash: sha("a") }],
    }));
    assert.throws(() => stateStore.validateFeatureState({
      ...state,
      implementationUnits: [{ unitId: "RU-001", status: "pending", basisHash: "short" }],
    }), /INVALID_STATE_SCHEMA/);
    // beginNonce must match the policy parser: pending cannot carry one; blank is invalid.
    assert.throws(() => stateStore.validateFeatureState({
      ...state,
      implementationUnits: [{ unitId: "RU-001", status: "pending", basisHash: sha("a"), beginNonce: "nonce" }],
    }), /INVALID_STATE_SCHEMA/);
    assert.throws(() => stateStore.validateFeatureState({
      ...state,
      implementationUnits: [{
        unitId: "RU-001", status: "active", basisHash: sha("a"), startedFingerprint: sha("b"), beginNonce: "   ",
      }],
    }), /INVALID_STATE_SCHEMA/);
    assert.doesNotThrow(() => stateStore.validateFeatureState({
      ...state,
      implementationUnits: [{
        unitId: "RU-001", status: "active", basisHash: sha("a"), startedFingerprint: sha("b"), beginNonce: "nonce-1",
      }],
    }));
    assert.throws(() => stateStore.validateFeatureState({
      ...state,
      implementationUnits: [
        { unitId: "RU-001", status: "checkpointed", basisHash: sha("a"), startedFingerprint: sha("b"), checkpointId: "CP-001" },
        { unitId: "RU-002", status: "checkpointed", basisHash: sha("a"), startedFingerprint: sha("b"), checkpointId: "CP-001" },
      ],
    }), /INVALID_STATE_SCHEMA/);
    // Capability bits are dormant outside their route/trace combination, never invalid state.
    assert.doesNotThrow(() => stateStore.validateFeatureState({
      ...state,
      workflowCapabilities: { trace: 0, review: 0, checkpoints: 1, rollbackExecution: 0 },
    }));
  });
});
