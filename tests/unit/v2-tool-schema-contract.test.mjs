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

test("dev_flow_classify keeps its either-or branches under a top-level object schema", async () => {
  const tools = await toolDefinitions();
  const classify = tools.find((tool) => tool.name === "dev_flow_classify");
  assert.ok(classify, "dev_flow_classify must be present");
  assert.equal(classify.inputSchema.type, "object");
  assert.ok(Array.isArray(classify.inputSchema.oneOf), "classify must keep its oneOf branches");
  assert.equal(classify.inputSchema.oneOf.length, 2);
  for (const branch of classify.inputSchema.oneOf) {
    assert.equal(branch.type, "object", "each classify branch must be an object schema");
    assert.ok(Array.isArray(branch.required), "each classify branch must declare required");
  }
});
