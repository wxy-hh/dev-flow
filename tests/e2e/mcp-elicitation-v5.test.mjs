import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { build } from "esbuild";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import readline from "node:readline";
import test, { after } from "node:test";
import { createTinyApp, strictProjectConfig } from "../helpers/fixture-repo.mjs";
import { mcpCall } from "../helpers/host-runner.mjs";
import { loadSource } from "../helpers/load-source.mjs";

const staging = await mkdtemp(path.join(os.tmpdir(), "dev-flow-elicitation-source-"));
const server = path.join(staging, "mcp-server.mjs");
await build({
  entryPoints: [path.resolve("plugins/dev-flow/src/mcp/server.ts")],
  outfile: server,
  bundle: true,
  platform: "node",
  target: "node20",
  format: "esm",
  define: { __DEV_FLOW_VERSION__: JSON.stringify("test") },
});
after(() => rm(staging, { recursive: true, force: true }));
const store = await loadSource("plugins/dev-flow/src/core/state-store.ts");

function interactiveClient(cwd, timeoutMs = "1000") {
  const child = spawn(process.execPath, [server], {
    cwd,
    env: { ...process.env, NODE_ENV: "test", DEV_FLOW_ELICITATION_TIMEOUT_MS: timeoutMs },
    stdio: ["pipe", "pipe", "pipe"],
  });
  const queued = [];
  const waiters = [];
  const lines = readline.createInterface({ input: child.stdout, crlfDelay: Infinity });
  lines.on("line", (line) => {
    const message = JSON.parse(line);
    const waiter = waiters.shift();
    if (waiter) waiter.resolve(message);
    else queued.push(message);
  });
  const send = (message) => child.stdin.write(`${JSON.stringify(message)}\n`);
  const next = () => queued.length ? Promise.resolve(queued.shift()) : new Promise((resolve, reject) => waiters.push({ resolve, reject }));
  const close = async () => {
    child.stdin.end();
    await new Promise((resolve) => child.once("close", resolve));
  };
  return { send, next, close };
}

async function initialize(client, capabilities = { elicitation: { form: {} } }) {
  client.send({ jsonrpc: "2.0", id: "init", method: "initialize", params: { protocolVersion: "2025-11-25", capabilities, clientInfo: { name: "test", version: "1" } } });
  const initialized = await client.next();
  assert.equal(initialized.id, "init");
}

async function nextMatching(client, predicate) {
  for (;;) {
    const message = await client.next();
    if (predicate(message)) return message;
  }
}

const grillArgs = (revision, suffix = "1") => ({
  featureId: "elicitation",
  expectedRevision: revision,
  questionId: `DEC-00${suffix}`,
  question: "是否保留现有行为？",
  options: [{ id: "keep", label: "保留" }, { id: "remove", label: "移除" }],
  host: "codex",
});

const qualityExceptionArgs = (revision) => ({
  featureId: "elicitation",
  expectedRevision: revision,
  kind: "verification",
  basisHash: "a".repeat(64),
  fingerprint: "b".repeat(64),
  riskSummary: "验证证据需要用户明确接受。",
  host: "codex",
});

test("decline and cancel preserve the pending decision and fall back to explicit text", async (t) => {
  for (const action of ["decline", "cancel"]) {
    await t.test(action, async () => {
      const fixture = await createTinyApp();
      try {
        await mcpCall(server, fixture.root, "dev_flow_init_project", { config: strictProjectConfig });
        const started = await mcpCall(server, fixture.root, "dev_flow_start", { featureId: "elicitation", objective: "测试拒绝与取消", host: "codex" });
        const client = interactiveClient(fixture.root);
        await initialize(client);
        client.send({ jsonrpc: "2.0", id: "tool", method: "tools/call", params: { name: "dev_flow_request_grill_decision", arguments: grillArgs(started.control.expectedRevision) } });
        const request = await nextMatching(client, (message) => message.method === "elicitation/create");
        client.send({ jsonrpc: "2.0", id: request.id, result: { action } });
        const response = await nextMatching(client, (message) => message.id === "tool");
        assert.equal(response.result.structuredContent.interactionOutcome, "pending");
        const state = await store.readState(fixture.root, "elicitation");
        assert.equal(state.pendingDecision.kind, "grill");
        await client.close();
      } finally { await fixture.dispose(); }
    });
  }
});

