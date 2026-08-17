import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { build } from "esbuild";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
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
const decisions = await loadSource("plugins/dev-flow/src/core/decision-interactions.ts");

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

async function initialize(client, capabilities = { elicitation: { form: {} } }, clientInfo = { name: "test", version: "1" }) {
  client.send({ jsonrpc: "2.0", id: "init", method: "initialize", params: { protocolVersion: "2025-11-25", capabilities, clientInfo } });
  const initialized = await client.next();
  assert.equal(initialized.id, "init");
}

test("Claude Code skips its multi-step form renderer and returns text fallback immediately", async () => {
  const fixture = await createTinyApp();
  let client;
  try {
    await mcpCall(server, fixture.root, "dev_flow_init_project", { config: strictProjectConfig });
    const started = await mcpCall(server, fixture.root, "dev_flow_start", { featureId: "elicitation", objective: "测试 Claude 文本降级", host: "claude" });
    client = interactiveClient(fixture.root);
    await initialize(client, { elicitation: { form: {} } }, { name: "claude-code", version: "2.1.226" });
    client.send({ jsonrpc: "2.0", id: "tool-claude", method: "tools/call", params: { name: "dev_flow_request_grill_decision", arguments: { ...grillArgs(started.control.expectedRevision), host: "claude" } } });
    let response;
    for (;;) {
      const message = await client.next();
      assert.notEqual(message.method, "elicitation/create");
      if (message.id === "tool-claude") {
        response = message;
        break;
      }
    }
    assert.equal(response.result.structuredContent.interactionOutcome, "pending");
    assert.match(response.result.structuredContent.interaction.presentation, /A\. 保留现有行为（推荐）/);
    assert.match(response.result.structuredContent.interaction.presentation, /保持当前行为，避免无关改动。/);
    assert.match(response.result.structuredContent.interaction.presentation, /请回复 A 或 B/);
  } finally {
    if (client) await client.close();
    await fixture.dispose();
  }
});

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
  options: [
    { id: "keep", label: "保留现有行为", description: "不改变当前行为。" },
    { id: "remove", label: "移除现有行为", description: "删除当前行为。" },
  ],
  recommendation: {
    optionId: "keep",
    reason: "保持当前行为，避免无关改动。",
    drawback: "会继续保留当前行为的维护成本。",
    alternative: { optionId: "remove", condition: "如果后续确认应删除现有行为。" },
  },
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

test("text grill journey accepts semantic A and substantive other replies without reformulation", async () => {
  const fixture = await createTinyApp();
  try {
    await mcpCall(server, fixture.root, "dev_flow_init_project", { config: strictProjectConfig });
    const started = await mcpCall(server, fixture.root, "dev_flow_start", {
      featureId: "elicitation",
      objective: "测试 grill 文本语义回答",
      host: "codex",
    });
    const first = await mcpCall(server, fixture.root, "dev_flow_request_grill_decision", grillArgs(started.control.expectedRevision));
    assert.match(first.interaction.presentation, /A\. 保留现有行为（推荐）/);
    const status = await mcpCall(server, fixture.root, "dev_flow_status", { featureId: "elicitation" });
    assert.equal(status.pendingDecision.presentation, first.interaction.presentation);
    assert.deepEqual(status.pendingDecision.options.map((option) => option.answerCode), ["A", "B"]);
    await store.recordHostEvent(fixture.root, {
      eventId: "semantic-a",
      type: "user-prompt",
      host: "codex",
      text: "我选择 A",
    });
    const selected = await mcpCall(server, fixture.root, "dev_flow_answer", {
      featureId: "elicitation",
      expectedRevision: first.control.expectedRevision,
      host: "codex",
    });
    assert.deepEqual(selected.response, {
      action: "保留现有行为",
      kind: "option",
      answerCode: "A",
      selectedOptionId: "keep",
      rawReply: "我选择 A",
    });

    const second = await mcpCall(server, fixture.root, "dev_flow_request_grill_decision", grillArgs(selected.control.expectedRevision, "2"));
    const otherReply = "其他：先做一个最小实验，再依据结果决定是否保留。";
    await store.recordHostEvent(fixture.root, {
      eventId: "semantic-other",
      type: "user-prompt",
      host: "codex",
      text: otherReply,
    });
    const custom = await mcpCall(server, fixture.root, "dev_flow_answer", {
      featureId: "elicitation",
      expectedRevision: second.control.expectedRevision,
      host: "codex",
    });
    assert.deepEqual(custom.response, {
      action: "other",
      kind: "other",
      rawReply: otherReply,
      comment: "先做一个最小实验，再依据结果决定是否保留。",
    });
  } finally {
    await fixture.dispose();
  }
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
        assert.equal(decisions.pendingDecisionForState(state).kind, "grill");
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
        assert.equal(decisions.pendingDecisionForState(await store.readState(fixture.root, "elicitation")).kind, "grill");
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
    assert.match(request.params.message, /A\. 保留现有行为（推荐）/);
    assert.match(request.params.message, /保持当前行为，避免无关改动。/);
    assert.deepEqual(request.params.requestedSchema.properties.action.oneOf, [
      { const: "keep", title: "A. 保留现有行为（推荐）" },
      { const: "remove", title: "B. 移除现有行为" },
      { const: "other", title: "其他（请补充方案和理由）" },
    ]);
    assert.equal("enumNames" in request.params.requestedSchema.properties.action, false);
    client.send({ jsonrpc: "2.0", id: request.id, result: { action: "accept", content: { action: "keep" } } });
    const response = await nextMatching(client, (message) => message.id === "tool");
    assert.equal(response.id, "tool");
    assert.equal(response.result.isError, undefined);
    const state = await store.readState(fixture.root, "elicitation");
    assert.equal(decisions.pendingDecisionForState(state), undefined);
    assert.equal(state.governance.decisions.length, 1);
    assert.equal(state.governance.decisions[0].conclusion, "keep");
    await client.close();
  } finally { await fixture.dispose(); }
});

