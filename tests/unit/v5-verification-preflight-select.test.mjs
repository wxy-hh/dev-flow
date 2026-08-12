import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { loadSource } from "../helpers/load-source.mjs";

const store = await loadSource("plugins/dev-flow/src/core/state-store.ts");
const checks = await loadSource("plugins/dev-flow/src/core/feature-check.ts");
const verification = await loadSource("plugins/dev-flow/src/core/verification.ts");

const scanned = ["assumption", "free-space", "tbd", "fallback", "scope", "acceptance"];

const config = {
  schemaVersion: 2,
  verification: {
    commands: [
      { id: "preflight", command: process.execPath, args: ["-e", "process.exit(0)"], cwd: ".", provides: ["targeted"] },
      { id: "unit", command: process.execPath, args: ["-e", "process.exit(0)"], cwd: ".", provides: ["targeted"] },
    ],
    preflightCommands: ["preflight"],
  },
  enforcement: { mode: "strict", gitWriteRequiresLogicComplete: true, oneActiveFeature: true, requireExplicitHumanReply: true },
  governedRoots: ["src"],
};

function classificationFacts() {
  return {
    level: "XS",
    topology: "local",
    scopeFactRefs: [],
    topologyFactRefs: [],
    uncertaintyFactRefs: [],
    riskFactRefs: {},
    decisionRefs: [],
    signals: {
      changeSurface: "single-site",
      behaviorChange: "mechanical",
      topology: "local",
      unitCount: 1,
      requirements: "provided-confirmed",
      operationalRecovery: false,
      executableRollback: false,
    },
  };
}

async function setup(prefix) {
  const root = await mkdtemp(path.join(os.tmpdir(), prefix));
  await mkdir(path.join(root, "src"));
  await store.initProject(root, config);
  let state = await store.startFeature(root, { featureId: "f", host: "codex" });
  state = await store.lockClassification(root, "f", state.revision, classificationFacts(), { scanned, items: [] });
  state = await checks.recordStep(root, "f", state.revision, "locate", {});
  state = await checks.recordStep(root, "f", state.revision, "implementation", { files: [] });
  return { root, state };
}

test("explicit commandIds selecting a preflight command is rejected as a caller error", async () => {
  const { root, state } = await setup("dev-flow-preflight-select-");
  try {
    // preflight 的 provides 绝不计入验证保证证据；显式选择它属于调用错误。
    await assert.rejects(
      () => verification.runVerification(root, "f", state.revision, "codex", ["preflight"]),
      (error) => {
        assert.equal(error.code, "PREFLIGHT_COMMAND_NOT_SELECTABLE");
        assert.deepEqual(error.details?.commandIds, ["preflight"]);
        assert.equal(typeof error.details?.recoveryHint, "string");
        return true;
      },
    );
    // 混合选择同样拒绝，且指出全部 preflight 命令。
    await assert.rejects(
      () => verification.runVerification(root, "f", state.revision, "codex", ["unit", "preflight"]),
      (error) => {
        assert.equal(error.code, "PREFLIGHT_COMMAND_NOT_SELECTABLE");
        assert.deepEqual(error.details?.commandIds, ["preflight"]);
        return true;
      },
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("explicitly selecting a normal command still works and preflight runs automatically", async () => {
  const { root, state } = await setup("dev-flow-preflight-normal-");
  try {
    const verified = await verification.runVerification(root, "f", state.revision, "codex", ["unit"]);
    const attempt = verified.verification.attempts.at(-1);
    assert.equal(attempt.exitReason, "success");
    assert.deepEqual(attempt.commandIds, ["unit"]);
    assert.deepEqual(attempt.preflightCommandIds, ["preflight"]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
