import path from "node:path";
import { approvalBasisArtifacts, confirmedApproval } from "./approval-basis.js";
import { assessImplementationUnitBegin, beginImplementationUnit, implementationUnitWriteBlock } from "./implementation-units.js";
import { readReviewLedger } from "./review-store.js";
import type { FeatureState } from "./state-store.js";
import {
  readActive,
  readFeatureEvents,
  readProjectConfig,
  readRecoveryTransaction,
  readState,
} from "./state-store.js";
import { currentOpenStep } from "./step-order.js";
import { readTraceability } from "./traceability-store.js";

/**
 * 写门禁唯一公开 seam。adapter 把命令收成语义意图（路径已归一为项目相对路径），
 * 门禁一次给出 allow / audit / block。文件写在允许前若该有活动单元，由门禁自己 begin。
 */
export type WriteIntent =
  | { kind: "file"; paths: string[] }
  | { kind: "file"; unresolved: true }
  | { kind: "git"; paths: string[] }
  | { kind: "git"; form: "unbounded" | "publish" };

export type WriteGateCode =
  | "GIT_GUARD"
  | "GIT_STARTUP_EXCLUDED"
  | "IMPLEMENTATION_APPROVAL_REQUIRED"
  | "IMPLEMENTATION_UNIT_REQUIRED"
  | "IMPLEMENTATION_UNIT_OUT_OF_SCOPE"
  | "CONTROL_MUTATION_FORBIDDEN"
  | "ARTIFACT_NOT_REGISTERED"
  | "WORKFLOW_STATE_UNREADABLE";

export interface WriteGateBlockDetail {
  /** Per-code variant the adapter uses to pick presentation copy. */
  variant?: string;
  /** WORKFLOW_STATE_UNREADABLE: the unreadable workflow cause. */
  unreadableReason?: string;
  /** IMPLEMENTATION_UNIT_REQUIRED: diagnostic when the lazy begin failed. */
  beginFailed?: string;
  /** IMPLEMENTATION_APPROVAL_REQUIRED: plan-basis kind that invalidated the approval. */
  revokedKind?: string;
}

export interface WriteGateBlock {
  code: WriteGateCode;
  /** Project-relative paths that triggered this verdict. */
  paths: string[];
  reason: string;
  detail?: WriteGateBlockDetail;
}

export type WriteGateResult =
  | { decision: "allow"; advisory?: "unresolved-write" }
  | { decision: "audit"; block: WriteGateBlock }
  | { decision: "block"; block: WriteGateBlock };

function block(code: WriteGateCode, paths: string[], reason: string, detail?: WriteGateBlockDetail): WriteGateResult {
  return { decision: "block", block: { code, paths, reason, ...(detail ? { detail } : {}) } };
}

// ---------------------------------------------------------------------------
// 路径谓词：控制区判定对所有宿主、文件写与 git 写共用同一份。
// ---------------------------------------------------------------------------

const controlFileNames = new Set(["state.json", "active.json", "project.json", "events.jsonl", "status.md", "状态文档.md", "recovery-transaction.json", "recovery-events.jsonl"]);

function isDevFlowPath(relative: string): boolean {
  return relative === ".dev-flow" || relative.startsWith(".dev-flow/");
}

function isControlPath(relative: string): boolean {
  if (!isDevFlowPath(relative)) return false;
  if (/^\.dev-flow\/features\/[^/]+\/traceability(?:\/|$)/.test(relative)) return true;
  if (/^\.dev-flow\/features\/[^/]+\/review\/(?:snapshots|packages|projections)(?:\/|$)/.test(relative)) return true;
  const base = path.posix.basename(relative);
  if (controlFileNames.has(base)) return true;
  if (relative.includes("/.lock/") || relative.endsWith("/.lock")) return true;
  if (relative === ".dev-flow/active.json" || relative === ".dev-flow/project.json") return true;
  if (relative.includes("/recovered/")) return true;
  if (relative.endsWith("/state.json") || relative.endsWith("/events.jsonl") || relative.endsWith("/status.md") || relative.endsWith("/状态文档.md")) return true;
  return false;
}

function isGoverned(relative: string, governedRoots: string[]): boolean {
  return governedRoots.some((item) => relative === item || relative.startsWith(`${item}/`));
}

