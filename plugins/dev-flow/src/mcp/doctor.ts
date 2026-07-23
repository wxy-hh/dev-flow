import { lstat, readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { readProjectConfig, readState, readActive, readRecoveryTransaction, stateFileSha256 } from "../core/state-store.js";

type Status = "ok" | "error" | "warning";
type Diagnostic = { code: string; status: Status; message: string; recoveryHint?: string };

async function readable(file: string): Promise<boolean> {
  try { await lstat(file); return true; } catch { return false; }
}

async function validJson(file: string): Promise<boolean> {
  try { JSON.parse(await readFile(file, "utf8")); return true; } catch { return false; }
}

async function pointerRecoveryCandidates(root: string): Promise<Array<{ featureId: string; stateSha256?: string }>> {
  try {
    const directory = path.join(root, ".dev-flow", "features");
    const entries = await readdir(directory, { withFileTypes: true });
    return await Promise.all(entries.filter((entry) => entry.isDirectory()).map(async (entry) => {
      let stateSha256: string | undefined;
      try { stateSha256 = await stateFileSha256(root, entry.name); } catch { /* report feature id without a digest */ }
      return { featureId: entry.name, ...(stateSha256 ? { stateSha256 } : {}) };
    }));
  } catch { return []; }
}

export async function collectDoctorReport(root: string, pluginRoot: string, version: string, tools: string[]) {
  const diagnostics: Diagnostic[] = [];
  const add = (code: string, status: Status, message: string, recoveryHint?: string) =>
    diagnostics.push({ code, status, message, ...(recoveryHint ? { recoveryHint } : {}) });

  const projectFile = path.join(root, ".dev-flow", "project.json");
  let project: { initialized: boolean; valid: boolean } = { initialized: await readable(projectFile), valid: false };
  if (!project.initialized) add("PROJECT_NOT_INITIALIZED", "warning", "run dev_flow_init_project before starting a feature");
  else {
    try { await readProjectConfig(root); project.valid = true; add("PROJECT_CONFIG_VALID", "ok", "strict project configuration is valid"); }
    catch (error) { add("PROJECT_CONFIG_INVALID", "error", error instanceof Error ? error.message : String(error)); }
  }

  const activeFile = path.join(root, ".dev-flow", "active.json");
  let activeFeature: {
    present: boolean;
    featureId?: string;
    valid: boolean;
    corrupt?: boolean;
    stateSha256?: string;
    recoveryAction?: string;
  } = { present: await readable(activeFile), valid: false };

  let corruptFeature: {
    featureId: string;
    stateSha256: string;
    recommendedAction: "abandon";
    recoveryHint: string;
  } | undefined;
  let corruptActivePointer: {
    activeSha256: string;
    candidates: Array<{ featureId: string; stateSha256?: string }>;
    recoveryHint: string;
  } | undefined;

  if (activeFeature.present) {
    try {
      const active = await readActive(root);
      if (!active?.featureId) throw new Error("active feature id is missing");
      try {
        const state = await readState(root, active.featureId);
        activeFeature = { present: true, featureId: state.featureId, valid: state.lifecycle === "active" };
        add(
          activeFeature.valid ? "ACTIVE_FEATURE_VALID" : "ACTIVE_FEATURE_INVALID",
          activeFeature.valid ? "ok" : "error",
          activeFeature.valid ? `active feature ${state.featureId} is valid` : `active feature ${state.featureId} is not active`,
        );
      } catch (error) {
        let digest: string | undefined;
        try { digest = await stateFileSha256(root, active.featureId); } catch { /* missing */ }
        if (!digest) {
          try {
            const raw = await readFile(path.join(root, ".dev-flow", "features", active.featureId, "state.json"));
            digest = createHash("sha256").update(raw).digest("hex");
          } catch { digest = undefined; }
        }
        activeFeature = {
          present: true,
          featureId: active.featureId,
          valid: false,
          corrupt: true,
          stateSha256: digest,
          recoveryAction: "abandon",
        };
        const message = error instanceof Error ? error.message : String(error);
        add("ACTIVE_FEATURE_CORRUPT", "error", message, "Call dev_flow_recover_corrupt_feature with stateSha256, reason, and userEvidence");
        if (digest) {
          corruptFeature = {
            featureId: active.featureId,
            stateSha256: digest,
            recommendedAction: "abandon",
            recoveryHint: "User must explicitly agree to abandon; then start a new feature. Do not hand-edit state.json.",
          };
        }
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if ((error as { code?: string }).code === "ACTIVE_POINTER_UNREADABLE") {
        let activeSha256: string | undefined;
        try { activeSha256 = createHash("sha256").update(await readFile(activeFile)).digest("hex"); } catch { /* already reported as unreadable */ }
        activeFeature = { present: true, valid: false, corrupt: true, recoveryAction: "abandon" };
        add("ACTIVE_POINTER_CORRUPT", "error", message, "Choose a doctor-reported feature and call dev_flow_recover_corrupt_feature with activeSha256, stateSha256, reason, and userEvidence");
        if (activeSha256) {
          corruptActivePointer = {
            activeSha256,
            candidates: await pointerRecoveryCandidates(root),
            recoveryHint: "User must explicitly select one candidate feature to abandon. Recovery backs up active.json and the selected feature; it never guesses.",
          };
        }
      } else add("ACTIVE_FEATURE_INVALID", "error", message);
    }
  } else add("NO_ACTIVE_FEATURE", "ok", "no active feature is recorded");

  let recoveryTxn: Awaited<ReturnType<typeof readRecoveryTransaction>>;
  try { recoveryTxn = await readRecoveryTransaction(root); }
  catch (error) { add("RECOVERY_TRANSACTION_UNREADABLE", "error", error instanceof Error ? error.message : String(error), "Do not start a feature or hand-edit .dev-flow; recovery remains fail-closed"); }
  if (recoveryTxn) add(
    "RECOVERY_TRANSACTION_OPEN",
    "error",
    `open recovery transaction phase=${String(recoveryTxn.phase)} featureId=${String(recoveryTxn.featureId ?? "")}`,
    "Re-run dev_flow_recover_corrupt_feature with the same doctor-reported input to resume the next safe journal phase",
  );

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

  return {
    version, root, pluginRoot, tools, project, activeFeature, corruptFeature, corruptActivePointer,
    recoveryTransaction: recoveryTxn ?? null,
    mcp: { server: "running", configuration: !invalidJson },
    diagnostics,
  };
}
