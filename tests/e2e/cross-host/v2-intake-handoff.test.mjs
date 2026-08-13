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

test("Claude/Codex 共享 intake、可信 decision 与锁定后的 v5 状态", async () => {
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
  // v5 分类引用已登记的仓库事实记录（ADR-0018）：先登记事实（并提交文件），
  // 再记录依赖当前内容指纹的决定，最后用事实 recordId 锁定路线。
  await writeFile(path.join(root, "src", "feature-fact.txt"), "shared contract evidence\n");
  execFileSync("git", ["add", "src/feature-fact.txt"], { cwd: root });
  execFileSync("git", ["commit", "-qm", "feature fact"], { cwd: root });
  const withFact = await state.registerRepositoryFact(root, intake.featureId, intake.revision, {
    assertion: "共享契约会影响多个调用方",
    location: { kind: "positive", path: "src/feature-fact.txt" },
  }, "codex");
  const factRef = withFact.recordId;
  await state.recordHostEvent(root, { eventId: "codex-existing-conclusion", type: "user-prompt", host: "codex", text: "允许共享契约变更" });
  const recorded = await state.recordDecision(root, intake.featureId, withFact.state.revision, "是否允许共享契约变更？", "调用方兼容性已核实", "允许共享契约变更", [factRef], "codex");
  // 较早对话的决定需要用户追认（issue 08）：确认后才是 resolved 决定
  await state.recordHostEvent(root, { eventId: "codex-ratify", type: "user-prompt", host: "codex", text: "确认登记" });
  const ratified = await state.resolveRatificationAnswer(root, intake.featureId, recorded.state.revision, recorded.interactionId, "确认登记", "codex");
  const pending = await state.lockClassification(root, intake.featureId, ratified.state.revision, {
    level: "M", topology: "shared-contract", requirements: "provided-confirmed",
    scopeFactRefs: [factRef], topologyFactRefs: [factRef], uncertaintyFactRefs: [],
    riskFactRefs: {}, decisionRefs: [recorded.decisionId],
    signals: { changeSurface: "multi-component", behaviorChange: "bounded-rule", topology: "shared-contract", unitCount: 1, requirements: "provided-confirmed", operationalRecovery: false, executableRollback: false },
  }, { scanned: ["assumption", "free-space", "tbd", "fallback", "scope", "acceptance"], items: [] });
  await state.recordHostEvent(root, { eventId: "codex-route-confirm", type: "user-prompt", host: "codex", text: "确认这条路线" });
  const routed = await state.confirmRouteClassification(root, intake.featureId, pending.revision, "确认这条路线", "codex");
  const handedOff = await state.readState(root, routed.featureId);
  assert.equal(handedOff.mode, "routed");
  assert.equal(handedOff.route, "m");
  assert.equal(handedOff.lastUpdatedBy.host, "codex");
  assert.equal(handedOff.governance.decisions[0].recordId, recorded.decisionId);
  assert.deepEqual(handedOff.classificationBasis, routed.classificationBasis);
});

test("Claude/Codex 对中文与分解 Unicode 路径使用同一 NFC 表示", () => {
  const fromClaude = delivery.implementationFiles({ files: ["src/需求a\u0301.js"] });
  const fromCodex = delivery.implementationFiles({ files: ["src/需求á.js"] });
  assert.deepEqual(fromClaude, fromCodex);
});
