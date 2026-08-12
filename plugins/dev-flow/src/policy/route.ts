import { allowedRiskLabels, contract } from "./contract.js";
import { decisionBasisHash, deriveObligations } from "./obligations.js";
import type {
  BehaviorChange,
  Classification,
  ClassificationBasis,
  ClassificationFacts,
  ClassificationInput,
  ClassificationIssue,
  ClassificationPreview,
  ClassificationReason,
  ClassificationSignals,
  CodeReviewControl,
  DerivedRiskRequirements,
  GovernanceControls,
  GovernanceControlEnhancements,
  Level,
  ReviewRole,
  RiskLabel,
  RouteId,
  Topology,
  VerificationKind,
} from "./types.js";
import { normalizeClassification, PolicyError } from "./validation.js";

const levelRank: Record<Level, number> = { XS: 0, S: 1, M: 2, L: 3 };
const levelRoute: Record<Level, RouteId> = { XS: "xs", S: "s", M: "m", L: "l" };
const requiredBoundaryKinds = ["assumption", "free-space", "tbd", "fallback", "scope", "acceptance"] as const;

function maxLevel(...levels: Level[]): Level {
  return levels.reduce((left, right) => levelRank[left] >= levelRank[right] ? left : right);
}

export function minimumLevelForTopology(topology: Topology): Level {
  return contract.topologyMinimumLevel[topology] as Level;
}

export function assertTopologyLevel(classification: Pick<Classification, "level" | "topology">): void {
  const minimum = minimumLevelForTopology(classification.topology);
  if (levelRank[classification.level] < levelRank[minimum]) {
    throw new PolicyError("TOPOLOGY_LEVEL_MISMATCH", "level is below topology minimum", {
      suggestedLevel: minimum,
      topology: classification.topology,
    });
  }
}

function levelForSurface(value: ClassificationSignals["changeSurface"]): Level {
  return value === "single-site" ? "XS" : value === "single-component" ? "S" : value === "multi-component" ? "M" : "L";
}

function levelForBehavior(value: BehaviorChange): Level {
  return value === "mechanical" ? "XS" : value === "bounded-rule" ? "S" : value === "new-capability" ? "M" : "L";
}

function riskLabelsOf(basis: ClassificationBasis): RiskLabel[] {
  return Object.keys(basis.riskFactRefs).filter((label) => allowedRiskLabels.includes(label as RiskLabel)).sort() as RiskLabel[];
}

function highConsequence(labels: RiskLabel[]): boolean {
  return labels.some((label) => ["security", "money", "critical_correctness", "irreversible_consequence"].includes(label));
}

function reviewRoles(level: Level, signals: ClassificationSignals, labels: RiskLabel[], planReview: boolean): ReviewRole[] {
  if (!planReview) return [];
  const roles = new Set<ReviewRole>(["requirements-coverage", "architecture-testability"]);
  if (level === "L" || signals.operationalRecovery || signals.executableRollback || signals.unitCount > 1) roles.add("rollback-operability");
  if (labels.includes("security")) roles.add("security");
  if (labels.includes("data") || labels.includes("irreversible_consequence")) roles.add("data-irreversibility");
  if (labels.includes("money")) roles.add("money-safety");
  if (labels.includes("external")) roles.add("contract-failure");
  if (labels.includes("availability")) roles.add("recovery-observability");
  if (labels.includes("critical_correctness")) roles.add("critical-correctness");
  return [...roles].sort();
}

