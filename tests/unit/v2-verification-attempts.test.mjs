import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { loadSource } from "../helpers/load-source.mjs";

const store = await loadSource("plugins/dev-flow/src/core/state-store.ts");
const checks = await loadSource("plugins/dev-flow/src/core/feature-check.ts");
const verification = await loadSource("plugins/dev-flow/src/core/verification.ts");
const checkpoints = await loadSource("plugins/dev-flow/src/core/checkpoints.ts");

test("final verification selects an exact minimum command cover", () => {
  const state = { classification: { controls: { verification: ["targeted", "behavior", "integration", "full"] } } };
  const command = (id, provides) => ({ id, command: "node", args: [], cwd: ".", provides });
  const config = { verification: { commands: [
    command("a", ["targeted", "behavior"]),
    command("b", ["targeted", "integration"]),
    command("c", ["behavior", "full"]),
    command("d", ["integration", "full"]),
  ] } };
  assert.deepEqual(verification.minimalGuaranteeCommands(state, config).map((item) => item.id), ["a", "d"]);
});

test("default verification command selection adds a behavior command when behavior ACs exist", () => {
  const state = { classification: { controls: { verification: ["targeted", "integration", "full"] } } };
  const trace = {
    nodes: {
      "AC-001": { id: "AC-001", kind: "acceptance-criterion", status: "current", verificationDisposition: { kind: "behavior-test" } },
    },
  };
  const command = (id, provides) => ({ id, command: "node", args: [], cwd: ".", provides });
  const config = { verification: { commands: [
    command("full-ci", ["integration", "full"]),
    command("unit-tests", ["targeted", "behavior"]),
  ] } };
  assert.deepEqual(verification.minimalGuaranteeCommands(state, config, trace).map((item) => item.id), ["full-ci", "unit-tests"]);
});

test("explicit command selection rejects behavior ACs without a behavior command", () => {
  const trace = {
    nodes: {
      "AC-001": { id: "AC-001", kind: "acceptance-criterion", status: "current", verificationDisposition: { kind: "behavior-test" } },
    },
  };
  const command = (id, provides) => ({ id, command: "node", args: [], cwd: ".", provides });
  const config = { verification: { commands: [
    command("full-ci", ["integration", "full"]),
    command("unit-tests", ["targeted", "behavior"]),
  ] } };
  assert.throws(
    () => verification.assertBehaviorGuaranteeCovered(config, [config.verification.commands[0]], ["full-ci"], trace),
    (error) => {
      assert.equal(error.code, "VERIFICATION_BEHAVIOR_UNCOVERED");
      assert.deepEqual(error.details.acceptanceCriterionIds, ["AC-001"]);
      assert.equal(error.details.behaviorCommands.length, 1);
      return true;
    },
  );
});

test("RU forward verification rejects commands that do not provide targeted", () => {
  const config = { verification: { commands: [{ id: "integration", command: "node", args: [], cwd: ".", provides: ["integration"] }] } };
  assert.throws(() => checkpoints.resolveVerificationCommands(config, { id: "RU-001", forwardVerification: ["integration"] }), (error) => error.code === "TRACE_VERIFICATION_COMMAND_NOT_TARGETED");
});

