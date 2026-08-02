import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
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
const checks = await loadSource("plugins/dev-flow/src/core/feature-check.ts");
const gates = await loadSource("plugins/dev-flow/src/core/human-gates.ts");
const traceStore = await loadSource("plugins/dev-flow/src/core/traceability-store.ts");
const config = {
  schemaVersion: 1,
  verification: { commands: [{ id: "unit", command: "node", args: ["--test"], cwd: "." }], behaviorCommands: [] },
  enforcement: { mode: "strict", gitWriteRequiresLogicComplete: true, oneActiveFeature: true, requireExplicitHumanReply: true },
  protectedRoots: ["src"],
};

test("Claude and Codex share Trace pointers and resolve same-revision CAS without overwriting", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "dev-flow-trace-cross-host-"));
  try {
    await mkdir(path.join(root, "src"));
    await writeFile(path.join(root, "src", "app.js"), "export const value = 1;\n");
    await store.initProject(root, config);

    // Claude creates and registers requirements; Codex consumes that exact pointer.
    let state = await store.startFeature(root, {
      featureId: "f", host: "claude", level: "M", topology: "local", execution: "standard", requirements: "provided-confirmed",
    });
    state = await artifacts.scaffoldArtifact(root, "f", state.revision, "requirements");
    state = await registerTraceFixture({ root, featureId: "f", state, kind: "requirements" });
    const claudePointer = state.traceability;
    assert.equal((await traceStore.readTraceability(root, await store.readState(root, "f"))).featureId, "f");
    assert.ok(claudePointer);

    state = await checks.recordStep(root, "f", state.revision, "requirements", {});
    state = await gates.presentGate(root, "f", state.revision, "requirement_confirmation");
    await store.recordHostEvent(root, { eventId: "codex-requirements-confirm", type: "user-prompt", host: "codex", text: "确认需求" });
    state = await gates.confirmGate(root, "f", state.revision, "requirement_confirmation", "确认需求", { promptEventId: "codex-requirements-confirm" }, "codex");
    state = await artifacts.scaffoldArtifact(root, "f", state.revision, "implementation-plan");

    // Both hosts submit the same plan delta at one revision. The CAS winner is the only state transition.
    const expectedRevision = state.revision;
    const results = await Promise.allSettled([
      artifacts.recordArtifactWithTrace(root, "f", expectedRevision, "implementation-plan", traceDeltaFor("implementation-plan", "standard-m")),
      artifacts.recordArtifactWithTrace(root, "f", expectedRevision, "implementation-plan", traceDeltaFor("implementation-plan", "standard-m")),
    ]);
    assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
    const rejected = results.find((result) => result.status === "rejected");
    assert.equal(rejected.reason.code, "STATE_REVISION_CONFLICT");

    state = await store.readState(root, "f");
    const codexLedger = await traceStore.readTraceability(root, state);
    assert.ok(state.traceability);
    assert.equal(codexLedger.summary.current, 4);
    state = await checks.recordStep(root, "f", state.revision, "implementation_plan", {});
    assert.equal(state.steps.implementation_plan.status, "satisfied");
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("Codex requirements and Claude plan share the same Trace contract", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "dev-flow-trace-cross-host-reverse-"));
  try {
    await mkdir(path.join(root, "src"));
    await writeFile(path.join(root, "src", "app.js"), "export const value = 1;\n");
    await store.initProject(root, config);
    let state = await store.startFeature(root, {
      featureId: "f", host: "codex", level: "M", topology: "local", execution: "standard", requirements: "provided-confirmed",
    });
    state = await artifacts.scaffoldArtifact(root, "f", state.revision, "requirements");
    state = await registerTraceFixture({ root, featureId: "f", state, kind: "requirements" });
    state = await checks.recordStep(root, "f", state.revision, "requirements", {});
    state = await gates.presentGate(root, "f", state.revision, "requirement_confirmation");
    await store.recordHostEvent(root, { eventId: "claude-requirements-confirm", type: "user-prompt", host: "claude", text: "确认需求" });
    state = await gates.confirmGate(root, "f", state.revision, "requirement_confirmation", "确认需求", { promptEventId: "claude-requirements-confirm" }, "claude");
    state = await artifacts.scaffoldArtifact(root, "f", state.revision, "implementation-plan");
    state = await registerTraceFixture({ root, featureId: "f", state, kind: "implementation-plan" });
    assert.equal((await traceStore.readTraceability(root, state)).summary.current, 4);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("standard routes reject bare registration, incomplete coverage, missing RU, and stale source", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "dev-flow-trace-failures-"));
  try {
    await mkdir(path.join(root, "src"));
    await writeFile(path.join(root, "src", "app.js"), "export const value = 1;\n");
    await store.initProject(root, config);
    let state = await store.startFeature(root, {
      featureId: "f", host: "codex", level: "M", topology: "local", execution: "standard", requirements: "provided-confirmed",
    });
    state = await artifacts.scaffoldArtifact(root, "f", state.revision, "requirements");
    await assert.rejects(
      () => artifacts.recordArtifact(root, "f", state.revision, "requirements"),
      (error) => error.code === "TRACE_AWARE_REGISTRATION_REQUIRED",
    );
    state = await registerTraceFixture({
      root, featureId: "f", state, kind: "requirements", delta: twoClosureTraceDeltaFor("requirements", "standard-m"),
      edit: (markdown) => appendSecondTraceClosure(markdown, "requirements", "standard-m"),
    });
    state = await checks.recordStep(root, "f", state.revision, "requirements", {});
    state = await gates.presentGate(root, "f", state.revision, "requirement_confirmation");
    state = await gates.resolveGateElicitation(root, "f", state.revision, state.gateInteraction.id, "confirm", undefined, "codex");
    state = await artifacts.scaffoldArtifact(root, "f", state.revision, "implementation-plan");
    state = await registerTraceFixture({
      root, featureId: "f", state, kind: "implementation-plan", delta: twoClosureTraceDeltaFor("implementation-plan", "standard-m"),
      edit: (markdown) => appendSecondTraceClosure(markdown, "implementation-plan", "standard-m"),
    });
    state = await checks.recordStep(root, "f", state.revision, "implementation_plan", {});
    state = await artifacts.scaffoldArtifact(root, "f", state.revision, "coverage-matrix");
    state = await registerTraceFixture({ root, featureId: "f", state, kind: "coverage-matrix" });
    await assert.rejects(
      () => checks.recordStep(root, "f", state.revision, "coverage_review", {}),
      (error) => error.code === "TRACE_SLICE_INCOMPLETE",
    );
    state = await registerTraceFixture({
      root, featureId: "f", state, kind: "requirements", delta: twoClosureTraceDeltaFor("requirements", "standard-m"),
      edit: (markdown) => markdown.replace("- 描述：", "- 描述：updated"),
    });
    state = await gates.presentGate(root, "f", state.revision, "requirement_confirmation");
    state = await gates.resolveGateElicitation(root, "f", state.revision, state.gateInteraction.id, "confirm", undefined, "codex");
    await assert.rejects(
      () => checks.recordStep(root, "f", state.revision, "implementation_plan", {}),
      (error) => error.code === "TRACE_SLICE_STALE",
    );
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("standard L blocks rollback_unit without registered rollback units", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "dev-flow-trace-missing-ru-"));
  try {
    await mkdir(path.join(root, "src"));
    await writeFile(path.join(root, "src", "app.js"), "export const value = 1;\n");
    await store.initProject(root, config);
    let state = await store.startFeature(root, {
      featureId: "f", host: "codex", level: "L", topology: "coordinated-rollback", execution: "standard", requirements: "provided-confirmed",
    });
    state = await artifacts.scaffoldArtifact(root, "f", state.revision, "requirements");
    state = await registerTraceFixture({ root, featureId: "f", state, kind: "requirements" });
    state = await checks.recordStep(root, "f", state.revision, "requirements", {});
    state = await gates.presentGate(root, "f", state.revision, "requirement_confirmation");
    state = await gates.resolveGateElicitation(root, "f", state.revision, state.gateInteraction.id, "confirm", undefined, "codex");
    state = await artifacts.scaffoldArtifact(root, "f", state.revision, "implementation-plan");
    state = await registerTraceFixture({ root, featureId: "f", state, kind: "implementation-plan" });
    state = await checks.recordStep(root, "f", state.revision, "implementation_plan", {});
    state = await artifacts.scaffoldArtifact(root, "f", state.revision, "coverage-matrix");
    state = await registerTraceFixture({ root, featureId: "f", state, kind: "coverage-matrix" });
    state = await checks.recordStep(root, "f", state.revision, "coverage_review", {});
    await assert.rejects(
      () => checks.recordStep(root, "f", state.revision, "rollback_unit", {}),
      (error) => error.code === "TRACE_SLICE_INCOMPLETE",
    );
  } finally { await rm(root, { recursive: true, force: true }); }
});