export function deriveGovernanceControls(
  level: Level,
  signals: ClassificationSignals,
  labels: RiskLabel[],
): GovernanceControls {
  const shared = signals.topology === "shared-contract";
  const multi = signals.unitCount > 1 || signals.topology === "multi-chain" || signals.topology === "coordinated-rollback";
  const riskReview = labels.length > 0;
  const persistentRequirements = level === "L" || signals.behaviorChange === "new-capability" || signals.behaviorChange === "systemic-change" || shared;
  const planReview = level === "L" || (level === "M" && (shared || multi || signals.operationalRecovery || riskReview));
  const checkpoints = level === "L" || multi || signals.executableRollback || labels.includes("irreversible_consequence") ? "unit-chain" : "baseline";
  const plan = level === "XS" && !planReview && checkpoints === "baseline" && !signals.operationalRecovery ? "locate"
    : level === "S" && !planReview && checkpoints === "baseline" && !signals.operationalRecovery ? "brief" : "formal";
  const trace = level === "L" || (level === "M" && (shared || multi || signals.operationalRecovery || planReview));
  // Trace nodes need a frozen REQ/AC source. When topology/recovery turns Trace
  // on for an otherwise bounded change, promote requirements evidence too.
  const requirements = persistentRequirements || trace;
  const executionApproval = level === "L"
    || (level === "M" && (shared || planReview || multi || signals.operationalRecovery || highConsequence(labels)))
    || ((level === "XS" || level === "S") && highConsequence(labels));
  const recovery: GovernanceControls["recovery"] = ["delivery-reverse"];
  if (level === "L" || multi || signals.operationalRecovery || labels.some((label) => ["data", "money", "availability"].includes(label))) recovery.push("operational-strategy");
  if (signals.executableRollback && checkpoints === "unit-chain" && !labels.includes("irreversible_consequence")) recovery.push("executable-rollback");
  if (labels.includes("irreversible_consequence")) recovery.push("irreversible-compensation");
  let codeReview: CodeReviewControl = level === "XS" ? "none" : level === "S" ? "focused" : "independent";
  if (labels.some((label) => ["security", "money", "critical_correctness", "irreversible_consequence"].includes(label))) codeReview = "full";
  const verification = new Set<VerificationKind>(["targeted"]);
  if (signals.behaviorChange === "new-capability" || labels.includes("security")) verification.add("behavior");
  if (signals.changeSurface === "multi-component" || shared || labels.some((label) => ["data", "money", "external", "availability"].includes(label))) verification.add("integration");
  if ((level === "L" && signals.behaviorChange === "systemic-change") || labels.includes("critical_correctness") || labels.includes("irreversible_consequence")) verification.add("full");
  const roles = reviewRoles(level, signals, labels, planReview);
  return {
    requirements,
    plan,
    trace,
    planReview,
    reviewRoles: roles,
    executionApproval,
    checkpoints,
    recovery,
    codeReview,
    verification: [...verification],
    reasons: {
      requirements: requirements ? "L、新能力、系统性行为或共享契约要求持久需求证据" : "当前事实不要求单独需求工件",
      plan: `变更级别与控制要求使用 ${plan} 计划`,
      trace: trace ? "共享契约、多单元、恢复或计划审查要求 Trace" : "当前路线不要求正式 Trace",
      planReview: planReview ? "级别、拓扑、恢复或风险要求计划审查" : "当前事实不要求独立计划审查",
      executionApproval: executionApproval ? "执行语义具有需要确认的影响" : "当前事实不要求执行审批",
      checkpoints: checkpoints === "unit-chain" ? "多单元、L、回撤或不可逆风险要求单元链" : "自动 baseline 足够",
      recovery: recovery.join("、"),
      codeReview: `代码审查深度为 ${codeReview}`,
      verification: `最终验证保证：${[...verification].join("、")}`,
    },
  };
}

