import { createHash, randomUUID } from "node:crypto";
import { mkdir, open, readFile, rename } from "node:fs/promises";
import path from "node:path";
import { stableJson } from "../policy/stable-json.js";
import {
  parseReviewExecutionRecord,
  parseReviewResultEnvelope,
  type ReviewExecutionJobState,
  type ReviewExecutionRecord,
  type ReviewExecutionSource,
  type ReviewResultEnvelope,
} from "../policy/review-execution.js";
import { deriveReviewJobRequirements, parseReviewJobCompletion, type ReviewRole, type ReviewBatch } from "../policy/review.js";
import { parseEvidenceObjectRef, type EvidenceObjectRef, type EvidenceStorePointer } from "../policy/evidence-store.js";
import { putEvidenceObject, readEvidenceObject, evidenceStorePointer } from "./evidence-store.js";
import { DevFlowError } from "./errors.js";
import { readReviewLedger, reviewSummary, writeReviewSnapshot } from "./review-store.js";
import { submitParsedReviewJob } from "./review-jobs.js";
import { appendFeatureEvent, mutatePrepared, readFeatureEvents, readState, type FeatureState } from "./state-store.js";
import { satisfyObligations } from "../policy/obligations.js";

const sha256 = (bytes: Buffer | string): string => createHash("sha256").update(bytes).digest("hex");

export interface HostReviewEnvelopeInput {
  featureId: string;
  batchId: string;
  jobId: string;
  role: ReviewRole;
  packageSha256: string;
  capabilityHash: string;
  executionRequestId: string;
  leaseGeneration: number;
  declarationId?: string;
  source: "claude-subagent" | "server-sampling";
  host: "claude" | "codex";
  hostEventId?: string;
  parentContext?: string;
  childContext?: string;
  agentId?: string;
  startedAt: string;
  completedAt: string;
  rawResult: Buffer | string;
  parsedCompletion?: Buffer | string;
}

/**
 * Freeze one host-captured review result as an immutable Evidence Store
 * envelope. The envelope binds identity, job/package/capability, execution and
 * raw output; nothing here mutates feature state.
 */
export async function captureHostReviewEnvelope(
  root: string,
  input: HostReviewEnvelopeInput,
): Promise<{ ref: Awaited<ReturnType<typeof putEvidenceObject>>["ref"]; envelope: ReviewResultEnvelope }> {
  if (input.rawResult === undefined || input.rawResult === null) throw new TypeError("review envelope rawResult is required");
  const rawBytes = Buffer.isBuffer(input.rawResult) ? input.rawResult : Buffer.from(input.rawResult, "utf8");
  const rawStored = await putEvidenceObject(root, input.featureId, "review-result", rawBytes);
  const envelope: ReviewResultEnvelope = {
    schemaVersion: 1,
    featureId: input.featureId,
    batchId: input.batchId,
    jobId: input.jobId,
    role: input.role,
    packageSha256: input.packageSha256,
    capabilityHash: input.capabilityHash,
    executionRequestId: input.executionRequestId,
    leaseGeneration: input.leaseGeneration,
    ...(input.declarationId ? { declarationId: input.declarationId } : {}),
    source: input.source,
    host: input.host,
    ...(input.hostEventId ? { hostEventId: input.hostEventId } : {}),
    ...(input.parentContext ? { parentContext: input.parentContext } : {}),
    ...(input.childContext ? { childContext: input.childContext } : {}),
    ...(input.agentId ? { agentId: input.agentId } : {}),
    startedAt: input.startedAt,
    completedAt: input.completedAt,
    rawResultSha256: rawStored.ref.sha256,
    ...(input.parsedCompletion
      ? { parsedCompletionSha256: sha256(Buffer.isBuffer(input.parsedCompletion) ? input.parsedCompletion : Buffer.from(input.parsedCompletion, "utf8")) }
      : {}),
    rawResultRef: rawStored.ref,
  };
  const envelopeStored = await putEvidenceObject(root, input.featureId, "review-result", Buffer.from(`${stableJson(envelope)}\n`, "utf8"));
  parseReviewResultEnvelope(envelope);
  return { ref: envelopeStored.ref, envelope };
}

