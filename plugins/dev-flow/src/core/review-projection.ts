import { createHash, randomUUID } from "node:crypto";
import { mkdir, open, readFile, rename } from "node:fs/promises";
import path from "node:path";
import { reviewEnforcementRequired } from "../policy/contract.js";
import { deriveReviewJobRequirements, evidenceSourcesForReviewBatch } from "../policy/review.js";
import type { ReviewBatch, ReviewEvidenceSource, ReviewFindingDisposition, ReviewJob, ReviewLedger } from "../policy/review.js";
import type { ReviewFinding } from "../policy/types.js";
import { DevFlowError } from "./errors.js";
import { readReviewLedger } from "./review-store.js";
import type { FeatureState } from "./state-store.js";
import { unresolvedBlockingFindings } from "./review-findings.js";

const digest = (contents: string | Buffer): string => createHash("sha256").update(contents).digest("hex");

export interface ReviewProjectionJob {
  jobId: string;
  role: string;
  reviewDepth: "standard" | "full";
  status: "pending" | "claimed" | "sampling" | "submitted" | "reused";
}

export interface ReviewProjectionFinding {
  findingId: string;
  jobId: string;
  severity: "blocking" | "warning" | "note";
  category: string;
  targets: string[];
  evidence: Array<{ path: string; line?: number }>;
  claim: string;
  recommendation: string;
}

export interface ReviewProjection {
  schemaVersion: 1;
  featureId: string;
  route: string;
  reviewPointer: { path: string; sha256: string; revision: number };
  assurance: {
    level?: string;
    evidenceType: "core-derived-review-batch";
    /** Honest labels for which evidence classes contributed; never invent verified. */
    evidenceSources: ReviewEvidenceSource[];
  };
  batch: {
    status: "not-created" | "current" | "stale";
    batchId?: string;
    basisHash?: string;
    progress?: "open" | "complete";
    executionMode?: string;
    requiredRoles: Array<{ role: string; reviewDepth: "standard" | "full" }>;
    jobs: ReviewProjectionJob[];
    visibility: "coarse" | "complete";
    /** Present only after every isolated job has submitted. */
    findings?: ReviewProjectionFinding[];
    dispositions?: Record<string, ReviewFindingDisposition>;
    unresolvedBlockingFindingIds?: string[];
  };
  staleBatches: Array<{ batchId: string; basisHash: string; progress: "open" | "complete" }>;
}

export interface CurrentReviewProjection {
  artifact: { path: string; sha256: string };
  model: ReviewProjection;
  markdown: string;
}

function projectionError(message: string, details: Record<string, unknown> = {}): never {
  throw new DevFlowError("REVIEW_PROJECTION_INVALID", message, details);
}

function currentBatch(ledger: ReviewLedger): ReviewBatch | undefined {
  const batches = ledger.batches.filter((batch) => batch.validity === "current");
  if (batches.length > 1) projectionError("review ledger has more than one current batch");
  return batches[0];
}

function publicJob(job: ReviewJob): ReviewProjectionJob {
  return { jobId: job.jobId, role: job.role, reviewDepth: job.reviewDepth, status: job.status };
}

function publicFinding(finding: ReviewFinding): ReviewProjectionFinding {
  return {
    findingId: finding.findingId,
    jobId: finding.jobId,
    severity: finding.severity,
    category: finding.category,
    targets: [...finding.targets],
    evidence: finding.evidence.map((evidence) => ({ ...evidence })),
    claim: finding.claim,
    recommendation: finding.recommendation,
  };
}

function unresolvedBlockingFindingIds(ledger: ReviewLedger): string[] {
  if (ledger.findingEvents?.length) {
    const current = ledger.batches.find((batch) => batch.validity === "current");
    const roleBasis = (origin: import("../policy/review.js").ReviewFindingEvent & { type: "origin" }) => current?.jobs.find((job) => job.role === origin.role)?.roleBasisHash;
    return unresolvedBlockingFindings(ledger, roleBasis).map((finding) => finding.findingId).sort();
  }
  const dispositions = Object.fromEntries(ledger.batches.flatMap((batch) => Object.entries(batch.dispositions ?? {})));
  return ledger.batches.flatMap((batch) => batch.jobs.flatMap((job) => job.submission?.findings ?? []))
    .filter((finding) => finding.severity === "blocking" && !dispositions[finding.findingId])
    .map((finding) => finding.findingId)
    .sort();
}