function applyControlEnhancements(
  base: GovernanceControls,
  requested: GovernanceControlEnhancements | undefined,
  signals: ClassificationSignals,
  labels: RiskLabel[],
): GovernanceControls {
  if (!requested) return base;
  const planRank = { locate: 0, brief: 1, formal: 2 } as const;
  const reviewRank = { none: 0, focused: 1, independent: 2, full: 3 } as const;
  const requestedRecovery = new Set(requested.recovery ?? []);
  if (requestedRecovery.has("executable-rollback") && (!signals.executableRollback || labels.includes("irreversible_consequence"))) {
    throw new PolicyError("CONTROL_ENHANCEMENT_UNSUPPORTED", "executable rollback requires reversible repository facts", {
      path: "$.classificationBasis.controlEnhancements.recovery",
      recoveryHint: "修正 executableRollback 事实，或改用 operational-strategy/irreversible-compensation",
    });
  }
  const reviewRoles = new Set([...base.reviewRoles, ...(requested.reviewRoles ?? [])]);
  const planReview = base.planReview || requested.planReview === true || reviewRoles.size > base.reviewRoles.length;
  const checkpoints = base.checkpoints === "unit-chain" || requested.checkpoints === "unit-chain" || requestedRecovery.has("executable-rollback")
    ? "unit-chain" : "baseline";
  const trace = base.trace || requested.trace === true || planReview || checkpoints === "unit-chain";
  const requestedPlan = requested.plan ?? "locate";
  const forcedFormal = planReview || checkpoints === "unit-chain" || requestedRecovery.has("operational-strategy");
  const plan = forcedFormal
    ? "formal"
    : planRank[requestedPlan] > planRank[base.plan] ? requestedPlan : base.plan;
  const requestedReview = requested.codeReview ?? "none";
  const codeReview = reviewRank[requestedReview] > reviewRank[base.codeReview] ? requestedReview : base.codeReview;
  const recovery = [...new Set([...base.recovery, ...requestedRecovery])] as GovernanceControls["recovery"];
  const verification = [...new Set([...base.verification, ...(requested.verification ?? [])])];
  const enhanced: GovernanceControls = {
    ...base,
    requirements: base.requirements || requested.requirements === true || trace,
    plan,
    trace,
    planReview,
    reviewRoles: [...reviewRoles].sort(),
    executionApproval: base.executionApproval || requested.executionApproval === true,
    checkpoints,
    recovery,
    codeReview,
    verification,
    reasons: { ...base.reasons },
  };
  for (const [field, value] of Object.entries(requested)) {
    if (value !== undefined && (!Array.isArray(value) || value.length > 0)) {
      enhanced.reasons[field] = `${enhanced.reasons[field] ? `${enhanced.reasons[field]}；` : ""}用户明确要求增强该控制`;
    }
  }
  return enhanced;
}

export function compileOrderedRoute(level: Level, controls: GovernanceControls): string[] {
  const route: string[] = [];
  if (controls.requirements) route.push("requirements_alignment");
  route.push(controls.plan === "locate" ? "locate" : controls.plan === "brief" ? "boundary" : "planning");
  if (controls.planReview) route.push("plan_review");
  if (controls.executionApproval) route.push("execution_approval");
  route.push("implementation");
  if (controls.codeReview !== "none") route.push("code_review");
  route.push("verification", "finalize");
  void level;
  return route;
}

function actualType(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  return typeof value;
}

