import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createTinyApp, strictProjectConfig } from "../helpers/fixture-repo.mjs";
import { loadSource } from "../helpers/load-source.mjs";
import { registerTraceFixture } from "../helpers/trace-fixtures.mjs";

const store = await loadSource("plugins/dev-flow/src/core/state-store.ts");
const artifacts = await loadSource("plugins/dev-flow/src/core/artifacts.ts");
const checks = await loadSource("plugins/dev-flow/src/core/feature-check.ts");
const config = {
  schemaVersion: 1,
  verification: { commands: [{ id: "unit", command: "node", args: ["-e", "process.exit(0)"], cwd: "." }], behaviorCommands: [] },
  enforcement: { mode: "strict", gitWriteRequiresLogicComplete: true, oneActiveFeature: true, requireExplicitHumanReply: true },
  protectedRoots: ["src"],
};

function request(messages, cwd) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [path.resolve("plugins/dev-flow/dist/mcp-server.mjs")], { cwd, stdio: ["pipe", "pipe", "pipe"], env: { ...process.env, DEV_FLOW_DISABLE_ATTENTION: "1" } });
    let stdout = "", stderr = ""; child.stdout.on("data", (chunk) => { stdout += chunk; }); child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("error", reject); child.on("close", (code) => code === 0 ? resolve(stdout.trim().split("\n").filter(Boolean).map(JSON.parse)) : reject(new Error(stderr)));
    child.stdin.end(messages.map((message) => JSON.stringify(message)).join("\n") + "\n");
  });
}

function requestWithElicitation(message, cwd, elicitationResult) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [path.resolve("plugins/dev-flow/dist/mcp-server.mjs")], { cwd, stdio: ["pipe", "pipe", "pipe"], env: { ...process.env, DEV_FLOW_DISABLE_ATTENTION: "1" } });
    let stdout = "", stderr = "", settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
      const lines = stdout.split("\n");
      stdout = lines.pop();
      for (const line of lines.filter(Boolean)) {
        const response = JSON.parse(line);
        if (response.method === "elicitation/create") {
          child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id: response.id, result: elicitationResult })}\n`);
        } else if (response.id === 2) {
          child.stdin.end();
          finish(response);
        }
      }
    });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("error", reject);
    child.on("close", (code) => {
      if (!settled && code === 0) finish(undefined);
      else if (!settled) reject(new Error(stderr));
    });
    child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: { elicitation: { form: {} } } } })}\n`);
    child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/call", params: message })}\n`);
  });
}

test("MCP server initializes, advertises the complete public interface, and maps errors", async () => {
  const responses = await request([
    { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2024-11-05" } },
    { jsonrpc: "2.0", id: 2, method: "tools/list" },
    { jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "not_a_tool", arguments: {} } },
    { jsonrpc: "2.0", id: 4, method: "tools/call", params: { name: "dev_flow_classify", arguments: { level: "L", topology: "multi-chain", execution: "light", riskLabels: ["security", "critical_correctness"] } } },
    { jsonrpc: "2.0", id: 5, method: "tools/call", params: { name: "dev_flow_enable_windows_notifications", arguments: {} } },
  ]);
  // initialize / tools/list must be bare protocol results (not tools/call content wrappers)
  assert.equal(responses[0].result.serverInfo.name, "dev-flow");
  assert.equal(responses[0].result.capabilities.tools !== undefined, true);
  assert.equal(responses[0].result.content, undefined);
  assert.ok(Array.isArray(responses[1].result.tools));
  assert.equal(responses[1].result.content, undefined);
  const names = responses[1].result.tools.map((tool) => tool.name);
  for (const name of ["dev_flow_init_project", "dev_flow_classify", "dev_flow_start", "dev_flow_next", "dev_flow_verify", "dev_flow_confirm_gate", "dev_flow_respond_interaction", "dev_flow_request_grill_decision", "dev_flow_resolve_grill_decision", "dev_flow_enable_windows_notifications", "dev_flow_finalize", "dev_flow_recover_corrupt_feature", "dev_flow_status"]) {
    assert.ok(names.includes(name), `missing tool ${name}`);
  }
  const contract = JSON.parse(await readFile(path.resolve("plugins/dev-flow/policy/contract.json"), "utf8"));
  const allowedRiskLabels = Object.keys(contract.riskEnhancements);
  for (const toolName of ["dev_flow_classify", "dev_flow_start"]) {
    const properties = responses[1].result.tools.find((tool) => tool.name === toolName).inputSchema.properties;
    assert.deepEqual(properties.riskLabels.items.enum, allowedRiskLabels);
    assert.equal(properties.riskLabels.uniqueItems, true);
    assert.equal(properties.acceptanceAssistSuggested.type, "boolean");
    assert.equal(properties.manualAcceptanceRequired.type, "boolean");
  }
  const verifySchema = responses[1].result.tools.find((tool) => tool.name === "dev_flow_verify").inputSchema;
  assert.equal(verifySchema.properties.manualAcceptance.properties.scenarios.minItems, 1);
  assert.deepEqual(verifySchema.properties.manualAcceptance.properties.mode.enum, ["browser", "user-signoff", "code-path-audit"]);
  assert.equal(verifySchema.properties.manualAcceptance.properties.promptEventId.type, "string");
  assert.equal(verifySchema.properties.manualAcceptance.additionalProperties, false);
  const scaffoldTool = responses[1].result.tools.find((tool) => tool.name === "dev_flow_scaffold_artifact");
  assert.match(scaffoldTool.description, /Generated status artifacts are read-only/);

  // tools/call keeps CallToolResult content shape
  assert.equal(responses[2].error.data.code, "UNKNOWN_TOOL");
  assert.equal(responses[3].result.structuredContent.route, "light-l");
  assert.deepEqual(responses[3].result.structuredContent.riskRequirements, {
    checks: ["full-code-review", "security"],
    verification: ["behavior", "full"],
  });
  assert.deepEqual(responses[4].result.structuredContent, { status: "unsupported", platform: process.platform });
});

