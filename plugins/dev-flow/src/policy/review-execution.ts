import { parseEvidenceObjectRef, type EvidenceObjectRef } from "./evidence-store.js";
import type { ReviewRole } from "./review.js";

/**
 * Phase 5 execution contract. `parallel-execution` describes the concurrency
 * contract only; proof source is recorded per envelope and never mixed into
 * the execution mode.
 */

export type ReviewExecutionMode = "parallel-execution";
export type ReviewExecutionSource = "claude-subagent" | "server-sampling";

export type ReviewExecutionJobState = "pending" | "leased" | "envelope-captured" | "submitted";

export interface ReviewExecutionLease {
  jobId: string;
  role: ReviewRole;
  capabilityHash: string;
  declarationId?: string;
  packageSha256: string;
  leaseGeneration: number;
  leasedAt: string;
  leaseExpiresAt: string;
  state: ReviewExecutionJobState;
}

export interface ReviewExecutionRecord {
  schemaVersion: 1;
  featureId: string;
  batchId: string;
  executionRequestId: string;
  source: ReviewExecutionSource;
  host: "claude" | "codex";
  startedAt: string;
  leases: ReviewExecutionLease[];
  envelopes: EvidenceObjectRef[];
  generation: number;
}

export interface ReviewResultEnvelope {
  schemaVersion: 1;
  featureId: string;
  batchId: string;
  jobId: string;
  role: ReviewRole;
  packageSha256: string;
  capabilityHash: string;
  executionRequestId: string;
  leaseGeneration: number;
  declarationId?: string;
  source: ReviewExecutionSource;
  host: "claude" | "codex";
  hostEventId?: string;
  parentContext?: string;
  childContext?: string;
  agentId?: string;
  startedAt: string;
  completedAt: string;
  rawResultSha256: string;
  parsedCompletionSha256?: string;
  rawResultRef: EvidenceObjectRef;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isSha256(value: unknown): value is string {
  return typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
}

function validRole(value: unknown): ReviewRole {
  const roles: ReviewRole[] = [
    "code-quality", "requirement-fidelity", "requirements-coverage",
    "architecture-testability", "rollback-operability", "security",
    "data-irreversibility", "money-safety", "contract-failure",
    "recovery-observability", "critical-correctness",
  ];
  if (typeof value !== "string" || !roles.includes(value as ReviewRole)) throw new TypeError("invalid review role");
  return value as ReviewRole;
}

function validDate(value: unknown): string {
  if (typeof value !== "string" || Number.isNaN(Date.parse(value))) throw new TypeError("invalid review execution date");
  return value;
}

export function parseReviewResultEnvelope(value: unknown): ReviewResultEnvelope {
  if (!isRecord(value) || value.schemaVersion !== 1
    || typeof value.featureId !== "string" || !value.featureId
    || typeof value.batchId !== "string" || typeof value.jobId !== "string"
    || !isSha256(value.packageSha256) || !isSha256(value.capabilityHash)
    || typeof value.executionRequestId !== "string" || !value.executionRequestId
    || !Number.isInteger(value.leaseGeneration) || (value.leaseGeneration as number) < 0
    || (value.source !== "claude-subagent" && value.source !== "server-sampling")
    || (value.host !== "claude" && value.host !== "codex")
    || (value.declarationId !== undefined && (typeof value.declarationId !== "string" || !value.declarationId))
    || (value.hostEventId !== undefined && typeof value.hostEventId !== "string")
    || (value.parentContext !== undefined && typeof value.parentContext !== "string")
    || (value.childContext !== undefined && typeof value.childContext !== "string")
    || (value.agentId !== undefined && typeof value.agentId !== "string")
    || !isSha256(value.rawResultSha256)
    || (value.parsedCompletionSha256 !== undefined && !isSha256(value.parsedCompletionSha256))) {
    throw new TypeError("invalid review result envelope");
  }
  const v = value as Record<string, unknown>;
  return {
    schemaVersion: 1,
    featureId: String(v.featureId),
    batchId: String(v.batchId),
    jobId: String(v.jobId),
    role: validRole(v.role as ReviewRole),
    packageSha256: String(v.packageSha256),
    capabilityHash: String(v.capabilityHash),
    executionRequestId: String(v.executionRequestId),
    leaseGeneration: Number(v.leaseGeneration),
    ...(v.declarationId !== undefined ? { declarationId: String(v.declarationId) } : {}),
    source: v.source as ReviewExecutionSource,
    host: v.host as "claude" | "codex",
    ...(v.hostEventId !== undefined ? { hostEventId: String(v.hostEventId) } : {}),
    ...(v.parentContext !== undefined ? { parentContext: String(v.parentContext) } : {}),
    ...(v.childContext !== undefined ? { childContext: String(v.childContext) } : {}),
    ...(v.agentId !== undefined ? { agentId: String(v.agentId) } : {}),
    startedAt: validDate(v.startedAt as string),
    completedAt: validDate(v.completedAt as string),
    rawResultSha256: String(v.rawResultSha256),
    ...(v.parsedCompletionSha256 !== undefined ? { parsedCompletionSha256: String(v.parsedCompletionSha256) } : {}),
    rawResultRef: parseEvidenceObjectRef(v.rawResultRef),
  };
}

export function parseReviewExecutionRecord(value: unknown): ReviewExecutionRecord {
  if (!isRecord(value) || value.schemaVersion !== 1
    || typeof value.featureId !== "string" || !value.featureId
    || typeof value.batchId !== "string" || typeof value.executionRequestId !== "string"
    || (value.source !== "claude-subagent" && value.source !== "server-sampling")
    || (value.host !== "claude" && value.host !== "codex")
    || !Number.isInteger(value.generation) || (value.generation as number) < 0
    || !Array.isArray(value.leases) || !Array.isArray(value.envelopes)) {
    throw new TypeError("invalid review execution record");
  }
  const v = value as Record<string, unknown>;
  const leases = (v.leases as unknown[]).map((leaseValue) => {
    const lease = leaseValue as Record<string, unknown>;
    if (typeof lease.jobId !== "string" || typeof lease.capabilityHash !== "string"
      || typeof lease.packageSha256 !== "string" || !Number.isInteger(lease.leaseGeneration)
      || typeof lease.leasedAt !== "string" || typeof lease.leaseExpiresAt !== "string"
      || (lease.state !== "pending" && lease.state !== "leased" && lease.state !== "envelope-captured" && lease.state !== "submitted")
      || (lease.declarationId !== undefined && typeof lease.declarationId !== "string")) {
      throw new TypeError("invalid review execution lease");
    }
    return {
      jobId: String(lease.jobId),
      role: validRole(lease.role as ReviewRole),
      capabilityHash: String(lease.capabilityHash),
      ...(lease.declarationId !== undefined ? { declarationId: String(lease.declarationId) } : {}),
      packageSha256: String(lease.packageSha256),
      leaseGeneration: Number(lease.leaseGeneration),
      leasedAt: validDate(lease.leasedAt as string),
      leaseExpiresAt: validDate(lease.leaseExpiresAt as string),
      state: lease.state as ReviewExecutionJobState,
    };
  });
  return {
    schemaVersion: 1,
    featureId: String(v.featureId),
    batchId: String(v.batchId),
    executionRequestId: String(v.executionRequestId),
    source: v.source as ReviewExecutionSource,
    host: v.host as "claude" | "codex",
    startedAt: validDate(v.startedAt as string),
    leases,
    envelopes: (v.envelopes as unknown[]).map(parseEvidenceObjectRef),
    generation: Number(v.generation),
  };
}