export function validateBasis(basis: ClassificationBasis, riskLabels: RiskLabel[]): void {
  if (["scopeFacts", "topologyFacts", "uncertaintyFacts", "riskFacts"].some((key) => Object.hasOwn(basis as object, key))) {
    throw new PolicyError("CLASSIFICATION_BASIS_INVALID", "v5 classification accepts fact record references, not caller-authored fact prose", { path: "$.classificationBasis" });
  }
  for (const key of ["scopeFactRefs", "topologyFactRefs", "uncertaintyFactRefs", "decisionRefs"] as const) {
    if (!Array.isArray(basis[key]) || basis[key].some((item) => typeof item !== "string" || item.trim().length === 0)) {
      throw new PolicyError("CLASSIFICATION_BASIS_INVALID", `${key} must be a list of non-empty record references`, { path: `$.classificationBasis.${key}`, actualType: actualType(basis[key]) });
    }
  }
  if (!basis.riskFactRefs || typeof basis.riskFactRefs !== "object" || Array.isArray(basis.riskFactRefs)) {
    throw new PolicyError("CLASSIFICATION_BASIS_INVALID", "riskFactRefs must be an object keyed by risk label", { path: "$.classificationBasis.riskFactRefs" });
  }
  for (const [label, refs] of Object.entries(basis.riskFactRefs)) {
    if (!allowedRiskLabels.includes(label as RiskLabel) || !Array.isArray(refs) || refs.length === 0 || refs.some((ref) => typeof ref !== "string" || !ref.trim())) {
      throw new PolicyError("CLASSIFICATION_BASIS_INVALID", `riskFactRefs.${label} must be a non-empty known reference list`, { path: `$.classificationBasis.riskFactRefs.${label}`, actualType: actualType(refs) });
    }
  }
  for (const label of riskLabels) if (!basis.riskFactRefs[label]?.length) {
    throw new PolicyError("RISK_BASIS_REQUIRED", `risk label ${label} has no factual basis`, { path: `$.classificationBasis.riskFactRefs.${label}` });
  }
  if (basis.controlEnhancements !== undefined) {
    const controls = basis.controlEnhancements as Record<string, unknown>;
    const allowed = new Set(["requirements", "plan", "trace", "planReview", "reviewRoles", "executionApproval", "checkpoints", "recovery", "codeReview", "verification"]);
    if (!controls || typeof controls !== "object" || Array.isArray(controls) || Object.keys(controls).some((key) => !allowed.has(key))) {
      throw new PolicyError("CONTROL_ENHANCEMENT_INVALID", "controlEnhancements contains unsupported fields", { path: "$.classificationBasis.controlEnhancements" });
    }
    for (const key of ["requirements", "trace", "planReview", "executionApproval"] as const) {
      if (controls[key] !== undefined && controls[key] !== true) throw new PolicyError("CONTROL_ENHANCEMENT_INVALID", `${key} can only strengthen to true`, { path: `$.classificationBasis.controlEnhancements.${key}` });
    }
    if (controls.plan !== undefined && !["brief", "formal"].includes(String(controls.plan))) throw new PolicyError("CONTROL_ENHANCEMENT_INVALID", "plan enhancement is invalid", { path: "$.classificationBasis.controlEnhancements.plan" });
    if (controls.checkpoints !== undefined && controls.checkpoints !== "unit-chain") throw new PolicyError("CONTROL_ENHANCEMENT_INVALID", "checkpoint enhancement is invalid", { path: "$.classificationBasis.controlEnhancements.checkpoints" });
    if (controls.codeReview !== undefined && !["focused", "independent", "full"].includes(String(controls.codeReview))) throw new PolicyError("CONTROL_ENHANCEMENT_INVALID", "code review enhancement is invalid", { path: "$.classificationBasis.controlEnhancements.codeReview" });
    const arrays: Array<[string, unknown, string[]]> = [
      ["reviewRoles", controls.reviewRoles, ["requirements-coverage", "architecture-testability", "rollback-operability", "security", "data-irreversibility", "money-safety", "contract-failure", "recovery-observability", "critical-correctness"]],
      ["recovery", controls.recovery, ["operational-strategy", "executable-rollback", "irreversible-compensation"]],
      ["verification", controls.verification, ["targeted", "behavior", "integration", "full"]],
    ];
    for (const [key, value, values] of arrays) {
      if (value !== undefined && (!Array.isArray(value) || value.some((item) => typeof item !== "string" || !values.includes(item)))) {
        throw new PolicyError("CONTROL_ENHANCEMENT_INVALID", `${key} enhancement is invalid`, { path: `$.classificationBasis.controlEnhancements.${key}` });
      }
    }
  }
}

function issue(code: string, path: string, message: string, recoveryHint: string): ClassificationIssue {
  return { code, path, message, recoveryHint };
}

