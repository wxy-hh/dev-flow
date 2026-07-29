import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { loadSource } from "../helpers/load-source.mjs";
import { registerTraceFixture } from "../helpers/trace-fixtures.mjs";

const store = await loadSource("plugins/dev-flow/src/core/state-store.ts");
const artifacts = await loadSource("plugins/dev-flow/src/core/artifacts.ts");
const status = await loadSource("plugins/dev-flow/src/core/status.ts");
const checks = await loadSource("plugins/dev-flow/src/core/feature-check.ts");
const gates = await loadSource("plugins/dev-flow/src/core/human-gates.ts");
const verification = await loadSource("plugins/dev-flow/src/core/verification.ts");
const grill = await loadSource("plugins/dev-flow/src/core/requirements-grill.ts");
const config = {
  schemaVersion: 1,
  verification: { commands: [{ id: "unit", command: "node", args: ["-e", "process.exit(0)"], cwd: "." }], behaviorCommands: [] },
  enforcement: { mode: "strict", gitWriteRequiresLogicComplete: true, oneActiveFeature: true, requireExplicitHumanReply: true },
  protectedRoots: ["src"],
};

test("status progress reports grill wait without changing revision", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "dev-flow-status-"));
  try {
    await store.initProject(root, config);
    let state = await store.startFeature(root, {
      featureId: "f", host: "claude", level: "M", topology: "local", execution: "standard", requirements: "missing-or-unclear",
    });
    state = await artifacts.scaffoldArtifact(root, "f", state.revision, "requirements");
    state = await registerTraceFixture({
      root, featureId: "f", state, kind: "requirements",
      edit: (markdown) => markdown.replace(
        /^  grill_status: pending$/m,
        "  grill_status: in_progress\n  grill_question_id: Q-002\n  grill_response_hint: \"回复 A / B / C\"\n  grill_question_limit: 3",
      ),
    });
    const before = state.revision;
    const view = await status.readStatusView(root, "f");
    assert.equal(view.revision, before);
    assert.equal(view.reviewStatus.enforced, true);
    assert.equal(view.reviewStatus.projection.batch.visibility, "coarse");
    assert.equal(view.progress.wait.kind, "grill");
    assert.equal(view.progress.wait.questionId, "Q-002");
    assert.match(view.progress.wait.responseHint, /A \/ B \/ C/);
    const decision = await grill.requestGrillDecision(root, "f", state.revision, {
      questionId: "Q-002",
      question: "选择同步方案",
      options: [{ id: "hosted", label: "托管同步" }, { id: "other", label: "其他 / 补充", requiresComment: true }],
      host: "claude",
    });
    const withInteraction = await status.readStatusView(root, "f");
    assert.equal(withInteraction.progress.wait.interaction.id, decision.interaction.id);
    assert.match(withInteraction.progress.wait.responseHint, /^托管同步: DF-/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("status progress reports human gates", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "dev-flow-status-gate-"));
  try {
    await store.initProject(root, config);
    let state = await store.startFeature(root, {
      featureId: "f", host: "claude", level: "M", topology: "local", execution: "standard", requirements: "provided-confirmed",
    });
    state = await artifacts.scaffoldArtifact(root, "f", state.revision, "requirements");
    state = await registerTraceFixture({ root, featureId: "f", state, kind: "requirements" });
    state = await checks.recordStep(root, "f", state.revision, "requirements", {});
    state = await gates.presentGate(root, "f", state.revision, "requirement_confirmation");
    const view = await status.readStatusView(root, "f");
    assert.equal(view.progress.wait.kind, "human-gate");
    assert.equal(view.progress.wait.gate, "requirement_confirmation");
    assert.match(view.progress.wait.replyHint, /^确认需求: DF-/);
    assert.equal(view.progress.wait.interaction.options[0].label, "确认需求");
    state = await gates.resolveGateElicitation(root, "f", state.revision, state.gateInteraction.id, "request-changes", "补充边界条件", "claude");
    const returned = await status.readStatusView(root, "f");
    assert.match(returned.progress.wait.replyHint, /已记录修改意见/);
    assert.equal(returned.progress.wait.feedback, "补充边界条件");
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("status and next report stale verification without changing revision", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "dev-flow-status-stale-"));
  try {
    await store.initProject(root, config);
    await mkdir(path.join(root, "src"));
    await writeFile(path.join(root, "src", "app.js"), "changed\n");
    const state = await store.startFeature(root, { featureId: "f", host: "codex", level: "XS", topology: "local" });
    const file = path.join(root, ".dev-flow", "features", "f", "state.json");
    const raw = JSON.parse(await readFile(file, "utf8"));
    raw.steps = { locate: { status: "satisfied" }, implementation: { status: "satisfied" }, verification: { status: "satisfied" } };
    raw.verification = { attempts: [], verifiedFingerprint: "obsolete", satisfiedByAttemptId: 1 };
    raw.businessFingerprint = "obsolete";
    await writeFile(file, `${JSON.stringify(raw, null, 2)}\n`);
    const eventsFile = path.join(root, ".dev-flow", "features", "f", "events.jsonl");
    const eventsSize = (await stat(eventsFile)).size;
    const view = await status.readStatusView(root, "f");
    assert.equal(view.revision, state.revision);
    assert.equal((await stat(eventsFile)).size, eventsSize);
    assert.deepEqual(view.progress.nextAction, {
      kind: "run-step",
      step: "verification",
      requiredEvidence: { fields: {}, checks: [], verificationKinds: ["targeted"] },
    });
    assert.equal(view.progress.requiredEvidence.verificationKinds[0], "targeted");
    assert.equal(view.progress.verificationFreshness.status, "stale");
    assert.equal(view.progress.verificationFreshness.reasonCode, "VERIFICATION_STALE");
    assert.equal(view.progress.verificationFreshness.recoveryHint, "Protected files changed; rerun verification before feature-check or finalize");
    assert.equal(view.progress.currentStep, "verification");
    assert.ok(view.progress.remainingSteps.includes("verification"));
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("status reports missing and fresh verification without mutation", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "dev-flow-status-freshness-"));
  try {
    await store.initProject(root, config);
    await mkdir(path.join(root, "src"));
    await writeFile(path.join(root, "src", "app.js"), "export const value = 1;\n");
    let state = await store.startFeature(root, { featureId: "f", host: "codex", level: "XS", topology: "local" });
    const missing = await status.readStatusView(root, "f");
    assert.equal(missing.progress.verificationFreshness.status, "missing");
    state = await checks.recordStep(root, "f", state.revision, "locate", {});
    state = await checks.recordStep(root, "f", state.revision, "implementation", { files: [] });
    state = await verification.runVerification(root, "f", state.revision, "codex");
    const eventsFile = path.join(root, ".dev-flow", "features", "f", "events.jsonl");
    const revision = state.revision;
    const eventsSize = (await stat(eventsFile)).size;
    const fresh = await status.readStatusView(root, "f");
    assert.equal(fresh.revision, revision);
    assert.equal((await stat(eventsFile)).size, eventsSize);
    assert.equal(fresh.progress.verificationFreshness.status, "fresh");
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("status exposes optional acceptance assistance without making it a blocker", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "dev-flow-status-acceptance-assist-"));
  try {
    await store.initProject(root, config);
    await mkdir(path.join(root, "src"));
    await writeFile(path.join(root, "src", "app.js"), "export const value = 1;\n");
    await store.startFeature(root, {
      featureId: "f", host: "codex", level: "XS", topology: "local", manualAcceptanceRequired: true,
    });
    const view = await status.readStatusView(root, "f");
    assert.deepEqual(view.progress.acceptanceAssist, { suggested: true, blocking: false });
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("status surfaces incomplete in-progress grill metadata", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "dev-flow-status-grill-invalid-"));
  try {
    await store.initProject(root, config);
    let state = await store.startFeature(root, {
      featureId: "f", host: "claude", level: "M", topology: "local", execution: "standard", requirements: "missing-or-unclear",
    });
    state = await artifacts.scaffoldArtifact(root, "f", state.revision, "requirements");
    state = await registerTraceFixture({
      root, featureId: "f", state, kind: "requirements",
      edit: (markdown) => markdown.replace(/^  grill_status: pending$/m, "  grill_status: in_progress"),
    });
    await assert.rejects(() => status.readStatusView(root, "f"), (error) => error.code === "GRILL_STATUS_INVALID");
  } finally { await rm(root, { recursive: true, force: true }); }
});