test("form elicitation exposes other and persists its required explanation", async () => {
  const fixture = await createTinyApp();
  try {
    await mcpCall(server, fixture.root, "dev_flow_init_project", { config: strictProjectConfig });
    const started = await mcpCall(server, fixture.root, "dev_flow_start", { featureId: "elicitation", objective: "测试表单其他方案", host: "codex" });
    const client = interactiveClient(fixture.root);
    await initialize(client);
    client.send({ jsonrpc: "2.0", id: "tool-other", method: "tools/call", params: { name: "dev_flow_request_grill_decision", arguments: grillArgs(started.control.expectedRevision) } });
    const request = await nextMatching(client, (message) => message.method === "elicitation/create");
    client.send({
      jsonrpc: "2.0",
      id: request.id,
      result: { action: "accept", content: { action: "other", comment: "先验证行为差异，再决定保留或移除。" } },
    });
    const response = await nextMatching(client, (message) => message.id === "tool-other");
    assert.deepEqual(response.result.structuredContent.response, {
      action: "other",
      kind: "other",
      rawReply: "其他：先验证行为差异，再决定保留或移除。",
      comment: "先验证行为差异，再决定保留或移除。",
    });
    const state = await store.readState(fixture.root, "elicitation");
    const resolved = Object.values(state.interactions).find((interaction) => interaction.kind === "grill");
    assert.equal(resolved.response.kind, "other");
    assert.equal(resolved.response.comment, "先验证行为差异，再决定保留或移除。");
    await client.close();
  } finally {
    await fixture.dispose();
  }
});

