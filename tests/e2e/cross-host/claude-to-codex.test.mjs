import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { loadSource } from "../../helpers/load-source.mjs";
import { registerTraceFixture } from "../../helpers/trace-fixtures.mjs";

const store = await loadSource("plugins/dev-flow/src/core/state-store.ts");
const gates = await loadSource("plugins/dev-flow/src/core/human-gates.ts");
const artifacts = await loadSource("plugins/dev-flow/src/core/artifacts.ts");
const checks = await loadSource("plugins/dev-flow/src/core/feature-check.ts");
const config = {
  schemaVersion: 1,
  verification: { commands: [{ id: "unit", command: "node", args: ["--test"], cwd: "." }], behaviorCommands: [] },
  enforcement: { mode: "strict", gitWriteRequiresLogicComplete: true, oneActiveFeature: true, requireExplicitHumanReply: true },
  protectedRoots: ["src"],
};

test("Claude creates a standard M feature and Codex confirms the next user turn", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "dev-flow-interop-"));
  try {
    await store.initProject(root, config);
    let state = await store.startFeature(root, {
      featureId: "f", level: "M", topology: "local", execution: "standard", requirements: "provided-confirmed", host: "claude",
    });
    state = await artifacts.scaffoldArtifact(root, "f", state.revision, "requirements");
    state = await registerTraceFixture({ root, featureId: "f", state, kind: "requirements" });
    state = await checks.recordStep(root, "f", state.revision, "requirements", {});
    state = await gates.presentGate(root, "f", state.revision, "requirement_confirmation");
    await store.recordHostEvent(root, { eventId: "claude-later-turn", type: "user-prompt", host: "claude", text: "确认需求" });
    state = await gates.confirmGate(root, "f", state.revision, "requirement_confirmation", "确认需求", { promptEventId: "claude-later-turn" }, "claude");
    state = await artifacts.scaffoldArtifact(root, "f", state.revision, "implementation-plan");
    state = await registerTraceFixture({ root, featureId: "f", state, kind: "implementation-plan" });
    state = await checks.recordStep(root, "f", state.revision, "implementation_plan", {});
    state = await artifacts.scaffoldArtifact(root, "f", state.revision, "coverage-matrix");
    state = await registerTraceFixture({ root, featureId: "f", state, kind: "coverage-matrix" });
    state = await checks.recordStep(root, "f", state.revision, "coverage_review", {});
    state = await checks.recordStep(root, "f", state.revision, "rollback_unit", {});
    state = await checks.recordStep(root, "f", state.revision, "plan_review", { reviewType: "plan" });
    state = await artifacts.scaffoldArtifact(root, "f", state.revision, "status");
    state = await gates.presentGate(root, "f", state.revision, "implementation_approval");
    await store.recordHostEvent(root, { eventId: "codex-later-turn", type: "user-prompt", host: "codex", text: "批准实现" });
    state = await gates.confirmGate(root, "f", state.revision, "implementation_approval", "批准实现", { promptEventId: "codex-later-turn" }, "codex");
    assert.equal(state.lastUpdatedBy.host, "codex");
    assert.equal(state.humanGates.implementation_approval.confirmation.host, "codex");
  } finally { await rm(root, { recursive: true, force: true }); }
});
