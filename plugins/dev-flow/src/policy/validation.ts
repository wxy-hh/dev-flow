import { allowedRiskLabels } from "./contract.js";
import type { Classification, ClassificationInput, Level, Topology } from "./types.js";

export class PolicyError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly details: Record<string, unknown> = {},
  ) {
    super(`${code}: ${message}`);
  }
}

const levels: Level[] = ["XS", "S", "M", "L"];
const topologies: Topology[] = ["local", "shared-contract", "multi-chain", "coordinated-rollback"];

export function normalizeClassification(input: ClassificationInput): Classification {
  if (!input.level || !levels.includes(input.level)) throw new PolicyError("INVALID_LEVEL", "level is invalid");
  if (!input.topology || !topologies.includes(input.topology)) throw new PolicyError("INVALID_TOPOLOGY", "topology is invalid");
  if (input.requirements && !["missing-or-unclear", "documented-unconfirmed", "provided-confirmed"].includes(input.requirements)) {
    throw new PolicyError("INVALID_REQUIREMENTS_STATE", "requirements state is invalid");
  }
  const riskLabels = [...new Set(input.riskLabels ?? [])];
  if (riskLabels.some((label) => !allowedRiskLabels.includes(label))) {
    throw new PolicyError("INVALID_RISK_LABEL", "risk label is invalid", {
      allowed: allowedRiskLabels,
      recoveryHint: "Choose only contract-defined risk labels; do not invent domain labels",
    });
  }
  if (input.manualAcceptanceRequired !== undefined && typeof input.manualAcceptanceRequired !== "boolean") {
    throw new PolicyError("INVALID_MANUAL_ACCEPTANCE_REQUIREMENT", "manualAcceptanceRequired must be boolean");
  }
  if (input.acceptanceAssistSuggested !== undefined && typeof input.acceptanceAssistSuggested !== "boolean") {
    throw new PolicyError("INVALID_ACCEPTANCE_ASSIST_SUGGESTION", "acceptanceAssistSuggested must be boolean");
  }
  return {
    level: input.level,
    topology: input.topology,
    ...(input.requirements ? { requirements: input.requirements } : {}),
    riskLabels,
    // The former hard requirement remains a compatibility input only. Browser/user
    // acceptance is advisory and never changes a route's ability to finalize.
    acceptanceAssistSuggested: input.acceptanceAssistSuggested === true || input.manualAcceptanceRequired === true,
    ...(input.classificationBasis ? { classificationBasis: input.classificationBasis } : {}),
    controls: {
      requirements: false,
      plan: "locate",
      trace: false,
      planReview: false,
      reviewRoles: [],
      executionApproval: false,
      checkpoints: "baseline",
      recovery: ["delivery-reverse"],
      codeReview: "none",
      verification: ["targeted"],
      reasons: {},
    },
    orderedRoute: [],
    routeConfirmationRequired: false,
  };
}
