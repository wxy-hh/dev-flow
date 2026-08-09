import { randomUUID, createHash } from "node:crypto";
import { access, lstat, mkdir, open, readdir, readFile, readlink, rename, rm, rmdir, writeFile } from "node:fs/promises";
import { hostname } from "node:os";
import path from "node:path";
import { normalizeWorkflowCapabilities, reviewEnforcementRequired, routeDefinition, routeDefinitionForFeature, traceEnforcementRequired } from "../policy/contract.js";
import { assertBoundaryAuditComplete, selectBaseRoute, selectRoute } from "../policy/route.js";
import { deriveObligations, reopenObligations } from "../policy/obligations.js";
import { SUPPORTED_WORKFLOW_CAPABILITIES, type Classification, type ClassificationBasis, type ClassificationFacts, type ClassificationInput, type ClassificationObligation, type DecisionRecord, type EvidenceFreshness, type FeatureLifecycle, type PendingDecision, type QualityException, type RouteId, type WorkspaceLineage, type WorkflowCapabilities } from "../policy/types.js";
import type { TraceabilityPointer } from "../policy/traceability.js";
import type { ReviewPointer } from "../policy/review.js";
import type { ImplementationUnitState } from "../policy/rollback.js";
import { pathWithinFileScope } from "../policy/rollback.js";
import { DevFlowError } from "./errors.js";
import type { DeliveryBaseline, DeliverySnapshot } from "./delivery-snapshot.js";
import { fingerprintGovernedRoots } from "./fingerprint.js";
import { missingVerificationGuarantees, projectConfigImpact, validateProjectConfig, type ProjectConfig } from "./project-config.js";
import { emptyTraceabilityLedger } from "./traceability.js";
import { inspectCurrentTrace } from "./traceability-gates.js";
import { readProjectConfigSnapshot, readTraceability, writeTraceSnapshot } from "./traceability-store.js";
import { emptyReviewLedger, prepareReviewInvalidation, readReviewLedger, writeReviewSnapshot } from "./review-store.js";
import { prepareReviewProjection } from "./review-projection.js";
import { createDecision, resolveDecision } from "./decision-ledger.js";
import type { RepairState } from "./repair-loop.js";
import { approvalIds } from "./approval-basis.js";
import { normalizeUnicode } from "./path-normalization.js";
import { captureWorkspaceLineage, ownershipForScope, reconcileWorkspaceForFeature, reconcileWorkspaceLineage } from "./git-reconciliation.js";
import { resolveInteractionPromptEvent, resolvePromptEvent } from "./interaction-provenance.js";
import { createInteraction, resolveNativeInteraction, resolveTextInteraction } from "./user-interactions.js";
import { matchDecisionReply, pendingDecisionForState, pendingInteractionForDecision } from "./decision-interactions.js";
import { assertHostHealth } from "./host-health.js";
import { collectProjectConfigAffectedEvidence, type ProjectConfigAffectedEvidence } from "./project-config-impact.js";

export { assertHostHealth, readHostHealth, recordHostHealth } from "./host-health.js";
export type { HostHealthKind, HostHealthSignal } from "./host-health.js";

export type Lifecycle = FeatureLifecycle;
export interface FeatureState {
  schemaVersion: 4; mode: "intake" | "routed"; featureId: string; revision: number; lifecycle: Lifecycle; route: RouteId; classification: Classification;
  objective?: string; investigationSummary?: string; classificationBasis?: ClassificationBasis; obligations?: ClassificationObligation[]; decisionLedger?: DecisionRecord[]; currentStage?: string; repair?: RepairState;
  /** Core-owned automatic checkpoint summaries for v3 implementation boundaries. */
  checkpoints?: Array<{ checkpointId: string; stage: string; capturedAt: string; fingerprint: string; files: string[]; basisHash: string }>;
  scope: { inScope: string[]; outOfScope: string[] }; steps: Record<string, { status: "pending" | "satisfied"; evidence?: unknown }>;
  humanGates: Record<string, unknown>; artifacts: Record<string, { path: string; sha256: string }>; verification: { attempts: unknown[]; satisfiedByAttemptId?: number; verifiedFingerprint?: string };
  /** Interactive controls are retained as a projection of the decision ledger. */
  interactions?: Record<string, unknown>;
  /** Optional so active features written before traceability capabilities remain readable. */
  workflowCapabilities?: WorkflowCapabilities;
  /** Immutable snapshot pointer; legacy and non-enforced routes may omit it. */
  traceability?: TraceabilityPointer;
  /** Immutable review snapshot pointer; legacy and non-enforced routes may omit it. */
  review?: ReviewPointer;
  /** Runtime lifecycle of rollback units; absent until the first begin and on legacy features. */
  implementationUnits?: ImplementationUnitState[];
  /** Rollback confirmation gate state; absent until presentRollbackGate is called. */
  rollbackGate?: {
    status: "pending" | "confirmed";
    targetCheckpointId: string;
    targetUnitId: string;
    previewBasisHash: string;
    interactionId: string;
    stateRevision: number;
    presentedAt: string;
    confirmedAt?: string;
  };
  businessFingerprint?: string; startBusinessFingerprint?: string;
  deliveryBaseline?: DeliveryBaseline; deliverySnapshot?: DeliverySnapshot;
  abandonment?: { reason: string; userEvidence: string; at: string };
  blockingFindings: Array<{ blocking: boolean; message: string }>;
  logicComplete: boolean; lastUpdatedBy: { host: "claude" | "codex"; pluginVersion: string };
  pendingDecision?: PendingDecision;
  routeConfirmation?: { facts: ClassificationFacts; basisHash: string };
  executionSemanticBasisHash?: string;
  workspace: WorkspaceLineage;
  evidenceFreshness: EvidenceFreshness;
  qualityExceptions: QualityException[];
  resumeSummary?: string;
}
const lifecycles = new Set<Lifecycle>(["active", "paused", "finalized", "abandoned"]);
const unitStatuses = new Set(["pending", "active", "verified", "checkpointed", "rolled_back"]);
function validateImplementationUnits(units: unknown): asserts units is ImplementationUnitState[] {
  if (!Array.isArray(units)) throw new DevFlowError("INVALID_STATE_SCHEMA", "implementationUnits must be an array");
  const ids = new Set<string>();
  const checkpoints = new Set<string>();
  for (const value of units) {
    const unit = value as Partial<ImplementationUnitState> | undefined;
    if (!unit || typeof unit !== "object" || Array.isArray(unit)
      || typeof unit.unitId !== "string" || !/^RU-[0-9]{3,}$/.test(unit.unitId)
      || typeof unit.status !== "string" || !unitStatuses.has(unit.status)
      || typeof unit.basisHash !== "string" || !/^[a-f0-9]{64}$/.test(unit.basisHash)
      || (unit.startedFingerprint !== undefined && (typeof unit.startedFingerprint !== "string" || !/^[a-f0-9]{64}$/.test(unit.startedFingerprint)))
      || (unit.checkpointId !== undefined && typeof unit.checkpointId !== "string")
      || (unit.beginNonce !== undefined && (typeof unit.beginNonce !== "string" || unit.beginNonce.trim().length === 0))) {
      throw new DevFlowError("INVALID_STATE_SCHEMA", "implementation unit state is invalid");
    }
    const started = unit.startedFingerprint !== undefined;
    const checkpointed = unit.checkpointId !== undefined;
    // Align with policy/parseImplementationUnitState: pending never carries a
    // beginNonce; blank nonces are rejected above via trim.
    const hasNonce = unit.beginNonce !== undefined;
    const consistent = (unit.status === "pending" && !started && !checkpointed && !hasNonce)
      || ((unit.status === "active" || unit.status === "verified") && started && !checkpointed)
      || ((unit.status === "checkpointed" || unit.status === "rolled_back") && started && checkpointed);
    if (!consistent) throw new DevFlowError("INVALID_STATE_SCHEMA", "implementation unit status is inconsistent with its fields");
    if (ids.has(unit.unitId)) throw new DevFlowError("INVALID_STATE_SCHEMA", "implementation units duplicate a rollback unit");
    if (checkpointed && checkpoints.has(unit.checkpointId!)) throw new DevFlowError("INVALID_STATE_SCHEMA", "implementation units duplicate a checkpoint id");
    ids.add(unit.unitId);
    if (checkpointed) checkpoints.add(unit.checkpointId!);
  }
}
export function validateFeatureState(value: unknown): asserts value is FeatureState {
  const state = value as Partial<FeatureState>;
  if ([1, 2, 3].includes(Number((state as { schemaVersion?: unknown }).schemaVersion))) throw new DevFlowError("UNSUPPORTED_FEATURE_SCHEMA", "检测到 Dev Flow 4.x 或更早的 active state。", { userMessage: "旧 feature 不能在 Dev Flow 5.0 中继续。", cause: "5.0 不迁移旧 active state。", impact: "系统不会覆盖或猜测旧审计状态。", recoveryKind: "repair", recoveryInstruction: "回到 4.x 完成或放弃该 feature，备份 .dev-flow 后重新初始化。", retryOriginal: false, schemaVersion: (state as { schemaVersion?: unknown }).schemaVersion });
  if (state?.schemaVersion !== 4) throw new DevFlowError("UNSUPPORTED_FEATURE_SCHEMA", "当前只支持 schema v4 状态。", { recoveryHint: "使用 Dev Flow 5.0 重新初始化 feature" });
  if (state.mode !== "intake" && state.mode !== "routed") throw new DevFlowError("INVALID_STATE_SCHEMA", "state mode must be intake or routed");
  if (typeof state.featureId !== "string" || !state.featureId || !Number.isInteger(state.revision) || (state.revision ?? -1) < 0 || !lifecycles.has(state.lifecycle as Lifecycle) || !state.scope || !Array.isArray(state.scope.inScope) || !Array.isArray(state.scope.outOfScope) || !state.steps || !state.humanGates || !state.artifacts || !state.verification || !Array.isArray(state.verification.attempts) || (state.interactions !== undefined && (typeof state.interactions !== "object" || state.interactions === null || Array.isArray(state.interactions))) || !Array.isArray(state.blockingFindings) || typeof state.logicComplete !== "boolean" || !state.lastUpdatedBy || !state.workspace || !state.evidenceFreshness || !Array.isArray(state.qualityExceptions)) {
    throw new DevFlowError("INVALID_STATE_SCHEMA", "状态不是合法的 schema v4 feature state。");
  }
  if (state.lastUpdatedBy.host !== "claude" && state.lastUpdatedBy.host !== "codex") throw new DevFlowError("INVALID_STATE_SCHEMA", "lastUpdatedBy host is invalid");
  const pendingInteractions = Object.values(state.interactions ?? {}).filter((item) => (item as { status?: unknown }).status === "pending");
  if (pendingInteractions.length > 1) throw new DevFlowError("MULTIPLE_PENDING_DECISIONS", "schema v4 状态包含多个待决问题。", { userMessage: "当前状态同时存在多个待决问题，流程已安全停止。", cause: "决策账本不是单一待决问题。", impact: "系统不会任选一个问题消费。", recoveryKind: "repair", recoveryInstruction: "运行 doctor 检查决策账本，然后通过公开回答接口恢复。", retryOriginal: false });
  if (state.pendingDecision !== undefined) {
    const decision = state.pendingDecision;
    if (!decision || decision.source !== "core" || typeof decision.question !== "string" || !decision.question.trim() || !/^[a-f0-9]{64}$/.test(decision.basisHash) || !Number.isInteger(decision.presentedRevision) || (decision.presentationEventId !== undefined && typeof decision.presentationEventId !== "string") || !Array.isArray(decision.options) || decision.options.length < 2 || decision.options.length > 3 || decision.options.some((option) => !option || typeof option.id !== "string" || typeof option.label !== "string" || !option.label.trim())) {
      throw new DevFlowError("INVALID_STATE_SCHEMA", "pendingDecision is invalid");
    }
  }
  const workspace = state.workspace;
  if (!workspace || typeof workspace.baseHead !== "string" || typeof workspace.baseBranch !== "string" || typeof workspace.observedHead !== "string" || typeof workspace.lastWorkspaceFingerprint !== "string" || !["current", "required", "blocked"].includes(workspace.reconciliationStatus) || typeof workspace.startedDirty !== "object" || workspace.startedDirty === null || Array.isArray(workspace.startedDirty) || typeof workspace.ownership !== "object" || workspace.ownership === null || Array.isArray(workspace.ownership) || typeof workspace.ownershipSource !== "object" || workspace.ownershipSource === null || Array.isArray(workspace.ownershipSource) || typeof workspace.observedPathFingerprints !== "object" || workspace.observedPathFingerprints === null || Array.isArray(workspace.observedPathFingerprints) || (workspace.unownedPaths !== undefined && (!Array.isArray(workspace.unownedPaths) || workspace.unownedPaths.some((file) => typeof file !== "string"))) || !Array.isArray(workspace.observedCommits)) {
    throw new DevFlowError("INVALID_STATE_SCHEMA", "workspace lineage is invalid");
  }
  if (state.lifecycle === "finalized" && !state.deliverySnapshot) throw new DevFlowError("INVALID_STATE_SCHEMA", "schema v4 的 finalized 状态必须包含交付快照。");
  if (state.lifecycle === "abandoned" && !state.abandonment) throw new DevFlowError("INVALID_STATE_SCHEMA", "schema v4 的 abandoned 状态必须包含用户原因。");
  if (state.mode === "intake") {
    if (state.route !== undefined || state.classification !== undefined || state.classificationBasis !== undefined || state.obligations !== undefined) {
      throw new DevFlowError("INVALID_STATE_SCHEMA", "intake state cannot contain route or classification fields");
    }
    if (state.decisionLedger !== undefined && (!Array.isArray(state.decisionLedger) || state.decisionLedger.some((decision) => !decision || typeof decision.id !== "string"))) {
      throw new DevFlowError("INVALID_STATE_SCHEMA", "decisionLedger is invalid");
    }
    return;
  }
  if (!state.route || !routeDefinition(state.route as RouteId) || !state.classification || !state.classificationBasis || !Array.isArray(state.obligations)) {
    throw new DevFlowError("INVALID_STATE_SCHEMA", "schema v4 的 routed 状态必须包含分类事实和义务。");
  }
  if (state.repair !== undefined && (typeof state.repair !== "object" || !["active", "stalled", "waiting-user", "completed"].includes(state.repair.status) || !Array.isArray(state.repair.attempts) || !Number.isInteger(state.repair.maxAttempts) || state.repair.maxAttempts < 1)) {
    throw new DevFlowError("INVALID_STATE_SCHEMA", "repair state is invalid");
  }
  if (state.checkpoints !== undefined && (!Array.isArray(state.checkpoints) || state.checkpoints.some((checkpoint) => {
    const item = checkpoint as { checkpointId?: unknown; stage?: unknown; capturedAt?: unknown; fingerprint?: unknown; files?: unknown; basisHash?: unknown };
    return !item || typeof item.checkpointId !== "string" || !/^AUTO-[0-9a-f-]{10,}$/.test(item.checkpointId)
      || typeof item.stage !== "string" || typeof item.capturedAt !== "string"
      || typeof item.fingerprint !== "string" || !/^[a-f0-9]{64}$/.test(item.fingerprint)
      || !Array.isArray(item.files) || item.files.some((file) => typeof file !== "string")
      || typeof item.basisHash !== "string" || !/^[a-f0-9]{64}$/.test(item.basisHash);
  }))) {
    throw new DevFlowError("INVALID_STATE_SCHEMA", "automatic checkpoints are invalid");
  }
  if (state.workflowCapabilities !== undefined) {
    try { normalizeWorkflowCapabilities(state.workflowCapabilities); }
    catch { throw new DevFlowError("INVALID_STATE_SCHEMA", "workflowCapabilities are invalid"); }
  }
  if (state.traceability !== undefined) {
    const pointer = state.traceability;
    if (typeof pointer !== "object" || pointer === null
      || !/^traceability\/snapshots\/[a-f0-9]{64}\.json$/.test(pointer.path)
      || !/^[a-f0-9]{64}$/.test(pointer.sha256)
      || pointer.path !== `traceability/snapshots/${pointer.sha256}.json`
      || !Number.isInteger(pointer.revision) || pointer.revision < 0
      || !pointer.summary || !["total", "current", "stale", "tombstoned"].every((key) => Number.isInteger(pointer.summary[key as keyof typeof pointer.summary]) && pointer.summary[key as keyof typeof pointer.summary] >= 0)) {
      throw new DevFlowError("INVALID_STATE_SCHEMA", "traceability pointer is invalid");
    }
  }
  if (traceEnforcementRequired(state.route as RouteId, state.classification.controls) && !state.traceability) {
    throw new DevFlowError("INVALID_STATE_SCHEMA", "启用 Trace 控制的 feature 必须包含 traceability pointer。");
  }
  if (state.review !== undefined) {
    const pointer = state.review;
    if (typeof pointer !== "object" || pointer === null
      || !/^review\/snapshots\/[a-f0-9]{64}\.json$/.test(pointer.path)
      || !/^[a-f0-9]{64}$/.test(pointer.sha256)
      || pointer.path !== `review/snapshots/${pointer.sha256}.json`
      || !Number.isInteger(pointer.revision) || pointer.revision < 0
      || !pointer.summary || !["batches", "current", "stale", "open", "complete"].every((key) => Number.isInteger(pointer.summary[key as keyof typeof pointer.summary]) && pointer.summary[key as keyof typeof pointer.summary] >= 0)) {
      throw new DevFlowError("INVALID_STATE_SCHEMA", "review pointer is invalid");
    }
  }
  if (reviewEnforcementRequired(state.route as RouteId, state.classification.controls) && !state.review) {
    throw new DevFlowError("INVALID_STATE_SCHEMA", "启用计划审查控制的 feature 必须包含 review pointer。");
  }
  if (state.implementationUnits !== undefined) validateImplementationUnits(state.implementationUnits);
  if (state.rollbackGate !== undefined) {
    const gate = state.rollbackGate;
    if (typeof gate !== "object" || gate === null
      || (gate.status !== "pending" && gate.status !== "confirmed")
      || typeof gate.targetCheckpointId !== "string" || typeof gate.targetUnitId !== "string"
      || !/^[a-f0-9]{64}$/.test(gate.previewBasisHash)
      || typeof gate.interactionId !== "string"
      || typeof gate.stateRevision !== "number" || !Number.isInteger(gate.stateRevision) || gate.stateRevision < 0
      || typeof gate.presentedAt !== "string"
      || (gate.confirmedAt !== undefined && typeof gate.confirmedAt !== "string")) {
      throw new DevFlowError("INVALID_STATE_SCHEMA", "rollbackGate is invalid");
    }
  }
}

