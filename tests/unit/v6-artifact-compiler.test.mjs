// v6 artifact-compiler tests. Phase 2 enables the pure parser expectations now;
// compiler/MCP integration todos stay disabled until their behavior exists.
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { loadSource } from "../helpers/load-source.mjs";
import {
  v6ImplementationPlanMarkdown,
  v6RecoveryBlock,
  v6RequirementsMarkdown,
} from "../helpers/v6-fixtures.mjs";

const markdown = await loadSource("plugins/dev-flow/src/core/traceability-markdown.ts");
const store = await loadSource("plugins/dev-flow/src/core/state-store.ts");
const artifacts = await loadSource("plugins/dev-flow/src/core/artifacts.ts");
const traceStore = await loadSource("plugins/dev-flow/src/core/traceability-store.ts");
const { publicTools, toolSchemas } = await loadSource("plugins/dev-flow/src/mcp/dispatch.ts");

const nonTargetedConfig = {
  schemaVersion: 2,
  verification: {
    commands: [
      { id: "unit", command: process.execPath, args: ["-e", "process.exit(0)"], cwd: ".", provides: ["targeted", "behavior", "integration"] },
      { id: "unit-wide", command: process.execPath, args: ["-e", "process.exit(0)"], cwd: ".", provides: ["integration", "full"] },
    ],
  },
  enforcement: { mode: "strict", gitWriteRequiresLogicComplete: true, oneActiveFeature: true, requireExplicitHumanReply: true },
  governedRoots: ["src"],
};

