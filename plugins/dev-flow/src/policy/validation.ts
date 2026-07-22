import type { Classification, ClassificationInput, Level, RiskLabel, Topology } from "./types.js";

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
const risks: RiskLabel[] = [
  "security",
  "data",
  "money",
  "external",
  "availability",
  "critical_correctness",
  "irreversible_consequence",
];

export function normalizeClassification(input: ClassificationInput): Classification {
  if (!levels.includes(input.level)) throw new PolicyError("INVALID_LEVEL", "level is invalid");
  if (!topologies.includes(input.topology)) throw new PolicyError("INVALID_TOPOLOGY", "topology is invalid");
  if (input.execution && input.execution !== "light" && input.execution !== "standard") {
    throw new PolicyError("INVALID_EXECUTION", "execution is invalid");
  }
  if (input.requirements && !["missing-or-unclear", "documented-unconfirmed", "provided-confirmed"].includes(input.requirements)) {
    throw new PolicyError("INVALID_REQUIREMENTS_STATE", "requirements state is invalid");
  }
  const riskLabels = [...new Set(input.riskLabels ?? [])];
  if (riskLabels.some((label) => !risks.includes(label))) {
    throw new PolicyError("INVALID_RISK_LABEL", "risk label is invalid");
  }
  return { ...input, riskLabels };
}
