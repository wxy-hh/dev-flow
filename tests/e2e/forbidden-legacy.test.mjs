import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
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
  // Root .claude/ is the repo's own dev config (settings, skills) and may exist;
  // it must not contain legacy injection artifacts, though.
  const claudeRoot = path.join(root, ".claude");
  if (existsSync(claudeRoot)) {
    const claudePaths = listPaths(claudeRoot).map((entry) => path.relative(root, entry));
    assert.equal(
      claudePaths.some(
        (entry) => entry.includes("project-workflow.md") || entry.includes("dev-flow-upgrade") || entry.includes("CLAUDE.dev-flow-snippet.md"),
      ),
      false,
      ".claude must not contain legacy injection artifacts",
    );
  }
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

test("v2 runtime surfaces contain no removed route or gate vocabulary", () => {
  const scanRoots = [
    path.join(root, "plugins", "dev-flow", "src"),
    path.join(root, "plugins", "dev-flow", "policy"),
    path.join(root, "plugins", "dev-flow", "skills"),
    path.join(root, "docs", "routes.md"),
    path.join(root, "docs", "architecture.md"),
    path.join(root, "README.md"),
  ];
  const forbidden = /risk-minimal|risk_review|risk_controls|risk-card|requirement_confirmation|implementation_approval|execution_approval|dev_flow_present_gate|dev_flow_confirm_gate|gate-approval|gate-basis/g;
  const hits = [];
  for (const target of scanRoots) {
    const files = target.endsWith(".md") ? [target] : (existsSync(target) ? listPaths(target).filter((file) => !requireDirectory(file)) : []);
    for (const file of files) {
      const content = readFileSync(file, "utf8");
      if (forbidden.test(content)) hits.push(path.relative(root, file));
      forbidden.lastIndex = 0;
    }
  }
  assert.deepEqual(hits, []);
});

function requireDirectory(file) {
  try { return statSync(file).isDirectory(); } catch { return false; }
}

test("prebuilt plugin bundles are release assets rather than ignored build output", () => {
  const result = spawnSync("git", ["check-ignore", "plugins/dev-flow/dist/mcp-server.mjs"], { encoding: "utf8" });
  assert.notEqual(result.status, 0, result.stdout);
});
