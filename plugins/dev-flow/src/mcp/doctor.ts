import { lstat, readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { reviewEnforcementRequired, traceEnforcementRequired } from "../policy/contract.js";
import { listOrphanTraceSnapshots, readTraceability } from "../core/traceability-store.js";
import { listOrphanReviewSnapshots, readReviewLedger } from "../core/review-store.js";
import { readHostHealth } from "../core/host-health.js";
import { assertActivePointerConsistent, readProjectConfig, readState, readActive, readRecoveryTransaction, readFeatureEvents, stateFileSha256, type FeatureState } from "../core/state-store.js";
import { readRollbackTransaction, rollbackTransactionFinished, type RollbackTransaction } from "../core/rollback-journal.js";
import { pendingDecisionForState } from "../core/decision-interactions.js";
import { gitBranchAndHead, isAncestor } from "../core/git-reconciliation.js";

type Status = "ok" | "error" | "warning";
type Diagnostic = { code: string; status: Status; message: string; recoveryHint?: string };

function projectActiveWorkflow(state: FeatureState): {
  mode: FeatureState["mode"];
  stage?: string;
  pendingDecision?: { kind: string; question: string };
  nextStep: string;
} {
  let pending: { kind: string; question: string } | undefined;
  let pendingUnreadable = false;
  try {
    const decision = pendingDecisionForState(state);
    if (decision) pending = { kind: decision.kind, question: decision.question };
  } catch {
    pendingUnreadable = true;
  }
  const nextStep = pendingUnreadable
    ? "待决问题不可读，查看 dev_flow_status"
    : pending
      ? `回答待决问题：${pending.question}`
      : state.mode === "intake"
        ? "完成调查后调用 dev_flow_lock_classification"
        : state.mode === "routed"
          ? "详情看 dev_flow_status"
          : "查看 dev_flow_status";
  return {
    mode: state.mode,
    ...(state.mode === "routed" && state.currentStage ? { stage: state.currentStage } : {}),
    ...(pending ? { pendingDecision: pending } : {}),
    nextStep,
  };
}

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

  const healthSignals = await readHostHealth(root);
  const now = Date.now();
  const hookHealth = (["claude", "codex"] as const).map((host) => {
    const latest = [...healthSignals].reverse().find((signal) => signal.host === host);
    const ageMs = latest ? Math.max(0, now - Date.parse(latest.at)) : undefined;
    const capability = (kinds: Array<(typeof healthSignals)[number]["kind"]>) => {
      const signal = [...healthSignals].reverse().find((candidate) => candidate.host === host && kinds.includes(candidate.kind));
      const capabilityAgeMs = signal ? Math.max(0, now - Date.parse(signal.at)) : undefined;
      const status = !signal ? "missing" : capabilityAgeMs! <= 15 * 60 * 1000 ? "healthy" : "stale";
      return { status, ...(signal ? { latest: signal } : {}), ...(capabilityAgeMs !== undefined ? { ageMs: capabilityAgeMs } : {}) };
    };
    const capabilities = {
      session: capability(["session-start"]),
      prompt: capability(["user-prompt-submit"]),
      tool: capability(["tool", "turn-boundary"]),
    };
    const capabilityStatuses = Object.values(capabilities).map((entry) => entry.status);
    const status = !latest ? "missing"
      : capabilityStatuses.every((entry) => entry === "healthy") ? "healthy"
        : capabilityStatuses.some((entry) => entry === "healthy") ? "partial" : "stale";
    if (status === "missing") add("HOOK_HEALTH_MISSING", "warning", `${host} hook 尚未记录 SessionStart/UserPromptSubmit 健康信号`, "确认对应宿主已安装并接线 Dev Flow hook，然后重新开启会话");
    else if (status === "stale") add("HOOK_HEALTH_STALE", "warning", `${host} hook 最近信号已过期`, "恢复宿主 hook 后重新开启会话并重试原操作；若有未知路径，再调用 dev_flow_reconcile_workspace");
    else if (status === "partial") add("HOOK_HEALTH_PARTIAL", "warning", `${host} hook 只有部分能力存在近期信号`, "触发一次用户消息和一次安全工具调用，确认各 hook 通道均已接线");
    else add("HOOK_HEALTH_HEALTHY", "ok", `${host} hook 当前健康`);
    if (capabilities.prompt.status === "missing") add("HOOK_PROMPT_HEALTH_MISSING", "warning", `${host} UserPromptSubmit 通道尚无可信信号`, "确认 UserPromptSubmit hook 已安装，发送一条用户消息后重新运行 doctor");
    else if (capabilities.prompt.status === "stale") add("HOOK_PROMPT_HEALTH_STALE", "warning", `${host} UserPromptSubmit 通道最近信号已过期`, "恢复 UserPromptSubmit hook，发送一条用户消息后重试文本回答");
    return { host, status, capabilities, ...(latest ? { latest } : {}), ...(ageMs !== undefined ? { ageMs } : {}) };
  });

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
    mode?: FeatureState["mode"];
    stage?: string;
    pendingDecision?: { kind: string; question: string };
    nextStep?: string;
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
  let traceState: FeatureState | undefined;

  if (activeFeature.present) {
    try {
      const active = await readActive(root);
      if (!active?.featureId) throw new Error("active feature id is missing");
      try {
        const state = await readState(root, active.featureId);
        await assertActivePointerConsistent(root);
        traceState = state;
        const projection = projectActiveWorkflow(state);
        activeFeature = {
          present: true,
          featureId: state.featureId,
          valid: state.lifecycle === "active",
          ...projection,
        };
        add(
          activeFeature.valid ? "ACTIVE_FEATURE_VALID" : "ACTIVE_FEATURE_INVALID",
          activeFeature.valid ? "ok" : "error",
          activeFeature.valid ? `active feature ${state.featureId} is valid` : `active feature ${state.featureId} is not active`,
        );
        add(
          "ACTIVE_FEATURE_STATE",
          "ok",
          `active feature ${state.featureId} 处于 ${projection.mode}${projection.pendingDecision ? "，有待决问题" : ""}；下一步：${projection.nextStep}。日常看 dev_flow_status，doctor 只是附带投影`,
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

  // Rollback transaction journals (one slot per feature, kept as audit after
  // completion). A non-terminal journal blocks every feature mutation, so the
  // doctor always surfaces it — with the resume input and, when blocked, the
  // two attempt groups (rollback verification vs compensation) from the event
  // ledger.
  const rollbackTransactions: Array<{
    featureId: string;
    transactionId: string;
    phase: RollbackTransaction["phase"];
    targetCheckpointId: string;
    undoOrder: string[];
    backupDirectory: string;
    blocked: boolean;
    error?: string;
    verificationAttemptIds: string[];
    compensationAttemptIds: string[];
  }> = [];
  try {
    const featuresDirectory = path.join(root, ".dev-flow", "features");
    const entries = await readdir(featuresDirectory, { withFileTypes: true });
    for (const entry of entries.filter((candidate) => candidate.isDirectory())) {
      let journal: RollbackTransaction | undefined;
      try {
        journal = await readRollbackTransaction(root, entry.name);
      } catch (error) {
        add(
          "ROLLBACK_TRANSACTION_UNREADABLE",
          "error",
          error instanceof Error ? error.message : String(error),
          "Do not hand-edit .dev-flow; the feature stays fail-closed while its rollback journal is unreadable",
        );
        continue;
      }
      if (!journal) continue;
      const current = journal;
      const finished = rollbackTransactionFinished(current);
      const blocked = !finished && typeof current.error === "string";
      const events = blocked ? await readFeatureEvents(root, entry.name).catch(() => []) : [];
      const attemptIds = (type: string) => events
        .filter((event) => event.type === type && (event.data as { transactionId?: string }).transactionId === current.transactionId)
        .map((event) => (event.data as { attemptId?: string }).attemptId)
        .filter((attemptId): attemptId is string => typeof attemptId === "string");
      rollbackTransactions.push({
        featureId: entry.name,
        transactionId: current.transactionId,
        phase: current.phase,
        targetCheckpointId: current.targetCheckpointId,
        undoOrder: [...current.undoOrder],
        backupDirectory: current.backupDirectory,
        blocked,
        ...(current.error ? { error: current.error } : {}),
        verificationAttemptIds: attemptIds("rollback-verification-attempt"),
        compensationAttemptIds: attemptIds("rollback-compensation-attempt"),
      });
      if (finished) {
        add("ROLLBACK_TRANSACTION_COMPLETED", "ok", `rollback transaction ${current.transactionId} finished phase=${current.phase} feature=${entry.name}`);
      } else if (blocked) {
        add(
          "ROLLBACK_RECOVERY_BLOCKED",
          "error",
          `rollback recovery is blocked feature=${entry.name} transaction=${current.transactionId}: ${current.error ?? ""}`,
          "Resolve the reported cause, then resume the rollback with the same target checkpoint; the backup scene is preserved",
        );
      } else {
        add(
          "ROLLBACK_TRANSACTION_OPEN",
          "error",
          `open rollback transaction phase=${current.phase} feature=${entry.name} target=${current.targetCheckpointId}`,
          `Resume the rollback with the same target checkpoint ${current.targetCheckpointId} before mutating this feature`,
        );
      }
    }
  } catch { /* no features directory — nothing to scan */ }

  let trace: {
    enforced: boolean;
    pointerPresent: boolean;
    orphanSnapshots: string[];
  } | undefined;
  if (traceState && traceState.mode !== "intake") {
    const enforced = traceEnforcementRequired(traceState.route, traceState.classification.controls);
    const orphanSnapshots = await listOrphanTraceSnapshots(root, traceState);
    trace = { enforced, pointerPresent: Boolean(traceState.traceability), orphanSnapshots };
    if (!enforced) {
      add(
        traceState.workflowCapabilities ? "TRACE_NOT_REQUIRED" : "TRACE_LEGACY_FEATURE",
        "ok",
        traceState.workflowCapabilities ? "Trace pointer is not required for this route" : "legacy feature has no Trace capability stamp",
      );
    } else {
      try {
        await readTraceability(root, traceState);
        add("TRACE_POINTER_VALID", "ok", "current Trace pointer and snapshot are valid");
      } catch (error) {
        add(
          "TRACE_POINTER_INVALID",
          "error",
          error instanceof Error ? error.message : String(error),
          "Restore the referenced Trace snapshot or re-register the current Trace artifact; doctor will not select a replacement snapshot automatically",
        );
      }
    }
    if (orphanSnapshots.length) {
      add(
        "TRACE_ORPHAN_SNAPSHOTS",
        "warning",
        `unreferenced Trace snapshots: ${orphanSnapshots.join(", ")}`,
        "Orphan snapshots are retained for diagnosis; do not hand-edit state or select an orphan as the current pointer",
      );
    }
  }

  let review: {
    enforced: boolean;
    pointerPresent: boolean;
    orphanSnapshots: string[];
  } | undefined;
  if (traceState && traceState.mode !== "intake") {
    const enforced = reviewEnforcementRequired(traceState.route, traceState.classification.controls);
    const orphanSnapshots = await listOrphanReviewSnapshots(root, traceState);
    review = { enforced, pointerPresent: Boolean(traceState.review), orphanSnapshots };
    if (!enforced) {
      add(
        traceState.workflowCapabilities ? "REVIEW_NOT_REQUIRED" : "REVIEW_LEGACY_FEATURE",
        "ok",
        traceState.workflowCapabilities ? "Review pointer is not required for this route" : "legacy feature has no Review capability stamp",
      );
    } else {
      try {
        await readReviewLedger(root, traceState);
        add("REVIEW_POINTER_VALID", "ok", "current review pointer and snapshot are valid");
      } catch (error) {
        add(
          "REVIEW_POINTER_INVALID",
          "error",
          error instanceof Error ? error.message : String(error),
          "Restore the referenced review snapshot; doctor will not select a replacement snapshot automatically",
        );
      }
    }
    if (orphanSnapshots.length) {
      add(
        "REVIEW_ORPHAN_SNAPSHOTS",
        "warning",
        `unreferenced review snapshots: ${orphanSnapshots.join(", ")}`,
        "Orphan snapshots are retained for diagnosis; do not hand-edit state or select an orphan as the current pointer",
      );
    }
  }

  if (traceState && traceState.mode !== "intake" && traceState.workspace) {
    const workspace = traceState.workspace;
    try {
      const { branch, head } = await gitBranchAndHead(root);
      if (workspace.baseBranch && branch !== workspace.baseBranch) {
        add(
          "WORKSPACE_BRANCH_CHANGED",
          "error",
          `启动分支为 ${workspace.baseBranch}，当前分支为 ${branch || "未命名分支"}`,
          "切回原分支后运行 dev_flow_reconcile_workspace 刷新状态，或暂停/终止该 feature；不要手动修改 .dev-flow",
        );
      } else if (workspace.baseHead) {
        const ancestor = await isAncestor(root, workspace.baseHead, head);
        add(
          ancestor ? "WORKSPACE_LINEAGE_VALID" : "WORKSPACE_HISTORY_REWRITTEN",
          ancestor ? "ok" : "error",
          ancestor ? "Git 基线仍是当前 HEAD 的祖先，提交链可证明" : "当前 HEAD 不再是启动基线的后代",
          ancestor ? undefined : "恢复可证明的提交链后运行 dev_flow_reconcile_workspace，或暂停/终止该 feature",
        );
      }
    } catch { /* Git unavailable: lineage failures surface through normal mutation errors */ }
  }

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

  const legacyFeatures: string[] = [];
  try {
    const directory = path.join(root, ".dev-flow", "features");
    const entries = await readdir(directory, { withFileTypes: true });
    for (const entry of entries.filter((candidate) => candidate.isDirectory())) {
      try {
        const raw = JSON.parse(await readFile(path.join(directory, entry.name, "state.json"), "utf8")) as { schemaVersion?: unknown; lifecycle?: unknown };
        if ([1, 2, 3].includes(Number(raw.schemaVersion)) && raw.lifecycle !== "finalized" && raw.lifecycle !== "abandoned") legacyFeatures.push(entry.name);
      } catch { /* corrupt features are already surfaced above */ }
    }
  } catch { /* no feature directory means there is nothing to upgrade */ }
  const v4Ready = legacyFeatures.length === 0;
  add(v4Ready ? "V4_READY" : "V4_NOT_READY", v4Ready ? "ok" : "warning", v4Ready ? "没有未完成的旧版 feature，可以使用 schema v4" : `仍有未完成的旧版 feature: ${legacyFeatures.join(", ")}`, v4Ready ? undefined : "先使用 4.x 完成或放弃旧 feature，备份 .dev-flow，再使用 5.0 重新初始化；doctor 不自动迁移或终止");

  return {
    version, root, pluginRoot, tools, project, activeFeature, corruptFeature, corruptActivePointer, hookHealth,
    recoveryTransaction: recoveryTxn ?? null,
    rollbackTransactions,
    trace: trace ?? null,
    review: review ?? null,
    mcp: { server: "running", configuration: !invalidJson },
    v4Ready,
    legacyFeatures,
    diagnostics,
  };
}
