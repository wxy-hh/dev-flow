import type {
  ReviewAssurance,
  ReviewDepth,
  ReviewJobCompletion,
  ReviewJobRequirement,
  ReviewRole,
  RiskLabel,
  RouteId,
} from "./types.js";

const reviewRoles = [
  "requirements-coverage",
  "architecture-testability",
  "rollback-operability",
  "security",
  "data-irreversibility",
] as const satisfies readonly ReviewRole[];

const reviewDepths = ["standard", "full"] as const satisfies readonly ReviewDepth[];

function protocolInvalid(message: string): never {
  throw new Error(`REVIEW_PROTOCOL_INVALID: ${message}`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function isReviewRole(value: unknown): value is ReviewRole {
  return typeof value === "string" && reviewRoles.includes(value as ReviewRole);
}

function isReviewDepth(value: unknown): value is ReviewDepth {
  return typeof value === "string" && reviewDepths.includes(value as ReviewDepth);
}

/**
 * Parse only persisted, Core-derived job requirements. Callers never choose
 * roles or depth; this parser protects future snapshot readers from drift.
 */
export function parseReviewJobRequirements(value: unknown): ReviewJobRequirement[] {
  if (!Array.isArray(value)) protocolInvalid("job requirements must be an array");
  const seen = new Set<ReviewRole>();
  return value.map((item, index) => {
    if (!isRecord(item)
      || Object.keys(item).some((key) => key !== "role" && key !== "reviewDepth")
      || !isReviewRole(item.role)
      || !isReviewDepth(item.reviewDepth)) {
      protocolInvalid(`job requirement ${index} has an invalid shape`);
    }
    if (seen.has(item.role)) protocolInvalid(`job requirement ${index} duplicates role ${item.role}`);
    seen.add(item.role);
    return { role: item.role, reviewDepth: item.reviewDepth };
  });
}

/** Validate the completion envelope without inventing a finding where none exists. */
export function parseReviewJobCompletion(value: unknown): ReviewJobCompletion {
  if (!isRecord(value)
    || Object.keys(value).some((key) => key !== "coverageSummary" && key !== "findings")
    || typeof value.coverageSummary !== "string"
    || !value.coverageSummary.trim()
    || !Array.isArray(value.findings)) {
    protocolInvalid("review job completion has an invalid shape");
  }
  return { coverageSummary: value.coverageSummary, findings: [...value.findings] };
}

/** Derive the complete 2a review assignment from immutable feature facts. */
export function deriveReviewJobRequirements(
  route: RouteId,
  riskLabels: RiskLabel[],
): ReviewJobRequirement[] {
  if (route !== "standard-m" && route !== "standard-l") return [];
  const roles: ReviewRole[] = ["requirements-coverage", "architecture-testability"];
  if (route === "standard-l") roles.push("rollback-operability");
  if (riskLabels.includes("security")) roles.push("security");
  if (riskLabels.some((label) => label === "data" || label === "money" || label === "irreversible_consequence")) {
    roles.push("data-irreversibility");
  }
  const reviewDepth: ReviewDepth = riskLabels.includes("critical_correctness") ? "full" : "standard";
  return reviewRoles
    .filter((role) => roles.includes(role))
    .map((role) => ({ role, reviewDepth }));
}

/** Executor/context strings are diagnostic only during Review 2a. */
export function assuranceForReview2a(_diagnostics?: unknown): ReviewAssurance {
  return "multi-perspective";
}
