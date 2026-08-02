import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { loadSource } from "../helpers/load-source.mjs";
import {
  appendSecondTraceClosure,
  registerTraceFixture,
  traceDeltaFor,
  twoClosureTraceDeltaFor,
} from "../helpers/trace-fixtures.mjs";

const store = await loadSource("plugins/dev-flow/src/core/state-store.ts");
const artifacts = await loadSource("plugins/dev-flow/src/core/artifacts.ts");
const gateBasis = await loadSource("plugins/dev-flow/src/core/gate-basis.ts");
const traceStore = await loadSource("plugins/dev-flow/src/core/traceability-store.ts");

const config = {
  schemaVersion: 1,
  verification: { commands: [{ id: "unit", command: "node", args: ["-e", "process.exit(0)"], cwd: "." }], behaviorCommands: [] },
  enforcement: { mode: "strict", gitWriteRequiresLogicComplete: true, oneActiveFeature: true, requireExplicitHumanReply: true },
  protectedRoots: ["src"],
};

async function standardFeature(root) {
  await store.initProject(root, config);
  return store.startFeature(root, {
    featureId: "f", host: "codex", level: "M", topology: "local", execution: "standard", requirements: "provided-confirmed",
  });
}

async function twoClosureFeature(root) {
  let state = await standardFeature(root);
  state = await registerTraceFixture({
    root, featureId: "f", state, kind: "requirements",
    delta: twoClosureTraceDeltaFor("requirements", "standard-m"),
    edit: (markdown) => appendSecondTraceClosure(markdown, "requirements", "standard-m"),
  });
  state = await store.mutate(root, "f", state.revision, "ready-for-plan", (draft) => {
    draft.steps.requirements = { status: "satisfied" };
    draft.steps.requirement_confirmation = { status: "satisfied" };
  });
  state = await registerTraceFixture({
    root, featureId: "f", state, kind: "implementation-plan",
    delta: twoClosureTraceDeltaFor("implementation-plan", "standard-m"),
    edit: (markdown) => appendSecondTraceClosure(markdown, "implementation-plan", "standard-m"),
  });
  state = await store.mutate(root, "f", state.revision, "ready-for-coverage", (draft) => {
    draft.steps.implementation_plan = { status: "satisfied" };
  });
  return registerTraceFixture({
    root, featureId: "f", state, kind: "coverage-matrix",
    delta: twoClosureTraceDeltaFor("coverage-matrix", "standard-m"),
    edit: (markdown) => appendSecondTraceClosure(markdown, "coverage-matrix", "standard-m"),
  });
}

function approveTraceWorkflow(draft) {
  for (const step of ["requirements", "requirement_confirmation", "implementation_plan", "coverage_review", "plan_review", "implementation_approval"]) {
    draft.steps[step] = { status: "satisfied" };
  }
  draft.humanGates.requirement_confirmation = { status: "confirmed" };
  draft.humanGates.implementation_approval = { status: "confirmed" };
}

