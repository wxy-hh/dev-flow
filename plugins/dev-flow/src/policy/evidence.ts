import { checkpointsEnforcementRequired, routeDefinitionForFeature } from "./contract.js";
import { deriveRiskRequirements } from "./route.js";
import type { GovernanceControls, RequiredEvidence, RiskLabel, RouteId, VerificationKind } from "./types.js";

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
  controls?: GovernanceControls,
): RequiredEvidence {
  const required = emptyEvidence();
  // Risk evidence must follow the compiled route. A dynamically strengthened
  // XS/S route can contain planning or an independent code-review stage even
  // though the base route does not.
  const orderedSteps = routeDefinitionForFeature(route, controls).orderedSteps;
  const risk = deriveRiskRequirements(riskLabels);

  if (step === "planning") {
    const effectiveRoute = routeDefinitionForFeature(route, controls);
    if (effectiveRoute.generatedArtifacts?.includes("plan-review")) required.fields.reviewBatch = true;
    else required.fields.reviewType = "plan";
    if (route === "l") addChecks(required.checks, ["rollback-strategy"]);
  }
  if (step === "code_review") required.fields.reviewBatch = true;
  if (step === "implementation" && controls && checkpointsEnforcementRequired(route, controls)) {
    required.fields.files = "governed-root-paths";
  }


  // Risk overlays use one explicit evidence check at the first review-capable
  // point. This is a contract obligation, not another user-visible route.
  const riskReviewTarget = orderedSteps.includes("code_review")
    ? "code_review"
    : orderedSteps.includes("planning")
      ? "planning"
      : orderedSteps.includes("verification") ? "verification" : undefined;
  if (riskReviewTarget === step && riskLabels.length) addChecks(required.checks, ["risk-review"]);

  if (risk.checks.some((check) => check.includes("security"))) {
    const target = orderedSteps.includes("code_review")
      ? "code_review"
      : orderedSteps.includes("planning")
        ? "planning"
        : orderedSteps.includes("verification") ? "verification" : undefined;
    if (step === target) addChecks(required.checks, risk.checks.filter((check) => check.includes("security")));
  }

  const rollbackChecks = risk.checks.filter((check) => check === "rollback" || check === "full-rollback" || check === "backup-preview-abort-compensation");
  if (rollbackChecks.length) {
    const target = orderedSteps.includes("planning") ? "planning" : "verification";
    if (step === target) addChecks(required.checks, rollbackChecks);
  }

  if (step === "verification") {
    required.verificationKinds = controls
      ? [...controls.verification]
      : riskLabels.length ? [...risk.verification] : ["targeted"];
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
  // A caller cannot supply batch/basis/assurance strings to satisfy this.
  // Task 4 replaces this placeholder with Core-owned batch validation.
  if (required.fields.reviewBatch !== undefined) missing.fields.reviewBatch = true;
  if (required.fields.files !== undefined
    && (!Array.isArray(supplied.files) || supplied.files.some((file) => typeof file !== "string" || !file.trim()))) {
    missing.fields.files = required.fields.files;
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