/** Read and validate one immutable envelope by its logical ref. */
export async function readHostReviewEnvelope(
  root: string,
  featureId: string,
  ref: Awaited<ReturnType<typeof putEvidenceObject>>["ref"],
): Promise<ReviewResultEnvelope> {
  const bytes = await readEvidenceObject(root, featureId, ref);
  let envelope: ReviewResultEnvelope;
  try {
    envelope = parseReviewResultEnvelope(JSON.parse(bytes.toString("utf8")));
  } catch (error) {
    throw new DevFlowError("REVIEW_ENVELOPE_INVALID", "review result envelope is invalid", {
      featureId,
      cause: error instanceof Error ? error.message : String(error),
    });
  }
  if (envelope.featureId !== featureId) throw new DevFlowError("REVIEW_ENVELOPE_INVALID", "envelope featureId mismatch", { featureId });
  return envelope;
}

const leaseMilliseconds = 60 * 60 * 1000;

interface ExecutionIndexEntry {
  executionRequestId: string;
  ref: EvidenceObjectRef;
  capabilities: Array<{ jobId: string; capability: string; declarationId?: string }>;
}

interface ExecutionIndex {
  schemaVersion: 1;
  featureId: string;
  entries: ExecutionIndexEntry[];
}

function executionDirectory(root: string, featureId: string): string {
  return path.join(root, ".dev-flow", "features", featureId, "review", "executions");
}

function executionIndexPath(root: string, featureId: string): string {
  return path.join(executionDirectory(root, featureId), "index.json");
}

async function readExecutionIndex(root: string, featureId: string): Promise<ExecutionIndex> {
  try {
    const raw = await readFile(executionIndexPath(root, featureId), "utf8");
    const value = JSON.parse(raw) as Partial<ExecutionIndex>;
    if (!value || value.schemaVersion !== 1 || value.featureId !== featureId || !Array.isArray(value.entries)) {
      throw new TypeError("invalid review execution index");
    }
    return value as ExecutionIndex;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { schemaVersion: 1, featureId, entries: [] };
    throw error;
  }
}

async function writeExecutionIndex(root: string, featureId: string, index: ExecutionIndex): Promise<void> {
  const directory = executionDirectory(root, featureId);
  await mkdir(directory, { recursive: true });
  const target = executionIndexPath(root, featureId);
  const temporary = path.join(directory, `.index.${randomUUID()}.tmp`);
  const handle = await open(temporary, "wx");
  try {
    await handle.writeFile(`${stableJson(index)}\n`);
    await handle.sync();
  } finally {
    await handle.close();
  }
  await rename(temporary, target);
}

async function writeReviewExecutionRecord(root: string, featureId: string, record: ReviewExecutionRecord): Promise<{ ref: EvidenceObjectRef; pointer: EvidenceStorePointer }> {
  const stored = await putEvidenceObject(root, featureId, "review-execution", Buffer.from(`${stableJson(record)}\n`, "utf8"));
  return { ref: stored.ref, pointer: stored.pointer };
}

async function readReviewExecutionRecord(root: string, featureId: string, executionRequestId: string): Promise<ReviewExecutionRecord> {
  const index = await readExecutionIndex(root, featureId);
  const entry = index.entries.find((candidate) => candidate.executionRequestId === executionRequestId);
  if (!entry) throw new DevFlowError("REVIEW_EXECUTION_NOT_FOUND", "review execution record not found", { executionRequestId });
  const bytes = await readEvidenceObject(root, featureId, entry.ref);
  return parseReviewExecutionRecord(JSON.parse(bytes.toString("utf8")));
}

export interface StartedReviewExecutionJob {
  jobId: string;
  role: ReviewRole;
  capability: string;
  declarationId?: string;
  packageSha256: string;
}