function isGeneratedReviewProjectionPath(kind: string, artifactPath: unknown): boolean {
  return kind === "plan-review" && typeof artifactPath === "string"
    && /^review\/projections\/[a-f0-9]{64}\.md$/.test(artifactPath);
}

function inFeatureScope(relative: string, state: FeatureState): boolean {
  return state.scope.inScope.some((scope) => scope === "." || relative === scope || relative.startsWith(`${scope}/`));
}

// ---------------------------------------------------------------------------
// 工作流装载：门禁自己读 active/state/ownership/ledger/批准，adapter 不预加载。
// ---------------------------------------------------------------------------

interface ActiveWorkflow {
  featureId: string;
  logicComplete?: boolean;
  approvalConfirmed: boolean;
  allowedArtifacts: Set<string>;
  governedRoots: string[];
  state?: FeatureState;
  ledger?: Awaited<ReturnType<typeof readTraceability>>;
}

type UnreadableWorkflow = { kind: "unreadable"; reason: string; governedRoots?: string[]; blockAllWrites: boolean };

async function loadActiveWorkflow(root: string): Promise<
  | { kind: "none" }
  | UnreadableWorkflow
  | { kind: "ready"; workflow: ActiveWorkflow }
> {
  try {
    const recovery = await readRecoveryTransaction(root);
    if (recovery) {
      try {
        const project = await readProjectConfig(root);
        return { kind: "unreadable", reason: `recovery journal open for ${recovery.featureId}`, governedRoots: project.governedRoots, blockAllWrites: false };
      } catch { return { kind: "unreadable", reason: "project.json invalid while recovery journal is open", blockAllWrites: true }; }
    }
  } catch { return { kind: "unreadable", reason: "recovery journal unreadable", blockAllWrites: true }; }
  let active;
  try { active = await readActive(root); }
  catch {
    try {
      const project = await readProjectConfig(root);
      return { kind: "unreadable", reason: "active.json unreadable", governedRoots: project.governedRoots, blockAllWrites: false };
    } catch { return { kind: "unreadable", reason: "project.json invalid while active.json is unreadable", blockAllWrites: true }; }
  }
  if (!active) return { kind: "none" };

  let project;
  try { project = await readProjectConfig(root); }
  catch { return { kind: "unreadable", reason: "project.json invalid", blockAllWrites: true }; }

  let state: FeatureState;
  let ledger: Awaited<ReturnType<typeof readTraceability>> | undefined;
  try {
    state = await readState(root, active.featureId);
  } catch { return { kind: "unreadable", reason: "state invalid", governedRoots: project.governedRoots, blockAllWrites: false }; }
  if (state.lifecycle !== "active" || active.revision !== state.revision) return { kind: "unreadable", reason: "active pointer revision mismatch", governedRoots: project.governedRoots, blockAllWrites: false };
  if (state.traceability) {
    try { ledger = await readTraceability(root, state); }
    catch { return { kind: "unreadable", reason: "traceability snapshot invalid", governedRoots: project.governedRoots, blockAllWrites: false }; }
  }
  if (state.review) {
    try { await readReviewLedger(root, state); }
    catch { return { kind: "unreadable", reason: "review snapshot invalid", governedRoots: project.governedRoots, blockAllWrites: false }; }
  }

  const allowedArtifacts = new Set<string>();
  for (const [kind, artifact] of Object.entries(state.artifacts ?? {})) {
    if (kind === "status" || !artifact?.path) continue;
    if (isGeneratedReviewProjectionPath(kind, artifact.path)) continue;
    if (typeof artifact.path !== "string" || path.posix.dirname(artifact.path) !== "." || !artifact.path.endsWith(".md")) {
      return { kind: "unreadable", reason: "artifact path invalid", governedRoots: project.governedRoots, blockAllWrites: false };
    }
    const relative = `.dev-flow/features/${active.featureId}/${artifact.path}`.split(path.sep).join("/");
    allowedArtifacts.add(relative);
  }

  return {
    kind: "ready",
    workflow: {
      featureId: active.featureId,
      logicComplete: state.logicComplete,
      approvalConfirmed: Boolean(confirmedApproval(state)),
      allowedArtifacts,
      governedRoots: project.governedRoots,
      state,
      ledger,
    },
  };
}

