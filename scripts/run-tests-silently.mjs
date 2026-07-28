import { readdir } from "node:fs/promises";
import { spawn } from "node:child_process";
import path from "node:path";

const mode = process.argv[2];
const testDirectories = {
  unit: ["tests/unit"],
  routes: ["tests/e2e/routes"],
  interop: ["tests/e2e/cross-host"],
  e2e: ["tests/e2e"],
};

async function collectTests(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await collectTests(file));
    else if (entry.isFile() && entry.name.endsWith(".test.mjs")) files.push(file);
  }
  return files;
}

if (mode !== "host-e2e" && !Object.hasOwn(testDirectories, mode)) {
  throw new Error("usage: node scripts/run-tests-silently.mjs <unit|routes|interop|e2e|host-e2e>");
}

const args = mode === "host-e2e"
  ? ["scripts/run-host-e2e.mjs"]
  : ["--test", ...(await Promise.all(testDirectories[mode].map(collectTests))).flat()];
if (mode !== "host-e2e" && args.length === 1) throw new Error(`no test files found for ${mode}`);

const exitCode = await new Promise((resolve) => {
  const child = spawn(process.execPath, args, {
    stdio: "inherit",
    env: { ...process.env, DEV_FLOW_DISABLE_ATTENTION: "1", NODE_ENV: "test" },
  });
  child.once("error", (error) => {
    console.error(error);
    resolve(1);
  });
  child.once("close", (code, signal) => resolve(code ?? (signal ? 1 : 0)));
});
process.exitCode = exitCode;
