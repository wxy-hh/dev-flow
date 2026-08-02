import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { loadSource } from "../helpers/load-source.mjs";

const store = await loadSource("plugins/dev-flow/src/core/state-store.ts");
const verification = await loadSource("plugins/dev-flow/src/core/verification.ts");
const checks = await loadSource("plugins/dev-flow/src/core/feature-check.ts");
const gates = await loadSource("plugins/dev-flow/src/core/human-gates.ts");
const artifacts = await loadSource("plugins/dev-flow/src/core/artifacts.ts");
const policy = await loadSource("plugins/dev-flow/src/policy/validation.ts");
const config = {
  schemaVersion: 1,
  verification: {
    commands: [
      { id: "pass", command: "node", args: ["-e", "process.exit(0)"], cwd: "." },
      { id: "fail", command: "node", args: ["-e", "process.exit(2)"], cwd: "." },
    ],
    behaviorCommands: [],
  },
  enforcement: { mode: "strict", gitWriteRequiresLogicComplete: true, oneActiveFeature: true, requireExplicitHumanReply: true },
  protectedRoots: ["src"],
};

test("Windows verification invokes cmd.exe for package-manager command wrappers", () => {
  assert.deepEqual(
    verification.verificationInvocation(
      { command: "npm", args: ["test", "--", "a test with spaces"] },
      "win32",
      "C:\\Windows\\System32\\cmd.exe",
    ),
    {
      executable: "C:\\Windows\\System32\\cmd.exe",
      args: ["/d", "/s", "/c", "npm test -- \"a test with spaces\""],
    },
  );
  assert.deepEqual(
    verification.verificationInvocation({ command: "node", args: ["--test"] }, "darwin"),
    { executable: "node", args: ["--test"] },
  );
});

async function startXs(root, classification = {}, projectConfig = config) {
  await mkdir(path.join(root, "src"));
  await writeFile(path.join(root, "src", "app.js"), "export const x = 1;\n");
  await store.initProject(root, projectConfig);
  let state = await store.startFeature(root, { featureId: "f", host: "codex", level: "XS", topology: "local", ...classification });
  state = await checks.recordStep(root, "f", state.revision, "locate", {});
  return checks.recordStep(root, "f", state.revision, "implementation", { files: [] });
}

async function startMoneyRisk(root, projectConfig) {
  await mkdir(path.join(root, "src"));
  await writeFile(path.join(root, "src", "app.js"), "export const x = 1;\n");
  await store.initProject(root, projectConfig);
  let state = await store.startFeature(root, {
    featureId: "f", host: "codex", level: "M", topology: "local", execution: "light", riskLabels: ["money"],
  });
  state = await artifacts.scaffoldArtifact(root, "f", state.revision, "risk-card");
  state = await checks.recordStep(root, "f", state.revision, "risk_review", {});
  state = await artifacts.scaffoldArtifact(root, "f", state.revision, "status");
  state = await checks.recordStep(root, "f", state.revision, "risk_controls", { checks: ["rollback"] });
  state = await gates.presentGate(root, "f", state.revision, "implementation_approval");
  await store.recordHostEvent(root, { eventId: "approve", type: "user-prompt", host: "codex", text: "批准实现" });
  state = await gates.confirmGate(root, "f", state.revision, "implementation_approval", "批准实现", {}, "codex");
  state = await checks.recordStep(root, "f", state.revision, "implementation", { files: [] });
  return checks.recordStep(root, "f", state.revision, "code_review", { reviewType: "code" });
}