test("trace-enforced artifacts reject bare registration and generated artifacts stay read-only", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "dev-flow-trace-artifacts-"));
  try {
    let state = await standardFeature(root);
    state = await artifacts.scaffoldArtifact(root, "f", state.revision, "requirements");
    await assert.rejects(() => artifacts.recordArtifact(root, "f", state.revision, "requirements"), /TRACE_AWARE_REGISTRATION_REQUIRED/);
    await assert.rejects(() => artifacts.recordArtifact(root, "f", state.revision, "status"), /GENERATED_ARTIFACT_READ_ONLY/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("artifact and trace pointer register in one CAS and preserve old state on failures", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "dev-flow-trace-artifacts-cas-"));
  try {
    let state = await standardFeature(root);
    state = await registerTraceFixture({ root, featureId: "f", state, kind: "requirements" });
    assert.equal(state.revision, 2);
    assert.equal(state.traceability.revision, 1);
    assert.equal((await traceStore.readTraceability(root, state)).nodes["REQ-001"].status, "current");

    const stable = await store.readState(root, "f");
    await assert.rejects(
      () => artifacts.recordArtifactWithTrace(root, "f", stable.revision - 1, "requirements", traceDeltaFor("requirements", "standard-m")),
      /STATE_REVISION_CONFLICT/,
    );
    assert.deepEqual(await store.readState(root, "f"), stable);

    const requirements = path.join(root, ".dev-flow", "features", "f", stable.artifacts.requirements.path);
    const originalRequirements = await readFile(requirements, "utf8");
    await writeFile(requirements, "# missing anchors\n");
    await assert.rejects(
      () => artifacts.recordArtifactWithTrace(root, "f", stable.revision, "requirements", traceDeltaFor("requirements", "standard-m")),
      /TRACE_SOURCE_ANCHOR_INVALID/,
    );
    assert.deepEqual(await store.readState(root, "f"), stable);

    await writeFile(requirements, originalRequirements);
    await assert.rejects(
      () => artifacts.recordArtifactWithTrace(root, "f", stable.revision, "requirements", traceDeltaFor("requirements", "standard-m"), {
        mutation: { fault: (point) => { if (point === "before-state-commit") throw new Error("injected"); } },
      }),
      /injected/,
    );
    assert.deepEqual(await store.readState(root, "f"), stable);

    await writeFile(requirements, `${originalRequirements}\n- snapshot fault change\n`);
    await assert.rejects(
      () => artifacts.recordArtifactWithTrace(root, "f", stable.revision, "requirements", traceDeltaFor("requirements", "standard-m"), {
        snapshot: { fault: (point) => { if (point === "before-temp-write") throw new Error("snapshot injected"); } },
      }),
      /snapshot injected/,
    );
    assert.deepEqual(await store.readState(root, "f"), stable);
    await writeFile(requirements, originalRequirements);

    let readyForPlan = await store.mutate(root, "f", stable.revision, "seed-requirement-stage", (draft) => {
      draft.steps.requirements = { status: "satisfied" };
      draft.steps.requirement_confirmation = { status: "satisfied" };
    });
    readyForPlan = await artifacts.scaffoldArtifact(root, "f", readyForPlan.revision, "implementation-plan");
    const beforeUnknownCommand = await store.readState(root, "f");
    const invalidPlanDelta = structuredClone(traceDeltaFor("implementation-plan", "standard-m"));
    invalidPlanDelta.nodes.find((node) => node.kind === "rollback").forwardVerification = ["unknown-command"];
    await assert.rejects(
      () => artifacts.recordArtifactWithTrace(root, "f", beforeUnknownCommand.revision, "implementation-plan", invalidPlanDelta),
      /TRACE_GRAPH_INVALID/,
    );
    assert.deepEqual(await store.readState(root, "f"), beforeUnknownCommand);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("only the originating Trace artifact can repair a legacy unsafe fileScope snapshot", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "dev-flow-trace-file-scope-repair-"));
  try {
    let state = await standardFeature(root);
    state = await registerTraceFixture({ root, featureId: "f", state, kind: "requirements" });
    state = await store.mutate(root, "f", state.revision, "ready-for-plan", (draft) => {
      draft.steps.requirements = { status: "satisfied" };
      draft.steps.requirement_confirmation = { status: "satisfied" };
    });
    state = await registerTraceFixture({ root, featureId: "f", state, kind: "implementation-plan" });

    const legacy = await traceStore.readTraceability(root, state);
    legacy.nodes["RU-001"].fileScope = ["../x"];
    const legacyPointer = await traceStore.writeTraceSnapshot(root, legacy);
    state = await store.mutate(root, "f", state.revision, "seed-legacy-unsafe-file-scope", (draft) => {
      draft.traceability = legacyPointer;
    });
    await assert.rejects(() => traceStore.readTraceability(root, state), /TRACEABILITY_INTEGRITY_FAILED/);

    const beforeWrongSource = await store.readState(root, "f");
    await assert.rejects(
      () => artifacts.recordArtifactWithTrace(root, "f", beforeWrongSource.revision, "requirements", traceDeltaFor("requirements", "standard-m")),
      /TRACEABILITY_INTEGRITY_FAILED/,
    );
    assert.deepEqual(await store.readState(root, "f"), beforeWrongSource);

    const illegalRepair = structuredClone(traceDeltaFor("implementation-plan", "standard-m"));
    illegalRepair.nodes.find((node) => node.kind === "rollback").fileScope = ["../still-bad"];
    await assert.rejects(
      () => artifacts.recordArtifactWithTrace(root, "f", beforeWrongSource.revision, "implementation-plan", illegalRepair),
      /TRACE_GRAPH_INVALID/,
    );
    assert.deepEqual(await store.readState(root, "f"), beforeWrongSource);
    const stillBroken = await store.readState(root, "f");
    await assert.rejects(() => traceStore.readTraceability(root, stillBroken), /TRACEABILITY_INTEGRITY_FAILED/);

    state = await artifacts.recordArtifactWithTrace(root, "f", beforeWrongSource.revision, "implementation-plan", traceDeltaFor("implementation-plan", "standard-m"));
    const repaired = await traceStore.readTraceability(root, state);
    assert.deepEqual(repaired.nodes["RU-001"].fileScope, ["src"]);
    assert.notDeepEqual(state.traceability, legacyPointer);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("standard L rollback-units source can repair its own legacy unsafe fileScope snapshot", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "dev-flow-trace-file-scope-repair-l-"));
  try {
    await store.initProject(root, config);
    let state = await store.startFeature(root, {
      featureId: "f", host: "codex", level: "L", topology: "multi-chain", execution: "standard", requirements: "provided-confirmed",
    });
    assert.equal(state.route, "standard-l");
    state = await registerTraceFixture({ root, featureId: "f", state, kind: "requirements" });
    state = await store.mutate(root, "f", state.revision, "ready-for-plan", (draft) => {
      draft.steps.requirements = { status: "satisfied" };
      draft.steps.requirement_confirmation = { status: "satisfied" };
    });
    state = await registerTraceFixture({ root, featureId: "f", state, kind: "implementation-plan" });
    state = await store.mutate(root, "f", state.revision, "ready-for-coverage", (draft) => {
      draft.steps.implementation_plan = { status: "satisfied" };
    });
    state = await registerTraceFixture({ root, featureId: "f", state, kind: "coverage-matrix" });
    state = await store.mutate(root, "f", state.revision, "ready-for-ru", (draft) => {
      draft.steps.coverage_review = { status: "satisfied" };
    });
    state = await registerTraceFixture({ root, featureId: "f", state, kind: "rollback-units" });
    assert.equal((await traceStore.readTraceability(root, state)).nodes["RU-001"].sourceArtifact, "rollback-units");

    const legacy = await traceStore.readTraceability(root, state);
    legacy.nodes["RU-001"].fileScope = ["/etc/passwd"];
    const legacyPointer = await traceStore.writeTraceSnapshot(root, legacy);
    state = await store.mutate(root, "f", state.revision, "seed-legacy-l-unsafe-file-scope", (draft) => {
      draft.traceability = legacyPointer;
    });
    await assert.rejects(() => traceStore.readTraceability(root, state), /TRACEABILITY_INTEGRITY_FAILED/);

    const before = await store.readState(root, "f");
    await assert.rejects(
      () => artifacts.recordArtifactWithTrace(root, "f", before.revision, "implementation-plan", traceDeltaFor("implementation-plan", "standard-l")),
      /TRACEABILITY_INTEGRITY_FAILED/,
    );
    assert.deepEqual(await store.readState(root, "f"), before);

    state = await artifacts.recordArtifactWithTrace(root, "f", before.revision, "rollback-units", traceDeltaFor("rollback-units", "standard-l"));
    const repaired = await traceStore.readTraceability(root, state);
    assert.deepEqual(repaired.nodes["RU-001"].fileScope, ["src"]);
    assert.equal(repaired.nodes["RU-001"].sourceArtifact, "rollback-units");
    assert.notDeepEqual(state.traceability, legacyPointer);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("legacy fileScope repair does not bypass other integrity failures", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "dev-flow-trace-file-scope-repair-integrity-"));
  try {
    let state = await standardFeature(root);
    state = await registerTraceFixture({ root, featureId: "f", state, kind: "requirements" });
    state = await store.mutate(root, "f", state.revision, "ready-for-plan", (draft) => {
      draft.steps.requirements = { status: "satisfied" };
      draft.steps.requirement_confirmation = { status: "satisfied" };
    });
    state = await registerTraceFixture({ root, featureId: "f", state, kind: "implementation-plan" });

    const legacy = await traceStore.readTraceability(root, state);
    legacy.nodes["RU-001"].fileScope = ["../x"];
    // Break a relationship so the ledger is not merely an unsafe-fileScope legacy case.
    legacy.nodes["TASK-001"].covers = ["REQ-999"];
    const legacyPointer = await traceStore.writeTraceSnapshot(root, legacy);
    state = await store.mutate(root, "f", state.revision, "seed-legacy-broken-graph", (draft) => {
      draft.traceability = legacyPointer;
    });

    const before = await store.readState(root, "f");
    await assert.rejects(
      () => artifacts.recordArtifactWithTrace(root, "f", before.revision, "implementation-plan", traceDeltaFor("implementation-plan", "standard-m")),
      /TRACEABILITY_INTEGRITY_FAILED/,
    );
    assert.deepEqual(await store.readState(root, "f"), before);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("requirements artifact or delta changes revoke only downstream approvals", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "dev-flow-trace-artifacts-invalidate-"));
  try {
    let state = await standardFeature(root);
    state = await registerTraceFixture({ root, featureId: "f", state, kind: "requirements" });
    state = await store.mutate(root, "f", state.revision, "seed-evidence", (draft) => {
      draft.steps.requirements = { status: "satisfied" };
      draft.steps.requirement_confirmation = { status: "satisfied" };
      draft.steps.implementation_plan = { status: "satisfied" };
      draft.steps.implementation_approval = { status: "satisfied" };
      draft.humanGates.requirement_confirmation = { status: "confirmed" };
      draft.humanGates.implementation_approval = { status: "confirmed" };
      draft.featureCheck = { passed: true };
      draft.logicComplete = true;
    });
    state = await registerTraceFixture({
      root, featureId: "f", state, kind: "requirements",
      edit: (contents) => contents.replace("- 描述：", "- 描述：已调整"),
    });
    assert.equal(state.steps.requirements.status, "satisfied");
    assert.equal(state.steps.requirement_confirmation, undefined);
    assert.equal(state.steps.implementation_plan, undefined);
    assert.equal(state.humanGates.implementation_approval, undefined);
    assert.deepEqual(state.featureCheck, {});
    assert.equal(state.logicComplete, false);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("requirements front matter changes invalidate the artifact basis without staling Trace blocks", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "dev-flow-trace-artifacts-front-matter-"));
  try {
    let state = await standardFeature(root);
    state = await registerTraceFixture({
      root, featureId: "f", state, kind: "requirements",
      edit: (markdown) => markdown.replace(/^  grill_status: not_required$/m, "  grill_status: complete"),
    });
    const before = await traceStore.readTraceability(root, state);
    state = await store.mutate(root, "f", state.revision, "seed-requirement-gate", (draft) => {
      draft.humanGates.requirement_confirmation = { status: "confirmed" };
      draft.steps.requirement_confirmation = { status: "satisfied" };
    });
    state = await registerTraceFixture({
      root, featureId: "f", state, kind: "requirements",
      edit: (markdown) => markdown.replace(/^  grill_status: complete$/m, "  grill_status: in_progress"),
    });
    const after = await traceStore.readTraceability(root, state);
    assert.equal(after.nodes["REQ-001"].sourceBlockSha256, before.nodes["REQ-001"].sourceBlockSha256);
    assert.equal(after.nodes["AC-001"].sourceBlockSha256, before.nodes["AC-001"].sourceBlockSha256);
    assert.equal(after.nodes["REQ-001"].status, "current");
    assert.equal(state.humanGates.requirement_confirmation, undefined);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("with-trace registration stales exactly one independent closure and revokes requirements confirmation", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "dev-flow-trace-artifacts-closures-"));
  try {
    let state = await twoClosureFeature(root);
    state = await store.mutate(root, "f", state.revision, "approve-two-closures", approveTraceWorkflow);
    state = await registerTraceFixture({
      root, featureId: "f", state, kind: "requirements",
      delta: twoClosureTraceDeltaFor("requirements", "standard-m"),
      edit: (markdown) => markdown
        .replace("- 描述：", "- 描述：第一组更新")
        .replace("- 验收条件：", "- 验收条件：第一组更新"),
    });
    const ledger = await traceStore.readTraceability(root, state);
    for (const id of ["TASK-001", "RU-001", "TEST-001"]) assert.equal(ledger.nodes[id].status, "stale", id);
    for (const id of ["REQ-001", "AC-001", "REQ-002", "AC-002", "TASK-002", "RU-002", "TEST-002"]) {
      assert.equal(ledger.nodes[id].status, "current", id);
    }
    assert.equal(state.steps.requirement_confirmation, undefined);
    assert.equal(state.steps.coverage_review, undefined);
    assert.equal(state.steps.plan_review, undefined);
    assert.equal(state.humanGates.implementation_approval, undefined);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("a Trace-only delta change revokes downstream approvals even when the artifact hash is unchanged", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "dev-flow-trace-artifacts-trace-only-"));
  try {
    let state = await twoClosureFeature(root);
    state = await store.mutate(root, "f", state.revision, "approve-trace-only", approveTraceWorkflow);
    const artifactHash = state.artifacts.requirements.sha256;
    const beforePointer = state.traceability;
    const changedDelta = twoClosureTraceDeltaFor("requirements", "standard-m");
    changedDelta.nodes.find((node) => node.id === "AC-001").parentRequirement = "REQ-002";
    state = await registerTraceFixture({ root, featureId: "f", state, kind: "requirements", delta: changedDelta });
    assert.equal(state.artifacts.requirements.sha256, artifactHash);
    assert.notDeepEqual(state.traceability, beforePointer);
    assert.equal(state.steps.requirement_confirmation, undefined);
    assert.equal(state.humanGates.implementation_approval, undefined);
    const event = (await store.readFeatureEvents(root, "f")).at(-1);
    assert.equal(event.data.invalidationReason, "trace-changed");
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("plan and coverage registrations preserve requirements confirmation while revoking implementation approval", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "dev-flow-trace-artifacts-one-way-gates-"));
  try {
    let state = await twoClosureFeature(root);
    state = await store.mutate(root, "f", state.revision, "approve-before-plan-change", approveTraceWorkflow);
    state = await registerTraceFixture({
      root, featureId: "f", state, kind: "implementation-plan",
      delta: twoClosureTraceDeltaFor("implementation-plan", "standard-m"),
      edit: (markdown) => markdown.replace("### TASK-001：实现任务", "### TASK-001：实现任务（已调整）"),
    });
    assert.equal(state.humanGates.requirement_confirmation.status, "confirmed");
    assert.equal(state.steps.requirement_confirmation.status, "satisfied");
    assert.equal(state.humanGates.implementation_approval, undefined);

    state = await store.mutate(root, "f", state.revision, "reapprove-before-coverage-change", (draft) => {
      draft.steps.implementation_approval = { status: "satisfied" };
      draft.humanGates.implementation_approval = { status: "confirmed" };
    });
    state = await registerTraceFixture({
      root, featureId: "f", state, kind: "coverage-matrix",
      delta: twoClosureTraceDeltaFor("coverage-matrix", "standard-m"),
      edit: (markdown) => markdown.replace("### TEST-001：验证场景", "### TEST-001：验证场景（已调整）"),
    });
    assert.equal(state.humanGates.requirement_confirmation.status, "confirmed");
    assert.equal(state.steps.requirement_confirmation.status, "satisfied");
    assert.equal(state.humanGates.implementation_approval, undefined);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("implementation approval basis includes the current Trace pointer for trace-enforced features", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "dev-flow-trace-artifacts-gate-basis-"));
  try {
    const state = await twoClosureFeature(root);
    const basis = gateBasis.gateBasis(state, "implementation_approval");
    assert.deepEqual(basis.traceability, state.traceability);
  } finally { await rm(root, { recursive: true, force: true }); }
});
