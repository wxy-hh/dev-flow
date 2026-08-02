import { contract } from "./contract.js";
import { decisionBasisHash, deriveObligations } from "./obligations.js";
import type {
  Classification,
  ClassificationBasis,
  ClassificationFacts,
  ClassificationInput,
  DerivedRiskRequirements,
  Level,
  RiskLabel,
  RouteId,
  Topology,
} from "./types.js";
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

function defaultBasis(input: ClassificationInput): ClassificationBasis {
  const riskLabels = input.riskLabels ?? [];
  const facts = input.classificationBasis;
  return facts ?? {
    scopeFacts: input.scope ? [...input.scope.inScope, ...input.scope.outOfScope] : [],
    topologyFacts: [input.topology ?? ""].filter(Boolean),
    uncertaintyFacts: input.requirements === "provided-confirmed" ? [] : [input.requirements ?? "requirements-not-confirmed"],
    // Labels without explicit evidence are deliberately rejected below.
    riskFacts: {},
    decisionRefs: [],
  };
}

function validateBasis(basis: ClassificationBasis, riskLabels: RiskLabel[]): void {
  for (const key of ["scopeFacts", "topologyFacts", "uncertaintyFacts", "decisionRefs"] as const) {
    if (!Array.isArray(basis[key]) || basis[key].some((item) => typeof item !== "string" || item.trim().length === 0)) {
      throw new PolicyError("CLASSIFICATION_BASIS_INVALID", `${key} must be a list of non-empty fact strings`);
    }
  }
  if (!basis.riskFacts || typeof basis.riskFacts !== "object" || Array.isArray(basis.riskFacts)) {
    throw new PolicyError("CLASSIFICATION_BASIS_INVALID", "riskFacts must be an object keyed by risk label");
  }
  for (const label of riskLabels) {
    const facts = basis.riskFacts[label];
    if (!Array.isArray(facts) || facts.length === 0 || facts.some((fact) => typeof fact !== "string" || fact.trim().length === 0)) {
      throw new PolicyError("RISK_BASIS_REQUIRED", `risk label ${label} has no factual basis`, { label });
    }
  }
}

/** Pure v2 resolver. Risk facts can add obligations but can never change route. */
export function selectBaseRoute(input: ClassificationFacts): {
  classification: Classification;
  route: RouteId;
  classificationBasis: ClassificationBasis;
  obligations: ReturnType<typeof deriveObligations>;
  contradictions: string[];
} {
  const classification = normalizeClassification(input);
  const basis = input;
  validateBasis(basis, classification.riskLabels);
  assertTopologyLevel(classification);
  const contradictions: string[] = [];
  if (classification.level === "XS" || classification.level === "S") {
    if (classification.execution) contradictions.push("XS/S 不允许指定 execution");
  } else if (!classification.execution) {
    contradictions.push("M/L 必须指定 execution");
  }
  if (classification.level === "M" && classification.execution === "light") return {
    classification: { ...classification, classificationBasis: basis }, route: "light-m", classificationBasis: basis,
    obligations: deriveObligations("light-m", basis), contradictions,
  };
  if (classification.level === "L" && classification.execution === "light") return {
    classification: { ...classification, classificationBasis: basis }, route: "light-l", classificationBasis: basis,
    obligations: deriveObligations("light-l", basis), contradictions,
  };
  const route = classification.level === "XS" ? "xs"
    : classification.level === "S" ? "s"
      : classification.level === "M" ? "standard-m" : "standard-l";
  if ((route === "standard-m" || route === "standard-l") && !classification.requirements) {
    contradictions.push("standard M/L 需要 requirements 状态；可在 lock 前由决策台账补齐");
  }
  return {
    classification: { ...classification, classificationBasis: basis },
    route,
    classificationBasis: basis,
    obligations: deriveObligations(route, basis),
    contradictions,
  };
}

/** Compatibility-shaped entry point used by MCP; it now resolves only base routes. */
export function selectRoute(input: ClassificationInput): ReturnType<typeof selectBaseRoute> {
  if (input.level === undefined || input.topology === undefined) throw new PolicyError("CLASSIFICATION_FACTS_REQUIRED", "level and topology facts are required before route selection");
  const basis = defaultBasis(input);
  return selectBaseRoute({
    ...basis,
    level: input.level,
    topology: input.topology,
    ...(input.execution ? { execution: input.execution } : {}),
    ...(input.requirements ? { requirements: input.requirements } : {}),
    ...(input.riskLabels ? { riskLabels: input.riskLabels } : {}),
    ...(input.acceptanceAssistSuggested !== undefined ? { acceptanceAssistSuggested: input.acceptanceAssistSuggested } : {}),
  });
}

export function deriveRiskRequirements(riskLabels: RiskLabel[]): DerivedRiskRequirements {
  const basis: ClassificationBasis = {
    scopeFacts: ["derived from classification facts"],
    topologyFacts: ["derived from classification facts"],
    uncertaintyFacts: [],
    riskFacts: Object.fromEntries(riskLabels.map((label) => [label, ["derived from classification facts"]])) as Partial<Record<RiskLabel, string[]>>,
    decisionRefs: [],
  };
  const obligations = deriveObligations("xs", basis);
  const checks = new Set<string>();
  const verification = new Set<DerivedRiskRequirements["verification"][number]>();
  for (const obligation of obligations) {
    if (obligation.kind === "review" || obligation.kind === "rollback") checks.add(obligation.reason);
    for (const kind of obligation.verificationKinds ?? []) if (kind !== "targeted") verification.add(kind);
  }
  return { checks: [...checks].sort(), verification: [...verification].sort() };
}

export { decisionBasisHash };
