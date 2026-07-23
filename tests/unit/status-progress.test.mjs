import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { loadSource } from "../helpers/load-source.mjs";

const store = await loadSource("plugins/dev-flow/src/core/state-store.ts");
const artifacts = await loadSource("plugins/dev-flow/src/core/artifacts.ts");
const status = await loadSource("plugins/dev-flow/src/core/status.ts");
const checks = await loadSource("plugins/dev-flow/src/core/feature-check.ts");
const gates = await loadSource("plugins/dev-flow/src/core/human-gates.ts");
const config = {
  schemaVersion: 1,
  verification: { commands: [{ id: "unit", command: "node", args: ["-e", "process.exit(0)"], cwd: "." }], behaviorCommands: [] },
  enforcement: { mode: "strict", gitWriteRequiresLogicComplete: true, oneActiveFeature: true, requireExplicitHumanReply: true },
  protectedRoots: ["src"],
};

async function setRequirements(root, body) {
  const file = path.join(root, ".dev-flow", "features", "f", "requirements.md");
  await writeFile(file, body);
}

test("status progress reports grill wait without changing revision", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "dev-flow-status-"));
  try {
    await store.initProject(root, config);
    let state = await store.startFeature(root, {
      featureId: "f", host: "claude", level: "M", topology: "local", execution: "standard", requirements: "missing-or-unclear",
    });
    state = await artifacts.scaffoldArtifact(root, "f", state.revision, "requirements");
    await setRequirements(root, `---
dev_flow:
  schema_version: 1
  feature_id: f
  route: standard-m
  kind: requirements
  grill_status: in_progress
  grill_question_id: Q-002
  grill_response_hint: "回复 A / B / C"
  grill_question_limit: 3
---

# Requirements

## Open Questions

- Q-002
`);
    state = await artifacts.recordArtifact(root, "f", state.revision, "requirements");
    const before = state.revision;
    const view = await status.readStatusView(root, "f");
    assert.equal(view.revision, before);
    assert.equal(view.progress.wait.kind, "grill");
    assert.equal(view.progress.wait.questionId, "Q-002");
    assert.match(view.progress.wait.responseHint, /A \/ B \/ C/);
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
    state = await checks.recordStep(root, "f", state.revision, "requirements", {});
    state = await gates.presentGate(root, "f", state.revision, "requirement_confirmation");
    const view = await status.readStatusView(root, "f");
    assert.equal(view.progress.wait.kind, "human-gate");
    assert.equal(view.progress.wait.gate, "requirement_confirmation");
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
    const view = await status.readStatusView(root, "f");
    assert.equal(view.revision, state.revision);
    assert.deepEqual(view.progress.nextAction, { kind: "run-step", step: "verification" });
    assert.equal(view.progress.currentStep, "verification");
    assert.ok(view.progress.remainingSteps.includes("verification"));
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
    await setRequirements(root, `---
dev_flow:
  schema_version: 1
  feature_id: f
  route: standard-m
  kind: requirements
  grill_status: in_progress
---
`);
    state = await artifacts.recordArtifact(root, "f", state.revision, "requirements");
    await assert.rejects(() => status.readStatusView(root, "f"), (error) => error.code === "GRILL_STATUS_INVALID");
  } finally { await rm(root, { recursive: true, force: true }); }
});
