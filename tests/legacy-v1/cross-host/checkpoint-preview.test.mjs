import { createHash } from "node:crypto";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execSync } from "node:child_process";
import test from "node:test";
import { loadSource } from "../../helpers/load-source.mjs";
import { appendSecondTraceClosure, registerTraceFixture, twoClosureTraceDeltaFor } from "../../helpers/trace-fixtures.mjs";

const hash = (value) => createHash("sha256").update(value).digest("hex");

const store = await loadSource("plugins/dev-flow/src/core/state-store.ts");
const checks = await loadSource("plugins/dev-flow/src/core/feature-check.ts");
const units = await loadSource("plugins/dev-flow/src/core/implementation-units.ts");
const checkpoints = await loadSource("plugins/dev-flow/src/core/checkpoints.ts");
const status = await loadSource("plugins/dev-flow/src/core/status.ts");
const verification = await loadSource("plugins/dev-flow/src/core/verification.ts");
const contract = await loadSource("plugins/dev-flow/src/policy/contract.ts");

const config = {
  schemaVersion: 1,
  verification: { commands: [{ id: "unit", command: "node", args: ["--test"], cwd: "." }], behaviorCommands: [] },
  enforcement: { mode: "strict", gitWriteRequiresLogicComplete: true, oneActiveFeature: true, requireExplicitHumanReply: true },
  protectedRoots: ["src", "test"],
};

function initGit(root) {
  execSync("git init", { cwd: root, stdio: "pipe" });
  execSync("git add -A", { cwd: root, stdio: "pipe" });
  execSync('git commit -m "initial"', { cwd: root, stdio: "pipe" });
}

const statusArtifactName = "状态文档.md";

function statusArtifactContent(featureId, route) {
  return `---\ndev_flow:\n  schema_version: 1\n  feature_id: ${featureId}\n  route: ${route}\n  kind: status\n---\n\n# status\n\n`;
}

async function writeStatusArtifact(root, featureId, route) {
  const name = statusArtifactName;
  const content = statusArtifactContent(featureId, route);
  await writeFile(path.join(root, ".dev-flow", "features", featureId, name), content);
  return hash(content);
}

async function advanceToImplementationTwoClosures(root, featureId, state) {
  state = await store.mutate(root, featureId, state.revision, "xhost-capabilities", (draft) => {
    draft.workflowCapabilities = { trace: 1, review: 0, checkpoints: 1, rollbackExecution: 0 };
  });
  state = await registerTraceFixture({
    root, featureId, state, kind: "requirements",
    delta: twoClosureTraceDeltaFor("requirements", "standard-m"),
    edit: (markdown) => appendSecondTraceClosure(markdown, "requirements", "standard-m"),
  });
  state = await store.mutate(root, featureId, state.revision, "xhost-adv-req", (draft) => {
    draft.steps.requirements = { status: "satisfied" };
    draft.steps.requirement_confirmation = { status: "satisfied" };
  });
  state = await registerTraceFixture({
    root, featureId, state, kind: "implementation-plan",
    delta: twoClosureTraceDeltaFor("implementation-plan", "standard-m"),
    edit: (markdown) => appendSecondTraceClosure(markdown, "implementation-plan", "standard-m"),
  });
  state = await store.mutate(root, featureId, state.revision, "xhost-adv-plan", (draft) => {
    draft.steps.implementation_plan = { status: "satisfied" };
  });
  state = await registerTraceFixture({
    root, featureId, state, kind: "coverage-matrix",
    delta: twoClosureTraceDeltaFor("coverage-matrix", "standard-m"),
    edit: (markdown) => appendSecondTraceClosure(markdown, "coverage-matrix", "standard-m"),
  });
  const statusSha = await writeStatusArtifact(root, featureId, state.route);
  return store.mutate(root, featureId, state.revision, "xhost-adv-final", (draft) => {
    const defn = contract.routeDefinitionForFeature(draft.route, draft.workflowCapabilities);
    for (const step of defn.orderedSteps.slice(0, defn.orderedSteps.indexOf("implementation"))) {
      draft.steps[step] = { status: "satisfied", ...(step === "plan_review" ? { evidence: { reviewType: "plan" } } : {}) };
    }
    draft.humanGates.implementation_approval = { status: "confirmed" };
    draft.artifacts.status = { path: statusArtifactName, sha256: statusSha };
  });
}