async function setupFeature() {
  const root = await mkdtemp(path.join(os.tmpdir(), "dev-flow-v6-compiler-"));
  await mkdir(path.join(root, "src"));
  await store.initProject(root, nonTargetedConfig);
  const state = await store.startFeature(root, {
    featureId: "v6compiler",
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
  const id = state.featureId;
  // requirements 阶段完成后才能 scaffold 计划工件
  const withRequirements = await artifacts.scaffoldArtifact(root, id, state.revision, "requirements");
  const reqPath = path.join(root, ".dev-flow", "features", id, withRequirements.artifacts.requirements.path);
  await writeFile(reqPath, v6RequirementsMarkdown());
  const recorded = await artifacts.recordArtifactFromMarkdown(root, id, withRequirements.revision, "requirements");
  const steps = await loadSource("plugins/dev-flow/src/core/feature-check.ts");
  const afterRequirements = await steps.recordStep(root, id, recorded.state.revision, "requirements_alignment", {});
  const withArtifact = await artifacts.scaffoldArtifact(root, id, afterRequirements.revision, "implementation-plan");
  const planPath = path.join(root, ".dev-flow", "features", id, withArtifact.artifacts["implementation-plan"].path);
  return { root, state: withArtifact, id, planPath };
}

test("v6 parser derives valid TraceNodeInput from requirements Markdown", () => {
  const parsed = markdown.parseTraceMarkdown(v6RequirementsMarkdown(), "requirements");
  assert.equal(parsed.ok, true, JSON.stringify(parsed.diagnostics));
  assert.deepEqual(parsed.nodes, [
    { kind: "requirement", id: "REQ-001" },
    { kind: "acceptance-criterion", id: "AC-001", parentRequirement: "REQ-001", verificationDisposition: { kind: "behavior-test" } },
  ]);
});

test("v6 parser derives task/test/UNIT/recovery nodes with TDD and bracket lists", () => {
  const parsed = markdown.parseTraceMarkdown(
    v6ImplementationPlanMarkdown({ extra: v6RecoveryBlock() }),
    "implementation-plan",
  );
  assert.equal(parsed.ok, true, JSON.stringify(parsed.diagnostics));
  assert.deepEqual(parsed.nodes.map((node) => node.id), ["TASK-001", "TEST-001", "UNIT-001", "REC-001"]);
  const task = parsed.nodes.find((node) => node.kind === "task");
  assert.equal(task.tdd, "test-first");
  const unit = parsed.nodes.find((node) => node.kind === "implementation-unit");
  assert.deepEqual(unit.tasks, ["TASK-001"]);
  assert.deepEqual(unit.dependsOn, []);
  assert.deepEqual(unit.fileScope, ["src"]);
  assert.deepEqual(unit.forwardVerification, ["unit"]);
});

test("v6 parser aggregates unknown field, duplicate field and missing required field with locations", () => {
  const source = [
    "<!-- dev-flow:id=TASK-001 kind=task -->",
    "### TASK-001",
    "",
    "- covers: [REQ-001, AC-001]",
    "- implementation_unit: UNIT-001",
    "- not_a_v6_field: true",
    "- not_a_v6_field: false",
    "",
  ].join("\n");
  const parsed = markdown.parseTraceMarkdown(source, "implementation-plan");
  assert.equal(parsed.ok, false);
  assert.ok(parsed.diagnostics.some((item) => item.field === "not_a_v6_field"));
  assert.equal(parsed.diagnostics.filter((item) => item.field === "not_a_v6_field").length, 2);
  const missing = [
    "<!-- dev-flow:id=TASK-001 kind=task -->",
    "### TASK-001",
    "",
    "- implementation_unit: UNIT-001",
    "",
  ].join("\n");
  const missingParsed = markdown.parseTraceMarkdown(missing, "implementation-plan");
  assert.equal(missingParsed.ok, false);
  assert.ok(missingParsed.diagnostics.some((item) => item.message.includes("covers")));
});

test("v6 parser rejects comma-bare lists, empty elements and duplicate elements", () => {
  const commaBare = markdown.parseTraceMarkdown(
    v6ImplementationPlanMarkdown().replace("- covers: [REQ-001, AC-001]", "- covers: REQ-001, AC-001"),
    "implementation-plan",
  );
  assert.equal(commaBare.ok, false);
  assert.ok(commaBare.diagnostics.some((item) => item.message.includes("bracket")));
  const emptyElement = markdown.parseTraceMarkdown(
    v6ImplementationPlanMarkdown().replace("- covers: [REQ-001, AC-001]", "- covers: [REQ-001,, AC-001]"),
    "implementation-plan",
  );
  assert.equal(emptyElement.ok, false);
  assert.ok(emptyElement.diagnostics.some((item) => item.message.includes("空元素")));
  const duplicate = markdown.parseTraceMarkdown(
    v6ImplementationPlanMarkdown().replace("- covers: [REQ-001, AC-001]", "- covers: [REQ-001, REQ-001]"),
    "implementation-plan",
  );
  assert.equal(duplicate.ok, false);
  assert.ok(duplicate.diagnostics.some((item) => item.message.includes("重复")));
});

test("v6 parser rejects malformed anchors, inline command refs and legacy artifact kinds", () => {
  const malformed = markdown.parseTraceMarkdown("<!-- dev-flow:id=TASK-001 kind=wat -->\n", "implementation-plan");
  assert.equal(malformed.ok, false);
  assert.ok(malformed.diagnostics.some((item) => item.message.includes("anchor")));
  const inlineLike = v6ImplementationPlanMarkdown().replace(
    "- forward_verification: [unit]",
    "- forward_verification: [{command: unit}]",
  );
  const inlineParsed = markdown.parseTraceMarkdown(inlineLike, "implementation-plan");
  assert.equal(inlineParsed.ok, true);
  const inlineUnit = inlineParsed.nodes.find((node) => node.kind === "implementation-unit");
  assert.deepEqual(inlineUnit.forwardVerification, ["{command: unit}"], "Markdown has no object syntax; the value is only an unknown command string for the compiler to reject");
  const legacy = markdown.parseTraceMarkdown(
    v6ImplementationPlanMarkdown(),
    "coverage-matrix",
  );
  assert.equal(legacy.ok, false);
  assert.ok(legacy.diagnostics.some((item) => item.message.includes("不再是 v6 Trace artifact")));
  const rollbackAnchor = "<!-- dev-flow:id=RU-001 kind=rollback -->\n### RU-001\n";
  const rollback = markdown.parseTraceMarkdown(rollbackAnchor, "implementation-plan");
  assert.equal(rollback.ok, false);
  assert.ok(rollback.diagnostics.some((item) => item.message.includes("anchor")));
});

test("v6 parser keeps full-width prose bullets out of machine semantics", () => {
  const source = v6ImplementationPlanMarkdown().replace(
    "- covers: [REQ-001, AC-001]",
    "- 描述：这是人工计划正文，不应解析为字段\n- covers: [REQ-001, AC-001]",
  );
  const parsed = markdown.parseTraceMarkdown(source, "implementation-plan");
  assert.equal(parsed.ok, true, JSON.stringify(parsed.diagnostics));
});

test("v6 compiler aggregates parser and targeted-command diagnostics in one preflight", async () => {
  const { root, state, id, planPath } = await setupFeature();
  try {
    const planWithBadField = v6ImplementationPlanMarkdown({ commandId: "unit-wide" }).replace(
      "- covers: [REQ-001, AC-001]",
      "- covers: [REQ-001, AC-001]\n- not_a_v6_field: true",
    );
    await writeFile(planPath, planWithBadField);
    const preflight = await artifacts.validatePlanFromMarkdown(root, id, "implementation-plan");
    assert.equal(preflight.ok, false, JSON.stringify(preflight.diagnostics));
    assert.ok(preflight.diagnostics.some((item) => item.message.includes("not_a_v6_field") || item.field === "not_a_v6_field"), "parser diagnostic must be included");
    assert.ok(preflight.diagnostics.some((item) => /targeted/.test(item.message) || /provides/.test(item.message)), "targeted-command diagnostic must be aggregated in the same preflight");
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("only structured field changes move semantic SHA and Trace; prose-only edits change raw SHA only", async () => {
  const { root, state, id, planPath } = await setupFeature();
  try {
    await writeFile(planPath, v6ImplementationPlanMarkdown());
    let current = (await artifacts.recordArtifactFromMarkdown(root, id, state.revision, "implementation-plan")).state;
    const first = await artifacts.validatePlanFromMarkdown(root, id, "implementation-plan");
    assert.ok(first.semanticSha256, "preflight exposes semantic SHA");

    await writeFile(planPath, v6ImplementationPlanMarkdown().replace("### TASK-001：v6 fixture task", "### TASK-001：v6 fixture task（正文更新）"));
    const proseOnly = await artifacts.validatePlanFromMarkdown(root, id, "implementation-plan");
    assert.equal(proseOnly.semanticSha256, first.semanticSha256, "prose-only edits must not move semantic SHA");
    let reRegistered = (await artifacts.recordArtifactFromMarkdown(root, id, current.revision, "implementation-plan")).state;
    assert.notEqual(reRegistered.artifacts["implementation-plan"].sha256, current.artifacts["implementation-plan"].sha256, "raw SHA moves on prose edits");
    current = reRegistered;

    await writeFile(planPath, v6ImplementationPlanMarkdown({ fileScope: ["src/a.ts"] }));
    const fieldChange = await artifacts.validatePlanFromMarkdown(root, id, "implementation-plan");
    assert.notEqual(fieldChange.semanticSha256, first.semanticSha256, "structured field changes must move semantic SHA");
    reRegistered = (await artifacts.recordArtifactFromMarkdown(root, id, current.revision, "implementation-plan")).state;
    assert.notEqual(reRegistered.artifacts["implementation-plan"].sha256, current.artifacts["implementation-plan"].sha256);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("there is no artifactChanged:false traceChanged:true semantic registration path", async () => {
  const { root, state, id, planPath } = await setupFeature();
  try {
    await writeFile(planPath, v6ImplementationPlanMarkdown());
    let current = (await artifacts.recordArtifactFromMarkdown(root, id, state.revision, "implementation-plan")).state;
    const nodesOf = async (s) => JSON.stringify((await traceStore.readTraceability(root, s)).nodes);
    const baselineLedgerRev = (await traceStore.readTraceability(root, current)).revision;

    const cases = [
      { name: "identical re-registration", contents: v6ImplementationPlanMarkdown() },
      { name: "prose-only change", contents: v6ImplementationPlanMarkdown().replace("### TASK-001：v6 fixture task", "### TASK-001：v6 fixture task（正文更新）") },
      { name: "field change", contents: v6ImplementationPlanMarkdown({ fileScope: ["src/a.ts"] }) },
    ];
    for (const entry of cases) {
      await writeFile(planPath, entry.contents);
      const before = current.artifacts["implementation-plan"].sha256;
      const beforeNodes = await nodesOf(current);
      current = (await artifacts.recordArtifactFromMarkdown(root, id, current.revision, "implementation-plan")).state;
      const artifactChanged = current.artifacts["implementation-plan"].sha256 !== before;
      const traceChanged = (await nodesOf(current)) !== beforeNodes;
      assert.ok(!(artifactChanged === false && traceChanged === true), entry.name + ": trace must never change without the artifact changing");
    }
    assert.equal((await traceStore.readTraceability(root, current)).revision, baselineLedgerRev + cases.length, "all three registrations advanced the ledger");
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("tools/list never exposes traceDelta, record_artifact_with_trace, coverage-matrix or rollback-units", async () => {
  assert.equal(publicTools.includes("dev_flow_record_artifact_with_trace"), false);
  assert.equal("dev_flow_record_artifact_with_trace" in toolSchemas, false);
  assert.deepEqual([...toolSchemas.dev_flow_validate_plan.inputSchema.properties.kind.enum].sort(), ["implementation-plan", "requirements"]);
  assert.equal("traceDelta" in toolSchemas.dev_flow_record_artifact.inputSchema.properties, false);
  assert.equal("traceDelta" in toolSchemas.dev_flow_scaffold_artifact.inputSchema.properties, false);
  await assert.rejects(
    artifacts.recordArtifactFromMarkdown("/nonexistent-root", "f", 0, "coverage-matrix"),
    (error) => error.code === "UNSUPPORTED_TRACE_ARTIFACT_KIND",
  );
  await assert.rejects(
    artifacts.recordArtifactFromMarkdown("/nonexistent-root", "f", 0, "rollback-units"),
    (error) => error.code === "UNSUPPORTED_TRACE_ARTIFACT_KIND",
  );
});
