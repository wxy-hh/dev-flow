import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

const run = promisify(execFile);
const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const temporaryDist = await mkdtemp(path.join(os.tmpdir(), "dev-flow-dist-check-"));
const names = ["mcp-server.mjs", "claude-hook.mjs", "codex-hook.mjs"];

try {
  await run(process.execPath, [path.join(repositoryRoot, "scripts", "build.mjs")], {
    cwd: repositoryRoot,
    env: { ...process.env, DEV_FLOW_DIST_DIR: temporaryDist },
  });
  for (const name of names) {
    const [expected, actual] = await Promise.all([
      readFile(path.join(temporaryDist, name)),
      readFile(path.join(repositoryRoot, "plugins", "dev-flow", "dist", name)),
    ]);
    assert.deepEqual(actual, expected, `plugins/dev-flow/dist/${name} is stale; run npm run build`);
  }
} finally {
  await rm(temporaryDist, { recursive: true, force: true });
}
