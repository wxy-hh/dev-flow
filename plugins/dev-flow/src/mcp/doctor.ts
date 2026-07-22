import { access, readFile } from "node:fs/promises";
import path from "node:path";
import { readProjectConfig, readState } from "../core/state-store.js";

type Status = "ok" | "error" | "warning";
type Diagnostic = { code: string; status: Status; message: string };

async function readable(file: string): Promise<boolean> {
  try { await access(file); return true; } catch { return false; }
}

async function validJson(file: string): Promise<boolean> {
  try { JSON.parse(await readFile(file, "utf8")); return true; } catch { return false; }
}

export async function collectDoctorReport(root: string, pluginRoot: string, version: string, tools: string[]) {
  const diagnostics: Diagnostic[] = [];
  const add = (code: string, status: Status, message: string) => diagnostics.push({ code, status, message });
  const projectFile = path.join(root, ".dev-flow", "project.json");
  let project: { initialized: boolean; valid: boolean } = { initialized: await readable(projectFile), valid: false };
  if (!project.initialized) add("PROJECT_NOT_INITIALIZED", "warning", "run dev_flow_init_project before starting a feature");
  else {
    try { await readProjectConfig(root); project.valid = true; add("PROJECT_CONFIG_VALID", "ok", "strict project configuration is valid"); }
    catch (error) { add("PROJECT_CONFIG_INVALID", "error", error instanceof Error ? error.message : String(error)); }
  }

  const activeFile = path.join(root, ".dev-flow", "active.json");
  let activeFeature: { present: boolean; featureId?: string; valid: boolean } = { present: await readable(activeFile), valid: false };
  if (activeFeature.present) {
    try {
      const active = JSON.parse(await readFile(activeFile, "utf8")) as { featureId?: string };
      if (!active.featureId) throw new Error("active feature id is missing");
      const state = await readState(root, active.featureId);
      activeFeature = { present: true, featureId: state.featureId, valid: state.lifecycle === "active" };
      add(activeFeature.valid ? "ACTIVE_FEATURE_VALID" : "ACTIVE_FEATURE_INVALID", activeFeature.valid ? "ok" : "error", activeFeature.valid ? `active feature ${state.featureId} is valid` : `active feature ${state.featureId} is not active`);
    } catch (error) { add("ACTIVE_FEATURE_INVALID", "error", error instanceof Error ? error.message : String(error)); }
  } else add("NO_ACTIVE_FEATURE", "ok", "no active feature is recorded");

  const paths = {
    claudeManifest: path.join(pluginRoot, ".claude-plugin", "plugin.json"),
    codexManifest: path.join(pluginRoot, ".codex-plugin", "plugin.json"),
    mcp: path.join(pluginRoot, ".mcp.json"),
    claudeHooks: path.join(pluginRoot, "hosts", "claude", "hooks.json"),
    codexHooks: path.join(pluginRoot, "hosts", "codex", "hooks.json"),
    mcpBundle: path.join(pluginRoot, "dist", "mcp-server.mjs"),
    claudeBundle: path.join(pluginRoot, "dist", "claude-hook.mjs"),
    codexBundle: path.join(pluginRoot, "dist", "codex-hook.mjs"),
  };
  const files = await Promise.all(Object.entries(paths).map(async ([name, file]) => [name, await readable(file)] as const));
  const missing = files.filter(([, exists]) => !exists).map(([name]) => name);
  add(missing.length ? "PLUGIN_FILES_MISSING" : "PLUGIN_FILES_PRESENT", missing.length ? "error" : "ok", missing.length ? `missing plugin files: ${missing.join(", ")}` : "manifests, hooks, MCP configuration and bundles are present");
  const jsonFiles = [paths.claudeManifest, paths.codexManifest, paths.mcp, paths.claudeHooks, paths.codexHooks];
  const invalidJson = (await Promise.all(jsonFiles.map(async (file) => !(await validJson(file))))).some(Boolean);
  add(invalidJson ? "PLUGIN_WIRING_INVALID" : "PLUGIN_WIRING_VALID", invalidJson ? "error" : "ok", invalidJson ? "a manifest, MCP file, or hook file is not valid JSON" : "plugin manifest, MCP and hook wiring parse successfully");

  return { version, root, pluginRoot, tools, project, activeFeature, mcp: { server: "running", configuration: !invalidJson }, diagnostics };
}
