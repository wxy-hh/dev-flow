import { execFile } from "node:child_process";
import { cp, mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const fixtureRoot = path.join(repositoryRoot, "tests", "fixtures", "tiny-app");
const run = promisify(execFile);

export const strictProjectConfig = {
  schemaVersion: 2,
  verification: {
    commands: [{ id: "unit", command: process.execPath, args: ["--test", "test/counter.test.js"], cwd: ".", provides: ["targeted", "behavior", "integration", "full"] }]
  },
  enforcement: { mode: "strict", gitWriteRequiresLogicComplete: true, oneActiveFeature: true, requireExplicitHumanReply: true },
  governedRoots: ["src", "test"],
};

export async function createTinyApp() {
  const root = await mkdtemp(path.join(os.tmpdir(), "dev-flow-tiny-app-"));
  await cp(fixtureRoot, root, { recursive: true });
  await run("git", ["init", "--quiet"], { cwd: root });
  await run("git", ["add", "."], { cwd: root });
  await run("git", ["-c", "user.name=Dev Flow Tests", "-c", "user.email=tests@example.invalid", "commit", "--quiet", "-m", "fixture baseline"], { cwd: root });
  return { root, dispose: () => rm(root, { recursive: true, force: true }) };
}
