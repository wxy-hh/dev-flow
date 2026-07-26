import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

function request(messages, cwd) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [path.resolve("plugins/dev-flow/dist/mcp-server.mjs")], { cwd, stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "", stderr = ""; child.stdout.on("data", (chunk) => { stdout += chunk; }); child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("error", reject); child.on("close", (code) => code === 0 ? resolve(stdout.trim().split("\n").filter(Boolean).map(JSON.parse)) : reject(new Error(stderr)));
    child.stdin.end(messages.map((message) => JSON.stringify(message)).join("\n") + "\n");
  });
}

test("MCP server initializes, advertises the complete public interface, and maps errors", async () => {
  const responses = await request([
    { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2024-11-05" } },
    { jsonrpc: "2.0", id: 2, method: "tools/list" },
    { jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "not_a_tool", arguments: {} } },
    { jsonrpc: "2.0", id: 4, method: "tools/call", params: { name: "dev_flow_classify", arguments: { level: "L", topology: "multi-chain", execution: "light", riskLabels: ["security", "critical_correctness"] } } },
  ]);
  // initialize / tools/list must be bare protocol results (not tools/call content wrappers)
  assert.equal(responses[0].result.serverInfo.name, "dev-flow");
  assert.equal(responses[0].result.capabilities.tools !== undefined, true);
  assert.equal(responses[0].result.content, undefined);
  assert.ok(Array.isArray(responses[1].result.tools));
  assert.equal(responses[1].result.content, undefined);
  const names = responses[1].result.tools.map((tool) => tool.name);
  for (const name of ["dev_flow_init_project", "dev_flow_classify", "dev_flow_start", "dev_flow_next", "dev_flow_verify", "dev_flow_confirm_gate", "dev_flow_finalize", "dev_flow_recover_corrupt_feature", "dev_flow_status"]) {
    assert.ok(names.includes(name), `missing tool ${name}`);
  }
  const contract = JSON.parse(await readFile(path.resolve("plugins/dev-flow/policy/contract.json"), "utf8"));
  const allowedRiskLabels = Object.keys(contract.riskEnhancements);
  for (const toolName of ["dev_flow_classify", "dev_flow_start"]) {
    const schema = responses[1].result.tools.find((tool) => tool.name === toolName).inputSchema.properties.riskLabels;
    assert.deepEqual(schema.items.enum, allowedRiskLabels);
    assert.equal(schema.uniqueItems, true);
  }
  const verifySchema = responses[1].result.tools.find((tool) => tool.name === "dev_flow_verify").inputSchema;
  assert.equal(verifySchema.properties.manualAcceptance.properties.scenarios.minItems, 1);
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