function validateSignals(signals: ClassificationSignals | undefined): ClassificationIssue[] {
  if (!signals || typeof signals !== "object" || Array.isArray(signals)) return [issue("CLASSIFICATION_SIGNALS_REQUIRED", "$.classificationBasis.signals", "signals is required", "调查仓库后提供完整结构化信号")];
  const issues: ClassificationIssue[] = [];
  if (!(["single-site", "single-component", "multi-component", "system-wide"] as unknown[]).includes(signals.changeSurface)) issues.push(issue("CLASSIFICATION_SIGNAL_INVALID", "$.classificationBasis.signals.changeSurface", "changeSurface is invalid", "提供合法变更表面"));
  if (!(["mechanical", "bounded-rule", "new-capability", "systemic-change"] as unknown[]).includes(signals.behaviorChange)) issues.push(issue("CLASSIFICATION_SIGNAL_INVALID", "$.classificationBasis.signals.behaviorChange", "behaviorChange is invalid", "提供合法行为复杂度"));
  if (!(["local", "shared-contract", "multi-chain", "coordinated-rollback"] as unknown[]).includes(signals.topology)) issues.push(issue("CLASSIFICATION_SIGNAL_INVALID", "$.classificationBasis.signals.topology", "topology is invalid", "提供合法拓扑"));
  if (!Number.isInteger(signals.unitCount) || signals.unitCount < 1) issues.push(issue("CLASSIFICATION_SIGNAL_INVALID", "$.classificationBasis.signals.unitCount", "unitCount must be an integer >= 1", "提供实现单元数量"));
  if (!["missing-or-unclear", "documented-unconfirmed", "provided-confirmed"].includes(signals.requirements)) issues.push(issue("CLASSIFICATION_SIGNAL_INVALID", "$.classificationBasis.signals.requirements", "requirements is invalid", "提供需求状态"));
  if (typeof signals.operationalRecovery !== "boolean" || typeof signals.executableRollback !== "boolean") issues.push(issue("CLASSIFICATION_SIGNAL_INVALID", "$.classificationBasis.signals", "recovery signals must be boolean", "明确 operationalRecovery 与 executableRollback"));
  if (signals.upwardLevel !== undefined && !["XS", "S", "M", "L"].includes(signals.upwardLevel)) issues.push(issue("CLASSIFICATION_SIGNAL_INVALID", "$.classificationBasis.signals.upwardLevel", "upwardLevel is invalid", "删除或提供合法向上加强级别"));
  return issues;
}

export function recommendClassification(basis: ClassificationBasis): ClassificationPreview {
  try { validateBasis(basis, []); }
  catch (error) {
    const policy = error as PolicyError;
    return { readyToLock: false, reasons: [], issues: [issue(policy.code ?? "CLASSIFICATION_BASIS_INVALID", String(policy.details?.path ?? "$.classificationBasis"), policy.message, "修正结构化事实后重试")] };
  }
  const issues = validateSignals(basis.signals);
  if (issues.length) return { readyToLock: false, reasons: [], issues };
  const signals = basis.signals!;
  const minimum = maxLevel(levelForSurface(signals.changeSurface), levelForBehavior(signals.behaviorChange), minimumLevelForTopology(signals.topology));
  const level = signals.upwardLevel && levelRank[signals.upwardLevel] > levelRank[minimum] ? signals.upwardLevel : minimum;
  const riskLabels = riskLabelsOf(basis);
  const controls = applyControlEnhancements(deriveGovernanceControls(level, signals, riskLabels), basis.controlEnhancements, signals, riskLabels);
  const orderedRoute = compileOrderedRoute(level, controls);
  const classification: Classification = {
    level,
    topology: signals.topology,
    requirements: signals.requirements,
    riskLabels,
    acceptanceAssistSuggested: false,
    classificationBasis: basis,
    controls,
    orderedRoute,
    routeConfirmationRequired: level === "M" || level === "L" || riskLabels.length > 0,
  };
  const reasons: ClassificationReason[] = [
    { field: "changeSurface", value: signals.changeSurface, basisPaths: ["$.classificationBasis.signals.changeSurface"], message: `变更表面下限 ${levelForSurface(signals.changeSurface)}` },
    { field: "behaviorChange", value: signals.behaviorChange, basisPaths: ["$.classificationBasis.signals.behaviorChange"], message: `行为复杂度下限 ${levelForBehavior(signals.behaviorChange)}` },
    { field: "topology", value: signals.topology, basisPaths: ["$.classificationBasis.signals.topology"], message: `拓扑下限 ${minimumLevelForTopology(signals.topology)}` },
    { field: "level", value: level, basisPaths: ["$.classificationBasis.signals"], message: `Core 最低级别与有依据的向上加强合并为 ${level}` },
    ...Object.entries(controls.reasons).map(([field, message]) => ({ field: `controls.${field}`, value: message, basisPaths: ["$.classificationBasis.signals", "$.classificationBasis.riskFactRefs"], message })),
  ];
  const route = levelRoute[level];
  return { readyToLock: true, classification, route, obligations: deriveObligations(route, basis, controls), reasons, issues: [] };
}

