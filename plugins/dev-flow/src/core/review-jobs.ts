import { createHash, randomUUID } from "node:crypto";
import { toPublicReviewJob, type ReviewAgentAttestation, type ReviewBasis, type ReviewBatch, type ReviewFindingEvent, type ReviewJob, type ReviewLedger, type ReviewSamplingAttempt, type PublicReviewJob } from "../policy/review.js";
import type { AcceptanceCriterionNode, TraceNode, TraceabilityLedger, VerificationDispositionKind } from "../policy/traceability.js";
import type { ReviewAssurance, ReviewDepth, ReviewFinding, ReviewFindingInput, ReviewFindingResolutionInput, ReviewRole } from "../policy/review.js";
import { pathWithinFileScope } from "../policy/rollback.js";
import { REVIEW_ROLE_SEMANTIC_SPECS } from "../policy/review-basis.js";
import {
  assuranceForReview2a,
  assuranceForReviewBatch,
  defaultReviewIdentityVerifier,
  deriveReviewJobRequirements,
  parseHostAttestation,
  parseReviewJobCompletion,
  type ReviewIdentityVerifier,
} from "../policy/review.js";
import { DevFlowError } from "./errors.js";
import { isAbsoluteProjectPath, isCanonicalProjectPath, normalizeUnicode } from "./path-normalization.js";
import { fingerprintFeatureOwned, fingerprintGovernedRoots } from "./fingerprint.js";
import { appendFeatureEvent, mutatePrepared, readFeatureEvents, readState, type FeatureState } from "./state-store.js";
import { assertArtifactCurrent } from "./artifacts.js";
import {
  canonicalReviewValueJson,
  readReviewLedger,
  readReviewPackage,
  reviewSummary,
  semanticReviewBasisHash,
  writeReviewPackage,
  writeReviewSnapshot,
} from "./review-store.js";
import { readProjectConfigSnapshot, readTraceability } from "./traceability-store.js";
import { assertCurrentReviewProjection } from "./review-projection.js";
import { satisfyObligations } from "../policy/obligations.js";
import { assertImplementationPlanTraceCurrent } from "./traceability-gates.js";
import {
  createInteraction,
  findInteractionForTarget,
  getInteraction,
  resolveResponseForAnswer,
  textCompatible,
  toPublicInteraction,
  type PresentedInteraction,
  type PublicInteraction,
} from "./user-interactions.js";
import type { InteractionResponse, UserInteraction } from "../policy/interaction.js";
import type { AnswerResolveContext, AnswerResolveResult } from "./interaction-answer.js";
import { carriedFindings } from "./review-findings.js";
import { effectiveFindingState, unresolvedBlockingFindings } from "./review-findings.js";
import { hasCurrentQualityException } from "./quality-exceptions.js";
import { verificationCommandHashes } from "./project-config.js";
import { currentOpenStep } from "./step-order.js";
import { reviewEnforcementRequired } from "../policy/contract.js";

const digest = (value: string) => createHash("sha256").update(value).digest("hex");
const leaseMilliseconds = 60 * 60 * 1000;
const samplingLeaseMilliseconds = 120 * 1000;
const basisArtifactKinds = ["requirements", "implementation-plan"] as const;

interface FrozenReviewArtifact {
  kind: typeof basisArtifactKinds[number];
  path: string;
  sha256: string;
  contents: string;
}

interface DerivedReviewInput {
  basis: ReviewBasis;
  roleBasisHashes: Record<ReviewRole, string>;
  frozenArtifacts: FrozenReviewArtifact[];
  projectConfig: { sha256: string; contents: string };
  scopeManifest: { governedRoots: string[]; rollbackFileScopes: string[]; traceIds: string[]; frozenArtifactPaths: string[] };
  nonBehaviorDispositions: NonBehaviorDispositionExemption[];
}

/** 一条非行为验证处置豁免：AC 声明不由行为测试验证，及其自报理由与覆盖任务。 */
interface NonBehaviorDispositionExemption {
  criterionId: string;
  dispositionKind: VerificationDispositionKind;
  reason?: string;
  target?: string;
  coveredBy: Array<{ taskId: string; tdd?: "test-first" | "direct" }>;
}

/**
 * 非行为验证处置清单（spec 计划审查既定机制）。计划编译没有可靠的机器信号
 * 能判定任务是否改变行为——任务 tdd 与 AC verificationDisposition 都是调用方
 * 自报。把两组自报并排显式纳入 requirements-coverage 角色的 basis 与审查包：
 * 不当豁免（行为变化却声明 file-check 等非行为处置）成为可定位的显式 finding，
 * 清单本身的变化也会使该角色 basis 失效并触发重审。
 */
function nonBehaviorDispositions(trace: TraceabilityLedger | undefined): NonBehaviorDispositionExemption[] {
  const nodes = Object.values(trace?.nodes ?? {}).filter((node) => node.status !== "tombstoned");
  const coveredBy = new Map<string, Array<{ taskId: string; tdd?: "test-first" | "direct" }>>();
  for (const node of nodes) {
    if (node.kind !== "task") continue;
    for (const covered of node.covers) {
      if (!covered.startsWith("AC-")) continue;
      const list = coveredBy.get(covered) ?? [];
      list.push({ taskId: node.id, ...(node.tdd ? { tdd: node.tdd } : {}) });
      coveredBy.set(covered, list);
    }
  }
  return nodes
    .filter((node): node is AcceptanceCriterionNode => node.kind === "acceptance-criterion"
      && node.verificationDisposition !== undefined
      && node.verificationDisposition.kind !== "behavior-test")
    .map((node) => ({
      criterionId: node.id,
      dispositionKind: node.verificationDisposition!.kind,
      ...(node.verificationDisposition!.reason ? { reason: node.verificationDisposition!.reason } : {}),
      ...(node.verificationDisposition!.target ? { target: node.verificationDisposition!.target } : {}),
      coveredBy: (coveredBy.get(node.id) ?? []).sort((left, right) => left.taskId.localeCompare(right.taskId)),
    }))
    .sort((left, right) => left.criterionId.localeCompare(right.criterionId));
}

export interface CreateReviewBatchResult {
  state: FeatureState;
  batch: ReviewBatch;
  created: boolean;
}

export interface ClaimedReviewJob {
  state: FeatureState;
  batchId: string;
  job: PublicReviewJob;
  capability: string;
  idempotent: boolean;
}

export interface ReleasedReviewJob {
  state: FeatureState;
  batchId: string;
  job: PublicReviewJob;
}

export interface StartedReviewSampling {
  state: FeatureState;
  batchId: string;
  job: PublicReviewJob;
  requestId: string;
  package: unknown;
}

type SamplingFailureCode = "client-error" | "timeout" | "invalid-response" | "validation-failed";

export interface ReviewRiskAcceptancePresentation extends PresentedInteraction {
  idempotent: boolean;
}

function invalid(code: string, message: string, details: Record<string, unknown> = {}): never {
  throw new DevFlowError(code, message, details);
}

function currentBatch(ledger: ReviewLedger, batchId: string): ReviewBatch {
  const batch = ledger.batches.find((candidate) => candidate.batchId === batchId);
  if (!batch) invalid("REVIEW_BATCH_NOT_FOUND", "review batch does not exist", { batchId });
  if (batch!.validity !== "current") invalid("REVIEW_BATCH_STALE", "review batch is stale", { batchId });
  return batch!;
}

/** Keep the review obligation in lock-step with the immutable batch ledger. */
function satisfyCompletedReviewObligation(
  obligations: FeatureState["obligations"],
  batch: ReviewBatch,
): FeatureState["obligations"] {
  return batch.progress === "complete"
    ? satisfyObligations(obligations, ["review"])
    : obligations;
}

function cloneLedger(ledger: ReviewLedger, stateRevision: number, batches: ReviewBatch[], appendedFindingEvents: ReviewFindingEvent[] = []): ReviewLedger {
  return {
    ...ledger,
    revision: ledger.revision + 1,
    stateRevision,
    batches,
    summary: reviewSummary(batches),
    findingEvents: [...(ledger.findingEvents ?? []), ...appendedFindingEvents],
  };
}

function reviewArtifactKinds(state: FeatureState): typeof basisArtifactKinds[number][] {
  // The implementation plan is the only editable source for the execution
  // graph. Coverage/rollback entries remain supported as legacy evidence but
  // are omitted from new review bases when no standalone artifact exists.
  return basisArtifactKinds.filter((kind) => Boolean(state.artifacts[kind]));
}

async function deriveReviewInput(root: string, state: FeatureState): Promise<DerivedReviewInput> {
  const trace = state.traceability ? await readTraceability(root, state) : undefined;
  const { config, sha256: projectConfigSha256 } = await readProjectConfigSnapshot(root);
  const frozenArtifacts = await Promise.all(reviewArtifactKinds(state).map(async (kind) => {
    const artifact = state.artifacts[kind];
    if (!artifact) invalid("REVIEW_BASIS_ARTIFACT_MISSING", `review basis artifact is missing: ${kind}`, { kind });
      let contents: string;
      try { contents = await assertArtifactCurrent(root, state.featureId, state, kind); }
      catch (error) {
        if (error instanceof DevFlowError && error.code === "ARTIFACT_INTEGRITY_FAILED") throw error;
        invalid("REVIEW_BASIS_ARTIFACT_MISSING", `review basis artifact cannot be read: ${kind}`, { kind });
      }
    if (digest(contents!) !== artifact!.sha256) {
      invalid("ARTIFACT_INTEGRITY_FAILED", `review basis artifact was edited without registration: ${kind}`, {
        kind,
        recoveryHint: `Re-register the edited ${kind} artifact with the latest feature revision known before the edit.`,
      });
    }
    return { kind, path: artifact!.path, sha256: artifact!.sha256, contents: contents! };
  }));
      const projectContents = (await readProjectConfigSnapshot(root)).contents;
  if (digest(projectContents) !== projectConfigSha256) {
    invalid("REVIEW_BASIS_UNAVAILABLE", "project configuration changed while review basis was being captured");
  }
  const scopeManifest = {
    inScope: [...state.scope.inScope].sort(),
    outOfScope: [...state.scope.outOfScope].sort(),
    governedRoots: [...config.governedRoots].sort(),
    rollbackFileScopes: Object.values(trace?.nodes ?? {})
      .reduce<Array<{ id: string; fileScope: string[] }>>((scopes, node) => {
        if ((node.kind === "implementation-unit" || node.kind === "rollback") && node.status === "current") {
          scopes.push({ id: node.id, fileScope: [...node.fileScope].sort() });
        }
        return scopes;
      }, [])
      .sort((left, right) => left.id.localeCompare(right.id)),
  };
  // Content fingerprint of protected roots at basis capture time. Batch create and
  // pre-record planning gates must see live drift; post-record revalidation is
  // handled separately so implementation may mutate those same paths.
  const governedRootsFingerprint = await fingerprintGovernedRoots(root, config);
  const featureOwnedFingerprint = await fingerprintFeatureOwned(root, config, state.workspace.ownership);
  const basis: ReviewBasis = {
    featureId: state.featureId,
    route: state.route,
    workflowCapabilities: { ...state.workflowCapabilities ?? { trace: 0, review: 0, checkpoints: 0, rollbackExecution: 0 } },
    classification: {
      level: state.classification.level,
      topology: state.classification.topology,
      ...(state.classification.requirements ? { requirements: state.classification.requirements } : {}),
      riskLabels: [...state.classification.riskLabels].sort(),
    },
    artifacts: frozenArtifacts.map(({ kind, path: artifactPath, sha256 }) => ({ kind, path: artifactPath, sha256 })),
    ...(state.traceability && trace ? { traceability: { path: state.traceability.path, sha256: state.traceability.sha256, revision: trace.revision } } : {}),
    projectConfigSha256,
    verificationCommandHashes: verificationCommandHashes(config),
    scopeManifestSha256: digest(canonicalReviewValueJson(scopeManifest)),
    governedRootsFingerprint,
    featureOwnedFingerprint,
  };
  // 与 deriveReviewJobRequirements 使用同一角色集：controlEnhancements 单独开启
  // planReview（未显式给 reviewRoles）时回退默认 plan 角色，否则 job 有角色
  // 却没有 roleBasisHash，ReviewLedger 校验会以 REVIEW_INTEGRITY_FAILED 拒绝批次。
  const fallbackRoles: ReviewRole[] = ["requirements-coverage", "architecture-testability", "rollback-operability"];
  const baseRoles = state.classification.controls.reviewRoles.length
    ? state.classification.controls.reviewRoles
    : fallbackRoles;
  const roles = [...new Set<ReviewRole>([
    ...baseRoles,
    ...(state.classification.controls.codeReview !== "none" ? ["code-quality" as const, "requirement-fidelity" as const] : []),
  ])];
  const roleBasisHashes = Object.fromEntries(
    roles.map((role) => [role, roleBasisHash(basis, frozenArtifacts, trace, role)]),
  ) as Record<ReviewRole, string>;
  return {
    basis,
    roleBasisHashes,
    frozenArtifacts,
    projectConfig: { sha256: projectConfigSha256, contents: projectContents },
    scopeManifest: {
      governedRoots: scopeManifest.governedRoots,
      rollbackFileScopes: scopeManifest.rollbackFileScopes.flatMap((item) => item.fileScope),
      traceIds: Object.values(trace?.nodes ?? {}).filter((node) => node.status === "current").map((node) => node.id).sort(),
      frozenArtifactPaths: frozenArtifacts.map((artifact) => artifact.path).sort(),
    },
    nonBehaviorDispositions: nonBehaviorDispositions(trace),
  };
}

