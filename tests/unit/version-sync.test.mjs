import assert from "node:assert/strict";
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const script = path.join(root, "scripts", "sync-version.mjs");

function run(rootPath) {
  return spawnSync(process.execPath, [script, "--check", "--root", rootPath], {
    encoding: "utf8",
  });
}

test("version check accepts synchronized root, manifests, and bundles", () => {
  const result = run(root);
  assert.equal(result.status, 0, result.stderr);
});

test("version check rejects a manifest drift", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "dev-flow-version-"));
  try {
    await cp(path.join(root, "package.json"), path.join(tempRoot, "package.json"));
    for (const relative of [
      "plugins/dev-flow/.claude-plugin/plugin.json",
      "plugins/dev-flow/.codex-plugin/plugin.json",
      "plugins/dev-flow/dist",
    ]) {
      const source = path.join(root, relative);
      const target = path.join(tempRoot, relative);
      await cp(source, target, { recursive: true });
    }
    const manifestPath = path.join(tempRoot, "plugins/dev-flow/.codex-plugin/plugin.json");
    const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
    manifest.version = "9.9.9";
    await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
    const result = run(tempRoot);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /expected 1\.0\.0/);
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});