function defaultBasis(input: ClassificationInput): ClassificationBasis {
  return input.classificationBasis ?? {
    scopeFactRefs: [],
    topologyFactRefs: [],
    uncertaintyFactRefs: [],
    riskFactRefs: {},
    decisionRefs: [],
    ...(input.controlEnhancements ? { controlEnhancements: input.controlEnhancements } : {}),
  };
}

export function selectRoute(input: ClassificationInput): ReturnType<typeof selectBaseRoute> {
  const basis = defaultBasis(input);
  if (basis.signals) {
    const preview = recommendClassification(basis);
    if (!preview.readyToLock) throw new PolicyError(preview.issues[0]?.code ?? "CLASSIFICATION_INVALID", preview.issues[0]?.message ?? "classification invalid", { issues: preview.issues });
    if (input.level && levelRank[input.level] < levelRank[preview.classification.level]) throw new PolicyError("CLASSIFICATION_BELOW_CORE_MINIMUM", "requested level is below Core minimum", { minimum: preview.classification.level });
    return { classification: preview.classification, route: preview.route, classificationBasis: basis, obligations: preview.obligations, contradictions: [] };
  }
  if (!input.level || !input.topology) throw new PolicyError("CLASSIFICATION_FACTS_REQUIRED", "classificationBasis.signals is required");
  const fallbackSignals: ClassificationSignals = {
    changeSurface: input.level === "XS" ? "single-site" : input.level === "S" ? "single-component" : input.level === "M" ? "multi-component" : "system-wide",
    behaviorChange: input.level === "XS" ? "mechanical" : input.level === "S" ? "bounded-rule" : input.level === "M" ? "new-capability" : "systemic-change",
    topology: input.topology,
    unitCount: input.topology === "multi-chain" || input.topology === "coordinated-rollback" ? 2 : 1,
    requirements: input.requirements ?? "missing-or-unclear",
    operationalRecovery: input.topology !== "local",
    executableRollback: input.topology === "coordinated-rollback",
    upwardLevel: input.level,
  };
  return selectBaseRoute({ ...basis, signals: fallbackSignals, level: input.level, topology: input.topology, requirements: input.requirements, riskLabels: input.riskLabels });
}

export function selectBaseRoute(input: ClassificationFacts): {
  classification: Classification;
  route: RouteId;
  classificationBasis: ClassificationBasis;
  obligations: ReturnType<typeof deriveObligations>;
  contradictions: string[];
} {
  const normalized = normalizeClassification(input);
  const basis: ClassificationBasis = {
    scopeFactRefs: input.scopeFactRefs,
    topologyFactRefs: input.topologyFactRefs,
    uncertaintyFactRefs: input.uncertaintyFactRefs,
    riskFactRefs: input.riskFactRefs,
    decisionRefs: input.decisionRefs,
    ...(input.signals ? { signals: input.signals } : {}),
    ...(input.controlEnhancements ? { controlEnhancements: input.controlEnhancements } : {}),
  };
  validateBasis(basis, normalized.riskLabels);
  const preview = basis.signals ? recommendClassification(basis) : undefined;
  if (preview && !preview.readyToLock) throw new PolicyError(preview.issues[0]?.code ?? "CLASSIFICATION_INVALID", preview.issues[0]?.message ?? "classification invalid", { issues: preview.issues });
  if (preview?.readyToLock && levelRank[input.level] < levelRank[preview.classification.level]) throw new PolicyError("CLASSIFICATION_BELOW_CORE_MINIMUM", "requested level is below Core minimum", { minimum: preview.classification.level });
  if (preview?.readyToLock) return { classification: preview.classification, route: preview.route, classificationBasis: basis, obligations: preview.obligations, contradictions: [] };
  assertTopologyLevel(normalized);
  const signals: ClassificationSignals = {
    changeSurface: input.level === "XS" ? "single-site" : input.level === "S" ? "single-component" : input.level === "M" ? "multi-component" : "system-wide",
    behaviorChange: input.level === "XS" ? "mechanical" : input.level === "S" ? "bounded-rule" : input.level === "M" ? "new-capability" : "systemic-change",
    topology: input.topology,
    unitCount: input.topology === "multi-chain" || input.topology === "coordinated-rollback" ? 2 : 1,
    requirements: input.requirements ?? "missing-or-unclear",
    operationalRecovery: input.topology !== "local",
    executableRollback: input.topology === "coordinated-rollback",
  };
  const controls = applyControlEnhancements(deriveGovernanceControls(input.level, signals, normalized.riskLabels), basis.controlEnhancements, signals, normalized.riskLabels);
  const classification: Classification = { ...normalized, classificationBasis: basis, controls, orderedRoute: compileOrderedRoute(input.level, controls), routeConfirmationRequired: input.level === "M" || input.level === "L" || normalized.riskLabels.length > 0 };
  const route = levelRoute[input.level];
  return { classification, route, classificationBasis: basis, obligations: deriveObligations(route, basis, controls), contradictions: [] };
}

