import { routeDefinition } from "./contract.js";
import { deriveRiskRequirements } from "./route.js";
import type { RequiredEvidence, RiskLabel, RouteId, VerificationKind } from "./types.js";

const emptyEvidence = (): RequiredEvidence => ({
  fields: {},
  checks: [],
  verificationKinds: [],
});

function addChecks(target: string[], checks: string[]): void {
  for (const check of checks) if (!target.includes(check)) target.push(check);
}

export function requiredEvidenceForStep(
  route: RouteId,
  riskLabels: RiskLabel[],
  step: string,
): RequiredEvidence {
  const required = emptyEvidence();
  const orderedSteps = routeDefinition(route).orderedSteps;
  const risk = deriveRiskRequirements(riskLabels);

  if (step === "plan_review") required.fields.reviewType = "plan";
  if (step === "code_review") required.fields.reviewType = "code";

  if (step === "code_review" && risk.checks.includes("full-code-review")) {
    required.fields.reviewDepth = "full";
  }

  if (risk.checks.includes("security")) {
    const target = orderedSteps.includes("risk_controls") ? "risk_controls" : "code_review";
    if (step === target) addChecks(required.checks, ["security"]);
  }

  const rollbackChecks = risk.checks.filter((check) => check === "rollback" || check === "full-rollback");
  if (rollbackChecks.length) {
    const target = orderedSteps.includes("risk_controls")
      ? "risk_controls"
      : orderedSteps.includes("rollback_safety")
        ? "rollback_safety"
        : "rollback_unit";
    if (step === target) addChecks(required.checks, rollbackChecks);
  }

  if (step === "verification" || step === "feature_check") {
    required.verificationKinds = riskLabels.length
      ? [...risk.verification]
      : ["targeted"];
  }

  required.checks.sort();
  return required;
}

export function requiredEvidenceIsEmpty(required: RequiredEvidence): boolean {
  return Object.keys(required.fields).length === 0
    && required.checks.length === 0
    && required.verificationKinds.length === 0;
}

export function missingRequiredEvidence(
  required: RequiredEvidence,
  evidence: unknown,
): RequiredEvidence {
  const missing = emptyEvidence();
  const supplied = typeof evidence === "object" && evidence !== null && !Array.isArray(evidence)
    ? evidence as Record<string, unknown>
    : {};

  if (required.fields.reviewType !== undefined && supplied.reviewType !== required.fields.reviewType) {
    missing.fields.reviewType = required.fields.reviewType;
  }
  if (required.fields.reviewDepth !== undefined && supplied.reviewDepth !== required.fields.reviewDepth) {
    missing.fields.reviewDepth = required.fields.reviewDepth;
  }

  const suppliedChecks = Array.isArray(supplied.checks)
    ? supplied.checks.filter((value): value is string => typeof value === "string")
    : [];
  missing.checks = required.checks.filter((check) => !suppliedChecks.includes(check));

  const kinds = Array.isArray(supplied.kinds)
    ? supplied.kinds.filter((value): value is VerificationKind => typeof value === "string")
    : [];
  missing.verificationKinds = required.verificationKinds.filter((kind) => !kinds.includes(kind));
  return missing;
}
