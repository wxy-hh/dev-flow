import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { cp, mkdtemp, rm, writeFile } from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { installedPluginRoot, isolatedHostEnvironment, run } from "./host-runner.mjs";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const marketplace = "dev-flow-marketplace";

function availablePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      server.close((error) => error ? reject(error) : resolve(address.port));
    });
  });
}

async function startGitMarketplace(basePath, bareName) {
  const port = await availablePort();
  const child = spawn("python3", ["-m", "http.server", String(port), "--bind", "127.0.0.1", "--directory", basePath], { stdio: "ignore" });
  const source = `http://127.0.0.1:${port}/${bareName}`;
  for (let attempt = 0; attempt < 20; attempt += 1) {
    try { await run("git", ["ls-remote", source], { timeout: 2_000 }); return { source, stop: () => child.kill("SIGTERM") }; }
    catch { await new Promise((resolve) => setTimeout(resolve, 50)); }
  }
  child.kill("SIGTERM");
  throw new Error("local Git marketplace HTTP server did not become ready");
}

export async function installNativeHosts() {
  const temp = await mkdtemp(path.join(os.tmpdir(), "dev-flow-native-hosts-"));
  const marketplaceSource = path.join(temp, "marketplace");
  await cp(repositoryRoot, marketplaceSource, { recursive: true, filter: (source) => !source.split(path.sep).includes("node_modules") && !source.split(path.sep).includes(".git") });
  await run("git", ["init", "--initial-branch=main"], { cwd: marketplaceSource });
  await run("git", ["config", "user.email", "release-smoke@dev-flow.invalid"], { cwd: marketplaceSource });
  await run("git", ["config", "user.name", "Dev Flow release smoke"], { cwd: marketplaceSource });
  await run("git", ["add", "."], { cwd: marketplaceSource });
  await run("git", ["commit", "-m", "marketplace snapshot"], { cwd: marketplaceSource });
  const bareName = "marketplace.git";
  const bareMarketplace = path.join(temp, bareName);
  await run("git", ["init", "--bare", bareMarketplace]);
  await run("git", ["remote", "add", "release-smoke", bareMarketplace], { cwd: marketplaceSource });
  await run("git", ["push", "release-smoke", "main"], { cwd: marketplaceSource });
  await run("git", ["--git-dir", bareMarketplace, "symbolic-ref", "HEAD", "refs/heads/main"]);
  await run("git", ["--git-dir", bareMarketplace, "update-server-info"]);
  const gitMarketplace = await startGitMarketplace(temp, bareName);
  const claudeHome = path.join(temp, "claude-home");
  const codexHome = path.join(temp, "codex-home");
  const claudeEnv = await isolatedHostEnvironment(claudeHome);
  const codexEnv = await isolatedHostEnvironment(codexHome);
  const claude = process.env.CLAUDE_BIN ?? "claude";
  const codex = process.env.CODEX_BIN ?? "codex";
  await run(claude, ["plugin", "marketplace", "add", marketplaceSource], { env: claudeEnv });
  await run(claude, ["plugin", "install", `dev-flow@${marketplace}`], { env: claudeEnv });
  await run(codex, ["plugin", "marketplace", "add", gitMarketplace.source], { env: codexEnv });
  await run(codex, ["plugin", "add", `dev-flow@${marketplace}`], { env: codexEnv });
  const claudeRoot = await installedPluginRoot(claudeHome, ".claude-plugin");
  const codexRoot = await installedPluginRoot(codexHome, ".codex-plugin");
  assert.notEqual(claudeRoot, repositoryRoot, "Claude must execute its marketplace-installed plugin copy");
  assert.notEqual(codexRoot, repositoryRoot, "Codex must execute its marketplace-installed plugin copy");
  return {
    claude, codex, claudeEnv, codexEnv, claudeRoot, codexRoot, marketplaceSource, bareMarketplace,
    cleanup: async () => { gitMarketplace.stop(); await rm(temp, { recursive: true, force: true }); },
  };
}

export async function exerciseNativeUpgrade(hosts) {
  await writeFile(path.join(hosts.marketplaceSource, ".release-smoke-upgrade"), "new marketplace snapshot\n");
  await run("git", ["add", ".release-smoke-upgrade"], { cwd: hosts.marketplaceSource });
  await run("git", ["commit", "-m", "upgrade marketplace snapshot"], { cwd: hosts.marketplaceSource });
  await run("git", ["push", "release-smoke", "main"], { cwd: hosts.marketplaceSource });
  await run("git", ["--git-dir", hosts.bareMarketplace, "update-server-info"]);
  await run(hosts.claude, ["plugin", "marketplace", "update", marketplace], { env: hosts.claudeEnv });
  await run(hosts.claude, ["plugin", "update", `dev-flow@${marketplace}`], { env: hosts.claudeEnv });
  await run(hosts.codex, ["plugin", "marketplace", "upgrade", marketplace], { env: hosts.codexEnv });
  // Codex refreshes a marketplace snapshot, then the native add command applies it.
  await run(hosts.codex, ["plugin", "add", `dev-flow@${marketplace}`], { env: hosts.codexEnv });
}