/** 从事件账本推导实现批准是否因计划依据变更而作废（返回最近作废的资产 kind）。 */
async function revokedImplementationApprovalHint(root: string, featureId: string): Promise<string | undefined> {
  const events = await readFeatureEvents(root, featureId);
  let lastConfirmedIndex = -1;
  for (let index = events.length - 1; index >= 0; index--) {
    const event = events[index];
    const data = event.data as { approval?: string };
    if ((event.type === "approval-confirmed" || event.type === "approval-interaction-resolved") && typeof data.approval === "string" && data.approval.startsWith("approval:")) {
      lastConfirmedIndex = index;
      break;
    }
  }
  if (lastConfirmedIndex < 0) return undefined;
  for (let index = events.length - 1; index >= lastConfirmedIndex; index--) {
    const event = events[index];
    const data = event.data as { kind?: string; invalidationReason?: unknown };
    if ((event.type === "artifact-recorded" || event.type === "artifact-recorded-with-trace")
      && data.kind !== undefined && approvalBasisArtifacts.includes(data.kind)
      && data.invalidationReason) {
      return data.kind;
    }
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// 门禁
// ---------------------------------------------------------------------------

export async function writeGate(root: string, intent: WriteIntent): Promise<WriteGateResult> {
  // 句法无法安全解析的写入：永不拦，仅在存在可读 active workflow 时提示归属未知。
  if (intent.kind === "file" && "unresolved" in intent) {
    const loaded = await loadActiveWorkflow(root);
    return loaded.kind === "ready" ? { decision: "allow", advisory: "unresolved-write" } : { decision: "allow" };
  }

  // 已知控制路径在读状态之前 fail-closed；状态损坏也不放行。
  if (intent.kind === "file") {
    for (const relative of intent.paths) {
      if (isControlPath(relative)) {
        return block("CONTROL_MUTATION_FORBIDDEN", [relative], "workflow control files are Core-owned", { variant: "control-file" });
      }
    }
  }

  const loaded = await loadActiveWorkflow(root);
  if (loaded.kind === "none") return { decision: "allow" };

  if (loaded.kind === "unreadable") {
    if (intent.kind === "git") {
      return block("WORKFLOW_STATE_UNREADABLE", [], loaded.reason, { unreadableReason: loaded.reason });
    }
    for (const relative of intent.paths) {
      if (loaded.blockAllWrites || isDevFlowPath(relative) || isGoverned(relative, loaded.governedRoots ?? [])) {
        return block("WORKFLOW_STATE_UNREADABLE", [relative], loaded.reason, { unreadableReason: loaded.reason });
      }
    }
    return { decision: "allow" };
  }

  if (intent.kind === "git") return evaluateGitWrite(loaded.workflow, intent);
  return evaluateFileWrite(root, loaded.workflow, intent.paths);
}

async function evaluateFileWrite(root: string, workflow: ActiveWorkflow, paths: string[]): Promise<WriteGateResult> {
  const state = workflow.state;
  if (!state) return { decision: "allow" };

  // 先拦先胜：非单元类拦截先于懒 begin，避免为注定被拦的写入推进工作流。
  let unitNeededPath: string | undefined;
  for (const relative of paths) {
    if (isControlPath(relative)) return block("CONTROL_MUTATION_FORBIDDEN", [relative], "workflow control files are Core-owned", { variant: "control-file" });
    if (isDevFlowPath(relative)) {
      if (workflow.allowedArtifacts.has(relative)) continue;
      if (relative.startsWith(`.dev-flow/features/${workflow.featureId}/`) && relative.endsWith(".md")) {
        return block("ARTIFACT_NOT_REGISTERED", [relative], "feature artifact Markdown is not registered");
      }
      return block("CONTROL_MUTATION_FORBIDDEN", [relative], "Dev Flow control area is Core-owned", { variant: "control-area" });
    }
    const governed = isGoverned(relative, workflow.governedRoots);
    if (state.mode === "intake" && governed) {
      return approvalBlock(root, workflow, relative, "intake");
    }
    if (state.mode === "routed" && currentOpenStep(state) === "implementation" && governed) {
      const approvalPending = state.obligations?.some((obligation) => obligation.kind === "approval" && obligation.status !== "satisfied") ?? false;
      if (approvalPending && !workflow.approvalConfirmed) {
        return approvalBlock(root, workflow, relative, "approval");
      }
      const unitBlock = implementationUnitWriteBlock(state, workflow.ledger, relative);
      if (unitBlock?.code === "IMPLEMENTATION_UNIT_OUT_OF_SCOPE") {
        return block("IMPLEMENTATION_UNIT_OUT_OF_SCOPE", [relative], "active implementation unit is not backed by the current trace");
      }
      if (unitBlock?.code === "IMPLEMENTATION_UNIT_REQUIRED") unitNeededPath ??= relative;
      continue;
    }
  }

  // 问 → 该 begin 则 begin：就绪判定与 begin 共享同一派生（锁内复查）；
  // begin 成功后活动单元必在当前账本内，整体重载重判可证明冗余，直接 allow。
  if (unitNeededPath) {
    const assessment = await assessImplementationUnitBegin(root, workflow.featureId, state);
    if (assessment.kind === "blocked") {
      return block("IMPLEMENTATION_UNIT_REQUIRED", [unitNeededPath], "no active implementation unit", { beginFailed: `${assessment.code}: ${assessment.message}` });
    }
    if (assessment.kind === "none") {
      // 无 ready 节点可 begin：仍是 REQUIRED，不半允许。
      return block("IMPLEMENTATION_UNIT_REQUIRED", [unitNeededPath], "no active implementation unit");
    }
    try {
      await beginImplementationUnit(root, workflow.featureId, state.revision, assessment.unitId);
      return { decision: "allow" };
    } catch (error) {
      // TOCTOU 兜底：预问到落账之间状态被推进时，锁内复查抛错。
      const diagnostic = error instanceof Error ? error.message : String(error);
      return block("IMPLEMENTATION_UNIT_REQUIRED", [unitNeededPath], "no active implementation unit", { beginFailed: diagnostic });
    }
  }
  return { decision: "allow" };
}

async function approvalBlock(root: string, workflow: ActiveWorkflow, relative: string, variant: string): Promise<WriteGateResult> {
  let revokedKind: string | undefined;
  try {
    revokedKind = await revokedImplementationApprovalHint(root, workflow.featureId);
  } catch {
    return block("WORKFLOW_STATE_UNREADABLE", [relative], "events.jsonl invalid or unreadable", { unreadableReason: "events.jsonl invalid or unreadable" });
  }
  return block("IMPLEMENTATION_APPROVAL_REQUIRED", [relative], "governed write requires implementation approval", {
    variant,
    ...(revokedKind ? { revokedKind } : {}),
  });
}

function evaluateGitWrite(workflow: ActiveWorkflow, intent: WriteIntent): WriteGateResult {
  if (intent.kind !== "git") return { decision: "allow" };
  if ("form" in intent) {
    if (intent.form === "publish") {
      return block("GIT_GUARD", [], "external publish is not allowed", { variant: "publish" });
    }
    return block("GIT_GUARD", [], "git write cannot be safety-enumerated", { variant: "unbounded" });
  }
  const state = workflow.state;
  const paths = intent.paths;
  if (!state || state.lifecycle !== "active") {
    return block("GIT_GUARD", paths, "git delivery write is not allowed before the implementation stage", { variant: "not-eligible" });
  }
  const implementationReady = state.mode === "routed" && currentOpenStep(state) === "implementation" && workflow.approvalConfirmed;
  if (!state.logicComplete && !implementationReady) {
    return block("GIT_GUARD", paths, "git delivery write is not allowed before logic-complete", { variant: "not-eligible" });
  }
  const startedDirty = state.workspace.startedDirty ?? {};
  const startupExcluded = paths.filter((relative) => state.workspace.ownership[relative] === "excluded" && startedDirty[relative] !== undefined);
  const excluded = paths.filter((relative) => state.workspace.ownership[relative] === "excluded" && startedDirty[relative] === undefined);
  const unknown = paths.filter((relative) => state.workspace.ownership[relative] !== "feature" && state.workspace.ownership[relative] !== "excluded" && !inFeatureScope(relative, state));
  if (excluded.length || unknown.length) {
    return block("GIT_GUARD", [...excluded, ...unknown], "git command includes unowned or excluded paths", { variant: "paths" });
  }
  if (startupExcluded.length) {
    return {
      decision: "audit",
      block: {
        code: "GIT_STARTUP_EXCLUDED",
        paths: startupExcluded,
        reason: "startup-excluded pre-existing dirty paths are not blocked but stay out of delivery",
      },
    };
  }
  return { decision: "allow" };
}
