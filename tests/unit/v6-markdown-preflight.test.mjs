import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { loadSource } from "../helpers/load-source.mjs";
import { v6ImplementationPlanMarkdown, v6RequirementsMarkdown } from "../helpers/v6-fixtures.mjs";

const store = await loadSource("plugins/dev-flow/src/core/state-store.ts");
const artifacts = await loadSource("plugins/dev-flow/src/core/artifacts.ts");
const steps = await loadSource("plugins/dev-flow/src/core/feature-check.ts");

const projectConfig = {
  schemaVersion: 2,
  verification: { commands: [{ id: "unit", command: process.execPath, args: ["-e", "process.exit(0)"], cwd: ".", provides: ["targeted", "behavior", "integration", "full"] }] },
  enforcement: { mode: "strict", gitWriteRequiresLogicComplete: true, oneActiveFeature: true, requireExplicitHumanReply: true },
  governedRoots: ["src"],
};

async function setupTraceM(config = projectConfig) {
  const root = await mkdtemp(path.join(os.tmpdir(), "dev-flow-v6-preflight-"));
  await mkdir(path.join(root, "src"));
  await store.initProject(root, config);
  let state = await store.startFeature(root, {
    featureId: "v6plan",
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
  // Requirements still use the v5 delta-based registration path until Phase 2
  // swaps the public recorder; the v6 Markdown content matches the delta.
  state = await artifacts.scaffoldArtifact(root, state.featureId, state.revision, "requirements");
  const requirementsPath = path.join(root, ".dev-flow", "features", state.featureId, state.artifacts.requirements.path);
  await writeFile(requirementsPath, v6RequirementsMarkdown());
  state = await artifacts.recordArtifactWithTrace(root, state.featureId, state.revision, "requirements", {
    nodes: [
      { kind: "requirement", id: "REQ-001" },
      { kind: "acceptance-criterion", id: "AC-001", parentRequirement: "REQ-001", verificationDisposition: { kind: "behavior-test" } },
    ],
  });
  state = state.state;
  state = await steps.recordStep(root, state.featureId, state.revision, "requirements_alignment", {});
  state = await artifacts.scaffoldArtifact(root, state.featureId, state.revision, "implementation-plan");
  return { root, state };
}

test("validatePlanFromMarkdown compiles the edited plan without a delta", async () => {
  const { root, state } = await setupTraceM();
  try {
    const id = state.featureId;
    const planPath = path.join(root, ".dev-flow", "features", id, state.artifacts["implementation-plan"].path);
    await writeFile(planPath, v6ImplementationPlanMarkdown());
    const result = await artifacts.validatePlanFromMarkdown(root, id, "implementation-plan");
    assert.equal(result.ok, true, JSON.stringify(result.diagnostics));
    assert.equal(typeof result.semanticSha256, "string");
    assert.ok(result.implementationUnits.some((unit) => unit.unitId === "UNIT-001" && unit.forwardVerification.includes("unit")));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("recordArtifactFromMarkdown registers artifact and Trace in one CAS", async () => {
  const { root, state } = await setupTraceM();
  try {
    const id = state.featureId;
    const planPath = path.join(root, ".dev-flow", "features", id, state.artifacts["implementation-plan"].path);
    await writeFile(planPath, v6ImplementationPlanMarkdown());
    const before = state.revision;
    const recorded = await artifacts.recordArtifactFromMarkdown(root, id, before, "implementation-plan");
    assert.equal(recorded.state.revision, before + 1);
    assert.ok(recorded.state.traceability, "Trace pointer must be persisted in the same mutation");
    assert.notEqual(recorded.state.artifacts["implementation-plan"].sha256, state.artifacts["implementation-plan"].sha256);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("validatePlanFromMarkdown aggregates every non-targeted forward_verification command", async () => {
  const config = {
    ...projectConfig,
    verification: { commands: [
      { id: "unit", command: process.execPath, args: ["-e", "process.exit(0)"], cwd: ".", provides: ["targeted", "behavior", "integration", "full"] },
      { id: "full", command: process.execPath, args: ["-e", "process.exit(0)"], cwd: ".", provides: ["integration", "full"] },
    ] },
  };
  const { root, state } = await setupTraceM(config);
  try {
    const id = state.featureId;
    const planPath = path.join(root, ".dev-flow", "features", id, state.artifacts["implementation-plan"].path);
    await writeFile(planPath, v6ImplementationPlanMarkdown({ commandId: "full" }));
    const result = await artifacts.validatePlanFromMarkdown(root, id, "implementation-plan");
    assert.equal(result.ok, false);
    assert.ok(result.diagnostics.some((item) => item.code === "TRACE_VERIFICATION_COMMAND_NOT_TARGETED" && item.position === "UNIT-001" && item.message.includes("full")));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("validatePlanFromMarkdown returns parser diagnostics for malformed v6 Markdown", async () => {
  const { root, state } = await setupTraceM();
  try {
    const id = state.featureId;
    const planPath = path.join(root, ".dev-flow", "features", id, state.artifacts["implementation-plan"].path);
    await writeFile(planPath, v6ImplementationPlanMarkdown().replace("- covers: [REQ-001, AC-001]", "- covers: REQ-001, AC-001"));
    const result = await artifacts.validatePlanFromMarkdown(root, id, "implementation-plan");
    assert.equal(result.ok, false);
    assert.ok(result.diagnostics.some((item) => item.code === "TRACE_MARKDOWN_INVALID" && item.message.includes("bracket")));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