/**
 * This is the single visibility calculation for status JSON and the generated
 * Markdown. An incomplete batch exposes only its scheduling metadata so one
 * reviewer cannot learn a sibling's findings before the batch is complete.
 */
export function reviewProjectionModel(state: FeatureState, ledger: ReviewLedger): ReviewProjection {
  const batch = currentBatch(ledger);
  const staleBatches = ledger.batches.filter((candidate) => candidate.validity === "stale")
    .map((candidate) => ({ batchId: candidate.batchId, basisHash: candidate.basisHash, progress: candidate.progress }));
  const requiredRoles = batch
    ? batch.jobs.map((job) => ({ role: job.role, reviewDepth: job.reviewDepth }))
    : deriveReviewJobRequirements(state.route, state.classification.riskLabels)
      .map((requirement) => ({ role: requirement.role, reviewDepth: requirement.reviewDepth }));
  const complete = batch?.progress === "complete";
  const findings = complete
    ? batch!.jobs.flatMap((job) => job.submission?.findings ?? []).map(publicFinding)
    : undefined;
  return {
    schemaVersion: 1,
    featureId: state.featureId,
    route: state.route,
    reviewPointer: {
      path: state.review!.path,
      sha256: state.review!.sha256,
      revision: state.review!.revision,
    },
    assurance: {
      ...(batch ? { level: batch.assuranceLevel } : {}),
      evidenceType: "core-derived-review-batch",
      evidenceSources: evidenceSourcesForReviewBatch(batch),
    },
    batch: {
      status: batch ? batch.validity : "not-created",
      ...(batch ? {
        batchId: batch.batchId,
        basisHash: batch.basisHash,
        progress: batch.progress,
        executionMode: batch.executionMode,
      } : {}),
      requiredRoles,
      jobs: batch ? batch.jobs.map(publicJob) : [],
      visibility: complete ? "complete" : "coarse",
      ...(complete ? {
        findings,
        dispositions: { ...batch!.dispositions },
        unresolvedBlockingFindingIds: unresolvedBlockingFindingIds(ledger),
      } : {}),
    },
    staleBatches,
  };
}

export function renderReviewProjection(model: ReviewProjection): string {
  const batch = model.batch;
  const lines = [
    "---",
    "dev_flow:",
    "  schema_version: 1",
    `  feature_id: ${model.featureId}`,
    `  route: ${model.route}`,
    "  kind: plan-review",
    "  generated: true",
    "---",
    "",
    "# Plan Review",
    "",
    "## Review Ledger",
    "",
    `- Pointer: ${model.reviewPointer.path}`,
    `- Revision: ${model.reviewPointer.revision}`,
    `- Batch status: ${batch.status}`,
    `- Evidence type: ${model.assurance.evidenceType}`,
    ...(model.assurance.level ? [`- Assurance: ${model.assurance.level}`] : []),
    ...(model.assurance.evidenceSources.length
      ? [`- Evidence sources: ${model.assurance.evidenceSources.join(", ")}`]
      : []),
    ...(model.assurance.level === "independent-sampling"
      ? ["- Note: independent-sampling is server sampling provenance, not multi-agent identity."]
      : []),
    ...(batch.batchId ? [`- Batch ID: ${batch.batchId}`, `- Basis hash: ${batch.basisHash}`, `- Diagnostic execution: ${batch.executionMode}`, `- Progress: ${batch.progress}`] : []),
    "",
    "## Required Review Jobs",
    "",
    ...(batch.requiredRoles.length
      ? batch.requiredRoles.map((required) => {
        const job = batch.jobs.find((candidate) => candidate.role === required.role);
        return `- ${required.role} (${required.reviewDepth}): ${job?.status ?? "pending"}`;
      })
      : ["- No review batch has been created yet."]),
    "",
  ];
  if (batch.visibility === "coarse") {
    lines.push(
      "## Visibility",
      "",
      "- Waiting for all required jobs. Findings and reviewer submissions remain isolated until the batch is complete.",
      "",
    );
  } else {
    lines.push("## Findings", "");
    if (batch.findings!.length) {
      for (const finding of batch.findings!) {
        lines.push(`- ${finding.findingId} [${finding.severity}] ${finding.category}: ${finding.claim}`);
      }
    } else lines.push("- No findings submitted.");
    lines.push("", "## Dispositions", "");
    const dispositions = Object.entries(batch.dispositions ?? {});
    if (dispositions.length) {
      for (const [findingId, disposition] of dispositions) lines.push(`- ${findingId}: ${disposition.kind}`);
    } else lines.push("- No dispositions recorded.");
    lines.push("", "## Unresolved Blocking Findings", "");
    if (batch.unresolvedBlockingFindingIds!.length) {
      for (const findingId of batch.unresolvedBlockingFindingIds!) lines.push(`- ${findingId}`);
    } else lines.push("- None.");
    lines.push("");
  }
  if (model.staleBatches.length) {
    lines.push("## Stale / Superseded Batches", "");
    for (const stale of model.staleBatches) lines.push(`- ${stale.batchId}: ${stale.progress} (basis ${stale.basisHash})`);
    lines.push("");
  }
  return `${lines.join("\n")}\n`;
}

