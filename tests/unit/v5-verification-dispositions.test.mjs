import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { loadSource } from "../helpers/load-source.mjs";
import { v6ImplementationPlanMarkdown, v6RequirementsMarkdown } from "../helpers/v6-fixtures.mjs";

const stateStore = await loadSource("plugins/dev-flow/src/core/state-store.ts");
const artifacts = await loadSource("plugins/dev-flow/src/core/artifacts.ts");
const steps = await loadSource("plugins/dev-flow/src/core/feature-check.ts");
const inspection = await loadSource("plugins/dev-flow/src/core/inspection.ts");

const projectConfig = {
  schemaVersion: 2,
  verification: { commands: [{ id: "unit", command: process.execPath, args: ["-e", "process.exit(0)"], cwd: ".", provides: ["targeted", "behavior", "integration", "full"] }] },
  enforcement: { mode: "strict", gitWriteRequiresLogicComplete: true, oneActiveFeature: true, requireExplicitHumanReply: true },
  governedRoots: ["src"],
};

function requirementsMarkdown(ac2Disposition) {
  const ac2 = [
    "<!-- dev-flow:id=AC-002 kind=acceptance-criterion -->",
    "### AC-002：第二项验收",
    "",
    "- parent_requirement: REQ-001",
  ];
  if (ac2Disposition) {
    ac2.push(`- verification_kind: ${ac2Disposition.kind}`);
    if (ac2Disposition.reason !== undefined) ac2.push(`- verification_reason: ${ac2Disposition.reason}`);
    if (ac2Disposition.target) ac2.push(`- verification_target: ${ac2Disposition.target}`);
  }
  ac2.push("");
  return `${v6RequirementsMarkdown().replace("- verification_kind: behavior-test\n", "")}\n${ac2.join("\n")}`;
}

async function setupFormalFeature() {
  const root = await mkdtemp(path.join(os.tmpdir(), "dev-flow-disposition-"));
  await mkdir(path.join(root, "src"));
  await stateStore.initProject(root, projectConfig);
  let state = await stateStore.startFeature(root, {
    featureId: "disp",
    host: "codex",
    level: "M",
    topology: "local",
    classificationBasis: {
      scopeFacts: ["scope"],
      topologyFacts: ["topology"],
      uncertaintyFacts: [],
      riskFacts: {},
      decisionRefs: [],
      signals: { changeSurface: "multi-component", behaviorChange: "new-capability", topology: "local", unitCount: 1, requirements: "provided-confirmed", operationalRecovery: false, executableRollback: false },
      controlEnhancements: { trace: true },
    },
  });
  state = await artifacts.scaffoldArtifact(root, state.featureId, state.revision, "requirements");
  return { root, state };
}

async function registerRequirements(root, state, ac2Disposition) {
  await writeFile(path.join(root, ".dev-flow", "features", state.featureId, state.artifacts.requirements.path), requirementsMarkdown(ac2Disposition));
  let current = (await artifacts.recordArtifactFromMarkdown(root, state.featureId, state.revision, "requirements")).state;
  current = await steps.recordStep(root, state.featureId, current.revision, "requirements_alignment", {});
  current = await artifacts.scaffoldArtifact(root, state.featureId, current.revision, "implementation-plan");
  return current;
}

const taskRuMarkdown = v6ImplementationPlanMarkdown();

