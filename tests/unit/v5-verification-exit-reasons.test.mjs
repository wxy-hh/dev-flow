import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { loadSource } from "../helpers/load-source.mjs";

const store = await loadSource("plugins/dev-flow/src/core/state-store.ts");
const projectConfig = await loadSource("plugins/dev-flow/src/core/project-config.ts");
const checks = await loadSource("plugins/dev-flow/src/core/feature-check.ts");
const verification = await loadSource("plugins/dev-flow/src/core/verification.ts");

function command(overrides) {
  return { id: "cmd", command: process.execPath, args: [], cwd: ".", provides: ["targeted"], ...overrides };
}

test("unconfigured commands keep stable defaults; per-command overrides are honored", async () => {
  assert.equal(verification.DEFAULT_COMMAND_TIMEOUT_MS, 120_000);
  assert.equal(verification.DEFAULT_COMMAND_MAX_OUTPUT_BYTES, 1024 * 1024);
  const root = await mkdtemp(path.join(os.tmpdir(), "dev-flow-exit-reason-"));
  try {
    const success = await verification.runVerificationCommand(root, command({ args: ["-e", "process.exit(0)"] }));
    assert.equal(success.exitReason, "success");
    assert.equal(success.exitCode, 0);

    const slow = await verification.runVerificationCommand(root, command({
      args: ["-e", "setTimeout(() => {}, 30_000)"],
      timeoutMs: 1_000,
    }));
    assert.equal(slow.exitReason, "timeout");
    assert.equal(slow.exitCode, 1);
    assert.match(slow.output, /timed out after 1000ms/);

    const chatty = await verification.runVerificationCommand(root, command({
      args: ["-e", "process.stdout.write('x'.repeat(4096))"],
      maxOutputBytes: 1024,
    }));
    assert.equal(chatty.exitReason, "output-limit");
    assert.match(chatty.output, /exceeded 1024 bytes/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("spawn failure and non-zero exit are distinct exit reasons", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "dev-flow-exit-reason-2-"));
  try {
    const missing = await verification.runVerificationCommand(root, command({ command: "definitely-not-a-real-binary-xyz" }));
    assert.equal(missing.exitReason, "spawn-failure");

    const failing = await verification.runVerificationCommand(root, command({ args: ["-e", "process.exit(3)"] }));
    assert.equal(failing.exitReason, "non-zero-exit");
    assert.equal(failing.exitCode, 3);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("invalid per-command timeout or output limit is diagnosed before execution", async () => {
  const base = {
    schemaVersion: 2,
    verification: { commands: [] },
    enforcement: { mode: "strict", gitWriteRequiresLogicComplete: true, oneActiveFeature: true, requireExplicitHumanReply: true },
    governedRoots: ["src"],
  };
  const withCommand = (extra) => ({ ...base, verification: { commands: [{ id: "c", command: "node", args: [], cwd: ".", provides: ["targeted"], ...extra }] } });
  for (const bad of [
    { timeoutMs: 500 },
    { timeoutMs: 1.5 },
    { timeoutMs: "1000" },
    { maxOutputBytes: 100 },
    { maxOutputBytes: -1 },
  ]) {
    assert.throws(
      () => projectConfig.validateProjectConfig(withCommand(bad)),
      (error) => error.code === "INVALID_PROJECT_CONFIG",
      JSON.stringify(bad),
    );
  }
  assert.doesNotThrow(() => projectConfig.validateProjectConfig(withCommand({ timeoutMs: 5_000, maxOutputBytes: 2_048 })));
});

test("runVerification records the concrete exit reason on the attempt and keeps preflight out of guarantee evidence", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "dev-flow-exit-reason-attempt-"));
  try {
    await mkdir(path.join(root, "src"));
    const config = {
      schemaVersion: 2,
      verification: {
        commands: [
          { id: "preflight", command: process.execPath, args: ["-e", "process.exit(0)"], cwd: ".", provides: ["targeted"] },
          { id: "slow", command: process.execPath, args: ["-e", "setTimeout(() => {}, 30_000)"], cwd: ".", provides: ["targeted", "behavior"], timeoutMs: 1_000 },
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
    state = await verification.runVerification(root, "f", state.revision, "codex", ["slow"]);
    const attempt = state.verification.attempts.at(-1);
    assert.equal(attempt.exitReason, "timeout");
    assert.equal(attempt.phase, "forward");
    assert.deepEqual(attempt.commandIds, ["slow"]);
    assert.deepEqual(attempt.preflightCommandIds, ["preflight"]);
    assert.equal(state.steps.verification.status, "pending");
    assert.equal(state.steps.verification.evidence.exitReason, "timeout");
    // 修复签名携带结束原因：环境问题不会与代码缺陷互相归并。
    assert.match(attempt.outputTail, /timed out after 1000ms/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("preflight failure stops forward commands and never counts as verification evidence", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "dev-flow-exit-reason-preflight-"));
  try {
    await mkdir(path.join(root, "src"));
    const config = {
      schemaVersion: 2,
      verification: {
        commands: [
          { id: "preflight-fail", command: process.execPath, args: ["-e", "process.exit(2)"], cwd: ".", provides: ["targeted"] },
          { id: "forward", command: process.execPath, args: ["-e", "require('node:fs').writeFileSync('forward-ran', 'x')"], cwd: ".", provides: ["targeted", "behavior"] },
        ],
        preflightCommands: ["preflight-fail"],
      },
      enforcement: { mode: "strict", gitWriteRequiresLogicComplete: true, oneActiveFeature: true, requireExplicitHumanReply: true },
      governedRoots: ["src"],
    };
    await store.initProject(root, config);
    let state = await store.startFeature(root, { featureId: "f", host: "codex", level: "XS", topology: "local" });
    state = await checks.recordStep(root, "f", state.revision, "locate", {});
    state = await checks.recordStep(root, "f", state.revision, "implementation", { files: [] });
    state = await verification.runVerification(root, "f", state.revision, "codex", ["forward"]);
    const attempt = state.verification.attempts.at(-1);
    // preflight 失败：attempt 处于 preflight 阶段，forward 命令未执行
    assert.equal(attempt.phase, "preflight");
    assert.equal(attempt.exitReason, "non-zero-exit");
    assert.equal(attempt.exitCode, 2);
    assert.deepEqual(attempt.commandIds, ["forward"]);
    assert.deepEqual(attempt.preflightCommandIds, ["preflight-fail"]);
    assert.equal(state.steps.verification.status, "pending");
    // forward 命令确实没有运行（不产生副作用文件）
    await assert.rejects(() => import("node:fs/promises").then((fs) => fs.access(path.join(root, "forward-ran"))), (error) => error.code === "ENOENT");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