test("missing elicitation capability and client protocol errors preserve text fallback", async (t) => {
  for (const mode of ["missing-capability", "protocol-error"]) {
    await t.test(mode, async () => {
      const fixture = await createTinyApp();
      try {
        await mcpCall(server, fixture.root, "dev_flow_init_project", { config: strictProjectConfig });
        const started = await mcpCall(server, fixture.root, "dev_flow_start", { featureId: "elicitation", objective: "测试协议降级", host: "codex" });
        const client = interactiveClient(fixture.root);
        await initialize(client, mode === "missing-capability" ? {} : { elicitation: { form: {} } });
        client.send({ jsonrpc: "2.0", id: "tool", method: "tools/call", params: { name: "dev_flow_request_grill_decision", arguments: grillArgs(started.control.expectedRevision) } });
        if (mode === "protocol-error") {
          const request = await nextMatching(client, (message) => message.method === "elicitation/create");
          client.send({ jsonrpc: "2.0", id: request.id, error: { code: -32603, message: "host failed" } });
        }
        const response = await nextMatching(client, (message) => message.id === "tool");
        assert.equal(response.result.structuredContent.interactionOutcome, "pending");
        assert.equal((await store.readState(fixture.root, "elicitation")).pendingDecision.kind, "grill");
        await client.close();
      } finally { await fixture.dispose(); }
    });
  }
});

test("form elicitation uses oneOf const/title and accept atomically resolves the ledger", async () => {
  const fixture = await createTinyApp();
  try {
    await mcpCall(server, fixture.root, "dev_flow_init_project", { config: strictProjectConfig });
    const started = await mcpCall(server, fixture.root, "dev_flow_start", { featureId: "elicitation", objective: "测试原生交互", host: "codex" });
    const client = interactiveClient(fixture.root);
    await initialize(client);
    client.send({ jsonrpc: "2.0", id: "tool", method: "tools/call", params: { name: "dev_flow_request_grill_decision", arguments: grillArgs(started.control.expectedRevision) } });
    const request = await nextMatching(client, (message) => message.method === "elicitation/create");
    assert.equal(request.method, "elicitation/create");
    assert.deepEqual(request.params.requestedSchema.properties.action.oneOf, [
      { const: "keep", title: "保留" },
      { const: "remove", title: "移除" },
    ]);
    assert.equal("enumNames" in request.params.requestedSchema.properties.action, false);
    client.send({ jsonrpc: "2.0", id: request.id, result: { action: "accept", content: { action: "keep" } } });
    const response = await nextMatching(client, (message) => message.id === "tool");
    assert.equal(response.id, "tool");
    assert.equal(response.result.isError, undefined);
    const state = await store.readState(fixture.root, "elicitation");
    assert.equal(state.pendingDecision, undefined);
    assert.equal(state.decisionLedger.length, 1);
    assert.equal(state.decisionLedger[0].status, "resolved");
    await client.close();
  } finally { await fixture.dispose(); }
});

test("quality-exception form accept records the accepted risk with the form comment", async () => {
  const fixture = await createTinyApp();
  try {
    await mcpCall(server, fixture.root, "dev_flow_init_project", { config: strictProjectConfig });
    const started = await mcpCall(server, fixture.root, "dev_flow_start", { featureId: "elicitation", objective: "测试质量例外表单", host: "codex" });
    const client = interactiveClient(fixture.root);
    await initialize(client);
    client.send({ jsonrpc: "2.0", id: "tool-quality", method: "tools/call", params: { name: "dev_flow_present_quality_exception", arguments: qualityExceptionArgs(started.control.expectedRevision) } });
    const request = await nextMatching(client, (message) => message.method === "elicitation/create");
    assert.deepEqual(request.params.requestedSchema.properties.action.oneOf, [
      { const: "accept", title: "接受风险" },
      { const: "decline", title: "先修复问题" },
    ]);
    client.send({ jsonrpc: "2.0", id: request.id, result: { action: "accept", content: { action: "accept", comment: "已了解验证风险" } } });
    const response = await nextMatching(client, (message) => message.id === "tool-quality");
    assert.equal(response.id, "tool-quality");
    assert.equal(response.result.isError, undefined);
    assert.equal(response.result.structuredContent.interactionOutcome, "接受风险");
    const state = await store.readState(fixture.root, "elicitation");
    assert.equal(state.qualityExceptions.length, 1);
    assert.equal(state.qualityExceptions[0].status, "current");
    assert.equal(state.qualityExceptions[0].userEvidence, "已了解验证风险");
    assert.equal(state.pendingDecision, undefined);
    await client.close();
  } finally { await fixture.dispose(); }
});

