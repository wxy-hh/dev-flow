import { execFile } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const run = promisify(execFile);

/** Build MCP test bundles outside the repository so source tests never overwrite dist/. */
export async function buildTestBundles() {
  const directory = await mkdtemp(path.join(os.tmpdir(), "dev-flow-dist-"));
  await run(process.execPath, ["scripts/build.mjs"], {
    cwd: path.resolve("."),
    env: { ...process.env, DEV_FLOW_DIST_DIR: directory },
  });
  return {
    pathFor: (name) => path.join(directory, `${name}.mjs`),
    dispose: () => rm(directory, { recursive: true, force: true }),
  };
}