test("route confirmation uses the same native form and resolves in one MCP call", async () => {
  const fixture = await createTinyApp();
  try {
    await mcpCall(server, fixture.root, "dev_flow_init_project", { config: strictProjectConfig });
    const started = await mcpCall(server, fixture.root, "dev_flow_start", { featureId: "route-form", objective: "测试路线原生确认", host: "codex" });
    // v5 分类引用已登记的仓库事实记录（ADR-0018）：先登记事实并提交，再记录
    // 依赖当前内容指纹的决定，最后用事实 recordId 锁定路线。
    await writeFile(path.join(fixture.root, "src", "route-fact.txt"), "single module evidence\n");
    execFileSync("git", ["add", "src/route-fact.txt"], { cwd: fixture.root });
    execFileSync("git", ["commit", "-qm", "route fact"], { cwd: fixture.root });
    const withFact = await store.registerRepositoryFact(fixture.root, "route-form", started.control.expectedRevision, {
      assertion: "只改一个模块",
      location: { kind: "positive", path: "src/route-fact.txt" },
    }, "codex");
    const factRef = withFact.recordId;
    await store.recordHostEvent(fixture.root, { eventId: "route-decision", type: "user-prompt", host: "codex", text: "保留" });
    const recorded = await mcpCall(server, fixture.root, "dev_flow_record_decision", {
      featureId: "route-form", expectedRevision: withFact.state.revision,
      question: "是否保留兼容行为？", evidence: "用户已有明确结论", conclusion: "保留", factRefs: [], host: "codex",
    });
    // issue 08：较早对话的决定需要用户追认后才成为当前决定
    await store.recordHostEvent(fixture.root, { eventId: "ratify-route", type: "user-prompt", host: "codex", text: "确认登记" });
    const ratified = await mcpCall(server, fixture.root, "dev_flow_answer", {
      featureId: "route-form", expectedRevision: recorded.control.expectedRevision,
      host: "codex",
    });
    const client = interactiveClient(fixture.root);
    await initialize(client);
    client.send({ jsonrpc: "2.0", id: "lock", method: "tools/call", params: {
      name: "dev_flow_lock_classification",
      arguments: {
        featureId: "route-form", expectedRevision: ratified.state.revision,
        classification: {
          level: "M", topology: "local", requirements: "provided-confirmed",
          classificationBasis: {
            scopeFactRefs: [factRef], topologyFactRefs: [factRef], uncertaintyFactRefs: [],
            riskFactRefs: {}, decisionRefs: [recorded.decisionId],
            signals: { changeSurface: "multi-component", behaviorChange: "new-capability", topology: "local", unitCount: 1, requirements: "provided-confirmed", operationalRecovery: false, executableRollback: false },
          },
        },
        boundaryAudit: { scanned: ["assumption", "free-space", "tbd", "fallback", "scope", "acceptance"], items: [] },
      },
    } });
    const request = await nextMatching(client, (message) => message.method === "elicitation/create");
    assert.deepEqual(request.params.requestedSchema.properties.action.oneOf, [
      { const: "confirm", title: "确认这条路线" },
      { const: "correct", title: "修正分类事实" },
    ]);
    client.send({ jsonrpc: "2.0", id: request.id, result: { action: "accept", content: { action: "confirm" } } });
    const response = await nextMatching(client, (message) => message.id === "lock");
    assert.equal(response.result.isError, undefined);
    assert.equal(response.result.structuredContent.control.stage, "requirements_alignment");
    const state = await store.readState(fixture.root, "route-form");
    assert.equal(state.mode, "routed");
    assert.equal(decisions.pendingDecisionForState(state), undefined);
    assert.equal(Object.values(state.interactions).filter((value) => value.status === "pending").length, 0);
    await client.close();
  } finally {
    await fixture.dispose();
  }
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
    assert.equal(state.governance.authorizations.length, 1);
    assert.equal(state.governance.authorizations[0].authorizationType, "risk-acceptance");
    assert.equal(state.governance.credentials[0].rawText, "已了解验证风险");
    assert.equal(decisions.pendingDecisionForState(state), undefined);
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
    assert.equal(state.governance.authorizations.length, 0);
    assert.equal(decisions.pendingDecisionForState(state), undefined);
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
    assert.equal(decisions.pendingDecisionForState(state).kind, "grill");

    // Resolve through trusted text, then prove the same MCP session no longer
    // emits a second elicitation/create request.
    await store.recordHostEvent(fixture.root, { eventId: "text-answer", type: "user-prompt", host: "codex", text: "A" });
    client.send({ jsonrpc: "2.0", id: "answer", method: "tools/call", params: { name: "dev_flow_answer", arguments: { featureId: "elicitation", expectedRevision: state.revision, host: "codex" } } });
    assert.equal((await nextMatching(client, (message) => message.id === "answer")).id, "answer");
    state = await store.readState(fixture.root, "elicitation");
    client.send({ jsonrpc: "2.0", id: "tool-fused", method: "tools/call", params: { name: "dev_flow_request_grill_decision", arguments: grillArgs(state.revision, "2") } });
    const fusedResponse = await nextMatching(client, (message) => message.id === "tool-fused");
    assert.equal(fusedResponse.id, "tool-fused");
    assert.equal(fusedResponse.result.structuredContent.interactionOutcome, "pending");
    await client.close();
  } finally { await fixture.dispose(); }
});
