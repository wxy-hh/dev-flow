import { allowedRiskLabels, contract } from "./contract.js";
import { decisionBasisHash, deriveObligations } from "./obligations.js";
import type {
  Classification,
  ClassificationBasis,
  ClassificationFacts,
  ClassificationInput,
  ClassificationIssue,
  ClassificationPreview,
  ClassificationReason,
  ClassificationSignals,
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

function basisOnly(input: ClassificationFacts): ClassificationBasis {
  const nestedSignals = (input as unknown as { classificationBasis?: ClassificationBasis }).classificationBasis?.signals;
  return {
    scopeFacts: input.scopeFacts,
    topologyFacts: input.topologyFacts,
    uncertaintyFacts: input.uncertaintyFacts,
    riskFacts: input.riskFacts,
    decisionRefs: input.decisionRefs,
    ...((input.signals ?? nestedSignals) ? { signals: input.signals ?? nestedSignals } : {}),
  };
}

function actualType(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  return typeof value;
}

export function validateBasis(basis: ClassificationBasis, riskLabels: RiskLabel[]): void {
  for (const key of ["scopeFacts", "topologyFacts", "uncertaintyFacts", "decisionRefs"] as const) {
    if (!Array.isArray(basis[key]) || basis[key].some((item) => typeof item !== "string" || item.trim().length === 0)) {
      throw new PolicyError("CLASSIFICATION_BASIS_INVALID", `${key} must be a list of non-empty fact strings`, {
        path: `$.classificationBasis.${key}`,
        actualType: actualType(basis[key]),
        invalidValue: basis[key],
      });
    }
  }
  if (!basis.riskFacts || typeof basis.riskFacts !== "object" || Array.isArray(basis.riskFacts)) {
    throw new PolicyError("CLASSIFICATION_BASIS_INVALID", "riskFacts must be an object keyed by risk label", {
      path: "$.classificationBasis.riskFacts",
      actualType: actualType(basis.riskFacts),
      invalidValue: basis.riskFacts,
    });
  }
  for (const [label, facts] of Object.entries(basis.riskFacts)) {
    if (!allowedRiskLabels.includes(label as RiskLabel)) {
      throw new PolicyError("CLASSIFICATION_BASIS_INVALID", `riskFacts contains an unknown risk label: ${label}`, {
        path: `$.classificationBasis.riskFacts.${label}`,
        actualType: actualType(facts),
        invalidValue: label,
        allowed: allowedRiskLabels,
      });
    }
    if (!Array.isArray(facts) || facts.length === 0 || facts.some((fact) => typeof fact !== "string" || fact.trim().length === 0)) {
      throw new PolicyError("CLASSIFICATION_BASIS_INVALID", `riskFacts.${label} must be a non-empty fact list`, {
        path: `$.classificationBasis.riskFacts.${label}`,
        actualType: actualType(facts),
        invalidValue: facts,
      });
    }
  }
  for (const label of riskLabels) {
    const facts = basis.riskFacts[label];
    if (!Array.isArray(facts) || facts.length === 0 || facts.some((fact) => typeof fact !== "string" || fact.trim().length === 0)) {
      throw new PolicyError("RISK_BASIS_REQUIRED", `risk label ${label} has no factual basis`, {
        label,
        path: `$.classificationBasis.riskFacts.${label}`,
        actualType: actualType(facts),
        invalidValue: facts,
      });
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
  const basis = basisOnly(input);
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

const signalRequirements = new Set(["missing-or-unclear", "documented-unconfirmed", "provided-confirmed"]);
const formalControlValues = new Set(["trace", "independent-review", "multiple-rollback-units"]);

function issue(code: string, path: string, message: string, recoveryHint: string): ClassificationIssue {
  return { code, path, message, recoveryHint };
}

function signalPath(field: string): string {
  return `$.classificationBasis.signals.${field}`;
}

function maxLevel(left: Level, right: Level): Level {
  return levelRank[left] >= levelRank[right] ? left : right;
}

function levelForImpactScope(scope: ClassificationSignals["impactScope"]): Level {
  return scope === "single-location" ? "XS" : scope === "single-module" ? "S" : "M";
}

function recommendationReasons(signals: ClassificationSignals, topology: Topology, level: Level, riskLabels: RiskLabel[], basis: ClassificationBasis): ClassificationReason[] {
  const reasons: ClassificationReason[] = [
    {
      field: "impactScope",
      value: signals.impactScope,
      basisPaths: [signalPath("impactScope")],
      message: `影响范围决定基础级别 ${levelForImpactScope(signals.impactScope)}`,
    },
    {
      field: "topology",
      value: topology,
      basisPaths: [signalPath("coordinatedRollback"), signalPath("independentChains"), signalPath("sharedContract")],
      message: `结构化拓扑信号建议 ${topology}`,
    },
    {
      field: "level",
      value: level,
      basisPaths: [signalPath("impactScope"), signalPath("coordinatedRollback"), signalPath("independentChains"), signalPath("sharedContract")],
      message: `基础级别与拓扑最低级别合并为 ${level}`,
    },
  ];
  const execution = level === "M" || level === "L"
    ? signals.requirements !== "provided-confirmed" || signals.formalControls.length > 0 ? "standard" : "light"
    : undefined;
  if (execution) reasons.push({
    field: "execution",
    value: execution,
    basisPaths: [signalPath("requirements"), signalPath("formalControls")],
    message: `需求确认状态与形式化控制决定 ${execution} 执行模式`,
  });
  for (const label of riskLabels) reasons.push({
    field: "riskLabels",
    value: label,
    basisPaths: [`$.classificationBasis.riskFacts.${label}`],
    message: `风险事实增加 ${label} 义务，不提高级别`,
  });
  void basis;
  return reasons;
}

/**
 * Pure, structure-only classification recommendation. It never reads files,
 * interprets prose, or treats risk as a size signal.
 */
export function recommendClassification(basis: ClassificationBasis): ClassificationPreview {
  const issues: ClassificationIssue[] = [];
  try {
    validateBasis(basis, []);
  } catch (error) {
    if (error instanceof PolicyError) {
      issues.push(issue(error.code, String(error.details.path ?? "$.classificationBasis"), error.message, "修正 classificationBasis 的结构化字段后重新推荐"));
    } else {
      issues.push(issue("CLASSIFICATION_BASIS_INVALID", "$.classificationBasis", "classification basis is invalid", "提供完整的结构化 classificationBasis"));
    }
  }
  const signals = basis?.signals;
  if (!signals || typeof signals !== "object" || Array.isArray(signals)) {
    issues.push(issue("CLASSIFICATION_SIGNALS_REQUIRED", "$.classificationBasis.signals", "signals is required for recommendation mode", "调查仓库后提供完整 ClassificationSignals"));
    return { readyToLock: false, reasons: [], issues };
  }
  const signalRecord = signals as unknown as Record<string, unknown>;
  const impactScope = signalRecord.impactScope;
  if (impactScope !== "single-location" && impactScope !== "single-module" && impactScope !== "cross-module") {
    issues.push(issue("CLASSIFICATION_SIGNAL_INVALID", signalPath("impactScope"), "impactScope is invalid", "选择 single-location、single-module 或 cross-module"));
  }
  if (typeof signalRecord.sharedContract !== "boolean") {
    issues.push(issue("CLASSIFICATION_SIGNAL_INVALID", signalPath("sharedContract"), "sharedContract must be boolean", "提供布尔型 sharedContract"));
  }
  if (typeof signalRecord.independentChains !== "number" || !Number.isInteger(signalRecord.independentChains) || signalRecord.independentChains < 1) {
    issues.push(issue("CLASSIFICATION_SIGNAL_INVALID", signalPath("independentChains"), "independentChains must be an integer >= 1", "提供大于等于 1 的独立链数量"));
  }
  if (typeof signalRecord.coordinatedRollback !== "boolean") {
    issues.push(issue("CLASSIFICATION_SIGNAL_INVALID", signalPath("coordinatedRollback"), "coordinatedRollback must be boolean", "提供布尔型 coordinatedRollback"));
  }
  if (!signalRequirements.has(signalRecord.requirements as string)) {
    issues.push(issue("CLASSIFICATION_SIGNAL_INVALID", signalPath("requirements"), "requirements is invalid", "提供合法 RequirementsState"));
  }
  if (!Array.isArray(signalRecord.formalControls)
    || signalRecord.formalControls.some((control) => typeof control !== "string" || !formalControlValues.has(control as string))) {
    issues.push(issue("CLASSIFICATION_SIGNAL_INVALID", signalPath("formalControls"), "formalControls contains an invalid control", "仅使用 trace、independent-review、multiple-rollback-units"));
  }
  if (issues.length) return { readyToLock: false, reasons: [], issues };

  const validSignals = signals as ClassificationSignals;
  if (validSignals.impactScope === "single-location"
    && (validSignals.sharedContract || validSignals.independentChains > 1 || validSignals.coordinatedRollback)) {
    issues.push(issue("CLASSIFICATION_SIGNALS_CONTRADICTORY", signalPath("impactScope"), "single-location conflicts with cross-location topology signals", "修正影响范围或拓扑信号，使两者一致"));
  }
  if (validSignals.impactScope === "single-module" && (validSignals.independentChains > 1 || validSignals.coordinatedRollback)) {
    issues.push(issue("CLASSIFICATION_SIGNALS_CONTRADICTORY", signalPath("impactScope"), "single-module conflicts with multiple independent chains or coordinated rollback", "修正影响范围或拓扑信号，使两者一致"));
  }
  if (issues.length) return { readyToLock: false, reasons: [], issues };

  const topology: Topology = validSignals.coordinatedRollback
    ? "coordinated-rollback"
    : validSignals.independentChains >= 2
      ? "multi-chain"
      : validSignals.sharedContract ? "shared-contract" : "local";
  const level = maxLevel(levelForImpactScope(validSignals.impactScope), minimumLevelForTopology(topology));
  const riskLabels = Object.keys(basis.riskFacts).sort() as RiskLabel[];
  const execution = level === "M" || level === "L"
    ? validSignals.requirements !== "provided-confirmed" || validSignals.formalControls.length > 0 ? "standard" : "light"
    : undefined;
  const classification: Classification = {
    level,
    topology,
    ...(execution ? { execution } : {}),
    requirements: validSignals.requirements,
    riskLabels,
    acceptanceAssistSuggested: false,
    classificationBasis: basis,
  };
  const route: RouteId = level === "XS" ? "xs"
    : level === "S" ? "s"
      : level === "M" ? execution === "light" ? "light-m" : "standard-m"
        : execution === "light" ? "light-l" : "standard-l";
  return {
    readyToLock: true,
    classification,
    route,
    obligations: deriveObligations(route, basis),
    reasons: recommendationReasons(validSignals, topology, level, riskLabels, basis),
    issues: [],
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
  const checks = new Set<string>();
  const verification = new Set<DerivedRiskRequirements["verification"][number]>();
  for (const label of riskLabels) {
    const enhancement = contract.riskEnhancements[label];
    if (!enhancement) continue;
    checks.add("risk-review");
    for (const check of enhancement.checks) checks.add(check);
    verification.add(enhancement.verification);
  }
  return { checks: [...checks].sort(), verification: [...verification].sort() };
}

export { decisionBasisHash };