export function validateScopeInput(scope: unknown): { inScope: string[]; outOfScope: string[] } {
  if (scope === undefined || scope === null) return { inScope: [], outOfScope: [] };
  if (typeof scope !== "object" || Array.isArray(scope)) {
    throw new DevFlowError("INVALID_START_INPUT", "scope must be an object with inScope and outOfScope string arrays", {
      recoveryHint: "Fix scope.inScope/outOfScope then call dev_flow_start again",
    });
  }
  const value = scope as Record<string, unknown>;
  const keys = Object.keys(value);
  if (keys.some((key) => key !== "inScope" && key !== "outOfScope")) {
    throw new DevFlowError("INVALID_START_INPUT", "scope only allows inScope and outOfScope", {
      recoveryHint: "Fix scope.inScope/outOfScope then call dev_flow_start again",
    });
  }
  if (!("inScope" in value) || !("outOfScope" in value)) {
    throw new DevFlowError("INVALID_START_INPUT", "scope requires inScope and outOfScope", {
      recoveryHint: "Fix scope.inScope/outOfScope then call dev_flow_start again",
    });
  }
  if (!Array.isArray(value.inScope) || !value.inScope.every((item) => typeof item === "string")
    || !Array.isArray(value.outOfScope) || !value.outOfScope.every((item) => typeof item === "string")) {
    throw new DevFlowError("INVALID_START_INPUT", "scope.inScope and scope.outOfScope must be string arrays", {
      recoveryHint: "Fix scope.inScope/outOfScope then call dev_flow_start again",
    });
  }
  return {
    inScope: (value.inScope as string[]).map(normalizeUnicode),
    outOfScope: (value.outOfScope as string[]).map(normalizeUnicode),
  };
}

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const devFlow = (root: string) => path.join(root, ".dev-flow");
const features = (root: string) => path.join(devFlow(root), "features");
const statePath = (root: string, id: string) => path.join(features(root), id, "state.json");
const eventPath = (root: string, id: string) => path.join(features(root), id, "events.jsonl");
const activePath = (root: string) => path.join(devFlow(root), "active.json");
const recoveryTxnPath = (root: string) => path.join(devFlow(root), "recovery-transaction.json");
const recoveryEventsPath = (root: string) => path.join(devFlow(root), "recovery-events.jsonl");
const rollbackTxnPath = (root: string, featureId: string) => path.join(features(root), featureId, "rollback-transaction.json");

export async function readProjectConfig(root: string): Promise<ProjectConfig> {
  try {
    const raw = await readFile(path.join(devFlow(root), "project.json"), "utf8");
    const value = JSON.parse(raw);
    validateProjectConfig(value);
    return value;
  } catch (error) {
    if (error instanceof DevFlowError) throw error;
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      throw new DevFlowError("PROJECT_NOT_INITIALIZED", "run dev_flow_init_project first", {
        userMessage: "项目尚未初始化，请先运行 dev_flow_init_project。",
        cause: "当前业务目录缺少 .dev-flow/project.json。",
        impact: "未初始化项目前无法开始或推进任何需求。",
        recoveryKind: "retry",
        recoveryInstruction: "运行 dev_flow_init_project 初始化项目，然后重新 dev_flow_start。",
        retryOriginal: true,
        requiresUserDecision: false,
      });
    }
    throw new DevFlowError("INVALID_PROJECT_CONFIG", "project.json exists but is unreadable", {
      userMessage: "项目配置文件无法读取。",
      cause: ".dev-flow/project.json 存在但内容损坏或无法解析。",
      impact: "无法确认项目的强制配置与受保护路径，流程已停止。",
      recoveryKind: "repair",
      recoveryInstruction: "运行 dev_flow_doctor 检查，或修复 project.json 后重试。",
      retryOriginal: false,
      requiresUserDecision: false,
    });
  }
}
export async function initProject(root: string, config: ProjectConfig): Promise<void> {
  validateProjectConfig(config); await mkdir(devFlow(root), { recursive: true });
  try {
    const existing = JSON.parse(await readFile(path.join(devFlow(root), "project.json"), "utf8")) as unknown;
    validateProjectConfig(existing);
    if (JSON.stringify(existing) === JSON.stringify(config)) return;
    throw new DevFlowError("PROJECT_CONFIG_UPDATE_REQUIRED", "project.json 已存在且内容不同。", {
      userMessage: "项目配置已经初始化；修改配置必须通过并发安全的更新入口。",
      cause: "初始化入口不会覆盖现有项目配置。",
      impact: "当前配置与请求配置均保持不变。",
      recoveryKind: "retry",
      recoveryInstruction: "先读取当前配置摘要并使用 dev_flow_update_project 提交 expectedSha256 后重试。",
      retryOriginal: false,
    });
  } catch (error) {
    if (error instanceof DevFlowError) throw error;
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  await writeAtomic(path.join(devFlow(root), "project.json"), config);
}

export async function updateProjectConfig(
  root: string,
  config: ProjectConfig,
  expectedSha256: string,
): Promise<{
  config: ProjectConfig;
  previousSha256: string;
  sha256: string;
  impact: ReturnType<typeof projectConfigImpact>;
  affectedEvidence: ProjectConfigAffectedEvidence;
}> {
  validateProjectConfig(config);
  const release = await lock(root, "project-config", "update-project");
  try {
    const file = path.join(devFlow(root), "project.json");
    let raw: string;
    try { raw = await readFile(file, "utf8"); }
    catch { throw new DevFlowError("PROJECT_NOT_INITIALIZED", "run dev_flow_init_project first"); }
    const previousSha256 = createHash("sha256").update(raw).digest("hex");
    if (!/^[a-f0-9]{64}$/.test(expectedSha256) || previousSha256 !== expectedSha256) {
      throw new DevFlowError("PROJECT_CONFIG_REVISION_CONFLICT", "project configuration changed since it was read", {
        userMessage: "项目配置已被其他操作更新，旧 expectedSha256 不能覆盖当前配置。",
        cause: "配置更新使用 sha256 CAS，检测到基线不一致。",
        impact: "没有写入新配置，也没有使现有 feature 失效。",
        recoveryKind: "refresh",
        recoveryInstruction: "重新读取当前配置摘要，确认差异后再提交更新。",
        retryOriginal: true,
        currentSha256: previousSha256,
      });
    }
    const previousConfig = JSON.parse(raw) as ProjectConfig;
    validateProjectConfig(previousConfig);
    const impact = projectConfigImpact(previousConfig, config);
    if (impact.governanceChanged || impact.preflightChanged) {
      throw new DevFlowError("PROJECT_CONFIG_HIGH_IMPACT", "governance roots, enforcement or preflight policy changed。", {
        userMessage: "这是高影响项目策略变更，不能作为普通增量配置更新。",
        cause: "治理范围或执行前置策略会改变现有 feature 的路线与证据含义。",
        impact: "没有写入新配置；现有 feature 保持原状态。",
        recoveryKind: "repair",
        recoveryInstruction: "先暂停相关 feature，完成显式重分类或恢复评估后再更新项目配置。",
        retryOriginal: false,
      });
    }
    const active = await readActive(root);
    const affectedEvidence = await collectProjectConfigAffectedEvidence(
      root,
      active ? await readState(root, active.featureId) : undefined,
      impact,
    );
    await writeAtomic(file, config);
    const nextRaw = await readFile(file, "utf8");
    return { config, previousSha256, sha256: createHash("sha256").update(nextRaw).digest("hex"), impact, affectedEvidence };
  } finally { await release(); }
}

async function writeAtomic(file: string, value: unknown): Promise<void> {
  const temp = `${file}.${randomUUID()}.tmp`; const handle = await open(temp, "w");
  try { await handle.writeFile(`${JSON.stringify(value, null, 2)}\n`); await handle.sync(); } finally { await handle.close(); }
  await rename(temp, file);
  const directory = await open(path.dirname(file), "r"); try { await directory.sync(); } finally { await directory.close(); }
}
async function prepareStatusProjection(root: string, state: FeatureState, revision: number): Promise<(() => Promise<void>) | undefined> {
  const status = state.artifacts.status; if (!status) return;
  // Route confirmation is persisted while the feature is still in intake.
  // A generated status artifact may already exist at that point, so projection
  // must not read routed-only classification fields until the confirmation is
  // atomically accepted.
  if (state.mode !== "routed" || !state.route || !state.classification) {
    const pending = pendingDecisionForState(state);
    const contents = [
      "---", "dev_flow:", "  schema_version: 1", `  feature_id: ${state.featureId}`,
      "  kind: status", "  generated: true", "---", "", "# Dev Flow Status", "",
      `- Revision: ${revision}`, `- Lifecycle: ${state.lifecycle}`, "- Mode: intake", "",
      ...(pending?.kind === "route-confirmation"
        ? ["## Pending", "", `- ${pending.question}`, ""]
        : []),
    ].join("\n");
    const file = path.join(features(root), state.featureId, status.path);
    state.artifacts.status = { ...status, sha256: createHash("sha256").update(contents).digest("hex") };
    return async () => { await writeFile(file, contents); };
  }
  const trace = await inspectCurrentTrace(root, state);
  const summary = trace.effectiveSummary;
  const traceLines = [
    "## Trace", "",
    `- Enforced: ${trace.enforced}`,
    ...(state.traceability ? [`- Pointer: ${state.traceability.path}`] : []),
    ...(summary ? [`- Summary: total=${summary.total} current=${summary.current} stale=${summary.stale} tombstoned=${summary.tombstoned}`] : []),
    ...(trace.blocker ? [`- Blocker: ${trace.blocker.code} (${trace.blocker.step})`] : []),
    "",
  ];
  const projection = [
    "---", "dev_flow:", "  schema_version: 1", `  feature_id: ${state.featureId}`, `  route: ${state.route}`, "  kind: status", "  generated: true", "---", "",
    "# Dev Flow Status", "", `- Revision: ${revision}`, `- Lifecycle: ${state.lifecycle}`, `- Route: ${state.route}`, `- Logic complete: ${state.logicComplete}`, "", "## Steps", "",
    ...routeDefinitionForFeature(state.route, state.classification.controls).orderedSteps.map((step) => `- ${step}: ${state.steps[step]?.status ?? "pending"}`), "",
    ...traceLines,
  ].join("\n");
  const contents = `${projection}\n`;
  const file = path.join(features(root), state.featureId, status.path);
  state.artifacts.status = { ...status, sha256: createHash("sha256").update(contents).digest("hex") };
  return async () => { await writeFile(file, contents); };
}
async function lock(root: string, featureId: string, operation: string): Promise<() => Promise<void>> {
  const directory = path.join(devFlow(root), ".lock"); const started = Date.now(); await mkdir(devFlow(root), { recursive: true });
  while (true) {
    try { await mkdir(directory); await writeFile(path.join(directory, "owner.json"), JSON.stringify({ pid: process.pid, hostname: hostname(), acquiredAt: new Date().toISOString(), featureId, operation })); return async () => { await rm(directory, { recursive: true, force: true }); }; }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      try { const owner = JSON.parse(await readFile(path.join(directory, "owner.json"), "utf8")); const age = Date.now() - Date.parse(owner.acquiredAt); let live = owner.hostname === hostname(); if (live) { try { process.kill(owner.pid, 0); } catch { live = false; } } if (!live && age > 30_000) { await rm(directory, { recursive: true, force: true }); continue; } } catch { /* wait for owner */ }
      if (Date.now() - started >= 5_000) throw new DevFlowError("STATE_LOCK_TIMEOUT", "state lock could not be acquired");
      await delay(50 + Math.floor(Math.random() * 20));
    }
  }
}
export async function readState(root: string, featureId: string): Promise<FeatureState> {
  try {
    const state: unknown = JSON.parse(await readFile(statePath(root, featureId), "utf8"));
    validateFeatureState(state);
    if ((state as FeatureState).featureId !== featureId) throw new DevFlowError("INVALID_STATE_SCHEMA", "state feature id does not match its path");
    return state;
  } catch (error) {
    if (error instanceof DevFlowError) throw error;
    if ((error as NodeJS.ErrnoException).code === "ENOENT") throw new DevFlowError("FEATURE_NOT_FOUND", `feature ${featureId} does not exist`, {
      userMessage: "找不到该 feature。",
      cause: `feature ${featureId} 不存在，或尚未通过 dev_flow_start 创建。`,
      impact: "未创建该 feature 前无法查看其状态。",
      recoveryKind: "retry",
      recoveryInstruction: "先 dev_flow_start 创建该 feature；如已创建，核对 featureId。",
      retryOriginal: true,
      requiresUserDecision: false,
    });
    throw new DevFlowError("INVALID_STATE_SCHEMA", `feature ${featureId} state is unreadable`, {
      recoveryHint: "Run dev_flow_doctor; if corrupt, use dev_flow_recover_corrupt_feature then start a new feature",
    });
  }
}
export interface ActivePointer { featureId: string; revision: number; updatedAt?: string }
export async function readActive(root: string): Promise<ActivePointer | undefined> {
  let raw: string;
  try { raw = await readFile(activePath(root), "utf8"); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw new DevFlowError("ACTIVE_POINTER_UNREADABLE", "active.json cannot be read", { recoveryHint: "Run dev_flow_doctor and use recovery; do not start a new feature" });
  }
  try {
    const active = JSON.parse(raw) as Partial<ActivePointer>;
    if (typeof active.featureId !== "string" || !active.featureId || typeof active.revision !== "number" || !Number.isInteger(active.revision) || active.revision < 0) {
      throw new Error("invalid active pointer fields");
    }
    return { featureId: active.featureId, revision: active.revision, ...(typeof active.updatedAt === "string" ? { updatedAt: active.updatedAt } : {}) };
  } catch {
    throw new DevFlowError("ACTIVE_POINTER_UNREADABLE", "active.json is invalid", { recoveryHint: "Run dev_flow_doctor and use recovery; do not start a new feature" });
  }
}