function basisHash(basis: ReviewBasis): string {
  return semanticReviewBasisHash(basis);
}

export function roleBasisHash(
  basis: ReviewBasis,
  frozenArtifacts: FrozenReviewArtifact[],
  trace: TraceabilityLedger | undefined,
  role: ReviewRole,
): string {
  const spec = REVIEW_ROLE_SEMANTIC_SPECS[role];
  const artifacts = frozenArtifacts
    .filter((artifact) => spec.artifactKinds.includes(artifact.kind))
    .map(({ kind, path: artifactPath, sha256 }) => ({ kind, path: artifactPath, sha256 }));
  const traceSlice = Object.values(trace?.nodes ?? {})
    .filter((node) => node.status !== "tombstoned" && spec.traceKinds.includes(node.kind))
    .sort((left, right) => left.id.localeCompare(right.id))
    .map(({ sourceArtifact: _sourceArtifact, sourceSha256: _sourceSha256, sourceAnchor: _sourceAnchor, sourceBlockSha256: _sourceBlockSha256, status: _status, ...semantic }) => semantic);
  if (spec.riskLabels) {
    // 专项角色绑定自己的风险标签与完整 plan 语义切片；计划/Trace 变化必须
    // 重新审查，避免只因风险标签未变就永久复用旧结果。
    return digest(canonicalReviewValueJson({
      role,
      route: basis.route,
      level: basis.classification.level,
      riskLabels: basis.classification.riskLabels.filter((label) => spec.riskLabels!.includes(label)),
      traceSlice,
    }));
  }
  const referencedCommandIds = spec.bindReferencedCommandHashes
    ? traceSlice.flatMap((node) => node.kind === "implementation-unit" ? node.forwardVerification : [])
        .filter((reference): reference is string => typeof reference === "string")
    : [];
  const referencedCommandHashes = Object.fromEntries([...new Set(referencedCommandIds)].sort()
    .filter((id) => basis.verificationCommandHashes?.[id] !== undefined)
    .map((id) => [id, basis.verificationCommandHashes![id]]));
  return digest(canonicalReviewValueJson({
    role,
    route: basis.route,
    level: basis.classification.level,
    ...(role === "architecture-testability" ? { topology: basis.classification.topology } : {}),
    ...(artifacts.length ? { artifacts } : {}),
    traceSlice,
    ...(spec.bindFeatureOwnedContent
      ? { featureOwnedFingerprint: basis.featureOwnedFingerprint ?? "" }
      : {}),
    ...(spec.bindNonBehaviorDispositions ? { nonBehaviorDispositions: nonBehaviorDispositions(trace) } : {}),
    ...(spec.bindReferencedCommandHashes ? { verificationCommandHashes: referencedCommandHashes } : {}),
  }));
}

function requireClaimRequestId(value: string): void {
  if (typeof value !== "string" || value.length < 24 || !/[A-Za-z]/.test(value) || !/[0-9]/.test(value)) {
    invalid("REVIEW_CLAIM_REQUEST_INVALID", "claimRequestId must be an unguessable high-entropy value");
  }
}

function findJob(batch: ReviewBatch, jobId: string): ReviewJob {
  const job = batch.jobs.find((candidate) => candidate.jobId === jobId);
  if (!job) invalid("REVIEW_JOB_NOT_FOUND", "review job does not exist", { batchId: batch.batchId, jobId });
  return job!;
}

function visibleJob(job: ReviewJob): PublicReviewJob { return toPublicReviewJob(job); }

function recoverExpiredLease(job: ReviewJob, now: Date): ReviewJob {
  if (job.status === "claimed" && job.claim && Date.parse(job.claim.leaseExpiresAt) <= now.getTime()) {
    return { ...job, status: "pending", claim: undefined };
  }
  return job;
}

function activeSamplingAttempt(job: ReviewJob): ReviewSamplingAttempt | undefined {
  return job.samplingAttempts?.find((attempt) => attempt.status === "issued");
}

/** A later mutation cleans up an abandoned server-held sampling lease. */
function recoverExpiredSampling(job: ReviewJob, now: Date): ReviewJob {
  const active = activeSamplingAttempt(job);
  if (job.status !== "sampling" || !active || Date.parse(active.leaseExpiresAt) > now.getTime()) return job;
  return {
    ...job,
    status: "pending",
    samplingAttempts: job.samplingAttempts!.map((attempt) => attempt.requestSha256 !== active.requestSha256 ? attempt : {
      ...attempt,
      status: "failed" as const,
      completedAt: now.toISOString(),
      failureCode: "timeout" as const,
    }),
  };
}

function withDerivedAssurance(batch: ReviewBatch, verifier: ReviewIdentityVerifier = defaultReviewIdentityVerifier): ReviewBatch {
  return { ...batch, assuranceLevel: assuranceForReviewBatch(batch, verifier) };
}

function normalizeHostAttestation(value: unknown, now: Date): ReviewAgentAttestation {
  const parsed = parseHostAttestation(value);
  return {
    ...parsed,
    rawSha256: digest(parsed.raw),
    acceptedAt: now.toISOString(),
  };
}

/** Reject reuse of the same raw attestation across any job in the ledger, including stale batches. */
function assertAttestationUnique(
  ledger: ReviewLedger,
  batchId: string,
  jobId: string,
  attestation: ReviewAgentAttestation,
): void {
  for (const batch of ledger.batches) {
    for (const job of batch.jobs) {
      if (batch.batchId === batchId && job.jobId === jobId) continue;
      if (job.status !== "submitted" || !job.submission?.attestation) continue;
      if (job.submission.attestation.rawSha256 === attestation.rawSha256) {
        invalid("REVIEW_ATTESTATION_REUSED", "the same host attestation cannot be reused across review jobs or successor batches", {
          jobId,
          priorJobId: job.jobId,
          priorBatchId: batch.batchId,
        });
      }
    }
  }
}

function safePackagePath(value: string): boolean {
  const normalized = normalizeUnicode(value);
      return normalized.length > 0 && normalized === normalized.trim() && !isAbsoluteProjectPath(normalized) && !normalized.includes("\\")
        && isCanonicalProjectPath(normalized) && !normalized.split("/").includes("..");
}

function validScopeManifest(value: unknown): value is { governedRoots: string[]; rollbackFileScopes: string[]; traceIds: string[]; frozenArtifactPaths: string[] } {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const manifest = value as { governedRoots?: unknown; rollbackFileScopes?: unknown; traceIds?: unknown; frozenArtifactPaths?: unknown };
  return Array.isArray(manifest.governedRoots) && Array.isArray(manifest.rollbackFileScopes)
    && manifest.governedRoots.every((entry) => typeof entry === "string" && safePackagePath(entry))
    && manifest.rollbackFileScopes.every((entry) => typeof entry === "string" && safePackagePath(entry))
    && Array.isArray(manifest.traceIds) && manifest.traceIds.every((entry) => typeof entry === "string" && /^(?:REQ|AC|TASK|TEST|UNIT|RU|REC)-[0-9]{3,}$/.test(entry))
    && Array.isArray(manifest.frozenArtifactPaths) && manifest.frozenArtifactPaths.every((entry) => typeof entry === "string" && safePackagePath(entry));
}

async function readBoundReviewPackage(
  root: string,
  featureId: string,
  batch: ReviewBatch,
  job: ReviewJob,
): Promise<Record<string, unknown>> {
  const reviewPackage = await readReviewPackage(root, featureId, job.packageSha256);
  if (typeof reviewPackage !== "object" || reviewPackage === null || Array.isArray(reviewPackage)) {
    invalid("REVIEW_INTEGRITY_FAILED", "review package does not belong to its job", { batchId: batch.batchId, jobId: job.jobId });
  }
  const packageRecord = reviewPackage as Record<string, unknown>;
  if (packageRecord.featureId !== featureId
    || packageRecord.batchId !== batch.batchId
    || packageRecord.jobId !== job.jobId
    || packageRecord.basisHash !== batch.basisHash) {
    invalid("REVIEW_INTEGRITY_FAILED", "review package does not belong to its job", { batchId: batch.batchId, jobId: job.jobId });
  }
  return packageRecord;
}

