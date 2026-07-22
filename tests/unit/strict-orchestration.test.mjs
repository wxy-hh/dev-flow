import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { loadSource } from "../helpers/load-source.mjs";

const store = await loadSource("plugins/dev-flow/src/core/state-store.ts");
const artifacts = await loadSource("plugins/dev-flow/src/core/artifacts.ts");
const checks = await loadSource("plugins/dev-flow/src/core/feature-check.ts");
const config = { schemaVersion: 1, verification: { commands: [{ id: "unit", command: "node", args: ["-e", "process.exit(0)"], cwd: "." }], behaviorCommands: [] }, enforcement: { mode: "strict", gitWriteRequiresLogicComplete: true, oneActiveFeature: true, requireExplicitHumanReply: true }, protectedRoots: ["src"] };

test("direct MCP-core calls cannot skip route order, current assets, or risk evidence", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "dev-flow-strict-"));
  try {
    await store.initProject(root, config);
    let standard = await store.startFeature(root, { featureId: "standard", host: "claude", level: "M", topology: "local", execution: "standard", requirements: "missing-or-unclear" });
    await assert.rejects(() => checks.recordStep(root, "standard", standard.revision, "code_review", { reviewType: "code" }), /STEP_OUT_OF_ORDER/);
    await assert.rejects(() => artifacts.scaffoldArtifact(root, "standard", standard.revision, "status"), /ARTIFACT_OUT_OF_ORDER/);
    standard = await artifacts.scaffoldArtifact(root, "standard", standard.revision, "requirements");
    assert.ok(standard.artifacts.requirements);

    let risky = await store.startFeature(root, { featureId: "risky", activation: "paused", host: "codex", level: "XS", topology: "local", riskLabels: ["security"] });
    risky = await store.switchActive(root, "standard", "risky", "test handoff").then(() => store.readState(root, "risky"));
    risky = await artifacts.scaffoldArtifact(root, "risky", risky.revision, "risk-card");
    risky = await checks.recordStep(root, "risky", risky.revision, "risk_review", {});
    await assert.rejects(() => checks.recordStep(root, "risky", risky.revision, "risk_controls", { checks: [] }), /RISK_EVIDENCE_INCOMPLETE/);
    risky = await checks.recordStep(root, "risky", risky.revision, "risk_controls", { checks: ["security"] });
    assert.equal(risky.steps.risk_controls.status, "satisfied");
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("corrupt schema-v1 state fails closed instead of being accepted", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "dev-flow-state-schema-"));
  try {
    await store.initProject(root, config); await store.startFeature(root, { featureId: "f", host: "claude", level: "XS", topology: "local" });
    await writeFile(path.join(root, ".dev-flow", "features", "f", "state.json"), JSON.stringify({ schemaVersion: 1, featureId: "f" }));
    await assert.rejects(() => store.readState(root, "f"), /INVALID_STATE_SCHEMA/);
  } finally { await rm(root, { recursive: true, force: true }); }
});