test("MCP dev_flow_next returns the same enriched evidence as the core action", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "dev-flow-mcp-next-"));
  const config = {
    schemaVersion: 1,
    verification: { commands: [{ id: "unit", command: "node", args: ["-e", "process.exit(0)"], cwd: "." }], behaviorCommands: [] },
    enforcement: { mode: "strict", gitWriteRequiresLogicComplete: true, oneActiveFeature: true, requireExplicitHumanReply: true },
    protectedRoots: ["src"],
  };
  try {
    await mkdir(path.join(root, "src"));
    await writeFile(path.join(root, "src", "app.js"), "export const value = 1;\n");
    await request([
      { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "dev_flow_init_project", arguments: { config } } },
      { jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "dev_flow_start", arguments: { featureId: "f", host: "codex", level: "L", topology: "multi-chain", execution: "light", riskLabels: ["security"] } } },
    ], root);
    const stateFile = path.join(root, ".dev-flow", "features", "f", "state.json");
    const state = JSON.parse(await readFile(stateFile, "utf8"));
    state.steps = Object.fromEntries(["boundary", "rollback_safety", "implementation_approval", "implementation"].map((step) => [step, { status: "satisfied" }]));
    await writeFile(stateFile, `${JSON.stringify(state, null, 2)}\n`);
    const [response] = await request([
      { jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "dev_flow_next", arguments: { featureId: "f" } } },
    ], root);
    assert.deepEqual(response.result.structuredContent, {
      kind: "run-step",
      step: "code_review",
      requiredEvidence: { fields: { reviewType: "code" }, checks: ["security"], verificationKinds: [] },
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("MCP nests a native confirmation control and records its structured user decision", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "dev-flow-mcp-elicit-"));
  try {
    await store.initProject(root, config);
    let state = await store.startFeature(root, {
      featureId: "f", host: "codex", level: "M", topology: "local", execution: "standard", requirements: "missing-or-unclear",
    });
    state = await artifacts.scaffoldArtifact(root, "f", state.revision, "requirements");
    const requirements = path.join(root, ".dev-flow", "features", "f", "需求文档.md");
    await writeFile(requirements, (await readFile(requirements, "utf8")).replace(/^  grill_status: pending$/m, "  grill_status: complete"));
    state = await registerTraceFixture({ root, featureId: "f", state, kind: "requirements" });
    state = await checks.recordStep(root, "f", state.revision, "requirements", {});

    const response = await requestWithElicitation({
      name: "dev_flow_present_gate",
      arguments: { featureId: "f", expectedRevision: state.revision, gate: "requirement_confirmation", host: "codex" },
    }, root, { action: "accept", content: { action: "confirm" } });
    assert.equal(response.result.structuredContent.interactionOutcome, "confirm");
    assert.equal(response.result.structuredContent.interaction.kind, "gate");
    assert.equal(response.result.structuredContent.response.action, "confirm");
    assert.equal(response.result.structuredContent.gateInteraction, undefined);
    const current = await store.readState(root, "f");
    assert.equal(current.steps.requirement_confirmation.status, "satisfied");
    assert.equal(current.humanGates.requirement_confirmation.confirmation.source, "elicitation");
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("MCP nests native grill choices and returns a free-text other response", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "dev-flow-mcp-grill-elicit-"));
  try {
    await store.initProject(root, config);
    let state = await store.startFeature(root, {
      featureId: "f", host: "codex", level: "M", topology: "local", execution: "standard", requirements: "missing-or-unclear",
    });
    state = await artifacts.scaffoldArtifact(root, "f", state.revision, "requirements");
    const requirements = path.join(root, ".dev-flow", "features", "f", "需求文档.md");
    await writeFile(requirements, (await readFile(requirements, "utf8")).replace(
      /^  grill_status: pending$/m,
      "  grill_status: in_progress\n  grill_question_id: Q-001\n  grill_response_hint: \"请选择一个方案\"\n  grill_question_limit: 3",
    ));
    state = await registerTraceFixture({ root, featureId: "f", state, kind: "requirements" });

    const response = await requestWithElicitation({
      name: "dev_flow_request_grill_decision",
      arguments: {
        featureId: "f", expectedRevision: state.revision, questionId: "Q-001", question: "选择同步方案", host: "codex",
        options: [{ id: "hosted", label: "托管同步" }, { id: "other", label: "其他 / 补充", requiresComment: true }],
      },
    }, root, { action: "accept", content: { action: "other", comment: "支持离线同步" } });
    assert.equal(response.result.structuredContent.interactionOutcome, "other");
    assert.equal(response.result.structuredContent.route, "standard-m");
    assert.equal(response.result.structuredContent.response.comment, "支持离线同步");
    const current = await store.readState(root, "f");
    assert.equal(Object.values(current.interactions).find((item) => item.response?.action === "other").response.source, "elicitation");
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("MCP emits one advisory attention event for a pending gate", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "dev-flow-mcp-gate-attention-"));
  try {
    await store.initProject(root, config);
    let state = await store.startFeature(root, {
      featureId: "f", host: "codex", level: "M", topology: "local", execution: "standard", requirements: "provided-confirmed",
    });
    state = await artifacts.scaffoldArtifact(root, "f", state.revision, "requirements");
    state = await registerTraceFixture({ root, featureId: "f", state, kind: "requirements" });
    state = await checks.recordStep(root, "f", state.revision, "requirements", {});
    const messages = await request([
      { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "dev_flow_present_gate", arguments: { featureId: "f", expectedRevision: state.revision, gate: "requirement_confirmation", host: "codex" } } },
    ], root);
    assert.deepEqual(messages.filter((message) => message.method === "notifications/message").map((message) => message.params.data), [
      { kind: "decision-required", featureId: "f", decision: "requirement_confirmation" },
    ]);
    const pending = messages.find((message) => message.id === 1).result.structuredContent;
    assert.equal(pending.interactionOutcome, "pending");
    assert.equal(pending.interaction.kind, "gate");
    assert.equal(pending.gateInteraction.id, pending.interaction.id);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("MCP emits one advisory attention event after successful finalize", async () => {
  const fixture = await createTinyApp();
  try {
    await store.initProject(fixture.root, strictProjectConfig);
    let state = await store.startFeature(fixture.root, { featureId: "f", host: "codex", level: "XS", topology: "local" });
    state = await checks.recordStep(fixture.root, "f", state.revision, "locate", {});
    state = await checks.recordStep(fixture.root, "f", state.revision, "implementation", { files: [] });
    state = await (await loadSource("plugins/dev-flow/src/core/verification.ts")).runVerification(fixture.root, "f", state.revision, "codex");
    const messages = await request([
      { jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "dev_flow_finalize", arguments: { featureId: "f", expectedRevision: state.revision } } },
    ], fixture.root);
    assert.deepEqual(messages.filter((message) => message.method === "notifications/message").map((message) => message.params.data), [
      { kind: "workflow-finalized", featureId: "f" },
    ]);
    assert.equal(messages.find((message) => message.id === 2).result.structuredContent.logicComplete, true);
  } finally { await fixture.dispose(); }
});
