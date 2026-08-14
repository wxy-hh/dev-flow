import { randomUUID, createHash } from "node:crypto";
import { access, mkdir, open, readdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { hostname } from "node:os";
import path from "node:path";
import { normalizeWorkflowCapabilities, reviewLedgerRequired, routeDefinition, routeDefinitionForFeature, traceEnforcementRequired } from "../policy/contract.js";
import { deriveObligations, reopenObligations } from "../policy/obligations.js";
import { SUPPORTED_WORKFLOW_CAPABILITIES, type Classification, type ClassificationBasis, type ClassificationFacts, type ClassificationInput, type ClassificationObligation, type EvidenceFreshness, type FeatureLifecycle, type PendingDecision, type RouteId, type WorkspaceLineage, type WorkflowCapabilities } from "../policy/types.js";
import { EMPTY_GOVERNANCE_LEDGER, type AcceptanceState, type GovernanceLedger } from "../policy/governance-records.js";
import type { InteractionKind, UserInteraction } from "../policy/interaction.js";
import type { TraceabilityPointer } from "../policy/traceability.js";
import type { ReviewPointer } from "../policy/review.js";
import type { ImplementationUnitState } from "../policy/rollback.js";
import { pathWithinFileScope } from "../policy/rollback.js";
import { DevFlowError } from "./errors.js";
import { migrateFeatureState } from "./schema-migration.js";
import { currentOpenStep } from "./step-order.js";
const featureDirectory = (root: string, id: string) => path.join(root, ".dev-flow", "features", id);
import {
  assertRepositoryFactCurrent,
  computeFactFingerprint,
  normalizeFactLocation,
  normalizeRepositoryObservation,
  repositoryFactRecord,
  registerRepositoryFact,
  registerRepositoryFacts,
  type RepositoryFactInput,
} from "./repository-facts.js";
export { registerRepositoryFact, registerRepositoryFacts } from "./repository-facts.js";
import type { DeliveryBaseline, DeliverySnapshot } from "./delivery-snapshot.js";
import { fingerprintGovernedRoots } from "./fingerprint.js";
import { projectConfigImpact, validateProjectConfig, type ProjectConfig } from "./project-config.js";
import { emptyTraceabilityLedger } from "./traceability.js";
import { inspectCurrentTrace } from "./traceability-gates.js";
import { readTraceability } from "./traceability-store.js";
import { readReviewLedger } from "./review-store.js";
import { trustedWriteSummary } from "./workspace-store.js";
import { prepareReviewProjection } from "./review-projection.js";
import { createDecision, resolveDecision, supersedeDecision } from "./decision-ledger.js";
import type { RepairState } from "./repair-loop.js";
import { approvalIds } from "./approval-basis.js";
import { normalizeUnicode } from "./path-normalization.js";
import { captureWorkspaceLineage, ownershipForScope, reconcileWorkspaceForFeature, reconcileWorkspaceLineage } from "./git-reconciliation.js";
import { pendingDecisionForState } from "./decision-interactions.js";
import { assertHostHealth } from "./host-health.js";
import { collectProjectConfigAffectedEvidence, type ProjectConfigAffectedEvidence } from "./project-config-impact.js";
import { executeRepositoryObservation } from "./repository-fact-store.js";
import { checkpointAffectedByPaths, legalActiveUnitChanges, markAffectedEvidenceStale, objectiveForSwitch, presentTaskSwitch, queueNextOwnershipDecision, TASK_SWITCH_QUESTION, unknownOwnershipPaths } from "./ownership-workflow.js";

export { presentWorkspaceOwnership } from "./ownership-workflow.js";
export { reconcileWorkspace } from "./ownership-workflow.js";
export { lockClassification, reclassifyFeature } from "./route-workflow.js";

export {
  recordDecision,
  reviseDecision,
} from "./decision-workflow.js";

export { revisePlanDuringImplementation } from "./plan-revision.js";

export { answer } from "./interaction-answer.js";

export { assertHostHealth, readHostHealth, recordHostHealth } from "./host-health.js";
export type { HostHealthKind, HostHealthSignal } from "./host-health.js";

export type Lifecycle = FeatureLifecycle;
export interface FeatureState {
  schemaVersion: 5; mode: "intake" | "routed"; featureId: string; revision: number; lifecycle: Lifecycle; route: RouteId; classification: Classification;
  objective?: string; investigationSummary?: string; classificationBasis?: ClassificationBasis; obligations?: ClassificationObligation[]; repair?: RepairState;
  /** Core-owned automatic checkpoint summaries for v3 implementation boundaries. */
  checkpoints?: Array<{ checkpointId: string; stage: string; capturedAt: string; fingerprint: string; files: string[]; basisHash: string }>;
  scope: { inScope: string[]; outOfScope: string[] }; steps: Record<string, { status: "pending" | "satisfied"; evidence?: unknown }>;
  humanGates: Record<string, unknown>; artifacts: Record<string, { path: string; sha256: string }>; verification: { attempts: unknown[]; satisfiedByAttemptId?: number; verifiedFingerprint?: string };
  /** Interactive controls are retained as a projection of the decision ledger. */
  interactions?: Record<string, UserInteraction>;
  /** v5 类型隔离的治理记录层：决策/治理声明/授权/凭证/已确认仓库事实。 */
  governance?: GovernanceLedger;
  /** 逐项验收记录与处置状态；与 verification command result 分开存储。 */
  acceptance?: AcceptanceState;
  /** Optional so active features written before traceability capabilities remain readable. */
  workflowCapabilities?: WorkflowCapabilities;
  /** Immutable snapshot pointer; legacy and non-enforced routes may omit it. */
  traceability?: TraceabilityPointer;
  /** Immutable review snapshot pointer; legacy and non-enforced routes may omit it. */
  review?: ReviewPointer;
  /** Runtime lifecycle of implementation units; absent until the first begin and on legacy features. */
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
  resumeSummary?: string;
  /** 最近一次变更失效传播的诊断记录（issue 21：审查后变更回到受影响步骤）。 */
  lastInvalidation?: { at: string; changedFiles?: string[]; reopenedUnits: string[]; reviewReopened: boolean; verificationReopened: boolean; fallback: boolean; reason: string };
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
      || typeof unit.unitId !== "string" || !/^UNIT-[0-9]{3,}$/.test(unit.unitId)
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
    if (ids.has(unit.unitId)) throw new DevFlowError("INVALID_STATE_SCHEMA", "implementation units duplicate an implementation unit");
    if (checkpointed && checkpoints.has(unit.checkpointId!)) throw new DevFlowError("INVALID_STATE_SCHEMA", "implementation units duplicate a checkpoint id");
    ids.add(unit.unitId);
    if (checkpointed) checkpoints.add(unit.checkpointId!);
  }
}