test("new verification attempts keep a tail in state and write full output externally", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "dev-flow-verification-attempt-"));
  try {
    await mkdir(path.join(root, "src"));
    const config = {
      schemaVersion: 2,
      verification: { commands: [{ id: "pass", command: process.execPath, args: ["-e", "process.stdout.write('full-output')"], cwd: ".", provides: ["targeted", "behavior", "integration", "full"] }] },
      enforcement: { mode: "strict", gitWriteRequiresLogicComplete: true, oneActiveFeature: true, requireExplicitHumanReply: true },
      governedRoots: ["src"],
    };
    await store.initProject(root, config);
    let state = await store.startFeature(root, { featureId: "f", host: "codex", level: "XS", topology: "local" });
    state = await checks.recordStep(root, "f", state.revision, "locate", {});
    state = await checks.recordStep(root, "f", state.revision, "implementation", { files: [] });
    state = await verification.runVerification(root, "f", state.revision, "codex", ["pass"]);
    const attempt = state.verification.attempts[0];
    assert.equal("output" in attempt, false);
    assert.equal(attempt.outputTail.includes("full-output"), true);
    assert.equal(attempt.outputPath, "verification/1.log");
    assert.equal(await readFile(path.join(root, ".dev-flow", "features", "f", attempt.outputPath), "utf8"), "[pass] full-output");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("verification records a failed preflight attempt without running forward commands", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "dev-flow-verification-preflight-"));
  try {
    await mkdir(path.join(root, "src"));
    const config = {
      schemaVersion: 2,
      verification: {
        commands: [
          { id: "preflight", command: process.execPath, args: ["-e", "process.exit(3)"], cwd: ".", provides: ["targeted", "behavior", "integration", "full"] },
          { id: "forward", command: process.execPath, args: ["-e", "process.stdout.write('forward')"], cwd: ".", provides: ["targeted", "behavior", "integration", "full"] },
        ],
        preflightCommands: ["preflight"],
      },
      enforcement: { mode: "strict", gitWriteRequiresLogicComplete: true, oneActiveFeature: true, requireExplicitHumanReply: true },
      governedRoots: ["src"],
    };
    await store.initProject(root, config);
    let state = await store.startFeature(root, { featureId: "f", host: "codex", level: "XS", topology: "local" });
    state = await checks.recordStep(root, "f", state.revision, "locate", {});
    state = await checks.recordStep(root, "f", state.revision, "implementation", { files: [] });
    state = await verification.runVerification(root, "f", state.revision, "codex", ["forward"]);
    assert.equal(state.verification.attempts.at(-1).phase, "preflight");
    assert.equal(state.verification.attempts.at(-1).exitCode, 3);
    assert.equal(state.steps.verification.status, "pending");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("successful verification separates preflight audit from guarantee evidence", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "dev-flow-verification-evidence-"));
  try {
    await mkdir(path.join(root, "src"));
    const pass = ["-e", "process.exit(0)"];
    const config = {
      schemaVersion: 2,
      verification: {
        commands: [
          { id: "preflight", command: process.execPath, args: pass, cwd: ".", provides: ["targeted"] },
          { id: "forward", command: process.execPath, args: pass, cwd: ".", provides: ["targeted", "integration"] },
        ],
        preflightCommands: ["preflight"],
      },
      enforcement: { mode: "strict", gitWriteRequiresLogicComplete: true, oneActiveFeature: true, requireExplicitHumanReply: true },
      governedRoots: ["src"],
    };
    await store.initProject(root, config);
    let state = await store.startFeature(root, { featureId: "f", host: "codex", level: "XS", topology: "local" });
    state = await checks.recordStep(root, "f", state.revision, "locate", {});
    state = await checks.recordStep(root, "f", state.revision, "implementation", {});
    state = await store.mutate(root, "f", state.revision, "test-guarantee", (draft) => {
      draft.classification.controls.verification = ["targeted", "integration"];
    });
    state = await verification.runVerification(root, "f", state.revision, "codex", ["forward"]);
    const attempt = state.verification.attempts.at(-1);
    assert.deepEqual(attempt.commandIds, ["forward"]);
    assert.deepEqual(attempt.preflightCommandIds, ["preflight"]);
    assert.deepEqual(attempt.kinds, ["targeted", "integration"]);
    assert.deepEqual(state.steps.verification.evidence.commandIds, ["forward"]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("verification freshness follows the commands executed by the attempt", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "dev-flow-verification-command-slice-"));
  try {
    await mkdir(path.join(root, "src"));
    const config = {
      schemaVersion: 2,
      verification: { commands: [
        { id: "forward", command: process.execPath, args: ["-e", "process.exit(0)"], cwd: ".", provides: ["targeted"] },
      ] },
      enforcement: { mode: "strict", gitWriteRequiresLogicComplete: true, oneActiveFeature: true, requireExplicitHumanReply: true },
      governedRoots: ["src"],
    };
    await store.initProject(root, config);
    let state = await store.startFeature(root, { featureId: "f", host: "codex", level: "XS", topology: "local" });
    state = await checks.recordStep(root, "f", state.revision, "locate", {});
    state = await checks.recordStep(root, "f", state.revision, "implementation", {});
    state = await verification.runVerification(root, "f", state.revision, "codex", ["forward"]);
    assert.equal((await verification.readVerificationFreshness(root, state)).status, "fresh");

    const addRaw = await readFile(path.join(root, ".dev-flow", "project.json"));
    const additive = structuredClone(config);
    additive.verification.commands.push({ id: "unrelated", command: process.execPath, args: ["-e", "process.exit(0)"], cwd: ".", provides: ["targeted"] });
    await store.updateProjectConfig(root, additive, createHash("sha256").update(addRaw).digest("hex"));
    state = await store.readState(root, "f");
    assert.equal((await verification.readVerificationFreshness(root, state)).status, "fresh");

    const capabilityRaw = await readFile(path.join(root, ".dev-flow", "project.json"));
    const capabilityOnly = structuredClone(additive);
    capabilityOnly.verification.commands[0].provides = ["targeted", "behavior"];
    await store.updateProjectConfig(root, capabilityOnly, createHash("sha256").update(capabilityRaw).digest("hex"));
    state = await store.readState(root, "f");
    assert.equal((await verification.readVerificationFreshness(root, state)).status, "fresh");

    const changedRaw = await readFile(path.join(root, ".dev-flow", "project.json"));
    const changed = structuredClone(additive);
    changed.verification.commands[0].args = ["-e", "process.stdout.write('changed')"];
    await store.updateProjectConfig(root, changed, createHash("sha256").update(changedRaw).digest("hex"));
    state = await store.readState(root, "f");
    assert.equal((await verification.readVerificationFreshness(root, state)).status, "stale");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
