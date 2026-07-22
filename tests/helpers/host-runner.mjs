import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { access, mkdir, readdir } from "node:fs/promises";
import path from "node:path";

export const hostE2EEnabled = process.env.HOST_E2E === "1";

export async function isolatedHostEnvironment(home) {
  await Promise.all([mkdir(home, { recursive: true }), mkdir(path.join(home, ".cache"), { recursive: true }), mkdir(path.join(home, ".config"), { recursive: true })]);
  return { ...process.env, HOME: home, XDG_CACHE_HOME: path.join(home, ".cache"), XDG_CONFIG_HOME: path.join(home, ".config"), CI: "1" };
}

export function run(command, args, { cwd, env, input, timeout = 90_000 } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, env, stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "", stderr = "";
    const timer = setTimeout(() => { child.kill("SIGTERM"); reject(new Error(`${command} timed out after ${timeout}ms`)); }, timeout);
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("error", (error) => { clearTimeout(timer); reject(error); });
    child.on("close", (code) => { clearTimeout(timer); code === 0 ? resolve({ stdout, stderr }) : reject(new Error(`${command} ${args.join(" ")} exited ${code}: ${stderr || stdout}`)); });
    child.stdin.end(input ?? "");
  });
}

export async function mcpCall(serverPath, cwd, name, arguments_ = {}) {
  const response = await run(process.execPath, [serverPath], {
    cwd,
    input: `${JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: arguments_ } })}\n`,
  });
  const message = JSON.parse(response.stdout.trim());
  if (message.error) throw Object.assign(new Error(message.error.data?.message ?? message.error.message), { code: message.error.data?.code });
  return message.result.structuredContent;
}

export async function invokeHook(hookPath, cwd, event) {
  const response = await run(process.execPath, [hookPath], { cwd, input: `${JSON.stringify({ cwd, ...event })}\n` });
  return JSON.parse(response.stdout.trim());
}

async function descendants(directory, predicate, matches = [], depth = 0) {
  if (depth > 8) return matches;
  let entries = [];
  try { entries = await readdir(directory, { withFileTypes: true }); } catch { return matches; }
  for (const entry of entries) {
    const candidate = path.join(directory, entry.name);
    if (entry.isDirectory()) await descendants(candidate, predicate, matches, depth + 1);
    else if (predicate(entry.name, candidate)) matches.push(candidate);
  }
  return matches;
}

export async function installedPluginRoot(home, manifestDirectory) {
  const manifests = await descendants(home, (name, candidate) => name === "plugin.json" && path.basename(path.dirname(candidate)) === manifestDirectory);
  assert.ok(manifests.length, `no installed ${manifestDirectory} plugin manifest under ${home}`);
  const candidates = manifests.map((manifest) => path.dirname(path.dirname(manifest)));
  for (const candidate of candidates) {
    try { await access(path.join(candidate, "dist", "mcp-server.mjs")); return candidate; } catch { /* marketplace staging directories are not executable installs */ }
  }
  throw new Error(`no executable ${manifestDirectory} plugin bundle under ${home}; candidates: ${candidates.join(", ")}`);
}
