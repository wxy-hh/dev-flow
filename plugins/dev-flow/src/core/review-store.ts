import { createHash, randomUUID } from "node:crypto";
import { mkdir, open, readFile, readdir, rename } from "node:fs/promises";
import path from "node:path";
import { assuranceForReviewBatch, type ReviewAgentAttestation, type ReviewBasis, type ReviewBatch, type ReviewFindingEvent, type ReviewJob, type ReviewLedger, type ReviewPointer, type ReviewSamplingAttempt, type ReviewSummary } from "../policy/review.js";
import type { FeatureState } from "./state-store.js";
import { DevFlowError } from "./errors.js";

function sortValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => [key, sortValue(child)]));
  }
  return value;
}

const emptySummary = (): ReviewSummary => ({ batches: 0, current: 0, stale: 0, open: 0, complete: 0 });
const digest = (contents: string | Buffer): string => createHash("sha256").update(contents).digest("hex");

export function emptyReviewLedger(featureId: string, stateRevision: number): ReviewLedger {
  return { schemaVersion: 2, featureId, revision: 0, stateRevision, batches: [], summary: emptySummary(), findingEvents: [] };
}

export function canonicalReviewJson(ledger: ReviewLedger): string {
  return `${JSON.stringify(sortValue(ledger), null, 2)}\n`;
}

export function canonicalReviewValueJson(value: unknown): string {
  return `${JSON.stringify(sortValue(value), null, 2)}\n`;
}

/** Review batch ids and raw config/command catalogs are metadata, not overall semantics. */
export function semanticReviewBasisHash(basis: ReviewBasis): string {
  const { projectConfigSha256: _projectConfigSha256, verificationCommandHashes: _verificationCommandHashes, ...semanticBasis } = basis;
  return digest(canonicalReviewValueJson(semanticBasis));
}

function validBasisHash(basis: ReviewBasis, basisHash: string): boolean {
  // Accept the full legacy hash while reading 5.0 ledgers; all new writes use
  // the semantic form so unrelated verification additions remain reusable.
  return basisHash === digest(canonicalReviewValueJson(basis)) || basisHash === semanticReviewBasisHash(basis);
}

function snapshotDirectory(root: string, featureId: string): string {
  return path.join(root, ".dev-flow", "features", featureId, "review", "snapshots");
}

function packageDirectory(root: string, featureId: string): string {
  return path.join(root, ".dev-flow", "features", featureId, "review", "packages");
}

function integrity(message: string, details: Record<string, unknown> = {}): never {
  throw new DevFlowError("REVIEW_INTEGRITY_FAILED", message, details);
}

function validateSummary(value: unknown): value is ReviewSummary {
  return typeof value === "object" && value !== null
    && ["batches", "current", "stale", "open", "complete"].every((key) => {
      const candidate = (value as Record<string, unknown>)[key];
      return Number.isInteger(candidate) && (candidate as number) >= 0;
    });
}

function sameSummary(left: ReviewSummary, right: ReviewSummary): boolean {
  return left.batches === right.batches
    && left.current === right.current
    && left.stale === right.stale
    && left.open === right.open
    && left.complete === right.complete;
}