test("quality-exception form decline resolves without recording acceptance", async () => {
  const fixture = await createTinyApp();
  try {
    await mcpCall(server, fixture.root, "dev_flow_init_project", { config: strictProjectConfig });
    const started = await mcpCall(server, fixture.root, "dev_flow_start", { featureId: "elicitation", objective: "测试质量例外表单拒绝", host: "codex" });
    const client = interactiveClient(fixture.root);
    await initialize(client);
    client.send({ jsonrpc: "2.0", id: "tool-quality", method: "tools/call", params: { name: "dev_flow_present_quality_exception", arguments: qualityExceptionArgs(started.control.expectedRevision) } });
    const request = await nextMatching(client, (message) => message.method === "elicitation/create");
    client.send({ jsonrpc: "2.0", id: request.id, result: { action: "accept", content: { action: "decline" } } });
    const response = await nextMatching(client, (message) => message.id === "tool-quality");
    assert.equal(response.result.isError, undefined);
    assert.equal(response.result.structuredContent.interactionOutcome, "先修复问题");
    const state = await store.readState(fixture.root, "elicitation");
    assert.equal(state.qualityExceptions.length, 0);
    assert.equal(state.pendingDecision, undefined);
    await client.close();
  } finally { await fixture.dispose(); }
});

test("elicitation timeout cancels, ignores a late response, and fuses the session to text", async () => {
  const fixture = await createTinyApp();
  try {
    await mcpCall(server, fixture.root, "dev_flow_init_project", { config: strictProjectConfig });
    const started = await mcpCall(server, fixture.root, "dev_flow_start", { featureId: "elicitation", objective: "测试超时降级", host: "codex" });
    const client = interactiveClient(fixture.root, "30");
    await initialize(client);
    client.send({ jsonrpc: "2.0", id: "tool-timeout", method: "tools/call", params: { name: "dev_flow_request_grill_decision", arguments: grillArgs(started.control.expectedRevision) } });
    const request = await nextMatching(client, (message) => message.method === "elicitation/create");
    const cancelled = await nextMatching(client, (message) => message.method === "notifications/cancelled");
    assert.equal(cancelled.method, "notifications/cancelled");
    assert.equal(cancelled.params.requestId, request.id);
    const pendingResponse = await nextMatching(client, (message) => message.id === "tool-timeout");
    assert.equal(pendingResponse.id, "tool-timeout");
    assert.equal(pendingResponse.result.structuredContent.interactionOutcome, "pending");

    // Late response is consumed as expired and cannot resolve the decision.
    client.send({ jsonrpc: "2.0", id: request.id, result: { action: "accept", content: { action: "keep" } } });
    client.send({ jsonrpc: "2.0", id: "ping", method: "ping", params: {} });
    assert.equal((await nextMatching(client, (message) => message.id === "ping")).id, "ping");
    let state = await store.readState(fixture.root, "elicitation");
    assert.equal(state.pendingDecision.kind, "grill");

    // Resolve through trusted text, then prove the same MCP session no longer
    // emits a second elicitation/create request.
    await store.recordHostEvent(fixture.root, { eventId: "text-answer", type: "user-prompt", host: "codex", text: "保留" });
    client.send({ jsonrpc: "2.0", id: "answer", method: "tools/call", params: { name: "dev_flow_answer", arguments: { featureId: "elicitation", expectedRevision: state.revision, userReply: "保留", host: "codex" } } });
    assert.equal((await nextMatching(client, (message) => message.id === "answer")).id, "answer");
    state = await store.readState(fixture.root, "elicitation");
    client.send({ jsonrpc: "2.0", id: "tool-fused", method: "tools/call", params: { name: "dev_flow_request_grill_decision", arguments: grillArgs(state.revision, "2") } });
    const fusedResponse = await nextMatching(client, (message) => message.id === "tool-fused");
    assert.equal(fusedResponse.id, "tool-fused");
    assert.equal(fusedResponse.result.structuredContent.interactionOutcome, "pending");
    await client.close();
  } finally { await fixture.dispose(); }
});