function assertFindingScope(
  manifest: { governedRoots: string[]; rollbackFileScopes: string[]; traceIds: string[]; frozenArtifactPaths: string[] },
  findings: ReviewFindingInput[],
  resolutions: ReviewFindingResolutionInput[],
): void {
  const allowed = [...new Set([...manifest.governedRoots, ...manifest.rollbackFileScopes])];
  const inManifest = (value: string) => {
    const normalized = normalizeUnicode(value);
    return safePackagePath(normalized) && allowed.some((scope) => pathWithinFileScope(normalized, [scope]));
  };
  const validTarget = (value: string) => inManifest(value) || manifest.traceIds.includes(value);
  const validEvidence = (value: string) => inManifest(value) || manifest.frozenArtifactPaths.includes(value);
  const invalidPaths: string[] = [];
  for (const finding of findings) {
    if (finding.severity === "blocking" && !finding.evidence.length) invalid("REVIEW_FINDING_EVIDENCE_REQUIRED", "blocking finding requires evidence");
    invalidPaths.push(...finding.targets.filter((target) => !validTarget(target)));
    invalidPaths.push(...finding.evidence.map((evidence) => evidence.path).filter((path) => !validEvidence(path)));
  }
  invalidPaths.push(...resolutions.flatMap((resolution) => resolution.evidence.map((evidence) => evidence.path).filter((path) => !validEvidence(path))));
  if (invalidPaths.length) {
    invalid("REVIEW_FINDING_SCOPE_INVALID", "finding targets and evidence must be package-relative paths inside the scope manifest", {
      invalidPaths: [...new Set(invalidPaths)].sort(),
      allowedScopes: allowed.sort(),
    });
  }
}

const severityRank = { note: 0, warning: 1, blocking: 2 } as const;

/**
 * A reviewer may repeat the same claim while refining its severity. Persist one
 * immutable finding and retain the strongest severity; duplicates can never
 * turn a blocking claim into a warning or note.
 */
function dedupeFindings(findings: ReviewFindingInput[]): ReviewFindingInput[] {
  const byIdentity = new Map<string, ReviewFindingInput>();
  for (const finding of findings) {
    const identity = canonicalReviewValueJson({
      category: finding.category,
      targets: [...finding.targets].sort(),
      evidence: [...finding.evidence].sort((left, right) => `${left.path}:${left.line ?? 0}`.localeCompare(`${right.path}:${right.line ?? 0}`)),
      claim: finding.claim,
      recommendation: finding.recommendation,
    });
    const existing = byIdentity.get(identity);
    if (!existing || severityRank[finding.severity] > severityRank[existing.severity]) {
      byIdentity.set(identity, { ...finding, targets: [...finding.targets], evidence: finding.evidence.map((evidence) => ({ ...evidence })) });
    }
  }
  return [...byIdentity.values()];
}

export function codeReviewIsolationRequired(state: FeatureState): boolean {
  return state.classification.controls.codeReview === "independent"
    || state.classification.controls.codeReview === "full";
}

function submittedSourceForJob(ledger: ReviewLedger, job: ReviewJob, visited = new Set<string>()): ReviewJob | undefined {
  if (job.status === "submitted") return job;
  if (job.status !== "reused" || !job.reusedFrom) return undefined;
  const key = `${job.reusedFrom.batchId}:${job.reusedFrom.jobId}`;
  if (visited.has(key)) return undefined;
  visited.add(key);
  const sourceBatch = ledger.batches.find((candidate) => candidate.batchId === job.reusedFrom!.batchId);
  const sourceJob = sourceBatch?.jobs.find((candidate) => candidate.jobId === job.reusedFrom!.jobId);
  return sourceJob ? submittedSourceForJob(ledger, sourceJob, visited) : undefined;
}

/** A reused job satisfies isolation only when its original submission carried proof. */
export function jobHasEffectiveIsolationProof(ledger: ReviewLedger, job: ReviewJob): boolean {
  const source = submittedSourceForJob(ledger, job);
  return Boolean(source?.submission?.isolationProof);
}

export interface StartIsolatedReviewResult {
  declarationId: string;
  batchId: string;
  jobId: string;
  executionId: string;
}

/** Parent agent declares a claimed code job for isolated subagent execution. */
export async function startIsolatedReview(
  root: string,
  id: string,
  expectedRevision: number,
  batchId: string,
  jobId: string,
  executionId: string,
  host: "claude" | "codex",
): Promise<StartIsolatedReviewResult> {
  const state = await readState(root, id);
  if (state.revision !== expectedRevision) throw new DevFlowError("STATE_REVISION_CONFLICT", "state revision changed", { currentRevision: state.revision });
  if (state.lifecycle !== "active") invalid("INVALID_LIFECYCLE", "only active features can declare isolated reviews");
  if (!codeReviewIsolationRequired(state) || hasCurrentQualityException(state, "review")) {
    invalid("ISOLATION_NOT_REQUIRED", "current route does not require isolated review or an accepted review quality exception is active");
  }
  const ledger = await readReviewLedger(root, state);
  const batch = ledger.batches.find((candidate) => candidate.validity === "current" && candidate.batchId === batchId);
  if (!batch || (batch.phase ?? "plan") !== "code") invalid("ISOLATION_DECLARATION_BATCH_INVALID", "isolated review must target a current code review batch", { batchId });
  const job = findJob(batch, jobId);
  if (job.status === "submitted" || job.status === "reused") invalid("REVIEW_JOB_ALREADY_SUBMITTED", "review job is already satisfied", { jobId });
  if (!job.claim) invalid("REVIEW_JOB_NOT_CLAIMED", "isolated review must start from a claimed code review job", { jobId });
  const declarationId = randomUUID();
  await appendFeatureEvent(root, id, state.revision, "review-execution-declared", {
    type: "review-execution-declared",
    declarationId,
    batchId,
    jobId,
    executionId,
    host,
    claimRequestSha256: job.claim.requestSha256,
    declaredAt: new Date().toISOString(),
  });
  return { declarationId, batchId, jobId, executionId };
}

/** Create is idempotent for an unchanged Core-computed basis. */

/** 纯函数：创建新批次时只把同 phase 的 current 批次置 stale（GPT-005）。 */
export function staleCurrentBatchesOfPhase(batches: ReviewBatch[], phase: "plan" | "code"): ReviewBatch[] {
  return batches.map((candidate) =>
    candidate.validity === "current" && candidate.phase === phase
      ? { ...candidate, validity: "stale" as const }
      : candidate);
}

export async function createReviewBatch(
  root: string,
  id: string,
  expectedRevision: number,
): Promise<CreateReviewBatchResult> {
  let result: CreateReviewBatchResult | undefined;
  const state = await mutatePrepared(root, id, expectedRevision, "review-batch-created", async (current, nextStateRevision) => {
    if (current.lifecycle !== "active") invalid("INVALID_LIFECYCLE", "only active features can create review batches");
    const phase = currentOpenStep(current) === "code_review" ? "code" : "plan";
    // Plan review must never start on a missing/stale implementation-plan slice.
    const currentTrace = current.traceability ? await readTraceability(root, current) : undefined;
    if (currentTrace) await assertImplementationPlanTraceCurrent(root, current as FeatureState, currentTrace);
    const ledger = await readReviewLedger(root, current);
    const reviewInput = await deriveReviewInput(root, current);
    const { basis } = reviewInput;
    const currentBasisHash = basisHash(basis);
    const requirements = deriveReviewJobRequirements(current.route, current.classification.riskLabels, current.classification.controls.reviewRoles, phase);
    const isolationRequired = phase === "code"
      && codeReviewIsolationRequired(current)
      && !hasCurrentQualityException(current, "review");
    const existing = ledger.batches.find((batch) => batch.validity === "current" && (batch.phase ?? "plan") === phase && batch.basisHash === currentBasisHash);
    const existingRolesCurrent = existing && requirements.every((requirement) => {
      const job = existing.jobs.find((candidate) => candidate.role === requirement.role);
      return job?.roleBasisHash === reviewInput.roleBasisHashes[requirement.role];
    });
    const existingIsolationSatisfied = existing && (!isolationRequired || requirements.every((requirement) => {
      const job = existing.jobs.find((candidate) => candidate.role === requirement.role);
      return job !== undefined && jobHasEffectiveIsolationProof(ledger, job);
    }));
    if (existing && existingRolesCurrent && existingIsolationSatisfied) {
      result = { state: undefined as unknown as FeatureState, batch: existing, created: false };
      return { mutate: () => undefined, unchanged: true, eventData: { batchId: existing.batchId, basisHash: currentBasisHash, idempotent: true } };
    }
    if (!requirements.length) invalid("REVIEW_ROUTE_UNSUPPORTED", "当前动态路线没有启用独立 plan-review 角色。");
    const carriedByRole = new Map<string, Array<{ finding: ReviewFinding; originBatchId: string; basisHash: string }>>();
    const reusableByRole = new Map<string, { batch: ReviewBatch; job: ReviewJob }>();
    for (const requirement of requirements) {
      const currentRoleBasisHash = reviewInput.roleBasisHashes[requirement.role];
      const carried = carriedFindings(ledger, requirement.role, currentRoleBasisHash);
      carriedByRole.set(requirement.role, carried);
      const reusable = carried.length === 0
        ? [...ledger.batches].reverse().flatMap((candidate) => candidate.jobs.map((job) => ({ batch: candidate, job })))
          .find(({ job }) => job.role === requirement.role
            && job.roleBasisHash === currentRoleBasisHash
            && job.status === "submitted"
            && job.submission
            && (!isolationRequired || jobHasEffectiveIsolationProof(ledger, job)))
        : undefined;
      if (reusable?.job.submission) reusableByRole.set(requirement.role, reusable);
    }
    const batchId = randomUUID();
    const jobs: ReviewJob[] = [];
    for (const requirement of requirements) {
      const jobId = randomUUID();
      const currentRoleBasisHash = reviewInput.roleBasisHashes[requirement.role];
      const reusable = reusableByRole.get(requirement.role);
      if (reusable?.job.submission) {
        jobs.push({
          jobId,
          role: requirement.role,
          reviewDepth: requirement.reviewDepth,
          packageSha256: reusable.job.packageSha256,
          roleBasisHash: currentRoleBasisHash,
          status: "reused",
          reusedFrom: { batchId: reusable.batch.batchId, jobId: reusable.job.jobId, submissionSha256: reusable.job.submission.payloadSha256 },
        });
        continue;
      }
      const carried = carriedByRole.get(requirement.role) ?? [];
      const packageSha256 = await writeReviewPackage(root, current.featureId, {
        schemaVersion: 2,
        featureId: current.featureId,
        batchId,
        jobId,
        basis,
        basisHash: currentBasisHash,
        frozenArtifacts: reviewInput.frozenArtifacts,
        projectConfig: reviewInput.projectConfig,
        scopeManifest: reviewInput.scopeManifest,
        role: requirement.role,
        reviewDepth: requirement.reviewDepth,
        // requirements-coverage 的审查包显式列出非行为处置豁免清单（含覆盖任务的
        // tdd 自报），让「行为变化却豁免行为测试」成为可定位的显式 finding 对象。
        ...(requirement.role === "requirements-coverage" ? { nonBehaviorDispositions: reviewInput.nonBehaviorDispositions } : {}),
        carriedFindings: carried.map((item) => ({
          findingId: item.finding.findingId,
          originBatchId: item.originBatchId,
          originRole: requirement.role,
          basisHash: item.basisHash,
          claim: item.finding.claim,
          evidence: item.finding.evidence,
        })),
      });
      jobs.push({
        jobId,
        role: requirement.role,
        reviewDepth: requirement.reviewDepth,
        packageSha256,
        roleBasisHash: currentRoleBasisHash,
        status: "pending",
        ...(carried.length ? { carriedFindings: carried.map((item) => ({
          findingId: item.finding.findingId,
          originBatchId: item.originBatchId,
          originRole: requirement.role,
          basisHash: item.basisHash,
          claim: item.finding.claim,
          evidence: item.finding.evidence,
        })) } : {}),
      });
    }
    const batch: ReviewBatch = {
      batchId,
      phase,
      basis,
      basisHash: currentBasisHash,
      validity: "current",
      progress: jobs.every((job) => job.status === "reused") ? "complete" : "open",
      executionMode: "parallel-execution",
      assuranceLevel: assuranceForReview2a(),
      jobs,
    };
    const batches = [
      ...staleCurrentBatchesOfPhase(ledger.batches, phase),
      batch,
    ];
    const pointer = await writeReviewSnapshot(root, cloneLedger(ledger, nextStateRevision, batches));
    result = { state: undefined as unknown as FeatureState, batch, created: true };
    return {
      mutate: (draft) => {
        draft.review = pointer;
        // A new current batch replaces the evidence that satisfied this phase.
        // Only the phase being re-created reopens; the other phase stays intact.
        if (phase === "plan") delete draft.steps.planning;
        else delete draft.steps.code_review;
      },
      eventData: {
        batchId,
        basisHash: currentBasisHash,
        roles: jobs.map((job) => job.role),
      },
    };
  });
  return { ...result!, state };
}