test("Claude checkpoints RU-001; Codex reads same revision and checkpoints RU-002", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "dev-flow-xhost-cp-"));
  try {
    await mkdir(path.join(root, "src"), { recursive: true });
    await writeFile(path.join(root, "src", "one.ts"), "export const a = 1;\n");
    await writeFile(path.join(root, "src", "two.ts"), "export const b = 2;\n");
    await store.initProject(root, config);
    initGit(root);

    // Claude starts the feature and advances to implementation with 2 units.
    let state = await store.startFeature(root, {
      featureId: "f", host: "claude", level: "M", topology: "local", execution: "standard", requirements: "provided-confirmed",
    });
    state = await advanceToImplementationTwoClosures(root, "f", state);

    // Claude begins and checkpoints RU-001 within src/one.ts.
    state = await units.beginImplementationUnit(root, "f", state.revision, "RU-001");
    await writeFile(path.join(root, "src", "one.ts"), "export const a = 2;\n");
    state = (await checkpoints.checkpointImplementationUnit(root, "f", state.revision, "RU-001")).state;
    const claudeRevision = state.revision;

    // Codex reads the feature from disk at the same revision.
    const next = await loadSource("plugins/dev-flow/src/core/next.ts");
    const codexNext = await next.nextAction(root, "f");
    assert.equal(codexNext.kind, "begin-implementation-unit");
    assert.equal(codexNext.unitId, "RU-002");

    // Codex begins and checkpoints RU-002 within src/two.ts.
    state = await units.beginImplementationUnit(root, "f", state.revision, "RU-002");
    await writeFile(path.join(root, "src", "two.ts"), "export const b = 3;\n");
    state = (await checkpoints.checkpointImplementationUnit(root, "f", state.revision, "RU-002")).state;
    assert.notEqual(state.revision, claudeRevision);

    // Both hosts see the same preview targets (the live chain tip is excluded).
    let view = await status.readStatusView(root, "f");
    assert.deepEqual(view.rollback.validTargets, ["CP-001"]);
    assert.deepEqual(view.rollback.chain, [
      { checkpointId: "CP-001", unitId: "RU-001", sequence: 1 },
      { checkpointId: "CP-002", unitId: "RU-002", sequence: 2 },
    ]);

    // Complete the route.
    state = await checks.recordStep(root, "f", state.revision, "implementation", { files: ["src/one.ts", "src/two.ts"] });

    // Satisfy the interim code_review step so verification becomes the next open step.
    state = await store.mutate(root, "f", state.revision, "xhost-code-review", (draft) => {
      draft.steps.code_review = { status: "satisfied", evidence: { reviewType: "code" } };
    });
    state = await verification.runVerification(root, "f", state.revision, "codex");
    state = await checks.featureCheck(root, "f", state.revision);
    state = await checks.finalize(root, "f", state.revision);
    assert.equal(state.lifecycle, "finalized");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("both hosts see preview targets but no execute-ready gate after checkpointing", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "dev-flow-xhost-preview-"));
  try {
    await mkdir(path.join(root, "src"), { recursive: true });
    await writeFile(path.join(root, "src", "one.ts"), "export const a = 1;\n");
    await writeFile(path.join(root, "src", "two.ts"), "export const b = 2;\n");
    await store.initProject(root, config);
    initGit(root);

    let state = await store.startFeature(root, {
      featureId: "f", host: "claude", level: "M", topology: "local", execution: "standard", requirements: "provided-confirmed",
    });
    state = await advanceToImplementationTwoClosures(root, "f", state);
    state = await units.beginImplementationUnit(root, "f", state.revision, "RU-001");
    await writeFile(path.join(root, "src", "one.ts"), "export const a = 2;\n");
    state = (await checkpoints.checkpointImplementationUnit(root, "f", state.revision, "RU-001")).state;
    state = await units.beginImplementationUnit(root, "f", state.revision, "RU-002");
    await writeFile(path.join(root, "src", "two.ts"), "export const b = 3;\n");
    state = (await checkpoints.checkpointImplementationUnit(root, "f", state.revision, "RU-002")).state;

    // Both hosts see the same preview targets (the live chain tip is excluded)
    // but no execute gate.
    for (const host of ["claude", "codex"]) {
      const view = await status.readStatusView(root, "f");
      assert.deepEqual(view.rollback.validTargets, ["CP-001"], `${host} should see valid targets`);
      assert.equal(view.implementation.enforced, true);
    }

    // No human gate — wait.kind is none (not rollback_confirmation or similar).
    assert.equal(
      (await status.readStatusView(root, "f")).progress.wait.kind,
      "none",
      "no execute-ready gate visible",
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
