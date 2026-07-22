import assert from "node:assert/strict";
import { cp, mkdtemp, readFile, rm } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const expectedClaudeCommand = "node \"${CLAUDE_PLUGIN_ROOT}/dist/claude-hook.mjs\"";

test("Claude hook uses the canonical quoted plugin-root command", async () => {
  const hooksPath = path.join(root, "plugins/dev-flow/hosts/claude/hooks.json");
  const hooks = JSON.parse(await readFile(hooksPath, "utf8"));
  for (const groups of Object.values(hooks.hooks)) {
    assert.equal(groups[0].hooks[0].command, expectedClaudeCommand);
  }
});

test("Claude command works when plugin root includes spaces", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "dev flow plugin root "));
  try {
    const pluginRoot = path.join(tempRoot, "plugin with spaces");
    await cp(path.join(root, "plugins/dev-flow/dist"), path.join(pluginRoot, "dist"), { recursive: true });
    const command = expectedClaudeCommand.replace("${CLAUDE_PLUGIN_ROOT}", pluginRoot);
    const fixture = await readFile(path.join(root, "tests/fixtures/hooks/claude-plugin-root-with-spaces.json"), "utf8");
    const result = spawnSync(command, { shell: true, input: fixture, encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(JSON.parse(result.stdout), { continue: true });
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("Codex MCP and hook paths use PLUGIN_ROOT", async () => {
  const mcp = JSON.parse(await readFile(path.join(root, "plugins/dev-flow/.mcp.json"), "utf8"));
  const hooks = JSON.parse(await readFile(path.join(root, "plugins/dev-flow/hosts/codex/hooks.json"), "utf8"));
  assert.equal(mcp.mcpServers["dev-flow"].args[0], "${PLUGIN_ROOT}/dist/mcp-server.mjs");
  for (const groups of Object.values(hooks.hooks)) {
    assert.equal(groups[0].hooks[0].command, "node \"${PLUGIN_ROOT}/dist/codex-hook.mjs\"");
  }
});
