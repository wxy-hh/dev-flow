import { createHash, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import type { ReviewBasis, ReviewBatch, ReviewJob, ReviewLedger } from "../policy/review.js";
import { assuranceForReview2a, deriveReviewJobRequirements, parseReviewJobCompletion } from "../policy/review.js";
import { DevFlowError } from "./errors.js";
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

const digest = (value: string) => createHash("sha256").update(value).digest("hex");
const leaseMilliseconds = 60 * 60 * 1000;
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
  return basisArtifactKinds.filter((kind) => kind !== "rollback-units" || state.route === "standard-l");
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
      invalid("ARTIFACT_INTEGRITY_FAILED", `review basis artifact was edited without registration: ${kind}`, { kind });
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
    protectedRootsFingerprint: await fingerprintProtectedRoots(root, config.protectedRoots),
  };
  return { basis, frozenArtifacts, projectConfig: { sha256: projectConfigSha256, contents: projectContents } };
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
  const reviewPackage = await readReviewPackage(root, id, job.packageSha256);
  if (typeof reviewPackage !== "object" || reviewPackage === null
    || (reviewPackage as Record<string, unknown>).featureId !== id
    || (reviewPackage as Record<string, unknown>).batchId !== batchId
    || (reviewPackage as Record<string, unknown>).jobId !== jobId
    || (reviewPackage as Record<string, unknown>).basisHash !== batch.basisHash) {
    invalid("REVIEW_INTEGRITY_FAILED", "review package does not belong to its job", { batchId, jobId });
  }
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
    const job = recoverExpiredLease(original, now);
    if (job.status === "submitted") invalid("REVIEW_JOB_ALREADY_SUBMITTED", "review job has already been submitted", { jobId });
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

export async function submitReviewJob(
  root: string,
  id: string,
  expectedRevision: number,
  batchId: string,
  jobId: string,
  capability: string,
  completion: unknown,
  now = new Date(),
): Promise<{ state: FeatureState; batch: ReviewBatch; idempotent: boolean }> {
  const parsed = parseReviewJobCompletion(completion);
  let result: Omit<{ state: FeatureState; batch: ReviewBatch; idempotent: boolean }, "state"> | undefined;
  const state = await mutatePrepared(root, id, expectedRevision, "review-job-submitted", async (current, nextStateRevision) => {
    const ledger = await readReviewLedger(root, current);
    const batch = currentBatch(ledger, batchId);
    const job = findJob(batch, jobId);
    const payloadSha256 = digest(canonicalReviewValueJson(parsed));
    if (job.status === "submitted") {
      if (job.submission?.payloadSha256 !== payloadSha256) invalid("REVIEW_SUBMISSION_CONFLICT", "review job was submitted with a different payload", { jobId });
      result = { batch, idempotent: true };
      return { mutate: () => undefined, unchanged: true, eventData: { batchId, jobId, idempotent: true } };
    }
    if (!job.claim || digest(capability) !== job.claim.requestSha256) invalid("REVIEW_JOB_CAPABILITY_INVALID", "review job capability is invalid");
    if (Date.parse(job.claim.leaseExpiresAt) <= now.getTime()) invalid("REVIEW_JOB_LEASE_EXPIRED", "review job lease has expired", { jobId });
    const submitted: ReviewJob = {
      ...job,
      status: "submitted",
      submission: { payloadSha256, coverageSummary: parsed.coverageSummary, findings: parsed.findings, submittedAt: now.toISOString() },
    };
    const updatedBatch: ReviewBatch = {
      ...batch,
      jobs: batch.jobs.map((candidate) => candidate.jobId === jobId ? submitted : candidate),
    };
    updatedBatch.progress = updatedBatch.jobs.every((candidate) => candidate.status === "submitted") ? "complete" : "open";
    const batches = ledger.batches.map((candidate) => candidate.batchId === batchId ? updatedBatch : candidate);
    const pointer = await writeReviewSnapshot(root, cloneLedger(ledger, nextStateRevision, batches));
    result = { batch: updatedBatch, idempotent: false };
    return { mutate: (draft) => { draft.review = pointer; }, eventData: { batchId, jobId, payloadSha256 } };
  });
  return { ...result!, state };
}
