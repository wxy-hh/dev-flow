import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { loadSource } from "../helpers/load-source.mjs";

const store = await loadSource("plugins/dev-flow/src/core/state-store.ts");
const artifacts = await loadSource("plugins/dev-flow/src/core/artifacts.ts");
const checks = await loadSource("plugins/dev-flow/src/core/feature-check.ts");
const gates = await loadSource("plugins/dev-flow/src/core/human-gates.ts");
const verification = await loadSource("plugins/dev-flow/src/core/verification.ts");
const config = { schemaVersion: 1, verification: { commands: [{ id: "unit", command: "node", args: ["-e", "process.exit(0)"], cwd: "." }], behaviorCommands: [] }, enforcement: { mode: "strict", gitWriteRequiresLogicComplete: true, oneActiveFeature: true, requireExplicitHumanReply: true }, protectedRoots: ["src"] };

const fileFor = (root) => path.join(root, ".dev-flow", "features", "f", "requirements.md");
async function setStatus(root, status) {
  const file = fileFor(root);
  await writeFile(file, (await readFile(file, "utf8")).replace(/^  grill_status: [^\r\n]+$/m, `  grill_status: ${status}`));
}
async function start(root, requirements) {
  await store.initProject(root, config);
  let state = await store.startFeature(root, { featureId: "f", host: "claude", level: "M", topology: "local", execution: "standard", requirements });
  return artifacts.scaffoldArtifact(root, "f", state.revision, "requirements");
}
async function writeLegacyState(root, mutate) {
  const file = path.join(root, ".dev-flow", "features", "f", "state.json");
  const state = JSON.parse(await readFile(file, "utf8"));
  mutate(state);
  await writeFile(file, `${JSON.stringify(state, null, 2)}\n`);
  return state;
}

test("requirements scaffolds the fixed grill status for every requirements state", async () => {
  for (const [requirements, status] of [["missing-or-unclear", "pending"], ["documented-unconfirmed", "pending"], ["provided-confirmed", "not_required"]]) {
    const root = await mkdtemp(path.join(os.tmpdir(), "dev-flow-grill-template-"));
    try {
      await start(root, requirements);
      const contents = await readFile(fileFor(root), "utf8");
      assert.match(contents, new RegExp(`^  grill_status: ${status}$`, "m"));
      for (const heading of ["Scope", "Goals", "Non-goals", "Acceptance Criteria", "Decision Log", "Open Questions"]) assert.match(contents, new RegExp(`^## ${heading}$`, "m"));
    } finally { await rm(root, { recursive: true, force: true }); }
  }
});