export interface BoundaryResolutionIndex {
  decisionRefs: string[];
  decisions: Array<{ recordId: string; currency?: "current" | "stale" | "unconfirmed"; supersededBy?: string }>;
  repositoryFacts: Array<{ recordId: string; currency?: "current" | "stale" | "unconfirmed" }>;
}

export function assertBoundaryAuditComplete(
  audit: unknown,
  decisionRefsOrIndex: string[] | BoundaryResolutionIndex,
  repositoryFacts: Array<{ recordId: string }> = [],
): void {
  const index: BoundaryResolutionIndex = Array.isArray(decisionRefsOrIndex)
    ? { decisionRefs: decisionRefsOrIndex, decisions: decisionRefsOrIndex.map((recordId) => ({ recordId, currency: "current" })), repositoryFacts: repositoryFacts.map((record) => ({ recordId: record.recordId, currency: "current" })) }
    : decisionRefsOrIndex;
  const value = audit as { scanned?: unknown; items?: unknown };
  if (!value || !Array.isArray(value.scanned) || requiredBoundaryKinds.some((kind) => !(value.scanned as unknown[]).includes(kind)) || !Array.isArray(value.items)) {
    throw new PolicyError("BOUNDARY_AUDIT_INCOMPLETE", "boundaryAudit must explicitly scan every boundary category", { required: requiredBoundaryKinds });
  }
  for (const item of value.items as Array<Record<string, unknown>>) {
    // ADR-0018：repository-fact 必须引用已登记的结构化事实（factRef）；
    // 自由文本不再满足完成条件（evidenceRef 字段已随 issue 23 删除）。
    const factRecord = typeof item.factRef === "string" ? index.repositoryFacts.find((record) => record.recordId === item.factRef) : undefined;
    const fact = item.disposition === "repository-fact"
      && typeof item.factRef === "string"
      && factRecord !== undefined
      && factRecord.currency === "current";
    const decisionRecord = typeof item.decisionRef === "string" ? index.decisions.find((record) => record.recordId === item.decisionRef) : undefined;
    const decision = item.disposition === "resolved-decision"
      && typeof item.decisionRef === "string"
      && index.decisionRefs.includes(item.decisionRef)
      && decisionRecord !== undefined
      && decisionRecord.currency === "current"
      && decisionRecord.supersededBy === undefined;
    if (!fact && !decision) {
      const code = decisionRecord?.supersededBy ? "BOUNDARY_DECISION_SUPERSEDED" : "BOUNDARY_AUDIT_UNRESOLVED";
      throw new PolicyError(code, "every boundary item needs a current repository fact or a current resolved decision", { itemId: item.id, ...(typeof item.decisionRef === "string" ? { decisionRef: item.decisionRef } : {}), ...(typeof item.factRef === "string" ? { factRef: item.factRef } : {}) });
    }
  }
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