export async function assertActivePointerConsistent(root: string): Promise<void> {
  const active = await readActive(root);
  if (!active) return;
  let state: FeatureState;
  try { state = await readState(root, active.featureId); }
  catch (error) {
    throw new DevFlowError("ACTIVE_POINTER_INCONSISTENT", "active pointer references an unreadable feature", {
      cause: error instanceof Error ? error.message : String(error),
      impact: "系统不能确定当前 active feature，已停止自动切换。",
      recoveryKind: "repair",
      recoveryInstruction: "运行 doctor 检查 active pointer 和 feature 状态。",
      retryOriginal: false,
    });
  }
  if (state.lifecycle !== "active" || state.revision !== active.revision) {
    throw new DevFlowError("ACTIVE_POINTER_INCONSISTENT", "active pointer 与 schema v4 feature revision 不一致。", {
      userMessage: "当前 active 指针与 feature 状态不一致，流程已安全停止。",
      cause: "active pointer 必须引用同一 feature 和 revision 的 active 状态。",
      impact: "系统不会猜测应该继续哪一个 revision。",
      recoveryKind: "repair",
      recoveryInstruction: "运行 doctor 检查状态投影；不要手动修改 active.json。",
      retryOriginal: false,
      activeRevision: active.revision,
      stateRevision: state.revision,
      lifecycle: state.lifecycle,
    });
  }
}
async function appendEvent(root: string, id: string, revision: number, type: string, data: unknown): Promise<void> {
  const handle = await open(eventPath(root, id), "a");
  try { await handle.writeFile(`${JSON.stringify({ revision, type, at: new Date().toISOString(), data })}\n`); await handle.sync(); }
  finally { await handle.close(); }
}
export async function stateFileSha256(root: string, featureId: string): Promise<string> {
  const contents = await readFile(statePath(root, featureId));
  return createHash("sha256").update(contents).digest("hex");
}
export interface HostEvent { eventId: string; type: "user-prompt" | "turn-boundary" | "tool"; host: "claude" | "codex"; text?: string; at?: string; }

/** Reconcile before a critical progression gate and refuse unknown ownership. */
export async function assertWorkspaceOwnershipComplete(
  root: string,
  state: Pick<FeatureState, "workspace" | "scope">,
  config: Pick<ProjectConfig, "governedRoots" | "governedRootsExclude">,
  operation: string,
): Promise<WorkspaceLineage> {
  const reconciled = await reconcileWorkspaceForFeature(root, state, config);
  const unownedPaths = reconciled.workspace.unownedPaths ?? [];
  if (unownedPaths.length) {
    throw new DevFlowError("WORKSPACE_OWNERSHIP_REQUIRED", `unknown workspace ownership before ${operation}`, {
      userMessage: `${operation} 前发现尚未确认归属的工作区路径。`,
      cause: `以下路径已被观察到，但没有可信的 ownership 结论：${unownedPaths.join("、")}`,
      impact: "操作没有推进 feature、checkpoint、verification 或交付状态。",
      recoveryKind: "refresh",
      recoveryInstruction: "先调用 dev_flow_reconcile_workspace，按当前清单完成全部纳入、全部排除或逐个确认，再重试原操作。",
      retryOriginal: true,
      operation,
      unownedPaths,
    });
  }
  return reconciled.workspace;
}

export async function recordHostEvent(root: string, hostEvent: HostEvent): Promise<void> {
  const active = await readActive(root); if (!active) return;
  const release = await lock(root, active.featureId, "host-event");
  try {
    const state = await readState(root, active.featureId);
    const events = await readFeatureEvents(root, active.featureId);
    const duplicate = events.some((item) => {
      const recorded = item.data as Partial<HostEvent>;
      return item.type === "host-event" && recorded.host === hostEvent.host && recorded.eventId === hostEvent.eventId;
    });
    if (!duplicate) await appendEvent(root, active.featureId, state.revision, "host-event", { ...hostEvent, at: hostEvent.at ?? new Date().toISOString() });
  }
  finally { await release(); }
}

async function trustedWriteSummary(root: string, file: string): Promise<string> {
  try {
    const metadata = await lstat(path.join(root, file));
    const bytes = metadata.isSymbolicLink() ? Buffer.from(await readlink(path.join(root, file))) : await readFile(path.join(root, file));
    return `${metadata.isSymbolicLink() ? "symlink" : "file"}:${createHash("sha256").update(bytes).digest("hex")}`;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return "missing";
    throw error;
  }
}

export async function recordTrustedWriteIntent(root: string, paths: string[], host: "claude" | "codex", eventId: string): Promise<void> {
  const active = await readActive(root);
  if (!active || paths.length === 0) return;
  const state = await readState(root, active.featureId);
  if (state.mode !== "routed" || state.lifecycle !== "active" || state.currentStage !== "implementation") return;
  const config = await readProjectConfig(root);
  const governed = paths.filter((file) => config.governedRoots.some((entry) => entry === "." || file === entry || file.startsWith(`${entry}/`)));
  if (!governed.length) return;
  const before = Object.fromEntries(await Promise.all(governed.map(async (file) => [file, await trustedWriteSummary(root, file)])));
  await appendFeatureEvent(root, state.featureId, state.revision, "trusted-write-before", { eventId, host, paths: governed, before });
}

export async function recordTrustedWriteOwnership(root: string, paths: string[], host: "claude" | "codex", eventId: string): Promise<void> {
  const active = await readActive(root);
  if (!active || paths.length === 0) return;
  const state = await readState(root, active.featureId);
  if (state.mode !== "routed" || state.lifecycle !== "active" || state.currentStage !== "implementation") return;
  const config = await readProjectConfig(root);
  const governed = paths.filter((file) => config.governedRoots.some((entry) => entry === "." || file === entry || file.startsWith(`${entry}/`)));
  if (!governed.length) return;
  const after = Object.fromEntries(await Promise.all(governed.map(async (file) => [file, await trustedWriteSummary(root, file)])));
  await mutate(root, state.featureId, state.revision, "trusted-write-owned", (draft) => {
    for (const file of governed) {
      draft.workspace.ownership[file] = "feature";
      draft.workspace.ownershipSource[file] = "trusted-hook";
    }
    draft.workspace.unownedPaths = (draft.workspace.unownedPaths ?? []).filter((file) => !governed.includes(file));
    draft.lastUpdatedBy = { host, pluginVersion: __DEV_FLOW_VERSION__ };
  }, { eventId, host, paths: governed, after });
}

export type HostAuthorizationEventType = "host-authorization-pending" | "host-authorization-granted";
export type HostAuthorizationRiskClass = "task-reusable" | "always-confirm";
export interface HostAuthorizationRecord {
  host: "claude" | "codex";
  featureId: string;
  riskClass: HostAuthorizationRiskClass;
  commandFingerprint: string;
  sourceToolEvent: string;
  requestedAt?: string;
  grantedAt?: string;
}

/** Persist host authorization as an append-only Core event, never in state.json. */
export async function recordHostAuthorizationEvent(
  root: string,
  type: HostAuthorizationEventType,
  record: HostAuthorizationRecord,
): Promise<void> {
  const active = await readActive(root);
  if (!active || active.featureId !== record.featureId) return;
  const release = await lock(root, active.featureId, "host-authorization");
  try {
    const current = await readActive(root);
    if (!current || current.featureId !== record.featureId || current.revision !== active.revision) return;
    const state = await readState(root, record.featureId);
    if (state.lifecycle !== "active" || state.revision !== current.revision) return;
    const events = await readFeatureEvents(root, record.featureId);
    const duplicate = events.some((event) => {
      if (event.type !== type) return false;
      const value = event.data as Partial<HostAuthorizationRecord>;
      return value.host === record.host
        && value.featureId === record.featureId
        && value.riskClass === record.riskClass
        && value.commandFingerprint === record.commandFingerprint
        && value.sourceToolEvent === record.sourceToolEvent;
    });
    if (!duplicate) await appendEvent(root, record.featureId, state.revision, type, record);
  }
  finally { await release(); }
}

export async function readHostAuthorizationEvents(root: string, featureId: string): Promise<Array<{ type: HostAuthorizationEventType; data: HostAuthorizationRecord }>> {
  const events = await readFeatureEvents(root, featureId);
  return events.flatMap((event) => {
    if (event.type !== "host-authorization-pending" && event.type !== "host-authorization-granted") return [];
    return [{ type: event.type, data: event.data as HostAuthorizationRecord }];
  });
}

export async function readFeatureEvents(root: string, id: string): Promise<Array<{ revision: number; type: string; at: string; data: unknown }>> {
  try { return (await readFile(eventPath(root, id), "utf8")).split("\n").filter(Boolean).map((line) => JSON.parse(line)); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return []; throw error; }
}
export interface StartFeatureOptions {
  /** Test-only fault injection. Production callers omit this. */
  fault?: (point: "before-state-commit" | "after-state-commit" | "before-event" | "before-active") => void | Promise<void>;
  snapshotFault?: (point: "before-temp-write" | "after-temp-fsync" | "after-snapshot-rename") => void | Promise<void>;
}

export async function startFeature(
  root: string,
  input: ClassificationInput & { featureId?: string; activation?: "active" | "paused"; scope?: { inScope: string[]; outOfScope: string[] }; host: "claude" | "codex" },
  options: StartFeatureOptions = {},
): Promise<FeatureState> {
  await readProjectConfig(root);
  await assertHostHealth(root, input.host, "开始任务");
  await assertNoOpenRecovery(root);
  await assertNoOpenRollbackTransaction(root);
  const scope = validateScopeInput(input.scope);
  const id = input.featureId ?? randomUUID();
  const release = await lock(root, id, "start");
  try {
    await assertNoOpenRecovery(root);
    await assertNoOpenRollbackTransaction(root);
    const active = await readActive(root);
    const lifecycle = input.activation ?? "active";
    if (lifecycle === "active" && active) {
      const activeState = await readState(root, active.featureId);
      if (!pendingDecisionForState(activeState)) {
        const pendingState = structuredClone(activeState) as FeatureState;
        const interaction = createInteraction(pendingState, {
          kind: "task-switch",
          target: `task-switch:${id}`,
          basisHash: createHash("sha256").update(`${active.featureId}\n${objectiveForSwitch(input)}`).digest("hex"),
          question: "当前已有一个进行中的任务。开始新任务前，你希望如何处理旧任务？",
          options: [
            { id: "finish-old", label: "先完成当前任务" },
            { id: "pause-old", label: "暂停当前任务后开始新任务" },
            { id: "return-old", label: "返回当前任务" },
          ],
        });
        pendingState.revision += 1;
        validateFeatureState(pendingState);
        await writeAtomic(statePath(root, active.featureId), pendingState);
        await appendEvent(root, active.featureId, pendingState.revision, "task-switch-presented", { targetFeatureId: id, presentationEventId: interaction.presentationEventId });
        await writeAtomic(activePath(root), { featureId: active.featureId, revision: pendingState.revision, updatedAt: new Date().toISOString() });
      }
      throw new DevFlowError("TASK_SWITCH_REQUIRED", "另一个 feature 当前处于 active 状态。", {
        userMessage: "当前已有一个进行中的任务，请先决定如何处理它。",
        cause: "系统不会后台 finalize、暂停、终止或切换旧任务。",
        impact: "新任务尚未创建，也没有改变旧任务的执行状态。",
        recoveryKind: "ask-user",
        recoveryInstruction: "请通过 dev_flow_answer 逐题选择处理旧任务的方式。",
        requiresUserDecision: true,
        retryOriginal: false,
        activeFeatureId: active.featureId,
      });
    }
    const objective = typeof input.objective === "string" && input.objective.trim().length > 0
      ? input.objective.trim()
      : "未命名需求";
    const project = await readProjectConfig(root);
    const startBusinessFingerprint = await fingerprintGovernedRoots(root, project);
    const directory = path.join(features(root), id);
    const existedBefore = await pathExists(directory);
    let stateCommitted = false;
    try {
      await mkdir(directory, { recursive: true });
      const workflowCapabilities = normalizeWorkflowCapabilities(SUPPORTED_WORKFLOW_CAPABILITIES);
      const capturedWorkspace = ownershipForScope(await captureWorkspaceLineage(root, project), scope.inScope, scope.outOfScope);
      const deliveryBaseline: DeliveryBaseline = {
        gitHead: capturedWorkspace.baseHead || undefined,
        dirtyPaths: Object.keys(capturedWorkspace.startedDirty),
        baseBranch: capturedWorkspace.baseBranch,
        startedDirty: capturedWorkspace.startedDirty,
      };
      const state = {
        schemaVersion: 4, mode: "intake", featureId: id, revision: 0, lifecycle, objective, scope, workspace: capturedWorkspace, evidenceFreshness: { review: "missing", verification: "missing", checkpoint: "missing", implementation: "current" }, qualityExceptions: [], steps: {}, humanGates: {}, artifacts: {},
        verification: { attempts: [] }, interactions: {}, workflowCapabilities, checkpoints: [], startBusinessFingerprint, deliveryBaseline, decisionLedger: [], blockingFindings: [], logicComplete: false,
        lastUpdatedBy: { host: input.host, pluginVersion: __DEV_FLOW_VERSION__ },
      } as unknown as FeatureState;
      const ownershipPaths = unknownOwnershipPaths(state);
      state.workspace.unownedPaths = ownershipPaths;
      let presentationEventId: string | undefined;
      if (ownershipPaths.length) {
        const presentation = presentWorkspaceOwnership(state, ownershipPaths);
        presentationEventId = presentation.presentationEventId;
      }
      // v3 always starts in intake. Classification is an explicit, atomic
      // lock after repository investigation and user-owned decisions converge.
      validateFeatureState(state);
      await options.fault?.("before-state-commit");
      await writeAtomic(statePath(root, id), state);
      stateCommitted = true;
      // After state.json is durable, event/active are projections: failures keep the commit
      // and surface STATE_COMMITTED_PROJECTION_FAILED (same contract as mutatePrepared).
      const failures: string[] = [];
      try { await options.fault?.("after-state-commit"); } catch { failures.push("after-state-commit"); }
      try {
        await options.fault?.("before-event");
        await appendEvent(root, id, state.revision, "started", {
          lifecycle, mode: state.mode, objective,
          ...(presentationEventId ? { presentationEventId } : {}),
        });
      } catch { failures.push("event"); }
      if (lifecycle === "active") {
        try {
          await options.fault?.("before-active");
          await writeAtomic(activePath(root), { featureId: id, revision: state.revision, updatedAt: new Date().toISOString() });
        } catch { failures.push("active"); }
      }
      if (failures.length) {
        throw new DevFlowError("STATE_COMMITTED_PROJECTION_FAILED", "state commit succeeded but one or more projections failed", {
          committed: true,
          currentRevision: state.revision,
          failedProjections: failures,
        });
      }
      return state;
    } catch (error) {
      // Pre-commit failures leave no feature dir/snapshot; post-commit projection failures keep state.json.
      if (!stateCommitted && !existedBefore) await rm(directory, { recursive: true, force: true });
      throw error;
    }
  } finally { await release(); }
}

function objectiveForSwitch(input: { objective?: string }): string {
  return typeof input.objective === "string" ? input.objective.trim() : "未命名需求";
}

function unknownOwnershipPaths(state: Pick<FeatureState, "workspace">): string[] {
  const candidates = new Set(state.workspace.unownedPaths ?? Object.keys(state.workspace.startedDirty));
  return [...candidates].filter((file) => state.workspace.ownership[file] === undefined).sort();
}

function presentedOwnershipPaths(
  interaction: import("./user-interactions.js").UserInteraction,
): string[] {
  const persisted = interaction.workspaceBatchPaths ?? interaction.workspacePaths;
  if (persisted?.length) return [...new Set(persisted)].sort();
  // Early 5.0 single-path interactions encoded the immutable path in target.
  const legacyPrefix = "workspace-ownership:";
  return interaction.target.startsWith(legacyPrefix) && interaction.target.length > legacyPrefix.length
    ? [interaction.target.slice(legacyPrefix.length)] : [];
}

function workspaceOwnershipQuestion(paths: string[], single: boolean): string {
  if (single) return `路径“${paths[0]}”是否属于当前任务？`;
  return `发现 ${paths.length} 个无法归属的工作区路径：\n${paths.map((file) => `- ${file}`).join("\n")}\n请选择处理方式。`;
}