export interface StartReviewExecutionResult {
  state: FeatureState;
  batchId: string;
  executionRequestId: string;
  jobs: StartedReviewExecutionJob[];
  idempotent: boolean;
}

function requireExecutionRequestId(value: string): void {
  if (typeof value !== "string" || value.length < 24 || !/[A-Za-z]/.test(value) || !/[0-9]/.test(value)) {
    throw new DevFlowError("REVIEW_EXECUTION_REQUEST_INVALID", "executionRequestId must be an unguessable high-entropy value");
  }
}

function currentReviewBatch(ledger: Awaited<ReturnType<typeof readReviewLedger>>, batchId: string): ReviewBatch {
  const batch = ledger.batches.find((candidate) => candidate.batchId === batchId && candidate.validity === "current");
  if (!batch) throw new DevFlowError("REVIEW_BATCH_NOT_CURRENT", "review batch is not current", { batchId });
  return batch;
}

function isolationProofForEnvelope(envelope: ReviewResultEnvelope, events: Awaited<ReturnType<typeof readFeatureEvents>>): { mode: "subagent"; hostEventId: string } | undefined {
  if (envelope.source !== "claude-subagent" || !envelope.hostEventId || !envelope.parentContext || !envelope.childContext) return undefined;
  if (envelope.parentContext === envelope.childContext) return undefined;
  const proofEvent = events.find((event) => {
    const data = event.data as { eventId?: string; type?: string; host?: string; contextId?: string; implementationContextId?: string };
    return event.type === "review-execution" && data?.type === "review-execution"
      && data.eventId === envelope.hostEventId && data.host === envelope.host
      && data.contextId === envelope.childContext && data.implementationContextId === envelope.parentContext;
  });
  return proofEvent ? { mode: "subagent", hostEventId: envelope.hostEventId } : undefined;
}

export type ReviewSamplingFn = (job: { role: string; reviewDepth: string; package: unknown }) => Promise<unknown>;

export interface StartReviewExecutionOptions {
  /** Server-sampling port. Required for non-Claude hosts; callers must not self-report isolation. */
  sampleReview?: ReviewSamplingFn;
  now?: Date;
}