/** A job package is capability-protected; callers without the secret cannot read it. */
export async function getReviewJob(
  root: string,
  id: string,
  batchId: string,
  jobId: string,
  capability: string,
): Promise<{ job: PublicReviewJob; package: unknown }> {
  const state = await readState(root, id);
  const batch = currentBatch(await readReviewLedger(root, state), batchId);
  const job = findJob(batch, jobId);
  if (!job.claim || digest(capability) !== job.claim.requestSha256) invalid("REVIEW_JOB_CAPABILITY_INVALID", "review job capability is invalid");
  const reviewPackage = await readBoundReviewPackage(root, id, batch, job);
  return { job: visibleJob(job), package: reviewPackage };
}

export async function claimReviewJob(
  root: string,
  id: string,
  expectedRevision: number,
  batchId: string,
  jobId: string,
  claimRequestId: string,
  now = new Date(),
): Promise<ClaimedReviewJob> {
  requireClaimRequestId(claimRequestId);
  let result: Omit<ClaimedReviewJob, "state"> | undefined;
  const state = await mutatePrepared(root, id, expectedRevision, "review-job-claimed", async (current, nextStateRevision) => {
    const ledger = await readReviewLedger(root, current);
    const batch = currentBatch(ledger, batchId);
    const requestSha256 = digest(claimRequestId);
    const original = findJob(batch, jobId);
    const job = recoverExpiredSampling(recoverExpiredLease(original, now), now);
    if (job.status === "submitted" || job.status === "reused") invalid("REVIEW_JOB_ALREADY_SUBMITTED", "review job is already satisfied", { jobId });
    if (job.status === "sampling") invalid("REVIEW_JOB_SAMPLING_IN_PROGRESS", "review job is held by server sampling", { jobId });
    if (job.status === "claimed" && job.claim!.requestSha256 !== requestSha256) {
      invalid("REVIEW_JOB_ALREADY_CLAIMED", "review job is claimed by another capability", { jobId });
    }
    const idempotent = job.status === "claimed";
    const claimed = idempotent ? job : {
      ...job,
      status: "claimed" as const,
      claim: { requestSha256, claimedAt: now.toISOString(), leaseExpiresAt: new Date(now.getTime() + leaseMilliseconds).toISOString() },
    };
    result = { batchId, job: visibleJob(claimed), capability: claimRequestId, idempotent };
    if (idempotent) return { mutate: () => undefined, unchanged: true, eventData: { batchId, jobId, idempotent: true } };
    const batches = ledger.batches.map((candidate) => candidate.batchId !== batchId ? candidate : {
      ...candidate,
      jobs: candidate.jobs.map((candidateJob) => candidateJob.jobId === jobId ? claimed : candidateJob),
    });
    const pointer = await writeReviewSnapshot(root, cloneLedger(ledger, nextStateRevision, batches));
    return { mutate: (draft) => { draft.review = pointer; }, eventData: { batchId, jobId } };
  });
  return { ...result!, state };
}

/** Release only the exact claim that supplied the capability; expired claims are
 * still releasable by their original holder, while other callers must reclaim. */
export async function releaseReviewJob(
  root: string,
  id: string,
  expectedRevision: number,
  batchId: string,
  jobId: string,
  capability: string,
): Promise<ReleasedReviewJob> {
  let result: Omit<ReleasedReviewJob, "state"> | undefined;
  const state = await mutatePrepared(root, id, expectedRevision, "review-job-released", async (current, nextStateRevision) => {
    const ledger = await readReviewLedger(root, current);
    const batch = currentBatch(ledger, batchId);
    const original = findJob(batch, jobId);
    if (original.status === "submitted") invalid("REVIEW_JOB_ALREADY_SUBMITTED", "review job has already been submitted", { jobId });
    if (original.status === "sampling") invalid("REVIEW_JOB_SAMPLING_IN_PROGRESS", "review job is held by server sampling", { jobId });
    if (original.status !== "claimed" || !original.claim) invalid("REVIEW_JOB_NOT_CLAIMED", "review job is not currently claimed", { jobId });
    if (digest(capability) !== original.claim.requestSha256) invalid("REVIEW_JOB_CAPABILITY_INVALID", "review job capability is invalid");
    const released: ReviewJob = { ...original, status: "pending", claim: undefined };
    const updatedBatch = {
      ...batch,
      jobs: batch.jobs.map((candidate) => candidate.jobId === jobId ? released : candidate),
    };
    const pointer = await writeReviewSnapshot(root, cloneLedger(
      ledger,
      nextStateRevision,
      ledger.batches.map((candidate) => candidate.batchId === batchId ? updatedBatch : candidate),
    ));
    result = { batchId, job: visibleJob(released) };
    return {
      mutate: (draft) => { draft.review = pointer; },
      eventData: { batchId, jobId },
    };
  });
  return { ...result!, state };
}

export interface SubmittedReviewJob {
  batch: ReviewBatch;
  payloadSha256: string;
  findingEvents: ReviewFindingEvent[];
}

function normalizeReviewCompletion(parsed: ReturnType<typeof parseReviewJobCompletion>): ReturnType<typeof parseReviewJobCompletion> {
  return {
    ...parsed,
    findings: parsed.findings.map((finding) => ({
      ...finding,
      targets: finding.targets.map(normalizeUnicode),
      evidence: finding.evidence.map((evidence) => ({ ...evidence, path: normalizeUnicode(evidence.path) })),
    })),
    ...(parsed.resolutions ? {
      resolutions: parsed.resolutions.map((resolution) => ({
        ...resolution,
        evidence: resolution.evidence.map((evidence) => ({ ...evidence, path: normalizeUnicode(evidence.path) })),
      })),
    } : {}),
  };
}

export async function submitParsedReviewJob(
  root: string,
  featureId: string,
  ledger: ReviewLedger,
  batch: ReviewBatch,
  job: ReviewJob,
  parsed: ReturnType<typeof parseReviewJobCompletion>,
  now: Date,
  samplingAttempt?: ReviewSamplingAttempt,
  hostAttestation?: ReviewAgentAttestation,
  attestationSourceVerified = false,
  isolationProof?: { mode: "subagent" | "sampling"; hostEventId?: string },
): Promise<SubmittedReviewJob> {
  const normalizedParsed = normalizeReviewCompletion(parsed);
  if (normalizedParsed.findings.some((finding) => finding.category !== job.role)) {
    invalid("REVIEW_FINDING_ROLE_MISMATCH", "a job may only submit findings for its assigned review role", { jobId: job.jobId, role: job.role });
  }
  if (samplingAttempt && hostAttestation) {
    invalid("REVIEW_ATTESTATION_INVALID", "server sampling submissions cannot carry host attestation");
  }
  if (hostAttestation) assertAttestationUnique(ledger, batch.batchId, job.jobId, hostAttestation);
  const reviewPackage = await readBoundReviewPackage(root, featureId, batch, job);
  if (!validScopeManifest(reviewPackage.scopeManifest)) {
    invalid("REVIEW_INTEGRITY_FAILED", "review package scope manifest is invalid", { jobId: job.jobId });
  }
  const manifest = reviewPackage.scopeManifest;
  assertFindingScope(manifest, normalizedParsed.findings, normalizedParsed.resolutions ?? []);
  const dispositions = { ...batch.dispositions };
  const findingEvents: ReviewFindingEvent[] = [];
  const resolvedIds = new Set<string>();
  for (const resolution of normalizedParsed.resolutions ?? []) {
    if (resolvedIds.has(resolution.findingId)) invalid("REVIEW_RESOLUTION_DUPLICATE", "a finding may be resolved only once per successor batch", { findingId: resolution.findingId });
    const source = ledger.batches
      .filter((candidate) => candidate.batchId !== batch.batchId)
      .flatMap((candidate) => candidate.jobs.map((candidateJob) => ({ batch: candidate, job: candidateJob })))
      .find(({ job: candidateJob }) => candidateJob.submission?.findings.some((finding) => finding.findingId === resolution.findingId));
    const finding = source?.job.submission?.findings.find((candidate) => candidate.findingId === resolution.findingId);
    if (!source || !finding) invalid("REVIEW_RESOLUTION_UNKNOWN_FINDING", "resolution references an unknown prior finding", { findingId: resolution.findingId });
    if (finding.severity !== "blocking" || source.job.role !== job.role) {
      invalid("REVIEW_RESOLUTION_ROLE_MISMATCH", "only the same role may resolve a prior blocking finding", { findingId: resolution.findingId });
    }
    if (dispositions[resolution.findingId]) {
      invalid("REVIEW_RESOLUTION_ALREADY_DISPOSED", "a prior finding already has a disposition", { findingId: resolution.findingId });
    }
    dispositions[resolution.findingId] = {
      kind: "resolved-in-successor",
      successorBatchId: batch.batchId,
      resolutionJobId: job.jobId,
      resolvedAt: now.toISOString(),
    };
    const outcome = resolution.outcome ?? "resolved";
    findingEvents.push(outcome === "resolved"
      ? {
          type: "resolved",
          findingId: resolution.findingId,
          successorBatchId: batch.batchId,
          resolutionJobId: job.jobId,
          basisHash: job.roleBasisHash,
          evidence: resolution,
          at: now.toISOString(),
        }
      : {
          type: "still-blocking",
          findingId: resolution.findingId,
          successorBatchId: batch.batchId,
          resolutionJobId: job.jobId,
          basisHash: job.roleBasisHash,
          reason: resolution.note,
          at: now.toISOString(),
        });
    resolvedIds.add(resolution.findingId);
  }
  const payloadSha256 = digest(canonicalReviewValueJson(normalizedParsed));
  const findings: ReviewFinding[] = dedupeFindings(normalizedParsed.findings).map((finding) => ({
    ...finding,
    findingId: `F-${randomUUID()}`,
    jobId: job.jobId,
  }));
  for (const finding of findings) {
    findingEvents.push({ type: "origin", finding, batchId: batch.batchId, role: job.role, basisHash: job.roleBasisHash, at: now.toISOString() });
  }
  const missingCarried = (job.carriedFindings ?? []).filter((finding) => !resolvedIds.has(finding.findingId));
  if (missingCarried.length) {
    invalid("REVIEW_CARRIED_FINDING_UNRESOLVED", "每个结转 blocker 都必须提交明确处置结果", {
      findingIds: missingCarried.map((finding) => finding.findingId),
      recoveryHint: "为每个 carried finding 提交 resolved、still-blocking 或 risk-acceptance-required 结果",
    });
  }
  const completedAt = now.toISOString();
  const samplingAttempts = samplingAttempt
    ? job.samplingAttempts!.map((attempt) => attempt.requestSha256 !== samplingAttempt.requestSha256 ? attempt : {
      ...attempt,
      status: "submitted" as const,
      completedAt,
      payloadSha256,
    })
    : job.samplingAttempts;
  const submitted: ReviewJob = {
    ...job,
    status: "submitted",
    ...(samplingAttempt ? { claim: undefined } : {}),
    ...(samplingAttempts ? { samplingAttempts } : {}),
    submission: {
      payloadSha256,
      coverageSummary: normalizedParsed.coverageSummary,
      findings,
      resolutions: normalizedParsed.resolutions ?? [],
      submittedAt: completedAt,
      ...(samplingAttempt ? {
        samplingProvenance: {
          requestSha256: samplingAttempt.requestSha256,
          issuedAt: samplingAttempt.issuedAt,
          completedAt,
        },
      } : {}),
      ...(hostAttestation ? { attestation: hostAttestation } : {}),
      ...(hostAttestation && attestationSourceVerified ? { attestationSourceVerified: true } : {}),
      ...(isolationProof ? { isolationProof } : {}),
    },
  };
  let updatedBatch: ReviewBatch = {
    ...batch,
    jobs: batch.jobs.map((candidate) => candidate.jobId === job.jobId ? submitted : candidate),
    ...(Object.keys(dispositions).length ? { dispositions } : {}),
  };
  updatedBatch = {
    ...updatedBatch,
    progress: updatedBatch.jobs.every((candidate) => candidate.status === "submitted" || candidate.status === "reused") ? "complete" : "open",
  };
  return { batch: withDerivedAssurance(updatedBatch), payloadSha256, findingEvents };
}

