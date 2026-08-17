import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import test from "node:test";
import { loadSource } from "../helpers/load-source.mjs";

// 候选 3：dispatch 是可导入深模块（接口即测试面）。本文件在进程内用
// fake 端口驱动它：不 spawn stdio 进程、不经过入口 adapter。线协议与
// 握手仍由 tests/e2e 的真进程测试覆盖。

const { dispatch, publicTools, toolSchemas } = await loadSource("plugins/dev-flow/src/mcp/dispatch.ts");
const run = promisify(execFile);

const config = {
  schemaVersion: 2,
  verification: { commands: [{ id: "unit", command: process.execPath, args: ["-e", "process.exit(0)"], cwd: ".", provides: ["targeted", "behavior", "integration", "full"] }] },
  enforcement: { mode: "strict", gitWriteRequiresLogicComplete: true, oneActiveFeature: true, requireExplicitHumanReply: true },
  governedRoots: ["src"],
};

function fakePorts() {
  const calls = { elicit: [], notify: [] };
  return {
    calls,
    ports: {
      // 模拟无 form 能力的客户端：elicit 一律回落（交互落 pending）。
      elicit: async (interaction, question) => {
        calls.elicit.push({ interaction, question });
        return undefined;
      },
      sampleReview: async () => {
        throw new Error("sampling not available in tests");
      },
      assertSamplingSupported: () => {},
      notify: (event) => {
        calls.notify.push(event);
      },
    },
  };
}

async function setup() {
  const root = await mkdtemp(path.join(os.tmpdir(), "dev-flow-dispatch-"));
  await mkdir(path.join(root, "src"));
  await run("git", ["init", "--quiet"], { cwd: root });
  await run("git", ["-c", "user.name=Dev Flow Tests", "-c", "user.email=tests@example.invalid", "commit", "--quiet", "--allow-empty", "-m", "fixture baseline"], { cwd: root });
  // startFeature 要求宿主 hook 健康信号（与 load-source 的 ensureFixtureHookHealth 同法）。
  await mkdir(path.join(root, ".dev-flow"), { recursive: true });
  const now = Date.now();
  const at = new Date(now).toISOString();
  const signals = ["codex", "claude"].map((host) => JSON.stringify({ host, kind: "session-start", eventId: `fixture-${host}-${now}`, at })).join("\n");
  await writeFile(path.join(root, ".dev-flow", "host-health.jsonl"), `${signals}\n`);
  return root;
}

test("dispatch 可导入：公开工具面由声明派生且数量完整", () => {
  assert.ok(publicTools.length >= 40, `expected the full public tool surface, got ${publicTools.length}`);
  // v6 已无 expose:false 内部工具声明；tools/list 与声明一一对应。
  assert.equal(Object.keys(toolSchemas).length, publicTools.length);
  assert.ok(!publicTools.includes("dev_flow_record_review_execution_event"));
});

test("主链路进程内走通：init_project → start → status", async () => {
  const root = await setup();
  const { ports } = fakePorts();
  try {
    const initialized = await dispatch(root, "dev_flow_init_project", { config }, ports);
    assert.equal(initialized.状态, "已初始化");

    const started = await dispatch(root, "dev_flow_start", { featureId: "f", objective: "进程内冒烟", host: "codex" }, ports);
    assert.equal(started.featureId, "f");

    const status = await dispatch(root, "dev_flow_status", { featureId: "f" }, ports);
    assert.ok(status, "status must return a compact view");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("fake elicit 端口被 lock_classification 的路线确认驱动，交互落 pending", async () => {
  const root = await setup();
  const { calls, ports } = fakePorts();
  try {
    await dispatch(root, "dev_flow_init_project", { config }, ports);
    const started = await dispatch(root, "dev_flow_start", { featureId: "f", objective: "端口注入证明", host: "codex" }, ports);

    // 登记一条仓库事实作为分类依据（与 load-source 的 legacy fixture 同法：
    // 先落盘并提交，避免脏工作区漂移）。
    await writeFile(path.join(root, "src", "seed.txt"), "fixture repository fact\n");
    await run("git", ["add", "--", "src/seed.txt"], { cwd: root });
    await run("git", ["-c", "user.name=Dev Flow Tests", "-c", "user.email=tests@example.invalid", "commit", "--quiet", "-m", "fixture fact", "--", "src/seed.txt"], { cwd: root });
    const fact = await dispatch(root, "dev_flow_record_repository_fact", {
      featureId: "f", expectedRevision: started.revision,
      observation: { kind: "file-exists", path: "src/seed.txt" },
      host: "codex",
    }, ports);
    const factRef = fact.recordId;
    assert.ok(factRef, "fact registration must return a recordId");

    const locked = await dispatch(root, "dev_flow_lock_classification", {
      featureId: "f", expectedRevision: fact.state.revision,
      classification: {
        level: "M", topology: "local", requirements: "provided-confirmed",
        classificationBasis: {
          scopeFactRefs: [factRef], topologyFactRefs: [factRef], uncertaintyFactRefs: [], riskFactRefs: {}, decisionRefs: [],
          signals: {
            changeSurface: "multi-component", behaviorChange: "new-capability", topology: "local",
            unitCount: 1, requirements: "provided-confirmed", operationalRecovery: false, executableRollback: false,
          },
        },
      },
      boundaryAudit: { scanned: ["assumption", "free-space", "tbd", "fallback", "scope", "acceptance"], items: [] },
    }, ports);

    assert.equal(calls.elicit.length, 1, "route-confirmation must go through the injected elicit port");
    assert.equal(calls.elicit[0].interaction.kind, "route-confirmation");
    assert.equal(locked.interaction.kind, "route-confirmation");
    assert.equal(locked.interaction.status, "pending");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("未知工具与 schema 校验在 dispatch 内自含防护", async () => {
  const root = await setup();
  const { ports } = fakePorts();
  try {
    await assert.rejects(
      () => dispatch(root, "dev_flow_no_such_tool", {}, ports),
      (error) => error.code === "UNKNOWN_TOOL",
    );
    await assert.rejects(
      () => dispatch(root, "dev_flow_status", {}, ports),
      (error) => error.code === "INVALID_TOOL_INPUT",
    );
    // expose:false 的宿主接缝工具经 agent 面调用时按未知工具拒绝（须先通过 schema 校验）。
    await assert.rejects(
      () => dispatch(root, "dev_flow_record_review_execution_event", {
        event: {
          eventId: "e1", type: "review-execution", host: "codex",
          batchId: "b", jobId: "j", executionId: "x", sourceId: "s",
          contextId: "c", implementationContextId: "ic",
        },
      }, ports),
      (error) => error.code === "UNKNOWN_TOOL",
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
