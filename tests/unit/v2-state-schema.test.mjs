import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { loadSource } from "../helpers/load-source.mjs";

const state = await loadSource("plugins/dev-flow/src/core/state-store.ts");
const decisions = await loadSource("plugins/dev-flow/src/core/decision-interactions.ts");
const steps = await loadSource("plugins/dev-flow/src/core/feature-check.ts");
const config = {
  schemaVersion: 2,
  verification: { commands: [{ id: "unit", command: process.execPath, args: ["-e", "process.exit(0)"], cwd: ".", provides: ["targeted", "behavior", "integration", "full"] }] },
  enforcement: { mode: "strict", gitWriteRequiresLogicComplete: true, oneActiveFeature: true, requireExplicitHumanReply: true },
  governedRoots: ["src"],
};
const facts = {
  level: "M", topology: "local", requirements: "provided-confirmed",
  scopeFactRefs: [], topologyFactRefs: [], uncertaintyFactRefs: [], riskFactRefs: {}, decisionRefs: [],
  signals: { changeSurface: "multi-component", behaviorChange: "new-capability", topology: "local", unitCount: 1, requirements: "provided-confirmed", operationalRecovery: false, executableRollback: false },
};
const boundaryAudit = { scanned: ["assumption", "free-space", "tbd", "fallback", "scope", "acceptance"], items: [] };

function basis(changeSurface, behaviorChange, topology = "local", riskFactRefs = {}) {
  return {
    scopeFactRefs: [], topologyFactRefs: [], uncertaintyFactRefs: [], riskFactRefs, decisionRefs: [],
    signals: { changeSurface, behaviorChange, topology, unitCount: 1, requirements: "provided-confirmed", operationalRecovery: false, executableRollback: false },
  };
}

test("start creates intake and route confirmation atomically creates routed v4 state", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "dev-flow-v2-state-"));
  await mkdir(path.join(root, "src"));
  await state.initProject(root, config);
  const intake = await state.startFeature(root, { featureId: "f", objective: "调整模块行为", scope: { inScope: ["src/需求a\u0301"], outOfScope: [] }, host: "codex" });
  assert.equal(intake.schemaVersion, 5);
  assert.equal(intake.mode, "intake");
  assert.equal(intake.route, undefined);
  assert.deepEqual(intake.scope.inScope, ["src/需求á"]);
  const pending = await state.lockClassification(root, "f", intake.revision, facts, boundaryAudit);
  assert.equal(decisions.pendingDecisionForState(pending).kind, "route-confirmation");
  await state.recordHostEvent(root, { eventId: "route-confirm", type: "user-prompt", host: "codex", text: "确认这条路线" });
  const routed = (await state.answer({ root, featureId: "f", expectedRevision: pending.revision, host: "codex", credential: { source: "text", userReply: "确认这条路线" } })).state;
  assert.equal(routed.mode, "routed");
  assert.equal(routed.route, "m");
  assert.equal(routed.schemaVersion, 5);
  assert.ok(routed.classificationBasis);
});

test("pre-v4 state is rejected with an actionable hard-cut error", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "dev-flow-v2-legacy-"));
  await mkdir(path.join(root, ".dev-flow", "features", "legacy"), { recursive: true });
  await writeFile(path.join(root, ".dev-flow", "features", "legacy", "state.json"), JSON.stringify({ schemaVersion: 1 }));
  await assert.rejects(() => state.readState(root, "legacy"), /UNSUPPORTED_FEATURE_SCHEMA/);
});