export async function submitReviewJob(
  root: string,
  id: string,
  expectedRevision: number,
  batchId: string,
  jobId: string,
  capability: string,
  completion: unknown,
  attestationOrNow?: unknown,
  maybeNow?: Date,
): Promise<{ state: FeatureState; batch: ReviewBatch; idempotent: boolean }> {
  // Back-compat: older call sites pass `now` as the 8th argument.
  const attestation = attestationOrNow instanceof Date ? undefined : attestationOrNow;
  const now = attestationOrNow instanceof Date
    ? attestationOrNow
    : (maybeNow instanceof Date ? maybeNow : new Date());
  const parsed = parseReviewJobCompletion(completion);
  const hostAttestation = attestation === undefined ? undefined : normalizeHostAttestation(attestation, now);
  // Core 来源校验（ADR-0007）：attestation 声明的宿主事件必须真实存在于
  // 当前 feature 事件账本且来自同宿主；验证结果由 Core 写入，调用方不能
  // 自行声明来源可信。
  let attestationSourceVerified = false;
  let isolationProven = false;
  if (hostAttestation?.hostEventId) {
    const events = await readFeatureEvents(root, id);
    // 只接受专用 review-execution 事件。user-prompt、tool、started、step-recorded
    // 以及调用方自带的 isolated/agentId/raw 都不是来源或隔离证明。
    const execution = events.find((event) => {
      const data = event.data as Partial<{ eventId: string; type: string; host: string; batchId: string; jobId: string; sourceId: string; executionId: string; contextId: string; implementationContextId: string }> | undefined;
      return event.type === "review-execution"
        && data?.type === "review-execution"
        && data.eventId === hostAttestation.hostEventId
        && data.host === hostAttestation.host
        && data.batchId === batchId
        && data.jobId === jobId
        && typeof data.sourceId === "string" && data.sourceId.length > 0
        && typeof data.executionId === "string" && data.executionId.length > 0
        && typeof data.contextId === "string" && data.contextId.length > 0
        && typeof data.implementationContextId === "string" && data.implementationContextId.length > 0;
    });
    attestationSourceVerified = execution !== undefined;
    isolationProven = execution !== undefined
      && execution.data !== undefined
      && (execution.data as { contextId?: string; implementationContextId?: string }).contextId !== (execution.data as { implementationContextId?: string }).implementationContextId;
  }
  let result: Omit<{ state: FeatureState; batch: ReviewBatch; idempotent: boolean }, "state"> | undefined;
  const state = await mutatePrepared(root, id, expectedRevision, "review-job-submitted", async (current, nextStateRevision) => {
    const ledger = await readReviewLedger(root, current);
    const batch = currentBatch(ledger, batchId);
    const job = findJob(batch, jobId);
    const payloadSha256 = digest(canonicalReviewValueJson(parsed));
    if (job.status === "sampling") invalid("REVIEW_JOB_SAMPLING_IN_PROGRESS", "review job is held by server sampling", { jobId });
    if (!job.claim || digest(capability) !== job.claim.requestSha256) {
      invalid("REVIEW_JOB_CAPABILITY_INVALID", "review job capability is invalid");
    }
    if (job.status === "submitted") {
      if (job.submission?.payloadSha256 !== payloadSha256) invalid("REVIEW_SUBMISSION_CONFLICT", "review job was submitted with a different payload", { jobId });
      if (hostAttestation) {
        const existing = job.submission?.attestation;
        if (!existing || existing.rawSha256 !== hostAttestation.rawSha256
          || existing.agentId !== hostAttestation.agentId || existing.host !== hostAttestation.host) {
          invalid("REVIEW_SUBMISSION_CONFLICT", "review job was submitted with a different host attestation", { jobId });
        }
      } else if (job.submission?.attestation) {
        invalid("REVIEW_SUBMISSION_CONFLICT", "review job was submitted with a different host attestation", { jobId });
      }
      result = { batch, idempotent: true };
      return { mutate: () => undefined, unchanged: true, eventData: { batchId, jobId, idempotent: true } };
    }
    if (Date.parse(job.claim.leaseExpiresAt) <= now.getTime()) invalid("REVIEW_JOB_LEASE_EXPIRED", "review job lease has expired", {
      jobId,
      leaseExpiresAt: job.claim.leaseExpiresAt,
      recoveryHint: "重新 claim 当前 job 后再提交；过期租约不会自动保留提交权",
    });
    let submitted: SubmittedReviewJob;
    try {
      submitted = await submitParsedReviewJob(root, id, ledger, batch, job, parsed, now, undefined, hostAttestation, attestationSourceVerified, isolationProven && hostAttestation?.hostEventId ? { mode: "subagent", hostEventId: hostAttestation.hostEventId } : undefined);
    } catch (error) {
      if (error instanceof DevFlowError) {
        invalid(error.code, error.message, {
          ...error.details,
          claimRetained: true,
          leaseExpiresAt: job.claim.leaseExpiresAt,
          retryHint: "修正 completion、scope 或 attestation 后，在当前租约内重试提交",
        });
      }
      throw error;
    }
    const batches = ledger.batches.map((candidate) => candidate.batchId === batchId ? submitted.batch : candidate);
    const pointer = await writeReviewSnapshot(root, cloneLedger(ledger, nextStateRevision, batches, submitted.findingEvents));
    result = { batch: submitted.batch, idempotent: false };
    return {
      mutate: (draft) => {
        draft.review = pointer;
        draft.obligations = satisfyCompletedReviewObligation(draft.obligations, submitted.batch);
      },
      eventData: {
        batchId,
        jobId,
        payloadSha256: submitted.payloadSha256,
        ...(hostAttestation ? { attestationRawSha256: hostAttestation.rawSha256, agentId: hostAttestation.agentId } : {}),
      },
    };
  });
  return { ...result!, state };
}

function samplingCurrentBatch(ledger: ReviewLedger, batchId: string): ReviewBatch {
  const batch = ledger.batches.find((candidate) => candidate.batchId === batchId);
  if (!batch || batch.validity !== "current") {
    invalid("REVIEW_SAMPLING_REQUEST_REPLAY", "sampling request is not valid for a current review batch", { batchId });
  }
  return batch;
}

function samplingAttemptForRequest(job: ReviewJob, requestId: string): ReviewSamplingAttempt {
  const requestSha256 = digest(requestId);
  const attempt = activeSamplingAttempt(job);
  if (job.status !== "sampling" || !attempt || attempt.requestSha256 !== requestSha256) {
    invalid("REVIEW_SAMPLING_REQUEST_REPLAY", "sampling request was already consumed or does not belong to this job", { jobId: job.jobId });
  }
  return attempt;
}

/** Reserve exactly one pending job for a short-lived server-side sampling request. */
export async function beginReviewSampling(
  root: string,
  id: string,
  expectedRevision: number,
  batchId: string,
  jobId: string,
  now = new Date(),
): Promise<StartedReviewSampling> {
  let result: Omit<StartedReviewSampling, "state"> | undefined;
  const state = await mutatePrepared(root, id, expectedRevision, "review-sampling-started", async (current, nextStateRevision) => {
    const ledger = await readReviewLedger(root, current);
    const batch = currentBatch(ledger, batchId);
    const original = findJob(batch, jobId);
    const job = recoverExpiredSampling(original, now);
    if (job.status === "submitted") invalid("REVIEW_JOB_ALREADY_SUBMITTED", "review job has already been submitted", { jobId });
    if (job.status === "claimed") invalid("REVIEW_JOB_ALREADY_CLAIMED", "review job is claimed by a human capability", { jobId });
    if (job.status === "sampling") invalid("REVIEW_JOB_SAMPLING_IN_PROGRESS", "review job is already held by server sampling", { jobId });
    const requestId = `${randomUUID()}-${randomUUID()}`;
    const attempt: ReviewSamplingAttempt = {
      requestSha256: digest(requestId),
      issuedAt: now.toISOString(),
      leaseExpiresAt: new Date(now.getTime() + samplingLeaseMilliseconds).toISOString(),
      status: "issued",
    };
    const sampling: ReviewJob = {
      ...job,
      status: "sampling",
      claim: undefined,
      samplingAttempts: [...job.samplingAttempts ?? [], attempt],
    };
    const packageContents = await readBoundReviewPackage(root, id, batch, sampling);
    const updatedBatch = withDerivedAssurance({
      ...batch,
      executionMode: "parallel-execution",
      jobs: batch.jobs.map((candidate) => candidate.jobId === jobId ? sampling : candidate),
    });
    const pointer = await writeReviewSnapshot(root, cloneLedger(
      ledger,
      nextStateRevision,
      ledger.batches.map((candidate) => candidate.batchId === batchId ? updatedBatch : candidate),
    ));
    result = { batchId, job: visibleJob(sampling), requestId, package: packageContents };
    return {
      mutate: (draft) => { draft.review = pointer; },
      eventData: { batchId, jobId, requestSha256: attempt.requestSha256 },
    };
  });
  return { ...result!, state };
}

