import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import path from "node:path";
import test from "node:test";

function request(messages) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [path.resolve("plugins/dev-flow/dist/mcp-server.mjs")], { stdio: ["pipe", "pipe", "pipe"] });
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
  // tools/call keeps CallToolResult content shape
  assert.equal(responses[2].error.data.code, "UNKNOWN_TOOL");
});