test("implementation files must exist on disk and files accepts only plain paths", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "dev-flow-existence-"));
  try {
    // 只完成 locate，implementation 保持 pending，失败后可重新登记
    await mkdir(path.join(root, "src"));
    await writeFile(path.join(root, "src", "app.js"), "export const x = 1;\n");
    await store.initProject(root, config);
    let state = await store.startFeature(root, { featureId: "f", host: "codex", level: "XS", topology: "local" });
    state = await checks.recordStep(root, "f", state.revision, "locate", {});
    assert.equal(state.steps.implementation, undefined);
    await assert.rejects(
      () => checks.recordStep(root, "f", state.revision, "implementation", { files: ["src/app.js (新增)"] }),
      (error) => error.code === "INVALID_IMPLEMENTATION_FILE"
        && /纯路径/.test(error.details.recoveryHint),
    );
    const stateAfterDecorated = await store.readState(root, "f");
    assert.equal(stateAfterDecorated.revision, state.revision);
    assert.equal(stateAfterDecorated.steps.implementation, undefined);
    await assert.rejects(
      () => checks.recordStep(root, "f", state.revision, "implementation", { files: ["src/missing.js"] }),
      (error) => error.code === "INVALID_IMPLEMENTATION_FILE",
    );
    state = await checks.recordStep(root, "f", state.revision, "implementation", { files: ["src/app.js"] });
    assert.equal(state.steps.implementation.status, "satisfied");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("verification retains failed attempts and never inherits manual acceptance", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "dev-flow-verify-"));
  try {
    let state = await startXs(root);
    assert.equal((await verification.readVerificationFreshness(root, state)).status, "missing");
    state = await verification.runVerification(root, "f", state.revision, "codex", ["fail"], {
      mode: "browser",
      source: "local browser",
      scenarios: [{ name: "submit", evidence: "form rendered" }],
    });
    assert.equal(state.verification.attempts.length, 1);
    assert.equal(state.steps.verification.status, "pending");
    assert.equal(state.verification.attempts[0].manualAcceptance.mode, "browser");
    assert.equal(state.steps.verification.evidence.manualAcceptance, undefined);

    state = await verification.runVerification(root, "f", state.revision, "codex", ["pass"]);
    assert.equal(state.verification.attempts.length, 2);
    assert.equal(state.steps.verification.status, "satisfied");
    assert.equal(state.verification.attempts[1].manualAcceptance, undefined);
    assert.equal(state.steps.verification.evidence.manualAcceptance, undefined);
    assert.equal((await verification.readVerificationFreshness(root, state)).status, "fresh");

    await writeFile(path.join(root, "src", "app.js"), "export const x = 2;\n");
    state = await verification.invalidateStaleVerification(root, "f", state.revision);
    assert.equal(state.steps.verification.status, "pending");
    assert.equal(state.verification.attempts.length, 2);
    state = await verification.runVerification(root, "f", state.revision, "codex", ["pass"]);
    assert.equal(state.verification.attempts[2].manualAcceptance, undefined);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("successful user signoff is stored in the attempt and satisfied verification evidence", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "dev-flow-signoff-"));
  try {
    let state = await startXs(root);
    await store.recordHostEvent(root, {
      eventId: "user-signoff",
      type: "user-prompt",
      host: "codex",
      text: "验收通过",
    });
    state = await verification.runVerification(root, "f", state.revision, "codex", ["pass"], {
      mode: "user-signoff",
      source: "user reply 42",
      promptEventId: "user-signoff",
      userReply: "验收通过",
      scenarios: [{ name: "mobile navigation", evidence: "user confirmed navigation works" }],
    });
    assert.equal(state.verification.attempts[0].manualAcceptance.mode, "user-signoff");
    assert.equal(state.steps.verification.evidence.manualAcceptance.source, "user reply 42");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("invalid manual acceptance fails before commands and does not mutate revision", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "dev-flow-signoff-invalid-"));
  try {
    const state = await startXs(root);
    await assert.rejects(
      () => verification.runVerification(root, "f", state.revision, "codex", ["pass"], {
        mode: "browser", source: "browser", scenarios: [],
      }),
      (error) => error.code === "INVALID_MANUAL_ACCEPTANCE",
    );
    const after = await store.readState(root, "f");
    assert.equal(after.revision, state.revision);
    assert.equal(after.verification.attempts.length, 0);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("legacy manual acceptance input is advisory and does not block machine verification", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "dev-flow-required-acceptance-"));
  try {
    let state = await startXs(root, { manualAcceptanceRequired: true });
    assert.equal(state.classification.acceptanceAssistSuggested, true);
    assert.equal("manualAcceptanceRequired" in state.classification, false);
    state = await verification.runVerification(root, "f", state.revision, "codex", ["pass"]);
    assert.equal(state.steps.verification.status, "satisfied");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("classification accepts the legacy flag but persists only acceptance assist advice", () => {
  const classification = policy.normalizeClassification({
    level: "L", topology: "multi-chain", execution: "light", manualAcceptanceRequired: true,
  });
  assert.equal(classification.acceptanceAssistSuggested, true);
  assert.equal("manualAcceptanceRequired" in classification, false);
});

test("a user signoff event cannot be reused by a later verification attempt", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "dev-flow-signoff-reuse-"));
  try {
    let state = await startXs(root, { manualAcceptanceRequired: true });
    await store.recordHostEvent(root, { eventId: "signoff", type: "user-prompt", host: "codex", text: "LGTM" });
    const signoff = {
      mode: "user-signoff", source: "captured user reply", promptEventId: "signoff", userReply: "LGTM",
      scenarios: [{ name: "main flow", evidence: "user accepted the result" }],
    };
    state = await verification.runVerification(root, "f", state.revision, "codex", ["pass"], signoff);
    await writeFile(path.join(root, "src", "app.js"), "export const x = 2;\n");
    state = await verification.invalidateStaleVerification(root, "f", state.revision);
    await assert.rejects(
      () => verification.runVerification(root, "f", state.revision, "codex", ["pass"], signoff),
      (error) => error.code === "MANUAL_ACCEPTANCE_EVENT_CONSUMED",
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("money risk cannot skip configured behavior commands or run without them", async () => {
  const noBehaviorRoot = await mkdtemp(path.join(os.tmpdir(), "dev-flow-money-none-"));
  const selectiveRoot = await mkdtemp(path.join(os.tmpdir(), "dev-flow-money-selective-"));
  try {
    let state = await startMoneyRisk(noBehaviorRoot, config);
    assert.equal(state.classification.acceptanceAssistSuggested, false);
    await assert.rejects(
      () => verification.runVerification(noBehaviorRoot, "f", state.revision, "codex", ["pass"]),
      (error) => error.code === "MONEY_BEHAVIOR_COMMAND_REQUIRED",
    );

    const withBehavior = {
      ...config,
      verification: {
        commands: [...config.verification.commands, { id: "other", command: "node", args: ["-e", "process.exit(0)"], cwd: "." }],
        behaviorCommands: ["pass"],
      },
    };
    state = await startMoneyRisk(selectiveRoot, withBehavior);
    await assert.rejects(
      () => verification.runVerification(selectiveRoot, "f", state.revision, "codex", ["other"]),
      (error) => error.code === "MONEY_BEHAVIOR_COMMAND_REQUIRED",
    );
  } finally {
    await rm(noBehaviorRoot, { recursive: true, force: true });
    await rm(selectiveRoot, { recursive: true, force: true });
  }
});