/** Burn an issued request and return the job to human-claimable pending state. */
export async function failReviewSampling(
  root: string,
  id: string,
  expectedRevision: number,
  batchId: string,
  jobId: string,
  requestId: string,
  failureCode: SamplingFailureCode,
  now = new Date(),
): Promise<FeatureState> {
  return mutatePrepared(root, id, expectedRevision, "review-sampling-failed", async (current, nextStateRevision) => {
    const ledger = await readReviewLedger(root, current);
    const batch = samplingCurrentBatch(ledger, batchId);
    const job = findJob(batch, jobId);
    const attempt = samplingAttemptForRequest(job, requestId);
    const failed: ReviewJob = {
      ...job,
      status: "pending",
      samplingAttempts: job.samplingAttempts!.map((candidate) => candidate.requestSha256 !== attempt.requestSha256 ? candidate : {
        ...candidate,
        status: "failed" as const,
        completedAt: now.toISOString(),
        failureCode,
      }),
    };
    const updatedBatch = withDerivedAssurance({
      ...batch,
      jobs: batch.jobs.map((candidate) => candidate.jobId === jobId ? failed : candidate),
    });
    const pointer = await writeReviewSnapshot(root, cloneLedger(
      ledger,
      nextStateRevision,
      ledger.batches.map((candidate) => candidate.batchId === batchId ? updatedBatch : candidate),
    ));
    return {
      mutate: (draft) => { draft.review = pointer; },
      eventData: { batchId, jobId, requestSha256: attempt.requestSha256, failureCode },
    };
  });
}

/** Submit one valid server-sampled completion. The server-held request is consumed exactly once. */
export async function completeReviewSampling(
  root: string,
  id: string,
  expectedRevision: number,
  batchId: string,
  jobId: string,
  requestId: string,
  completion: unknown,
  now = new Date(),
): Promise<{ state: FeatureState; batch: ReviewBatch }> {
  const parsed = parseReviewJobCompletion(completion);
  let result: Omit<{ state: FeatureState; batch: ReviewBatch }, "state"> | undefined;
  const state = await mutatePrepared(root, id, expectedRevision, "review-sampling-submitted", async (current, nextStateRevision) => {
    const ledger = await readReviewLedger(root, current);
    const batch = samplingCurrentBatch(ledger, batchId);
    const job = findJob(batch, jobId);
    const attempt = samplingAttemptForRequest(job, requestId);
    if (Date.parse(attempt.leaseExpiresAt) <= now.getTime()) {
      invalid("REVIEW_SAMPLING_REQUEST_EXPIRED", "sampling request lease has expired", { jobId });
    }
    // 受控 server sampling 是 Core 权威的隔离上下文（spec §188 / issue 19）：
    // 采样完成的 job 直接获得 sampling 隔离证明，不依赖任何调用方自述。
    const submitted = await submitParsedReviewJob(root, id, ledger, batch, job, parsed, now, attempt, undefined, false, { mode: "sampling" });
    const pointer = await writeReviewSnapshot(root, cloneLedger(
      ledger,
      nextStateRevision,
      ledger.batches.map((candidate) => candidate.batchId === batchId ? submitted.batch : candidate),
      submitted.findingEvents,
    ));
    result = { batch: submitted.batch };
    return {
      mutate: (draft) => {
        draft.review = pointer;
        draft.obligations = satisfyCompletedReviewObligation(draft.obligations, submitted.batch);
      },
      eventData: { batchId, jobId, requestSha256: attempt.requestSha256, payloadSha256: submitted.payloadSha256 },
    };
  });
  return { ...result!, state };
}

interface LocatedFinding {
  batch: ReviewBatch;
  job: ReviewJob;
  finding: ReviewFinding;
}

function submittedFindings(ledger: ReviewLedger): LocatedFinding[] {
  return ledger.batches.flatMap((batch) => batch.jobs.flatMap((job) =>
    (job.submission?.findings ?? []).map((finding) => ({ batch, job, finding }))));
}

function sortedFindingIds(findingIds: string[]): string[] {
  if (!Array.isArray(findingIds) || !findingIds.length || findingIds.some((id) => typeof id !== "string" || !id)) {
    invalid("REVIEW_RISK_ACCEPTANCE_INVALID", "risk acceptance requires one or more finding ids");
  }
  const sorted = [...findingIds].sort();
  if (new Set(sorted).size !== sorted.length) {
    invalid("REVIEW_RISK_ACCEPTANCE_INVALID", "risk acceptance finding ids must be unique");
  }
  return sorted;
}

function findingSetHash(batch: ReviewBatch, findings: ReviewFinding[]): string {
  const items = findings
    .map((finding) => ({ findingId: finding.findingId, sha256: digest(canonicalReviewValueJson(finding)) }))
    .sort((left, right) => left.findingId.localeCompare(right.findingId));
  return digest(canonicalReviewValueJson({ batchId: batch.batchId, basisHash: batch.basisHash, findings: items }));
}

function riskBinding(interaction: UserInteraction): { batchId: string; findingIds: string[]; findingSetHash: string } {
  const binding = interaction.binding;
  if (interaction.kind !== "risk-acceptance" || !binding || typeof binding.batchId !== "string"
    || typeof binding.findingSetHash !== "string" || !Array.isArray(binding.findingIds)) {
    invalid("REVIEW_RISK_ACCEPTANCE_INVALID", "interaction is not a valid review risk-acceptance decision", { interactionId: interaction.id });
  }
  return { batchId: binding!.batchId, findingIds: sortedFindingIds(binding!.findingIds), findingSetHash: binding!.findingSetHash };
}

function planReviewBoundToBatch(state: FeatureState, batch: ReviewBatch): boolean {
  const evidence = state.steps.planning?.evidence as { batchId?: unknown; basisHash?: unknown } | undefined;
  return state.steps.planning?.status === "satisfied"
    && evidence?.batchId === batch.batchId
    && evidence?.basisHash === batch.basisHash;
}

async function currentBatchWithBasis(
  root: string,
  state: FeatureState,
  options: { requireLiveBasis?: boolean } = {},
): Promise<{ ledger: ReviewLedger; batch: ReviewBatch }> {
  const ledger = await readReviewLedger(root, state);
  const batch = ledger.batches.find((candidate) => candidate.validity === "current");
  if (!batch) invalid("REVIEW_BATCH_REQUIRED", "a current review batch is required");
  // Once planning has bound this exact batch, later governed-root implementation
  // edits must not invent a new live basis; verification freshness owns that drift.
  const requireLiveBasis = options.requireLiveBasis ?? !planReviewBoundToBatch(state, batch!);
  const reviewInput = await deriveReviewInput(root, state);
  if (requireLiveBasis) {
    if (basisHash(reviewInput.basis) !== batch!.basisHash) {
      invalid("REVIEW_BASIS_STALE", "review batch basis no longer matches current feature state", {
        batchId: batch!.batchId,
        recoveryHint: "重建批次→重交 jobs→re-record planning",
      });
    }
  }
  // Even after planning binds a batch, a referenced verification command may
  // change without changing the overall semantic basis. Role slices still
  // have to match so architecture/rollback review evidence cannot be reused
  // across a changed execution command.
  const phase = batch!.phase ?? "plan";
  const requirements = deriveReviewJobRequirements(state.route, state.classification.riskLabels, state.classification.controls.reviewRoles, phase);
  for (const requirement of requirements) {
    const job = batch!.jobs.find((candidate) => candidate.role === requirement.role);
    if (!job || job.roleBasisHash !== reviewInput.roleBasisHashes[requirement.role]) {
      invalid("REVIEW_BASIS_STALE", "review role basis no longer matches current feature semantics", {
        batchId: batch!.batchId,
        role: requirement.role,
        recoveryHint: "重建批次→重交受影响 role job→re-record planning",
      });
    }
  }
  return { ledger, batch: batch! };
}

function currentBlockingFindings(ledger: ReviewLedger, batch: ReviewBatch): LocatedFinding[] {
  if (ledger.findingEvents?.length) {
    const roleBasis = (origin: ReviewFindingEvent & { type: "origin" }) => batch.jobs.find((job) => job.role === origin.role)?.roleBasisHash;
    return unresolvedBlockingFindings(ledger, roleBasis).flatMap((finding) => {
      const state = effectiveFindingState(ledger, finding.findingId, roleBasis);
      if (!state) return [];
      const sourceBatch = ledger.batches.find((candidate) => candidate.batchId === state.origin.batchId);
      const sourceJob = sourceBatch?.jobs.find((candidate) => candidate.jobId === finding.jobId);
      return sourceBatch && sourceJob ? [{ batch: sourceBatch, job: sourceJob, finding }] : [];
    });
  }
  const dispositions = batch.dispositions ?? {};
  return submittedFindings(ledger).filter(({ batch: source, finding }) => source.batchId === batch.batchId
    && finding.severity === "blocking" && !dispositions[finding.findingId]);
}

function acceptanceFindings(ledger: ReviewLedger, batch: ReviewBatch, findingIds: string[]): ReviewFinding[] {
  return selectCurrentBlockingFindings(ledger, batch, findingIds, true);
}

function selectCurrentBlockingFindings(
  ledger: ReviewLedger,
  batch: ReviewBatch,
  findingIds: string[],
  unresolvedOnly: boolean,
): ReviewFinding[] {
  if (ledger.findingEvents?.length) {
    const roleBasis = (origin: ReviewFindingEvent & { type: "origin" }) => batch.jobs.find((job) => job.role === origin.role)?.roleBasisHash;
    const unresolved = new Map(unresolvedBlockingFindings(ledger, roleBasis)
      .filter((finding) => effectiveFindingState(ledger, finding.findingId, roleBasis)?.status !== "needs-revalidation")
      .map((finding) => [finding.findingId, finding]));
    const selected = sortedFindingIds(findingIds).map((findingId) => unresolved.get(findingId));
    if (selected.some((finding) => !finding)) invalid("REVIEW_RISK_ACCEPTANCE_INVALID", "风险接受只能覆盖当前未解决的阻断发现", { findingIds });
    return selected as ReviewFinding[];
  }
  const byId = new Map(submittedFindings(ledger)
    .filter(({ batch: source, finding }) => source.batchId === batch.batchId
      && finding.severity === "blocking" && (!unresolvedOnly || !batch.dispositions?.[finding.findingId]))
    .map(({ finding }) => [finding.findingId, finding]));
  const selected = sortedFindingIds(findingIds).map((findingId) => byId.get(findingId));
  if (selected.some((finding) => !finding)) {
    invalid("REVIEW_RISK_ACCEPTANCE_INVALID", "risk acceptance can cover only current unresolved blocking findings", {
      batchId: batch.batchId,
      findingIds,
    });
  }
  return selected as ReviewFinding[];
}

