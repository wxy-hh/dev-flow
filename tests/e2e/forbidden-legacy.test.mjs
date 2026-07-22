import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

function listPaths(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    if (entry.name === ".git" || entry.name === "node_modules") return [];
    const entryPath = path.join(directory, entry.name);
    return entry.isDirectory()
      ? [entryPath, ...listPaths(entryPath)]
      : [entryPath];
  });
}

test("repository has only plugin distribution surfaces, not legacy injection surfaces", () => {
  assert.equal(existsSync(path.join(root, ".claude")), false);
  assert.equal(existsSync(path.join(root, "templates", "CLAUDE.dev-flow-snippet.md")), false);
  assert.equal(existsSync(path.join(root, "plugins", "dev-flow", "dev-flow-upgrade")), false);

  const paths = listPaths(root).map((entry) => path.relative(root, entry));
  assert.equal(paths.some((entry) => entry.includes("project-workflow.md")), false);
  assert.equal(paths.some((entry) => entry.includes("dev-flow-upgrade")), false);
});

test("prebuilt plugin entry points are present", () => {
  for (const name of ["mcp-server.mjs", "claude-hook.mjs", "codex-hook.mjs"]) {
    assert.equal(existsSync(path.join(root, "plugins", "dev-flow", "dist", name)), true, name);
  }
});

test("prebuilt plugin bundles are release assets rather than ignored build output", () => {
  const result = spawnSync("git", ["check-ignore", "plugins/dev-flow/dist/mcp-server.mjs"], { encoding: "utf8" });
  assert.notEqual(result.status, 0, result.stdout);
});