export function presentWorkspaceOwnership(
  state: FeatureState,
  paths: string[],
  options: { batchPaths?: string[]; remainingPaths?: string[]; single?: boolean; presentationEventId?: string } = {},
): { interaction: import("./user-interactions.js").UserInteraction; presentationEventId: string } {
  const currentPaths = [...new Set(paths)].sort();
  const batchPaths = [...new Set(options.batchPaths ?? currentPaths)].sort();
  const single = options.single ?? currentPaths.length === 1;
  const presentationEventId = options.presentationEventId ?? randomUUID();
  const basisHash = createHash("sha256").update(JSON.stringify({ kind: "workspace-ownership", paths: batchPaths, fingerprint: state.workspace.lastWorkspaceFingerprint })).digest("hex");
  const interaction = createInteraction(state, {
    kind: "workspace-ownership",
    target: `workspace:${createHash("sha256").update(batchPaths.join("\n")).digest("hex").slice(0, 16)}:${currentPaths[0] ?? "batch"}`,
    basisHash,
    question: workspaceOwnershipQuestion(currentPaths, single),
    options: single ? [
      { id: "adopt", label: "纳入当前任务" },
      { id: "exclude", label: "排除并先处理" },
    ] : [
      { id: "adopt-all", label: "全部纳入当前任务" },
      { id: "exclude-all", label: "全部排除并先处理" },
      { id: "one-by-one", label: "逐个确认" },
    ],
    presentationEventId,
    workspacePaths: currentPaths,
    workspaceBatchPaths: batchPaths,
    ...(options.remainingPaths ? { workspaceRemainingPaths: [...options.remainingPaths] } : {}),
  });
  return { interaction, presentationEventId };
}

export async function resolveWorkspaceOwnershipText(
  root: string,
  id: string,
  expectedRevision: number,
  interactionId: string,
  userReply: string,
  host: "claude" | "codex",
): Promise<{ state: FeatureState; action: string }> {
  const current = await readState(root, id);
  const decision = pendingDecisionForState(current);
  const interaction = current.interactions?.[interactionId] as import("./user-interactions.js").UserInteraction | undefined;
  if (decision?.kind !== "workspace-ownership" || !interaction || interaction.status !== "pending") {
    throw new DevFlowError("WORKSPACE_OWNERSHIP_NOT_PENDING", "当前没有待确认的工作区归属问题。");
  }
  const prompt = resolveInteractionPromptEvent(await readFeatureEvents(root, id), current, interaction, { host, userReply });
  const presentedPaths = presentedOwnershipPaths(interaction);
  const currentPaths = unknownOwnershipPaths(current);
  if (JSON.stringify(presentedPaths) !== JSON.stringify(currentPaths)) {
    throw new DevFlowError("WORKSPACE_OWNERSHIP_STALE", "待确认路径清单已变化，请重新对账后回答。", {
      userMessage: "工作区路径清单已变化，旧回答不会被套用。",
      cause: "呈现后的未知路径集合与当前未知路径集合不一致。",
      impact: "系统没有批量接纳或排除新的未确认路径。",
      recoveryKind: "refresh",
      recoveryInstruction: "先调用 dev_flow_reconcile_workspace 刷新清单，再回答当前问题。",
      retryOriginal: true,
      paths: presentedPaths,
    });
  }
  const matched = matchDecisionReply(decision, userReply);
  let nextPresentationEventId: string | undefined;
  const state = await mutate(root, id, expectedRevision, "workspace-ownership-answered", async (draft) => {
    const draftInteraction = draft.interactions?.[interactionId] as import("./user-interactions.js").UserInteraction | undefined;
    if (!draftInteraction || draftInteraction.status !== "pending" || pendingDecisionForState(draft)?.basisHash !== decision.basisHash) {
      throw new DevFlowError("WORKSPACE_OWNERSHIP_STALE", "工作区归属问题的依据已变化，请重新对账后回答。");
    }
    const batchPaths = presentedOwnershipPaths(draftInteraction);
    const unknown = unknownOwnershipPaths(draft);
    if (JSON.stringify(batchPaths) !== JSON.stringify(unknown)) {
      throw new DevFlowError("WORKSPACE_OWNERSHIP_STALE", "待确认路径清单已变化，请重新对账后回答。", {
        userMessage: "工作区路径清单已变化，旧回答不会被套用。",
        cause: "呈现后的未知路径集合与当前未知路径集合不一致。",
        impact: "系统没有批量接纳或排除新的未确认路径。",
        recoveryKind: "refresh",
        recoveryInstruction: "先调用 dev_flow_reconcile_workspace 刷新清单，再回答当前问题。",
        retryOriginal: true,
        paths: batchPaths,
      });
    }
    resolveTextInteraction(draft, interactionId, userReply, host, { promptEventId: prompt.eventId });
    const currentPaths = draftInteraction.workspacePaths ?? batchPaths;
    if (matched.option.id === "adopt-all" || matched.option.id === "adopt" || matched.option.id === "include") {
      for (const file of matched.option.id === "adopt" || matched.option.id === "include" ? currentPaths : batchPaths) {
        draft.workspace.ownership[file] = "feature";
        draft.workspace.ownershipSource[file] = "user-adopted";
      }
    } else if (matched.option.id === "exclude-all" || matched.option.id === "exclude") {
      for (const file of matched.option.id === "exclude" ? currentPaths : batchPaths) {
        draft.workspace.ownership[file] = "excluded";
      }
    }
    draft.workspace.unownedPaths = (draft.workspace.unownedPaths ?? []).filter((file) => draft.workspace.ownership[file] === undefined);
    if (matched.option.id === "one-by-one") {
      const first = batchPaths[0];
      const next = presentWorkspaceOwnership(draft, [first], { batchPaths, remainingPaths: batchPaths.slice(1), single: true });
      nextPresentationEventId = next.presentationEventId;
    } else if ((matched.option.id === "adopt" || matched.option.id === "include" || matched.option.id === "exclude") && draftInteraction.workspaceRemainingPaths?.length) {
      const remaining = draftInteraction.workspaceRemainingPaths;
      const next = presentWorkspaceOwnership(draft, [remaining[0]], { batchPaths: remaining, remainingPaths: remaining.slice(1), single: true });
      nextPresentationEventId = next.presentationEventId;
    }
    draft.lastUpdatedBy = { host, pluginVersion: __DEV_FLOW_VERSION__ };
  }, () => ({
    promptEventId: prompt.eventId,
    action: matched.option.id,
    ...(nextPresentationEventId ? { presentationEventId: nextPresentationEventId } : {}),
  }));
  return { state, action: matched.option.id };
}

export async function lockClassification(
  root: string,
  id: string,
  expectedRevision: number,
  facts: ClassificationFacts,
  boundaryAudit: unknown,
): Promise<FeatureState> {
  assertBoundaryAuditComplete(boundaryAudit, facts.decisionRefs);
  const selected = selectBaseRoute(facts);
  if (selected.contradictions.length) {
    throw new DevFlowError("CLASSIFICATION_CONTRADICTION", "classification facts contain unresolved contradictions", {
      contradictions: selected.contradictions,
      userMessage: "分类参数存在冲突或缺失，无法锁定路线。",
      cause: `分类事实存在 ${selected.contradictions.length} 处矛盾：${selected.contradictions.join("；")}`,
      impact: "路线不会锁定，仍停留在 intake 阶段。",
      recoveryKind: "retry",
      recoveryInstruction: "修正分类参数（补齐结构化 signals、避免字段重复或与 classificationBasis 冲突）后重新 dev_flow_lock_classification。",
      retryOriginal: true,
      requiresUserDecision: false,
    });
  }
  const release = await lock(root, id, "lock-classification");
  try {
    const current = await readState(root, id);
    if (current.revision !== expectedRevision) throw new DevFlowError("STATE_REVISION_CONFLICT", "state revision changed", { currentRevision: current.revision });
    if (current.mode !== "intake") throw new DevFlowError("CLASSIFICATION_ALREADY_LOCKED", "classification is already locked");
    const decisionRefs = new Set(facts.decisionRefs);
    const openDecisions = (current.decisionLedger ?? []).filter((decision) => decision.status === "open" && (decisionRefs.has(decision.id) || decisionRefs.size === 0));
    if (openDecisions.length) throw new DevFlowError("OPEN_CLASSIFICATION_DECISIONS", "classification-affecting decisions remain open", { decisionIds: openDecisions.map((decision) => decision.id), recoveryHint: "Resolve the listed decisions with grillme, then retry lock" });
    const project = await readProjectConfig(root);
    const missingGuarantees = missingVerificationGuarantees(project, selected.classification.controls.verification);
    if (missingGuarantees.length) {
      throw new DevFlowError("VERIFICATION_GUARANTEE_UNCONFIGURED", "项目验证配置不能覆盖当前路线的最终保证集。", {
        missingGuarantees,
        route: selected.route,
        userMessage: "当前路线需要的验证保证尚未配置。",
        cause: `当前路线需要 ${missingGuarantees.join("、")} guarantee，但非 preflight 验证命令没有提供这些保证。`,
        impact: "路线不会锁定，也不会创建 Trace、review 或路线确认状态。",
        recoveryKind: "repair",
        recoveryInstruction: "通过项目配置更新入口补齐非 preflight 验证命令后重试路线锁定。",
        retryOriginal: true,
      });
    }
    const capabilities = normalizeWorkflowCapabilities(SUPPORTED_WORKFLOW_CAPABILITIES);
    if (selected.classification.routeConfirmationRequired) {
      let presentationEventId: string | undefined;
      return mutatePreparedLocked(root, id, expectedRevision, "route-confirmation-presented", async () => ({ mutate: (draft) => {
        const basisHash = createHash("sha256").update(JSON.stringify({ facts, route: selected.classification.orderedRoute, controls: selected.classification.controls })).digest("hex");
        presentationEventId = randomUUID();
        draft.routeConfirmation = { facts, basisHash };
        createInteraction(draft, {
          kind: "route-confirmation",
          target: "route-confirmation",
          basisHash,
          question: `请确认 Dev Flow 5.0 路线：${selected.classification.orderedRoute.join(" → ")}`,
          options: [
            { id: "confirm", label: "确认这条路线" },
            { id: "correct", label: "修正分类事实", requiresComment: true },
          ],
          presentationEventId,
        });
      }, eventData: () => ({
        level: selected.classification.level,
        controls: selected.classification.controls,
        orderedRoute: selected.classification.orderedRoute,
        ...(presentationEventId ? { presentationEventId } : {}),
      }) }));
    }
    return mutatePreparedLocked(root, id, expectedRevision, "classification-locked", async (_current, nextRevision) => {
      const definition = routeDefinitionForFeature(selected.route, selected.classification.controls);
      const traceability = traceEnforcementRequired(selected.route, selected.classification.controls)
        ? await writeTraceSnapshot(root, emptyTraceabilityLedger(id, nextRevision, (await readProjectConfigSnapshot(root)).sha256))
        : undefined;
      const review = reviewEnforcementRequired(selected.route, selected.classification.controls)
        ? await writeReviewSnapshot(root, emptyReviewLedger(id, nextRevision))
        : undefined;
      return { mutate: (draft) => {
        draft.schemaVersion = 4;
        draft.mode = "routed";
        draft.route = selected.route;
        draft.classification = selected.classification;
        draft.classificationBasis = selected.classificationBasis;
        draft.obligations = selected.obligations;
        draft.currentStage = definition.orderedSteps[0];
        draft.workflowCapabilities = capabilities;
        draft.steps = Object.fromEntries(definition.orderedSteps.map((step) => [step, { status: "pending" as const }]));
        draft.humanGates = {};
        draft.artifacts = {};
        draft.verification = { attempts: [] };
        draft.logicComplete = false;
        if (traceability) draft.traceability = traceability;
        if (review) draft.review = review;
        // Keep this read so a future project policy change cannot silently alter
        // the basis between preview and lock.
        void project;
      } };
    });
  } finally { await release(); }
}

export async function confirmRouteClassification(
  root: string,
  id: string,
  expectedRevision: number,
  userReply: string,
  host: "claude" | "codex",
): Promise<FeatureState> {
  const current = await readState(root, id);
  const pending = pendingDecisionForState(current);
  if (pending?.kind !== "route-confirmation" || !current.routeConfirmation) throw new DevFlowError("ROUTE_CONFIRMATION_NOT_PENDING", "当前没有待确认路线。");
  const matched = matchDecisionReply(pending, userReply);
  if (matched.option.id !== "confirm") throw new DevFlowError("ROUTE_CONFIRMATION_CORRECTION_REQUIRED", "路线需要修正，不能按当前分类锁定。", { comment: matched.comment });
  const currentInteraction = pendingInteractionForDecision(current, pending);
  const events = await readFeatureEvents(root, id);
  const prompt = currentInteraction
    ? resolveInteractionPromptEvent(events, current, currentInteraction, { host, userReply })
    : resolvePromptEvent(events, {
      host, userReply, presentedAt: pending.presentedAt, presentedRevision: pending.presentedRevision,
      ...(pending.presentationEventId ? { presentationEventId: pending.presentationEventId } : {}),
    });
  const selected = selectBaseRoute(current.routeConfirmation.facts);
  const definition = routeDefinitionForFeature(selected.route, selected.classification.controls);
  const traceability = traceEnforcementRequired(selected.route, selected.classification.controls)
    ? await writeTraceSnapshot(root, emptyTraceabilityLedger(id, expectedRevision + 1, (await readProjectConfigSnapshot(root)).sha256)) : undefined;
  const review = reviewEnforcementRequired(selected.route, selected.classification.controls)
    ? await writeReviewSnapshot(root, emptyReviewLedger(id, expectedRevision + 1)) : undefined;
  return mutate(root, id, expectedRevision, "route-confirmation-accepted", (draft) => {
    if (pendingDecisionForState(draft)?.basisHash !== pending.basisHash || draft.routeConfirmation?.basisHash !== pending.basisHash) throw new DevFlowError("ROUTE_CONFIRMATION_STALE", "路线确认依据已变化。");
    const interaction = Object.values(draft.interactions ?? {}).find((value) => (value as { target?: unknown; status?: unknown }).target === "route-confirmation" && (value as { status?: unknown }).status === "pending") as import("./user-interactions.js").UserInteraction | undefined;
    if (interaction) resolveTextInteraction(draft, interaction.id, userReply, host, { promptEventId: prompt.eventId });
    draft.mode = "routed";
    draft.route = selected.route;
    draft.classification = selected.classification;
    draft.classificationBasis = selected.classificationBasis;
    draft.obligations = selected.obligations;
    draft.currentStage = definition.orderedSteps[0];
    draft.workflowCapabilities = normalizeWorkflowCapabilities(SUPPORTED_WORKFLOW_CAPABILITIES);
    draft.steps = Object.fromEntries(definition.orderedSteps.map((step) => [step, { status: "pending" as const }]));
    if (traceability) draft.traceability = traceability;
    if (review) draft.review = review;
    delete draft.pendingDecision;
    delete draft.routeConfirmation;
    draft.lastUpdatedBy = { host, pluginVersion: __DEV_FLOW_VERSION__ };
  }, { promptEventId: prompt.eventId, level: selected.classification.level, orderedRoute: selected.classification.orderedRoute });
}

/** Resolve the active-feature switch question through the same interaction contract. */
export async function resolveTaskSwitchAnswer(
  root: string,
  id: string,
  expectedRevision: number,
  userReply: string,
  host: "claude" | "codex",
): Promise<{ state: FeatureState; action: string }> {
  const current = await readState(root, id);
  const decision = pendingDecisionForState(current);
  const interaction = decision ? pendingInteractionForDecision(current, decision) : undefined;
  if (decision?.kind !== "task-switch" || !interaction || interaction.status !== "pending") {
    throw new DevFlowError("TASK_SWITCH_NOT_PENDING", "当前没有待处理的任务切换问题。", { recoveryHint: "刷新状态后继续当前任务" });
  }
  const prompt = resolveInteractionPromptEvent(await readFeatureEvents(root, id), current, interaction, { host, userReply });
  const match = matchDecisionReply(decision, userReply);
  const state = await mutate(root, id, expectedRevision, "task-switch-answered", (draft) => {
    const live = draft.interactions?.[interaction.id] as import("./user-interactions.js").UserInteraction | undefined;
    if (!live || live.status !== "pending") throw new DevFlowError("INTERACTION_ALREADY_RESOLVED", interaction.id);
    resolveTextInteraction(draft, interaction.id, userReply, host, { promptEventId: prompt.eventId });
    if (match.option.id === "pause-old") {
      draft.lifecycle = "paused";
      draft.resumeSummary = "旧任务已暂停；恢复时会自动对账工作区。";
    }
  }, () => ({ targetFeatureId: interaction.target.slice("task-switch:".length), action: match.option.id, promptEventId: prompt.eventId }));
  return { state, action: match.option.id };
}

