import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { loadSource } from "../helpers/load-source.mjs";

const store = await loadSource("plugins/dev-flow/src/core/state-store.ts");
const artifacts = await loadSource("plugins/dev-flow/src/core/artifacts.ts");
const contract = await loadSource("plugins/dev-flow/src/policy/contract.ts");
const checks = await loadSource("plugins/dev-flow/src/core/feature-check.ts");
const gates = await loadSource("plugins/dev-flow/src/core/human-gates.ts");
const config = { schemaVersion: 1, verification: { commands: [{ id: "unit", command: "node", args: ["-e", "process.exit(0)"], cwd: "." }], behaviorCommands: [] }, enforcement: { mode: "strict", gitWriteRequiresLogicComplete: true, oneActiveFeature: true, requireExplicitHumanReply: true }, protectedRoots: ["src"] };

test("route asset requirements are exact and edited assets require re-registration", async () => {
  assert.deepEqual(contract.routeDefinition("xs").requiredArtifacts, []);
  assert.deepEqual(contract.routeDefinition("s").requiredArtifacts, []);
  assert.deepEqual(contract.routeDefinition("risk-minimal").requiredArtifacts, ["status", "risk-card"]);
  assert.deepEqual(contract.routeDefinition("light-m").requiredArtifacts, []);
  const root = await mkdtemp(path.join(os.tmpdir(), "dev-flow-artifact-"));
  try {
    await store.initProject(root, config);
    let state = await store.startFeature(root, { featureId: "f", host: "claude", level: "M", topology: "local", execution: "standard", requirements: "missing-or-unclear" });
    await assert.rejects(() => artifacts.scaffoldArtifact(root, "f", state.revision, "code-review"), /ARTIFACT_NOT_REQUIRED/);
    state = await artifacts.scaffoldArtifact(root, "f", state.revision, "requirements");
    assert.equal(state.artifacts.requirements.path, "需求文档.md");
    const file = path.join(root, ".dev-flow", "features", "f", "需求文档.md"); await writeFile(file, "# changed requirements\n");
    await assert.rejects(() => artifacts.assertArtifactCurrent(root, "f", state, "requirements"), /ARTIFACT_INTEGRITY_FAILED/);
    state = await artifacts.recordArtifact(root, "f", state.revision, "requirements");
    assert.ok(state.artifacts.requirements.sha256);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("an existing feature keeps reading its registered English artifact path", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "dev-flow-artifact-legacy-"));
  try {
    await store.initProject(root, config);
    let state = await store.startFeature(root, { featureId: "f", host: "claude", level: "M", topology: "local", execution: "standard", requirements: "missing-or-unclear" });
    state = await artifacts.scaffoldArtifact(root, "f", state.revision, "requirements");
    const featureDirectory = path.join(root, ".dev-flow", "features", "f");
    await writeFile(path.join(featureDirectory, "requirements.md"), await readFile(path.join(featureDirectory, "需求文档.md"), "utf8"));
    state = await store.mutate(root, "f", state.revision, "test-legacy-path", (draft) => {
      draft.artifacts.requirements.path = "requirements.md";
    });
    await assert.doesNotReject(() => artifacts.assertArtifactCurrent(root, "f", state, "requirements"));
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("recording a changed risk card revokes implementation approval", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "dev-flow-artifact-risk-approval-"));
  try {
    await store.initProject(root, config);
    let state = await store.startFeature(root, {
      featureId: "f", host: "codex", level: "M", topology: "local", execution: "light", riskLabels: ["money"],
    });
    state = await artifacts.scaffoldArtifact(root, "f", state.revision, "risk-card");
    state = await checks.recordStep(root, "f", state.revision, "risk_review", {});
    state = await artifacts.scaffoldArtifact(root, "f", state.revision, "status");
    state = await checks.recordStep(root, "f", state.revision, "risk_controls", { checks: ["rollback"] });
    state = await gates.presentGate(root, "f", state.revision, "implementation_approval");
    state = await gates.resolveGateElicitation(root, "f", state.revision, state.gateInteraction.id, "confirm", undefined, "codex");
    assert.equal(state.humanGates.implementation_approval.status, "confirmed");

    const file = path.join(root, ".dev-flow", "features", "f", state.artifacts["risk-card"].path);
    await writeFile(file, "# updated money risk\n");
    state = await artifacts.recordArtifact(root, "f", state.revision, "risk-card");

    assert.equal(state.humanGates.implementation_approval, undefined);
    assert.equal(state.steps.implementation_approval, undefined);
    assert.equal(Object.values(state.interactions).some((item) => item.target === "gate:implementation_approval"), false);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("recording changed requirements revokes both downstream human approvals", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "dev-flow-artifact-requirements-approval-"));
  try {
    await store.initProject(root, config);
    let state = await store.startFeature(root, {
      featureId: "f", host: "codex", level: "M", topology: "local", execution: "standard", requirements: "missing-or-unclear",
    });
    state = await artifacts.scaffoldArtifact(root, "f", state.revision, "requirements");
    state = await artifacts.recordArtifact(root, "f", state.revision, "requirements");
    state = await store.mutate(root, "f", state.revision, "test-confirmed-gates", (draft) => {
      draft.humanGates.requirement_confirmation = { status: "confirmed" };
      draft.humanGates.implementation_approval = { status: "confirmed" };
      draft.steps.requirement_confirmation = { status: "satisfied" };
      draft.steps.implementation_approval = { status: "satisfied" };
    });

    const file = path.join(root, ".dev-flow", "features", "f", state.artifacts.requirements.path);
    await writeFile(file, "# updated requirements\n");
    state = await artifacts.recordArtifact(root, "f", state.revision, "requirements");

    assert.equal(state.humanGates.requirement_confirmation, undefined);
    assert.equal(state.humanGates.implementation_approval, undefined);
    assert.equal(state.steps.requirement_confirmation, undefined);
    assert.equal(state.steps.implementation_approval, undefined);
  } finally { await rm(root, { recursive: true, force: true }); }
});