export async function startReviewExecution(
  root: string,
  featureId: string,
  expectedRevision: number,
  batchId: string,
  host: "claude" | "codex",
  executionRequestId: string,
  options: StartReviewExecutionOptions | Date = {},
): Promise<StartReviewExecutionResult> {
  requireExecutionRequestId(executionRequestId);
  const resolved = options instanceof Date ? { now: options } : options;
  const now = resolved.now ?? new Date();
  const useSampling = host !== "claude";
  if (useSampling && !resolved.sampleReview) {
    throw new DevFlowError("REVIEW_EXECUTION_UNAVAILABLE", `${host} review execution is unavailable until a trusted sampling path is wired`, {
      host,
      recoveryHint: "Codex 当前只允许 server sampling；客户端未声明 sampling/createMessage 时 review 不能启动。更新插件并重开会话，或走既有 quality-exception。",
    });
  }
  const existingIndex = await readExecutionIndex(root, featureId);
  const existingEntry = existingIndex.entries.find((entry) => entry.executionRequestId === executionRequestId);
  let result: Omit<StartReviewExecutionResult, "state"> | undefined;
  const state = await mutatePrepared(root, featureId, expectedRevision, "review-execution-started", async (current, nextStateRevision) => {
    const ledger = await readReviewLedger(root, current);
    const batch = currentReviewBatch(ledger, batchId);
    const phase = batch.phase ?? "plan";
    const requirements = deriveReviewJobRequirements(current.route, current.classification.riskLabels, current.classification.controls.reviewRoles, phase);
    if (!requirements.length) throw new DevFlowError("REVIEW_ROUTE_UNSUPPORTED", "current route has no review jobs to execute");
    const pending = batch.jobs.filter((job) => job.status !== "submitted" && job.status !== "reused" && requirements.some((requirement) => requirement.role === job.role));
    if (existingEntry) {
      const jobs = existingEntry.capabilities.map((capability) => {
        const job = batch.jobs.find((candidate) => candidate.jobId === capability.jobId);
        return {
          jobId: capability.jobId,
          role: job?.role as ReviewRole,
          capability: capability.capability,
          ...(capability.declarationId ? { declarationId: capability.declarationId } : {}),
          packageSha256: job?.packageSha256 ?? "",
        };
      });
      result = { batchId, executionRequestId, jobs, idempotent: true };
      return { mutate: () => undefined, unchanged: true, eventData: { executionRequestId, idempotent: true } };
    }
    const leases = pending.map((job) => {
      const capability = `${executionRequestId}:${job.jobId}:${randomUUID()}`;
      return {
        job,
        capability,
        declarationId: randomUUID(),
        lease: {
          jobId: job.jobId,
          role: job.role,
          capabilityHash: sha256(capability),
          declarationId: "",
          packageSha256: job.packageSha256,
          leaseGeneration: 1,
          leasedAt: now.toISOString(),
          leaseExpiresAt: new Date(now.getTime() + leaseMilliseconds).toISOString(),
          state: "leased" as ReviewExecutionJobState,
        },
      };
    });
    for (const lease of leases) {
      await appendFeatureEvent(root, featureId, current.revision, "review-execution-declared", {
        type: "review-execution-declared",
        declarationId: lease.declarationId,
        executionRequestId,
        batchId,
        jobId: lease.job.jobId,
        role: lease.job.role,
        capabilityHash: lease.lease.capabilityHash,
        packageSha256: lease.job.packageSha256,
        leaseGeneration: lease.lease.leaseGeneration,
        host,
        declaredAt: now.toISOString(),
      });
    }
    const batches = ledger.batches.map((candidate) => candidate.batchId !== batchId ? candidate : {
      ...batch,
      jobs: batch.jobs.map((job) => {
        const lease = leases.find((candidate) => candidate.job.jobId === job.jobId);
        if (!lease) return job;
        return {
          ...job,
          status: "claimed" as const,
          claim: {
            requestSha256: sha256(lease.capability),
            claimedAt: lease.lease.leasedAt,
            leaseExpiresAt: lease.lease.leaseExpiresAt,
          },
        };
      }),
    });
    const pointer = await writeReviewSnapshot(root, {
      ...ledger,
      revision: ledger.revision + 1,
      stateRevision: nextStateRevision,
      batches,
      summary: reviewSummary(batches),
    });
    const record: ReviewExecutionRecord = {
      schemaVersion: 1,
      featureId,
      batchId,
      executionRequestId,
      source: (useSampling ? "server-sampling" : "claude-subagent") as ReviewExecutionSource,
      host,
      startedAt: now.toISOString(),
      leases: leases.map((lease) => ({ ...lease.lease, declarationId: lease.declarationId })),
      envelopes: [],
      generation: 1,
    };
    const stored = await writeReviewExecutionRecord(root, featureId, record);
    const nextIndex = {
      ...existingIndex,
      entries: [
        ...existingIndex.entries,
        {
          executionRequestId,
          ref: stored.ref,
          capabilities: leases.map((lease) => ({
            jobId: lease.job.jobId,
            capability: lease.capability,
            declarationId: lease.declarationId,
          })),
        },
      ],
    };
    await writeExecutionIndex(root, featureId, nextIndex);
    result = {
      batchId,
      executionRequestId,
      jobs: leases.map((lease) => ({
        jobId: lease.job.jobId,
        role: lease.job.role,
        capability: lease.capability,
        declarationId: lease.declarationId,
        packageSha256: lease.job.packageSha256,
      })),
      idempotent: false,
    };
    return {
      mutate: (draft) => {
        draft.review = pointer;
        draft.evidenceStore = stored.pointer;
      },
      eventData: { batchId, executionRequestId, jobs: result!.jobs.map((job) => job.jobId) },
    };
  });
  if (useSampling && resolved.sampleReview && result && !result.idempotent) {
    const { getReviewJob } = await import("./review-jobs.js");
    const sampledJobs = await Promise.all(result.jobs.map(async (job) => {
      const packed = await getReviewJob(root, featureId, batchId, job.jobId, job.capability);
      const sampled = await resolved.sampleReview!({
        role: job.role,
        reviewDepth: packed.job.reviewDepth,
        package: packed.package,
      });
      return { job, sampled };
    }));
    for (const { job, sampled } of sampledJobs) {
      const rawResult = Buffer.from(`${stableJson(sampled)}\n`, "utf8");
      const captured = await captureHostReviewEnvelope(root, {
        featureId,
        batchId,
        jobId: job.jobId,
        role: job.role,
        packageSha256: job.packageSha256,
        capabilityHash: sha256(job.capability),
        executionRequestId,
        leaseGeneration: 1,
        ...(job.declarationId ? { declarationId: job.declarationId } : {}),
        source: "server-sampling",
        host,
        startedAt: now.toISOString(),
        completedAt: new Date().toISOString(),
        rawResult,
        parsedCompletion: rawResult,
      });
      await recordCapturedEnvelope(root, featureId, executionRequestId, captured.ref);
    }
  }
  return { ...result!, state };
}