/** Resolve the route confirmation from the same native form that presented it. */
export async function resolveRouteClassificationElicitation(
  root: string,
  id: string,
  expectedRevision: number,
  interactionId: string,
  action: string,
  comment: string | undefined,
  host: "claude" | "codex",
): Promise<FeatureState> {
  if (action !== "confirm") throw new DevFlowError("DECISION_REPLY_NOT_RECOGNIZED", "请确认当前路线，或关闭表单后补充分类事实。");
  const current = await readState(root, id);
  const pending = pendingDecisionForState(current);
  const interaction = current.interactions?.[interactionId] as import("./user-interactions.js").UserInteraction | undefined;
  if (pending?.kind !== "route-confirmation" || !current.routeConfirmation || !interaction || interaction.status !== "pending") {
    throw new DevFlowError("ROUTE_CONFIRMATION_NOT_PENDING", "当前没有待确认路线。");
  }
  const selected = selectBaseRoute(current.routeConfirmation.facts);
  const definition = routeDefinitionForFeature(selected.route, selected.classification.controls);
  const traceability = traceEnforcementRequired(selected.route, selected.classification.controls)
    ? await writeTraceSnapshot(root, emptyTraceabilityLedger(id, expectedRevision + 1, (await readProjectConfigSnapshot(root)).sha256)) : undefined;
  const review = reviewEnforcementRequired(selected.route, selected.classification.controls)
    ? await writeReviewSnapshot(root, emptyReviewLedger(id, expectedRevision + 1)) : undefined;
  return mutate(root, id, expectedRevision, "route-confirmation-accepted", (draft) => {
    if (pendingDecisionForState(draft)?.basisHash !== pending.basisHash || draft.routeConfirmation?.basisHash !== pending.basisHash) throw new DevFlowError("ROUTE_CONFIRMATION_STALE", "路线确认依据已变化。");
    resolveNativeInteraction(draft, interactionId, action, comment, host);
    draft.mode = "routed";
    draft.route = selected.route;
    draft.classification = selected.classification;
    draft.classificationBasis = selected.classificationBasis;
    draft.obligations = selected.obligations;
    draft.currentStage = definition.orderedSteps[0];
    draft.workflowCapabilities = normalizeWorkflowCapabilities(SUPPORTED_WORKFLOW_CAPABILITIES);
    draft.steps = Object.fromEntries(definition.orderedSteps.map((step) => [step, { status: "pending" as const }]));
    if (traceability) draft.traceability = traceability;
    if (review) draft.review = review;
    delete draft.routeConfirmation;
    draft.lastUpdatedBy = { host, pluginVersion: __DEV_FLOW_VERSION__ };
  }, { interactionId, action, level: selected.classification.level, orderedRoute: selected.classification.orderedRoute });
}

export async function recordDecision(
  root: string,
  id: string,
  expectedRevision: number,
  question: string,
  evidence: string,
  conclusion: string,
  factRefs: string[] = [],
  host: "claude" | "codex",
): Promise<{ state: FeatureState; decisionId: string }> {
  const prompt = resolvePromptEvent(await readFeatureEvents(root, id), {
    host,
    userReply: conclusion,
    presentedAt: new Date(0).toISOString(),
    presentedRevision: -1,
  });
  const decision = resolveDecision(createDecision(question, factRefs), evidence, conclusion);
  const attempt = (revision: number) => mutatePrepared(root, id, revision, "decision-opened", async (current) => ({
    unchanged: (current.decisionLedger ?? []).some((candidate) => candidate.id === decision.id),
    mutate: (draft) => {
      const ledger = draft.decisionLedger ?? [];
      if (ledger.some((candidate) => candidate.id === decision.id)) return;
      draft.decisionLedger = [...ledger, decision];
      draft.lastUpdatedBy = { host, pluginVersion: __DEV_FLOW_VERSION__ };
    },
    eventData: { decisionId: decision.id, promptEventId: prompt.eventId, status: "resolved" },
  }));
  try {
    const state = await attempt(expectedRevision);
    return { state, decisionId: decision.id };
  } catch (error) {
    // Decisions are content-addressed idempotent appends; a concurrent writer may
    // have committed between read and write. Retry once against the fresh revision
    // reported by the CAS conflict; prepare() already treats an identical decision
    // as unchanged, so a duplicate never fakes a revision/event.
    if (!(error instanceof DevFlowError) || error.code !== "STATE_REVISION_CONFLICT") throw error;
    const currentRevision = typeof error.details?.currentRevision === "number" ? error.details.currentRevision : expectedRevision;
    const state = await attempt(currentRevision);
    return { state, decisionId: decision.id };
  }
}

export async function resolveRecordedDecision(
  root: string,
  id: string,
  expectedRevision: number,
  decisionId: string,
  evidence: string,
  conclusion: string,
  host: "claude" | "codex",
): Promise<FeatureState> {
  return mutate(root, id, expectedRevision, "decision-resolved", (draft) => {
    const ledger = draft.decisionLedger ?? [];
    const index = ledger.findIndex((decision) => decision.id === decisionId);
    if (index < 0) throw new DevFlowError("DECISION_NOT_FOUND", decisionId);
    const next = [...ledger];
    next[index] = resolveDecision(next[index], evidence, conclusion);
    draft.decisionLedger = next;
    draft.lastUpdatedBy = { host, pluginVersion: __DEV_FLOW_VERSION__ };
  }, { decisionId });
}

export async function mutate(
  root: string,
  id: string,
  expectedRevision: number,
  operation: string,
  mutator: (state: FeatureState) => void | Promise<void>,
  eventData: unknown | (() => unknown) = {},
): Promise<FeatureState> {
  return mutatePrepared(root, id, expectedRevision, operation, async () => ({ mutate: mutator, eventData }));
}

export interface PreparedFeatureMutation {
  mutate: (draft: FeatureState) => void | Promise<void>;
  eventData?: unknown | (() => unknown);
  /** A lock-protected idempotent retry returns current state without a fake revision/event. */
  unchanged?: boolean;
}

export interface PreparedMutationOptions {
  fault?: (point: "before-state-commit" | "after-state-commit") => void | Promise<void>;
  /** The owning rollback transaction may commit through the open-transaction guard. */
  allowRollbackTransaction?: string;
}

export async function mutatePrepared(
  root: string,
  id: string,
  expectedRevision: number,
  operation: string,
  prepare: (current: Readonly<FeatureState>, nextStateRevision: number) => Promise<PreparedFeatureMutation>,
  options: PreparedMutationOptions = {},
): Promise<FeatureState> {
  const release = await lock(root, id, operation);
  try { return await mutatePreparedLocked(root, id, expectedRevision, operation, prepare, options); }
  finally { await release(); }
}

async function mutateLocked(
  root: string,
  id: string,
  expectedRevision: number,
  operation: string,
  mutator: (state: FeatureState) => void | Promise<void>,
  eventData: unknown | (() => unknown) = {},
): Promise<FeatureState> {
  return mutatePreparedLocked(root, id, expectedRevision, operation, async () => ({ mutate: mutator, eventData }));
}

async function mutatePreparedLocked(
  root: string,
  id: string,
  expectedRevision: number,
  operation: string,
  prepare: (current: Readonly<FeatureState>, nextStateRevision: number) => Promise<PreparedFeatureMutation>,
  options: PreparedMutationOptions = {},
): Promise<FeatureState> {
  const state = await readState(root, id);
  await assertNoOpenRollbackTransaction(root, { featureId: id, transactionId: options.allowRollbackTransaction });
  if (state.revision !== expectedRevision) throw new DevFlowError("STATE_REVISION_CONFLICT", "state revision changed", { currentRevision: state.revision });
  const prepared = await prepare(state, state.revision + 1);
  if (prepared.unchanged) return state;
  await prepared.mutate(state);
  state.revision += 1;
  // Review mutations and basis invalidations update the immutable pointer in
  // prepare(). Derive its read-only Markdown before the state CAS so a failed
  // projection cannot leave state pointing at a missing or stale artifact.
  await prepareReviewProjection(root, state);
  validateFeatureState(state);
  const writeStatus = await prepareStatusProjection(root, state, state.revision);
  await options.fault?.("before-state-commit");
  await writeAtomic(statePath(root, id), state);
  const failures: string[] = [];
  try { await options.fault?.("after-state-commit"); } catch { failures.push("after-state-commit"); }
  try { await writeStatus?.(); } catch { failures.push("status"); }
  try {
    const data = typeof prepared.eventData === "function" ? (prepared.eventData as () => unknown)() : prepared.eventData ?? {};
    await appendEvent(root, id, state.revision, operation, data);
  } catch { failures.push("event"); }
  try {
    const active = await readActive(root);
    if (active?.featureId === id && (state.lifecycle === "finalized" || state.lifecycle === "abandoned" || state.lifecycle === "paused")) await rm(activePath(root), { force: true });
    else if (state.lifecycle === "active" && (
      active?.featureId === id
      || (!active && ["feature-resumed", "workspace-reconciled", "feature-derived-state-repaired"].includes(operation))
    )) await writeAtomic(activePath(root), { featureId: id, revision: state.revision, updatedAt: new Date().toISOString() });
  } catch { failures.push("active"); }
  if (failures.length) {
    throw new DevFlowError("STATE_COMMITTED_PROJECTION_FAILED", "state commit succeeded but one or more projections failed", {
      committed: true, currentRevision: state.revision, failedProjections: failures,
    });
  }
  return state;
}
export async function switchActive(root: string, from: string, to: string, reason: string): Promise<FeatureState> {
  if (!reason) throw new DevFlowError("SWITCH_REASON_REQUIRED", "switch requires a reason");
  const release = await lock(root, `${from}:${to}`, "switch-active");
  try {
    await assertNoOpenRollbackTransaction(root);
    const active = await readActive(root);
    if (active?.featureId !== from) throw new DevFlowError("ACTIVE_FEATURE_CONFLICT", "source is not active");
    const source = await readState(root, from), target = await readState(root, to);
    if (target.lifecycle !== "paused") throw new DevFlowError("INVALID_LIFECYCLE", "target must be paused");
    source.lifecycle = "paused"; source.revision++; target.lifecycle = "active"; target.revision++;
    await writeAtomic(statePath(root, from), source); await writeAtomic(statePath(root, to), target);
    await appendEvent(root, from, source.revision, "paused", { reason });
    await appendEvent(root, to, target.revision, "activated", { reason });
    await writeAtomic(activePath(root), { featureId: to, revision: target.revision, updatedAt: new Date().toISOString() });
    return target;
  } finally { await release(); }
}

export async function pauseFeature(
  root: string,
  id: string,
  expectedRevision: number,
  reason: string,
  host: "claude" | "codex",
): Promise<FeatureState> {
  if (!reason.trim()) throw new DevFlowError("PAUSE_REASON_REQUIRED", "暂停需要说明原因。", { userMessage: "请说明为什么暂停当前任务。", recoveryKind: "ask-user", recoveryInstruction: "补充一句暂停原因后重试。", retryOriginal: true });
  return mutate(root, id, expectedRevision, "feature-paused", (state) => {
    if (state.lifecycle !== "active") throw new DevFlowError("INVALID_LIFECYCLE", "只有进行中的 feature 可以暂停。", { userMessage: "当前 feature 不能暂停。", recoveryKind: "refresh", recoveryInstruction: "刷新状态后从当前阶段继续。", retryOriginal: false });
    state.lifecycle = "paused";
    state.resumeSummary = `暂停原因：${reason.trim()}。恢复后先对账工作区，再从${state.currentStage ? `“${state.currentStage}”` : "当前阶段"}继续。`;
    state.lastUpdatedBy = { host, pluginVersion: __DEV_FLOW_VERSION__ };
  }, { reason: reason.trim() });
}

export async function reconcileWorkspace(
  root: string,
  id: string,
  expectedRevision: number,
  host: "claude" | "codex",
): Promise<FeatureState> {
  const state = await readState(root, id);
  const config = await readProjectConfig(root);
  const { workspace, contentChanged, changedPaths } = await reconcileWorkspaceForFeature(root, state, config);
  const legalCheckpointPaths = contentChanged
    ? await legalActiveUnitChanges(root, state, changedPaths)
    : new Set<string>();
  const active = state.lifecycle === "finalized" && contentChanged ? await readActive(root) : undefined;
  const reopenedLifecycle = state.lifecycle === "finalized" && contentChanged
    ? (!active || active.featureId === id ? "active" : "paused")
    : undefined;
  const checkpointAffected = contentChanged
    ? checkpointAffectedByPaths(state, changedPaths, legalCheckpointPaths)
    : false;
  let presentationEventId: string | undefined;
  return mutate(root, id, expectedRevision, "workspace-reconciled", (draft) => {
    draft.workspace = workspace;
    if (contentChanged) {
      markAffectedEvidenceStale(draft, changedPaths, reopenedLifecycle, legalCheckpointPaths);
    }
    presentationEventId = queueNextOwnershipDecision(draft);
    draft.lastUpdatedBy = { host, pluginVersion: __DEV_FLOW_VERSION__ };
  }, () => ({
    observedHead: workspace.observedHead,
    commitCount: workspace.observedCommits.length,
    contentChanged,
    checkpointAffected,
    reopenedLifecycle,
    unresolvedOwnership: changedPaths.filter((file) => workspace.ownership[file] === undefined),
    ...(presentationEventId ? { presentationEventId } : {}),
  }));
}

function queueNextOwnershipDecision(draft: FeatureState): string | undefined {
  if (pendingDecisionForState(draft)) return undefined;
  const paths = unknownOwnershipPaths(draft);
  if (!paths.length) return undefined;
  return presentWorkspaceOwnership(draft, paths).presentationEventId;
}

function markAffectedEvidenceStale(
  draft: FeatureState,
  changedPaths: string[],
  reopenedLifecycle?: "active" | "paused",
  legalCheckpointPaths: ReadonlySet<string> = new Set(),
): void {
  const checkpointAffected = checkpointAffectedByPaths(draft, changedPaths, legalCheckpointPaths);
  draft.evidenceFreshness = {
    ...draft.evidenceFreshness,
    verification: draft.verification.satisfiedByAttemptId !== undefined ? "stale" : draft.evidenceFreshness.verification,
    checkpoint: checkpointAffected ? "stale" : draft.evidenceFreshness.checkpoint,
    implementation: "current",
  };
  if (checkpointAffected) {
    delete draft.steps.implementation;
    delete draft.steps.code_review;
    delete draft.steps.verification;
    delete draft.steps.finalize;
    draft.currentStage = "implementation";
  } else if (draft.steps.verification?.status === "satisfied" || draft.steps.finalize?.status === "satisfied") {
    delete draft.steps.verification;
    delete draft.steps.finalize;
    draft.currentStage = "verification";
  }
  draft.logicComplete = false;
  if (reopenedLifecycle) {
    draft.lifecycle = reopenedLifecycle;
    delete draft.deliverySnapshot;
    draft.resumeSummary = reopenedLifecycle === "active"
      ? `已撤销过期的完成声明，从“${draft.currentStage ?? "当前阶段"}”继续。`
      : `完成后检测到真实内容漂移；另一个 feature 正在进行，本任务已恢复为暂停状态并回退到“${draft.currentStage ?? "当前阶段"}”。`;
  }
  draft.obligations = reopenObligations(draft.obligations, [
    ...(checkpointAffected ? ["checkpoint" as const] : []),
    "verification",
  ]);
  draft.qualityExceptions = draft.qualityExceptions.map((exception) => ({ ...exception, status: "stale" as const }));
}

function checkpointAffectedByPaths(
  state: FeatureState,
  changedPaths: string[],
  legalCheckpointPaths: ReadonlySet<string>,
): boolean {
  const externallyChangedPaths = changedPaths.filter((file) => !legalCheckpointPaths.has(file));
  return state.checkpoints?.some((checkpoint) =>
    checkpoint.files.some((file) => externallyChangedPaths.includes(file))) ?? false;
}