/** Present a one-time, exact-set acceptance decision for current blocking findings. */
export async function presentReviewRiskAcceptance(
  root: string,
  id: string,
  expectedRevision: number,
  findingIds: string[],
): Promise<ReviewRiskAcceptancePresentation> {
  let result: Omit<ReviewRiskAcceptancePresentation, "state"> | undefined;
  let presentationEventId: string | undefined;
  const state = await mutatePrepared(root, id, expectedRevision, "review-risk-acceptance-presented", async (current) => {
    const { ledger, batch } = await currentBatchWithBasis(root, current as FeatureState);
    if (batch.progress !== "complete") invalid("REVIEW_BATCH_INCOMPLETE", "all required review jobs must be submitted", { batchId: batch.batchId });
    const findings = acceptanceFindings(ledger, batch, findingIds);
    const ids = findings.map((finding) => finding.findingId).sort();
    const setHash = findingSetHash(batch, findings);
    const target = `review-risk:${batch.batchId}:${setHash}`;
    const existing = findInteractionForTarget(current as FeatureState, target);
    if (existing) {
      result = { interaction: toPublicInteraction(existing), interactionId: existing.id, idempotent: true };
      return { mutate: () => undefined, unchanged: true, eventData: { batchId: batch.batchId, findingSetHash: setHash, idempotent: true } };
    }
    return {
      mutate: (draft) => {
        const interaction = createInteraction(draft, {
          kind: "risk-acceptance",
          target,
          basisHash: batch.basisHash,
          binding: { batchId: batch.batchId, findingIds: ids, findingSetHash: setHash },
          question: "接受这些阻断性审查发现的风险？此操作只适用于当前审查批次与精确发现集合。",
          options: [
            { id: "accept", label: "接受风险", requiresComment: true },
            { id: "decline", label: "不接受" },
          ],
        });
        presentationEventId = interaction.presentationEventId;
        result = { interaction: toPublicInteraction(interaction), interactionId: interaction.id, idempotent: false };
      },
      eventData: () => ({ batchId: batch.batchId, findingIds: ids, findingSetHash: setHash, presentationEventId }),
    };
  });
  return { ...result!, state };
}

function assertResolvedAcceptance(
  state: FeatureState,
  interaction: UserInteraction,
  batch: ReviewBatch,
  findings: ReviewFinding[],
): void {
  const binding = riskBinding(interaction);
  const expectedIds = findings.map((finding) => finding.findingId).sort();
  const expectedSetHash = findingSetHash(batch, findings);
  if (interaction.basisHash !== batch.basisHash || binding.batchId !== batch.batchId
    || binding.findingSetHash !== expectedSetHash || binding.findingIds.join("\n") !== expectedIds.join("\n")) {
    invalid("REVIEW_RISK_ACCEPTANCE_STALE", "risk acceptance no longer matches the current batch and finding set", { interactionId: interaction.id });
  }
  if (state.interactions?.[interaction.id] !== interaction) {
    invalid("REVIEW_RISK_ACCEPTANCE_INVALID", "risk acceptance interaction is not part of feature state", { interactionId: interaction.id });
  }
}

/** Validate the user event before a risk-acceptance answer can consume it. */
export function assertReviewRiskAcceptanceEvidence(
  event: { revision: number; at: string; data: unknown } | undefined,
  interaction: Pick<UserInteraction, "presentedAt">,
  promptEventId: string | undefined,
  userReply: string,
  host: "claude" | "codex",
): void {
  if (!event) {
    throw new DevFlowError("INTERACTION_PROVENANCE_UNAVAILABLE", "no matching user prompt event was captured", {
      eventId: promptEventId,
      recoveryHint: "使用当前宿主捕获的后续 user-prompt event 再重试",
    });
  }
  const payload = event.data as { eventId?: unknown; host?: unknown; type?: unknown; text?: unknown; at?: unknown };
  if (payload.host !== host) {
    throw new DevFlowError("HOST_EVENT_HOST_MISMATCH", "host event belongs to a different host", {
      expectedHost: host,
      actualHost: payload.host,
      eventId: promptEventId,
    });
  }
  if (payload.eventId !== promptEventId || payload.type !== "user-prompt") {
    throw new DevFlowError("INTERACTION_PROVENANCE_UNAVAILABLE", "the referenced event is not a user prompt", {
      eventId: promptEventId,
      recoveryHint: "使用当前宿主捕获的 user-prompt event 再重试",
    });
  }
  if (!textCompatible(String(payload.text ?? ""), userReply)) {
    throw new DevFlowError("REVIEW_RISK_ACCEPTANCE_REPLY_MISMATCH", "userReply must be compatible with the captured prompt text", {
      eventId: promptEventId,
      recoveryHint: "传入与 host event 语义兼容的 userReply",
    });
  }
  const eventTime = Date.parse(typeof payload.at === "string" ? payload.at : event.at);
  const presentedTime = Date.parse(interaction.presentedAt);
  if (Number.isNaN(eventTime) || Number.isNaN(presentedTime) || eventTime <= presentedTime) {
    throw new DevFlowError("REVIEW_RISK_ACCEPTANCE_SAME_TURN", "risk acceptance must come from a later user turn", {
      eventId: promptEventId,
      recoveryHint: "在风险接受交互呈现后的后续回合重新提交",
    });
  }
}

/** 审查风险接受经统一回答入口落账（ADR-0019）：绑定当前批次与精确发现集合，原子持久化。 */
export async function resolveReviewRiskAcceptanceForAnswer(ctx: AnswerResolveContext): Promise<AnswerResolveResult> {
  const { root, featureId, expectedRevision, host, credential, interaction, state } = ctx;
  if (interaction.kind !== "risk-acceptance" || (interaction.status !== "pending" && interaction.status !== "resolved")) {
    throw new DevFlowError("INTERACTION_NOT_PENDING", "当前没有待处理的审查风险接受问题。", { interactionId: interaction.id });
  }
  let promptEventId: string | undefined;
  let promptText: string | undefined;
  if (credential.source === "text") {
    promptEventId = credential.promptEventId;
    promptText = credential.promptText;
    const events = await readFeatureEvents(root, featureId);
    const hostEvent = events.find((event) => event.type === "host-event"
      && (event.data as { eventId?: unknown }).eventId === promptEventId);
    assertReviewRiskAcceptanceEvidence(hostEvent, interaction, promptEventId, promptText, host);
  }
  let response: InteractionResponse | undefined;
  let replayed = false;
  const next = await mutatePrepared(root, featureId, expectedRevision, "review-risk-acceptance-resolved", async (current, nextStateRevision) => {
    const live = getInteraction(current as FeatureState, interaction.id);
    const { ledger, batch } = await currentBatchWithBasis(root, current as FeatureState);
    const binding = riskBinding(live);
    if (live.status === "resolved") {
      // 幂等重放：accept 是原子写入，交互已解决即 disposition 与 finding 事件已落账；
      // 这里只做 binding 与批次匹配校验，不再要求 finding 保持未解决。
      const resolvedFindings = submittedFindings(ledger)
        .filter(({ batch: source, finding }) => source.batchId === batch.batchId && binding.findingIds.includes(finding.findingId))
        .map(({ finding }) => finding);
      assertResolvedAcceptance(current as FeatureState, live, batch, resolvedFindings);
      const accepted = credential.source === "text"
        ? live.response?.action === "accept"
          && live.response.source === "text"
          && live.response.userReply === promptText
          && live.response.promptEventId === promptEventId
          && live.response.host === host
        : live.response?.action === "accept"
          && live.response.source === "elicitation"
          && live.response.host === host;
      const dispositions = batch.dispositions ?? {};
      if (accepted && resolvedFindings.every((finding) => {
        const disposition = dispositions[finding.findingId];
        return disposition?.kind === "risk-accepted" && disposition.interactionId === live.id
          && disposition.findingSetHash === binding.findingSetHash;
      })) {
        replayed = true;
        return { mutate: () => undefined, unchanged: true, eventData: { interactionId: interaction.id, idempotent: true } };
      }
      invalid("INTERACTION_ALREADY_RESOLVED", interaction.id);
    }
    const findings = acceptanceFindings(ledger, batch, binding.findingIds);
    assertResolvedAcceptance(current as FeatureState, live, batch, findings);
    const resolveOn = (draft: FeatureState) => resolveResponseForAnswer(draft, interaction, {
      source: credential.source,
      action: credential.source === "elicitation" ? credential.action : undefined,
      comment: credential.source === "elicitation" ? credential.comment : undefined,
      userReply: credential.source === "text" ? promptText : undefined,
      promptText,
      promptEventId,
      host,
    });
    const preview = structuredClone(current as FeatureState);
    const previewResponse = resolveOn(preview);
    if (previewResponse.action !== "accept") {
      return {
        mutate: (draft) => { response = resolveOn(draft); },
        eventData: { interactionId: interaction.id, batchId: batch.batchId, action: previewResponse.action },
      };
    }
    const dispositions = { ...batch.dispositions };
    for (const finding of findings) {
      dispositions[finding.findingId] = {
        kind: "risk-accepted",
        interactionId: interaction.id,
        acceptedAt: previewResponse.respondedAt,
        batchId: batch.batchId,
        basisHash: batch.basisHash,
        findingIds: binding.findingIds,
        findingSetHash: binding.findingSetHash,
      };
    }
    const updatedBatch = { ...batch, dispositions };
    const findingEvents: ReviewFindingEvent[] = findings.map((finding) => {
      const source = submittedFindings(ledger).find((candidate) => candidate.finding.findingId === finding.findingId);
      return {
        type: "risk-accepted",
        findingId: finding.findingId,
        batchId: batch.batchId,
        interactionId: interaction.id,
        basisHash: source?.job.roleBasisHash ?? batch.jobs.find((job) => job.role === finding.category)?.roleBasisHash ?? batch.basisHash,
        findingSetHash: binding.findingSetHash,
        userEvidence: previewResponse.comment ?? (credential.source === "text" ? (promptText ?? credential.promptText) : credential.action),
        at: previewResponse.respondedAt,
      };
    });
    const pointer = await writeReviewSnapshot(root, cloneLedger(
      ledger,
      nextStateRevision,
      ledger.batches.map((candidate) => candidate.batchId === batch.batchId ? updatedBatch : candidate),
      findingEvents,
    ));
    return {
      mutate: (draft) => {
        response = resolveOn(draft);
        draft.review = pointer;
      },
      eventData: { interactionId: interaction.id, batchId: batch.batchId, findingIds: binding.findingIds, findingSetHash: binding.findingSetHash },
    };
  });
  if (response) return { state: next, action: response.action, ...(response.comment ? { comment: response.comment } : {}) };
  if (replayed) return { state: next, action: "accept" };
  throw new DevFlowError("INTERACTION_NOT_RESOLVED", interaction.id);
}

