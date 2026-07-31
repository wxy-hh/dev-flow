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

export function selectRoute(input: ClassificationInput): { classification: Classification; route: RouteId; warning?: string } {
  const classification = normalizeClassification(input);
  assertTopologyLevel(classification);
  const { level, execution, requirements, riskLabels } = classification;

  let route: RouteId;
  if (level === "XS" || level === "S") {
    if (execution) throw new PolicyError("EXECUTION_NOT_ALLOWED", "XS/S do not accept execution");
    route = riskLabels.length ? "risk-minimal" : (level.toLowerCase() as RouteId);
  } else {
    if (!execution) throw new PolicyError("EXECUTION_REQUIRED", "M/L require execution");
    if (level === "M" && execution === "light") {
      route = riskLabels.length ? "risk-minimal" : "light-m";
    } else if (level === "L" && execution === "light") {
      route = "light-l";
    } else {
      if (!requirements) throw new PolicyError("REQUIREMENTS_REQUIRED", "standard M/L require requirements state");
      route = level === "M" ? "standard-m" : "standard-l";
    }
  }

  // 无需求澄清环节的路线（非 standard M/L）收到不清晰需求时，提示分类可能失误；仅提示，不强制升级。
  const warning =
    requirements && requirements !== "provided-confirmed" && route !== "standard-m" && route !== "standard-l"
      ? `需求状态为 ${requirements}，但 ${route} 路线无需求澄清环节；建议升级 M + standard 或先向用户澄清后重新分类`
      : undefined;
  return { classification, route, ...(warning ? { warning } : {}) };
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