/**
 * A confirmed checkpoint remains current when the bytes came from the trusted
 * hook for the currently active RU and the path is inside that RU's frozen
 * scope. A later IDE/manual overwrite no longer matches the trusted after
 * summary and therefore fails closed as external drift.
 */
async function legalActiveUnitChanges(
  root: string,
  state: FeatureState,
  changedPaths: string[],
): Promise<Set<string>> {
  const activeUnit = state.implementationUnits?.find((unit) => unit.status === "active" || unit.status === "verified");
  if (!activeUnit || !state.traceability || !state.checkpoints?.length) return new Set();
  const trace = await readTraceability(root, state);
  const node = trace.nodes[activeUnit.unitId];
  if (!node || node.kind !== "rollback" || node.status !== "current") return new Set();
  const events = await readFeatureEvents(root, state.featureId);
  let lastCheckpointEventIndex = -1;
  for (let index = events.length - 1; index >= 0; index -= 1) {
    if (events[index].type === "automatic-checkpoint-captured") {
      lastCheckpointEventIndex = index;
      break;
    }
  }
  const legal = new Set<string>();
  for (const file of changedPaths) {
    if (!pathWithinFileScope(file, node.fileScope)) continue;
    let event: (typeof events)[number] | undefined;
    for (let index = events.length - 1; index > lastCheckpointEventIndex; index -= 1) {
      const candidate = events[index];
      const after = candidate.type === "trusted-write-owned"
        ? (candidate.data as { after?: Record<string, unknown> }).after
        : undefined;
      if (typeof after?.[file] === "string") {
        event = candidate;
        break;
      }
    }
    if (!event) continue;
    const expected = (event.data as { after: Record<string, string> }).after[file];
    if (expected === await trustedWriteSummary(root, file)) legal.add(file);
  }
  return legal;
}

export async function resumeFeature(root: string, id: string, host: "claude" | "codex"): Promise<FeatureState> {
  const current = await readState(root, id);
  if (current.lifecycle !== "paused") throw new DevFlowError("INVALID_LIFECYCLE", "只有已暂停的 feature 可以恢复。", { userMessage: "当前 feature 不在暂停状态。", recoveryKind: "refresh", recoveryInstruction: "刷新状态并继续当前 active feature。", retryOriginal: false });
  const active = await readActive(root);
  if (active && active.featureId !== id) {
    throw new DevFlowError("TASK_SWITCH_REQUIRED", "另一个 feature 当前处于 active 状态。", {
      userMessage: "当前已有另一个进行中的任务，请先决定是否切换。",
      cause: `active feature 为 ${active.featureId}。`,
      impact: "系统不会后台暂停、终止或切换任何任务。",
      recoveryKind: "ask-user",
      recoveryInstruction: "请逐题选择：返回当前任务、暂停当前任务后恢复此任务，或完成旧任务。",
      requiresUserDecision: true,
      retryOriginal: false,
      activeFeatureId: active.featureId,
    });
  }
  const config = await readProjectConfig(root);
  const { workspace, contentChanged, changedPaths } = await reconcileWorkspaceForFeature(root, current, config);
  const legalCheckpointPaths = contentChanged
    ? await legalActiveUnitChanges(root, current, changedPaths)
    : new Set<string>();
  const checkpointAffected = contentChanged
    ? checkpointAffectedByPaths(current, changedPaths, legalCheckpointPaths)
    : false;
  let presentationEventId: string | undefined;
  return mutate(root, id, current.revision, "feature-resumed", (state) => {
    state.lifecycle = "active";
    state.workspace = workspace;
    if (contentChanged) {
      markAffectedEvidenceStale(state, changedPaths, undefined, legalCheckpointPaths);
    }
    presentationEventId = queueNextOwnershipDecision(state);
    state.resumeSummary = `已恢复${state.currentStage ? `，从“${state.currentStage}”继续` : "当前任务"}。${contentChanged ? "工作区内容有变化，相关证据已标记为待更新。" : ""}`;
    state.lastUpdatedBy = { host, pluginVersion: __DEV_FLOW_VERSION__ };
  }, () => ({ observedHead: workspace.observedHead, contentChanged, checkpointAffected, ...(presentationEventId ? { presentationEventId } : {}) }));
}
export async function abandonFeature(root: string, id: string, expectedRevision: number, reason: string, userEvidence: string): Promise<FeatureState> {
  if (!reason || !userEvidence) throw new DevFlowError("ABANDON_EVIDENCE_REQUIRED", "abandon requires reason and user evidence");
  return mutate(root, id, expectedRevision, "abandoned", async (state) => {
    if (state.lifecycle === "finalized" || state.lifecycle === "abandoned") throw new DevFlowError("INVALID_LIFECYCLE", "terminal feature cannot be abandoned");
    state.lifecycle = "abandoned";
    state.abandonment = { reason: reason.trim(), userEvidence: userEvidence.trim(), at: new Date().toISOString() };
  }, { reason, userEvidence });
}

/** Rebuild only projections/derived pointers; immutable user and evidence records are untouched. */
export async function repairFeature(root: string, id: string, expectedRevision: number, host: "claude" | "codex"): Promise<FeatureState> {
  const current = await readState(root, id);
  const active = await readActive(root);
  if (current.lifecycle === "active" && active && active.featureId !== id) {
    throw new DevFlowError("ACTIVE_POINTER_CONFLICT", "活动指针指向另一个 feature，不能自动覆盖。", {
      userMessage: "检测到两个任务都声称处于活动状态。",
      cause: `active pointer 当前指向 ${active.featureId}。`,
      impact: "repair 不会覆盖另一个任务的活动指针。",
      recoveryKind: "ask-user",
      recoveryInstruction: "先决定保留哪个 active feature，再重试 repair。",
      requiresUserDecision: true,
      retryOriginal: false,
    });
  }
  return mutate(root, id, expectedRevision, "feature-derived-state-repaired", async (state) => {
    if (state.mode === "routed") {
      const definition = routeDefinitionForFeature(state.route, state.classification.controls);
      const fingerprint = await fingerprintGovernedRoots(root, await readProjectConfig(root));
      const events = await readFeatureEvents(root, id);
      state.evidenceFreshness.verification = state.verification.satisfiedByAttemptId === undefined
        ? "missing"
        : state.verification.verifiedFingerprint === fingerprint ? "current" : "stale";
      if (!state.review) {
        state.evidenceFreshness.review = "missing";
      } else {
        const ledger = await readReviewLedger(root, state);
        const currentBatch = ledger.batches.find((batch) => batch.validity === "current");
        state.evidenceFreshness.review = currentBatch
          ? currentBatch.progress === "complete" ? "current" : "missing"
          : ledger.batches.length ? "stale" : "missing";
      }
      let checkpointCaptureIndex = -1;
      for (let index = events.length - 1; index >= 0; index -= 1) {
        if (events[index].type === "automatic-checkpoint-captured") {
          checkpointCaptureIndex = index;
          break;
        }
      }
      const checkpointInvalidated = checkpointCaptureIndex >= 0 && events
        .slice(checkpointCaptureIndex + 1)
        .some((event) => ["workspace-reconciled", "feature-resumed"].includes(event.type)
          && (event.data as { checkpointAffected?: unknown })?.checkpointAffected === true);
      state.evidenceFreshness.checkpoint = checkpointCaptureIndex < 0
        ? "missing"
        : checkpointInvalidated ? "stale" : "current";
      state.evidenceFreshness.implementation = "current";
      const finalEvidenceCurrent = state.evidenceFreshness.verification === "current"
        && state.steps.finalize?.status === "satisfied"
        && Boolean(state.deliverySnapshot);
      if (state.lifecycle === "finalized" && !finalEvidenceCurrent) {
        state.lifecycle = active && active.featureId !== id ? "paused" : "active";
        delete state.deliverySnapshot;
      }
      state.logicComplete = state.lifecycle === "finalized" && finalEvidenceCurrent;
      state.currentStage = state.logicComplete
        ? "complete"
        : definition.orderedSteps.find((step) => state.steps[step]?.status !== "satisfied") ?? "finalize";
    }
    state.lastUpdatedBy = { host, pluginVersion: __DEV_FLOW_VERSION__ };
  }, { repaired: ["active-pointer", "current-stage", "freshness", "review/status-projection"] });
}

type RecoveryPhase = "prepared" | "directory-moved" | "active-cleared" | "completed";
interface RecoveryTransaction {
  schemaVersion: 1;
  transactionId: string;
  phase: RecoveryPhase;
  featureId: string;
  stateSha256: string;
  recoveredTo: string;
  reason: string;
  userEvidence: string;
  host: "claude" | "codex";
  at: string;
  activeSha256?: string;
  completedAt?: string;
}
function isRecoveryPhase(value: unknown): value is RecoveryPhase {
  return value === "prepared" || value === "directory-moved" || value === "active-cleared" || value === "completed";
}
function validateRecoveryTransaction(value: unknown): asserts value is RecoveryTransaction {
  const transaction = value as Partial<RecoveryTransaction>;
  if (transaction?.schemaVersion !== 1 || typeof transaction.transactionId !== "string" || !transaction.transactionId
    || !isRecoveryPhase(transaction.phase) || typeof transaction.featureId !== "string" || !transaction.featureId
    || typeof transaction.stateSha256 !== "string" || !transaction.stateSha256 || typeof transaction.recoveredTo !== "string"
    || !path.isAbsolute(transaction.recoveredTo) || typeof transaction.reason !== "string" || typeof transaction.userEvidence !== "string"
    || (transaction.host !== "claude" && transaction.host !== "codex") || typeof transaction.at !== "string"
    || (transaction.activeSha256 !== undefined && typeof transaction.activeSha256 !== "string")) {
    throw new DevFlowError("RECOVERY_TRANSACTION_UNREADABLE", "recovery journal is invalid", {
      recoveryHint: "Run dev_flow_doctor; do not start a new feature or hand-edit .dev-flow",
    });
  }
  if (path.basename(transaction.featureId) !== transaction.featureId || transaction.featureId === "." || transaction.featureId === "..") {
    throw new DevFlowError("RECOVERY_TRANSACTION_UNREADABLE", "recovery journal has an unsafe feature id", { recoveryHint: "Run dev_flow_doctor; recovery remains fail-closed" });
  }
}
function validateRecoveryLocation(root: string, transaction: RecoveryTransaction): void {
  const recoveredRoot = path.join(devFlow(root), "recovered");
  const relative = path.relative(recoveredRoot, transaction.recoveredTo);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative) || path.basename(relative) !== relative) {
    throw new DevFlowError("RECOVERY_TRANSACTION_UNREADABLE", "recovery journal points outside the recovered directory", {
      recoveryHint: "Run dev_flow_doctor; do not start a new feature or hand-edit .dev-flow",
    });
  }
}
export async function readRecoveryTransaction(root: string): Promise<RecoveryTransaction | undefined> {
  let raw: string;
  try { raw = await readFile(recoveryTxnPath(root), "utf8"); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw new DevFlowError("RECOVERY_TRANSACTION_UNREADABLE", "recovery journal cannot be read", { recoveryHint: "Run dev_flow_doctor; do not start a new feature" });
  }
  try { const transaction: unknown = JSON.parse(raw); validateRecoveryTransaction(transaction); validateRecoveryLocation(root, transaction); return transaction; }
  catch (error) {
    if (error instanceof DevFlowError) throw error;
    throw new DevFlowError("RECOVERY_TRANSACTION_UNREADABLE", "recovery journal is not valid JSON", { recoveryHint: "Run dev_flow_doctor; do not start a new feature" });
  }
}
async function assertNoOpenRecovery(root: string): Promise<void> {
  const transaction = await readRecoveryTransaction(root);
  if (transaction) throw new DevFlowError("RECOVERY_TRANSACTION_OPEN", "resume the existing recovery before starting a feature", {
    featureId: transaction.featureId,
    phase: transaction.phase,
    recoveryHint: "Call dev_flow_recover_corrupt_feature again with the doctor-reported feature and digest",
  });
}
async function pathExists(file: string): Promise<boolean> {
  try { await access(file); return true; } catch { return false; }
}
async function fileSha256(file: string): Promise<string> {
  return createHash("sha256").update(await readFile(file)).digest("hex");
}
async function updateRecoveryTransaction(root: string, transaction: RecoveryTransaction, phase: RecoveryPhase): Promise<RecoveryTransaction> {
  const next = { ...transaction, phase, ...(phase === "completed" ? { completedAt: new Date().toISOString() } : {}) };
  await writeAtomic(recoveryTxnPath(root), next);
  return next;
}
async function recoveryEventExists(root: string, transactionId: string): Promise<boolean> {
  try {
    return (await readFile(recoveryEventsPath(root), "utf8")).split("\n").filter(Boolean).some((line) => {
      try { return (JSON.parse(line) as { transactionId?: string }).transactionId === transactionId; }
      catch { throw new DevFlowError("RECOVERY_EVENTS_UNREADABLE", "recovery audit log is invalid", { recoveryHint: "Run dev_flow_doctor; recovery remains fail-closed" }); }
    });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}
async function appendRecoveryEvent(root: string, transaction: RecoveryTransaction): Promise<void> {
  if (await recoveryEventExists(root, transaction.transactionId)) return;
  const handle = await open(recoveryEventsPath(root), "a");
  try { await handle.writeFile(`${JSON.stringify({ ...transaction, phase: "completed", completedAt: new Date().toISOString() })}\n`); await handle.sync(); }
  finally { await handle.close(); }
}
async function resumeRecovery(root: string, transaction: RecoveryTransaction): Promise<{ recoveredTo: string; featureId: string; stateSha256: string }> {
  const sourceDir = path.join(features(root), transaction.featureId);
  if (transaction.phase === "prepared") {
    const [sourceExists, recoveredExists] = await Promise.all([pathExists(sourceDir), pathExists(transaction.recoveredTo)]);
    if (sourceExists === recoveredExists) throw new DevFlowError("RECOVERY_TRANSACTION_INCONSISTENT", "cannot safely determine feature-directory recovery stage", { recoveryHint: "Run dev_flow_doctor; do not start a new feature" });
    if (sourceExists) await rename(sourceDir, transaction.recoveredTo);
    transaction = await updateRecoveryTransaction(root, transaction, "directory-moved");
  }
  if (transaction.phase === "directory-moved") {
    if (transaction.activeSha256) {
      if (await pathExists(activePath(root))) {
        if (await fileSha256(activePath(root)) !== transaction.activeSha256) {
          throw new DevFlowError("RECOVERY_POINTER_DIGEST_MISMATCH", "active pointer changed during recovery", { recoveryHint: "Run dev_flow_doctor; recovery remains fail-closed" });
        }
        await rename(activePath(root), path.join(transaction.recoveredTo, "active.json"));
      }
    } else {
      const active = await readActive(root);
      if (active && active.featureId !== transaction.featureId) {
        throw new DevFlowError("RECOVERY_TRANSACTION_INCONSISTENT", "active pointer changed during recovery", { recoveryHint: "Run dev_flow_doctor; do not start a new feature" });
      }
      if (active?.featureId === transaction.featureId) await rm(activePath(root), { force: true });
    }
    transaction = await updateRecoveryTransaction(root, transaction, "active-cleared");
  }
  if (transaction.phase === "active-cleared") {
    await appendRecoveryEvent(root, transaction);
    transaction = await updateRecoveryTransaction(root, transaction, "completed");
  }
  if (transaction.phase === "completed") await rm(recoveryTxnPath(root), { force: true });
  return { recoveredTo: transaction.recoveredTo, featureId: transaction.featureId, stateSha256: transaction.stateSha256 };
}

// ─── Rollback transaction journal ────────────────────────────────────────────

export type RollbackTransactionPhase = "prepared" | "backing-up" | "rolling-back" | "verifying" | "committed" | "compensating" | "compensated";
const rollbackTransactionPhases = new Set<RollbackTransactionPhase>(["prepared", "backing-up", "rolling-back", "verifying", "committed", "compensating", "compensated"]);

export interface RollbackTransactionFileAction {
  action: "restore" | "delete";
  path: string;
  blobSha256?: string;
  mode?: string;
  kind?: "file" | "symlink";
}

/** Resumable journal for checkpoint rollback execution; mirrors policy/rollback-transaction.schema.json. */
export interface RollbackTransaction {
  schemaVersion: 1;
  transactionId: string;
  featureId: string;
  phase: RollbackTransactionPhase;
  targetCheckpointId: string;
  targetUnitId: string;
  undoOrder: string[];
  undoCheckpoints?: string[];
  previewBasisHash: string;
  stateRevision: number;
  backupDirectory: string;
  nextFileIndex: number;
  filePlan: RollbackTransactionFileAction[];
  verificationAttemptIds: string[];
  projectConfigSha256: string;
  /** Referenced verification command identities captured for scoped invalidation. */
  verificationCommandHashes?: Record<string, string>;
  startedAt: string;
  completedAt?: string;
  error?: string;
}

function isSha256(value: unknown): value is string {
  return typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
}

function validateRollbackTransaction(value: unknown): asserts value is RollbackTransaction {
  const transaction = value as Partial<RollbackTransaction>;
  const validPlan = Array.isArray(transaction?.filePlan) && transaction.filePlan.every((action) => {
    const candidate = action as Partial<RollbackTransactionFileAction> | undefined;
    if (!candidate || (candidate.action !== "restore" && candidate.action !== "delete")
      || typeof candidate.path !== "string" || !candidate.path) return false;
    if (candidate.action === "restore" && (!isSha256(candidate.blobSha256) || typeof candidate.mode !== "string" || !/^[0-7]{3,4}$/.test(candidate.mode))) return false;
    if (candidate.blobSha256 !== undefined && !isSha256(candidate.blobSha256)) return false;
    if (candidate.mode !== undefined && (typeof candidate.mode !== "string" || !/^[0-7]{3,4}$/.test(candidate.mode))) return false;
    if (candidate.kind !== undefined && candidate.kind !== "file" && candidate.kind !== "symlink") return false;
    return true;
  });
  if (transaction?.schemaVersion !== 1 || typeof transaction.transactionId !== "string" || !transaction.transactionId
    || typeof transaction.featureId !== "string" || !transaction.featureId
    || !rollbackTransactionPhases.has(transaction.phase as RollbackTransactionPhase)
    || typeof transaction.targetCheckpointId !== "string" || !/^CP-[0-9]{3,}$/.test(transaction.targetCheckpointId)
    || typeof transaction.targetUnitId !== "string" || !/^RU-[0-9]{3,}$/.test(transaction.targetUnitId)
    || !Array.isArray(transaction.undoOrder) || transaction.undoOrder.length === 0 || !transaction.undoOrder.every((unitId) => typeof unitId === "string" && /^RU-[0-9]{3,}$/.test(unitId))
    || (transaction.undoCheckpoints !== undefined && (!Array.isArray(transaction.undoCheckpoints) || !transaction.undoCheckpoints.every((id) => typeof id === "string" && /^CP-[0-9]{3,}$/.test(id))))
    || !isSha256(transaction.previewBasisHash) || !isSha256(transaction.projectConfigSha256)
    || (transaction.verificationCommandHashes !== undefined && (typeof transaction.verificationCommandHashes !== "object" || transaction.verificationCommandHashes === null || Array.isArray(transaction.verificationCommandHashes) || Object.values(transaction.verificationCommandHashes).some((hash) => !isSha256(hash))))
    || !Number.isInteger(transaction.stateRevision) || (transaction.stateRevision ?? -1) < 0
    || typeof transaction.backupDirectory !== "string" || !/^checkpoints\/recovery\/[^/]+$/.test(transaction.backupDirectory)
    || !Number.isInteger(transaction.nextFileIndex) || (transaction.nextFileIndex ?? -1) < 0
    || !validPlan
    || !Array.isArray(transaction.verificationAttemptIds) || !transaction.verificationAttemptIds.every((id) => typeof id === "string" && id.length > 0)
    || typeof transaction.startedAt !== "string"
    || (transaction.completedAt !== undefined && typeof transaction.completedAt !== "string")
    || (transaction.error !== undefined && typeof transaction.error !== "string")) {
    throw new DevFlowError("ROLLBACK_TRANSACTION_UNREADABLE", "rollback transaction journal is invalid", {
      recoveryHint: "Run dev_flow_doctor; the workspace may be mid-rollback — do not hand-edit .dev-flow",
    });
  }
}

/** A journal is fully finished only at a terminal phase with cleanup recorded. */
export function rollbackTransactionFinished(transaction: RollbackTransaction): boolean {
  return (transaction.phase === "committed" || transaction.phase === "compensated") && typeof transaction.completedAt === "string";
}

export async function readRollbackTransaction(root: string, featureId: string): Promise<RollbackTransaction | undefined> {
  let raw: string;
  try { raw = await readFile(rollbackTxnPath(root, featureId), "utf8"); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw new DevFlowError("ROLLBACK_TRANSACTION_UNREADABLE", "rollback transaction journal cannot be read", {
      recoveryHint: "Run dev_flow_doctor; the workspace may be mid-rollback — do not hand-edit .dev-flow",
    });
  }
  let parsed: unknown;
  try { parsed = JSON.parse(raw); }
  catch {
    throw new DevFlowError("ROLLBACK_TRANSACTION_UNREADABLE", "rollback transaction journal is not valid JSON", {
      recoveryHint: "Run dev_flow_doctor; the workspace may be mid-rollback — do not hand-edit .dev-flow",
    });
  }
  validateRollbackTransaction(parsed);
  if ((parsed as RollbackTransaction).featureId !== featureId) {
    throw new DevFlowError("ROLLBACK_TRANSACTION_UNREADABLE", "rollback transaction journal feature id does not match its path", {
      recoveryHint: "Run dev_flow_doctor; the workspace may be mid-rollback — do not hand-edit .dev-flow",
    });
  }
  return parsed;
}

export async function writeRollbackTransaction(root: string, featureId: string, transaction: RollbackTransaction): Promise<void> {
  validateRollbackTransaction(transaction);
  if (transaction.featureId !== featureId) {
    throw new DevFlowError("ROLLBACK_TRANSACTION_UNREADABLE", "rollback transaction journal feature id does not match its path");
  }
  await writeAtomic(rollbackTxnPath(root, featureId), transaction);
}

/**
 * Fail-closed mutation guard: an open rollback journal on ANY feature blocks
 * every feature mutation — the plan requires that any open transaction blocks
 * other feature mutations, because the rollback rewrites the shared workspace.
 * The owning transaction commits through via allowTransactionId on its own
 * feature; unreadable journals propagate ROLLBACK_TRANSACTION_UNREADABLE.
 * Reads stay available for status/doctor.
 */
async function assertNoOpenRollbackTransaction(root: string, allow?: { featureId?: string; transactionId?: string }): Promise<void> {
  let entries;
  try { entries = await readdir(features(root), { withFileTypes: true }); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
    throw error;
  }
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const transaction = await readRollbackTransaction(root, entry.name);
    if (!transaction || rollbackTransactionFinished(transaction)) continue;
    if (allow?.featureId === entry.name && allow.transactionId !== undefined && allow.transactionId === transaction.transactionId) continue;
    throw new DevFlowError("ROLLBACK_TRANSACTION_OPEN", "a rollback transaction is open", {
      transactionId: transaction.transactionId,
      featureId: entry.name,
      phase: transaction.phase,
      recoveryHint: `Resume the rollback transaction for feature ${entry.name} with the same input before mutating features`,
    });
  }
}