/** Append one captured envelope ref to its execution record without feature revision. */
export async function recordCapturedEnvelope(
  root: string,
  featureId: string,
  executionRequestId: string,
  envelopeRef: EvidenceObjectRef,
): Promise<void> {
  const index = await readExecutionIndex(root, featureId);
  const entry = index.entries.find((candidate) => candidate.executionRequestId === executionRequestId);
  if (!entry) throw new DevFlowError("REVIEW_EXECUTION_NOT_FOUND", "review execution record not found", { executionRequestId });
  const record = await readReviewExecutionRecord(root, featureId, executionRequestId);
  if (record.envelopes.some((ref) => ref.sha256 === envelopeRef.sha256 && ref.kind === envelopeRef.kind)) return;
  const updated: ReviewExecutionRecord = { ...record, envelopes: [...record.envelopes, envelopeRef] };
  const stored = await writeReviewExecutionRecord(root, featureId, updated);
  await writeExecutionIndex(root, featureId, {
    ...index,
    entries: index.entries.map((candidate) => candidate.executionRequestId === executionRequestId
      ? { ...candidate, ref: stored.ref }
      : candidate),
  });
}

/** Evidence Store roots referenced by the review execution index and its envelopes. */
export async function reviewExecutionEvidenceRoots(root: string, featureId: string): Promise<EvidenceObjectRef[]> {
  const index = await readExecutionIndex(root, featureId);
  const refs: EvidenceObjectRef[] = [];
  for (const entry of index.entries) {
    if (refs.some((candidate) => candidate.kind === entry.ref.kind && candidate.sha256 === entry.ref.sha256)) continue;
    refs.push(entry.ref);
    const record = await readReviewExecutionRecord(root, featureId, entry.executionRequestId);
    for (const envelopeRef of record.envelopes) {
      if (!refs.some((candidate) => candidate.kind === envelopeRef.kind && candidate.sha256 === envelopeRef.sha256)) refs.push(envelopeRef);
      const envelope = await readHostReviewEnvelope(root, featureId, envelopeRef);
      if (!refs.some((candidate) => candidate.kind === envelope.rawResultRef.kind && candidate.sha256 === envelope.rawResultRef.sha256)) refs.push(envelope.rawResultRef);
    }
  }
  return refs;
}


export interface CompleteReviewExecutionResult {
  state: FeatureState;
  batch: ReviewBatch;
  submittedJobIds: string[];
}

