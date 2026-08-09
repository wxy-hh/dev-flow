import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { createTinyApp } from "../helpers/fixture-repo.mjs";
import { invokeHook } from "../helpers/host-runner.mjs";
import { buildTestBundles } from "../helpers/test-bundle.mjs";
import { claimCapability, driveUntil, routeFlowConfig } from "../helpers/route-flow.mjs";
import { registerTraceFixture, traceDeltaFor } from "../helpers/trace-fixtures.mjs";
import { loadSource } from "../helpers/load-source.mjs";

const store = await loadSource("plugins/dev-flow/src/core/state-store.ts");
const jobs = await loadSource("plugins/dev-flow/src/core/review-jobs.ts");
const traceStore = await loadSource("plugins/dev-flow/src/core/traceability-store.ts");

const routeInput = {
  level: "M",
  topology: "shared-contract",
  requirements: "provided-confirmed",
  scopeFacts: ["多个受治理文件"],
  topologyFacts: ["共享契约"],
  uncertaintyFacts: [],
  riskFacts: {},
  decisionRefs: [],
};

const classificationFacts = {
  ...routeInput,
  signals: {
    changeSurface: "multi-component",
    behaviorChange: "new-capability",
    topology: "shared-contract",
    unitCount: 1,
    requirements: "provided-confirmed",
    operationalRecovery: true,
    executableRollback: false,
  },
};

const boundaryAudit = { scanned: ["assumption", "free-space", "tbd", "fallback", "scope", "acceptance"], items: [] };

function pendingInteraction(state, kind) {
  const found = Object.values(state.interactions ?? {}).find((interaction) => interaction.status === "pending" && interaction.kind === kind);
  assert.ok(found, `missing pending ${kind} interaction`);
  return found;
}

async function answerOwnership(hook, root, state, text, eventId) {
  const interaction = pendingInteraction(state, "workspace-ownership");
  await invokeHook(hook, root, { hook_event_name: "UserPromptSubmit", event_id: eventId, prompt: text });
  return (await store.resolveWorkspaceOwnershipText(root, state.featureId, state.revision, interaction.id, text, "codex")).state;
}

async function lockAndConfirmRoute(hook, root, state, host = "codex") {
  let current = await store.lockClassification(root, state.featureId, state.revision, classificationFacts, boundaryAudit);
  const route = Object.values(current.interactions ?? {}).find((interaction) => interaction.status === "pending" && interaction.kind === "route-confirmation");
  if (route) {
    await invokeHook(hook, root, { hook_event_name: "UserPromptSubmit", event_id: `route-${current.revision}`, prompt: "路线没问题" });
    current = await store.confirmRouteClassification(root, current.featureId, current.revision, "路线没问题", host);
  }
  return current;
}

async function submitReviewBatch(root, state, batch, completionForRole) {
  let current = state;
  let findingId;
  for (const job of batch.jobs) {
    const capability = claimCapability(job.jobId, "audit-journey");
    current = (await jobs.claimReviewJob(root, state.featureId, current.revision, batch.batchId, job.jobId, capability)).state;
    const completion = completionForRole(job, findingId);
    const submitted = await jobs.submitReviewJob(root, state.featureId, current.revision, batch.batchId, job.jobId, capability, completion);
    current = submitted.state;
    findingId ??= submitted.batch.jobs.find((candidate) => candidate.jobId === job.jobId)?.submission?.findings[0]?.findingId;
  }
  return { state: current, findingId };
}

test("audit journey 1: revision-0 ownership, hook recovery, stable control fingerprint, finding repair, finalize", { timeout: 240_000 }, async () => {
  const fixture = await createTinyApp();
  const bundles = await buildTestBundles();
  const hook = bundles.pathFor("codex-hook");
  try {
    await store.initProject(fixture.root, routeFlowConfig);
    await invokeHook(hook, fixture.root, { hook_event_name: "SessionStart", event_id: "audit-session" });
    await writeFile(path.join(fixture.root, "src", "started-a.js"), "export const a = 1;\n");
    await writeFile(path.join(fixture.root, "src", "started-b.js"), "export const b = 1;\n");
    let state = await store.startFeature(fixture.root, { featureId: "audit-one", objective: "重放第一条审计旅程", host: "codex" });
    assert.equal(state.revision, 0);
    state = await answerOwnership(hook, fixture.root, state, "这些都算当前任务的", "revision-zero-answer");

    // Simulate a dead hook interval: writes happen with no PostToolUse event.
    await store.recordHostHealth(fixture.root, { host: "codex", kind: "session-start", eventId: "stale-gap", at: "2020-01-01T00:00:00.000Z" });
    await writeFile(path.join(fixture.root, "src", "during-gap-a.js"), "export const gapA = 1;\n");
    await writeFile(path.join(fixture.root, "src", "during-gap-b.js"), "export const gapB = 1;\n");
    await invokeHook(hook, fixture.root, { hook_event_name: "SessionStart", event_id: "hook-recovered" });
    state = await store.readState(fixture.root, state.featureId);
    assert.deepEqual(state.workspace.unownedPaths, ["src/during-gap-a.js", "src/during-gap-b.js"]);
    state = await answerOwnership(hook, fixture.root, state, "全部纳入", "recovered-batch-answer");
    state = await lockAndConfirmRoute(hook, fixture.root, state);

    const ready = await driveUntil(fixture.root, state.featureId, state, {
      input: routeInput,
      stopAt: (action) => action.kind === "create-review-batch",
    });
    state = ready.state;
    const first = await jobs.createReviewBatch(fixture.root, state.featureId, state.revision);
    const firstSubmitted = await submitReviewBatch(fixture.root, first.state, first.batch, (job) => job.role === "architecture-testability"
      ? { coverageSummary: "发现边界测试缺口", findings: [{
          severity: "blocking", category: job.role, targets: ["src/counter.js"],
          evidence: [{ path: "src/counter.js", line: 1 }], claim: "缺少边界断言", recommendation: "在计划中补齐测试",
        }] }
      : { coverageSummary: "审查通过", findings: [] });
    assert.ok(firstSubmitted.findingId);

    const unchanged = await jobs.createReviewBatch(fixture.root, state.featureId, firstSubmitted.state.revision);
    assert.equal(unchanged.created, false, ".dev-flow writes must not change the governed review basis");
    assert.equal(unchanged.batch.batchId, first.batch.batchId);

    state = await registerTraceFixture({
      root: fixture.root,
      featureId: state.featureId,
      state: firstSubmitted.state,
      kind: "implementation-plan",
      delta: traceDeltaFor("implementation-plan", "m"),
      edit: (markdown) => `${markdown}\n修复：为共享边界补齐明确测试断言。\n`,
    });
    const successor = await jobs.createReviewBatch(fixture.root, state.featureId, state.revision);
    const repaired = await submitReviewBatch(fixture.root, successor.state, successor.batch, (job) => ({
      coverageSummary: `${job.role} 后继审查完成`,
      findings: [],
      ...(job.carriedFindings?.length ? { resolutions: job.carriedFindings.map((finding) => ({
        findingId: finding.findingId,
        outcome: "resolved",
        note: "计划已补齐边界断言",
        evidence: [{ path: state.artifacts["implementation-plan"].path }],
      })) } : {}),
    }));

    const completed = await driveUntil(fixture.root, state.featureId, repaired.state, {
      input: routeInput,
      host: "codex",
      recordPrompt: async ({ eventId, text }) => invokeHook(hook, fixture.root, { hook_event_name: "UserPromptSubmit", event_id: eventId, prompt: text }),
    });
    assert.equal(completed.state.lifecycle, "finalized");
    assert.equal(completed.state.logicComplete, true);
  } finally {
    await bundles.dispose();
    await fixture.dispose();
  }
});