test("v4 JSON schema closes runtime state and has no feature-check compatibility field", async () => {
  const schema = JSON.parse(await readFile(path.resolve("plugins/dev-flow/policy/state.schema.json"), "utf8"));
  assert.equal(schema.additionalProperties, false);
  assert.ok(schema.required.includes("governance"));
  assert.equal(schema.required.includes("qualityExceptions"), false);
  assert.ok(schema.properties.workspace.required.includes("observedPathFingerprints"));
  assert.equal("featureCheck" in schema.properties, false);
  assert.equal(schema.$defs.classificationBasis.properties.controlEnhancements.$ref, "#/$defs/controlEnhancements");
  const intakeRule = schema.allOf[0].then.not.anyOf.flatMap((entry) => entry.required);
  assert.deepEqual(intakeRule, ["route", "classification", "classificationBasis", "obligations", "currentStage"]);
});

test("lock with contradictory classification args reports a readable contradiction", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "dev-flow-v2-lock-contradiction-"));
  await mkdir(path.join(root, "src"));
  await state.initProject(root, config);
  const intake = await state.startFeature(root, { featureId: "f", host: "codex" });
  await assert.rejects(
    () => state.lockClassification(root, "f", intake.revision, {
      level: "M", topology: "local",
      scopeFactRefs: [], topologyFactRefs: [], uncertaintyFactRefs: [],
      riskFactRefs: {}, decisionRefs: [],
      signals: { changeSurface: "system-wide", behaviorChange: "systemic-change", topology: "local", unitCount: 1, requirements: "provided-confirmed", operationalRecovery: false, executableRollback: false },
    }, boundaryAudit),
    (error) => {
      assert.equal(error.code, "CLASSIFICATION_BELOW_CORE_MINIMUM");
      return true;
    },
  );
});

test("pre-write reclassification can correct facts downward and re-presents material routes", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "dev-flow-v5-reclassify-prewrite-"));
  await mkdir(path.join(root, "src"));
  await state.initProject(root, config);
  const intake = await state.startFeature(root, { featureId: "f", host: "codex" });
  let routed = await state.lockClassification(root, "f", intake.revision, {
    level: "S", topology: "local", requirements: "provided-confirmed",
    ...basis("single-component", "bounded-rule"),
  }, boundaryAudit);
  assert.equal(routed.route, "s");

  routed = await state.reclassifyFeature(root, "f", routed.revision, {
    classificationBasis: basis("single-site", "mechanical"),
  }, "仓库取证确认只有一个机械修改点");
  assert.equal(routed.route, "xs");
  assert.equal(routed.pendingDecision, undefined);

  const pending = await state.reclassifyFeature(root, "f", routed.revision, {
    classificationBasis: basis("multi-component", "new-capability"),
  }, "发现跨组件新能力");
  assert.equal(pending.route, "xs");
  assert.equal(decisions.pendingDecisionForState(pending).kind, "route-confirmation");
  assert.equal(pending.routeConfirmation.facts.level, "M");
});

test("after the first governed write reclassification is monotonic", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "dev-flow-v5-reclassify-write-"));
  await mkdir(path.join(root, "src"));
  await writeFile(path.join(root, "src", "app.ts"), "export const value = 1;\n");
  await state.initProject(root, config);
  const intake = await state.startFeature(root, { featureId: "f", host: "codex" });
  let routed = await state.lockClassification(root, "f", intake.revision, {
    level: "S", topology: "local", requirements: "provided-confirmed",
    ...basis("single-component", "bounded-rule"),
  }, boundaryAudit);
  routed = await steps.recordStep(root, "f", routed.revision, "boundary", {});
  await state.recordTrustedWriteIntent(root, ["src/app.ts"], "codex", "write-1");
  await writeFile(path.join(root, "src", "app.ts"), "export const value = 2;\n");
  await state.recordTrustedWriteOwnership(root, ["src/app.ts"], "codex", "write-1");
  routed = await state.readState(root, "f");

  await assert.rejects(
    () => state.reclassifyFeature(root, "f", routed.revision, {
      classificationBasis: basis("single-site", "mechanical"),
    }, "尝试降低治理"),
    (error) => error.code === "RECLASSIFICATION_DOWNGRADE_FORBIDDEN",
  );
});