/**
 * 统一的“当前未解决严重发现”查询（issue 16）：只有 reviewGate 与 inspect
 * 读取这组集合（inspect 为展示、gate 为就绪判定），二者共用同一归约。
 * 两条路径（findingEvents 派生、旧格式 jobs + dispositions 派生）都收敛于此。
 * @internal 不是公开就绪 API——就绪只问 reviewGate。
 */
export function currentUnresolvedBlocking(
  ledger: ReviewLedger,
  batch: ReviewBatch,
  state: Pick<FeatureState, "interactions">,
): ReviewFinding[] {
  if (ledger.findingEvents?.length) {
    const roleBasis = (origin: ReviewFindingEvent & { type: "origin" }) => batch.jobs.find((job) => job.role === origin.role)?.roleBasisHash;
    return unresolvedBlockingFindings(ledger, roleBasis);
  }
  const jobs = ledger.batches.flatMap((candidate) => candidate.jobs);
  const dispositions = Object.assign({}, ...ledger.batches.map((candidate) => candidate.dispositions ?? {}));
  return jobs.flatMap((job) => job.submission?.findings ?? [])
    .filter((finding) => {
      if (finding.severity !== "blocking") return false;
      const disposition = dispositions[finding.findingId];
      if (!disposition) return true;
      if (disposition.kind === "risk-accepted") {
        // A user decision is valid only for this exact current basis and frozen finding set.
        if (disposition.batchId !== batch.batchId || disposition.basisHash !== batch.basisHash) return true;
        const interaction = state.interactions?.[disposition.interactionId];
        if (!interaction || interaction.kind !== "risk-acceptance" || interaction.status !== "resolved"
          || interaction.response?.action !== "accept" || interaction.basisHash !== batch.basisHash) return true;
        let binding: { batchId: string; findingIds: string[]; findingSetHash: string };
        try { binding = riskBinding(interaction); } catch { return true; }
        if (binding.batchId !== batch.batchId || binding.findingSetHash !== disposition.findingSetHash
          || binding.findingIds.join("\n") !== [...disposition.findingIds].sort().join("\n")
          || !binding.findingIds.includes(finding.findingId)) return true;
        const acceptedFindings = submittedFindings(ledger)
          .filter(({ batch: source, finding: candidate }) => source.batchId === batch.batchId
            && binding.findingIds.includes(candidate.findingId))
          .map(({ finding: candidate }) => candidate);
        if (acceptedFindings.length !== binding.findingIds.length
          || acceptedFindings.some((candidate) => candidate.severity !== "blocking")
          || findingSetHash(batch, acceptedFindings) !== binding.findingSetHash) return true;
        return false;
      }
      const successor = ledger.batches.find((candidate) => candidate.batchId === disposition.successorBatchId);
      const resolutionJob = successor?.jobs.find((candidate) => candidate.jobId === disposition.resolutionJobId);
      const sourceJob = jobs.find((candidate) => candidate.jobId === finding.jobId);
      return !successor || !resolutionJob || !sourceJob || resolutionJob.role !== sourceJob.role
        || !resolutionJob.submission?.resolutions.some((resolution) => resolution.findingId === finding.findingId);
    });
}

/** 审查就绪时写入步骤证据的 stamp（batchId / basisHash / assuranceLevel）。 */
export interface ReviewStamp {
  batchId: string;
  basisHash: string;
  assuranceLevel: ReviewAssurance;
}

/**
 * 审查就绪的唯一公开 seam（ADR-0023）。返回就绪或一种缺口，不返回 NextAction，
 * 不对外暴露 deficit 集合。调用方：nextAction 调度、recordStep/begin 门禁、inspect。
 */
export type ReviewGateResult =
  | { status: "ready"; stamp?: ReviewStamp }
  | { status: "need-batch"; cause: "missing" | "stale" | "phase"; batchId?: string }
  | { status: "jobs-open"; batchId: string; jobs: Array<{ jobId: string; role: ReviewRole; reviewDepth: ReviewDepth; status: "pending" | "claimed" | "sampling" | "submitted" | "reused" }> }
  | { status: "blocking"; batchId: string; findingIds: string[] }
  | { status: "isolation"; batchId: string; jobIds: string[] };

export interface ReviewGateQuery {
  phase?: "plan" | "code";
}

/** 某相位是否存在审查义务：plan 跟 planReview，code 跟 codeReview（与 reviewLedgerRequired 一致）。 */
function reviewObligation(state: FeatureState, phase: "plan" | "code"): boolean {
  if (state.mode !== "routed") return false;
  if (phase === "code") return state.classification.controls.codeReview !== "none";
  return reviewEnforcementRequired(state.route, state.classification.controls);
}

/** 与 currentBatchWithBasis 相同的基础新鲜度判定，但用布尔表达缺口而不是抛错。 */
async function reviewBasisStale(root: string, state: FeatureState, batch: ReviewBatch, phase: "plan" | "code"): Promise<boolean> {
  const requireLiveBasis = !planReviewBoundToBatch(state, batch);
  const reviewInput = await deriveReviewInput(root, state);
  if (requireLiveBasis && basisHash(reviewInput.basis) !== batch.basisHash) return true;
  const requirements = deriveReviewJobRequirements(state.route, state.classification.riskLabels, state.classification.controls.reviewRoles, phase);
  for (const requirement of requirements) {
    const job = batch.jobs.find((candidate) => candidate.role === requirement.role);
    if (!job || job.roleBasisHash !== reviewInput.roleBasisHashes[requirement.role]) return true;
  }
  return false;
}

function reviewJobsSummary(batch: ReviewBatch): Array<{ jobId: string; role: ReviewRole; reviewDepth: ReviewDepth; status: "pending" | "claimed" | "sampling" | "submitted" | "reused" }> {
  return batch.jobs.map(({ jobId, role, reviewDepth, status }) => ({ jobId, role, reviewDepth, status }));
}

/**
 * 审查就绪门禁（ADR-0023）。无审查义务时直接就绪且不读 ledger；有义务时
 * 按 need-batch → jobs-open → isolation → blocking → ready 的先到先胜次序
 * 给一种结果。投影不可读在本将就绪时 fail-closed（抛修复错误，不当日常缺口）。
 */
export async function reviewGate(
  root: string,
  state: FeatureState,
  query?: ReviewGateQuery,
): Promise<ReviewGateResult> {
  const phase = query?.phase ?? (currentOpenStep(state) === "code_review" ? "code" : "plan");
  if (!reviewObligation(state, phase)) return { status: "ready" };
  const ledger = await readReviewLedger(root, state);
  const batch = ledger.batches.find((candidate) => candidate.validity === "current" && (candidate.phase ?? "plan") === phase);
  if (!batch) {
    const otherPhase = ledger.batches.find((candidate) => candidate.validity === "current");
    return otherPhase
      ? { status: "need-batch", cause: "phase" as const, batchId: otherPhase.batchId }
      : { status: "need-batch", cause: "missing" as const };
  }
  if (await reviewBasisStale(root, state, batch, phase)) return { status: "need-batch", cause: "stale", batchId: batch.batchId };
  if (batch.progress !== "complete") return { status: "jobs-open", batchId: batch.batchId, jobs: reviewJobsSummary(batch) };
  // 独立代码审查的隔离门禁（ADR-0017 / issue 19）：M/L 路线默认要求
  // codeReview "independent"，高后果标签会提升到 "full"——两者都要求审查在
  // 与实现隔离的新上下文中完成。只有绑定专用 review-execution 事件的 subagent
  // 证明或受控 server sampling 能形成隔离证明；缺失时审查保持未完成并阻塞。
  if (phase === "code") {
    const requiresIsolation = codeReviewIsolationRequired(state);
    if (requiresIsolation && !hasCurrentQualityException(state, "review")) {
      const requirements = deriveReviewJobRequirements(state.route, state.classification.riskLabels, state.classification.controls.reviewRoles, phase);
      const missingIsolation = requirements
        .map((requirement) => batch.jobs.find((job) => job.role === requirement.role))
        .filter((job): job is ReviewJob => job !== undefined && !jobHasEffectiveIsolationProof(ledger, job))
        .map((job) => job.jobId);
      if (missingIsolation.length) return { status: "isolation", batchId: batch.batchId, jobIds: missingIsolation };
    }
  }
  const unresolved = currentUnresolvedBlocking(ledger, batch, state);
  if (unresolved.length && !hasCurrentQualityException(state, "review")) {
    return { status: "blocking", batchId: batch.batchId, findingIds: unresolved.map((finding) => finding.findingId) };
  }
  // 账本是权威，但 plan-review 仍是必选生成的工件：就绪前不得绕过缺失/损坏的视图。
  if (reviewEnforcementRequired(state.route, state.classification.controls)) {
    await assertCurrentReviewProjection(root, state);
  }
  return { status: "ready", stamp: { batchId: batch.batchId, basisHash: batch.basisHash, assuranceLevel: batch.assuranceLevel } };
}

/** 把非就绪的 gate 结果译回现有错误码（REQUIRED / STALE / INCOMPLETE / BLOCKING / ISOLATION）。 */
function reviewGateError(gate: Exclude<ReviewGateResult, { status: "ready" }>, phase: "plan" | "code"): DevFlowError {
  switch (gate.status) {
    case "need-batch": {
      if (gate.cause === "stale") {
        return new DevFlowError("REVIEW_BASIS_STALE", "review batch basis no longer matches current feature state", {
          batchId: gate.batchId,
          recoveryHint: "重建批次→重交 jobs→re-record planning",
        });
      }
      return new DevFlowError("REVIEW_BATCH_REQUIRED", `a current ${phase} review batch is required`, { expectedPhase: phase });
    }
    case "jobs-open":
      return new DevFlowError("REVIEW_BATCH_INCOMPLETE", "all required review jobs must be submitted", { batchId: gate.batchId });
    case "isolation":
      return new DevFlowError("REVIEW_ISOLATION_REQUIRED", "独立代码审查要求审查在与实现隔离的新上下文中完成，当前批次缺少隔离证明。", {
        jobIds: gate.jobIds,
        batchId: gate.batchId,
        recoveryHint: "在与实现隔离的上下文中重新完成这些审查 job 并记录 review-execution 事件，或通过服务端采样完成 job；复用批次同样需要隔离证明，可在隔离子代理中重做 job 或经质量例外接受风险。",
        retryOriginal: true,
      });
    case "blocking":
      return new DevFlowError("REVIEW_BLOCKING_FINDINGS", "review ledger has unresolved blocking findings", {
        batchId: gate.batchId,
        findingIds: gate.findingIds,
      });
  }
}

/** recordStep / begin 读 gate 的同一句“过/不过”：就绪返回 stamp，否则抛对应错误码。 */
export async function requireReviewReady(
  root: string,
  state: FeatureState,
  query?: ReviewGateQuery,
): Promise<ReviewStamp> {
  const phase = query?.phase ?? (currentOpenStep(state) === "code_review" ? "code" : "plan");
  const gate = await reviewGate(root, state, query);
  if (gate.status === "ready") return gate.stamp!;
  throw reviewGateError(gate, phase);
}
