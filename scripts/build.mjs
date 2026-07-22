import { build } from "esbuild";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const packageJson = JSON.parse(
  await readFile(path.join(repositoryRoot, "package.json"), "utf8"),
);
const pluginRoot = path.join(repositoryRoot, "plugins", "dev-flow");
const version = packageJson.version;

const entries = [
  ["mcp-server", path.join(pluginRoot, "src", "mcp", "server.ts")],
  ["claude-hook", path.join(pluginRoot, "src", "hosts", "claude-adapter.ts")],
  ["codex-hook", path.join(pluginRoot, "src", "hosts", "codex-adapter.ts")],
];

await Promise.all(
  entries.map(async ([name, entryPoint]) =>
    build({
      entryPoints: [entryPoint],
      outfile: path.join(pluginRoot, "dist", `${name}.mjs`),
      bundle: true,
      platform: "node",
      target: "node20",
      format: "esm",
      packages: "bundle",
      sourcemap: false,
      banner: {
        js: `/* dev-flow ${version}; built from source, deterministic build */`,
      },
      define: {
        __DEV_FLOW_VERSION__: JSON.stringify(version),
      },
    }),
  ),
);