/**
 * Atomically plant a prepared rollback journal under the project state lock:
 * scan every open journal, re-check the feature revision, then write. This is
 * the only entry that creates a fresh journal — concurrent hosts cannot both
 * pass the open-transaction check and land different journals.
 */
export async function prepareRollbackTransaction(
  root: string,
  featureId: string,
  expectedRevision: number,
  transaction: RollbackTransaction,
): Promise<RollbackTransaction> {
  if (transaction.featureId !== featureId) {
    throw new DevFlowError("ROLLBACK_TRANSACTION_UNREADABLE", "rollback transaction journal feature id does not match its path");
  }
  if (transaction.phase !== "prepared") {
    throw new DevFlowError("ROLLBACK_TRANSACTION_UNREADABLE", "prepareRollbackTransaction only accepts phase prepared");
  }
  if (transaction.stateRevision !== expectedRevision) {
    throw new DevFlowError("STATE_REVISION_CONFLICT", "state revision changed", { currentRevision: transaction.stateRevision });
  }
  const release = await lock(root, featureId, "prepare-rollback-transaction");
  try {
    await assertNoOpenRollbackTransaction(root);
    const state = await readState(root, featureId);
    if (state.revision !== expectedRevision) {
      throw new DevFlowError("STATE_REVISION_CONFLICT", "state revision changed", { currentRevision: state.revision });
    }
    // Finished journals are replaced; an open journal for this feature would
    // already have been rejected by the project-wide scan above.
    await writeRollbackTransaction(root, featureId, transaction);
    return transaction;
  } finally {
    await release();
  }
}

/** A remote drive lease must renew within this window or it may be reclaimed. */
const ROLLBACK_DRIVE_LEASE_STALE_MS = 30_000;
const ROLLBACK_DRIVE_LEASE_HEARTBEAT_MS = 10_000;

export interface RollbackDriveLease {
  schemaVersion: 1;
  transactionId: string;
  featureId: string;
  ownerId: string;
  pid: number;
  hostname: string;
  acquiredAt: string;
  /** Last owner-authenticated renewal. Older leases may only have acquiredAt. */
  heartbeatAt?: string;
}

function driveLeasePath(root: string, featureId: string, transactionId: string): string {
  // The sidecar is the current-version fencing token. It is paired with the
  // legacy in-directory lease below for the whole open-transaction lifetime.
  return path.join(features(root), featureId, "checkpoints", "recovery", `${transactionId}-drive-lease.json`);
}

/**
 * Older hosts only read this in-directory lease. New hosts therefore mirror
 * their lease here until completedAt is durable; a sidecar-only lease would be
 * invisible to an older host and permit two concurrent transaction drivers.
 */
function legacyDriveLeasePath(root: string, featureId: string, transactionId: string): string {
  return path.join(features(root), featureId, "checkpoints", "recovery", transactionId, "drive-lease.json");
}

/** Read a lease from a specific file path.  Returns undefined for ENOENT,
 *  throws ROLLBACK_TRANSACTION_UNREADABLE for other I/O errors. */
async function readLeaseAt(leaseFile: string, transactionId: string): Promise<RollbackDriveLease | undefined> {
  try {
    const raw = await readFile(leaseFile, "utf8");
    return JSON.parse(raw) as RollbackDriveLease;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw new DevFlowError("ROLLBACK_TRANSACTION_UNREADABLE", "rollback drive lease is unreadable", {
      transactionId,
      recoveryHint: "Run dev_flow_doctor; do not hand-edit the drive lease",
    });
  }
}

/** Both lease locations are read independently: any fresh lease is authoritative. */
async function readDriveLeases(
  root: string,
  featureId: string,
  transactionId: string,
): Promise<{ sidecar?: RollbackDriveLease; legacy?: RollbackDriveLease }> {
  const [sidecar, legacy] = await Promise.all([
    readLeaseAt(driveLeasePath(root, featureId, transactionId), transactionId),
    readLeaseAt(legacyDriveLeasePath(root, featureId, transactionId), transactionId),
  ]);
  return { ...(sidecar ? { sidecar } : {}), ...(legacy ? { legacy } : {}) };
}

/**
 * New hosts publish to both locations. The legacy write comes first so a host
 * that knows only the old path never observes an unlocked active transaction.
 * Calls happen under the shared project lock, making the pair a single claim
 * protocol for current and older binaries.
 */
async function writeDriveLeasePair(
  root: string,
  featureId: string,
  transactionId: string,
  lease: RollbackDriveLease,
): Promise<void> {
  const legacyFile = legacyDriveLeasePath(root, featureId, transactionId);
  const sidecarFile = driveLeasePath(root, featureId, transactionId);
  await mkdir(path.dirname(legacyFile), { recursive: true });
  await mkdir(path.dirname(sidecarFile), { recursive: true });
  await writeAtomic(legacyFile, lease);
  await writeAtomic(sidecarFile, lease);
}

