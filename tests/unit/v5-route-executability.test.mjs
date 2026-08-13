import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { loadSource } from "../helpers/load-source.mjs";

const store = await loadSource("plugins/dev-flow/src/core/state-store.ts");
const decisions = await loadSource("plugins/dev-flow/src/core/decision-interactions.ts");

function configWith(commands) {
  return {
    schemaVersion: 2,
    verification: { commands },
    enforcement: { mode: "strict", gitWriteRequiresLogicComplete: true, oneActiveFeature: true, requireExplicitHumanReply: true },
    governedRoots: ["src"],
  };
}

const fullConfig = configWith([
  { id: "unit", command: process.execPath, args: ["-e", "process.exit(0)"], cwd: ".", provides: ["targeted", "behavior", "integration", "full"] },
]);

const facts = {
  level: "M", topology: "local", requirements: "provided-confirmed",
  scopeFactRefs: [], topologyFactRefs: [], uncertaintyFactRefs: [], riskFactRefs: {}, decisionRefs: [],
  signals: { changeSurface: "multi-component", behaviorChange: "new-capability", topology: "local", unitCount: 1, requirements: "provided-confirmed", operationalRecovery: false, executableRollback: false },
};
const boundaryAudit = { scanned: ["assumption", "free-space", "tbd", "fallback", "scope", "acceptance"], items: [] };

async function setup(prefix) {
  const root = await mkdtemp(path.join(os.tmpdir(), prefix));
  await mkdir(path.join(root, "src"));
  await store.initProject(root, fullConfig);
  let state = await store.startFeature(root, { featureId: "f", host: "codex" });
  state = await store.lockClassification(root, "f", state.revision, facts, boundaryAudit);
  assert.equal(decisions.pendingDecisionForState(state).kind, "route-confirmation");
  return { root, state };
}

async function confirm(root, state, host = "codex", eventId = "route-confirm") {
  await store.recordHostEvent(root, { eventId, type: "user-prompt", host, text: "确认这条路线" });
  return (await store.answer({ root, featureId: "f", expectedRevision: state.revision, host, credential: { source: "text", userReply: "确认这条路线" } })).state;
}

test("route confirmation binds user-visible route content, not the whole project config hash", async () => {
  const { root, state } = await setup("dev-flow-route-exec-");
  try {
    const before = state.routeConfirmation.basisHash;
    // 增加一条无关验证命令：路线确认不应失效（basisHash 不变、仍可确认）。
    const raw = await readFile(path.join(root, ".dev-flow", "project.json"));
    const additive = structuredClone(fullConfig);
    additive.verification.commands.push({ id: "extra", command: process.execPath, args: ["-e", "process.exit(0)"], cwd: ".", provides: ["targeted"] });
    await store.updateProjectConfig(root, additive, createHash("sha256").update(raw).digest("hex"));
    const current = await store.readState(root, "f");
    assert.equal(current.routeConfirmation.basisHash, before, "unrelated config change must not invalidate the confirmation");
    assert.equal(decisions.pendingDecisionForState(current).kind, "route-confirmation");

    const routed = await confirm(root, current);
    assert.equal(routed.mode, "routed");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("missing verification capability blocks confirmation without deleting the still-current route decision", async () => {
  const { root, state } = await setup("dev-flow-route-exec-missing-");
  try {
    // 确认前把提供全部保证的命令替换为只提供 targeted 的命令：路线需要
    // behavior/integration/full，配置不再覆盖。
    const raw = await readFile(path.join(root, ".dev-flow", "project.json"));
    const weakened = configWith([
      { id: "unit", command: process.execPath, args: ["-e", "process.exit(0)"], cwd: ".", provides: ["targeted"] },
    ]);
    await store.updateProjectConfig(root, weakened, createHash("sha256").update(raw).digest("hex"));

    await store.recordHostEvent(root, { eventId: "route-confirm", type: "user-prompt", host: "codex", text: "确认这条路线" });
    await assert.rejects(
      () => store.answer({ root, featureId: "f", expectedRevision: state.revision, host: "codex", credential: { source: "text", userReply: "确认这条路线" } }),
      (error) => error.code === "VERIFICATION_GUARANTEE_UNCONFIGURED" && Array.isArray(error.details.missingGuarantees),
    );
    // 路线确认未被删除，仍是 pending：执行条件失败不影响用户可见决定。
    const after = await store.readState(root, "f");
    assert.equal(decisions.pendingDecisionForState(after).kind, "route-confirmation");
    assert.ok(after.routeConfirmation, "route confirmation must be preserved");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("reclassify presents a fresh route confirmation when user-visible content changes", async () => {
  const { root, state } = await setup("dev-flow-route-exec-reclass-");
  try {
    await store.recordHostEvent(root, { eventId: "route-confirm", type: "user-prompt", host: "codex", text: "确认这条路线" });
    const routed = (await store.answer({ root, featureId: "f", expectedRevision: state.revision, host: "codex", credential: { source: "text", userReply: "确认这条路线" } })).state;
    const reclassified = await store.reclassifyFeature(root, "f", routed.revision, {
      level: "L", topology: "local", requirements: "provided-confirmed",
      classificationBasis: {
        scopeFactRefs: [], topologyFactRefs: [], uncertaintyFactRefs: [], riskFactRefs: {}, decisionRefs: [],
        signals: { changeSurface: "system-wide", behaviorChange: "systemic-change", topology: "local", unitCount: 1, requirements: "provided-confirmed", operationalRecovery: false, executableRollback: false },
      },
    }, "路线调整", "user confirmed reclassify");
    const pending = decisions.pendingDecisionForState(reclassified);
    assert.equal(pending.kind, "route-confirmation");
    assert.match(pending.question, /重新确认/);
    assert.notEqual(reclassified.routeConfirmation.basisHash, routed.routeConfirmation?.basisHash ?? "");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
