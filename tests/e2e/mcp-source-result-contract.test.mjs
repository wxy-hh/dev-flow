import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { build } from "esbuild";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { after, test } from "node:test";
import { fileURLToPath } from "node:url";
import { createTinyApp, strictProjectConfig } from "../helpers/fixture-repo.mjs";
import { invokeHook, mcpCall, run } from "../helpers/host-runner.mjs";
import { loadSource } from "../helpers/load-source.mjs";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const serverEntry = path.join(repositoryRoot, "plugins", "dev-flow", "src", "mcp", "server.ts");
const codexHookEntry = path.join(repositoryRoot, "plugins", "dev-flow", "src", "hosts", "codex-adapter.ts");
const store = await loadSource("plugins/dev-flow/src/core/state-store.ts");
const decisions = await loadSource("plugins/dev-flow/src/core/decision-interactions.ts");

// Bundle the MCP server from source so these contract tests exercise the
// current src without depending on the committed dist bundle.
async function bundleSourceServer(directory) {
  const outfile = path.join(directory, "mcp-server-source.mjs");
  await build({
    entryPoints: [serverEntry],
    outfile,
    bundle: true,
    platform: "node",
    target: "node20",
    format: "esm",
    define: { __DEV_FLOW_VERSION__: JSON.stringify("test") },
  });
  return outfile;
}

async function bundleSourceHook(directory) {
  const outfile = path.join(directory, "codex-hook-source.mjs");
  await build({
    entryPoints: [codexHookEntry],
    outfile,
    bundle: true,
    platform: "node",
    target: "node20",
    format: "esm",
    define: { __DEV_FLOW_VERSION__: JSON.stringify("test") },
  });
  return outfile;
}

const staging = await mkdtemp(path.join(os.tmpdir(), "dev-flow-source-server-"));
const server = await bundleSourceServer(staging);
const codexHook = await bundleSourceHook(staging);
after(() => rm(staging, { recursive: true, force: true }));

async function rawListTools(cwd) {
  const response = await run(process.execPath, [server], {
    cwd,
    input: `${JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} })}\n`,
  });
  const message = response.stdout.split("\n").filter(Boolean).map((line) => JSON.parse(line)).find((candidate) => candidate.id === 1);
  if (!message) throw new Error(`MCP did not return a response for tools/list: ${response.stdout}`);
  return message.result.tools;
}

