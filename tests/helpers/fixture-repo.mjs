import { cp, mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const fixtureRoot = path.join(repositoryRoot, "tests", "fixtures", "tiny-app");

export const strictProjectConfig = {
  schemaVersion: 1,
  verification: {
    commands: [{ id: "unit", command: process.execPath, args: ["--test", "test/counter.test.js"], cwd: "." }],
    behaviorCommands: [],
  },
  enforcement: { mode: "strict", gitWriteRequiresLogicComplete: true, oneActiveFeature: true, requireExplicitHumanReply: true },
  protectedRoots: ["src", "test"],
};

export async function createTinyApp() {
  const root = await mkdtemp(path.join(os.tmpdir(), "dev-flow-tiny-app-"));
  await cp(fixtureRoot, root, { recursive: true });
  return { root, dispose: () => rm(root, { recursive: true, force: true }) };
}