test("an AC with a non-behavior disposition and reason passes plan preflight without its own TEST", async () => {
  const { root, state } = await setupFormalFeature();
  try {
    const req = await registerRequirements(root, state, { kind: "file-check", reason: "核对 docs/api.md 与实现一致", target: "docs/api.md" });
    assert.equal(req.mode, "routed");
    await writeFile(path.join(root, ".dev-flow", "features", state.featureId, req.artifacts["implementation-plan"].path), taskRuMarkdown);
    const result = await artifacts.validatePlanFromMarkdown(root, state.featureId, "implementation-plan");
    assert.equal(result.ok, true, JSON.stringify(result.diagnostics));
    await assert.doesNotReject(() => artifacts.recordArtifactFromMarkdown(root, state.featureId, req.revision, "implementation-plan"));
    const store = await loadSource("plugins/dev-flow/src/core/traceability-store.ts");
    const ledger = await store.readTraceability(root, (await stateStore.readState(root, state.featureId)));
    const ac2 = ledger.nodes["AC-002"];
    assert.equal(ac2.verificationDisposition.kind, "file-check");
    assert.equal(ac2.verificationDisposition.target, "docs/api.md");
    // TDD 顺序与最终处置分别记录在 task 与 AC 上
    assert.equal(ledger.nodes["TASK-001"].tdd, "test-first");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("uncovered AC without disposition, empty reason, and behavior-test without TEST are all rejected", async () => {
  const { root, state } = await setupFormalFeature();
  try {
    // 1) AC-002 无处置且 plan 无 TEST 覆盖 → 预检失败（定位 AC-002）
    const prepared = await registerRequirements(root, state, undefined);
    await writeFile(path.join(root, ".dev-flow", "features", state.featureId, prepared.artifacts["implementation-plan"].path), taskRuMarkdown);
    let result = await artifacts.validatePlanFromMarkdown(root, state.featureId, "implementation-plan");
    assert.equal(result.ok, false);
    assert.ok(result.diagnostics.some((d) => d.position === "AC-002"), JSON.stringify(result.diagnostics));

    const fresh = await stateStore.readState(root, state.featureId);
    await writeFile(path.join(root, ".dev-flow", "features", state.featureId, fresh.artifacts.requirements.path), requirementsMarkdown({ kind: "rule-check", reason: "   " }));
    await assert.rejects(
      () => artifacts.recordArtifactFromMarkdown(root, state.featureId, fresh.revision, "requirements"),
      (error) => error.code === "TRACE_GRAPH_INVALID" || error.code === "PLAN_INVALID",
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("one TEST can cover multiple ACs and inspect reports dispositions separately", async () => {
  const { root, state } = await setupFormalFeature();
  try {
    const req = await registerRequirements(root, state, { kind: "file-check", reason: "核对 README 文档" });
    const markdown = v6ImplementationPlanMarkdown({
      covers: ["REQ-001", "AC-001", "AC-002"],
      verifies: ["AC-001", "AC-002"],
    });
    await writeFile(path.join(root, ".dev-flow", "features", state.featureId, req.artifacts["implementation-plan"].path), markdown);
    const registered = await artifacts.recordArtifactFromMarkdown(root, state.featureId, req.revision, "implementation-plan");
    const view = await inspection.inspectFeature(root, state.featureId, "trace");
    assert.ok(view.content.verificationDispositions);
    assert.equal(view.content.verificationDispositions.coveredByTest, 1);
    assert.deepEqual(view.content.verificationDispositions.byKind, [{ kind: "file-check", count: 1 }]);
    void registered;
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("test-first tasks require a behavior test for the ACs they cover", async () => {
  const { root, state } = await setupFormalFeature();
  try {
    const req = await registerRequirements(root, state, undefined);
    await writeFile(path.join(root, ".dev-flow", "features", state.featureId, req.artifacts["implementation-plan"].path), v6ImplementationPlanMarkdown({ includeTest: false }));
    let result = await artifacts.validatePlanFromMarkdown(root, state.featureId, "implementation-plan");
    assert.equal(result.ok, false);
    assert.ok(result.diagnostics.some((d) => d.code === "TEST_FIRST_REQUIRES_BEHAVIOR_TEST" && d.position === "AC-001"), JSON.stringify(result.diagnostics));
    await writeFile(path.join(root, ".dev-flow", "features", state.featureId, req.artifacts["implementation-plan"].path), v6ImplementationPlanMarkdown({ includeTest: false, tdd: "direct" }));
    result = await artifacts.validatePlanFromMarkdown(root, state.featureId, "implementation-plan");
    assert.equal(result.ok, false, "AC-001 仍无任何验证处置，direct 只解除 test-first 约束");
    assert.ok(!result.diagnostics.some((d) => d.code === "TEST_FIRST_REQUIRES_BEHAVIOR_TEST"));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
