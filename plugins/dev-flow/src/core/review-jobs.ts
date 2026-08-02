import { createHash, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import type { ReviewAgentAttestation, ReviewBasis, ReviewBatch, ReviewJob, ReviewLedger, ReviewSamplingAttempt } from "../policy/review.js";
import type { ReviewAssurance, ReviewFinding, ReviewFindingInput, ReviewFindingResolutionInput } from "../policy/types.js";
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
import { normalizeUnicode } from "./path-normalization.js";
import { fingerprintProtectedRoots } from "./fingerprint.js";
import { mutatePrepared, readState, type FeatureState } from "./state-store.js";
import {
  canonicalReviewValueJson,
  readReviewLedger,
  readReviewPackage,
  reviewSummary,
  writeReviewPackage,
  writeReviewSnapshot,
} from "./review-store.js";
import { readProjectConfigSnapshot, readTraceability } from "./traceability-store.js";
import { assertCurrentReviewProjection } from "./review-projection.js";
import { satisfyObligations } from "../policy/obligations.js";
import {
  createInteraction,
  findInteractionForTarget,
  getInteraction,
  resolveTokenInteraction,
  toPublicInteraction,
  type PublicInteraction,
  type UserInteraction,
} from "./user-interactions.js";

const digest = (value: string) => createHash("sha256").update(value).digest("hex");
const leaseMilliseconds = 60 * 60 * 1000;
const samplingLeaseMilliseconds = 120 * 1000;
const basisArtifactKinds = ["requirements", "implementation-plan", "coverage-matrix", "rollback-units"] as const;

interface FrozenReviewArtifact {
  kind: typeof basisArtifactKinds[number];
  path: string;
  sha256: string;
  contents: string;
}

interface DerivedReviewInput {
  basis: ReviewBasis;
  frozenArtifacts: FrozenReviewArtifact[];
  projectConfig: { sha256: string; contents: string };
  scopeManifest: { protectedRoots: string[]; rollbackFileScopes: string[] };
}

export interface CreateReviewBatchResult {
  state: FeatureState;
  batch: ReviewBatch;
  created: boolean;
}

export interface ClaimedReviewJob {
  state: FeatureState;
  batchId: string;
  job: Omit<ReviewJob, "claim">;
  capability: string;
  idempotent: boolean;
}

export interface StartedReviewSampling {
  state: FeatureState;
  batchId: string;
  job: Omit<ReviewJob, "claim">;
  requestId: string;
  package: unknown;
}

type SamplingFailureCode = "client-error" | "timeout" | "invalid-response" | "validation-failed";

export interface ReviewRiskAcceptancePresentation {
  state: FeatureState;
  interaction: PublicInteraction;
  idempotent: boolean;
}

export interface ResolvedReviewRiskAcceptance {
  state: FeatureState;
  acceptedFindingIds: string[];
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

function cloneLedger(ledger: ReviewLedger, stateRevision: number, batches: ReviewBatch[]): ReviewLedger {
  return {
    ...ledger,
    revision: ledger.revision + 1,
    stateRevision,
    batches,
    summary: reviewSummary(batches),
  };
}

function reviewArtifactKinds(state: FeatureState): typeof basisArtifactKinds[number][] {
  // The implementation plan is the only editable source for the execution
  // graph. Coverage/rollback entries remain supported as legacy evidence but
  // are omitted from new review bases when no standalone artifact exists.
  return basisArtifactKinds.filter((kind) => Boolean(state.artifacts[kind]));
}

async function deriveReviewInput(root: string, state: FeatureState): Promise<DerivedReviewInput> {
  if (!state.traceability) invalid("REVIEW_BASIS_UNAVAILABLE", "review basis requires a current Trace pointer");
  const trace = await readTraceability(root, state);
  const { config, sha256: projectConfigSha256 } = await readProjectConfigSnapshot(root);
  const frozenArtifacts = await Promise.all(reviewArtifactKinds(state).map(async (kind) => {
    const artifact = state.artifacts[kind];
    if (!artifact) invalid("REVIEW_BASIS_ARTIFACT_MISSING", `review basis artifact is missing: ${kind}`, { kind });
    let contents: string;
    try { contents = await readFile(path.join(root, ".dev-flow", "features", state.featureId, artifact!.path), "utf8"); }
    catch { invalid("REVIEW_BASIS_ARTIFACT_MISSING", `review basis artifact cannot be read: ${kind}`, { kind }); }
    if (digest(contents!) !== artifact!.sha256) {
      invalid("ARTIFACT_INTEGRITY_FAILED", `review basis artifact was edited without registration: ${kind}`, {
        kind,
        recoveryHint: `Re-register the edited ${kind} artifact with the latest feature revision known before the edit.`,
      });
    }
    return { kind, path: artifact!.path, sha256: artifact!.sha256, contents: contents! };
  }));
  const projectContents = await readFile(path.join(root, ".dev-flow", "project.json"), "utf8");
  if (digest(projectContents) !== projectConfigSha256) {
    invalid("REVIEW_BASIS_UNAVAILABLE", "project configuration changed while review basis was being captured");
  }
  const scopeManifest = {
    inScope: [...state.scope.inScope].sort(),
    outOfScope: [...state.scope.outOfScope].sort(),
    protectedRoots: [...config.protectedRoots].sort(),
    rollbackFileScopes: Object.values(trace.nodes)
      .reduce<Array<{ id: string; fileScope: string[] }>>((scopes, node) => {
        if (node.kind === "rollback" && node.status === "current") {
          scopes.push({ id: node.id, fileScope: [...node.fileScope].sort() });
        }
        return scopes;
      }, [])
      .sort((left, right) => left.id.localeCompare(right.id)),
  };
  // Content fingerprint of protected roots at basis capture time. Batch create and
  // pre-record planning gates must see live drift; post-record revalidation is
  // handled separately so implementation may mutate those same paths.
  const protectedRootsFingerprint = await fingerprintProtectedRoots(root, config.protectedRoots);
  const basis: ReviewBasis = {
    featureId: state.featureId,
    route: state.route,
    workflowCapabilities: { ...state.workflowCapabilities ?? { trace: 0, review: 0, checkpoints: 0, rollbackExecution: 0 } },
    classification: {
      level: state.classification.level,
      topology: state.classification.topology,
      ...(state.classification.execution ? { execution: state.classification.execution } : {}),
      ...(state.classification.requirements ? { requirements: state.classification.requirements } : {}),
      riskLabels: [...state.classification.riskLabels].sort(),
    },
    artifacts: frozenArtifacts.map(({ kind, path: artifactPath, sha256 }) => ({ kind, path: artifactPath, sha256 })),
    traceability: { path: state.traceability.path, sha256: state.traceability.sha256, revision: trace.revision },
    projectConfigSha256,
    scopeManifestSha256: digest(canonicalReviewValueJson(scopeManifest)),
    protectedRootsFingerprint,
  };
  return {
    basis,
    frozenArtifacts,
    projectConfig: { sha256: projectConfigSha256, contents: projectContents },
    scopeManifest: {
      protectedRoots: scopeManifest.protectedRoots,
      rollbackFileScopes: scopeManifest.rollbackFileScopes.flatMap((item) => item.fileScope),
    },
  };
}

function basisHash(basis: ReviewBasis): string {
  return digest(canonicalReviewValueJson(basis));
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

function visibleJob(job: ReviewJob): Omit<ReviewJob, "claim"> {
  const { claim: _claim, ...visible } = job;
  return visible;
}

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
  return normalized.length > 0 && normalized === normalized.trim() && !path.posix.isAbsolute(normalized) && !normalized.includes("\\")
    && path.posix.normalize(normalized) === normalized && !normalized.split("/").includes("..");
}

function validScopeManifest(value: unknown): value is { protectedRoots: string[]; rollbackFileScopes: string[] } {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const manifest = value as { protectedRoots?: unknown; rollbackFileScopes?: unknown };
  return Array.isArray(manifest.protectedRoots) && Array.isArray(manifest.rollbackFileScopes)
    && manifest.protectedRoots.every((entry) => typeof entry === "string" && safePackagePath(entry))
    && manifest.rollbackFileScopes.every((entry) => typeof entry === "string" && safePackagePath(entry));
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
  manifest: { protectedRoots: string[]; rollbackFileScopes: string[] },
  findings: ReviewFindingInput[],
  resolutions: ReviewFindingResolutionInput[],
): void {
  const allowed = [...new Set([...manifest.protectedRoots, ...manifest.rollbackFileScopes])];
  const inManifest = (value: string) => {
    const normalized = normalizeUnicode(value);
    return safePackagePath(normalized) && allowed.some((scope) => scope === "." || normalized === scope || normalized.startsWith(`${scope}/`));
  };
  for (const finding of findings) {
    if (finding.severity === "blocking" && !finding.evidence.length) invalid("REVIEW_FINDING_EVIDENCE_REQUIRED", "blocking finding requires evidence");
    if (finding.targets.some((target) => !inManifest(target)) || finding.evidence.some((evidence) => !inManifest(evidence.path))) {
      invalid("REVIEW_FINDING_SCOPE_INVALID", "finding targets and evidence must be package-relative paths inside the scope manifest");
    }
  }
  if (resolutions.some((resolution) => resolution.evidence.some((evidence) => !inManifest(evidence.path)))) {
    invalid("REVIEW_FINDING_SCOPE_INVALID", "resolution evidence must be package-relative paths inside the scope manifest");
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

/** Create is idempotent for an unchanged Core-computed basis. */
export async function createReviewBatch(
  root: string,
  id: string,
  expectedRevision: number,
): Promise<CreateReviewBatchResult> {
  let result: CreateReviewBatchResult | undefined;
  const state = await mutatePrepared(root, id, expectedRevision, "review-batch-created", async (current, nextStateRevision) => {
    if (current.lifecycle !== "active") invalid("INVALID_LIFECYCLE", "only active features can create review batches");
    const ledger = await readReviewLedger(root, current);
    const reviewInput = await deriveReviewInput(root, current);
    const { basis } = reviewInput;
    const currentBasisHash = basisHash(basis);
    const existing = ledger.batches.find((batch) => batch.validity === "current" && batch.basisHash === currentBasisHash);
    if (existing) {
      result = { state: undefined as unknown as FeatureState, batch: existing, created: false };
      return { mutate: () => undefined, unchanged: true, eventData: { batchId: existing.batchId, basisHash: currentBasisHash, idempotent: true } };
    }
    const requirements = deriveReviewJobRequirements(current.route, current.classification.riskLabels);
    if (!requirements.length) invalid("REVIEW_ROUTE_UNSUPPORTED", "review jobs require a standard M or L route");
    const batchId = randomUUID();
    const jobs: ReviewJob[] = [];
    for (const requirement of requirements) {
      const jobId = randomUUID();
      const packageSha256 = await writeReviewPackage(root, current.featureId, {
        schemaVersion: 1,
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
      });
      jobs.push({ jobId, role: requirement.role, reviewDepth: requirement.reviewDepth, packageSha256, status: "pending" });
    }
    const batch: ReviewBatch = {
      batchId,
      basis,
      basisHash: currentBasisHash,
      validity: "current",
      progress: "open",
      executionMode: "isolated-sequential",
      assuranceLevel: assuranceForReview2a(),
      jobs,
    };
    const batches = [
      ...ledger.batches.map((candidate) => candidate.validity === "current" ? { ...candidate, validity: "stale" as const } : candidate),
      batch,
    ];
    const pointer = await writeReviewSnapshot(root, cloneLedger(ledger, nextStateRevision, batches));
    result = { state: undefined as unknown as FeatureState, batch, created: true };
    return {
      mutate: (draft) => { draft.review = pointer; },
      eventData: { batchId, basisHash: currentBasisHash, roles: jobs.map((job) => job.role) },
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
): Promise<{ job: Omit<ReviewJob, "claim">; package: unknown }> {
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
    if (job.status === "submitted") invalid("REVIEW_JOB_ALREADY_SUBMITTED", "review job has already been submitted", { jobId });
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

interface SubmittedReviewJob {
  batch: ReviewBatch;
  payloadSha256: string;
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

async function submitParsedReviewJob(
  root: string,
  featureId: string,
  ledger: ReviewLedger,
  batch: ReviewBatch,
  job: ReviewJob,
  parsed: ReturnType<typeof parseReviewJobCompletion>,
  now: Date,
  samplingAttempt?: ReviewSamplingAttempt,
  hostAttestation?: ReviewAgentAttestation,
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
    resolvedIds.add(resolution.findingId);
  }
  const payloadSha256 = digest(canonicalReviewValueJson(normalizedParsed));
  const findings: ReviewFinding[] = dedupeFindings(normalizedParsed.findings).map((finding) => ({
    ...finding,
    findingId: `F-${randomUUID()}`,
    jobId: job.jobId,
  }));
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
    },
  };
  let updatedBatch: ReviewBatch = {
    ...batch,
    jobs: batch.jobs.map((candidate) => candidate.jobId === job.jobId ? submitted : candidate),
    ...(Object.keys(dispositions).length ? { dispositions } : {}),
  };
  if (hostAttestation && updatedBatch.executionMode === "isolated-sequential") {
    updatedBatch = { ...updatedBatch, executionMode: "native-subagent" };
  }
  updatedBatch = {
    ...updatedBatch,
    progress: updatedBatch.jobs.every((candidate) => candidate.status === "submitted") ? "complete" : "open",
  };
  return { batch: withDerivedAssurance(updatedBatch), payloadSha256 };
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
    if (Date.parse(job.claim.leaseExpiresAt) <= now.getTime()) invalid("REVIEW_JOB_LEASE_EXPIRED", "review job lease has expired", { jobId });
    const submitted = await submitParsedReviewJob(root, id, ledger, batch, job, parsed, now, undefined, hostAttestation);
    const batches = ledger.batches.map((candidate) => candidate.batchId === batchId ? submitted.batch : candidate);
    const pointer = await writeReviewSnapshot(root, cloneLedger(ledger, nextStateRevision, batches));
    result = { batch: submitted.batch, idempotent: false };
    return {
      mutate: (draft) => { draft.review = pointer; },
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
      executionMode: "mcp-sampling",
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
    const submitted = await submitParsedReviewJob(root, id, ledger, batch, job, parsed, now, attempt);
    const pointer = await writeReviewSnapshot(root, cloneLedger(
      ledger,
      nextStateRevision,
      ledger.batches.map((candidate) => candidate.batchId === batchId ? submitted.batch : candidate),
    ));
    result = { batch: submitted.batch };
    return {
      mutate: (draft) => {
        draft.review = pointer;
        if (submitted.batch.progress === "complete") {
          draft.obligations = satisfyObligations(draft.obligations, ["review"]);
        }
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
  // Once planning has bound this exact batch, later protected-root implementation
  // edits must not invent a new live basis; verification freshness owns that drift.
  const requireLiveBasis = options.requireLiveBasis ?? !planReviewBoundToBatch(state, batch!);
  if (requireLiveBasis) {
    const reviewInput = await deriveReviewInput(root, state);
    if (basisHash(reviewInput.basis) !== batch!.basisHash) {
      invalid("REVIEW_BASIS_STALE", "review batch basis no longer matches current feature state", { batchId: batch!.batchId });
    }
  }
  return { ledger, batch: batch! };
}

function currentBlockingFindings(ledger: ReviewLedger, batch: ReviewBatch): LocatedFinding[] {
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
  const state = await mutatePrepared(root, id, expectedRevision, "review-risk-acceptance-presented", async (current) => {
    const { ledger, batch } = await currentBatchWithBasis(root, current as FeatureState);
    if (batch.progress !== "complete") invalid("REVIEW_BATCH_INCOMPLETE", "all required review jobs must be submitted", { batchId: batch.batchId });
    const findings = acceptanceFindings(ledger, batch, findingIds);
    const ids = findings.map((finding) => finding.findingId).sort();
    const setHash = findingSetHash(batch, findings);
    const target = `review-risk:${batch.batchId}:${setHash}`;
    const existing = findInteractionForTarget(current as FeatureState, target);
    if (existing) {
      result = { interaction: toPublicInteraction(existing), idempotent: true };
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
        result = { interaction: toPublicInteraction(interaction), idempotent: false };
      },
      eventData: { batchId: batch.batchId, findingIds: ids, findingSetHash: setHash },
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

/** Resolve the one-time text token and atomically persist accepted dispositions. */
export async function resolveReviewRiskAcceptanceToken(
  root: string,
  id: string,
  expectedRevision: number,
  interactionId: string,
  userReply: string,
  promptEventId: string,
  host: "claude" | "codex",
): Promise<ResolvedReviewRiskAcceptance> {
  let result: Omit<ResolvedReviewRiskAcceptance, "state"> | undefined;
  const state = await mutatePrepared(root, id, expectedRevision, "review-risk-acceptance-resolved", async (current, nextStateRevision) => {
    const interaction = getInteraction(current as FeatureState, interactionId);
    const { ledger, batch } = await currentBatchWithBasis(root, current as FeatureState);
    const binding = riskBinding(interaction);
    if (interaction.status === "resolved") {
      const findings = selectCurrentBlockingFindings(ledger, batch, binding.findingIds, false);
      assertResolvedAcceptance(current as FeatureState, interaction, batch, findings);
      const accepted = interaction.response?.action === "accept"
        && interaction.response.source === "text-token"
        && interaction.response.userReply === userReply
        && interaction.response.promptEventId === promptEventId
        && interaction.response.host === host;
      const dispositions = batch.dispositions ?? {};
      if (accepted && findings.every((finding) => {
        const disposition = dispositions[finding.findingId];
        return disposition?.kind === "risk-accepted" && disposition.interactionId === interaction.id
          && disposition.findingSetHash === binding.findingSetHash;
      })) {
        result = { acceptedFindingIds: binding.findingIds, idempotent: true };
        return { mutate: () => undefined, unchanged: true, eventData: { interactionId, idempotent: true } };
      }
      invalid("INTERACTION_ALREADY_RESOLVED", interactionId);
    }
    const findings = acceptanceFindings(ledger, batch, binding.findingIds);
    assertResolvedAcceptance(current as FeatureState, interaction, batch, findings);
    const preview = structuredClone(current as FeatureState);
    const response = resolveTokenInteraction(preview, interactionId, userReply, host, promptEventId);
    if (response.action !== "accept") {
      result = { acceptedFindingIds: [], idempotent: false };
      return {
        mutate: (draft) => { resolveTokenInteraction(draft, interactionId, userReply, host, promptEventId); },
        eventData: { interactionId, batchId: batch.batchId, action: response.action },
      };
    }
    const dispositions = { ...batch.dispositions };
    for (const finding of findings) {
      dispositions[finding.findingId] = {
        kind: "risk-accepted",
        interactionId,
        acceptedAt: response.respondedAt,
        batchId: batch.batchId,
        basisHash: batch.basisHash,
        findingIds: binding.findingIds,
        findingSetHash: binding.findingSetHash,
      };
    }
    const updatedBatch = { ...batch, dispositions };
    const pointer = await writeReviewSnapshot(root, cloneLedger(
      ledger,
      nextStateRevision,
      ledger.batches.map((candidate) => candidate.batchId === batch.batchId ? updatedBatch : candidate),
    ));
    result = { acceptedFindingIds: binding.findingIds, idempotent: false };
    return {
      mutate: (draft) => {
        resolveTokenInteraction(draft, interactionId, userReply, host, promptEventId);
        draft.review = pointer;
      },
      eventData: { interactionId, batchId: batch.batchId, findingIds: binding.findingIds, findingSetHash: binding.findingSetHash },
    };
  });
  return { ...result!, state };
}

/** Only Core derives plan-review evidence from a complete, current batch. */
export async function assertReviewComplete(
  root: string,
  state: FeatureState,
): Promise<{ batchId: string; basisHash: string; assuranceLevel: ReviewAssurance }> {
  const { ledger, batch } = await currentBatchWithBasis(root, state);
  if (batch.progress !== "complete") invalid("REVIEW_BATCH_INCOMPLETE", "all required review jobs must be submitted", { batchId: batch.batchId });
  const jobs = ledger.batches.flatMap((candidate) => candidate.jobs);
  const dispositions = Object.assign({}, ...ledger.batches.map((candidate) => candidate.dispositions ?? {}));
  const blocking = jobs.flatMap((job) => job.submission?.findings ?? [])
    .filter((finding) => {
      if (finding.severity !== "blocking") return false;
      const disposition = dispositions[finding.findingId];
      if (!disposition) return true;
      if (disposition.kind === "risk-accepted") {
        // A user decision is valid only for this exact current basis and frozen finding set.
        if (disposition.batchId !== batch.batchId || disposition.basisHash !== batch.basisHash) return true;
        const interaction = state.interactions?.[disposition.interactionId] as UserInteraction | undefined;
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
  if (blocking.length) invalid("REVIEW_BLOCKING_FINDINGS", "review batch has unresolved blocking findings", {
    batchId: batch.batchId,
    findingIds: blocking.map((finding) => finding.findingId),
  });
  // The ledger is the authority, but plan-review remains a required generated
  // artifact. Do not allow a complete batch to bypass a missing/corrupt view.
  await assertCurrentReviewProjection(root, state);
  return { batchId: batch.batchId, basisHash: batch.basisHash, assuranceLevel: batch.assuranceLevel };
}