test("dev_flow_init_project returns a well-formed result (P2)", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "dev-flow-p2-init-"));
  try {
    const result = await mcpCall(server, root, "dev_flow_init_project", { config: strictProjectConfig }, { raw: true });
    assert.equal(result.isError, undefined);
    assert.ok(Array.isArray(result.content) && result.content.length > 0);
    assert.equal(typeof result.content[0].text, "string");
    assert.ok(result.content[0].text.length > 0, "content[0].text must be a non-empty string");
    assert.ok(result.structuredContent, "structuredContent must be present");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("a real early-5.0 interaction continues through the public answer tool", async () => {
  const fixture = await createTinyApp();
  try {
    await mcpCall(server, fixture.root, "dev_flow_init_project", { config: strictProjectConfig });
    const featureId = "legacy-ownership";
    const featureDir = path.join(fixture.root, ".dev-flow", "features", featureId);
    await mkdir(featureDir, { recursive: true });
    const legacy = JSON.parse(await readFile(path.join(repositoryRoot, "tests", "fixtures", "v5-legacy", "state.json"), "utf8"));
    await writeFile(path.join(featureDir, "state.json"), `${JSON.stringify(legacy, null, 2)}\n`);
    await writeFile(path.join(fixture.root, ".dev-flow", "active.json"), `${JSON.stringify({ featureId, revision: 0 })}\n`);
    await writeFile(path.join(featureDir, "events.jsonl"), [
      JSON.stringify({ revision: 0, type: "feature-started", at: "2026-08-01T00:00:00.000Z", data: {} }),
      JSON.stringify({ revision: 0, type: "host-event", at: "2026-08-01T00:00:01.000Z", data: {
        eventId: "legacy-public-answer", type: "user-prompt", host: "codex", text: "这个算当前任务", at: "2026-08-01T00:00:01.000Z",
      } }),
    ].join("\n") + "\n");
    // 真实会话必然带有宿主健康信号；fixture 直接落盘状态，需要显式补齐。
    await store.recordHostHealth(fixture.root, { host: "codex", kind: "session-start", eventId: "legacy-session-start" });

    const answered = await mcpCall(server, fixture.root, "dev_flow_answer", {
      featureId, expectedRevision: 0, userReply: "这个算当前任务", host: "codex",
    });
    assert.equal(answered.control.expectedRevision, 1);
    const continued = await store.readState(fixture.root, featureId);
    assert.equal(continued.interactions["interaction-legacy-ownership"].status, "resolved");
    assert.equal(continued.workspace.ownership["src/counter.js"], "feature");
    assert.deepEqual(continued.workspace.unownedPaths, []);
  } finally {
    await fixture.dispose();
  }
});

test("dev_flow_update_project returns CAS recovery and affected-evidence contracts", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "dev-flow-config-contract-"));
  try {
    await mcpCall(server, root, "dev_flow_init_project", { config: strictProjectConfig });
    const raw = await readFile(path.join(root, ".dev-flow", "project.json"));
    const currentSha256 = createHash("sha256").update(raw).digest("hex");
    await assert.rejects(
      () => mcpCall(server, root, "dev_flow_update_project", {
        config: strictProjectConfig,
        expectedSha256: "0".repeat(64),
      }),
      (error) => error.code === "PROJECT_CONFIG_REVISION_CONFLICT" && error.details.currentSha256 === currentSha256,
    );
    const config = structuredClone(strictProjectConfig);
    config.verification.commands.push({
      id: "lint",
      command: process.execPath,
      args: ["--check"],
      cwd: ".",
      provides: ["targeted"],
    });
    const updated = await mcpCall(server, root, "dev_flow_update_project", { config, expectedSha256: currentSha256 });
    assert.equal(updated.previousSha256, currentSha256);
    assert.match(updated.sha256, /^[a-f0-9]{64}$/);
    assert.deepEqual(updated.受影响证据, {
      commandIds: [],
      traceNodeIds: [],
      checkpointIds: [],
      verificationAttemptIds: [],
      reviewRoles: [],
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("dev_flow_record_decision exposes a decisionId usable end-to-end (P5)", async () => {
  const fixture = await createTinyApp();
  try {
    await mcpCall(server, fixture.root, "dev_flow_init_project", { config: strictProjectConfig });
    let state = await mcpCall(server, fixture.root, "dev_flow_start", {
      featureId: "decisions", objective: "澄清一个决策", host: "codex",
      scope: { inScope: ["src/counter.js"], outOfScope: [] },
    });
    await store.recordHostEvent(fixture.root, { eventId: "known-conclusion", type: "user-prompt", host: "codex", text: "保留" });
    const recorded = await mcpCall(server, fixture.root, "dev_flow_record_decision", {
      featureId: "decisions", expectedRevision: state.control.expectedRevision,
      question: "是否保留兼容行为？", evidence: "用户已有明确结论", conclusion: "保留", factRefs: ["fact-1"], host: "codex",
    });
    assert.match(recorded.decisionId, /^DEC-[0-9a-f]{16}$/);
    const pending = await mcpCall(server, fixture.root, "dev_flow_lock_classification", {
      featureId: "decisions", expectedRevision: recorded.control.expectedRevision,
      classification: {
        level: "M", topology: "local", requirements: "provided-confirmed",
        classificationBasis: {
          scopeFacts: ["只改一个模块"], topologyFacts: ["没有共享契约"], uncertaintyFacts: [],
          riskFacts: {}, decisionRefs: [recorded.decisionId],
          signals: { changeSurface: "multi-component", behaviorChange: "new-capability", topology: "local", unitCount: 1, requirements: "provided-confirmed", operationalRecovery: false, executableRollback: false },
        },
      },
      boundaryAudit: { scanned: ["assumption", "free-space", "tbd", "fallback", "scope", "acceptance"], items: [] },
    });
    await store.recordHostEvent(fixture.root, { eventId: "route-confirm", type: "user-prompt", host: "codex", text: "确认路线" });
    const locked = await mcpCall(server, fixture.root, "dev_flow_answer", { featureId: "decisions", expectedRevision: pending.control.expectedRevision, userReply: "确认路线", host: "codex" });
    assert.equal(locked.control.stage, "requirements_alignment");
  } finally {
    await fixture.dispose();
  }
});

test("same-revision host answer resolves the initial workspace ownership question (P1)", async () => {
  const fixture = await createTinyApp();
  try {
    await writeFile(path.join(fixture.root, "src/counter.js"), "export const counter = 1;\n", "utf8");
    await mcpCall(server, fixture.root, "dev_flow_init_project", { config: strictProjectConfig });
    await invokeHook(codexHook, fixture.root, {
      hook_event_name: "SessionStart",
      event_id: "ownership-session",
    });
    const started = await mcpCall(server, fixture.root, "dev_flow_start", {
      featureId: "same-revision-ownership", objective: "验证同一 revision 的回答", host: "codex",
      scope: { inScope: ["src/counter.js"], outOfScope: [] },
    }, { requireRealHostHealth: true });
    assert.equal(started.control.expectedRevision, 0);
    await invokeHook(codexHook, fixture.root, {
      hook_event_name: "UserPromptSubmit",
      event_id: "ownership-answer",
      prompt: "纳入当前任务",
    });
    const answered = await mcpCall(server, fixture.root, "dev_flow_answer", {
      featureId: "same-revision-ownership",
      expectedRevision: started.control.expectedRevision,
      userReply: "纳入当前任务",
      host: "codex",
    });
    assert.equal(answered.control.expectedRevision, 1);
    const resolvedState = await store.readState(fixture.root, "same-revision-ownership");
    assert.equal(resolvedState.pendingDecision, undefined);
    assert.equal(resolvedState.workspace.ownership["src/counter.js"], "feature");
  } finally {
    await fixture.dispose();
  }
});

test("workspace ownership presents a batch and supports one-by-one resolution", async () => {
  const fixture = await createTinyApp();
  try {
    await writeFile(path.join(fixture.root, "src/counter.js"), "export const counter = 2;\n", "utf8");
    await writeFile(path.join(fixture.root, "src/extra.js"), "export const extra = true;\n", "utf8");
    await mcpCall(server, fixture.root, "dev_flow_init_project", { config: strictProjectConfig });
    const started = await mcpCall(server, fixture.root, "dev_flow_start", {
      featureId: "batch-ownership", objective: "批量确认工作区归属", host: "codex",
      scope: { inScope: ["src"], outOfScope: [] },
    });
    const before = await store.readState(fixture.root, "batch-ownership");
    assert.equal(decisions.pendingDecisionForState(before).options.length, 3);
    assert.deepEqual(before.interactions[Object.keys(before.interactions)[0]].workspaceBatchPaths, ["src/counter.js", "src/extra.js"]);
    await store.recordHostEvent(fixture.root, { eventId: "batch-adopt", type: "user-prompt", host: "codex", text: "这些都算当前任务的" });
    const answered = await mcpCall(server, fixture.root, "dev_flow_answer", {
      featureId: "batch-ownership", expectedRevision: started.control.expectedRevision,
      userReply: "这些都算当前任务的", host: "codex",
    });
    assert.equal(answered.control.expectedRevision, 1);
    const adopted = await store.readState(fixture.root, "batch-ownership");
    assert.equal(decisions.pendingDecisionForState(adopted), undefined);
    assert.equal(adopted.workspace.ownership["src/counter.js"], "feature");
    assert.equal(adopted.workspace.ownership["src/extra.js"], "feature");
  } finally {
    await fixture.dispose();
  }

  const second = await createTinyApp();
  try {
    await writeFile(path.join(second.root, "src/counter.js"), "export const counter = 3;\n", "utf8");
    await writeFile(path.join(second.root, "src/extra.js"), "export const extra = false;\n", "utf8");
    await mcpCall(server, second.root, "dev_flow_init_project", { config: strictProjectConfig });
    const started = await mcpCall(server, second.root, "dev_flow_start", {
      featureId: "one-by-one-ownership", objective: "逐个确认工作区归属", host: "codex",
      scope: { inScope: ["src"], outOfScope: [] },
    });
    await store.recordHostEvent(second.root, { eventId: "one-by-one", type: "user-prompt", host: "codex", text: "逐个确认" });
    const first = await mcpCall(server, second.root, "dev_flow_answer", {
      featureId: "one-by-one-ownership", expectedRevision: started.control.expectedRevision,
      userReply: "逐个确认", host: "codex",
    });
    assert.equal(first.control.expectedRevision, 1);
    const pending = await store.readState(second.root, "one-by-one-ownership");
    assert.equal(decisions.pendingDecisionForState(pending).kind, "workspace-ownership");
    const firstPath = pending.interactions[Object.keys(pending.interactions).find((key) => pending.interactions[key].status === "pending")].workspacePaths[0];
    await store.recordHostEvent(second.root, { eventId: "one-by-one-adopt", type: "user-prompt", host: "codex", text: "纳入当前任务" });
    const secondAnswer = await mcpCall(server, second.root, "dev_flow_answer", {
      featureId: "one-by-one-ownership", expectedRevision: first.control.expectedRevision,
      userReply: "纳入当前任务", host: "codex",
    });
    const afterFirst = await store.readState(second.root, "one-by-one-ownership");
    assert.equal(decisions.pendingDecisionForState(afterFirst).kind, "workspace-ownership");
    const remainingPath = afterFirst.interactions[Object.keys(afterFirst.interactions).find((key) => afterFirst.interactions[key].status === "pending")].workspacePaths[0];
    assert.notEqual(firstPath, remainingPath);
    await store.recordHostEvent(second.root, { eventId: "one-by-one-exclude", type: "user-prompt", host: "codex", text: "排除并先处理" });
    await mcpCall(server, second.root, "dev_flow_answer", {
      featureId: "one-by-one-ownership", expectedRevision: secondAnswer.control.expectedRevision,
      userReply: "排除并先处理", host: "codex",
    });
    const resolved = await store.readState(second.root, "one-by-one-ownership");
    assert.equal(decisions.pendingDecisionForState(resolved), undefined);
    assert.equal(resolved.workspace.ownership[firstPath], "feature");
    assert.equal(resolved.workspace.ownership[remainingPath], "excluded");
  } finally {
    await second.dispose();
  }
});

test("workspace ownership answer fails closed when reconciliation adds an unknown path", async () => {
  const fixture = await createTinyApp();
  try {
    await writeFile(path.join(fixture.root, "src/counter.js"), "export const counter = 4;\n", "utf8");
    await mcpCall(server, fixture.root, "dev_flow_init_project", { config: strictProjectConfig });
    const started = await mcpCall(server, fixture.root, "dev_flow_start", {
      featureId: "stale-ownership", objective: "验证归属问题的陈旧保护", host: "codex",
      scope: { inScope: ["src"], outOfScope: [] },
    });
    await writeFile(path.join(fixture.root, "src/new.js"), "export const newFile = true;\n", "utf8");
    await mcpCall(server, fixture.root, "dev_flow_reconcile_workspace", {
      featureId: "stale-ownership", expectedRevision: started.control.expectedRevision, host: "codex",
    });
    await store.recordHostEvent(fixture.root, { eventId: "stale-answer", type: "user-prompt", host: "codex", text: "全部纳入当前任务" });
    await assert.rejects(
      () => mcpCall(server, fixture.root, "dev_flow_answer", {
        featureId: "stale-ownership", expectedRevision: 1,
        userReply: "全部纳入当前任务", host: "codex",
      }),
      (error) => error.code === "WORKSPACE_OWNERSHIP_STALE",
    );
    const state = await store.readState(fixture.root, "stale-ownership");
    assert.equal(decisions.pendingDecisionForState(state).kind, "workspace-ownership");
    assert.deepEqual(state.workspace.unownedPaths, ["src/counter.js", "src/new.js"]);
  } finally {
    await fixture.dispose();
  }
});

test("dev_flow_classify uses a properties-based schema, not top-level oneOf (P3)", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "dev-flow-p3-schema-"));
  try {
    const tools = await rawListTools(root);
    const classify = tools.find((tool) => tool.name === "dev_flow_classify");
    assert.ok(classify, "dev_flow_classify must be advertised in tools/list");
    const schema = classify.inputSchema;
    assert.equal(schema.oneOf, undefined, "classify schema must not use top-level oneOf");
    assert.ok(schema.properties, "classify schema must have properties at root");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("dev_flow_classify rejects empty args with CLASSIFICATION_ARGS_INVALID (P3)", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "dev-flow-p3-args-"));
  try {
    await assert.rejects(
      () => mcpCall(server, root, "dev_flow_classify", {}),
      (error) => error.code === "CLASSIFICATION_ARGS_INVALID",
    );
    const preview = await mcpCall(server, root, "dev_flow_classify", { level: "M", topology: "local", requirements: "provided-confirmed" });
    assert.equal(preview.route, "m");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