function validateAcceptanceState(value: unknown): asserts value is AcceptanceState {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new DevFlowError("INVALID_STATE_SCHEMA", "acceptance state is invalid");
  const acceptance = value as Partial<AcceptanceState>;
  if (!Array.isArray(acceptance.evidence) || !Array.isArray(acceptance.dispositions)) {
    throw new DevFlowError("INVALID_STATE_SCHEMA", "acceptance state must contain evidence and dispositions arrays");
  }
  const sha = /^[a-f0-9]{64}$/;
  const evidenceIds = new Set<string>();
  for (const record of acceptance.evidence) {
    if (!record || typeof record !== "object" || typeof record.recordId !== "string" || evidenceIds.has(record.recordId)
      || record.kind !== "acceptance-evidence" || !/^AC-[0-9]{3,}$/.test(record.acceptanceCriterionId)
      || !record.basis || record.basis.kind !== "content" || !sha.test(record.basis.sha256)
      || !["browser-operation", "screenshot", "file-inspection", "agent-self-check"].includes(record.evidenceKind)) {
      throw new DevFlowError("INVALID_STATE_SCHEMA", "acceptance evidence record is invalid");
    }
    if (record.artifactSha256 !== undefined && (typeof record.artifactSha256 !== "string" || !sha.test(record.artifactSha256))) {
      throw new DevFlowError("INVALID_STATE_SCHEMA", "acceptance evidence artifact hash is invalid");
    }
    evidenceIds.add(record.recordId);
  }
  const dispositionIds = new Set<string>();
  for (const disposition of acceptance.dispositions) {
    if (!disposition || typeof disposition !== "object" || !/^AC-[0-9]{3,}$/.test(disposition.acceptanceCriterionId)
      || dispositionIds.has(disposition.acceptanceCriterionId)
      || !["behavior-test", "type-check", "rule-check", "file-check", "human-acceptance"].includes(disposition.dispositionKind)
      || !["pending", "satisfied", "stale"].includes(disposition.status)
      || !Array.isArray(disposition.evidenceRefs) || disposition.evidenceRefs.some((id) => typeof id !== "string")
      || !disposition.basis || disposition.basis.kind !== "content" || !sha.test(disposition.basis.sha256)) {
      throw new DevFlowError("INVALID_STATE_SCHEMA", "acceptance disposition state is invalid");
    }
    dispositionIds.add(disposition.acceptanceCriterionId);
  }
}
const interactionKinds = new Set<InteractionKind>(["approval", "grill", "risk-acceptance", "rollback-confirmation", "quality-exception", "workspace-ownership", "route-confirmation", "task-switch", "decision-ratification", "decision-revision", "plan-revision", "side-effect-rerun", "acceptance-confirmation"]);
function validateInteractionRecords(interactions: Record<string, unknown>): void {
  for (const value of Object.values(interactions)) {
    const record = value as Partial<UserInteraction> | undefined;
    if (!record || typeof record !== "object" || Array.isArray(record)
      || typeof record.id !== "string" || !record.id
      || typeof record.kind !== "string" || !interactionKinds.has(record.kind as InteractionKind)
      || typeof record.target !== "string"
      || typeof record.basisHash !== "string"
      || !Array.isArray(record.options)
      || (record.status !== "pending" && record.status !== "resolved")) {
      throw new DevFlowError("INVALID_STATE_SCHEMA", "interaction record is invalid");
    }
  }
}
export function validateFeatureState(value: unknown): asserts value is FeatureState {
  const state = value as Partial<FeatureState>;
  if ([1, 2, 3].includes(Number((state as { schemaVersion?: unknown }).schemaVersion))) throw new DevFlowError("UNSUPPORTED_FEATURE_SCHEMA", "检测到 Dev Flow 4.x 或更早的 active state。", { userMessage: "旧 feature 不能在 Dev Flow 5.0 中继续。", cause: "5.0 不迁移旧 active state。", impact: "系统不会覆盖或猜测旧审计状态。", recoveryKind: "repair", recoveryInstruction: "回到 4.x 完成或放弃该 feature，备份 .dev-flow 后重新初始化。", retryOriginal: false, schemaVersion: (state as { schemaVersion?: unknown }).schemaVersion });
  const schemaVersion = Number((state as { schemaVersion?: unknown }).schemaVersion);
  if (schemaVersion !== 4 && schemaVersion !== 5) throw new DevFlowError("UNSUPPORTED_FEATURE_SCHEMA", "当前只支持 schema v4/v5 状态。", { recoveryHint: "使用 Dev Flow 5.0 重新初始化 feature" });
  if (schemaVersion === 5) {
    // v5 state.json must not persist the removed legacy fields.
    if (Object.keys(state).includes("decisionLedger") || Object.keys(state).includes("qualityExceptions")) {
      throw new DevFlowError("INVALID_STATE_SCHEMA", "v5 运行态不能包含旧 decisionLedger 或 qualityExceptions 字段。", {
        recoveryHint: "通过加载入口转换为 governance 账本后重新写入 v5 state。",
      });
    }
    validateGovernanceLedger(state.governance);
    if (state.acceptance !== undefined) validateAcceptanceState(state.acceptance);
  }
  if (state.mode !== "intake" && state.mode !== "routed") throw new DevFlowError("INVALID_STATE_SCHEMA", "state mode must be intake or routed");
  if (typeof state.featureId !== "string" || !state.featureId || !Number.isInteger(state.revision) || (state.revision ?? -1) < 0 || !lifecycles.has(state.lifecycle as Lifecycle) || !state.scope || !Array.isArray(state.scope.inScope) || !Array.isArray(state.scope.outOfScope) || !state.steps || !state.humanGates || !state.artifacts || !state.verification || !Array.isArray(state.verification.attempts) || (state.interactions !== undefined && (typeof state.interactions !== "object" || state.interactions === null || Array.isArray(state.interactions))) || !Array.isArray(state.blockingFindings) || typeof state.logicComplete !== "boolean" || !state.lastUpdatedBy || !state.workspace || !state.evidenceFreshness) {
    throw new DevFlowError("INVALID_STATE_SCHEMA", "状态不是合法的 feature state。");
  }
  if (state.lastUpdatedBy.host !== "claude" && state.lastUpdatedBy.host !== "codex") throw new DevFlowError("INVALID_STATE_SCHEMA", "lastUpdatedBy host is invalid");
  if (state.interactions !== undefined) validateInteractionRecords(state.interactions);
  const pendingInteractions = Object.values(state.interactions ?? {}).filter((item) => item.status === "pending");
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
  if (state.lifecycle === "finalized" && !state.deliverySnapshot) throw new DevFlowError("INVALID_STATE_SCHEMA", "finalized 状态必须包含交付快照。");
  if (state.lifecycle === "abandoned" && !state.abandonment) throw new DevFlowError("INVALID_STATE_SCHEMA", "abandoned 状态必须包含用户原因。");
  if (state.mode === "intake") {
    if (state.route !== undefined || state.classification !== undefined || state.classificationBasis !== undefined || state.obligations !== undefined) {
      throw new DevFlowError("INVALID_STATE_SCHEMA", "intake state cannot contain route or classification fields");
    }
    return;
  }
  if (!state.route || !routeDefinition(state.route as RouteId) || !state.classification || !state.classificationBasis || !Array.isArray(state.obligations)) {
    throw new DevFlowError("INVALID_STATE_SCHEMA", "routed 状态必须包含分类事实和义务。");
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
  if (reviewLedgerRequired(state.route as RouteId, state.classification.controls) && !state.review) {
    throw new DevFlowError("INVALID_STATE_SCHEMA", "启用审查控制的 feature 必须包含 review pointer。");
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

function invalidGovernance(message: string): DevFlowError {
  return new DevFlowError("INVALID_STATE_SCHEMA", `governance ledger is invalid: ${message}`);
}

function validateRecordBasis(basis: unknown): void {
  if (basis === undefined) return;
  if (!basis || typeof basis !== "object" || Array.isArray(basis)) throw invalidGovernance("record basis must be an object");
  const value = basis as Record<string, unknown>;
  if (value.kind === "content") {
    if (Object.keys(value).some((key) => key !== "kind" && key !== "sha256") || typeof value.sha256 !== "string" || !/^[a-f0-9]{64}$/.test(value.sha256)) {
      throw invalidGovernance("content record basis requires only a valid sha256");
    }
    return;
  }
  if (value.kind === "event") {
    if (Object.keys(value).some((key) => key !== "kind" && key !== "eventId") || typeof value.eventId !== "string" || !value.eventId) {
      throw invalidGovernance("event record basis requires only a non-empty eventId");
    }
    return;
  }
  if (value.kind === "slice") {
    if (Object.keys(value).some((key) => key !== "kind" && key !== "sliceKey" && key !== "sliceHash")
      || typeof value.sliceKey !== "string" || !value.sliceKey
      || typeof value.sliceHash !== "string" || !value.sliceHash) {
      throw invalidGovernance("slice record basis requires only sliceKey and sliceHash");
    }
    return;
  }
  throw invalidGovernance("record basis kind is invalid");
}

function validateGovernanceRecordBase(record: Record<string, unknown>): void {
  if (typeof record.recordId !== "string" || !record.recordId) throw invalidGovernance("record recordId must be a non-empty string");
  if (record.supersededBy !== undefined && (typeof record.supersededBy !== "string" || !record.supersededBy)) throw invalidGovernance("record supersededBy must be a non-empty string");
  if (record.recordedAt !== undefined && typeof record.recordedAt !== "string") throw invalidGovernance("record recordedAt must be a string");
  validateRecordBasis(record.basis);
}

function validateGovernanceLedger(ledger: unknown): void {
  if (!ledger || typeof ledger !== "object" || Array.isArray(ledger)) throw invalidGovernance("ledger must be an object");
  const value = ledger as Record<string, unknown>;
  const arrays: Array<[string, string[]]> = [
    ["decisions", ["decision"]],
    ["claims", ["claim"]],
    ["authorizations", ["authorization"]],
    ["credentials", ["credential"]],
    ["repositoryFacts", ["repository-fact"]],
  ];
  for (const [key, allowedKinds] of arrays) {
    const entries = value[key];
    if (!Array.isArray(entries)) throw invalidGovernance(`${key} must be an array`);
    for (const entry of entries) {
      if (!entry || typeof entry !== "object" || Array.isArray(entry)) throw invalidGovernance(`${key} entries must be objects`);
      const record = entry as Record<string, unknown>;
      if (!allowedKinds.includes(record.kind as string)) throw invalidGovernance(`${key} entry kind must be ${allowedKinds.join(" or ")}`);
      validateGovernanceRecordBase(record);
      switch (record.kind) {
        case "decision":
          if (typeof record.question !== "string" || !record.question.trim()) throw invalidGovernance("decision question must be a non-empty string");
          if (typeof record.conclusion !== "string" || !record.conclusion.trim()) throw invalidGovernance("decision conclusion must be a non-empty string");
          if (record.credentialId !== undefined && typeof record.credentialId !== "string") throw invalidGovernance("decision credentialId must be a string");
          break;
        case "claim":
          if (typeof record.claimType !== "string" || !record.claimType) throw invalidGovernance("claim claimType must be a non-empty string");
          if (typeof record.subject !== "string" || !record.subject) throw invalidGovernance("claim subject must be a non-empty string");
          break;
        case "authorization":
          if (typeof record.authorizationType !== "string" || !record.authorizationType) throw invalidGovernance("authorization authorizationType must be a non-empty string");
          if (typeof record.target !== "string" || !record.target) throw invalidGovernance("authorization target must be a non-empty string");
          if (record.credentialId !== undefined && typeof record.credentialId !== "string") throw invalidGovernance("authorization credentialId must be a string");
          break;
        case "credential":
          if (record.source !== "native-form" && record.source !== "text") throw invalidGovernance("credential source must be native-form or text");
          if (record.host !== "claude" && record.host !== "codex") throw invalidGovernance("credential host must be claude or codex");
          if (typeof record.interactionId !== "string" || !record.interactionId) throw invalidGovernance("credential interactionId must be a non-empty string");
          if (record.optionId !== undefined && typeof record.optionId !== "string") throw invalidGovernance("credential optionId must be a string");
          if (record.rawText !== undefined && typeof record.rawText !== "string") throw invalidGovernance("credential rawText must be a string");
          break;
        case "repository-fact": {
          const location = record.location as Record<string, unknown> | undefined;
          if (!location || typeof location !== "object" || Array.isArray(location)) throw invalidGovernance("repository-fact location must be an object");
          if (typeof record.assertion !== "string" || !record.assertion.trim()) throw invalidGovernance("repository-fact assertion must be a non-empty string");
          if (location.kind === "positive") {
            if (typeof location.path !== "string" || !location.path) throw invalidGovernance("repository-fact positive location path must be a non-empty string");
          } else if (location.kind === "negative") {
            if (!Array.isArray(location.checkedScope) || location.checkedScope.some((item) => typeof item !== "string")) throw invalidGovernance("repository-fact negative checkedScope must be a string array");
            if (typeof location.conditions !== "string" || !location.conditions.trim()) throw invalidGovernance("repository-fact negative conditions must be a non-empty string");
          } else {
            throw invalidGovernance("repository-fact location kind must be positive or negative");
          }
          if (record.observation !== undefined) {
            const observation = record.observation as Record<string, unknown>;
            if (!observation || typeof observation !== "object" || Array.isArray(observation) || typeof observation.kind !== "string") {
              throw invalidGovernance("repository-fact observation must be a tagged object");
            }
            const hasOnly = (keys: string[]) => Object.keys(observation).every((key) => keys.includes(key));
            const nonEmptyPath = () => typeof observation.path === "string" && observation.path.trim().length > 0;
            if (observation.kind === "file-exists") {
              if (!hasOnly(["kind", "path"]) || !nonEmptyPath()) throw invalidGovernance("file-exists observation is invalid");
            } else if (observation.kind === "text-present") {
              if (!hasOnly(["kind", "path", "text", "occurrence"]) || !nonEmptyPath() || typeof observation.text !== "string" || !observation.text.trim()
                || (observation.occurrence !== undefined && (typeof observation.occurrence !== "number" || !Number.isInteger(observation.occurrence) || observation.occurrence < 1))) throw invalidGovernance("text-present observation is invalid");
            } else if (observation.kind === "symbol-present") {
              if (!hasOnly(["kind", "path", "symbol"]) || !nonEmptyPath() || typeof observation.symbol !== "string" || !observation.symbol.trim()) throw invalidGovernance("symbol-present observation is invalid");
            } else if (observation.kind === "json-value") {
              if (!hasOnly(["kind", "path", "pointer", "expected"]) || !nonEmptyPath() || typeof observation.pointer !== "string" || !observation.pointer.startsWith("/")) throw invalidGovernance("json-value observation is invalid");
            } else if (observation.kind === "search-absent") {
              if (!hasOnly(["kind", "checkedScope", "pattern", "patternKind"]) || !Array.isArray(observation.checkedScope) || observation.checkedScope.length === 0
                || observation.checkedScope.some((item) => typeof item !== "string" || !item.trim()) || typeof observation.pattern !== "string" || !observation.pattern.trim()
                || (observation.patternKind !== "literal" && observation.patternKind !== "regex")) throw invalidGovernance("search-absent observation is invalid");
            } else {
              throw invalidGovernance("repository-fact observation kind is invalid");
            }
          }
          if (typeof record.observedFingerprint !== "string" || !record.observedFingerprint) throw invalidGovernance("repository-fact observedFingerprint must be a non-empty string");
          break;
        }
      }
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

export async function writeAtomic(file: string, value: unknown): Promise<void> {
  const temp = `${file}.${randomUUID()}.tmp`; const handle = await open(temp, "w");
  const payload = file.endsWith(`${path.sep}state.json`) && value && typeof value === "object" && (value as { schemaVersion?: unknown }).schemaVersion === 5
    ? (() => {
      const copy = { ...(value as Record<string, unknown>) };
      delete copy.decisionLedger;
      delete copy.qualityExceptions;
      return copy;
    })()
    : value;
  try { await handle.writeFile(`${JSON.stringify(payload, null, 2)}\n`); await handle.sync(); } finally { await handle.close(); }
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
export async function lock(root: string, featureId: string, operation: string): Promise<() => Promise<void>> {
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
    const raw: unknown = JSON.parse(await readFile(statePath(root, featureId), "utf8"));
    validateFeatureState(raw);
    // v4 状态在加载边界一次性、确定地转换到 v5；v5 原样返回。转换保持
    // 幂等：重复读取同一文件得到相同结果，写入只产生 v5 单格式。
    const state = migrateFeatureState(raw);
    if (state.featureId !== featureId) throw new DevFlowError("INVALID_STATE_SCHEMA", "state feature id does not match its path");
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
export interface HostEvent {
  eventId: string;
  type: "user-prompt" | "turn-boundary" | "tool";
  host: "claude" | "codex";
  text?: string;
  toolName?: string;
  executionId?: string;
  result?: "success" | "failure";
  resultSummary?: string;
  at?: string;
}
export interface ReviewExecutionHostEvent {
  eventId: string;
  type: "review-execution";
  host: "claude" | "codex";
  batchId: string;
  jobId: string;
  executionId: string;
  sourceId: string;
  contextId: string;
  implementationContextId: string;
  parentContextId?: string;
  at?: string;
}

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
  if ((hostEvent as { type?: unknown }).type === "review-execution") {
    throw new DevFlowError("REVIEW_EXECUTION_EVENT_INVALID", "review execution proofs must use the dedicated adapter seam");
  }
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

/**
 * 专用审查执行证明接缝。普通 user-prompt/tool/step 事件永远不能被解释成
 * 审查来源或上下文隔离；只有宿主适配器或受控 sampling 入口应调用此函数。
 */
export async function recordReviewExecutionEvent(root: string, hostEvent: ReviewExecutionHostEvent): Promise<void> {
  for (const [key, value] of Object.entries(hostEvent)) {
    if (["at", "parentContextId"].includes(key)) continue;
    if (typeof value !== "string" || !value.trim()) throw new DevFlowError("REVIEW_EXECUTION_EVENT_INVALID", `${key} must be non-empty`);
  }
  const active = await readActive(root);
  if (!active) return;
  const release = await lock(root, active.featureId, "review-execution-event");
  try {
    const state = await readState(root, active.featureId);
    const events = await readFeatureEvents(root, active.featureId);
    if (events.some((item) => item.type === "review-execution" && (item.data as { eventId?: unknown }).eventId === hostEvent.eventId)) return;
    await appendEvent(root, active.featureId, state.revision, "review-execution", { ...hostEvent, at: hostEvent.at ?? new Date().toISOString() });
  } finally { await release(); }
}

export async function recordTrustedWriteIntent(root: string, paths: string[], host: "claude" | "codex", eventId: string): Promise<void> {
  const active = await readActive(root);
  if (!active || paths.length === 0) return;
  const state = await readState(root, active.featureId);
  if (state.mode !== "routed" || state.lifecycle !== "active" || currentOpenStep(state) !== "implementation") return;
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
  if (state.mode !== "routed" || state.lifecycle !== "active" || currentOpenStep(state) !== "implementation") return;
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
  /** 同一次执行的稳定标识（event_id/tool_use_id/permission_request_id）；用于重复通知去重。 */
  executionKey?: string;
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
      let existingPending: ReturnType<typeof pendingDecisionForState>;
      let pendingUnreadable = false;
      try {
        existingPending = pendingDecisionForState(activeState);
      } catch {
        pendingUnreadable = true;
        existingPending = undefined;
      }
      const switchInteractionCreated = !existingPending && !pendingUnreadable;
      if (switchInteractionCreated) {
        // 项目级锁不可重入，持锁期间不能调 mutate；走锁内统一模板，
        // 呈现、校验、投影、事件与 active 指针同步与 mutatePrepared 同管线。
        let presentationEventId: string | undefined;
        await mutatePreparedLocked(root, active.featureId, activeState.revision, "task-switch-presented", async () => ({
          mutate: (draft) => {
            presentationEventId = presentTaskSwitch(draft, { targetFeatureId: id, objective: objectiveForSwitch(input) }).presentationEventId;
          },
          eventData: () => ({ targetFeatureId: id, presentationEventId }),
        }));
      }
      throw new DevFlowError("TASK_SWITCH_REQUIRED", "另一个 feature 当前处于 active 状态。", {
        userMessage: "当前已有一个进行中的任务，请先决定如何处理它。",
        cause: switchInteractionCreated
          ? "系统不会后台 finalize、暂停、终止或切换旧任务。"
          : "旧任务仍有待决问题，系统没有创建 task-switch 交互，也不会后台切换任务。",
        impact: "新任务尚未创建，也没有改变旧任务的执行状态。",
        recoveryKind: "ask-user",
        recoveryInstruction: switchInteractionCreated
          ? "旧任务上有待处理的任务切换问题：先调用 dev_flow_answer 回答它（finish-old=先完成当前任务、pause-old=暂停当前任务后开始新任务、return-old=返回当前任务），再重试开始新任务。"
          : "旧任务有待决问题未解决。先调用 dev_flow_answer 回答该问题，再重试开始新任务。",
        requiresUserDecision: true,
        retryOriginal: false,
        activeFeatureId: active.featureId,
        ...(switchInteractionCreated ? { kind: "task-switch", question: TASK_SWITCH_QUESTION } : {}),
        ...(existingPending ? { kind: existingPending.kind, question: existingPending.question } : {}),
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
        schemaVersion: 5, mode: "intake", featureId: id, revision: 0, lifecycle, objective, scope, workspace: capturedWorkspace, evidenceFreshness: { review: "missing", verification: "missing", checkpoint: "missing", implementation: "current" }, steps: {}, humanGates: {}, artifacts: {},
        verification: { attempts: [] }, acceptance: { evidence: [], dispositions: [] }, interactions: {}, workflowCapabilities, checkpoints: [], startBusinessFingerprint, deliveryBaseline, blockingFindings: [], logicComplete: false,
        governance: { decisions: [], claims: [], authorizations: [], credentials: [], repositoryFacts: [] },
        lastUpdatedBy: { host: input.host, pluginVersion: __DEV_FLOW_VERSION__ },
      } as unknown as FeatureState;
      const ownershipPaths = unknownOwnershipPaths(state);
      state.workspace.unownedPaths = ownershipPaths;
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

/**
 * 登记一条结构化仓库事实（ADR-0018）。事实绑定观察时的内容指纹：
 * 相关内容变化后由 Core 自动重查（assertRepositoryFactCurrent），
 * 无法核实时不通过 BoundaryAudit。
 */
/** Resolve the active-feature switch question through the same interaction contract. */
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
    const openStep = currentOpenStep(state);
    state.resumeSummary = `暂停原因：${reason.trim()}。恢复后先对账工作区，再从${openStep ? `“${openStep}”` : "当前阶段"}继续。`;
    state.lastUpdatedBy = { host, pluginVersion: __DEV_FLOW_VERSION__ };
  }, { reason: reason.trim() });
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
    const openStep = currentOpenStep(state);
    state.resumeSummary = `已恢复${openStep ? `，从“${openStep}”继续` : "当前任务"}。${contentChanged ? "工作区内容有变化，相关证据已标记为待更新。" : ""}`;
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
    }
    state.lastUpdatedBy = { host, pluginVersion: __DEV_FLOW_VERSION__ };
  }, { repaired: ["active-pointer", "freshness", "review/status-projection"] });
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

// ─── Rollback journal: readonly presence gate only ──────────────────────────
// The journal write/lease machinery lives in ./rollback-journal.ts (rollback
// owns phase writes, shape validation, and drive leases). Store keeps only the
// fail-closed "is there an unfinished rollback journal" query so mutate/start/
// lock/recover stay blocked while any rollback is open.

/** A minimal read of a rollback journal for the mutation gate; never a full parse. */
async function readRollbackJournalPresence(root: string, featureId: string): Promise<{ finished: boolean; transactionId: string; featureId: string; phase: string } | undefined> {
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
  const journal = parsed as { phase?: unknown; transactionId?: unknown; featureId?: unknown; completedAt?: unknown };
  if (typeof journal.phase !== "string" || typeof journal.transactionId !== "string" || typeof journal.featureId !== "string") {
    throw new DevFlowError("ROLLBACK_TRANSACTION_UNREADABLE", "rollback transaction journal is invalid", {
      recoveryHint: "Run dev_flow_doctor; the workspace may be mid-rollback — do not hand-edit .dev-flow",
    });
  }
  if (journal.featureId !== featureId) {
    throw new DevFlowError("ROLLBACK_TRANSACTION_UNREADABLE", "rollback transaction journal feature id does not match its path", {
      recoveryHint: "Run dev_flow_doctor; the workspace may be mid-rollback — do not hand-edit .dev-flow",
    });
  }
  // Mirrors rollback-journal's rollbackTransactionFinished: only a terminal
  // phase with a durable completedAt clears the gate.
  const finished = (journal.phase === "committed" || journal.phase === "compensated") && typeof journal.completedAt === "string";
  return { finished, transactionId: journal.transactionId, featureId: journal.featureId, phase: journal.phase };
}

/**
 * Fail-closed mutation guard: an open rollback journal on ANY feature blocks
 * every feature mutation — the plan requires that any open transaction blocks
 * other feature mutations, because the rollback rewrites the shared workspace.
 * The owning transaction commits through via allowTransactionId on its own
 * feature; unreadable journals propagate ROLLBACK_TRANSACTION_UNREADABLE.
 * Reads stay available for status/doctor. rollback-journal's prepare step
 * calls this gate before planting a fresh journal.
 */
export async function assertNoOpenRollbackTransaction(root: string, allow?: { featureId?: string; transactionId?: string }): Promise<void> {
  let entries;
  try { entries = await readdir(features(root), { withFileTypes: true }); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
    throw error;
  }
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const presence = await readRollbackJournalPresence(root, entry.name);
    if (!presence || presence.finished) continue;
    if (allow?.featureId === entry.name && allow.transactionId !== undefined && allow.transactionId === presence.transactionId) continue;
    throw new DevFlowError("ROLLBACK_TRANSACTION_OPEN", "a rollback transaction is open", {
      transactionId: presence.transactionId,
      featureId: entry.name,
      phase: presence.phase,
      recoveryHint: `Resume the rollback transaction for feature ${entry.name} with the same input before mutating features`,
    });
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

export function businessFingerprint(contents: string): string { return createHash("sha256").update(contents).digest("hex"); }