test("audit journey 2: guarantee repair is scoped and semantic approval is reused", { timeout: 240_000 }, async () => {
  const fixture = await createTinyApp();
  try {
    const incomplete = structuredClone(routeFlowConfig);
    incomplete.verification.commands[0].provides = ["targeted"];
    await store.initProject(fixture.root, incomplete);
    await store.recordHostHealth(fixture.root, { host: "claude", kind: "session-start", eventId: "journey-two-health" });
    let state = await store.startFeature(fixture.root, { featureId: "guarantee-gap", objective: "重放保证缺口", host: "claude" });
    await assert.rejects(
      () => store.lockClassification(fixture.root, state.featureId, state.revision, classificationFacts, boundaryAudit),
      (error) => error.code === "VERIFICATION_GUARANTEE_UNCONFIGURED",
    );
    const raw = await readFile(path.join(fixture.root, ".dev-flow", "project.json"));
    const repairedConfig = JSON.parse(raw);
    repairedConfig.verification.commands.push({
      id: "route-guarantees", command: "node", args: ["--test"], cwd: ".", provides: ["behavior", "integration", "full"],
    });
    const updated = await store.updateProjectConfig(fixture.root, repairedConfig, createHash("sha256").update(raw).digest("hex"));
    assert.deepEqual(updated.affectedEvidence.traceNodeIds, []);

    state = await store.lockClassification(fixture.root, state.featureId, state.revision, classificationFacts, boundaryAudit);
    pendingInteraction(state, "route-confirmation");
    await store.recordHostEvent(fixture.root, { eventId: "route-two", type: "user-prompt", host: "claude", text: "确认路线" });
    state = await store.confirmRouteClassification(fixture.root, state.featureId, state.revision, "确认路线", "claude");
    const toApproval = await driveUntil(fixture.root, state.featureId, state, {
      input: routeInput,
      host: "claude",
      stopAt: (_action, current) => Object.values(current.humanGates).some((gate) => gate.status === "confirmed"),
    });
    state = toApproval.state;
    const approval = Object.entries(state.humanGates).find(([, gate]) => gate.status === "confirmed");
    assert.ok(approval);
    const [approvalId, gateBefore] = approval;

    const configRaw = await readFile(path.join(fixture.root, ".dev-flow", "project.json"));
    const commandChanged = JSON.parse(configRaw);
    commandChanged.verification.commands.push({
      id: "lint-extra",
      command: "node",
      args: ["--version"],
      cwd: ".",
      provides: ["targeted"],
    });
    const scoped = await store.updateProjectConfig(
      fixture.root,
      commandChanged,
      createHash("sha256").update(configRaw).digest("hex"),
    );
    assert.deepEqual(scoped.affectedEvidence.traceNodeIds, []);
    assert.deepEqual(scoped.affectedEvidence.reviewRoles, []);

    state = await registerTraceFixture({
      root: fixture.root,
      featureId: state.featureId,
      state,
      kind: "implementation-plan",
      delta: traceDeltaFor("implementation-plan", "m"),
      edit: (markdown) => `${markdown}\n说明：只调整文字，不改变 TASK、TEST、RU 或文件范围。\n`,
    });
    assert.equal(state.humanGates[approvalId].status, "confirmed");
    assert.equal(state.humanGates[approvalId].basisHash, gateBefore.basisHash);
    assert.equal(state.obligations.find((item) => item.id === approvalId).status, "satisfied");
    const recoveredTrace = await traceStore.readTraceability(fixture.root, state);
    assert.equal(recoveredTrace.nodes["RU-001"].status, "current");
    assert.equal(recoveredTrace.nodes["REQ-001"].status, "current");
  } finally {
    await fixture.dispose();
  }
});