test("requirements step and gate require a registered, complete grill", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "dev-flow-grill-gate-"));
  try {
    let state = await start(root, "missing-or-unclear");
    await assert.rejects(() => checks.recordStep(root, "f", state.revision, "requirements", {}), (error) => error.code === "GRILL_INCOMPLETE");

    await setStatus(root, "complete");
    await assert.rejects(() => checks.recordStep(root, "f", state.revision, "requirements", {}), (error) => error.code === "ARTIFACT_INTEGRITY_FAILED");
    state = await artifacts.recordArtifact(root, "f", state.revision, "requirements");
    state = await checks.recordStep(root, "f", state.revision, "requirements", {});

    await setStatus(root, "in_progress");
    state = await artifacts.recordArtifact(root, "f", state.revision, "requirements");
    await assert.rejects(() => gates.presentGate(root, "f", state.revision, "requirement_confirmation"), (error) => error.code === "GRILL_INCOMPLETE");

    await setStatus(root, "complete");
    state = await artifacts.recordArtifact(root, "f", state.revision, "requirements");
    state = await gates.presentGate(root, "f", state.revision, "requirement_confirmation");
    assert.equal(state.humanGates.requirement_confirmation.status, "pending");
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("documented requirements enforce the same pending and in-progress gate", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "dev-flow-grill-documented-"));
  try {
    let state = await start(root, "documented-unconfirmed");
    await assert.rejects(() => checks.recordStep(root, "f", state.revision, "requirements", {}), (error) => error.code === "GRILL_INCOMPLETE");
    await setStatus(root, "complete");
    state = await artifacts.recordArtifact(root, "f", state.revision, "requirements");
    state = await checks.recordStep(root, "f", state.revision, "requirements", {});
    await setStatus(root, "in_progress");
    state = await artifacts.recordArtifact(root, "f", state.revision, "requirements");
    await assert.rejects(() => gates.presentGate(root, "f", state.revision, "requirement_confirmation"), (error) => error.code === "GRILL_INCOMPLETE");
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("provided-confirmed requirements accept an explicit completed grill", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "dev-flow-grill-provided-"));
  try {
    let state = await start(root, "provided-confirmed");
    await setStatus(root, "complete");
    state = await artifacts.recordArtifact(root, "f", state.revision, "requirements");
    state = await checks.recordStep(root, "f", state.revision, "requirements", {});
    state = await gates.presentGate(root, "f", state.revision, "requirement_confirmation");
    assert.equal(state.humanGates.requirement_confirmation.status, "pending");
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("invalid grill status is rejected and registered edits revoke a confirmed requirement gate", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "dev-flow-grill-invalidation-"));
  try {
    let state = await start(root, "provided-confirmed");
    state = await checks.recordStep(root, "f", state.revision, "requirements", {});
    state = await gates.presentGate(root, "f", state.revision, "requirement_confirmation");
    await store.recordHostEvent(root, { eventId: "later", type: "user-prompt", host: "claude", text: "approved" });
    state = await gates.confirmGate(root, "f", state.revision, "requirement_confirmation", "approved", { promptEventId: "later" }, "claude");

    await setStatus(root, "in_progress");
    state = await artifacts.recordArtifact(root, "f", state.revision, "requirements");
    assert.equal(state.humanGates.requirement_confirmation, undefined);
    assert.equal(state.steps.requirement_confirmation, undefined);
    await assert.rejects(() => gates.presentGate(root, "f", state.revision, "requirement_confirmation"), (error) => error.code === "GRILL_INCOMPLETE");

    await setStatus(root, "unsupported");
    state = await artifacts.recordArtifact(root, "f", state.revision, "requirements");
    await assert.rejects(() => gates.presentGate(root, "f", state.revision, "requirement_confirmation"), (error) => error.code === "GRILL_STATUS_INVALID");
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("grill status must occur exactly once inside dev_flow front matter", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "dev-flow-grill-front-matter-"));
  try {
    let state = await start(root, "provided-confirmed");
    const file = fileFor(root);
    await writeFile(file, `${(await readFile(file, "utf8")).replace(/^  grill_status: not_required\r?\n/m, "")}\n  grill_status: complete\n`);
    state = await artifacts.recordArtifact(root, "f", state.revision, "requirements");
    await assert.rejects(() => checks.recordStep(root, "f", state.revision, "requirements", {}), (error) => error.code === "GRILL_STATUS_INVALID");

    const duplicateRoot = await mkdtemp(path.join(os.tmpdir(), "dev-flow-grill-duplicate-"));
    try {
      state = await start(duplicateRoot, "missing-or-unclear");
      const duplicate = fileFor(duplicateRoot);
      await writeFile(duplicate, (await readFile(duplicate, "utf8")).replace(/^  grill_status: pending$/m, "  grill_status: complete\n  grill_status: complete"));
      state = await artifacts.recordArtifact(duplicateRoot, "f", state.revision, "requirements");
      await assert.rejects(() => checks.recordStep(duplicateRoot, "f", state.revision, "requirements", {}), (error) => error.code === "GRILL_STATUS_INVALID");
    } finally { await rm(duplicateRoot, { recursive: true, force: true }); }
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("legacy standard features without grill_status fail closed after requirements", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "dev-flow-grill-legacy-"));
  try {
    let state = await start(root, "missing-or-unclear");
    const requirements = fileFor(root);
    const contents = (await readFile(requirements, "utf8")).replace(/^  grill_status: pending\r?\n/m, "");
    await writeFile(requirements, contents);
    state = await writeLegacyState(root, (legacy) => {
      legacy.artifacts.requirements.sha256 = createHash("sha256").update(contents).digest("hex");
      legacy.steps = { requirements: { status: "satisfied" }, requirement_confirmation: { status: "satisfied" } };
    });
    await assert.rejects(() => checks.recordStep(root, "f", state.revision, "implementation_plan", {}), (error) => error.code === "GRILL_STATUS_INVALID");

    state = await writeLegacyState(root, (legacy) => {
      legacy.steps = Object.fromEntries(["requirements", "requirement_confirmation", "implementation_plan", "coverage_review", "rollback_unit", "plan_review", "implementation_approval", "implementation", "code_review"].map((step) => [step, { status: "satisfied" }]));
    });
    await assert.rejects(() => verification.runVerification(root, "f", state.revision, "claude"), (error) => error.code === "GRILL_STATUS_INVALID");
  } finally { await rm(root, { recursive: true, force: true }); }
});
