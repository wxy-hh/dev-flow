import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { loadSource } from "../../helpers/load-source.mjs";

const state = await loadSource("plugins/dev-flow/src/core/state-store.ts");
const delivery = await loadSource("plugins/dev-flow/src/core/delivery-snapshot.ts");

const config = {
  schemaVersion: 2,
  verification: { commands: [{ id: "unit", command: process.execPath, args: ["-e", "process.exit(0)"], cwd: ".", provides: ["targeted", "behavior", "integration", "full"] }] },
  enforcement: { mode: "strict", gitWriteRequiresLogicComplete: true, oneActiveFeature: true, requireExplicitHumanReply: true },
  governedRoots: ["src"],
};

test("Claude/Codex 共享 intake、可信 resolved decision 与锁定后的 v4 状态", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "dev-flow-v2-interop-"));
  await mkdir(path.join(root, "src"));
  await writeFile(path.join(root, "src", "feature.txt"), "baseline\n");
  execFileSync("git", ["init", "-q"], { cwd: root });
  execFileSync("git", ["config", "user.email", "dev-flow@example.test"], { cwd: root });
  execFileSync("git", ["config", "user.name", "Dev Flow Test"], { cwd: root });
  execFileSync("git", ["add", "."], { cwd: root });
  execFileSync("git", ["commit", "-qm", "baseline"], { cwd: root });
  await state.initProject(root, config);

  const intake = await state.startFeature(root, {
    featureId: "handoff",
    objective: "调整共享模块行为",
    scope: { inScope: ["src/feature.txt"], outOfScope: [] },
    host: "claude",
  });
  await state.recordHostEvent(root, { eventId: "codex-existing-conclusion", type: "user-prompt", host: "codex", text: "允许共享契约变更" });
  const recorded = await state.recordDecision(root, intake.featureId, intake.revision, "是否允许共享契约变更？", "调用方兼容性已核实", "允许共享契约变更", ["scope"], "codex");
  const pending = await state.lockClassification(root, intake.featureId, recorded.state.revision, {
    level: "M", topology: "shared-contract", requirements: "provided-confirmed",
    scopeFacts: ["共享契约会影响多个调用方"], topologyFacts: ["存在共享调用方"], uncertaintyFacts: [],
    riskFacts: {}, decisionRefs: [recorded.decisionId],
    signals: { changeSurface: "multi-component", behaviorChange: "bounded-rule", topology: "shared-contract", unitCount: 1, requirements: "provided-confirmed", operationalRecovery: false, executableRollback: false },
  }, { scanned: ["assumption", "free-space", "tbd", "fallback", "scope", "acceptance"], items: [] });
  await state.recordHostEvent(root, { eventId: "codex-route-confirm", type: "user-prompt", host: "codex", text: "确认这条路线" });
  const routed = await state.confirmRouteClassification(root, intake.featureId, pending.revision, "确认这条路线", "codex");
  const handedOff = await state.readState(root, routed.featureId);
  assert.equal(handedOff.mode, "routed");
  assert.equal(handedOff.route, "m");
  assert.equal(handedOff.lastUpdatedBy.host, "codex");
  assert.equal(handedOff.decisionLedger[0].status, "resolved");
  assert.deepEqual(handedOff.classificationBasis, routed.classificationBasis);
});

test("Claude/Codex 对中文与分解 Unicode 路径使用同一 NFC 表示", () => {
  const fromClaude = delivery.implementationFiles({ files: ["src/需求a\u0301.js"] });
  const fromCodex = delivery.implementationFiles({ files: ["src/需求á.js"] });
  assert.deepEqual(fromClaude, fromCodex);
});