export async function completeReviewExecution(
  root: string,
  featureId: string,
  expectedRevision: number,
  batchId: string,
  executionRequestId: string,
  now = new Date(),
): Promise<CompleteReviewExecutionResult> {
  const record = await readReviewExecutionRecord(root, featureId, executionRequestId);
  if (record.batchId !== batchId) throw new DevFlowError("REVIEW_EXECUTION_BATCH_MISMATCH", "execution record belongs to another batch", { executionRequestId, batchId });
  const events = await readFeatureEvents(root, featureId);
  let submittedJobIds: string[] = [];
  let completed: ReviewBatch | undefined;
  const state = await mutatePrepared(root, featureId, expectedRevision, "review-execution-completed", async (current, nextStateRevision) => {
    const ledger = await readReviewLedger(root, current);
    let batch = currentReviewBatch(ledger, batchId);
    const findingEvents = [...(ledger.findingEvents ?? [])];
    const leaseById = new Map(record.leases.map((lease) => [lease.jobId, lease]));
    for (const ref of record.envelopes) {
      const envelope = await readHostReviewEnvelope(root, featureId, ref);
      if (envelope.executionRequestId !== executionRequestId || envelope.batchId !== batchId) {
        throw new DevFlowError("REVIEW_ENVELOPE_EXECUTION_MISMATCH", "envelope does not belong to this execution", { envelope: ref });
      }
      const lease = leaseById.get(envelope.jobId);
      const job = batch.jobs.find((candidate) => candidate.jobId === envelope.jobId);
      if (!lease || !job) throw new DevFlowError("REVIEW_ENVELOPE_JOB_MISMATCH", "envelope job is not leased in this execution", { jobId: envelope.jobId });
      if (job.status === "submitted" || job.status === "reused") continue;
      if (!job.claim || job.claim.requestSha256 !== envelope.capabilityHash) {
        throw new DevFlowError("REVIEW_JOB_CAPABILITY_INVALID", "review job capability is invalid", { jobId: job.jobId });
      }
      const raw = await readEvidenceObject(root, featureId, envelope.rawResultRef);
      let parsed: ReturnType<typeof parseReviewJobCompletion>;
      try {
        parsed = parseReviewJobCompletion(JSON.parse(raw.toString("utf8")));
      } catch (error) {
        throw new DevFlowError("REVIEW_COMPLETION_INVALID", "review envelope raw result is not a valid completion", {
          jobId: job.jobId,
          cause: error instanceof Error ? error.message : String(error),
        });
      }
      const submitted = await submitParsedReviewJob(
        root,
        featureId,
        ledger,
        batch,
        job,
        parsed,
        new Date(envelope.completedAt),
        undefined,
        undefined,
        false,
        isolationProofForEnvelope(envelope, events),
      );
      batch = submitted.batch;
      findingEvents.push(...submitted.findingEvents);
      submittedJobIds.push(job.jobId);
    }
    const batches = ledger.batches.map((candidate) => candidate.batchId === batchId ? batch : candidate);
    const pointer = await writeReviewSnapshot(root, {
      ...ledger,
      revision: ledger.revision + 1,
      stateRevision: nextStateRevision,
      batches,
      summary: reviewSummary(batches),
      findingEvents,
    });
    const updatedRecord: ReviewExecutionRecord = {
      ...record,
      leases: record.leases.map((lease) => {
        const job = batch.jobs.find((candidate) => candidate.jobId === lease.jobId);
        return { ...lease, state: job?.status === "submitted" ? "submitted" as const : lease.state };
      }),
      envelopes: record.envelopes,
    };
    const stored = await writeReviewExecutionRecord(root, featureId, updatedRecord);
    await writeExecutionIndex(root, featureId, {
      ...(await readExecutionIndex(root, featureId)),
      entries: (await readExecutionIndex(root, featureId)).entries.map((entry) => entry.executionRequestId === executionRequestId ? { ...entry, ref: stored.ref } : entry),
    });
    completed = batch;
    return {
      mutate: (draft) => {
        draft.review = pointer;
        draft.evidenceStore = stored.pointer;
        if (batch.progress === "complete") draft.obligations = satisfyObligations(draft.obligations, ["review"]);
      },
      eventData: { batchId, executionRequestId, submittedJobIds },
    };
  });
  return { state, batch: completed!, submittedJobIds };
}

