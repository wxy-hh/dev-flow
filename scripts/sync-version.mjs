import { readFile, writeFile } from "node:fs/promises";
import { access } from "node:fs/promises";
import { constants } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const args = process.argv.slice(2);
const mode = args.includes("--write") ? "write" : args.includes("--check") ? "check" : undefined;
const rootIndex = args.indexOf("--root");
const repositoryRoot = rootIndex >= 0
  ? path.resolve(args[rootIndex + 1] ?? "")
  : path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

if (!mode || (rootIndex >= 0 && !args[rootIndex + 1])) {
  throw new Error("usage: node scripts/sync-version.mjs --write|--check [--root <path>]");
}

const packagePath = path.join(repositoryRoot, "package.json");
const packageJson = JSON.parse(await readFile(packagePath, "utf8"));
const version = packageJson.version;
if (typeof version !== "string" || !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.test(version)) {
  throw new Error(`package.json version must be strict semver; received ${String(version)}`);
}

const manifestPaths = [
  path.join(repositoryRoot, "plugins", "dev-flow", ".claude-plugin", "plugin.json"),
  path.join(repositoryRoot, "plugins", "dev-flow", ".codex-plugin", "plugin.json"),
];

if (mode === "write") {
  for (const manifestPath of manifestPaths) {
    const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
    manifest.version = version;
    await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  }
  process.stdout.write(`synchronized manifests to ${version}\n`);
  process.exit(0);
}

for (const manifestPath of manifestPaths) {
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  if (manifest.version !== version) {
    throw new Error(`${path.relative(repositoryRoot, manifestPath)} has version ${String(manifest.version)}; expected ${version}`);
  }
}

for (const name of ["mcp-server.mjs", "claude-hook.mjs", "codex-hook.mjs"]) {
  const distPath = path.join(repositoryRoot, "plugins", "dev-flow", "dist", name);
  try {
    await access(distPath, constants.R_OK);
  } catch {
    throw new Error(`${path.relative(repositoryRoot, distPath)} is missing; run npm run build`);
  }
  const contents = await readFile(distPath, "utf8");
  if (!contents.includes(`dev-flow ${version}; built from source, deterministic build`)) {
    throw new Error(`${path.relative(repositoryRoot, distPath)} does not contain version ${version}; run npm run build`);
  }
}

process.stdout.write(`version check passed for ${version}\n`);
