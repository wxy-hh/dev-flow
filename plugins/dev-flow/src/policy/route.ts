import { contract } from "./contract.js";
import type { Classification, ClassificationInput, DerivedRiskRequirements, Level, RouteId, Topology } from "./types.js";
import { normalizeClassification, PolicyError } from "./validation.js";

const levelRank: Record<Level, number> = { XS: 0, S: 1, M: 2, L: 3 };

export function minimumLevelForTopology(topology: Topology): Level {
  return contract.topologyMinimumLevel[topology] as Level;
}

export function assertTopologyLevel(classification: Classification): void {
  const minimum = minimumLevelForTopology(classification.topology);
  if (levelRank[classification.level] < levelRank[minimum]) {
    throw new PolicyError("TOPOLOGY_LEVEL_MISMATCH", "level is below topology minimum", {
      suggestedLevel: minimum,
      topology: classification.topology,
    });
  }
}

export function selectRoute(input: ClassificationInput): { classification: Classification; route: RouteId } {
  const classification = normalizeClassification(input);
  assertTopologyLevel(classification);
  const { level, execution, requirements, riskLabels } = classification;

  if (level === "XS" || level === "S") {
    if (execution) throw new PolicyError("EXECUTION_NOT_ALLOWED", "XS/S do not accept execution");
    return { classification, route: riskLabels.length ? "risk-minimal" : level.toLowerCase() as RouteId };
  }

  if (!execution) throw new PolicyError("EXECUTION_REQUIRED", "M/L require execution");
  if (level === "M" && execution === "light") {
    return { classification, route: riskLabels.length ? "risk-minimal" : "light-m" };
  }
  if (level === "L" && execution === "light") {
    return { classification, route: "light-l" };
  }
  if (!requirements) throw new PolicyError("REQUIREMENTS_REQUIRED", "standard M/L require requirements state");
  return { classification, route: level === "M" ? "standard-m" : "standard-l" };
}

export function deriveRiskRequirements(riskLabels: Classification["riskLabels"]): DerivedRiskRequirements {
  const checks = new Set<string>();
  const verification = new Set<DerivedRiskRequirements["verification"][number]>();
  for (const label of riskLabels) {
    const enhancement = contract.riskEnhancements[label];
    enhancement.checks.forEach((check) => checks.add(check));
    verification.add(enhancement.verification);
  }
  return { checks: [...checks].sort(), verification: [...verification].sort() };
}