function validHash(value: unknown): value is string {
  return typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function validSamplingAttempt(value: unknown): value is ReviewSamplingAttempt {
  if (!isRecord(value) || !validHash(value.requestSha256)
    || typeof value.issuedAt !== "string" || typeof value.leaseExpiresAt !== "string"
    || (value.status !== "issued" && value.status !== "failed" && value.status !== "submitted")) return false;
  if (value.status === "issued") {
    return value.completedAt === undefined && value.payloadSha256 === undefined && value.failureCode === undefined;
  }
  if (typeof value.completedAt !== "string") return false;
  if (value.status === "failed") {
    return value.payloadSha256 === undefined
      && (value.failureCode === "client-error" || value.failureCode === "timeout"
        || value.failureCode === "invalid-response" || value.failureCode === "validation-failed");
  }
  return validHash(value.payloadSha256) && value.failureCode === undefined;
}

function validSamplingAttempts(value: unknown, status: ReviewJob["status"], submission: ReviewJob["submission"]): boolean {
  if (value === undefined) return status !== "sampling" && !submission?.samplingProvenance;
  if (!Array.isArray(value) || !value.length || !value.every(validSamplingAttempt)) return false;
  const attempts = value as ReviewSamplingAttempt[];
  const issued = attempts.filter((attempt) => attempt.status === "issued");
  if (issued.length > 1 || (status === "sampling") !== (issued.length === 1)) return false;
  if (status === "sampling" && submission) return false;
  if (status === "sampling") return attempts.every((attempt) => attempt.status === "failed" || attempt.status === "issued");
  if (status === "pending" || status === "claimed") return attempts.every((attempt) => attempt.status === "failed");
  if (!submission?.samplingProvenance) return attempts.every((attempt) => attempt.status === "failed");
  return attempts.every((attempt) => attempt.status === "failed" || attempt.status === "submitted")
    && attempts.filter((attempt) => attempt.status === "submitted").length === 1
    && attempts.some((attempt) => attempt.status === "submitted"
      && attempt.requestSha256 === submission.samplingProvenance!.requestSha256
      && attempt.issuedAt === submission.samplingProvenance!.issuedAt
      && attempt.completedAt === submission.samplingProvenance!.completedAt
      && attempt.payloadSha256 === submission.payloadSha256);
}

function validAttestation(value: unknown): value is ReviewAgentAttestation {
  return isRecord(value)
    && (value.host === "claude" || value.host === "codex")
    && typeof value.agentId === "string" && value.agentId.trim().length > 0
    && typeof value.issuedAt === "string" && !Number.isNaN(Date.parse(value.issuedAt))
    && typeof value.raw === "string" && value.raw.trim().length > 0
    && validHash(value.rawSha256)
    && typeof value.acceptedAt === "string"
    && digest(value.raw) === value.rawSha256;
}

function validateBatch(value: unknown): value is ReviewBatch {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const batch = value as Partial<ReviewBatch>;
  if (typeof batch.batchId !== "string" || !batch.batchId || !validHash(batch.basisHash)
    || !batch.basis || batch.validity !== "current" && batch.validity !== "stale"
    || batch.progress !== "open" && batch.progress !== "complete"
    || batch.executionMode !== "isolated-sequential" && batch.executionMode !== "parallel-safe" && batch.executionMode !== "mcp-sampling" && batch.executionMode !== "native-subagent"
    || batch.assuranceLevel !== "multi-perspective" && batch.assuranceLevel !== "independent-sampling"
      && batch.assuranceLevel !== "multi-agent-verified"
    || !Array.isArray(batch.jobs)) return false;
  const ids = new Set<string>();
  const attestationRaws = new Set<string>();
  return batch.jobs.every((job) => {
    if (!job || typeof job !== "object" || typeof job.jobId !== "string" || !job.jobId || ids.has(job.jobId)
      || typeof job.role !== "string" || (job.reviewDepth !== "standard" && job.reviewDepth !== "full")
      || !validHash(job.packageSha256) || !validHash(job.roleBasisHash) || (job.status !== "pending" && job.status !== "claimed" && job.status !== "sampling" && job.status !== "submitted" && job.status !== "reused")) return false;
    ids.add(job.jobId);
    if (job.status === "reused") return !!job.reusedFrom && validHash(job.reusedFrom.submissionSha256) && !job.claim && !job.submission;
    if (!validSamplingAttempts(job.samplingAttempts, job.status, job.submission)) return false;
    if (job.status === "pending") return !job.claim && !job.submission;
    if (job.status === "sampling") return !job.claim && !job.submission?.attestation;
    if (job.status === "claimed") {
      return !job.submission && !!job.claim && validHash(job.claim.requestSha256)
        && typeof job.claim.claimedAt === "string" && typeof job.claim.leaseExpiresAt === "string";
    }
    const sampled = Boolean(job.submission?.samplingProvenance);
    const attested = Boolean(job.submission?.attestation);
    if (sampled && attested) return false;
    if (!sampled && (!job.claim || !validHash(job.claim.requestSha256)
      || typeof job.claim.claimedAt !== "string" || typeof job.claim.leaseExpiresAt !== "string")) return false;
    if (sampled && job.claim) return false;
    if (!job.submission || !validHash(job.submission.payloadSha256)
      || typeof job.submission.coverageSummary !== "string" || !Array.isArray(job.submission.findings)
      || typeof job.submission.submittedAt !== "string") return false;
    if (attested) {
      if (!validAttestation(job.submission.attestation)) return false;
      if (attestationRaws.has(job.submission.attestation!.rawSha256)) return false;
      attestationRaws.add(job.submission.attestation!.rawSha256);
    }
    return true;
  });
}

function validateLedger(value: unknown): asserts value is ReviewLedger {
  if (typeof value !== "object" || value === null || Array.isArray(value)) integrity("review snapshot has an invalid shape");
  const ledger = value as Partial<ReviewLedger>;
  if ((ledger as { schemaVersion?: unknown }).schemaVersion === 1) {
    throw new DevFlowError("UNSUPPORTED_REVIEW_SCHEMA", "检测到 Dev Flow 4.x review ledger schema v1。", {
      recoveryHint: "回到 4.x 完成或放弃该 feature，备份 .dev-flow 后用 5.0 重新初始化",
    });
  }
  if (ledger.schemaVersion !== 2 || typeof ledger.featureId !== "string" || !ledger.featureId
    || !Number.isInteger(ledger.revision) || (ledger.revision ?? -1) < 0
    || !Number.isInteger(ledger.stateRevision) || (ledger.stateRevision ?? -1) < 0
    || !Array.isArray(ledger.batches) || !ledger.batches.every(validateBatch) || !validateSummary(ledger.summary)) {
    integrity("review snapshot has an invalid shape");
  }
  const batchIds = new Set<string>();
  for (const batch of ledger.batches) {
    if (batchIds.has(batch.batchId)
      || batch.basis.featureId !== ledger.featureId
      || !validBasisHash(batch.basis, batch.basisHash)
      || (batch.progress === "complete") !== batch.jobs.every((job) => job.status === "submitted" || job.status === "reused")) {
      integrity("review snapshot batch is inconsistent");
    }
    if (batch.assuranceLevel !== assuranceForReviewBatch(batch)) {
      integrity("review batch assurance is not derived from persisted provenance", { batchId: batch.batchId });
    }
    if (batch.executionMode === "isolated-sequential" && batch.assuranceLevel !== "multi-perspective") {
      integrity("isolated review batch assurance is not Core-derived", { batchId: batch.batchId });
    }
    // mcp-sampling may later accept manual host attestation on claim/submit; ladder
    // Host attestation remains diagnostic while executionMode stays explicit.
    batchIds.add(batch.batchId);
  }
  if (ledger.findingEvents !== undefined) {
    if (!Array.isArray(ledger.findingEvents)) integrity("review finding event ledger is invalid");
    const origins = new Set<string>();
    for (const event of ledger.findingEvents as ReviewFindingEvent[]) {
      if (!event || typeof event !== "object" || typeof event.type !== "string" || typeof event.at !== "string") integrity("review finding event has an invalid shape");
      if (event.type === "origin") {
        if (!event.finding || typeof event.finding.findingId !== "string" || origins.has(event.finding.findingId)) integrity("review finding origin is missing or duplicated");
        origins.add(event.finding.findingId);
      } else if (typeof event.findingId !== "string" || !origins.has(event.findingId)) {
        integrity("review finding event references an unknown origin", { findingId: event.findingId });
      }
    }
  }
  const attestationRaws = new Set<string>();
  for (const batch of ledger.batches) {
    for (const job of batch.jobs) {
      const rawSha256 = job.submission?.attestation?.rawSha256;
      if (!rawSha256) continue;
      if (attestationRaws.has(rawSha256)) {
        integrity("host attestation raw hash is reused across the review ledger", {
          batchId: batch.batchId,
          jobId: job.jobId,
        });
      }
      attestationRaws.add(rawSha256);
    }
  }
  if (!sameSummary(ledger.summary, reviewSummary(ledger.batches))) integrity("review snapshot summary is inconsistent");
}

export function reviewSummary(batches: ReviewBatch[]): ReviewSummary {
  return {
    batches: batches.length,
    current: batches.filter((batch) => batch.validity === "current").length,
    stale: batches.filter((batch) => batch.validity === "stale").length,
    open: batches.filter((batch) => batch.progress === "open").length,
    complete: batches.filter((batch) => batch.progress === "complete").length,
  };
}

async function fsyncDirectory(directory: string): Promise<void> {
  const handle = await open(directory, "r");
  try { await handle.sync(); } finally { await handle.close(); }
}

export async function writeReviewSnapshot(root: string, ledger: ReviewLedger): Promise<ReviewPointer> {
  validateLedger(ledger);
  const contents = canonicalReviewJson(ledger);
  const sha256 = digest(contents);
  const directory = snapshotDirectory(root, ledger.featureId);
  const target = path.join(directory, `${sha256}.json`);
  await mkdir(directory, { recursive: true });
  try {
    const existing = await readFile(target, "utf8");
    if (existing !== contents) integrity("existing review snapshot does not match its content address");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    const temporary = path.join(directory, `.${sha256}.${randomUUID()}.tmp`);
    const handle = await open(temporary, "wx");
    try { await handle.writeFile(contents); await handle.sync(); }
    finally { await handle.close(); }
    try { await rename(temporary, target); }
    catch (renameError) {
      if ((renameError as NodeJS.ErrnoException).code !== "EEXIST") throw renameError;
      if (await readFile(target, "utf8") !== contents) integrity("concurrent review snapshot does not match its content address");
    }
    await fsyncDirectory(directory);
  }
  return { path: `review/snapshots/${sha256}.json`, sha256, revision: ledger.revision, summary: ledger.summary };
}

/** Review packages are immutable and are addressed only by their canonical bytes. */
export async function writeReviewPackage(root: string, featureId: string, value: unknown): Promise<string> {
  const contents = canonicalReviewValueJson(value);
  const sha256 = digest(contents);
  const directory = packageDirectory(root, featureId);
  const target = path.join(directory, `${sha256}.json`);
  await mkdir(directory, { recursive: true });
  try {
    const existing = await readFile(target, "utf8");
    if (existing !== contents) integrity("existing review package does not match its content address");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    const temporary = path.join(directory, `.${sha256}.${randomUUID()}.tmp`);
    const handle = await open(temporary, "wx");
    try { await handle.writeFile(contents); await handle.sync(); }
    finally { await handle.close(); }
    try { await rename(temporary, target); }
    catch (renameError) {
      if ((renameError as NodeJS.ErrnoException).code !== "EEXIST") throw renameError;
      if (await readFile(target, "utf8") !== contents) integrity("concurrent review package does not match its content address");
    }
    await fsyncDirectory(directory);
  }
  return sha256;
}

export async function readReviewPackage(root: string, featureId: string, sha256: string): Promise<unknown> {
  if (!validHash(sha256)) integrity("review package hash is invalid");
  let contents: string;
  try { contents = await readFile(path.join(packageDirectory(root, featureId), `${sha256}.json`), "utf8"); }
  catch { integrity("review package cannot be read", { featureId, sha256 }); }
  if (digest(contents!) !== sha256) integrity("review package digest does not match its address", { featureId, sha256 });
  try { return JSON.parse(contents!); }
  catch { integrity("review package is not valid JSON", { featureId, sha256 }); }
}

function safeSnapshotPath(pointer: ReviewPointer): string {
  if (!/^review\/snapshots\/[a-f0-9]{64}\.json$/.test(pointer.path)
    || pointer.path !== `review/snapshots/${pointer.sha256}.json`) integrity("review pointer path is invalid");
  return pointer.path;
}

export async function readReviewLedger(root: string, state: FeatureState): Promise<ReviewLedger> {
  if (!state.review) integrity("review pointer is missing", { featureId: state.featureId });
  const pointer = state.review;
  const relative = safeSnapshotPath(pointer);
  let contents: string;
  try { contents = await readFile(path.join(root, ".dev-flow", "features", state.featureId, relative), "utf8"); }
  catch { integrity("review snapshot cannot be read", { featureId: state.featureId, path: relative }); }
  if (digest(contents!) !== pointer.sha256) integrity("review snapshot digest does not match pointer", { featureId: state.featureId });
  let ledger: ReviewLedger;
  try { ledger = JSON.parse(contents!) as ReviewLedger; }
  catch { integrity("review snapshot is not valid JSON", { featureId: state.featureId }); }
  validateLedger(ledger!);
  if (ledger!.featureId !== state.featureId || ledger!.revision !== pointer.revision || ledger!.stateRevision > state.revision
    || !sameSummary(ledger!.summary, pointer.summary)) {
    integrity("review pointer and ledger revisions do not match", { featureId: state.featureId });
  }
  return ledger!;
}

/** Prepare an immutable successor ledger before a state CAS changes review basis input. */
export async function prepareReviewInvalidation(
  root: string,
  state: Readonly<FeatureState>,
  nextStateRevision: number,
): Promise<ReviewPointer | undefined> {
  if (!state.review) return undefined;
  const ledger = await readReviewLedger(root, state as FeatureState);
  const batches = ledger.batches.map((batch) => batch.validity === "current" ? { ...batch, validity: "stale" as const } : batch);
  if (batches.every((batch, index) => batch === ledger.batches[index])) return undefined;
  return writeReviewSnapshot(root, {
    ...ledger,
    revision: ledger.revision + 1,
    stateRevision: nextStateRevision,
    batches,
    summary: reviewSummary(batches),
  });
}

export async function listOrphanReviewSnapshots(root: string, state: FeatureState): Promise<string[]> {
  let entries: string[];
  try { entries = await readdir(snapshotDirectory(root, state.featureId)); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return []; throw error; }
  const active = state.review?.path.split("/").at(-1);
  return entries.filter((entry) => /^[a-f0-9]{64}\.json$/.test(entry) && entry !== active).sort();
}
