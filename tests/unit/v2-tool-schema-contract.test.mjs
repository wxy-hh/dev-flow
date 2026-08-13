import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { after, test } from "node:test";
import { buildTestBundles } from "../helpers/test-bundle.mjs";

// MCP requires every tool's inputSchema to be an object schema. Assert the
// contract over the real tools/list wire output, not the source constant, so a
// malformed inline schema in the server entry is caught exactly like a client
// would surface it.
const bundles = await buildTestBundles();
after(() => bundles.dispose());

function listTools() {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [bundles.pathFor("mcp-server")], {
      stdio: ["pipe", "pipe", "pipe"],
      env: { ...process.env, DEV_FLOW_DISABLE_ATTENTION: "1" },
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code !== 0) return reject(new Error(stderr || `mcp-server exited with ${code}`));
      resolve(stdout.trim().split("\n").filter(Boolean).map(JSON.parse));
    });
    child.stdin.end([
      JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "test", version: "0" } } }),
      JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list" }),
    ].join("\n") + "\n");
  });
}

async function toolDefinitions() {
  const responses = await listTools();
  const toolsResponse = responses.find((message) => message.id === 2 && message.result?.tools);
  assert.ok(toolsResponse, "expected a tools/list result");
  assert.ok(Array.isArray(toolsResponse.result.tools) && toolsResponse.result.tools.length > 0);
  return toolsResponse.result.tools;
}

test("every tool exposes an MCP-conformant object inputSchema", async () => {
  const tools = await toolDefinitions();
  for (const tool of tools) {
    assert.ok(tool.inputSchema, `${tool.name} must declare an inputSchema`);
    assert.equal(tool.inputSchema.type, "object", `${tool.name}.inputSchema must declare top-level type: "object"`);
    if (!Array.isArray(tool.inputSchema.oneOf)) {
      assert.ok(tool.inputSchema.properties && typeof tool.inputSchema.properties === "object" && !Array.isArray(tool.inputSchema.properties),
        `${tool.name}.inputSchema.properties must be an object`);
      assert.ok(Array.isArray(tool.inputSchema.required), `${tool.name}.inputSchema.required must be an array`);
    }
  }
});

test("dev_flow_classify exposes a properties-based schema with both call modes", async () => {
  const tools = await toolDefinitions();
  const classify = tools.find((tool) => tool.name === "dev_flow_classify");
  assert.ok(classify, "dev_flow_classify must be present");
  assert.equal(classify.inputSchema.type, "object");
  assert.equal(classify.inputSchema.oneOf, undefined, "classify must not use top-level oneOf");
  assert.ok(classify.inputSchema.properties, "classify must declare root properties");
  assert.ok("classificationBasis" in classify.inputSchema.properties, "recommend mode via classificationBasis");
  assert.ok("level" in classify.inputSchema.properties && "topology" in classify.inputSchema.properties, "flat mode via level/topology");
  assert.ok("controlEnhancements" in classify.inputSchema.properties, "flat mode must expose additive control enhancements");
  assert.ok("controlEnhancements" in classify.inputSchema.properties.classificationBasis.properties,
    "classificationBasis must expose additive control enhancements");
  assert.equal(classify.inputSchema.properties.controlEnhancements.properties.requirements.const, true);
  assert.equal(classify.inputSchema.properties.controlEnhancements.additionalProperties, false);
});

test("v5 public MCP surface removes split decisions and feature-check, and exposes derived repair", async () => {
  const tools = await toolDefinitions();
  const names = new Set(tools.map((tool) => tool.name));
  assert.equal(names.has("dev_flow_answer"), true);
  assert.equal(names.has("dev_flow_status"), true);
  assert.equal(names.has("dev_flow_inspect"), true);
  assert.equal(names.has("dev_flow_repair_feature"), true);
  for (const removed of ["dev_flow_next", "dev_flow_confirm_approval", "dev_flow_respond_interaction", "dev_flow_resolve_decision", "dev_flow_resolve_grill_decision", "dev_flow_resolve_review_risk_acceptance", "dev_flow_feature_check", "dev_flow_switch_active"]) {
    assert.equal(names.has(removed), false, `${removed} must not be public in v5`);
  }
  const answer = tools.find((tool) => tool.name === "dev_flow_answer");
  assert.equal("promptEventId" in answer.inputSchema.properties, false);
  assert.equal("fallbackToken" in answer.inputSchema.properties, false);
  const approval = tools.find((tool) => tool.name === "dev_flow_present_approval");
  assert.equal("approvalId" in approval.inputSchema.properties, false);
});

test("v5 governance tools record_repository_fact / revise_decision / revise_plan / validate_plan are exposed; host seam stays hidden", async () => {
  const tools = await toolDefinitions();
  const names = new Set(tools.map((tool) => tool.name));
  for (const expected of [
    "dev_flow_record_repository_fact",
    "dev_flow_record_repository_facts",
    "dev_flow_revise_decision",
    "dev_flow_revise_plan",
    "dev_flow_validate_plan",
  ]) {
    assert.equal(names.has(expected), true,
      `${expected} must be exposed via tools/list: lock_classification requires basis factRefs registered through record_repository_fact`);
  }
  assert.equal(names.has("dev_flow_record_review_execution_event"), false,
    "record_review_execution_event is a host adapter seam for subagent reviews and must stay hidden from the agent tool surface");
});