function isProcessAlive(pid: number, ownerHostname: string): boolean {
  if (ownerHostname !== hostname()) return true; // different host: assume live (fail closed until stale)
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function leaseHeartbeatAt(lease: RollbackDriveLease): number {
  const timestamp = Date.parse(lease.heartbeatAt ?? lease.acquiredAt);
  return Number.isFinite(timestamp) ? timestamp : Number.NaN;
}

function activeLease(lease: RollbackDriveLease): boolean {
  const heartbeatAt = leaseHeartbeatAt(lease);
  const live = Number.isFinite(heartbeatAt) && isProcessAlive(lease.pid, lease.hostname);
  const stale = !Number.isFinite(heartbeatAt) || Date.now() - heartbeatAt > ROLLBACK_DRIVE_LEASE_STALE_MS;
  return live && !stale;
}

function leaseBusyError(featureId: string, transactionId: string, lease: RollbackDriveLease): DevFlowError {
  return new DevFlowError("ROLLBACK_TRANSACTION_BUSY", "another host is already driving this rollback transaction", {
    transactionId,
    featureId,
    ownerId: lease.ownerId,
    pid: lease.pid,
    hostname: lease.hostname,
    recoveryHint: "Wait for the other host to finish, or resume after its process exits and the lease ages out",
  });
}

/**
 * Claim exclusive ownership of driving an open rollback journal. Held only for
 * the duration of driveRollbackTransaction (not the whole verification wait
 * via the project lock — the lease file is the mutex). Concurrent resumes get
 * ROLLBACK_TRANSACTION_BUSY while the owner is live.
 */
export async function claimRollbackDriveLease(
  root: string,
  featureId: string,
  transactionId: string,
): Promise<RollbackDriveLease> {
  const release = await lock(root, featureId, "claim-rollback-drive");
  try {
    const journal = await readRollbackTransaction(root, featureId);
    if (!journal || rollbackTransactionFinished(journal)) {
      throw new DevFlowError("ROLLBACK_TRANSACTION_MISMATCH", "no open rollback transaction to drive", {
        featureId,
        transactionId,
      });
    }
    if (journal.transactionId !== transactionId) {
      throw new DevFlowError("ROLLBACK_TRANSACTION_MISMATCH", "rollback transaction id does not match the open journal", {
        openTransactionId: journal.transactionId,
        transactionId,
      });
    }
    // Every fresh lease is authoritative. This includes the legacy mirror so
    // an old host and a new host cannot independently claim the same journal.
    const leases = await readDriveLeases(root, featureId, transactionId);
    for (const existing of [leases.sidecar, leases.legacy]) {
      if (existing && activeLease(existing)) {
        throw leaseBusyError(featureId, transactionId, existing);
      }
    }
    const lease: RollbackDriveLease = {
      schemaVersion: 1,
      transactionId,
      featureId,
      ownerId: randomUUID(),
      pid: process.pid,
      hostname: hostname(),
      acquiredAt: new Date().toISOString(),
      heartbeatAt: new Date().toISOString(),
    };
    await writeDriveLeasePair(root, featureId, transactionId, lease);
    return lease;
  } finally {
    await release();
  }
}

/** Refreshes a lease only when the caller still owns its fencing token. */
export async function renewRollbackDriveLease(
  root: string,
  featureId: string,
  lease: RollbackDriveLease,
): Promise<void> {
  const release = await lock(root, featureId, "renew-rollback-drive");
  try {
    const leases = await readDriveLeases(root, featureId, lease.transactionId);
    const existing = leases.sidecar ?? leases.legacy;
    if (!existing) {
      throw new DevFlowError("ROLLBACK_TRANSACTION_MISMATCH", "rollback drive lease disappeared while being renewed", {
        transactionId: lease.transactionId,
      });
    }
    for (const candidate of [leases.sidecar, leases.legacy]) {
      if (candidate && candidate.ownerId !== lease.ownerId) {
        throw leaseBusyError(featureId, lease.transactionId, candidate);
      }
    }
    const renewed: RollbackDriveLease = { ...existing, heartbeatAt: new Date().toISOString() };
    await writeDriveLeasePair(root, featureId, lease.transactionId, renewed);
  } finally {
    await release();
  }
}

export interface RollbackDriveLeaseHeartbeat {
  assertOwned(): void;
  stop(): Promise<void>;
}

/**
 * Keeps a remote-visible lease fresh while long file operations or verification
 * commands run. A renewal failure is surfaced to the driver before it performs
 * a further transaction transition.
 */
export function maintainRollbackDriveLease(
  root: string,
  featureId: string,
  lease: RollbackDriveLease,
): RollbackDriveLeaseHeartbeat {
  let stopped = false;
  let inFlight: Promise<void> | undefined;
  let failure: unknown;
  const renew = (): Promise<void> => {
    if (stopped || failure) return inFlight ?? Promise.resolve();
    if (!inFlight) {
      inFlight = renewRollbackDriveLease(root, featureId, lease)
        .catch((error) => { failure = error; })
        .finally(() => { inFlight = undefined; });
    }
    return inFlight;
  };
  const interval = setInterval(() => { void renew(); }, ROLLBACK_DRIVE_LEASE_HEARTBEAT_MS);
  interval.unref();
  return {
    assertOwned(): void {
      if (!failure) return;
      if (failure instanceof DevFlowError && failure.code === "ROLLBACK_TRANSACTION_BUSY") throw failure;
      throw new DevFlowError("ROLLBACK_TRANSACTION_BUSY", "rollback drive lease could not be renewed; refusing to continue this driver", {
        transactionId: lease.transactionId,
        cause: failure instanceof DevFlowError ? failure.code : String(failure),
        recoveryHint: "Wait for the current driver to finish, then resume the open rollback transaction",
      });
    },
    async stop(): Promise<void> {
      stopped = true;
      clearInterval(interval);
      await inFlight;
    },
  };
}

/** Release the drive lease only if this owner still holds it. */
export async function releaseRollbackDriveLease(
  root: string,
  featureId: string,
  lease: RollbackDriveLease,
): Promise<void> {
  const release = await lock(root, featureId, "release-rollback-drive");
  try {
    const sidecarFile = driveLeasePath(root, featureId, lease.transactionId);
    const legacyFile = legacyDriveLeasePath(root, featureId, lease.transactionId);
    let sidecar: RollbackDriveLease | undefined;
    try {
      sidecar = JSON.parse(await readFile(sidecarFile, "utf8")) as RollbackDriveLease;
    } catch {
      // Best-effort release continues with the legacy mirror.
    }
    if (sidecar?.ownerId === lease.ownerId) {
      await rm(sidecarFile, { force: true });
    }
    try {
      const legacyExisting = JSON.parse(await readFile(legacyFile, "utf8")) as RollbackDriveLease;
      if (legacyExisting?.ownerId === lease.ownerId) {
        await rm(legacyFile, { force: true });
      }
    } catch {
      // ENOENT or unreadable: nothing to clean up.
    }
    // After the terminal marker is durable, both mirrors are gone and this
    // otherwise-empty directory can disappear. During a resumable failure it
    // still contains the backup, so rmdir safely leaves it in place.
    try { await rmdir(path.dirname(legacyFile)); } catch { /* backup is still present or another owner holds the lease */ }
  } finally {
    await release();
  }
}

/** Append one audit record to the feature event ledger (rollback attempts, transaction milestones). */
export async function appendFeatureEvent(root: string, id: string, revision: number, type: string, data: unknown): Promise<void> {
  await appendEvent(root, id, revision, type, data);
}

export async function recoverCorruptFeature(root: string, input: {
  featureId: string; stateSha256: string; activeSha256?: string; action: "abandon"; reason: string; userEvidence: string; host: "claude" | "codex";
}): Promise<{ recoveredTo: string; featureId: string; stateSha256: string }> {
  if (input.action !== "abandon") throw new DevFlowError("INVALID_RECOVERY_ACTION", "only abandon is supported in 1.3");
  if (!input.reason || !input.userEvidence) throw new DevFlowError("RECOVERY_EVIDENCE_REQUIRED", "reason and userEvidence are required");
  if (path.basename(input.featureId) !== input.featureId || input.featureId === "." || input.featureId === "..") throw new DevFlowError("INVALID_FEATURE_ID", "recovery featureId must name one feature directory");
  const release = await lock(root, input.featureId, "recover-corrupt");
  try {
    // Fail closed while any rollback journal is open: recovery moves the whole
    // feature directory (journal + backup evidence). Resume the rollback first.
    await assertNoOpenRollbackTransaction(root);
    const openTransaction = await readRecoveryTransaction(root);
    if (openTransaction) {
      if (openTransaction.featureId !== input.featureId || openTransaction.stateSha256 !== input.stateSha256
        || openTransaction.activeSha256 !== input.activeSha256) {
        throw new DevFlowError("RECOVERY_TRANSACTION_MISMATCH", "recovery input does not match the open journal", { recoveryHint: "Use the doctor-reported feature and digest to resume" });
      }
      return resumeRecovery(root, openTransaction);
    }

    let pointerRecovery = false;
    try {
      const active = await readActive(root);
      if (!active || active.featureId !== input.featureId) throw new DevFlowError("RECOVERY_NOT_ACTIVE", "featureId must be the active feature", { recoveryHint: "Run dev_flow_doctor and recover only the active corrupt feature" });
    } catch (error) {
      if (!(error instanceof DevFlowError) || error.code !== "ACTIVE_POINTER_UNREADABLE") throw error;
      if (!input.activeSha256) throw new DevFlowError("RECOVERY_POINTER_DIGEST_REQUIRED", "activeSha256 is required for a corrupt active pointer", { recoveryHint: "Use the active pointer digest from dev_flow_doctor" });
      const currentPointerDigest = await fileSha256(activePath(root));
      if (currentPointerDigest !== input.activeSha256) throw new DevFlowError("RECOVERY_POINTER_DIGEST_MISMATCH", "activeSha256 does not match active.json", { currentDigest: currentPointerDigest, recoveryHint: "Re-run dev_flow_doctor" });
      pointerRecovery = true;
    }

    let digest: string;
    try { digest = await stateFileSha256(root, input.featureId); }
    catch { throw new DevFlowError("RECOVERY_STATE_MISSING", "feature state file is missing", { recoveryHint: "Run dev_flow_doctor; recovery remains fail-closed" }); }
    if (digest !== input.stateSha256) throw new DevFlowError("RECOVERY_DIGEST_MISMATCH", "stateSha256 does not match current corrupt state", { currentDigest: digest, recoveryHint: "Re-run dev_flow_doctor and use the reported stateSha256" });
    try {
      const state = await readState(root, input.featureId);
      if (!pointerRecovery || state.lifecycle !== "active") throw new DevFlowError("RECOVERY_STATE_VALID", "feature state is readable; use abandon instead of recovery");
    } catch (error) {
      if (error instanceof DevFlowError && error.code === "RECOVERY_STATE_VALID") throw error;
      // A corrupt feature state is the ordinary recovery path.
    }

    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const recoveredDir = path.join(devFlow(root), "recovered", `${input.featureId}-${timestamp}`);
    await mkdir(path.join(devFlow(root), "recovered"), { recursive: true });
    const prepared: RecoveryTransaction = {
      schemaVersion: 1, transactionId: randomUUID(), phase: "prepared", featureId: input.featureId, stateSha256: digest, recoveredTo: recoveredDir,
      reason: input.reason, userEvidence: input.userEvidence, host: input.host, at: new Date().toISOString(),
      ...(pointerRecovery ? { activeSha256: input.activeSha256 } : {}),
    };
    await writeAtomic(recoveryTxnPath(root), prepared);
    return resumeRecovery(root, prepared);
  } finally { await release(); }
}

const levelRank: Record<string, number> = { XS: 0, S: 1, M: 2, L: 3 };
const topologyRank: Record<string, number> = { local: 0, "shared-contract": 1, "multi-chain": 2, "coordinated-rollback": 3 };
function isDowngrade(before: Classification, after: Classification): boolean {
  const riskRemoved = before.riskLabels.some((risk) => !after.riskLabels.includes(risk));
  return levelRank[after.level] < levelRank[before.level]
    || topologyRank[after.topology] < topologyRank[before.topology]
    || riskRemoved;
}

function controlsAreWeaker(before: Classification["controls"], after: Classification["controls"]): boolean {
  const planRank = { locate: 0, brief: 1, formal: 2 } as const;
  const reviewRank = { none: 0, focused: 1, independent: 2, full: 3 } as const;
  return before.requirements && !after.requirements
    || planRank[after.plan] < planRank[before.plan]
    || before.trace && !after.trace
    || before.planReview && !after.planReview
    || before.executionApproval && !after.executionApproval
    || before.checkpoints === "unit-chain" && after.checkpoints !== "unit-chain"
    || reviewRank[after.codeReview] < reviewRank[before.codeReview]
    || before.reviewRoles.some((role) => !after.reviewRoles.includes(role))
    || before.recovery.some((kind) => !after.recovery.includes(kind))
    || before.verification.some((kind) => !after.verification.includes(kind));
}

function applyRouteTransition(state: FeatureState, selected: ReturnType<typeof selectRoute>) {
  const previousRoute = state.route;
  const previousDefinition = routeDefinitionForFeature(previousRoute, state.classification.controls);
  const nextDefinition = routeDefinitionForFeature(selected.route, selected.classification.controls);
  const previousArtifacts = new Set([...previousDefinition.requiredArtifacts, ...(previousDefinition.generatedArtifacts ?? [])]);
  const nextArtifacts = new Set([...nextDefinition.requiredArtifacts, ...(nextDefinition.generatedArtifacts ?? [])]);
  const retainedArtifacts = Object.fromEntries(Object.entries(state.artifacts).filter(([kind]) =>
    previousArtifacts.has(kind) && nextArtifacts.has(kind)));
  const retainedSteps: FeatureState["steps"] = {};
  for (const step of nextDefinition.orderedSteps) {
    if (["finalize", "verification"].includes(step)) break;
    if (state.steps[step]?.status !== "satisfied") break;
    retainedSteps[step] = state.steps[step];
  }
  const invalidatedSteps = Object.keys(state.steps).filter((step) => !retainedSteps[step]);
  const invalidatedArtifacts = Object.keys(state.artifacts).filter((kind) => !retainedArtifacts[kind]);
  state.classification = selected.classification;
  state.classificationBasis = selected.classificationBasis;
  state.obligations = selected.obligations;
  state.route = selected.route;
  state.artifacts = retainedArtifacts;
  state.steps = retainedSteps;
  state.humanGates = {};
  state.interactions = {};
  state.verification = { attempts: [] };
  state.logicComplete = false;
  state.currentStage = nextDefinition.orderedSteps.find((step) => retainedSteps[step]?.status !== "satisfied") ?? nextDefinition.orderedSteps[0];
  if (!selected.classification.controls.trace) delete state.traceability;
  if (!selected.classification.controls.planReview) delete state.review;
  return { previousRoute, invalidatedSteps, invalidatedArtifacts };
}

export async function reclassifyFeature(
  root: string,
  id: string,
  expectedRevision: number,
  next: ClassificationInput,
  reason: string,
  userEvidence?: string,
): Promise<FeatureState & { reclassifyNotice?: string }> {
  if (!reason) throw new DevFlowError("RECLASSIFICATION_REASON_REQUIRED", "reclassify requires a reason");
  const release = await lock(root, id, "reclassify");
  try {
    const initial = await readState(root, id);
    if (initial.revision !== expectedRevision) throw new DevFlowError("STATE_REVISION_CONFLICT", "state revision changed", { currentRevision: initial.revision });
    const selectedAtLock = selectRoute(next);
    const events = await readFeatureEvents(root, id);
    const governedWriteStarted = Object.values(initial.workspace.ownershipSource).includes("trusted-hook")
      || events.some((event) => event.type === "trusted-write-owned");
    const changedAtLock = selectedAtLock.route !== initial.route
      || JSON.stringify(selectedAtLock.classification) !== JSON.stringify(initial.classification);
    const weakerAtLock = isDowngrade(initial.classification, selectedAtLock.classification)
      || controlsAreWeaker(initial.classification.controls, selectedAtLock.classification.controls);
    if (governedWriteStarted && weakerAtLock) {
      throw new DevFlowError("RECLASSIFICATION_DOWNGRADE_FORBIDDEN", "首次 governed write 后控制只能单调增加。", {
        recoveryHint: "保留当前控制，或提交不会移除任何 level、风险、审查、恢复或验证保证的更强分类事实",
      });
    }
    if (!changedAtLock) throw new DevFlowError("RECLASSIFICATION_NOT_CHANGED", "分类事实和控制没有发生变化。", { recoveryHint: "无需重分类；继续当前路线" });
    if (!governedWriteStarted && selectedAtLock.classification.routeConfirmationRequired) {
      if (pendingDecisionForState(initial)) throw new DevFlowError("DECISION_ALREADY_PENDING", "先处理当前唯一用户决策，再重算路线。", { recoveryHint: "使用 dev_flow_answer 回答当前问题" });
      const facts = {
        level: selectedAtLock.classification.level,
        topology: selectedAtLock.classification.topology,
        requirements: selectedAtLock.classification.requirements,
        riskLabels: selectedAtLock.classification.riskLabels,
        scopeFacts: selectedAtLock.classificationBasis.scopeFacts,
        topologyFacts: selectedAtLock.classificationBasis.topologyFacts,
        uncertaintyFacts: selectedAtLock.classificationBasis.uncertaintyFacts,
        riskFacts: selectedAtLock.classificationBasis.riskFacts,
        decisionRefs: selectedAtLock.classificationBasis.decisionRefs,
        signals: selectedAtLock.classificationBasis.signals,
      } as ClassificationFacts;
      let presentationEventId: string | undefined;
      return mutatePreparedLocked(root, id, expectedRevision, "route-confirmation-represented", async () => ({ mutate: (draft) => {
        const basisHash = createHash("sha256").update(JSON.stringify({ facts, controls: selectedAtLock.classification.controls, reason })).digest("hex");
        draft.routeConfirmation = { facts, basisHash };
        const interaction = createInteraction(draft, {
          kind: "route-confirmation",
          target: "route-confirmation",
          basisHash,
          question: `分类事实变化，请重新确认路线：${selectedAtLock.classification.orderedRoute.join(" → ")}`,
          options: [{ id: "confirm", label: "确认这条路线" }, { id: "correct", label: "修正分类事实", requiresComment: true }],
        });
        presentationEventId = interaction.presentationEventId;
      }, eventData: () => ({ reason, previousRoute: initial.classification.orderedRoute, nextRoute: selectedAtLock.classification.orderedRoute, presentationEventId }) }));
    }
    let notice: string | undefined;
    let eventData: unknown = { reason };
    const state = await mutatePreparedLocked(root, id, expectedRevision, "reclassified", async (current, nextStateRevision) => {
    const preparedTraceability = traceEnforcementRequired(selectedAtLock.route, selectedAtLock.classification.controls) && !current.traceability
      ? await (async () => {
        const configSnapshot = await readProjectConfigSnapshot(root);
        return writeTraceSnapshot(root, emptyTraceabilityLedger(id, nextStateRevision, configSnapshot.sha256));
      })()
      : undefined;
    const preparedReview = reviewEnforcementRequired(selectedAtLock.route, selectedAtLock.classification.controls) && !current.review
      ? await writeReviewSnapshot(root, emptyReviewLedger(id, nextStateRevision))
      : undefined;
    const reviewInvalidation = current.review
      && (selectedAtLock.route !== current.route || JSON.stringify(selectedAtLock.classification) !== JSON.stringify(current.classification))
      ? await prepareReviewInvalidation(root, current, nextStateRevision)
      : undefined;
    return { mutate: async (draft) => {
    if (draft.lifecycle !== "active") throw new DevFlowError("INVALID_LIFECYCLE", "only an active feature can be reclassified");
    const selected = selectRoute(next);
    if (preparedTraceability) draft.traceability = preparedTraceability;
    if (preparedReview) draft.review = preparedReview;
    if (reviewInvalidation) draft.review = reviewInvalidation;
    const before = draft.classification;
    const after = selected.classification;
    const transition = applyRouteTransition(draft, selected);
    eventData = {
      before, after, previousRoute: transition.previousRoute, nextRoute: selected.route, reason, userEvidence,
      invalidatedSteps: transition.invalidatedSteps, invalidatedArtifacts: transition.invalidatedArtifacts,
    };
    notice = `分类已更新为 ${selected.route}，未继续登记的旧工件保留在磁盘作为审计历史。`;
    }, eventData: () => eventData };
    });
    return notice ? { ...state, reclassifyNotice: notice } : state;
  } finally { await release(); }
}
export function businessFingerprint(contents: string): string { return createHash("sha256").update(contents).digest("hex"); }