function projectionDirectory(root: string, featureId: string): string {
  return path.join(root, ".dev-flow", "features", featureId, "review", "projections");
}

async function fsyncDirectory(directory: string): Promise<void> {
  const handle = await open(directory, "r");
  try { await handle.sync(); } finally { await handle.close(); }
}

async function writeProjection(root: string, featureId: string, markdown: string): Promise<{ path: string; sha256: string }> {
  const sha256 = digest(markdown);
  const directory = projectionDirectory(root, featureId);
  const target = path.join(directory, `${sha256}.md`);
  await mkdir(directory, { recursive: true });
  try {
    const existing = await readFile(target, "utf8");
    if (existing !== markdown) projectionError("existing review projection does not match its content address");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    const temporary = path.join(directory, `.${sha256}.${randomUUID()}.tmp`);
    const handle = await open(temporary, "wx");
    try { await handle.writeFile(markdown); await handle.sync(); }
    finally { await handle.close(); }
    try { await rename(temporary, target); }
    catch (renameError) {
      if ((renameError as NodeJS.ErrnoException).code !== "EEXIST") throw renameError;
      if (await readFile(target, "utf8") !== markdown) projectionError("concurrent review projection does not match its content address");
    }
    await fsyncDirectory(directory);
  }
  return { path: `review/projections/${sha256}.md`, sha256 };
}

export async function prepareReviewProjection(root: string, state: FeatureState): Promise<void> {
  if (state.mode !== "routed" || !state.route || !state.classification) return;
  if (!reviewEnforcementRequired(state.route, state.classification.controls)) return;
  if (!state.review) projectionError("review-enabled feature has no review pointer", { featureId: state.featureId });
  const ledger = await readReviewLedger(root, state);
  const model = reviewProjectionModel(state, ledger);
  const artifact = await writeProjection(root, state.featureId, renderReviewProjection(model));
  state.artifacts["plan-review"] = artifact;
}

function validProjectionArtifact(artifact: { path: string; sha256: string } | undefined): artifact is { path: string; sha256: string } {
  return Boolean(artifact)
    && /^review\/projections\/[a-f0-9]{64}\.md$/.test(artifact!.path)
    && /^[a-f0-9]{64}$/.test(artifact!.sha256)
    && artifact!.path === `review/projections/${artifact!.sha256}.md`;
}

/** Validate that the immutable ledger and its read-only artifact projection agree. */
export async function readReviewProjection(root: string, state: FeatureState): Promise<CurrentReviewProjection | undefined> {
  if (state.mode !== "routed" || !state.route || !state.classification) return undefined;
  if (!reviewEnforcementRequired(state.route, state.classification.controls)) return undefined;
  const artifact = state.artifacts["plan-review"];
  if (!validProjectionArtifact(artifact)) projectionError("review projection artifact pointer is missing or invalid", { featureId: state.featureId });
  let markdown: string;
  try { markdown = await readFile(path.join(root, ".dev-flow", "features", state.featureId, artifact.path), "utf8"); }
  catch { projectionError("review projection artifact cannot be read", { featureId: state.featureId, path: artifact.path }); }
  if (digest(markdown!) !== artifact.sha256) projectionError("review projection digest does not match artifact pointer", { featureId: state.featureId });
  const ledger = await readReviewLedger(root, state);
  const model = reviewProjectionModel(state, ledger);
  const expected = renderReviewProjection(model);
  if (markdown !== expected) projectionError("review projection does not match the current review ledger", { featureId: state.featureId });
  return { artifact, model, markdown: expected };
}

export async function assertCurrentReviewProjection(root: string, state: FeatureState): Promise<void> {
  await readReviewProjection(root, state);
}
