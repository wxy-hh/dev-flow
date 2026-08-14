/* dev-flow 5.1.0; built from source, deterministic build */

// plugins/dev-flow/src/mcp/server.ts
import readline from "node:readline";

// plugins/dev-flow/src/core/errors.ts
var chineseRecovery = (code) => {
  if (code.includes("REVISION") || code.includes("CONFLICT")) {
    return { kind: "refresh", instruction: "\u5237\u65B0\u5F53\u524D\u72B6\u6001\u540E\u91CD\u8BD5\u539F\u64CD\u4F5C\u3002", requiresUserDecision: false, retryOriginal: true };
  }
  if (code.includes("INTEGRITY") || code.includes("CORRUPT") || code.includes("UNREADABLE")) {
    return { kind: "repair", instruction: "\u8FD0\u884C doctor \u68C0\u67E5\u5F53\u524D\u72B6\u6001\uFF1B\u4E0D\u8981\u624B\u52A8\u4FEE\u6539\u63A7\u5236\u6587\u4EF6\u3002", requiresUserDecision: false, retryOriginal: false };
  }
  if (code.includes("REQUIRED") || code.includes("INCOMPLETE") || code.includes("STALE")) {
    return { kind: "retry", instruction: "\u6309\u5F53\u524D\u72B6\u6001\u63D0\u793A\u8865\u9F50\u7F3A\u5931\u8BC1\u636E\u540E\u91CD\u8BD5\u3002", requiresUserDecision: false, retryOriginal: true };
  }
  return { kind: "ask-user", instruction: "\u8BF7\u786E\u8BA4\u662F\u5426\u6309\u63A8\u8350\u6062\u590D\u52A8\u4F5C\u7EE7\u7EED\u3002", requiresUserDecision: true, retryOriginal: false };
};
var safeDetailKeys = /* @__PURE__ */ new Set([
  "path",
  "paths",
  "file",
  "files",
  "field",
  "allowed",
  "missing",
  "missingGuarantees",
  "command",
  "commandId",
  "currentRevision",
  "expectedRevision",
  "expectedStage",
  "schemaVersion",
  "decisionIds",
  "approvalIds",
  "incomplete",
  "conflicts",
  "issues",
  "recoveryHint",
  "itemId",
  "required"
]);
function safeFailureDetails(details) {
  return Object.fromEntries(Object.entries(details).filter(([key, value]) => {
    if (key === "currentSha256") return typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
    return safeDetailKeys.has(key) && !/(?:capability|token|secret|hash|sha|fingerprint)/iu.test(key) && (typeof value !== "string" || value.length <= 2e3);
  }));
}
var DevFlowError = class extends Error {
  constructor(code, message, details = {}) {
    super(`${code}: ${message}`);
    this.code = code;
    this.details = details;
    this.name = "DevFlowError";
    this.userMessage = typeof details.userMessage === "string" ? details.userMessage : "\u5F53\u524D\u52A8\u4F5C\u672A\u5B8C\u6210\u3002";
    this.cause = typeof details.cause === "string" ? details.cause : /[\u3400-\u9fff]/u.test(message) ? message : `\u672A\u6EE1\u8DB3\u9519\u8BEF\u7801 ${code} \u5BF9\u5E94\u7684\u6D41\u7A0B\u6761\u4EF6\u3002`;
    this.impact = typeof details.impact === "string" ? details.impact : "\u6D41\u7A0B\u4FDD\u6301\u5728\u5F53\u524D\u9636\u6BB5\uFF0C\u5DF2\u6709\u7528\u6237\u6587\u4EF6\u4E0D\u4F1A\u88AB\u81EA\u52A8\u6539\u5199\u3002";
    this.recovery = {
      ...chineseRecovery(code),
      ...typeof details.recoveryKind === "string" ? { kind: details.recoveryKind } : {},
      ...typeof details.recoveryInstruction === "string" ? { instruction: details.recoveryInstruction } : {},
      ...typeof details.requiresUserDecision === "boolean" ? { requiresUserDecision: details.requiresUserDecision } : {},
      ...typeof details.retryOriginal === "boolean" ? { retryOriginal: details.retryOriginal } : {}
    };
  }
  userMessage;
  cause;
  impact;
  recovery;
  toFailure() {
    const technical = safeFailureDetails(this.details);
    if (this.code.includes("REVISION_CONFLICT")) {
      technical.basisChanged = false;
      technical.safeToRefresh = true;
    }
    return {
      code: this.code,
      userMessage: this.userMessage,
      cause: this.cause,
      impact: this.impact,
      recovery: { ...this.recovery },
      ...Object.keys(technical).length ? { technical } : {}
    };
  }
};
function isPolicyError(error) {
  return error instanceof Error && error.name === "PolicyError" && typeof error.code === "string";
}
function failureFrom(error) {
  if (error instanceof DevFlowError) return error.toFailure();
  if (isPolicyError(error)) {
    return {
      code: error.code,
      userMessage: "\u5206\u7C7B\u53C2\u6570\u672A\u901A\u8FC7\u7B56\u7565\u6821\u9A8C\u3002",
      cause: error.message,
      impact: "\u6D41\u7A0B\u4FDD\u6301\u5728\u5F53\u524D\u9636\u6BB5\uFF0C\u672A\u9501\u5B9A\u4EFB\u4F55\u72B6\u6001\uFF1B\u4FEE\u6B63\u8F93\u5165\u540E\u53EF\u91CD\u8BD5\u3002",
      recovery: { kind: "retry", instruction: "\u4FEE\u6B63\u5206\u7C7B\u53C2\u6570\u6216\u8FB9\u754C\u5BA1\u8BA1\u9879\u540E\u91CD\u65B0\u63D0\u4EA4\u3002", requiresUserDecision: false, retryOriginal: true },
      technical: safeFailureDetails(error.details ?? {})
    };
  }
  return {
    code: "INTERNAL_ERROR",
    userMessage: "\u7CFB\u7EDF\u52A8\u4F5C\u672A\u5B8C\u6210\u3002",
    cause: "\u53D1\u751F\u672A\u5206\u7C7B\u7684\u5185\u90E8\u9519\u8BEF\uFF1B\u4E3A\u907F\u514D\u6CC4\u9732\u5185\u90E8\u4FE1\u606F\uFF0C\u8BE6\u7EC6\u539F\u56E0\u4EC5\u4FDD\u7559\u5728\u672C\u5730\u8BCA\u65AD\u4E2D\u3002",
    impact: "\u6D41\u7A0B\u4FDD\u6301\u5728\u5F53\u524D\u9636\u6BB5\uFF0C\u672A\u786E\u8BA4\u7684\u52A8\u4F5C\u4E0D\u4F1A\u88AB\u89C6\u4E3A\u6210\u529F\u3002",
    recovery: { kind: "repair", instruction: "\u8FD0\u884C doctor \u5BFC\u51FA\u8BCA\u65AD\u5E76\u505C\u6B62\u7EE7\u7EED\u5199\u5165\u3002", requiresUserDecision: false, retryOriginal: false },
    technical: {}
  };
}

// plugins/dev-flow/src/policy/obligations.ts
import { createHash } from "node:crypto";

// plugins/dev-flow/src/policy/stable-json.ts
function stableJson(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(",")}}`;
}

// plugins/dev-flow/src/policy/obligations.ts
function decisionBasisHash(decision) {
  return createHash("sha256").update(stableJson(decision)).digest("hex");
}
var riskRules = {
  security: { kinds: ["review", "verification", "approval"], verification: ["behavior"], roles: ["security"] },
  data: { kinds: ["review", "verification"], verification: ["behavior", "integration"], roles: ["data-irreversibility"] },
  money: { kinds: ["review", "verification", "approval"], verification: ["behavior", "integration"], roles: ["money-safety"] },
  external: { kinds: ["review", "verification"], verification: ["integration"], roles: ["contract-failure"] },
  availability: { kinds: ["review", "verification"], verification: ["integration"], roles: ["recovery-observability"] },
  critical_correctness: { kinds: ["review", "verification", "approval"], verification: ["full"], roles: ["critical-correctness"] },
  irreversible_consequence: { kinds: ["review", "verification", "rollback", "approval", "checkpoint"], verification: ["full"], roles: ["data-irreversibility"] }
};
function add(output, kind, source, reason, basis, roles = [], verificationKinds = []) {
  const basisHash2 = decisionBasisHash({ kind, source, reason, basis });
  const id = `${kind}:${basisHash2.slice(0, 16)}`;
  if (output.has(id)) return;
  output.set(id, { id, kind, source, basisHash: basisHash2, status: "pending", reason, ...roles.length ? { roles: [...new Set(roles)].sort() } : {}, ...verificationKinds.length ? { verificationKinds: [...new Set(verificationKinds)].sort() } : {} });
}
function deriveObligations(route, classificationBasis, controls) {
  const output = /* @__PURE__ */ new Map();
  const labels = Object.keys(classificationBasis.riskFactRefs);
  if (controls?.executionApproval) {
    add(output, "approval", "route", "\u8BE5\u8DEF\u7EBF\u9700\u8981\u4E00\u6B21\u5408\u5E76\u7684\u6267\u884C\u786E\u8BA4", { route }, ["execution"]);
  }
  if (controls?.planReview) {
    add(output, "review", "route", "\u52A8\u6001\u63A7\u5236\u8981\u6C42\u72EC\u7ACB\u8BA1\u5212\u5BA1\u67E5", { route, roles: controls.reviewRoles }, controls.reviewRoles);
  }
  if (controls?.recovery.some((kind) => kind !== "delivery-reverse")) {
    add(output, "rollback", "route", "\u52A8\u6001\u63A7\u5236\u8981\u6C42\u53EF\u64CD\u4F5C\u7684\u6062\u590D\u7B56\u7565", { route, recovery: controls.recovery }, ["rollback-operability"]);
  }
  if (controls?.checkpoints) {
    add(output, "checkpoint", "route", "\u5B9E\u73B0\u8FB9\u754C\u81EA\u52A8\u4FDD\u5B58\u53EF\u6062\u590D\u68C0\u67E5\u70B9", { route }, ["checkpoint"]);
  }
  for (const label of labels) {
    const rule = riskRules[label];
    if (!rule) continue;
    for (const kind of rule.kinds) {
      add(output, kind, "risk", `\u98CE\u9669\u4E8B\u5B9E\u8981\u6C42 ${kind} \u4E49\u52A1`, { label, factRefs: classificationBasis.riskFactRefs[label] }, rule.roles, rule.verification);
    }
  }
  const merged = /* @__PURE__ */ new Map();
  for (const obligation of output.values()) {
    const key = `${obligation.kind}:${obligation.source}:${obligation.basisHash}`;
    const prior = merged.get(key);
    if (!prior) merged.set(key, obligation);
    else merged.set(key, {
      ...prior,
      roles: [.../* @__PURE__ */ new Set([...prior.roles ?? [], ...obligation.roles ?? []])].sort(),
      verificationKinds: [.../* @__PURE__ */ new Set([...prior.verificationKinds ?? [], ...obligation.verificationKinds ?? []])].sort()
    });
  }
  const consolidated = /* @__PURE__ */ new Map();
  for (const obligation of merged.values()) {
    const prior = consolidated.get(obligation.kind);
    if (!prior) {
      consolidated.set(obligation.kind, obligation);
      continue;
    }
    const basisHash2 = decisionBasisHash({
      kind: obligation.kind,
      bases: [prior.basisHash, obligation.basisHash].sort()
    });
    consolidated.set(obligation.kind, {
      ...prior,
      id: `${obligation.kind}:${basisHash2.slice(0, 16)}`,
      basisHash: basisHash2,
      reason: `${prior.reason}\uFF1B${obligation.reason}`,
      roles: [.../* @__PURE__ */ new Set([...prior.roles ?? [], ...obligation.roles ?? []])].sort(),
      verificationKinds: [.../* @__PURE__ */ new Set([...prior.verificationKinds ?? [], ...obligation.verificationKinds ?? []])].sort()
    });
  }
  return [...consolidated.values()].sort((a, b) => a.id.localeCompare(b.id));
}
function satisfyObligations(obligations, kinds) {
  if (!obligations) return void 0;
  const completed = new Set(kinds);
  return obligations.map((obligation) => completed.has(obligation.kind) && obligation.status === "pending" ? { ...obligation, status: "satisfied" } : obligation);
}
function reopenObligations(obligations, kinds) {
  if (!obligations) return void 0;
  const selected = new Set(kinds);
  return obligations.map((obligation) => selected.has(obligation.kind) && obligation.status !== "pending" ? { ...obligation, status: "pending" } : obligation);
}

// plugins/dev-flow/policy/contract.json
var contract_default = {
  schemaVersion: 4,
  routes: {
    xs: {
      orderedSteps: ["locate", "implementation", "verification", "finalize"],
      stages: ["locate", "implementation", "verification", "finalize"],
      requiredArtifacts: []
    },
    s: {
      orderedSteps: ["boundary", "implementation", "verification", "finalize"],
      stages: ["boundary", "implementation", "verification", "finalize"],
      requiredArtifacts: []
    },
    m: {
      orderedSteps: ["planning", "implementation", "code_review", "verification", "finalize"],
      stages: ["planning", "implementation", "code_review", "verification", "finalize"],
      requiredArtifacts: []
    },
    l: {
      orderedSteps: ["requirements_alignment", "planning", "plan_review", "execution_approval", "implementation", "code_review", "verification", "finalize"],
      stages: ["requirements_alignment", "planning", "plan_review", "execution_approval", "implementation", "code_review", "verification", "finalize"],
      requiredArtifacts: ["requirements", "implementation-plan"],
      artifactSteps: { requirements_alignment: ["requirements"], planning: ["implementation-plan"] }
    }
  },
  riskEnhancements: {
    security: { checks: ["security-boundary"], verification: "behavior" },
    data: { checks: ["data-integrity", "rollback"], verification: "integration" },
    money: { checks: ["idempotency", "reconciliation", "rollback"], verification: "integration" },
    external: { checks: ["contract-failure"], verification: "integration" },
    availability: { checks: ["degradation-recovery"], verification: "integration" },
    critical_correctness: { checks: ["full-code-review"], verification: "full" },
    irreversible_consequence: { checks: ["backup-preview-abort-compensation", "full-code-review"], verification: "full" }
  },
  topologyMinimumLevel: {
    local: "XS",
    "shared-contract": "M",
    "multi-chain": "L",
    "coordinated-rollback": "L"
  },
  topologyStrictOrder: ["local", "shared-contract", "multi-chain", "coordinated-rollback"]
};

// plugins/dev-flow/src/policy/types.ts
var ZERO_WORKFLOW_CAPABILITIES = Object.freeze({
  trace: 0,
  review: 0,
  checkpoints: 0,
  rollbackExecution: 0
});
var SUPPORTED_WORKFLOW_CAPABILITIES = Object.freeze({
  trace: 1,
  review: 1,
  checkpoints: 1,
  rollbackExecution: 1
});

// plugins/dev-flow/src/policy/contract.ts
var contract = contract_default;
if (contract.schemaVersion !== 4) {
  throw new Error(`unsupported contract schema ${String(contract.schemaVersion)}`);
}
var allowedRiskLabels = Object.freeze(Object.keys(contract.riskEnhancements));
function routeDefinition(route) {
  return contract.routes[route];
}
function cloneArtifactSteps(steps) {
  if (!steps) return void 0;
  return Object.fromEntries(Object.entries(steps).map(([step, artifacts2]) => [step, [...artifacts2]]));
}
function cloneRouteDefinition(definition) {
  return {
    ...definition,
    orderedSteps: [...definition.orderedSteps],
    requiredArtifacts: [...definition.requiredArtifacts],
    ...definition.generatedArtifacts ? { generatedArtifacts: [...definition.generatedArtifacts] } : {},
    ...definition.artifactSteps ? { artifactSteps: cloneArtifactSteps(definition.artifactSteps) } : {},
    ...definition.generatedArtifactSteps ? { generatedArtifactSteps: cloneArtifactSteps(definition.generatedArtifactSteps) } : {},
    ...definition.artifactTransitions ? {
      artifactTransitions: definition.artifactTransitions.map((transition) => ({ ...transition, steps: [...transition.steps] }))
    } : {}
  };
}
function validateArtifactModes(definition) {
  const generated = definition.generatedArtifacts ?? [];
  const overlap = definition.requiredArtifacts.find((artifact) => generated.includes(artifact));
  if (overlap) throw new Error(`route contract artifact ${overlap} cannot be both editable and generated`);
}
function normalizeWorkflowCapabilities(value) {
  const candidate = value ?? ZERO_WORKFLOW_CAPABILITIES;
  if (candidate.trace !== 0 && candidate.trace !== 1 || candidate.review !== 0 && candidate.review !== 1 || candidate.checkpoints !== 0 && candidate.checkpoints !== 1 || candidate.rollbackExecution !== 0 && candidate.rollbackExecution !== 1) {
    throw new Error("workflow capabilities must use 0 or 1");
  }
  return Object.freeze({ ...candidate });
}
function routeDefinitionForFeature(route, controls) {
  const definition = cloneRouteDefinition(routeDefinition(route));
  if (controls) {
    definition.orderedSteps = [];
    if (controls.requirements) definition.orderedSteps.push("requirements_alignment");
    definition.orderedSteps.push(controls.plan === "locate" ? "locate" : controls.plan === "brief" ? "boundary" : "planning");
    definition.orderedSteps.push("implementation");
    if (controls.codeReview !== "none") definition.orderedSteps.push("code_review");
    definition.orderedSteps.push("verification", "finalize");
    definition.requiredArtifacts = [];
    definition.artifactSteps = {};
    if (controls.requirements) {
      definition.requiredArtifacts.push("requirements");
      definition.artifactSteps.requirements_alignment = ["requirements"];
    }
    if (controls.plan === "formal") {
      definition.requiredArtifacts.push("implementation-plan");
      definition.artifactSteps.planning = ["implementation-plan"];
    }
    if (controls.planReview) {
      definition.generatedArtifacts = ["plan-review"];
      definition.generatedArtifactSteps = { planning: ["plan-review"] };
    }
  }
  validateArtifactModes(definition);
  return definition;
}
function traceEnforcementRequired(route, controls) {
  return controls?.trace ?? false;
}
function reviewEnforcementRequired(route, controls) {
  return controls?.planReview ?? false;
}
function reviewLedgerRequired(route, controls) {
  return controls ? controls.planReview || controls.codeReview !== "none" : false;
}
function checkpointsEnforcementRequired(route, controls) {
  return controls ? controls.checkpoints === "unit-chain" && controls.trace : false;
}
function rollbackExecutionAllowed(route, controls) {
  return controls ? controls.recovery.includes("executable-rollback") && checkpointsEnforcementRequired(route, controls) : false;
}

// plugins/dev-flow/src/policy/validation.ts
var PolicyError = class extends Error {
  constructor(code, message, details = {}) {
    super(`${code}: ${message}`);
    this.code = code;
    this.details = details;
    this.name = "PolicyError";
  }
};
var levels = ["XS", "S", "M", "L"];
var topologies = ["local", "shared-contract", "multi-chain", "coordinated-rollback"];
function normalizeClassification(input) {
  if (!input.level || !levels.includes(input.level)) throw new PolicyError("INVALID_LEVEL", "level is invalid");
  if (!input.topology || !topologies.includes(input.topology)) throw new PolicyError("INVALID_TOPOLOGY", "topology is invalid");
  if (input.requirements && !["missing-or-unclear", "documented-unconfirmed", "provided-confirmed"].includes(input.requirements)) {
    throw new PolicyError("INVALID_REQUIREMENTS_STATE", "requirements state is invalid");
  }
  const riskLabels = [...new Set(input.riskLabels ?? [])];
  if (riskLabels.some((label) => !allowedRiskLabels.includes(label))) {
    throw new PolicyError("INVALID_RISK_LABEL", "risk label is invalid", {
      allowed: allowedRiskLabels,
      recoveryHint: "Choose only contract-defined risk labels; do not invent domain labels"
    });
  }
  if (input.acceptanceAssistSuggested !== void 0 && typeof input.acceptanceAssistSuggested !== "boolean") {
    throw new PolicyError("INVALID_ACCEPTANCE_ASSIST_SUGGESTION", "acceptanceAssistSuggested must be boolean");
  }
  return {
    level: input.level,
    topology: input.topology,
    ...input.requirements ? { requirements: input.requirements } : {},
    riskLabels,
    // Browser/user acceptance is advisory and never changes a route's ability to finalize.
    acceptanceAssistSuggested: input.acceptanceAssistSuggested === true,
    ...input.classificationBasis ? { classificationBasis: input.classificationBasis } : {},
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
      reasons: {}
    },
    orderedRoute: [],
    routeConfirmationRequired: false
  };
}

// plugins/dev-flow/src/policy/route.ts
var levelRank = { XS: 0, S: 1, M: 2, L: 3 };
var levelRoute = { XS: "xs", S: "s", M: "m", L: "l" };
var requiredBoundaryKinds = ["assumption", "free-space", "tbd", "fallback", "scope", "acceptance"];
function maxLevel(...levels2) {
  return levels2.reduce((left, right) => levelRank[left] >= levelRank[right] ? left : right);
}
function minimumLevelForTopology(topology) {
  return contract.topologyMinimumLevel[topology];
}
function assertTopologyLevel(classification2) {
  const minimum = minimumLevelForTopology(classification2.topology);
  if (levelRank[classification2.level] < levelRank[minimum]) {
    throw new PolicyError("TOPOLOGY_LEVEL_MISMATCH", "level is below topology minimum", {
      suggestedLevel: minimum,
      topology: classification2.topology
    });
  }
}
function levelForSurface(value) {
  return value === "single-site" ? "XS" : value === "single-component" ? "S" : value === "multi-component" ? "M" : "L";
}
function levelForBehavior(value) {
  return value === "mechanical" ? "XS" : value === "bounded-rule" ? "S" : value === "new-capability" ? "M" : "L";
}
function riskLabelsOf(basis) {
  return Object.keys(basis.riskFactRefs).filter((label) => allowedRiskLabels.includes(label)).sort();
}
function highConsequence(labels) {
  return labels.some((label) => ["security", "money", "critical_correctness", "irreversible_consequence"].includes(label));
}
function reviewRoles(level, signals, labels, planReview) {
  if (!planReview) return [];
  const roles = /* @__PURE__ */ new Set(["requirements-coverage", "architecture-testability"]);
  if (level === "L" || signals.operationalRecovery || signals.executableRollback || signals.unitCount > 1) roles.add("rollback-operability");
  if (labels.includes("security")) roles.add("security");
  if (labels.includes("data") || labels.includes("irreversible_consequence")) roles.add("data-irreversibility");
  if (labels.includes("money")) roles.add("money-safety");
  if (labels.includes("external")) roles.add("contract-failure");
  if (labels.includes("availability")) roles.add("recovery-observability");
  if (labels.includes("critical_correctness")) roles.add("critical-correctness");
  return [...roles].sort();
}
function deriveGovernanceControls(level, signals, labels) {
  const shared = signals.topology === "shared-contract";
  const multi = signals.unitCount > 1 || signals.topology === "multi-chain" || signals.topology === "coordinated-rollback";
  const riskReview = labels.length > 0;
  const persistentRequirements = level === "L" || signals.behaviorChange === "new-capability" || signals.behaviorChange === "systemic-change" || shared;
  const planReview = level === "L" || level === "M" && (shared || multi || signals.operationalRecovery || riskReview);
  const checkpoints = level === "L" || multi || signals.executableRollback || labels.includes("irreversible_consequence") ? "unit-chain" : "baseline";
  const plan = level === "XS" && !planReview && checkpoints === "baseline" && !signals.operationalRecovery ? "locate" : level === "S" && !planReview && checkpoints === "baseline" && !signals.operationalRecovery ? "brief" : "formal";
  const trace2 = level === "L" || level === "M" && (shared || multi || signals.operationalRecovery || planReview);
  const requirements = persistentRequirements || trace2;
  const executionApproval = level === "L" || level === "M" && (shared || planReview || multi || signals.operationalRecovery || highConsequence(labels)) || (level === "XS" || level === "S") && highConsequence(labels);
  const recovery = ["delivery-reverse"];
  if (level === "L" || multi || signals.operationalRecovery || labels.some((label) => ["data", "money", "availability"].includes(label))) recovery.push("operational-strategy");
  if (signals.executableRollback && checkpoints === "unit-chain" && !labels.includes("irreversible_consequence")) recovery.push("executable-rollback");
  if (labels.includes("irreversible_consequence")) recovery.push("irreversible-compensation");
  let codeReview = level === "XS" ? "none" : level === "S" ? "focused" : "independent";
  if (labels.some((label) => ["security", "money", "critical_correctness", "irreversible_consequence"].includes(label))) codeReview = "full";
  const verification2 = /* @__PURE__ */ new Set(["targeted"]);
  if (signals.behaviorChange === "new-capability" || labels.includes("security")) verification2.add("behavior");
  if (signals.changeSurface === "multi-component" || shared || labels.some((label) => ["data", "money", "external", "availability"].includes(label))) verification2.add("integration");
  if (level === "L" && signals.behaviorChange === "systemic-change" || labels.includes("critical_correctness") || labels.includes("irreversible_consequence")) verification2.add("full");
  const roles = reviewRoles(level, signals, labels, planReview);
  return {
    requirements,
    plan,
    trace: trace2,
    planReview,
    reviewRoles: roles,
    executionApproval,
    checkpoints,
    recovery,
    codeReview,
    verification: [...verification2],
    reasons: {
      requirements: requirements ? "L\u3001\u65B0\u80FD\u529B\u3001\u7CFB\u7EDF\u6027\u884C\u4E3A\u6216\u5171\u4EAB\u5951\u7EA6\u8981\u6C42\u6301\u4E45\u9700\u6C42\u8BC1\u636E" : "\u5F53\u524D\u4E8B\u5B9E\u4E0D\u8981\u6C42\u5355\u72EC\u9700\u6C42\u5DE5\u4EF6",
      plan: `\u53D8\u66F4\u7EA7\u522B\u4E0E\u63A7\u5236\u8981\u6C42\u4F7F\u7528 ${plan} \u8BA1\u5212`,
      trace: trace2 ? "\u5171\u4EAB\u5951\u7EA6\u3001\u591A\u5355\u5143\u3001\u6062\u590D\u6216\u8BA1\u5212\u5BA1\u67E5\u8981\u6C42 Trace" : "\u5F53\u524D\u8DEF\u7EBF\u4E0D\u8981\u6C42\u6B63\u5F0F Trace",
      planReview: planReview ? "\u7EA7\u522B\u3001\u62D3\u6251\u3001\u6062\u590D\u6216\u98CE\u9669\u8981\u6C42\u8BA1\u5212\u5BA1\u67E5" : "\u5F53\u524D\u4E8B\u5B9E\u4E0D\u8981\u6C42\u72EC\u7ACB\u8BA1\u5212\u5BA1\u67E5",
      executionApproval: executionApproval ? "\u6267\u884C\u8BED\u4E49\u5177\u6709\u9700\u8981\u786E\u8BA4\u7684\u5F71\u54CD" : "\u5F53\u524D\u4E8B\u5B9E\u4E0D\u8981\u6C42\u6267\u884C\u5BA1\u6279",
      checkpoints: checkpoints === "unit-chain" ? "\u591A\u5355\u5143\u3001L\u3001\u56DE\u64A4\u6216\u4E0D\u53EF\u9006\u98CE\u9669\u8981\u6C42\u5355\u5143\u94FE" : "\u81EA\u52A8 baseline \u8DB3\u591F",
      recovery: recovery.join("\u3001"),
      codeReview: `\u4EE3\u7801\u5BA1\u67E5\u6DF1\u5EA6\u4E3A ${codeReview}`,
      verification: `\u6700\u7EC8\u9A8C\u8BC1\u4FDD\u8BC1\uFF1A${[...verification2].join("\u3001")}`
    }
  };
}
function applyControlEnhancements(base, requested, signals, labels) {
  if (!requested) return base;
  const planRank = { locate: 0, brief: 1, formal: 2 };
  const reviewRank = { none: 0, focused: 1, independent: 2, full: 3 };
  const requestedRecovery = new Set(requested.recovery ?? []);
  if (requestedRecovery.has("executable-rollback") && (!signals.executableRollback || labels.includes("irreversible_consequence"))) {
    throw new PolicyError("CONTROL_ENHANCEMENT_UNSUPPORTED", "executable rollback requires reversible repository facts", {
      path: "$.classificationBasis.controlEnhancements.recovery",
      recoveryHint: "\u4FEE\u6B63 executableRollback \u4E8B\u5B9E\uFF0C\u6216\u6539\u7528 operational-strategy/irreversible-compensation"
    });
  }
  const reviewRoles3 = /* @__PURE__ */ new Set([...base.reviewRoles, ...requested.reviewRoles ?? []]);
  const planReview = base.planReview || requested.planReview === true || reviewRoles3.size > base.reviewRoles.length;
  const checkpoints = base.checkpoints === "unit-chain" || requested.checkpoints === "unit-chain" || requestedRecovery.has("executable-rollback") ? "unit-chain" : "baseline";
  const trace2 = base.trace || requested.trace === true || planReview || checkpoints === "unit-chain";
  const requestedPlan = requested.plan ?? "locate";
  const forcedFormal = planReview || checkpoints === "unit-chain" || requestedRecovery.has("operational-strategy");
  const plan = forcedFormal ? "formal" : planRank[requestedPlan] > planRank[base.plan] ? requestedPlan : base.plan;
  const requestedReview = requested.codeReview ?? "none";
  const codeReview = reviewRank[requestedReview] > reviewRank[base.codeReview] ? requestedReview : base.codeReview;
  const recovery = [.../* @__PURE__ */ new Set([...base.recovery, ...requestedRecovery])];
  const verification2 = [.../* @__PURE__ */ new Set([...base.verification, ...requested.verification ?? []])];
  const enhanced = {
    ...base,
    requirements: base.requirements || requested.requirements === true || trace2,
    plan,
    trace: trace2,
    planReview,
    reviewRoles: [...reviewRoles3].sort(),
    executionApproval: base.executionApproval || requested.executionApproval === true,
    checkpoints,
    recovery,
    codeReview,
    verification: verification2,
    reasons: { ...base.reasons }
  };
  for (const [field, value] of Object.entries(requested)) {
    if (value !== void 0 && (!Array.isArray(value) || value.length > 0)) {
      enhanced.reasons[field] = `${enhanced.reasons[field] ? `${enhanced.reasons[field]}\uFF1B` : ""}\u7528\u6237\u660E\u786E\u8981\u6C42\u589E\u5F3A\u8BE5\u63A7\u5236`;
    }
  }
  return enhanced;
}
function compileOrderedRoute(level, controls) {
  const route = [];
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
function actualType(value) {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  return typeof value;
}
function validateBasis(basis, riskLabels) {
  if (["scopeFacts", "topologyFacts", "uncertaintyFacts", "riskFacts"].some((key) => Object.hasOwn(basis, key))) {
    throw new PolicyError("CLASSIFICATION_BASIS_INVALID", "v5 classification accepts fact record references, not caller-authored fact prose", { path: "$.classificationBasis" });
  }
  for (const key of ["scopeFactRefs", "topologyFactRefs", "uncertaintyFactRefs", "decisionRefs"]) {
    if (!Array.isArray(basis[key]) || basis[key].some((item) => typeof item !== "string" || item.trim().length === 0)) {
      throw new PolicyError("CLASSIFICATION_BASIS_INVALID", `${key} must be a list of non-empty record references`, { path: `$.classificationBasis.${key}`, actualType: actualType(basis[key]) });
    }
  }
  if (!basis.riskFactRefs || typeof basis.riskFactRefs !== "object" || Array.isArray(basis.riskFactRefs)) {
    throw new PolicyError("CLASSIFICATION_BASIS_INVALID", "riskFactRefs must be an object keyed by risk label", { path: "$.classificationBasis.riskFactRefs" });
  }
  for (const [label, refs] of Object.entries(basis.riskFactRefs)) {
    if (!allowedRiskLabels.includes(label) || !Array.isArray(refs) || refs.length === 0 || refs.some((ref) => typeof ref !== "string" || !ref.trim())) {
      throw new PolicyError("CLASSIFICATION_BASIS_INVALID", `riskFactRefs.${label} must be a non-empty known reference list`, { path: `$.classificationBasis.riskFactRefs.${label}`, actualType: actualType(refs) });
    }
  }
  for (const label of riskLabels) if (!basis.riskFactRefs[label]?.length) {
    throw new PolicyError("RISK_BASIS_REQUIRED", `risk label ${label} has no factual basis`, { path: `$.classificationBasis.riskFactRefs.${label}` });
  }
  if (basis.controlEnhancements !== void 0) {
    const controls = basis.controlEnhancements;
    const allowed = /* @__PURE__ */ new Set(["requirements", "plan", "trace", "planReview", "reviewRoles", "executionApproval", "checkpoints", "recovery", "codeReview", "verification"]);
    if (!controls || typeof controls !== "object" || Array.isArray(controls) || Object.keys(controls).some((key) => !allowed.has(key))) {
      throw new PolicyError("CONTROL_ENHANCEMENT_INVALID", "controlEnhancements contains unsupported fields", { path: "$.classificationBasis.controlEnhancements" });
    }
    for (const key of ["requirements", "trace", "planReview", "executionApproval"]) {
      if (controls[key] !== void 0 && controls[key] !== true) throw new PolicyError("CONTROL_ENHANCEMENT_INVALID", `${key} can only strengthen to true`, { path: `$.classificationBasis.controlEnhancements.${key}` });
    }
    if (controls.plan !== void 0 && !["brief", "formal"].includes(String(controls.plan))) throw new PolicyError("CONTROL_ENHANCEMENT_INVALID", "plan enhancement is invalid", { path: "$.classificationBasis.controlEnhancements.plan" });
    if (controls.checkpoints !== void 0 && controls.checkpoints !== "unit-chain") throw new PolicyError("CONTROL_ENHANCEMENT_INVALID", "checkpoint enhancement is invalid", { path: "$.classificationBasis.controlEnhancements.checkpoints" });
    if (controls.codeReview !== void 0 && !["focused", "independent", "full"].includes(String(controls.codeReview))) throw new PolicyError("CONTROL_ENHANCEMENT_INVALID", "code review enhancement is invalid", { path: "$.classificationBasis.controlEnhancements.codeReview" });
    const arrays = [
      ["reviewRoles", controls.reviewRoles, ["requirements-coverage", "architecture-testability", "rollback-operability", "security", "data-irreversibility", "money-safety", "contract-failure", "recovery-observability", "critical-correctness"]],
      ["recovery", controls.recovery, ["operational-strategy", "executable-rollback", "irreversible-compensation"]],
      ["verification", controls.verification, ["targeted", "behavior", "integration", "full"]]
    ];
    for (const [key, value, values] of arrays) {
      if (value !== void 0 && (!Array.isArray(value) || value.some((item) => typeof item !== "string" || !values.includes(item)))) {
        throw new PolicyError("CONTROL_ENHANCEMENT_INVALID", `${key} enhancement is invalid`, { path: `$.classificationBasis.controlEnhancements.${key}` });
      }
    }
  }
}
function issue(code, path25, message, recoveryHint) {
  return { code, path: path25, message, recoveryHint };
}
function validateSignals(signals) {
  if (!signals || typeof signals !== "object" || Array.isArray(signals)) return [issue("CLASSIFICATION_SIGNALS_REQUIRED", "$.classificationBasis.signals", "signals is required", "\u8C03\u67E5\u4ED3\u5E93\u540E\u63D0\u4F9B\u5B8C\u6574\u7ED3\u6784\u5316\u4FE1\u53F7")];
  const issues = [];
  if (!["single-site", "single-component", "multi-component", "system-wide"].includes(signals.changeSurface)) issues.push(issue("CLASSIFICATION_SIGNAL_INVALID", "$.classificationBasis.signals.changeSurface", "changeSurface is invalid", "\u63D0\u4F9B\u5408\u6CD5\u53D8\u66F4\u8868\u9762"));
  if (!["mechanical", "bounded-rule", "new-capability", "systemic-change"].includes(signals.behaviorChange)) issues.push(issue("CLASSIFICATION_SIGNAL_INVALID", "$.classificationBasis.signals.behaviorChange", "behaviorChange is invalid", "\u63D0\u4F9B\u5408\u6CD5\u884C\u4E3A\u590D\u6742\u5EA6"));
  if (!["local", "shared-contract", "multi-chain", "coordinated-rollback"].includes(signals.topology)) issues.push(issue("CLASSIFICATION_SIGNAL_INVALID", "$.classificationBasis.signals.topology", "topology is invalid", "\u63D0\u4F9B\u5408\u6CD5\u62D3\u6251"));
  if (!Number.isInteger(signals.unitCount) || signals.unitCount < 1) issues.push(issue("CLASSIFICATION_SIGNAL_INVALID", "$.classificationBasis.signals.unitCount", "unitCount must be an integer >= 1", "\u63D0\u4F9B\u5B9E\u73B0\u5355\u5143\u6570\u91CF"));
  if (!["missing-or-unclear", "documented-unconfirmed", "provided-confirmed"].includes(signals.requirements)) issues.push(issue("CLASSIFICATION_SIGNAL_INVALID", "$.classificationBasis.signals.requirements", "requirements is invalid", "\u63D0\u4F9B\u9700\u6C42\u72B6\u6001"));
  if (typeof signals.operationalRecovery !== "boolean" || typeof signals.executableRollback !== "boolean") issues.push(issue("CLASSIFICATION_SIGNAL_INVALID", "$.classificationBasis.signals", "recovery signals must be boolean", "\u660E\u786E operationalRecovery \u4E0E executableRollback"));
  if (signals.upwardLevel !== void 0 && !["XS", "S", "M", "L"].includes(signals.upwardLevel)) issues.push(issue("CLASSIFICATION_SIGNAL_INVALID", "$.classificationBasis.signals.upwardLevel", "upwardLevel is invalid", "\u5220\u9664\u6216\u63D0\u4F9B\u5408\u6CD5\u5411\u4E0A\u52A0\u5F3A\u7EA7\u522B"));
  return issues;
}
function recommendClassification(basis) {
  try {
    validateBasis(basis, []);
  } catch (error) {
    const policy = error;
    return { readyToLock: false, reasons: [], issues: [issue(policy.code ?? "CLASSIFICATION_BASIS_INVALID", String(policy.details?.path ?? "$.classificationBasis"), policy.message, "\u4FEE\u6B63\u7ED3\u6784\u5316\u4E8B\u5B9E\u540E\u91CD\u8BD5")] };
  }
  const issues = validateSignals(basis.signals);
  if (issues.length) return { readyToLock: false, reasons: [], issues };
  const signals = basis.signals;
  const minimum = maxLevel(levelForSurface(signals.changeSurface), levelForBehavior(signals.behaviorChange), minimumLevelForTopology(signals.topology));
  const level = signals.upwardLevel && levelRank[signals.upwardLevel] > levelRank[minimum] ? signals.upwardLevel : minimum;
  const riskLabels = riskLabelsOf(basis);
  const controls = applyControlEnhancements(deriveGovernanceControls(level, signals, riskLabels), basis.controlEnhancements, signals, riskLabels);
  const orderedRoute = compileOrderedRoute(level, controls);
  const classification2 = {
    level,
    topology: signals.topology,
    requirements: signals.requirements,
    riskLabels,
    acceptanceAssistSuggested: false,
    classificationBasis: basis,
    controls,
    orderedRoute,
    routeConfirmationRequired: level === "M" || level === "L" || riskLabels.length > 0
  };
  const reasons = [
    { field: "changeSurface", value: signals.changeSurface, basisPaths: ["$.classificationBasis.signals.changeSurface"], message: `\u53D8\u66F4\u8868\u9762\u4E0B\u9650 ${levelForSurface(signals.changeSurface)}` },
    { field: "behaviorChange", value: signals.behaviorChange, basisPaths: ["$.classificationBasis.signals.behaviorChange"], message: `\u884C\u4E3A\u590D\u6742\u5EA6\u4E0B\u9650 ${levelForBehavior(signals.behaviorChange)}` },
    { field: "topology", value: signals.topology, basisPaths: ["$.classificationBasis.signals.topology"], message: `\u62D3\u6251\u4E0B\u9650 ${minimumLevelForTopology(signals.topology)}` },
    { field: "level", value: level, basisPaths: ["$.classificationBasis.signals"], message: `Core \u6700\u4F4E\u7EA7\u522B\u4E0E\u6709\u4F9D\u636E\u7684\u5411\u4E0A\u52A0\u5F3A\u5408\u5E76\u4E3A ${level}` },
    ...Object.entries(controls.reasons).map(([field, message]) => ({ field: `controls.${field}`, value: message, basisPaths: ["$.classificationBasis.signals", "$.classificationBasis.riskFactRefs"], message }))
  ];
  const route = levelRoute[level];
  return { readyToLock: true, classification: classification2, route, obligations: deriveObligations(route, basis, controls), reasons, issues: [] };
}
function defaultBasis(input) {
  return input.classificationBasis ?? {
    scopeFactRefs: [],
    topologyFactRefs: [],
    uncertaintyFactRefs: [],
    riskFactRefs: {},
    decisionRefs: [],
    ...input.controlEnhancements ? { controlEnhancements: input.controlEnhancements } : {}
  };
}
function fallbackClassificationSignals(input) {
  return {
    changeSurface: input.level === "XS" ? "single-site" : input.level === "S" ? "single-component" : input.level === "M" ? "multi-component" : "system-wide",
    behaviorChange: input.level === "XS" ? "mechanical" : input.level === "S" ? "bounded-rule" : input.level === "M" ? "new-capability" : "systemic-change",
    topology: input.topology,
    unitCount: input.topology === "multi-chain" || input.topology === "coordinated-rollback" ? 2 : 1,
    requirements: input.requirements ?? "missing-or-unclear",
    operationalRecovery: input.topology !== "local",
    executableRollback: input.topology === "coordinated-rollback"
  };
}
function selectRoute(input) {
  const basis = defaultBasis(input);
  if (basis.signals) {
    const preview = recommendClassification(basis);
    if (!preview.readyToLock) throw new PolicyError(preview.issues[0]?.code ?? "CLASSIFICATION_INVALID", preview.issues[0]?.message ?? "classification invalid", { issues: preview.issues });
    if (input.level && levelRank[input.level] < levelRank[preview.classification.level]) throw new PolicyError("CLASSIFICATION_BELOW_CORE_MINIMUM", "requested level is below Core minimum", { minimum: preview.classification.level });
    return { classification: preview.classification, route: preview.route, classificationBasis: basis, obligations: preview.obligations };
  }
  if (!input.level || !input.topology) throw new PolicyError("CLASSIFICATION_FACTS_REQUIRED", "classificationBasis.signals is required");
  const fallbackSignals = { ...fallbackClassificationSignals({ level: input.level, topology: input.topology, requirements: input.requirements }), upwardLevel: input.level };
  return selectBaseRoute({ ...basis, signals: fallbackSignals, level: input.level, topology: input.topology, requirements: input.requirements, riskLabels: input.riskLabels });
}
function selectBaseRoute(input) {
  const normalized = normalizeClassification(input);
  const basis = {
    scopeFactRefs: input.scopeFactRefs,
    topologyFactRefs: input.topologyFactRefs,
    uncertaintyFactRefs: input.uncertaintyFactRefs,
    riskFactRefs: input.riskFactRefs,
    decisionRefs: input.decisionRefs,
    ...input.signals ? { signals: input.signals } : {},
    ...input.controlEnhancements ? { controlEnhancements: input.controlEnhancements } : {}
  };
  validateBasis(basis, normalized.riskLabels);
  const preview = basis.signals ? recommendClassification(basis) : void 0;
  if (preview && !preview.readyToLock) throw new PolicyError(preview.issues[0]?.code ?? "CLASSIFICATION_INVALID", preview.issues[0]?.message ?? "classification invalid", { issues: preview.issues });
  if (preview?.readyToLock && levelRank[input.level] < levelRank[preview.classification.level]) throw new PolicyError("CLASSIFICATION_BELOW_CORE_MINIMUM", "requested level is below Core minimum", { minimum: preview.classification.level });
  if (preview?.readyToLock) return { classification: preview.classification, route: preview.route, classificationBasis: basis, obligations: preview.obligations };
  assertTopologyLevel(normalized);
  const signals = fallbackClassificationSignals(input);
  const controls = applyControlEnhancements(deriveGovernanceControls(input.level, signals, normalized.riskLabels), basis.controlEnhancements, signals, normalized.riskLabels);
  const classification2 = { ...normalized, classificationBasis: basis, controls, orderedRoute: compileOrderedRoute(input.level, controls), routeConfirmationRequired: input.level === "M" || input.level === "L" || normalized.riskLabels.length > 0 };
  const route = levelRoute[input.level];
  return { classification: classification2, route, classificationBasis: basis, obligations: deriveObligations(route, basis, controls) };
}
function assertBoundaryAuditComplete(audit, decisionRefsOrIndex, repositoryFacts = []) {
  const index = Array.isArray(decisionRefsOrIndex) ? { decisionRefs: decisionRefsOrIndex, decisions: decisionRefsOrIndex.map((recordId) => ({ recordId, currency: "current" })), repositoryFacts: repositoryFacts.map((record) => ({ recordId: record.recordId, currency: "current" })) } : decisionRefsOrIndex;
  const value = audit;
  if (!value || !Array.isArray(value.scanned) || requiredBoundaryKinds.some((kind) => !value.scanned.includes(kind)) || !Array.isArray(value.items)) {
    throw new PolicyError("BOUNDARY_AUDIT_INCOMPLETE", "boundaryAudit must explicitly scan every boundary category", { required: requiredBoundaryKinds });
  }
  for (const item of value.items) {
    const factRecord = typeof item.factRef === "string" ? index.repositoryFacts.find((record) => record.recordId === item.factRef) : void 0;
    const fact = item.disposition === "repository-fact" && typeof item.factRef === "string" && factRecord !== void 0 && factRecord.currency === "current";
    const decisionRecord = typeof item.decisionRef === "string" ? index.decisions.find((record) => record.recordId === item.decisionRef) : void 0;
    const decision = item.disposition === "resolved-decision" && typeof item.decisionRef === "string" && index.decisionRefs.includes(item.decisionRef) && decisionRecord !== void 0 && decisionRecord.currency === "current" && decisionRecord.supersededBy === void 0;
    if (!fact && !decision) {
      const code = decisionRecord?.supersededBy ? "BOUNDARY_DECISION_SUPERSEDED" : "BOUNDARY_AUDIT_UNRESOLVED";
      const unresolvedRefs = [item.factRef, item.decisionRef].filter((ref) => typeof ref === "string");
      const registeredIds = [
        ...index.repositoryFacts.map((record) => record.recordId),
        ...index.decisions.map((record) => record.recordId)
      ];
      throw new PolicyError(code, "every boundary item needs a current repository fact or a current resolved decision", {
        itemId: item.id,
        unresolvedRefs,
        registeredIds,
        ...typeof item.decisionRef === "string" ? { decisionRef: item.decisionRef } : {},
        ...typeof item.factRef === "string" ? { factRef: item.factRef } : {}
      });
    }
  }
}
function deriveRiskRequirements(riskLabels) {
  const checks = /* @__PURE__ */ new Set();
  const verification2 = /* @__PURE__ */ new Set();
  for (const label of riskLabels) {
    const enhancement = contract.riskEnhancements[label];
    if (!enhancement) continue;
    checks.add("risk-review");
    for (const check of enhancement.checks) checks.add(check);
    verification2.add(enhancement.verification);
  }
  return { checks: [...checks].sort(), verification: [...verification2].sort() };
}

// plugins/dev-flow/src/policy/evidence.ts
var emptyEvidence = () => ({
  fields: {},
  checks: [],
  verificationKinds: []
});
function addChecks(target, checks) {
  for (const check of checks) if (!target.includes(check)) target.push(check);
}
function requiredEvidenceForStep(route, riskLabels, step, controls) {
  const required = emptyEvidence();
  const orderedSteps = routeDefinitionForFeature(route, controls).orderedSteps;
  const risk = deriveRiskRequirements(riskLabels);
  if (step === "planning") {
    const effectiveRoute2 = routeDefinitionForFeature(route, controls);
    if (effectiveRoute2.generatedArtifacts?.includes("plan-review")) required.fields.reviewBatch = true;
    else required.fields.reviewType = "plan";
    if (route === "l") addChecks(required.checks, ["rollback-strategy"]);
  }
  if (step === "code_review") required.fields.reviewBatch = true;
  if (step === "implementation" && controls && checkpointsEnforcementRequired(route, controls)) {
    required.fields.files = "governed-root-paths";
  }
  const riskReviewTarget = orderedSteps.includes("code_review") ? "code_review" : orderedSteps.includes("planning") ? "planning" : orderedSteps.includes("verification") ? "verification" : void 0;
  if (riskReviewTarget === step && riskLabels.length) addChecks(required.checks, ["risk-review"]);
  if (risk.checks.some((check) => check.includes("security"))) {
    const target = orderedSteps.includes("code_review") ? "code_review" : orderedSteps.includes("planning") ? "planning" : orderedSteps.includes("verification") ? "verification" : void 0;
    if (step === target) addChecks(required.checks, risk.checks.filter((check) => check.includes("security")));
  }
  const rollbackChecks = risk.checks.filter((check) => check === "rollback" || check === "full-rollback" || check === "backup-preview-abort-compensation");
  if (rollbackChecks.length) {
    const target = orderedSteps.includes("planning") ? "planning" : "verification";
    if (step === target) addChecks(required.checks, rollbackChecks);
  }
  if (step === "verification") {
    required.verificationKinds = controls ? [...controls.verification] : riskLabels.length ? [...risk.verification] : ["targeted"];
  }
  required.checks.sort();
  return required;
}
function requiredEvidenceIsEmpty(required) {
  return Object.keys(required.fields).length === 0 && required.checks.length === 0 && required.verificationKinds.length === 0;
}
function missingRequiredEvidence(required, evidence) {
  const missing = emptyEvidence();
  const supplied = typeof evidence === "object" && evidence !== null && !Array.isArray(evidence) ? evidence : {};
  if (required.fields.reviewType !== void 0 && supplied.reviewType !== required.fields.reviewType) {
    missing.fields.reviewType = required.fields.reviewType;
  }
  if (required.fields.reviewDepth !== void 0 && supplied.reviewDepth !== required.fields.reviewDepth) {
    missing.fields.reviewDepth = required.fields.reviewDepth;
  }
  if (required.fields.reviewBatch !== void 0) missing.fields.reviewBatch = true;
  if (required.fields.files !== void 0 && (!Array.isArray(supplied.files) || supplied.files.some((file) => typeof file !== "string" || !file.trim()))) {
    missing.fields.files = required.fields.files;
  }
  const suppliedChecks = Array.isArray(supplied.checks) ? supplied.checks.filter((value) => typeof value === "string") : [];
  missing.checks = required.checks.filter((check) => !suppliedChecks.includes(check));
  const kinds = Array.isArray(supplied.kinds) ? supplied.kinds.filter((value) => typeof value === "string") : [];
  missing.verificationKinds = required.verificationKinds.filter((kind) => !kinds.includes(kind));
  return missing;
}

// plugins/dev-flow/src/policy/stages.ts
function firstOpenStep(orderedSteps, steps) {
  return orderedSteps.find((step) => steps[step]?.status !== "satisfied");
}
function effectiveStage(state) {
  if (state.mode === "intake" || !state.route) return "intake";
  if (state.lifecycle === "finalized") return "complete";
  const definition = routeDefinitionForFeature(state.route, state.classification?.controls);
  return firstOpenStep(definition.orderedSteps, state.steps ?? {}) ?? definition.orderedSteps[definition.orderedSteps.length - 1] ?? "unknown";
}

// plugins/dev-flow/src/core/execution-brief.ts
function buildFeatureMutationSummary(state) {
  const obligations = state.obligations ?? [];
  const units = state.implementationUnits ?? [];
  const interactions2 = Object.values(state.interactions ?? {});
  const snapshot = state.deliverySnapshot;
  return {
    featureId: state.featureId,
    revision: state.revision,
    mode: state.mode,
    lifecycle: state.lifecycle,
    ...state.mode === "routed" ? { route: state.route } : {},
    stage: effectiveStage(state),
    logicComplete: state.logicComplete,
    obligations: {
      pending: obligations.filter((obligation) => obligation.status === "pending").length,
      satisfied: obligations.filter((obligation) => obligation.status === "satisfied").length,
      stale: obligations.filter((obligation) => obligation.status === "stale").length
    },
    counters: {
      checkpoints: state.checkpoints?.length ?? 0,
      unitsDone: units.filter((unit) => unit.status === "checkpointed" || unit.status === "rolled_back").length,
      unitsTotal: units.length,
      openInteractions: interactions2.filter((interaction) => interaction.status === "pending").length,
      blockingFindings: state.blockingFindings.filter((finding) => finding.blocking).length
    },
    // finalize 透明性：已排除但仍有变化的路径不阻塞完成，只在响应中提醒。
    ...snapshot?.excludedChangedPaths?.length ? { excludedChangedPaths: snapshot.excludedChangedPaths } : {}
  };
}

// plugins/dev-flow/src/policy/presentation.ts
var stageLabels = {
  intake: "\u9700\u6C42\u4E86\u89E3",
  locate: "\u9700\u6C42\u4E86\u89E3",
  boundary: "\u9700\u6C42\u786E\u8BA4",
  requirements: "\u9700\u6C42\u786E\u8BA4",
  requirements_alignment: "\u9700\u6C42\u786E\u8BA4",
  planning: "\u5B9E\u65BD\u89C4\u5212",
  plan_review: "\u8BA1\u5212\u5BA1\u67E5",
  execution_approval: "\u6267\u884C\u786E\u8BA4",
  implementation: "\u5F00\u53D1\u5B9E\u73B0",
  code_review: "\u4EE3\u7801\u5BA1\u67E5",
  verification: "\u9A8C\u8BC1",
  finalize: "\u4EA4\u4ED8\u6536\u5C3E",
  complete: "\u5DF2\u5B8C\u6210",
  abandoned: "\u5DF2\u7EC8\u6B62",
  paused: "\u5DF2\u6682\u505C"
};
var lifecycleLabels = {
  active: "\u8FDB\u884C\u4E2D",
  paused: "\u5DF2\u6682\u505C",
  finalized: "\u5DF2\u5B8C\u6210",
  abandoned: "\u5DF2\u7EC8\u6B62"
};
function exhaustive(value) {
  throw new Error(`unmapped presentation value: ${String(value)}`);
}
function routeLabel(route) {
  switch (route) {
    case "xs":
      return "XS\uFF1A\u6781\u5C0F\u6539\u52A8";
    case "s":
      return "S\uFF1A\u5C0F\u578B\u6539\u52A8";
    case "m":
      return "M\uFF1A\u4E2D\u578B\u53D8\u66F4\uFF08\u52A8\u6001\u6CBB\u7406\uFF09";
    case "l":
      return "L\uFF1A\u5927\u578B\u53D8\u66F4\uFF08\u52A8\u6001\u6CBB\u7406\uFF09";
    default:
      return exhaustive(route);
  }
}
function stageLabel(stage) {
  return stageLabels[stage] ?? "\u5F53\u524D\u9636\u6BB5";
}
function lifecycleLabel(lifecycle) {
  switch (lifecycle) {
    case "active":
      return lifecycleLabels.active;
    case "paused":
      return lifecycleLabels.paused;
    case "finalized":
      return lifecycleLabels.finalized;
    case "abandoned":
      return lifecycleLabels.abandoned;
    default:
      return exhaustive(lifecycle);
  }
}

// plugins/dev-flow/src/mcp/attention.ts
import { execFile as execFile2 } from "node:child_process";
import { promisify as promisify2 } from "node:util";

// plugins/dev-flow/src/mcp/windows-notifications.ts
import { execFile } from "node:child_process";
import { access } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
var run = promisify(execFile);
var WINDOWS_NOTIFICATION_APP_ID = "io.github.wxy_hh.dev_flow";
var shortcutName = "Dev Flow \u901A\u77E5.lnk";
function platformOf(options) {
  return options.platform ?? process.platform;
}
function environmentOf(options) {
  return options.environment ?? process.env;
}
function shortcutPathOf(environment) {
  const appData = environment.APPDATA;
  return appData ? path.win32.join(appData, "Microsoft", "Windows", "Start Menu", "Programs", shortcutName) : void 0;
}
async function command(file, args) {
  return run(file, args);
}
async function pathExists(file) {
  try {
    await access(file);
    return true;
  } catch {
    return false;
  }
}
function powerShellLiteral(value) {
  return `'${value.replaceAll("'", "''")}'`;
}
function encodedPowerShell(script) {
  return ["-NoProfile", "-NonInteractive", "-EncodedCommand", Buffer.from(script, "utf16le").toString("base64")];
}
function xmlEscape(value) {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&apos;");
}
function registrationScript(shortcutPath, nodeExecutable) {
  return `
$ErrorActionPreference = 'Stop'
$shortcutPath = ${powerShellLiteral(shortcutPath)}
$nodeExecutable = ${powerShellLiteral(nodeExecutable)}
$nodeArguments = '-e "process.exit(0)"'
$workingDirectory = ${powerShellLiteral(path.win32.dirname(shortcutPath))}
$appId = ${powerShellLiteral(WINDOWS_NOTIFICATION_APP_ID)}
$source = @'
using System;
using System.IO;
using System.Runtime.InteropServices;

namespace DevFlowNotifications {
  [StructLayout(LayoutKind.Sequential, Pack = 4)]
  public struct PropertyKey {
    public Guid FormatId;
    public uint PropertyId;
    public PropertyKey(string formatId, uint propertyId) { FormatId = new Guid(formatId); PropertyId = propertyId; }
  }

  [StructLayout(LayoutKind.Explicit)]
  public struct PropVariant {
    [FieldOffset(0)] public ushort VarType;
    [FieldOffset(8)] public IntPtr PointerValue;
    [FieldOffset(8)] public short BoolValue;
    public static PropVariant FromString(string value) {
      return new PropVariant { VarType = 31, PointerValue = Marshal.StringToCoTaskMemUni(value) };
    }
    public static PropVariant FromBool(bool value) {
      return new PropVariant { VarType = 11, BoolValue = value ? (short)-1 : (short)0 };
    }
    public void Clear() { PropVariantClear(ref this); }
    [DllImport("ole32.dll")] private static extern int PropVariantClear(ref PropVariant value);
  }

  [ComImport, Guid("000214F9-0000-0000-C000-000000000046"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  internal interface IShellLinkW {
    void GetPath([Out, MarshalAs(UnmanagedType.LPWStr)] System.Text.StringBuilder file, int maxPath, IntPtr findData, uint flags);
    void GetIDList(out IntPtr itemIdList);
    void SetIDList(IntPtr itemIdList);
    void GetDescription([Out, MarshalAs(UnmanagedType.LPWStr)] System.Text.StringBuilder name, int maxPath);
    void SetDescription([MarshalAs(UnmanagedType.LPWStr)] string name);
    void GetWorkingDirectory([Out, MarshalAs(UnmanagedType.LPWStr)] System.Text.StringBuilder directory, int maxPath);
    void SetWorkingDirectory([MarshalAs(UnmanagedType.LPWStr)] string directory);
    void GetArguments([Out, MarshalAs(UnmanagedType.LPWStr)] System.Text.StringBuilder arguments, int maxPath);
    void SetArguments([MarshalAs(UnmanagedType.LPWStr)] string arguments);
    void GetHotkey(out ushort hotkey);
    void SetHotkey(ushort hotkey);
    void GetShowCmd(out int showCommand);
    void SetShowCmd(int showCommand);
    void GetIconLocation([Out, MarshalAs(UnmanagedType.LPWStr)] System.Text.StringBuilder iconPath, int maxPath, out int iconIndex);
    void SetIconLocation([MarshalAs(UnmanagedType.LPWStr)] string iconPath, int iconIndex);
    void SetRelativePath([MarshalAs(UnmanagedType.LPWStr)] string relativePath, uint reserved);
    void Resolve(IntPtr owner, uint flags);
    void SetPath([MarshalAs(UnmanagedType.LPWStr)] string file);
  }

  [ComImport, Guid("0000010B-0000-0000-C000-000000000046"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  internal interface IPersistFile {
    void GetClassID(out Guid classId);
    [PreserveSig] int IsDirty();
    void Load([MarshalAs(UnmanagedType.LPWStr)] string fileName, uint mode);
    void Save([MarshalAs(UnmanagedType.LPWStr)] string fileName, bool remember);
    void SaveCompleted([MarshalAs(UnmanagedType.LPWStr)] string fileName);
    void GetCurFile(out IntPtr fileName);
  }

  [ComImport, Guid("886D8EEB-8CF2-4446-8D02-CDBA1DBDCF99"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  internal interface IPropertyStore {
    void GetCount(out uint count);
    void GetAt(uint index, out PropertyKey key);
    void GetValue(ref PropertyKey key, out PropVariant value);
    void SetValue(ref PropertyKey key, ref PropVariant value);
    void Commit();
  }

  [ComImport, Guid("00021401-0000-0000-C000-000000000046")]
  internal class ShellLink { }

  public static class ShortcutInstaller {
    // System.AppUserModel.ID and System.AppUserModel.PreventPinning.
    private static readonly PropertyKey AppUserModelId = new PropertyKey("9F4C2855-9F79-4B39-A8D0-E1D42DE1D5F3", 5);
    private static readonly PropertyKey PreventPinning = new PropertyKey("9F4C2855-9F79-4B39-A8D0-E1D42DE1D5F3", 9);

    public static void CreateOrUpdate(string shortcutPath, string executablePath, string arguments, string workingDirectory, string appId) {
      Directory.CreateDirectory(Path.GetDirectoryName(shortcutPath));
      var link = (IShellLinkW)new ShellLink();
      try {
        link.SetPath(executablePath);
        link.SetArguments(arguments);
        link.SetWorkingDirectory(workingDirectory);
        link.SetDescription("Dev Flow \u672C\u5730\u901A\u77E5\u8EAB\u4EFD");
        link.SetIconLocation(executablePath, 0);
        link.SetShowCmd(0);
        var properties = (IPropertyStore)link;
        var appIdValue = PropVariant.FromString(appId);
        var preventPinningValue = PropVariant.FromBool(true);
        try {
          properties.SetValue(ref PreventPinning, ref preventPinningValue);
          properties.SetValue(ref AppUserModelId, ref appIdValue);
          properties.Commit();
        } finally {
          appIdValue.Clear();
          preventPinningValue.Clear();
        }
        ((IPersistFile)link).Save(shortcutPath, true);
      } finally {
        Marshal.FinalReleaseComObject(link);
      }
    }
  }
}
'@
Add-Type -TypeDefinition $source -ErrorAction Stop
[DevFlowNotifications.ShortcutInstaller]::CreateOrUpdate($shortcutPath, $nodeExecutable, $nodeArguments, $workingDirectory, $appId)
`;
}
function toastScript(title, body) {
  const xml = `<toast><visual><binding template="ToastGeneric"><text>${xmlEscape(title)}</text><text>${xmlEscape(body)}</text></binding></visual><audio src="ms-winsoundevent:Notification.Default"/></toast>`;
  return `
$ErrorActionPreference = 'Stop'
$null = [Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime]
$null = [Windows.Data.Xml.Dom.XmlDocument, Windows.Data.Xml.Dom.XmlDocument, ContentType = WindowsRuntime]
$xml = New-Object Windows.Data.Xml.Dom.XmlDocument
$xml.LoadXml(${powerShellLiteral(xml)})
$toast = [Windows.UI.Notifications.ToastNotification]::new($xml)
[Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier(${powerShellLiteral(WINDOWS_NOTIFICATION_APP_ID)}).Show($toast)
`;
}
async function enableWindowsNotifications(options = {}) {
  const platform = platformOf(options);
  if (platform !== "win32") return { status: "unsupported", platform };
  const shortcutPath = shortcutPathOf(environmentOf(options));
  if (!shortcutPath) {
    return { status: "unavailable", reason: "APPDATA is unavailable; run this from an interactive Windows desktop session." };
  }
  try {
    await (options.execute ?? command)("powershell.exe", encodedPowerShell(registrationScript(shortcutPath, options.nodeExecutable ?? process.execPath)));
    return { status: "enabled", appId: WINDOWS_NOTIFICATION_APP_ID, shortcutPath };
  } catch (error) {
    return {
      status: "failed",
      appId: WINDOWS_NOTIFICATION_APP_ID,
      shortcutPath,
      reason: error instanceof Error ? error.message : String(error),
      recoveryHint: "Check that Windows PowerShell is available, then retry dev_flow_enable_windows_notifications."
    };
  }
}
async function emitWindowsToast(title, body, options = {}) {
  if (platformOf(options) !== "win32") return;
  const shortcutPath = shortcutPathOf(environmentOf(options));
  if (!shortcutPath) return;
  try {
    if (!await (options.exists ?? pathExists)(shortcutPath)) return;
    await (options.execute ?? command)("powershell.exe", encodedPowerShell(toastScript(title, body)));
  } catch {
  }
}

// plugins/dev-flow/src/mcp/attention.ts
var run2 = promisify2(execFile2);
function messageFor(event) {
  if (event.kind === "workflow-finalized") {
    return { title: "Dev Flow \u5DF2\u5B8C\u6210", body: "\u5F53\u524D\u529F\u80FD\u5DF2\u5B8C\u6210\u5E76\u751F\u6210\u4EA4\u4ED8\u5FEB\u7167\u3002" };
  }
  const decision = event.decision === "approval" ? "\u786E\u8BA4\u5F00\u59CB\u6267\u884C" : event.decision === "rollback-confirmation" ? "\u56DE\u64A4\u786E\u8BA4" : event.decision === "quality-exception" ? "\u8D28\u91CF\u98CE\u9669\u786E\u8BA4" : event.decision === "review-risk" ? "\u5BA1\u67E5\u98CE\u9669\u786E\u8BA4" : event.decision === "route-confirmation" ? "\u8DEF\u7EBF\u786E\u8BA4" : event.decision === "decision-ratification" ? "\u51B3\u5B9A\u8FFD\u8BA4" : event.decision === "decision-revision" ? "\u51B3\u5B9A\u4FEE\u8BA2" : event.decision === "plan-revision" ? "\u8BA1\u5212\u4FEE\u8BA2" : event.decision === "side-effect-rerun" ? "\u526F\u4F5C\u7528\u5355\u5143\u91CD\u8DD1\u786E\u8BA4" : event.decision === "acceptance-confirmation" ? "\u9A8C\u6536\u786E\u8BA4" : "\u9700\u6C42\u9009\u62E9";
  return { title: "Dev Flow \u9700\u8981\u51B3\u7B56", body: `\u5F53\u524D\u529F\u80FD\u6B63\u5728\u7B49\u5F85\u4F60\u7684${decision}\u3002` };
}
function appleScriptString(value) {
  return `"${value.replaceAll("\\", "\\\\").replaceAll('"', '\\"').replaceAll("\n", "\\n")}"`;
}
async function emitAttention(event, options = {}) {
  const { title, body } = messageFor(event);
  try {
    options.emit?.({
      jsonrpc: "2.0",
      method: "notifications/message",
      params: { level: "info", data: event }
    });
  } catch {
  }
  const environment = options.environment ?? process.env;
  const automatedEnvironment = environment.CI === "true" || environment.CI === "1" || environment.NODE_ENV === "test";
  const localAlertsEnabled = options.localAlertsEnabled ?? (environment.DEV_FLOW_DISABLE_ATTENTION !== "1" && !automatedEnvironment);
  const platform = options.platform ?? process.platform;
  if (!localAlertsEnabled) return;
  if (platform === "win32") {
    await emitWindowsToast(title, body, { platform, environment, execute: options.execute, exists: options.exists });
    return;
  }
  if (platform !== "darwin") return;
  const script = `display notification ${appleScriptString(body)} with title ${appleScriptString(title)} sound name "Glass"`;
  try {
    await (options.execute ?? ((file, args) => run2(file, args)))("osascript", ["-e", script]);
  } catch {
  }
}

// plugins/dev-flow/src/mcp/dispatch.ts
import path24 from "node:path";
import { fileURLToPath } from "node:url";

// plugins/dev-flow/src/core/artifacts.ts
import { createHash as createHash29 } from "node:crypto";
import { readFile as readFile17, writeFile as writeFile4 } from "node:fs/promises";
import path21 from "node:path";

// plugins/dev-flow/src/core/artifact-templates.ts
function frontMatter(context, kind) {
  return [
    "---",
    "dev_flow:",
    "  schema_version: 3",
    `  feature_id: ${context.featureId}`,
    `  route: ${context.route}`,
    `  kind: ${kind}`,
    "---",
    ""
  ].join("\n");
}
function requirementsTemplate(context) {
  void context.requirementsState;
  return `${frontMatter(context, "requirements")}# \u9700\u6C42

## \u8303\u56F4

## \u76EE\u6807

## \u975E\u76EE\u6807

## \u9A8C\u6536\u6761\u4EF6

<!-- dev-flow:id=REQ-001 kind=requirement -->
### REQ-001\uFF1A\u9700\u6C42

- \u63CF\u8FF0\uFF1A

<!-- dev-flow:id=AC-001 kind=acceptance-criterion -->
#### AC-001\uFF1A\u9A8C\u6536\u6761\u4EF6\uFF08parent: REQ-001\uFF09

- \u9A8C\u6536\u6761\u4EF6\uFF1A

## \u51B3\u7B56\u8BB0\u5F55

| ID | \u95EE\u9898 | \u51B3\u7B56 | \u6765\u6E90 | \u5F71\u54CD |
| --- | --- | --- | --- | --- |

## \u5F00\u653E\u95EE\u9898

- \u65E0
`;
}
function implementationPlanTemplate(context) {
  const formal = context.controls?.plan === "formal" || ["m", "l"].includes(context.route);
  const implementationUnit = formal ? "\n<!-- dev-flow:id=UNIT-001 kind=implementation-unit -->\n### UNIT-001\uFF1A\u5B9E\u73B0\u5355\u5143\n\n- tasks: [TASK-001]\n- depends_on: []\n- file_scope: []\n- covers: [REQ-001]\n- forward_verification: [unit]\n" : "";
  const test = formal ? "\n<!-- dev-flow:id=TEST-001 kind=test -->\n### TEST-001\uFF1A\u9A8C\u8BC1\u573A\u666F\uFF08verifies: AC-001\uFF09\n\n- \u9A8C\u8BC1\u65B9\u6CD5\uFF1A\n" : "";
  return `${frontMatter(context, "implementation-plan")}# \u5B9E\u73B0\u8BA1\u5212

<!-- dev-flow:id=TASK-001 kind=task -->
### TASK-001\uFF1A\u5B9E\u73B0\u4EFB\u52A1

- covers: [REQ-001]
- implementation_unit: UNIT-001
${test}${implementationUnit}`;
}
function coverageMatrixTemplate(context) {
  return `${frontMatter(context, "coverage-matrix")}# \u8986\u76D6\u77E9\u9635

<!-- dev-flow:id=TEST-001 kind=test -->
### TEST-001\uFF1A\u9A8C\u8BC1\u573A\u666F\uFF08verifies: AC-001\uFF09

- \u9A8C\u8BC1\u65B9\u6CD5\uFF1A
`;
}
function rollbackUnitsTemplate(context) {
  return `${frontMatter(context, "rollback-units")}# \u56DE\u64A4\u5355\u5143

<!-- dev-flow:id=RU-001 kind=rollback -->
### RU-001\uFF1A\u56DE\u64A4\u5355\u5143

- tasks: [TASK-001]
- depends_on: []
- file_scope: []
- covers: [REQ-001]
- forward_verification: [unit]
- rollback_verification: [unit]
`;
}
function renderArtifactTemplate(context, kind) {
  switch (kind) {
    case "requirements":
      return requirementsTemplate(context);
    case "implementation-plan":
      return implementationPlanTemplate(context);
    case "coverage-matrix":
      return coverageMatrixTemplate(context);
    case "rollback-units":
      return rollbackUnitsTemplate(context);
    default:
      return `${frontMatter(context, kind)}# ${kind}

`;
  }
}

// plugins/dev-flow/src/core/approval-basis.ts
function approvalIds(state) {
  return (state.obligations ?? []).filter((obligation) => obligation.kind === "approval").map((obligation) => obligation.id);
}
function approvalBasis(state, approvalId2) {
  const obligation = state.obligations?.find((candidate) => candidate.id === approvalId2 && candidate.kind === "approval");
  if (!obligation) throw new Error(`approval obligation not found: ${approvalId2}`);
  const basis = {
    approvalId: approvalId2,
    obligationBasisHash: obligation.basisHash,
    route: state.route,
    scope: state.scope,
    classification: state.classification,
    classificationBasis: state.classificationBasis,
    executionSemanticBasisHash: state.executionSemanticBasisHash
  };
  basis.blockingRisks = state.blockingFindings.filter((finding) => finding.blocking).map((finding) => finding.message).sort();
  basis.verification = {
    riskLabels: state.classification.riskLabels,
    blockingRisks: basis.blockingRisks
  };
  return basis;
}
function confirmedApproval(state) {
  for (const approvalId2 of approvalIds(state)) {
    const record = state.humanGates[approvalId2];
    if (record?.status === "confirmed") return { approvalId: approvalId2, record };
  }
  return void 0;
}

// plugins/dev-flow/src/core/state-store.ts
import { randomUUID as randomUUID13, createHash as createHash28 } from "node:crypto";
import { access as access4, mkdir as mkdir11, open as open7, readdir as readdir6, readFile as readFile16, rename as rename6, rm as rm3, writeFile as writeFile3 } from "node:fs/promises";
import { hostname as hostname2 } from "node:os";
import path20 from "node:path";

// plugins/dev-flow/src/core/schema-migration.ts
import { createHash as createHash2 } from "node:crypto";
function migrateFeatureState(raw) {
  const version = raw?.schemaVersion;
  if (version === 5) return raw;
  if (version === 4) return migrateV4ToV5(raw);
  throw new DevFlowError("UNSUPPORTED_FEATURE_SCHEMA", `\u4E0D\u652F\u6301\u7684 feature state schema v${String(version)}\u3002`, {
    userMessage: `\u68C0\u6D4B\u5230\u4E0D\u652F\u6301\u7684\u65E7\u72B6\u6001 schema\uFF08v${String(version)}\uFF09\u3002`,
    cause: "\u672C\u7248\u672C\u652F\u6301 schema v4\uFF08\u81EA\u52A8\u8F6C\u6362\uFF09\u4E0E v5\uFF1B\u66F4\u65E9\u7684 schema \u4E0D\u8FC1\u79FB\u3002",
    impact: "\u65E7 feature \u4E0D\u4F1A\u88AB\u8BFB\u53D6\u3001\u8986\u76D6\u6216\u731C\u6D4B\u3002",
    recoveryKind: "repair",
    recoveryInstruction: "\u56DE\u5230\u4EA7\u751F\u8BE5\u72B6\u6001\u7684 Dev Flow \u7248\u672C\u5B8C\u6210\u6216\u653E\u5F03\u8BE5 feature\uFF0C\u5907\u4EFD .dev-flow \u540E\u91CD\u65B0\u521D\u59CB\u5316\u3002",
    retryOriginal: false,
    schemaVersion: version
  });
}
function migrateV4ToV5(v4) {
  const ledger = {
    decisions: migrateDecisions(v4),
    claims: [],
    authorizations: migrateAuthorizations(v4),
    credentials: migrateCredentials(v4),
    repositoryFacts: []
  };
  const { decisionLedger: _decisionLedger, qualityExceptions: _qualityExceptions, ...rest } = v4;
  void _decisionLedger;
  void _qualityExceptions;
  return { ...rest, schemaVersion: 5, governance: ledger };
}
function migrateDecisions(v4) {
  return (v4.decisionLedger ?? []).filter((record) => record.status === "resolved" && (record.conclusion ?? record.evidence ?? "").trim().length > 0).map((record) => ({
    recordId: record.id,
    kind: "decision",
    question: record.question,
    conclusion: (record.conclusion ?? record.evidence ?? "").trim()
  }));
}
function migrateAuthorizations(v4) {
  return (v4.qualityExceptions ?? []).map((item) => ({
    recordId: `AUTH-${createHash2("sha256").update(`${item.kind}|${item.fingerprint}|${item.at}`).digest("hex").slice(0, 16)}`,
    kind: "authorization",
    authorizationType: "risk-acceptance",
    target: item.riskSummary,
    basis: item.fingerprint ? { kind: "content", sha256: item.fingerprint } : void 0,
    recordedAt: item.at
  }));
}
function migrateCredentials(v4) {
  const hostIsValid = (host) => host === "claude" || host === "codex";
  const credentials = [];
  for (const raw of Object.values(v4.interactions ?? {})) {
    const interaction = raw;
    const response = interaction?.response;
    if (interaction?.status !== "resolved" || !response) continue;
    if (!hostIsValid(response.host)) continue;
    if (!interaction.id) continue;
    const eventId = response.promptEventId ?? interaction.presentationEventId;
    credentials.push({
      recordId: `CRED-${interaction.id}`,
      kind: "credential",
      source: response.source === "elicitation" ? "native-form" : "text",
      host: response.host,
      interactionId: interaction.id,
      ...response.selectedOptionId ? { optionId: response.selectedOptionId } : {},
      ...response.rawReply ?? response.userReply ? { rawText: response.rawReply ?? response.userReply } : {},
      ...eventId ? { basis: { kind: "event", eventId } } : {},
      ...response.respondedAt ? { recordedAt: response.respondedAt } : {}
    });
  }
  return credentials;
}

// plugins/dev-flow/src/core/step-order.ts
function routeDefinitionForState(state) {
  if (state.mode !== "routed") {
    throw new DevFlowError("ROUTE_NOT_DETERMINED", "route is not determined yet", {
      userMessage: "\u5F53\u524D feature \u5C1A\u672A\u9501\u5B9A\u8DEF\u7EBF\u3002",
      cause: `feature ${state.featureId} \u5904\u4E8E intake \u9636\u6BB5\uFF0Croute \u5C1A\u672A\u786E\u5B9A\u3002`,
      impact: "\u9501\u5B9A\u8DEF\u7EBF\u524D\u65E0\u6CD5\u63A8\u8FDB\u4EFB\u4F55\u8DEF\u7EBF\u6B65\u9AA4\u3002",
      recoveryKind: "retry",
      recoveryInstruction: "\u5148\u8C03\u7528 dev_flow_lock_classification \u9501\u5B9A\u8DEF\u7EBF\uFF0C\u518D\u7EE7\u7EED\u5F53\u524D\u64CD\u4F5C\u3002",
      retryOriginal: true,
      requiresUserDecision: false
    });
  }
  return routeDefinitionForFeature(state.route, state.classification.controls);
}
function currentOpenStep(state) {
  if (state.mode !== "routed") return void 0;
  return firstOpenStep(routeDefinitionForFeature(state.route, state.classification.controls).orderedSteps, state.steps);
}
function assertCurrentStep(state, step) {
  if (currentOpenStep(state) !== step) throw new DevFlowError("STEP_OUT_OF_ORDER", `${step} is not the current route step`, { expected: currentOpenStep(state) });
}

// plugins/dev-flow/src/core/repository-facts.ts
import { createHash as createHash4 } from "node:crypto";

// plugins/dev-flow/src/core/path-normalization.ts
import path2 from "node:path";
function normalizeUnicode(value) {
  return value.normalize("NFC");
}
function normalizeProjectPath(value) {
  return path2.posix.normalize(normalizeUnicode(value).replaceAll("\\", "/"));
}
function isAbsoluteProjectPath(value) {
  return path2.posix.isAbsolute(value);
}
function isCanonicalProjectPath(value) {
  return normalizeProjectPath(value) === value;
}

// plugins/dev-flow/src/core/repository-fact-store.ts
import { createHash as createHash3 } from "node:crypto";
import { lstat, readFile, readdir } from "node:fs/promises";
import path3 from "node:path";
var digest = (value) => createHash3("sha256").update(value).digest("hex");
function invalid(message) {
  throw new DevFlowError("INVALID_REPOSITORY_FACT", message, {
    recoveryHint: "\u4FEE\u6B63\u7ED3\u6784\u5316\u4ED3\u5E93\u89C2\u5BDF\u540E\u91CD\u8BD5\uFF1B\u89C2\u5BDF\u5FC5\u987B\u80FD\u7531 Core \u5728\u5F53\u524D\u4ED3\u5E93\u4E2D\u91CD\u590D\u6267\u884C\u3002",
    retryOriginal: true
  });
}
function safeRelative(root2, candidate) {
  const absoluteRoot = path3.resolve(root2);
  const absolute = path3.resolve(root2, candidate);
  const relative = path3.relative(absoluteRoot, absolute).split(path3.sep).join("/");
  if (!relative || relative === "." || relative.startsWith("../") || relative === ".." || path3.isAbsolute(relative) || relative === ".git" || relative.startsWith(".git/") || relative === ".dev-flow" || relative.startsWith(".dev-flow/") || relative === "node_modules" || relative.startsWith("node_modules/")) invalid(`repository observation path escapes the project: ${candidate}`);
  return relative;
}
async function filesInScope(root2, scope) {
  const files = [];
  for (const raw of scope) {
    const entry = safeRelative(root2, raw);
    const absolute = path3.join(root2, entry);
    let metadata;
    try {
      metadata = await lstat(absolute);
    } catch (error) {
      if (error.code === "ENOENT") invalid(`repository observation scope does not exist: ${entry}`);
      throw invalid(`repository observation scope is not readable: ${entry}`);
    }
    if (metadata.isSymbolicLink()) invalid(`repository observation scope cannot be a symbolic link: ${entry}`);
    if (metadata.isFile()) files.push(entry);
    else if (metadata.isDirectory()) {
      for (const child of await readdir(absolute, { recursive: true })) {
        const relative = path3.posix.join(entry, String(child).split(path3.sep).join("/"));
        const childAbsolute = path3.join(root2, relative);
        try {
          const childMetadata = await lstat(childAbsolute);
          if (childMetadata.isFile() && !childMetadata.isSymbolicLink()) files.push(relative);
        } catch (error) {
          if (error.code !== "ENOENT") throw error;
        }
      }
    } else invalid(`repository observation scope is not a file or directory: ${entry}`);
  }
  return [...new Set(files)].sort();
}
async function readRegularFile(root2, candidate) {
  const relative = safeRelative(root2, candidate);
  const absolute = path3.join(root2, relative);
  let metadata;
  try {
    metadata = await lstat(absolute);
  } catch (error) {
    if (error.code === "ENOENT") invalid(`repository observation file does not exist: ${relative}`);
    throw invalid(`repository observation file is not readable: ${relative}`);
  }
  if (!metadata.isFile() || metadata.isSymbolicLink()) invalid(`repository observation file is not a regular file: ${relative}`);
  try {
    const contents = await readFile(absolute, "utf8");
    return { path: relative, contents, sha256: digest(contents) };
  } catch {
    throw invalid(`repository observation file is not readable: ${relative}`);
  }
}
function jsonPointer(value, pointer) {
  if (pointer === "") return value;
  if (!pointer.startsWith("/")) invalid("json-value observation pointer must be an RFC 6901 pointer");
  let current = value;
  for (const segment of pointer.slice(1).split("/")) {
    const key = segment.replaceAll("~1", "/").replaceAll("~0", "~");
    if (current === null || typeof current !== "object" || !(key in current)) return void 0;
    current = current[key];
  }
  return current;
}
function equalJson(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}
function safeRegex(pattern) {
  if (!pattern || pattern.length > 200 || /(?:\\[1-9]|\([^)]*[+*][^)]*\)[+*])/.test(pattern)) {
    invalid("search-absent regex is empty, too long, or potentially catastrophic");
  }
  try {
    return new RegExp(pattern, "m");
  } catch {
    throw invalid("search-absent regex is invalid");
  }
}
async function executeRepositoryObservation(root2, observation) {
  if (observation.kind === "file-exists") {
    const file = await readRegularFile(root2, observation.path);
    return { confirmed: true, observedFingerprint: file.sha256, summary: `${file.path} is a readable file` };
  }
  if (observation.kind === "text-present" || observation.kind === "symbol-present") {
    const file = await readRegularFile(root2, observation.path);
    const needle = observation.kind === "text-present" ? observation.text : observation.symbol;
    if (!needle.trim()) invalid(`${observation.kind} observation requires a non-empty anchor`);
    const count = file.contents.split(needle).length - 1;
    const required = observation.kind === "text-present" ? observation.occurrence ?? 1 : 1;
    return { confirmed: count >= required, observedFingerprint: file.sha256, summary: `${file.path} contains ${observation.kind === "text-present" ? "the requested text" : "the requested symbol"}` };
  }
  if (observation.kind === "json-value") {
    const file = await readRegularFile(root2, observation.path);
    let parsed;
    try {
      parsed = JSON.parse(file.contents);
    } catch {
      return { confirmed: false, observedFingerprint: file.sha256, summary: `${file.path} is not valid JSON` };
    }
    return { confirmed: equalJson(jsonPointer(parsed, observation.pointer), observation.expected), observedFingerprint: file.sha256, summary: `${file.path} JSON pointer ${observation.pointer} matches the expected value` };
  }
  const files = await filesInScope(root2, observation.checkedScope);
  const matcher = observation.patternKind === "literal" ? void 0 : safeRegex(observation.pattern);
  let hit = false;
  const hashes = [];
  for (const file of files) {
    const read = await readRegularFile(root2, file);
    hashes.push(`${file}:${read.sha256}`);
    if (matcher ? matcher.test(read.contents) : read.contents.includes(observation.pattern)) hit = true;
  }
  const observedFingerprint = digest(hashes.sort().join("\n"));
  return { confirmed: !hit, observedFingerprint, summary: `${observation.patternKind} search across ${files.length} files found no match` };
}
async function computeLocationFingerprint(root2, location) {
  if (location.kind === "positive") return (await readRegularFile(root2, location.path)).sha256;
  const files = await filesInScope(root2, location.checkedScope);
  const hashes = [];
  for (const file of files) hashes.push(`${file}:${(await readRegularFile(root2, file)).sha256}`);
  return digest(hashes.sort().join("\n"));
}
async function assertPositiveAnchor(root2, location) {
  if (!location.anchor) return;
  const file = await readRegularFile(root2, location.path);
  if (!file.contents.includes(location.anchor)) invalid(`repository fact anchor is not present: ${location.path}`);
}

// plugins/dev-flow/src/policy/governance-records.ts
var EMPTY_GOVERNANCE_LEDGER = Object.freeze({
  decisions: [],
  claims: [],
  authorizations: [],
  credentials: [],
  repositoryFacts: []
});

// plugins/dev-flow/src/core/repository-facts.ts
function canonicalLocation(location) {
  if (location.kind === "positive") return JSON.stringify({ kind: "positive", path: location.path, anchor: location.anchor ?? null });
  return JSON.stringify({ kind: "negative", checkedScope: [...location.checkedScope].sort(), conditions: location.conditions });
}
function repositoryFactId(input) {
  return `FACT-${createHash4("sha256").update(`${input.assertion?.trim() ?? ""}
${input.location ? canonicalLocation(input.location) : JSON.stringify(input.observation)}`).digest("hex").slice(0, 16)}`;
}
function invalidFact(message) {
  return new DevFlowError("INVALID_REPOSITORY_FACT", message, {
    recoveryHint: "\u80AF\u5B9A\u4E8B\u5B9E\u63D0\u4F9B\u9879\u76EE\u76F8\u5BF9\u8DEF\u5F84\uFF08\u53EF\u542B\u7B26\u53F7\u951A\u70B9\uFF09\uFF1B\u5426\u5B9A\u4E8B\u5B9E\u63D0\u4F9B\u68C0\u67E5\u8303\u56F4\u4E0E\u53EF\u91CD\u590D\u7684\u68C0\u67E5\u6761\u4EF6",
    retryOriginal: true
  });
}
function normalizeFactLocation(location, governedRoots) {
  const inside = (file) => {
    const normalized = normalizeUnicode(file).replaceAll("\\", "/");
    const clean = normalizeProjectPath(normalized);
    if (!clean || isAbsoluteProjectPath(clean) || clean.startsWith("../") || clean === ".." || clean.startsWith(".dev-flow/") || clean === ".dev-flow" || clean.startsWith(".git/") || clean === ".git") {
      return false;
    }
    return governedRoots.some((root2) => root2 === "." || clean === root2 || clean.startsWith(`${root2}/`));
  };
  if (location.kind === "positive") {
    if (!location.path.trim() || !inside(location.path)) throw invalidFact("positive fact must point to a readable project-relative governed path");
    return { kind: "positive", path: normalizeProjectPath(normalizeUnicode(location.path).replaceAll("\\", "/")), ...location.anchor?.trim() ? { anchor: location.anchor.trim() } : {} };
  }
  const scope = [...new Set(location.checkedScope.map((entry) => normalizeProjectPath(normalizeUnicode(entry).replaceAll("\\", "/"))).filter((entry) => entry && inside(entry)))].sort();
  const conditions = location.conditions.trim();
  if (scope.length === 0) throw invalidFact("negative fact must record a non-empty checked scope inside governed roots");
  if (!conditions) throw invalidFact("negative fact must record repeatable check conditions");
  return { kind: "negative", checkedScope: scope, conditions };
}
function normalizeRepositoryObservation(observation, governedRoots) {
  const inside = (file) => {
    const normalized = normalizeUnicode(file).replaceAll("\\", "/");
    const clean = normalizeProjectPath(normalized);
    if (!clean || isAbsoluteProjectPath(clean) || clean.startsWith("../") || clean === ".." || clean.startsWith(".dev-flow/") || clean === ".dev-flow" || clean.startsWith(".git/") || clean === ".git" || clean === "node_modules" || clean.startsWith("node_modules/")) return false;
    return governedRoots.some((root2) => root2 === "." || clean === root2 || clean.startsWith(`${root2}/`));
  };
  const pathValue = "path" in observation ? normalizeProjectPath(normalizeUnicode(observation.path).replaceAll("\\", "/")) : void 0;
  if (pathValue !== void 0 && !inside(pathValue)) throw invalidFact("repository observation path must be inside a governed root");
  if (observation.kind === "file-exists") return { kind: observation.kind, path: pathValue };
  if (observation.kind === "text-present") {
    if (!observation.text.trim()) throw invalidFact("text-present observation requires non-empty text");
    if (observation.occurrence !== void 0 && (!Number.isInteger(observation.occurrence) || observation.occurrence < 1)) throw invalidFact("text-present occurrence must be a positive integer");
    return { kind: observation.kind, path: pathValue, text: observation.text, ...observation.occurrence === void 0 ? {} : { occurrence: observation.occurrence } };
  }
  if (observation.kind === "symbol-present") {
    if (!observation.symbol.trim()) throw invalidFact("symbol-present observation requires a non-empty symbol");
    return { kind: observation.kind, path: pathValue, symbol: observation.symbol };
  }
  if (observation.kind === "json-value") {
    if (!observation.pointer.startsWith("/")) throw invalidFact("json-value observation pointer must start with /");
    return { kind: observation.kind, path: pathValue, pointer: observation.pointer, expected: observation.expected };
  }
  if (!observation.pattern.trim() || observation.patternKind !== "literal" && observation.patternKind !== "regex") throw invalidFact("search-absent observation requires a pattern and patternKind");
  const scope = [...new Set(observation.checkedScope.map((entry) => normalizeProjectPath(normalizeUnicode(entry).replaceAll("\\", "/"))).filter((entry) => entry && inside(entry)))].sort();
  if (!scope.length) throw invalidFact("search-absent observation requires a non-empty governed scope");
  return { kind: observation.kind, checkedScope: scope, pattern: observation.pattern, patternKind: observation.patternKind };
}
async function computeFactFingerprint(root2, fact) {
  const location = "location" in fact ? fact.location : fact;
  return computeLocationFingerprint(root2, location);
}
async function assertRepositoryFactCurrent(root2, fact) {
  if (fact.observation) {
    const observation = await executeRepositoryObservation(root2, fact.observation);
    if (!observation.confirmed) throw new DevFlowError("BOUNDARY_FACT_UNCONFIRMED", `repository fact ${fact.recordId} no longer satisfies its observation`, { recordId: fact.recordId, recoveryHint: "\u91CD\u65B0\u767B\u8BB0\u5F53\u524D\u89C2\u5BDF\u6216\u4FEE\u6B63\u5206\u7C7B\u4F9D\u636E\u3002" });
    if (observation.observedFingerprint !== fact.observedFingerprint) throw new DevFlowError("BOUNDARY_FACT_STALE", `repository fact ${fact.recordId} refers to changed content`, { recordId: fact.recordId, recoveryHint: "\u91CD\u65B0\u767B\u8BB0\u8BE5\u4ED3\u5E93\u4E8B\u5B9E\u4EE5\u53CD\u6620\u5F53\u524D\u5185\u5BB9\u3002" });
    return;
  }
  const current = await computeFactFingerprint(root2, fact);
  if (fact.location.kind === "positive") await assertPositiveAnchor(root2, fact.location);
  if (current !== fact.observedFingerprint) {
    throw new DevFlowError("BOUNDARY_FACT_STALE", `repository fact ${fact.recordId} refers to changed content`, {
      recordId: fact.recordId,
      assertion: fact.assertion,
      recoveryHint: "\u91CD\u65B0\u767B\u8BB0\u8BE5\u4ED3\u5E93\u4E8B\u5B9E\u4EE5\u53CD\u6620\u5F53\u524D\u5185\u5BB9\uFF1B\u4E0D\u76F8\u5173\u5185\u5BB9\u53D8\u5316\u4E0D\u4F1A\u4F7F\u4E8B\u5B9E\u5931\u6548",
      retryOriginal: true
    });
  }
}
function repositoryFactRecord(input, observedFingerprint, recordedAt) {
  return {
    recordId: repositoryFactId(input),
    kind: "repository-fact",
    assertion: input.assertion.trim(),
    location: input.location,
    ...input.observation ? { observation: input.observation } : {},
    observedFingerprint,
    recordedAt
  };
}
var MAX_REPOSITORY_FACT_BATCH = 50;
async function normalizeRepositoryFact(root2, input, config) {
  const observation = input.observation ? normalizeRepositoryObservation(input.observation, config.governedRoots) : void 0;
  const location = input.location ? normalizeFactLocation(input.location, config.governedRoots) : observation?.kind === "search-absent" ? { kind: "negative", checkedScope: observation.checkedScope, conditions: `${observation.patternKind}:${observation.pattern}` } : observation && "path" in observation ? { kind: "positive", path: observation.path, ...observation.kind === "text-present" ? { anchor: observation.text } : observation.kind === "symbol-present" ? { anchor: observation.symbol } : {} } : void 0;
  if (!location) throw new DevFlowError("INVALID_REPOSITORY_FACT", "repository fact requires a structured location or observation");
  const assertion = input.assertion?.trim() || (observation ? `observation:${observation.kind}` : "");
  const normalized = { assertion, location, ...observation ? { observation } : {} };
  if (!normalized.assertion) throw new DevFlowError("INVALID_REPOSITORY_FACT", "repository fact assertion must not be empty");
  const observationResult = observation ? await executeRepositoryObservation(root2, observation) : void 0;
  const observedFingerprint = observationResult ? observationResult.observedFingerprint : await computeFactFingerprint(root2, { ...normalized, location });
  if (observationResult && !observationResult.confirmed) throw new DevFlowError("BOUNDARY_FACT_UNCONFIRMED", "repository observation is not satisfied", { summary: observationResult.summary, recoveryHint: "\u4FEE\u6B63\u89C2\u5BDF\u5B9A\u4E49\u6216\u5148\u4FEE\u6B63\u4ED3\u5E93\u540E\u91CD\u8BD5\u3002" });
  return repositoryFactRecord(normalized, observedFingerprint, (/* @__PURE__ */ new Date()).toISOString());
}
function applyRepositoryFacts(draft, records, host) {
  const ledger = draft.governance ?? EMPTY_GOVERNANCE_LEDGER;
  const facts = [...ledger.repositoryFacts];
  const created = [];
  const existing = [];
  for (const record of records) {
    if (facts.some((item) => item.recordId === record.recordId)) existing.push(record.recordId);
    else {
      facts.push(record);
      created.push(record.recordId);
    }
  }
  draft.governance = { ...ledger, repositoryFacts: facts };
  draft.lastUpdatedBy = { host, pluginVersion: "5.1.0" };
  return { created, existing };
}
async function registerRepositoryFact(root2, id, expectedRevision, input, host) {
  const initial = await readState(root2, id);
  if (initial.revision !== expectedRevision) throw new DevFlowError("STATE_REVISION_CONFLICT", "state revision changed", { currentRevision: initial.revision });
  const config = await readProjectConfig(root2);
  const record = await normalizeRepositoryFact(root2, input, config);
  const state = await mutate(root2, id, expectedRevision, "repository-fact-recorded", (draft) => {
    applyRepositoryFacts(draft, [record], host);
  });
  return { state, recordId: record.recordId };
}
async function registerRepositoryFacts(root2, id, expectedRevision, inputs, host) {
  if (!inputs.length) throw new DevFlowError("INVALID_REPOSITORY_FACT", "repository fact batch must not be empty");
  if (inputs.length > MAX_REPOSITORY_FACT_BATCH) {
    throw new DevFlowError("INVALID_REPOSITORY_FACT", `repository fact batch cannot exceed ${MAX_REPOSITORY_FACT_BATCH} items`, { limit: MAX_REPOSITORY_FACT_BATCH });
  }
  const initial = await readState(root2, id);
  if (initial.revision !== expectedRevision) throw new DevFlowError("STATE_REVISION_CONFLICT", "state revision changed", { currentRevision: initial.revision });
  const config = await readProjectConfig(root2);
  const records = await Promise.all(inputs.map((input) => normalizeRepositoryFact(root2, input, config)));
  let created = [];
  let existing = [];
  const state = await mutate(root2, id, expectedRevision, "repository-facts-recorded", (draft) => {
    const applied = applyRepositoryFacts(draft, records, host);
    created = applied.created;
    existing = applied.existing;
  });
  return { state, recordIds: records.map((record) => record.recordId), created, existing };
}

// plugins/dev-flow/src/core/fingerprint.ts
import { execFile as execFile3 } from "node:child_process";
import { createHash as createHash5 } from "node:crypto";
import { readdir as readdir2, readFile as readFile2, readlink, realpath, lstat as lstat2 } from "node:fs/promises";
import path4 from "node:path";
import { promisify as promisify3 } from "node:util";

// plugins/dev-flow/src/policy/rollback.ts
function reopenImplementationUnit(unit) {
  if (unit.status === "pending") return;
  unit.status = "pending";
  delete unit.startedFingerprint;
  delete unit.beginNonce;
  delete unit.checkpointId;
}
var IMPLEMENTATION_UNIT_TRANSITIONS = Object.freeze({
  pending: Object.freeze(["active"]),
  active: Object.freeze(["verified"]),
  verified: Object.freeze(["checkpointed", "active"]),
  checkpointed: Object.freeze(["rolled_back"]),
  rolled_back: Object.freeze(["active"])
});
var fileChanges = ["added", "modified", "deleted", "renamed", "mode-changed"];
var IMPLEMENTATION_UNIT_ID = /^UNIT-[0-9]{3,}$/;
var SHA256 = /^[0-9a-f]{64}$/;
var FILE_MODE = /^[0-7]{3,4}$/;
function pathWithinFileScope(path25, fileScope) {
  return fileScope.some((pattern) => scopePatternMatches(pattern.normalize("NFC"), path25.normalize("NFC")));
}
function isSafeFileScopePattern(value) {
  if (typeof value !== "string" || !value || value.trim() !== value) return false;
  if (value.includes("\\") || value.startsWith("/") || /^[A-Za-z]:/.test(value)) return false;
  if (value === ".") return true;
  return value.split("/").every((segment) => segment.length > 0 && segment !== "." && segment !== "..");
}
function scopePatternMatches(pattern, target) {
  if (!isSafeFileScopePattern(pattern) || typeof target !== "string" || !target.trim()) return false;
  if (target.includes("\\") || target.startsWith("/")) return false;
  const segments = pattern.split("/");
  const parts = target.split("/");
  if (parts.some((part) => part === "..")) return false;
  if (/[*?]/.test(pattern)) return globSegmentsMatch(segments, parts);
  if (pattern === ".") return true;
  return target === pattern || target.startsWith(`${pattern}/`);
}
function globSegmentsMatch(pattern, target) {
  if (pattern.length === 0) return target.length === 0;
  const [head2, ...rest] = pattern;
  if (head2 === "**") {
    if (rest.length === 0) return true;
    for (let skip = 0; skip <= target.length; skip += 1) {
      if (globSegmentsMatch(rest, target.slice(skip))) return true;
    }
    return false;
  }
  if (target.length === 0 || !globSegmentMatches(head2, target[0])) return false;
  return globSegmentsMatch(rest, target.slice(1));
}
function globSegmentMatches(pattern, segment) {
  if (pattern === "") return segment === "";
  const [head2, ...rest] = pattern;
  if (head2 === "*") {
    for (let take = 0; take <= segment.length; take += 1) {
      if (globSegmentMatches(rest.join(""), segment.slice(take))) return true;
    }
    return false;
  }
  if (head2 === "?") return segment.length > 0 && globSegmentMatches(rest.join(""), segment.slice(1));
  return segment.startsWith(head2) && globSegmentMatches(rest.join(""), segment.slice(head2.length));
}
var RollbackProtocolError = class extends Error {
  constructor(code, message) {
    super(`${code}: ${message}`);
    this.code = code;
  }
};
function invalid2(message, code = "ROLLBACK_PROTOCOL_INVALID") {
  throw new RollbackProtocolError(code, message);
}
function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function isImplementationUnitId(value) {
  return typeof value === "string" && IMPLEMENTATION_UNIT_ID.test(value);
}
function isSha256(value) {
  return typeof value === "string" && SHA256.test(value);
}
function isTimestamp(value) {
  return typeof value === "string" && !Number.isNaN(Date.parse(value));
}
function isNonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}
function isNonEmptyStringArray(value) {
  return Array.isArray(value) && value.length > 0 && value.every(isNonEmptyString);
}
function isVerificationCommandArray(value) {
  return Array.isArray(value) && value.length > 0 && value.every((item) => {
    if (isNonEmptyString(item)) return true;
    if (!isRecord(item) || typeof item.command !== "string" || !item.command.trim() || item.args !== void 0 && (!Array.isArray(item.args) || item.args.some((arg) => typeof arg !== "string")) || item.cwd !== void 0 && (typeof item.cwd !== "string" || !item.cwd || item.cwd.startsWith("/") || item.cwd.split(/[\\/]+/).includes(".."))) return false;
    return true;
  });
}
function hasOnlyKeys(value, keys) {
  return Object.keys(value).every((key) => keys.includes(key));
}
function implementationUnitForNode(node, basisHash2) {
  if (!isRecord(node) || node.kind !== "implementation-unit" || !isImplementationUnitId(node.id) || !isNonEmptyStringArray(node.tasks) || !isNonEmptyStringArray(node.fileScope) || !isVerificationCommandArray(node.forwardVerification) || node.status !== "current") {
    invalid2("implementation unit node is missing fields required to open an implementation unit");
  }
  if (!isSha256(basisHash2)) invalid2("implementation unit basis hash must be a SHA-256 hex digest");
  return { unitId: node.id, status: "pending", basisHash: basisHash2 };
}
function parseFileRecord(value, index) {
  if (!isRecord(value) || !hasOnlyKeys(value, ["path", "change", "renamedFrom", "beforeSha256", "afterSha256", "beforeBlobSha256", "afterBlobSha256", "beforeMode", "afterMode", "beforeKind", "afterKind"]) || !isNonEmptyString(value.path) || typeof value.change !== "string" || !fileChanges.includes(value.change)) {
    invalid2(`checkpoint file record ${index} has an invalid shape`);
  }
  const label = `checkpoint file record ${index}`;
  const change = value.change;
  const beforeOk = change !== "added" ? isSha256(value.beforeSha256) && isSha256(value.beforeBlobSha256) && typeof value.beforeMode === "string" && FILE_MODE.test(value.beforeMode) && (value.beforeKind === "file" || value.beforeKind === "symlink") : value.beforeSha256 === void 0 && value.beforeBlobSha256 === void 0 && value.beforeMode === void 0;
  const afterOk = change !== "deleted" ? isSha256(value.afterSha256) && isSha256(value.afterBlobSha256) && typeof value.afterMode === "string" && FILE_MODE.test(value.afterMode) && (value.afterKind === "file" || value.afterKind === "symlink") : value.afterSha256 === void 0 && value.afterBlobSha256 === void 0 && value.afterMode === void 0;
  if (!beforeOk) invalid2(`${label} has invalid before fields for change ${change}`);
  if (!afterOk) invalid2(`${label} has invalid after fields for change ${change}`);
  if (change === "renamed" && !isNonEmptyString(value.renamedFrom)) invalid2(`${label} renamed record requires renamedFrom`);
  if (change !== "renamed" && value.renamedFrom !== void 0) invalid2(`${label} only renamed records may carry renamedFrom`);
  return {
    path: value.path,
    change,
    ...value.renamedFrom !== void 0 ? { renamedFrom: value.renamedFrom } : {},
    ...change !== "added" ? { beforeSha256: value.beforeSha256, beforeBlobSha256: value.beforeBlobSha256, beforeMode: value.beforeMode, beforeKind: value.beforeKind } : {},
    ...change !== "deleted" ? { afterSha256: value.afterSha256, afterBlobSha256: value.afterBlobSha256, afterMode: value.afterMode, afterKind: value.afterKind } : {}
  };
}
function parseVerificationAttempt(value, index) {
  if (!isRecord(value) || !hasOnlyKeys(value, ["attemptId", "commandId", "command", "status", "startedAt", "completedAt", "phase", "cwd", "outputTail"]) || !isNonEmptyString(value.attemptId) || !isNonEmptyString(value.commandId) || !isNonEmptyString(value.command) || value.status !== "passed" && value.status !== "failed" || !isTimestamp(value.startedAt) || !isTimestamp(value.completedAt)) {
    invalid2(`checkpoint verification attempt ${index} has an invalid shape`);
  }
  if (value.phase !== void 0 && value.phase !== "preflight" && value.phase !== "forward" || value.cwd !== void 0 && !isNonEmptyString(value.cwd) || value.outputTail !== void 0 && typeof value.outputTail !== "string") {
    invalid2(`checkpoint verification attempt ${index} has invalid diagnostics`);
  }
  return {
    attemptId: value.attemptId,
    commandId: value.commandId,
    command: value.command,
    status: value.status,
    startedAt: value.startedAt,
    completedAt: value.completedAt,
    ...value.phase !== void 0 ? { phase: value.phase } : {},
    ...value.cwd !== void 0 ? { cwd: value.cwd } : {},
    ...value.outputTail !== void 0 ? { outputTail: value.outputTail } : {}
  };
}
function parseCheckpointManifest(value) {
  if (isRecord(value) && value.schemaVersion === 1) {
    invalid2("Dev Flow 4.x checkpoint manifest schema v1 is not supported by 5.0", "UNSUPPORTED_CHECKPOINT_SCHEMA");
  }
  if (!isRecord(value) || !hasOnlyKeys(value, ["schemaVersion", "checkpointId", "unitId", "sequence", "basisHash", "startedFingerprint", "completedFingerprint", "startedAt", "completedAt", "files", "forwardPatchSha256", "reversePatchSha256", "verificationAttempts", "requirementsSha256", "planSha256", "traceabilitySha256", "approvalBasisHash", "projectConfigSha256", "verificationCommands", "verificationCommandHashes", "beginNonce"]) || value.schemaVersion !== 2 || !isNonEmptyString(value.checkpointId) || !isImplementationUnitId(value.unitId) || typeof value.sequence !== "number" || !Number.isInteger(value.sequence) || value.sequence < 1 || !isSha256(value.basisHash) || !isSha256(value.startedFingerprint) || !isSha256(value.completedFingerprint) || value.beginNonce !== void 0 && !isNonEmptyString(value.beginNonce) || !isTimestamp(value.startedAt) || !isTimestamp(value.completedAt) || !Array.isArray(value.files) || !isSha256(value.forwardPatchSha256) || !isSha256(value.reversePatchSha256) || !Array.isArray(value.verificationAttempts) || value.requirementsSha256 !== "" && !isSha256(value.requirementsSha256) || value.planSha256 !== "" && !isSha256(value.planSha256) || value.traceabilitySha256 !== "" && !isSha256(value.traceabilitySha256) || !isSha256(value.approvalBasisHash) || !isSha256(value.projectConfigSha256) || !Array.isArray(value.verificationCommands)) {
    invalid2("checkpoint manifest has an invalid shape");
  }
  const files = value.files.map((file, index) => parseFileRecord(file, index));
  const verificationAttempts = value.verificationAttempts.map((attempt, index) => parseVerificationAttempt(attempt, index));
  const verificationCommands = value.verificationCommands.map((command2, index) => {
    if (!isRecord(command2) || !hasOnlyKeys(command2, ["commandId", "command"]) || !isNonEmptyString(command2.commandId) || !isNonEmptyString(command2.command)) {
      invalid2(`checkpoint verification command ${index} has an invalid shape`);
    }
    return { commandId: command2.commandId, command: command2.command };
  });
  const declaredCommandIds = new Set(verificationCommands.map((command2) => command2.commandId));
  if (value.verificationCommandHashes !== void 0 && (!isRecord(value.verificationCommandHashes) || Object.entries(value.verificationCommandHashes).some(([id, hash2]) => !declaredCommandIds.has(id) || !isSha256(hash2)))) {
    invalid2("checkpoint verification command hashes have an invalid shape");
  }
  for (const attempt of verificationAttempts) {
    if (!declaredCommandIds.has(attempt.commandId)) {
      invalid2(`checkpoint verification attempt ${attempt.attemptId} references undeclared command ${attempt.commandId}`);
    }
  }
  return {
    schemaVersion: 2,
    checkpointId: value.checkpointId,
    unitId: value.unitId,
    sequence: value.sequence,
    basisHash: value.basisHash,
    startedFingerprint: value.startedFingerprint,
    completedFingerprint: value.completedFingerprint,
    startedAt: value.startedAt,
    completedAt: value.completedAt,
    files,
    forwardPatchSha256: value.forwardPatchSha256,
    reversePatchSha256: value.reversePatchSha256,
    verificationAttempts,
    requirementsSha256: value.requirementsSha256,
    planSha256: value.planSha256,
    traceabilitySha256: value.traceabilitySha256,
    approvalBasisHash: value.approvalBasisHash,
    projectConfigSha256: value.projectConfigSha256,
    verificationCommands,
    ...value.verificationCommandHashes !== void 0 ? { verificationCommandHashes: Object.fromEntries(Object.entries(value.verificationCommandHashes).map(([id, hash2]) => [id, hash2])) } : {},
    ...typeof value.beginNonce === "string" ? { beginNonce: value.beginNonce } : {}
  };
}

// plugins/dev-flow/src/core/fingerprint.ts
var runFile = promisify3(execFile3);
var ignored = /* @__PURE__ */ new Set([".git", ".dev-flow", "node_modules"]);
function controlPath(relative) {
  return relative === ".git" || relative.startsWith(".git/") || relative === ".dev-flow" || relative.startsWith(".dev-flow/") || relative === "node_modules" || relative.startsWith("node_modules/");
}
function configFor(input) {
  return Array.isArray(input) ? { governedRoots: input } : input;
}
async function collect(root2, relative, files, excludes) {
  const absolute = path4.join(root2, relative);
  let entries;
  try {
    entries = await readdir2(absolute, { withFileTypes: true });
  } catch (error) {
    if (error.code === "ENOENT") return;
    throw error;
  }
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    if (ignored.has(entry.name)) continue;
    const child = normalizeProjectPath(path4.join(relative, entry.name));
    if (excludes?.some((pattern) => pathWithinFileScope(child, [pattern]))) continue;
    const target = path4.join(root2, child);
    const metadata = await lstat2(target);
    if (metadata.isSymbolicLink()) throw new DevFlowError("UNSAFE_PROTECTED_ROOT", `symbolic link is not allowed: ${child}`);
    if (metadata.isDirectory()) await collect(root2, child, files, excludes);
    else if (metadata.isFile()) files.push(child);
  }
}
async function hasGitMetadata(root2) {
  let current = path4.resolve(root2);
  while (true) {
    try {
      await lstat2(path4.join(current, ".git"));
      return true;
    } catch (error) {
      if (error.code !== "ENOENT") return true;
    }
    const parent = path4.dirname(current);
    if (parent === current) return false;
    current = parent;
  }
}
async function gitOutput(root2, args) {
  try {
    const result = await runFile("git", args, { cwd: root2, encoding: "utf8", maxBuffer: 8 * 1024 * 1024 });
    return String(result.stdout);
  } catch (error) {
    throw new DevFlowError("PROTECTED_ROOT_ENUMERATION_FAILED", "Git \u65E0\u6CD5\u679A\u4E3E governed roots\u3002", {
      command: ["git", ...args].join(" "),
      cause: error instanceof Error ? error.message : String(error)
    });
  }
}
async function gitFiles(root2, governedRoots) {
  const hasMetadata = await hasGitMetadata(root2);
  let insideWorktree = false;
  try {
    insideWorktree = (await gitOutput(root2, ["rev-parse", "--is-inside-work-tree"])).trim() === "true";
  } catch (error) {
    if (!hasMetadata) return void 0;
    throw error;
  }
  if (!insideWorktree) return void 0;
  const output = await gitOutput(root2, ["ls-files", "--cached", "--others", "--exclude-standard", "-z", "--", ...governedRoots]);
  return output.split("\0").filter(Boolean).map(normalizeProjectPath);
}
async function gitTrackedFiles(root2, governedRoots) {
  const output = await gitOutput(root2, ["ls-files", "--cached", "-z", "--", ...governedRoots]);
  return new Set(output.split("\0").filter(Boolean).map(normalizeProjectPath));
}
function withinConfiguredRoot(file, governedRoots) {
  return governedRoots.some((root2) => root2 === "." || file === root2 || file.startsWith(`${root2}/`));
}
function applyExcludes(files, excludes) {
  return files.filter((file) => !excludes?.some((pattern) => pathWithinFileScope(file, [pattern])));
}
async function assertGovernedRootsSafe(root2, governedRoots) {
  for (const relative of governedRoots) {
    try {
      const metadata = await lstat2(path4.join(root2, relative));
      if (metadata.isSymbolicLink()) throw new DevFlowError("UNSAFE_PROTECTED_ROOT", `symbolic link is not allowed: ${relative}`);
    } catch (error) {
      if (error instanceof DevFlowError) throw error;
      if (error.code !== "ENOENT") throw error;
    }
  }
}
async function enumerateProtectedFiles(root2, input) {
  const config = configFor(input);
  const governedRoots = [...new Set(config.governedRoots.map(normalizeProjectPath))].sort();
  const fromGit = await gitFiles(root2, governedRoots);
  if (!fromGit) {
    const rootsToValidate = governedRoots.filter((entry) => !config.governedRootsExclude?.some((pattern) => pathWithinFileScope(entry, [pattern])));
    await assertGovernedRootsSafe(root2, rootsToValidate);
  }
  const files = fromGit ?? (() => {
    const collected = [];
    return Promise.all(governedRoots.map((item) => collect(root2, item, collected, config.governedRootsExclude))).then(() => collected);
  })();
  const resolved = await files;
  const unique2 = applyExcludes([...new Set(resolved.map(normalizeProjectPath).filter((file) => !controlPath(file)).filter((file) => withinConfiguredRoot(file, governedRoots)))].sort(), config.governedRootsExclude);
  const tracked = fromGit ? await gitTrackedFiles(root2, governedRoots) : /* @__PURE__ */ new Set();
  for (const relative of unique2) {
    let metadata;
    try {
      metadata = await lstat2(path4.join(root2, relative));
    } catch (error) {
      if (error.code === "ENOENT") continue;
      throw error;
    }
    if (metadata.isSymbolicLink()) {
      if (!tracked.has(relative)) throw new DevFlowError("UNSAFE_GOVERNED_SYMLINK", `symlink must be Git-tracked: ${relative}`, { path: relative, recoveryHint: "\u8DDF\u8E2A\u8BE5\u4ED3\u5185\u94FE\u63A5\uFF0C\u6216\u5C06\u5176\u6392\u9664\u5728 governedRoots \u4E4B\u5916" });
      const resolvedTarget = await realpath(path4.join(root2, relative));
      const rootPath = await realpath(root2);
      const targetRelative = normalizeProjectPath(path4.relative(rootPath, resolvedTarget));
      if (!targetRelative || targetRelative === ".." || targetRelative.startsWith("../") || path4.isAbsolute(targetRelative) || targetRelative === ".git" || targetRelative.startsWith(".git/") || targetRelative === ".dev-flow" || targetRelative.startsWith(".dev-flow/")) {
        throw new DevFlowError("UNSAFE_GOVERNED_SYMLINK", `symlink target escapes governed safety boundary: ${relative}`, { path: relative, linkTarget: await readlink(path4.join(root2, relative)) });
      }
    }
  }
  const present = [];
  for (const relative of unique2) {
    try {
      await lstat2(path4.join(root2, relative));
      present.push(relative);
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
  }
  return present;
}
async function fingerprintGovernedRoots(root2, input) {
  const files = await enumerateProtectedFiles(root2, input);
  const digest13 = createHash5("sha256");
  for (const relative of files) {
    const absolute = path4.join(root2, relative);
    const metadata = await lstat2(absolute);
    digest13.update(relative);
    digest13.update("\0");
    if (metadata.isSymbolicLink()) {
      digest13.update("symlink\0");
      digest13.update(await readlink(absolute));
    } else {
      digest13.update("file\0");
      digest13.update(await readFile2(absolute));
    }
    digest13.update("\0");
  }
  return digest13.digest("hex");
}
async function fingerprintFeatureOwned(root2, input, ownership) {
  const files = (await enumerateProtectedFiles(root2, input)).filter((file) => ownership[file] === "feature");
  const digest13 = createHash5("sha256");
  for (const relative of files) {
    const absolute = path4.join(root2, relative);
    const metadata = await lstat2(absolute);
    digest13.update(relative);
    digest13.update("\0");
    if (metadata.isSymbolicLink()) {
      digest13.update("symlink\0");
      digest13.update(await readlink(absolute));
    } else {
      digest13.update("file\0");
      digest13.update(await readFile2(absolute));
    }
    digest13.update("\0");
  }
  return digest13.digest("hex");
}
async function snapshotGovernedRoots(root2, input) {
  const files = await enumerateProtectedFiles(root2, input);
  const snapshots = [];
  for (const relative of files) {
    const absolute = path4.join(root2, relative);
    const metadata = await lstat2(absolute);
    const symbolic = metadata.isSymbolicLink();
    const bytes = symbolic ? Buffer.from(await readlink(absolute)) : await readFile2(absolute);
    snapshots.push({
      path: relative,
      sha256: createHash5("sha256").update(bytes).digest("hex"),
      mode: (metadata.mode & 511).toString(8).padStart(3, "0"),
      kind: symbolic ? "symlink" : "file",
      ...symbolic ? { linkTarget: bytes.toString("utf8") } : {}
    });
  }
  return snapshots;
}

// plugins/dev-flow/src/core/project-config.ts
import path5 from "node:path";
import { createHash as createHash6 } from "node:crypto";
function projectConfigImpact(previous, next) {
  const previousCommands = new Map(previous.verification.commands.map((command2) => [command2.id, command2]));
  const nextCommands = new Map(next.verification.commands.map((command2) => [command2.id, command2]));
  const addedCommandIds = [...nextCommands.keys()].filter((id) => !previousCommands.has(id)).sort();
  const removedCommandIds = [...previousCommands.keys()].filter((id) => !nextCommands.has(id)).sort();
  const modifiedCommandIds = [...nextCommands.keys()].filter((id) => previousCommands.has(id) && JSON.stringify({ ...previousCommands.get(id), provides: void 0 }) !== JSON.stringify({ ...nextCommands.get(id), provides: void 0 })).sort();
  const capabilityOnlyIds = [...nextCommands.keys()].filter((id) => previousCommands.has(id) && JSON.stringify({ ...previousCommands.get(id), provides: void 0 }) === JSON.stringify({ ...nextCommands.get(id), provides: void 0 }) && JSON.stringify(previousCommands.get(id)?.provides) !== JSON.stringify(nextCommands.get(id)?.provides));
  const changedCommandIds = [.../* @__PURE__ */ new Set([...addedCommandIds, ...removedCommandIds, ...modifiedCommandIds, ...capabilityOnlyIds])].sort();
  const governanceChanged = JSON.stringify({
    enforcement: previous.enforcement,
    governedRoots: previous.governedRoots,
    governedRootsExclude: previous.governedRootsExclude
  }) !== JSON.stringify({
    enforcement: next.enforcement,
    governedRoots: next.governedRoots,
    governedRootsExclude: next.governedRootsExclude
  });
  const preflightChanged = JSON.stringify(previous.verification.preflightCommands ?? []) !== JSON.stringify(next.verification.preflightCommands ?? []);
  return {
    changedCommandIds,
    addedCommandIds,
    removedCommandIds,
    modifiedCommandIds,
    capabilityOnlyCommandIds: capabilityOnlyIds.sort(),
    verificationCapabilityChanged: capabilityOnlyIds.length > 0 || addedCommandIds.length > 0 || removedCommandIds.length > 0,
    governanceChanged,
    preflightChanged
  };
}
function verificationCommandHashes(config) {
  return Object.fromEntries(config.verification.commands.map((command2) => [
    command2.id,
    // `provides` is a governance declaration, not executable command
    // identity. Expanding guarantees must not invalidate evidence that ran
    // the same command bytes with the same cwd/args.
    createHash6("sha256").update(JSON.stringify({ id: command2.id, command: command2.command, args: command2.args, cwd: command2.cwd })).digest("hex")
  ]));
}
function verificationCommandIdsForRefs(refs) {
  return [...new Set(refs.filter((ref) => typeof ref === "string"))].sort();
}
function verificationCommandHashesForRefs(config, refs) {
  const all = verificationCommandHashes(config);
  return Object.fromEntries(verificationCommandIdsForRefs(refs).filter((id) => all[id] !== void 0).map((id) => [id, all[id]]));
}
function verificationGuarantees(config) {
  const preflight = new Set(config.verification.preflightCommands ?? []);
  return new Set(config.verification.commands.filter((command2) => !preflight.has(command2.id)).flatMap((command2) => command2.provides));
}
function missingVerificationGuarantees(config, required) {
  const available = verificationGuarantees(config);
  return [...new Set(required)].filter((kind) => !available.has(kind));
}
function relativeDirectory(value) {
  return value.length > 0 && !path5.isAbsolute(value) && !value.split(/[\\/]+/).includes("..");
}
function normalizedRelativeDirectory(value) {
  if (!relativeDirectory(value)) return void 0;
  const normalized = normalizeProjectPath(value).replace(/\/+$/u, "");
  return normalized || ".";
}
function validateProjectConfig(value) {
  const config = value;
  if (value?.schemaVersion === 1) throw new DevFlowError("UNSUPPORTED_PROJECT_SCHEMA", "\u9879\u76EE\u4ECD\u4F7F\u7528 Dev Flow 4.x schema v1\u3002", {
    schemaVersion: 1,
    recoveryHint: "\u5148\u7528 4.x \u5B8C\u6210\u6216\u653E\u5F03 active feature\uFF0C\u5907\u4EFD .dev-flow\uFF0C\u518D\u4EE5 schema v2 \u91CD\u65B0\u521D\u59CB\u5316"
  });
  if (config?.schemaVersion !== 2 || config.enforcement?.mode !== "strict") throw new DevFlowError("INVALID_PROJECT_CONFIG", "only schema v2 strict configuration is supported");
  if (config.enforcement.gitWriteRequiresLogicComplete !== true || config.enforcement.oneActiveFeature !== true || config.enforcement.requireExplicitHumanReply !== true) {
    throw new DevFlowError("INVALID_PROJECT_CONFIG", "all strict enforcement controls must be enabled");
  }
  if (!Array.isArray(config.governedRoots) || !config.governedRoots.length) {
    throw new DevFlowError("INVALID_PROJECT_CONFIG", "governedRoots must contain project-relative files or directories outside .dev-flow");
  }
  const governedRoots = config.governedRoots.map(normalizedRelativeDirectory);
  if (governedRoots.some((root2) => !root2 || root2 === ".git" || root2.startsWith(".git/") || root2 === ".dev-flow" || root2.startsWith(".dev-flow/"))) {
    throw new DevFlowError("INVALID_PROJECT_CONFIG", "governedRoots must contain project-relative files or directories outside control paths");
  }
  config.governedRoots = governedRoots;
  if (config.governedRootsExclude !== void 0) {
    if (!Array.isArray(config.governedRootsExclude) || config.governedRootsExclude.some((pattern) => typeof pattern !== "string" || !relativeDirectory(pattern))) {
      throw new DevFlowError("INVALID_PROJECT_CONFIG", "governedRootsExclude must contain non-empty relative patterns without ..");
    }
    config.governedRootsExclude = config.governedRootsExclude.map((pattern) => normalizeProjectPath(pattern));
  }
  const commands = config.verification?.commands;
  if (!Array.isArray(commands) || !commands.length) throw new DevFlowError("INVALID_PROJECT_CONFIG", "at least one verification command is required");
  const ids = /* @__PURE__ */ new Set();
  for (const command2 of commands) {
    if (!command2?.id || !command2.command || !Array.isArray(command2.args) || !relativeDirectory(command2.cwd) || !Array.isArray(command2.provides) || command2.provides.length === 0 || command2.provides.some((kind) => !["targeted", "behavior", "integration", "full"].includes(kind))) {
      throw new DevFlowError("INVALID_PROJECT_CONFIG", "verification commands require valid provides guarantees");
    }
    if (command2.timeoutMs !== void 0 && (!Number.isInteger(command2.timeoutMs) || command2.timeoutMs < 1e3)) {
      throw new DevFlowError("INVALID_PROJECT_CONFIG", `verification command ${command2.id} timeoutMs must be an integer of at least 1000ms`);
    }
    if (command2.maxOutputBytes !== void 0 && (!Number.isInteger(command2.maxOutputBytes) || command2.maxOutputBytes < 1024)) {
      throw new DevFlowError("INVALID_PROJECT_CONFIG", `verification command ${command2.id} maxOutputBytes must be an integer of at least 1024 bytes`);
    }
    if (ids.has(command2.id)) throw new DevFlowError("INVALID_PROJECT_CONFIG", "verification command ids must be unique");
    ids.add(command2.id);
  }
  const preflightCommands = config.verification?.preflightCommands;
  if (preflightCommands !== void 0 && (!Array.isArray(preflightCommands) || preflightCommands.some((id) => typeof id !== "string" || !ids.has(id)))) {
    throw new DevFlowError("INVALID_PROJECT_CONFIG", "preflightCommands must reference configured command ids");
  }
  if (preflightCommands && config.verification) config.verification.preflightCommands = [...new Set(preflightCommands)];
  const missing = missingVerificationGuarantees(config, ["targeted"]);
  if (missing.length) {
    throw new DevFlowError("VERIFICATION_GUARANTEE_UNCONFIGURED", "\u9879\u76EE\u5FC5\u987B\u914D\u7F6E\u81F3\u5C11\u4E00\u4E2A\u975E preflight \u547D\u4EE4\u63D0\u4F9B targeted guarantee\u3002", {
      missingGuarantees: missing,
      userMessage: "\u9879\u76EE\u9A8C\u8BC1\u914D\u7F6E\u7F3A\u5C11\u6700\u7EC8\u9A8C\u8BC1\u6240\u9700\u7684 targeted guarantee\u3002",
      cause: "preflight \u547D\u4EE4\u53EA\u7528\u4E8E\u73AF\u5883\u51C6\u5907\u548C\u8BCA\u65AD\uFF0C\u4E0D\u80FD\u4F5C\u4E3A\u4E1A\u52A1\u9A8C\u8BC1\u8BC1\u636E\u3002",
      impact: "\u9879\u76EE\u65E0\u6CD5\u5B89\u5168\u521B\u5EFA\u4F1A\u8BDD\u6216\u9501\u5B9A\u8DEF\u7EBF\u3002",
      recoveryKind: "repair",
      recoveryInstruction: "\u8865\u5145\u4E00\u4E2A\u975E preflight \u9A8C\u8BC1\u547D\u4EE4\u5E76\u91CD\u65B0\u521D\u59CB\u5316\u9879\u76EE\u3002",
      retryOriginal: false
    });
  }
}

// plugins/dev-flow/src/core/traceability-store.ts
import { createHash as createHash7, randomUUID } from "node:crypto";
import { mkdir, open, readFile as readFile3, readdir as readdir3, rename } from "node:fs/promises";
import path6 from "node:path";

// plugins/dev-flow/src/core/traceability.ts
var ALLOWED_TRACE_KINDS = {
  requirements: ["requirement", "acceptance-criterion"],
  // The implementation plan is the single editable source for the execution
  // graph. Recovery is explicit and never implied by an implementation unit.
  "implementation-plan": ["task", "test", "implementation-unit", "recovery"],
  "coverage-matrix": ["test"],
  "rollback-units": ["rollback"]
};
var inputKeys = {
  requirement: ["kind", "id"],
  "acceptance-criterion": ["kind", "id", "parentRequirement", "verificationDisposition"],
  task: ["kind", "id", "covers", "implementationUnit", "tdd"],
  test: ["kind", "id", "verifies"],
  rollback: ["kind", "id", "tasks", "dependsOn", "fileScope", "covers", "forwardVerification", "rollbackVerification"],
  "implementation-unit": ["kind", "id", "tasks", "dependsOn", "fileScope", "covers", "forwardVerification"],
  recovery: ["kind", "id", "stepRef", "recoveryKind", "method", "riskRef"]
};
var idPrefix = {
  requirement: "REQ",
  "acceptance-criterion": "AC",
  task: "TASK",
  test: "TEST",
  "implementation-unit": "UNIT",
  rollback: "RU",
  recovery: "REC"
};
function invalid3(message, details = {}) {
  throw new DevFlowError("TRACE_GRAPH_INVALID", message, details);
}
function sliceError(code, message, details = {}) {
  throw new DevFlowError(code, message, details);
}
function isRecord2(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function isStringArray(value, allowEmpty = false) {
  return Array.isArray(value) && (allowEmpty || value.length > 0) && value.every((item) => typeof item === "string" && item.length > 0);
}
function isSafeCommandCwd(value) {
  return typeof value === "string" && value.length > 0 && !value.startsWith("/") && !/^[A-Za-z]:[\\/]/.test(value) && !value.split(/[\\/]+/).includes("..");
}
function isVerificationCommandRef(value) {
  if (typeof value === "string") return value.length > 0;
  if (!isRecord2(value) || Object.keys(value).some((key) => !["command", "args", "cwd"].includes(key)) || typeof value.command !== "string" || !value.command.trim() || value.args !== void 0 && (!Array.isArray(value.args) || value.args.some((arg) => typeof arg !== "string")) || value.cwd !== void 0 && !isSafeCommandCwd(value.cwd)) return false;
  return true;
}
function isVerificationCommandArray2(value) {
  return Array.isArray(value) && value.length > 0 && value.every(isVerificationCommandRef);
}
function verificationCommandKey(value) {
  return typeof value === "string" ? `id:${value}` : `inline:${JSON.stringify(value)}`;
}
function assertId(kind, id) {
  if (typeof id !== "string" || !new RegExp(`^${idPrefix[kind]}-[0-9]{3,}$`).test(id)) {
    invalid3("node ID does not match its kind", { kind, id });
  }
}
function assertNoDuplicate(values, field, id) {
  if (new Set(values).size !== values.length) invalid3("node relationship contains duplicates", { field, id });
}
function assertSafeFileScope(fileScope, id, persisted = false) {
  for (const pattern of fileScope) {
    if (persisted && pattern !== normalizeUnicode(pattern)) {
      invalid3("persisted rollback fileScope must use Unicode NFC", { id, field: "fileScope", pattern });
    }
    if (!isSafeFileScopePattern(pattern)) {
      invalid3(persisted ? "persisted rollback fileScope is unsafe" : "rollback fileScope is unsafe", { id, field: "fileScope", pattern });
    }
  }
}
var dispositionKinds = /* @__PURE__ */ new Set(["behavior-test", "type-check", "rule-check", "file-check", "human-acceptance"]);
function validateVerificationDisposition(value, id) {
  if (!isRecord2(value) || Object.keys(value).some((key) => !["kind", "reason", "target"].includes(key)) || typeof value.kind !== "string" || !dispositionKinds.has(value.kind)) {
    invalid3("acceptance-criterion verificationDisposition is invalid", { id });
  }
  if (value.kind !== "behavior-test") {
    if (typeof value.reason !== "string" || !value.reason.trim()) {
      invalid3("non-behavior verification disposition requires a non-empty reason", { id });
    }
    if (value.target !== void 0 && (typeof value.target !== "string" || !value.target.trim())) {
      invalid3("verification disposition target must be a non-empty string", { id });
    }
  } else if (value.reason !== void 0 && typeof value.reason !== "string") {
    invalid3("verification disposition reason must be a string", { id });
  }
}
function validateNodeInput(value) {
  if (!isRecord2(value) || typeof value.kind !== "string" || !(value.kind in inputKeys)) invalid3("node input has an unknown kind");
  const kind = value.kind;
  const keys = Object.keys(value);
  if (keys.some((key) => !inputKeys[kind].includes(key))) invalid3("node input contains Core-owned or unknown fields", { kind, keys });
  assertId(kind, value.id);
  if (kind === "acceptance-criterion") {
    assertId("requirement", value.parentRequirement);
    if (value.verificationDisposition !== void 0) validateVerificationDisposition(value.verificationDisposition, value.id);
  }
  if (kind === "task") {
    if (!isStringArray(value.covers)) invalid3("task covers must be a non-empty string array", { id: value.id });
    assertNoDuplicate(value.covers, "covers", value.id);
    assertId("implementation-unit", value.implementationUnit);
    if (value.tdd !== void 0 && value.tdd !== "test-first" && value.tdd !== "direct") {
      invalid3("task tdd must be test-first or direct", { id: value.id });
    }
  }
  if (kind === "test") {
    if (!isStringArray(value.verifies)) invalid3("test verifies must be a non-empty string array", { id: value.id });
    assertNoDuplicate(value.verifies, "verifies", value.id);
    for (const id of value.verifies) assertId("acceptance-criterion", id);
  }
  if (kind === "rollback") {
    const rollback = value;
    for (const [field, allowEmpty] of [["tasks", false], ["dependsOn", true], ["fileScope", false], ["covers", false], ["forwardVerification", false], ["rollbackVerification", false]]) {
      const relationship = field === "forwardVerification" || field === "rollbackVerification" ? value[field] : value[field];
      if (field === "forwardVerification" || field === "rollbackVerification") {
        if (!isVerificationCommandArray2(relationship)) invalid3("rollback verification must be a non-empty command array", { field, id: value.id });
        const keys2 = relationship.map(verificationCommandKey);
        assertNoDuplicate(keys2, field, value.id);
      } else {
        if (!isStringArray(relationship, allowEmpty)) invalid3("rollback relationship must be a string array", { field, id: value.id });
        assertNoDuplicate(relationship, field, value.id);
      }
    }
    for (const id of rollback.tasks) assertId("task", id);
    for (const id of rollback.dependsOn) assertId("rollback", id);
    assertSafeFileScope(rollback.fileScope, value.id);
  }
  if (kind === "implementation-unit") {
    const unit = value;
    for (const [field, allowEmpty] of [["tasks", false], ["dependsOn", true], ["fileScope", false], ["covers", false]]) {
      const relationship = unit[field];
      if (!isStringArray(relationship, allowEmpty)) invalid3("implementation unit relationship must be a string array", { field, id: value.id });
      assertNoDuplicate(relationship, field, value.id);
    }
    if (!isVerificationCommandArray2(unit.forwardVerification)) invalid3("implementation unit forwardVerification must be a non-empty command array", { id: value.id });
    assertNoDuplicate(unit.forwardVerification.map(verificationCommandKey), "forwardVerification", value.id);
    for (const id of unit.tasks) assertId("task", id);
    for (const id of unit.dependsOn) assertId("implementation-unit", id);
    assertSafeFileScope(unit.fileScope, value.id);
  }
  if (kind === "recovery") {
    const recovery = value;
    if (recovery.recoveryKind !== "rollback" && recovery.recoveryKind !== "compensation") {
      invalid3("recovery recoveryKind must be rollback or compensation", { id: value.id });
    }
    if (typeof recovery.method !== "string" || !recovery.method.trim()) {
      invalid3("recovery method must be a non-empty string", { id: value.id });
    }
    if (typeof recovery.riskRef !== "string" || !recovery.riskRef.trim()) {
      invalid3("recovery riskRef must be a non-empty string", { id: value.id });
    }
    if (typeof recovery.stepRef !== "string" || !/^(?:UNIT|TASK)-[0-9]{3,}$/.test(recovery.stepRef)) {
      invalid3("recovery stepRef must reference an implementation unit or task", { id: value.id, stepRef: recovery.stepRef });
    }
  }
}
function validateTraceDelta(value) {
  if (!isRecord2(value) || Object.keys(value).length !== 1 || !Array.isArray(value.nodes)) invalid3("Trace delta must contain only nodes");
  const ids = /* @__PURE__ */ new Set();
  for (const node of value.nodes) {
    validateNodeInput(node);
    if (ids.has(node.id)) invalid3("Trace delta declares an ID more than once", { id: node.id });
    ids.add(node.id);
  }
}
function normalizeTraceDelta(value) {
  return {
    nodes: value.nodes.map((node) => node.kind === "rollback" ? {
      ...node,
      fileScope: node.fileScope.map(normalizeUnicode),
      forwardVerification: node.forwardVerification.map(normalizeVerificationCommandRef),
      rollbackVerification: node.rollbackVerification.map(normalizeVerificationCommandRef)
    } : node)
  };
}
function normalizeVerificationCommandRef(value) {
  if (typeof value === "string") return value;
  return {
    command: value.command,
    ...value.args ? { args: [...value.args] } : {},
    ...value.cwd ? { cwd: normalizeProjectPath(value.cwd) } : {}
  };
}
function currentNodes(nodes) {
  return Object.values(nodes).filter((node) => node.status !== "tombstoned");
}
function nodeById(nodes, id) {
  const node = nodes[id];
  return node?.status === "tombstoned" ? void 0 : node;
}
function sourceFor(input, node, source) {
  const common = {
    sourceArtifact: input.artifactKind,
    sourceSha256: input.artifactSha256,
    sourceAnchor: source.sourceAnchor,
    sourceBlockSha256: source.sourceBlockSha256,
    status: "current"
  };
  switch (node.kind) {
    case "requirement":
      return { ...common, kind: node.kind, id: node.id };
    case "acceptance-criterion":
      return {
        ...common,
        kind: node.kind,
        id: node.id,
        parentRequirement: node.parentRequirement,
        ...node.verificationDisposition ? { verificationDisposition: { ...node.verificationDisposition } } : {}
      };
    case "task":
      return {
        ...common,
        kind: node.kind,
        id: node.id,
        covers: [...node.covers],
        implementationUnit: node.implementationUnit,
        ...node.tdd ? { tdd: node.tdd } : {}
      };
    case "test":
      return { ...common, kind: node.kind, id: node.id, verifies: [...node.verifies] };
    case "rollback":
      return {
        ...common,
        kind: node.kind,
        id: node.id,
        tasks: [...node.tasks],
        dependsOn: [...node.dependsOn],
        fileScope: [...node.fileScope],
        covers: [...node.covers],
        forwardVerification: node.forwardVerification.map(normalizeVerificationCommandRef),
        rollbackVerification: node.rollbackVerification.map(normalizeVerificationCommandRef),
        sourceArtifact: "rollback-units",
        verificationConfigSha256: input.projectConfigSha256
      };
    case "implementation-unit":
      return {
        ...common,
        kind: node.kind,
        id: node.id,
        tasks: [...node.tasks],
        dependsOn: [...node.dependsOn],
        fileScope: node.fileScope.map(normalizeUnicode),
        covers: [...node.covers],
        forwardVerification: node.forwardVerification.map(normalizeVerificationCommandRef),
        sourceArtifact: "implementation-plan",
        verificationConfigSha256: input.projectConfigSha256
      };
    case "recovery":
      return {
        ...common,
        kind: node.kind,
        id: node.id,
        stepRef: node.stepRef,
        recoveryKind: node.recoveryKind,
        method: node.method,
        riskRef: node.riskRef
      };
  }
}
function inputMeaning(node) {
  return JSON.stringify(node);
}
function nodeMeaning(node) {
  switch (node.kind) {
    case "requirement":
      return JSON.stringify({ kind: node.kind, id: node.id });
    case "acceptance-criterion":
      return JSON.stringify({ kind: node.kind, id: node.id, parentRequirement: node.parentRequirement, ...node.verificationDisposition ? { verificationDisposition: node.verificationDisposition } : {} });
    case "task":
      return JSON.stringify({ kind: node.kind, id: node.id, covers: node.covers, implementationUnit: node.implementationUnit, ...node.tdd ? { tdd: node.tdd } : {} });
    case "test":
      return JSON.stringify({ kind: node.kind, id: node.id, verifies: node.verifies });
    case "rollback":
      return JSON.stringify({ kind: node.kind, id: node.id, tasks: node.tasks, dependsOn: node.dependsOn, fileScope: node.fileScope, covers: node.covers, forwardVerification: node.forwardVerification, rollbackVerification: node.rollbackVerification });
    case "implementation-unit":
      return JSON.stringify({ kind: node.kind, id: node.id, tasks: node.tasks, dependsOn: node.dependsOn, fileScope: node.fileScope, covers: node.covers, forwardVerification: node.forwardVerification });
    case "recovery":
      return JSON.stringify({ kind: node.kind, id: node.id, stepRef: node.stepRef, recoveryKind: node.recoveryKind, method: node.method, riskRef: node.riskRef });
  }
}
function assertSourceBlocks(input) {
  const sourceBlocks = /* @__PURE__ */ new Map();
  for (const block of input.sourceBlocks) {
    if (!isRecord2(block) || typeof block.id !== "string" || typeof block.kind !== "string" || typeof block.sourceAnchor !== "string" || typeof block.sourceBlockSha256 !== "string") {
      invalid3("source block is invalid");
    }
    if (sourceBlocks.has(block.id)) invalid3("source block ID is declared more than once", { id: block.id });
    sourceBlocks.set(block.id, block);
  }
  const ids = new Set(input.delta.nodes.map((node) => node.id));
  if (ids.size !== sourceBlocks.size || [...ids].some((id) => !sourceBlocks.has(id))) invalid3("source blocks must exactly match delta nodes");
  for (const node of input.delta.nodes) {
    const source = sourceBlocks.get(node.id);
    if (source.kind !== node.kind) invalid3("source anchor kind does not match delta node", { id: node.id });
  }
  return sourceBlocks;
}
function assertArtifactDeltaContract(input) {
  const allowed = ALLOWED_TRACE_KINDS[input.artifactKind];
  if (input.delta.nodes.some((node) => !allowed.includes(node.kind))) invalid3("delta kind is not allowed for its artifact", { artifactKind: input.artifactKind });
  const has = (kind) => input.delta.nodes.some((node) => node.kind === kind);
  if (input.artifactKind === "implementation-plan" && input.route !== "xs" && (!has("task") || !has("implementation-unit"))) {
    invalid3("\u542F\u7528 Trace \u7684\u5B9E\u65BD\u8BA1\u5212\u5FC5\u987B\u540C\u65F6\u5305\u542B task \u548C implementation unit");
  }
  if (input.artifactKind === "rollback-units" && input.route !== "l") invalid3("\u72EC\u7ACB rollback-units \u5DE5\u4EF6\u53EA\u9002\u7528\u4E8E L \u7EA7\u8DEF\u7EBF");
  for (const node of input.delta.nodes) {
    if (node.kind !== "rollback" && node.kind !== "implementation-unit") continue;
    if (node.kind === "rollback" && !["rollback-units"].includes(input.artifactKind)) invalid3("rollback node has an invalid source artifact");
    if (node.kind === "implementation-unit" && input.artifactKind !== "implementation-plan") invalid3("implementation unit has an invalid source artifact");
    const verification2 = node.kind === "rollback" ? [...node.forwardVerification, ...node.rollbackVerification] : node.forwardVerification;
    if (verification2.some((ref) => typeof ref === "string" && !input.verificationCommandIds.includes(ref))) {
      invalid3("implementation verification references an unknown command ID", { id: node.id });
    }
  }
}
function deriveTraceEdges(nodes) {
  const edges = [];
  for (const node of currentNodes(nodes)) {
    if (node.kind === "acceptance-criterion") edges.push({ from: node.id, type: "parent", to: node.parentRequirement });
    if (node.kind === "task") {
      for (const target of node.covers) edges.push({ from: node.id, type: "covers", to: target });
      edges.push({ from: node.id, type: "implementation-unit", to: node.implementationUnit });
    }
    if (node.kind === "test") for (const target of node.verifies) edges.push({ from: node.id, type: "verifies", to: target });
    if (node.kind === "rollback") {
      for (const target of node.tasks) edges.push({ from: node.id, type: "contains-task", to: target });
      for (const target of node.dependsOn) edges.push({ from: node.id, type: "depends-on", to: target });
      for (const target of node.covers) edges.push({ from: node.id, type: "covers", to: target });
    }
    if (node.kind === "implementation-unit") {
      for (const target of node.tasks) edges.push({ from: node.id, type: "contains-task", to: target });
      for (const target of node.dependsOn) edges.push({ from: node.id, type: "depends-on", to: target });
      for (const target of node.covers) edges.push({ from: node.id, type: "covers", to: target });
    }
  }
  return edges.sort((a, b) => `${a.from}\0${a.type}\0${a.to}`.localeCompare(`${b.from}\0${b.type}\0${b.to}`));
}
function traceSummary(nodes) {
  const values = Object.values(nodes);
  return {
    total: values.length,
    current: values.filter((node) => node.status === "current").length,
    stale: values.filter((node) => node.status === "stale").length,
    tombstoned: values.filter((node) => node.status === "tombstoned").length
  };
}
function assertReference(nodes, id, kinds, details) {
  const node = nodeById(nodes, id);
  if (!node || !kinds.includes(node.kind)) invalid3("graph reference is missing or has the wrong kind", { id, ...details });
  return node;
}
function assertRollbackDag(nodes) {
  const visiting = /* @__PURE__ */ new Set();
  const visited = /* @__PURE__ */ new Set();
  const visit = (id) => {
    if (visited.has(id)) return;
    if (visiting.has(id)) invalid3("rollback dependency graph contains a cycle", { id });
    visiting.add(id);
    const node = nodeById(nodes, id);
    if (node?.kind === "rollback") for (const dependency of node.dependsOn) visit(dependency);
    visiting.delete(id);
    visited.add(id);
  };
  for (const node of currentNodes(nodes)) if (node.kind === "rollback") visit(node.id);
}
function assertImplementationDag(nodes) {
  const visiting = /* @__PURE__ */ new Set();
  const visited = /* @__PURE__ */ new Set();
  const visit = (id) => {
    if (visited.has(id)) return;
    if (visiting.has(id)) invalid3("implementation unit dependency graph contains a cycle", { id });
    visiting.add(id);
    const node = nodeById(nodes, id);
    if (node?.kind === "implementation-unit") for (const dependency of node.dependsOn) visit(dependency);
    visiting.delete(id);
    visited.add(id);
  };
  for (const node of currentNodes(nodes)) if (node.kind === "implementation-unit") visit(node.id);
}
function sameEdges(left, right) {
  return left.length === right.length && left.every((edge, index) => {
    const candidate = right[index];
    return edge.from === candidate?.from && edge.type === candidate.type && edge.to === candidate.to;
  });
}
function sameSummary(left, right) {
  return left.total === right.total && left.current === right.current && left.stale === right.stale && left.tombstoned === right.tombstoned;
}
var statusValues = /* @__PURE__ */ new Set(["current", "stale", "tombstoned"]);
var sourceArtifacts = /* @__PURE__ */ new Set(["requirements", "implementation-plan", "coverage-matrix", "rollback-units"]);
var hex64 = /^[a-f0-9]{64}$/;
function assertPersistedNode(recordId, value, options) {
  if (!isRecord2(value)) invalid3("persisted node is not an object", { id: recordId });
  const kind = value.kind;
  if (typeof kind !== "string" || !(kind in idPrefix)) invalid3("persisted node has an unknown kind", { id: recordId, kind });
  assertId(kind, value.id);
  if (value.id !== recordId) invalid3("persisted node id does not match its record key", { id: recordId, nodeId: value.id });
  if (!statusValues.has(value.status)) invalid3("persisted node has an invalid status", { id: recordId, status: value.status });
  if (typeof value.sourceArtifact !== "string" || !sourceArtifacts.has(value.sourceArtifact)) {
    invalid3("persisted node has an invalid sourceArtifact", { id: recordId, sourceArtifact: value.sourceArtifact });
  }
  if (typeof value.sourceSha256 !== "string" || !hex64.test(value.sourceSha256)) {
    invalid3("persisted node has an invalid sourceSha256", { id: recordId });
  }
  if (typeof value.sourceAnchor !== "string" || !value.sourceAnchor.includes(`id=${value.id}`)) {
    invalid3("persisted node has an invalid sourceAnchor", { id: recordId });
  }
  if (typeof value.sourceBlockSha256 !== "string" || !hex64.test(value.sourceBlockSha256)) {
    invalid3("persisted node has an invalid sourceBlockSha256", { id: recordId });
  }
  if (kind === "acceptance-criterion") {
    assertId("requirement", value.parentRequirement);
    if (value.verificationDisposition !== void 0) validateVerificationDisposition(value.verificationDisposition, recordId);
  }
  if (kind === "task") {
    if (!isStringArray(value.covers)) invalid3("persisted task covers is invalid", { id: recordId });
    assertId("implementation-unit", value.implementationUnit);
    if (value.tdd !== void 0 && value.tdd !== "test-first" && value.tdd !== "direct") {
      invalid3("persisted task tdd is invalid", { id: recordId });
    }
  }
  if (kind === "test") {
    if (!isStringArray(value.verifies)) invalid3("persisted test verifies is invalid", { id: recordId });
  }
  if (kind === "recovery") {
    if (typeof value.stepRef !== "string" || !/^(?:UNIT|TASK)-[0-9]{3,}$/.test(value.stepRef)) invalid3("persisted recovery stepRef is invalid", { id: recordId });
    if (value.recoveryKind !== "rollback" && value.recoveryKind !== "compensation") invalid3("persisted recovery recoveryKind is invalid", { id: recordId });
    if (typeof value.method !== "string" || !value.method.trim()) invalid3("persisted recovery method is invalid", { id: recordId });
    if (typeof value.riskRef !== "string" || !value.riskRef.trim()) invalid3("persisted recovery riskRef is invalid", { id: recordId });
  }
  if (kind === "rollback") {
    for (const [field, allowEmpty] of [["tasks", false], ["dependsOn", true], ["fileScope", false], ["covers", false], ["forwardVerification", false], ["rollbackVerification", false]]) {
      if (field === "forwardVerification" || field === "rollbackVerification") {
        if (!isVerificationCommandArray2(value[field])) invalid3("persisted rollback verification field is invalid", { id: recordId, field });
      } else if (!isStringArray(value[field], allowEmpty)) {
        invalid3("persisted rollback field is invalid", { id: recordId, field });
      }
    }
    if (value.sourceArtifact !== "implementation-plan" && value.sourceArtifact !== "rollback-units") {
      invalid3("persisted rollback has an invalid sourceArtifact", { id: recordId });
    }
    if (typeof value.verificationConfigSha256 !== "string" || !hex64.test(value.verificationConfigSha256)) {
      invalid3("persisted rollback has an invalid verificationConfigSha256", { id: recordId });
    }
    const allowLegacyRepair = value.status !== "tombstoned" && value.sourceArtifact === options.allowUnsafeFileScopeSourceArtifact;
    if (value.status !== "tombstoned" && !allowLegacyRepair) {
      assertSafeFileScope(value.fileScope, recordId, true);
    }
  }
  if (kind === "implementation-unit") {
    if (!isStringArray(value.tasks) || !isStringArray(value.dependsOn, true) || !isStringArray(value.fileScope) || !isStringArray(value.covers) || !isVerificationCommandArray2(value.forwardVerification)) {
      invalid3("persisted implementation unit fields are invalid", { id: recordId });
    }
    for (const taskId of value.tasks) assertId("task", taskId);
    for (const dependency of value.dependsOn) assertId("implementation-unit", dependency);
    assertSafeFileScope(value.fileScope, recordId, true);
    if (typeof value.verificationConfigSha256 !== "string" || !hex64.test(value.verificationConfigSha256)) invalid3("persisted implementation unit verification configuration is invalid", { id: recordId });
  }
}
function acceptanceCriterionCovered(nodes, node) {
  if (currentNodes(nodes).some((candidate) => candidate.kind === "test" && candidate.verifies.includes(node.id))) return true;
  const disposition = node.verificationDisposition;
  if (!disposition) return false;
  if (disposition.kind === "behavior-test") return false;
  return Boolean(disposition.reason?.trim());
}
function assertPersistedLedgerShape(ledger, options) {
  if (typeof ledger.featureId !== "string" || !ledger.featureId) invalid3("ledger featureId is invalid");
  if (!Number.isInteger(ledger.revision) || ledger.revision < 0) invalid3("ledger revision is invalid");
  if (!Number.isInteger(ledger.stateRevision) || ledger.stateRevision < 0) invalid3("ledger stateRevision is invalid");
  if (typeof ledger.projectConfigSha256 !== "string" || !hex64.test(ledger.projectConfigSha256)) {
    invalid3("ledger projectConfigSha256 is invalid");
  }
  if (ledger.verificationCommandHashes !== void 0 && (!isRecord2(ledger.verificationCommandHashes) || Object.values(ledger.verificationCommandHashes).some((value) => typeof value !== "string" || !hex64.test(value)))) {
    invalid3("ledger verification command hashes are invalid");
  }
  for (const [id, node] of Object.entries(ledger.nodes)) assertPersistedNode(id, node, options);
}
function validateTraceGraph(ledger, route, mode, options = {}) {
  if (!isRecord2(ledger) || ledger.schemaVersion !== 1 || !isRecord2(ledger.nodes) || !Array.isArray(ledger.edges)) invalid3("traceability ledger has an invalid shape");
  assertPersistedLedgerShape(ledger, options);
  const nodes = ledger.nodes;
  for (const node of currentNodes(nodes)) {
    if (node.kind === "acceptance-criterion") assertReference(nodes, node.parentRequirement, ["requirement"], { from: node.id });
    if (node.kind === "task") {
      if (node.covers.length === 0) invalid3("task cannot be orphaned", { id: node.id });
      for (const covered of node.covers) assertReference(nodes, covered, ["requirement", "acceptance-criterion"], { from: node.id });
      const unit = nodeById(nodes, node.implementationUnit);
      if (!unit && !(route === "l" && mode === "partial")) invalid3("task references a missing implementation unit", { id: node.id, implementationUnit: node.implementationUnit });
      if (unit && unit.kind !== "implementation-unit") invalid3("task implementation unit has the wrong kind", { id: node.id });
      if (unit?.kind === "implementation-unit" && !unit.tasks.includes(node.id)) {
        invalid3("implementation unit must list the task", { id: node.id, implementationUnit: node.implementationUnit });
      }
    }
    if (node.kind === "test") for (const verified of node.verifies) assertReference(nodes, verified, ["acceptance-criterion"], { from: node.id });
    if (node.kind === "rollback") {
      for (const taskId of node.tasks) {
        const task = assertReference(nodes, taskId, ["task"], { from: node.id });
        if (task.kind !== "task") invalid3("rollback arrangement task reference is invalid", { id: node.id, taskId });
      }
      for (const dependency of node.dependsOn) assertReference(nodes, dependency, ["rollback"], { from: node.id });
      for (const covered of node.covers) assertReference(nodes, covered, ["requirement", "acceptance-criterion"], { from: node.id });
    }
    if (node.kind === "implementation-unit") {
      for (const taskId of node.tasks) {
        const task = assertReference(nodes, taskId, ["task"], { from: node.id });
        if (task.kind !== "task" || task.implementationUnit !== node.id) invalid3("implementation unit tasks must be symmetric with task implementationUnit", { id: node.id, taskId });
      }
      for (const dependency of node.dependsOn) assertReference(nodes, dependency, ["implementation-unit"], { from: node.id });
      for (const covered of node.covers) assertReference(nodes, covered, ["requirement", "acceptance-criterion"], { from: node.id });
    }
    if (node.kind === "recovery") {
      assertReference(nodes, node.stepRef, ["implementation-unit", "task"], { from: node.id });
    }
  }
  assertRollbackDag(nodes);
  assertImplementationDag(nodes);
  const edges = deriveTraceEdges(nodes);
  if (!sameEdges(ledger.edges, edges)) invalid3("ledger edges do not match nodes");
  if (!sameSummary(ledger.summary, traceSummary(nodes))) invalid3("ledger summary does not match nodes");
  if (mode === "complete") {
    const kinds = new Set(currentNodes(nodes).map((node) => node.kind));
    for (const kind of ["requirement", "acceptance-criterion", "task", "implementation-unit"]) if (!kinds.has(kind)) invalid3("complete graph is missing a required node kind", { kind });
    if (currentNodes(nodes).some((node) => node.status !== "current")) invalid3("complete graph cannot contain stale nodes");
    for (const node of currentNodes(nodes)) {
      if (node.kind === "acceptance-criterion" && !acceptanceCriterionCovered(nodes, node)) {
        invalid3("every acceptance criterion requires a test or an explicit verification disposition", { id: node.id });
      }
    }
  }
}
function downstream(nodes, changed, protectedIds = /* @__PURE__ */ new Set()) {
  const reverse = /* @__PURE__ */ new Map();
  for (const edge of deriveTraceEdges(nodes)) {
    const items = reverse.get(edge.to) ?? [];
    items.push(edge.from);
    reverse.set(edge.to, items);
  }
  const queue = [...changed];
  const seen = new Set(queue);
  while (queue.length) {
    const id = queue.shift();
    for (const dependent of reverse.get(id) ?? []) {
      if (seen.has(dependent)) continue;
      seen.add(dependent);
      queue.push(dependent);
      if (protectedIds.has(dependent)) continue;
      const node = nodes[dependent];
      if (node && node.status !== "tombstoned") node.status = "stale";
    }
  }
}
function emptyTraceabilityLedger(featureId, stateRevision, projectConfigSha256) {
  return { schemaVersion: 1, featureId, revision: 0, stateRevision, projectConfigSha256, nodes: {}, edges: [], summary: { total: 0, current: 0, stale: 0, tombstoned: 0 } };
}
function applyTraceDelta(input, options = {}) {
  const effectiveInput = { ...input, delta: normalizeTraceDelta(input.delta) };
  validateTraceDelta(effectiveInput.delta);
  assertArtifactDeltaContract(effectiveInput);
  const sourceBlocks = assertSourceBlocks(effectiveInput);
  const nodes = structuredClone(effectiveInput.current.nodes);
  const changed = /* @__PURE__ */ new Set();
  for (const node of effectiveInput.delta.nodes) {
    const previous = nodes[node.id];
    if (previous?.status === "tombstoned") invalid3("tombstoned IDs cannot be reused", { id: node.id });
    const next = sourceFor(effectiveInput, node, sourceBlocks.get(node.id));
    if (previous && previous.sourceArtifact !== effectiveInput.artifactKind) invalid3("node ID already belongs to a different source artifact", { id: node.id });
    if (previous && (previous.sourceBlockSha256 !== next.sourceBlockSha256 || nodeMeaning(previous) !== inputMeaning(node))) changed.add(node.id);
    nodes[node.id] = next;
  }
  const inputIds = new Set(effectiveInput.delta.nodes.map((node) => node.id));
  for (const node of Object.values(nodes)) {
    if (node.sourceArtifact !== effectiveInput.artifactKind || inputIds.has(node.id) || node.status === "tombstoned") continue;
    node.status = "tombstoned";
    changed.add(node.id);
  }
  downstream(nodes, changed, inputIds);
  const ledger = {
    schemaVersion: 1,
    featureId: effectiveInput.current.featureId,
    revision: effectiveInput.current.revision + 1,
    stateRevision: effectiveInput.nextStateRevision,
    projectConfigSha256: effectiveInput.projectConfigSha256,
    ...effectiveInput.verificationCommandHashes ? { verificationCommandHashes: { ...effectiveInput.verificationCommandHashes } } : {},
    nodes,
    edges: deriveTraceEdges(nodes),
    summary: traceSummary(nodes)
  };
  if (options.validateGraph !== false) validateTraceGraph(ledger, effectiveInput.route, "partial");
  return ledger;
}
function assertConfigCurrent(ledger, currentProjectConfigSha256, currentCommandHashes) {
  if (ledger.verificationCommandHashes && currentCommandHashes) {
    const referenced = /* @__PURE__ */ new Set();
    for (const node of currentNodes(ledger.nodes)) {
      if (node.kind === "implementation-unit") {
        for (const ref of node.forwardVerification) if (typeof ref === "string") referenced.add(ref);
      } else if (node.kind === "rollback") {
        for (const ref of [...node.forwardVerification, ...node.rollbackVerification]) if (typeof ref === "string") referenced.add(ref);
      }
    }
    for (const id of referenced) {
      if (ledger.verificationCommandHashes[id] !== currentCommandHashes[id]) sliceError("TRACE_SLICE_STALE", "referenced verification command changed", { commandId: id });
    }
  } else if (ledger.projectConfigSha256 !== currentProjectConfigSha256) {
    sliceError("TRACE_SLICE_STALE", "project configuration changed since Trace registration");
  }
  for (const node of currentNodes(ledger.nodes)) {
    if ((node.kind === "rollback" || node.kind === "implementation-unit") && !ledger.verificationCommandHashes && node.verificationConfigSha256 !== currentProjectConfigSha256) {
      sliceError("TRACE_SLICE_STALE", "rollback verification configuration is stale", { id: node.id });
    }
  }
}
function requireCurrentKinds(ledger, kinds) {
  for (const kind of kinds) {
    const nodes = currentNodes(ledger.nodes).filter((node) => node.kind === kind);
    if (nodes.length === 0) sliceError("TRACE_SLICE_INCOMPLETE", "Trace slice is missing a required node", { kind });
    if (nodes.some((node) => node.status === "stale")) sliceError("TRACE_SLICE_STALE", "Trace slice contains stale nodes", { kind });
  }
}
function assertTraceabilityComplete(ledger, route, currentProjectConfigSha256, currentCommandHashes) {
  assertConfigCurrent(ledger, currentProjectConfigSha256, currentCommandHashes);
  if (Object.values(ledger.nodes).some((node) => node.status === "stale")) {
    sliceError("TRACE_SLICE_STALE", "complete Trace graph contains stale nodes");
  }
  try {
    validateTraceGraph(ledger, route, "complete");
  } catch (error) {
    if (error instanceof DevFlowError) sliceError("TRACE_SLICE_INCOMPLETE", error.message, error.details);
    throw error;
  }
}
function collectUncoveredAcceptanceCriteria(ledger) {
  const nodes = ledger.nodes;
  return currentNodes(nodes).filter((node) => node.kind === "acceptance-criterion").filter((node) => !acceptanceCriterionCovered(nodes, node)).map((node) => ({ id: node.id, parentRequirement: node.parentRequirement }));
}
function assertTraceSliceCurrent(ledger, route, step, currentProjectConfigSha256, currentCommandHashes) {
  assertConfigCurrent(ledger, currentProjectConfigSha256, currentCommandHashes);
  const completeSteps = /* @__PURE__ */ new Set(["planning", "implementation", "finalize"]);
  if (completeSteps.has(step)) return assertTraceabilityComplete(ledger, route, currentProjectConfigSha256, currentCommandHashes);
  const requirements = ["requirement", "acceptance-criterion"];
  if (["requirements"].includes(step)) {
    requireCurrentKinds(ledger, [...requirements]);
    try {
      validateTraceGraph(ledger, route, "partial");
    } catch (error) {
      if (error instanceof DevFlowError) sliceError("TRACE_SLICE_INCOMPLETE", error.message, error.details);
      throw error;
    }
    return;
  }
  const kinds = step === "implementation_plan" ? [...requirements, "task", "implementation-unit"] : step === "coverage_review" ? [...requirements, "task", "test"] : step === "rollback_unit" ? [...requirements, "task", "test", "rollback"] : [...requirements, "task", "test", "implementation-unit"];
  requireCurrentKinds(ledger, kinds);
  try {
    validateTraceGraph(ledger, route, step === "rollback_unit" ? "complete" : "partial");
    if (step === "coverage_review") {
      for (const node of currentNodes(ledger.nodes)) if (node.kind === "acceptance-criterion" && !acceptanceCriterionCovered(ledger.nodes, node)) {
        sliceError("TRACE_SLICE_INCOMPLETE", "coverage review requires a test or an explicit verification disposition for every acceptance criterion", { id: node.id });
      }
    }
  } catch (error) {
    if (error instanceof DevFlowError) sliceError("TRACE_SLICE_INCOMPLETE", error.message, error.details);
    throw error;
  }
}

// plugins/dev-flow/src/core/traceability-store.ts
function sortValue(value) {
  if (Array.isArray(value)) return value.map(sortValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).sort(([left], [right]) => left.localeCompare(right)).map(([key, child]) => [key, sortValue(child)]));
  }
  return value;
}
function canonicalTraceJson(ledger) {
  return `${JSON.stringify(sortValue(ledger), null, 2)}
`;
}
function snapshotDirectory(root2, featureId) {
  return path6.join(root2, ".dev-flow", "features", featureId, "traceability", "snapshots");
}
function digest2(contents) {
  return createHash7("sha256").update(contents).digest("hex");
}
async function fsyncDirectory(directory) {
  const handle = await open(directory, "r");
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}
async function writeTraceSnapshot(root2, ledger, options = {}) {
  const contents = canonicalTraceJson(ledger);
  const sha256 = digest2(contents);
  const directory = snapshotDirectory(root2, ledger.featureId);
  const target = path6.join(directory, `${sha256}.json`);
  await mkdir(directory, { recursive: true });
  try {
    const existing = await readFile3(target, "utf8");
    if (existing !== contents) throw new DevFlowError("TRACEABILITY_INTEGRITY_FAILED", "existing snapshot does not match its content address");
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    await options.fault?.("before-temp-write");
    const temporary = path6.join(directory, `.${sha256}.${randomUUID()}.tmp`);
    const handle = await open(temporary, "wx");
    try {
      await handle.writeFile(contents);
      await handle.sync();
    } finally {
      await handle.close();
    }
    await options.fault?.("after-temp-fsync");
    try {
      await rename(temporary, target);
    } catch (renameError) {
      if (renameError.code !== "EEXIST") throw renameError;
      const existing = await readFile3(target, "utf8");
      if (existing !== contents) throw new DevFlowError("TRACEABILITY_INTEGRITY_FAILED", "concurrent snapshot does not match its content address");
    }
    await fsyncDirectory(directory);
    await options.fault?.("after-snapshot-rename");
  }
  return {
    path: `traceability/snapshots/${sha256}.json`,
    sha256,
    revision: ledger.revision,
    summary: traceSummary(ledger.nodes)
  };
}
function integrity(message, details = {}) {
  throw new DevFlowError("TRACEABILITY_INTEGRITY_FAILED", message, details);
}
function safeSnapshotPath(pointer) {
  if (!/^traceability\/snapshots\/[a-f0-9]{64}\.json$/.test(pointer.path) || pointer.path !== `traceability/snapshots/${pointer.sha256}.json`) {
    integrity("Trace pointer path is invalid");
  }
  return pointer.path;
}
function sameEdges2(left, right) {
  return left.length === right.length && left.every((edge, index) => {
    const candidate = right[index];
    return edge.from === candidate?.from && edge.type === candidate.type && edge.to === candidate.to;
  });
}
async function readTraceabilityWithOptions(root2, state, options = {}) {
  if (!state.traceability) integrity("Trace pointer is missing", { featureId: state.featureId });
  const pointer = state.traceability;
  const relative = safeSnapshotPath(pointer);
  const file = path6.join(root2, ".dev-flow", "features", state.featureId, relative);
  let contents;
  try {
    contents = await readFile3(file, "utf8");
  } catch {
    integrity("Trace snapshot cannot be read", { featureId: state.featureId, path: relative });
  }
  if (digest2(contents) !== pointer.sha256) integrity("Trace snapshot digest does not match pointer", { featureId: state.featureId });
  let ledger;
  try {
    ledger = JSON.parse(contents);
  } catch {
    integrity("Trace snapshot is not valid JSON", { featureId: state.featureId });
  }
  try {
    validateTraceGraph(ledger, state.route, "partial", options);
  } catch (error) {
    integrity("Trace snapshot graph is invalid", { cause: error instanceof Error ? error.message : String(error) });
  }
  if (ledger.featureId !== state.featureId || ledger.revision !== pointer.revision || ledger.stateRevision > state.revision) {
    integrity("Trace pointer and ledger revisions do not match", { featureId: state.featureId });
  }
  if (ledger.summary.total !== pointer.summary.total || ledger.summary.current !== pointer.summary.current || ledger.summary.stale !== pointer.summary.stale || ledger.summary.tombstoned !== pointer.summary.tombstoned || !sameEdges2(deriveTraceEdges(ledger.nodes), ledger.edges)) {
    integrity("Trace pointer summary or ledger edges do not match", { featureId: state.featureId });
  }
  return ledger;
}
async function readTraceability(root2, state) {
  return readTraceabilityWithOptions(root2, state);
}
async function readTraceabilityForArtifactReplacement(root2, state, artifactKind) {
  const allowUnsafeFileScopeSourceArtifact = artifactKind === "implementation-plan" || artifactKind === "rollback-units" ? artifactKind : void 0;
  return readTraceabilityWithOptions(root2, state, { allowUnsafeFileScopeSourceArtifact });
}
async function listOrphanTraceSnapshots(root2, state) {
  const directory = snapshotDirectory(root2, state.featureId);
  let entries;
  try {
    entries = await readdir3(directory);
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }
  const active = state.traceability?.path.split("/").at(-1);
  return entries.filter((entry) => /^[a-f0-9]{64}\.json$/.test(entry) && entry !== active).sort();
}
async function readProjectConfigSnapshot(root2) {
  const file = path6.join(root2, ".dev-flow", "project.json");
  let raw;
  try {
    raw = await readFile3(file, "utf8");
  } catch {
    throw new DevFlowError("PROJECT_NOT_INITIALIZED", "run dev_flow_init_project first", {
      userMessage: "\u9879\u76EE\u5C1A\u672A\u521D\u59CB\u5316\uFF0C\u8BF7\u5148\u8FD0\u884C dev_flow_init_project\u3002",
      cause: "\u5F53\u524D\u4E1A\u52A1\u76EE\u5F55\u7F3A\u5C11 .dev-flow/project.json\u3002",
      impact: "\u672A\u521D\u59CB\u5316\u9879\u76EE\u524D\u65E0\u6CD5\u8BFB\u53D6\u8FFD\u6EAF\u6295\u5F71\u3002",
      recoveryKind: "retry",
      recoveryInstruction: "\u8FD0\u884C dev_flow_init_project \u521D\u59CB\u5316\u9879\u76EE\u540E\u91CD\u8BD5\u3002",
      retryOriginal: true,
      requiresUserDecision: false
    });
  }
  let config;
  try {
    config = JSON.parse(raw);
    validateProjectConfig(config);
  } catch (error) {
    if (error instanceof DevFlowError) throw error;
    throw new DevFlowError("INVALID_PROJECT_CONFIG", "project configuration is unreadable");
  }
  return { config, sha256: digest2(raw), contents: raw };
}

// plugins/dev-flow/src/core/traceability-gates.ts
function traceSliceForWorkflowStep(step) {
  if (step === "requirements_alignment") return "requirements";
  if (step === "planning") return "implementation_plan";
  return step;
}
function traceIsEnforced(state) {
  return traceEnforcementRequired(state.route, state.classification.controls);
}
function blockerFor(step, error) {
  const value = error;
  if (value?.code === "TRACE_SLICE_STALE" || value?.code === "TRACE_SLICE_INCOMPLETE") {
    return {
      code: value.code,
      step,
      details: typeof value.details === "object" && value.details !== null && !Array.isArray(value.details) ? value.details : {}
    };
  }
  return {
    code: "TRACE_SLICE_INCOMPLETE",
    step,
    details: {
      cause: typeof value?.code === "string" ? value.code : "TRACEABILITY_UNREADABLE",
      ...typeof value?.message === "string" ? { message: value.message } : {}
    }
  };
}
async function inspectTraceGate(root2, state, step) {
  if (!traceIsEnforced(state)) return { enforced: false };
  const traceStep = traceSliceForWorkflowStep(step);
  let ledger;
  try {
    ledger = await readTraceability(root2, state);
    const { config, sha256 } = await readProjectConfigSnapshot(root2);
    assertTraceSliceCurrent(ledger, state.route, traceStep, sha256, verificationCommandHashes(config));
    return { enforced: true, ledger, effectiveSummary: ledger.summary };
  } catch (error) {
    return {
      enforced: true,
      ...ledger ? { ledger, effectiveSummary: ledger.summary } : {},
      blocker: blockerFor(traceStep, error)
    };
  }
}
async function inspectCurrentTrace(root2, state) {
  if (!traceIsEnforced(state)) return { enforced: false };
  const step = currentOpenStep(state);
  return step ? inspectTraceGate(root2, state, step) : { enforced: true };
}
async function assertTraceGateCurrent(root2, state, step) {
  const inspection = await inspectTraceGate(root2, state, step);
  if (!inspection.blocker) return inspection.ledger;
  throw new DevFlowError(
    inspection.blocker.code,
    `Trace slice is not ready for ${step}`,
    {
      ...inspection.blocker.details,
      recoveryHint: inspection.blocker.code === "TRACE_SLICE_STALE" ? "\u9A8C\u8BC1\u914D\u7F6E\u6216 trace \u8BC1\u636E\u5DF2\u53D8\u66F4\uFF1A\u82E5\u5B58\u5728\u6D3B\u52A8\u5B9E\u73B0\u5355\u5143\uFF0C\u5148\u7528 dev_flow_abandon_implementation_unit \u53D6\u6D88\uFF0C\u518D\u91CD\u767B\u8BB0\u8BA1\u5212\u5237\u65B0 Trace \u57FA\u7EBF\u3002" : "\u6309\u5F53\u524D\u9636\u6BB5\u8865\u9F50 trace \u8BC1\u636E\u540E\u91CD\u8BD5\u3002"
    }
  );
}

// plugins/dev-flow/src/core/review-store.ts
import { createHash as createHash8, randomUUID as randomUUID2 } from "node:crypto";
import { mkdir as mkdir2, open as open2, readFile as readFile4, readdir as readdir4, rename as rename2 } from "node:fs/promises";
import path7 from "node:path";

// plugins/dev-flow/src/policy/review.ts
function toPublicReviewJob(job) {
  const { claim, samplingAttempts, submission, ...publicJob2 } = job;
  return {
    ...publicJob2,
    ...claim ? { lease: { claimedAt: claim.claimedAt, leaseExpiresAt: claim.leaseExpiresAt } } : {},
    ...samplingAttempts ? {
      samplingAttempts: samplingAttempts.map(({ requestSha256: _requestSha256, ...attempt }) => attempt)
    } : {},
    ...submission ? {
      submission: {
        ...submission,
        ...submission.samplingProvenance ? {
          samplingProvenance: {
            issuedAt: submission.samplingProvenance.issuedAt,
            completedAt: submission.samplingProvenance.completedAt
          }
        } : {}
      }
    } : {}
  };
}
var defaultReviewIdentityVerifier = {
  verify: () => ({ trusted: false })
};
function assuranceForReviewBatch(batch, verifier = defaultReviewIdentityVerifier) {
  const attested = batch.jobs.filter((job) => job.status === "submitted" && job.submission?.attestation);
  const trusted = attested.filter((job) => verifier.verify(job.submission.attestation).trusted);
  const trustedAgents = new Set(trusted.map((job) => job.submission.attestation.agentId));
  const trustedRaws = new Set(trusted.map((job) => job.submission.attestation.rawSha256));
  if (trusted.length >= 2 && trustedAgents.size >= 2 && trustedRaws.size >= 2) return "multi-agent-verified";
  const sampled = batch.jobs.filter((job) => job.status === "submitted" && job.submission?.samplingProvenance);
  const hashes = new Set(sampled.map((job) => job.submission.samplingProvenance.requestSha256));
  if (sampled.length >= 2 && hashes.size >= 2) return "independent-sampling";
  return "multi-perspective";
}
function evidenceSourcesForReviewBatch(batch) {
  if (!batch) return [];
  const sources = [];
  if (batch.jobs.some((job) => job.status === "submitted")) sources.push("role-jobs");
  if (batch.jobs.some((job) => job.submission?.samplingProvenance)) sources.push("server-sampling");
  if (batch.jobs.some((job) => job.submission?.attestation)) sources.push("host-attestation");
  return sources;
}
function parseHostAttestation(value) {
  if (!isRecord3(value) || Object.keys(value).some((key) => !["host", "agentId", "issuedAt", "raw", "hostEventId", "isolated"].includes(key)) || value.host !== "claude" && value.host !== "codex" || typeof value.agentId !== "string" || !value.agentId.trim() || typeof value.issuedAt !== "string" || !value.issuedAt.trim() || Number.isNaN(Date.parse(value.issuedAt)) || typeof value.raw !== "string" || !value.raw.trim()) {
    protocolInvalid("host attestation has an invalid shape");
  }
  return {
    host: value.host,
    agentId: value.agentId.trim(),
    issuedAt: value.issuedAt,
    raw: value.raw,
    ...typeof value.hostEventId === "string" && value.hostEventId.trim() ? { hostEventId: value.hostEventId.trim() } : {},
    ...value.isolated === true ? { isolated: true } : {}
  };
}
var reviewRoles2 = [
  "code-quality",
  "requirement-fidelity",
  "requirements-coverage",
  "architecture-testability",
  "rollback-operability",
  "security",
  "data-irreversibility",
  "money-safety",
  "contract-failure",
  "recovery-observability",
  "critical-correctness"
];
function protocolInvalid(message) {
  throw new Error(`REVIEW_PROTOCOL_INVALID: ${message}`);
}
function isRecord3(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function isReviewRole(value) {
  return typeof value === "string" && reviewRoles2.includes(value);
}
function parseReviewJobCompletion(value) {
  if (!isRecord3(value) || Object.keys(value).some((key) => key !== "coverageSummary" && key !== "findings" && key !== "resolutions") || typeof value.coverageSummary !== "string" || !value.coverageSummary.trim() || !Array.isArray(value.findings)) {
    protocolInvalid("review job completion has an invalid shape");
  }
  const findings = value.findings.map((finding, index) => parseFinding(finding, index));
  const resolutions = value.resolutions === void 0 ? [] : Array.isArray(value.resolutions) ? value.resolutions.map((resolution, index) => parseResolution(resolution, index)) : protocolInvalid("review job resolutions must be an array");
  return { coverageSummary: value.coverageSummary, findings, ...resolutions.length ? { resolutions } : {} };
}
function nonEmptyStrings(value) {
  return Array.isArray(value) && value.length > 0 && value.every((item) => typeof item === "string" && item.trim());
}
function parseEvidence(value, label) {
  if (!Array.isArray(value) || !value.length) protocolInvalid(`${label} evidence must be a non-empty array`);
  return value.map((item, index) => {
    const line = isRecord3(item) ? item.line : void 0;
    if (!isRecord3(item) || Object.keys(item).some((key) => key !== "path" && key !== "line") || typeof item.path !== "string" || !item.path.trim() || line !== void 0 && (typeof line !== "number" || !Number.isInteger(line) || line < 1)) {
      protocolInvalid(`${label} evidence ${index} has an invalid shape`);
    }
    return { path: item.path, ...line === void 0 ? {} : { line } };
  });
}
function parseFinding(value, index) {
  if (!isRecord3(value) || Object.keys(value).some((key) => !["severity", "category", "targets", "evidence", "claim", "recommendation"].includes(key)) || value.severity !== "blocking" && value.severity !== "warning" && value.severity !== "note" || !isReviewRole(value.category) || !nonEmptyStrings(value.targets) || typeof value.claim !== "string" || !value.claim.trim() || typeof value.recommendation !== "string" || !value.recommendation.trim()) {
    protocolInvalid(`review finding ${index} has an invalid shape`);
  }
  return { severity: value.severity, category: value.category, targets: [...value.targets], evidence: parseEvidence(value.evidence, `review finding ${index}`), claim: value.claim, recommendation: value.recommendation };
}
function parseResolution(value, index) {
  if (!isRecord3(value) || Object.keys(value).some((key) => key !== "findingId" && key !== "evidence" && key !== "note" && key !== "outcome") || typeof value.findingId !== "string" || !value.findingId || typeof value.note !== "string" || !value.note.trim()) {
    protocolInvalid(`review resolution ${index} has an invalid shape`);
  }
  if (value.outcome !== void 0 && value.outcome !== "resolved" && value.outcome !== "still-blocking" && value.outcome !== "risk-acceptance-required") protocolInvalid(`review resolution ${index} has an invalid outcome`);
  return { findingId: value.findingId, evidence: parseEvidence(value.evidence, `review resolution ${index}`), note: value.note, ...value.outcome ? { outcome: value.outcome } : {} };
}
function deriveReviewJobRequirements(route, riskLabels, derivedRoles, phase = "plan") {
  if (phase === "code") {
    const reviewDepth2 = riskLabels.includes("critical_correctness") ? "full" : "standard";
    return ["code-quality", "requirement-fidelity"].map((role) => ({ role, reviewDepth: reviewDepth2 }));
  }
  if (route !== "m" && route !== "l") return [];
  const roles = derivedRoles?.length ? [...derivedRoles] : ["requirements-coverage", "architecture-testability", "rollback-operability"];
  if (!derivedRoles && riskLabels.includes("security")) roles.push("security");
  if (!derivedRoles && riskLabels.some((label) => label === "data" || label === "money" || label === "irreversible_consequence")) {
    roles.push("data-irreversibility");
  }
  const reviewDepth = riskLabels.includes("critical_correctness") ? "full" : "standard";
  return reviewRoles2.filter((role) => roles.includes(role)).map((role) => ({ role, reviewDepth }));
}
function assuranceForReview2a(_diagnostics) {
  return "multi-perspective";
}

// plugins/dev-flow/src/core/review-store.ts
function sortValue2(value) {
  if (Array.isArray(value)) return value.map(sortValue2);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).sort(([left], [right]) => left.localeCompare(right)).map(([key, child]) => [key, sortValue2(child)]));
  }
  return value;
}
var emptySummary = () => ({ batches: 0, current: 0, stale: 0, open: 0, complete: 0 });
var digest3 = (contents) => createHash8("sha256").update(contents).digest("hex");
function emptyReviewLedger(featureId, stateRevision) {
  return { schemaVersion: 2, featureId, revision: 0, stateRevision, batches: [], summary: emptySummary(), findingEvents: [] };
}
function canonicalReviewJson(ledger) {
  return `${JSON.stringify(sortValue2(ledger), null, 2)}
`;
}
function canonicalReviewValueJson(value) {
  return `${JSON.stringify(sortValue2(value), null, 2)}
`;
}
function semanticReviewBasisHash(basis) {
  const { projectConfigSha256: _projectConfigSha256, verificationCommandHashes: _verificationCommandHashes, ...semanticBasis } = basis;
  return digest3(canonicalReviewValueJson(semanticBasis));
}
function validBasisHash(basis, basisHash2) {
  return basisHash2 === digest3(canonicalReviewValueJson(basis)) || basisHash2 === semanticReviewBasisHash(basis);
}
function snapshotDirectory2(root2, featureId) {
  return path7.join(root2, ".dev-flow", "features", featureId, "review", "snapshots");
}
function packageDirectory(root2, featureId) {
  return path7.join(root2, ".dev-flow", "features", featureId, "review", "packages");
}
function integrity2(message, details = {}) {
  throw new DevFlowError("REVIEW_INTEGRITY_FAILED", message, details);
}
function validateSummary(value) {
  return typeof value === "object" && value !== null && ["batches", "current", "stale", "open", "complete"].every((key) => {
    const candidate = value[key];
    return Number.isInteger(candidate) && candidate >= 0;
  });
}
function sameSummary2(left, right) {
  return left.batches === right.batches && left.current === right.current && left.stale === right.stale && left.open === right.open && left.complete === right.complete;
}
function validHash(value) {
  return typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
}
function isRecord4(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function validSamplingAttempt(value) {
  if (!isRecord4(value) || !validHash(value.requestSha256) || typeof value.issuedAt !== "string" || typeof value.leaseExpiresAt !== "string" || value.status !== "issued" && value.status !== "failed" && value.status !== "submitted") return false;
  if (value.status === "issued") {
    return value.completedAt === void 0 && value.payloadSha256 === void 0 && value.failureCode === void 0;
  }
  if (typeof value.completedAt !== "string") return false;
  if (value.status === "failed") {
    return value.payloadSha256 === void 0 && (value.failureCode === "client-error" || value.failureCode === "timeout" || value.failureCode === "invalid-response" || value.failureCode === "validation-failed");
  }
  return validHash(value.payloadSha256) && value.failureCode === void 0;
}
function validSamplingAttempts(value, status, submission) {
  if (value === void 0) return status !== "sampling" && !submission?.samplingProvenance;
  if (!Array.isArray(value) || !value.length || !value.every(validSamplingAttempt)) return false;
  const attempts = value;
  const issued = attempts.filter((attempt) => attempt.status === "issued");
  if (issued.length > 1 || status === "sampling" !== (issued.length === 1)) return false;
  if (status === "sampling" && submission) return false;
  if (status === "sampling") return attempts.every((attempt) => attempt.status === "failed" || attempt.status === "issued");
  if (status === "pending" || status === "claimed") return attempts.every((attempt) => attempt.status === "failed");
  if (!submission?.samplingProvenance) return attempts.every((attempt) => attempt.status === "failed");
  return attempts.every((attempt) => attempt.status === "failed" || attempt.status === "submitted") && attempts.filter((attempt) => attempt.status === "submitted").length === 1 && attempts.some((attempt) => attempt.status === "submitted" && attempt.requestSha256 === submission.samplingProvenance.requestSha256 && attempt.issuedAt === submission.samplingProvenance.issuedAt && attempt.completedAt === submission.samplingProvenance.completedAt && attempt.payloadSha256 === submission.payloadSha256);
}
function validAttestation(value) {
  return isRecord4(value) && (value.host === "claude" || value.host === "codex") && typeof value.agentId === "string" && value.agentId.trim().length > 0 && typeof value.issuedAt === "string" && !Number.isNaN(Date.parse(value.issuedAt)) && typeof value.raw === "string" && value.raw.trim().length > 0 && validHash(value.rawSha256) && typeof value.acceptedAt === "string" && digest3(value.raw) === value.rawSha256;
}
function validateBatch(value) {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const batch = value;
  if (typeof batch.batchId !== "string" || !batch.batchId || !validHash(batch.basisHash) || !batch.basis || batch.validity !== "current" && batch.validity !== "stale" || batch.progress !== "open" && batch.progress !== "complete" || batch.executionMode !== "isolated-sequential" && batch.executionMode !== "parallel-safe" && batch.executionMode !== "mcp-sampling" && batch.executionMode !== "native-subagent" || batch.assuranceLevel !== "multi-perspective" && batch.assuranceLevel !== "independent-sampling" && batch.assuranceLevel !== "multi-agent-verified" || !Array.isArray(batch.jobs)) return false;
  const ids = /* @__PURE__ */ new Set();
  const attestationRaws = /* @__PURE__ */ new Set();
  return batch.jobs.every((job) => {
    if (!job || typeof job !== "object" || typeof job.jobId !== "string" || !job.jobId || ids.has(job.jobId) || typeof job.role !== "string" || job.reviewDepth !== "standard" && job.reviewDepth !== "full" || !validHash(job.packageSha256) || !validHash(job.roleBasisHash) || job.status !== "pending" && job.status !== "claimed" && job.status !== "sampling" && job.status !== "submitted" && job.status !== "reused") return false;
    ids.add(job.jobId);
    if (job.status === "reused") return !!job.reusedFrom && validHash(job.reusedFrom.submissionSha256) && !job.claim && !job.submission;
    if (!validSamplingAttempts(job.samplingAttempts, job.status, job.submission)) return false;
    if (job.status === "pending") return !job.claim && !job.submission;
    if (job.status === "sampling") return !job.claim && !job.submission?.attestation;
    if (job.status === "claimed") {
      return !job.submission && !!job.claim && validHash(job.claim.requestSha256) && typeof job.claim.claimedAt === "string" && typeof job.claim.leaseExpiresAt === "string";
    }
    const sampled = Boolean(job.submission?.samplingProvenance);
    const attested = Boolean(job.submission?.attestation);
    if (sampled && attested) return false;
    if (!sampled && (!job.claim || !validHash(job.claim.requestSha256) || typeof job.claim.claimedAt !== "string" || typeof job.claim.leaseExpiresAt !== "string")) return false;
    if (sampled && job.claim) return false;
    if (!job.submission || !validHash(job.submission.payloadSha256) || typeof job.submission.coverageSummary !== "string" || !Array.isArray(job.submission.findings) || typeof job.submission.submittedAt !== "string") return false;
    if (attested) {
      if (!validAttestation(job.submission.attestation)) return false;
      if (attestationRaws.has(job.submission.attestation.rawSha256)) return false;
      attestationRaws.add(job.submission.attestation.rawSha256);
    }
    return true;
  });
}
function validateLedger(value) {
  if (typeof value !== "object" || value === null || Array.isArray(value)) integrity2("review snapshot has an invalid shape");
  const ledger = value;
  if (ledger.schemaVersion === 1) {
    throw new DevFlowError("UNSUPPORTED_REVIEW_SCHEMA", "\u68C0\u6D4B\u5230 Dev Flow 4.x review ledger schema v1\u3002", {
      recoveryHint: "\u56DE\u5230 4.x \u5B8C\u6210\u6216\u653E\u5F03\u8BE5 feature\uFF0C\u5907\u4EFD .dev-flow \u540E\u7528 5.0 \u91CD\u65B0\u521D\u59CB\u5316"
    });
  }
  if (ledger.schemaVersion !== 2 || typeof ledger.featureId !== "string" || !ledger.featureId || !Number.isInteger(ledger.revision) || (ledger.revision ?? -1) < 0 || !Number.isInteger(ledger.stateRevision) || (ledger.stateRevision ?? -1) < 0 || !Array.isArray(ledger.batches) || !ledger.batches.every(validateBatch) || !validateSummary(ledger.summary)) {
    integrity2("review snapshot has an invalid shape");
  }
  const batchIds = /* @__PURE__ */ new Set();
  for (const batch of ledger.batches) {
    if (batchIds.has(batch.batchId) || batch.basis.featureId !== ledger.featureId || !validBasisHash(batch.basis, batch.basisHash) || batch.progress === "complete" !== batch.jobs.every((job) => job.status === "submitted" || job.status === "reused")) {
      integrity2("review snapshot batch is inconsistent");
    }
    if (batch.assuranceLevel !== assuranceForReviewBatch(batch)) {
      integrity2("review batch assurance is not derived from persisted provenance", { batchId: batch.batchId });
    }
    if (batch.executionMode === "isolated-sequential" && batch.assuranceLevel !== "multi-perspective") {
      integrity2("isolated review batch assurance is not Core-derived", { batchId: batch.batchId });
    }
    batchIds.add(batch.batchId);
  }
  if (ledger.findingEvents !== void 0) {
    if (!Array.isArray(ledger.findingEvents)) integrity2("review finding event ledger is invalid");
    const origins = /* @__PURE__ */ new Set();
    for (const event of ledger.findingEvents) {
      if (!event || typeof event !== "object" || typeof event.type !== "string" || typeof event.at !== "string") integrity2("review finding event has an invalid shape");
      if (event.type === "origin") {
        if (!event.finding || typeof event.finding.findingId !== "string" || origins.has(event.finding.findingId)) integrity2("review finding origin is missing or duplicated");
        origins.add(event.finding.findingId);
      } else if (typeof event.findingId !== "string" || !origins.has(event.findingId)) {
        integrity2("review finding event references an unknown origin", { findingId: event.findingId });
      }
    }
  }
  const attestationRaws = /* @__PURE__ */ new Set();
  for (const batch of ledger.batches) {
    for (const job of batch.jobs) {
      const rawSha256 = job.submission?.attestation?.rawSha256;
      if (!rawSha256) continue;
      if (attestationRaws.has(rawSha256)) {
        integrity2("host attestation raw hash is reused across the review ledger", {
          batchId: batch.batchId,
          jobId: job.jobId
        });
      }
      attestationRaws.add(rawSha256);
    }
  }
  if (!sameSummary2(ledger.summary, reviewSummary(ledger.batches))) integrity2("review snapshot summary is inconsistent");
}
function reviewSummary(batches) {
  return {
    batches: batches.length,
    current: batches.filter((batch) => batch.validity === "current").length,
    stale: batches.filter((batch) => batch.validity === "stale").length,
    open: batches.filter((batch) => batch.progress === "open").length,
    complete: batches.filter((batch) => batch.progress === "complete").length
  };
}
async function fsyncDirectory2(directory) {
  const handle = await open2(directory, "r");
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}
async function writeReviewSnapshot(root2, ledger) {
  validateLedger(ledger);
  const contents = canonicalReviewJson(ledger);
  const sha256 = digest3(contents);
  const directory = snapshotDirectory2(root2, ledger.featureId);
  const target = path7.join(directory, `${sha256}.json`);
  await mkdir2(directory, { recursive: true });
  try {
    const existing = await readFile4(target, "utf8");
    if (existing !== contents) integrity2("existing review snapshot does not match its content address");
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    const temporary = path7.join(directory, `.${sha256}.${randomUUID2()}.tmp`);
    const handle = await open2(temporary, "wx");
    try {
      await handle.writeFile(contents);
      await handle.sync();
    } finally {
      await handle.close();
    }
    try {
      await rename2(temporary, target);
    } catch (renameError) {
      if (renameError.code !== "EEXIST") throw renameError;
      if (await readFile4(target, "utf8") !== contents) integrity2("concurrent review snapshot does not match its content address");
    }
    await fsyncDirectory2(directory);
  }
  return { path: `review/snapshots/${sha256}.json`, sha256, revision: ledger.revision, summary: ledger.summary };
}
async function writeReviewPackage(root2, featureId, value) {
  const contents = canonicalReviewValueJson(value);
  const sha256 = digest3(contents);
  const directory = packageDirectory(root2, featureId);
  const target = path7.join(directory, `${sha256}.json`);
  await mkdir2(directory, { recursive: true });
  try {
    const existing = await readFile4(target, "utf8");
    if (existing !== contents) integrity2("existing review package does not match its content address");
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    const temporary = path7.join(directory, `.${sha256}.${randomUUID2()}.tmp`);
    const handle = await open2(temporary, "wx");
    try {
      await handle.writeFile(contents);
      await handle.sync();
    } finally {
      await handle.close();
    }
    try {
      await rename2(temporary, target);
    } catch (renameError) {
      if (renameError.code !== "EEXIST") throw renameError;
      if (await readFile4(target, "utf8") !== contents) integrity2("concurrent review package does not match its content address");
    }
    await fsyncDirectory2(directory);
  }
  return sha256;
}
async function readReviewPackage(root2, featureId, sha256) {
  if (!validHash(sha256)) integrity2("review package hash is invalid");
  let contents;
  try {
    contents = await readFile4(path7.join(packageDirectory(root2, featureId), `${sha256}.json`), "utf8");
  } catch {
    integrity2("review package cannot be read", { featureId, sha256 });
  }
  if (digest3(contents) !== sha256) integrity2("review package digest does not match its address", { featureId, sha256 });
  try {
    return JSON.parse(contents);
  } catch {
    integrity2("review package is not valid JSON", { featureId, sha256 });
  }
}
function safeSnapshotPath2(pointer) {
  if (!/^review\/snapshots\/[a-f0-9]{64}\.json$/.test(pointer.path) || pointer.path !== `review/snapshots/${pointer.sha256}.json`) integrity2("review pointer path is invalid");
  return pointer.path;
}
async function readReviewLedger(root2, state) {
  if (!state.review) integrity2("review pointer is missing", { featureId: state.featureId });
  const pointer = state.review;
  const relative = safeSnapshotPath2(pointer);
  let contents;
  try {
    contents = await readFile4(path7.join(root2, ".dev-flow", "features", state.featureId, relative), "utf8");
  } catch {
    integrity2("review snapshot cannot be read", { featureId: state.featureId, path: relative });
  }
  if (digest3(contents) !== pointer.sha256) integrity2("review snapshot digest does not match pointer", { featureId: state.featureId });
  let ledger;
  try {
    ledger = JSON.parse(contents);
  } catch {
    integrity2("review snapshot is not valid JSON", { featureId: state.featureId });
  }
  validateLedger(ledger);
  if (ledger.featureId !== state.featureId || ledger.revision !== pointer.revision || ledger.stateRevision > state.revision || !sameSummary2(ledger.summary, pointer.summary)) {
    integrity2("review pointer and ledger revisions do not match", { featureId: state.featureId });
  }
  return ledger;
}
async function prepareReviewInvalidation(root2, state, nextStateRevision) {
  if (!state.review) return void 0;
  const ledger = await readReviewLedger(root2, state);
  const batches = ledger.batches.map((batch) => batch.validity === "current" ? { ...batch, validity: "stale" } : batch);
  if (batches.every((batch, index) => batch === ledger.batches[index])) return void 0;
  return writeReviewSnapshot(root2, {
    ...ledger,
    revision: ledger.revision + 1,
    stateRevision: nextStateRevision,
    batches,
    summary: reviewSummary(batches)
  });
}
async function listOrphanReviewSnapshots(root2, state) {
  let entries;
  try {
    entries = await readdir4(snapshotDirectory2(root2, state.featureId));
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }
  const active = state.review?.path.split("/").at(-1);
  return entries.filter((entry) => /^[a-f0-9]{64}\.json$/.test(entry) && entry !== active).sort();
}

// plugins/dev-flow/src/core/workspace-store.ts
import { lstat as lstat3, readFile as readFile5, readlink as readlink2 } from "node:fs/promises";
import path8 from "node:path";
import { createHash as createHash9 } from "node:crypto";
async function trustedWriteSummary(root2, file) {
  const target = path8.join(root2, file);
  try {
    const metadata = await lstat3(target);
    const bytes = metadata.isSymbolicLink() ? Buffer.from(await readlink2(target)) : await readFile5(target);
    return `${metadata.isSymbolicLink() ? "symlink" : "file"}:${createHash9("sha256").update(bytes).digest("hex")}`;
  } catch (error) {
    if (error.code === "ENOENT") return "missing";
    throw error;
  }
}

// plugins/dev-flow/src/core/review-projection.ts
import { createHash as createHash10, randomUUID as randomUUID3 } from "node:crypto";
import { mkdir as mkdir3, open as open3, readFile as readFile6, rename as rename3 } from "node:fs/promises";
import path9 from "node:path";

// plugins/dev-flow/src/core/review-findings.ts
function eventsFor(ledger, findingId) {
  return (ledger.findingEvents ?? []).filter((event) => event.type === "origin" ? event.finding.findingId === findingId : event.findingId === findingId);
}
function originFor(ledger, findingId) {
  return (ledger.findingEvents ?? []).find((event) => event.type === "origin" && event.finding.findingId === findingId);
}
function latestEvent(events) {
  return events.filter((event) => event.type !== "origin").at(-1);
}
function effectiveFindingState(ledger, findingId, currentBasisHash) {
  const origin = originFor(ledger, findingId);
  if (!origin) return void 0;
  const latest = latestEvent(eventsFor(ledger, findingId));
  const expectedBasis = typeof currentBasisHash === "function" ? currentBasisHash(origin) : currentBasisHash;
  const basisCurrent = !expectedBasis || !latest || latest.basisHash === expectedBasis;
  const status = !basisCurrent ? "needs-revalidation" : latest?.type === "resolved" ? "resolved" : latest?.type === "still-blocking" ? "still-blocking" : latest?.type === "risk-accepted" ? "risk-accepted" : "unresolved";
  return {
    findingId,
    status,
    blocking: origin.finding.severity === "blocking" && status !== "resolved" && status !== "risk-accepted",
    origin,
    ...latest ? { latestEvent: latest } : {}
  };
}
function unresolvedBlockingFindings(ledger, currentBasisHash) {
  const ids = new Set((ledger.findingEvents ?? []).filter((event) => event.type === "origin" && event.finding.severity === "blocking").map((event) => event.finding.findingId));
  return [...ids].map((findingId) => effectiveFindingState(ledger, findingId, currentBasisHash)).filter((state) => Boolean(state?.blocking)).map((state) => state.origin.finding);
}
function carriedFindings(ledger, role, currentBasisHash) {
  return unresolvedBlockingFindings(ledger, currentBasisHash).map((finding) => {
    const origin = originFor(ledger, finding.findingId);
    return origin && origin.role === role ? { finding, originBatchId: origin.batchId, basisHash: origin.basisHash } : void 0;
  }).filter((value) => Boolean(value));
}

// plugins/dev-flow/src/core/review-projection.ts
var digest4 = (contents) => createHash10("sha256").update(contents).digest("hex");
function projectionError(message, details = {}) {
  throw new DevFlowError("REVIEW_PROJECTION_INVALID", message, details);
}
function currentBatch(ledger) {
  const batches = ledger.batches.filter((batch) => batch.validity === "current");
  if (batches.length > 1) projectionError("review ledger has more than one current batch");
  return batches[0];
}
function publicJob(job) {
  return { jobId: job.jobId, role: job.role, reviewDepth: job.reviewDepth, status: job.status };
}
function publicFinding(finding) {
  return {
    findingId: finding.findingId,
    jobId: finding.jobId,
    severity: finding.severity,
    category: finding.category,
    targets: [...finding.targets],
    evidence: finding.evidence.map((evidence) => ({ ...evidence })),
    claim: finding.claim,
    recommendation: finding.recommendation
  };
}
function unresolvedBlockingFindingIds(ledger) {
  if (ledger.findingEvents?.length) {
    const current = ledger.batches.find((batch) => batch.validity === "current");
    const roleBasis = (origin) => current?.jobs.find((job) => job.role === origin.role)?.roleBasisHash;
    return unresolvedBlockingFindings(ledger, roleBasis).map((finding) => finding.findingId).sort();
  }
  const dispositions = Object.fromEntries(ledger.batches.flatMap((batch) => Object.entries(batch.dispositions ?? {})));
  return ledger.batches.flatMap((batch) => batch.jobs.flatMap((job) => job.submission?.findings ?? [])).filter((finding) => finding.severity === "blocking" && !dispositions[finding.findingId]).map((finding) => finding.findingId).sort();
}
function reviewProjectionModel(state, ledger) {
  const batch = currentBatch(ledger);
  const staleBatches = ledger.batches.filter((candidate) => candidate.validity === "stale").map((candidate) => ({ batchId: candidate.batchId, basisHash: candidate.basisHash, progress: candidate.progress }));
  const requiredRoles = batch ? batch.jobs.map((job) => ({ role: job.role, reviewDepth: job.reviewDepth })) : deriveReviewJobRequirements(state.route, state.classification.riskLabels).map((requirement) => ({ role: requirement.role, reviewDepth: requirement.reviewDepth }));
  const complete = batch?.progress === "complete";
  const findings = complete ? batch.jobs.flatMap((job) => job.submission?.findings ?? []).map(publicFinding) : void 0;
  return {
    schemaVersion: 1,
    featureId: state.featureId,
    route: state.route,
    reviewPointer: {
      path: state.review.path,
      sha256: state.review.sha256,
      revision: state.review.revision
    },
    assurance: {
      ...batch ? { level: batch.assuranceLevel } : {},
      evidenceType: "core-derived-review-batch",
      evidenceSources: evidenceSourcesForReviewBatch(batch)
    },
    batch: {
      status: batch ? batch.validity : "not-created",
      ...batch ? {
        batchId: batch.batchId,
        basisHash: batch.basisHash,
        progress: batch.progress,
        executionMode: batch.executionMode
      } : {},
      requiredRoles,
      jobs: batch ? batch.jobs.map(publicJob) : [],
      visibility: complete ? "complete" : "coarse",
      ...complete ? {
        findings,
        dispositions: { ...batch.dispositions },
        unresolvedBlockingFindingIds: unresolvedBlockingFindingIds(ledger)
      } : {}
    },
    staleBatches
  };
}
function renderReviewProjection(model) {
  const batch = model.batch;
  const lines = [
    "---",
    "dev_flow:",
    "  schema_version: 1",
    `  feature_id: ${model.featureId}`,
    `  route: ${model.route}`,
    "  kind: plan-review",
    "  generated: true",
    "---",
    "",
    "# Plan Review",
    "",
    "## Review Ledger",
    "",
    `- Pointer: ${model.reviewPointer.path}`,
    `- Revision: ${model.reviewPointer.revision}`,
    `- Batch status: ${batch.status}`,
    `- Evidence type: ${model.assurance.evidenceType}`,
    ...model.assurance.level ? [`- Assurance: ${model.assurance.level}`] : [],
    ...model.assurance.evidenceSources.length ? [`- Evidence sources: ${model.assurance.evidenceSources.join(", ")}`] : [],
    ...model.assurance.level === "independent-sampling" ? ["- Note: independent-sampling is server sampling provenance, not multi-agent identity."] : [],
    ...batch.batchId ? [`- Batch ID: ${batch.batchId}`, `- Basis hash: ${batch.basisHash}`, `- Diagnostic execution: ${batch.executionMode}`, `- Progress: ${batch.progress}`] : [],
    "",
    "## Required Review Jobs",
    "",
    ...batch.requiredRoles.length ? batch.requiredRoles.map((required) => {
      const job = batch.jobs.find((candidate) => candidate.role === required.role);
      return `- ${required.role} (${required.reviewDepth}): ${job?.status ?? "pending"}`;
    }) : ["- No review batch has been created yet."],
    ""
  ];
  if (batch.visibility === "coarse") {
    lines.push(
      "## Visibility",
      "",
      "- Waiting for all required jobs. Findings and reviewer submissions remain isolated until the batch is complete.",
      ""
    );
  } else {
    lines.push("## Findings", "");
    if (batch.findings.length) {
      for (const finding of batch.findings) {
        lines.push(`- ${finding.findingId} [${finding.severity}] ${finding.category}: ${finding.claim}`);
      }
    } else lines.push("- No findings submitted.");
    lines.push("", "## Dispositions", "");
    const dispositions = Object.entries(batch.dispositions ?? {});
    if (dispositions.length) {
      for (const [findingId, disposition] of dispositions) lines.push(`- ${findingId}: ${disposition.kind}`);
    } else lines.push("- No dispositions recorded.");
    lines.push("", "## Unresolved Blocking Findings", "");
    if (batch.unresolvedBlockingFindingIds.length) {
      for (const findingId of batch.unresolvedBlockingFindingIds) lines.push(`- ${findingId}`);
    } else lines.push("- None.");
    lines.push("");
  }
  if (model.staleBatches.length) {
    lines.push("## Stale / Superseded Batches", "");
    for (const stale of model.staleBatches) lines.push(`- ${stale.batchId}: ${stale.progress} (basis ${stale.basisHash})`);
    lines.push("");
  }
  return `${lines.join("\n")}
`;
}
function projectionDirectory(root2, featureId) {
  return path9.join(root2, ".dev-flow", "features", featureId, "review", "projections");
}
async function fsyncDirectory3(directory) {
  const handle = await open3(directory, "r");
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}
async function writeProjection(root2, featureId, markdown) {
  const sha256 = digest4(markdown);
  const directory = projectionDirectory(root2, featureId);
  const target = path9.join(directory, `${sha256}.md`);
  await mkdir3(directory, { recursive: true });
  try {
    const existing = await readFile6(target, "utf8");
    if (existing !== markdown) projectionError("existing review projection does not match its content address");
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    const temporary = path9.join(directory, `.${sha256}.${randomUUID3()}.tmp`);
    const handle = await open3(temporary, "wx");
    try {
      await handle.writeFile(markdown);
      await handle.sync();
    } finally {
      await handle.close();
    }
    try {
      await rename3(temporary, target);
    } catch (renameError) {
      if (renameError.code !== "EEXIST") throw renameError;
      if (await readFile6(target, "utf8") !== markdown) projectionError("concurrent review projection does not match its content address");
    }
    await fsyncDirectory3(directory);
  }
  return { path: `review/projections/${sha256}.md`, sha256 };
}
async function prepareReviewProjection(root2, state) {
  if (state.mode !== "routed" || !state.route || !state.classification) return;
  if (!reviewEnforcementRequired(state.route, state.classification.controls)) return;
  if (!state.review) projectionError("review-enabled feature has no review pointer", { featureId: state.featureId });
  const ledger = await readReviewLedger(root2, state);
  const model = reviewProjectionModel(state, ledger);
  const artifact = await writeProjection(root2, state.featureId, renderReviewProjection(model));
  state.artifacts["plan-review"] = artifact;
}
function validProjectionArtifact(artifact) {
  return Boolean(artifact) && /^review\/projections\/[a-f0-9]{64}\.md$/.test(artifact.path) && /^[a-f0-9]{64}$/.test(artifact.sha256) && artifact.path === `review/projections/${artifact.sha256}.md`;
}
async function readReviewProjection(root2, state) {
  if (state.mode !== "routed" || !state.route || !state.classification) return void 0;
  if (!reviewEnforcementRequired(state.route, state.classification.controls)) return void 0;
  const artifact = state.artifacts["plan-review"];
  if (!validProjectionArtifact(artifact)) projectionError("review projection artifact pointer is missing or invalid", { featureId: state.featureId });
  let markdown;
  try {
    markdown = await readFile6(path9.join(root2, ".dev-flow", "features", state.featureId, artifact.path), "utf8");
  } catch {
    projectionError("review projection artifact cannot be read", { featureId: state.featureId, path: artifact.path });
  }
  if (digest4(markdown) !== artifact.sha256) projectionError("review projection digest does not match artifact pointer", { featureId: state.featureId });
  const ledger = await readReviewLedger(root2, state);
  const model = reviewProjectionModel(state, ledger);
  const expected = renderReviewProjection(model);
  if (markdown !== expected) projectionError("review projection does not match the current review ledger", { featureId: state.featureId });
  return { artifact, model, markdown: expected };
}
async function assertCurrentReviewProjection(root2, state) {
  await readReviewProjection(root2, state);
}

// plugins/dev-flow/src/core/git-reconciliation.ts
import { execFile as execFile4 } from "node:child_process";
import { createHash as createHash11 } from "node:crypto";
import { lstat as lstat4, readFile as readFile7 } from "node:fs/promises";
import path10 from "node:path";
import { promisify as promisify4 } from "node:util";
var run3 = promisify4(execFile4);
async function git(root2, args, allowExitOne = false) {
  try {
    const result = await run3("git", args, { cwd: root2, encoding: "buffer", maxBuffer: 8 * 1024 * 1024 });
    return Buffer.from(result.stdout).toString("utf8");
  } catch (error) {
    const failure2 = error;
    if (allowExitOne && failure2.code === 1) return Buffer.from(failure2.stdout ?? "").toString("utf8");
    throw new DevFlowError("GIT_LINEAGE_UNAVAILABLE", "\u65E0\u6CD5\u8BFB\u53D6\u5F53\u524D Git \u5DE5\u4F5C\u533A\u3002", {
      cause: Buffer.from(failure2.stderr ?? failure2.message ?? "").toString("utf8").trim() || "Git \u547D\u4EE4\u5931\u8D25\u3002",
      impact: "\u65E0\u6CD5\u786E\u5B9A feature \u7684\u57FA\u7EBF\u3001\u63D0\u4EA4\u5F52\u5C5E\u548C\u6700\u7EC8\u4EA4\u4ED8\u5185\u5BB9\u3002",
      recoveryKind: "repair",
      recoveryInstruction: "\u68C0\u67E5 Git \u4ED3\u5E93\u548C\u5F53\u524D\u5206\u652F\u540E\uFF0C\u5237\u65B0\u72B6\u6001\uFF1B\u4E0D\u8981\u7EE7\u7EED finalize\u3002",
      retryOriginal: false,
      command: ["git", ...args].join(" ")
    });
  }
}
function normalizePath(value) {
  return normalizeProjectPath(normalizeUnicode(value).replaceAll("\\", "/"));
}
function builtInControlPath(value) {
  return value === ".git" || value.startsWith(".git/") || value === ".dev-flow" || value.startsWith(".dev-flow/") || value === "node_modules" || value.startsWith("node_modules/");
}
function statusKind(code) {
  if (code.includes("?") || code.includes("A")) return "untracked";
  if (code.includes("D")) return "deleted";
  if (code.includes("R")) return "renamed";
  if (code[0] !== " " && code[1] === " ") return "staged";
  return "unstaged";
}
async function contentHash(root2, relative) {
  try {
    const metadata = await lstat4(path10.join(root2, relative));
    if (!metadata.isFile()) return void 0;
    return createHash11("sha256").update(await readFile7(path10.join(root2, relative))).digest("hex");
  } catch {
    return void 0;
  }
}
async function dirtyPaths(root2, config) {
  const output = await git(root2, ["status", "--porcelain=v1", "-z", "--untracked-files=all", "--", ...config.governedRoots]);
  const items = output.split("\0").filter(Boolean);
  const result = {};
  for (let index = 0; index < items.length; index += 1) {
    const item = items[index];
    if (item.length < 4) continue;
    const code = item.slice(0, 2);
    const current = normalizePath(item.slice(3));
    if (builtInControlPath(current)) {
      if (code.includes("R")) index += 1;
      continue;
    }
    if (config.governedRootsExclude?.some((pattern) => current === pattern || current.startsWith(`${pattern}/`))) {
      if (code.includes("R")) index += 1;
      continue;
    }
    const entry = {
      status: statusKind(code),
      ...await contentHash(root2, current) ? { sha256: await contentHash(root2, current) } : {}
    };
    if (code.includes("R") && items[index + 1]) {
      entry.renamedFrom = normalizePath(items[index + 1]);
      index += 1;
    }
    result[current] = entry;
  }
  return result;
}
async function branchName(root2) {
  return (await git(root2, ["branch", "--show-current"])).trim();
}
async function head(root2) {
  return (await git(root2, ["rev-parse", "HEAD"])).trim();
}
async function fingerprint(root2, config) {
  return fingerprintGovernedRoots(root2, config);
}
async function pathFingerprints(root2, config) {
  return Object.fromEntries((await snapshotGovernedRoots(root2, config)).map((file) => [
    file.path,
    `${file.kind ?? "file"}:${file.sha256}:${file.mode}`
  ]));
}
async function captureWorkspaceLineage(root2, config) {
  const baseHead = await head(root2);
  const baseBranch = await branchName(root2);
  const startedDirty = await dirtyPaths(root2, config);
  const lastWorkspaceFingerprint = await fingerprint(root2, config);
  return {
    baseHead,
    baseBranch,
    observedHead: baseHead,
    startedDirty,
    ownership: {},
    ownershipSource: {},
    observedCommits: [],
    observedPathFingerprints: await pathFingerprints(root2, config),
    lastWorkspaceFingerprint,
    reconciliationStatus: "current"
  };
}
async function captureObservedCommits(root2, baseHead, observedHead) {
  if (!baseHead || !observedHead || baseHead === observedHead) return [];
  const output = await git(root2, ["log", "--format=%H%x00%P", `${baseHead}..${observedHead}`]);
  const commits = [];
  for (const line of output.split("\n").filter(Boolean)) {
    const [hash2, parents = ""] = line.split("\0");
    if (!hash2) continue;
    const paths = await git(root2, ["show", "--format=", "--name-only", "--pretty=", hash2]);
    commits.push({
      hash: hash2,
      parentHashes: parents.split(" ").filter(Boolean),
      changedPaths: paths.split("\n").map((value) => value.trim()).filter(Boolean).map(normalizePath).filter((file) => !builtInControlPath(file)),
      source: "unknown",
      observedAt: (/* @__PURE__ */ new Date()).toISOString()
    });
  }
  return commits;
}
async function changedPathsBetween(root2, baseHead, observedHead) {
  if (!baseHead || !observedHead || baseHead === observedHead) return [];
  const output = await git(root2, ["diff", "--name-only", "-z", baseHead, observedHead]);
  return output.split("\0").filter(Boolean).map(normalizePath).filter((file) => !builtInControlPath(file)).sort();
}
async function gitBranchAndHead(root2) {
  return { branch: await branchName(root2), head: await head(root2) };
}
async function reconcileWorkspaceLineage(root2, lineage, config) {
  const current = await gitBranchAndHead(root2);
  if (lineage.baseBranch && current.branch !== lineage.baseBranch) {
    throw new DevFlowError("GIT_BRANCH_CHANGED", "\u5F53\u524D\u5206\u652F\u5DF2\u5207\u6362\uFF0C\u4E0D\u80FD\u81EA\u52A8\u5047\u5B9A\u63D0\u4EA4\u5F52\u5C5E\u3002", {
      userMessage: "\u68C0\u6D4B\u5230\u5F53\u524D\u5206\u652F\u53D1\u751F\u53D8\u5316\uFF0C\u6D41\u7A0B\u5DF2\u5B89\u5168\u505C\u6B62\u3002",
      cause: `\u542F\u52A8\u5206\u652F\u4E3A ${lineage.baseBranch}\uFF0C\u5F53\u524D\u5206\u652F\u4E3A ${current.branch || "\u672A\u547D\u540D\u5206\u652F"}\u3002`,
      impact: "\u65E0\u6CD5\u8BC1\u660E\u5F53\u524D\u63D0\u4EA4\u5C5E\u4E8E\u539F feature\uFF0C\u5BA1\u67E5\u548C\u4EA4\u4ED8\u8BC1\u636E\u4FDD\u6301\u539F\u72B6\u3002",
      recoveryKind: "ask-user",
      recoveryInstruction: "\u5207\u56DE\u539F\u5206\u652F\u540E\u5237\u65B0\u72B6\u6001\uFF0C\u6216\u6682\u505C/\u7EC8\u6B62\u5F53\u524D feature\u3002",
      requiresUserDecision: true,
      retryOriginal: false,
      baseBranch: lineage.baseBranch,
      currentBranch: current.branch
    });
  }
  if (lineage.baseHead && !await isAncestor(root2, lineage.baseHead, current.head)) {
    throw new DevFlowError("GIT_HISTORY_REWRITE", "\u5F53\u524D HEAD \u4E0D\u662F\u542F\u52A8\u57FA\u7EBF\u7684\u540E\u4EE3\u3002", {
      userMessage: "\u68C0\u6D4B\u5230 Git \u5386\u53F2\u65E0\u6CD5\u8BC1\u660E\u8FDE\u7EED\uFF0C\u6D41\u7A0B\u5DF2\u5B89\u5168\u505C\u6B62\u3002",
      cause: "\u542F\u52A8\u57FA\u7EBF\u4E0D\u662F\u5F53\u524D HEAD \u7684\u7956\u5148\u3002",
      impact: "\u4EA4\u4ED8\u5185\u5BB9\u548C\u5BA1\u67E5\u8BC1\u636E\u7684\u63D0\u4EA4\u5F52\u5C5E\u4E0D\u786E\u5B9A\uFF0C\u4E0D\u80FD\u4F2A\u88C5\u6210\u529F\u3002",
      recoveryKind: "repair",
      recoveryInstruction: "\u6062\u590D\u53EF\u8BC1\u660E\u7684\u63D0\u4EA4\u94FE\u540E\u5237\u65B0\u72B6\u6001\uFF0C\u6216\u6682\u505C/\u7EC8\u6B62\u5F53\u524D feature\u3002",
      retryOriginal: false,
      baseHead: lineage.baseHead,
      currentHead: current.head
    });
  }
  const observedCommits = await captureObservedCommits(root2, lineage.baseHead, current.head);
  const knownCommits = new Set(lineage.observedCommits.map((commit) => commit.hash));
  return {
    ...lineage,
    observedHead: current.head,
    observedCommits: [...lineage.observedCommits, ...observedCommits.filter((commit) => !knownCommits.has(commit.hash))],
    observedPathFingerprints: await pathFingerprints(root2, config),
    lastWorkspaceFingerprint: await fingerprint(root2, config),
    reconciliationStatus: "current"
  };
}
async function isAncestor(root2, ancestor, descendant) {
  if (!ancestor || !descendant) return false;
  try {
    await git(root2, ["merge-base", "--is-ancestor", ancestor, descendant]);
    return true;
  } catch (error) {
    const failure2 = error;
    if (failure2.code === 1) return false;
    throw error;
  }
}
function ownershipForScope(lineage, inScope, outOfScope) {
  const ownership = { ...lineage.ownership };
  const ownershipSource = { ...lineage.ownershipSource };
  for (const file of Object.keys(lineage.startedDirty)) {
    if (ownership[file] !== void 0) continue;
    if (outOfScope.some((scope) => scope === "." || file === scope || file.startsWith(`${scope}/`))) {
      ownership[file] = "excluded";
      continue;
    }
    ownership[file] = "excluded";
    ownershipSource[file] = "startup-excluded";
  }
  void inScope;
  return { ...lineage, ownership, ownershipSource };
}
async function reconcileWorkspaceForFeature(root2, state, config) {
  const previouslyObservedHead = state.workspace.observedHead;
  let workspace = await reconcileWorkspaceLineage(root2, state.workspace, config);
  const committedPaths = await changedPathsBetween(root2, previouslyObservedHead, workspace.observedHead);
  const ownership = { ...workspace.ownership };
  const ownershipSource = { ...workspace.ownershipSource };
  for (const file of committedPaths) {
    if (state.scope.outOfScope.some((entry) => entry === "." || file === entry || file.startsWith(`${entry}/`))) {
      ownership[file] = "excluded";
    }
  }
  workspace = { ...workspace, ownership, ownershipSource };
  const dirty = Object.keys(await dirtyPaths(root2, config));
  const previousPaths = state.workspace.observedPathFingerprints ?? {};
  const currentPaths = workspace.observedPathFingerprints;
  const candidates = /* @__PURE__ */ new Set([...Object.keys(previousPaths), ...Object.keys(currentPaths), ...committedPaths, ...dirty]);
  const knownUnowned = /* @__PURE__ */ new Set([
    ...state.workspace.unownedPaths ?? [],
    ...Object.keys(state.workspace.startedDirty).filter((file) => state.workspace.ownership[file] === void 0)
  ]);
  const changedPaths2 = [...candidates].filter(
    (file) => previousPaths[file] !== currentPaths[file] || knownUnowned.has(file)
  ).sort();
  const unownedPaths = [.../* @__PURE__ */ new Set([...state.workspace.unownedPaths ?? [], ...changedPaths2])].filter((file) => workspace.ownership[file] === void 0).sort();
  return {
    workspace: { ...workspace, unownedPaths },
    contentChanged: changedPaths2.length > 0,
    changedPaths: changedPaths2
  };
}

// plugins/dev-flow/src/core/user-interactions.ts
import { randomUUID as randomUUID4 } from "node:crypto";

// plugins/dev-flow/src/core/text-normalization.ts
function normalizeReplyText(value) {
  return value.trim().replace(/[\s\u00A0\uFEFF]+/g, " ").replace(/[，。！？、；：,.!?;:()（）【】\[\]“”"']/g, "").toLowerCase();
}
function textCompatible(left, right) {
  const a = normalizeReplyText(left);
  const b = normalizeReplyText(right);
  if (!a || !b) return false;
  return a === b || a.startsWith(b) || b.startsWith(a);
}

// plugins/dev-flow/src/core/decision-language.ts
var confirmationTerms = ["\u786E\u8BA4", "\u540C\u610F", "\u6279\u51C6", "\u53EF\u4EE5", "\u597D\u7684", "\u884C", "\u6CA1\u95EE\u9898", "lgtm", "approved"];
function unique(matches) {
  const byOption = new Map(matches.map((match) => [match.option.id, match]));
  return byOption.size === 1 ? [...byOption.values()][0] : void 0;
}
var optionAliases = {
  "adopt-all": ["\u5168\u90E8\u7EB3\u5165", "\u90FD\u7EB3\u5165", "\u5168\u90FD\u7EB3\u5165", "\u5168\u90E8\u7B97\u5F53\u524D\u4EFB\u52A1", "\u90FD\u7B97\u5F53\u524D\u4EFB\u52A1", "\u8FD9\u4E9B\u90FD\u7B97\u5F53\u524D\u4EFB\u52A1\u7684"],
  "exclude-all": ["\u5168\u90E8\u6392\u9664", "\u90FD\u6392\u9664", "\u5168\u90FD\u6392\u9664", "\u8FD9\u4E9B\u90FD\u4E0D\u7B97\u5F53\u524D\u4EFB\u52A1", "\u90FD\u5148\u6392\u9664"],
  "one-by-one": ["\u9010\u4E2A\u786E\u8BA4", "\u4E00\u4E2A\u4E2A\u786E\u8BA4", "\u4E00\u4E2A\u4E2A\u6765", "\u9010\u4E2A\u6765"],
  adopt: ["\u7EB3\u5165\u5F53\u524D\u4EFB\u52A1", "\u7EB3\u5165", "\u7B97\u5F53\u524D\u4EFB\u52A1"],
  include: ["\u7EB3\u5165\u5F53\u524D\u4EFB\u52A1", "\u8FD9\u4E2A\u7B97\u5F53\u524D\u4EFB\u52A1", "\u7B97\u5F53\u524D\u4EFB\u52A1"],
  exclude: ["\u6392\u9664\u5E76\u5148\u5904\u7406", "\u6392\u9664", "\u4E0D\u7B97\u5F53\u524D\u4EFB\u52A1"],
  "request-changes": ["\u4FEE\u6539", "\u8981\u4FEE\u6539", "\u63D0\u51FA\u4FEE\u6539\u610F\u89C1", "\u8C03\u6574", "\u9700\u8981\u8C03\u6574"],
  accept: ["\u63A5\u53D7", "\u63A5\u53D7\u98CE\u9669", "\u4ECD\u7136\u7EE7\u7EED"],
  decline: ["\u4E0D\u63A5\u53D7", "\u62D2\u7EDD", "\u6682\u4E0D\u7EE7\u7EED"]
};
var interactionAliases = {
  "route-confirmation": {
    confirm: ["\u786E\u8BA4\u8DEF\u7EBF", "\u8DEF\u7EBF\u6CA1\u95EE\u9898", "\u5C31\u6309\u8FD9\u6761\u8DEF\u7EBF", "\u6309\u8FD9\u6761\u8DEF\u7EBF"]
  }
};
function matchNaturalDecision(kind, options, userReply) {
  const raw = userReply.trim();
  const normalized = normalizeReplyText(raw);
  if (!normalized) return void 0;
  const editMatch = raw.match(/^修改(?:需求|意见|计划|方案|)?[:：]?\s*([\s\S]*)$/u);
  if (editMatch) {
    const option = options.find((candidate) => candidate.id === "request-changes");
    if (option) return { option, comment: editMatch[1]?.trim() || void 0 };
  }
  const matches = [];
  for (const option of options) {
    const label = normalizeReplyText(option.label);
    if (!label) continue;
    if (label === normalized) matches.push({ option });
    if (kind !== "approval" && normalized.length >= 4 && label.includes(normalized)) {
      matches.push({ option });
    }
    if (option.id !== "confirm" && normalized.startsWith(label) && normalized.length > label.length) {
      matches.push({ option, comment: raw.slice(option.label.length).trim() });
    }
    if (normalized.startsWith(label) && normalized.length > label.length) {
      const tail = normalized.slice(label.length);
      if (tail === "\u63A8\u8350" || tail === "\u63A8\u8350\u9009\u9879" || tail === "recommended") matches.push({ option });
    }
    if (kind !== "approval" && (optionAliases[option.id] ?? []).some((alias) => normalizeReplyText(alias) === normalized)) {
      matches.push({ option });
    }
    if (kind !== "approval" && (interactionAliases[kind]?.[option.id] ?? []).some((alias) => normalizeReplyText(alias) === normalized)) {
      matches.push({ option });
    }
  }
  if (confirmationTerms.includes(normalized)) {
    for (const option of options) {
      if (option.id === "confirm" || option.id === "accept") matches.push({ option });
    }
  }
  return unique(matches);
}

// plugins/dev-flow/src/core/grill-interaction.ts
var answerCodes = ["A", "B", "C"];
function invalid4(message) {
  throw new DevFlowError("GRILL_PRESENTATION_INVALID", message, {
    userMessage: "\u5F53\u524D grill \u95EE\u9898\u4E0D\u7B26\u5408\u4EA4\u4E92\u5408\u540C\u3002",
    recoveryKind: "repair",
    recoveryInstruction: "\u63D0\u4F9B 2-3 \u4E2A\u5E26\u8BF4\u660E\u7684\u9009\u9879\uFF0C\u5E76\u660E\u786E\u4E00\u4E2A\u63A8\u8350\u9879\u53CA\u63A8\u8350\u7406\u7531\u3002",
    retryOriginal: false
  });
}
function buildGrillPresentation(input) {
  const question = input.question.trim();
  if (!question) invalid4("question must not be empty");
  if (!Array.isArray(input.options) || input.options.length < 2 || input.options.length > 3) {
    invalid4("grill must contain 2-3 options");
  }
  if (input.options.some((option) => option.id === "other" || !option.description?.trim())) {
    invalid4("grill options require descriptions and cannot use the reserved other id");
  }
  const reason = input.recommendation.reason.trim();
  if (!reason) invalid4("recommendation reason must not be empty");
  const recommendedIndex = input.options.findIndex((option) => option.id === input.recommendation.optionId);
  if (recommendedIndex < 0) invalid4("recommendation must reference one current option");
  const drawback = input.recommendation.drawback?.trim();
  const alternative = input.recommendation.alternative;
  const hasReminder = drawback !== void 0 || alternative !== void 0;
  if (hasReminder) {
    if (!drawback || !alternative || !alternative.condition.trim()) {
      invalid4("high-impact recommendation requires both a drawback and an alternative condition");
    }
    if (alternative.optionId === input.recommendation.optionId) {
      invalid4("alternative must reference a non-recommended option");
    }
    const alternativeIndex = input.options.findIndex((option) => option.id === alternative.optionId);
    if (alternativeIndex < 0) invalid4("alternative must reference one current option");
  }
  const options = input.options.map((option, index) => ({
    ...option,
    answerCode: answerCodes[index],
    recommended: index === recommendedIndex
  }));
  const lines = [question];
  for (const option of options) {
    lines.push("");
    lines.push(`${option.answerCode}. ${option.label}${option.recommended ? "\uFF08\u63A8\u8350\uFF09" : ""}`);
    lines.push(`   ${option.recommended ? reason : option.description.trim()}`);
  }
  if (hasReminder) {
    const alternativeOption = options.find((option) => option.id === alternative.optionId);
    lines.push("");
    lines.push(`\u63D0\u9192\uFF1A\u63A8\u8350\u65B9\u6848\u7684\u4E3B\u8981\u7F3A\u70B9\u662F ${drawback}\u3002`);
    lines.push(`\u5982\u679C ${alternative.condition.trim()}\uFF0C\u9009\u9879 ${alternativeOption.answerCode}\uFF08${alternativeOption.label}\uFF09\u53EF\u80FD\u66F4\u5408\u9002\u3002`);
  }
  lines.push("");
  const codes = options.map((option) => option.answerCode);
  lines.push(`\u8BF7\u56DE\u590D ${codes.slice(0, -1).join("\u3001")} \u6216 ${codes.at(-1)}\u3002`);
  lines.push("\u5982\u679C\u90FD\u4E0D\u5408\u9002\uFF0C\u8BF7\u56DE\u590D\u201C\u5176\u4ED6\uFF1A<\u4F60\u7684\u65B9\u6848\u548C\u7406\u7531>\u201D\u3002");
  return {
    question,
    options,
    recommendation: { optionId: input.recommendation.optionId, reason },
    text: lines.join("\n")
  };
}
function answerCodeFromReply(userReply) {
  const normalized = userReply.normalize("NFKC").trim().toUpperCase();
  if (/^[ABC]$/u.test(normalized)) return normalized;
  const positiveCodes = /* @__PURE__ */ new Set();
  const negativeCodes = /* @__PURE__ */ new Set();
  for (const match of normalized.matchAll(/(?<![A-Z])([ABC])(?![A-Z])/gu)) {
    const code = match[1];
    const before = normalized.slice(0, match.index);
    const after = normalized.slice((match.index ?? 0) + match[0].length);
    const negated = /(?:不选(?:择)?|不要|别选|排除|拒绝)\s*(?:方案|选项)?\s*$/u.test(before);
    if (negated) {
      negativeCodes.add(code);
      continue;
    }
    const selected2 = /(?:我?选(?:择)?|采用|使用|就用|按)\s*(?:方案|选项)?\s*$/u.test(before) || /(?:方案|选项)\s*$/u.test(before) || /^\s*(?:吧|来|更合适|就行|即可)(?:[。！!])?\s*$/u.test(after);
    if (selected2) positiveCodes.add(code);
  }
  if (positiveCodes.size !== 1) return void 0;
  const selected = [...positiveCodes][0];
  return negativeCodes.has(selected) ? void 0 : selected;
}
function normalizeMeaning(value) {
  return value.normalize("NFKC").trim().replace(/[\s\u00A0\uFEFF]+/g, "").replace(/[，。！？、；：,.!?;:()（）【】\[\]“”"']/g, "").toLowerCase();
}
function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
function matchGrillReply(input) {
  const rawReply = input.userReply.trim();
  if (!rawReply || input.options.length < 2 || input.options.length > 3) return void 0;
  const otherMatch = rawReply.match(/^其他\s*[:：+＋]\s*([\s\S]+)$/u) ?? rawReply.match(/^(?:这些|这几个|以上)?(?:都|全都)?不(?:合适|适合|接受|选(?:择)?)[了]?\s*[，,:：]?\s*([\s\S]+)$/u);
  const otherComment = otherMatch?.[1]?.trim();
  if (otherComment && otherComment.length >= 2) {
    return { kind: "other", rawReply, comment: otherComment };
  }
  const answerCode = answerCodeFromReply(rawReply);
  let optionIndex = answerCode ? answerCodes.indexOf(answerCode) : -1;
  if (optionIndex < 0) {
    const normalizedReply = normalizeMeaning(rawReply);
    const labelMatches = input.options.flatMap((option2, index) => {
      const label = normalizeMeaning(option2.label);
      const selectedLabel = normalizedReply === label || new RegExp(`^(?:\u6211)?(?:\u9009|\u9009\u62E9|\u91C7\u7528|\u4F7F\u7528|\u5C31\u7528|\u6309(?:\u65B9\u6848|\u9009\u9879)?)${escapeRegExp(label)}(?:\u5427|\u6765)?$`, "u").test(normalizedReply);
      return selectedLabel ? [index] : [];
    });
    if (labelMatches.length !== 1) return void 0;
    [optionIndex] = labelMatches;
  }
  const option = input.options[optionIndex];
  if (!option) return void 0;
  return {
    kind: "option",
    answerCode: answerCodes[optionIndex],
    selectedOptionId: option.id,
    rawReply
  };
}

// plugins/dev-flow/src/core/user-interactions.ts
function interactions(state) {
  if (!state.interactions) state.interactions = {};
  return state.interactions;
}
function validateOptions(options) {
  if (!Array.isArray(options) || options.length < 2 || options.length > 3) {
    throw new DevFlowError("INTERACTION_OPTIONS_INVALID", "\u6BCF\u4E2A\u7528\u6237\u95EE\u9898\u5FC5\u987B\u53EA\u6709 2-3 \u4E2A\u9009\u9879\u3002", { userMessage: "\u5F53\u524D\u95EE\u9898\u7684\u9009\u9879\u6570\u91CF\u4E0D\u7B26\u5408\u4EA4\u4E92\u5408\u540C\u3002", recoveryKind: "repair", recoveryInstruction: "\u5C06\u9009\u9879\u6536\u655B\u4E3A 2-3 \u4E2A\u7B80\u660E\u9009\u62E9\uFF0C\u5E76\u4FDD\u7559\u4E00\u4E2A\u63A8\u8350\u7B54\u6848\u3002", retryOriginal: false });
  }
  const seen = /* @__PURE__ */ new Set();
  for (const option of options) {
    if (!option || !/^[a-z][a-z0-9-]{0,63}$/.test(option.id) || !option.label.trim() || seen.has(option.id)) {
      throw new DevFlowError("INTERACTION_OPTIONS_INVALID", "option ids must be unique lowercase action ids with labels");
    }
    seen.add(option.id);
  }
}
function createInteraction(state, input) {
  validateOptions(input.options);
  if (input.kind === "grill") {
    if (!input.recommendation) throw new DevFlowError("GRILL_RECOMMENDATION_REQUIRED", "grill requires one explicit recommendation");
    buildGrillPresentation({ question: input.question ?? "", options: input.options, recommendation: input.recommendation });
  }
  const pending = Object.values(state.interactions ?? {}).filter((value) => value.status === "pending");
  if (pending.length) throw new DevFlowError("MULTIPLE_PENDING_DECISIONS", "\u540C\u4E00 feature \u53EA\u80FD\u5B58\u5728\u4E00\u4E2A\u5F85\u51B3\u95EE\u9898\u3002", { userMessage: "\u5F53\u524D\u5DF2\u6709\u4E00\u4E2A\u95EE\u9898\u7B49\u5F85\u56DE\u7B54\u3002", cause: "\u7CFB\u7EDF\u62D2\u7EDD\u5E76\u884C\u521B\u5EFA\u7B2C\u4E8C\u4E2A pending decision\u3002", impact: "\u65B0\u95EE\u9898\u6CA1\u6709\u88AB\u521B\u5EFA\uFF0C\u539F\u95EE\u9898\u4ECD\u7B49\u5F85\u56DE\u7B54\u3002", recoveryKind: "refresh", recoveryInstruction: "\u5148\u56DE\u7B54\u5F53\u524D\u95EE\u9898\uFF0C\u4E0B\u4E00\u56DE\u5408\u518D\u5904\u7406\u65B0\u95EE\u9898\u3002", retryOriginal: false });
  const current = findInteractionForTarget(state, input.target);
  if (current?.status === "pending") {
    throw new DevFlowError("INTERACTION_ALREADY_PENDING", input.target, { interactionId: current.id });
  }
  const interaction = {
    id: randomUUID4(),
    kind: input.kind,
    target: input.target,
    basisHash: input.basisHash,
    ...input.binding ? {
      binding: {
        batchId: input.binding.batchId,
        findingIds: [...input.binding.findingIds],
        findingSetHash: input.binding.findingSetHash
      }
    } : {},
    question: input.question,
    options: input.options.map((option) => ({ ...option })),
    ...input.recommendation ? { recommendation: { ...input.recommendation } } : {},
    presentedAt: (/* @__PURE__ */ new Date()).toISOString(),
    presentedRevision: state.revision,
    presentationEventId: input.presentationEventId ?? randomUUID4(),
    ...input.workspacePaths ? { workspacePaths: [...input.workspacePaths] } : {},
    ...input.workspaceBatchPaths ? { workspaceBatchPaths: [...input.workspaceBatchPaths] } : {},
    ...input.workspaceRemainingPaths ? { workspaceRemainingPaths: [...input.workspaceRemainingPaths] } : {},
    ...input.ratification ? { ratification: { ...input.ratification, factRefs: [...input.ratification.factRefs] } } : {},
    ...input.revision ? { revision: { ...input.revision, affected: [...input.revision.affected] } } : {},
    ...input.planRevision ? { planRevision: { ...input.planRevision, affectedUnits: [...input.planRevision.affectedUnits], redoUnits: [...input.planRevision.redoUnits], sideEffectUnits: [...input.planRevision.sideEffectUnits] } } : {},
    ...input.planRevisionBasis ? { planRevisionBasis: { ...input.planRevisionBasis } } : {},
    ...input.sideEffectRerun ? { sideEffectRerun: { units: [...input.sideEffectRerun.units] } } : {},
    ...input.acceptanceConfirmation ? { acceptanceConfirmation: { ...input.acceptanceConfirmation, acceptanceCriterionIds: [...input.acceptanceConfirmation.acceptanceCriterionIds] } } : {},
    status: "pending"
  };
  interactions(state)[interaction.id] = interaction;
  return interaction;
}
function getInteraction(state, interactionId) {
  const interaction = state.interactions?.[interactionId];
  if (!interaction) throw new DevFlowError("INTERACTION_NOT_FOUND", interactionId);
  return interaction;
}
function interactionResponse(state, interactionId) {
  const response = getInteraction(state, interactionId).response;
  return response ? Object.freeze({ ...response }) : void 0;
}
function findInteractionForTarget(state, target) {
  return Object.values(state.interactions ?? {}).find(
    (interaction) => interaction.target === target && interaction.status === "pending"
  );
}
function clearInteractionsForTarget(state, target) {
  if (!state.interactions) return;
  for (const [id, interaction] of Object.entries(state.interactions)) {
    if (interaction.target === target) delete state.interactions[id];
  }
  if (state.pendingDecision?.target === target) delete state.pendingDecision;
}
function clearInteractionsByKind(state, kind) {
  if (!state.interactions) return;
  for (const [id, interaction] of Object.entries(state.interactions)) {
    if (interaction.kind === kind) delete state.interactions[id];
  }
  if (state.pendingDecision?.kind === (kind === "risk-acceptance" ? "review-risk" : kind)) delete state.pendingDecision;
}
function optionFor(interaction, action) {
  const option = interaction.options.find((candidate) => candidate.id === action);
  if (!option) throw new DevFlowError("INTERACTION_ACTION_INVALID", action, { interactionId: interaction.id });
  return option;
}
function matchNaturalOption(interaction, userReply) {
  return matchNaturalDecision(interaction.kind, interaction.options, userReply);
}
function validateComment(option, comment) {
  const normalized = comment?.trim();
  if (option.requiresComment && !normalized) {
    throw new DevFlowError("INTERACTION_COMMENT_REQUIRED", option.id, { recoveryHint: "Provide a concise modification comment before submitting" });
  }
  return normalized || void 0;
}
function resolveNativeInteraction(state, interactionId, action, comment, host) {
  const interaction = getInteraction(state, interactionId);
  if (interaction.status !== "pending") throw new DevFlowError("INTERACTION_ALREADY_RESOLVED", interactionId);
  if (interaction.kind === "grill") {
    if (!interaction.recommendation) throw new DevFlowError("GRILL_RECOMMENDATION_REQUIRED", interactionId);
    const presentation = buildGrillPresentation({ question: interaction.question ?? "", options: interaction.options, recommendation: interaction.recommendation });
    const normalizedComment2 = comment?.trim();
    const selected = presentation.options.find((candidate) => candidate.id === action);
    if (!selected && action !== "other") throw new DevFlowError("INTERACTION_ACTION_INVALID", action, { interactionId: interaction.id });
    if (action === "other" && !normalizedComment2) throw new DevFlowError("INTERACTION_COMMENT_REQUIRED", "other", { recoveryHint: "\u8BF7\u8865\u5145\u4F60\u7684\u65B9\u6848\u548C\u7406\u7531" });
    if (selected?.requiresComment && !normalizedComment2) throw new DevFlowError("INTERACTION_COMMENT_REQUIRED", selected.id);
    const response2 = action === "other" ? {
      action: "other",
      kind: "other",
      comment: normalizedComment2,
      rawReply: `\u5176\u4ED6\uFF1A${normalizedComment2}`,
      source: "elicitation",
      host,
      respondedAt: (/* @__PURE__ */ new Date()).toISOString()
    } : {
      action: selected.id,
      kind: "option",
      answerCode: selected.answerCode,
      selectedOptionId: selected.id,
      rawReply: selected.answerCode,
      ...normalizedComment2 ? { comment: normalizedComment2 } : {},
      source: "elicitation",
      host,
      respondedAt: (/* @__PURE__ */ new Date()).toISOString()
    };
    interaction.status = "resolved";
    interaction.response = response2;
    if (state.pendingDecision?.target === interaction.target) delete state.pendingDecision;
    return response2;
  }
  const option = optionFor(interaction, action);
  const normalizedComment = validateComment(option, comment);
  const response = {
    action,
    ...normalizedComment ? { comment: normalizedComment } : {},
    source: "elicitation",
    host,
    respondedAt: (/* @__PURE__ */ new Date()).toISOString()
  };
  interaction.status = "resolved";
  interaction.response = response;
  if (state.pendingDecision?.target === interaction.target) delete state.pendingDecision;
  return response;
}
function resolveTextInteraction(state, interactionId, userReply, host, provenance, phraseAction) {
  const interaction = getInteraction(state, interactionId);
  if (interaction.status !== "pending") throw new DevFlowError("INTERACTION_ALREADY_RESOLVED", interactionId);
  const grillMatch = interaction.kind === "grill" ? matchGrillReply({ options: interaction.options, userReply }) : void 0;
  let match;
  if (grillMatch?.kind === "option") {
    match = { option: optionFor(interaction, grillMatch.selectedOptionId), ...grillMatch.comment ? { comment: grillMatch.comment } : {} };
  } else if (phraseAction) {
    match = { option: optionFor(interaction, phraseAction) };
  } else if (match = matchNaturalOption(interaction, userReply)) {
  }
  if (!match && grillMatch?.kind !== "other") {
    const grillRecovery = interaction.kind === "grill" ? "\u8BF7\u56DE\u590D A\u3001B \u6216 C\uFF1B\u5982\u679C\u90FD\u4E0D\u5408\u9002\uFF0C\u56DE\u590D\u201C\u5176\u4ED6\uFF1A<\u4F60\u7684\u65B9\u6848\u548C\u7406\u7531>\u201D\u3002" : "\u8BF7\u6362\u4E00\u79CD\u80FD\u552F\u4E00\u6307\u5411\u67D0\u4E2A\u9009\u9879\u7684\u7B80\u77ED\u8BF4\u6CD5\uFF0C\u6216\u76F4\u63A5\u56DE\u590D\u5B8C\u6574\u9009\u9879\u3002";
    throw new DevFlowError("DECISION_REPLY_NOT_RECOGNIZED", "\u56DE\u7B54\u6CA1\u6709\u7CBE\u786E\u5339\u914D\u5F53\u524D\u95EE\u9898\u7684\u9009\u9879\u3002", {
      userMessage: "\u6CA1\u6709\u8BC6\u522B\u51FA\u5F53\u524D\u95EE\u9898\u7684\u6709\u6548\u56DE\u7B54\u3002",
      cause: "\u56DE\u7B54\u65E0\u6CD5\u552F\u4E00\u5BF9\u5E94\u5F53\u524D\u9009\u9879\uFF0C\u4E5F\u4E0D\u662F\u53D7\u652F\u6301\u7684\u6279\u51C6\u77ED\u8BED\u3002",
      impact: "\u5F53\u524D\u95EE\u9898\u4ECD\u4FDD\u6301\u5F85\u56DE\u7B54\uFF0C\u6CA1\u6709\u4EFB\u4F55\u72B6\u6001\u88AB\u6539\u53D8\u3002",
      recoveryKind: "retry",
      recoveryInstruction: grillRecovery,
      retryOriginal: true
    });
  }
  const normalizedComment = grillMatch?.kind === "other" ? grillMatch.comment : validateComment(match.option, match.comment);
  const ids = provenance;
  const response = {
    action: grillMatch?.kind === "other" ? "other" : match.option.id,
    ...grillMatch ? grillMatch.kind === "other" ? {
      kind: "other",
      rawReply: grillMatch.rawReply
    } : {
      kind: "option",
      answerCode: grillMatch.answerCode,
      selectedOptionId: grillMatch.selectedOptionId,
      rawReply: grillMatch.rawReply
    } : {},
    ...normalizedComment ? { comment: normalizedComment } : {},
    source: "text",
    ...ids.promptEventId ? { promptEventId: ids.promptEventId } : {},
    ...ids.turnBoundaryEventId ? { turnBoundaryEventId: ids.turnBoundaryEventId } : {},
    userReply,
    host,
    respondedAt: (/* @__PURE__ */ new Date()).toISOString()
  };
  interaction.status = "resolved";
  interaction.response = response;
  if (state.pendingDecision?.target === interaction.target) delete state.pendingDecision;
  return response;
}
function resolveResponseForAnswer(draft, interaction, input) {
  const live = draft.interactions?.[interaction.id];
  if (!live || live.status !== "pending") {
    throw new DevFlowError("INTERACTION_ALREADY_RESOLVED", interaction.id);
  }
  if (input.source === "elicitation") {
    return resolveNativeInteraction(draft, interaction.id, input.action, input.comment, input.host);
  }
  return resolveTextInteraction(
    draft,
    interaction.id,
    input.promptText ?? input.userReply,
    input.host,
    { promptEventId: input.promptEventId },
    input.phraseAction
  );
}
function toPublicInteraction(interaction) {
  if (interaction.kind === "grill") {
    if (!interaction.recommendation) throw new DevFlowError("GRILL_RECOMMENDATION_REQUIRED", interaction.id);
    const presentation = buildGrillPresentation({
      question: interaction.question ?? "",
      options: interaction.options,
      recommendation: interaction.recommendation
    });
    return {
      kind: interaction.kind,
      status: interaction.status,
      question: presentation.question,
      options: presentation.options.map((option) => ({ ...option })),
      recommendation: { ...presentation.recommendation },
      presentation: presentation.text
    };
  }
  return {
    kind: interaction.kind,
    status: interaction.status,
    ...interaction.question ? { question: interaction.question } : {},
    options: interaction.options.map((option) => ({ ...option })),
    ...interaction.ratification ? { ratification: { ...interaction.ratification } } : {},
    ...interaction.revision ? { revision: { ...interaction.revision, affected: [...interaction.revision.affected] } } : {},
    ...interaction.planRevision ? { planRevision: { ...interaction.planRevision, affectedUnits: [...interaction.planRevision.affectedUnits], redoUnits: [...interaction.planRevision.redoUnits], sideEffectUnits: [...interaction.planRevision.sideEffectUnits] } } : {},
    ...interaction.acceptanceConfirmation ? { acceptanceConfirmation: { ...interaction.acceptanceConfirmation, acceptanceCriterionIds: [...interaction.acceptanceConfirmation.acceptanceCriterionIds] } } : {}
  };
}
function decisionHint(interaction) {
  if (interaction.kind === "approval") {
    const confirm = interaction.options.find((option) => option.id === "confirm");
    const changes = interaction.options.find((option) => option.id === "request-changes");
    const parts = [];
    if (confirm) parts.push("\u2705 \u5982\u9700\u786E\u8BA4\u5F00\u59CB\u6267\u884C\uFF0C\u76F4\u63A5\u56DE\u590D\u4EE5\u4E0B\u4EFB\u4E00\u77ED\u8BED\uFF1A\u786E\u8BA4 / \u786E\u8BA4\u9700\u6C42 / \u9700\u6C42\u5DF2\u786E\u8BA4 / \u540C\u610F\u9700\u6C42 / \u786E\u8BA4\u6267\u884C / \u6279\u51C6\u5B9E\u73B0 / \u540C\u610F\u5B9E\u73B0 / \u5F00\u59CB\u5B9E\u73B0 / \u5F00\u59CB\u6267\u884C / \u786E\u8BA4\u5F00\u59CB\u6267\u884C / \u540C\u610F\u5F00\u59CB\u6267\u884C / \u6279\u51C6\u6267\u884C / \u540C\u610F\u6267\u884C / approved / LGTM");
    if (changes) parts.push(`\u270F\uFE0F \u5982\u9700\u8C03\u6574\uFF0C\u8BF7\u56DE\u590D\uFF1A\u4FEE\u6539\u8BA1\u5212: <\u8865\u5145\u4F60\u7684\u4FEE\u6539\u610F\u89C1>`);
    return parts.join("\uFF1B");
  }
  if (interaction.kind === "grill") {
    if (!interaction.recommendation) throw new DevFlowError("GRILL_RECOMMENDATION_REQUIRED", interaction.id ?? interaction.target ?? "grill");
    return buildGrillPresentation({
      question: interaction.question ?? "",
      options: interaction.options,
      recommendation: interaction.recommendation
    }).text;
  }
  const lines = [interaction.question ?? "\u8BF7\u9009\u62E9\u65B9\u6848\uFF1A"];
  interaction.options.forEach((option, index) => {
    const recommended = index === 0 ? "\uFF08\u63A8\u8350\uFF09" : "";
    lines.push(`- ${option.label}${recommended}`);
  });
  lines.push("\u53EF\u76F4\u63A5\u56DE\u590D\u5B8C\u6574\u9009\u9879\u3001\u80FD\u552F\u4E00\u6307\u5411\u5B83\u7684\u7B80\u79F0\u6216\u540C\u4E49\u8BF4\u6CD5\uFF1B\u5982\u9700\u8865\u5145\u8BF4\u660E\uFF0C\u8BF7\u5728\u9009\u9879\u540E\u5199\u660E\u610F\u89C1\u3002");
  return lines.join("\n");
}

// plugins/dev-flow/src/core/approval.ts
var approvalPhrases = [
  "\u786E\u8BA4",
  "\u786E\u8BA4\u9700\u6C42",
  "\u9700\u6C42\u5DF2\u786E\u8BA4",
  "\u540C\u610F\u9700\u6C42",
  "\u786E\u8BA4\u6267\u884C",
  "\u6279\u51C6\u5B9E\u73B0",
  "\u540C\u610F\u5B9E\u73B0",
  "\u5F00\u59CB\u5B9E\u73B0",
  "\u5F00\u59CB\u6267\u884C",
  "\u786E\u8BA4\u5F00\u59CB\u6267\u884C",
  "\u540C\u610F\u5F00\u59CB\u6267\u884C",
  "\u6279\u51C6\u6267\u884C",
  "\u540C\u610F\u6267\u884C",
  "approved",
  "LGTM"
];
function approvalReplyHint() {
  return `\u2705 \u5982\u9700\u786E\u8BA4\u5F00\u59CB\u6267\u884C\uFF0C\u76F4\u63A5\u56DE\u590D\uFF1A${approvalPhrases.join(" / ")}`;
}
function isExplicitApproval(userReply) {
  const normalized = normalizeReplyText(userReply);
  return approvalPhrases.some((phrase) => normalizeReplyText(phrase) === normalized);
}

// plugins/dev-flow/src/core/decision-interactions.ts
function pendingInteraction(state) {
  return Object.values(state.interactions ?? {}).find((value) => value.status === "pending");
}
function rejectLegacyGrill() {
  throw new DevFlowError("GRILL_INTERACTION_RESTART_REQUIRED", "legacy grill state has no explicit recommendation", {
    userMessage: "\u8FD9\u4E2A grill \u95EE\u9898\u6765\u81EA\u65E7\u7248\u4EA4\u4E92\u5408\u540C\uFF0C\u4E0D\u80FD\u53EF\u9760\u7EE7\u7EED\u3002",
    recoveryKind: "repair",
    recoveryInstruction: "\u653E\u5F03\u53D7\u5F71\u54CD\u7684 feature\uFF0C\u518D\u7528\u5F53\u524D\u7248\u672C\u91CD\u65B0\u63D0\u51FA\u8BE5 grill \u95EE\u9898\u3002",
    retryOriginal: false
  });
}
function pendingDecisionForState(state) {
  const interaction = pendingInteraction(state);
  if (interaction) {
    if (interaction.kind === "grill" && !interaction.recommendation) rejectLegacyGrill();
    const grillPresentation = interaction.kind === "grill" && interaction.recommendation ? buildGrillPresentation({ question: interaction.question ?? "", options: interaction.options, recommendation: interaction.recommendation }) : void 0;
    return {
      kind: interaction.kind === "risk-acceptance" ? "review-risk" : interaction.kind,
      question: interaction.question ?? "\u8BF7\u9009\u62E9\u4E00\u4E2A\u65B9\u6848\u3002",
      options: grillPresentation ? grillPresentation.options.map((option) => ({ ...option })) : interaction.options.map((option, index) => ({ ...option, recommended: index === 0 })),
      ...grillPresentation ? {
        recommendation: { ...grillPresentation.recommendation },
        presentation: grillPresentation.text
      } : {},
      basisHash: interaction.basisHash,
      presentedAt: interaction.presentedAt,
      presentedRevision: interaction.presentedRevision ?? state.pendingDecision?.presentedRevision ?? state.revision,
      source: "core",
      target: interaction.target,
      ...interaction.presentationEventId ? { presentationEventId: interaction.presentationEventId } : {}
    };
  }
  if (state.pendingDecision?.kind === "grill") rejectLegacyGrill();
  return state.pendingDecision;
}
function publicPendingDecision(state) {
  const decision = pendingDecisionForState(state);
  if (!decision) return void 0;
  return {
    kind: decision.kind,
    question: decision.question,
    options: decision.options.map((option, index) => ({
      label: option.label,
      ...option.description ? { description: option.description } : {},
      ...option.answerCode ? { answerCode: option.answerCode } : {},
      recommended: option.recommended ?? index === 0,
      requiresComment: Boolean(option.requiresComment)
    })),
    ...decision.recommendation ? { recommendation: { ...decision.recommendation } } : {},
    ...decision.presentation ? { presentation: decision.presentation } : {}
  };
}
function matchDecisionReply(decision, userReply) {
  const normalized = normalizeReplyText(userReply);
  if (!normalized) throw new DevFlowError("DECISION_REPLY_REQUIRED", "\u8BF7\u56DE\u7B54\u5F53\u524D\u95EE\u9898\u3002", { userMessage: "\u5F53\u524D\u95EE\u9898\u8FD8\u6CA1\u6709\u5F97\u5230\u56DE\u7B54\u3002", recoveryKind: "retry", recoveryInstruction: "\u8BF7\u56DE\u590D\u4E00\u4E2A\u9009\u9879\u3001\u80FD\u552F\u4E00\u6307\u5411\u5B83\u7684\u7B80\u79F0\u6216\u540C\u4E49\u8BF4\u6CD5\u3002", retryOriginal: true });
  const options = decision.options;
  let match;
  if (decision.kind === "approval" && isExplicitApproval(userReply)) {
    const option = options.find((candidate) => candidate.id === "confirm");
    if (option) match = { option };
  }
  if (!match) match = matchNaturalDecision(decision.kind === "review-risk" ? "risk-acceptance" : decision.kind, options, userReply);
  if (!match) {
    throw new DevFlowError("DECISION_REPLY_NOT_RECOGNIZED", "\u56DE\u7B54\u6CA1\u6709\u7CBE\u786E\u5339\u914D\u5F53\u524D\u95EE\u9898\u7684\u9009\u9879\u3002", {
      userMessage: "\u6CA1\u6709\u8BC6\u522B\u51FA\u5F53\u524D\u95EE\u9898\u7684\u6709\u6548\u56DE\u7B54\u3002",
      cause: "\u56DE\u7B54\u65E0\u6CD5\u552F\u4E00\u5BF9\u5E94\u5F53\u524D\u9009\u9879\uFF0C\u4E5F\u4E0D\u662F\u53D7\u652F\u6301\u7684\u6279\u51C6\u77ED\u8BED\u3002",
      impact: "\u5F53\u524D\u95EE\u9898\u4ECD\u4FDD\u6301\u5F85\u56DE\u7B54\uFF0C\u6CA1\u6709\u4EFB\u4F55\u72B6\u6001\u88AB\u6539\u53D8\u3002",
      recoveryKind: "retry",
      recoveryInstruction: `\u8BF7\u6362\u4E00\u79CD\u80FD\u552F\u4E00\u6307\u5411\u67D0\u4E2A\u9009\u9879\u7684\u7B80\u77ED\u8BF4\u6CD5\uFF0C\u6216\u76F4\u63A5\u56DE\u590D\u5B8C\u6574\u9009\u9879\u3002\u5F53\u524D\u95EE\u9898\u53EF\u9009\u56DE\u7B54\uFF1A${options.map((option) => option.label).join("\u3001")}\u3002`,
      retryOriginal: true
    });
  }
  if (match.option.requiresComment && !match.comment?.trim()) {
    throw new DevFlowError("DECISION_COMMENT_REQUIRED", "\u8BE5\u9009\u9879\u9700\u8981\u8865\u5145\u8BF4\u660E\u3002", { userMessage: "\u8BF7\u8865\u5145\u4E00\u53E5\u5177\u4F53\u8BF4\u660E\u540E\u518D\u63D0\u4EA4\u3002", recoveryKind: "retry", recoveryInstruction: "\u5728\u9009\u9879\u540E\u8865\u5145\u4FEE\u6539\u610F\u89C1\u6216\u98CE\u9669\u8BF4\u660E\u3002", retryOriginal: true });
  }
  return match;
}
function pendingInteractionForDecision(state, decision) {
  return pendingInteraction(state) ?? (decision.target ? Object.values(state.interactions ?? {}).find((value) => value.target === decision.target) : void 0);
}

// plugins/dev-flow/src/core/host-health.ts
import { mkdir as mkdir4, open as open4, readFile as readFile8 } from "node:fs/promises";
import path11 from "node:path";
var healthWindowMs = 15 * 60 * 1e3;
var hostHealthPath = (root2) => path11.join(root2, ".dev-flow", "host-health.jsonl");
async function readHostHealth(root2) {
  try {
    const raw = await readFile8(hostHealthPath(root2), "utf8");
    return raw.split("\n").filter(Boolean).flatMap((line) => {
      try {
        const signal = JSON.parse(line);
        return (signal.host === "claude" || signal.host === "codex") && typeof signal.kind === "string" && typeof signal.eventId === "string" && typeof signal.at === "string" ? [signal] : [];
      } catch {
        return [];
      }
    });
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }
}
async function assertHostHealth(root2, host, operation) {
  const latest = [...await readHostHealth(root2)].reverse().find((signal) => signal.host === host);
  const ageMs = latest ? Date.now() - Date.parse(latest.at) : Number.POSITIVE_INFINITY;
  if (!latest) {
    throw new DevFlowError("HOOK_HEALTH_REQUIRED", `${host} hook health is required before ${operation}`, {
      userMessage: `\u5F00\u59CB${operation}\u524D\u6CA1\u6709\u53D1\u73B0 ${host} \u5BBF\u4E3B\u7684\u53EF\u4FE1 hook \u5065\u5EB7\u4FE1\u53F7\u3002`,
      cause: "\u5BBF\u4E3B\u63A5\u7EBF\u5C1A\u672A\u8BC1\u660E\u5F53\u524D\u4F1A\u8BDD\u80FD\u591F\u6355\u83B7\u7528\u6237\u56DE\u5408\u548C\u5199\u5165\u5F52\u5C5E\u3002",
      impact: "\u64CD\u4F5C\u6CA1\u6709\u6539\u53D8 feature\u3001ownership \u6216\u8BC1\u636E\u72B6\u6001\u3002",
      recoveryKind: "refresh",
      recoveryInstruction: `\u786E\u8BA4 ${host} manifest\u3001MCP \u4E0E hook \u5DF2\u5171\u540C\u5B89\u88C5\uFF0C\u91CD\u65B0\u5F00\u542F\u5BBF\u4E3B\u4F1A\u8BDD\u540E\u91CD\u8BD5\u3002`,
      retryOriginal: true,
      host,
      operation
    });
  }
  if (!Number.isFinite(ageMs) || ageMs > healthWindowMs) {
    throw new DevFlowError("HOOK_HEALTH_STALE", `${host} hook health is stale before ${operation}`, {
      userMessage: `${host} \u5BBF\u4E3B hook \u7684\u6700\u8FD1\u53EF\u4FE1\u4FE1\u53F7\u5DF2\u8FC7\u671F\uFF0C\u5DF2\u5B89\u5168\u6682\u505C\u5F53\u524D\u64CD\u4F5C\u3002`,
      cause: `\u6700\u8FD1\u4FE1\u53F7\u8DDD\u73B0\u5728\u7EA6 ${Math.round(ageMs / 6e4)} \u5206\u949F\uFF0C\u8D85\u8FC7 15 \u5206\u949F\u5065\u5EB7\u7A97\u53E3\u3002`,
      impact: "\u64CD\u4F5C\u6CA1\u6709\u6539\u53D8 feature\u3001ownership \u6216\u8BC1\u636E\u72B6\u6001\u3002",
      recoveryKind: "refresh",
      recoveryInstruction: `\u6062\u590D ${host} hook \u5E76\u91CD\u65B0\u5F00\u542F\u4F1A\u8BDD\u540E\u91CD\u8BD5\u539F\u64CD\u4F5C\uFF1B\u82E5\u53D1\u73B0\u672A\u77E5\u8DEF\u5F84\uFF0C\u518D\u8C03\u7528 dev_flow_reconcile_workspace\u3002`,
      retryOriginal: true,
      host,
      operation,
      latestAt: latest.at
    });
  }
  return latest;
}

// plugins/dev-flow/src/core/checkpoint-store.ts
import { readFile as readFile9 } from "node:fs/promises";
import path12 from "node:path";
async function readCheckpointManifest(root2, featureId, checkpointId) {
  const file = path12.join(root2, ".dev-flow", "features", featureId, "checkpoints", "manifests", `${checkpointId}.json`);
  let raw;
  try {
    raw = await readFile9(file, "utf8");
  } catch {
    throw new DevFlowError("CHECKPOINT_NOT_FOUND", "checkpoint manifest does not exist", { checkpointId });
  }
  try {
    const manifest = parseCheckpointManifest(JSON.parse(raw));
    if (manifest.checkpointId !== checkpointId) {
      throw new DevFlowError("CHECKPOINT_INTEGRITY_FAILED", "checkpoint manifest id does not match its path", { checkpointId });
    }
    return manifest;
  } catch (error) {
    if (error instanceof DevFlowError) throw error;
    if (error instanceof RollbackProtocolError && error.code === "UNSUPPORTED_CHECKPOINT_SCHEMA") {
      throw new DevFlowError("UNSUPPORTED_CHECKPOINT_SCHEMA", "\u68C0\u6D4B\u5230 Dev Flow 4.x checkpoint manifest schema v1\u3002", {
        checkpointId,
        recoveryHint: "\u56DE\u5230 4.x \u5B8C\u6210\u6216\u653E\u5F03\u8BE5 feature\uFF0C\u5907\u4EFD .dev-flow \u540E\u7528 5.0 \u91CD\u65B0\u521D\u59CB\u5316"
      });
    }
    throw new DevFlowError("CHECKPOINT_INTEGRITY_FAILED", "checkpoint manifest is unreadable", { checkpointId });
  }
}

// plugins/dev-flow/src/core/project-config-impact.ts
async function collectProjectConfigAffectedEvidence(root2, state, impact) {
  const commandIds = [.../* @__PURE__ */ new Set([...impact.modifiedCommandIds, ...impact.removedCommandIds])].sort();
  const empty = { commandIds, traceNodeIds: [], checkpointIds: [], verificationAttemptIds: [], reviewRoles: [] };
  if (!commandIds.length || !state) return empty;
  const changed = new Set(commandIds);
  const traceNodeIds = [];
  if (state.traceability) {
    const ledger = await readTraceability(root2, state);
    for (const node of Object.values(ledger.nodes)) {
      if (node.status === "tombstoned" || node.kind !== "rollback" && node.kind !== "implementation-unit") continue;
      const refs = (node.kind === "rollback" ? [...node.forwardVerification, ...node.rollbackVerification] : [...node.forwardVerification]).filter((ref) => typeof ref === "string");
      if (refs.some((id) => changed.has(id))) traceNodeIds.push(node.id);
    }
  }
  const verificationAttemptIds = state.verification.attempts.flatMap((value) => {
    const attempt = value;
    if (!Number.isInteger(attempt.id) || !attempt.verificationCommandHashes || typeof attempt.verificationCommandHashes !== "object") return [];
    return Object.keys(attempt.verificationCommandHashes).some((id) => changed.has(id)) ? [attempt.id] : [];
  }).sort((left, right) => left - right);
  const checkpointIds = [];
  for (const unit of state.implementationUnits ?? []) {
    if (!unit.checkpointId) continue;
    const manifest = await readCheckpointManifest(root2, state.featureId, unit.checkpointId);
    if (Object.keys(manifest.verificationCommandHashes ?? {}).some((id) => changed.has(id))) checkpointIds.push(unit.checkpointId);
  }
  return {
    featureId: state.featureId,
    commandIds,
    traceNodeIds: traceNodeIds.sort(),
    checkpointIds: checkpointIds.sort(),
    verificationAttemptIds,
    reviewRoles: traceNodeIds.length ? ["rollback-operability"] : []
  };
}

// plugins/dev-flow/src/core/ownership-workflow.ts
import { createHash as createHash12, randomUUID as randomUUID5 } from "node:crypto";

// plugins/dev-flow/src/core/interaction-provenance.ts
function presentationEventIndex(events, input) {
  const index = events.findIndex((record) => {
    if (record.type === "host-event") return false;
    if (input.presentationEventId) {
      if (!record.data || typeof record.data !== "object" || Array.isArray(record.data)) return false;
      return record.data.presentationEventId === input.presentationEventId;
    }
    return record.revision >= input.presentedRevision && Date.parse(record.at) >= Date.parse(input.presentedAt);
  });
  return index >= 0 ? index : void 0;
}
function promptFrom(record) {
  if (record.type !== "host-event" || !record.data || typeof record.data !== "object" || Array.isArray(record.data)) return void 0;
  const data = record.data;
  if (data.type !== "user-prompt" || typeof data.eventId !== "string" || typeof data.text !== "string" || data.host !== "claude" && data.host !== "codex") return void 0;
  const at = typeof data.at === "string" ? data.at : record.at;
  if (Number.isNaN(Date.parse(at))) return void 0;
  const question = typeof data.question === "string" && data.question.trim() ? data.question : void 0;
  return { eventId: data.eventId, text: data.text, host: data.host, at, ...question ? { question } : {} };
}
function eventMatchesPrompt(prompt, input) {
  if (textCompatible(prompt.text, input.userReply)) return true;
  return Boolean(input.question && prompt.question && textCompatible(prompt.question, input.question));
}
function resolvePromptEvent(events, input) {
  const consumed = new Set(input.consumedEventIds ?? []);
  const presentationIndex = presentationEventIndex(events, input);
  const isAfterPresentation = (record, index) => {
    if (presentationIndex !== void 0) return index > presentationIndex;
    return record.revision > input.presentedRevision && Date.parse(promptFrom(record)?.at ?? "") >= Date.parse(input.presentedAt);
  };
  const otherHost = events.flatMap((record, index) => {
    const prompt = promptFrom(record);
    if (!prompt || prompt.host === input.host || consumed.has(prompt.eventId)) return [];
    if (!isAfterPresentation(record, index)) return [];
    return eventMatchesPrompt(prompt, input) ? [prompt] : [];
  });
  if (otherHost.length) {
    throw new DevFlowError("HOST_EVENT_HOST_MISMATCH", "\u5339\u914D\u5230\u7684\u7528\u6237\u56DE\u7B54\u6765\u81EA\u53E6\u4E00\u4E2A\u5BBF\u4E3B\u3002", {
      userMessage: "\u8FD9\u6B21\u56DE\u7B54\u4E0D\u662F\u7531\u5F53\u524D\u5BBF\u4E3B\u6355\u83B7\u7684\uFF0C\u5F53\u524D\u95EE\u9898\u4ECD\u4FDD\u6301\u5F85\u56DE\u7B54\u3002",
      cause: "\u7528\u6237\u56DE\u7B54\u4E8B\u4EF6\u7684\u5BBF\u4E3B\u4E0E\u5F53\u524D\u56DE\u7B54\u5BBF\u4E3B\u4E0D\u4E00\u81F4\u3002",
      impact: "\u7CFB\u7EDF\u6CA1\u6709\u6D88\u8D39\u8DE8\u5BBF\u4E3B\u4E8B\u4EF6\uFF0C\u907F\u514D\u91CD\u590D\u6216\u9519\u8BEF\u786E\u8BA4\u3002",
      recoveryKind: "retry",
      recoveryInstruction: "\u8BF7\u5728\u5F53\u524D\u5BBF\u4E3B\u4E2D\u91CD\u65B0\u53D1\u9001\u4E00\u6B21\u5B8C\u6574\u56DE\u7B54\u3002",
      retryOriginal: true,
      actualHost: otherHost[0].host
    });
  }
  const candidates = events.flatMap((record, index) => {
    const prompt = promptFrom(record);
    if (!prompt || prompt.host !== input.host || consumed.has(prompt.eventId)) return [];
    if (!isAfterPresentation(record, index)) return [];
    return [{ prompt, record, index }];
  });
  const textMatches = candidates.filter(({ prompt }) => textCompatible(prompt.text, input.userReply));
  const matches = (textMatches.length ? textMatches : candidates.filter(({ prompt }) => Boolean(prompt.question))).map(({ prompt, record }) => ({ eventId: prompt.eventId, revision: record.revision, at: prompt.at, text: prompt.text, host: prompt.host }));
  if (matches.length === 0) {
    throw new DevFlowError("INTERACTION_PROVENANCE_UNAVAILABLE", "\u6CA1\u6709\u627E\u5230\u5448\u73B0\u95EE\u9898\u4E4B\u540E\u3001\u6765\u81EA\u5F53\u524D\u5BBF\u4E3B\u7684\u552F\u4E00\u7528\u6237\u56DE\u7B54\u3002", {
      userMessage: "\u6CA1\u6709\u786E\u8BA4\u5230\u8FD9\u6B21\u56DE\u7B54\u5C5E\u4E8E\u5F53\u524D\u95EE\u9898\u3002",
      cause: "\u5F53\u524D\u5BBF\u4E3B\u6CA1\u6709\u6355\u83B7\u5230\u5339\u914D\u7684\u540E\u7EED\u7528\u6237\u6D88\u606F\uFF0C\u6216\u8BE5\u6D88\u606F\u5DF2\u88AB\u6D88\u8D39\u3002",
      impact: "\u5F53\u524D\u95EE\u9898\u4ECD\u4FDD\u6301\u5F85\u56DE\u7B54\uFF0C\u7CFB\u7EDF\u4E0D\u4F1A\u731C\u6D4B\u7528\u6237\u610F\u56FE\u3002",
      recoveryKind: "retry",
      recoveryInstruction: "\u5F53\u524D\u5BBF\u4E3B\u6CA1\u6709\u6355\u83B7\u8FD9\u6761\u7528\u6237\u6D88\u606F\u3002\u4E0D\u8981\u8BA9\u7528\u6237\u6539\u5199\u6216\u91CD\u590D\u540C\u4E00\u7B54\u6848\uFF1B\u5148\u8FD0\u884C dev_flow_doctor \u6062\u590D UserPromptSubmit/AskUserQuestion hook\uFF0C\u518D\u53EA\u5448\u73B0\u5F53\u524D\u95EE\u9898\u4E00\u6B21\u3002",
      retryOriginal: true
    });
  }
  if (matches.length > 1) {
    throw new DevFlowError("INTERACTION_PROVENANCE_AMBIGUOUS", "\u540C\u4E00\u56DE\u7B54\u5339\u914D\u4E86\u591A\u4E2A\u672A\u6D88\u8D39\u7684\u7528\u6237\u4E8B\u4EF6\u3002", {
      userMessage: "\u65E0\u6CD5\u552F\u4E00\u786E\u8BA4\u8FD9\u6B21\u56DE\u7B54\uFF0C\u5F53\u524D\u95EE\u9898\u4ECD\u4FDD\u6301\u5F85\u56DE\u7B54\u3002",
      cause: "\u5B58\u5728\u591A\u4E2A\u76F8\u540C\u6587\u672C\u7684\u5019\u9009\u7528\u6237\u6D88\u606F\u3002",
      impact: "\u4E3A\u907F\u514D\u8BEF\u6D88\u8D39\uFF0C\u7CFB\u7EDF\u6CA1\u6709\u4EFB\u9009\u4E00\u4E2A\u4E8B\u4EF6\u3002",
      recoveryKind: "retry",
      recoveryInstruction: "\u8BF7\u91CD\u65B0\u53D1\u9001\u4E00\u6B21\u5B8C\u6574\u56DE\u7B54\uFF0C\u907F\u514D\u91CD\u590D\u63D0\u4EA4\u3002",
      retryOriginal: true,
      matchCount: matches.length
    });
  }
  return matches[0];
}
function resolveInteractionPromptEvent(events, state, interaction, input) {
  const presentedRevision = Number.isInteger(interaction.presentedRevision) ? interaction.presentedRevision : state.pendingDecision?.target === interaction.target ? state.pendingDecision.presentedRevision : Math.max(0, state.revision - 1);
  return resolvePromptEvent(events, {
    ...input,
    presentedAt: interaction.presentedAt,
    presentedRevision,
    ...interaction.presentationEventId ? { presentationEventId: interaction.presentationEventId } : {},
    ...interaction.question ? { question: interaction.question } : {}
  });
}
function consumedPromptEventIds(events) {
  const ids = /* @__PURE__ */ new Set();
  for (const event of events) {
    if (!event.data || typeof event.data !== "object" || Array.isArray(event.data)) continue;
    const data = event.data;
    for (const key of ["promptEventId", "eventId"]) {
      if (key === "eventId") continue;
      if (typeof data[key] === "string") ids.add(data[key]);
    }
  }
  return ids;
}

// plugins/dev-flow/src/core/ownership-workflow.ts
function objectiveForSwitch(input) {
  return typeof input.objective === "string" ? input.objective.trim() : "\u672A\u547D\u540D\u9700\u6C42";
}
function unknownOwnershipPaths(state) {
  const candidates = new Set(state.workspace.unownedPaths ?? Object.keys(state.workspace.startedDirty));
  return [...candidates].filter((file) => state.workspace.ownership[file] === void 0).sort();
}
function presentedOwnershipPaths(interaction) {
  const persisted = interaction.workspaceBatchPaths ?? interaction.workspacePaths;
  if (persisted?.length) return [...new Set(persisted)].sort();
  const legacyPrefix = "workspace-ownership:";
  return interaction.target.startsWith(legacyPrefix) && interaction.target.length > legacyPrefix.length ? [interaction.target.slice(legacyPrefix.length)] : [];
}
function workspaceOwnershipQuestion(paths, single) {
  if (single) return `\u8DEF\u5F84\u201C${paths[0]}\u201D\u662F\u5426\u5C5E\u4E8E\u5F53\u524D\u4EFB\u52A1\uFF1F`;
  return `\u53D1\u73B0 ${paths.length} \u4E2A\u65E0\u6CD5\u5F52\u5C5E\u7684\u5DE5\u4F5C\u533A\u8DEF\u5F84\uFF1A
${paths.map((file) => `- ${file}`).join("\n")}
\u8BF7\u9009\u62E9\u5904\u7406\u65B9\u5F0F\u3002`;
}
function presentWorkspaceOwnership(state, paths, options = {}) {
  const currentPaths = [...new Set(paths)].sort();
  const batchPaths = [...new Set(options.batchPaths ?? currentPaths)].sort();
  const single = options.single ?? currentPaths.length === 1;
  const presentationEventId = options.presentationEventId ?? randomUUID5();
  const basisHash2 = createHash12("sha256").update(JSON.stringify({ kind: "workspace-ownership", paths: batchPaths, fingerprint: state.workspace.lastWorkspaceFingerprint })).digest("hex");
  const interaction = createInteraction(state, {
    kind: "workspace-ownership",
    target: `workspace:${createHash12("sha256").update(batchPaths.join("\n")).digest("hex").slice(0, 16)}:${currentPaths[0] ?? "batch"}`,
    basisHash: basisHash2,
    question: workspaceOwnershipQuestion(currentPaths, single),
    options: single ? [
      { id: "adopt", label: "\u7EB3\u5165\u5F53\u524D\u4EFB\u52A1" },
      { id: "exclude", label: "\u6392\u9664\u5E76\u5148\u5904\u7406" }
    ] : [
      { id: "adopt-all", label: "\u5168\u90E8\u7EB3\u5165\u5F53\u524D\u4EFB\u52A1" },
      { id: "exclude-all", label: "\u5168\u90E8\u6392\u9664\u5E76\u5148\u5904\u7406" },
      { id: "one-by-one", label: "\u9010\u4E2A\u786E\u8BA4" }
    ],
    presentationEventId,
    workspacePaths: currentPaths,
    workspaceBatchPaths: batchPaths,
    ...options.remainingPaths ? { workspaceRemainingPaths: [...options.remainingPaths] } : {}
  });
  return { interaction, presentationEventId };
}
async function resolveOwnershipForAnswer(ctx) {
  const { root: root2, featureId, expectedRevision, host, credential, interaction, state } = ctx;
  const decision = pendingDecisionForState(state);
  if (decision?.kind !== "workspace-ownership" || interaction.status !== "pending") {
    throw new DevFlowError("WORKSPACE_OWNERSHIP_NOT_PENDING", "\u5F53\u524D\u6CA1\u6709\u5F85\u786E\u8BA4\u7684\u5DE5\u4F5C\u533A\u5F52\u5C5E\u95EE\u9898\u3002");
  }
  let promptEventId;
  let promptText;
  if (credential.source === "text") {
    const events = await readFeatureEvents(root2, featureId);
    const prompt = resolveInteractionPromptEvent(events, state, interaction, { host, userReply: credential.userReply });
    promptEventId = prompt.eventId;
    promptText = prompt.text;
  }
  const presentedPaths = presentedOwnershipPaths(interaction);
  const currentPaths = unknownOwnershipPaths(state);
  if (JSON.stringify(presentedPaths) !== JSON.stringify(currentPaths)) {
    throw new DevFlowError("WORKSPACE_OWNERSHIP_STALE", "\u5F85\u786E\u8BA4\u8DEF\u5F84\u6E05\u5355\u5DF2\u53D8\u5316\uFF0C\u8BF7\u91CD\u65B0\u5BF9\u8D26\u540E\u56DE\u7B54\u3002", {
      userMessage: "\u5DE5\u4F5C\u533A\u8DEF\u5F84\u6E05\u5355\u5DF2\u53D8\u5316\uFF0C\u65E7\u56DE\u7B54\u4E0D\u4F1A\u88AB\u5957\u7528\u3002",
      cause: "\u5448\u73B0\u540E\u7684\u672A\u77E5\u8DEF\u5F84\u96C6\u5408\u4E0E\u5F53\u524D\u672A\u77E5\u8DEF\u5F84\u96C6\u5408\u4E0D\u4E00\u81F4\u3002",
      impact: "\u7CFB\u7EDF\u6CA1\u6709\u6279\u91CF\u63A5\u7EB3\u6216\u6392\u9664\u65B0\u7684\u672A\u786E\u8BA4\u8DEF\u5F84\u3002",
      recoveryKind: "refresh",
      recoveryInstruction: "\u5148\u8C03\u7528 dev_flow_reconcile_workspace \u5237\u65B0\u6E05\u5355\uFF0C\u518D\u56DE\u7B54\u5F53\u524D\u95EE\u9898\u3002",
      retryOriginal: true,
      paths: presentedPaths
    });
  }
  const matchedId = credential.source === "elicitation" ? credential.action : matchDecisionReply(decision, promptText ?? credential.userReply).option.id;
  let nextPresentationEventId;
  const next = await mutatePrepared(root2, featureId, expectedRevision, "workspace-ownership-answered", async (current) => {
    const draftInteraction = current.interactions?.[interaction.id];
    if (!draftInteraction || draftInteraction.status !== "pending" || pendingDecisionForState(current)?.basisHash !== decision.basisHash) {
      throw new DevFlowError("WORKSPACE_OWNERSHIP_STALE", "\u5DE5\u4F5C\u533A\u5F52\u5C5E\u95EE\u9898\u7684\u4F9D\u636E\u5DF2\u53D8\u5316\uFF0C\u8BF7\u91CD\u65B0\u5BF9\u8D26\u540E\u56DE\u7B54\u3002");
    }
    const batchPaths = presentedOwnershipPaths(draftInteraction);
    const unknown = unknownOwnershipPaths(current);
    if (JSON.stringify(batchPaths) !== JSON.stringify(unknown)) {
      throw new DevFlowError("WORKSPACE_OWNERSHIP_STALE", "\u5F85\u786E\u8BA4\u8DEF\u5F84\u6E05\u5355\u5DF2\u53D8\u5316\uFF0C\u8BF7\u91CD\u65B0\u5BF9\u8D26\u540E\u56DE\u7B54\u3002", {
        userMessage: "\u5DE5\u4F5C\u533A\u8DEF\u5F84\u6E05\u5355\u5DF2\u53D8\u5316\uFF0C\u65E7\u56DE\u7B54\u4E0D\u4F1A\u88AB\u5957\u7528\u3002",
        cause: "\u5448\u73B0\u540E\u7684\u672A\u77E5\u8DEF\u5F84\u96C6\u5408\u4E0E\u5F53\u524D\u672A\u77E5\u8DEF\u5F84\u96C6\u5408\u4E0D\u4E00\u81F4\u3002",
        impact: "\u7CFB\u7EDF\u6CA1\u6709\u6279\u91CF\u63A5\u7EB3\u6216\u6392\u9664\u65B0\u7684\u672A\u786E\u8BA4\u8DEF\u5F84\u3002",
        recoveryKind: "refresh",
        recoveryInstruction: "\u5148\u8C03\u7528 dev_flow_reconcile_workspace \u5237\u65B0\u6E05\u5355\uFF0C\u518D\u56DE\u7B54\u5F53\u524D\u95EE\u9898\u3002",
        retryOriginal: true,
        paths: batchPaths
      });
    }
    return {
      mutate: (draft) => {
        const response = resolveResponseForAnswer(draft, interaction, {
          source: credential.source,
          action: credential.source === "elicitation" ? credential.action : void 0,
          comment: credential.source === "elicitation" ? credential.comment : void 0,
          userReply: credential.source === "text" ? credential.userReply : void 0,
          promptText,
          promptEventId,
          host
        });
        void response;
        const livePaths = draftInteraction.workspacePaths ?? batchPaths;
        if (matchedId === "adopt-all" || matchedId === "adopt" || matchedId === "include") {
          for (const file of matchedId === "adopt" || matchedId === "include" ? livePaths : batchPaths) {
            draft.workspace.ownership[file] = "feature";
            draft.workspace.ownershipSource[file] = "user-adopted";
          }
        } else if (matchedId === "exclude-all" || matchedId === "exclude") {
          for (const file of matchedId === "exclude" ? livePaths : batchPaths) {
            draft.workspace.ownership[file] = "excluded";
          }
        }
        draft.workspace.unownedPaths = (draft.workspace.unownedPaths ?? []).filter((file) => draft.workspace.ownership[file] === void 0);
        if (matchedId === "one-by-one") {
          const first = batchPaths[0];
          const nextInteraction = presentWorkspaceOwnership(draft, [first], { batchPaths, remainingPaths: batchPaths.slice(1), single: true });
          nextPresentationEventId = nextInteraction.presentationEventId;
        } else if ((matchedId === "adopt" || matchedId === "include" || matchedId === "exclude") && draftInteraction.workspaceRemainingPaths?.length) {
          const remaining = draftInteraction.workspaceRemainingPaths;
          const nextInteraction = presentWorkspaceOwnership(draft, [remaining[0]], { batchPaths: remaining, remainingPaths: remaining.slice(1), single: true });
          nextPresentationEventId = nextInteraction.presentationEventId;
        }
        draft.lastUpdatedBy = { host, pluginVersion: "5.1.0" };
      },
      eventData: () => ({
        promptEventId,
        action: matchedId,
        ...nextPresentationEventId ? { presentationEventId: nextPresentationEventId } : {}
      })
    };
  });
  return { state: next, action: matchedId };
}
var TASK_SWITCH_QUESTION = "\u5F53\u524D\u5DF2\u6709\u4E00\u4E2A\u8FDB\u884C\u4E2D\u7684\u4EFB\u52A1\u3002\u5F00\u59CB\u65B0\u4EFB\u52A1\u524D\uFF0C\u4F60\u5E0C\u671B\u5982\u4F55\u5904\u7406\u65E7\u4EFB\u52A1\uFF1F";
function presentTaskSwitch(state, input) {
  const presentationEventId = randomUUID5();
  const interaction = createInteraction(state, {
    kind: "task-switch",
    target: `task-switch:${input.targetFeatureId}`,
    basisHash: createHash12("sha256").update(`${state.featureId}
${input.objective}`).digest("hex"),
    question: TASK_SWITCH_QUESTION,
    options: [
      { id: "finish-old", label: "\u5148\u5B8C\u6210\u5F53\u524D\u4EFB\u52A1" },
      { id: "pause-old", label: "\u6682\u505C\u5F53\u524D\u4EFB\u52A1\u540E\u5F00\u59CB\u65B0\u4EFB\u52A1" },
      { id: "return-old", label: "\u8FD4\u56DE\u5F53\u524D\u4EFB\u52A1" }
    ],
    presentationEventId
  });
  return { interaction, presentationEventId };
}
async function resolveTaskSwitchForAnswer(ctx) {
  const { root: root2, featureId, expectedRevision, host, credential, interaction, state } = ctx;
  const decision = pendingDecisionForState(state);
  if (decision?.kind !== "task-switch" || interaction.status !== "pending") {
    throw new DevFlowError("TASK_SWITCH_NOT_PENDING", "\u5F53\u524D\u6CA1\u6709\u5F85\u5904\u7406\u7684\u4EFB\u52A1\u5207\u6362\u95EE\u9898\u3002", { recoveryHint: "\u5237\u65B0\u72B6\u6001\u540E\u7EE7\u7EED\u5F53\u524D\u4EFB\u52A1" });
  }
  let promptEventId;
  let promptText;
  if (credential.source === "text") {
    const events = await readFeatureEvents(root2, featureId);
    const prompt = resolveInteractionPromptEvent(events, state, interaction, { host, userReply: credential.userReply });
    promptEventId = prompt.eventId;
    promptText = prompt.text;
  }
  const matchedId = credential.source === "elicitation" ? credential.action : matchDecisionReply(decision, promptText ?? credential.userReply).option.id;
  const next = await mutate(root2, featureId, expectedRevision, "task-switch-answered", (draft) => {
    resolveResponseForAnswer(draft, interaction, {
      source: credential.source,
      action: credential.source === "elicitation" ? credential.action : void 0,
      comment: credential.source === "elicitation" ? credential.comment : void 0,
      userReply: credential.source === "text" ? credential.userReply : void 0,
      promptText,
      promptEventId,
      host
    });
    if (matchedId === "pause-old") {
      draft.lifecycle = "paused";
      draft.resumeSummary = "\u65E7\u4EFB\u52A1\u5DF2\u6682\u505C\uFF1B\u6062\u590D\u65F6\u4F1A\u81EA\u52A8\u5BF9\u8D26\u5DE5\u4F5C\u533A\u3002";
    }
    draft.lastUpdatedBy = { host, pluginVersion: "5.1.0" };
  }, () => ({ targetFeatureId: interaction.target.slice("task-switch:".length), action: matchedId, promptEventId }));
  return { state: next, action: matchedId };
}
async function reconcileWorkspace(root2, id, expectedRevision, host) {
  const state = await readState(root2, id);
  const config = await readProjectConfig(root2);
  const { workspace, contentChanged, changedPaths: changedPaths2 } = await reconcileWorkspaceForFeature(root2, state, config);
  const legalCheckpointPaths = contentChanged ? await legalActiveUnitChanges(root2, state, changedPaths2) : /* @__PURE__ */ new Set();
  const active = state.lifecycle === "finalized" && contentChanged ? await readActive(root2) : void 0;
  const reopenedLifecycle = state.lifecycle === "finalized" && contentChanged ? !active || active.featureId === id ? "active" : "paused" : void 0;
  const checkpointAffected = contentChanged ? checkpointAffectedByPaths(state, changedPaths2, legalCheckpointPaths) : false;
  let presentationEventId;
  return mutate(root2, id, expectedRevision, "workspace-reconciled", (draft) => {
    draft.workspace = workspace;
    if (contentChanged) markAffectedEvidenceStale(draft, changedPaths2, reopenedLifecycle, legalCheckpointPaths);
    presentationEventId = queueNextOwnershipDecision(draft);
    draft.lastUpdatedBy = { host, pluginVersion: "5.1.0" };
  }, () => ({
    observedHead: workspace.observedHead,
    commitCount: workspace.observedCommits.length,
    contentChanged,
    checkpointAffected,
    reopenedLifecycle,
    unresolvedOwnership: changedPaths2.filter((file) => workspace.ownership[file] === void 0),
    ...presentationEventId ? { presentationEventId } : {}
  }));
}
function queueNextOwnershipDecision(draft) {
  if (pendingDecisionForState(draft)) return void 0;
  const paths = unknownOwnershipPaths(draft);
  if (!paths.length) return void 0;
  return presentWorkspaceOwnership(draft, paths).presentationEventId;
}
function markAffectedEvidenceStale(draft, changedPaths2, reopenedLifecycle, legalCheckpointPaths = /* @__PURE__ */ new Set()) {
  const checkpointAffected = checkpointAffectedByPaths(draft, changedPaths2, legalCheckpointPaths);
  draft.evidenceFreshness = {
    ...draft.evidenceFreshness,
    verification: draft.verification.satisfiedByAttemptId !== void 0 ? "stale" : draft.evidenceFreshness.verification,
    checkpoint: checkpointAffected ? "stale" : draft.evidenceFreshness.checkpoint,
    implementation: "current"
  };
  if (checkpointAffected) {
    delete draft.steps.implementation;
    delete draft.steps.code_review;
    delete draft.steps.verification;
    delete draft.steps.finalize;
  } else if (draft.steps.verification?.status === "satisfied" || draft.steps.finalize?.status === "satisfied") {
    delete draft.steps.verification;
    delete draft.steps.finalize;
  }
  draft.logicComplete = false;
  if (reopenedLifecycle) {
    draft.lifecycle = reopenedLifecycle;
    delete draft.deliverySnapshot;
    const openStep = currentOpenStep(draft) ?? "\u5F53\u524D\u9636\u6BB5";
    draft.resumeSummary = reopenedLifecycle === "active" ? `\u5DF2\u64A4\u9500\u8FC7\u671F\u7684\u5B8C\u6210\u58F0\u660E\uFF0C\u4ECE\u201C${openStep}\u201D\u7EE7\u7EED\u3002` : `\u5B8C\u6210\u540E\u68C0\u6D4B\u5230\u771F\u5B9E\u5185\u5BB9\u6F02\u79FB\uFF1B\u53E6\u4E00\u4E2A feature \u6B63\u5728\u8FDB\u884C\uFF0C\u672C\u4EFB\u52A1\u5DF2\u6062\u590D\u4E3A\u6682\u505C\u72B6\u6001\u5E76\u56DE\u9000\u5230\u201C${openStep}\u201D\u3002`;
  }
  draft.obligations = reopenObligations(draft.obligations, [
    ...checkpointAffected ? ["checkpoint"] : [],
    "verification"
  ]);
}
function checkpointAffectedByPaths(state, changedPaths2, legalCheckpointPaths) {
  const externallyChangedPaths = changedPaths2.filter((file) => !legalCheckpointPaths.has(file));
  return state.checkpoints?.some((checkpoint) => checkpoint.files.some((file) => externallyChangedPaths.includes(file))) ?? false;
}
async function legalActiveUnitChanges(root2, state, changedPaths2) {
  const activeUnit = state.implementationUnits?.find((unit) => unit.status === "active" || unit.status === "verified");
  if (!activeUnit || !state.traceability || !state.checkpoints?.length) return /* @__PURE__ */ new Set();
  const trace2 = await readTraceability(root2, state);
  const node = trace2.nodes[activeUnit.unitId];
  if (!node || node.kind !== "rollback" || node.status !== "current") return /* @__PURE__ */ new Set();
  const events = await readFeatureEvents(root2, state.featureId);
  let lastCheckpointEventIndex = -1;
  for (let index = events.length - 1; index >= 0; index -= 1) {
    if (events[index].type === "automatic-checkpoint-captured") {
      lastCheckpointEventIndex = index;
      break;
    }
  }
  const legal = /* @__PURE__ */ new Set();
  for (const file of changedPaths2) {
    if (!pathWithinFileScope(file, node.fileScope)) continue;
    let event;
    for (let index = events.length - 1; index > lastCheckpointEventIndex; index -= 1) {
      const candidate = events[index];
      const after = candidate.type === "trusted-write-owned" ? candidate.data.after : void 0;
      if (typeof after?.[file] === "string") {
        event = candidate;
        break;
      }
    }
    if (!event) continue;
    const expected = event.data.after[file];
    if (expected === await trustedWriteSummary(root2, file)) legal.add(file);
  }
  return legal;
}

// plugins/dev-flow/src/core/route-workflow.ts
import { createHash as createHash13, randomUUID as randomUUID6 } from "node:crypto";

// plugins/dev-flow/src/core/basis-state.ts
function basisIsCurrent(basis, current) {
  switch (basis.kind) {
    case "content":
      return current.contentFingerprint !== void 0 && basis.sha256 === current.contentFingerprint;
    case "event":
      return current.eventIds?.has(basis.eventId) ?? false;
    case "slice": {
      return current.sliceBases?.[basis.sliceKey] === basis.sliceHash;
    }
  }
}
function deriveCurrency(record, current) {
  const basis = record.basis;
  if (!basis) return "unconfirmed";
  if (!basisIsCurrent(basis, current)) return currentKnown(basis, current) ? "stale" : "unconfirmed";
  return "current";
}
function currentKnown(basis, current) {
  switch (basis.kind) {
    case "content":
      return current.contentFingerprint !== void 0;
    case "event":
      return basis.eventId !== void 0;
    case "slice":
      return current.sliceBases?.[basis.sliceKey] !== void 0;
  }
}

// plugins/dev-flow/src/core/route-workflow.ts
async function lockClassification(root2, id, expectedRevision, facts, boundaryAudit) {
  validateBasis(facts, []);
  const initial = await readState(root2, id);
  const repositoryFacts = initial.governance?.repositoryFacts ?? [];
  const items = boundaryAudit.items ?? [];
  const auditFactRefs = items.filter((item) => item.disposition === "repository-fact" && typeof item.factRef === "string").map((item) => item.factRef);
  const basisFactRefs = [
    ...facts.scopeFactRefs,
    ...facts.topologyFactRefs,
    ...facts.uncertaintyFactRefs,
    ...Object.values(facts.riskFactRefs).flatMap((refs) => refs ?? [])
  ];
  const factRefs = [.../* @__PURE__ */ new Set([...auditFactRefs, ...basisFactRefs])];
  const registeredIds = [
    ...repositoryFacts.map((record) => record.recordId),
    ...(initial.governance?.decisions ?? []).map((record) => record.recordId)
  ];
  const unresolvedFactRefs = factRefs.filter((ref) => !repositoryFacts.some((record) => record.recordId === ref));
  if (unresolvedFactRefs.length) {
    throw new DevFlowError("BOUNDARY_AUDIT_UNRESOLVED", "classification references a repository fact that is not in the governance ledger", {
      factRef: unresolvedFactRefs[0],
      unresolvedRefs: unresolvedFactRefs,
      registeredIds
    });
  }
  for (const ref of factRefs) {
    const fact = repositoryFacts.find((record) => record.recordId === ref);
    await assertRepositoryFactCurrent(root2, fact);
  }
  const configForBasis = await readProjectConfig(root2);
  const currentFingerprint = await fingerprintGovernedRoots(root2, configForBasis);
  const eventIds = new Set((await readFeatureEvents(root2, id)).map((event) => String(event.data?.eventId ?? "")));
  const decisionRecords = (initial.governance?.decisions ?? []).map((decision) => ({
    recordId: decision.recordId,
    supersededBy: decision.supersededBy,
    currency: deriveCurrency(decision, { contentFingerprint: currentFingerprint, eventIds })
  }));
  const factRecords = repositoryFacts.map((fact) => ({ recordId: fact.recordId, currency: factRefs.includes(fact.recordId) ? "current" : "unconfirmed" }));
  const auditMissingFromBasis = auditFactRefs.filter((auditRef) => !basisFactRefs.includes(auditRef));
  if (auditMissingFromBasis.length) {
    throw new DevFlowError("BOUNDARY_AUDIT_UNRESOLVED", "boundary audit fact must be included in classification basis", {
      factRef: auditMissingFromBasis[0],
      unresolvedRefs: auditMissingFromBasis,
      registeredIds
    });
  }
  const boundaryIndex = { decisionRefs: [...facts.decisionRefs], decisions: decisionRecords, repositoryFacts: factRecords };
  assertBoundaryAuditComplete(boundaryAudit, boundaryIndex);
  const unresolvedDecisionRefs = facts.decisionRefs.filter((decisionRef) => !decisionRecords.some((record) => record.recordId === decisionRef));
  if (unresolvedDecisionRefs.length) {
    throw new DevFlowError("BOUNDARY_AUDIT_UNRESOLVED", "classification references a decision that is not in the governance ledger", {
      decisionRef: unresolvedDecisionRefs[0],
      unresolvedRefs: unresolvedDecisionRefs,
      registeredIds
    });
  }
  for (const decisionRef of facts.decisionRefs) {
    const decision = decisionRecords.find((record) => record.recordId === decisionRef);
    if (decision.supersededBy) throw new DevFlowError("BOUNDARY_DECISION_SUPERSEDED", "classification references a superseded decision", { decisionRef, successorId: decision.supersededBy });
    if (decision.currency !== "current") throw new DevFlowError("BOUNDARY_DECISION_NOT_CURRENT", "classification references a decision whose basis is not current", { decisionRef, currency: decision.currency });
  }
  const selected = selectBaseRoute(facts);
  const current = await readState(root2, id);
  if (current.revision !== expectedRevision) throw new DevFlowError("STATE_REVISION_CONFLICT", "state revision changed", { currentRevision: current.revision });
  if (current.mode !== "intake") throw new DevFlowError("CLASSIFICATION_ALREADY_LOCKED", "classification is already locked");
  const pending = pendingDecisionForState(current);
  if (pending && pending.kind !== "workspace-ownership") {
    throw new DevFlowError("OPEN_CLASSIFICATION_DECISIONS", "classification-affecting decisions remain open", { recoveryHint: "\u5148\u56DE\u7B54\u5F53\u524D\u5F85\u51B3\u95EE\u9898\uFF0C\u518D\u91CD\u8BD5\u9501\u5B9A\u8DEF\u7EBF\u3002" });
  }
  const project = await readProjectConfig(root2);
  const missingGuarantees = missingVerificationGuarantees(project, selected.classification.controls.verification);
  if (missingGuarantees.length) {
    throw new DevFlowError("VERIFICATION_GUARANTEE_UNCONFIGURED", "\u9879\u76EE\u9A8C\u8BC1\u914D\u7F6E\u4E0D\u80FD\u8986\u76D6\u5F53\u524D\u8DEF\u7EBF\u7684\u6700\u7EC8\u4FDD\u8BC1\u96C6\u3002", {
      missingGuarantees,
      route: selected.route,
      userMessage: "\u5F53\u524D\u8DEF\u7EBF\u9700\u8981\u7684\u9A8C\u8BC1\u4FDD\u8BC1\u5C1A\u672A\u914D\u7F6E\u3002",
      cause: `\u5F53\u524D\u8DEF\u7EBF\u9700\u8981 ${missingGuarantees.join("\u3001")} guarantee\uFF0C\u4F46\u975E preflight \u9A8C\u8BC1\u547D\u4EE4\u6CA1\u6709\u63D0\u4F9B\u8FD9\u4E9B\u4FDD\u8BC1\u3002`,
      impact: "\u8DEF\u7EBF\u4E0D\u4F1A\u9501\u5B9A\uFF0C\u4E5F\u4E0D\u4F1A\u521B\u5EFA Trace\u3001review \u6216\u8DEF\u7EBF\u786E\u8BA4\u72B6\u6001\u3002",
      recoveryKind: "repair",
      recoveryInstruction: "\u901A\u8FC7\u9879\u76EE\u914D\u7F6E\u66F4\u65B0\u5165\u53E3\u8865\u9F50\u975E preflight \u9A8C\u8BC1\u547D\u4EE4\u540E\u91CD\u8BD5\u8DEF\u7EBF\u9501\u5B9A\u3002",
      retryOriginal: true
    });
  }
  if (selected.classification.routeConfirmationRequired) {
    let presentationEventId;
    return mutatePrepared(root2, id, expectedRevision, "route-confirmation-presented", async () => ({ mutate: (draft) => {
      const basisHash2 = confirmationBasisHash(facts, selected);
      presentationEventId = randomUUID6();
      draft.routeConfirmation = { facts, basisHash: basisHash2 };
      createInteraction(draft, {
        kind: "route-confirmation",
        target: "route-confirmation",
        basisHash: basisHash2,
        question: `\u8BF7\u786E\u8BA4 Dev Flow \u8DEF\u7EBF\uFF1A${selected.classification.orderedRoute.join(" \u2192 ")}`,
        options: [
          { id: "confirm", label: "\u786E\u8BA4\u8FD9\u6761\u8DEF\u7EBF" },
          { id: "correct", label: "\u4FEE\u6B63\u5206\u7C7B\u4E8B\u5B9E", requiresComment: true }
        ],
        presentationEventId
      });
    }, eventData: () => ({
      level: selected.classification.level,
      controls: selected.classification.controls,
      orderedRoute: selected.classification.orderedRoute,
      ...presentationEventId ? { presentationEventId } : {}
    }) }));
  }
  return mutatePrepared(root2, id, expectedRevision, "classification-locked", applyLock({ root: root2, facts, basisHash: confirmationBasisHash(facts, selected) }));
}
async function assertRouteExecutable(root2, selected) {
  const project = await readProjectConfig(root2);
  const missingGuarantees = missingVerificationGuarantees(project, selected.classification.controls.verification);
  if (missingGuarantees.length) {
    throw new DevFlowError("VERIFICATION_GUARANTEE_UNCONFIGURED", "\u5F53\u524D\u8DEF\u7EBF\u9700\u8981\u7684\u9A8C\u8BC1\u4FDD\u8BC1\u5DF2\u7F3A\u5931\u3002", {
      missingGuarantees,
      userMessage: "\u5F53\u524D\u8DEF\u7EBF\u9700\u8981\u7684\u9A8C\u8BC1\u4FDD\u8BC1\u5C1A\u672A\u914D\u7F6E\uFF1B\u5DF2\u786E\u8BA4\u7684\u8DEF\u7EBF\u5185\u5BB9\u4FDD\u6301\u4E0D\u53D8\u3002",
      cause: `\u5F53\u524D\u8DEF\u7EBF\u9700\u8981 ${missingGuarantees.join("\u3001")} guarantee\uFF0C\u4F46\u9879\u76EE\u914D\u7F6E\u4E2D\u7684\u975E preflight \u9A8C\u8BC1\u547D\u4EE4\u4E0D\u518D\u63D0\u4F9B\u8FD9\u4E9B\u4FDD\u8BC1\u3002`,
      impact: "\u8DEF\u7EBF\u4E0D\u4F1A\u9501\u5B9A\uFF0C\u4E5F\u4E0D\u4F1A\u5220\u9664\u6216\u91CD\u95EE\u4ECD\u7136\u5F53\u524D\u7684\u8DEF\u7EBF\u51B3\u5B9A\u3002",
      recoveryKind: "repair",
      recoveryInstruction: "\u901A\u8FC7\u9879\u76EE\u914D\u7F6E\u66F4\u65B0\u5165\u53E3\u8865\u9F50\u975E preflight \u9A8C\u8BC1\u547D\u4EE4\u540E\uFF0C\u91CD\u65B0\u786E\u8BA4\u8FD9\u6761\u8DEF\u7EBF\u3002",
      retryOriginal: true
    });
  }
}
function confirmationBasisHash(facts, selected) {
  return createHash13("sha256").update(JSON.stringify({
    facts,
    route: selected.classification.orderedRoute,
    controls: selected.classification.controls
  })).digest("hex");
}
async function prepareRouteTransitionPointers(root2, featureId, selected, current, nextRevision) {
  const preparedTraceability = traceEnforcementRequired(selected.route, selected.classification.controls) && !current.traceability ? await writeTraceSnapshot(root2, emptyTraceabilityLedger(featureId, nextRevision, (await readProjectConfigSnapshot(root2)).sha256)) : void 0;
  const preparedReview = reviewLedgerRequired(selected.route, selected.classification.controls) && !current.review ? await writeReviewSnapshot(root2, emptyReviewLedger(featureId, nextRevision)) : void 0;
  const reviewInvalidation = current.review && (selected.route !== current.route || JSON.stringify(selected.classification) !== JSON.stringify(current.classification)) ? await prepareReviewInvalidation(root2, current, nextRevision) : void 0;
  return { preparedTraceability, preparedReview, reviewInvalidation };
}
function applyLock(input) {
  const { root: root2, facts, basisHash: basisHash2 } = input;
  return async (current, nextRevision) => {
    if (current.mode !== "intake") throw new DevFlowError("CLASSIFICATION_ALREADY_LOCKED", "classification is already locked");
    const selected = selectBaseRoute(facts);
    if (confirmationBasisHash(facts, selected) !== basisHash2) {
      throw new DevFlowError("ROUTE_CONFIRMATION_STALE", "\u8DEF\u7EBF\u786E\u8BA4\u4F9D\u636E\u5DF2\u53D8\u5316\u3002", {
        userMessage: "\u786E\u8BA4\u4F9D\u636E\u5DF2\u53D8\u5316\uFF0C\u9700\u8981\u91CD\u65B0\u786E\u8BA4\u5F53\u524D\u8DEF\u7EBF\u3002",
        cause: "\u5199\u5165\u65F6\u4ECE\u5DF2\u5BA1\u8BA1\u4E8B\u5B9E\u91CD\u7B97\u7684\u786E\u8BA4 hash \u4E0E\u5448\u73B0\u65F6\u7684\u4F9D\u636E\u4E0D\u4E00\u81F4\u3002",
        impact: "\u8DEF\u7EBF\u4E0D\u4F1A\u9501\u5B9A\uFF1B\u786E\u8BA4\u8EAB\u4EFD\u4FDD\u7559\uFF0C\u91CD\u65B0\u5448\u73B0\u540E\u518D\u786E\u8BA4\u3002",
        recoveryKind: "refresh",
        recoveryInstruction: "\u91CD\u65B0\u5448\u73B0\u5F53\u524D\u8DEF\u7EBF\u5E76\u786E\u8BA4\u3002",
        retryOriginal: false
      });
    }
    if (selected.classification.routeConfirmationRequired) {
      const pending = pendingDecisionForState(current);
      const gateMatches = pending?.kind === "route-confirmation" && pending.basisHash === basisHash2 && current.routeConfirmation?.basisHash === basisHash2;
      if (!gateMatches) {
        throw new DevFlowError("ROUTE_CONFIRMATION_REQUIRED", "\u8BE5\u8DEF\u7EBF\u9700\u8981\u7528\u6237\u786E\u8BA4\uFF0C\u4E0D\u80FD\u65E0\u95E8\u7981\u9501\u5B9A\u3002", {
          userMessage: "\u8FD9\u6761\u8DEF\u7EBF\u9700\u8981\u5148\u786E\u8BA4\uFF1B\u5F53\u524D\u6CA1\u6709 hash \u4E00\u81F4\u7684\u5F85\u786E\u8BA4\u8DEF\u7EBF\u3002",
          cause: "applyLock \u6536\u5230\u9700\u8981\u8DEF\u7EBF\u786E\u8BA4\u7684\u5206\u7C7B\uFF0C\u4F46\u72B6\u6001\u91CC\u6CA1\u6709\u5339\u914D\u7684\u5F85\u786E\u8BA4\u8DEF\u7EBF\u3002",
          impact: "\u8DEF\u7EBF\u4E0D\u4F1A\u9501\u5B9A\u3002",
          recoveryKind: "retry",
          recoveryInstruction: "\u7531 lockClassification \u5448\u73B0\u8DEF\u7EBF\u786E\u8BA4\uFF0C\u7ECF answer \u786E\u8BA4\u540E\u9501\u5B9A\u3002",
          retryOriginal: false
        });
      }
    }
    await assertRouteExecutable(root2, selected);
    const definition = routeDefinitionForFeature(selected.route, selected.classification.controls);
    const traceability = traceEnforcementRequired(selected.route, selected.classification.controls) ? await writeTraceSnapshot(root2, emptyTraceabilityLedger(current.featureId, nextRevision, (await readProjectConfigSnapshot(root2)).sha256)) : void 0;
    const review2 = reviewLedgerRequired(selected.route, selected.classification.controls) ? await writeReviewSnapshot(root2, emptyReviewLedger(current.featureId, nextRevision)) : void 0;
    return {
      mutate: (draft) => {
        draft.schemaVersion = 5;
        draft.mode = "routed";
        draft.route = selected.route;
        draft.classification = selected.classification;
        draft.classificationBasis = selected.classificationBasis;
        draft.obligations = selected.obligations;
        draft.workflowCapabilities = normalizeWorkflowCapabilities(SUPPORTED_WORKFLOW_CAPABILITIES);
        draft.steps = Object.fromEntries(definition.orderedSteps.map((step) => [step, { status: "pending" }]));
        draft.humanGates = {};
        draft.artifacts = {};
        draft.verification = { attempts: [] };
        draft.logicComplete = false;
        if (traceability) draft.traceability = traceability;
        if (review2) draft.review = review2;
        delete draft.routeConfirmation;
      }
    };
  };
}
async function resolveRouteConfirmationForAnswer(ctx) {
  const { root: root2, featureId, expectedRevision, host, credential, interaction, state } = ctx;
  const pending = pendingDecisionForState(state);
  if (pending?.kind !== "route-confirmation" || !state.routeConfirmation) {
    throw new DevFlowError("ROUTE_CONFIRMATION_NOT_PENDING", "\u5F53\u524D\u6CA1\u6709\u5F85\u786E\u8BA4\u8DEF\u7EBF\u3002");
  }
  let promptEventId;
  let promptText;
  if (credential.source === "text") {
    const events = await readFeatureEvents(root2, featureId);
    const prompt = interaction ? resolveInteractionPromptEvent(events, state, interaction, { host, userReply: credential.userReply }) : resolvePromptEvent(events, { host, userReply: credential.userReply, presentedAt: pending.presentedAt, presentedRevision: pending.presentedRevision, ...pending.presentationEventId ? { presentationEventId: pending.presentationEventId } : {} });
    promptEventId = prompt.eventId;
    promptText = prompt.text;
  }
  const matched = credential.source === "elicitation" ? { optionId: credential.action, comment: credential.comment } : (() => {
    const m = matchDecisionReply(pending, promptText ?? credential.userReply);
    return { optionId: m.option.id, comment: m.comment };
  })();
  if (matched.optionId !== "confirm") {
    if (credential.source === "elicitation") {
      throw new DevFlowError("DECISION_REPLY_NOT_RECOGNIZED", "\u8BF7\u786E\u8BA4\u5F53\u524D\u8DEF\u7EBF\uFF0C\u6216\u5173\u95ED\u8868\u5355\u540E\u8865\u5145\u5206\u7C7B\u4E8B\u5B9E\u3002");
    }
    throw new DevFlowError("ROUTE_CONFIRMATION_CORRECTION_REQUIRED", "\u8DEF\u7EBF\u9700\u8981\u4FEE\u6B63\uFF0C\u4E0D\u80FD\u6309\u5F53\u524D\u5206\u7C7B\u9501\u5B9A\u3002", { comment: matched.comment });
  }
  const confirmation = state.routeConfirmation;
  let response;
  let transitionData;
  if (state.mode === "intake") {
    const prepare = applyLock({ root: root2, facts: confirmation.facts, basisHash: confirmation.basisHash });
    let confirmedLevel;
    let confirmedRoute;
    const next2 = await mutatePrepared(root2, featureId, expectedRevision, "route-confirmation-accepted", async (current, nextStateRevision) => {
      const prepared = await prepare(current, nextStateRevision);
      const applyMutate = prepared.mutate;
      return {
        ...prepared,
        mutate: (draft) => {
          applyMutate(draft);
          confirmedLevel = draft.classification.level;
          confirmedRoute = draft.classification.orderedRoute;
          response = resolveResponseForAnswer(draft, interaction, {
            source: credential.source,
            action: credential.source === "elicitation" ? credential.action : void 0,
            comment: credential.source === "elicitation" ? credential.comment : void 0,
            userReply: credential.source === "text" ? credential.userReply : void 0,
            promptText,
            promptEventId,
            host
          });
          delete draft.pendingDecision;
          draft.lastUpdatedBy = { host, pluginVersion: "5.1.0" };
        },
        eventData: () => ({
          promptEventId,
          level: confirmedLevel,
          orderedRoute: confirmedRoute
        })
      };
    });
    if (!response) throw new DevFlowError("INTERACTION_NOT_RESOLVED", interaction.id);
    return { state: next2, action: "confirm" };
  }
  let selectedForEvent;
  const next = await mutatePrepared(root2, featureId, expectedRevision, "route-confirmation-accepted", async (current, nextStateRevision) => {
    const selected = selectBaseRoute(confirmation.facts);
    if (confirmationBasisHash(confirmation.facts, selected) !== confirmation.basisHash) {
      throw new DevFlowError("ROUTE_CONFIRMATION_STALE", "\u8DEF\u7EBF\u786E\u8BA4\u4F9D\u636E\u5DF2\u53D8\u5316\u3002", {
        userMessage: "\u786E\u8BA4\u4F9D\u636E\u5DF2\u53D8\u5316\uFF0C\u9700\u8981\u91CD\u65B0\u5448\u73B0\u5F53\u524D\u8DEF\u7EBF\u3002",
        impact: "\u8DEF\u7EBF\u4E0D\u4F1A\u53D8\u5316\uFF1B\u786E\u8BA4\u8EAB\u4EFD\u4FDD\u7559\uFF0C\u91CD\u65B0\u5448\u73B0\u540E\u518D\u786E\u8BA4\u3002",
        recoveryKind: "refresh",
        recoveryInstruction: "\u91CD\u65B0\u5448\u73B0\u5F53\u524D\u8DEF\u7EBF\u5E76\u786E\u8BA4\u3002",
        retryOriginal: false
      });
    }
    await assertRouteExecutable(root2, selected);
    const { preparedTraceability, preparedReview, reviewInvalidation } = await prepareRouteTransitionPointers(root2, featureId, selected, current, nextStateRevision);
    selectedForEvent = selected;
    return {
      mutate: (draft) => {
        if (preparedTraceability) draft.traceability = preparedTraceability;
        if (preparedReview) draft.review = preparedReview;
        if (reviewInvalidation) draft.review = reviewInvalidation;
        response = resolveResponseForAnswer(draft, interaction, {
          source: credential.source,
          action: credential.source === "elicitation" ? credential.action : void 0,
          comment: credential.source === "elicitation" ? credential.comment : void 0,
          userReply: credential.source === "text" ? credential.userReply : void 0,
          promptText,
          promptEventId,
          host
        });
        const transition = applyRouteTransition(draft, selected);
        transitionData = { previousRoute: transition.previousRoute, invalidatedSteps: transition.invalidatedSteps, invalidatedArtifacts: transition.invalidatedArtifacts };
        delete draft.pendingDecision;
        delete draft.routeConfirmation;
        draft.lastUpdatedBy = { host, pluginVersion: "5.1.0" };
      },
      eventData: () => ({
        promptEventId,
        level: selectedForEvent?.classification.level,
        orderedRoute: selectedForEvent?.classification.orderedRoute,
        ...transitionData ? { previousRoute: transitionData.previousRoute, invalidatedSteps: transitionData.invalidatedSteps, invalidatedArtifacts: transitionData.invalidatedArtifacts } : {}
      })
    };
  });
  if (!response) throw new DevFlowError("INTERACTION_NOT_RESOLVED", interaction.id);
  return { state: next, action: "confirm" };
}
var levelRank2 = { XS: 0, S: 1, M: 2, L: 3 };
var topologyRank = { local: 0, "shared-contract": 1, "multi-chain": 2, "coordinated-rollback": 3 };
function isDowngrade(before, after) {
  const riskRemoved = before.riskLabels.some((risk) => !after.riskLabels.includes(risk));
  return levelRank2[after.level] < levelRank2[before.level] || topologyRank[after.topology] < topologyRank[before.topology] || riskRemoved;
}
function controlsAreWeaker(before, after) {
  const planRank = { locate: 0, brief: 1, formal: 2 };
  const reviewRank = { none: 0, focused: 1, independent: 2, full: 3 };
  return before.requirements && !after.requirements || planRank[after.plan] < planRank[before.plan] || before.trace && !after.trace || before.planReview && !after.planReview || before.executionApproval && !after.executionApproval || before.checkpoints === "unit-chain" && after.checkpoints !== "unit-chain" || reviewRank[after.codeReview] < reviewRank[before.codeReview] || before.reviewRoles.some((role) => !after.reviewRoles.includes(role)) || before.recovery.some((kind) => !after.recovery.includes(kind)) || before.verification.some((kind) => !after.verification.includes(kind));
}
function applyRouteTransition(state, selected) {
  const previousRoute = state.route;
  const previousDefinition = routeDefinitionForFeature(previousRoute, state.classification.controls);
  const nextDefinition = routeDefinitionForFeature(selected.route, selected.classification.controls);
  const previousArtifacts = /* @__PURE__ */ new Set([...previousDefinition.requiredArtifacts, ...previousDefinition.generatedArtifacts ?? []]);
  const nextArtifacts = /* @__PURE__ */ new Set([...nextDefinition.requiredArtifacts, ...nextDefinition.generatedArtifacts ?? []]);
  const retainedArtifacts = Object.fromEntries(Object.entries(state.artifacts).filter(([kind]) => previousArtifacts.has(kind) && nextArtifacts.has(kind)));
  const retainedSteps = {};
  for (const step of nextDefinition.orderedSteps) {
    if (["finalize", "verification"].includes(step)) break;
    if (state.steps[step]?.status !== "satisfied") break;
    retainedSteps[step] = state.steps[step];
  }
  const invalidatedSteps = Object.keys(state.steps).filter((step) => !retainedSteps[step]);
  const invalidatedArtifacts = Object.keys(state.artifacts).filter((kind) => !retainedArtifacts[kind]);
  state.classification = selected.classification;
  state.classificationBasis = selected.classificationBasis;
  state.obligations = selected.obligations;
  state.route = selected.route;
  state.artifacts = retainedArtifacts;
  state.steps = retainedSteps;
  state.humanGates = {};
  state.interactions = {};
  state.verification = { attempts: [] };
  state.logicComplete = false;
  if (!selected.classification.controls.trace) delete state.traceability;
  if (!reviewLedgerRequired(selected.route, selected.classification.controls)) delete state.review;
  return { previousRoute, invalidatedSteps, invalidatedArtifacts };
}
async function reclassifyFeature(root2, id, expectedRevision, next, reason, userEvidence) {
  if (!reason) throw new DevFlowError("RECLASSIFICATION_REASON_REQUIRED", "reclassify requires a reason");
  const initial = await readState(root2, id);
  if (initial.revision !== expectedRevision) throw new DevFlowError("STATE_REVISION_CONFLICT", "state revision changed", { currentRevision: initial.revision });
  const selectedAtLock = selectRoute(next);
  const events = await readFeatureEvents(root2, id);
  const governedWriteStarted = Object.values(initial.workspace.ownershipSource).includes("trusted-hook") || events.some((event) => event.type === "trusted-write-owned");
  const changedAtLock = selectedAtLock.route !== initial.route || JSON.stringify(selectedAtLock.classification) !== JSON.stringify(initial.classification);
  const weakerAtLock = isDowngrade(initial.classification, selectedAtLock.classification) || controlsAreWeaker(initial.classification.controls, selectedAtLock.classification.controls);
  if (governedWriteStarted && weakerAtLock) {
    throw new DevFlowError("RECLASSIFICATION_DOWNGRADE_FORBIDDEN", "\u9996\u6B21 governed write \u540E\u63A7\u5236\u53EA\u80FD\u5355\u8C03\u589E\u52A0\u3002", { recoveryHint: "\u4FDD\u7559\u5F53\u524D\u63A7\u5236\uFF0C\u6216\u63D0\u4EA4\u4E0D\u4F1A\u79FB\u9664\u4EFB\u4F55 level\u3001\u98CE\u9669\u3001\u5BA1\u67E5\u3001\u6062\u590D\u6216\u9A8C\u8BC1\u4FDD\u8BC1\u7684\u66F4\u5F3A\u5206\u7C7B\u4E8B\u5B9E" });
  }
  if (!changedAtLock) throw new DevFlowError("RECLASSIFICATION_NOT_CHANGED", "\u5206\u7C7B\u4E8B\u5B9E\u548C\u63A7\u5236\u6CA1\u6709\u53D1\u751F\u53D8\u5316\u3002", { recoveryHint: "\u65E0\u9700\u91CD\u5206\u7C7B\uFF1B\u7EE7\u7EED\u5F53\u524D\u8DEF\u7EBF" });
  await assertRouteExecutable(root2, selectedAtLock);
  if (!governedWriteStarted && selectedAtLock.classification.routeConfirmationRequired) {
    if (pendingDecisionForState(initial)) throw new DevFlowError("DECISION_ALREADY_PENDING", "\u5148\u5904\u7406\u5F53\u524D\u552F\u4E00\u7528\u6237\u51B3\u7B56\uFF0C\u518D\u91CD\u7B97\u8DEF\u7EBF\u3002", { recoveryHint: "\u4F7F\u7528 dev_flow_answer \u56DE\u7B54\u5F53\u524D\u95EE\u9898" });
    const facts = {
      level: selectedAtLock.classification.level,
      topology: selectedAtLock.classification.topology,
      requirements: selectedAtLock.classification.requirements,
      riskLabels: selectedAtLock.classification.riskLabels,
      scopeFactRefs: selectedAtLock.classificationBasis.scopeFactRefs,
      topologyFactRefs: selectedAtLock.classificationBasis.topologyFactRefs,
      uncertaintyFactRefs: selectedAtLock.classificationBasis.uncertaintyFactRefs,
      riskFactRefs: selectedAtLock.classificationBasis.riskFactRefs,
      decisionRefs: selectedAtLock.classificationBasis.decisionRefs,
      signals: selectedAtLock.classificationBasis.signals
    };
    let presentationEventId;
    return mutatePrepared(root2, id, expectedRevision, "route-confirmation-represented", async () => ({ mutate: (draft) => {
      const basisHash2 = confirmationBasisHash(facts, selectedAtLock);
      draft.routeConfirmation = { facts, basisHash: basisHash2 };
      const interaction = createInteraction(draft, {
        kind: "route-confirmation",
        target: "route-confirmation",
        basisHash: basisHash2,
        question: `\u5206\u7C7B\u4E8B\u5B9E\u53D8\u5316\uFF0C\u8BF7\u91CD\u65B0\u786E\u8BA4\u8DEF\u7EBF\uFF1A${selectedAtLock.classification.orderedRoute.join(" \u2192 ")}`,
        options: [{ id: "confirm", label: "\u786E\u8BA4\u8FD9\u6761\u8DEF\u7EBF" }, { id: "correct", label: "\u4FEE\u6B63\u5206\u7C7B\u4E8B\u5B9E", requiresComment: true }]
      });
      presentationEventId = interaction.presentationEventId;
    }, eventData: () => ({ reason, previousRoute: initial.classification.orderedRoute, nextRoute: selectedAtLock.classification.orderedRoute, presentationEventId }) }));
  }
  let notice;
  let eventData = { reason };
  const state = await mutatePrepared(root2, id, expectedRevision, "reclassified", async (current, nextStateRevision) => {
    const { preparedTraceability, preparedReview, reviewInvalidation } = await prepareRouteTransitionPointers(root2, id, selectedAtLock, current, nextStateRevision);
    return { mutate: async (draft) => {
      if (draft.lifecycle !== "active") throw new DevFlowError("INVALID_LIFECYCLE", "only an active feature can be reclassified");
      const selected = selectRoute(next);
      if (preparedTraceability) draft.traceability = preparedTraceability;
      if (preparedReview) draft.review = preparedReview;
      if (reviewInvalidation) draft.review = reviewInvalidation;
      const before = draft.classification;
      const after = selected.classification;
      const transition = applyRouteTransition(draft, selected);
      eventData = { before, after, previousRoute: transition.previousRoute, nextRoute: selected.route, reason, userEvidence, invalidatedSteps: transition.invalidatedSteps, invalidatedArtifacts: transition.invalidatedArtifacts };
      notice = `\u5206\u7C7B\u5DF2\u66F4\u65B0\u4E3A ${selected.route}\uFF0C\u672A\u7EE7\u7EED\u767B\u8BB0\u7684\u65E7\u5DE5\u4EF6\u4FDD\u7559\u5728\u78C1\u76D8\u4F5C\u4E3A\u5BA1\u8BA1\u5386\u53F2\u3002`;
    }, eventData: () => eventData };
  });
  return notice ? { ...state, reclassifyNotice: notice } : state;
}

// plugins/dev-flow/src/core/decision-workflow.ts
import { createHash as createHash15 } from "node:crypto";

// plugins/dev-flow/src/core/decision-ledger.ts
import { createHash as createHash14 } from "node:crypto";
function idFor(question, refs = []) {
  return `DEC-${createHash14("sha256").update(`${question}
${[...refs].sort().join("\n")}`).digest("hex").slice(0, 16)}`;
}
function createDecision(question, factRefs = []) {
  if (!question.trim()) throw new DevFlowError("DECISION_QUESTION_REQUIRED", "decision question cannot be empty");
  return { id: idFor(question, factRefs), question: question.trim(), status: "open", ...factRefs.length ? { factRefs: [...new Set(factRefs)].sort() } : {} };
}
function resolveDecision(decision, evidence, conclusion) {
  if (decision.status !== "open") throw new DevFlowError("DECISION_NOT_OPEN", "only open decisions can be resolved");
  if (!evidence.trim() || !conclusion.trim()) throw new DevFlowError("DECISION_EVIDENCE_REQUIRED", "resolved decisions require evidence and a conclusion");
  return { ...decision, status: "resolved", evidence: evidence.trim(), conclusion: conclusion.trim() };
}

// plugins/dev-flow/src/core/decision-workflow.ts
function commitDecision(draft, input) {
  const ledgerAfter = draft.governance ?? EMPTY_GOVERNANCE_LEDGER;
  const credentials = [...ledgerAfter.credentials];
  if (!credentials.some((existing) => existing.recordId === input.credentialId)) {
    credentials.push({
      recordId: input.credentialId,
      kind: "credential",
      source: input.source,
      host: input.host,
      interactionId: input.interactionId,
      ...input.optionId ? { optionId: input.optionId } : {},
      ...input.rawText ? { rawText: input.rawText } : {},
      ...input.promptEventId ? { basis: { kind: "event", eventId: input.promptEventId } } : input.presentationEventId ? { basis: { kind: "event", eventId: input.presentationEventId } } : {},
      recordedAt: input.recordedAt
    });
  }
  const decisions = [...ledgerAfter.decisions];
  if (!decisions.some((existing) => existing.recordId === input.decisionId)) {
    decisions.push({
      recordId: input.decisionId,
      kind: "decision",
      question: input.question,
      conclusion: input.conclusion,
      credentialId: input.credentialId,
      ...input.promptEventId ? { basis: { kind: "event", eventId: input.promptEventId } } : input.presentationEventId ? { basis: { kind: "event", eventId: input.presentationEventId } } : {},
      recordedAt: input.recordedAt
    });
  }
  draft.governance = { ...ledgerAfter, credentials, decisions };
}
function latestUnconsumedPrompt(events, host) {
  const consumed = consumedPromptEventIds(events);
  const matches = events.flatMap((record) => {
    const prompt = promptFrom(record);
    if (!prompt || prompt.host !== host || consumed.has(prompt.eventId)) return [];
    return [{ eventId: prompt.eventId, text: prompt.text, revision: record.revision, at: prompt.at }];
  });
  matches.sort((left, right) => right.revision - left.revision || Date.parse(right.at) - Date.parse(left.at));
  return matches[0];
}
async function recordDecision(root2, id, expectedRevision, question, evidence, conclusion, factRefs = [], host) {
  if (!question.trim()) throw new DevFlowError("DECISION_QUESTION_REQUIRED", "decision question cannot be empty");
  if (!evidence.trim() || !conclusion.trim()) throw new DevFlowError("DECISION_EVIDENCE_REQUIRED", "ratified decisions require the user's original words and the intended conclusion");
  const initial = await readState(root2, id);
  if (initial.revision !== expectedRevision) throw new DevFlowError("STATE_REVISION_CONFLICT", "state revision changed", { currentRevision: initial.revision });
  const decision = resolveDecision(createDecision(question, factRefs), evidence, conclusion);
  const target = `decision-ratification:${decision.id}`;
  let existingPending = false;
  try {
    existingPending = Boolean(pendingDecisionForState(initial));
  } catch {
    existingPending = true;
  }
  const events = await readFeatureEvents(root2, id);
  const latest = existingPending ? void 0 : latestUnconsumedPrompt(events, host);
  const exactMatch = latest && normalizeReplyText(latest.text) === normalizeReplyText(evidence);
  if (latest && exactMatch) {
    const recordedAt = (/* @__PURE__ */ new Date()).toISOString();
    const state2 = await mutate(root2, id, expectedRevision, "decision-auto-ratified", (draft) => {
      commitDecision(draft, {
        decisionId: decision.id,
        question: question.trim(),
        conclusion: conclusion.trim(),
        credentialId: `CRED-auto-ratify-${decision.id}`,
        host,
        recordedAt,
        source: "text",
        interactionId: `auto-ratify:${decision.id}`,
        promptEventId: latest.eventId,
        rawText: evidence.trim()
      });
      draft.lastUpdatedBy = { host, pluginVersion: "5.1.0" };
    }, { decisionId: decision.id, promptEventId: latest.eventId });
    return {
      state: state2,
      decisionId: decision.id,
      ratifiedFrom: latest.eventId,
      question: question.trim(),
      evidence: evidence.trim(),
      conclusion: conclusion.trim()
    };
  }
  let interaction;
  const state = await mutate(root2, id, expectedRevision, "decision-ratification-presented", (draft) => {
    interaction = createInteraction(draft, {
      kind: "decision-ratification",
      target,
      basisHash: createHash15("sha256").update(`${decision.id}
${evidence.trim()}
${conclusion.trim()}`).digest("hex"),
      question: `\u8F83\u65E9\u5BF9\u8BDD\u4E2D\u4F60\u8868\u793A\u201C${evidence.trim()}\u201D\u3002\u5C06\u628A\u5B83\u767B\u8BB0\u4E3A\u9488\u5BF9\u201C${question.trim()}\u201D\u7684\u5F53\u524D\u51B3\u5B9A\u201C${conclusion.trim()}\u201D\u3002\u786E\u8BA4\u767B\u8BB0\u5417\uFF1F`,
      options: [
        { id: "confirm", label: "\u786E\u8BA4\u767B\u8BB0" },
        { id: "reject", label: "\u4E0D\u8981\u767B\u8BB0" }
      ],
      ratification: { question: question.trim(), evidence: evidence.trim(), conclusion: conclusion.trim(), factRefs: [...factRefs] }
    });
    draft.lastUpdatedBy = { host, pluginVersion: "5.1.0" };
  }, () => ({ decisionId: decision.id, presentationEventId: interaction?.presentationEventId }));
  if (!interaction) throw new DevFlowError("INTERACTION_NOT_CREATED", target);
  return { state, interaction: toPublicInteraction(interaction), decisionId: decision.id, interactionId: interaction.id };
}
function ratifyDecision(draft, interaction, response, promptEventId, host) {
  const candidate = interaction.ratification;
  if (!candidate) throw new DevFlowError("INTERACTION_INVALID", "decision-ratification interaction is missing its candidate content", { interactionId: interaction.id });
  const decision = resolveDecision(createDecision(candidate.question, candidate.factRefs), candidate.evidence, candidate.conclusion);
  commitDecision(draft, {
    decisionId: decision.id,
    question: candidate.question,
    conclusion: candidate.conclusion,
    credentialId: `CRED-ratify-${interaction.id}`,
    host,
    recordedAt: response.respondedAt,
    source: response.source === "elicitation" ? "native-form" : "text",
    interactionId: interaction.id,
    promptEventId,
    presentationEventId: interaction.presentationEventId,
    optionId: response.source === "elicitation" ? response.selectedOptionId ?? response.action : response.selectedOptionId,
    rawText: response.rawReply
  });
}
var revisionAffectedLabels = {
  classification: "\u5206\u7C7B\uFF08\u9700\u8981\u91CD\u65B0\u5206\u7C7B\u5E76\u91CD\u65B0\u786E\u8BA4\u8DEF\u7EBF\uFF09",
  requirements: "\u9700\u6C42\u6587\u6863\uFF08\u9700\u8981\u91CD\u65B0\u767B\u8BB0\uFF09",
  plan: "\u5B9E\u65BD\u8BA1\u5212\u4E0E Trace\uFF08\u9700\u8981\u91CD\u65B0\u767B\u8BB0\uFF09"
};
function revisionSuccessorId(question, newConclusion, reason) {
  return `DEC-${createHash15("sha256").update(`${question}
${newConclusion.trim()}
${reason.trim()}`).digest("hex").slice(0, 16)}`;
}
async function reviseDecision(root2, id, expectedRevision, decisionId, newConclusion, reason, host) {
  if (!newConclusion.trim()) throw new DevFlowError("DECISION_EVIDENCE_REQUIRED", "revised decision needs a new conclusion");
  if (!reason.trim()) throw new DevFlowError("DECISION_DISMISS_REASON_REQUIRED", "revised decision needs a reason");
  const initial = await readState(root2, id);
  if (initial.revision !== expectedRevision) throw new DevFlowError("STATE_REVISION_CONFLICT", "state revision changed", { currentRevision: initial.revision });
  const oldGovernance = (initial.governance?.decisions ?? []).find((candidate) => candidate.recordId === decisionId && !candidate.supersededBy);
  const old = oldGovernance ? { id: oldGovernance.recordId, question: oldGovernance.question, status: "resolved", conclusion: oldGovernance.conclusion, evidence: "", factRefs: [] } : void 0;
  if (!old) throw new DevFlowError("DECISION_NOT_FOUND", decisionId);
  if (old.status !== "resolved") throw new DevFlowError("DECISION_NOT_REVISABLE", `decision status ${old.status} cannot be revised`);
  const affected = [];
  if ((initial.classificationBasis?.decisionRefs ?? []).includes(decisionId)) affected.push("classification");
  if (initial.artifacts.requirements) affected.push("requirements");
  if (initial.artifacts["implementation-plan"] || initial.traceability) affected.push("plan");
  const target = `decision-revision:${decisionId}`;
  const successorId = revisionSuccessorId(old.question, newConclusion, reason);
  let interaction;
  const state = await mutate(root2, id, expectedRevision, "decision-revision-presented", (draft) => {
    const affectedText = affected.length ? affected.map((key) => revisionAffectedLabels[key]).join("\uFF1B") : "\u65E0\u2014\u2014\u53EA\u6709\u51B3\u7B56\u8BB0\u5F55\u672C\u8EAB\u53D8\u5316";
    interaction = createInteraction(draft, {
      kind: "decision-revision",
      target,
      basisHash: createHash15("sha256").update(`${decisionId}
${newConclusion.trim()}
${reason.trim()}`).digest("hex"),
      question: `\u5C06\u628A\u201C${old.question}\u201D\u7684\u5F53\u524D\u51B3\u5B9A\u201C${old.conclusion ?? old.question}\u201D\u4FEE\u8BA2\u4E3A\u201C${newConclusion.trim()}\u201D\u3002
\u539F\u56E0\uFF1A${reason.trim()}
\u9884\u8BA1\u5F71\u54CD\uFF1A${affectedText}
\u786E\u8BA4\u4FEE\u8BA2\u5417\uFF1F`,
      options: [
        { id: "confirm", label: "\u786E\u8BA4\u4FEE\u8BA2" },
        { id: "cancel", label: "\u53D6\u6D88" }
      ],
      revision: { decisionId, oldConclusion: old.conclusion ?? old.question, newConclusion: newConclusion.trim(), reason: reason.trim(), affected }
    });
    draft.lastUpdatedBy = { host, pluginVersion: "5.1.0" };
  }, () => ({ decisionId, successorId, presentationEventId: interaction?.presentationEventId }));
  if (!interaction) throw new DevFlowError("INTERACTION_NOT_CREATED", target);
  return { state, interaction: toPublicInteraction(interaction), decisionId: successorId, interactionId: interaction.id };
}
function applyDecisionRevision(draft, interaction, response, promptEventId, host) {
  const rev = interaction.revision;
  if (!rev) throw new DevFlowError("INTERACTION_INVALID", "decision-revision interaction is missing its candidate content", { interactionId: interaction.id });
  const gov = draft.governance ?? EMPTY_GOVERNANCE_LEDGER;
  const decisions = [...gov.decisions];
  const index = decisions.findIndex((candidate) => candidate.recordId === rev.decisionId && !candidate.supersededBy);
  if (index < 0) throw new DevFlowError("DECISION_NOT_FOUND", rev.decisionId);
  const old = decisions[index];
  const successorId = revisionSuccessorId(old.question, rev.newConclusion, rev.reason);
  decisions[index] = { ...decisions[index], supersededBy: successorId };
  const credentialId = `CRED-rev-${interaction.id}`;
  if (!decisions.some((candidate) => candidate.recordId === successorId)) {
    decisions.push({
      recordId: successorId,
      kind: "decision",
      question: old.question,
      conclusion: rev.newConclusion,
      credentialId,
      ...promptEventId ? { basis: { kind: "event", eventId: promptEventId } } : interaction.presentationEventId ? { basis: { kind: "event", eventId: interaction.presentationEventId } } : {},
      recordedAt: response.respondedAt
    });
  }
  const credentials = [...gov.credentials];
  if (!credentials.some((candidate) => candidate.recordId === credentialId)) {
    credentials.push({
      recordId: credentialId,
      kind: "credential",
      source: response.source === "elicitation" ? "native-form" : "text",
      host,
      interactionId: interaction.id,
      ...response.source === "elicitation" ? { optionId: response.selectedOptionId ?? response.action } : response.selectedOptionId ? { optionId: response.selectedOptionId } : {},
      ...response.rawReply ? { rawText: response.rawReply } : {},
      ...promptEventId ? { basis: { kind: "event", eventId: promptEventId } } : interaction.presentationEventId ? { basis: { kind: "event", eventId: interaction.presentationEventId } } : {},
      recordedAt: response.respondedAt
    });
  }
  draft.governance = { ...gov, decisions, credentials };
  if (rev.affected.includes("classification")) {
    if (draft.mode === "routed") {
      draft.mode = "intake";
      const intakeDraft = draft;
      delete intakeDraft.route;
      delete intakeDraft.classification;
      delete intakeDraft.classificationBasis;
      delete intakeDraft.obligations;
      delete intakeDraft.routeConfirmation;
      delete intakeDraft.traceability;
      delete intakeDraft.review;
      delete intakeDraft.pendingDecision;
      draft.steps = {};
      draft.humanGates = {};
    }
  }
  if (rev.affected.includes("requirements") && draft.artifacts.requirements) delete draft.artifacts.requirements;
  if (rev.affected.includes("plan")) {
    if (draft.artifacts["implementation-plan"]) delete draft.artifacts["implementation-plan"];
    delete draft.traceability;
  }
}
async function resolveRatificationForAnswer(ctx) {
  const { root: root2, featureId, expectedRevision, host, credential, interaction, state } = ctx;
  if (interaction.kind !== "decision-ratification" || interaction.status !== "pending") {
    throw new DevFlowError("INTERACTION_NOT_PENDING", "\u5F53\u524D\u6CA1\u6709\u5F85\u8FFD\u8BA4\u7684\u51B3\u5B9A\u3002", { interactionId: interaction.id });
  }
  let promptEventId;
  let promptText;
  if (credential.source === "text") {
    const events = await readFeatureEvents(root2, featureId);
    const match = resolveInteractionPromptEvent(events, state, interaction, { host, userReply: credential.userReply });
    promptEventId = match.eventId;
    promptText = match.text;
  }
  const pending = pendingDecisionForState(state);
  const matchedId = credential.source === "elicitation" ? credential.action : matchDecisionReply(pending, promptText ?? credential.userReply).option.id;
  const confirms = matchedId === "confirm";
  let response;
  const next = await mutatePrepared(root2, featureId, expectedRevision, confirms ? "decision-ratified" : "decision-ratification-rejected", async () => ({
    mutate: (draft) => {
      response = resolveResponseForAnswer(draft, interaction, { source: credential.source, action: credential.source === "elicitation" ? credential.action : void 0, comment: credential.source === "elicitation" ? credential.comment : void 0, userReply: credential.source === "text" ? credential.userReply : void 0, promptText, promptEventId, host });
      if (confirms) ratifyDecision(draft, draft.interactions[interaction.id], response, promptEventId, host);
      draft.lastUpdatedBy = { host, pluginVersion: "5.1.0" };
    },
    eventData: () => ({ interactionId: interaction.id, action: matchedId })
  }));
  if (!response) throw new DevFlowError("INTERACTION_NOT_RESOLVED", interaction.id);
  return { state: next, action: response.action, ...response.comment ? { comment: response.comment } : {} };
}
async function resolveRevisionForAnswer(ctx) {
  const { root: root2, featureId, expectedRevision, host, credential, interaction, state } = ctx;
  if (interaction.kind !== "decision-revision" || interaction.status !== "pending") {
    throw new DevFlowError("INTERACTION_NOT_PENDING", "\u5F53\u524D\u6CA1\u6709\u5F85\u4FEE\u8BA2\u7684\u51B3\u5B9A\u3002", { interactionId: interaction.id });
  }
  let promptEventId;
  let promptText;
  if (credential.source === "text") {
    const events = await readFeatureEvents(root2, featureId);
    const match = resolveInteractionPromptEvent(events, state, interaction, { host, userReply: credential.userReply });
    promptEventId = match.eventId;
    promptText = match.text;
  }
  const pending = pendingDecisionForState(state);
  const matchedId = credential.source === "elicitation" ? credential.action : matchDecisionReply(pending, promptText ?? credential.userReply).option.id;
  const confirms = matchedId === "confirm";
  let response;
  const next = await mutatePrepared(root2, featureId, expectedRevision, confirms ? "decision-revised" : "decision-revision-cancelled", async () => ({
    mutate: (draft) => {
      response = resolveResponseForAnswer(draft, interaction, { source: credential.source, action: credential.source === "elicitation" ? credential.action : void 0, comment: credential.source === "elicitation" ? credential.comment : void 0, userReply: credential.source === "text" ? credential.userReply : void 0, promptText, promptEventId, host });
      if (confirms) applyDecisionRevision(draft, draft.interactions[interaction.id], response, promptEventId, host);
      draft.lastUpdatedBy = { host, pluginVersion: "5.1.0" };
    },
    eventData: () => ({ interactionId: interaction.id, action: matchedId })
  }));
  if (!response) throw new DevFlowError("INTERACTION_NOT_RESOLVED", interaction.id);
  return { state: next, action: response.action, ...response.comment ? { comment: response.comment } : {} };
}

// plugins/dev-flow/src/core/plan-revision.ts
import { createHash as createHash18 } from "node:crypto";

// plugins/dev-flow/src/core/plan-compile-context.ts
import { createHash as createHash17 } from "node:crypto";
import { readFile as readFile10 } from "node:fs/promises";
import path13 from "node:path";

// plugins/dev-flow/src/core/plan-compiler.ts
function diagnosticFrom(error, position, fallbackCode) {
  if (error instanceof DevFlowError) {
    return {
      code: error.code,
      position,
      message: error.message.replace(/^[A-Z_]+:\s*/, ""),
      recoveryHint: typeof error.details?.recoveryHint === "string" ? error.details.recoveryHint : "\u4FEE\u6B63\u5BF9\u5E94\u4F4D\u7F6E\u540E\u91CD\u65B0\u9884\u68C0\u3002"
    };
  }
  return { code: fallbackCode, position, message: error instanceof Error ? error.message : String(error), recoveryHint: "\u4FEE\u6B63\u5BF9\u5E94\u4F4D\u7F6E\u540E\u91CD\u65B0\u9884\u68C0\u3002" };
}
function compileCore(input) {
  const diagnostics2 = [];
  let ledger;
  try {
    ledger = applyTraceDelta({
      current: input.currentLedger,
      route: input.route,
      artifactKind: input.artifactKind,
      artifactSha256: input.artifactSha256,
      sourceBlocks: input.sourceBlocks,
      delta: input.traceDelta,
      projectConfigSha256: input.projectConfigSha256,
      verificationCommandIds: input.verificationCommandIds,
      verificationCommandHashes: input.verificationCommandHashes,
      nextStateRevision: input.nextStateRevision
    }, { validateGraph: false });
  } catch (error) {
    return { diagnostics: [diagnosticFrom(error, "trace-delta", "TRACE_DELTA_INVALID")] };
  }
  let graphError;
  try {
    validateTraceGraph(ledger, input.route, "partial");
  } catch (error) {
    graphError = diagnosticFrom(error, "plan-graph", "PLAN_TASK_GRAPH_INVALID");
    diagnostics2.push(graphError);
  }
  if (input.artifactKind !== "implementation-plan") return { diagnostics: diagnostics2, ledger };
  const highRisk = (input.riskLabels ?? []).some((label) => label === "data" || label === "external" || label === "irreversible_consequence");
  if (highRisk) {
    const recoveries = Object.values(ledger.nodes).filter((node) => node.kind === "recovery" && node.status === "current");
    if (recoveries.length === 0) {
      diagnostics2.push({
        code: "PLAN_RECOVERY_REQUIRED",
        position: "plan-recovery",
        message: "\u5F53\u524D\u8DEF\u7EBF\u6D89\u53CA\u6570\u636E\u8FC1\u79FB\u3001\u5916\u90E8\u526F\u4F5C\u7528\u6216\u4E0D\u53EF\u9006\u6B65\u9AA4\uFF0C\u5B9E\u65BD\u8BA1\u5212\u5FC5\u987B\u4E3A\u9AD8\u98CE\u9669\u6B65\u9AA4\u58F0\u660E\u6062\u590D\u5B89\u6392\uFF08recovery \u8282\u70B9\uFF09\u3002",
        recoveryHint: "\u4E3A\u53D7\u4FDD\u62A4\u6B65\u9AA4\u6DFB\u52A0 recovery \u951A\u70B9\uFF08stepRef/recoveryKind/method/riskRef\uFF09\uFF0C\u6216\u786E\u8BA4\u8BE5\u6B65\u9AA4\u4E0D\u5C5E\u4E8E\u9AD8\u98CE\u9669\u7C7B\u522B\u3002"
      });
    } else {
      const steps = Object.values(ledger.nodes).filter((node) => node.kind === "implementation-unit" && node.status === "current");
      for (const step of steps) {
        const matching = recoveries.filter((recovery) => recovery.stepRef === step.id || recovery.stepRef.startsWith("TASK-") && step.tasks.includes(recovery.stepRef));
        if (!matching.length) {
          diagnostics2.push({
            code: "PLAN_RECOVERY_STEP_UNCOVERED",
            position: step.id,
            message: `\u9AD8\u98CE\u9669\u6B65\u9AA4 ${step.id} \u6CA1\u6709\u5339\u914D\u7684\u6062\u590D\u5B89\u6392\u3002`,
            recoveryHint: `\u4E3A ${step.id} \u6216\u5176\u4EFB\u52A1\u6DFB\u52A0 recovery\uFF0C\u5E76\u8BA9 riskRef \u660E\u786E\u5BF9\u5E94\u5F53\u524D\u98CE\u9669\u3002`
          });
        }
      }
    }
  }
  if (!graphError) {
    try {
      validateTraceGraph(ledger, input.route, "complete");
      assertTraceabilityComplete(ledger, input.route, input.projectConfigSha256, input.verificationCommandHashes);
    } catch (error) {
      diagnostics2.push(diagnosticFrom(error, "plan-complete", "TRACE_SLICE_INCOMPLETE"));
    }
  }
  for (const uncovered of collectUncoveredAcceptanceCriteria(ledger)) {
    diagnostics2.push({
      code: "TRACE_SLICE_INCOMPLETE",
      position: uncovered.id,
      message: `\u9A8C\u6536\u6761\u4EF6 ${uncovered.id} \u7F3A\u5C11\u9A8C\u8BC1\u5904\u7F6E\uFF1A\u6CA1\u6709\u884C\u4E3A\u6D4B\u8BD5\uFF08TEST \u8282\u70B9 verifies \u5B83\uFF09\uFF0C\u4E5F\u6CA1\u6709\u6709\u6548\u7684\u975E\u884C\u4E3A\u5904\u7F6E\uFF08\u7C7B\u578B/\u89C4\u5219\u68C0\u67E5\u3001\u6587\u4EF6\u6838\u5BF9\u6216\u4EBA\u5DE5\u9A8C\u6536\uFF09\u3002`,
      recoveryHint: "\u4E3A\u8BE5\u9A8C\u6536\u6761\u4EF6\u6DFB\u52A0 TEST \u8282\u70B9\uFF0C\u6216\u6309\u9A8C\u8BC1\u5904\u7F6E\u89C4\u5219\u4E3A\u5B83\u58F0\u660E\u5177\u4F53\u7684\u975E\u884C\u4E3A\u9A8C\u8BC1\u65B9\u6CD5\u4E0E\u9884\u671F\u8BC1\u636E\u3002"
    });
  }
  const testFirstAcCoveredByTest = /* @__PURE__ */ new Set();
  for (const node of Object.values(ledger.nodes)) {
    if (node.kind !== "task" || node.tdd !== "test-first") continue;
    for (const covered of node.covers) {
      if (covered.startsWith("AC-")) testFirstAcCoveredByTest.add(covered);
    }
  }
  if (testFirstAcCoveredByTest.size > 0) {
    const tests = Object.values(ledger.nodes).filter((node) => node.kind === "test" && node.status === "current").flatMap((node) => node.verifies);
    const covered = new Set(tests);
    for (const acId of [...testFirstAcCoveredByTest].sort()) {
      if (covered.has(acId)) continue;
      diagnostics2.push({
        code: "TEST_FIRST_REQUIRES_BEHAVIOR_TEST",
        position: acId,
        message: `\u9A8C\u6536\u6761\u4EF6 ${acId} \u7531 test-first \u4EFB\u52A1\u8986\u76D6\uFF0C\u5FC5\u987B\u7531\u884C\u4E3A\u6D4B\u8BD5\u9A8C\u8BC1\uFF1B\u975E\u884C\u4E3A\u9A8C\u8BC1\u5904\u7F6E\u4E0D\u80FD\u66FF\u4EE3\u53EF\u81EA\u52A8\u6D4B\u8BD5\u884C\u4E3A\u53D8\u66F4\u7684\u6D4B\u8BD5\u5148\u884C\u3002`,
        recoveryHint: "\u4E3A\u8BE5\u9A8C\u6536\u6761\u4EF6\u6DFB\u52A0 TEST \u8282\u70B9\uFF0C\u6216\u5C06\u8BE5\u4EFB\u52A1\u58F0\u660E\u4E3A direct\uFF08\u975E\u884C\u4E3A\u53D8\u66F4\uFF09\u3002"
      });
    }
  }
  return { diagnostics: diagnostics2, ledger };
}
function compilePlan(input) {
  const { diagnostics: diagnostics2, ledger } = compileCore(input);
  if (diagnostics2.length > 0) return { ok: false, diagnostics: diagnostics2 };
  const nodes = Object.values(ledger.nodes);
  const current = (node) => node.status === "current";
  const implementationUnits = nodes.filter((node) => current(node) && node.kind === "implementation-unit").sort((left, right) => left.id.localeCompare(right.id)).map((node) => ({
    unitId: node.id,
    tasks: [...node.tasks],
    dependsOn: [...node.dependsOn],
    fileScope: [...node.fileScope],
    forwardVerification: node.forwardVerification.filter((ref) => typeof ref === "string")
  }));
  const recoveryArrangements = nodes.filter((node) => current(node) && node.kind === "recovery").sort((left, right) => left.id.localeCompare(right.id)).map((node) => ({
    arrangementId: node.id,
    stepRef: node.stepRef,
    recoveryKind: node.recoveryKind,
    method: node.method,
    riskRef: node.riskRef
  }));
  return { ok: true, diagnostics: diagnostics2, ledger, implementationUnits, recoveryArrangements };
}

// plugins/dev-flow/src/core/traceability-anchors.ts
import { createHash as createHash16 } from "node:crypto";
var TRACE_ANCHOR = /<!-- dev-flow:id=(REQ|AC|TASK|TEST|UNIT|RU|REC)-([0-9]{3,}) kind=(requirement|acceptance-criterion|task|test|implementation-unit|rollback|recovery) -->/g;
var expectedKind = {
  REQ: "requirement",
  AC: "acceptance-criterion",
  TASK: "task",
  TEST: "test",
  UNIT: "implementation-unit",
  RU: "rollback",
  REC: "recovery"
};
function invalidAnchor(message, details = {}) {
  throw new DevFlowError("TRACE_SOURCE_ANCHOR_INVALID", message, details);
}
function parseTraceSourceBlocks(markdown) {
  const devFlowComments = markdown.match(/<!-- dev-flow:[\s\S]*?-->/g) ?? [];
  TRACE_ANCHOR.lastIndex = 0;
  const anchors = [];
  let match;
  while ((match = TRACE_ANCHOR.exec(markdown)) !== null) {
    const [, prefix, suffix, rawKind] = match;
    const kind = rawKind;
    if (expectedKind[prefix] !== kind) {
      invalidAnchor("anchor ID prefix does not match its kind", { prefix, kind });
    }
    const id = `${prefix}-${suffix}`;
    if (anchors.some((anchor) => anchor.id === id)) {
      invalidAnchor("anchor ID is declared more than once", { id });
    }
    anchors.push({ id, kind, sourceAnchor: match[0], index: match.index });
  }
  if (anchors.length === 0 || anchors.length !== devFlowComments.length) {
    invalidAnchor("trace artifacts require one or more exact declaration anchors");
  }
  return anchors.map((anchor, index) => {
    const end = anchors[index + 1]?.index ?? markdown.length;
    const sourceBlock = markdown.slice(anchor.index, end);
    return {
      id: anchor.id,
      kind: anchor.kind,
      sourceAnchor: anchor.sourceAnchor,
      sourceBlockSha256: createHash16("sha256").update(sourceBlock, "utf8").digest("hex")
    };
  });
}

// plugins/dev-flow/src/core/plan-compile-context.ts
var featureDirectory = (root2, id) => path13.join(root2, ".dev-flow", "features", id);
async function compileArtifactPlan(root2, id, state, options) {
  const artifact = state.artifacts[options.artifactKind];
  if (!artifact) throw new DevFlowError("MISSING_REQUIRED_ARTIFACT", options.artifactKind);
  const contents = await readFile10(path13.join(featureDirectory(root2, id), normalizeUnicode(artifact.path)), "utf8");
  const { config, sha256: projectConfigSha256 } = await readProjectConfigSnapshot(root2);
  const currentLedger = await readTraceabilityForArtifactReplacement(root2, state, options.artifactKind);
  const input = {
    route: state.route,
    artifactKind: options.artifactKind,
    artifactSha256: createHash17("sha256").update(contents).digest("hex"),
    sourceBlocks: parseTraceSourceBlocks(contents),
    currentLedger,
    traceDelta: options.traceDelta,
    projectConfigSha256,
    verificationCommandIds: config.verification.commands.map((command2) => command2.id),
    verificationCommandHashes: verificationCommandHashes(config),
    nextStateRevision: options.nextStateRevision,
    riskLabels: state.classification.riskLabels
  };
  return { input, result: compilePlan(input), artifact, config };
}

// plugins/dev-flow/src/core/plan-revision.ts
async function revisePlanDuringImplementation(root2, id, expectedRevision, traceDelta, host) {
  const initial = await readState(root2, id);
  if (initial.revision !== expectedRevision) throw new DevFlowError("STATE_REVISION_CONFLICT", "state revision changed", { currentRevision: initial.revision });
  if (initial.lifecycle !== "active") throw new DevFlowError("INVALID_LIFECYCLE", "only active features can revise plans");
  if (!traceEnforcementRequired(initial.route, initial.classification.controls)) {
    throw new DevFlowError("TRACE_NOT_ENFORCED", "\u8BA1\u5212\u4FEE\u8BA2\u9700\u8981\u542F\u7528 Trace \u7684\u8DEF\u7EBF", { route: initial.route });
  }
  const currentStep = currentOpenStep(initial);
  if (currentStep !== "implementation" && currentStep !== "planning") {
    throw new DevFlowError("STEP_OUT_OF_ORDER", "\u8BA1\u5212\u4FEE\u8BA2\u53EA\u9002\u7528\u4E8E planning/implementation \u9636\u6BB5", { currentStep });
  }
  const compilation = await compileArtifactPlan(root2, id, initial, { artifactKind: "implementation-plan", traceDelta, nextStateRevision: expectedRevision + 1 });
  const compile = compilation.result;
  const currentLedger = compilation.input.currentLedger;
  const artifactSha256 = compilation.input.artifactSha256;
  const projectConfigSha256 = compilation.input.projectConfigSha256;
  if (!compile.ok) {
    throw new DevFlowError("PLAN_INVALID", "\u4FEE\u8BA2\u540E\u7684\u5B9E\u65BD\u8BA1\u5212\u7F16\u8BD1\u672A\u901A\u8FC7\u3002", {
      diagnostics: compile.diagnostics,
      recoveryHint: "\u6309\u8BCA\u65AD\u4FEE\u6B63\u8BA1\u5212\u5185\u5BB9\u540E\u91CD\u65B0\u53D1\u8D77\u4FEE\u8BA2\u3002",
      retryOriginal: true
    });
  }
  const newLedger = compile.ledger;
  const impact = computePlanRevisionImpact(currentLedger, newLedger);
  const affectedIds = new Set(impact.affectedIds);
  const { fallbackReason } = impact;
  const recoveryNodes = Object.values(currentLedger.nodes).filter((node) => node.kind === "recovery" && node.status === "current");
  const recoveryStepRefs = new Set(recoveryNodes.map((node) => node.stepRef));
  const unitTasks = new Map(
    Object.values(currentLedger.nodes).filter((node) => node.kind === "implementation-unit" && node.status === "current").map((node) => [node.id, node.tasks])
  );
  const units = initial.implementationUnits ?? [];
  const checkpointedAffected = units.filter((unit) => affectedIds.has(unit.unitId) && unit.status === "checkpointed").map((unit) => unit.unitId);
  const sideEffectUnits = checkpointedAffected.filter((unitId) => {
    const tasks = unitTasks.get(unitId) ?? [];
    return recoveryStepRefs.has(unitId) || recoveryNodes.some((recovery) => recovery.stepRef.startsWith("TASK-") && tasks.includes(recovery.stepRef));
  });
  const reviewInvalidated = Boolean(initial.review) || Boolean(fallbackReason);
  const target = `plan-revision:${createHash18("sha256").update(JSON.stringify(traceDelta)).digest("hex").slice(0, 16)}`;
  let interaction;
  const state = await mutate(root2, id, expectedRevision, "plan-revision-presented", (draft) => {
    const activeUnit = (draft.implementationUnits ?? []).find((unit) => unit.status === "active");
    const impactLines = [
      `- \u53D7\u5F71\u54CD\u7684\u5B9E\u73B0\u5355\u5143\uFF1A${[...affectedIds].sort().join("\u3001") || "\u65E0"}`,
      `- \u5C06\u91CD\u505A\u7684\u5DF2\u5B8C\u6210\u5355\u5143\uFF1A${checkpointedAffected.join("\u3001") || "\u65E0"}`,
      ...sideEffectUnits.length ? [`- \u26A0 \u4EE5\u4E0B\u5DF2\u5B8C\u6210\u5355\u5143\u53EF\u80FD\u5305\u542B\u6709\u526F\u4F5C\u7528\u7684\u64CD\u4F5C\uFF08\u5220\u9664/\u8FC1\u79FB/\u53D1\u5E03\u7B49\uFF09\uFF0C\u91CD\u65B0\u6267\u884C\u524D\u5FC5\u987B\u786E\u8BA4\u5F53\u524D\u72B6\u6001\u5B89\u5168\uFF1A${sideEffectUnits.join("\u3001")}`] : [],
      `- \u8BA1\u5212\u5BA1\u67E5\uFF1A${reviewInvalidated ? "\u5931\u6548\uFF0C\u9700\u8981\u91CD\u65B0\u5BA1\u67E5" : "\u672A\u542F\u7528"}`,
      ...activeUnit ? [`- \u5F53\u524D\u6B65\u9AA4\u6682\u505C\uFF1A${activeUnit.unitId}\uFF08${activeUnit.status}\uFF09\u5C06\u56DE\u5230\u5F85\u6267\u884C`] : [],
      ...fallbackReason ? [`- ${fallbackReason}`] : []
    ];
    interaction = createInteraction(draft, {
      kind: "plan-revision",
      target,
      basisHash: createHash18("sha256").update(`${id}
${JSON.stringify(traceDelta)}`).digest("hex"),
      question: `\u4FEE\u8BA2\u5B9E\u65BD\u8BA1\u5212\u5C06\u4EA7\u751F\u4EE5\u4E0B\u5F71\u54CD\uFF1A
${impactLines.join("\n")}
\u786E\u8BA4\u4FEE\u8BA2\u5417\uFF1F`,
      options: [
        { id: "confirm", label: "\u786E\u8BA4\u4FEE\u8BA2" },
        { id: "cancel", label: "\u53D6\u6D88" }
      ],
      planRevision: {
        affectedUnits: [...affectedIds].sort(),
        redoUnits: checkpointedAffected,
        sideEffectUnits,
        reviewInvalidated,
        ...fallbackReason ? { fallbackReason } : {}
      },
      planRevisionBasis: {
        artifactSha256,
        projectConfigSha256,
        traceabilitySha256: initial.traceability?.sha256 ?? "none"
      }
    });
    draft.lastUpdatedBy = { host, pluginVersion: "5.1.0" };
  }, () => ({ presentationEventId: interaction?.presentationEventId }));
  if (!interaction) throw new DevFlowError("INTERACTION_NOT_CREATED", target);
  return { state, interaction: toPublicInteraction(interaction), interactionId: interaction.id };
}
function applyPlanRevision(draft, interaction, host) {
  const revision = interaction.planRevision;
  if (!revision) throw new DevFlowError("INTERACTION_INVALID", "plan-revision interaction is missing its revision content", { interactionId: interaction.id });
  const units = draft.implementationUnits ?? [];
  const affected = new Set(revision.affectedUnits);
  const sideEffects = new Set(revision.sideEffectUnits);
  for (const unit of units) {
    if (!affected.has(unit.unitId)) continue;
    if (sideEffects.has(unit.unitId)) continue;
    if (unit.status === "active" || unit.status === "pending") continue;
    reopenImplementationUnit(unit);
  }
  draft.implementationUnits = units;
  delete draft.steps.planning;
  delete draft.steps.implementation;
  delete draft.steps.code_review;
  draft.lastUpdatedBy = { host, pluginVersion: "5.1.0" };
}
async function resolvePlanRevisionForAnswer(ctx) {
  const { root: root2, featureId, expectedRevision, host, credential, interaction, state } = ctx;
  if (interaction.kind !== "plan-revision" || interaction.status !== "pending") {
    throw new DevFlowError("INTERACTION_NOT_PENDING", "\u5F53\u524D\u6CA1\u6709\u5F85\u5904\u7406\u7684\u8BA1\u5212\u4FEE\u8BA2\u3002", { interactionId: interaction.id });
  }
  let promptEventId;
  let promptText;
  if (credential.source === "text") {
    const events = await readFeatureEvents(root2, featureId);
    const match = resolveInteractionPromptEvent(events, state, interaction, { host, userReply: credential.userReply });
    promptEventId = match.eventId;
    promptText = match.text;
  }
  const pending = pendingDecisionForState(state);
  const matchedId = credential.source === "elicitation" ? credential.action : matchDecisionReply(pending, promptText ?? credential.userReply).option.id;
  const confirms = matchedId === "confirm";
  let reviewInvalidation;
  let response;
  const next = await mutatePrepared(root2, featureId, expectedRevision, confirms ? "plan-revised" : "plan-revision-cancelled", async (current, nextStateRevision) => {
    if (confirms) {
      const live = current.interactions?.[interaction.id];
      const basis = live?.planRevisionBasis;
      const artifact = current.artifacts["implementation-plan"];
      if (!basis || !artifact) throw new DevFlowError("PLAN_REVISION_STALE", "\u8BA1\u5212\u4FEE\u8BA2\u9884\u89C8\u7F3A\u5C11\u5F53\u524D\u4F9D\u636E\uFF0C\u8BF7\u91CD\u65B0\u751F\u6210\u3002", { retryOriginal: true });
      const contents = await readArtifactText(root2, featureId, artifact.path);
      const currentArtifactSha256 = createHash18("sha256").update(contents).digest("hex");
      const currentConfigSha256 = (await readProjectConfigSnapshot(root2)).sha256;
      const currentTraceabilitySha256 = current.traceability?.sha256 ?? "none";
      if (currentArtifactSha256 !== basis.artifactSha256 || currentConfigSha256 !== basis.projectConfigSha256 || currentTraceabilitySha256 !== basis.traceabilitySha256) {
        throw new DevFlowError("PLAN_REVISION_STALE", "\u8BA1\u5212\u3001\u9879\u76EE\u914D\u7F6E\u6216 Trace \u5DF2\u5728\u9884\u89C8\u540E\u53D8\u5316\uFF0C\u8BF7\u91CD\u65B0\u751F\u6210\u5F71\u54CD\u9884\u89C8\u3002", {
          retryOriginal: true,
          changed: [
            ...currentArtifactSha256 !== basis.artifactSha256 ? ["implementation-plan"] : [],
            ...currentConfigSha256 !== basis.projectConfigSha256 ? ["project-config"] : [],
            ...currentTraceabilitySha256 !== basis.traceabilitySha256 ? ["traceability"] : []
          ]
        });
      }
      if (current.review) reviewInvalidation = await prepareReviewInvalidation(root2, current, nextStateRevision);
    }
    return {
      mutate: (draft) => {
        response = resolveResponseForAnswer(draft, interaction, { source: credential.source, action: credential.source === "elicitation" ? credential.action : void 0, comment: credential.source === "elicitation" ? credential.comment : void 0, userReply: credential.source === "text" ? credential.userReply : void 0, promptText, promptEventId, host });
        if (confirms) {
          const live = draft.interactions[interaction.id];
          applyPlanRevision(draft, live, host);
          if (reviewInvalidation) draft.review = reviewInvalidation;
          const sideEffects = live.planRevision?.sideEffectUnits ?? [];
          if (sideEffects.length) {
            createInteraction(draft, {
              kind: "side-effect-rerun",
              target: `side-effect-rerun:${[...sideEffects].sort().join(",")}`,
              basisHash: createHash18("sha256").update(`${featureId}
${[...sideEffects].sort().join("\n")}`).digest("hex"),
              question: `\u4EE5\u4E0B\u5DF2\u5B8C\u6210\u5B9E\u73B0\u5355\u5143\u5305\u542B\u6709\u526F\u4F5C\u7528\u7684\u64CD\u4F5C\uFF08\u5220\u9664/\u8FC1\u79FB/\u53D1\u5E03\u7B49\uFF09\uFF0C\u8BA1\u5212\u4FEE\u8BA2\u540E\u4E0D\u4F1A\u81EA\u52A8\u91CD\u8DD1\uFF1A${[...sideEffects].sort().join("\u3001")}\u3002\u786E\u8BA4\u91CD\u8DD1\u8FD9\u4E9B\u5355\u5143\u5417\uFF1F\u91CD\u8DD1\u524D\u8BF7\u786E\u8BA4\u5F53\u524D\u72B6\u6001\u5B89\u5168\u3002`,
              options: [
                { id: "confirm", label: "\u786E\u8BA4\u91CD\u8DD1" },
                { id: "keep", label: "\u4E0D\u91CD\u8DD1\uFF0C\u4FDD\u7559\u539F\u7ED3\u679C" }
              ],
              sideEffectRerun: { units: [...sideEffects].sort() }
            });
          }
        }
        draft.lastUpdatedBy = { host, pluginVersion: "5.1.0" };
      },
      eventData: () => ({ interactionId: interaction.id, action: matchedId })
    };
  });
  if (!response) throw new DevFlowError("INTERACTION_NOT_RESOLVED", interaction.id);
  return { state: next, action: response.action, ...response.comment ? { comment: response.comment } : {} };
}
async function resolveSideEffectRerunForAnswer(ctx) {
  const { root: root2, featureId, expectedRevision, host, credential, interaction, state } = ctx;
  if (interaction.kind !== "side-effect-rerun" || interaction.status !== "pending") {
    throw new DevFlowError("INTERACTION_NOT_PENDING", "\u5F53\u524D\u6CA1\u6709\u5F85\u5904\u7406\u7684\u526F\u4F5C\u7528\u5355\u5143\u786E\u8BA4\u3002", { interactionId: interaction.id });
  }
  let promptEventId;
  let promptText;
  if (credential.source === "text") {
    const events = await readFeatureEvents(root2, featureId);
    const match = resolveInteractionPromptEvent(events, state, interaction, { host, userReply: credential.userReply });
    promptEventId = match.eventId;
    promptText = match.text;
  }
  const pending = pendingDecisionForState(state);
  const matchedId = credential.source === "elicitation" ? credential.action : matchDecisionReply(pending, promptText ?? credential.userReply).option.id;
  const confirms = matchedId === "confirm";
  let response;
  const next = await mutatePrepared(root2, featureId, expectedRevision, confirms ? "side-effect-rerun-confirmed" : "side-effect-rerun-kept", async () => ({
    mutate: (draft) => {
      response = resolveResponseForAnswer(draft, interaction, { source: credential.source, action: credential.source === "elicitation" ? credential.action : void 0, comment: credential.source === "elicitation" ? credential.comment : void 0, userReply: credential.source === "text" ? credential.userReply : void 0, promptText, promptEventId, host });
      if (confirms) {
        const live = draft.interactions[interaction.id];
        const units = draft.implementationUnits ?? [];
        let reopened = false;
        for (const unit of units) {
          if (!live.sideEffectRerun?.units.includes(unit.unitId)) continue;
          if (unit.status !== "checkpointed") continue;
          reopenImplementationUnit(unit);
          reopened = true;
        }
        if (reopened) {
          delete draft.steps.implementation;
          draft.logicComplete = false;
          delete draft.steps.finalize;
        }
      }
      draft.lastUpdatedBy = { host, pluginVersion: "5.1.0" };
    },
    eventData: () => ({ interactionId: interaction.id, action: matchedId })
  }));
  if (!response) throw new DevFlowError("INTERACTION_NOT_RESOLVED", interaction.id);
  return { state: next, action: response.action, ...response.comment ? { comment: response.comment } : {} };
}
function semanticKey(node) {
  switch (node.kind) {
    case "requirement":
      return JSON.stringify({ kind: node.kind, id: node.id });
    case "acceptance-criterion":
      return JSON.stringify({ kind: node.kind, id: node.id, parentRequirement: node.parentRequirement, verificationDisposition: node.verificationDisposition });
    case "task":
      return JSON.stringify({ kind: node.kind, id: node.id, covers: [...node.covers].sort(), implementationUnit: node.implementationUnit, tdd: node.tdd });
    case "test":
      return JSON.stringify({ kind: node.kind, id: node.id, verifies: [...node.verifies].sort() });
    case "rollback":
      return JSON.stringify({ kind: node.kind, id: node.id, tasks: [...node.tasks].sort(), dependsOn: [...node.dependsOn].sort(), fileScope: [...node.fileScope].sort(), covers: [...node.covers].sort(), forwardVerification: node.forwardVerification, rollbackVerification: node.rollbackVerification });
    case "implementation-unit":
      return JSON.stringify({ kind: node.kind, id: node.id, tasks: [...node.tasks].sort(), dependsOn: [...node.dependsOn].sort(), fileScope: [...node.fileScope].sort(), covers: [...node.covers].sort(), forwardVerification: node.forwardVerification });
    case "recovery":
      return JSON.stringify({ kind: node.kind, id: node.id, stepRef: node.stepRef, recoveryKind: node.recoveryKind, method: node.method, riskRef: node.riskRef });
  }
}
function computePlanRevisionImpact(currentLedger, newLedger) {
  const oldUnits = Object.values(currentLedger.nodes).filter((node) => node.kind === "implementation-unit" && node.status === "current");
  const newUnits = Object.values(newLedger.nodes).filter((node) => node.kind === "implementation-unit" && node.status === "current");
  const oldCurrent = Object.values(currentLedger.nodes).filter((node) => node.status === "current");
  const newCurrent = Object.values(newLedger.nodes).filter((node) => node.status === "current");
  const oldById = new Map(oldCurrent.map((node) => [node.id, node]));
  const newById = new Map(newCurrent.map((node) => [node.id, node]));
  const changedNodeIds = /* @__PURE__ */ new Set();
  for (const node of oldCurrent) {
    const next = newById.get(node.id);
    if (!next || semanticKey(node) !== semanticKey(next)) changedNodeIds.add(node.id);
  }
  for (const node of newCurrent) if (!oldById.has(node.id)) changedNodeIds.add(node.id);
  const newByKey = new Map(newUnits.map((node) => [node.id, node]));
  const affectedIds = /* @__PURE__ */ new Set();
  for (const node of oldUnits) {
    const next = newByKey.get(node.id);
    if (!next || changedNodeIds.has(node.id)) affectedIds.add(node.id);
  }
  for (const node of newUnits) {
    if (!oldUnits.some((old) => old.id === node.id) || changedNodeIds.has(node.id)) affectedIds.add(node.id);
  }
  for (const unit of [...oldUnits, ...newUnits]) {
    const touches = [...changedNodeIds].some((id) => {
      const node = newById.get(id) ?? oldById.get(id);
      if (!node) return false;
      if (node.kind === "task") return unit.tasks.includes(node.id);
      if (node.kind === "acceptance-criterion" || node.kind === "test") {
        const criteria = node.kind === "test" ? node.verifies : [node.id];
        return criteria.some((criterion) => unit.covers.includes(criterion));
      }
      if (node.kind === "recovery") return node.stepRef === unit.id || unit.tasks.some((taskId) => taskId === node.stepRef);
      return false;
    });
    if (touches) affectedIds.add(unit.id);
  }
  const unmappedChanged = [...changedNodeIds].filter((id) => {
    const node = newById.get(id) ?? oldById.get(id);
    return node && node.kind !== "task" && node.kind !== "acceptance-criterion" && node.kind !== "test" && node.kind !== "recovery" && node.kind !== "implementation-unit";
  });
  const fallbackReason = unmappedChanged.length ? `\u65E0\u6CD5\u5C40\u90E8\u5B9A\u4F4D\u53D8\u5316\u5F71\u54CD\uFF1A\u53D8\u5316\u7684\u8282\u70B9\u79CD\u7C7B\u4E0D\u5728\u5B9E\u73B0\u5355\u5143\u5207\u7247\u5185\uFF08${[...new Set(unmappedChanged.map((id) => (newById.get(id) ?? oldById.get(id)).kind))].sort().join("\u3001")}\uFF1A${[...unmappedChanged].sort().join("\u3001")}\uFF09\u3002\u6309\u5B8C\u6574\u91CD\u5BA1\u5904\u7406\uFF1A\u5168\u90E8\u5B9E\u73B0\u5355\u5143\u91CD\u65B0\u6267\u884C\uFF0C\u8BA1\u5212\u5BA1\u67E5\u5168\u90E8\u5931\u6548\u3002` : void 0;
  if (fallbackReason) {
    for (const unit of oldUnits) affectedIds.add(unit.id);
    for (const unit of newUnits) affectedIds.add(unit.id);
  }
  return { affectedIds: [...affectedIds].sort(), fallbackReason };
}

// plugins/dev-flow/src/core/requirements-grill.ts
async function currentRequirements(root2, id, state) {
  if (!state.artifacts.requirements) throw new DevFlowError("MISSING_REQUIRED_ARTIFACT", "requirements");
  await assertArtifactCurrent(root2, id, state, "requirements");
}
async function requestGrillDecision(root2, id, expectedRevision, input) {
  if (!input.question.trim()) throw new DevFlowError("GRILL_QUESTION_REQUIRED", "\u95EE\u9898\u4E0D\u80FD\u4E3A\u7A7A\u3002", { userMessage: "\u5F53\u524D\u95EE\u9898\u6CA1\u6709\u5185\u5BB9\u3002", recoveryKind: "retry", recoveryInstruction: "\u8865\u5145\u4E00\u4E2A\u9700\u8981\u7528\u6237\u51B3\u5B9A\u7684\u95EE\u9898\u540E\u91CD\u8BD5\u3002", retryOriginal: true });
  if (!input.recommendation.drawback?.trim() || !input.recommendation.alternative?.condition.trim()) {
    throw new DevFlowError("GRILL_HIGH_IMPACT_REMINDER_REQUIRED", "\u9700\u6C42\u51B3\u7B56\u5C5E\u4E8E\u9AD8\u5F71\u54CD\u4EA4\u4E92\uFF0C\u5FC5\u987B\u8BF4\u660E\u63A8\u8350\u65B9\u6848\u7684\u4E3B\u8981\u7F3A\u70B9\u548C\u66FF\u4EE3\u6761\u4EF6\u3002", {
      recoveryHint: "\u8865\u5145 drawback \u4E0E alternative.condition\uFF0C\u5E76\u8BA9 alternative.optionId \u6307\u5411\u975E\u63A8\u8350\u9009\u9879\u540E\u91CD\u8BD5\u3002",
      retryOriginal: true
    });
  }
  const initial = await readState(root2, id);
  if (initial.revision !== expectedRevision) throw new DevFlowError("STATE_REVISION_CONFLICT", "state revision changed", { currentRevision: initial.revision });
  if (initial.mode !== "intake") await currentRequirements(root2, id, initial);
  const target = `grill:${input.questionId}`;
  const existing = findInteractionForTarget(initial, target);
  if (existing) return { state: initial, interaction: toPublicInteraction(existing), interactionId: existing.id };
  let interaction;
  const state = await mutate(root2, id, expectedRevision, "decision-presented", (draft) => {
    interaction = createInteraction(draft, {
      kind: "grill",
      target,
      basisHash: decisionBasisHash({ objective: draft.objective, questionId: input.questionId, requirements: draft.artifacts.requirements?.sha256 }),
      question: input.question,
      options: input.options,
      recommendation: input.recommendation
    });
    draft.lastUpdatedBy = { host: input.host, pluginVersion: "5.1.0" };
  }, () => ({ questionId: input.questionId, mode: "decision", presentationEventId: interaction?.presentationEventId }));
  if (!interaction) throw new DevFlowError("INTERACTION_NOT_CREATED", target);
  return { state, interaction: toPublicInteraction(interaction), interactionId: interaction.id };
}
async function resolveGrillForAnswer(ctx) {
  const { root: root2, featureId, expectedRevision, host, credential, interaction, state } = ctx;
  if (interaction.kind !== "grill" || interaction.status !== "pending") {
    throw new DevFlowError("INTERACTION_NOT_PENDING", "\u5F53\u524D\u6CA1\u6709\u5F85\u56DE\u7B54\u7684\u9700\u6C42\u95EE\u9898\u3002", { interactionId: interaction.id });
  }
  let promptEventId;
  let promptText;
  if (credential.source === "text") {
    const events = await readFeatureEvents(root2, featureId);
    const match = resolveInteractionPromptEvent(events, state, interaction, { host, userReply: credential.userReply });
    promptEventId = match.eventId;
    promptText = match.text;
  }
  let response;
  const next = await mutatePrepared(root2, featureId, expectedRevision, "decision-answered", async () => ({
    mutate: (draft) => {
      response = resolveResponseForAnswer(draft, interaction, { source: credential.source, action: credential.source === "elicitation" ? credential.action : void 0, comment: credential.source === "elicitation" ? credential.comment : void 0, userReply: credential.source === "text" ? credential.userReply : void 0, promptText, promptEventId, host });
      if (!response) throw new DevFlowError("INTERACTION_NOT_RESOLVED", interaction.id);
      const decisionId = interaction.target.slice("grill:".length);
      const existingGovernance = draft.governance ?? EMPTY_GOVERNANCE_LEDGER;
      const previous = existingGovernance.decisions.find((candidate) => candidate.recordId === decisionId && !candidate.supersededBy);
      const recordId = previous ? `${decisionId}-${interaction.id}` : decisionId;
      const decisions = [...existingGovernance.decisions];
      if (previous) {
        const previousIndex = decisions.findIndex((candidate) => candidate.recordId === previous.recordId);
        if (previousIndex >= 0) decisions[previousIndex] = { ...previous, supersededBy: recordId };
      }
      const credentials = [...existingGovernance.credentials];
      const credentialId = `CRED-grill-${interaction.id}`;
      if (!credentials.some((record) => record.recordId === credentialId)) {
        credentials.push({
          recordId: credentialId,
          kind: "credential",
          source: credential.source === "elicitation" ? "native-form" : "text",
          host,
          interactionId: interaction.id,
          ...response.selectedOptionId ? { optionId: response.selectedOptionId } : {},
          ...response.rawReply ? { rawText: response.rawReply } : {},
          ...credential.source === "text" && promptEventId ? { basis: { kind: "event", eventId: promptEventId } } : {},
          recordedAt: response.respondedAt
        });
      }
      if (!decisions.some((candidate) => candidate.recordId === recordId)) {
        decisions.push({
          recordId,
          kind: "decision",
          question: interaction.question ?? decisionId,
          conclusion: response.action,
          credentialId,
          ...credential.source === "text" && promptEventId ? { basis: { kind: "event", eventId: promptEventId } } : {},
          recordedAt: response.respondedAt
        });
      }
      draft.governance = { ...existingGovernance, decisions, credentials };
      draft.lastUpdatedBy = { host, pluginVersion: "5.1.0" };
    },
    eventData: () => ({ interactionId: interaction.id, mode: "decision" })
  }));
  if (!response) throw new DevFlowError("INTERACTION_NOT_RESOLVED", interaction.id);
  return { state: next, action: response.action, ...response.comment ? { comment: response.comment } : {} };
}
async function assertRequirementsGrillSatisfied(root2, id, state) {
  if (state.route !== "m" && state.route !== "l") return;
  await currentRequirements(root2, id, state);
  const pending = Object.values(state.interactions ?? {}).some((value) => {
    const interaction = value;
    return interaction.kind === "grill" && interaction.status === "pending";
  }) || pendingDecisionForState(state)?.kind === "grill";
  if (pending) throw new DevFlowError("GRILL_INCOMPLETE", "\u8FD8\u6709\u4E00\u4E2A\u9700\u6C42\u95EE\u9898\u7B49\u5F85\u56DE\u7B54\u3002", { userMessage: "\u9700\u6C42\u6F84\u6E05\u8FD8\u6CA1\u6709\u5B8C\u6210\u3002", cause: "\u51B3\u7B56\u8D26\u672C\u4ECD\u6709\u5F85\u56DE\u7B54\u7684 grill \u95EE\u9898\u3002", impact: "\u5F53\u524D\u8DEF\u7EBF\u4E0D\u80FD\u8FDB\u5165\u4E0B\u4E00\u6B65\u3002", recoveryKind: "retry", recoveryInstruction: "\u5148\u56DE\u7B54\u5F53\u524D\u552F\u4E00\u95EE\u9898\uFF0C\u518D\u7EE7\u7EED\u5F53\u524D\u6B65\u9AA4\u3002", retryOriginal: true });
}

// plugins/dev-flow/src/core/approval-interactions.ts
import { createHash as createHash19 } from "node:crypto";
var digest5 = (value) => createHash19("sha256").update(JSON.stringify(value)).digest("hex");
function approvalId(value) {
  if (!/^approval:[a-f0-9]{16,}$/.test(value)) throw new DevFlowError("INVALID_APPROVAL", value);
  return value;
}
function approvalInteractionOptions() {
  return [
    { id: "confirm", label: "\u786E\u8BA4\u5F00\u59CB\u6267\u884C" },
    { id: "request-changes", label: "\u63D0\u51FA\u4FEE\u6539\u610F\u89C1", requiresComment: true }
  ];
}
async function assertReviewProjectionForApproval(root2, state) {
  if (reviewEnforcementRequired(state.route, state.classification.controls)) {
    await assertCurrentReviewProjection(root2, state);
  }
}
async function presentApproval(root2, id, expectedRevision) {
  const initial = await readState(root2, id);
  const candidates = approvalIds(initial).filter((candidate) => {
    const obligation = initial.obligations?.find((item) => item.id === candidate);
    return obligation?.status !== "satisfied";
  });
  if (candidates.length !== 1) throw new DevFlowError("APPROVAL_NOT_UNIQUE", "Core \u65E0\u6CD5\u9009\u62E9\u552F\u4E00\u7684\u5F53\u524D\u5BA1\u6279\u3002", { approvalIds: candidates, recoveryHint: "\u5237\u65B0\u72B6\u6001\u5E76\u4FEE\u590D\u91CD\u590D\u6216\u7F3A\u5931\u7684\u5BA1\u6279\u6295\u5F71" });
  const selectedApproval = approvalId(candidates[0]);
  let interaction;
  const state = await mutate(root2, id, expectedRevision, "approval-presented", async (state2) => {
    if (state2.lifecycle !== "active") {
      throw new DevFlowError("INVALID_LIFECYCLE", "approval requires active feature");
    }
    const obligation = state2.obligations?.find((candidate) => candidate.id === selectedApproval && candidate.kind === "approval");
    if (!obligation || obligation.status === "satisfied") throw new DevFlowError("INVALID_APPROVAL", selectedApproval);
    const definition = routeDefinitionForState(state2);
    const implementationIndex = definition.orderedSteps.indexOf("implementation");
    if (implementationIndex < 0 || !definition.orderedSteps.slice(0, implementationIndex).every((step) => state2.steps[step]?.status === "satisfied")) {
      throw new DevFlowError("APPROVAL_NOT_READY", "approval is only available after planning prerequisites are complete", { expectedStage: definition.orderedSteps[implementationIndex - 1] });
    }
    if (state2.humanGates[selectedApproval]) {
      throw new DevFlowError("APPROVAL_ALREADY_PRESENTED", selectedApproval);
    }
    await assertRequirementsGrillSatisfied(root2, id, state2);
    await assertTraceGateCurrent(root2, state2, "planning");
    await assertReviewProjectionForApproval(root2, state2);
    const basisHash2 = digest5(approvalBasis(state2, selectedApproval));
    state2.humanGates[selectedApproval] = {
      status: "pending",
      presentedRevision: state2.revision,
      presentedAt: (/* @__PURE__ */ new Date()).toISOString(),
      basisHash: basisHash2,
      approvalId: selectedApproval
    };
    interaction = createInteraction(state2, {
      kind: "approval",
      target: `approval:${selectedApproval}`,
      basisHash: basisHash2,
      options: approvalInteractionOptions()
    });
  }, () => ({
    approvalId: selectedApproval,
    replyHint: interaction ? decisionHint(interaction) : approvalReplyHint(),
    interactionId: interaction?.id,
    presentationEventId: interaction?.presentationEventId
  }));
  if (!interaction) throw new DevFlowError("INTERACTION_NOT_CREATED", selectedApproval);
  return { state, approvalId: selectedApproval, interactionId: interaction.id, approvalReplyHint: decisionHint(interaction), interaction: toPublicInteraction(interaction) };
}
function confirmationEventIds(value) {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return [];
  const confirmation = value.confirmation;
  if (typeof confirmation !== "object" || confirmation === null || Array.isArray(confirmation)) return [];
  const record = confirmation;
  const ids = [];
  if (typeof record.promptEventId === "string") ids.push(record.promptEventId);
  if (typeof record.turnBoundaryEventId === "string") ids.push(record.turnBoundaryEventId);
  return ids;
}
function hostEventRecord(events, eventId, expectedHost) {
  const record = events.find((item) => item.type === "host-event" && item.data.eventId === eventId);
  if (record && expectedHost && record.data.host !== expectedHost) {
    throw new DevFlowError("HOST_EVENT_HOST_MISMATCH", "host event belongs to a different host", {
      expectedHost,
      actualHost: record.data.host,
      eventId
    });
  }
  return record;
}
function assertApprovalEvidenceTiming(eventRecord, event, presented, recoveryHint) {
  if (!event || !presented?.presentedAt || (eventRecord?.revision ?? -1) <= (presented.presentedRevision ?? -1) || Date.parse(event.at ?? "") < Date.parse(presented.presentedAt)) {
    throw new DevFlowError("APPROVAL_SAME_TURN", "confirmation evidence must be later than approval presentation", {
      recoveryHint
    });
  }
}
function assertApprovalPromptEvidence(event, userReply, recoveryHint) {
  if (event?.type !== "user-prompt" || !textCompatible(String(event.text ?? ""), userReply)) {
    throw new DevFlowError("APPROVAL_REPLY_MISMATCH", "userReply must be compatible with the captured prompt", {
      recoveryHint
    });
  }
}
function assertApprovalTurnBoundaryEvidence(event, recoveryHint) {
  if (event?.type !== "turn-boundary") {
    throw new DevFlowError("APPROVAL_PROVENANCE_UNAVAILABLE", "turn boundary was not captured", {
      ...recoveryHint ? { recoveryHint } : {}
    });
  }
}
function resolveProvenance(events, state, approval, userReply, provenance, host) {
  if (provenance.promptEventId || provenance.turnBoundaryEventId) return provenance;
  const current = state.humanGates[approval];
  const consumed = new Set(Object.values(state.humanGates).flatMap(confirmationEventIds));
  const match = [...events].reverse().find((item) => {
    const event = item.data;
    return item.type === "host-event" && typeof event.eventId === "string" && !consumed.has(event.eventId) && event.type === "user-prompt" && event.host === host && textCompatible(String(event.text ?? ""), userReply) && item.revision > (current?.presentedRevision ?? state.revision) && typeof current?.presentedAt === "string" && typeof event.at === "string" && Date.parse(event.at) >= Date.parse(current.presentedAt);
  });
  const eventId = match?.data?.eventId;
  if (typeof eventId !== "string") {
    throw new DevFlowError(
      "APPROVAL_PROVENANCE_UNAVAILABLE",
      "no matching post-presentation user prompt was captured",
      { recoveryHint: "\u8BF7\u786E\u4FDD\u5BBF\u4E3B UserPromptSubmit hook \u5DF2\u751F\u6548\uFF0C\u7136\u540E\u5728\u95E8\u7981\u5448\u73B0\u540E\u63D0\u4EA4\u4E00\u6761\u51C6\u786E\u7684\u6279\u51C6\u8BCD\uFF08\u5982\u201C\u786E\u8BA4\u9700\u6C42\u201D\uFF09\u91CD\u8BD5\u786E\u8BA4" }
    );
  }
  return { promptEventId: eventId };
}
function assertTokenEvidence(events, state, approval, userReply, provenance, host) {
  const resolved = resolveProvenance(events, state, approval, userReply, provenance, host);
  const current = state.humanGates[approval];
  if (resolved.promptEventId) {
    const eventRecord = hostEventRecord(events, resolved.promptEventId, host);
    const event = eventRecord?.data;
    assertApprovalEvidenceTiming(eventRecord, event, current, "\u8BF7\u5728\u786E\u8BA4\u5448\u73B0\u540E\u7684\u540E\u7EED\u56DE\u5408\u63D0\u4EA4\u4E00\u6B21\u6027\u56DE\u590D\u6216\u6279\u51C6\u8BCD");
    assertApprovalPromptEvidence(event, userReply, "\u8BF7\u539F\u6837\u4F20\u9012\u6355\u83B7\u5230\u7684\u7528\u6237\u56DE\u590D\u6587\u672C\uFF08\u7A7A\u683C\u4E0E\u5927\u5C0F\u5199\u5DEE\u5F02\u4F1A\u81EA\u52A8\u5F52\u4E00\u5316\uFF09");
  }
  if (resolved.turnBoundaryEventId) {
    const eventRecord = hostEventRecord(events, resolved.turnBoundaryEventId, host);
    const event = eventRecord?.data;
    assertApprovalEvidenceTiming(eventRecord, event, current, "\u8BF7\u5728\u786E\u8BA4\u5448\u73B0\u540E\u7684\u540E\u7EED\u56DE\u5408\u63D0\u4EA4\u4E00\u6B21\u6027\u56DE\u590D\u6216\u6279\u51C6\u8BCD");
    assertApprovalTurnBoundaryEvidence(event);
  }
  return resolved;
}
async function resolveApprovalForAnswer(ctx) {
  const { root: root2, featureId, expectedRevision, host, credential, interaction, state } = ctx;
  if (interaction.kind !== "approval" || interaction.status !== "pending") {
    throw new DevFlowError("INTERACTION_NOT_PENDING", "\u5F53\u524D\u6CA1\u6709\u5F85\u786E\u8BA4\u7684\u6267\u884C\u6279\u51C6\u3002", { interactionId: interaction.id });
  }
  const approval = approvalId(interaction.target.slice("approval:".length));
  let provenance;
  let promptText;
  let promptEventId;
  if (credential.source === "text") {
    const events = await readFeatureEvents(root2, featureId);
    provenance = assertTokenEvidence(events, state, approval, credential.userReply, {}, host);
    promptEventId = provenance.promptEventId;
    promptText = provenance.promptEventId ? events.find((item) => item.type === "host-event" && item.data.eventId === provenance.promptEventId)?.data?.text : void 0;
  }
  let response;
  const next = await mutatePrepared(root2, featureId, expectedRevision, "approval-interaction-resolved", async (current) => {
    await assertRequirementsGrillSatisfied(root2, featureId, current);
    await assertTraceGateCurrent(root2, current, "planning");
    await assertReviewProjectionForApproval(root2, current);
    const gate = current.humanGates[approval];
    if (gate?.status !== "pending") throw new DevFlowError("APPROVAL_NOT_PENDING", approval);
    const live = current.interactions?.[interaction.id];
    if (live?.kind !== "approval" || live?.target !== `approval:${approval}` || live?.status !== "pending") {
      throw new DevFlowError("INTERACTION_NOT_PENDING", interaction.id);
    }
    const basisHash2 = digest5(approvalBasis(current, approval));
    if (basisHash2 !== gate.basisHash || basisHash2 !== live.basisHash) {
      throw new DevFlowError("APPROVAL_BASIS_CHANGED", approval, {
        recoveryHint: "\u95E8\u7981\u4F9D\u636E\u5DF2\u53D8\u66F4\uFF0C\u8BF7\u66F4\u65B0\u5E76\u767B\u8BB0\u76F8\u5173\u8D44\u4EA7\u540E\u91CD\u65B0\u5448\u73B0\u95E8\u7981"
      });
    }
    if (credential.source === "text") {
      const ids = [
        ...provenance?.promptEventId ? [provenance.promptEventId] : [],
        ...provenance?.turnBoundaryEventId ? [provenance.turnBoundaryEventId] : []
      ];
      for (const [otherApproval, value] of Object.entries(current.humanGates)) {
        if (otherApproval === approval) continue;
        const replayed = confirmationEventIds(value).find((eventId) => ids.includes(eventId));
        if (replayed) throw new DevFlowError("APPROVAL_EVENT_CONSUMED", replayed);
      }
    }
    return {
      mutate: (draft) => {
        const phraseText = promptText ?? (credential.source === "text" ? credential.userReply : void 0);
        response = resolveResponseForAnswer(draft, interaction, {
          source: credential.source,
          action: credential.source === "elicitation" ? credential.action : void 0,
          comment: credential.source === "elicitation" ? credential.comment : void 0,
          userReply: credential.source === "text" ? credential.userReply : void 0,
          promptText,
          promptEventId,
          host,
          phraseAction: phraseText && isExplicitApproval(phraseText) ? "confirm" : void 0
        });
        const currentGate = draft.humanGates[approval];
        if (response.action === "confirm") {
          draft.humanGates[approval] = {
            ...currentGate,
            status: "confirmed",
            confirmation: {
              interactionId: interaction.id,
              ...response,
              confirmedAt: (/* @__PURE__ */ new Date()).toISOString()
            }
          };
          draft.obligations = satisfyObligations(draft.obligations, ["approval"]);
        } else if (response.action === "request-changes") {
          draft.humanGates[approval] = { ...currentGate, status: "returned", lastResponse: response };
        } else {
          throw new DevFlowError("INTERACTION_ACTION_INVALID", response.action);
        }
        draft.lastUpdatedBy = { host, pluginVersion: "5.1.0" };
      },
      eventData: () => ({ approval, interactionId: interaction.id, response })
    };
  });
  if (!response) throw new DevFlowError("INTERACTION_NOT_RESOLVED", interaction.id);
  return { state: next, action: response.action, ...response.comment ? { comment: response.comment } : {} };
}

// plugins/dev-flow/src/core/quality-exceptions.ts
import { createHash as createHash20 } from "node:crypto";

// plugins/dev-flow/src/core/governance-state.ts
function governanceLedger(state) {
  return state.governance ?? EMPTY_GOVERNANCE_LEDGER;
}
function currentRiskAuthorizations(state, basis) {
  return governanceLedger(state).authorizations.filter((authorization) => authorization.authorizationType === "risk-acceptance" && deriveCurrency(authorization, basis) === "current");
}

// plugins/dev-flow/src/core/quality-exceptions.ts
function validKind(kind) {
  if (kind === "review" || kind === "verification" || kind === "checkpoint" || kind === "implementation-evidence") return kind;
  throw new DevFlowError("QUALITY_EXCEPTION_KIND_INVALID", "\u8BE5\u6761\u4EF6\u4E0D\u662F\u53EF\u63A5\u53D7\u98CE\u9669\u7684\u6D41\u7A0B\u8D28\u91CF\u95EE\u9898\u3002", {
    userMessage: "\u5F53\u524D\u95EE\u9898\u5C5E\u4E8E\u7CFB\u7EDF\u5B8C\u6574\u6027\u963B\u585E\uFF0C\u4E0D\u80FD\u901A\u8FC7\u63A5\u53D7\u98CE\u9669\u8DF3\u8FC7\u3002",
    cause: "\u8D28\u91CF\u4F8B\u5916\u53EA\u5141\u8BB8 review\u3001verification\u3001checkpoint \u6216 implementation evidence \u6761\u4EF6\u3002",
    impact: "\u7CFB\u7EDF\u4E0D\u4F1A\u4F2A\u88C5\u5B8C\u6574\u6027\u95EE\u9898\u4E3A\u6210\u529F\u3002",
    recoveryKind: "repair",
    recoveryInstruction: "\u8FD0\u884C doctor\uFF0C\u5E76\u6309\u4FEE\u590D\u3001\u6682\u505C\u6216\u7EC8\u6B62\u8DEF\u5F84\u5904\u7406\u3002",
    retryOriginal: false
  });
}
function hasCurrentQualityException(state, kind) {
  const invalidatedAt = state.lastInvalidation?.at ? Date.parse(state.lastInvalidation.at) : Number.NaN;
  const authorization = currentRiskAuthorizations(state, { contentFingerprint: state.businessFingerprint }).some((item) => item.target === kind && (!Number.isFinite(invalidatedAt) || !item.recordedAt || Date.parse(item.recordedAt) >= invalidatedAt));
  return authorization;
}
function qualityExceptionCoversStep(state, step) {
  const kindForStep = {
    verification: "verification",
    code_review: "review",
    planning: "review",
    implementation: "implementation-evidence"
  };
  const kind = kindForStep[step];
  return kind !== void 0 && hasCurrentQualityException(state, kind);
}
async function presentQualityException(root2, featureId, expectedRevision, input) {
  const kind = validKind(input.kind);
  if (kind === "verification") {
    const initial = await readState(root2, featureId);
    if (initial.verification.verifiedFingerprint === input.fingerprint) {
      throw new DevFlowError("QUALITY_EXCEPTION_NOT_NEEDED", "\u5F53\u524D\u4EA4\u4ED8\u5185\u5BB9\u5DF2\u901A\u8FC7\u9A8C\u8BC1\uFF0C\u65E0\u9700\u63A5\u53D7\u98CE\u9669\u3002", {
        recoveryHint: "\u9A8C\u8BC1\u5DF2\u5BF9\u5F53\u524D\u5185\u5BB9\u901A\u8FC7\uFF0C\u76F4\u63A5\u7EE7\u7EED\u540E\u7EED\u6D41\u7A0B\uFF1B\u53EA\u6709\u9A8C\u8BC1\u518D\u6B21\u5931\u8D25\u6216\u5185\u5BB9\u518D\u6B21\u53D8\u5316\u540E\u624D\u9700\u8981\u63A5\u53D7\u98CE\u9669\u3002"
      });
    }
  }
  if (!input.riskSummary.trim()) throw new DevFlowError("QUALITY_EXCEPTION_SUMMARY_REQUIRED", "\u98CE\u9669\u8BF4\u660E\u4E0D\u80FD\u4E3A\u7A7A\u3002", { userMessage: "\u8BF7\u5148\u8BF4\u660E\u63A5\u53D7\u98CE\u9669\u7684\u5177\u4F53\u5F71\u54CD\u3002", recoveryKind: "retry", recoveryInstruction: "\u8865\u5145\u7B80\u660E\u98CE\u9669\u8BF4\u660E\u540E\u91CD\u8BD5\u3002", retryOriginal: true });
  let interactionId = "";
  let interaction;
  const state = await mutate(root2, featureId, expectedRevision, "quality-exception-presented", (draft) => {
    const existing = currentRiskAuthorizations(draft, { contentFingerprint: input.fingerprint }).find((authorization) => authorization.target === kind);
    if (existing) throw new DevFlowError("QUALITY_EXCEPTION_ALREADY_ACCEPTED", "\u5F53\u524D\u4F9D\u636E\u5DF2\u7ECF\u8BB0\u5F55\u8FC7\u98CE\u9669\u63A5\u53D7\u3002", { userMessage: "\u5F53\u524D\u98CE\u9669\u5DF2\u7ECF\u5728\u540C\u4E00\u4F9D\u636E\u4E0B\u8BB0\u5F55\uFF0C\u65E0\u9700\u91CD\u590D\u63A5\u53D7\u3002", recoveryKind: "refresh", recoveryInstruction: "\u5237\u65B0\u72B6\u6001\u540E\u7EE7\u7EED\u540E\u7EED\u6D41\u7A0B\u3002", retryOriginal: false });
    interaction = createInteraction(draft, {
      kind: "quality-exception",
      target: `quality-exception:${kind}`,
      basisHash: input.basisHash,
      question: `\u5F53\u524D${kind}\u8BC1\u636E\u5B58\u5728\u8D28\u91CF\u98CE\u9669\u3002\u662F\u5426\u63A5\u53D7\u8FD9\u9879\u5DF2\u77E5\u98CE\u9669\u5E76\u7EE7\u7EED\uFF1F`,
      options: [
        { id: "accept", label: "\u63A5\u53D7\u98CE\u9669", requiresComment: true },
        { id: "decline", label: "\u5148\u4FEE\u590D\u95EE\u9898" }
      ]
    });
    interactionId = interaction.id;
  }, () => ({ kind, presentationEventId: interaction?.presentationEventId }));
  if (!interaction) throw new DevFlowError("INTERACTION_NOT_CREATED", kind);
  return { state, interaction: toPublicInteraction(interaction), interactionId };
}
async function resolveQualityExceptionForAnswer(ctx) {
  const { root: root2, featureId, expectedRevision, host, credential, interaction, state } = ctx;
  if (interaction.kind !== "quality-exception" || interaction.status !== "pending") {
    throw new DevFlowError("INTERACTION_NOT_PENDING", "\u5F53\u524D\u98CE\u9669\u95EE\u9898\u5DF2\u7ECF\u5904\u7406\u3002", { interactionId: interaction.id });
  }
  let promptEventId;
  let promptText;
  if (credential.source === "text") {
    const match = resolveInteractionPromptEvent(await readFeatureEvents(root2, featureId), state, interaction, {
      host,
      userReply: credential.userReply
    });
    promptEventId = match.eventId;
    promptText = match.text;
  }
  let response;
  const next = await mutatePrepared(root2, featureId, expectedRevision, "quality-exception-answered", async (current) => {
    const live = getInteraction(current, interaction.id);
    if (live.kind !== "quality-exception" || live.status !== "pending") {
      throw new DevFlowError("INTERACTION_NOT_PENDING", "\u5F53\u524D\u98CE\u9669\u95EE\u9898\u5DF2\u7ECF\u5904\u7406\u3002", { interactionId: interaction.id });
    }
    return {
      mutate: async (draft) => {
        response = resolveResponseForAnswer(draft, interaction, {
          source: credential.source,
          action: credential.source === "elicitation" ? credential.action : void 0,
          comment: credential.source === "elicitation" ? credential.comment : void 0,
          userReply: credential.source === "text" ? credential.userReply : void 0,
          promptText,
          promptEventId,
          host
        });
        const kind = interaction.target.slice("quality-exception:".length);
        if (response.action === "accept") {
          const config = await readProjectConfig(root2);
          const fingerprint2 = await fingerprintFeatureOwned(root2, config, draft.workspace.ownership);
          const fullFingerprint = await fingerprintGovernedRoots(root2, config);
          draft.startBusinessFingerprint = fullFingerprint;
          draft.businessFingerprint = fingerprint2;
          const gov = draft.governance ?? EMPTY_GOVERNANCE_LEDGER;
          const credentialId = `CRED-qe-${interaction.id}`;
          const authorizationId = `AUTH-${createHash20("sha256").update(`${kind}|${fingerprint2}|${response.respondedAt}`).digest("hex").slice(0, 16)}`;
          const authorizations = [...gov.authorizations];
          if (!authorizations.some((authorization) => authorization.recordId === authorizationId)) {
            authorizations.push({
              recordId: authorizationId,
              kind: "authorization",
              authorizationType: "risk-acceptance",
              target: kind,
              credentialId,
              basis: { kind: "content", sha256: fingerprint2 },
              recordedAt: response.respondedAt
            });
          }
          const credentials = [...gov.credentials];
          if (!credentials.some((existing) => existing.recordId === credentialId)) {
            credentials.push({
              recordId: credentialId,
              kind: "credential",
              source: credential.source === "elicitation" ? "native-form" : "text",
              host,
              interactionId: interaction.id,
              ...response.selectedOptionId ? { optionId: response.selectedOptionId } : {},
              // Native forms do not have a raw user-prompt reply. Preserve the
              // supplied comment as the credential's user-visible text so the
              // acceptance record remains auditable after legacy projections are
              // rebuilt from the governance ledger.
              ...response.rawReply ?? response.comment ? { rawText: response.rawReply ?? response.comment } : {},
              basis: interaction.presentationEventId ? { kind: "event", eventId: interaction.presentationEventId } : void 0,
              recordedAt: response.respondedAt
            });
          }
          draft.governance = { ...gov, authorizations, credentials };
          if (kind === "review" || kind === "verification" || kind === "checkpoint") {
            draft.obligations = satisfyObligations(draft.obligations, [kind]);
          }
        }
        draft.lastUpdatedBy = { host, pluginVersion: "5.1.0" };
      },
      eventData: { interactionId: interaction.id }
    };
  });
  if (!response) throw new DevFlowError("INTERACTION_NOT_RESOLVED", interaction.id);
  return { state: next, action: response.action, ...response.comment ? { comment: response.comment } : {} };
}

// plugins/dev-flow/src/core/acceptance.ts
import { createHash as createHash22, randomUUID as randomUUID7 } from "node:crypto";

// plugins/dev-flow/src/core/acceptance-store.ts
import { createHash as createHash21 } from "node:crypto";
import { copyFile, lstat as lstat5, mkdir as mkdir5, readFile as readFile11 } from "node:fs/promises";
import path14 from "node:path";
var digest6 = (value) => createHash21("sha256").update(value).digest("hex");
function safePath(value) {
  const normalized = value.replaceAll("\\", "/");
  if (!normalized || normalized.startsWith("/") || normalized.split("/").includes("..") || normalized === ".dev-flow" || normalized.startsWith(".dev-flow/")) {
    throw new DevFlowError("INVALID_ACCEPTANCE_EVIDENCE", "\u9A8C\u6536\u8BB0\u5F55\u8DEF\u5F84\u5FC5\u987B\u662F\u9879\u76EE\u5185\u7684\u666E\u901A\u76F8\u5BF9\u8DEF\u5F84\u3002", { path: value });
  }
  return normalized;
}
function imageValid(bytes) {
  const png = bytes.length >= 24 && bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) && bytes.readUInt32BE(16) > 0 && bytes.readUInt32BE(20) > 0;
  const jpeg = bytes.length >= 4 && bytes[0] === 255 && bytes[1] === 216 && bytes.at(-2) === 255 && bytes.at(-1) === 217;
  const webp = bytes.length >= 16 && bytes.toString("ascii", 0, 4) === "RIFF" && bytes.toString("ascii", 8, 12) === "WEBP";
  return png || jpeg || webp;
}
async function storeScreenshotArtifact(root2, featureId, sourcePath) {
  const source = safePath(sourcePath);
  const sourceAbsolute = path14.join(root2, source);
  let metadata;
  try {
    metadata = await lstat5(sourceAbsolute);
  } catch {
    throw new DevFlowError("INVALID_ACCEPTANCE_EVIDENCE", "\u622A\u56FE\u6587\u4EF6\u4E0D\u5B58\u5728\u6216\u4E0D\u53EF\u8BFB\u53D6\u3002", { path: source });
  }
  if (!metadata.isFile() || metadata.isSymbolicLink()) {
    throw new DevFlowError("INVALID_ACCEPTANCE_EVIDENCE", "\u622A\u56FE\u6587\u4EF6\u5FC5\u987B\u662F\u9879\u76EE\u5185\u7684\u666E\u901A\u6587\u4EF6\u3002", { path: source });
  }
  let bytes;
  try {
    bytes = await readFile11(sourceAbsolute);
  } catch {
    throw new DevFlowError("INVALID_ACCEPTANCE_EVIDENCE", "\u622A\u56FE\u6587\u4EF6\u4E0D\u5B58\u5728\u6216\u4E0D\u53EF\u8BFB\u53D6\u3002", { path: source });
  }
  if (!imageValid(bytes)) {
    throw new DevFlowError("INVALID_ACCEPTANCE_EVIDENCE", "\u622A\u56FE\u6587\u4EF6\u4E0D\u662F\u53EF\u89E3\u6790\u7684 PNG\u3001JPEG \u6216 WebP\u3002", { path: source });
  }
  const artifactSha256 = digest6(bytes);
  const ext = path14.extname(source).toLowerCase() || ".bin";
  const artifactPath = `acceptance/${artifactSha256}${ext}`;
  const featureRoot = path14.join(root2, ".dev-flow", "features", featureId);
  await mkdir5(path14.join(featureRoot, "acceptance"), { recursive: true });
  await copyFile(sourceAbsolute, path14.join(featureRoot, artifactPath));
  return { artifactPath, artifactSha256 };
}

// plugins/dev-flow/src/core/acceptance.ts
var digest7 = (value) => createHash22("sha256").update(value).digest("hex");
function currentHumanCriteria(state, trace2) {
  return Object.values(trace2.nodes).filter((node) => node.status === "current" && node.kind === "acceptance-criterion" && node.verificationDisposition?.kind === "human-acceptance").map((node) => node.id).sort();
}
async function currentBasis(root2, state) {
  const config = await readProjectConfig(root2);
  const fingerprint2 = await fingerprintFeatureOwned(root2, config, state.workspace.ownership);
  const trace2 = await readTraceability(root2, state);
  return { fingerprint: fingerprint2, trace: trace2 };
}
function ensureAcceptance(state) {
  state.acceptance ??= { evidence: [], dispositions: [] };
  return state.acceptance;
}
function upsertDisposition(state, criterionId, status, basisHash2, evidenceRefs) {
  const acceptance = ensureAcceptance(state);
  const existing = acceptance.dispositions.find((item) => item.acceptanceCriterionId === criterionId);
  const next = {
    acceptanceCriterionId: criterionId,
    dispositionKind: "human-acceptance",
    status,
    evidenceRefs: [...new Set(evidenceRefs)],
    basis: { kind: "content", sha256: basisHash2 }
  };
  if (existing) Object.assign(existing, next);
  else acceptance.dispositions.push(next);
}
async function browserEvent(root2, id, eventId, host) {
  const events = await readFeatureEvents(root2, id);
  const event = events.find((candidate) => candidate.type === "host-event" && candidate.data.eventId === eventId);
  const data = event?.data;
  if (!event || data?.host !== host || data.type !== "tool" || typeof data.toolName !== "string" || !/(browser|chrome|computer|playwright|screenshot)/iu.test(data.toolName) || typeof data.executionId !== "string" || !data.executionId || data.result !== "success" || typeof data.resultSummary !== "string" || !data.resultSummary) {
    throw new DevFlowError("INVALID_ACCEPTANCE_EVIDENCE", "\u6D4F\u89C8\u5668\u9A8C\u6536\u5FC5\u987B\u5F15\u7528\u5F53\u524D\u5BBF\u4E3B\u6355\u83B7\u7684\u771F\u5B9E\u6D4F\u89C8\u5668\u5DE5\u5177\u4E8B\u4EF6\u3002", { eventId });
  }
}
async function recordAcceptanceEvidence(root2, id, expectedRevision, input) {
  if (input.evidence.kind === "agent-self-check") {
    if (!input.evidence.note?.trim()) throw new DevFlowError("INVALID_ACCEPTANCE_EVIDENCE", "\u667A\u80FD\u4F53\u81EA\u68C0\u5FC5\u987B\u8BF4\u660E\u68C0\u67E5\u5185\u5BB9\u3002", { recoveryHint: "\u81EA\u68C0\u53EA\u80FD\u4F5C\u4E3A\u53C2\u8003\uFF0C\u4E0D\u80FD\u5B8C\u6210\u4EBA\u5DE5\u9A8C\u6536\u3002" });
  }
  const initial = await readState(root2, id);
  const { fingerprint: fingerprint2, trace: trace2 } = await currentBasis(root2, initial);
  const criterion = trace2.nodes[input.acceptanceCriterionId];
  if (!criterion || criterion.status !== "current" || criterion.kind !== "acceptance-criterion" || criterion.verificationDisposition?.kind !== "human-acceptance") {
    throw new DevFlowError("ACCEPTANCE_CRITERION_NOT_HUMAN", "\u8BE5\u9A8C\u6536\u6761\u4EF6\u5F53\u524D\u6CA1\u6709\u4EBA\u5DE5\u9A8C\u6536\u5904\u7F6E\u3002", { acceptanceCriterionId: input.acceptanceCriterionId });
  }
  if (input.evidence.kind === "browser-operation") {
    if (!input.evidence.eventId) throw new DevFlowError("INVALID_ACCEPTANCE_EVIDENCE", "\u6D4F\u89C8\u5668\u9A8C\u6536\u5FC5\u987B\u63D0\u4F9B eventId\u3002");
    await browserEvent(root2, id, input.evidence.eventId, input.host);
  }
  let sourceEventId;
  let artifactPath;
  let artifactSha256;
  if (input.evidence.kind === "screenshot") {
    sourceEventId = input.evidence.sourceEventId;
    if (!sourceEventId || !input.evidence.path) throw new DevFlowError("INVALID_ACCEPTANCE_EVIDENCE", "\u622A\u56FE\u9A8C\u6536\u5FC5\u987B\u540C\u65F6\u63D0\u4F9B\u622A\u56FE\u8DEF\u5F84\u548C\u6D4F\u89C8\u5668\u4E8B\u4EF6\u3002");
    await browserEvent(root2, id, sourceEventId, input.host);
    const artifact = await storeScreenshotArtifact(root2, id, input.evidence.path);
    artifactPath = artifact.artifactPath;
    artifactSha256 = artifact.artifactSha256;
  }
  if (input.evidence.kind === "file-inspection") {
    if (!input.evidence.observation) throw new DevFlowError("INVALID_ACCEPTANCE_EVIDENCE", "\u6587\u4EF6\u6838\u5BF9\u5FC5\u987B\u63D0\u4F9B\u7ED3\u6784\u5316 observation\u3002");
    const result = await executeRepositoryObservation(root2, input.evidence.observation);
    if (!result.confirmed) throw new DevFlowError("INVALID_ACCEPTANCE_EVIDENCE", "\u6587\u4EF6\u6838\u5BF9\u6CA1\u6709\u5F97\u5230\u9884\u671F\u7ED3\u679C\u3002", { summary: result.summary });
    artifactSha256 = result.observedFingerprint;
  }
  const evidenceId = `AC-EVIDENCE-${randomUUID7()}`;
  return mutate(root2, id, expectedRevision, "acceptance-evidence-recorded", (state) => {
    const acceptance = ensureAcceptance(state);
    const record = {
      recordId: evidenceId,
      kind: "acceptance-evidence",
      evidenceKind: input.evidence.kind,
      acceptanceCriterionId: input.acceptanceCriterionId,
      basis: { kind: "content", sha256: fingerprint2 },
      ...artifactPath ? { artifactPath } : {},
      ...artifactSha256 ? { artifactSha256 } : {},
      ...input.evidence.eventId ? { eventId: input.evidence.eventId } : {},
      ...sourceEventId ? { eventId: sourceEventId } : {},
      ...input.evidence.observation ? { observation: input.evidence.observation } : {},
      ...input.evidence.note?.trim() ? { note: input.evidence.note.trim() } : {},
      recordedAt: (/* @__PURE__ */ new Date()).toISOString()
    };
    acceptance.evidence.push(record);
    upsertDisposition(state, record.acceptanceCriterionId, input.evidence.kind === "agent-self-check" ? "pending" : "satisfied", fingerprint2, [...acceptance.dispositions.find((item) => item.acceptanceCriterionId === record.acceptanceCriterionId)?.evidenceRefs ?? [], evidenceId]);
    state.lastUpdatedBy = { host: input.host, pluginVersion: "5.1.0" };
  });
}
function dispositionHash(state, criterionIds, fingerprint2) {
  const entries = (state.acceptance?.dispositions ?? []).filter((item) => criterionIds.includes(item.acceptanceCriterionId)).map((item) => ({ id: item.acceptanceCriterionId, kind: item.dispositionKind, status: item.status, refs: item.evidenceRefs, basis: item.basis })).sort((a, b) => a.id.localeCompare(b.id));
  return digest7(JSON.stringify({ criterionIds, fingerprint: fingerprint2, entries }));
}
async function presentAcceptanceConfirmation(root2, id, expectedRevision, acceptanceCriterionIds) {
  const initial = await readState(root2, id);
  const { fingerprint: fingerprint2, trace: trace2 } = await currentBasis(root2, initial);
  const criteria = currentHumanCriteria(initial, trace2);
  const selected = [...new Set(acceptanceCriterionIds)].sort();
  if (!selected.length || selected.some((criterion) => !criteria.includes(criterion))) throw new DevFlowError("ACCEPTANCE_CRITERION_NOT_HUMAN", "\u53EA\u80FD\u4E3A\u5F53\u524D\u9700\u8981\u4EBA\u5DE5\u9A8C\u6536\u7684 AC \u8BF7\u6C42\u7528\u6237\u786E\u8BA4\u3002", { criteria });
  const hash2 = dispositionHash(initial, selected, fingerprint2);
  let created;
  const state = await mutate(root2, id, expectedRevision, "acceptance-confirmation-presented", (draft) => {
    const current = draft.acceptance?.dispositions ?? [];
    const currentHash = dispositionHash(draft, selected, fingerprint2);
    if (currentHash !== hash2) throw new DevFlowError("ACCEPTANCE_CONFIRMATION_STALE", "\u9A8C\u6536\u4F9D\u636E\u5DF2\u53D8\u5316\uFF0C\u8BF7\u91CD\u65B0\u5448\u73B0\u3002", { retryOriginal: true });
    created = createInteraction(draft, {
      kind: "acceptance-confirmation",
      target: `acceptance-confirmation:${selected.join(",")}`,
      basisHash: digest7(JSON.stringify({ fingerprint: fingerprint2, hash: hash2, selected })),
      question: `\u8BF7\u786E\u8BA4\u4EE5\u4E0B\u9A8C\u6536\u6761\u4EF6\u5728\u5F53\u524D\u4EA4\u4ED8\u5185\u5BB9\u4E0A\u5DF2\u7ECF\u8FBE\u5230\u9884\u671F\uFF1A${selected.join("\u3001")}`,
      options: [{ id: "confirm", label: "\u786E\u8BA4\u9A8C\u6536" }, { id: "decline", label: "\u6682\u4E0D\u786E\u8BA4" }],
      acceptanceConfirmation: { acceptanceCriterionIds: selected, deliveryFingerprint: fingerprint2, dispositionHash: hash2 }
    });
  });
  if (!created) throw new DevFlowError("INTERACTION_NOT_CREATED", "\u9A8C\u6536\u786E\u8BA4\u95EE\u9898\u672A\u521B\u5EFA");
  return { state, interaction: toPublicInteraction(created), interactionId: created.id };
}
async function resolveAcceptanceConfirmationForAnswer(ctx) {
  const { root: root2, featureId, expectedRevision, host, credential, interaction, state } = ctx;
  if (interaction.kind !== "acceptance-confirmation" || interaction.status !== "pending" || !interaction.acceptanceConfirmation) {
    throw new DevFlowError("INTERACTION_NOT_PENDING", "\u5F53\u524D\u6CA1\u6709\u5F85\u786E\u8BA4\u7684\u9A8C\u6536\u95EE\u9898\u3002");
  }
  const { fingerprint: fingerprint2 } = await currentBasis(root2, state);
  if (fingerprint2 !== interaction.acceptanceConfirmation.deliveryFingerprint || dispositionHash(state, interaction.acceptanceConfirmation.acceptanceCriterionIds, fingerprint2) !== interaction.acceptanceConfirmation.dispositionHash) {
    throw new DevFlowError("ACCEPTANCE_CONFIRMATION_STALE", "\u4EA4\u4ED8\u5185\u5BB9\u5DF2\u53D8\u5316\uFF0C\u65E7\u9A8C\u6536\u786E\u8BA4\u4E0D\u80FD\u7EE7\u7EED\u4F7F\u7528\u3002", { retryOriginal: true });
  }
  let promptEventId;
  let promptText;
  if (credential.source === "text") {
    const prompt = resolveInteractionPromptEvent(await readFeatureEvents(root2, featureId), state, interaction, { host, userReply: credential.userReply });
    promptEventId = prompt.eventId;
    promptText = prompt.text;
  }
  let response;
  const next = await mutatePrepared(root2, featureId, expectedRevision, "acceptance-confirmation-resolved", async (current) => {
    const live = getInteraction(current, interaction.id);
    if (live.kind !== "acceptance-confirmation" || live.status !== "pending") {
      throw new DevFlowError("INTERACTION_NOT_PENDING", "\u5F53\u524D\u6CA1\u6709\u5F85\u786E\u8BA4\u7684\u9A8C\u6536\u95EE\u9898\u3002");
    }
    return {
      mutate: (draft) => {
        const draftLive = getInteraction(draft, interaction.id);
        response = resolveResponseForAnswer(draft, interaction, {
          source: credential.source,
          action: credential.source === "elicitation" ? credential.action : void 0,
          comment: credential.source === "elicitation" ? credential.comment : void 0,
          userReply: credential.source === "text" ? credential.userReply : void 0,
          promptText,
          promptEventId,
          host
        });
        if (response.action !== "confirm") return;
        const credentialId = `CRED-ACCEPTANCE-${randomUUID7()}`;
        const credentials = [...draft.governance?.credentials ?? []];
        const record = {
          recordId: credentialId,
          kind: "credential",
          source: credential.source === "elicitation" ? "native-form" : "text",
          host,
          interactionId: interaction.id,
          optionId: "confirm",
          ...promptEventId ? { basis: { kind: "event", eventId: promptEventId } } : draftLive.presentationEventId ? { basis: { kind: "event", eventId: draftLive.presentationEventId } } : {},
          recordedAt: (/* @__PURE__ */ new Date()).toISOString()
        };
        credentials.push(record);
        draft.governance = { ...draft.governance ?? { decisions: [], claims: [], authorizations: [], credentials: [], repositoryFacts: [] }, credentials };
        const confirmation = draftLive.acceptanceConfirmation;
        if (!confirmation) throw new DevFlowError("ACCEPTANCE_CONFIRMATION_STALE", "\u9A8C\u6536\u786E\u8BA4\u4E0A\u4E0B\u6587\u7F3A\u5931\uFF0C\u8BF7\u91CD\u65B0\u5448\u73B0\u3002");
        for (const criterionId of confirmation.acceptanceCriterionIds) {
          const refs = draft.acceptance?.dispositions.find((item) => item.acceptanceCriterionId === criterionId)?.evidenceRefs ?? [];
          upsertDisposition(draft, criterionId, "satisfied", confirmation.deliveryFingerprint, [...refs, credentialId]);
        }
      }
    };
  });
  if (!response) throw new DevFlowError("INTERACTION_NOT_RESOLVED", interaction.id);
  return { state: next, action: response.action, ...response.comment ? { comment: response.comment } : {} };
}

// plugins/dev-flow/src/core/rollback.ts
import { createHash as createHash27, randomUUID as randomUUID12 } from "node:crypto";
import { access as access3, chmod, lstat as lstat6, mkdir as mkdir10, open as open6, readFile as readFile15, readlink as readlink4, rename as rename5, rm as rm2, symlink } from "node:fs/promises";
import path19 from "node:path";

// plugins/dev-flow/src/core/checkpoints.ts
import { randomUUID as randomUUID8, createHash as createHash24 } from "node:crypto";
import { access as access2, mkdir as mkdir8, open as open5, readFile as readFile13, readlink as readlink3, readdir as readdir5, rename as rename4 } from "node:fs/promises";
import path17 from "node:path";

// plugins/dev-flow/src/core/verification.ts
import { createHash as createHash23 } from "node:crypto";

// plugins/dev-flow/src/core/repair-loop.ts
function startRepairLoop(maxAttempts = 5) {
  if (!Number.isInteger(maxAttempts) || maxAttempts < 1) throw new Error("maxAttempts must be a positive integer");
  return { status: "active", attempts: [], maxAttempts };
}
function recordRepairAttempt(state, signature, progressEvidence) {
  const attempts = [...state.attempts, { attempt: state.attempts.length + 1, signature, progressEvidence: [...progressEvidence], at: (/* @__PURE__ */ new Date()).toISOString() }];
  const prior = attempts.at(-2);
  const noProgress = Boolean(prior && prior.signature === signature && prior.progressEvidence.join("\n") === progressEvidence.join("\n"));
  const stalled = noProgress || attempts.length >= state.maxAttempts;
  return stalled ? { ...state, status: "waiting-user", attempts, recoveryAction: { kind: "ask-user", reason: noProgress ? "\u540C\u4E00\u5931\u8D25\u7B7E\u540D\u8FDE\u7EED\u4E24\u6B21\u6CA1\u6709\u8FDB\u5C55" : "\u81EA\u52A8\u4FEE\u590D\u5DF2\u8FBE\u5230\u8F6E\u6B21\u4E0A\u9650", facts: [signature, ...progressEvidence], impact: "\u7EE7\u7EED\u81EA\u52A8\u4FEE\u590D\u53EF\u80FD\u63A9\u76D6\u771F\u5B9E\u504F\u5DEE", recommendation: "\u8BF7\u786E\u8BA4\u4FEE\u8BA2\u5F53\u524D\u5355\u5143\u3001\u56DE\u6EDA\u6216\u8C03\u6574\u8BA1\u5212" } } : { ...state, status: "active", attempts };
}
function markRepairCompleted(state) {
  return { ...state, status: "completed", recoveryAction: void 0 };
}

// plugins/dev-flow/src/core/evidence-snapshot-store.ts
import { mkdir as mkdir6, readFile as readFile12, writeFile } from "node:fs/promises";
import path15 from "node:path";
function featureDirectory2(root2, id) {
  return path15.join(root2, ".dev-flow", "features", id);
}
async function readEvidenceSnapshot(root2, id, snapshotPath) {
  const raw = await readFile12(path15.join(featureDirectory2(root2, id), snapshotPath), "utf8");
  const parsed = JSON.parse(raw);
  if (!Array.isArray(parsed)) throw new TypeError("evidence snapshot must be an array");
  return parsed;
}
async function writeEvidenceSnapshot(root2, id, snapshot, fingerprint2, directory) {
  const snapshotPath = `${directory}/snapshot-${fingerprint2}.json`;
  const featureRoot = featureDirectory2(root2, id);
  const file = path15.join(featureRoot, snapshotPath);
  await mkdir6(path15.dirname(file), { recursive: true });
  await writeFile(file, JSON.stringify(snapshot));
  return snapshotPath;
}

// plugins/dev-flow/src/core/change-invalidation.ts
function recordedBaseline(state) {
  const verificationEvidence = state.steps.verification?.evidence;
  if (state.verification.verifiedFingerprint) {
    return { fingerprint: state.verification.verifiedFingerprint, snapshotPath: verificationEvidence?.snapshotPath };
  }
  const reviewEvidence = state.steps.code_review?.evidence;
  if (typeof reviewEvidence?.fingerprint === "string") {
    return { fingerprint: reviewEvidence.fingerprint, snapshotPath: reviewEvidence.snapshotPath };
  }
  const invalidatedAt = state.lastInvalidation?.at ? Date.parse(state.lastInvalidation.at) : Number.NaN;
  const accepted = (state.governance?.authorizations ?? []).find((authorization) => authorization.authorizationType === "risk-acceptance" && authorization.basis?.kind === "content" && (!Number.isFinite(invalidatedAt) || !authorization.recordedAt || Date.parse(authorization.recordedAt) >= invalidatedAt));
  if (accepted?.basis?.kind === "content") return { fingerprint: accepted.basis.sha256 };
  return void 0;
}
function changedPaths(before, after) {
  const beforeMap = new Map(before.map((file) => [file.path, file]));
  const afterMap = new Map(after.map((file) => [file.path, file]));
  const changed = /* @__PURE__ */ new Set();
  for (const [filePath, beforeFile] of beforeMap) {
    const afterFile = afterMap.get(filePath);
    if (!afterFile) changed.add(filePath);
    else if (afterFile.sha256 !== beforeFile.sha256 || afterFile.mode !== beforeFile.mode) changed.add(filePath);
  }
  for (const [filePath] of afterMap) {
    if (!beforeMap.has(filePath)) changed.add(filePath);
  }
  return [...changed].sort();
}
async function invalidateAffectedClaims(root2, id, expectedRevision) {
  const state = await readState(root2, id);
  if (state.lifecycle !== "active") return void 0;
  const baseline = recordedBaseline(state);
  if (!baseline) return void 0;
  const config = await readProjectConfig(root2);
  const current = await fingerprintFeatureOwned(root2, config, state.workspace.ownership);
  const currentFull = await fingerprintGovernedRoots(root2, config);
  let changedFiles;
  if (baseline.snapshotPath) {
    try {
      const before = (await readEvidenceSnapshot(root2, id, baseline.snapshotPath)).filter((file) => state.workspace.ownership[file.path] !== "excluded");
      const after = (await snapshotGovernedRoots(root2, config)).filter((file) => state.workspace.ownership[file.path] !== "excluded");
      changedFiles = changedPaths(
        before,
        after
      );
    } catch {
      changedFiles = void 0;
    }
  }
  const unownedDeliveryChange = changedFiles?.some((file) => state.workspace.ownership[file] === void 0) ?? true;
  const fullDrift = baseline.snapshotPath ? unownedDeliveryChange : currentFull !== state.startBusinessFingerprint;
  if (current === baseline.fingerprint && !fullDrift) return void 0;
  const reviewEvidence = state.steps.code_review?.evidence;
  const reviewReopened = state.steps.code_review !== void 0 && (fullDrift || typeof reviewEvidence?.fingerprint !== "string" || reviewEvidence.fingerprint !== current);
  const verificationReopened = state.verification.verifiedFingerprint !== void 0 && (fullDrift || state.verification.verifiedFingerprint !== current);
  const authorizationBound = (state.governance?.authorizations ?? []).some((authorization) => authorization.authorizationType === "risk-acceptance" && authorization.basis?.kind === "content" && authorization.basis.sha256 !== current);
  let exceptionBound = authorizationBound;
  if (!baseline.snapshotPath && currentFull !== state.startBusinessFingerprint) {
    changedFiles = void 0;
    exceptionBound = true;
  }
  if ((changedFiles?.length ?? 0) > 0 && (state.governance?.authorizations ?? []).some((authorization) => authorization.authorizationType === "risk-acceptance")) {
    exceptionBound = true;
  }
  const checkpointed = (state.implementationUnits ?? []).filter((unit) => unit.status === "checkpointed");
  let reopenedUnits = [];
  let fallback = false;
  let reason = "";
  if (!changedFiles) {
    reopenedUnits = checkpointed.map((unit) => unit.unitId);
    fallback = reopenedUnits.length > 0;
    reason = reopenedUnits.length ? "\u65E0\u6CD5\u5B9A\u4F4D\u53D8\u5316\u5F71\u54CD\uFF1A\u7F3A\u5C11\u9010\u6587\u4EF6\u57FA\u51C6\u5FEB\u7167\uFF0C\u56DE\u9000\u5230\u5B8C\u6574\u5B9E\u73B0\u91CD\u505A" : "\u65E0\u5B9E\u73B0\u5355\u5143\u8BB0\u5F55\uFF0C\u8DF3\u8FC7\u5355\u5143\u91CD\u5F00";
  } else if (changedFiles.length > 0) {
    const matched = /* @__PURE__ */ new Set();
    for (const unit of checkpointed) {
      const manifest = await readCheckpointManifest(root2, id, unit.checkpointId);
      const unitFiles = new Set(manifest.files.map((record) => record.path));
      if (changedFiles.some((file) => unitFiles.has(file))) matched.add(unit.unitId);
    }
    reopenedUnits = [...matched].sort();
    if (reopenedUnits.length === 0) {
      reopenedUnits = checkpointed.map((unit) => unit.unitId);
      fallback = reopenedUnits.length > 0;
      reason = reopenedUnits.length ? "\u65E0\u6CD5\u5B9A\u4F4D\u53D8\u5316\u5F71\u54CD\uFF1A\u53D8\u5316\u6587\u4EF6\u672A\u547D\u4E2D\u4EFB\u4F55\u5B9E\u73B0\u5355\u5143\u7684\u5B9E\u9645\u5199\u5165\u8303\u56F4\uFF0C\u56DE\u9000\u5230\u5B8C\u6574\u5B9E\u73B0\u91CD\u505A" : "\u53D8\u5316\u672A\u547D\u4E2D\u4EFB\u4F55\u5B9E\u73B0\u5355\u5143";
    } else {
      reason = "\u53D7\u5F71\u54CD\u5B9E\u73B0\u5355\u5143\u5DF2\u91CD\u5F00";
    }
  } else {
    reason = "\u65E0\u6587\u4EF6\u7EA7\u53D8\u5316\uFF08\u4EC5\u5143\u6570\u636E\u6F02\u79FB\uFF09\uFF0C\u8DF3\u8FC7\u5355\u5143\u91CD\u5F00";
  }
  if (reopenedUnits.length === 0 && !reviewReopened && !verificationReopened && !exceptionBound) return void 0;
  const invalidated = {
    changedFiles,
    reopenedUnits,
    reviewReopened,
    verificationReopened,
    fallback,
    reason
  };
  await mutate(root2, id, expectedRevision, "claims-invalidated", (draft) => {
    for (const unitId of reopenedUnits) {
      const unit = (draft.implementationUnits ?? []).find((candidate) => candidate.unitId === unitId);
      if (!unit || unit.status !== "checkpointed") continue;
      reopenImplementationUnit(unit);
    }
    const liveReview = draft.steps.code_review?.evidence;
    if (draft.steps.code_review !== void 0 && (fullDrift || typeof liveReview?.fingerprint !== "string" || liveReview.fingerprint !== current)) {
      delete draft.steps.code_review;
    }
    if (verificationReopened) {
      delete draft.verification.satisfiedByAttemptId;
      delete draft.verification.verifiedFingerprint;
      draft.steps.verification = { status: "pending", evidence: { reason: "governed-files-changed", current } };
    }
    if (reopenedUnits.length > 0) delete draft.steps.implementation;
    if (draft.acceptance) {
      draft.acceptance.dispositions = draft.acceptance.dispositions.map((disposition) => ({
        ...disposition,
        status: "stale"
      }));
    }
    draft.logicComplete = false;
    delete draft.steps.finalize;
    draft.lastInvalidation = {
      at: (/* @__PURE__ */ new Date()).toISOString(),
      ...changedFiles ? { changedFiles } : {},
      reopenedUnits,
      reviewReopened,
      verificationReopened,
      fallback,
      reason
    };
    draft.lastUpdatedBy = { host: state.lastUpdatedBy.host, pluginVersion: "5.1.0" };
  }, { changedFiles, reopenedUnits, reviewReopened, verificationReopened, fallback, reason });
  return invalidated;
}
async function persistThroughSnapshot(root2, id, snapshot, fingerprint2, directory) {
  return writeEvidenceSnapshot(root2, id, snapshot, fingerprint2, directory);
}
function workspaceChangedError(invalidated) {
  return new DevFlowError("WORKSPACE_CHANGED", "\u4EA4\u4ED8\u5185\u5BB9\u5DF2\u53D8\u5316\uFF0C\u53D7\u5F71\u54CD\u7684\u5B9E\u73B0\u5355\u5143\u3001\u4EE3\u7801\u5BA1\u67E5\u6216\u9A8C\u8BC1\u5DF2\u91CD\u65B0\u6253\u5F00\u3002", {
    ...invalidated,
    recoveryHint: "\u6309 dev_flow_status \u663E\u793A\u7684\u5F53\u524D\u9636\u6BB5\u7EE7\u7EED\uFF1A\u91CD\u505A\u53D7\u5F71\u54CD\u5B9E\u73B0\u5355\u5143\uFF0C\u5E76\u91CD\u65B0\u5B8C\u6210\u4EE3\u7801\u5BA1\u67E5\u4E0E\u9A8C\u8BC1\u3002"
  });
}

// plugins/dev-flow/src/core/verification-store.ts
import { execFile as execFile5 } from "node:child_process";
import { mkdir as mkdir7, writeFile as writeFile2 } from "node:fs/promises";
import path16 from "node:path";
import { promisify as promisify5 } from "node:util";
var run4 = promisify5(execFile5);
async function runVerificationProcess(root2, input) {
  try {
    const result = await run4(input.executable, input.args, {
      cwd: path16.resolve(root2, input.cwd ?? "."),
      timeout: input.timeoutMs,
      maxBuffer: input.maxOutputBytes
    });
    return { exitCode: 0, output: `${result.stdout}${result.stderr}`, exitReason: "success" };
  } catch (error) {
    const failure2 = error;
    const output = `${failure2.stdout ?? ""}${failure2.stderr ?? failure2.message}`;
    if (failure2.killed === true || failure2.code === "ETIMEDOUT") {
      return { exitCode: 1, output: `${output}
[command timed out after ${input.timeoutMs}ms]`, exitReason: "timeout" };
    }
    if (failure2.code === "ERR_CHILD_PROCESS_STDIO_MAXBUFFER") {
      return { exitCode: 1, output: `${output}
[command output exceeded ${input.maxOutputBytes} bytes]`, exitReason: "output-limit" };
    }
    if (typeof failure2.code === "number") {
      return { exitCode: failure2.code, output, exitReason: "non-zero-exit" };
    }
    return { exitCode: 1, output, exitReason: "spawn-failure" };
  }
}
async function writeVerificationOutput(root2, featureId, outputPath, output) {
  const file = path16.join(root2, ".dev-flow", "features", featureId, outputPath);
  await mkdir7(path16.dirname(file), { recursive: true });
  await writeFile2(file, output);
}

// plugins/dev-flow/src/core/verification.ts
function quoteForWindowsCommandProcessor(value) {
  if (value.length > 0 && !/[\s"&|<>()^%!]/u.test(value)) return value;
  return `"${value.replace(/(["^&|<>()%!])/gu, "^$1")}"`;
}
function verificationInvocation(command2, platform = process.platform, commandProcessor = process.env.ComSpec ?? "cmd.exe") {
  if (platform !== "win32") return { executable: command2.command, args: command2.args };
  return {
    executable: commandProcessor,
    args: ["/d", "/s", "/c", [command2.command, ...command2.args].map(quoteForWindowsCommandProcessor).join(" ")]
  };
}
var DEFAULT_COMMAND_TIMEOUT_MS = 12e4;
var DEFAULT_COMMAND_MAX_OUTPUT_BYTES = 1024 * 1024;
async function runVerificationCommand(root2, command2) {
  const timeout = command2.timeoutMs ?? DEFAULT_COMMAND_TIMEOUT_MS;
  const maxBuffer = command2.maxOutputBytes ?? DEFAULT_COMMAND_MAX_OUTPUT_BYTES;
  const invocation = verificationInvocation(command2);
  return runVerificationProcess(root2, {
    ...invocation,
    cwd: command2.cwd,
    timeoutMs: timeout,
    maxOutputBytes: maxBuffer
  });
}
function successfulAttempt(state) {
  const attemptId = state.verification.satisfiedByAttemptId;
  if (attemptId === void 0) return void 0;
  return state.verification.attempts.find((value) => {
    const candidate = value;
    return candidate.id === attemptId;
  });
}
function verificationCommandSliceStale(state, config) {
  const attempt = successfulAttempt(state);
  if (!attempt?.verificationCommandHashes) return false;
  const refs = [...attempt.commandIds, ...attempt.preflightCommandIds ?? []];
  const current = verificationCommandHashesForRefs(config, refs);
  return Object.entries(attempt.verificationCommandHashes).some(([id, hash2]) => current[id] !== hash2);
}
function minimalGuaranteeCommands(state, config) {
  const needed = new Set(state.classification.controls.verification);
  const preflight = new Set(config.verification.preflightCommands ?? []);
  const candidates = [...config.verification.commands].filter((command2) => !preflight.has(command2.id)).sort((left, right) => left.id.localeCompare(right.id));
  const coversAll = (commands) => {
    const provided = new Set(commands.flatMap((command2) => command2.provides));
    return [...needed].every((kind) => provided.has(kind));
  };
  const choose = (size, start, selected) => {
    if (selected.length === size) return coversAll(selected) ? [...selected] : void 0;
    for (let index = start; index <= candidates.length - (size - selected.length); index += 1) {
      selected.push(candidates[index]);
      const match = choose(size, index + 1, selected);
      selected.pop();
      if (match) return match;
    }
    return void 0;
  };
  for (let size = 1; size <= candidates.length; size += 1) {
    const selected = choose(size, 0, []);
    if (selected) return selected;
  }
  const configured = new Set(candidates.flatMap((command2) => command2.provides));
  throw new DevFlowError("VERIFICATION_GUARANTEE_UNCONFIGURED", "\u9879\u76EE\u6CA1\u6709\u914D\u7F6E\u6EE1\u8DB3\u5F53\u524D\u4FDD\u8BC1\u96C6\u7684\u9A8C\u8BC1\u547D\u4EE4\u3002", {
    missingGuarantees: [...needed].filter((kind) => !configured.has(kind)),
    recoveryHint: "\u5728 project schema v2 \u4E2D\u4E3A\u9A8C\u8BC1\u547D\u4EE4\u58F0\u660E provides\uFF0C\u7136\u540E\u91CD\u8BD5"
  });
}
function dispositionKindForCriterion(ledger, criterionId) {
  const node = ledger.nodes[criterionId];
  if (node?.kind === "acceptance-criterion" && node.verificationDisposition) return node.verificationDisposition.kind;
  return "behavior-test";
}
function syncAcceptanceDispositions(state, ledger, fingerprint2, provided, commandSucceeded) {
  const currentCriteria = Object.values(ledger.nodes).filter((node) => node.status === "current" && node.kind === "acceptance-criterion");
  state.acceptance ??= { evidence: [], dispositions: [] };
  const pending = [];
  for (const criterion of currentCriteria) {
    const kind = dispositionKindForCriterion(ledger, criterion.id);
    const existing = state.acceptance.dispositions.find((item) => item.acceptanceCriterionId === criterion.id);
    let status = "pending";
    let evidenceRefs = existing?.evidenceRefs ?? [];
    if (kind === "human-acceptance") {
      status = existing?.basis.sha256 === fingerprint2 && existing.status === "satisfied" ? "satisfied" : existing?.basis.sha256 === fingerprint2 ? existing.status : "stale";
      evidenceRefs = [
        ...state.acceptance.evidence.filter((record) => record.acceptanceCriterionId === criterion.id && record.basis.sha256 === fingerprint2 && record.evidenceKind !== "agent-self-check").map((record) => record.recordId),
        ...existing?.evidenceRefs.filter((ref) => ref.startsWith("CRED-ACCEPTANCE-")) ?? []
      ];
      if (existing?.evidenceRefs.some((ref) => ref.startsWith("CRED-ACCEPTANCE-")) && existing.basis.sha256 === fingerprint2 && existing.status === "satisfied") status = "satisfied";
    } else if (kind === "file-check") {
      status = state.acceptance.evidence.some((record) => record.acceptanceCriterionId === criterion.id && record.evidenceKind === "file-inspection" && record.basis.sha256 === fingerprint2) ? "satisfied" : "pending";
    } else {
      const commandKind = kind === "behavior-test" ? "behavior" : kind === "type-check" ? "type" : "rule";
      status = commandSucceeded && provided.has(commandKind) ? "satisfied" : "pending";
    }
    const next = { acceptanceCriterionId: criterion.id, dispositionKind: kind, status, evidenceRefs: [...new Set(evidenceRefs)], basis: { kind: "content", sha256: fingerprint2 } };
    if (existing) Object.assign(existing, next);
    else state.acceptance.dispositions.push(next);
    if (status !== "satisfied") pending.push(criterion.id);
  }
  return { complete: pending.length === 0, pending };
}
async function runVerification(root2, id, expectedRevision, host, commandIds) {
  const initial = await readState(root2, id);
  if (initial.revision !== expectedRevision) {
    throw new DevFlowError("STATE_REVISION_CONFLICT", "state revision changed", {
      currentRevision: initial.revision
    });
  }
  const invalidated = await invalidateAffectedClaims(root2, id, expectedRevision);
  if (invalidated) throw workspaceChangedError(invalidated);
  await assertRequirementsGrillSatisfied(root2, id, initial);
  const config = await readProjectConfig(root2);
  const preflightIds = new Set(config.verification.preflightCommands ?? []);
  if (commandIds?.some((commandId) => preflightIds.has(commandId))) {
    throw new DevFlowError("PREFLIGHT_COMMAND_NOT_SELECTABLE", "preflight \u547D\u4EE4\u662F\u73AF\u5883\u51C6\u5907\uFF0C\u4E0D\u80FD\u4F5C\u4E3A\u9A8C\u8BC1\u547D\u4EE4\u663E\u5F0F\u9009\u62E9\u3002", {
      commandIds: commandIds.filter((commandId) => preflightIds.has(commandId)),
      recoveryHint: "\u4ECE commandIds \u4E2D\u79FB\u9664 preflight \u547D\u4EE4\uFF1B\u73AF\u5883\u51C6\u5907\u4F1A\u5728\u6BCF\u6B21\u9A8C\u8BC1\u65F6\u81EA\u52A8\u6267\u884C\uFF0C\u53EA\u6709\u666E\u901A\u9A8C\u8BC1\u547D\u4EE4\u80FD\u63D0\u4F9B\u4FDD\u8BC1\u8BC1\u636E\u3002"
    });
  }
  const selected = commandIds?.length ? config.verification.commands.filter((command2) => commandIds.includes(command2.id)) : minimalGuaranteeCommands(initial, config);
  if (!selected.length || commandIds?.some((command2) => !selected.some((item) => item.id === command2))) {
    throw new DevFlowError("UNKNOWN_VERIFICATION_COMMAND", "verification command is not configured");
  }
  const provided = new Set(selected.flatMap((command2) => command2.provides));
  const missingGuarantees = initial.classification.controls.verification.filter((kind) => !provided.has(kind));
  if (missingGuarantees.length) throw new DevFlowError("VERIFICATION_GUARANTEE_UNCOVERED", "\u9009\u62E9\u7684\u547D\u4EE4\u4E0D\u80FD\u8986\u76D6\u5F53\u524D\u6700\u7EC8\u4FDD\u8BC1\u96C6\u3002", { missingGuarantees });
  const fingerprint2 = await fingerprintFeatureOwned(root2, config, initial.workspace.ownership);
  const trace2 = initial.traceability ? await readTraceability(root2, initial) : void 0;
  const replacingStaleVerification = Boolean(
    initial.verification.verifiedFingerprint && initial.verification.verifiedFingerprint !== fingerprint2
  ) || verificationCommandSliceStale(initial, config);
  const startedAt = (/* @__PURE__ */ new Date()).toISOString();
  let exitCode = 0;
  let exitReason = "success";
  let phase = "forward";
  const output = [];
  const preflight = (config.verification.preflightCommands ?? []).map((commandId) => {
    const command2 = config.verification.commands.find((candidate) => candidate.id === commandId);
    if (!command2) throw new DevFlowError("INVALID_PROJECT_CONFIG", "preflight command is not configured", { commandId });
    return command2;
  });
  for (const group of [
    { phase: "preflight", commands: preflight },
    { phase: "forward", commands: selected }
  ]) {
    if (exitCode !== 0) break;
    for (const command2 of group.commands) {
      const result = await runVerificationCommand(root2, command2);
      output.push(`[${command2.id}] ${result.output}`);
      if (result.exitReason !== "success") {
        exitCode = result.exitCode;
        exitReason = result.exitReason;
        phase = group.phase;
        break;
      }
    }
  }
  const finishedAt = (/* @__PURE__ */ new Date()).toISOString();
  const fullOutput = output.join("\n");
  return mutate(root2, id, expectedRevision, "verification-recorded", async (state) => {
    if (state.lifecycle !== "active") {
      throw new DevFlowError("INVALID_LIFECYCLE", "only active features can verify");
    }
    if (currentOpenStep(state) !== "verification" && !(replacingStaleVerification && state.steps.verification?.status === "satisfied")) {
      assertCurrentStep(state, "verification");
    }
    await assertRequirementsGrillSatisfied(root2, id, state);
    const kinds = [...state.classification.controls.verification];
    const attempt = {
      id: state.verification.attempts.length + 1,
      commandIds: selected.map((item) => item.id),
      ...preflight.length ? { preflightCommandIds: preflight.map((item) => item.id) } : {},
      verificationCommandHashes: verificationCommandHashesForRefs(config, [
        ...selected.map((item) => item.id),
        ...preflight.map((item) => item.id)
      ]),
      kinds,
      startedAt,
      finishedAt,
      exitCode,
      exitReason,
      outputTail: fullOutput.slice(-4e3),
      outputPath: `verification/${state.verification.attempts.length + 1}.log`,
      fingerprint: fingerprint2,
      host,
      phase
    };
    await writeVerificationOutput(root2, id, attempt.outputPath, fullOutput);
    state.verification.attempts.push(attempt);
    delete state.verification.satisfiedByAttemptId;
    delete state.verification.verifiedFingerprint;
    state.steps.verification = { status: "pending", evidence: { attemptId: attempt.id, exitCode, exitReason } };
    const acceptance = trace2 ? syncAcceptanceDispositions(state, trace2, fingerprint2, new Set(selected.flatMap((command2) => command2.provides)), exitCode === 0) : { complete: true, pending: [] };
    if (exitCode === 0 && acceptance.complete) {
      const snapshot = await snapshotGovernedRoots(root2, config);
      const snapshotPath = await persistThroughSnapshot(root2, id, snapshot, fingerprint2, "verification");
      const gov = state.governance ?? EMPTY_GOVERNANCE_LEDGER;
      const claimId = `CLAIM-${createHash23("sha256").update(`verification-current|${fingerprint2}`).digest("hex").slice(0, 16)}`;
      const claims = [...gov.claims];
      if (!claims.some((claim) => claim.recordId === claimId)) {
        claims.push({
          recordId: claimId,
          kind: "claim",
          claimType: "verification-current",
          subject: id,
          basis: { kind: "content", sha256: fingerprint2 },
          recordedAt: finishedAt
        });
      }
      state.governance = { ...gov, claims };
      state.verification.satisfiedByAttemptId = attempt.id;
      state.verification.verifiedFingerprint = fingerprint2;
      state.businessFingerprint = fingerprint2;
      state.steps.verification = {
        status: "satisfied",
        evidence: {
          attemptId: attempt.id,
          commandIds: attempt.commandIds,
          kinds: attempt.kinds,
          fingerprint: fingerprint2,
          snapshotPath,
          acceptance: state.acceptance?.dispositions.map((disposition) => ({ ...disposition }))
        }
      };
      if (state.repair) state.repair = markRepairCompleted(state.repair);
      state.obligations = satisfyObligations(state.obligations, ["verification"]);
      if (state.classification.riskLabels.length && !reviewEnforcementRequired(state.route, state.classification.controls)) {
        state.obligations = satisfyObligations(state.obligations, ["review"]);
      }
      if (state.classification.riskLabels.includes("irreversible_consequence")) {
        state.obligations = satisfyObligations(state.obligations, ["rollback"]);
      }
    } else if (exitCode === 0) {
      state.steps.verification = {
        status: "pending",
        evidence: {
          attemptId: attempt.id,
          commandIds: attempt.commandIds,
          kinds: attempt.kinds,
          fingerprint: fingerprint2,
          pendingAcceptanceCriteria: acceptance.pending,
          message: "\u81EA\u52A8\u68C0\u67E5\u901A\u8FC7\uFF0C\u4EBA\u5DE5\u9A8C\u6536\u5F85\u5B8C\u6210"
        }
      };
      state.evidenceFreshness.verification = "missing";
    } else {
      const signature = `${exitReason}:${createHash23("sha256").update(fullOutput).digest("hex").slice(0, 16)}`;
      state.repair = recordRepairAttempt(state.repair ?? startRepairLoop(), signature, output.slice(-3));
    }
    state.lastUpdatedBy = { host, pluginVersion: "5.1.0" };
  });
}
async function readVerificationFreshness(root2, state) {
  if (!state.verification.verifiedFingerprint) return { status: "missing" };
  const config = await readProjectConfig(root2);
  const current = await fingerprintFeatureOwned(root2, config, state.workspace.ownership);
  if (state.verification.verifiedFingerprint === current && !verificationCommandSliceStale(state, config)) return { status: "fresh" };
  return {
    status: "stale",
    reasonCode: "VERIFICATION_STALE",
    recoveryHint: "governed \u6587\u4EF6\u5DF2\u53D8\u5316\uFF1B\u5B8C\u6210 finalize \u524D\u8BF7\u91CD\u65B0\u8FD0\u884C\u9A8C\u8BC1"
  };
}
async function verificationIsStale(root2, state) {
  return (await readVerificationFreshness(root2, state)).status === "stale";
}

// plugins/dev-flow/src/core/checkpoints.ts
var digest8 = (value) => createHash24("sha256").update(value).digest("hex");
var featureDirectory3 = (root2, featureId) => path17.join(root2, ".dev-flow", "features", featureId);
function blobPath(sha256) {
  return `checkpoints/blobs/${sha256}`;
}
function manifestPath(checkpointId) {
  return `checkpoints/manifests/${checkpointId}.json`;
}
function baselinePath(unitId) {
  return `checkpoints/baselines/${unitId}.json`;
}
async function writeAtomic(file, contents) {
  const temp = `${file}.${randomUUID8()}.tmp`;
  const handle = await open5(temp, "w");
  try {
    await handle.writeFile(contents);
    await handle.sync();
  } finally {
    await handle.close();
  }
  await rename4(temp, file);
  const directory = await open5(path17.dirname(file), "r");
  try {
    await directory.sync();
  } finally {
    await directory.close();
  }
}
async function pathExists2(file) {
  try {
    await access2(file);
    return true;
  } catch {
    return false;
  }
}
async function writeBlobIfAbsent(root2, featureId, bytes) {
  const sha256 = digest8(bytes);
  const file = path17.join(featureDirectory3(root2, featureId), blobPath(sha256));
  if (await pathExists2(file)) return sha256;
  await mkdir8(path17.dirname(file), { recursive: true });
  await writeAtomic(file, bytes);
  return sha256;
}
function validateBaseline(value, unitId) {
  const baseline = value;
  const files = baseline?.files;
  if (!baseline || baseline.schemaVersion !== 2 || baseline.unitId !== unitId || typeof baseline.featureId !== "string" || typeof baseline.capturedAt !== "string" || !Array.isArray(files) || !files.every((file) => file && typeof file.path === "string" && /^[a-f0-9]{64}$/.test(file.sha256) && /^[0-7]{3,4}$/.test(file.mode))) {
    throw new DevFlowError("CHECKPOINT_BASELINE_INVALID", "implementation unit baseline is unreadable", { unitId });
  }
  return baseline;
}
async function captureUnitBaseline(root2, featureId, unitId, snapshot) {
  for (const file2 of snapshot) {
    const bytes = file2.kind === "symlink" ? Buffer.from(await readlink3(path17.join(root2, file2.path))) : await readFile13(path17.join(root2, file2.path));
    if (digest8(bytes) !== file2.sha256) {
      throw new DevFlowError("CHECKPOINT_HASH_MISMATCH", "\u6355\u83B7\u5355\u5143\u57FA\u7EBF\u65F6 governed \u6587\u4EF6\u53D1\u751F\u53D8\u5316\u3002", { path: file2.path });
    }
    await writeBlobIfAbsent(root2, featureId, bytes);
  }
  const baseline = {
    schemaVersion: 2,
    featureId,
    unitId,
    capturedAt: (/* @__PURE__ */ new Date()).toISOString(),
    files: snapshot
  };
  const file = path17.join(featureDirectory3(root2, featureId), baselinePath(unitId));
  await mkdir8(path17.dirname(file), { recursive: true });
  await writeAtomic(file, `${JSON.stringify(baseline, null, 2)}
`);
}
async function readCheckpointBaseline(root2, featureId, unitId) {
  const file = path17.join(featureDirectory3(root2, featureId), baselinePath(unitId));
  let raw;
  try {
    raw = await readFile13(file, "utf8");
  } catch {
    throw new DevFlowError("CHECKPOINT_BASELINE_INVALID", "implementation unit baseline is missing", { unitId });
  }
  try {
    return validateBaseline(JSON.parse(raw), unitId);
  } catch (error) {
    if (error instanceof DevFlowError) throw error;
    throw new DevFlowError("CHECKPOINT_BASELINE_INVALID", "implementation unit baseline is unreadable", { unitId });
  }
}
function diffSnapshots(before, after) {
  const beforeMap = new Map(before.map((file) => [file.path, file]));
  const afterMap = new Map(after.map((file) => [file.path, file]));
  const records = [];
  const deleted = [];
  const added = [];
  for (const [filePath, beforeFile] of beforeMap) {
    const afterFile = afterMap.get(filePath);
    if (!afterFile) {
      deleted.push(beforeFile);
      continue;
    }
    if (afterFile.sha256 !== beforeFile.sha256) {
      records.push({
        path: filePath,
        change: "modified",
        beforeSha256: beforeFile.sha256,
        afterSha256: afterFile.sha256,
        beforeBlobSha256: beforeFile.sha256,
        afterBlobSha256: afterFile.sha256,
        beforeMode: beforeFile.mode,
        afterMode: afterFile.mode,
        beforeKind: beforeFile.kind ?? "file",
        afterKind: afterFile.kind ?? "file"
      });
    } else if (afterFile.mode !== beforeFile.mode) {
      records.push({
        path: filePath,
        change: "mode-changed",
        beforeSha256: beforeFile.sha256,
        afterSha256: afterFile.sha256,
        beforeBlobSha256: beforeFile.sha256,
        afterBlobSha256: afterFile.sha256,
        beforeMode: beforeFile.mode,
        afterMode: afterFile.mode,
        beforeKind: beforeFile.kind ?? "file",
        afterKind: afterFile.kind ?? "file"
      });
    }
  }
  for (const [filePath, afterFile] of afterMap) {
    if (!beforeMap.has(filePath)) added.push(afterFile);
  }
  const byHash = (files) => {
    const groups = /* @__PURE__ */ new Map();
    for (const file of files) groups.set(file.sha256, [...groups.get(file.sha256) ?? [], file]);
    return groups;
  };
  const deletedByHash = byHash(deleted);
  const addedByHash = byHash(added);
  const pairedDeleted = /* @__PURE__ */ new Set();
  const pairedAdded = /* @__PURE__ */ new Set();
  for (const [hash2, deletedFiles] of deletedByHash) {
    const addedFiles = addedByHash.get(hash2) ?? [];
    if (deletedFiles.length === 1 && addedFiles.length === 1) {
      const from = deletedFiles[0];
      const to = addedFiles[0];
      records.push({
        path: to.path,
        change: "renamed",
        renamedFrom: from.path,
        beforeSha256: hash2,
        afterSha256: hash2,
        beforeBlobSha256: hash2,
        afterBlobSha256: hash2,
        beforeMode: from.mode,
        afterMode: to.mode,
        beforeKind: from.kind ?? "file",
        afterKind: to.kind ?? "file"
      });
      pairedDeleted.add(from.path);
      pairedAdded.add(to.path);
    }
  }
  for (const file of deleted) {
    if (pairedDeleted.has(file.path)) continue;
    records.push({ path: file.path, change: "deleted", beforeSha256: file.sha256, beforeBlobSha256: file.sha256, beforeMode: file.mode, beforeKind: file.kind ?? "file" });
  }
  for (const file of added) {
    if (pairedAdded.has(file.path)) continue;
    records.push({ path: file.path, change: "added", afterSha256: file.sha256, afterBlobSha256: file.sha256, afterMode: file.mode, afterKind: file.kind ?? "file" });
  }
  return records.sort((a, b) => a.path.localeCompare(b.path));
}
function snapshotsEqual(a, b) {
  return a.length === b.length && a.every((file, index) => file.path === b[index]?.path && file.sha256 === b[index]?.sha256 && file.mode === b[index]?.mode && (file.kind ?? "file") === (b[index]?.kind ?? "file"));
}
function reverseRecords(records) {
  return records.map((record) => {
    switch (record.change) {
      case "added":
        return { path: record.path, change: "deleted", beforeSha256: record.afterSha256, beforeBlobSha256: record.afterBlobSha256, beforeMode: record.afterMode, beforeKind: record.afterKind };
      case "deleted":
        return { path: record.path, change: "added", afterSha256: record.beforeSha256, afterBlobSha256: record.beforeBlobSha256, afterMode: record.beforeMode, afterKind: record.beforeKind };
      case "renamed":
        return {
          path: record.renamedFrom,
          change: "renamed",
          renamedFrom: record.path,
          beforeSha256: record.afterSha256,
          afterSha256: record.beforeSha256,
          beforeBlobSha256: record.afterBlobSha256,
          afterBlobSha256: record.beforeBlobSha256,
          beforeMode: record.afterMode,
          afterMode: record.beforeMode,
          beforeKind: record.afterKind,
          afterKind: record.beforeKind
        };
      default:
        return {
          path: record.path,
          change: record.change,
          beforeSha256: record.afterSha256,
          afterSha256: record.beforeSha256,
          beforeBlobSha256: record.afterBlobSha256,
          afterBlobSha256: record.beforeBlobSha256,
          beforeMode: record.afterMode,
          afterMode: record.beforeMode,
          beforeKind: record.afterKind,
          afterKind: record.beforeKind
        };
    }
  });
}
function commandSummary(command2) {
  return [command2.command, ...command2.args].join(" ");
}
function currentImplementationNode(state, nodes, unitId) {
  const node = nodes.find((candidate) => candidate.id === unitId);
  if (!node) {
    throw new DevFlowError("IMPLEMENTATION_UNIT_UNKNOWN", "implementation unit is not part of the current trace graph", { unitId });
  }
  return node;
}
function resolveVerificationCommands(config, node) {
  return node.forwardVerification.map((reference, index) => resolveVerificationCommand(config, node.id, reference, index));
}
function resolveVerificationCommand(config, unitId, reference, index) {
  if (typeof reference !== "string") {
    return {
      id: `inline:${unitId}:${index}`,
      command: reference.command,
      args: [...reference.args ?? []],
      cwd: reference.cwd ?? ".",
      provides: ["targeted"]
    };
  }
  const command2 = config.verification.commands.find((candidate) => candidate.id === reference);
  if (!command2) {
    throw new DevFlowError("TRACE_VERIFICATION_COMMAND_UNKNOWN", "implementation unit references an unknown verification command", {
      unitId,
      commandId: reference
    });
  }
  if (!command2.provides.includes("targeted")) {
    throw new DevFlowError("TRACE_VERIFICATION_COMMAND_NOT_TARGETED", "\u5B9E\u73B0\u5355\u5143\u524D\u5411\u9A8C\u8BC1\u53EA\u80FD\u5F15\u7528\u63D0\u4F9B targeted \u4FDD\u8BC1\u7684\u547D\u4EE4\u3002", {
      commandId: reference,
      recoveryHint: "\u4E3A\u8BE5\u547D\u4EE4\u589E\u52A0 targeted provides\uFF0C\u6216\u5728 RU \u4E2D\u6539\u7528\u660E\u786E\u7684 targeted \u547D\u4EE4"
    });
  }
  return command2;
}
function resolvePreflightCommands(config) {
  return (config.verification.preflightCommands ?? []).map((commandId) => {
    const command2 = config.verification.commands.find((candidate) => candidate.id === commandId);
    if (!command2) {
      throw new DevFlowError("INVALID_PROJECT_CONFIG", "preflight command is not configured", { commandId });
    }
    return command2;
  });
}
async function nextCheckpointSequence(root2, featureId) {
  const directory = path17.join(featureDirectory3(root2, featureId), "checkpoints", "manifests");
  let entries;
  try {
    entries = await readdir5(directory);
  } catch {
    return 1;
  }
  let max = 0;
  for (const entry of entries) {
    const match = /^CP-(\d+)\.json$/.exec(entry);
    if (match) max = Math.max(max, Number.parseInt(match[1], 10));
  }
  return max + 1;
}
async function checkpointImplementationUnit(root2, id, expectedRevision, unitId, options = {}) {
  const initial = await readState(root2, id);
  await assertHostHealth(root2, initial.lastUpdatedBy.host, "checkpoint");
  if (initial.revision !== expectedRevision) {
    throw new DevFlowError("STATE_REVISION_CONFLICT", "state revision changed", { currentRevision: initial.revision });
  }
  const invalidated = await invalidateAffectedClaims(root2, id, expectedRevision);
  if (invalidated) throw workspaceChangedError(invalidated);
  if (!checkpointsEnforcementRequired(initial.route, initial.classification.controls) && initial.classification.controls.plan !== "formal") {
    throw new DevFlowError("IMPLEMENTATION_UNITS_NOT_ENFORCED", "\u5F53\u524D\u52A8\u6001\u8DEF\u7EBF\u672A\u542F\u7528 unit-chain checkpoint \u63A7\u5236\u3002");
  }
  if (currentOpenStep(initial) !== "implementation") {
    throw new DevFlowError("STEP_OUT_OF_ORDER", "checkpoint requires the implementation step", { expected: currentOpenStep(initial) });
  }
  await assertWorkspaceOwnershipComplete(root2, initial, await readProjectConfig(root2), "checkpoint");
  const unit = (initial.implementationUnits ?? []).find((candidate) => candidate.unitId === unitId);
  if (!unit) throw new DevFlowError("IMPLEMENTATION_UNIT_UNKNOWN", "implementation unit has no runtime state", { unitId });
  if (unit.status !== "active") {
    throw new DevFlowError("IMPLEMENTATION_UNIT_NOT_ACTIVE", "checkpoint requires an active implementation unit", { unitId, status: unit.status });
  }
  const traceEnforced = traceEnforcementRequired(initial.route, initial.classification.controls);
  let commands = [];
  let config = await readProjectConfig(root2);
  let currentCommandHashes = {};
  if (traceEnforced) {
    const ledger = await readTraceability(root2, initial);
    const node = currentImplementationNode(
      initial,
      Object.values(ledger.nodes).filter((candidate) => candidate.kind === "implementation-unit" && candidate.status === "current"),
      unitId
    );
    const { config: configSnapshot, sha256: projectConfigSha2562 } = await readProjectConfigSnapshot(root2);
    config = configSnapshot;
    const verificationRefs = [...node.forwardVerification];
    currentCommandHashes = verificationCommandHashesForRefs(config, verificationRefs);
    const traceCommandHashes = ledger.verificationCommandHashes;
    const commandSliceStale = traceCommandHashes ? verificationCommandIdsForRefs(verificationRefs).some((id2) => traceCommandHashes[id2] !== currentCommandHashes[id2]) : node.verificationConfigSha256 !== projectConfigSha2562;
    if (commandSliceStale) {
      throw new DevFlowError("TRACE_SLICE_STALE", "rollback verification configuration is stale", {
        unitId,
        recoveryHint: "\u9A8C\u8BC1\u547D\u4EE4\u5B9A\u4E49\u5DF2\u53D8\u66F4\uFF1A\u5148\u7528 dev_flow_abandon_implementation_unit \u53D6\u6D88\u5F53\u524D\u5355\u5143\uFF0C\u518D\u91CD\u767B\u8BB0\u8BA1\u5212\u5237\u65B0 Trace \u57FA\u7EBF\uFF0C\u7136\u540E\u91CD\u65B0\u5F00\u59CB\u8BE5\u5355\u5143\u3002"
      });
    }
    commands = resolveVerificationCommands(config, node);
  }
  const preflightCommands = resolvePreflightCommands(config);
  const projectConfigSha256 = (await readProjectConfigSnapshot(root2)).sha256;
  const baseline = await readCheckpointBaseline(root2, id, unitId);
  const after = await snapshotGovernedRoots(root2, config);
  const records = diffSnapshots(baseline.files, after);
  const sequence = await nextCheckpointSequence(root2, id);
  const checkpointId = `CP-${String(sequence).padStart(3, "0")}`;
  const implementationUnitId = unit.unitId;
  const featureDir = featureDirectory3(root2, id);
  const manifestsDir = path17.join(featureDir, "checkpoints", "manifests");
  let orphan;
  let entries;
  try {
    entries = await readdir5(manifestsDir);
  } catch (error) {
    if (error.code === "ENOENT") entries = [];
    else throw error;
  }
  for (const entry of entries.sort().reverse()) {
    if (!/^CP-\d+\.json$/.test(entry)) continue;
    let candidate;
    try {
      candidate = parseCheckpointManifest(JSON.parse(await readFile13(path17.join(manifestsDir, entry), "utf8")));
    } catch (error) {
      throw new DevFlowError("ROLLBACK_CHECKPOINT_CORRUPT", "checkpoint manifest is unreadable or invalid", {
        checkpointFile: entry,
        unitId: implementationUnitId,
        cause: error instanceof Error ? error.message : String(error),
        recoveryHint: "Do not hand-edit checkpoint manifests; repair or remove the corrupt file before retrying the checkpoint"
      });
    }
    if (candidate.unitId === implementationUnitId && candidate.beginNonce === unit.beginNonce) {
      orphan = candidate;
      break;
    }
  }
  if (orphan) {
    const sameCheckpoint = orphan.basisHash === unit.basisHash && (orphan.verificationCommandHashes ? Object.keys(orphan.verificationCommandHashes).every((id2) => orphan.verificationCommandHashes?.[id2] === currentCommandHashes[id2]) : orphan.projectConfigSha256 === projectConfigSha256) && JSON.stringify(orphan.files) === JSON.stringify(records);
    if (!sameCheckpoint) {
      throw new DevFlowError("CHECKPOINT_CONFLICT", "an existing checkpoint manifest no longer matches this unit", {
        checkpointId: orphan.checkpointId,
        unitId: implementationUnitId
      });
    }
    const reused = await mutate(root2, id, expectedRevision, "implementation-unit-checkpointed", (draft) => {
      const current = (draft.implementationUnits ?? []).find((candidate) => candidate.unitId === unitId);
      if (!current || current.status !== "active") {
        throw new DevFlowError("IMPLEMENTATION_UNIT_NOT_ACTIVE", "checkpoint requires an active implementation unit", { unitId, status: current?.status });
      }
      current.status = "checkpointed";
      current.checkpointId = orphan.checkpointId;
    }, { unitId, checkpointId: orphan.checkpointId, sequence: orphan.sequence });
    return { state: reused, manifest: orphan };
  }
  const manifestFile = path17.join(featureDir, manifestPath(checkpointId));
  const attempts = [];
  for (const { command: command2, phase } of [
    ...preflightCommands.map((command3) => ({ command: command3, phase: "preflight" })),
    ...commands.map((command3) => ({ command: command3, phase: "forward" }))
  ]) {
    const startedAt = (/* @__PURE__ */ new Date()).toISOString();
    const result = await runVerificationCommand(root2, command2);
    const attempt = {
      attemptId: randomUUID8(),
      commandId: command2.id,
      command: commandSummary(command2),
      status: result.exitCode === 0 ? "passed" : "failed",
      startedAt,
      completedAt: (/* @__PURE__ */ new Date()).toISOString(),
      phase,
      cwd: command2.cwd,
      outputTail: result.output.slice(-4e3)
    };
    attempts.push(attempt);
    if (result.exitCode !== 0) {
      throw new DevFlowError(phase === "preflight" ? "CHECKPOINT_PREFLIGHT_FAILED" : "CHECKPOINT_VERIFICATION_FAILED", phase === "preflight" ? "preflight verification failed; the unit stays active and no checkpoint is recorded" : "forward verification failed; the unit stays active and no checkpoint is recorded", {
        unitId,
        attemptId: attempt.attemptId,
        phase,
        commandId: attempt.commandId,
        command: attempt.command,
        cwd: command2.cwd,
        exitCode: result.exitCode,
        outputTail: result.output.slice(-4e3),
        recoveryHint: phase === "preflight" ? "\u4FEE\u590D\u914D\u7F6E\u7684\u73AF\u5883\u524D\u7F6E\u547D\u4EE4\u540E\u91CD\u8BD5\uFF1B\u5355\u5143\u4FDD\u6301 active \u4E14\u4E0D\u4F1A\u521B\u5EFA checkpoint" : "\u524D\u5411\u9A8C\u8BC1\u5931\u8D25\u65F6\u5355\u5143\u4FDD\u6301 active \u4E14\u4E0D\u8BB0 checkpoint\uFF1A\u82E5\u5931\u8D25\u6E90\u4E8E\u6D4B\u8BD5\u5148\u884C\uFF08\u9A8C\u8BC1\u4F9D\u8D56\u5C1A\u672A\u843D\u5730\u7684\u5355\u5143\uFF09\uFF0C\u8BF7\u628A\u6D4B\u8BD5\u4E0E\u4FEE\u590D\u5408\u5E76\u4E3A\u540C\u4E00\u56DE\u64A4\u5355\u5143\uFF08\u539F\u5B50\u5355\u5143\uFF09\u4E00\u5E76\u56DE\u6EDA\uFF1Bcheckpoint \u524D\u6E05\u7406 scratch/ \u4E2D\u7684\u6B8B\u7559\u7EA2\u6D4B\u8BD5"
      });
    }
  }
  const afterVerification = await snapshotGovernedRoots(root2, config);
  if (!snapshotsEqual(after, afterVerification)) {
    throw new DevFlowError("CHECKPOINT_HASH_MISMATCH", "\u8FD0\u884C\u9A8C\u8BC1\u65F6 governed \u6587\u4EF6\u53D1\u751F\u53D8\u5316\u3002", { unitId });
  }
  const completedFingerprint = await fingerprintGovernedRoots(root2, config);
  for (const record of records) {
    if (record.change === "deleted" || record.change === "renamed") continue;
    const bytes = record.afterKind === "symlink" ? Buffer.from(await readlink3(path17.join(root2, record.path))) : await readFile13(path17.join(root2, record.path));
    if (digest8(bytes) !== record.afterSha256) {
      throw new DevFlowError("CHECKPOINT_HASH_MISMATCH", "\u6355\u83B7 checkpoint blob \u65F6 governed \u6587\u4EF6\u53D1\u751F\u53D8\u5316\u3002", { path: record.path });
    }
    await writeBlobIfAbsent(root2, id, bytes);
  }
  const forwardPatch = canonicalReviewValueJson({ direction: "forward", checkpointId, unitId: implementationUnitId, files: records });
  const reversePatch = canonicalReviewValueJson({ direction: "reverse", checkpointId, unitId: implementationUnitId, files: reverseRecords(records) });
  const manifest = {
    schemaVersion: 2,
    checkpointId,
    unitId: implementationUnitId,
    sequence,
    basisHash: unit.basisHash,
    startedFingerprint: unit.startedFingerprint,
    completedFingerprint,
    startedAt: attempts[0]?.startedAt ?? (/* @__PURE__ */ new Date()).toISOString(),
    completedAt: (/* @__PURE__ */ new Date()).toISOString(),
    files: records,
    forwardPatchSha256: digest8(forwardPatch),
    reversePatchSha256: digest8(reversePatch),
    verificationAttempts: attempts,
    requirementsSha256: initial.artifacts.requirements?.sha256 ?? "",
    planSha256: initial.artifacts["implementation-plan"]?.sha256 ?? "",
    traceabilitySha256: initial.traceability?.sha256 ?? "",
    approvalBasisHash: unit.basisHash,
    projectConfigSha256,
    ...unit.beginNonce ? { beginNonce: unit.beginNonce } : {},
    verificationCommands: [...preflightCommands, ...commands].map((command2) => ({ commandId: command2.id, command: commandSummary(command2) })),
    verificationCommandHashes: Object.fromEntries([...preflightCommands, ...commands].map((command2) => [command2.id, currentCommandHashes[command2.id] ?? digest8(JSON.stringify(command2))]))
  };
  const validated = parseCheckpointManifest(JSON.parse(JSON.stringify(manifest)));
  await mkdir8(path17.join(featureDir, "checkpoints", "patches"), { recursive: true });
  await mkdir8(path17.dirname(manifestFile), { recursive: true });
  await writeAtomic(path17.join(featureDir, "checkpoints", "patches", `${manifest.forwardPatchSha256}.json`), forwardPatch);
  await writeAtomic(path17.join(featureDir, "checkpoints", "patches", `${manifest.reversePatchSha256}.json`), reversePatch);
  const manifestContents = `${JSON.stringify(validated, null, 2)}
`;
  const temp = `${manifestFile}.${randomUUID8()}.tmp`;
  const handle = await open5(temp, "w");
  try {
    await handle.writeFile(manifestContents);
    await handle.sync();
  } finally {
    await handle.close();
  }
  await options.fault?.("before-manifest-rename");
  await rename4(temp, manifestFile);
  const manifestDir = await open5(path17.dirname(manifestFile), "r");
  try {
    await manifestDir.sync();
  } finally {
    await manifestDir.close();
  }
  await options.fault?.("after-manifest-rename");
  const state = await mutate(root2, id, expectedRevision, "implementation-unit-checkpointed", (draft) => {
    const current = (draft.implementationUnits ?? []).find((candidate) => candidate.unitId === unitId);
    if (!current || current.status !== "active") {
      throw new DevFlowError("IMPLEMENTATION_UNIT_NOT_ACTIVE", "checkpoint requires an active implementation unit", { unitId, status: current?.status });
    }
    current.status = "checkpointed";
    current.checkpointId = checkpointId;
  }, { unitId, checkpointId, sequence });
  return { state, manifest: validated };
}
async function readCheckpoint(root2, featureId, checkpointId) {
  return readCheckpointManifest(root2, featureId, checkpointId);
}
async function checkpointChain(root2, featureId, state) {
  const ids = (state.implementationUnits ?? []).filter((unit) => unit.checkpointId && (unit.status === "checkpointed" || unit.status === "rolled_back")).map((unit) => unit.checkpointId);
  const manifests = [];
  for (const checkpointId of ids) manifests.push(await readCheckpoint(root2, featureId, checkpointId));
  return manifests.sort((a, b) => a.sequence - b.sequence);
}

// plugins/dev-flow/src/core/implementation-units.ts
import { createHash as createHash26, randomUUID as randomUUID10 } from "node:crypto";

// plugins/dev-flow/src/core/review-jobs.ts
import { createHash as createHash25, randomUUID as randomUUID9 } from "node:crypto";
var digest9 = (value) => createHash25("sha256").update(value).digest("hex");
var leaseMilliseconds = 60 * 60 * 1e3;
var samplingLeaseMilliseconds = 120 * 1e3;
var basisArtifactKinds = ["requirements", "implementation-plan", "coverage-matrix", "rollback-units"];
function nonBehaviorDispositions(trace2) {
  const nodes = Object.values(trace2?.nodes ?? {}).filter((node) => node.status !== "tombstoned");
  const coveredBy = /* @__PURE__ */ new Map();
  for (const node of nodes) {
    if (node.kind !== "task") continue;
    for (const covered of node.covers) {
      if (!covered.startsWith("AC-")) continue;
      const list = coveredBy.get(covered) ?? [];
      list.push({ taskId: node.id, ...node.tdd ? { tdd: node.tdd } : {} });
      coveredBy.set(covered, list);
    }
  }
  return nodes.filter((node) => node.kind === "acceptance-criterion" && node.verificationDisposition !== void 0 && node.verificationDisposition.kind !== "behavior-test").map((node) => ({
    criterionId: node.id,
    dispositionKind: node.verificationDisposition.kind,
    ...node.verificationDisposition.reason ? { reason: node.verificationDisposition.reason } : {},
    ...node.verificationDisposition.target ? { target: node.verificationDisposition.target } : {},
    coveredBy: (coveredBy.get(node.id) ?? []).sort((left, right) => left.taskId.localeCompare(right.taskId))
  })).sort((left, right) => left.criterionId.localeCompare(right.criterionId));
}
function invalid5(code, message, details = {}) {
  throw new DevFlowError(code, message, details);
}
function currentBatch2(ledger, batchId) {
  const batch = ledger.batches.find((candidate) => candidate.batchId === batchId);
  if (!batch) invalid5("REVIEW_BATCH_NOT_FOUND", "review batch does not exist", { batchId });
  if (batch.validity !== "current") invalid5("REVIEW_BATCH_STALE", "review batch is stale", { batchId });
  return batch;
}
function satisfyCompletedReviewObligation(obligations, batch) {
  return batch.progress === "complete" ? satisfyObligations(obligations, ["review"]) : obligations;
}
function cloneLedger(ledger, stateRevision, batches, appendedFindingEvents = []) {
  return {
    ...ledger,
    revision: ledger.revision + 1,
    stateRevision,
    batches,
    summary: reviewSummary(batches),
    findingEvents: [...ledger.findingEvents ?? [], ...appendedFindingEvents]
  };
}
function reviewArtifactKinds(state) {
  return basisArtifactKinds.filter((kind) => Boolean(state.artifacts[kind]));
}
async function deriveReviewInput(root2, state) {
  const trace2 = state.traceability ? await readTraceability(root2, state) : void 0;
  const { config, sha256: projectConfigSha256 } = await readProjectConfigSnapshot(root2);
  const frozenArtifacts = await Promise.all(reviewArtifactKinds(state).map(async (kind) => {
    const artifact = state.artifacts[kind];
    if (!artifact) invalid5("REVIEW_BASIS_ARTIFACT_MISSING", `review basis artifact is missing: ${kind}`, { kind });
    let contents;
    try {
      contents = await assertArtifactCurrent(root2, state.featureId, state, kind);
    } catch (error) {
      if (error instanceof DevFlowError && error.code === "ARTIFACT_INTEGRITY_FAILED") throw error;
      invalid5("REVIEW_BASIS_ARTIFACT_MISSING", `review basis artifact cannot be read: ${kind}`, { kind });
    }
    if (digest9(contents) !== artifact.sha256) {
      invalid5("ARTIFACT_INTEGRITY_FAILED", `review basis artifact was edited without registration: ${kind}`, {
        kind,
        recoveryHint: `Re-register the edited ${kind} artifact with the latest feature revision known before the edit.`
      });
    }
    return { kind, path: artifact.path, sha256: artifact.sha256, contents };
  }));
  const projectContents = (await readProjectConfigSnapshot(root2)).contents;
  if (digest9(projectContents) !== projectConfigSha256) {
    invalid5("REVIEW_BASIS_UNAVAILABLE", "project configuration changed while review basis was being captured");
  }
  const scopeManifest = {
    inScope: [...state.scope.inScope].sort(),
    outOfScope: [...state.scope.outOfScope].sort(),
    governedRoots: [...config.governedRoots].sort(),
    rollbackFileScopes: Object.values(trace2?.nodes ?? {}).reduce((scopes, node) => {
      if ((node.kind === "implementation-unit" || node.kind === "rollback") && node.status === "current") {
        scopes.push({ id: node.id, fileScope: [...node.fileScope].sort() });
      }
      return scopes;
    }, []).sort((left, right) => left.id.localeCompare(right.id))
  };
  const governedRootsFingerprint = await fingerprintGovernedRoots(root2, config);
  const basis = {
    featureId: state.featureId,
    route: state.route,
    workflowCapabilities: { ...state.workflowCapabilities ?? { trace: 0, review: 0, checkpoints: 0, rollbackExecution: 0 } },
    classification: {
      level: state.classification.level,
      topology: state.classification.topology,
      ...state.classification.requirements ? { requirements: state.classification.requirements } : {},
      riskLabels: [...state.classification.riskLabels].sort()
    },
    artifacts: frozenArtifacts.map(({ kind, path: artifactPath, sha256 }) => ({ kind, path: artifactPath, sha256 })),
    ...state.traceability && trace2 ? { traceability: { path: state.traceability.path, sha256: state.traceability.sha256, revision: trace2.revision } } : {},
    projectConfigSha256,
    verificationCommandHashes: verificationCommandHashes(config),
    scopeManifestSha256: digest9(canonicalReviewValueJson(scopeManifest)),
    governedRootsFingerprint
  };
  const roles = [.../* @__PURE__ */ new Set([
    ...state.classification.controls.reviewRoles,
    ...state.classification.controls.codeReview !== "none" ? ["code-quality", "requirement-fidelity"] : []
  ])];
  const roleBasisHashes = Object.fromEntries(
    roles.map((role) => [role, roleBasisHash(basis, frozenArtifacts, trace2, role)])
  );
  return {
    basis,
    roleBasisHashes,
    frozenArtifacts,
    projectConfig: { sha256: projectConfigSha256, contents: projectContents },
    scopeManifest: {
      governedRoots: scopeManifest.governedRoots,
      rollbackFileScopes: scopeManifest.rollbackFileScopes.flatMap((item) => item.fileScope),
      traceIds: Object.values(trace2?.nodes ?? {}).filter((node) => node.status === "current").map((node) => node.id).sort(),
      frozenArtifactPaths: frozenArtifacts.map((artifact) => artifact.path).sort()
    },
    nonBehaviorDispositions: nonBehaviorDispositions(trace2)
  };
}
function basisHash(basis) {
  return semanticReviewBasisHash(basis);
}
function roleBasisHash(basis, frozenArtifacts, trace2, role) {
  const artifacts2 = frozenArtifacts.filter((artifact) => {
    if (role === "code-quality" || role === "requirement-fidelity") return true;
    if (role === "requirements-coverage") return artifact.kind === "requirements" || artifact.kind === "implementation-plan";
    if (role === "architecture-testability") return artifact.kind === "implementation-plan";
    if (role === "rollback-operability") return artifact.kind === "implementation-plan" || artifact.kind === "rollback-units";
    return artifact.kind === "requirements" || artifact.kind === "implementation-plan";
  }).map(({ kind, path: artifactPath, sha256 }) => ({ kind, path: artifactPath, sha256 }));
  const traceKinds = role === "requirements-coverage" || role === "requirement-fidelity" ? ["requirement", "acceptance-criterion", "task", "test", "implementation-unit"] : role === "architecture-testability" ? ["task", "test", "implementation-unit"] : role === "rollback-operability" ? ["task", "implementation-unit", "recovery", "rollback"] : ["requirement", "acceptance-criterion", "task", "test", "implementation-unit", "recovery", "rollback"];
  const traceSlice = Object.values(trace2?.nodes ?? {}).filter((node) => node.status !== "tombstoned" && traceKinds.includes(node.kind)).sort((left, right) => left.id.localeCompare(right.id)).map(({ sourceArtifact: _sourceArtifact, sourceSha256: _sourceSha256, sourceAnchor: _sourceAnchor, sourceBlockSha256: _sourceBlockSha256, status: _status, ...semantic }) => semantic);
  const specialtyRisk = {
    security: ["security"],
    "data-irreversibility": ["data", "irreversible_consequence"],
    "money-safety": ["money"],
    "contract-failure": ["external"],
    "recovery-observability": ["availability"],
    "critical-correctness": ["critical_correctness"]
  };
  if (specialtyRisk[role]) {
    return digest9(canonicalReviewValueJson({
      role,
      route: basis.route,
      level: basis.classification.level,
      riskLabels: basis.classification.riskLabels.filter((label) => specialtyRisk[role].includes(label)),
      // Specialty roles follow structured execution semantics. Whole-document
      // hashes would turn unrelated wording edits into a full risk re-review.
      traceSlice
    }));
  }
  const referencedCommandIds = traceSlice.flatMap((node) => {
    if (node.kind === "implementation-unit") return node.forwardVerification;
    if (node.kind === "rollback") return [...node.forwardVerification, ...node.rollbackVerification];
    return [];
  }).filter((reference) => typeof reference === "string");
  const referencedCommandHashes = Object.fromEntries([...new Set(referencedCommandIds)].sort().filter((id) => basis.verificationCommandHashes?.[id] !== void 0).map((id) => [id, basis.verificationCommandHashes[id]]));
  return digest9(canonicalReviewValueJson({
    role,
    route: basis.route,
    level: basis.classification.level,
    artifacts: artifacts2,
    traceSlice,
    // requirements-coverage 显式绑定非行为处置豁免清单：豁免变化必须使该角色
    // basis 失效（traceSlice 已覆盖，这里把语义绑定写明，防止切片收窄后脱钩）。
    ...role === "requirements-coverage" ? { nonBehaviorDispositions: nonBehaviorDispositions(trace2) } : {},
    ...role === "architecture-testability" || role === "rollback-operability" ? { verificationCommandHashes: referencedCommandHashes } : {}
  }));
}
function requireClaimRequestId(value) {
  if (typeof value !== "string" || value.length < 24 || !/[A-Za-z]/.test(value) || !/[0-9]/.test(value)) {
    invalid5("REVIEW_CLAIM_REQUEST_INVALID", "claimRequestId must be an unguessable high-entropy value");
  }
}
function findJob(batch, jobId) {
  const job = batch.jobs.find((candidate) => candidate.jobId === jobId);
  if (!job) invalid5("REVIEW_JOB_NOT_FOUND", "review job does not exist", { batchId: batch.batchId, jobId });
  return job;
}
function visibleJob(job) {
  return toPublicReviewJob(job);
}
function recoverExpiredLease(job, now) {
  if (job.status === "claimed" && job.claim && Date.parse(job.claim.leaseExpiresAt) <= now.getTime()) {
    return { ...job, status: "pending", claim: void 0 };
  }
  return job;
}
function activeSamplingAttempt(job) {
  return job.samplingAttempts?.find((attempt) => attempt.status === "issued");
}
function recoverExpiredSampling(job, now) {
  const active = activeSamplingAttempt(job);
  if (job.status !== "sampling" || !active || Date.parse(active.leaseExpiresAt) > now.getTime()) return job;
  return {
    ...job,
    status: "pending",
    samplingAttempts: job.samplingAttempts.map((attempt) => attempt.requestSha256 !== active.requestSha256 ? attempt : {
      ...attempt,
      status: "failed",
      completedAt: now.toISOString(),
      failureCode: "timeout"
    })
  };
}
function withDerivedAssurance(batch, verifier = defaultReviewIdentityVerifier) {
  return { ...batch, assuranceLevel: assuranceForReviewBatch(batch, verifier) };
}
function normalizeHostAttestation(value, now) {
  const parsed = parseHostAttestation(value);
  return {
    ...parsed,
    rawSha256: digest9(parsed.raw),
    acceptedAt: now.toISOString()
  };
}
function assertAttestationUnique(ledger, batchId, jobId, attestation) {
  for (const batch of ledger.batches) {
    for (const job of batch.jobs) {
      if (batch.batchId === batchId && job.jobId === jobId) continue;
      if (job.status !== "submitted" || !job.submission?.attestation) continue;
      if (job.submission.attestation.rawSha256 === attestation.rawSha256) {
        invalid5("REVIEW_ATTESTATION_REUSED", "the same host attestation cannot be reused across review jobs or successor batches", {
          jobId,
          priorJobId: job.jobId,
          priorBatchId: batch.batchId
        });
      }
    }
  }
}
function safePackagePath(value) {
  const normalized = normalizeUnicode(value);
  return normalized.length > 0 && normalized === normalized.trim() && !isAbsoluteProjectPath(normalized) && !normalized.includes("\\") && isCanonicalProjectPath(normalized) && !normalized.split("/").includes("..");
}
function validScopeManifest(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const manifest = value;
  return Array.isArray(manifest.governedRoots) && Array.isArray(manifest.rollbackFileScopes) && manifest.governedRoots.every((entry) => typeof entry === "string" && safePackagePath(entry)) && manifest.rollbackFileScopes.every((entry) => typeof entry === "string" && safePackagePath(entry)) && Array.isArray(manifest.traceIds) && manifest.traceIds.every((entry) => typeof entry === "string" && /^(?:REQ|AC|TASK|TEST|UNIT|RU)-[0-9]{3,}$/.test(entry)) && Array.isArray(manifest.frozenArtifactPaths) && manifest.frozenArtifactPaths.every((entry) => typeof entry === "string" && safePackagePath(entry));
}
async function readBoundReviewPackage(root2, featureId, batch, job) {
  const reviewPackage = await readReviewPackage(root2, featureId, job.packageSha256);
  if (typeof reviewPackage !== "object" || reviewPackage === null || Array.isArray(reviewPackage)) {
    invalid5("REVIEW_INTEGRITY_FAILED", "review package does not belong to its job", { batchId: batch.batchId, jobId: job.jobId });
  }
  const packageRecord = reviewPackage;
  if (packageRecord.featureId !== featureId || packageRecord.batchId !== batch.batchId || packageRecord.jobId !== job.jobId || packageRecord.basisHash !== batch.basisHash) {
    invalid5("REVIEW_INTEGRITY_FAILED", "review package does not belong to its job", { batchId: batch.batchId, jobId: job.jobId });
  }
  return packageRecord;
}
function assertFindingScope(manifest, findings, resolutions) {
  const allowed = [.../* @__PURE__ */ new Set([...manifest.governedRoots, ...manifest.rollbackFileScopes])];
  const inManifest = (value) => {
    const normalized = normalizeUnicode(value);
    return safePackagePath(normalized) && allowed.some((scope) => pathWithinFileScope(normalized, [scope]));
  };
  const validTarget = (value) => inManifest(value) || manifest.traceIds.includes(value);
  const validEvidence = (value) => inManifest(value) || manifest.frozenArtifactPaths.includes(value);
  const invalidPaths = [];
  for (const finding of findings) {
    if (finding.severity === "blocking" && !finding.evidence.length) invalid5("REVIEW_FINDING_EVIDENCE_REQUIRED", "blocking finding requires evidence");
    invalidPaths.push(...finding.targets.filter((target) => !validTarget(target)));
    invalidPaths.push(...finding.evidence.map((evidence) => evidence.path).filter((path25) => !validEvidence(path25)));
  }
  invalidPaths.push(...resolutions.flatMap((resolution) => resolution.evidence.map((evidence) => evidence.path).filter((path25) => !validEvidence(path25))));
  if (invalidPaths.length) {
    invalid5("REVIEW_FINDING_SCOPE_INVALID", "finding targets and evidence must be package-relative paths inside the scope manifest", {
      invalidPaths: [...new Set(invalidPaths)].sort(),
      allowedScopes: allowed.sort()
    });
  }
}
var severityRank = { note: 0, warning: 1, blocking: 2 };
function dedupeFindings(findings) {
  const byIdentity = /* @__PURE__ */ new Map();
  for (const finding of findings) {
    const identity = canonicalReviewValueJson({
      category: finding.category,
      targets: [...finding.targets].sort(),
      evidence: [...finding.evidence].sort((left, right) => `${left.path}:${left.line ?? 0}`.localeCompare(`${right.path}:${right.line ?? 0}`)),
      claim: finding.claim,
      recommendation: finding.recommendation
    });
    const existing = byIdentity.get(identity);
    if (!existing || severityRank[finding.severity] > severityRank[existing.severity]) {
      byIdentity.set(identity, { ...finding, targets: [...finding.targets], evidence: finding.evidence.map((evidence) => ({ ...evidence })) });
    }
  }
  return [...byIdentity.values()];
}
async function createReviewBatch(root2, id, expectedRevision) {
  let result;
  const state = await mutatePrepared(root2, id, expectedRevision, "review-batch-created", async (current, nextStateRevision) => {
    if (current.lifecycle !== "active") invalid5("INVALID_LIFECYCLE", "only active features can create review batches");
    const ledger = await readReviewLedger(root2, current);
    const reviewInput = await deriveReviewInput(root2, current);
    const { basis } = reviewInput;
    const currentBasisHash = basisHash(basis);
    const phase = currentOpenStep(current) === "code_review" ? "code" : "plan";
    const requirements = deriveReviewJobRequirements(current.route, current.classification.riskLabels, current.classification.controls.reviewRoles, phase);
    const existing = ledger.batches.find((batch2) => batch2.validity === "current" && (batch2.phase ?? "plan") === phase && batch2.basisHash === currentBasisHash);
    const existingRolesCurrent = existing && requirements.every((requirement) => {
      const job = existing.jobs.find((candidate) => candidate.role === requirement.role);
      return job?.roleBasisHash === reviewInput.roleBasisHashes[requirement.role];
    });
    if (existing && existingRolesCurrent) {
      result = { state: void 0, batch: existing, created: false };
      return { mutate: () => void 0, unchanged: true, eventData: { batchId: existing.batchId, basisHash: currentBasisHash, idempotent: true } };
    }
    if (!requirements.length) invalid5("REVIEW_ROUTE_UNSUPPORTED", "\u5F53\u524D\u52A8\u6001\u8DEF\u7EBF\u6CA1\u6709\u542F\u7528\u72EC\u7ACB plan-review \u89D2\u8272\u3002");
    const prevCurrent = ledger.batches.find((batch2) => batch2.validity === "current");
    const reusableByRole = /* @__PURE__ */ new Map();
    for (const requirement of requirements) {
      const currentRoleBasisHash = reviewInput.roleBasisHashes[requirement.role];
      const reusable = [...ledger.batches].reverse().flatMap((candidate) => candidate.jobs.map((job) => ({ batch: candidate, job }))).find(({ job }) => job.role === requirement.role && job.roleBasisHash === currentRoleBasisHash && job.status === "submitted" && job.submission);
      if (reusable?.job.submission) reusableByRole.set(requirement.role, reusable);
    }
    const unknownDiff = prevCurrent !== void 0 && reusableByRole.size === requirements.length && prevCurrent.basisHash !== currentBasisHash;
    const batchId = randomUUID9();
    const jobs = [];
    for (const requirement of requirements) {
      const jobId = randomUUID9();
      const currentRoleBasisHash = reviewInput.roleBasisHashes[requirement.role];
      const reusable = unknownDiff ? void 0 : reusableByRole.get(requirement.role);
      if (reusable?.job.submission) {
        jobs.push({
          jobId,
          role: requirement.role,
          reviewDepth: requirement.reviewDepth,
          packageSha256: reusable.job.packageSha256,
          roleBasisHash: currentRoleBasisHash,
          status: "reused",
          reusedFrom: { batchId: reusable.batch.batchId, jobId: reusable.job.jobId, submissionSha256: reusable.job.submission.payloadSha256 }
        });
        continue;
      }
      const carried = carriedFindings(ledger, requirement.role, currentRoleBasisHash);
      const packageSha256 = await writeReviewPackage(root2, current.featureId, {
        schemaVersion: 2,
        featureId: current.featureId,
        batchId,
        jobId,
        basis,
        basisHash: currentBasisHash,
        frozenArtifacts: reviewInput.frozenArtifacts,
        projectConfig: reviewInput.projectConfig,
        scopeManifest: reviewInput.scopeManifest,
        role: requirement.role,
        reviewDepth: requirement.reviewDepth,
        // requirements-coverage 的审查包显式列出非行为处置豁免清单（含覆盖任务的
        // tdd 自报），让「行为变化却豁免行为测试」成为可定位的显式 finding 对象。
        ...requirement.role === "requirements-coverage" ? { nonBehaviorDispositions: reviewInput.nonBehaviorDispositions } : {},
        carriedFindings: carried.map((item) => ({
          findingId: item.finding.findingId,
          originBatchId: item.originBatchId,
          originRole: requirement.role,
          basisHash: item.basisHash,
          claim: item.finding.claim,
          evidence: item.finding.evidence
        }))
      });
      jobs.push({
        jobId,
        role: requirement.role,
        reviewDepth: requirement.reviewDepth,
        packageSha256,
        roleBasisHash: currentRoleBasisHash,
        status: "pending",
        ...carried.length ? { carriedFindings: carried.map((item) => ({
          findingId: item.finding.findingId,
          originBatchId: item.originBatchId,
          originRole: requirement.role,
          basisHash: item.basisHash,
          claim: item.finding.claim,
          evidence: item.finding.evidence
        })) } : {}
      });
    }
    const batch = {
      batchId,
      phase,
      basis,
      basisHash: currentBasisHash,
      validity: "current",
      progress: jobs.every((job) => job.status === "reused") ? "complete" : "open",
      executionMode: "parallel-safe",
      assuranceLevel: assuranceForReview2a(),
      jobs,
      // 未知 diff 诊断（issue 16）：basis 变化字段、未命中切片原因与全量重审决定。
      ...unknownDiff ? {
        unknownDiffInfo: {
          changedFields: Object.keys(basis).filter((key) => JSON.stringify(prevCurrent.basis[key]) !== JSON.stringify(basis[key])),
          reason: "basis \u53D8\u5316\u672A\u843D\u5165\u4EFB\u4F55\u89D2\u8272\u8BED\u4E49\u5207\u7247\uFF0C\u4FDD\u5B88\u6267\u884C\u5B8C\u6574\u91CD\u5BA1\u800C\u4E0D\u662F\u9759\u9ED8\u590D\u7528\u3002"
        }
      } : {}
    };
    const batches = [
      ...ledger.batches.map((candidate) => candidate.validity === "current" ? { ...candidate, validity: "stale" } : candidate),
      batch
    ];
    const pointer = await writeReviewSnapshot(root2, cloneLedger(ledger, nextStateRevision, batches));
    result = { state: void 0, batch, created: true };
    return {
      mutate: (draft) => {
        draft.review = pointer;
      },
      eventData: {
        batchId,
        basisHash: currentBasisHash,
        roles: jobs.map((job) => job.role),
        ...batch.unknownDiffInfo ? { unknownDiff: batch.unknownDiffInfo } : {}
      }
    };
  });
  return { ...result, state };
}
async function getReviewJob(root2, id, batchId, jobId, capability) {
  const state = await readState(root2, id);
  const batch = currentBatch2(await readReviewLedger(root2, state), batchId);
  const job = findJob(batch, jobId);
  if (!job.claim || digest9(capability) !== job.claim.requestSha256) invalid5("REVIEW_JOB_CAPABILITY_INVALID", "review job capability is invalid");
  const reviewPackage = await readBoundReviewPackage(root2, id, batch, job);
  return { job: visibleJob(job), package: reviewPackage };
}
async function claimReviewJob(root2, id, expectedRevision, batchId, jobId, claimRequestId, now = /* @__PURE__ */ new Date()) {
  requireClaimRequestId(claimRequestId);
  let result;
  const state = await mutatePrepared(root2, id, expectedRevision, "review-job-claimed", async (current, nextStateRevision) => {
    const ledger = await readReviewLedger(root2, current);
    const batch = currentBatch2(ledger, batchId);
    const requestSha256 = digest9(claimRequestId);
    const original = findJob(batch, jobId);
    const job = recoverExpiredSampling(recoverExpiredLease(original, now), now);
    if (job.status === "submitted" || job.status === "reused") invalid5("REVIEW_JOB_ALREADY_SUBMITTED", "review job is already satisfied", { jobId });
    if (job.status === "sampling") invalid5("REVIEW_JOB_SAMPLING_IN_PROGRESS", "review job is held by server sampling", { jobId });
    if (job.status === "claimed" && job.claim.requestSha256 !== requestSha256) {
      invalid5("REVIEW_JOB_ALREADY_CLAIMED", "review job is claimed by another capability", { jobId });
    }
    const idempotent = job.status === "claimed";
    const claimed = idempotent ? job : {
      ...job,
      status: "claimed",
      claim: { requestSha256, claimedAt: now.toISOString(), leaseExpiresAt: new Date(now.getTime() + leaseMilliseconds).toISOString() }
    };
    result = { batchId, job: visibleJob(claimed), capability: claimRequestId, idempotent };
    if (idempotent) return { mutate: () => void 0, unchanged: true, eventData: { batchId, jobId, idempotent: true } };
    const batches = ledger.batches.map((candidate) => candidate.batchId !== batchId ? candidate : {
      ...candidate,
      jobs: candidate.jobs.map((candidateJob) => candidateJob.jobId === jobId ? claimed : candidateJob)
    });
    const pointer = await writeReviewSnapshot(root2, cloneLedger(ledger, nextStateRevision, batches));
    return { mutate: (draft) => {
      draft.review = pointer;
    }, eventData: { batchId, jobId } };
  });
  return { ...result, state };
}
async function releaseReviewJob(root2, id, expectedRevision, batchId, jobId, capability) {
  let result;
  const state = await mutatePrepared(root2, id, expectedRevision, "review-job-released", async (current, nextStateRevision) => {
    const ledger = await readReviewLedger(root2, current);
    const batch = currentBatch2(ledger, batchId);
    const original = findJob(batch, jobId);
    if (original.status === "submitted") invalid5("REVIEW_JOB_ALREADY_SUBMITTED", "review job has already been submitted", { jobId });
    if (original.status === "sampling") invalid5("REVIEW_JOB_SAMPLING_IN_PROGRESS", "review job is held by server sampling", { jobId });
    if (original.status !== "claimed" || !original.claim) invalid5("REVIEW_JOB_NOT_CLAIMED", "review job is not currently claimed", { jobId });
    if (digest9(capability) !== original.claim.requestSha256) invalid5("REVIEW_JOB_CAPABILITY_INVALID", "review job capability is invalid");
    const released = { ...original, status: "pending", claim: void 0 };
    const updatedBatch = {
      ...batch,
      jobs: batch.jobs.map((candidate) => candidate.jobId === jobId ? released : candidate)
    };
    const pointer = await writeReviewSnapshot(root2, cloneLedger(
      ledger,
      nextStateRevision,
      ledger.batches.map((candidate) => candidate.batchId === batchId ? updatedBatch : candidate)
    ));
    result = { batchId, job: visibleJob(released) };
    return {
      mutate: (draft) => {
        draft.review = pointer;
      },
      eventData: { batchId, jobId }
    };
  });
  return { ...result, state };
}
function normalizeReviewCompletion(parsed) {
  return {
    ...parsed,
    findings: parsed.findings.map((finding) => ({
      ...finding,
      targets: finding.targets.map(normalizeUnicode),
      evidence: finding.evidence.map((evidence) => ({ ...evidence, path: normalizeUnicode(evidence.path) }))
    })),
    ...parsed.resolutions ? {
      resolutions: parsed.resolutions.map((resolution) => ({
        ...resolution,
        evidence: resolution.evidence.map((evidence) => ({ ...evidence, path: normalizeUnicode(evidence.path) }))
      }))
    } : {}
  };
}
async function submitParsedReviewJob(root2, featureId, ledger, batch, job, parsed, now, samplingAttempt, hostAttestation, attestationSourceVerified = false, isolationProof) {
  const normalizedParsed = normalizeReviewCompletion(parsed);
  if (normalizedParsed.findings.some((finding) => finding.category !== job.role)) {
    invalid5("REVIEW_FINDING_ROLE_MISMATCH", "a job may only submit findings for its assigned review role", { jobId: job.jobId, role: job.role });
  }
  if (samplingAttempt && hostAttestation) {
    invalid5("REVIEW_ATTESTATION_INVALID", "server sampling submissions cannot carry host attestation");
  }
  if (hostAttestation) assertAttestationUnique(ledger, batch.batchId, job.jobId, hostAttestation);
  const reviewPackage = await readBoundReviewPackage(root2, featureId, batch, job);
  if (!validScopeManifest(reviewPackage.scopeManifest)) {
    invalid5("REVIEW_INTEGRITY_FAILED", "review package scope manifest is invalid", { jobId: job.jobId });
  }
  const manifest = reviewPackage.scopeManifest;
  assertFindingScope(manifest, normalizedParsed.findings, normalizedParsed.resolutions ?? []);
  const dispositions = { ...batch.dispositions };
  const findingEvents = [];
  const resolvedIds = /* @__PURE__ */ new Set();
  for (const resolution of normalizedParsed.resolutions ?? []) {
    if (resolvedIds.has(resolution.findingId)) invalid5("REVIEW_RESOLUTION_DUPLICATE", "a finding may be resolved only once per successor batch", { findingId: resolution.findingId });
    const source = ledger.batches.filter((candidate) => candidate.batchId !== batch.batchId).flatMap((candidate) => candidate.jobs.map((candidateJob) => ({ batch: candidate, job: candidateJob }))).find(({ job: candidateJob }) => candidateJob.submission?.findings.some((finding2) => finding2.findingId === resolution.findingId));
    const finding = source?.job.submission?.findings.find((candidate) => candidate.findingId === resolution.findingId);
    if (!source || !finding) invalid5("REVIEW_RESOLUTION_UNKNOWN_FINDING", "resolution references an unknown prior finding", { findingId: resolution.findingId });
    if (finding.severity !== "blocking" || source.job.role !== job.role) {
      invalid5("REVIEW_RESOLUTION_ROLE_MISMATCH", "only the same role may resolve a prior blocking finding", { findingId: resolution.findingId });
    }
    if (dispositions[resolution.findingId]) {
      invalid5("REVIEW_RESOLUTION_ALREADY_DISPOSED", "a prior finding already has a disposition", { findingId: resolution.findingId });
    }
    dispositions[resolution.findingId] = {
      kind: "resolved-in-successor",
      successorBatchId: batch.batchId,
      resolutionJobId: job.jobId,
      resolvedAt: now.toISOString()
    };
    const outcome = resolution.outcome ?? "resolved";
    findingEvents.push(outcome === "resolved" ? {
      type: "resolved",
      findingId: resolution.findingId,
      successorBatchId: batch.batchId,
      resolutionJobId: job.jobId,
      basisHash: job.roleBasisHash,
      evidence: resolution,
      at: now.toISOString()
    } : {
      type: "still-blocking",
      findingId: resolution.findingId,
      successorBatchId: batch.batchId,
      resolutionJobId: job.jobId,
      basisHash: job.roleBasisHash,
      reason: resolution.note,
      at: now.toISOString()
    });
    resolvedIds.add(resolution.findingId);
  }
  const payloadSha256 = digest9(canonicalReviewValueJson(normalizedParsed));
  const findings = dedupeFindings(normalizedParsed.findings).map((finding) => ({
    ...finding,
    findingId: `F-${randomUUID9()}`,
    jobId: job.jobId
  }));
  for (const finding of findings) {
    findingEvents.push({ type: "origin", finding, batchId: batch.batchId, role: job.role, basisHash: job.roleBasisHash, at: now.toISOString() });
  }
  const missingCarried = (job.carriedFindings ?? []).filter((finding) => !resolvedIds.has(finding.findingId));
  if (missingCarried.length) {
    invalid5("REVIEW_CARRIED_FINDING_UNRESOLVED", "\u6BCF\u4E2A\u7ED3\u8F6C blocker \u90FD\u5FC5\u987B\u63D0\u4EA4\u660E\u786E\u5904\u7F6E\u7ED3\u679C", {
      findingIds: missingCarried.map((finding) => finding.findingId),
      recoveryHint: "\u4E3A\u6BCF\u4E2A carried finding \u63D0\u4EA4 resolved\u3001still-blocking \u6216 risk-acceptance-required \u7ED3\u679C"
    });
  }
  const completedAt = now.toISOString();
  const samplingAttempts = samplingAttempt ? job.samplingAttempts.map((attempt) => attempt.requestSha256 !== samplingAttempt.requestSha256 ? attempt : {
    ...attempt,
    status: "submitted",
    completedAt,
    payloadSha256
  }) : job.samplingAttempts;
  const submitted = {
    ...job,
    status: "submitted",
    ...samplingAttempt ? { claim: void 0 } : {},
    ...samplingAttempts ? { samplingAttempts } : {},
    submission: {
      payloadSha256,
      coverageSummary: normalizedParsed.coverageSummary,
      findings,
      resolutions: normalizedParsed.resolutions ?? [],
      submittedAt: completedAt,
      ...samplingAttempt ? {
        samplingProvenance: {
          requestSha256: samplingAttempt.requestSha256,
          issuedAt: samplingAttempt.issuedAt,
          completedAt
        }
      } : {},
      ...hostAttestation ? { attestation: hostAttestation } : {},
      ...hostAttestation && attestationSourceVerified ? { attestationSourceVerified: true } : {},
      ...isolationProof ? { isolationProof } : {}
    }
  };
  let updatedBatch = {
    ...batch,
    jobs: batch.jobs.map((candidate) => candidate.jobId === job.jobId ? submitted : candidate),
    ...Object.keys(dispositions).length ? { dispositions } : {}
  };
  if (hostAttestation && updatedBatch.executionMode === "isolated-sequential") {
    updatedBatch = { ...updatedBatch, executionMode: "native-subagent" };
  }
  updatedBatch = {
    ...updatedBatch,
    progress: updatedBatch.jobs.every((candidate) => candidate.status === "submitted" || candidate.status === "reused") ? "complete" : "open"
  };
  return { batch: withDerivedAssurance(updatedBatch), payloadSha256, findingEvents };
}
async function submitReviewJob(root2, id, expectedRevision, batchId, jobId, capability, completion, attestationOrNow, maybeNow) {
  const attestation = attestationOrNow instanceof Date ? void 0 : attestationOrNow;
  const now = attestationOrNow instanceof Date ? attestationOrNow : maybeNow instanceof Date ? maybeNow : /* @__PURE__ */ new Date();
  const parsed = parseReviewJobCompletion(completion);
  const hostAttestation = attestation === void 0 ? void 0 : normalizeHostAttestation(attestation, now);
  let attestationSourceVerified = false;
  let isolationProven = false;
  if (hostAttestation?.hostEventId) {
    const events = await readFeatureEvents(root2, id);
    const execution = events.find((event) => {
      const data = event.data;
      return event.type === "review-execution" && data?.type === "review-execution" && data.eventId === hostAttestation.hostEventId && data.host === hostAttestation.host && data.batchId === batchId && data.jobId === jobId && typeof data.sourceId === "string" && data.sourceId.length > 0 && typeof data.executionId === "string" && data.executionId.length > 0 && typeof data.contextId === "string" && data.contextId.length > 0 && typeof data.implementationContextId === "string" && data.implementationContextId.length > 0;
    });
    attestationSourceVerified = execution !== void 0;
    isolationProven = execution !== void 0 && execution.data !== void 0 && execution.data.contextId !== execution.data.implementationContextId;
  }
  let result;
  const state = await mutatePrepared(root2, id, expectedRevision, "review-job-submitted", async (current, nextStateRevision) => {
    const ledger = await readReviewLedger(root2, current);
    const batch = currentBatch2(ledger, batchId);
    const job = findJob(batch, jobId);
    const payloadSha256 = digest9(canonicalReviewValueJson(parsed));
    if (job.status === "sampling") invalid5("REVIEW_JOB_SAMPLING_IN_PROGRESS", "review job is held by server sampling", { jobId });
    if (!job.claim || digest9(capability) !== job.claim.requestSha256) {
      invalid5("REVIEW_JOB_CAPABILITY_INVALID", "review job capability is invalid");
    }
    if (job.status === "submitted") {
      if (job.submission?.payloadSha256 !== payloadSha256) invalid5("REVIEW_SUBMISSION_CONFLICT", "review job was submitted with a different payload", { jobId });
      if (hostAttestation) {
        const existing = job.submission?.attestation;
        if (!existing || existing.rawSha256 !== hostAttestation.rawSha256 || existing.agentId !== hostAttestation.agentId || existing.host !== hostAttestation.host) {
          invalid5("REVIEW_SUBMISSION_CONFLICT", "review job was submitted with a different host attestation", { jobId });
        }
      } else if (job.submission?.attestation) {
        invalid5("REVIEW_SUBMISSION_CONFLICT", "review job was submitted with a different host attestation", { jobId });
      }
      result = { batch, idempotent: true };
      return { mutate: () => void 0, unchanged: true, eventData: { batchId, jobId, idempotent: true } };
    }
    if (Date.parse(job.claim.leaseExpiresAt) <= now.getTime()) invalid5("REVIEW_JOB_LEASE_EXPIRED", "review job lease has expired", {
      jobId,
      leaseExpiresAt: job.claim.leaseExpiresAt,
      recoveryHint: "\u91CD\u65B0 claim \u5F53\u524D job \u540E\u518D\u63D0\u4EA4\uFF1B\u8FC7\u671F\u79DF\u7EA6\u4E0D\u4F1A\u81EA\u52A8\u4FDD\u7559\u63D0\u4EA4\u6743"
    });
    let submitted;
    try {
      submitted = await submitParsedReviewJob(root2, id, ledger, batch, job, parsed, now, void 0, hostAttestation, attestationSourceVerified, isolationProven && hostAttestation?.hostEventId ? { mode: "subagent", hostEventId: hostAttestation.hostEventId } : void 0);
    } catch (error) {
      if (error instanceof DevFlowError) {
        invalid5(error.code, error.message, {
          ...error.details,
          claimRetained: true,
          leaseExpiresAt: job.claim.leaseExpiresAt,
          retryHint: "\u4FEE\u6B63 completion\u3001scope \u6216 attestation \u540E\uFF0C\u5728\u5F53\u524D\u79DF\u7EA6\u5185\u91CD\u8BD5\u63D0\u4EA4"
        });
      }
      throw error;
    }
    const batches = ledger.batches.map((candidate) => candidate.batchId === batchId ? submitted.batch : candidate);
    const pointer = await writeReviewSnapshot(root2, cloneLedger(ledger, nextStateRevision, batches, submitted.findingEvents));
    result = { batch: submitted.batch, idempotent: false };
    return {
      mutate: (draft) => {
        draft.review = pointer;
        draft.obligations = satisfyCompletedReviewObligation(draft.obligations, submitted.batch);
      },
      eventData: {
        batchId,
        jobId,
        payloadSha256: submitted.payloadSha256,
        ...hostAttestation ? { attestationRawSha256: hostAttestation.rawSha256, agentId: hostAttestation.agentId } : {}
      }
    };
  });
  return { ...result, state };
}
function samplingCurrentBatch(ledger, batchId) {
  const batch = ledger.batches.find((candidate) => candidate.batchId === batchId);
  if (!batch || batch.validity !== "current") {
    invalid5("REVIEW_SAMPLING_REQUEST_REPLAY", "sampling request is not valid for a current review batch", { batchId });
  }
  return batch;
}
function samplingAttemptForRequest(job, requestId) {
  const requestSha256 = digest9(requestId);
  const attempt = activeSamplingAttempt(job);
  if (job.status !== "sampling" || !attempt || attempt.requestSha256 !== requestSha256) {
    invalid5("REVIEW_SAMPLING_REQUEST_REPLAY", "sampling request was already consumed or does not belong to this job", { jobId: job.jobId });
  }
  return attempt;
}
async function beginReviewSampling(root2, id, expectedRevision, batchId, jobId, now = /* @__PURE__ */ new Date()) {
  let result;
  const state = await mutatePrepared(root2, id, expectedRevision, "review-sampling-started", async (current, nextStateRevision) => {
    const ledger = await readReviewLedger(root2, current);
    const batch = currentBatch2(ledger, batchId);
    const original = findJob(batch, jobId);
    const job = recoverExpiredSampling(original, now);
    if (job.status === "submitted") invalid5("REVIEW_JOB_ALREADY_SUBMITTED", "review job has already been submitted", { jobId });
    if (job.status === "claimed") invalid5("REVIEW_JOB_ALREADY_CLAIMED", "review job is claimed by a human capability", { jobId });
    if (job.status === "sampling") invalid5("REVIEW_JOB_SAMPLING_IN_PROGRESS", "review job is already held by server sampling", { jobId });
    const requestId = `${randomUUID9()}-${randomUUID9()}`;
    const attempt = {
      requestSha256: digest9(requestId),
      issuedAt: now.toISOString(),
      leaseExpiresAt: new Date(now.getTime() + samplingLeaseMilliseconds).toISOString(),
      status: "issued"
    };
    const sampling = {
      ...job,
      status: "sampling",
      claim: void 0,
      samplingAttempts: [...job.samplingAttempts ?? [], attempt]
    };
    const packageContents = await readBoundReviewPackage(root2, id, batch, sampling);
    const updatedBatch = withDerivedAssurance({
      ...batch,
      executionMode: "mcp-sampling",
      jobs: batch.jobs.map((candidate) => candidate.jobId === jobId ? sampling : candidate)
    });
    const pointer = await writeReviewSnapshot(root2, cloneLedger(
      ledger,
      nextStateRevision,
      ledger.batches.map((candidate) => candidate.batchId === batchId ? updatedBatch : candidate)
    ));
    result = { batchId, job: visibleJob(sampling), requestId, package: packageContents };
    return {
      mutate: (draft) => {
        draft.review = pointer;
      },
      eventData: { batchId, jobId, requestSha256: attempt.requestSha256 }
    };
  });
  return { ...result, state };
}
async function failReviewSampling(root2, id, expectedRevision, batchId, jobId, requestId, failureCode, now = /* @__PURE__ */ new Date()) {
  return mutatePrepared(root2, id, expectedRevision, "review-sampling-failed", async (current, nextStateRevision) => {
    const ledger = await readReviewLedger(root2, current);
    const batch = samplingCurrentBatch(ledger, batchId);
    const job = findJob(batch, jobId);
    const attempt = samplingAttemptForRequest(job, requestId);
    const failed = {
      ...job,
      status: "pending",
      samplingAttempts: job.samplingAttempts.map((candidate) => candidate.requestSha256 !== attempt.requestSha256 ? candidate : {
        ...candidate,
        status: "failed",
        completedAt: now.toISOString(),
        failureCode
      })
    };
    const updatedBatch = withDerivedAssurance({
      ...batch,
      jobs: batch.jobs.map((candidate) => candidate.jobId === jobId ? failed : candidate)
    });
    const pointer = await writeReviewSnapshot(root2, cloneLedger(
      ledger,
      nextStateRevision,
      ledger.batches.map((candidate) => candidate.batchId === batchId ? updatedBatch : candidate)
    ));
    return {
      mutate: (draft) => {
        draft.review = pointer;
      },
      eventData: { batchId, jobId, requestSha256: attempt.requestSha256, failureCode }
    };
  });
}
async function completeReviewSampling(root2, id, expectedRevision, batchId, jobId, requestId, completion, now = /* @__PURE__ */ new Date()) {
  const parsed = parseReviewJobCompletion(completion);
  let result;
  const state = await mutatePrepared(root2, id, expectedRevision, "review-sampling-submitted", async (current, nextStateRevision) => {
    const ledger = await readReviewLedger(root2, current);
    const batch = samplingCurrentBatch(ledger, batchId);
    const job = findJob(batch, jobId);
    const attempt = samplingAttemptForRequest(job, requestId);
    if (Date.parse(attempt.leaseExpiresAt) <= now.getTime()) {
      invalid5("REVIEW_SAMPLING_REQUEST_EXPIRED", "sampling request lease has expired", { jobId });
    }
    const submitted = await submitParsedReviewJob(root2, id, ledger, batch, job, parsed, now, attempt, void 0, false, { mode: "sampling" });
    const pointer = await writeReviewSnapshot(root2, cloneLedger(
      ledger,
      nextStateRevision,
      ledger.batches.map((candidate) => candidate.batchId === batchId ? submitted.batch : candidate),
      submitted.findingEvents
    ));
    result = { batch: submitted.batch };
    return {
      mutate: (draft) => {
        draft.review = pointer;
        draft.obligations = satisfyCompletedReviewObligation(draft.obligations, submitted.batch);
      },
      eventData: { batchId, jobId, requestSha256: attempt.requestSha256, payloadSha256: submitted.payloadSha256 }
    };
  });
  return { ...result, state };
}
function submittedFindings(ledger) {
  return ledger.batches.flatMap((batch) => batch.jobs.flatMap((job) => (job.submission?.findings ?? []).map((finding) => ({ batch, job, finding }))));
}
function sortedFindingIds(findingIds) {
  if (!Array.isArray(findingIds) || !findingIds.length || findingIds.some((id) => typeof id !== "string" || !id)) {
    invalid5("REVIEW_RISK_ACCEPTANCE_INVALID", "risk acceptance requires one or more finding ids");
  }
  const sorted = [...findingIds].sort();
  if (new Set(sorted).size !== sorted.length) {
    invalid5("REVIEW_RISK_ACCEPTANCE_INVALID", "risk acceptance finding ids must be unique");
  }
  return sorted;
}
function findingSetHash(batch, findings) {
  const items = findings.map((finding) => ({ findingId: finding.findingId, sha256: digest9(canonicalReviewValueJson(finding)) })).sort((left, right) => left.findingId.localeCompare(right.findingId));
  return digest9(canonicalReviewValueJson({ batchId: batch.batchId, basisHash: batch.basisHash, findings: items }));
}
function riskBinding(interaction) {
  const binding = interaction.binding;
  if (interaction.kind !== "risk-acceptance" || !binding || typeof binding.batchId !== "string" || typeof binding.findingSetHash !== "string" || !Array.isArray(binding.findingIds)) {
    invalid5("REVIEW_RISK_ACCEPTANCE_INVALID", "interaction is not a valid review risk-acceptance decision", { interactionId: interaction.id });
  }
  return { batchId: binding.batchId, findingIds: sortedFindingIds(binding.findingIds), findingSetHash: binding.findingSetHash };
}
function planReviewBoundToBatch(state, batch) {
  const evidence = state.steps.planning?.evidence;
  return state.steps.planning?.status === "satisfied" && evidence?.batchId === batch.batchId && evidence?.basisHash === batch.basisHash;
}
async function currentBatchWithBasis(root2, state, options = {}) {
  const ledger = await readReviewLedger(root2, state);
  const batch = ledger.batches.find((candidate) => candidate.validity === "current");
  if (!batch) invalid5("REVIEW_BATCH_REQUIRED", "a current review batch is required");
  const requireLiveBasis = options.requireLiveBasis ?? !planReviewBoundToBatch(state, batch);
  const reviewInput = await deriveReviewInput(root2, state);
  if (requireLiveBasis) {
    if (basisHash(reviewInput.basis) !== batch.basisHash) {
      invalid5("REVIEW_BASIS_STALE", "review batch basis no longer matches current feature state", {
        batchId: batch.batchId,
        recoveryHint: "\u91CD\u5EFA\u6279\u6B21\u2192\u91CD\u4EA4 jobs\u2192re-record planning"
      });
    }
  }
  const phase = batch.phase ?? "plan";
  const requirements = deriveReviewJobRequirements(state.route, state.classification.riskLabels, state.classification.controls.reviewRoles, phase);
  for (const requirement of requirements) {
    const job = batch.jobs.find((candidate) => candidate.role === requirement.role);
    if (!job || job.roleBasisHash !== reviewInput.roleBasisHashes[requirement.role]) {
      invalid5("REVIEW_BASIS_STALE", "review role basis no longer matches current feature semantics", {
        batchId: batch.batchId,
        role: requirement.role,
        recoveryHint: "\u91CD\u5EFA\u6279\u6B21\u2192\u91CD\u4EA4\u53D7\u5F71\u54CD role job\u2192re-record planning"
      });
    }
  }
  return { ledger, batch };
}
function acceptanceFindings(ledger, batch, findingIds) {
  return selectCurrentBlockingFindings(ledger, batch, findingIds, true);
}
function selectCurrentBlockingFindings(ledger, batch, findingIds, unresolvedOnly) {
  if (ledger.findingEvents?.length) {
    const roleBasis = (origin) => batch.jobs.find((job) => job.role === origin.role)?.roleBasisHash;
    const unresolved = new Map(unresolvedBlockingFindings(ledger, roleBasis).filter((finding) => effectiveFindingState(ledger, finding.findingId, roleBasis)?.status !== "needs-revalidation").map((finding) => [finding.findingId, finding]));
    const selected2 = sortedFindingIds(findingIds).map((findingId) => unresolved.get(findingId));
    if (selected2.some((finding) => !finding)) invalid5("REVIEW_RISK_ACCEPTANCE_INVALID", "\u98CE\u9669\u63A5\u53D7\u53EA\u80FD\u8986\u76D6\u5F53\u524D\u672A\u89E3\u51B3\u7684\u963B\u65AD\u53D1\u73B0", { findingIds });
    return selected2;
  }
  const byId = new Map(submittedFindings(ledger).filter(({ batch: source, finding }) => source.batchId === batch.batchId && finding.severity === "blocking" && (!unresolvedOnly || !batch.dispositions?.[finding.findingId])).map(({ finding }) => [finding.findingId, finding]));
  const selected = sortedFindingIds(findingIds).map((findingId) => byId.get(findingId));
  if (selected.some((finding) => !finding)) {
    invalid5("REVIEW_RISK_ACCEPTANCE_INVALID", "risk acceptance can cover only current unresolved blocking findings", {
      batchId: batch.batchId,
      findingIds
    });
  }
  return selected;
}
async function presentReviewRiskAcceptance(root2, id, expectedRevision, findingIds) {
  let result;
  let presentationEventId;
  const state = await mutatePrepared(root2, id, expectedRevision, "review-risk-acceptance-presented", async (current) => {
    const { ledger, batch } = await currentBatchWithBasis(root2, current);
    if (batch.progress !== "complete") invalid5("REVIEW_BATCH_INCOMPLETE", "all required review jobs must be submitted", { batchId: batch.batchId });
    const findings = acceptanceFindings(ledger, batch, findingIds);
    const ids = findings.map((finding) => finding.findingId).sort();
    const setHash = findingSetHash(batch, findings);
    const target = `review-risk:${batch.batchId}:${setHash}`;
    const existing = findInteractionForTarget(current, target);
    if (existing) {
      result = { interaction: toPublicInteraction(existing), interactionId: existing.id, idempotent: true };
      return { mutate: () => void 0, unchanged: true, eventData: { batchId: batch.batchId, findingSetHash: setHash, idempotent: true } };
    }
    return {
      mutate: (draft) => {
        const interaction = createInteraction(draft, {
          kind: "risk-acceptance",
          target,
          basisHash: batch.basisHash,
          binding: { batchId: batch.batchId, findingIds: ids, findingSetHash: setHash },
          question: "\u63A5\u53D7\u8FD9\u4E9B\u963B\u65AD\u6027\u5BA1\u67E5\u53D1\u73B0\u7684\u98CE\u9669\uFF1F\u6B64\u64CD\u4F5C\u53EA\u9002\u7528\u4E8E\u5F53\u524D\u5BA1\u67E5\u6279\u6B21\u4E0E\u7CBE\u786E\u53D1\u73B0\u96C6\u5408\u3002",
          options: [
            { id: "accept", label: "\u63A5\u53D7\u98CE\u9669", requiresComment: true },
            { id: "decline", label: "\u4E0D\u63A5\u53D7" }
          ]
        });
        presentationEventId = interaction.presentationEventId;
        result = { interaction: toPublicInteraction(interaction), interactionId: interaction.id, idempotent: false };
      },
      eventData: () => ({ batchId: batch.batchId, findingIds: ids, findingSetHash: setHash, presentationEventId })
    };
  });
  return { ...result, state };
}
function assertResolvedAcceptance(state, interaction, batch, findings) {
  const binding = riskBinding(interaction);
  const expectedIds = findings.map((finding) => finding.findingId).sort();
  const expectedSetHash = findingSetHash(batch, findings);
  if (interaction.basisHash !== batch.basisHash || binding.batchId !== batch.batchId || binding.findingSetHash !== expectedSetHash || binding.findingIds.join("\n") !== expectedIds.join("\n")) {
    invalid5("REVIEW_RISK_ACCEPTANCE_STALE", "risk acceptance no longer matches the current batch and finding set", { interactionId: interaction.id });
  }
  if (state.interactions?.[interaction.id] !== interaction) {
    invalid5("REVIEW_RISK_ACCEPTANCE_INVALID", "risk acceptance interaction is not part of feature state", { interactionId: interaction.id });
  }
}
function assertReviewRiskAcceptanceEvidence(event, interaction, promptEventId, userReply, host) {
  if (!event) {
    throw new DevFlowError("INTERACTION_PROVENANCE_UNAVAILABLE", "no matching user prompt event was captured", {
      eventId: promptEventId,
      recoveryHint: "\u4F7F\u7528\u5F53\u524D\u5BBF\u4E3B\u6355\u83B7\u7684\u540E\u7EED user-prompt event \u518D\u91CD\u8BD5"
    });
  }
  const payload = event.data;
  if (payload.host !== host) {
    throw new DevFlowError("HOST_EVENT_HOST_MISMATCH", "host event belongs to a different host", {
      expectedHost: host,
      actualHost: payload.host,
      eventId: promptEventId
    });
  }
  if (payload.eventId !== promptEventId || payload.type !== "user-prompt") {
    throw new DevFlowError("INTERACTION_PROVENANCE_UNAVAILABLE", "the referenced event is not a user prompt", {
      eventId: promptEventId,
      recoveryHint: "\u4F7F\u7528\u5F53\u524D\u5BBF\u4E3B\u6355\u83B7\u7684 user-prompt event \u518D\u91CD\u8BD5"
    });
  }
  if (!textCompatible(String(payload.text ?? ""), userReply)) {
    throw new DevFlowError("REVIEW_RISK_ACCEPTANCE_REPLY_MISMATCH", "userReply must be compatible with the captured prompt text", {
      eventId: promptEventId,
      recoveryHint: "\u4F20\u5165\u4E0E host event \u8BED\u4E49\u517C\u5BB9\u7684 userReply"
    });
  }
  const eventTime = Date.parse(typeof payload.at === "string" ? payload.at : event.at);
  const presentedTime = Date.parse(interaction.presentedAt);
  if (Number.isNaN(eventTime) || Number.isNaN(presentedTime) || eventTime <= presentedTime) {
    throw new DevFlowError("REVIEW_RISK_ACCEPTANCE_SAME_TURN", "risk acceptance must come from a later user turn", {
      eventId: promptEventId,
      recoveryHint: "\u5728\u98CE\u9669\u63A5\u53D7\u4EA4\u4E92\u5448\u73B0\u540E\u7684\u540E\u7EED\u56DE\u5408\u91CD\u65B0\u63D0\u4EA4"
    });
  }
}
async function resolveReviewRiskAcceptanceForAnswer(ctx) {
  const { root: root2, featureId, expectedRevision, host, credential, interaction, state } = ctx;
  if (interaction.kind !== "risk-acceptance" || interaction.status !== "pending" && interaction.status !== "resolved") {
    throw new DevFlowError("INTERACTION_NOT_PENDING", "\u5F53\u524D\u6CA1\u6709\u5F85\u5904\u7406\u7684\u5BA1\u67E5\u98CE\u9669\u63A5\u53D7\u95EE\u9898\u3002", { interactionId: interaction.id });
  }
  let promptEventId;
  let promptText;
  if (credential.source === "text") {
    const events = await readFeatureEvents(root2, featureId);
    const resolvedPromptEventId = resolveInteractionPromptEvent(events, state, interaction, {
      host,
      userReply: credential.userReply
    }).eventId;
    const hostEvent = events.find((event) => event.type === "host-event" && event.data.eventId === resolvedPromptEventId);
    assertReviewRiskAcceptanceEvidence(hostEvent, interaction, resolvedPromptEventId, credential.userReply, host);
    promptEventId = resolvedPromptEventId;
    const capturedText = hostEvent?.data?.text;
    promptText = typeof capturedText === "string" ? capturedText : void 0;
  }
  let response;
  let replayed = false;
  const next = await mutatePrepared(root2, featureId, expectedRevision, "review-risk-acceptance-resolved", async (current, nextStateRevision) => {
    const live = getInteraction(current, interaction.id);
    const { ledger, batch } = await currentBatchWithBasis(root2, current);
    const binding = riskBinding(live);
    if (live.status === "resolved") {
      const resolvedFindings = submittedFindings(ledger).filter(({ batch: source, finding }) => source.batchId === batch.batchId && binding.findingIds.includes(finding.findingId)).map(({ finding }) => finding);
      assertResolvedAcceptance(current, live, batch, resolvedFindings);
      const accepted = credential.source === "text" ? live.response?.action === "accept" && live.response.source === "text" && live.response.userReply === credential.userReply && live.response.promptEventId === promptEventId && live.response.host === host : live.response?.action === "accept" && live.response.source === "elicitation" && live.response.host === host;
      const dispositions2 = batch.dispositions ?? {};
      if (accepted && resolvedFindings.every((finding) => {
        const disposition = dispositions2[finding.findingId];
        return disposition?.kind === "risk-accepted" && disposition.interactionId === live.id && disposition.findingSetHash === binding.findingSetHash;
      })) {
        replayed = true;
        return { mutate: () => void 0, unchanged: true, eventData: { interactionId: interaction.id, idempotent: true } };
      }
      invalid5("INTERACTION_ALREADY_RESOLVED", interaction.id);
    }
    const findings = acceptanceFindings(ledger, batch, binding.findingIds);
    assertResolvedAcceptance(current, live, batch, findings);
    const resolveOn = (draft) => resolveResponseForAnswer(draft, interaction, {
      source: credential.source,
      action: credential.source === "elicitation" ? credential.action : void 0,
      comment: credential.source === "elicitation" ? credential.comment : void 0,
      userReply: credential.source === "text" ? credential.userReply : void 0,
      promptText,
      promptEventId,
      host
    });
    const preview = structuredClone(current);
    const previewResponse = resolveOn(preview);
    if (previewResponse.action !== "accept") {
      return {
        mutate: (draft) => {
          response = resolveOn(draft);
        },
        eventData: { interactionId: interaction.id, batchId: batch.batchId, action: previewResponse.action }
      };
    }
    const dispositions = { ...batch.dispositions };
    for (const finding of findings) {
      dispositions[finding.findingId] = {
        kind: "risk-accepted",
        interactionId: interaction.id,
        acceptedAt: previewResponse.respondedAt,
        batchId: batch.batchId,
        basisHash: batch.basisHash,
        findingIds: binding.findingIds,
        findingSetHash: binding.findingSetHash
      };
    }
    const updatedBatch = { ...batch, dispositions };
    const findingEvents = findings.map((finding) => {
      const source = submittedFindings(ledger).find((candidate) => candidate.finding.findingId === finding.findingId);
      return {
        type: "risk-accepted",
        findingId: finding.findingId,
        batchId: batch.batchId,
        interactionId: interaction.id,
        basisHash: source?.job.roleBasisHash ?? batch.jobs.find((job) => job.role === finding.category)?.roleBasisHash ?? batch.basisHash,
        findingSetHash: binding.findingSetHash,
        userEvidence: previewResponse.comment ?? (credential.source === "text" ? credential.userReply : credential.action),
        at: previewResponse.respondedAt
      };
    });
    const pointer = await writeReviewSnapshot(root2, cloneLedger(
      ledger,
      nextStateRevision,
      ledger.batches.map((candidate) => candidate.batchId === batch.batchId ? updatedBatch : candidate),
      findingEvents
    ));
    return {
      mutate: (draft) => {
        response = resolveOn(draft);
        draft.review = pointer;
      },
      eventData: { interactionId: interaction.id, batchId: batch.batchId, findingIds: binding.findingIds, findingSetHash: binding.findingSetHash }
    };
  });
  if (response) return { state: next, action: response.action, ...response.comment ? { comment: response.comment } : {} };
  if (replayed) return { state: next, action: "accept" };
  throw new DevFlowError("INTERACTION_NOT_RESOLVED", interaction.id);
}
function currentUnresolvedBlocking(ledger, batch, state) {
  if (ledger.findingEvents?.length) {
    const roleBasis = (origin) => batch.jobs.find((job) => job.role === origin.role)?.roleBasisHash;
    return unresolvedBlockingFindings(ledger, roleBasis);
  }
  const jobs = ledger.batches.flatMap((candidate) => candidate.jobs);
  const dispositions = Object.assign({}, ...ledger.batches.map((candidate) => candidate.dispositions ?? {}));
  return jobs.flatMap((job) => job.submission?.findings ?? []).filter((finding) => {
    if (finding.severity !== "blocking") return false;
    const disposition = dispositions[finding.findingId];
    if (!disposition) return true;
    if (disposition.kind === "risk-accepted") {
      if (disposition.batchId !== batch.batchId || disposition.basisHash !== batch.basisHash) return true;
      const interaction = state.interactions?.[disposition.interactionId];
      if (!interaction || interaction.kind !== "risk-acceptance" || interaction.status !== "resolved" || interaction.response?.action !== "accept" || interaction.basisHash !== batch.basisHash) return true;
      let binding;
      try {
        binding = riskBinding(interaction);
      } catch {
        return true;
      }
      if (binding.batchId !== batch.batchId || binding.findingSetHash !== disposition.findingSetHash || binding.findingIds.join("\n") !== [...disposition.findingIds].sort().join("\n") || !binding.findingIds.includes(finding.findingId)) return true;
      const acceptedFindings = submittedFindings(ledger).filter(({ batch: source, finding: candidate }) => source.batchId === batch.batchId && binding.findingIds.includes(candidate.findingId)).map(({ finding: candidate }) => candidate);
      if (acceptedFindings.length !== binding.findingIds.length || acceptedFindings.some((candidate) => candidate.severity !== "blocking") || findingSetHash(batch, acceptedFindings) !== binding.findingSetHash) return true;
      return false;
    }
    const successor = ledger.batches.find((candidate) => candidate.batchId === disposition.successorBatchId);
    const resolutionJob = successor?.jobs.find((candidate) => candidate.jobId === disposition.resolutionJobId);
    const sourceJob = jobs.find((candidate) => candidate.jobId === finding.jobId);
    return !successor || !resolutionJob || !sourceJob || resolutionJob.role !== sourceJob.role || !resolutionJob.submission?.resolutions.some((resolution) => resolution.findingId === finding.findingId);
  });
}
function reviewObligation(state, phase) {
  if (state.mode !== "routed") return false;
  if (phase === "code") return state.classification.controls.codeReview !== "none";
  return reviewEnforcementRequired(state.route, state.classification.controls);
}
async function reviewBasisStale(root2, state, batch, phase) {
  const requireLiveBasis = !planReviewBoundToBatch(state, batch);
  const reviewInput = await deriveReviewInput(root2, state);
  if (requireLiveBasis && basisHash(reviewInput.basis) !== batch.basisHash) return true;
  const requirements = deriveReviewJobRequirements(state.route, state.classification.riskLabels, state.classification.controls.reviewRoles, phase);
  for (const requirement of requirements) {
    const job = batch.jobs.find((candidate) => candidate.role === requirement.role);
    if (!job || job.roleBasisHash !== reviewInput.roleBasisHashes[requirement.role]) return true;
  }
  return false;
}
function reviewJobsSummary(batch) {
  return batch.jobs.map(({ jobId, role, reviewDepth, status }) => ({ jobId, role, reviewDepth, status }));
}
async function reviewGate(root2, state, query) {
  const phase = query?.phase ?? (currentOpenStep(state) === "code_review" ? "code" : "plan");
  if (!reviewObligation(state, phase)) return { status: "ready" };
  const ledger = await readReviewLedger(root2, state);
  const batch = ledger.batches.find((candidate) => candidate.validity === "current");
  if (!batch) return { status: "need-batch", cause: "missing" };
  if ((batch.phase ?? "plan") !== phase) return { status: "need-batch", cause: "phase", batchId: batch.batchId };
  if (await reviewBasisStale(root2, state, batch, phase)) return { status: "need-batch", cause: "stale", batchId: batch.batchId };
  if (batch.progress !== "complete") return { status: "jobs-open", batchId: batch.batchId, jobs: reviewJobsSummary(batch) };
  if (phase === "code") {
    const requiresIsolation = state.classification.controls.codeReview === "independent" || state.classification.controls.codeReview === "full";
    if (requiresIsolation && !hasCurrentQualityException(state, "review")) {
      const missingIsolation = batch.jobs.filter((job) => job.status === "submitted" && !job.submission?.isolationProof).map((job) => job.jobId);
      if (missingIsolation.length) return { status: "isolation", batchId: batch.batchId, jobIds: missingIsolation };
    }
  }
  const unresolved = currentUnresolvedBlocking(ledger, batch, state);
  if (unresolved.length && !hasCurrentQualityException(state, "review")) {
    return { status: "blocking", batchId: batch.batchId, findingIds: unresolved.map((finding) => finding.findingId) };
  }
  if (reviewEnforcementRequired(state.route, state.classification.controls)) {
    await assertCurrentReviewProjection(root2, state);
  }
  return { status: "ready", stamp: { batchId: batch.batchId, basisHash: batch.basisHash, assuranceLevel: batch.assuranceLevel } };
}
function reviewGateError(gate, phase) {
  switch (gate.status) {
    case "need-batch": {
      if (gate.cause === "stale") {
        return new DevFlowError("REVIEW_BASIS_STALE", "review batch basis no longer matches current feature state", {
          batchId: gate.batchId,
          recoveryHint: "\u91CD\u5EFA\u6279\u6B21\u2192\u91CD\u4EA4 jobs\u2192re-record planning"
        });
      }
      return new DevFlowError("REVIEW_BATCH_REQUIRED", `a current ${phase} review batch is required`, { expectedPhase: phase });
    }
    case "jobs-open":
      return new DevFlowError("REVIEW_BATCH_INCOMPLETE", "all required review jobs must be submitted", { batchId: gate.batchId });
    case "isolation":
      return new DevFlowError("REVIEW_ISOLATION_REQUIRED", "\u72EC\u7ACB\u4EE3\u7801\u5BA1\u67E5\u8981\u6C42\u5BA1\u67E5\u5728\u4E0E\u5B9E\u73B0\u9694\u79BB\u7684\u65B0\u4E0A\u4E0B\u6587\u4E2D\u5B8C\u6210\uFF0C\u5F53\u524D\u6279\u6B21\u7F3A\u5C11\u9694\u79BB\u8BC1\u660E\u3002", {
        jobIds: gate.jobIds,
        batchId: gate.batchId,
        recoveryHint: "\u5728\u4E0E\u5B9E\u73B0\u9694\u79BB\u7684\u4E0A\u4E0B\u6587\u4E2D\u91CD\u65B0\u5B8C\u6210\u8FD9\u4E9B\u5BA1\u67E5 job \u5E76\u8BB0\u5F55 review-execution \u4E8B\u4EF6\uFF0C\u6216\u901A\u8FC7\u670D\u52A1\u7AEF\u91C7\u6837\u5B8C\u6210 job\uFF1B\u5BBF\u4E3B\u65E0\u6CD5\u63D0\u4F9B\u9694\u79BB\u4E0A\u4E0B\u6587\u65F6\uFF0C\u53EF\u901A\u8FC7\u8D28\u91CF\u4F8B\u5916\uFF08presentQualityException kind=review\uFF09\u663E\u5F0F\u63A5\u53D7\u72EC\u7ACB\u6027\u98CE\u9669\u540E\u7EE7\u7EED\u3002",
        retryOriginal: true
      });
    case "blocking":
      return new DevFlowError("REVIEW_BLOCKING_FINDINGS", "review ledger has unresolved blocking findings", {
        batchId: gate.batchId,
        findingIds: gate.findingIds
      });
  }
}
async function requireReviewReady(root2, state, query) {
  const phase = query?.phase ?? (currentOpenStep(state) === "code_review" ? "code" : "plan");
  const gate = await reviewGate(root2, state, query);
  if (gate.status === "ready") return gate.stamp;
  throw reviewGateError(gate, phase);
}

// plugins/dev-flow/src/core/plan-graph.ts
var TRACE_ANCHOR2 = /<!-- dev-flow:id=(REQ|AC|TASK|TEST|UNIT)-([0-9]{3,}) kind=(requirement|acceptance-criterion|task|test|implementation-unit) -->/g;
function parseField(line) {
  const match = /^-\s+([A-Za-z_]+):\s*(.*)$/.exec(line.trim());
  if (!match) return void 0;
  const raw = match[2].trim();
  if (raw.startsWith("[") && raw.endsWith("]")) {
    const inner = raw.slice(1, -1).trim();
    return {
      key: match[1],
      value: inner.length ? inner.split(",").map((item) => item.trim()).filter((item) => item.length > 0) : []
    };
  }
  return { key: match[1], value: raw.length ? [raw] : [] };
}
function parseBlock(blockText) {
  const fields = {};
  for (const line of blockText.split("\n")) {
    const parsed = parseField(line);
    if (parsed) fields[parsed.key] = parsed.value;
  }
  return fields;
}
function parsePlanBlocks(markdown) {
  TRACE_ANCHOR2.lastIndex = 0;
  const anchors = [];
  let match;
  while ((match = TRACE_ANCHOR2.exec(markdown)) !== null) {
    const [, prefix, suffix, kind] = match;
    anchors.push({ id: `${prefix}-${suffix}`, kind, index: match.index });
  }
  const blocks = /* @__PURE__ */ new Map();
  for (let index = 0; index < anchors.length; index += 1) {
    const anchor = anchors[index];
    const end = anchors[index + 1]?.index ?? markdown.length;
    blocks.set(anchor.id, { kind: anchor.kind, text: markdown.slice(anchor.index, end) });
  }
  return blocks;
}
function collectGraph(markdown) {
  const blocks = parsePlanBlocks(markdown);
  const tasks = /* @__PURE__ */ new Map();
  const implementationUnits = /* @__PURE__ */ new Map();
  for (const [id, block] of blocks) {
    const fields = parseBlock(block.text);
    if (block.kind === "task") {
      tasks.set(id, { id, implementationUnit: fields["implementation_unit"]?.[0] });
    } else if (block.kind === "implementation-unit") {
      implementationUnits.set(id, {
        id,
        tasks: fields["tasks"] ?? [],
        dependsOn: fields["depends_on"] ?? []
      });
    }
  }
  return { tasks, implementationUnits };
}
function validatePlanTaskGraph(markdown) {
  const { tasks, implementationUnits } = collectGraph(markdown);
  const errors = [];
  if (tasks.size === 0) errors.push("\u8BA1\u5212\u4E2D\u6CA1\u6709\u4EFB\u4F55 TASK \u951A\u70B9\uFF1B\u8BF7\u4E3A\u6BCF\u4E2A\u4EFB\u52A1\u58F0\u660E dev-flow:id=TASK-xxx kind=task");
  if (implementationUnits.size === 0) errors.push("\u8BA1\u5212\u4E2D\u6CA1\u6709\u4EFB\u4F55 UNIT \u951A\u70B9\uFF1B\u8BF7\u4E3A\u6BCF\u4E2A\u5B9E\u73B0\u5355\u5143\u58F0\u660E dev-flow:id=UNIT-xxx kind=implementation-unit");
  for (const task of tasks.values()) {
    const unit = task.implementationUnit;
    if (!unit) {
      errors.push(`${task.id} \u672A\u58F0\u660E implementation_unit`);
      continue;
    }
    if (!implementationUnits.has(unit)) {
      errors.push(`${task.id} \u5F15\u7528\u4E86\u4E0D\u5B58\u5728\u7684\u5B9E\u73B0\u5355\u5143 ${unit}`);
      continue;
    }
    const declared = implementationUnits.get(unit);
    if (!declared.tasks.includes(task.id)) {
      errors.push(`${unit} \u7684 tasks \u672A\u5305\u542B\u5F15\u7528\u5B83\u7684 ${task.id}\uFF08\u53CC\u5411\u4E0D\u4E00\u81F4\uFF09`);
    }
  }
  for (const implementationUnit of implementationUnits.values()) {
    for (const taskId of implementationUnit.tasks) {
      const task = tasks.get(taskId);
      if (!task) {
        errors.push(`${implementationUnit.id} \u7684 tasks \u5F15\u7528\u4E86\u4E0D\u5B58\u5728\u7684\u4EFB\u52A1 ${taskId}`);
      } else if (task.implementationUnit !== implementationUnit.id) {
        errors.push(`${implementationUnit.id} \u5217\u51FA ${taskId}\uFF0C\u4F46\u8BE5\u4EFB\u52A1\u58F0\u660E\u7684 implementation_unit \u662F ${task.implementationUnit ?? "\u7A7A"}\uFF08\u53CC\u5411\u4E0D\u4E00\u81F4\uFF09`);
      }
    }
    for (const dependency of implementationUnit.dependsOn) {
      if (!implementationUnits.has(dependency)) {
        errors.push(`${implementationUnit.id} \u7684 depends_on \u5F15\u7528\u4E86\u4E0D\u5B58\u5728\u7684\u5B9E\u73B0\u5355\u5143 ${dependency}`);
      }
    }
  }
  const cycle = findCycle(implementationUnits);
  if (cycle) errors.push(`\u5B9E\u73B0\u5355\u5143\u4F9D\u8D56\u6210\u73AF\uFF1A${cycle.join(" \u2192 ")}`);
  return errors;
}
function findCycle(implementationUnits) {
  const WHITE = 0;
  const GRAY = 1;
  const BLACK = 2;
  const color = /* @__PURE__ */ new Map();
  const stack = [];
  function visit(nodeId) {
    color.set(nodeId, GRAY);
    stack.push(nodeId);
    for (const dependency of implementationUnits.get(nodeId)?.dependsOn ?? []) {
      if (!implementationUnits.has(dependency)) continue;
      const state = color.get(dependency) ?? WHITE;
      if (state === GRAY) {
        const start = stack.indexOf(dependency);
        return [...stack.slice(start), dependency];
      }
      if (state === WHITE) {
        const cycle = visit(dependency);
        if (cycle) return cycle;
      }
    }
    stack.pop();
    color.set(nodeId, BLACK);
    return void 0;
  }
  for (const nodeId of implementationUnits.keys()) {
    if ((color.get(nodeId) ?? WHITE) === WHITE) {
      const cycle = visit(nodeId);
      if (cycle) return cycle;
    }
  }
  return void 0;
}

// plugins/dev-flow/src/core/implementation-units.ts
var digest10 = (value) => createHash26("sha256").update(value).digest("hex");
async function abandonImplementationUnit(root2, id, expectedRevision, unitId, reason, host) {
  const reasonText = reason.trim();
  if (!reasonText) {
    throw new DevFlowError("IMPLEMENTATION_UNIT_CANCEL_REASON_REQUIRED", "cancelling an implementation unit requires a reason", {
      recoveryHint: "\u8BF4\u660E\u4E3A\u4EC0\u4E48\u53D6\u6D88\u8BE5\u5355\u5143\uFF08\u4F8B\u5982\u9A8C\u8BC1\u914D\u7F6E\u53D8\u66F4\u540E\u9700\u8981\u91CD\u767B\u8BB0\u8BA1\u5212\uFF09"
    });
  }
  return mutate(root2, id, expectedRevision, "implementation-unit-cancelled", async (state) => {
    await assertHostHealth(root2, state.lastUpdatedBy.host, "implementation unit");
    const unit = (state.implementationUnits ?? []).find((candidate) => candidate.unitId === unitId);
    if (!unit) throw new DevFlowError("IMPLEMENTATION_UNIT_UNKNOWN", "implementation unit has no runtime state", { unitId });
    if (unit.status !== "active") {
      throw new DevFlowError("IMPLEMENTATION_UNIT_NOT_ACTIVE", "only an active implementation unit can be cancelled", { unitId, status: unit.status });
    }
    reopenImplementationUnit(unit);
  }, { unitId, reason: reasonText, host });
}
function currentImplementationNodes(ledger) {
  return Object.values(ledger?.nodes ?? {}).filter((node) => node.kind === "implementation-unit" && node.status === "current");
}
function readyUnitFromNodes(state, nodes) {
  const statusByUnit = new Map((state.implementationUnits ?? []).map((unit) => [unit.unitId, unit.status]));
  return [...nodes].sort((left, right) => left.id.localeCompare(right.id)).find((node) => statusByUnit.get(node.id) !== "checkpointed" && node.dependsOn.every((dependency) => statusByUnit.get(dependency) === "checkpointed"));
}
function nextReadyImplementationUnit(state, ledger) {
  return readyUnitFromNodes(state, currentImplementationNodes(ledger));
}
function planImplementationUnitDefs(planMarkdown) {
  const blocks = parsePlanBlocks(planMarkdown);
  const defs = [];
  for (const [id, block] of blocks) {
    if (block.kind !== "implementation-unit" || !/^UNIT-[0-9]{3,}$/.test(id)) continue;
    const fields = {};
    for (const line of block.text.split("\n")) {
      const match = /^-\s+([A-Za-z_]+):\s*(.*)$/.exec(line.trim());
      if (!match) continue;
      const raw = match[2].trim();
      fields[match[1]] = raw.startsWith("[") && raw.endsWith("]") ? raw.slice(1, -1).trim() ? raw.slice(1, -1).split(",").map((item) => item.trim()).filter(Boolean) : [] : raw ? [raw] : [];
    }
    defs.push({ id, tasks: fields["tasks"] ?? [], dependsOn: fields["depends_on"] ?? [] });
  }
  return defs.sort((left, right) => left.id.localeCompare(right.id));
}
async function assertImplementationUnitBeginReady(root2, id, state, unitId) {
  await assertHostHealth(root2, state.lastUpdatedBy.host, "implementation unit");
  await assertWorkspaceOwnershipComplete(root2, state, await readProjectConfig(root2), "implementation unit");
  if (!checkpointsEnforcementRequired(state.route, state.classification.controls) && state.classification.controls.plan !== "formal") {
    throw new DevFlowError("IMPLEMENTATION_UNITS_NOT_ENFORCED", "\u5F53\u524D\u52A8\u6001\u8DEF\u7EBF\u672A\u542F\u7528 unit-chain checkpoint \u63A7\u5236\u3002");
  }
  if (currentOpenStep(state) !== "implementation") {
    throw new DevFlowError("STEP_OUT_OF_ORDER", "begin requires the implementation step", { expected: currentOpenStep(state) });
  }
  const approvalObligation = (state.obligations ?? []).find((obligation) => obligation.kind === "approval" && obligation.status !== "satisfied");
  if (approvalObligation && !confirmedApproval(state)) {
    throw new DevFlowError("DEV_FLOW_IMPLEMENTATION_APPROVAL_REQUIRED", "implementation approval must be confirmed before beginning a unit");
  }
  const assertNoPendingSideEffect = (targetUnitId) => {
    const pendingSideEffect = Object.values(state.interactions ?? {}).find((candidate) => candidate.kind === "side-effect-rerun" && candidate.status === "pending" && candidate.sideEffectRerun?.units.includes(targetUnitId));
    if (pendingSideEffect) {
      throw new DevFlowError("SIDE_EFFECT_UNIT_PENDING_CONFIRMATION", "\u8BE5\u5B9E\u73B0\u5355\u5143\u5305\u542B\u6709\u526F\u4F5C\u7528\u7684\u64CD\u4F5C\uFF0C\u8BA1\u5212\u4FEE\u8BA2\u540E\u9700\u7528\u6237\u786E\u8BA4\u624D\u80FD\u91CD\u8DD1\u3002", {
        unitId: targetUnitId,
        recoveryHint: "\u56DE\u7B54\u5F53\u524D\u5F85\u51B3\u95EE\u9898\uFF08\u786E\u8BA4\u91CD\u8DD1\u8BE5\u5355\u5143\uFF0C\u6216\u4E0D\u91CD\u8DD1\u4FDD\u7559\u539F\u7ED3\u679C\uFF09\u540E\u518D\u91CD\u8BD5 begin\u3002"
      });
    }
  };
  if (unitId) assertNoPendingSideEffect(unitId);
  const traceEnforced = traceEnforcementRequired(state.route, state.classification.controls);
  let nodes;
  if (traceEnforced) {
    const ledger = await assertTraceGateCurrent(root2, state, "implementation");
    for (const kind of ["requirements", "implementation-plan"]) {
      await assertArtifactCurrent(root2, id, state, kind);
    }
    if (reviewEnforcementRequired(state.route, state.classification.controls)) {
      await requireReviewReady(root2, state, { phase: "plan" });
    }
    nodes = currentImplementationNodes(ledger);
  } else {
    const plan = state.artifacts["implementation-plan"];
    if (!plan) throw new DevFlowError("MISSING_REQUIRED_ARTIFACT", "implementation-plan");
    const contents = await assertArtifactCurrent(root2, id, state, "implementation-plan");
    nodes = planImplementationUnitDefs(contents);
  }
  let targetId = unitId;
  if (!targetId) {
    const ready = readyUnitFromNodes(state, nodes);
    if (!ready) return void 0;
    targetId = ready.id;
    assertNoPendingSideEffect(targetId);
  }
  const node = nodes.find((candidate) => candidate.id === targetId);
  if (!node) {
    throw new DevFlowError("IMPLEMENTATION_UNIT_UNKNOWN", "implementation unit is not part of the current execution graph", { unitId: targetId });
  }
  if ((state.implementationUnits ?? []).some((unit) => unit.status === "active")) {
    const active = state.implementationUnits.find((unit) => unit.status === "active");
    throw new DevFlowError("IMPLEMENTATION_UNIT_ALREADY_ACTIVE", "another implementation unit is already active", { activeUnitId: active.unitId });
  }
  const basisHash2 = implementationUnitBasisHash(state);
  const byId = new Map((state.implementationUnits ?? []).map((unit) => [unit.unitId, unit]));
  const merged = [];
  for (const candidate of nodes) {
    const candidateId = candidate.id;
    const existing = byId.get(candidateId);
    if (existing && existing.status !== "pending") {
      merged.push(existing);
    } else {
      merged.push({
        unitId: candidateId,
        status: "pending",
        basisHash: basisHash2,
        ...candidate.tasks.length ? { tasks: [...candidate.tasks] } : {},
        ...candidate.dependsOn.length ? { dependsOn: [...candidate.dependsOn] } : {}
      });
    }
  }
  for (const dependency of node.dependsOn) {
    const unit = merged.find((candidate) => candidate.unitId === dependency);
    if (unit?.status !== "checkpointed") {
      throw new DevFlowError("IMPLEMENTATION_UNIT_DEPENDENCY_INCOMPLETE", "implementation unit dependencies must be checkpointed first", {
        unitId: targetId,
        dependency,
        status: unit?.status ?? "unknown"
      });
    }
  }
  const target = merged.find((unit) => unit.unitId === targetId);
  if (target.status !== "pending" && target.status !== "rolled_back") {
    throw new DevFlowError("IMPLEMENTATION_UNIT_NOT_PENDING", "implementation unit cannot begin from its current status", { unitId: targetId, status: target.status });
  }
  return { unitId: targetId, merged, basisHash: basisHash2 };
}
function implementationUnitBasisHash(state) {
  return digest10(canonicalReviewValueJson({
    traceability: state.traceability,
    approval: confirmedApproval(state)?.record ?? null
  }));
}
async function beginImplementationUnit(root2, id, expectedRevision, unitId) {
  return mutate(root2, id, expectedRevision, "implementation-unit-begun", async (state) => {
    const ready = await assertImplementationUnitBeginReady(root2, id, state, unitId);
    const { merged, basisHash: basisHash2 } = ready;
    const project = await readProjectConfig(root2);
    const snapshot = await snapshotGovernedRoots(root2, project);
    await captureUnitBaseline(root2, id, unitId, snapshot);
    const target = merged.find((unit) => unit.unitId === unitId);
    delete target.checkpointId;
    target.basisHash = basisHash2;
    target.beginNonce = randomUUID10();
    target.status = "active";
    target.startedFingerprint = await fingerprintGovernedRoots(root2, project);
    state.implementationUnits = merged;
  }, { unitId });
}

// plugins/dev-flow/src/core/rollback-journal.ts
import { randomUUID as randomUUID11 } from "node:crypto";
import { mkdir as mkdir9, readFile as readFile14, rm, rmdir } from "node:fs/promises";
import { hostname } from "node:os";
import path18 from "node:path";
var features = (root2) => path18.join(root2, ".dev-flow", "features");
var rollbackTxnPath = (root2, featureId) => path18.join(features(root2), featureId, "rollback-transaction.json");
var rollbackTransactionPhases = /* @__PURE__ */ new Set(["prepared", "backing-up", "rolling-back", "verifying", "committed", "compensating", "compensated"]);
function isSha2562(value) {
  return typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
}
function validateRollbackTransaction(value) {
  const transaction = value;
  const validPlan = Array.isArray(transaction?.filePlan) && transaction.filePlan.every((action) => {
    const candidate = action;
    if (!candidate || candidate.action !== "restore" && candidate.action !== "delete" || typeof candidate.path !== "string" || !candidate.path) return false;
    if (candidate.action === "restore" && (!isSha2562(candidate.blobSha256) || typeof candidate.mode !== "string" || !/^[0-7]{3,4}$/.test(candidate.mode))) return false;
    if (candidate.blobSha256 !== void 0 && !isSha2562(candidate.blobSha256)) return false;
    if (candidate.mode !== void 0 && (typeof candidate.mode !== "string" || !/^[0-7]{3,4}$/.test(candidate.mode))) return false;
    if (candidate.kind !== void 0 && candidate.kind !== "file" && candidate.kind !== "symlink") return false;
    return true;
  });
  if (transaction?.schemaVersion !== 1 || typeof transaction.transactionId !== "string" || !transaction.transactionId || typeof transaction.featureId !== "string" || !transaction.featureId || !rollbackTransactionPhases.has(transaction.phase) || typeof transaction.targetCheckpointId !== "string" || !/^CP-[0-9]{3,}$/.test(transaction.targetCheckpointId) || typeof transaction.targetUnitId !== "string" || !/^UNIT-[0-9]{3,}$/.test(transaction.targetUnitId) || !Array.isArray(transaction.undoOrder) || transaction.undoOrder.length === 0 || !transaction.undoOrder.every((unitId) => typeof unitId === "string" && /^UNIT-[0-9]{3,}$/.test(unitId)) || transaction.undoCheckpoints !== void 0 && (!Array.isArray(transaction.undoCheckpoints) || !transaction.undoCheckpoints.every((id) => typeof id === "string" && /^CP-[0-9]{3,}$/.test(id))) || !isSha2562(transaction.previewBasisHash) || !isSha2562(transaction.projectConfigSha256) || transaction.verificationCommandHashes !== void 0 && (typeof transaction.verificationCommandHashes !== "object" || transaction.verificationCommandHashes === null || Array.isArray(transaction.verificationCommandHashes) || Object.values(transaction.verificationCommandHashes).some((hash2) => !isSha2562(hash2))) || !Number.isInteger(transaction.stateRevision) || (transaction.stateRevision ?? -1) < 0 || typeof transaction.backupDirectory !== "string" || !/^checkpoints\/recovery\/[^/]+$/.test(transaction.backupDirectory) || !Number.isInteger(transaction.nextFileIndex) || (transaction.nextFileIndex ?? -1) < 0 || !validPlan || !Array.isArray(transaction.verificationAttemptIds) || !transaction.verificationAttemptIds.every((id) => typeof id === "string" && id.length > 0) || typeof transaction.startedAt !== "string" || transaction.completedAt !== void 0 && typeof transaction.completedAt !== "string" || transaction.error !== void 0 && typeof transaction.error !== "string") {
    throw new DevFlowError("ROLLBACK_TRANSACTION_UNREADABLE", "rollback transaction journal is invalid", {
      recoveryHint: "Run dev_flow_doctor; the workspace may be mid-rollback \u2014 do not hand-edit .dev-flow"
    });
  }
}
function rollbackTransactionFinished(transaction) {
  return (transaction.phase === "committed" || transaction.phase === "compensated") && typeof transaction.completedAt === "string";
}
async function readRollbackTransaction(root2, featureId) {
  let raw;
  try {
    raw = await readFile14(rollbackTxnPath(root2, featureId), "utf8");
  } catch (error) {
    if (error.code === "ENOENT") return void 0;
    throw new DevFlowError("ROLLBACK_TRANSACTION_UNREADABLE", "rollback transaction journal cannot be read", {
      recoveryHint: "Run dev_flow_doctor; the workspace may be mid-rollback \u2014 do not hand-edit .dev-flow"
    });
  }
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new DevFlowError("ROLLBACK_TRANSACTION_UNREADABLE", "rollback transaction journal is not valid JSON", {
      recoveryHint: "Run dev_flow_doctor; the workspace may be mid-rollback \u2014 do not hand-edit .dev-flow"
    });
  }
  validateRollbackTransaction(parsed);
  if (parsed.featureId !== featureId) {
    throw new DevFlowError("ROLLBACK_TRANSACTION_UNREADABLE", "rollback transaction journal feature id does not match its path", {
      recoveryHint: "Run dev_flow_doctor; the workspace may be mid-rollback \u2014 do not hand-edit .dev-flow"
    });
  }
  return parsed;
}
async function writeRollbackTransaction(root2, featureId, transaction) {
  validateRollbackTransaction(transaction);
  if (transaction.featureId !== featureId) {
    throw new DevFlowError("ROLLBACK_TRANSACTION_UNREADABLE", "rollback transaction journal feature id does not match its path");
  }
  await writeAtomic2(rollbackTxnPath(root2, featureId), transaction);
}
async function prepareRollbackTransaction(root2, featureId, expectedRevision, transaction) {
  if (transaction.featureId !== featureId) {
    throw new DevFlowError("ROLLBACK_TRANSACTION_UNREADABLE", "rollback transaction journal feature id does not match its path");
  }
  if (transaction.phase !== "prepared") {
    throw new DevFlowError("ROLLBACK_TRANSACTION_UNREADABLE", "prepareRollbackTransaction only accepts phase prepared");
  }
  if (transaction.stateRevision !== expectedRevision) {
    throw new DevFlowError("STATE_REVISION_CONFLICT", "state revision changed", { currentRevision: transaction.stateRevision });
  }
  const release = await lock(root2, featureId, "prepare-rollback-transaction");
  try {
    await assertNoOpenRollbackTransaction(root2);
    const state = await readState(root2, featureId);
    if (state.revision !== expectedRevision) {
      throw new DevFlowError("STATE_REVISION_CONFLICT", "state revision changed", { currentRevision: state.revision });
    }
    await writeRollbackTransaction(root2, featureId, transaction);
    return transaction;
  } finally {
    await release();
  }
}
var ROLLBACK_DRIVE_LEASE_STALE_MS = 3e4;
var ROLLBACK_DRIVE_LEASE_HEARTBEAT_MS = 1e4;
function driveLeasePath(root2, featureId, transactionId) {
  return path18.join(features(root2), featureId, "checkpoints", "recovery", `${transactionId}-drive-lease.json`);
}
function legacyDriveLeasePath(root2, featureId, transactionId) {
  return path18.join(features(root2), featureId, "checkpoints", "recovery", transactionId, "drive-lease.json");
}
async function readLeaseAt(leaseFile, transactionId) {
  try {
    const raw = await readFile14(leaseFile, "utf8");
    return JSON.parse(raw);
  } catch (error) {
    if (error.code === "ENOENT") return void 0;
    throw new DevFlowError("ROLLBACK_TRANSACTION_UNREADABLE", "rollback drive lease is unreadable", {
      transactionId,
      recoveryHint: "Run dev_flow_doctor; do not hand-edit the drive lease"
    });
  }
}
async function readDriveLeases(root2, featureId, transactionId) {
  const [sidecar, legacy] = await Promise.all([
    readLeaseAt(driveLeasePath(root2, featureId, transactionId), transactionId),
    readLeaseAt(legacyDriveLeasePath(root2, featureId, transactionId), transactionId)
  ]);
  return { ...sidecar ? { sidecar } : {}, ...legacy ? { legacy } : {} };
}
async function writeDriveLeasePair(root2, featureId, transactionId, lease) {
  const legacyFile = legacyDriveLeasePath(root2, featureId, transactionId);
  const sidecarFile = driveLeasePath(root2, featureId, transactionId);
  await mkdir9(path18.dirname(legacyFile), { recursive: true });
  await mkdir9(path18.dirname(sidecarFile), { recursive: true });
  await writeAtomic2(legacyFile, lease);
  await writeAtomic2(sidecarFile, lease);
}
function isProcessAlive(pid, ownerHostname) {
  if (ownerHostname !== hostname()) return true;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}
function leaseHeartbeatAt(lease) {
  const timestamp = Date.parse(lease.heartbeatAt ?? lease.acquiredAt);
  return Number.isFinite(timestamp) ? timestamp : Number.NaN;
}
function activeLease(lease) {
  const heartbeatAt = leaseHeartbeatAt(lease);
  const live = Number.isFinite(heartbeatAt) && isProcessAlive(lease.pid, lease.hostname);
  const stale = !Number.isFinite(heartbeatAt) || Date.now() - heartbeatAt > ROLLBACK_DRIVE_LEASE_STALE_MS;
  return live && !stale;
}
function leaseBusyError(featureId, transactionId, lease) {
  return new DevFlowError("ROLLBACK_TRANSACTION_BUSY", "another host is already driving this rollback transaction", {
    transactionId,
    featureId,
    ownerId: lease.ownerId,
    pid: lease.pid,
    hostname: lease.hostname,
    recoveryHint: "Wait for the other host to finish, or resume after its process exits and the lease ages out"
  });
}
async function claimRollbackDriveLease(root2, featureId, transactionId) {
  const release = await lock(root2, featureId, "claim-rollback-drive");
  try {
    const journal = await readRollbackTransaction(root2, featureId);
    if (!journal || rollbackTransactionFinished(journal)) {
      throw new DevFlowError("ROLLBACK_TRANSACTION_MISMATCH", "no open rollback transaction to drive", {
        featureId,
        transactionId
      });
    }
    if (journal.transactionId !== transactionId) {
      throw new DevFlowError("ROLLBACK_TRANSACTION_MISMATCH", "rollback transaction id does not match the open journal", {
        openTransactionId: journal.transactionId,
        transactionId
      });
    }
    const leases = await readDriveLeases(root2, featureId, transactionId);
    for (const existing of [leases.sidecar, leases.legacy]) {
      if (existing && activeLease(existing)) {
        throw leaseBusyError(featureId, transactionId, existing);
      }
    }
    const lease = {
      schemaVersion: 1,
      transactionId,
      featureId,
      ownerId: randomUUID11(),
      pid: process.pid,
      hostname: hostname(),
      acquiredAt: (/* @__PURE__ */ new Date()).toISOString(),
      heartbeatAt: (/* @__PURE__ */ new Date()).toISOString()
    };
    await writeDriveLeasePair(root2, featureId, transactionId, lease);
    return lease;
  } finally {
    await release();
  }
}
async function renewRollbackDriveLease(root2, featureId, lease) {
  const release = await lock(root2, featureId, "renew-rollback-drive");
  try {
    const leases = await readDriveLeases(root2, featureId, lease.transactionId);
    const existing = leases.sidecar ?? leases.legacy;
    if (!existing) {
      throw new DevFlowError("ROLLBACK_TRANSACTION_MISMATCH", "rollback drive lease disappeared while being renewed", {
        transactionId: lease.transactionId
      });
    }
    for (const candidate of [leases.sidecar, leases.legacy]) {
      if (candidate && candidate.ownerId !== lease.ownerId) {
        throw leaseBusyError(featureId, lease.transactionId, candidate);
      }
    }
    const renewed = { ...existing, heartbeatAt: (/* @__PURE__ */ new Date()).toISOString() };
    await writeDriveLeasePair(root2, featureId, lease.transactionId, renewed);
  } finally {
    await release();
  }
}
function maintainRollbackDriveLease(root2, featureId, lease) {
  let stopped = false;
  let inFlight2;
  let failure2;
  const renew = () => {
    if (stopped || failure2) return inFlight2 ?? Promise.resolve();
    if (!inFlight2) {
      inFlight2 = renewRollbackDriveLease(root2, featureId, lease).catch((error) => {
        failure2 = error;
      }).finally(() => {
        inFlight2 = void 0;
      });
    }
    return inFlight2;
  };
  const interval = setInterval(() => {
    void renew();
  }, ROLLBACK_DRIVE_LEASE_HEARTBEAT_MS);
  interval.unref();
  return {
    assertOwned() {
      if (!failure2) return;
      if (failure2 instanceof DevFlowError && failure2.code === "ROLLBACK_TRANSACTION_BUSY") throw failure2;
      throw new DevFlowError("ROLLBACK_TRANSACTION_BUSY", "rollback drive lease could not be renewed; refusing to continue this driver", {
        transactionId: lease.transactionId,
        cause: failure2 instanceof DevFlowError ? failure2.code : String(failure2),
        recoveryHint: "Wait for the current driver to finish, then resume the open rollback transaction"
      });
    },
    async stop() {
      stopped = true;
      clearInterval(interval);
      await inFlight2;
    }
  };
}
async function releaseRollbackDriveLease(root2, featureId, lease) {
  const release = await lock(root2, featureId, "release-rollback-drive");
  try {
    const sidecarFile = driveLeasePath(root2, featureId, lease.transactionId);
    const legacyFile = legacyDriveLeasePath(root2, featureId, lease.transactionId);
    let sidecar;
    try {
      sidecar = JSON.parse(await readFile14(sidecarFile, "utf8"));
    } catch {
    }
    if (sidecar?.ownerId === lease.ownerId) {
      await rm(sidecarFile, { force: true });
    }
    try {
      const legacyExisting = JSON.parse(await readFile14(legacyFile, "utf8"));
      if (legacyExisting?.ownerId === lease.ownerId) {
        await rm(legacyFile, { force: true });
      }
    } catch {
    }
    try {
      await rmdir(path18.dirname(legacyFile));
    } catch {
    }
  } finally {
    await release();
  }
}

// plugins/dev-flow/src/core/rollback.ts
var digest11 = (value) => createHash27("sha256").update(value).digest("hex");
function rollbackNodes(nodes) {
  return Object.values(nodes).filter((node) => node.kind === "implementation-unit" && node.status === "current");
}
function expectedTipState(chain) {
  const present = /* @__PURE__ */ new Map();
  const absent = /* @__PURE__ */ new Set();
  for (const manifest of chain) {
    for (const record of manifest.files) {
      if (record.change === "deleted") {
        present.delete(record.path);
        absent.add(record.path);
        continue;
      }
      if (record.change === "renamed") {
        present.delete(record.renamedFrom);
        absent.add(record.renamedFrom);
      }
      present.set(record.path, { sha256: record.afterSha256, mode: record.afterMode });
      absent.delete(record.path);
    }
  }
  return { present, absent };
}
function detectChainConflicts(chain, snapshot, fileScopes, baselineFiles = []) {
  const conflicts = [];
  const { present: expected, absent } = expectedTipState(chain);
  const baseline = new Map(baselineFiles.map((file) => [file.path, file]));
  const current = new Map(snapshot.map((file) => [file.path, file]));
  for (const [filePath, tip] of expected) {
    const present = current.get(filePath);
    if (!present) {
      conflicts.push({ path: filePath, expected: "checkpointed", actual: "missing" });
    } else if (present.sha256 !== tip.sha256 || present.mode !== tip.mode) {
      conflicts.push({ path: filePath, expected: "checkpointed", actual: "modified" });
    }
  }
  for (const filePath of absent) {
    if (current.has(filePath)) {
      conflicts.push({ path: filePath, expected: "absent", actual: "unregistered" });
    }
  }
  for (const file of snapshot) {
    if (expected.has(file.path) || absent.has(file.path)) continue;
    const base = baseline.get(file.path);
    if (base) {
      if (file.sha256 !== base.sha256 || file.mode !== base.mode) {
        conflicts.push({ path: file.path, expected: "checkpointed", actual: "modified" });
      }
      continue;
    }
    if (pathWithinFileScope(file.path, fileScopes)) {
      conflicts.push({ path: file.path, expected: "absent", actual: "unregistered" });
    }
  }
  for (const file of baselineFiles) {
    if (expected.has(file.path) || absent.has(file.path)) continue;
    if (!current.has(file.path)) {
      conflicts.push({ path: file.path, expected: "checkpointed", actual: "missing" });
    }
  }
  return conflicts.sort((a, b) => a.path.localeCompare(b.path));
}
function assertChainIntegrity(chain, nodes) {
  const checkpointedUnits = new Set(chain.map((manifest) => manifest.unitId));
  for (const [index, manifest] of chain.entries()) {
    const node = nodes.find((candidate) => candidate.id === manifest.unitId);
    if (!node) {
      throw new DevFlowError("ROLLBACK_CHAIN_INVALID", "checkpoint chain references a unit that is not current in the trace graph", {
        unitId: manifest.unitId
      });
    }
    for (const dependency of node.dependsOn) {
      const dependencyIndex = chain.findIndex((candidate) => candidate.unitId === dependency);
      if (dependencyIndex === -1 && !checkpointedUnits.has(dependency)) {
        throw new DevFlowError("ROLLBACK_CHAIN_INVALID", "checkpoint chain has a dependency hole", {
          unitId: manifest.unitId,
          missingDependency: dependency
        });
      }
      if (dependencyIndex > index) {
        throw new DevFlowError("ROLLBACK_CHAIN_INVALID", "checkpoint chain order violates the rollback DAG", {
          unitId: manifest.unitId,
          dependency
        });
      }
    }
  }
}
function liveChain(state, chain) {
  const liveIds = new Set(
    (state.implementationUnits ?? []).filter((unit) => unit.status === "checkpointed" && unit.checkpointId).map((unit) => unit.checkpointId)
  );
  return chain.filter((manifest) => liveIds.has(manifest.checkpointId));
}
async function previewContext(root2, featureId) {
  const state = await readState(root2, featureId);
  if (!checkpointsEnforcementRequired(state.route, state.classification.controls)) {
    throw new DevFlowError("IMPLEMENTATION_UNITS_NOT_ENFORCED", "\u56DE\u64A4\u9884\u89C8\u8981\u6C42\u52A8\u6001\u8DEF\u7EBF\u542F\u7528 unit-chain checkpoint \u63A7\u5236\u3002");
  }
  const ledger = await readTraceability(root2, state);
  const nodes = rollbackNodes(ledger.nodes);
  const chain = liveChain(state, await checkpointChain(root2, featureId, state));
  assertChainIntegrity(chain, nodes);
  const { config, sha256: projectConfigSha256 } = await readProjectConfigSnapshot(root2);
  const verificationRefs = chain.flatMap((manifest) => manifest.verificationCommands.map((command2) => command2.commandId));
  const verificationCommandHashes2 = Object.fromEntries(verificationRefs.filter((id) => config.verification.commands.some((command2) => command2.id === id)).map((id) => [id, verificationCommandHashesForRefs(config, [id])[id]]).filter((entry) => typeof entry[1] === "string"));
  return { state, chain, nodes, config, projectConfigSha256, verificationCommandHashes: verificationCommandHashes2 };
}
function commandSummary2(command2) {
  return [command2.command, ...command2.args].join(" ");
}
async function previewRollback(root2, featureId, targetCheckpointId) {
  const { state, chain, nodes, config, projectConfigSha256, verificationCommandHashes: verificationCommandHashes2 } = await previewContext(root2, featureId);
  const target = chain.find((manifest) => manifest.checkpointId === targetCheckpointId);
  if (!target) {
    throw new DevFlowError("ROLLBACK_TARGET_INVALID", "rollback target is not a confirmed checkpoint in the live chain", {
      targetCheckpointId,
      validTargets: chain.map((manifest) => manifest.checkpointId)
    });
  }
  const suffix = chain.filter((manifest) => manifest.sequence > target.sequence);
  if (!suffix.length) {
    throw new DevFlowError("ROLLBACK_TARGET_INVALID", "rollback target is the live chain tip; there is nothing to undo", {
      targetCheckpointId
    });
  }
  const stale = suffix.filter((manifest) => manifest.verificationCommandHashes ? Object.entries(manifest.verificationCommandHashes).some(([id, hash2]) => verificationCommandHashes2[id] !== hash2) : manifest.projectConfigSha256 !== projectConfigSha256);
  if (stale.length) {
    throw new DevFlowError("ROLLBACK_BASIS_STALE", "project verification config changed after these checkpoints", {
      checkpointIds: stale.map((manifest) => manifest.checkpointId)
    });
  }
  const snapshot = await snapshotGovernedRoots(root2, config);
  const fileScopes = [...new Set(nodes.flatMap((node) => node.fileScope))];
  const baselineFiles = (await readCheckpointBaseline(root2, featureId, chain[0].unitId)).files;
  const conflicts = detectChainConflicts(chain, snapshot, fileScopes, baselineFiles);
  if (conflicts.length) {
    throw new DevFlowError("ROLLBACK_CONFLICT", "workspace has unregistered modifications; rollback would overwrite them", {
      conflicts
    });
  }
  const undoManifests = [...suffix].reverse();
  const verificationCommands = [];
  for (const manifest of undoManifests) {
    const node = nodes.find((candidate) => candidate.id === manifest.unitId);
    for (const [index, reference] of (node?.forwardVerification ?? []).entries()) {
      const command2 = typeof reference === "string" ? config.verification.commands.find((candidate) => candidate.id === reference) : {
        id: `inline:${manifest.unitId}:${index}`,
        command: reference.command,
        args: [...reference.args ?? []],
        cwd: reference.cwd ?? ".",
        provides: ["targeted"]
      };
      if (!command2) {
        throw new DevFlowError("TRACE_VERIFICATION_COMMAND_UNKNOWN", "rollback verification command is not configured", {
          unitId: manifest.unitId,
          commandId: reference
        });
      }
      verificationCommands.push({ commandId: command2.id, command: commandSummary2(command2) });
    }
  }
  const filePlan = /* @__PURE__ */ new Map();
  const planAction = (path25, action) => {
    filePlan.set(path25, action);
  };
  for (const manifest of undoManifests) {
    for (const record of manifest.files) {
      switch (record.change) {
        case "added":
          planAction(record.path, { action: "delete", path: record.path });
          break;
        case "renamed":
          planAction(record.path, { action: "delete", path: record.path });
          planAction(record.renamedFrom, {
            action: "restore",
            path: record.renamedFrom,
            blobSha256: record.beforeBlobSha256,
            mode: record.beforeMode,
            kind: record.beforeKind
          });
          break;
        case "deleted":
        case "modified":
        case "mode-changed":
          planAction(record.path, {
            action: "restore",
            path: record.path,
            blobSha256: record.beforeBlobSha256,
            mode: record.beforeMode,
            kind: record.beforeKind
          });
          break;
      }
    }
  }
  const plan = [...filePlan.values()].sort((a, b) => a.path.localeCompare(b.path));
  const previewBasisHash = digest11(canonicalReviewValueJson({
    targetCheckpointId,
    targetUnitId: target.unitId,
    undoOrder: undoManifests.map((manifest) => manifest.unitId),
    filePlan: plan,
    verificationCommands,
    projectConfigSha256,
    verificationCommandHashes: verificationCommandHashes2,
    traceabilitySha256: state.traceability?.sha256 ?? null
  }));
  return {
    targetCheckpointId,
    targetUnitId: target.unitId,
    undoOrder: undoManifests.map((manifest) => manifest.unitId),
    undoCheckpoints: undoManifests.map((manifest) => manifest.checkpointId),
    filePlan: plan,
    verificationCommands,
    projectConfigSha256,
    verificationCommandHashes: verificationCommandHashes2,
    previewBasisHash
  };
}
async function presentRollbackGate(root2, featureId, expectedRevision, targetCheckpointId) {
  const initial = await readState(root2, featureId);
  if (initial.revision !== expectedRevision) {
    throw new DevFlowError("STATE_REVISION_CONFLICT", "state revision changed", { currentRevision: initial.revision });
  }
  if (!rollbackExecutionAllowed(initial.route, initial.classification.controls)) {
    throw new DevFlowError("ROLLBACK_EXECUTION_NOT_ALLOWED", "\u5F53\u524D\u52A8\u6001\u8DEF\u7EBF\u6CA1\u6709\u542F\u7528 executable-rollback \u4E0E unit-chain \u63A7\u5236\u3002");
  }
  if (initial.lifecycle !== "active") {
    throw new DevFlowError("INVALID_LIFECYCLE", "rollback gate requires an active feature");
  }
  if (initial.rollbackGate?.status === "pending") {
    throw new DevFlowError("ROLLBACK_GATE_ALREADY_PRESENTED", "a rollback confirmation gate is already pending", {
      interactionId: initial.rollbackGate.interactionId
    });
  }
  const preview = await previewRollback(root2, featureId, targetCheckpointId);
  let interaction;
  const state = await mutate(root2, featureId, expectedRevision, "rollback-gate-presented", async (state2) => {
    if (!rollbackExecutionAllowed(state2.route, state2.classification.controls)) {
      throw new DevFlowError("ROLLBACK_EXECUTION_NOT_ALLOWED", "\u5F53\u524D\u52A8\u6001\u8DEF\u7EBF\u6CA1\u6709\u542F\u7528 executable-rollback \u4E0E unit-chain \u63A7\u5236\u3002");
    }
    if (state2.lifecycle !== "active") {
      throw new DevFlowError("INVALID_LIFECYCLE", "rollback gate requires an active feature");
    }
    if (state2.rollbackGate?.status === "pending") {
      throw new DevFlowError("ROLLBACK_GATE_ALREADY_PRESENTED", "a rollback confirmation gate was presented concurrently");
    }
    interaction = createInteraction(state2, {
      kind: "rollback-confirmation",
      target: `rollback:${targetCheckpointId}`,
      basisHash: preview.previewBasisHash,
      options: [
        { id: "confirm", label: "\u786E\u8BA4\u56DE\u64A4" },
        { id: "request-changes", label: "\u63D0\u51FA\u4FEE\u6539\u610F\u89C1", requiresComment: true }
      ]
    });
    state2.rollbackGate = {
      status: "pending",
      targetCheckpointId: preview.targetCheckpointId,
      targetUnitId: preview.targetUnitId,
      previewBasisHash: preview.previewBasisHash,
      interactionId: interaction.id,
      stateRevision: state2.revision,
      presentedAt: (/* @__PURE__ */ new Date()).toISOString()
    };
  }, () => ({
    gate: "rollback-confirmation",
    targetCheckpointId,
    interactionId: interaction?.id,
    presentationEventId: interaction?.presentationEventId
  }));
  if (!interaction) throw new DevFlowError("INTERACTION_NOT_CREATED", targetCheckpointId);
  return { state, interaction: toPublicInteraction(interaction), interactionId: interaction.id, preview };
}
async function resolveRollbackGateForAnswer(ctx) {
  const { root: root2, featureId, expectedRevision, host, credential, interaction, state } = ctx;
  if (interaction.kind !== "rollback-confirmation" || interaction.status !== "pending") {
    throw new DevFlowError("INTERACTION_NOT_PENDING", interaction.id);
  }
  const gate = state.rollbackGate;
  if (!gate || gate.status !== "pending" || gate.interactionId !== interaction.id) {
    throw new DevFlowError("ROLLBACK_GATE_NOT_PENDING", "rollback gate is not pending or belongs to a different interaction");
  }
  let currentPreview;
  try {
    currentPreview = await previewRollback(root2, featureId, gate.targetCheckpointId);
  } catch (err) {
    if (err instanceof DevFlowError) {
      await mutate(root2, featureId, expectedRevision, "rollback-gate-stale", async (draft) => {
        if (draft.rollbackGate?.interactionId === interaction.id) {
          delete draft.rollbackGate;
          clearInteractionsForTarget(draft, `rollback:${gate.targetCheckpointId}`);
        }
      });
      throw new DevFlowError("ROLLBACK_GATE_BASIS_CHANGED", "rollback preview failed or basis changed since gate was presented; the pending gate has been cleared", {
        originalError: err.code,
        recoveryHint: "Resolve the conflict or update checkpoints, then present the rollback gate again"
      });
    }
    throw err;
  }
  if (currentPreview.previewBasisHash !== gate.previewBasisHash) {
    await mutate(root2, featureId, expectedRevision, "rollback-gate-stale", async (draft) => {
      if (draft.rollbackGate?.interactionId === interaction.id) {
        delete draft.rollbackGate;
        clearInteractionsForTarget(draft, `rollback:${gate.targetCheckpointId}`);
      }
    });
    throw new DevFlowError("ROLLBACK_GATE_BASIS_CHANGED", "rollback preview basis hash changed since gate was presented; the pending gate has been cleared", {
      recoveryHint: "Present the rollback gate again after updating checkpoint state"
    });
  }
  let promptEventId;
  let promptText;
  if (credential.source === "text") {
    const events = await readFeatureEvents(root2, featureId);
    promptEventId = resolveInteractionPromptEvent(events, state, interaction, {
      host,
      userReply: credential.userReply
    }).eventId;
    const eventRecord = events.find(
      (item) => item.type === "host-event" && item.data.eventId === promptEventId
    );
    if (!eventRecord) {
      throw new DevFlowError("ROLLBACK_GATE_PROVENANCE_UNAVAILABLE", "no matching host event found for the given promptEventId", {
        recoveryHint: "Ensure the host UserPromptSubmit hook is active, then submit one exact approval reply and retry"
      });
    }
    const event = eventRecord.data;
    promptText = typeof event.text === "string" ? event.text : void 0;
    if (event.host !== host) {
      throw new DevFlowError("HOST_EVENT_HOST_MISMATCH", "host event belongs to a different host", {
        expectedHost: host,
        actualHost: event.host,
        eventId: promptEventId
      });
    }
    if (event.type !== "user-prompt") {
      throw new DevFlowError("ROLLBACK_GATE_PROVENANCE_UNAVAILABLE", "the event referenced by promptEventId is not a user prompt; tool events cannot confirm a gate", {
        recoveryHint: "Submit the confirmation reply in a user message, not through a tool callback"
      });
    }
    if (eventRecord.revision <= gate.stateRevision) {
      throw new DevFlowError("ROLLBACK_GATE_SAME_TURN", "confirmation must come from a later user turn after gate presentation", {
        recoveryHint: "Submit the confirmation reply in a later user message"
      });
    }
    if (Date.parse(event.at ?? "") < Date.parse(gate.presentedAt)) {
      throw new DevFlowError("ROLLBACK_GATE_SAME_TURN", "confirmation event timestamp is before gate presentation", {
        recoveryHint: "Submit the confirmation reply after the gate has been presented"
      });
    }
    if (!textCompatible(event.text ?? "", credential.userReply)) {
      throw new DevFlowError("ROLLBACK_GATE_REPLY_MISMATCH", "userReply must be compatible with the captured prompt text", {
        recoveryHint: "Pass the user prompt text that was captured for this event"
      });
    }
  }
  let response;
  const next = await mutatePrepared(root2, featureId, expectedRevision, "rollback-gate-resolved", async (current) => {
    const currentGate = current.rollbackGate;
    if (!currentGate || currentGate.status !== "pending" || currentGate.interactionId !== interaction.id) {
      throw new DevFlowError("ROLLBACK_GATE_NOT_PENDING", "rollback gate was resolved concurrently");
    }
    return {
      mutate: (draft) => {
        response = resolveResponseForAnswer(draft, interaction, {
          source: credential.source,
          action: credential.source === "elicitation" ? credential.action : void 0,
          comment: credential.source === "elicitation" ? credential.comment : void 0,
          userReply: credential.source === "text" ? credential.userReply : void 0,
          promptText,
          promptEventId,
          host
        });
        if (response.action === "confirm") {
          draft.rollbackGate = {
            ...currentGate,
            status: "confirmed",
            confirmedAt: (/* @__PURE__ */ new Date()).toISOString()
          };
        } else if (response.action === "request-changes") {
          delete draft.rollbackGate;
          clearInteractionsForTarget(draft, `rollback:${gate.targetCheckpointId}`);
        } else {
          throw new DevFlowError("INTERACTION_ACTION_INVALID", response.action);
        }
        draft.lastUpdatedBy = { host, pluginVersion: "5.1.0" };
      },
      eventData: () => ({ gate: "rollback-confirmation", interactionId: interaction.id, response })
    };
  });
  if (!response) throw new DevFlowError("INTERACTION_NOT_RESOLVED", interaction.id);
  return { state: next, action: response.action, ...response.comment ? { comment: response.comment } : {} };
}
var featureDirectory4 = (root2, featureId) => path19.join(root2, ".dev-flow", "features", featureId);
async function pathExists3(file) {
  try {
    await access3(file);
    return true;
  } catch {
    return false;
  }
}
async function fsyncDirectory4(directory) {
  const handle = await open6(directory, "r");
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}
async function writeFileAtomicMode(file, bytes, mode) {
  await mkdir10(path19.dirname(file), { recursive: true });
  const temp = `${file}.${randomUUID12()}.tmp`;
  const handle = await open6(temp, "w");
  try {
    await handle.writeFile(bytes);
    await handle.sync();
  } finally {
    await handle.close();
  }
  await chmod(temp, Number.parseInt(mode, 8));
  await rename5(temp, file);
  await fsyncDirectory4(path19.dirname(file));
}
async function writeSymlinkAtomic(file, target) {
  await mkdir10(path19.dirname(file), { recursive: true });
  const temp = `${file}.${randomUUID12()}.tmp`;
  await symlink(target, temp);
  await rename5(temp, file);
  await fsyncDirectory4(path19.dirname(file));
}
async function writeAtomicBuffer(file, contents) {
  await mkdir10(path19.dirname(file), { recursive: true });
  const temp = `${file}.${randomUUID12()}.tmp`;
  const handle = await open6(temp, "w");
  try {
    await handle.writeFile(contents);
    await handle.sync();
  } finally {
    await handle.close();
  }
  await rename5(temp, file);
  await fsyncDirectory4(path19.dirname(file));
}
function validateBackupManifest(value, transactionId) {
  const manifest = value;
  const files = manifest?.files;
  if (!manifest || manifest.schemaVersion !== 1 || manifest.transactionId !== transactionId || typeof manifest.featureId !== "string" || typeof manifest.capturedAt !== "string" || !Array.isArray(files) || !files.every((file) => file && typeof file.path === "string" && /^[a-f0-9]{64}$/.test(file.sha256) && /^[0-7]{3,4}$/.test(file.mode))) {
    throw new DevFlowError("ROLLBACK_BACKUP_CORRUPT", "rollback backup manifest is invalid", { transactionId });
  }
}
async function readBackupManifest(manifestFile, transactionId) {
  let raw;
  try {
    raw = await readFile15(manifestFile, "utf8");
  } catch {
    throw new DevFlowError("ROLLBACK_BACKUP_CORRUPT", "rollback backup manifest is missing", { transactionId });
  }
  try {
    const parsed = JSON.parse(raw);
    validateBackupManifest(parsed, transactionId);
    return parsed;
  } catch (error) {
    if (error instanceof DevFlowError) throw error;
    throw new DevFlowError("ROLLBACK_BACKUP_CORRUPT", "rollback backup manifest is unreadable", { transactionId });
  }
}
function snapshotMismatches(expected, current) {
  const mismatches = [];
  const expectedByPath = new Map(expected.map((file) => [file.path, file]));
  const currentByPath = new Map(current.map((file) => [file.path, file]));
  for (const [filePath, file] of expectedByPath) {
    const actual = currentByPath.get(filePath);
    if (!actual) {
      mismatches.push({ path: filePath, expected: "present", actual: "absent" });
    } else if (actual.sha256 !== file.sha256 || actual.mode !== file.mode || (actual.kind ?? "file") !== (file.kind ?? "file")) {
      mismatches.push({ path: filePath, expected: "present", actual: "changed" });
    }
  }
  for (const filePath of currentByPath.keys()) {
    if (!expectedByPath.has(filePath)) {
      mismatches.push({ path: filePath, expected: "absent", actual: "present" });
    }
  }
  return mismatches.sort((a, b) => a.path.localeCompare(b.path));
}
async function assertWorkspaceMatchesChainTip(root2, featureId, config) {
  const state = await readState(root2, featureId);
  const chain = liveChain(state, await checkpointChain(root2, featureId, state));
  const nodes = rollbackNodes((await readTraceability(root2, state)).nodes);
  const fileScopes = [...new Set(nodes.flatMap((node) => node.fileScope))];
  const baselineFiles = chain.length ? (await readCheckpointBaseline(root2, featureId, chain[0].unitId)).files : [];
  const snapshot = await snapshotGovernedRoots(root2, config);
  const conflicts = detectChainConflicts(chain, snapshot, fileScopes, baselineFiles);
  if (conflicts.length) {
    throw new DevFlowError("ROLLBACK_HASH_MISMATCH", "workspace drifted from the confirmed rollback basis; refusing to capture it as the pre-rollback backup", {
      conflicts,
      recoveryHint: "Restore the drifted files to their checkpointed bytes, then resume the rollback with the same target; run dev_flow_doctor to inspect the open transaction"
    });
  }
}
async function captureBackup(root2, featureId, journal, config, options) {
  const dir = path19.join(featureDirectory4(root2, featureId), journal.backupDirectory);
  const manifestFile = path19.join(dir, "backup-manifest.json");
  if (await pathExists3(manifestFile)) {
    const manifest2 = await readBackupManifest(manifestFile, journal.transactionId);
    const current = await snapshotGovernedRoots(root2, config);
    const mismatches = snapshotMismatches(manifest2.files, current);
    if (mismatches.length) {
      throw new DevFlowError("ROLLBACK_HASH_MISMATCH", "workspace drifted from the recorded rollback backup", { mismatches });
    }
    return;
  }
  await assertWorkspaceMatchesChainTip(root2, featureId, config);
  await mkdir10(path19.join(dir, "files"), { recursive: true });
  await mkdir10(path19.join(dir, "trash"), { recursive: true });
  const snapshot = await snapshotGovernedRoots(root2, config);
  let first = true;
  for (const file of snapshot) {
    const bytes = file.kind === "symlink" ? Buffer.from(await readlink4(path19.join(root2, file.path))) : await readFile15(path19.join(root2, file.path));
    if (digest11(bytes) !== file.sha256) {
      throw new DevFlowError("ROLLBACK_HASH_MISMATCH", "protected files changed while capturing the rollback backup", { path: file.path });
    }
    const blobFile = path19.join(dir, "files", file.sha256);
    if (!await pathExists3(blobFile)) await writeAtomicBuffer(blobFile, bytes);
    if (first) {
      first = false;
      await options.fault?.("during-backup");
    }
  }
  const manifest = {
    schemaVersion: 1,
    transactionId: journal.transactionId,
    featureId,
    capturedAt: (/* @__PURE__ */ new Date()).toISOString(),
    files: snapshot
  };
  await writeAtomicBuffer(manifestFile, `${JSON.stringify(manifest, null, 2)}
`);
  const captureDrift = snapshotMismatches(manifest.files, await snapshotGovernedRoots(root2, config));
  if (captureDrift.length) {
    throw new DevFlowError("ROLLBACK_HASH_MISMATCH", "protected files changed while capturing the rollback backup", { mismatches: captureDrift });
  }
}
async function assertPathMatchesBackupExpectation(root2, filePath, expected) {
  const absolute = path19.join(root2, filePath);
  if (expected) {
    let metadata;
    let bytes;
    try {
      metadata = await lstat6(absolute);
      bytes = expected.kind === "symlink" ? Buffer.from(await readlink4(absolute)) : await readFile15(absolute);
    } catch {
      throw new DevFlowError("ROLLBACK_HASH_MISMATCH", "workspace drifted from the pre-rollback backup before a file action", {
        path: filePath,
        expected: "present",
        actual: "missing",
        recoveryHint: "Restore the drifted path to its pre-rollback bytes, then resume the rollback with the same target"
      });
    }
    const mode = (metadata.mode & 511).toString(8).padStart(3, "0");
    const kind = metadata.isSymbolicLink() ? "symlink" : "file";
    if (digest11(bytes) !== expected.sha256 || mode !== expected.mode || kind !== (expected.kind ?? "file")) {
      throw new DevFlowError("ROLLBACK_HASH_MISMATCH", "workspace drifted from the pre-rollback backup before a file action", {
        path: filePath,
        expected: "present",
        actual: "changed",
        recoveryHint: "Restore the drifted path to its pre-rollback bytes, then resume the rollback with the same target"
      });
    }
    return;
  }
  if (await pathExists3(absolute)) {
    throw new DevFlowError("ROLLBACK_HASH_MISMATCH", "workspace drifted from the pre-rollback backup before a file action", {
      path: filePath,
      expected: "absent",
      actual: "present",
      recoveryHint: "Remove the unregistered path, then resume the rollback with the same target"
    });
  }
}
async function applyFilePlan(root2, featureId, journal, options) {
  const dir = path19.join(featureDirectory4(root2, featureId), journal.backupDirectory);
  const trash = path19.join(dir, "trash");
  const backup = await readBackupManifest(path19.join(dir, "backup-manifest.json"), journal.transactionId);
  const expectedByPath = new Map(backup.files.map((file) => [file.path, file]));
  for (let index = journal.nextFileIndex; index < journal.filePlan.length; index += 1) {
    const action = journal.filePlan[index];
    if (index === 0) await options.fault?.("before-first-rename");
    await assertPathMatchesBackupExpectation(root2, action.path, expectedByPath.get(action.path));
    const target = path19.join(root2, action.path);
    if (action.action === "restore") {
      const blobFile = path19.join(featureDirectory4(root2, featureId), blobPath(action.blobSha256));
      let bytes;
      try {
        bytes = await readFile15(blobFile);
      } catch {
        throw new DevFlowError("ROLLBACK_CHECKPOINT_CORRUPT", "checkpoint blob is missing", {
          blobSha256: action.blobSha256,
          path: action.path
        });
      }
      if (digest11(bytes) !== action.blobSha256) {
        throw new DevFlowError("ROLLBACK_CHECKPOINT_CORRUPT", "checkpoint blob failed its digest check", {
          blobSha256: action.blobSha256,
          path: action.path
        });
      }
      if (action.kind === "symlink") await writeSymlinkAtomic(target, bytes.toString("utf8"));
      else await writeFileAtomicMode(target, bytes, action.mode);
    } else {
      const trashFile = path19.join(trash, `${String(index).padStart(4, "0")}-${path19.basename(action.path)}`);
      if (await pathExists3(target)) {
        await mkdir10(trash, { recursive: true });
        await rename5(target, trashFile);
        await fsyncDirectory4(path19.dirname(target));
        await fsyncDirectory4(trash);
      } else if (!await pathExists3(trashFile)) {
        throw new DevFlowError("ROLLBACK_HASH_MISMATCH", "file planned for deletion vanished outside the transaction", { path: action.path });
      }
    }
    journal.nextFileIndex = index + 1;
    await writeRollbackTransaction(root2, featureId, journal);
    const progressive = await expectedPlanStateAfter(root2, featureId, journal, journal.nextFileIndex);
    for (const action2 of journal.filePlan.slice(0, journal.nextFileIndex)) {
      const expected = progressive.find((file) => file.path === action2.path);
      if (action2.action === "delete") {
        if (await pathExists3(path19.join(root2, action2.path))) {
          throw new DevFlowError("ROLLBACK_HASH_MISMATCH", "workspace drifted after a rollback file action", {
            path: action2.path,
            source: "post-plan",
            expected: "absent",
            actual: "present",
            recoveryHint: "Restore the drifted path to the post-plan state, then resume the rollback with the same target"
          });
        }
      } else if (expected) {
        let metadata;
        let bytes;
        try {
          metadata = await lstat6(path19.join(root2, action2.path));
          bytes = expected.kind === "symlink" ? Buffer.from(await readlink4(path19.join(root2, action2.path))) : await readFile15(path19.join(root2, action2.path));
        } catch {
          throw new DevFlowError("ROLLBACK_HASH_MISMATCH", "workspace drifted after a rollback file action", {
            path: action2.path,
            source: "post-plan",
            expected: "present",
            actual: "missing",
            recoveryHint: "Restore the drifted path to the post-plan state, then resume the rollback with the same target"
          });
        }
        const mode = (metadata.mode & 511).toString(8).padStart(3, "0");
        if (digest11(bytes) !== expected.sha256 || mode !== expected.mode) {
          throw new DevFlowError("ROLLBACK_HASH_MISMATCH", "workspace drifted after a rollback file action", {
            path: action2.path,
            source: "post-plan",
            expected: "present",
            actual: "changed",
            recoveryHint: "Restore the drifted path to the post-plan state, then resume the rollback with the same target"
          });
        }
      }
    }
    if (index === 0) await options.fault?.("after-first-rename");
  }
  journal.phase = "verifying";
  await writeRollbackTransaction(root2, featureId, journal);
}
async function transactionVerificationCommands(root2, featureId, journal, config) {
  const state = await readState(root2, featureId);
  const nodes = rollbackNodes((await readTraceability(root2, state)).nodes);
  const plan = [];
  for (const unitId of journal.undoOrder) {
    const node = nodes.find((candidate) => candidate.id === unitId);
    if (!node) {
      throw new DevFlowError("ROLLBACK_CHAIN_INVALID", "undo unit is not current in the trace graph", { unitId });
    }
    for (const [index, reference] of node.forwardVerification.entries()) {
      const command2 = typeof reference === "string" ? config.verification.commands.find((candidate) => candidate.id === reference) : {
        id: `inline:${unitId}:${index}`,
        command: reference.command,
        args: [...reference.args ?? []],
        cwd: reference.cwd ?? ".",
        provides: ["targeted"]
      };
      if (!command2) {
        throw new DevFlowError("TRACE_VERIFICATION_COMMAND_UNKNOWN", "rollback verification command is not configured", {
          unitId,
          commandId: reference
        });
      }
      plan.push({ unitId, command: command2 });
    }
  }
  return plan;
}
async function expectedPlanStateAfter(root2, featureId, journal, appliedCount) {
  const manifest = await readBackupManifest(
    path19.join(featureDirectory4(root2, featureId), journal.backupDirectory, "backup-manifest.json"),
    journal.transactionId
  );
  const expected = new Map(manifest.files.map((file) => [file.path, { ...file }]));
  for (const action of journal.filePlan.slice(0, appliedCount)) {
    if (action.action === "restore") {
      expected.set(action.path, { path: action.path, sha256: action.blobSha256, mode: action.mode, kind: action.kind ?? "file" });
    } else {
      expected.delete(action.path);
    }
  }
  return [...expected.values()].sort((a, b) => a.path.localeCompare(b.path));
}
async function expectedPlanState(root2, featureId, journal) {
  return expectedPlanStateAfter(root2, featureId, journal, journal.filePlan.length);
}
async function recordVerificationAttempt(root2, featureId, journal, attempt) {
  const attemptId = randomUUID12();
  const state = await readState(root2, featureId);
  await appendFeatureEvent(root2, featureId, state.revision, "rollback-verification-attempt", {
    attemptId,
    transactionId: journal.transactionId,
    ...attempt
  });
  journal.verificationAttemptIds.push(attemptId);
  await writeRollbackTransaction(root2, featureId, journal);
  return attemptId;
}
async function runRollbackVerification(root2, featureId, journal, config, options) {
  await options.fault?.("before-verification");
  const commands = await transactionVerificationCommands(root2, featureId, journal, config);
  const events = await readFeatureEvents(root2, featureId);
  const passedByUnit = /* @__PURE__ */ new Map();
  for (const event of events) {
    if (event.type !== "rollback-verification-attempt") continue;
    const data = event.data;
    if (data.transactionId !== journal.transactionId || data.status !== "passed" || !data.unitId || !data.commandId) continue;
    const passed = passedByUnit.get(data.unitId) ?? /* @__PURE__ */ new Set();
    passed.add(data.commandId);
    passedByUnit.set(data.unitId, passed);
  }
  for (const { unitId, command: command2 } of commands) {
    if (passedByUnit.get(unitId)?.has(command2.id)) continue;
    const startedAt = (/* @__PURE__ */ new Date()).toISOString();
    const result = await runVerificationCommand(root2, command2);
    const attemptId = await recordVerificationAttempt(root2, featureId, journal, {
      unitId,
      commandId: command2.id,
      command: commandSummary2(command2),
      status: result.exitCode === 0 ? "passed" : "failed",
      exitCode: result.exitCode,
      output: result.output.slice(-4e3),
      startedAt,
      completedAt: (/* @__PURE__ */ new Date()).toISOString()
    });
    if (result.exitCode !== 0) {
      throw new DevFlowError("ROLLBACK_VERIFICATION_FAILED", "rollback verification failed; the transaction compensates the workspace", {
        unitId,
        phase: "rollback",
        commandId: command2.id,
        command: commandSummary2(command2),
        cwd: command2.cwd,
        attemptId,
        exitCode: result.exitCode,
        outputTail: result.output.slice(-4e3),
        recoveryHint: "\u4FEE\u590D\u56DE\u64A4\u9A8C\u8BC1\u5931\u8D25\u539F\u56E0\u540E\uFF0C\u4F7F\u7528\u540C\u4E00\u4E8B\u52A1\u91CD\u8BD5\uFF1B\u4E8B\u52A1\u4F1A\u4FDD\u7559\u539F\u56DE\u64A4\u524D\u5907\u4EFD"
      });
    }
  }
  const expected = await expectedPlanState(root2, featureId, journal);
  const current = await snapshotGovernedRoots(root2, config);
  const mismatches = snapshotMismatches(expected, current);
  if (mismatches.length) {
    const attemptId = await recordVerificationAttempt(root2, featureId, journal, {
      unitId: null,
      commandId: "drift-guard",
      command: "governed-root drift guard",
      status: "failed",
      reason: "drift",
      mismatches,
      startedAt: (/* @__PURE__ */ new Date()).toISOString(),
      completedAt: (/* @__PURE__ */ new Date()).toISOString()
    });
    throw new DevFlowError("ROLLBACK_VERIFICATION_FAILED", "rollback verification changed protected files; the transaction compensates the workspace", {
      unitId: null,
      phase: "rollback",
      commandId: "drift-guard",
      command: "governed-root drift guard",
      cwd: ".",
      exitCode: 1,
      outputTail: "protected files differ from the expected rollback state",
      attemptId,
      mismatches,
      source: "verification-drift",
      recoveryHint: "\u68C0\u67E5\u56DE\u64A4\u9A8C\u8BC1\u662F\u5426\u5199\u5165\u53D7\u4FDD\u62A4\u6587\u4EF6\uFF0C\u7136\u540E\u6062\u590D\u5230\u9884\u671F\u56DE\u64A4\u72B6\u6001\u5E76\u91CD\u8BD5\u4E8B\u52A1"
    });
  }
}
async function recordCompensationAttempt(root2, featureId, journal, attempt) {
  const attemptId = randomUUID12();
  const state = await readState(root2, featureId);
  await appendFeatureEvent(root2, featureId, state.revision, "rollback-compensation-attempt", {
    attemptId,
    transactionId: journal.transactionId,
    status: attempt.status,
    ...attempt.reason ? { reason: attempt.reason } : {},
    ...attempt.mismatches ? { mismatches: attempt.mismatches } : {},
    startedAt: attempt.startedAt,
    completedAt: (/* @__PURE__ */ new Date()).toISOString()
  });
  journal.verificationAttemptIds.push(attemptId);
  await writeRollbackTransaction(root2, featureId, journal);
  return attemptId;
}
async function blockRecovery(root2, featureId, journal, message, details) {
  journal.error = message;
  await writeRollbackTransaction(root2, featureId, journal);
  throw new DevFlowError("ROLLBACK_RECOVERY_BLOCKED", "rollback recovery is blocked: compensation could not restore the pre-rollback workspace", {
    transactionId: journal.transactionId,
    backupDirectory: journal.backupDirectory,
    attemptIds: [...journal.verificationAttemptIds],
    ...details,
    recoveryHint: "Resolve the reported cause, then resume the same rollback transaction; the backup scene is preserved"
  });
}
async function compensateRollback(root2, featureId, journal, config, options) {
  if (journal.phase !== "compensating") {
    journal.phase = "compensating";
    await writeRollbackTransaction(root2, featureId, journal);
  }
  const dir = path19.join(featureDirectory4(root2, featureId), journal.backupDirectory);
  const startedAt = (/* @__PURE__ */ new Date()).toISOString();
  try {
    const manifest = await readBackupManifest(path19.join(dir, "backup-manifest.json"), journal.transactionId);
    let restored = 0;
    for (const file of manifest.files) {
      const blobFile = path19.join(dir, "files", file.sha256);
      let bytes;
      try {
        bytes = await readFile15(blobFile);
      } catch {
        throw new DevFlowError("ROLLBACK_BACKUP_CORRUPT", "rollback backup bytes are missing", { path: file.path, sha256: file.sha256 });
      }
      if (digest11(bytes) !== file.sha256) {
        throw new DevFlowError("ROLLBACK_BACKUP_CORRUPT", "rollback backup bytes failed their digest check", { path: file.path, sha256: file.sha256 });
      }
      if (file.kind === "symlink") await writeSymlinkAtomic(path19.join(root2, file.path), bytes.toString("utf8"));
      else await writeFileAtomicMode(path19.join(root2, file.path), bytes, file.mode);
      restored += 1;
      if (restored === 1) await options.fault?.("during-compensation");
    }
    const current = await snapshotGovernedRoots(root2, config);
    const expectedPaths = new Set(manifest.files.map((file) => file.path));
    const trash = path19.join(dir, "trash");
    for (const file of current) {
      if (expectedPaths.has(file.path)) continue;
      const trashFile = path19.join(trash, `extra-${digest11(file.path).slice(0, 16)}-${path19.basename(file.path)}`);
      await mkdir10(trash, { recursive: true });
      await rename5(path19.join(root2, file.path), trashFile);
      await fsyncDirectory4(path19.dirname(path19.join(root2, file.path)));
    }
    const after = await snapshotGovernedRoots(root2, config);
    const mismatches = snapshotMismatches(manifest.files, after);
    if (mismatches.length) {
      await recordCompensationAttempt(root2, featureId, journal, { status: "failed", reason: "mismatch", mismatches, startedAt });
      await blockRecovery(root2, featureId, journal, "compensation verification failed: the workspace does not match the pre-rollback backup", { mismatches });
    }
    await recordCompensationAttempt(root2, featureId, journal, { status: "passed", startedAt });
  } catch (error) {
    if (error instanceof DevFlowError && error.code === "ROLLBACK_BACKUP_CORRUPT") {
      await recordCompensationAttempt(root2, featureId, journal, { status: "failed", reason: "backup-corrupt", startedAt });
      await blockRecovery(root2, featureId, journal, error.message, { cause: error.details });
    }
    throw error;
  }
  journal.phase = "compensated";
  delete journal.error;
  await writeRollbackTransaction(root2, featureId, journal);
}
async function commitRollbackState(root2, featureId, journal) {
  const target = await readCheckpoint(root2, featureId, journal.targetCheckpointId);
  return mutatePrepared(root2, featureId, journal.stateRevision, "rollback-executed", async (current, nextStateRevision) => {
    const nodes = rollbackNodes((await readTraceability(root2, current)).nodes);
    const basisKept = implementationUnitBasisHash(current) === target.basisHash;
    const review2 = reviewEnforcementRequired(current.route, current.classification.controls) ? await prepareReviewInvalidation(root2, current, nextStateRevision) : void 0;
    return {
      mutate: (draft) => {
        const units = draft.implementationUnits ?? [];
        for (const unitId of journal.undoOrder) {
          const unit = units.find((candidate) => candidate.unitId === unitId);
          if (!unit) {
            throw new DevFlowError("ROLLBACK_CHAIN_INVALID", "undo unit is missing from implementation state", { unitId });
          }
          unit.status = "rolled_back";
        }
        const earliest = units.find((candidate) => candidate.unitId === journal.undoOrder[journal.undoOrder.length - 1]);
        earliest.status = "pending";
        delete earliest.checkpointId;
        delete earliest.startedFingerprint;
        delete earliest.beginNonce;
        if (!basisKept) {
          for (const approvalId2 of approvalIds(draft)) {
            delete draft.humanGates[approvalId2];
            clearInteractionsForTarget(draft, `approval:${approvalId2}`);
          }
          draft.obligations = (draft.obligations ?? []).map((obligation) => obligation.kind === "approval" ? { ...obligation, status: "pending" } : obligation);
        }
        const basisHash2 = implementationUnitBasisHash(draft);
        for (const node of nodes) {
          if (!units.some((candidate) => candidate.unitId === node.id)) {
            units.push(implementationUnitForNode(node, basisHash2));
          }
        }
        draft.implementationUnits = units;
        for (const step of ["implementation", "code_review", "verification", "finalize"]) {
          delete draft.steps[step];
        }
        draft.logicComplete = false;
        delete draft.verification.satisfiedByAttemptId;
        delete draft.verification.verifiedFingerprint;
        if (review2) draft.review = review2;
        delete draft.rollbackGate;
        clearInteractionsForTarget(draft, `rollback:${journal.targetCheckpointId}`);
      },
      eventData: {
        transactionId: journal.transactionId,
        targetCheckpointId: journal.targetCheckpointId,
        targetUnitId: journal.targetUnitId,
        undoOrder: [...journal.undoOrder],
        undoCheckpoints: [...journal.undoCheckpoints ?? []],
        verificationAttemptIds: [...journal.verificationAttemptIds]
      }
    };
  }, { allowRollbackTransaction: journal.transactionId });
}
async function cleanupRollbackBackup(root2, featureId, journal) {
  const directory = path19.join(featureDirectory4(root2, featureId), journal.backupDirectory);
  await rm2(path19.join(directory, "files"), { recursive: true, force: true });
  await rm2(path19.join(directory, "trash"), { recursive: true, force: true });
  await rm2(path19.join(directory, "backup-manifest.json"), { force: true });
}
async function finishCommitted(root2, featureId, journal, options) {
  await options.fault?.("before-state-cas");
  let state = await readState(root2, featureId);
  if (state.revision === journal.stateRevision) {
    state = await commitRollbackState(root2, featureId, journal);
  }
  await options.fault?.("after-state-cas");
  await cleanupRollbackBackup(root2, featureId, journal);
  journal.completedAt = (/* @__PURE__ */ new Date()).toISOString();
  await writeRollbackTransaction(root2, featureId, journal);
  return { outcome: "committed", state, transaction: journal };
}
async function finishCompensated(root2, featureId, journal, cause) {
  const state = await readState(root2, featureId);
  if (state.revision === journal.stateRevision) {
    await mutatePrepared(root2, featureId, journal.stateRevision, "rollback-compensated", async () => ({
      mutate: (draft) => {
        delete draft.rollbackGate;
        clearInteractionsForTarget(draft, `rollback:${journal.targetCheckpointId}`);
      },
      eventData: {
        transactionId: journal.transactionId,
        targetCheckpointId: journal.targetCheckpointId,
        cause: cause.code
      }
    }), { allowRollbackTransaction: journal.transactionId });
  }
  await cleanupRollbackBackup(root2, featureId, journal);
  journal.completedAt = (/* @__PURE__ */ new Date()).toISOString();
  await writeRollbackTransaction(root2, featureId, journal);
  throw new DevFlowError("ROLLBACK_EXECUTION_FAILED", "rollback execution failed; the workspace was compensated to its pre-rollback state", {
    compensated: true,
    transactionId: journal.transactionId,
    cause: cause.code,
    attemptIds: [...journal.verificationAttemptIds]
  });
}
async function driveRollbackTransaction(root2, featureId, journal, options) {
  const lease = await claimRollbackDriveLease(root2, featureId, journal.transactionId);
  const heartbeat = maintainRollbackDriveLease(root2, featureId, lease);
  try {
    heartbeat.assertOwned();
    const current = await readRollbackTransaction(root2, featureId);
    if (!current || current.transactionId !== journal.transactionId) {
      throw new DevFlowError("ROLLBACK_TRANSACTION_MISMATCH", "rollback transaction disappeared while claiming the drive lease", {
        transactionId: journal.transactionId
      });
    }
    journal = current;
    const { config, sha256: projectConfigSha256 } = await readProjectConfigSnapshot(root2);
    try {
      const commandHashes = journal.verificationCommandHashes ? verificationCommandHashesForRefs(config, Object.keys(journal.verificationCommandHashes)) : void 0;
      const commandSliceStale = journal.verificationCommandHashes ? Object.entries(journal.verificationCommandHashes).some(([id, hash2]) => commandHashes?.[id] !== hash2) : projectConfigSha256 !== journal.projectConfigSha256;
      if ((journal.phase === "prepared" || journal.phase === "backing-up" || journal.phase === "rolling-back" || journal.phase === "verifying") && commandSliceStale) {
        throw new DevFlowError("ROLLBACK_BASIS_STALE", "project verification config changed during the rollback transaction", {
          transactionId: journal.transactionId
        });
      }
      if (journal.phase === "prepared") {
        journal.phase = "backing-up";
        await writeRollbackTransaction(root2, featureId, journal);
      }
      if (journal.phase === "backing-up") {
        await captureBackup(root2, featureId, journal, config, options);
        heartbeat.assertOwned();
        journal.phase = "rolling-back";
        journal.nextFileIndex = 0;
        await writeRollbackTransaction(root2, featureId, journal);
      }
      if (journal.phase === "rolling-back") {
        await applyFilePlan(root2, featureId, journal, options);
        heartbeat.assertOwned();
      }
      if (journal.phase === "verifying") {
        await runRollbackVerification(root2, featureId, journal, config, options);
        heartbeat.assertOwned();
        journal.phase = "committed";
        await writeRollbackTransaction(root2, featureId, journal);
      }
      if (journal.phase === "committed") {
        return await finishCommitted(root2, featureId, journal, options);
      }
      if (journal.phase === "compensating") {
        await compensateRollback(root2, featureId, journal, config, options);
      }
      return await finishCompensated(root2, featureId, journal, new DevFlowError(
        "ROLLBACK_VERIFICATION_FAILED",
        "rollback verification failed (resumed transaction)",
        { transactionId: journal.transactionId }
      ));
    } catch (error) {
      if (!(error instanceof DevFlowError)) throw error;
      if (error.code === "ROLLBACK_RECOVERY_BLOCKED") throw error;
      if (error.code === "ROLLBACK_HASH_MISMATCH" || error.code === "ROLLBACK_TRANSACTION_BUSY") throw error;
      if (journal.phase !== "rolling-back" && journal.phase !== "verifying") throw error;
      await compensateRollback(root2, featureId, journal, config, options);
      return await finishCompensated(root2, featureId, journal, error);
    }
  } finally {
    await heartbeat.stop();
    await releaseRollbackDriveLease(root2, featureId, lease);
  }
}
async function clearStaleRollbackGate(root2, featureId, expectedRevision, targetCheckpointId) {
  await mutate(root2, featureId, expectedRevision, "rollback-gate-stale", async (state) => {
    if (state.rollbackGate?.targetCheckpointId === targetCheckpointId) {
      delete state.rollbackGate;
      clearInteractionsForTarget(state, `rollback:${targetCheckpointId}`);
    }
  });
}
async function executeRollback(root2, featureId, expectedRevision, targetCheckpointId, options = {}) {
  const initial = await readState(root2, featureId);
  if (initial.revision !== expectedRevision) {
    throw new DevFlowError("STATE_REVISION_CONFLICT", "state revision changed", { currentRevision: initial.revision });
  }
  const open8 = await readRollbackTransaction(root2, featureId);
  if (open8 && !rollbackTransactionFinished(open8)) {
    if (open8.targetCheckpointId !== targetCheckpointId) {
      throw new DevFlowError("ROLLBACK_TRANSACTION_MISMATCH", "an open rollback transaction targets a different checkpoint", {
        transactionId: open8.transactionId,
        openTargetCheckpointId: open8.targetCheckpointId,
        targetCheckpointId,
        recoveryHint: "Resume the open transaction with its original target checkpoint"
      });
    }
    return driveRollbackTransaction(root2, featureId, open8, options);
  }
  if (!rollbackExecutionAllowed(initial.route, initial.classification.controls)) {
    throw new DevFlowError("ROLLBACK_EXECUTION_NOT_ALLOWED", "\u5F53\u524D\u52A8\u6001\u8DEF\u7EBF\u6CA1\u6709\u542F\u7528 executable-rollback \u4E0E unit-chain \u63A7\u5236\u3002");
  }
  if (initial.lifecycle !== "active") {
    throw new DevFlowError("INVALID_LIFECYCLE", "rollback execution requires an active feature");
  }
  const gate = initial.rollbackGate;
  if (gate?.status !== "confirmed") {
    throw new DevFlowError("ROLLBACK_GATE_NOT_CONFIRMED", "rollback execution requires a confirmed rollback gate");
  }
  if (gate.targetCheckpointId !== targetCheckpointId) {
    throw new DevFlowError("ROLLBACK_GATE_TARGET_MISMATCH", "rollback target does not match the confirmed gate", {
      confirmedTargetCheckpointId: gate.targetCheckpointId,
      targetCheckpointId
    });
  }
  let preview;
  try {
    preview = await previewRollback(root2, featureId, targetCheckpointId);
  } catch (error) {
    if (error instanceof DevFlowError) {
      await clearStaleRollbackGate(root2, featureId, expectedRevision, targetCheckpointId);
      throw new DevFlowError("ROLLBACK_GATE_BASIS_CHANGED", "rollback preview failed since the gate was confirmed; the gate has been cleared", {
        originalError: error.code,
        recoveryHint: "Resolve the conflict or update checkpoints, then present the rollback gate again"
      });
    }
    throw error;
  }
  if (preview.previewBasisHash !== gate.previewBasisHash) {
    await clearStaleRollbackGate(root2, featureId, expectedRevision, targetCheckpointId);
    throw new DevFlowError("ROLLBACK_GATE_BASIS_CHANGED", "rollback preview basis changed since the gate was confirmed; the gate has been cleared", {
      recoveryHint: "Present the rollback gate again after updating checkpoint state"
    });
  }
  const transactionId = randomUUID12();
  const journal = {
    schemaVersion: 1,
    transactionId,
    featureId,
    phase: "prepared",
    targetCheckpointId,
    targetUnitId: preview.targetUnitId,
    undoOrder: [...preview.undoOrder],
    undoCheckpoints: [...preview.undoCheckpoints],
    previewBasisHash: preview.previewBasisHash,
    stateRevision: expectedRevision,
    backupDirectory: `checkpoints/recovery/${transactionId}`,
    nextFileIndex: 0,
    filePlan: preview.filePlan.map((action) => ({ ...action })),
    verificationAttemptIds: [],
    projectConfigSha256: preview.projectConfigSha256,
    ...preview.verificationCommandHashes ? { verificationCommandHashes: preview.verificationCommandHashes } : {},
    startedAt: (/* @__PURE__ */ new Date()).toISOString()
  };
  await options.fault?.("before-journal-write");
  await prepareRollbackTransaction(root2, featureId, expectedRevision, journal);
  await options.fault?.("after-journal-write");
  return driveRollbackTransaction(root2, featureId, journal, options);
}

// plugins/dev-flow/src/core/interaction-answer.ts
var kindResolvers = {
  "decision-ratification": resolveRatificationForAnswer,
  "decision-revision": resolveRevisionForAnswer,
  "plan-revision": resolvePlanRevisionForAnswer,
  "side-effect-rerun": resolveSideEffectRerunForAnswer,
  grill: resolveGrillForAnswer,
  approval: resolveApprovalForAnswer,
  "workspace-ownership": resolveOwnershipForAnswer,
  "route-confirmation": resolveRouteConfirmationForAnswer,
  "quality-exception": resolveQualityExceptionForAnswer,
  "acceptance-confirmation": resolveAcceptanceConfirmationForAnswer,
  "rollback-confirmation": resolveRollbackGateForAnswer,
  "risk-acceptance": resolveReviewRiskAcceptanceForAnswer,
  "task-switch": resolveTaskSwitchForAnswer
};
function pendingInteraction2(state) {
  const decision = pendingDecisionForState(state);
  return decision ? pendingInteractionForDecision(state, decision) : void 0;
}
function pendingAfter(state) {
  const interaction = pendingInteraction2(state);
  return interaction ? toPublicInteraction(interaction) : void 0;
}
async function answer(input) {
  const { root: root2, featureId, expectedRevision, host, credential } = input;
  const state = await readState(root2, featureId);
  if (state.revision !== expectedRevision) {
    throw new DevFlowError("STATE_REVISION_CONFLICT", "state revision changed", { currentRevision: state.revision });
  }
  const interaction = pendingInteraction2(state);
  if (!interaction) {
    throw new DevFlowError("INTERACTION_NOT_PENDING", "\u5F53\u524D\u6CA1\u6709\u9700\u8981\u56DE\u7B54\u7684\u95EE\u9898\u3002", {
      userMessage: "\u5F53\u524D\u6CA1\u6709\u9700\u8981\u56DE\u7B54\u7684\u95EE\u9898\u3002",
      cause: "\u6CA1\u6709\u5F85\u51B3\u7684\u6B63\u5F0F\u4EA4\u4E92\u8D26\u672C\u3002",
      impact: "\u6D41\u7A0B\u5C06\u6309\u5F53\u524D\u9636\u6BB5\u81EA\u52A8\u7EE7\u7EED\uFF0C\u4E0D\u4F1A\u9501\u5B9A\u6216\u6539\u5199\u8DEF\u7EBF\u3002",
      recoveryKind: "refresh",
      recoveryInstruction: "\u5237\u65B0\u72B6\u6001\u540E\u7EE7\u7EED\u5F53\u524D\u6B65\u9AA4\u3002",
      retryOriginal: false
    });
  }
  const resolver = kindResolvers[interaction.kind];
  if (!resolver) {
    throw new DevFlowError("DECISION_KIND_UNSUPPORTED", "\u5F53\u524D\u95EE\u9898\u7C7B\u578B\u8FD8\u6CA1\u6709\u53EF\u7528\u7684\u7EDF\u4E00\u56DE\u7B54\u5165\u53E3\u3002", {
      userMessage: "\u5F53\u524D\u95EE\u9898\u6682\u65F6\u4E0D\u80FD\u901A\u8FC7\u7EDF\u4E00\u5165\u53E3\u56DE\u7B54\u3002",
      cause: `\u51B3\u7B56\u7C7B\u578B\u4E3A ${interaction.kind}\uFF0C\u5C1A\u672A\u63A5\u5165 answer\u3002`,
      impact: "\u6D41\u7A0B\u4FDD\u6301\u5728\u5F53\u524D\u9636\u6BB5\uFF0C\u4EFB\u4F55\u72B6\u6001\u90FD\u6CA1\u6709\u88AB\u6539\u53D8\u3002",
      recoveryKind: "repair",
      recoveryInstruction: "\u8FD0\u884C dev_flow_doctor \u68C0\u67E5\u63D2\u4EF6\u7248\u672C\u4E0E\u72B6\u6001\uFF0C\u6216\u5237\u65B0\u540E\u91CD\u8BD5\u3002",
      retryOriginal: false
    });
  }
  const result = await resolver({ root: root2, featureId, expectedRevision, host, credential, interaction, state });
  const pending = pendingAfter(result.state);
  return {
    state: result.state,
    action: result.action,
    ...result.comment ? { comment: result.comment } : {},
    ...pending ? { pending } : {}
  };
}

// plugins/dev-flow/src/core/state-store.ts
var lifecycles = /* @__PURE__ */ new Set(["active", "paused", "finalized", "abandoned"]);
var unitStatuses = /* @__PURE__ */ new Set(["pending", "active", "verified", "checkpointed", "rolled_back"]);
function validateImplementationUnits(units) {
  if (!Array.isArray(units)) throw new DevFlowError("INVALID_STATE_SCHEMA", "implementationUnits must be an array");
  const ids = /* @__PURE__ */ new Set();
  const checkpoints = /* @__PURE__ */ new Set();
  for (const value of units) {
    const unit = value;
    if (!unit || typeof unit !== "object" || Array.isArray(unit) || typeof unit.unitId !== "string" || !/^UNIT-[0-9]{3,}$/.test(unit.unitId) || typeof unit.status !== "string" || !unitStatuses.has(unit.status) || typeof unit.basisHash !== "string" || !/^[a-f0-9]{64}$/.test(unit.basisHash) || unit.startedFingerprint !== void 0 && (typeof unit.startedFingerprint !== "string" || !/^[a-f0-9]{64}$/.test(unit.startedFingerprint)) || unit.checkpointId !== void 0 && typeof unit.checkpointId !== "string" || unit.beginNonce !== void 0 && (typeof unit.beginNonce !== "string" || unit.beginNonce.trim().length === 0)) {
      throw new DevFlowError("INVALID_STATE_SCHEMA", "implementation unit state is invalid");
    }
    const started = unit.startedFingerprint !== void 0;
    const checkpointed = unit.checkpointId !== void 0;
    const hasNonce = unit.beginNonce !== void 0;
    const consistent = unit.status === "pending" && !started && !checkpointed && !hasNonce || (unit.status === "active" || unit.status === "verified") && started && !checkpointed || (unit.status === "checkpointed" || unit.status === "rolled_back") && started && checkpointed;
    if (!consistent) throw new DevFlowError("INVALID_STATE_SCHEMA", "implementation unit status is inconsistent with its fields");
    if (ids.has(unit.unitId)) throw new DevFlowError("INVALID_STATE_SCHEMA", "implementation units duplicate an implementation unit");
    if (checkpointed && checkpoints.has(unit.checkpointId)) throw new DevFlowError("INVALID_STATE_SCHEMA", "implementation units duplicate a checkpoint id");
    ids.add(unit.unitId);
    if (checkpointed) checkpoints.add(unit.checkpointId);
  }
}
function validateAcceptanceState(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new DevFlowError("INVALID_STATE_SCHEMA", "acceptance state is invalid");
  const acceptance = value;
  if (!Array.isArray(acceptance.evidence) || !Array.isArray(acceptance.dispositions)) {
    throw new DevFlowError("INVALID_STATE_SCHEMA", "acceptance state must contain evidence and dispositions arrays");
  }
  const sha = /^[a-f0-9]{64}$/;
  const evidenceIds = /* @__PURE__ */ new Set();
  for (const record of acceptance.evidence) {
    if (!record || typeof record !== "object" || typeof record.recordId !== "string" || evidenceIds.has(record.recordId) || record.kind !== "acceptance-evidence" || !/^AC-[0-9]{3,}$/.test(record.acceptanceCriterionId) || !record.basis || record.basis.kind !== "content" || !sha.test(record.basis.sha256) || !["browser-operation", "screenshot", "file-inspection", "agent-self-check"].includes(record.evidenceKind)) {
      throw new DevFlowError("INVALID_STATE_SCHEMA", "acceptance evidence record is invalid");
    }
    if (record.artifactSha256 !== void 0 && (typeof record.artifactSha256 !== "string" || !sha.test(record.artifactSha256))) {
      throw new DevFlowError("INVALID_STATE_SCHEMA", "acceptance evidence artifact hash is invalid");
    }
    evidenceIds.add(record.recordId);
  }
  const dispositionIds = /* @__PURE__ */ new Set();
  for (const disposition of acceptance.dispositions) {
    if (!disposition || typeof disposition !== "object" || !/^AC-[0-9]{3,}$/.test(disposition.acceptanceCriterionId) || dispositionIds.has(disposition.acceptanceCriterionId) || !["behavior-test", "type-check", "rule-check", "file-check", "human-acceptance"].includes(disposition.dispositionKind) || !["pending", "satisfied", "stale"].includes(disposition.status) || !Array.isArray(disposition.evidenceRefs) || disposition.evidenceRefs.some((id) => typeof id !== "string") || !disposition.basis || disposition.basis.kind !== "content" || !sha.test(disposition.basis.sha256)) {
      throw new DevFlowError("INVALID_STATE_SCHEMA", "acceptance disposition state is invalid");
    }
    dispositionIds.add(disposition.acceptanceCriterionId);
  }
}
var interactionKinds = /* @__PURE__ */ new Set(["approval", "grill", "risk-acceptance", "rollback-confirmation", "quality-exception", "workspace-ownership", "route-confirmation", "task-switch", "decision-ratification", "decision-revision", "plan-revision", "side-effect-rerun", "acceptance-confirmation"]);
function validateInteractionRecords(interactions2) {
  for (const value of Object.values(interactions2)) {
    const record = value;
    if (!record || typeof record !== "object" || Array.isArray(record) || typeof record.id !== "string" || !record.id || typeof record.kind !== "string" || !interactionKinds.has(record.kind) || typeof record.target !== "string" || typeof record.basisHash !== "string" || !Array.isArray(record.options) || record.status !== "pending" && record.status !== "resolved") {
      throw new DevFlowError("INVALID_STATE_SCHEMA", "interaction record is invalid");
    }
  }
}
function validateFeatureState(value) {
  const state = value;
  if ([1, 2, 3].includes(Number(state.schemaVersion))) throw new DevFlowError("UNSUPPORTED_FEATURE_SCHEMA", "\u68C0\u6D4B\u5230 Dev Flow 4.x \u6216\u66F4\u65E9\u7684 active state\u3002", { userMessage: "\u65E7 feature \u4E0D\u80FD\u5728 Dev Flow 5.0 \u4E2D\u7EE7\u7EED\u3002", cause: "5.0 \u4E0D\u8FC1\u79FB\u65E7 active state\u3002", impact: "\u7CFB\u7EDF\u4E0D\u4F1A\u8986\u76D6\u6216\u731C\u6D4B\u65E7\u5BA1\u8BA1\u72B6\u6001\u3002", recoveryKind: "repair", recoveryInstruction: "\u56DE\u5230 4.x \u5B8C\u6210\u6216\u653E\u5F03\u8BE5 feature\uFF0C\u5907\u4EFD .dev-flow \u540E\u91CD\u65B0\u521D\u59CB\u5316\u3002", retryOriginal: false, schemaVersion: state.schemaVersion });
  const schemaVersion = Number(state.schemaVersion);
  if (schemaVersion !== 4 && schemaVersion !== 5) throw new DevFlowError("UNSUPPORTED_FEATURE_SCHEMA", "\u5F53\u524D\u53EA\u652F\u6301 schema v4/v5 \u72B6\u6001\u3002", { recoveryHint: "\u4F7F\u7528 Dev Flow 5.0 \u91CD\u65B0\u521D\u59CB\u5316 feature" });
  if (schemaVersion === 5) {
    if (Object.keys(state).includes("decisionLedger") || Object.keys(state).includes("qualityExceptions")) {
      throw new DevFlowError("INVALID_STATE_SCHEMA", "v5 \u8FD0\u884C\u6001\u4E0D\u80FD\u5305\u542B\u65E7 decisionLedger \u6216 qualityExceptions \u5B57\u6BB5\u3002", {
        recoveryHint: "\u901A\u8FC7\u52A0\u8F7D\u5165\u53E3\u8F6C\u6362\u4E3A governance \u8D26\u672C\u540E\u91CD\u65B0\u5199\u5165 v5 state\u3002"
      });
    }
    validateGovernanceLedger(state.governance);
    if (state.acceptance !== void 0) validateAcceptanceState(state.acceptance);
  }
  if (state.mode !== "intake" && state.mode !== "routed") throw new DevFlowError("INVALID_STATE_SCHEMA", "state mode must be intake or routed");
  if (typeof state.featureId !== "string" || !state.featureId || !Number.isInteger(state.revision) || (state.revision ?? -1) < 0 || !lifecycles.has(state.lifecycle) || !state.scope || !Array.isArray(state.scope.inScope) || !Array.isArray(state.scope.outOfScope) || !state.steps || !state.humanGates || !state.artifacts || !state.verification || !Array.isArray(state.verification.attempts) || state.interactions !== void 0 && (typeof state.interactions !== "object" || state.interactions === null || Array.isArray(state.interactions)) || !Array.isArray(state.blockingFindings) || typeof state.logicComplete !== "boolean" || !state.lastUpdatedBy || !state.workspace || !state.evidenceFreshness) {
    throw new DevFlowError("INVALID_STATE_SCHEMA", "\u72B6\u6001\u4E0D\u662F\u5408\u6CD5\u7684 feature state\u3002");
  }
  if (state.lastUpdatedBy.host !== "claude" && state.lastUpdatedBy.host !== "codex") throw new DevFlowError("INVALID_STATE_SCHEMA", "lastUpdatedBy host is invalid");
  if (state.interactions !== void 0) validateInteractionRecords(state.interactions);
  const pendingInteractions = Object.values(state.interactions ?? {}).filter((item) => item.status === "pending");
  if (pendingInteractions.length > 1) throw new DevFlowError("MULTIPLE_PENDING_DECISIONS", "schema v4 \u72B6\u6001\u5305\u542B\u591A\u4E2A\u5F85\u51B3\u95EE\u9898\u3002", { userMessage: "\u5F53\u524D\u72B6\u6001\u540C\u65F6\u5B58\u5728\u591A\u4E2A\u5F85\u51B3\u95EE\u9898\uFF0C\u6D41\u7A0B\u5DF2\u5B89\u5168\u505C\u6B62\u3002", cause: "\u51B3\u7B56\u8D26\u672C\u4E0D\u662F\u5355\u4E00\u5F85\u51B3\u95EE\u9898\u3002", impact: "\u7CFB\u7EDF\u4E0D\u4F1A\u4EFB\u9009\u4E00\u4E2A\u95EE\u9898\u6D88\u8D39\u3002", recoveryKind: "repair", recoveryInstruction: "\u8FD0\u884C doctor \u68C0\u67E5\u51B3\u7B56\u8D26\u672C\uFF0C\u7136\u540E\u901A\u8FC7\u516C\u5F00\u56DE\u7B54\u63A5\u53E3\u6062\u590D\u3002", retryOriginal: false });
  if (state.pendingDecision !== void 0) {
    const decision = state.pendingDecision;
    if (!decision || decision.source !== "core" || typeof decision.question !== "string" || !decision.question.trim() || !/^[a-f0-9]{64}$/.test(decision.basisHash) || !Number.isInteger(decision.presentedRevision) || decision.presentationEventId !== void 0 && typeof decision.presentationEventId !== "string" || !Array.isArray(decision.options) || decision.options.length < 2 || decision.options.length > 3 || decision.options.some((option) => !option || typeof option.id !== "string" || typeof option.label !== "string" || !option.label.trim())) {
      throw new DevFlowError("INVALID_STATE_SCHEMA", "pendingDecision is invalid");
    }
  }
  const workspace = state.workspace;
  if (!workspace || typeof workspace.baseHead !== "string" || typeof workspace.baseBranch !== "string" || typeof workspace.observedHead !== "string" || typeof workspace.lastWorkspaceFingerprint !== "string" || !["current", "required", "blocked"].includes(workspace.reconciliationStatus) || typeof workspace.startedDirty !== "object" || workspace.startedDirty === null || Array.isArray(workspace.startedDirty) || typeof workspace.ownership !== "object" || workspace.ownership === null || Array.isArray(workspace.ownership) || typeof workspace.ownershipSource !== "object" || workspace.ownershipSource === null || Array.isArray(workspace.ownershipSource) || typeof workspace.observedPathFingerprints !== "object" || workspace.observedPathFingerprints === null || Array.isArray(workspace.observedPathFingerprints) || workspace.unownedPaths !== void 0 && (!Array.isArray(workspace.unownedPaths) || workspace.unownedPaths.some((file) => typeof file !== "string")) || !Array.isArray(workspace.observedCommits)) {
    throw new DevFlowError("INVALID_STATE_SCHEMA", "workspace lineage is invalid");
  }
  if (state.lifecycle === "finalized" && !state.deliverySnapshot) throw new DevFlowError("INVALID_STATE_SCHEMA", "finalized \u72B6\u6001\u5FC5\u987B\u5305\u542B\u4EA4\u4ED8\u5FEB\u7167\u3002");
  if (state.lifecycle === "abandoned" && !state.abandonment) throw new DevFlowError("INVALID_STATE_SCHEMA", "abandoned \u72B6\u6001\u5FC5\u987B\u5305\u542B\u7528\u6237\u539F\u56E0\u3002");
  if (state.mode === "intake") {
    if (state.route !== void 0 || state.classification !== void 0 || state.classificationBasis !== void 0 || state.obligations !== void 0) {
      throw new DevFlowError("INVALID_STATE_SCHEMA", "intake state cannot contain route or classification fields");
    }
    return;
  }
  if (!state.route || !routeDefinition(state.route) || !state.classification || !state.classificationBasis || !Array.isArray(state.obligations)) {
    throw new DevFlowError("INVALID_STATE_SCHEMA", "routed \u72B6\u6001\u5FC5\u987B\u5305\u542B\u5206\u7C7B\u4E8B\u5B9E\u548C\u4E49\u52A1\u3002");
  }
  if (state.repair !== void 0 && (typeof state.repair !== "object" || !["active", "stalled", "waiting-user", "completed"].includes(state.repair.status) || !Array.isArray(state.repair.attempts) || !Number.isInteger(state.repair.maxAttempts) || state.repair.maxAttempts < 1)) {
    throw new DevFlowError("INVALID_STATE_SCHEMA", "repair state is invalid");
  }
  if (state.checkpoints !== void 0 && (!Array.isArray(state.checkpoints) || state.checkpoints.some((checkpoint) => {
    const item = checkpoint;
    return !item || typeof item.checkpointId !== "string" || !/^AUTO-[0-9a-f-]{10,}$/.test(item.checkpointId) || typeof item.stage !== "string" || typeof item.capturedAt !== "string" || typeof item.fingerprint !== "string" || !/^[a-f0-9]{64}$/.test(item.fingerprint) || !Array.isArray(item.files) || item.files.some((file) => typeof file !== "string") || typeof item.basisHash !== "string" || !/^[a-f0-9]{64}$/.test(item.basisHash);
  }))) {
    throw new DevFlowError("INVALID_STATE_SCHEMA", "automatic checkpoints are invalid");
  }
  if (state.workflowCapabilities !== void 0) {
    try {
      normalizeWorkflowCapabilities(state.workflowCapabilities);
    } catch {
      throw new DevFlowError("INVALID_STATE_SCHEMA", "workflowCapabilities are invalid");
    }
  }
  if (state.traceability !== void 0) {
    const pointer = state.traceability;
    if (typeof pointer !== "object" || pointer === null || !/^traceability\/snapshots\/[a-f0-9]{64}\.json$/.test(pointer.path) || !/^[a-f0-9]{64}$/.test(pointer.sha256) || pointer.path !== `traceability/snapshots/${pointer.sha256}.json` || !Number.isInteger(pointer.revision) || pointer.revision < 0 || !pointer.summary || !["total", "current", "stale", "tombstoned"].every((key) => Number.isInteger(pointer.summary[key]) && pointer.summary[key] >= 0)) {
      throw new DevFlowError("INVALID_STATE_SCHEMA", "traceability pointer is invalid");
    }
  }
  if (traceEnforcementRequired(state.route, state.classification.controls) && !state.traceability) {
    throw new DevFlowError("INVALID_STATE_SCHEMA", "\u542F\u7528 Trace \u63A7\u5236\u7684 feature \u5FC5\u987B\u5305\u542B traceability pointer\u3002");
  }
  if (state.review !== void 0) {
    const pointer = state.review;
    if (typeof pointer !== "object" || pointer === null || !/^review\/snapshots\/[a-f0-9]{64}\.json$/.test(pointer.path) || !/^[a-f0-9]{64}$/.test(pointer.sha256) || pointer.path !== `review/snapshots/${pointer.sha256}.json` || !Number.isInteger(pointer.revision) || pointer.revision < 0 || !pointer.summary || !["batches", "current", "stale", "open", "complete"].every((key) => Number.isInteger(pointer.summary[key]) && pointer.summary[key] >= 0)) {
      throw new DevFlowError("INVALID_STATE_SCHEMA", "review pointer is invalid");
    }
  }
  if (reviewLedgerRequired(state.route, state.classification.controls) && !state.review) {
    throw new DevFlowError("INVALID_STATE_SCHEMA", "\u542F\u7528\u5BA1\u67E5\u63A7\u5236\u7684 feature \u5FC5\u987B\u5305\u542B review pointer\u3002");
  }
  if (state.implementationUnits !== void 0) validateImplementationUnits(state.implementationUnits);
  if (state.rollbackGate !== void 0) {
    const gate = state.rollbackGate;
    if (typeof gate !== "object" || gate === null || gate.status !== "pending" && gate.status !== "confirmed" || typeof gate.targetCheckpointId !== "string" || typeof gate.targetUnitId !== "string" || !/^[a-f0-9]{64}$/.test(gate.previewBasisHash) || typeof gate.interactionId !== "string" || typeof gate.stateRevision !== "number" || !Number.isInteger(gate.stateRevision) || gate.stateRevision < 0 || typeof gate.presentedAt !== "string" || gate.confirmedAt !== void 0 && typeof gate.confirmedAt !== "string") {
      throw new DevFlowError("INVALID_STATE_SCHEMA", "rollbackGate is invalid");
    }
  }
}
function invalidGovernance(message) {
  return new DevFlowError("INVALID_STATE_SCHEMA", `governance ledger is invalid: ${message}`);
}
function validateRecordBasis(basis) {
  if (basis === void 0) return;
  if (!basis || typeof basis !== "object" || Array.isArray(basis)) throw invalidGovernance("record basis must be an object");
  const value = basis;
  if (value.kind === "content") {
    if (Object.keys(value).some((key) => key !== "kind" && key !== "sha256") || typeof value.sha256 !== "string" || !/^[a-f0-9]{64}$/.test(value.sha256)) {
      throw invalidGovernance("content record basis requires only a valid sha256");
    }
    return;
  }
  if (value.kind === "event") {
    if (Object.keys(value).some((key) => key !== "kind" && key !== "eventId") || typeof value.eventId !== "string" || !value.eventId) {
      throw invalidGovernance("event record basis requires only a non-empty eventId");
    }
    return;
  }
  if (value.kind === "slice") {
    if (Object.keys(value).some((key) => key !== "kind" && key !== "sliceKey" && key !== "sliceHash") || typeof value.sliceKey !== "string" || !value.sliceKey || typeof value.sliceHash !== "string" || !value.sliceHash) {
      throw invalidGovernance("slice record basis requires only sliceKey and sliceHash");
    }
    return;
  }
  throw invalidGovernance("record basis kind is invalid");
}
function validateGovernanceRecordBase(record) {
  if (typeof record.recordId !== "string" || !record.recordId) throw invalidGovernance("record recordId must be a non-empty string");
  if (record.supersededBy !== void 0 && (typeof record.supersededBy !== "string" || !record.supersededBy)) throw invalidGovernance("record supersededBy must be a non-empty string");
  if (record.recordedAt !== void 0 && typeof record.recordedAt !== "string") throw invalidGovernance("record recordedAt must be a string");
  validateRecordBasis(record.basis);
}
function validateGovernanceLedger(ledger) {
  if (!ledger || typeof ledger !== "object" || Array.isArray(ledger)) throw invalidGovernance("ledger must be an object");
  const value = ledger;
  const arrays = [
    ["decisions", ["decision"]],
    ["claims", ["claim"]],
    ["authorizations", ["authorization"]],
    ["credentials", ["credential"]],
    ["repositoryFacts", ["repository-fact"]]
  ];
  for (const [key, allowedKinds] of arrays) {
    const entries = value[key];
    if (!Array.isArray(entries)) throw invalidGovernance(`${key} must be an array`);
    for (const entry of entries) {
      if (!entry || typeof entry !== "object" || Array.isArray(entry)) throw invalidGovernance(`${key} entries must be objects`);
      const record = entry;
      if (!allowedKinds.includes(record.kind)) throw invalidGovernance(`${key} entry kind must be ${allowedKinds.join(" or ")}`);
      validateGovernanceRecordBase(record);
      switch (record.kind) {
        case "decision":
          if (typeof record.question !== "string" || !record.question.trim()) throw invalidGovernance("decision question must be a non-empty string");
          if (typeof record.conclusion !== "string" || !record.conclusion.trim()) throw invalidGovernance("decision conclusion must be a non-empty string");
          if (record.credentialId !== void 0 && typeof record.credentialId !== "string") throw invalidGovernance("decision credentialId must be a string");
          break;
        case "claim":
          if (typeof record.claimType !== "string" || !record.claimType) throw invalidGovernance("claim claimType must be a non-empty string");
          if (typeof record.subject !== "string" || !record.subject) throw invalidGovernance("claim subject must be a non-empty string");
          break;
        case "authorization":
          if (typeof record.authorizationType !== "string" || !record.authorizationType) throw invalidGovernance("authorization authorizationType must be a non-empty string");
          if (typeof record.target !== "string" || !record.target) throw invalidGovernance("authorization target must be a non-empty string");
          if (record.credentialId !== void 0 && typeof record.credentialId !== "string") throw invalidGovernance("authorization credentialId must be a string");
          break;
        case "credential":
          if (record.source !== "native-form" && record.source !== "text") throw invalidGovernance("credential source must be native-form or text");
          if (record.host !== "claude" && record.host !== "codex") throw invalidGovernance("credential host must be claude or codex");
          if (typeof record.interactionId !== "string" || !record.interactionId) throw invalidGovernance("credential interactionId must be a non-empty string");
          if (record.optionId !== void 0 && typeof record.optionId !== "string") throw invalidGovernance("credential optionId must be a string");
          if (record.rawText !== void 0 && typeof record.rawText !== "string") throw invalidGovernance("credential rawText must be a string");
          break;
        case "repository-fact": {
          const location = record.location;
          if (!location || typeof location !== "object" || Array.isArray(location)) throw invalidGovernance("repository-fact location must be an object");
          if (typeof record.assertion !== "string" || !record.assertion.trim()) throw invalidGovernance("repository-fact assertion must be a non-empty string");
          if (location.kind === "positive") {
            if (typeof location.path !== "string" || !location.path) throw invalidGovernance("repository-fact positive location path must be a non-empty string");
          } else if (location.kind === "negative") {
            if (!Array.isArray(location.checkedScope) || location.checkedScope.some((item) => typeof item !== "string")) throw invalidGovernance("repository-fact negative checkedScope must be a string array");
            if (typeof location.conditions !== "string" || !location.conditions.trim()) throw invalidGovernance("repository-fact negative conditions must be a non-empty string");
          } else {
            throw invalidGovernance("repository-fact location kind must be positive or negative");
          }
          if (record.observation !== void 0) {
            const observation = record.observation;
            if (!observation || typeof observation !== "object" || Array.isArray(observation) || typeof observation.kind !== "string") {
              throw invalidGovernance("repository-fact observation must be a tagged object");
            }
            const hasOnly = (keys) => Object.keys(observation).every((key2) => keys.includes(key2));
            const nonEmptyPath = () => typeof observation.path === "string" && observation.path.trim().length > 0;
            if (observation.kind === "file-exists") {
              if (!hasOnly(["kind", "path"]) || !nonEmptyPath()) throw invalidGovernance("file-exists observation is invalid");
            } else if (observation.kind === "text-present") {
              if (!hasOnly(["kind", "path", "text", "occurrence"]) || !nonEmptyPath() || typeof observation.text !== "string" || !observation.text.trim() || observation.occurrence !== void 0 && (typeof observation.occurrence !== "number" || !Number.isInteger(observation.occurrence) || observation.occurrence < 1)) throw invalidGovernance("text-present observation is invalid");
            } else if (observation.kind === "symbol-present") {
              if (!hasOnly(["kind", "path", "symbol"]) || !nonEmptyPath() || typeof observation.symbol !== "string" || !observation.symbol.trim()) throw invalidGovernance("symbol-present observation is invalid");
            } else if (observation.kind === "json-value") {
              if (!hasOnly(["kind", "path", "pointer", "expected"]) || !nonEmptyPath() || typeof observation.pointer !== "string" || !observation.pointer.startsWith("/")) throw invalidGovernance("json-value observation is invalid");
            } else if (observation.kind === "search-absent") {
              if (!hasOnly(["kind", "checkedScope", "pattern", "patternKind"]) || !Array.isArray(observation.checkedScope) || observation.checkedScope.length === 0 || observation.checkedScope.some((item) => typeof item !== "string" || !item.trim()) || typeof observation.pattern !== "string" || !observation.pattern.trim() || observation.patternKind !== "literal" && observation.patternKind !== "regex") throw invalidGovernance("search-absent observation is invalid");
            } else {
              throw invalidGovernance("repository-fact observation kind is invalid");
            }
          }
          if (typeof record.observedFingerprint !== "string" || !record.observedFingerprint) throw invalidGovernance("repository-fact observedFingerprint must be a non-empty string");
          break;
        }
      }
    }
  }
}
function validateScopeInput(scope) {
  if (scope === void 0 || scope === null) return { inScope: [], outOfScope: [] };
  if (typeof scope !== "object" || Array.isArray(scope)) {
    throw new DevFlowError("INVALID_START_INPUT", "scope must be an object with inScope and outOfScope string arrays", {
      recoveryHint: "Fix scope.inScope/outOfScope then call dev_flow_start again"
    });
  }
  const value = scope;
  const keys = Object.keys(value);
  if (keys.some((key) => key !== "inScope" && key !== "outOfScope")) {
    throw new DevFlowError("INVALID_START_INPUT", "scope only allows inScope and outOfScope", {
      recoveryHint: "Fix scope.inScope/outOfScope then call dev_flow_start again"
    });
  }
  if (!("inScope" in value) || !("outOfScope" in value)) {
    throw new DevFlowError("INVALID_START_INPUT", "scope requires inScope and outOfScope", {
      recoveryHint: "Fix scope.inScope/outOfScope then call dev_flow_start again"
    });
  }
  if (!Array.isArray(value.inScope) || !value.inScope.every((item) => typeof item === "string") || !Array.isArray(value.outOfScope) || !value.outOfScope.every((item) => typeof item === "string")) {
    throw new DevFlowError("INVALID_START_INPUT", "scope.inScope and scope.outOfScope must be string arrays", {
      recoveryHint: "Fix scope.inScope/outOfScope then call dev_flow_start again"
    });
  }
  return {
    inScope: value.inScope.map(normalizeUnicode),
    outOfScope: value.outOfScope.map(normalizeUnicode)
  };
}
var delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
var devFlow = (root2) => path20.join(root2, ".dev-flow");
var features2 = (root2) => path20.join(devFlow(root2), "features");
var statePath = (root2, id) => path20.join(features2(root2), id, "state.json");
var eventPath = (root2, id) => path20.join(features2(root2), id, "events.jsonl");
var activePath = (root2) => path20.join(devFlow(root2), "active.json");
var recoveryTxnPath = (root2) => path20.join(devFlow(root2), "recovery-transaction.json");
var recoveryEventsPath = (root2) => path20.join(devFlow(root2), "recovery-events.jsonl");
var rollbackTxnPath2 = (root2, featureId) => path20.join(features2(root2), featureId, "rollback-transaction.json");
async function readProjectConfig(root2) {
  try {
    const raw = await readFile16(path20.join(devFlow(root2), "project.json"), "utf8");
    const value = JSON.parse(raw);
    validateProjectConfig(value);
    return value;
  } catch (error) {
    if (error instanceof DevFlowError) throw error;
    if (error.code === "ENOENT") {
      throw new DevFlowError("PROJECT_NOT_INITIALIZED", "run dev_flow_init_project first", {
        userMessage: "\u9879\u76EE\u5C1A\u672A\u521D\u59CB\u5316\uFF0C\u8BF7\u5148\u8FD0\u884C dev_flow_init_project\u3002",
        cause: "\u5F53\u524D\u4E1A\u52A1\u76EE\u5F55\u7F3A\u5C11 .dev-flow/project.json\u3002",
        impact: "\u672A\u521D\u59CB\u5316\u9879\u76EE\u524D\u65E0\u6CD5\u5F00\u59CB\u6216\u63A8\u8FDB\u4EFB\u4F55\u9700\u6C42\u3002",
        recoveryKind: "retry",
        recoveryInstruction: "\u8FD0\u884C dev_flow_init_project \u521D\u59CB\u5316\u9879\u76EE\uFF0C\u7136\u540E\u91CD\u65B0 dev_flow_start\u3002",
        retryOriginal: true,
        requiresUserDecision: false
      });
    }
    throw new DevFlowError("INVALID_PROJECT_CONFIG", "project.json exists but is unreadable", {
      userMessage: "\u9879\u76EE\u914D\u7F6E\u6587\u4EF6\u65E0\u6CD5\u8BFB\u53D6\u3002",
      cause: ".dev-flow/project.json \u5B58\u5728\u4F46\u5185\u5BB9\u635F\u574F\u6216\u65E0\u6CD5\u89E3\u6790\u3002",
      impact: "\u65E0\u6CD5\u786E\u8BA4\u9879\u76EE\u7684\u5F3A\u5236\u914D\u7F6E\u4E0E\u53D7\u4FDD\u62A4\u8DEF\u5F84\uFF0C\u6D41\u7A0B\u5DF2\u505C\u6B62\u3002",
      recoveryKind: "repair",
      recoveryInstruction: "\u8FD0\u884C dev_flow_doctor \u68C0\u67E5\uFF0C\u6216\u4FEE\u590D project.json \u540E\u91CD\u8BD5\u3002",
      retryOriginal: false,
      requiresUserDecision: false
    });
  }
}
async function initProject(root2, config) {
  validateProjectConfig(config);
  await mkdir11(devFlow(root2), { recursive: true });
  try {
    const existing = JSON.parse(await readFile16(path20.join(devFlow(root2), "project.json"), "utf8"));
    validateProjectConfig(existing);
    if (JSON.stringify(existing) === JSON.stringify(config)) return;
    throw new DevFlowError("PROJECT_CONFIG_UPDATE_REQUIRED", "project.json \u5DF2\u5B58\u5728\u4E14\u5185\u5BB9\u4E0D\u540C\u3002", {
      userMessage: "\u9879\u76EE\u914D\u7F6E\u5DF2\u7ECF\u521D\u59CB\u5316\uFF1B\u4FEE\u6539\u914D\u7F6E\u5FC5\u987B\u901A\u8FC7\u5E76\u53D1\u5B89\u5168\u7684\u66F4\u65B0\u5165\u53E3\u3002",
      cause: "\u521D\u59CB\u5316\u5165\u53E3\u4E0D\u4F1A\u8986\u76D6\u73B0\u6709\u9879\u76EE\u914D\u7F6E\u3002",
      impact: "\u5F53\u524D\u914D\u7F6E\u4E0E\u8BF7\u6C42\u914D\u7F6E\u5747\u4FDD\u6301\u4E0D\u53D8\u3002",
      recoveryKind: "retry",
      recoveryInstruction: "\u5148\u8BFB\u53D6\u5F53\u524D\u914D\u7F6E\u6458\u8981\u5E76\u4F7F\u7528 dev_flow_update_project \u63D0\u4EA4 expectedSha256 \u540E\u91CD\u8BD5\u3002",
      retryOriginal: false
    });
  } catch (error) {
    if (error instanceof DevFlowError) throw error;
    if (error.code !== "ENOENT") throw error;
  }
  await writeAtomic2(path20.join(devFlow(root2), "project.json"), config);
}
async function updateProjectConfig(root2, config, expectedSha256) {
  validateProjectConfig(config);
  const release = await lock(root2, "project-config", "update-project");
  try {
    const file = path20.join(devFlow(root2), "project.json");
    let raw;
    try {
      raw = await readFile16(file, "utf8");
    } catch {
      throw new DevFlowError("PROJECT_NOT_INITIALIZED", "run dev_flow_init_project first");
    }
    const previousSha256 = createHash28("sha256").update(raw).digest("hex");
    if (!/^[a-f0-9]{64}$/.test(expectedSha256) || previousSha256 !== expectedSha256) {
      throw new DevFlowError("PROJECT_CONFIG_REVISION_CONFLICT", "project configuration changed since it was read", {
        userMessage: "\u9879\u76EE\u914D\u7F6E\u5DF2\u88AB\u5176\u4ED6\u64CD\u4F5C\u66F4\u65B0\uFF0C\u65E7 expectedSha256 \u4E0D\u80FD\u8986\u76D6\u5F53\u524D\u914D\u7F6E\u3002",
        cause: "\u914D\u7F6E\u66F4\u65B0\u4F7F\u7528 sha256 CAS\uFF0C\u68C0\u6D4B\u5230\u57FA\u7EBF\u4E0D\u4E00\u81F4\u3002",
        impact: "\u6CA1\u6709\u5199\u5165\u65B0\u914D\u7F6E\uFF0C\u4E5F\u6CA1\u6709\u4F7F\u73B0\u6709 feature \u5931\u6548\u3002",
        recoveryKind: "refresh",
        recoveryInstruction: "\u91CD\u65B0\u8BFB\u53D6\u5F53\u524D\u914D\u7F6E\u6458\u8981\uFF0C\u786E\u8BA4\u5DEE\u5F02\u540E\u518D\u63D0\u4EA4\u66F4\u65B0\u3002",
        retryOriginal: true,
        currentSha256: previousSha256
      });
    }
    const previousConfig = JSON.parse(raw);
    validateProjectConfig(previousConfig);
    const impact = projectConfigImpact(previousConfig, config);
    if (impact.governanceChanged || impact.preflightChanged) {
      throw new DevFlowError("PROJECT_CONFIG_HIGH_IMPACT", "governance roots, enforcement or preflight policy changed\u3002", {
        userMessage: "\u8FD9\u662F\u9AD8\u5F71\u54CD\u9879\u76EE\u7B56\u7565\u53D8\u66F4\uFF0C\u4E0D\u80FD\u4F5C\u4E3A\u666E\u901A\u589E\u91CF\u914D\u7F6E\u66F4\u65B0\u3002",
        cause: "\u6CBB\u7406\u8303\u56F4\u6216\u6267\u884C\u524D\u7F6E\u7B56\u7565\u4F1A\u6539\u53D8\u73B0\u6709 feature \u7684\u8DEF\u7EBF\u4E0E\u8BC1\u636E\u542B\u4E49\u3002",
        impact: "\u6CA1\u6709\u5199\u5165\u65B0\u914D\u7F6E\uFF1B\u73B0\u6709 feature \u4FDD\u6301\u539F\u72B6\u6001\u3002",
        recoveryKind: "repair",
        recoveryInstruction: "\u5148\u6682\u505C\u76F8\u5173 feature\uFF0C\u5B8C\u6210\u663E\u5F0F\u91CD\u5206\u7C7B\u6216\u6062\u590D\u8BC4\u4F30\u540E\u518D\u66F4\u65B0\u9879\u76EE\u914D\u7F6E\u3002",
        retryOriginal: false
      });
    }
    const active = await readActive(root2);
    const affectedEvidence = await collectProjectConfigAffectedEvidence(
      root2,
      active ? await readState(root2, active.featureId) : void 0,
      impact
    );
    await writeAtomic2(file, config);
    const nextRaw = await readFile16(file, "utf8");
    return { config, previousSha256, sha256: createHash28("sha256").update(nextRaw).digest("hex"), impact, affectedEvidence };
  } finally {
    await release();
  }
}
async function writeAtomic2(file, value) {
  const temp = `${file}.${randomUUID13()}.tmp`;
  const handle = await open7(temp, "w");
  const payload = file.endsWith(`${path20.sep}state.json`) && value && typeof value === "object" && value.schemaVersion === 5 ? (() => {
    const copy = { ...value };
    delete copy.decisionLedger;
    delete copy.qualityExceptions;
    return copy;
  })() : value;
  try {
    await handle.writeFile(`${JSON.stringify(payload, null, 2)}
`);
    await handle.sync();
  } finally {
    await handle.close();
  }
  await rename6(temp, file);
  const directory = await open7(path20.dirname(file), "r");
  try {
    await directory.sync();
  } finally {
    await directory.close();
  }
}
async function prepareStatusProjection(root2, state, revision) {
  const status = state.artifacts.status;
  if (!status) return;
  if (state.mode !== "routed" || !state.route || !state.classification) {
    const pending = pendingDecisionForState(state);
    const contents2 = [
      "---",
      "dev_flow:",
      "  schema_version: 1",
      `  feature_id: ${state.featureId}`,
      "  kind: status",
      "  generated: true",
      "---",
      "",
      "# Dev Flow Status",
      "",
      `- Revision: ${revision}`,
      `- Lifecycle: ${state.lifecycle}`,
      "- Mode: intake",
      "",
      ...pending?.kind === "route-confirmation" ? ["## Pending", "", `- ${pending.question}`, ""] : []
    ].join("\n");
    const file2 = path20.join(features2(root2), state.featureId, status.path);
    state.artifacts.status = { ...status, sha256: createHash28("sha256").update(contents2).digest("hex") };
    return async () => {
      await writeFile3(file2, contents2);
    };
  }
  const trace2 = await inspectCurrentTrace(root2, state);
  const summary = trace2.effectiveSummary;
  const traceLines = [
    "## Trace",
    "",
    `- Enforced: ${trace2.enforced}`,
    ...state.traceability ? [`- Pointer: ${state.traceability.path}`] : [],
    ...summary ? [`- Summary: total=${summary.total} current=${summary.current} stale=${summary.stale} tombstoned=${summary.tombstoned}`] : [],
    ...trace2.blocker ? [`- Blocker: ${trace2.blocker.code} (${trace2.blocker.step})`] : [],
    ""
  ];
  const projection = [
    "---",
    "dev_flow:",
    "  schema_version: 1",
    `  feature_id: ${state.featureId}`,
    `  route: ${state.route}`,
    "  kind: status",
    "  generated: true",
    "---",
    "",
    "# Dev Flow Status",
    "",
    `- Revision: ${revision}`,
    `- Lifecycle: ${state.lifecycle}`,
    `- Route: ${state.route}`,
    `- Logic complete: ${state.logicComplete}`,
    "",
    "## Steps",
    "",
    ...routeDefinitionForFeature(state.route, state.classification.controls).orderedSteps.map((step) => `- ${step}: ${state.steps[step]?.status ?? "pending"}`),
    "",
    ...traceLines
  ].join("\n");
  const contents = `${projection}
`;
  const file = path20.join(features2(root2), state.featureId, status.path);
  state.artifacts.status = { ...status, sha256: createHash28("sha256").update(contents).digest("hex") };
  return async () => {
    await writeFile3(file, contents);
  };
}
async function lock(root2, featureId, operation) {
  const directory = path20.join(devFlow(root2), ".lock");
  const started = Date.now();
  await mkdir11(devFlow(root2), { recursive: true });
  while (true) {
    try {
      await mkdir11(directory);
      await writeFile3(path20.join(directory, "owner.json"), JSON.stringify({ pid: process.pid, hostname: hostname2(), acquiredAt: (/* @__PURE__ */ new Date()).toISOString(), featureId, operation }));
      return async () => {
        await rm3(directory, { recursive: true, force: true });
      };
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
      try {
        const owner = JSON.parse(await readFile16(path20.join(directory, "owner.json"), "utf8"));
        const age = Date.now() - Date.parse(owner.acquiredAt);
        let live = owner.hostname === hostname2();
        if (live) {
          try {
            process.kill(owner.pid, 0);
          } catch {
            live = false;
          }
        }
        if (!live && age > 3e4) {
          await rm3(directory, { recursive: true, force: true });
          continue;
        }
      } catch {
      }
      if (Date.now() - started >= 5e3) throw new DevFlowError("STATE_LOCK_TIMEOUT", "state lock could not be acquired");
      await delay(50 + Math.floor(Math.random() * 20));
    }
  }
}
async function readState(root2, featureId) {
  try {
    const raw = JSON.parse(await readFile16(statePath(root2, featureId), "utf8"));
    validateFeatureState(raw);
    const state = migrateFeatureState(raw);
    if (state.featureId !== featureId) throw new DevFlowError("INVALID_STATE_SCHEMA", "state feature id does not match its path");
    return state;
  } catch (error) {
    if (error instanceof DevFlowError) throw error;
    if (error.code === "ENOENT") throw new DevFlowError("FEATURE_NOT_FOUND", `feature ${featureId} does not exist`, {
      userMessage: "\u627E\u4E0D\u5230\u8BE5 feature\u3002",
      cause: `feature ${featureId} \u4E0D\u5B58\u5728\uFF0C\u6216\u5C1A\u672A\u901A\u8FC7 dev_flow_start \u521B\u5EFA\u3002`,
      impact: "\u672A\u521B\u5EFA\u8BE5 feature \u524D\u65E0\u6CD5\u67E5\u770B\u5176\u72B6\u6001\u3002",
      recoveryKind: "retry",
      recoveryInstruction: "\u5148 dev_flow_start \u521B\u5EFA\u8BE5 feature\uFF1B\u5982\u5DF2\u521B\u5EFA\uFF0C\u6838\u5BF9 featureId\u3002",
      retryOriginal: true,
      requiresUserDecision: false
    });
    throw new DevFlowError("INVALID_STATE_SCHEMA", `feature ${featureId} state is unreadable`, {
      recoveryHint: "Run dev_flow_doctor; if corrupt, use dev_flow_recover_corrupt_feature then start a new feature"
    });
  }
}
async function readActive(root2) {
  let raw;
  try {
    raw = await readFile16(activePath(root2), "utf8");
  } catch (error) {
    if (error.code === "ENOENT") return void 0;
    throw new DevFlowError("ACTIVE_POINTER_UNREADABLE", "active.json cannot be read", { recoveryHint: "Run dev_flow_doctor and use recovery; do not start a new feature" });
  }
  try {
    const active = JSON.parse(raw);
    if (typeof active.featureId !== "string" || !active.featureId || typeof active.revision !== "number" || !Number.isInteger(active.revision) || active.revision < 0) {
      throw new Error("invalid active pointer fields");
    }
    return { featureId: active.featureId, revision: active.revision, ...typeof active.updatedAt === "string" ? { updatedAt: active.updatedAt } : {} };
  } catch {
    throw new DevFlowError("ACTIVE_POINTER_UNREADABLE", "active.json is invalid", { recoveryHint: "Run dev_flow_doctor and use recovery; do not start a new feature" });
  }
}
async function assertActivePointerConsistent(root2) {
  const active = await readActive(root2);
  if (!active) return;
  let state;
  try {
    state = await readState(root2, active.featureId);
  } catch (error) {
    throw new DevFlowError("ACTIVE_POINTER_INCONSISTENT", "active pointer references an unreadable feature", {
      cause: error instanceof Error ? error.message : String(error),
      impact: "\u7CFB\u7EDF\u4E0D\u80FD\u786E\u5B9A\u5F53\u524D active feature\uFF0C\u5DF2\u505C\u6B62\u81EA\u52A8\u5207\u6362\u3002",
      recoveryKind: "repair",
      recoveryInstruction: "\u8FD0\u884C doctor \u68C0\u67E5 active pointer \u548C feature \u72B6\u6001\u3002",
      retryOriginal: false
    });
  }
  if (state.lifecycle !== "active" || state.revision !== active.revision) {
    throw new DevFlowError("ACTIVE_POINTER_INCONSISTENT", "active pointer \u4E0E schema v4 feature revision \u4E0D\u4E00\u81F4\u3002", {
      userMessage: "\u5F53\u524D active \u6307\u9488\u4E0E feature \u72B6\u6001\u4E0D\u4E00\u81F4\uFF0C\u6D41\u7A0B\u5DF2\u5B89\u5168\u505C\u6B62\u3002",
      cause: "active pointer \u5FC5\u987B\u5F15\u7528\u540C\u4E00 feature \u548C revision \u7684 active \u72B6\u6001\u3002",
      impact: "\u7CFB\u7EDF\u4E0D\u4F1A\u731C\u6D4B\u5E94\u8BE5\u7EE7\u7EED\u54EA\u4E00\u4E2A revision\u3002",
      recoveryKind: "repair",
      recoveryInstruction: "\u8FD0\u884C doctor \u68C0\u67E5\u72B6\u6001\u6295\u5F71\uFF1B\u4E0D\u8981\u624B\u52A8\u4FEE\u6539 active.json\u3002",
      retryOriginal: false,
      activeRevision: active.revision,
      stateRevision: state.revision,
      lifecycle: state.lifecycle
    });
  }
}
async function appendEvent(root2, id, revision, type, data) {
  const handle = await open7(eventPath(root2, id), "a");
  try {
    await handle.writeFile(`${JSON.stringify({ revision, type, at: (/* @__PURE__ */ new Date()).toISOString(), data })}
`);
    await handle.sync();
  } finally {
    await handle.close();
  }
}
async function stateFileSha256(root2, featureId) {
  const contents = await readFile16(statePath(root2, featureId));
  return createHash28("sha256").update(contents).digest("hex");
}
async function assertWorkspaceOwnershipComplete(root2, state, config, operation) {
  const reconciled = await reconcileWorkspaceForFeature(root2, state, config);
  const unownedPaths = reconciled.workspace.unownedPaths ?? [];
  if (unownedPaths.length) {
    throw new DevFlowError("WORKSPACE_OWNERSHIP_REQUIRED", `unknown workspace ownership before ${operation}`, {
      userMessage: `${operation} \u524D\u53D1\u73B0\u5C1A\u672A\u786E\u8BA4\u5F52\u5C5E\u7684\u5DE5\u4F5C\u533A\u8DEF\u5F84\u3002`,
      cause: `\u4EE5\u4E0B\u8DEF\u5F84\u5DF2\u88AB\u89C2\u5BDF\u5230\uFF0C\u4F46\u6CA1\u6709\u53EF\u4FE1\u7684 ownership \u7ED3\u8BBA\uFF1A${unownedPaths.join("\u3001")}`,
      impact: "\u64CD\u4F5C\u6CA1\u6709\u63A8\u8FDB feature\u3001checkpoint\u3001verification \u6216\u4EA4\u4ED8\u72B6\u6001\u3002",
      recoveryKind: "refresh",
      recoveryInstruction: "\u5148\u8C03\u7528 dev_flow_reconcile_workspace\uFF0C\u6309\u5F53\u524D\u6E05\u5355\u5B8C\u6210\u5168\u90E8\u7EB3\u5165\u3001\u5168\u90E8\u6392\u9664\u6216\u9010\u4E2A\u786E\u8BA4\uFF0C\u518D\u91CD\u8BD5\u539F\u64CD\u4F5C\u3002",
      retryOriginal: true,
      operation,
      unownedPaths
    });
  }
  return reconciled.workspace;
}
async function readFeatureEvents(root2, id) {
  try {
    return (await readFile16(eventPath(root2, id), "utf8")).split("\n").filter(Boolean).map((line) => JSON.parse(line));
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }
}
async function startFeature(root2, input, options = {}) {
  await readProjectConfig(root2);
  await assertHostHealth(root2, input.host, "\u5F00\u59CB\u4EFB\u52A1");
  await assertNoOpenRecovery(root2);
  await assertNoOpenRollbackTransaction(root2);
  const scope = validateScopeInput(input.scope);
  const id = input.featureId ?? randomUUID13();
  const release = await lock(root2, id, "start");
  try {
    await assertNoOpenRecovery(root2);
    await assertNoOpenRollbackTransaction(root2);
    const active = await readActive(root2);
    const lifecycle = input.activation ?? "active";
    if (lifecycle === "active" && active) {
      const activeState = await readState(root2, active.featureId);
      let existingPending;
      let pendingUnreadable = false;
      try {
        existingPending = pendingDecisionForState(activeState);
      } catch {
        pendingUnreadable = true;
        existingPending = void 0;
      }
      const switchInteractionCreated = !existingPending && !pendingUnreadable;
      if (switchInteractionCreated) {
        let presentationEventId;
        await mutatePreparedLocked(root2, active.featureId, activeState.revision, "task-switch-presented", async () => ({
          mutate: (draft) => {
            presentationEventId = presentTaskSwitch(draft, { targetFeatureId: id, objective: objectiveForSwitch(input) }).presentationEventId;
          },
          eventData: () => ({ targetFeatureId: id, presentationEventId })
        }));
      }
      throw new DevFlowError("TASK_SWITCH_REQUIRED", "\u53E6\u4E00\u4E2A feature \u5F53\u524D\u5904\u4E8E active \u72B6\u6001\u3002", {
        userMessage: "\u5F53\u524D\u5DF2\u6709\u4E00\u4E2A\u8FDB\u884C\u4E2D\u7684\u4EFB\u52A1\uFF0C\u8BF7\u5148\u51B3\u5B9A\u5982\u4F55\u5904\u7406\u5B83\u3002",
        cause: switchInteractionCreated ? "\u7CFB\u7EDF\u4E0D\u4F1A\u540E\u53F0 finalize\u3001\u6682\u505C\u3001\u7EC8\u6B62\u6216\u5207\u6362\u65E7\u4EFB\u52A1\u3002" : "\u65E7\u4EFB\u52A1\u4ECD\u6709\u5F85\u51B3\u95EE\u9898\uFF0C\u7CFB\u7EDF\u6CA1\u6709\u521B\u5EFA task-switch \u4EA4\u4E92\uFF0C\u4E5F\u4E0D\u4F1A\u540E\u53F0\u5207\u6362\u4EFB\u52A1\u3002",
        impact: "\u65B0\u4EFB\u52A1\u5C1A\u672A\u521B\u5EFA\uFF0C\u4E5F\u6CA1\u6709\u6539\u53D8\u65E7\u4EFB\u52A1\u7684\u6267\u884C\u72B6\u6001\u3002",
        recoveryKind: "ask-user",
        recoveryInstruction: switchInteractionCreated ? "\u65E7\u4EFB\u52A1\u4E0A\u6709\u5F85\u5904\u7406\u7684\u4EFB\u52A1\u5207\u6362\u95EE\u9898\uFF1A\u5148\u8C03\u7528 dev_flow_answer \u56DE\u7B54\u5B83\uFF08finish-old=\u5148\u5B8C\u6210\u5F53\u524D\u4EFB\u52A1\u3001pause-old=\u6682\u505C\u5F53\u524D\u4EFB\u52A1\u540E\u5F00\u59CB\u65B0\u4EFB\u52A1\u3001return-old=\u8FD4\u56DE\u5F53\u524D\u4EFB\u52A1\uFF09\uFF0C\u518D\u91CD\u8BD5\u5F00\u59CB\u65B0\u4EFB\u52A1\u3002" : "\u65E7\u4EFB\u52A1\u6709\u5F85\u51B3\u95EE\u9898\u672A\u89E3\u51B3\u3002\u5148\u8C03\u7528 dev_flow_answer \u56DE\u7B54\u8BE5\u95EE\u9898\uFF0C\u518D\u91CD\u8BD5\u5F00\u59CB\u65B0\u4EFB\u52A1\u3002",
        requiresUserDecision: true,
        retryOriginal: false,
        activeFeatureId: active.featureId,
        ...switchInteractionCreated ? { kind: "task-switch", question: TASK_SWITCH_QUESTION } : {},
        ...existingPending ? { kind: existingPending.kind, question: existingPending.question } : {}
      });
    }
    const objective = typeof input.objective === "string" && input.objective.trim().length > 0 ? input.objective.trim() : "\u672A\u547D\u540D\u9700\u6C42";
    const project = await readProjectConfig(root2);
    const startBusinessFingerprint = await fingerprintGovernedRoots(root2, project);
    const directory = path20.join(features2(root2), id);
    const existedBefore = await pathExists4(directory);
    let stateCommitted = false;
    try {
      await mkdir11(directory, { recursive: true });
      const workflowCapabilities = normalizeWorkflowCapabilities(SUPPORTED_WORKFLOW_CAPABILITIES);
      const capturedWorkspace = ownershipForScope(await captureWorkspaceLineage(root2, project), scope.inScope, scope.outOfScope);
      const deliveryBaseline = {
        gitHead: capturedWorkspace.baseHead || void 0,
        dirtyPaths: Object.keys(capturedWorkspace.startedDirty),
        baseBranch: capturedWorkspace.baseBranch,
        startedDirty: capturedWorkspace.startedDirty
      };
      const state = {
        schemaVersion: 5,
        mode: "intake",
        featureId: id,
        revision: 0,
        lifecycle,
        objective,
        scope,
        workspace: capturedWorkspace,
        evidenceFreshness: { review: "missing", verification: "missing", checkpoint: "missing", implementation: "current" },
        steps: {},
        humanGates: {},
        artifacts: {},
        verification: { attempts: [] },
        acceptance: { evidence: [], dispositions: [] },
        interactions: {},
        workflowCapabilities,
        checkpoints: [],
        startBusinessFingerprint,
        deliveryBaseline,
        blockingFindings: [],
        logicComplete: false,
        governance: { decisions: [], claims: [], authorizations: [], credentials: [], repositoryFacts: [] },
        lastUpdatedBy: { host: input.host, pluginVersion: "5.1.0" }
      };
      const ownershipPaths = unknownOwnershipPaths(state);
      state.workspace.unownedPaths = ownershipPaths;
      validateFeatureState(state);
      await options.fault?.("before-state-commit");
      await writeAtomic2(statePath(root2, id), state);
      stateCommitted = true;
      const failures = [];
      try {
        await options.fault?.("after-state-commit");
      } catch {
        failures.push("after-state-commit");
      }
      try {
        await options.fault?.("before-event");
        await appendEvent(root2, id, state.revision, "started", {
          lifecycle,
          mode: state.mode,
          objective
        });
      } catch {
        failures.push("event");
      }
      if (lifecycle === "active") {
        try {
          await options.fault?.("before-active");
          await writeAtomic2(activePath(root2), { featureId: id, revision: state.revision, updatedAt: (/* @__PURE__ */ new Date()).toISOString() });
        } catch {
          failures.push("active");
        }
      }
      if (failures.length) {
        throw new DevFlowError("STATE_COMMITTED_PROJECTION_FAILED", "state commit succeeded but one or more projections failed", {
          committed: true,
          currentRevision: state.revision,
          failedProjections: failures
        });
      }
      return state;
    } catch (error) {
      if (!stateCommitted && !existedBefore) await rm3(directory, { recursive: true, force: true });
      throw error;
    }
  } finally {
    await release();
  }
}
async function mutate(root2, id, expectedRevision, operation, mutator, eventData = {}) {
  return mutatePrepared(root2, id, expectedRevision, operation, async () => ({ mutate: mutator, eventData }));
}
async function mutatePrepared(root2, id, expectedRevision, operation, prepare, options = {}) {
  const release = await lock(root2, id, operation);
  try {
    return await mutatePreparedLocked(root2, id, expectedRevision, operation, prepare, options);
  } finally {
    await release();
  }
}
async function mutatePreparedLocked(root2, id, expectedRevision, operation, prepare, options = {}) {
  const state = await readState(root2, id);
  await assertNoOpenRollbackTransaction(root2, { featureId: id, transactionId: options.allowRollbackTransaction });
  if (state.revision !== expectedRevision) throw new DevFlowError("STATE_REVISION_CONFLICT", "state revision changed", { currentRevision: state.revision });
  const prepared = await prepare(state, state.revision + 1);
  if (prepared.unchanged) return state;
  await prepared.mutate(state);
  state.revision += 1;
  await prepareReviewProjection(root2, state);
  validateFeatureState(state);
  const writeStatus = await prepareStatusProjection(root2, state, state.revision);
  await options.fault?.("before-state-commit");
  await writeAtomic2(statePath(root2, id), state);
  const failures = [];
  try {
    await options.fault?.("after-state-commit");
  } catch {
    failures.push("after-state-commit");
  }
  try {
    await writeStatus?.();
  } catch {
    failures.push("status");
  }
  try {
    const data = typeof prepared.eventData === "function" ? prepared.eventData() : prepared.eventData ?? {};
    await appendEvent(root2, id, state.revision, operation, data);
  } catch {
    failures.push("event");
  }
  try {
    const active = await readActive(root2);
    if (active?.featureId === id && (state.lifecycle === "finalized" || state.lifecycle === "abandoned" || state.lifecycle === "paused")) await rm3(activePath(root2), { force: true });
    else if (state.lifecycle === "active" && (active?.featureId === id || !active && ["feature-resumed", "workspace-reconciled", "feature-derived-state-repaired"].includes(operation))) await writeAtomic2(activePath(root2), { featureId: id, revision: state.revision, updatedAt: (/* @__PURE__ */ new Date()).toISOString() });
  } catch {
    failures.push("active");
  }
  if (failures.length) {
    throw new DevFlowError("STATE_COMMITTED_PROJECTION_FAILED", "state commit succeeded but one or more projections failed", {
      committed: true,
      currentRevision: state.revision,
      failedProjections: failures
    });
  }
  return state;
}
async function pauseFeature(root2, id, expectedRevision, reason, host) {
  if (!reason.trim()) throw new DevFlowError("PAUSE_REASON_REQUIRED", "\u6682\u505C\u9700\u8981\u8BF4\u660E\u539F\u56E0\u3002", { userMessage: "\u8BF7\u8BF4\u660E\u4E3A\u4EC0\u4E48\u6682\u505C\u5F53\u524D\u4EFB\u52A1\u3002", recoveryKind: "ask-user", recoveryInstruction: "\u8865\u5145\u4E00\u53E5\u6682\u505C\u539F\u56E0\u540E\u91CD\u8BD5\u3002", retryOriginal: true });
  return mutate(root2, id, expectedRevision, "feature-paused", (state) => {
    if (state.lifecycle !== "active") throw new DevFlowError("INVALID_LIFECYCLE", "\u53EA\u6709\u8FDB\u884C\u4E2D\u7684 feature \u53EF\u4EE5\u6682\u505C\u3002", { userMessage: "\u5F53\u524D feature \u4E0D\u80FD\u6682\u505C\u3002", recoveryKind: "refresh", recoveryInstruction: "\u5237\u65B0\u72B6\u6001\u540E\u4ECE\u5F53\u524D\u9636\u6BB5\u7EE7\u7EED\u3002", retryOriginal: false });
    state.lifecycle = "paused";
    const openStep = currentOpenStep(state);
    state.resumeSummary = `\u6682\u505C\u539F\u56E0\uFF1A${reason.trim()}\u3002\u6062\u590D\u540E\u5148\u5BF9\u8D26\u5DE5\u4F5C\u533A\uFF0C\u518D\u4ECE${openStep ? `\u201C${openStep}\u201D` : "\u5F53\u524D\u9636\u6BB5"}\u7EE7\u7EED\u3002`;
    state.lastUpdatedBy = { host, pluginVersion: "5.1.0" };
  }, { reason: reason.trim() });
}
async function resumeFeature(root2, id, host) {
  const current = await readState(root2, id);
  if (current.lifecycle !== "paused") throw new DevFlowError("INVALID_LIFECYCLE", "\u53EA\u6709\u5DF2\u6682\u505C\u7684 feature \u53EF\u4EE5\u6062\u590D\u3002", { userMessage: "\u5F53\u524D feature \u4E0D\u5728\u6682\u505C\u72B6\u6001\u3002", recoveryKind: "refresh", recoveryInstruction: "\u5237\u65B0\u72B6\u6001\u5E76\u7EE7\u7EED\u5F53\u524D active feature\u3002", retryOriginal: false });
  const active = await readActive(root2);
  if (active && active.featureId !== id) {
    throw new DevFlowError("TASK_SWITCH_REQUIRED", "\u53E6\u4E00\u4E2A feature \u5F53\u524D\u5904\u4E8E active \u72B6\u6001\u3002", {
      userMessage: "\u5F53\u524D\u5DF2\u6709\u53E6\u4E00\u4E2A\u8FDB\u884C\u4E2D\u7684\u4EFB\u52A1\uFF0C\u8BF7\u5148\u51B3\u5B9A\u662F\u5426\u5207\u6362\u3002",
      cause: `active feature \u4E3A ${active.featureId}\u3002`,
      impact: "\u7CFB\u7EDF\u4E0D\u4F1A\u540E\u53F0\u6682\u505C\u3001\u7EC8\u6B62\u6216\u5207\u6362\u4EFB\u4F55\u4EFB\u52A1\u3002",
      recoveryKind: "ask-user",
      recoveryInstruction: "\u8BF7\u9010\u9898\u9009\u62E9\uFF1A\u8FD4\u56DE\u5F53\u524D\u4EFB\u52A1\u3001\u6682\u505C\u5F53\u524D\u4EFB\u52A1\u540E\u6062\u590D\u6B64\u4EFB\u52A1\uFF0C\u6216\u5B8C\u6210\u65E7\u4EFB\u52A1\u3002",
      requiresUserDecision: true,
      retryOriginal: false,
      activeFeatureId: active.featureId
    });
  }
  const config = await readProjectConfig(root2);
  const { workspace, contentChanged, changedPaths: changedPaths2 } = await reconcileWorkspaceForFeature(root2, current, config);
  const legalCheckpointPaths = contentChanged ? await legalActiveUnitChanges(root2, current, changedPaths2) : /* @__PURE__ */ new Set();
  const checkpointAffected = contentChanged ? checkpointAffectedByPaths(current, changedPaths2, legalCheckpointPaths) : false;
  let presentationEventId;
  return mutate(root2, id, current.revision, "feature-resumed", (state) => {
    state.lifecycle = "active";
    state.workspace = workspace;
    if (contentChanged) {
      markAffectedEvidenceStale(state, changedPaths2, void 0, legalCheckpointPaths);
    }
    presentationEventId = queueNextOwnershipDecision(state);
    const openStep = currentOpenStep(state);
    state.resumeSummary = `\u5DF2\u6062\u590D${openStep ? `\uFF0C\u4ECE\u201C${openStep}\u201D\u7EE7\u7EED` : "\u5F53\u524D\u4EFB\u52A1"}\u3002${contentChanged ? "\u5DE5\u4F5C\u533A\u5185\u5BB9\u6709\u53D8\u5316\uFF0C\u76F8\u5173\u8BC1\u636E\u5DF2\u6807\u8BB0\u4E3A\u5F85\u66F4\u65B0\u3002" : ""}`;
    state.lastUpdatedBy = { host, pluginVersion: "5.1.0" };
  }, () => ({ observedHead: workspace.observedHead, contentChanged, checkpointAffected, ...presentationEventId ? { presentationEventId } : {} }));
}
async function abandonFeature(root2, id, expectedRevision, reason, userEvidence) {
  if (!reason || !userEvidence) throw new DevFlowError("ABANDON_EVIDENCE_REQUIRED", "abandon requires reason and user evidence");
  return mutate(root2, id, expectedRevision, "abandoned", async (state) => {
    if (state.lifecycle === "finalized" || state.lifecycle === "abandoned") throw new DevFlowError("INVALID_LIFECYCLE", "terminal feature cannot be abandoned");
    state.lifecycle = "abandoned";
    state.abandonment = { reason: reason.trim(), userEvidence: userEvidence.trim(), at: (/* @__PURE__ */ new Date()).toISOString() };
  }, { reason, userEvidence });
}
async function repairFeature(root2, id, expectedRevision, host) {
  const current = await readState(root2, id);
  const active = await readActive(root2);
  if (current.lifecycle === "active" && active && active.featureId !== id) {
    throw new DevFlowError("ACTIVE_POINTER_CONFLICT", "\u6D3B\u52A8\u6307\u9488\u6307\u5411\u53E6\u4E00\u4E2A feature\uFF0C\u4E0D\u80FD\u81EA\u52A8\u8986\u76D6\u3002", {
      userMessage: "\u68C0\u6D4B\u5230\u4E24\u4E2A\u4EFB\u52A1\u90FD\u58F0\u79F0\u5904\u4E8E\u6D3B\u52A8\u72B6\u6001\u3002",
      cause: `active pointer \u5F53\u524D\u6307\u5411 ${active.featureId}\u3002`,
      impact: "repair \u4E0D\u4F1A\u8986\u76D6\u53E6\u4E00\u4E2A\u4EFB\u52A1\u7684\u6D3B\u52A8\u6307\u9488\u3002",
      recoveryKind: "ask-user",
      recoveryInstruction: "\u5148\u51B3\u5B9A\u4FDD\u7559\u54EA\u4E2A active feature\uFF0C\u518D\u91CD\u8BD5 repair\u3002",
      requiresUserDecision: true,
      retryOriginal: false
    });
  }
  return mutate(root2, id, expectedRevision, "feature-derived-state-repaired", async (state) => {
    if (state.mode === "routed") {
      const fingerprint2 = await fingerprintGovernedRoots(root2, await readProjectConfig(root2));
      const events = await readFeatureEvents(root2, id);
      state.evidenceFreshness.verification = state.verification.satisfiedByAttemptId === void 0 ? "missing" : state.verification.verifiedFingerprint === fingerprint2 ? "current" : "stale";
      if (!state.review) {
        state.evidenceFreshness.review = "missing";
      } else {
        const ledger = await readReviewLedger(root2, state);
        const currentBatch3 = ledger.batches.find((batch) => batch.validity === "current");
        state.evidenceFreshness.review = currentBatch3 ? currentBatch3.progress === "complete" ? "current" : "missing" : ledger.batches.length ? "stale" : "missing";
      }
      let checkpointCaptureIndex = -1;
      for (let index = events.length - 1; index >= 0; index -= 1) {
        if (events[index].type === "automatic-checkpoint-captured") {
          checkpointCaptureIndex = index;
          break;
        }
      }
      const checkpointInvalidated = checkpointCaptureIndex >= 0 && events.slice(checkpointCaptureIndex + 1).some((event) => ["workspace-reconciled", "feature-resumed"].includes(event.type) && event.data?.checkpointAffected === true);
      state.evidenceFreshness.checkpoint = checkpointCaptureIndex < 0 ? "missing" : checkpointInvalidated ? "stale" : "current";
      state.evidenceFreshness.implementation = "current";
      const finalEvidenceCurrent = state.evidenceFreshness.verification === "current" && state.steps.finalize?.status === "satisfied" && Boolean(state.deliverySnapshot);
      if (state.lifecycle === "finalized" && !finalEvidenceCurrent) {
        state.lifecycle = active && active.featureId !== id ? "paused" : "active";
        delete state.deliverySnapshot;
      }
      state.logicComplete = state.lifecycle === "finalized" && finalEvidenceCurrent;
    }
    state.lastUpdatedBy = { host, pluginVersion: "5.1.0" };
  }, { repaired: ["active-pointer", "freshness", "review/status-projection"] });
}
function isRecoveryPhase(value) {
  return value === "prepared" || value === "directory-moved" || value === "active-cleared" || value === "completed";
}
function validateRecoveryTransaction(value) {
  const transaction = value;
  if (transaction?.schemaVersion !== 1 || typeof transaction.transactionId !== "string" || !transaction.transactionId || !isRecoveryPhase(transaction.phase) || typeof transaction.featureId !== "string" || !transaction.featureId || typeof transaction.stateSha256 !== "string" || !transaction.stateSha256 || typeof transaction.recoveredTo !== "string" || !path20.isAbsolute(transaction.recoveredTo) || typeof transaction.reason !== "string" || typeof transaction.userEvidence !== "string" || transaction.host !== "claude" && transaction.host !== "codex" || typeof transaction.at !== "string" || transaction.activeSha256 !== void 0 && typeof transaction.activeSha256 !== "string") {
    throw new DevFlowError("RECOVERY_TRANSACTION_UNREADABLE", "recovery journal is invalid", {
      recoveryHint: "Run dev_flow_doctor; do not start a new feature or hand-edit .dev-flow"
    });
  }
  if (path20.basename(transaction.featureId) !== transaction.featureId || transaction.featureId === "." || transaction.featureId === "..") {
    throw new DevFlowError("RECOVERY_TRANSACTION_UNREADABLE", "recovery journal has an unsafe feature id", { recoveryHint: "Run dev_flow_doctor; recovery remains fail-closed" });
  }
}
function validateRecoveryLocation(root2, transaction) {
  const recoveredRoot = path20.join(devFlow(root2), "recovered");
  const relative = path20.relative(recoveredRoot, transaction.recoveredTo);
  if (!relative || relative.startsWith("..") || path20.isAbsolute(relative) || path20.basename(relative) !== relative) {
    throw new DevFlowError("RECOVERY_TRANSACTION_UNREADABLE", "recovery journal points outside the recovered directory", {
      recoveryHint: "Run dev_flow_doctor; do not start a new feature or hand-edit .dev-flow"
    });
  }
}
async function readRecoveryTransaction(root2) {
  let raw;
  try {
    raw = await readFile16(recoveryTxnPath(root2), "utf8");
  } catch (error) {
    if (error.code === "ENOENT") return void 0;
    throw new DevFlowError("RECOVERY_TRANSACTION_UNREADABLE", "recovery journal cannot be read", { recoveryHint: "Run dev_flow_doctor; do not start a new feature" });
  }
  try {
    const transaction = JSON.parse(raw);
    validateRecoveryTransaction(transaction);
    validateRecoveryLocation(root2, transaction);
    return transaction;
  } catch (error) {
    if (error instanceof DevFlowError) throw error;
    throw new DevFlowError("RECOVERY_TRANSACTION_UNREADABLE", "recovery journal is not valid JSON", { recoveryHint: "Run dev_flow_doctor; do not start a new feature" });
  }
}
async function assertNoOpenRecovery(root2) {
  const transaction = await readRecoveryTransaction(root2);
  if (transaction) throw new DevFlowError("RECOVERY_TRANSACTION_OPEN", "resume the existing recovery before starting a feature", {
    featureId: transaction.featureId,
    phase: transaction.phase,
    recoveryHint: "Call dev_flow_recover_corrupt_feature again with the doctor-reported feature and digest"
  });
}
async function pathExists4(file) {
  try {
    await access4(file);
    return true;
  } catch {
    return false;
  }
}
async function fileSha256(file) {
  return createHash28("sha256").update(await readFile16(file)).digest("hex");
}
async function updateRecoveryTransaction(root2, transaction, phase) {
  const next = { ...transaction, phase, ...phase === "completed" ? { completedAt: (/* @__PURE__ */ new Date()).toISOString() } : {} };
  await writeAtomic2(recoveryTxnPath(root2), next);
  return next;
}
async function recoveryEventExists(root2, transactionId) {
  try {
    return (await readFile16(recoveryEventsPath(root2), "utf8")).split("\n").filter(Boolean).some((line) => {
      try {
        return JSON.parse(line).transactionId === transactionId;
      } catch {
        throw new DevFlowError("RECOVERY_EVENTS_UNREADABLE", "recovery audit log is invalid", { recoveryHint: "Run dev_flow_doctor; recovery remains fail-closed" });
      }
    });
  } catch (error) {
    if (error.code === "ENOENT") return false;
    throw error;
  }
}
async function appendRecoveryEvent(root2, transaction) {
  if (await recoveryEventExists(root2, transaction.transactionId)) return;
  const handle = await open7(recoveryEventsPath(root2), "a");
  try {
    await handle.writeFile(`${JSON.stringify({ ...transaction, phase: "completed", completedAt: (/* @__PURE__ */ new Date()).toISOString() })}
`);
    await handle.sync();
  } finally {
    await handle.close();
  }
}
async function resumeRecovery(root2, transaction) {
  const sourceDir = path20.join(features2(root2), transaction.featureId);
  if (transaction.phase === "prepared") {
    const [sourceExists, recoveredExists] = await Promise.all([pathExists4(sourceDir), pathExists4(transaction.recoveredTo)]);
    if (sourceExists === recoveredExists) throw new DevFlowError("RECOVERY_TRANSACTION_INCONSISTENT", "cannot safely determine feature-directory recovery stage", { recoveryHint: "Run dev_flow_doctor; do not start a new feature" });
    if (sourceExists) await rename6(sourceDir, transaction.recoveredTo);
    transaction = await updateRecoveryTransaction(root2, transaction, "directory-moved");
  }
  if (transaction.phase === "directory-moved") {
    if (transaction.activeSha256) {
      if (await pathExists4(activePath(root2))) {
        if (await fileSha256(activePath(root2)) !== transaction.activeSha256) {
          throw new DevFlowError("RECOVERY_POINTER_DIGEST_MISMATCH", "active pointer changed during recovery", { recoveryHint: "Run dev_flow_doctor; recovery remains fail-closed" });
        }
        await rename6(activePath(root2), path20.join(transaction.recoveredTo, "active.json"));
      }
    } else {
      const active = await readActive(root2);
      if (active && active.featureId !== transaction.featureId) {
        throw new DevFlowError("RECOVERY_TRANSACTION_INCONSISTENT", "active pointer changed during recovery", { recoveryHint: "Run dev_flow_doctor; do not start a new feature" });
      }
      if (active?.featureId === transaction.featureId) await rm3(activePath(root2), { force: true });
    }
    transaction = await updateRecoveryTransaction(root2, transaction, "active-cleared");
  }
  if (transaction.phase === "active-cleared") {
    await appendRecoveryEvent(root2, transaction);
    transaction = await updateRecoveryTransaction(root2, transaction, "completed");
  }
  if (transaction.phase === "completed") await rm3(recoveryTxnPath(root2), { force: true });
  return { recoveredTo: transaction.recoveredTo, featureId: transaction.featureId, stateSha256: transaction.stateSha256 };
}
async function readRollbackJournalPresence(root2, featureId) {
  let raw;
  try {
    raw = await readFile16(rollbackTxnPath2(root2, featureId), "utf8");
  } catch (error) {
    if (error.code === "ENOENT") return void 0;
    throw new DevFlowError("ROLLBACK_TRANSACTION_UNREADABLE", "rollback transaction journal cannot be read", {
      recoveryHint: "Run dev_flow_doctor; the workspace may be mid-rollback \u2014 do not hand-edit .dev-flow"
    });
  }
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new DevFlowError("ROLLBACK_TRANSACTION_UNREADABLE", "rollback transaction journal is not valid JSON", {
      recoveryHint: "Run dev_flow_doctor; the workspace may be mid-rollback \u2014 do not hand-edit .dev-flow"
    });
  }
  const journal = parsed;
  if (typeof journal.phase !== "string" || typeof journal.transactionId !== "string" || typeof journal.featureId !== "string") {
    throw new DevFlowError("ROLLBACK_TRANSACTION_UNREADABLE", "rollback transaction journal is invalid", {
      recoveryHint: "Run dev_flow_doctor; the workspace may be mid-rollback \u2014 do not hand-edit .dev-flow"
    });
  }
  if (journal.featureId !== featureId) {
    throw new DevFlowError("ROLLBACK_TRANSACTION_UNREADABLE", "rollback transaction journal feature id does not match its path", {
      recoveryHint: "Run dev_flow_doctor; the workspace may be mid-rollback \u2014 do not hand-edit .dev-flow"
    });
  }
  const finished = (journal.phase === "committed" || journal.phase === "compensated") && typeof journal.completedAt === "string";
  return { finished, transactionId: journal.transactionId, featureId: journal.featureId, phase: journal.phase };
}
async function assertNoOpenRollbackTransaction(root2, allow) {
  let entries;
  try {
    entries = await readdir6(features2(root2), { withFileTypes: true });
  } catch (error) {
    if (error.code === "ENOENT") return;
    throw error;
  }
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const presence = await readRollbackJournalPresence(root2, entry.name);
    if (!presence || presence.finished) continue;
    if (allow?.featureId === entry.name && allow.transactionId !== void 0 && allow.transactionId === presence.transactionId) continue;
    throw new DevFlowError("ROLLBACK_TRANSACTION_OPEN", "a rollback transaction is open", {
      transactionId: presence.transactionId,
      featureId: entry.name,
      phase: presence.phase,
      recoveryHint: `Resume the rollback transaction for feature ${entry.name} with the same input before mutating features`
    });
  }
}
async function appendFeatureEvent(root2, id, revision, type, data) {
  await appendEvent(root2, id, revision, type, data);
}
async function recoverCorruptFeature(root2, input) {
  if (input.action !== "abandon") throw new DevFlowError("INVALID_RECOVERY_ACTION", "only abandon is supported in 1.3");
  if (!input.reason || !input.userEvidence) throw new DevFlowError("RECOVERY_EVIDENCE_REQUIRED", "reason and userEvidence are required");
  if (path20.basename(input.featureId) !== input.featureId || input.featureId === "." || input.featureId === "..") throw new DevFlowError("INVALID_FEATURE_ID", "recovery featureId must name one feature directory");
  const release = await lock(root2, input.featureId, "recover-corrupt");
  try {
    await assertNoOpenRollbackTransaction(root2);
    const openTransaction = await readRecoveryTransaction(root2);
    if (openTransaction) {
      if (openTransaction.featureId !== input.featureId || openTransaction.stateSha256 !== input.stateSha256 || openTransaction.activeSha256 !== input.activeSha256) {
        throw new DevFlowError("RECOVERY_TRANSACTION_MISMATCH", "recovery input does not match the open journal", { recoveryHint: "Use the doctor-reported feature and digest to resume" });
      }
      return resumeRecovery(root2, openTransaction);
    }
    let pointerRecovery = false;
    try {
      const active = await readActive(root2);
      if (!active || active.featureId !== input.featureId) throw new DevFlowError("RECOVERY_NOT_ACTIVE", "featureId must be the active feature", { recoveryHint: "Run dev_flow_doctor and recover only the active corrupt feature" });
    } catch (error) {
      if (!(error instanceof DevFlowError) || error.code !== "ACTIVE_POINTER_UNREADABLE") throw error;
      if (!input.activeSha256) throw new DevFlowError("RECOVERY_POINTER_DIGEST_REQUIRED", "activeSha256 is required for a corrupt active pointer", { recoveryHint: "Use the active pointer digest from dev_flow_doctor" });
      const currentPointerDigest = await fileSha256(activePath(root2));
      if (currentPointerDigest !== input.activeSha256) throw new DevFlowError("RECOVERY_POINTER_DIGEST_MISMATCH", "activeSha256 does not match active.json", { currentDigest: currentPointerDigest, recoveryHint: "Re-run dev_flow_doctor" });
      pointerRecovery = true;
    }
    let digest13;
    try {
      digest13 = await stateFileSha256(root2, input.featureId);
    } catch {
      throw new DevFlowError("RECOVERY_STATE_MISSING", "feature state file is missing", { recoveryHint: "Run dev_flow_doctor; recovery remains fail-closed" });
    }
    if (digest13 !== input.stateSha256) throw new DevFlowError("RECOVERY_DIGEST_MISMATCH", "stateSha256 does not match current corrupt state", { currentDigest: digest13, recoveryHint: "Re-run dev_flow_doctor and use the reported stateSha256" });
    try {
      const state = await readState(root2, input.featureId);
      if (!pointerRecovery || state.lifecycle !== "active") throw new DevFlowError("RECOVERY_STATE_VALID", "feature state is readable; use abandon instead of recovery");
    } catch (error) {
      if (error instanceof DevFlowError && error.code === "RECOVERY_STATE_VALID") throw error;
    }
    const timestamp = (/* @__PURE__ */ new Date()).toISOString().replace(/[:.]/g, "-");
    const recoveredDir = path20.join(devFlow(root2), "recovered", `${input.featureId}-${timestamp}`);
    await mkdir11(path20.join(devFlow(root2), "recovered"), { recursive: true });
    const prepared = {
      schemaVersion: 1,
      transactionId: randomUUID13(),
      phase: "prepared",
      featureId: input.featureId,
      stateSha256: digest13,
      recoveredTo: recoveredDir,
      reason: input.reason,
      userEvidence: input.userEvidence,
      host: input.host,
      at: (/* @__PURE__ */ new Date()).toISOString(),
      ...pointerRecovery ? { activeSha256: input.activeSha256 } : {}
    };
    await writeAtomic2(recoveryTxnPath(root2), prepared);
    return resumeRecovery(root2, prepared);
  } finally {
    await release();
  }
}

// plugins/dev-flow/src/policy/rollback-warnings.ts
function isTestScope(pattern) {
  const normalized = pattern.normalize("NFC").replaceAll("\\", "/");
  return normalized.includes("__tests__") || /(^|\/)(tests?|fixtures?)(\/|$)/u.test(normalized) || /\.(test|spec)\./u.test(normalized);
}
function detectRollbackSplitWarning(nodes) {
  const current = new Map(nodes.filter((node) => node.kind === "implementation-unit" && node.status === "current").map((node) => [node.id, node]));
  const splits = [];
  for (const node of current.values()) {
    const implementationScope = node.fileScope.some((pattern) => !isTestScope(pattern));
    if (!implementationScope) continue;
    for (const dependencyId of node.dependsOn) {
      const dependency = current.get(dependencyId);
      if (dependency && dependency.fileScope.length > 0 && dependency.fileScope.every(isTestScope)) {
        splits.push(`${dependency.id}->${node.id}`);
      }
    }
  }
  return splits.length === 0 ? [] : [`\u6D4B\u8BD5\u4E0E\u5B9E\u73B0\u62C6\u4E3A\u4E0D\u540C\u5B9E\u73B0\u5355\u5143\uFF0C${[...new Set(splits)].sort().join(",")}\uFF1AA \u7684\u524D\u5411\u9A8C\u8BC1\u7EA2\u6D4B\u8BD5\u671F\u5FC5\u5931\u8D25\u6B7B\u9501\uFF1B\u5EFA\u8BAE\u5408\u5E76\u539F\u5B50\u5355\u5143`];
}

// plugins/dev-flow/src/core/artifacts.ts
var names = {
  requirements: "\u9700\u6C42\u6587\u6863.md",
  "implementation-plan": "\u5B9E\u65BD\u8BA1\u5212.md"
};
var hash = (value) => createHash29("sha256").update(value).digest("hex");
var featureDirectory5 = (root2, id) => path21.join(root2, ".dev-flow", "features", id);
var traceArtifactKinds = /* @__PURE__ */ new Set(["requirements", "implementation-plan"]);
var traceArtifactKindList = /* @__PURE__ */ new Set(["requirements", "implementation-plan"]);
var artifactInvalidations = {
  requirements: { afterStep: "requirements_alignment" },
  "implementation-plan": { afterStep: "planning", reopenFromStep: "planning" }
};
function template(state, id, kind) {
  if (traceArtifactKinds.has(kind)) {
    return renderArtifactTemplate({ featureId: id, route: state.route, requirementsState: state.classification.requirements, controls: state.classification.controls }, kind);
  }
  return `---
dev_flow:
  schema_version: 3
  feature_id: ${id}
  route: ${state.route}
  kind: ${kind}
---

# ${kind}

`;
}
function effectiveRoute(state) {
  return routeDefinitionForState(state);
}
function artifactKinds(definition) {
  return [.../* @__PURE__ */ new Set([...definition.requiredArtifacts, ...definition.generatedArtifacts ?? []])];
}
function assertManualRegistrationAllowed(state, kind, traceAware) {
  const route = effectiveRoute(state);
  if ((route.generatedArtifacts ?? []).includes(kind)) {
    throw new DevFlowError("GENERATED_ARTIFACT_READ_ONLY", `${kind} is generated from state and cannot be registered as manual evidence`);
  }
  if (!route.requiredArtifacts.includes(kind)) {
    throw new DevFlowError("ARTIFACT_NOT_REQUIRED", `${kind} is not required for ${state.route}`);
  }
  if (!traceAware && traceArtifactKinds.has(kind) && traceEnforcementRequired(state.route, state.classification.controls)) {
    throw new DevFlowError("TRACE_AWARE_REGISTRATION_REQUIRED", `${kind} must be registered with its Trace delta`);
  }
}
function assertPlanRevisionQuiescent(state, kind) {
  if (kind !== "implementation-plan") return;
  const active = (state.implementationUnits ?? []).find((unit) => unit.status === "active");
  if (active) {
    throw new DevFlowError("PLAN_REVISION_REQUIRES_QUIESCENT_UNIT", "implementation-plan cannot change while an implementation unit is active", {
      activeUnitId: active.unitId,
      hint: "\u5148 checkpoint\u3001\u53D6\u6D88\uFF08dev_flow_abandon_implementation_unit\uFF09\u6216 rollback \u518D\u4FEE\u8BA2\u8BA1\u5212"
    });
  }
}
function cleanupTombstonedPendingUnits(state, ledger) {
  if (!state.implementationUnits) return;
  state.implementationUnits = state.implementationUnits.filter((unit) => {
    if (unit.status !== "pending") return true;
    return ledger.nodes[unit.unitId]?.status === "current";
  });
}
function invalidateFromStep(state, kind) {
  const rule = artifactInvalidations[kind] ?? {};
  let planningReopened = false;
  const reopenFromStep = rule.reopenFromStep && reviewEnforcementRequired(state.route, state.classification.controls) ? rule.reopenFromStep : void 0;
  if (reopenFromStep) {
    const ordered = effectiveRoute(state).orderedSteps;
    const sourceIndex = ordered.indexOf(reopenFromStep);
    for (const step of ordered.slice(sourceIndex)) delete state.steps[step];
    planningReopened = reopenFromStep === "planning";
  } else if (rule.afterStep) {
    const ordered = effectiveRoute(state).orderedSteps;
    const sourceIndex = ordered.indexOf(rule.afterStep);
    for (const step of ordered.slice(sourceIndex + 1)) delete state.steps[step];
  }
  state.logicComplete = false;
  delete state.steps.finalize;
  return { planningReopened };
}
function invalidateArtifactDependents(state, kind, reason, executionBasisChanged) {
  const invalidation = invalidateFromStep(state, kind);
  if (executionBasisChanged) {
    for (const approval of approvalIds(state)) {
      delete state.humanGates[approval];
      clearInteractionsForTarget(state, `approval:${approval}`);
    }
    state.obligations = reopenObligations(state.obligations, ["approval"]);
  }
  if (kind === "requirements") clearInteractionsByKind(state, "grill");
  state.logicComplete = false;
  delete state.steps.finalize;
  void reason;
  return invalidation;
}
async function assertArtifactCurrent(root2, id, state, kind) {
  const artifact = state.artifacts[kind];
  if (!artifact) throw new DevFlowError("MISSING_REQUIRED_ARTIFACT", kind);
  const contents = await readFile17(path21.join(featureDirectory5(root2, id), normalizeUnicode(artifact.path)), "utf8");
  if (hash(contents) !== artifact.sha256) throw new DevFlowError("ARTIFACT_INTEGRITY_FAILED", kind);
  return contents;
}
async function readArtifactText(root2, id, artifactPath) {
  return readFile17(path21.join(featureDirectory5(root2, id), normalizeUnicode(artifactPath)), "utf8");
}
async function scaffoldArtifact(root2, id, expectedRevision, kind) {
  const state = await readState(root2, id);
  if (state.lifecycle !== "active") throw new DevFlowError("INVALID_LIFECYCLE", "only active features can scaffold artifacts");
  const route = effectiveRoute(state);
  if (!artifactKinds(route).includes(kind)) throw new DevFlowError("ARTIFACT_NOT_REQUIRED", `${kind} is not required for ${state.route}`);
  if (kind === "plan-review" && reviewEnforcementRequired(state.route, state.classification.controls)) {
    throw new DevFlowError("GENERATED_ARTIFACT_READ_ONLY", "plan-review is generated from the immutable review ledger");
  }
  const currentStep = currentOpenStep(state);
  const requiredNow = currentStep ? [...route.artifactSteps?.[currentStep] ?? [], ...route.generatedArtifactSteps?.[currentStep] ?? []] : [];
  if (!requiredNow.includes(kind)) throw new DevFlowError("ARTIFACT_OUT_OF_ORDER", `${kind} is not required by ${currentStep ?? "a pending step"}`, { expectedStep: currentStep });
  const filename = names[kind] ? normalizeUnicode(names[kind]) : void 0;
  if (!filename) throw new DevFlowError("INVALID_ARTIFACT", "unknown artifact kind");
  const target = path21.join(featureDirectory5(root2, id), filename);
  const content = template(state, id, kind);
  await writeFile4(target, content, { flag: "wx" }).catch(async (error) => {
    if (error.code !== "EEXIST") throw error;
  });
  const contents = await readFile17(target, "utf8");
  return mutate(root2, id, expectedRevision, "artifact-scaffolded", (current) => {
    current.artifacts[kind] = { path: filename, sha256: hash(contents) };
  });
}
async function recordArtifact(root2, id, expectedRevision, kind) {
  const state = await readState(root2, id);
  assertManualRegistrationAllowed(state, kind, false);
  assertPlanRevisionQuiescent(state, kind);
  const artifact = state.artifacts[kind];
  if (!artifact) throw new DevFlowError("MISSING_REQUIRED_ARTIFACT", kind);
  const contents = await readFile17(path21.join(featureDirectory5(root2, id), normalizeUnicode(artifact.path)), "utf8");
  const checksum = hash(contents);
  if (kind === "implementation-plan" && state.classification.controls.plan === "formal") {
    const errors = validatePlanTaskGraph(contents);
    if (errors.length) {
      throw new DevFlowError("PLAN_TASK_GRAPH_INVALID", "\u5B9E\u65BD\u8BA1\u5212\u7684\u4EFB\u52A1\u95F4\u5173\u7CFB\u6821\u9A8C\u672A\u901A\u8FC7", {
        errors,
        recoveryHint: "\u4FEE\u6B63\u8BA1\u5212\u4E2D\u6BCF\u4E2A\u4EFB\u52A1\u58F0\u660E\u7684 implementation_unit\u3001\u6BCF\u4E2A UNIT \u7684 tasks/depends_on\uFF0C\u786E\u4FDD\u5F15\u7528\u95ED\u5408\u4E14\u4F9D\u8D56\u65E0\u73AF\u540E\u91CD\u65B0\u767B\u8BB0"
      });
    }
  }
  return mutate(root2, id, expectedRevision, "artifact-recorded", (current) => {
    assertPlanRevisionQuiescent(current, kind);
    current.artifacts[kind] = { ...artifact, path: normalizeUnicode(artifact.path), sha256: checksum };
    invalidateArtifactDependents(current, kind, "artifact-changed", true);
  }, { kind, invalidationReason: "artifact-changed", planningReopened: kind === "implementation-plan" && reviewEnforcementRequired(state.route, state.classification.controls) });
}
async function recordArtifactWithTrace(root2, id, expectedRevision, artifactKind, traceDelta, options = {}) {
  if (!traceArtifactKindList.has(artifactKind)) throw new DevFlowError("INVALID_ARTIFACT", artifactKind);
  let eventData = { kind: artifactKind };
  let warnings = [];
  const state = await mutatePrepared(root2, id, expectedRevision, "artifact-recorded-with-trace", async (current, nextStateRevision) => {
    if (current.lifecycle !== "active") throw new DevFlowError("INVALID_LIFECYCLE", "only active features can register artifacts");
    if (!traceEnforcementRequired(current.route, current.classification.controls)) {
      throw new DevFlowError("TRACE_NOT_ENFORCED", `${artifactKind} does not use Trace registration on ${current.route}`, {
        route: current.route,
        recoveryHint: "\u5F53\u524D\u8DEF\u7EBF\u4E0D\u5F3A\u5236 Trace\uFF1B\u8BF7\u6539\u7528 dev_flow_record_artifact \u767B\u8BB0\u8BE5\u6587\u6863"
      });
    }
    assertManualRegistrationAllowed(current, artifactKind, true);
    assertPlanRevisionQuiescent(current, artifactKind);
    const compilation = await compileArtifactPlan(root2, id, current, { artifactKind, traceDelta, nextStateRevision });
    const compile = compilation.result;
    const artifact = compilation.artifact;
    const artifactSha256 = compilation.input.artifactSha256;
    const currentLedger = compilation.input.currentLedger;
    const config = compilation.config;
    if (!compile.ok || !compile.ledger) {
      throw new DevFlowError("PLAN_INVALID", "\u5B9E\u65BD\u8BA1\u5212\u7F16\u8BD1\u672A\u901A\u8FC7\u3002", {
        diagnostics: compile.diagnostics,
        userMessage: "\u5B9E\u65BD\u8BA1\u5212\u5B58\u5728\u9700\u8981\u4FEE\u6B63\u7684\u95EE\u9898\u3002",
        cause: `\u8BA1\u5212\u7F16\u8BD1\u53D1\u73B0 ${compile.diagnostics.length} \u5904\u95EE\u9898\u3002`,
        impact: "\u8BA1\u5212\u6CA1\u6709\u767B\u8BB0\uFF0C\u72B6\u6001\u4E0E\u5DE5\u4EF6\u5747\u672A\u53D8\u5316\u3002",
        recoveryKind: "retry",
        recoveryInstruction: "\u6309\u8BCA\u65AD\u9010\u9879\u4FEE\u6B63\u8BA1\u5212\u540E\u91CD\u65B0\u9884\u68C0\u5E76\u767B\u8BB0\u3002",
        retryOriginal: true
      });
    }
    const ledger = compile.ledger;
    const executionNodes = Object.values(ledger.nodes).filter((node) => node.status === "current" && node.kind !== "test").map((node) => node.kind === "rollback" ? {
      kind: node.kind,
      id: node.id,
      tasks: node.tasks,
      dependsOn: node.dependsOn,
      fileScope: node.fileScope,
      covers: node.covers,
      forwardVerification: node.forwardVerification,
      rollbackVerification: node.rollbackVerification
    } : node.kind === "implementation-unit" ? {
      kind: node.kind,
      id: node.id,
      tasks: node.tasks,
      dependsOn: node.dependsOn,
      fileScope: node.fileScope,
      covers: node.covers,
      forwardVerification: node.forwardVerification
    } : node.kind === "recovery" ? {
      kind: node.kind,
      id: node.id,
      stepRef: node.stepRef,
      recoveryKind: node.recoveryKind,
      method: node.method,
      riskRef: node.riskRef
    } : node.kind === "task" ? { kind: node.kind, id: node.id, covers: node.covers, implementationUnit: node.implementationUnit } : { kind: node.kind, id: node.id }).sort((left, right) => left.id.localeCompare(right.id));
    const executionVerificationRefs = Object.values(ledger.nodes).filter((node) => node.status === "current" && (node.kind === "implementation-unit" || node.kind === "rollback")).flatMap((node) => node.kind === "implementation-unit" ? node.forwardVerification : [...node.forwardVerification, ...node.rollbackVerification]);
    const executionSemanticBasisHash = hash(JSON.stringify({
      nodes: executionNodes,
      verificationCommandHashes: verificationCommandHashesForRefs(config, executionVerificationRefs)
    }));
    warnings = detectRollbackSplitWarning(Object.values(ledger.nodes).filter((node) => node.kind === "implementation-unit"));
    const pointer = await writeTraceSnapshot(root2, ledger, options.snapshot);
    const artifactChanged = artifact.sha256 !== artifactSha256;
    const traceChanged = JSON.stringify(currentLedger.nodes) !== JSON.stringify(ledger.nodes) || JSON.stringify(currentLedger.edges) !== JSON.stringify(ledger.edges);
    const executionBasisChanged = current.executionSemanticBasisHash !== executionSemanticBasisHash;
    const reviewPointer = artifactChanged || traceChanged ? await prepareReviewInvalidation(root2, current, nextStateRevision) : void 0;
    eventData = {
      kind: artifactKind,
      artifactChanged,
      traceChanged,
      invalidationReason: artifactChanged ? "artifact-changed" : traceChanged ? "trace-changed" : void 0,
      ...executionBasisChanged ? { executionBasisChanged: true } : {},
      ...warnings.length ? { warnings } : {}
    };
    return {
      mutate: (draft) => {
        draft.artifacts[artifactKind] = { ...artifact, sha256: artifactSha256 };
        draft.traceability = pointer;
        draft.executionSemanticBasisHash = executionSemanticBasisHash;
        if (reviewPointer) draft.review = reviewPointer;
        if (artifactChanged || traceChanged || executionBasisChanged) {
          const invalidation = invalidateArtifactDependents(
            draft,
            artifactKind,
            artifactChanged ? "artifact-changed" : "trace-changed",
            executionBasisChanged
          );
          cleanupTombstonedPendingUnits(draft, ledger);
          eventData = { ...eventData, planningReopened: invalidation.planningReopened };
        }
      },
      eventData: () => eventData
    };
  }, options.mutation);
  return warnings.length ? { state, warnings } : { state };
}
async function assertArtifactIntegrity(root2, id) {
  const state = await readState(root2, id);
  for (const kind of artifactKinds(effectiveRoute(state))) {
    await assertArtifactCurrent(root2, id, state, kind);
  }
}
async function validatePlan(root2, id, artifactKind, traceDelta) {
  const state = await readState(root2, id);
  if (!traceArtifactKindList.has(artifactKind)) throw new DevFlowError("INVALID_ARTIFACT", artifactKind);
  if (state.lifecycle !== "active") throw new DevFlowError("INVALID_LIFECYCLE", "only active features can validate plans");
  if (!traceEnforcementRequired(state.route, state.classification.controls)) {
    throw new DevFlowError("TRACE_NOT_ENFORCED", `${artifactKind} does not use Trace registration on ${state.route}`, {
      route: state.route,
      recoveryHint: "\u5F53\u524D\u8DEF\u7EBF\u4E0D\u5F3A\u5236 Trace\uFF1B\u8BF7\u6539\u7528 dev_flow_record_artifact \u767B\u8BB0\u8BE5\u6587\u6863"
    });
  }
  const { result } = await compileArtifactPlan(root2, id, state, { artifactKind, traceDelta, nextStateRevision: state.revision + 1 });
  return {
    ok: result.ok,
    diagnostics: result.diagnostics,
    ...result.implementationUnits ? { implementationUnits: result.implementationUnits } : {},
    ...result.recoveryArrangements ? { recoveryArrangements: result.recoveryArrangements } : {}
  };
}

// plugins/dev-flow/src/core/feature-check.ts
import { createHash as createHash31 } from "node:crypto";

// plugins/dev-flow/src/core/delivery-snapshot.ts
import { createHash as createHash30 } from "node:crypto";
import { execFile as execFile6 } from "node:child_process";
import { lstat as lstat7, readFile as readFile18, writeFile as writeFile5 } from "node:fs/promises";
import path22 from "node:path";
import { promisify as promisify6 } from "node:util";
var run5 = promisify6(execFile6);
var digest12 = (value) => createHash30("sha256").update(value).digest("hex");
async function git2(root2, args, allowExitOne = false) {
  try {
    const result = await run5("git", args, { cwd: root2, encoding: "buffer", maxBuffer: 8 * 1024 * 1024 });
    return Buffer.from(result.stdout).toString("utf8");
  } catch (error) {
    const failure2 = error;
    if (allowExitOne && failure2.code === 1) return Buffer.from(failure2.stdout ?? "").toString("utf8");
    const details = Buffer.from(failure2.stderr ?? failure2.message).toString("utf8").trim();
    throw new DevFlowError("DELIVERY_SNAPSHOT_GIT_REQUIRED", "delivery snapshots require a Git repository with a readable HEAD", {
      recoveryHint: "Initialize or repair Git, commit the baseline, then rerun finalize",
      ...details ? { gitError: details } : {}
    });
  }
}
function nulItems(value) {
  return value.split("\0").filter(Boolean);
}
function normalizePath2(value) {
  const slashPath = normalizeUnicode(value).replaceAll("\\", "/");
  const normalized = normalizeProjectPath(slashPath);
  if (!normalized || path22.posix.isAbsolute(normalized) || normalized.startsWith("../") || normalized === ".." || normalized.startsWith(".dev-flow/") || normalized !== slashPath) {
    throw new DevFlowError("INVALID_IMPLEMENTATION_FILE", "\u5B9E\u73B0\u6587\u4EF6\u5FC5\u987B\u662F\u89C4\u8303\u5316\u7684\u9879\u76EE\u76F8\u5BF9 governed \u8DEF\u5F84\u3002", {
      path: value
    });
  }
  return normalized;
}
function isWithinProtectedRoot(file, governedRoots) {
  return governedRoots.some((root2) => root2 === "." || file === root2 || file.startsWith(`${root2}/`));
}
function assertImplementationFilesInGovernedRoots(files, governedRoots) {
  if (files.some((file) => !isWithinProtectedRoot(file, governedRoots))) {
    throw new DevFlowError("INVALID_IMPLEMENTATION_FILE", "implementation files must be inside configured governedRoots", {
      governedRoots,
      recoveryHint: "\u5B9E\u73B0\u8BC1\u636E\u53EA\u767B\u8BB0 feature-owned \u4E14\u4F4D\u4E8E governedRoots \u7684\u6587\u4EF6\uFF1B\u6D4B\u8BD5\u3001\u65E5\u5FD7\u548C\u9A8C\u8BC1\u4EA7\u7269\u8BF7\u653E\u5165 verification evidence\uFF0C\u6216\u5148\u628A\u786E\u5C5E\u4EA4\u4ED8\u8303\u56F4\u7684\u76EE\u5F55\u52A0\u5165 governedRoots"
    });
  }
}
function implementationFiles(evidence) {
  if (typeof evidence !== "object" || evidence === null || Array.isArray(evidence)) {
    throw new DevFlowError("IMPLEMENTATION_FILES_REQUIRED", "implementation evidence must include files: string[]");
  }
  const files = evidence.files;
  if (!Array.isArray(files) || !files.every((file) => typeof file === "string")) {
    throw new DevFlowError("IMPLEMENTATION_FILES_REQUIRED", "implementation evidence must include files: string[]");
  }
  const normalized = files.map(normalizePath2);
  if (new Set(normalized).size !== normalized.length) {
    throw new DevFlowError("INVALID_IMPLEMENTATION_FILE", "implementation files must not contain duplicates");
  }
  return normalized.sort();
}
async function deriveImplementationFiles(root2, state, config) {
  const current = await gitBranchAndHead(root2);
  const committed = await changedPathsBetween(root2, state.workspace.baseHead, current.head);
  const dirty = await dirtyPaths2(root2, config);
  const changed = [.../* @__PURE__ */ new Set([...committed, ...dirty])].filter((file) => isWithinProtectedRoot(file, config.governedRoots)).filter((file) => !config.governedRootsExclude?.some((pattern) => pathWithinFileScope(file, [pattern]))).sort();
  const unknown = changed.filter((file) => state.workspace.ownership[file] !== "feature" && state.workspace.ownership[file] !== "excluded");
  if (unknown.length) throw new DevFlowError("DELIVERY_OWNERSHIP_UNRESOLVED", "\u5B58\u5728\u5C1A\u672A\u786E\u8BA4\u5F52\u5C5E\u7684 governed \u6587\u4EF6\u3002", {
    files: unknown,
    recoveryHint: "\u8FD0\u884C dev_flow_reconcile_workspace\uFF0C\u5E76\u9010\u4E2A\u56DE\u7B54 ownership decision \u540E\u91CD\u8BD5 implementation"
  });
  return changed.filter((file) => state.workspace.ownership[file] === "feature");
}
var missingFileHint = 'files \u53EA\u63A5\u53D7\u7EAF\u8DEF\u5F84\uFF0C\u5982 "src/foo.js"\uFF08\u800C\u975E "src/foo.js (\u65B0\u589E)"\uFF09\uFF1B\u5148\u521B\u5EFA\u6216\u767B\u8BB0\u5B9E\u9645\u5B58\u5728\u7684\u6587\u4EF6\u540E\u518D\u91CD\u5F55';
async function assertImplementationFilesExist(root2, files) {
  const missing = [];
  for (const file of files) {
    try {
      await lstat7(path22.join(root2, file));
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
      missing.push(file);
    }
  }
  if (!missing.length) return;
  let status;
  try {
    status = await git2(root2, ["status", "--porcelain=v1", "-z"]);
  } catch (error) {
    if (error instanceof DevFlowError && error.code === "DELIVERY_SNAPSHOT_GIT_REQUIRED") {
      throw new DevFlowError("INVALID_IMPLEMENTATION_FILE", `implementation file does not exist: ${missing.join(", ")}`, {
        files: missing,
        recoveryHint: missingFileHint
      });
    }
    throw error;
  }
  const allowed = /* @__PURE__ */ new Set();
  const items = nulItems(status);
  for (let index = 0; index < items.length; index += 1) {
    const item = items[index];
    if (item.length < 4) continue;
    const code = item.slice(0, 2);
    if (code.includes("D")) allowed.add(normalizePath2(item.slice(3)));
    if (/[RC]/.test(code)) {
      const original = items[index + 1];
      if (original) {
        allowed.add(normalizePath2(original));
        index += 1;
      }
    }
  }
  const stillMissing = missing.filter((file) => !allowed.has(file));
  if (stillMissing.length) {
    throw new DevFlowError("INVALID_IMPLEMENTATION_FILE", `implementation file does not exist: ${stillMissing.join(", ")}`, {
      files: stillMissing,
      recoveryHint: missingFileHint
    });
  }
}
function statusPaths(value) {
  const items = nulItems(value);
  const paths = /* @__PURE__ */ new Set();
  for (let index = 0; index < items.length; index += 1) {
    const item = items[index];
    if (item.length < 4) continue;
    const status = item.slice(0, 2);
    paths.add(normalizePath2(item.slice(3)));
    if (/[RC]/.test(status)) {
      const original = items[index + 1];
      if (original) {
        paths.add(normalizePath2(original));
        index += 1;
      }
    }
  }
  return [...paths].sort();
}
async function dirtyPaths2(root2, config) {
  const output = await git2(root2, ["status", "--porcelain=v1", "-z", "--untracked-files=all", "--", ...config.governedRoots]);
  return statusPaths(output).filter((file) => !config.governedRootsExclude?.some((pattern) => pathWithinFileScope(file, [pattern])));
}
async function fileHash(root2, file) {
  try {
    return digest12(await readFile18(path22.join(root2, file)));
  } catch (error) {
    if (error.code === "ENOENT") return "deleted";
    throw error;
  }
}
async function assertPlainFile(root2, file) {
  const metadata = await lstat7(path22.join(root2, file));
  if (!metadata.isFile()) throw new DevFlowError("INVALID_IMPLEMENTATION_FILE", "untracked implementation files must be regular files", { path: file });
}
async function untrackedFiles(root2, files) {
  if (!files.length) return /* @__PURE__ */ new Set();
  const output = await git2(root2, ["ls-files", "--others", "--exclude-standard", "-z", "--", ...files]);
  return new Set(nulItems(output).map(normalizePath2));
}
async function createDeliverySnapshot(root2, featureId, state, config) {
  const implementation2 = implementationFiles(state.steps.implementation?.evidence);
  assertImplementationFilesInGovernedRoots(implementation2, config.governedRoots);
  const baseline = state.deliveryBaseline;
  const lineage = state.workspace;
  if (!baseline?.gitHead || !lineage.baseHead) {
    throw new DevFlowError("DELIVERY_SNAPSHOT_GIT_REQUIRED", "\u4EA4\u4ED8\u5FEB\u7167\u9700\u8981 feature \u542F\u52A8\u65F6\u6355\u83B7\u7684 Git \u57FA\u7EBF\u3002", {
      userMessage: "\u5F53\u524D\u4ED3\u5E93\u6CA1\u6709\u53EF\u8BC1\u660E\u7684 Git \u57FA\u7EBF\uFF0C\u4E0D\u80FD\u751F\u6210\u4EA4\u4ED8\u5FEB\u7167\u3002",
      cause: "\u542F\u52A8\u65F6\u6CA1\u6709\u53EF\u8BFB\u53D6\u7684 HEAD\u3002",
      impact: "\u6700\u7EC8\u4EA4\u4ED8\u5185\u5BB9\u65E0\u6CD5\u4E0E\u542F\u52A8\u72B6\u6001\u6BD4\u8F83\u3002",
      recoveryKind: "repair",
      recoveryInstruction: "\u4FEE\u590D Git \u4ED3\u5E93\u540E\u91CD\u65B0\u5F00\u59CB feature\uFF1B\u7CFB\u7EDF\u4E0D\u4F1A\u731C\u6D4B\u57FA\u7EBF\u3002",
      retryOriginal: false
    });
  }
  const current = await gitBranchAndHead(root2);
  if (lineage.baseBranch && current.branch !== lineage.baseBranch) {
    throw new DevFlowError("GIT_BRANCH_CHANGED", "\u5F53\u524D\u5206\u652F\u4E0E feature \u542F\u52A8\u5206\u652F\u4E0D\u540C\u3002", { baseBranch: lineage.baseBranch, currentBranch: current.branch, recoveryHint: "\u5207\u56DE\u542F\u52A8\u5206\u652F\u540E\u91CD\u65B0\u5BF9\u8D26" });
  }
  if (!await isAncestor(root2, lineage.baseHead, current.head)) {
    throw new DevFlowError("GIT_HISTORY_REWRITE", "\u5F53\u524D HEAD \u4E0D\u662F feature \u57FA\u7EBF\u7684\u7956\u5148\u94FE\u540E\u4EE3\u3002", { baseHead: lineage.baseHead, currentHead: current.head, recoveryHint: "\u6062\u590D\u53EF\u8BC1\u660E\u7684\u63D0\u4EA4\u94FE\u540E\u91CD\u65B0\u5BF9\u8D26" });
  }
  const initialDirty = new Set(Object.keys(lineage.startedDirty).length ? Object.keys(lineage.startedDirty) : baseline.dirtyPaths);
  const currentDirty = await dirtyPaths2(root2, config);
  const committed = await changedPathsBetween(root2, lineage.baseHead, current.head);
  const featureOwned = /* @__PURE__ */ new Set([
    ...implementation2,
    ...Object.entries(lineage.ownership).filter(([, owner]) => owner === "feature").map(([file]) => file)
  ]);
  const protectedChanged = [.../* @__PURE__ */ new Set([...committed, ...currentDirty])].filter((file) => isWithinProtectedRoot(file, config.governedRoots));
  const unexpected = protectedChanged.filter((file) => !featureOwned.has(file) && !(initialDirty.has(file) && lineage.ownership[file] === "excluded"));
  if (unexpected.length) {
    throw new DevFlowError("DELIVERY_FILE_UNREGISTERED", "\u5B58\u5728\u5C1A\u672A\u5F52\u5C5E\u7684\u53D7\u4FDD\u62A4\u6587\u4EF6\u53D8\u66F4\u3002", {
      files: unexpected,
      userMessage: "\u53D1\u73B0\u672A\u5F52\u5C5E\u7684\u53D7\u4FDD\u62A4\u6587\u4EF6\u53D8\u66F4\uFF0C\u4E0D\u80FD\u751F\u6210\u4EA4\u4ED8\u5FEB\u7167\u3002",
      cause: "\u7CFB\u7EDF\u4E0D\u4F1A\u731C\u6D4B\u8FD9\u4E9B\u6539\u52A8\u5C5E\u4E8E\u5F53\u524D feature\u3002",
      impact: "\u4EA4\u4ED8\u5FEB\u7167\u53EF\u80FD\u6DF7\u5165\u5176\u4ED6\u4EFB\u52A1\u7684\u5185\u5BB9\u3002",
      recoveryKind: "ask-user",
      recoveryInstruction: "\u5148\u901A\u8FC7\u5DE5\u4F5C\u533A\u5BF9\u8D26\u63A5\u7EB3\u6587\u4EF6\u3001\u8C03\u6574\u8303\u56F4\uFF0C\u6216\u7531\u7528\u6237\u5904\u7406\u8FD9\u4E9B\u6587\u4EF6\u540E\u91CD\u8BD5\u3002",
      requiresUserDecision: true,
      retryOriginal: false
    });
  }
  const claimedDirty = [...featureOwned].filter((file) => initialDirty.has(file) && lineage.ownership[file] !== "feature");
  if (claimedDirty.length) {
    throw new DevFlowError("DELIVERY_FILE_PREEXISTING_DIRTY", "feature-owned \u6587\u4EF6\u5728\u542F\u52A8\u65F6\u5DF2\u7ECF\u6709\u672A\u5F52\u5C5E\u6539\u52A8\u3002", {
      files: claimedDirty,
      userMessage: "\u5F53\u524D feature \u7684\u6587\u4EF6\u5728\u542F\u52A8\u524D\u5DF2\u6709\u6539\u52A8\uFF0C\u5C1A\u672A\u5B8C\u6210\u5F52\u5C5E\u3002",
      cause: "\u542F\u52A8\u810F\u6811\u5FC5\u987B\u5148\u7ECF\u8FC7\u7528\u6237\u5F52\u5C5E\u51B3\u7B56\u3002",
      impact: "\u7CFB\u7EDF\u4E0D\u4F1A\u628A\u9884\u5B58\u6539\u52A8\u9759\u9ED8\u7B97\u5165\u672C\u6B21\u4EA4\u4ED8\u3002",
      recoveryKind: "ask-user",
      recoveryInstruction: "\u63A5\u7EB3\u8FD9\u4E9B\u6539\u52A8\u4E3A\u5F53\u524D feature\uFF0C\u6216\u5148\u63D0\u4EA4\u3001\u6682\u5B58/\u6062\u590D\u540E\u518D\u7EE7\u7EED\u3002",
      requiresUserDecision: true,
      retryOriginal: false
    });
  }
  const files = [...featureOwned].sort();
  const excludedChangedPaths = protectedChanged.filter((file) => lineage.ownership[file] === "excluded").sort();
  const untracked = await untrackedFiles(root2, files);
  const tracked = files.filter((file) => !untracked.has(file));
  const patches = [];
  if (tracked.length) patches.push(await git2(root2, ["diff", "--binary", "--full-index", "--no-ext-diff", lineage.baseHead, "--", ...tracked]));
  for (const file of [...untracked].sort()) {
    await assertPlainFile(root2, file);
    patches.push(await git2(root2, ["diff", "--binary", "--no-index", "--", "/dev/null", file], true));
  }
  const relativeDirectory2 = path22.posix.join(".dev-flow", "features", featureId);
  const patchFilename = "\u4EA4\u4ED8\u5FEB\u7167.patch";
  const manifestFilename = "\u4EA4\u4ED8\u5FEB\u7167\u6587\u6863.md";
  const patchPath = path22.posix.join(relativeDirectory2, patchFilename);
  const manifestPath2 = path22.posix.join(relativeDirectory2, manifestFilename);
  const patch = patches.filter(Boolean).join("\n");
  const patchHash = digest12(patch);
  await writeFile5(path22.join(root2, patchPath), patch, "utf8");
  const rows = await Promise.all(files.map(async (file) => `| ${file} | ${currentDirty.includes(file) ? "changed" : "unchanged"} | ${await fileHash(root2, file)} |`));
  const manifest = [
    "# \u4EA4\u4ED8\u5FEB\u7167",
    "",
    `- Feature: ${featureId}`,
    `- Base Git HEAD: ${lineage.baseHead}`,
    `- Final Git HEAD: ${current.head}`,
    `- Branch: ${current.branch}`,
    `- Commit range: ${lineage.baseHead}..${current.head}`,
    `- Patch: ${patchFilename}`,
    `- Patch SHA-256: ${patchHash}`,
    "",
    "## \u5DF2\u767B\u8BB0\u6587\u4EF6",
    "",
    "| \u8DEF\u5F84 | \u72B6\u6001 | SHA-256 |",
    "| --- | --- | --- |",
    ...rows,
    "",
    "## \u5F52\u5C5E\u8BB0\u5F55",
    "",
    `- Feature-owned \u8DEF\u5F84\uFF1A${files.length ? files.join(", ") : "\u65E0"}`,
    `- \u7528\u6237\u624B\u52A8\u63A5\u7EB3\u8DEF\u5F84\uFF1A${Object.entries(lineage.ownershipSource).filter(([, source]) => source === "user-adopted").map(([file]) => file).join(", ") || "\u65E0"}`,
    `- \u672A\u63D0\u4EA4\u8DEF\u5F84\uFF1A${currentDirty.filter((file) => featureOwned.has(file)).join(", ") || "\u65E0"}`,
    `- \u7528\u6237\u63A5\u53D7\u98CE\u9669\uFF1A${currentRiskAuthorizations(state, { contentFingerprint: state.businessFingerprint }).map((authorization) => authorization.target).join(", ") || "\u65E0"}`,
    ...files.filter((file) => initialDirty.has(file) && lineage.ownershipSource[file] === "trusted-hook").length ? [
      `- \u5305\u542B\u542F\u52A8\u524D\u5DF2\u5B58\u5728\u6539\u52A8\u7684\u6587\u4EF6\uFF1A${files.filter((file) => initialDirty.has(file) && lineage.ownershipSource[file] === "trusted-hook").join(", ")}`
    ] : [],
    ...excludedChangedPaths.length ? [
      "",
      "## \u975E\u4EA4\u4ED8\u6539\u52A8",
      "",
      "\u4EE5\u4E0B\u8DEF\u5F84\u5DF2\u88AB\u6392\u9664\u6216\u4E0D\u5C5E\u4E8E\u5F53\u524D\u4EFB\u52A1\u4EA4\u4ED8\uFF0C\u4F46\u4ECD\u68C0\u6D4B\u5230\u53D8\u5316\uFF1B\u5B83\u4EEC\u4E0D\u4F1A\u8FDB\u5165\u4EA4\u4ED8 patch\uFF0C\u4E5F\u4E0D\u4F1A\u963B\u585E\u5B8C\u6210\u3002\u8BF7\u8BB0\u5F97\u5355\u72EC\u5904\u7406\uFF1A",
      "",
      ...excludedChangedPaths.map((file) => `- ${file}`)
    ] : [],
    "",
    "## \u56DE\u6EDA",
    "",
    `\u5728\u4ED3\u5E93\u6839\u76EE\u5F55\u6267\u884C\uFF1A\`git apply -R --binary ${patchPath}\``,
    ""
  ].join("\n");
  const manifestHash = digest12(manifest);
  await writeFile5(path22.join(root2, manifestPath2), manifest, "utf8");
  return {
    manifestPath: manifestPath2,
    manifestSha256: manifestHash,
    patchPath,
    patchSha256: patchHash,
    baseHead: lineage.baseHead,
    finalHead: current.head,
    branch: current.branch,
    files,
    commitRange: current.head === lineage.baseHead ? [] : [lineage.baseHead, current.head],
    ownedPaths: files,
    manualAdoptedPaths: Object.entries(lineage.ownershipSource).filter(([, source]) => source === "user-adopted").map(([file]) => file),
    uncommittedPaths: currentDirty.filter((file) => featureOwned.has(file)),
    qualityExceptions: currentRiskAuthorizations(state, { contentFingerprint: state.businessFingerprint }).map((authorization) => authorization.target),
    ...excludedChangedPaths.length ? { excludedChangedPaths } : {}
  };
}

// plugins/dev-flow/src/core/auto-checkpoint.ts
import { randomUUID as randomUUID14 } from "node:crypto";
async function captureAutomaticCheckpoint(root2, featureId, expectedRevision, stage, reason = "stage-boundary") {
  const config = await readProjectConfig(root2);
  const files = await snapshotGovernedRoots(root2, config);
  const fingerprint2 = await fingerprintGovernedRoots(root2, config);
  const capturedAt = (/* @__PURE__ */ new Date()).toISOString();
  const checkpoint = {
    checkpointId: `AUTO-${randomUUID14()}`,
    stage,
    capturedAt,
    fingerprint: fingerprint2,
    files: files.map((file) => file.path).sort(),
    basisHash: decisionBasisHash({ stage, reason, fingerprint: fingerprint2, files: files.map((file) => file.path).sort() })
  };
  return mutate(root2, featureId, expectedRevision, "automatic-checkpoint-captured", (state) => {
    state.checkpoints = [...state.checkpoints ?? [], checkpoint];
    state.evidenceFreshness.checkpoint = "current";
    state.obligations = satisfyObligations(state.obligations, ["checkpoint"]);
  }, { checkpointId: checkpoint.checkpointId, stage, reason });
}

// plugins/dev-flow/src/core/feature-check.ts
function assertRequiredEvidence(step, required, evidence) {
  const missing = missingRequiredEvidence(required, evidence);
  if (requiredEvidenceIsEmpty(missing)) return;
  const details = { step, requiredEvidence: required, missing };
  if (missing.fields.reviewType !== void 0) {
    throw new DevFlowError("REVIEW_TYPE_MISMATCH", `${step} reviewType is missing or incorrect`, details);
  }
  throw new DevFlowError("RISK_EVIDENCE_INCOMPLETE", `${step} evidence is incomplete`, details);
}
function assertRecordableStep(state, step) {
  if (state.lifecycle !== "active") {
    throw new DevFlowError("INVALID_LIFECYCLE", "only active features can record steps");
  }
  const route = routeDefinitionForState(state);
  if (["verification", "finalize"].includes(step) || !route.orderedSteps.includes(step)) {
    const recoveryHint = step === "verification" ? "\u8BF7\u8C03\u7528 dev_flow_verify" : step === "finalize" ? "\u8BF7\u8C03\u7528 dev_flow_finalize" : "\u8BF7\u4F7F\u7528\u5F53\u524D\u8DEF\u7EBF\u5141\u8BB8\u7684 record_step \u9636\u6BB5";
    throw new DevFlowError("INVALID_STEP", step, { recoveryHint });
  }
  assertCurrentStep(state, step);
}
function satisfyStepObligations(state, route, step) {
  if (step === "planning" && state.classification.controls.recovery.some((kind) => kind !== "delivery-reverse")) {
    state.obligations = satisfyObligations(state.obligations, ["rollback"]);
  }
  const riskReviewTarget = route.orderedSteps.includes("code_review") ? "code_review" : route.orderedSteps.includes("planning") ? "planning" : route.orderedSteps.includes("verification") ? "verification" : void 0;
  if (step === riskReviewTarget && state.classification.riskLabels.length > 0) {
    if (!reviewEnforcementRequired(state.route, state.classification.controls)) {
      state.obligations = satisfyObligations(state.obligations, ["review"]);
    }
    if (state.classification.riskLabels.includes("irreversible_consequence")) {
      state.obligations = satisfyObligations(state.obligations, ["rollback"]);
    }
  }
}
async function recordStep(root2, id, expectedRevision, step, evidence) {
  let normalizedEvidence = evidence;
  const initial = await readState(root2, id);
  if (initial.revision !== expectedRevision) {
    throw new DevFlowError("STATE_REVISION_CONFLICT", "state revision changed", {
      currentRevision: initial.revision
    });
  }
  const invalidated = await invalidateAffectedClaims(root2, id, expectedRevision);
  if (invalidated) throw workspaceChangedError(invalidated);
  assertRecordableStep(initial, step);
  if (step === "implementation") await assertHostHealth(root2, initial.lastUpdatedBy.host, "implementation \u63A8\u8FDB");
  if (step === "implementation") {
    const config = await readProjectConfig(root2);
    const files = await deriveImplementationFiles(root2, initial, config);
    await assertWorkspaceOwnershipComplete(root2, initial, config, "implementation \u63A8\u8FDB");
    assertImplementationFilesInGovernedRoots(files, config.governedRoots);
    await assertImplementationFilesExist(root2, files);
    normalizedEvidence = {
      derivedBy: "core",
      files
    };
  }
  const next = await mutate(root2, id, expectedRevision, "step-recorded", async (state) => {
    assertRecordableStep(state, step);
    const route = routeDefinitionForState(state);
    await assertRequirementsGrillSatisfied(root2, id, state);
    await assertTraceGateCurrent(root2, state, step);
    if (step === "implementation" && (Number(state.schemaVersion) === 4 || Number(state.schemaVersion) === 5) && checkpointsEnforcementRequired(state.route, state.classification.controls)) {
      await assertImplementationUnitsComplete(root2, state);
    }
    const required = requiredEvidenceForStep(
      state.route,
      state.classification.riskLabels,
      step,
      state.classification.controls
    );
    if (required.fields.reviewBatch || step === "code_review") {
      normalizedEvidence = await requireReviewReady(root2, state, { phase: step === "code_review" ? "code" : "plan" });
    } else {
      assertRequiredEvidence(step, required, normalizedEvidence);
    }
    if (step === "code_review") {
      const config = await readProjectConfig(root2);
      const snapshot = await snapshotGovernedRoots(root2, config);
      const fingerprint2 = await fingerprintFeatureOwned(root2, config, state.workspace.ownership);
      const snapshotPath = await persistThroughSnapshot(root2, id, snapshot, fingerprint2, "review");
      normalizedEvidence = { ...normalizedEvidence, fingerprint: fingerprint2, snapshotPath };
      const gov = state.governance ?? EMPTY_GOVERNANCE_LEDGER;
      const claimId = `CLAIM-${createHash31("sha256").update(`review-complete|code_review|${fingerprint2}`).digest("hex").slice(0, 16)}`;
      const claims = [...gov.claims];
      if (!claims.some((claim) => claim.recordId === claimId)) {
        claims.push({
          recordId: claimId,
          kind: "claim",
          claimType: "review-complete",
          subject: "code_review",
          basis: { kind: "content", sha256: fingerprint2 },
          recordedAt: (/* @__PURE__ */ new Date()).toISOString()
        });
      }
      state.governance = { ...gov, claims };
    }
    state.steps[step] = { status: "satisfied", evidence: normalizedEvidence };
    satisfyStepObligations(state, route, step);
  });
  if ((Number(next.schemaVersion) === 4 || Number(next.schemaVersion) === 5) && currentOpenStep(next) === "implementation" && !next.checkpoints?.length) {
    return captureAutomaticCheckpoint(root2, id, next.revision, "implementation", "implementation-entry");
  }
  if (step === "implementation" && (Number(next.schemaVersion) === 4 || Number(next.schemaVersion) === 5) && next.checkpoints?.length) {
    return captureAutomaticCheckpoint(root2, id, next.revision, "implementation", "implementation-complete");
  }
  return next;
}
async function assertImplementationUnitsComplete(root2, state) {
  const ledger = await readTraceability(root2, state);
  const required = Object.values(ledger.nodes).filter((node) => node.kind === "implementation-unit" && node.status === "current");
  const units = new Map((state.implementationUnits ?? []).map((unit) => [unit.unitId, unit]));
  const incomplete = required.map((node) => node.id).filter((nodeId) => units.get(nodeId)?.status !== "checkpointed");
  if (incomplete.length) {
    throw new DevFlowError("IMPLEMENTATION_UNITS_INCOMPLETE", "every implementation unit must be checkpointed before recording implementation", {
      incomplete
    });
  }
}
async function invalidateBeforeFinalClaim(root2, id, expectedRevision) {
  const invalidated = await invalidateAffectedClaims(root2, id, expectedRevision);
  if (invalidated) throw workspaceChangedError(invalidated);
}
function assertVerificationWasNotInvalidated(state) {
  const evidence = state.steps.verification?.evidence;
  if (evidence?.reason === "governed-files-changed" && !hasCurrentQualityException(state, "verification")) {
    throw new DevFlowError("VERIFICATION_STALE", "governed \u6587\u4EF6\u5DF2\u53D8\u5316\uFF0C\u8BF7\u91CD\u65B0\u8FD0\u884C\u9A8C\u8BC1\u3002");
  }
}
async function finalize(root2, id, expectedRevision) {
  const initial = await readState(root2, id);
  await assertHostHealth(root2, initial.lastUpdatedBy.host, "finalize");
  if (initial.revision !== expectedRevision) {
    throw new DevFlowError("STATE_REVISION_CONFLICT", "state revision changed", {
      currentRevision: initial.revision
    });
  }
  await assertRequirementsGrillSatisfied(root2, id, initial);
  await invalidateBeforeFinalClaim(root2, id, expectedRevision);
  await assertArtifactIntegrity(root2, id);
  const config = await readProjectConfig(root2);
  const reconciledWorkspace = await assertWorkspaceOwnershipComplete(root2, initial, config, "finalize");
  let snapshot;
  return mutate(root2, id, expectedRevision, "finalized", async (state) => {
    await assertRequirementsGrillSatisfied(root2, id, state);
    assertVerificationWasNotInvalidated(state);
    state.workspace = reconciledWorkspace;
    const open8 = currentOpenStep(state);
    if (open8 !== "finalize" && !(open8 && qualityExceptionCoversStep(state, open8))) {
      assertCurrentStep(state, "finalize");
    }
    await assertTraceGateCurrent(root2, state, "finalize");
    const requiredKinds = /* @__PURE__ */ new Set(["approval", "checkpoint", "verification"]);
    for (const obligation of state.obligations ?? []) {
      if (["review", "rollback"].includes(obligation.kind)) requiredKinds.add(obligation.kind);
    }
    const pending = (state.obligations ?? []).filter((obligation) => requiredKinds.has(obligation.kind) && obligation.status !== "satisfied").map(({ id: id2, kind, status, reason }) => ({ id: id2, kind, status, reason }));
    if (pending.length) {
      throw new DevFlowError("OBLIGATIONS_INCOMPLETE", "required workflow obligations are not satisfied", {
        obligations: pending,
        recoveryHint: "\u8BF7\u6309 dev_flow_status \u548C\u5BF9\u5E94 inspect \u4E3B\u9898\u5B8C\u6210\u786E\u8BA4\u3001\u5BA1\u67E5\u3001\u9A8C\u8BC1\u6216\u56DE\u64A4\u7B56\u7565\u540E\u91CD\u8BD5\u5B8C\u6210"
      });
    }
    snapshot = await createDeliverySnapshot(root2, id, state, config);
    if (snapshot) state.deliverySnapshot = snapshot;
    state.logicComplete = true;
    state.lifecycle = "finalized";
    state.steps.finalize = { status: "satisfied" };
  }, () => snapshot ? { deliverySnapshot: snapshot } : {});
}

// plugins/dev-flow/src/core/next.ts
function toDerivedState(state, verificationStale) {
  const definition = routeDefinitionForState(state);
  const steps = { ...state.steps };
  if (verificationStale) steps.verification = { status: "pending" };
  else if (hasCurrentQualityException(state, "verification")) steps.verification = { status: "satisfied" };
  for (const [approvalId2, snapshot] of Object.entries(state.humanGates)) {
    const value = snapshot;
    if (approvalId2.startsWith("approval:") && (value.status === "pending" || value.status === "returned")) {
      steps[approvalId2] = { status: "pending", artifactReady: true };
    }
  }
  return {
    schemaVersion: state.schemaVersion,
    lifecycle: state.lifecycle,
    route: state.route,
    orderedSteps: definition.orderedSteps,
    steps,
    obligations: state.obligations,
    blockingFindings: state.blockingFindings,
    logicComplete: state.logicComplete,
    repair: state.repair
  };
}
function deriveRouteAction(state) {
  if (Number(state.schemaVersion) !== 4 && Number(state.schemaVersion) !== 5) throw new Error("UNSUPPORTED_STATE_SCHEMA");
  if (state.lifecycle === "finalized") return { kind: "done" };
  if (state.repair?.status === "waiting-user" || state.repair?.status === "stalled") {
    return {
      kind: "waiting-user",
      reason: state.repair.recoveryAction?.reason ?? "\u81EA\u52A8\u4FEE\u590D\u9700\u8981\u7528\u6237\u51B3\u7B56",
      recoveryAction: state.repair.recoveryAction ?? { kind: "ask-user", reason: "\u81EA\u52A8\u4FEE\u590D\u5DF2\u6682\u505C", facts: [], impact: "\u5F53\u524D\u5355\u5143\u672A\u5B8C\u6210", recommendation: "\u8BF7\u786E\u8BA4\u4FEE\u8BA2\u3001\u56DE\u6EDA\u6216\u8C03\u6574\u8BA1\u5212" }
    };
  }
  if (state.classificationViolatesTopology) return { kind: "stop", reason: "reclassification-required" };
  if (state.blockingFindings?.some((finding) => finding.blocking)) return { kind: "stop", reason: "resolve-blocking-findings" };
  const definition = routeDefinition(state.route);
  const orderedSteps = state.orderedSteps ?? definition.orderedSteps;
  const approval = state.obligations?.find((obligation) => obligation.kind === "approval" && obligation.status !== "satisfied");
  const implementationIndex = orderedSteps.indexOf("implementation");
  const implementationReady = implementationIndex >= 0 && orderedSteps.slice(0, implementationIndex).every((step) => state.steps[step]?.status === "satisfied");
  if (approval && implementationReady) {
    return { kind: "present-human-gate", step: approval.id };
  }
  const openStep = firstOpenStep(orderedSteps, state.steps);
  if (openStep) {
    const snapshot = state.steps[openStep];
    if (snapshot && snapshot.artifactReady === false) return { kind: "scaffold-artifact", step: openStep };
    return { kind: "run-step", step: openStep };
  }
  if (!state.logicComplete) return { kind: "finalize" };
  return { kind: "done" };
}
function enrichRunStep(state, step) {
  const requiredEvidence = requiredEvidenceForStep(
    state.route,
    state.classification.riskLabels,
    step,
    state.classification.controls
  );
  return requiredEvidenceIsEmpty(requiredEvidence) ? { kind: "run-step", step } : { kind: "run-step", step, requiredEvidence };
}
function traceStepForAction(action) {
  if (action.kind === "run-step") {
    if (action.step === "requirements_alignment") return "requirements";
    if (action.step === "planning") return "implementation_plan";
    return action.step;
  }
  if (action.kind === "present-human-gate") return action.step.startsWith("approval:") ? "implementation_plan" : action.step;
  if (action.kind === "finalize") return "finalize";
  return void 0;
}
async function reviewPlanAction(root2, state) {
  const gate = await reviewGate(root2, state);
  if (gate.status === "ready") return void 0;
  if (gate.status === "need-batch") return { kind: "create-review-batch", step: "planning" };
  if (gate.status === "jobs-open") {
    return { kind: "review-jobs-pending", step: "planning", batchId: gate.batchId, jobs: gate.jobs };
  }
  if (gate.status === "isolation") {
    return { kind: "review-jobs-pending", step: "planning", batchId: gate.batchId, jobIds: gate.jobIds };
  }
  return { kind: "review-jobs-pending", step: "planning", batchId: gate.batchId, findingIds: gate.findingIds };
}
async function unitLifecycleAction(root2, state) {
  if (!checkpointsEnforcementRequired(state.route, state.classification.controls)) return void 0;
  const units = state.implementationUnits ?? [];
  const active = units.find((unit) => unit.status === "active");
  if (active) return { kind: "checkpoint-implementation-unit", unitId: active.unitId };
  const ledger = await readTraceability(root2, state);
  const ready = nextReadyImplementationUnit(state, ledger);
  return ready ? { kind: "begin-implementation-unit", unitId: ready.id } : void 0;
}
async function nextAction(root2, id) {
  const state = await readState(root2, id);
  if (state.mode === "intake") {
    const pending2 = pendingDecisionForState(state);
    return pending2 ? { kind: "intake", activity: "resolve-decision", reason: "\u5F53\u524D\u6709\u4E00\u4E2A\u51B3\u7B56\u4ECD\u5F85\u7528\u6237\u786E\u8BA4" } : { kind: "intake", activity: "investigate", reason: "\u8BFB\u53D6\u9700\u6C42\u3001\u4EE3\u7801\u3001\u6587\u6863\u548C\u6D4B\u8BD5\u5B8C\u6210\u8C03\u67E5\u540E\uFF0C\u8C03\u7528 dev_flow_lock_classification \u9501\u5B9A\u8DEF\u7EBF\uFF08\u9501\u5B9A\u524D\u4E0D\u8981\u8C03\u7528 record_step \u7B49\u8DEF\u7EBF\u6B65\u9AA4\u5DE5\u5177\uFF09" };
  }
  let pending;
  try {
    pending = pendingDecisionForState(state);
  } catch (error) {
    if (error.code !== "GRILL_INTERACTION_RESTART_REQUIRED") throw error;
    pending = void 0;
  }
  if (pending) {
    return { kind: "intake", activity: "resolve-decision", reason: "\u5F53\u524D\u6709\u4E00\u4E2A\u51B3\u7B56\u4ECD\u5F85\u7528\u6237\u786E\u8BA4" };
  }
  const action = deriveRouteAction(toDerivedState(state, await verificationIsStale(root2, state)));
  if (action.kind === "run-step" || action.kind === "present-human-gate") {
    const definition = routeDefinitionForState(state);
    const requiredNow = [
      ...definition.artifactSteps?.[action.step] ?? [],
      ...definition.generatedArtifactSteps?.[action.step] ?? []
    ];
    const missing = requiredNow.find((artifact) => !state.artifacts[artifact]);
    if (missing) return { kind: "scaffold-artifact", step: missing };
  }
  if (action.kind === "run-step" && (action.step === "planning" || action.step === "implementation")) {
    const reviewAction = await reviewPlanAction(root2, state);
    if (reviewAction) return reviewAction;
    if (action.step === "planning") {
      await assertCurrentReviewProjection(root2, state);
    }
  }
  const traceStep = traceStepForAction(action);
  if (traceStep) {
    const trace2 = await inspectTraceGate(root2, state, traceStep);
    if (trace2.blocker) return { kind: "repair-trace", ...trace2.blocker };
  }
  if (action.kind === "run-step" && action.step === "implementation") {
    const unitAction = await unitLifecycleAction(root2, state);
    if (unitAction) return unitAction;
  }
  if (action.kind === "run-step" && action.step === "finalize") return { kind: "finalize" };
  if (action.kind === "run-step") return enrichRunStep(state, action.step);
  return action;
}

// plugins/dev-flow/src/core/status-projection.ts
var STATUS_SCHEMA_VERSION = 1;
function actionText(state, action) {
  switch (action.kind) {
    case "done":
      return "\u5F53\u524D\u4EFB\u52A1\u5DF2\u5B8C\u6210\u3002";
    case "intake":
      return action.activity === "resolve-decision" ? "\u56DE\u7B54\u5F53\u524D\u552F\u4E00\u5F85\u51B3\u95EE\u9898\u3002" : "\u8C03\u67E5\u4E8B\u5B9E\u540E\u8C03\u7528 dev_flow_lock_classification \u9501\u5B9A\u8DEF\u7EBF\uFF08\u9501\u5B9A\u524D\u4E0D\u8981\u8C03\u7528 record_step \u7B49\u6B65\u9AA4\u5DE5\u5177\uFF09\u3002";
    case "scaffold-artifact":
      return `\u751F\u6210${artifactLabel(action.step)}\uFF0C\u7136\u540E\u586B\u5199\u5E76\u767B\u8BB0\u3002`;
    case "present-human-gate":
      return "\u56DE\u7B54\u5F53\u524D\u6267\u884C\u786E\u8BA4\u95EE\u9898\u3002";
    case "wait-human-gate":
      return "\u7B49\u5F85\u5F53\u524D\u7528\u6237\u51B3\u5B9A\u3002";
    case "waiting-user":
      return "\u6309\u6062\u590D\u63D0\u793A\u5904\u7406\u5F53\u524D\u963B\u585E\u3002";
    case "stop":
      return "\u5148\u5904\u7406\u5F53\u524D\u963B\u585E\uFF0C\u518D\u7EE7\u7EED\u6D41\u7A0B\u3002";
    case "create-review-batch":
      return "\u751F\u6210\u5F53\u524D\u8BA1\u5212\u5DEE\u5F02\u5BA1\u67E5\u5305\u3002";
    case "review-jobs-pending":
      return "\u5B8C\u6210\u5F53\u524D\u6279\u6B21\u7684\u5FC5\u9700\u89D2\u8272\u5BA1\u67E5\u3002";
    case "repair-trace":
      return "\u91CD\u65B0\u767B\u8BB0\u5F53\u524D\u9700\u6C42\u6216\u8BA1\u5212\u4E0E\u8FFD\u6EAF\u5173\u7CFB\u3002";
    case "begin-implementation-unit":
      return "\u5F00\u59CB\u4E0B\u4E00\u4E2A\u5B9E\u73B0\u5355\u5143\u3002";
    case "checkpoint-implementation-unit":
      return "\u4FDD\u5B58\u5F53\u524D\u5B9E\u73B0\u5355\u5143\u5E76\u5B8C\u6210\u5355\u5143\u9A8C\u8BC1\u3002";
    case "finalize":
      return "\u8FDB\u5165\u4EA4\u4ED8\u6536\u5C3E\u5E76\u751F\u6210\u6700\u7EC8\u4EA4\u4ED8\u5FEB\u7167\u3002";
    case "run-step":
      return `\u7EE7\u7EED${stageLabel(action.step)}\u3002`;
    default:
      return "\u8BE6\u60C5\u67E5\u770B dev_flow_status\u3002";
  }
}
function artifactLabel(kind) {
  switch (kind) {
    case "requirements":
      return "\u9700\u6C42\u6587\u6863";
    case "implementation-plan":
      return "\u5B9E\u65BD\u8BA1\u5212";
    case "plan-review":
      return "\u8BA1\u5212\u5BA1\u67E5\u5305";
    default:
      return "\u5F53\u524D\u9636\u6BB5\u6240\u9700\u5DE5\u4EF6";
  }
}
function health(state, action) {
  if (state.workspace.reconciliationStatus === "blocked" || action.kind === "repair-trace") return "\u9700\u8981\u4FEE\u590D";
  if (action.kind === "waiting-user" || action.kind === "stop" || pendingDecisionForState(state)) return "\u9700\u8981\u5904\u7406";
  return "\u6B63\u5E38";
}
async function readCompactStatus(root2, featureId) {
  const state = await readState(root2, featureId);
  const action = await nextAction(root2, featureId);
  const stage = effectiveStage(state);
  const definition = state.mode === "routed" ? routeDefinitionForFeature(state.route, state.classification.controls) : void 0;
  const total = definition?.orderedSteps.length ?? 1;
  const completed = definition?.orderedSteps.filter((step) => state.steps[step]?.status === "satisfied").length ?? 0;
  const decision = pendingDecisionForState(state);
  const publicDecision = decision ? publicPendingDecision(state) : void 0;
  const content = {
    statusSchemaVersion: STATUS_SCHEMA_VERSION,
    \u72B6\u6001: state.lifecycle === "finalized" && currentRiskAuthorizations(state, { contentFingerprint: state.businessFingerprint }).length > 0 ? "\u5DF2\u5B8C\u6210\uFF08\u7528\u6237\u63A5\u53D7\u98CE\u9669\uFF09" : lifecycleLabel(state.lifecycle),
    \u8DEF\u7EBF: state.mode === "routed" ? routeLabel(state.route) : "\u8DEF\u7EBF\u5C1A\u672A\u786E\u5B9A",
    \u5F53\u524D\u9636\u6BB5: stageLabel(state.lifecycle === "paused" ? "paused" : stage),
    \u8FDB\u5EA6: `\u5DF2\u5B8C\u6210 ${completed}/${total} \u4E2A\u9636\u6BB5`,
    \u4E0B\u4E00\u6B65: actionText(state, action),
    \u9700\u8981\u7528\u6237\u51B3\u5B9A: Boolean(decision),
    \u5065\u5EB7\u72B6\u6001: health(state, action),
    \u6062\u590D\u63D0\u793A: state.resumeSummary ?? (state.lifecycle === "paused" ? "\u6062\u590D\u540E\u7CFB\u7EDF\u4F1A\u5148\u81EA\u52A8\u5BF9\u8D26\u5DE5\u4F5C\u533A\u3002" : "\u4E0B\u6B21\u53EF\u4EE5\u4ECE\u5F53\u524D\u9636\u6BB5\u7EE7\u7EED\u3002"),
    ...decision ? {
      attention: "\u8BF7\u53EA\u56DE\u7B54\u5F53\u524D\u8FD9\u4E00\u9053\u95EE\u9898\u3002",
      pendingDecision: {
        question: publicDecision.question,
        options: publicDecision.options,
        ...publicDecision.recommendation ? { recommendation: publicDecision.recommendation } : {},
        ...publicDecision.presentation ? { presentation: publicDecision.presentation } : {}
      }
    } : {}
  };
  const control = {
    featureId: state.featureId,
    expectedRevision: state.revision,
    ...state.mode === "routed" ? { stage } : {},
    nextAction: action,
    lifecycle: state.lifecycle
  };
  return { contentView: content, structuredContentView: { ...content, control } };
}

// plugins/dev-flow/src/core/inspection.ts
var inspectionTopics = ["classification", "artifacts", "trace", "review", "implementation", "verification", "delivery", "history", "diagnostics"];
function topic(value) {
  if (typeof value === "string" && inspectionTopics.includes(value)) return value;
  throw new DevFlowError("INSPECTION_TOPIC_INVALID", "inspect topic \u5FC5\u987B\u662F\u53D7\u652F\u6301\u7684\u4E3B\u9898\uFF0C\u4E0D\u80FD\u4F7F\u7528 all\u3002", { userMessage: "\u8BF7\u9009\u62E9\u4E00\u4E2A\u660E\u786E\u7684\u68C0\u67E5\u4E3B\u9898\u3002", recoveryKind: "retry", recoveryInstruction: "\u4ECE\u5206\u7C7B\u3001\u5DE5\u4EF6\u3001\u8FFD\u6EAF\u3001\u5BA1\u67E5\u3001\u5B9E\u73B0\u3001\u9A8C\u8BC1\u3001\u4EA4\u4ED8\u3001\u5386\u53F2\u6216\u8BCA\u65AD\u4E2D\u9009\u62E9\u4E00\u4E2A\u4E3B\u9898\u3002", retryOriginal: true });
}
async function classification(root2, state) {
  const facts = [];
  for (const fact of state.governance?.repositoryFacts ?? []) {
    let freshness = "unconfirmed";
    if (fact.observedFingerprint) {
      try {
        await assertRepositoryFactCurrent(root2, fact);
        freshness = "current";
      } catch (error) {
        freshness = error instanceof DevFlowError && error.code === "BOUNDARY_FACT_UNCONFIRMED" ? "unconfirmed" : "stale";
      }
    }
    facts.push({
      recordId: fact.recordId,
      assertion: fact.assertion,
      // 只展示安全的位置/范围信息，不暴露观察指纹等内部哈希。
      location: fact.location.kind === "positive" ? { kind: "positive", path: fact.location.path, ...fact.location.anchor ? { anchor: fact.location.anchor } : {} } : { kind: "negative", checkedScope: fact.location.checkedScope, conditions: fact.location.conditions },
      freshness
    });
  }
  return {
    objective: state.objective ?? "\u672A\u547D\u540D\u9700\u6C42",
    scope: state.scope,
    ...state.mode === "routed" ? { route: routeLabel(state.route), stage: stageLabel(effectiveStage(state)) } : { route: "\u8DEF\u7EBF\u5C1A\u672A\u786E\u5B9A", stage: "\u9700\u6C42\u4E86\u89E3" },
    ...facts.length ? { repositoryFacts: facts } : {},
    decisionStatus: governanceLedger(state).decisions.reduce((summary, decision) => {
      const status = decision.supersededBy ? "superseded" : "resolved";
      summary[status] = (summary[status] ?? 0) + 1;
      return summary;
    }, {})
  };
}
async function artifacts(state) {
  return {
    items: Object.entries(state.artifacts).map(([kind, artifact]) => ({ kind, path: artifact.path, registered: true }))
  };
}
async function trace(root2, state) {
  if (state.mode === "intake" || !traceEnforcementRequired(state.route, state.classification.controls)) return { enforced: false, blocker: void 0 };
  const inspection = await inspectCurrentTrace(root2, state);
  const nodes = Object.values(inspection.ledger?.nodes ?? {});
  const current = nodes.filter((node) => node.status === "current");
  const dispositions = current.filter((node) => node.kind === "acceptance-criterion" && node.verificationDisposition?.kind).map((node) => node.verificationDisposition.kind);
  const recoveries = current.filter((node) => node.kind === "recovery");
  const highRisk = (state.classification?.riskLabels ?? []).some((label) => label === "data" || label === "external" || label === "irreversible_consequence");
  return {
    enforced: true,
    summary: inspection.effectiveSummary,
    blocker: inspection.blocker ? "\u8FFD\u6EAF\u8BC1\u636E\u9700\u8981\u4FEE\u590D" : void 0,
    verificationDispositions: {
      coveredByTest: current.filter((node) => node.kind === "acceptance-criterion").length - dispositions.length,
      byKind: [...new Set(dispositions)].sort().map((kind) => ({ kind, count: dispositions.filter((item) => item === kind).length }))
    },
    recovery: {
      required: highRisk,
      arrangements: recoveries.map((node) => ({
        id: node.id,
        stepRef: node.stepRef,
        recoveryKind: node.recoveryKind,
        method: node.method,
        riskRef: node.riskRef
      }))
    }
  };
}
async function review(root2, state) {
  if (state.mode === "intake" || !reviewEnforcementRequired(state.route, state.classification.controls)) return { enforced: false };
  const ledger = await readReviewLedger(root2, state);
  const current = ledger.batches.find((batch) => batch.validity === "current");
  const unresolved = current ? currentUnresolvedBlocking(ledger, current, state) : [];
  const isolation = current?.jobs.flatMap((job) => job.submission?.isolationProof ? [{ jobId: job.jobId, mode: job.submission.isolationProof.mode }] : []) ?? [];
  return {
    enforced: true,
    currentBatch: current ? { progress: current.progress, roles: current.jobs.map((job) => ({ role: job.role, status: job.status })) } : void 0,
    unresolvedBlockingCount: unresolved.length,
    ...current?.unknownDiffInfo ? { unknownDiff: current.unknownDiffInfo } : {},
    independence: {
      // 隔离上下文证明与多来源证明是两个正交维度。
      isolatedJobs: isolation,
      assuranceLevel: current?.assuranceLevel,
      executionMode: current?.executionMode
    },
    staleBatchCount: ledger.batches.filter((batch) => batch.validity === "stale").length
  };
}
async function implementation(state) {
  const units = state.implementationUnits ?? [];
  return { total: units.length, completed: units.filter((unit) => unit.status === "checkpointed").length, active: units.find((unit) => unit.status === "active") ? "\u6709\u4E00\u4E2A\u5B9E\u73B0\u5355\u5143\u6B63\u5728\u8FDB\u884C" : "\u65E0" };
}
async function verification(state) {
  const attempts = state.verification.attempts;
  const latest = attempts.at(-1);
  const invalidatedAt = state.lastInvalidation?.at ? Date.parse(state.lastInvalidation.at) : Number.NaN;
  const accepted = governanceLedger(state).authorizations.filter((authorization) => authorization.authorizationType === "risk-acceptance" && authorization.target === "verification").map((authorization) => ({
    authorization,
    status: deriveCurrency(authorization, { contentFingerprint: state.businessFingerprint }) === "current" && (!Number.isFinite(invalidatedAt) || !authorization.recordedAt || Date.parse(authorization.recordedAt) >= invalidatedAt) ? "current" : "stale"
  }));
  return {
    attempts: attempts.length,
    freshness: state.evidenceFreshness.verification,
    passed: Boolean(state.verification.satisfiedByAttemptId !== void 0),
    acceptance: (state.acceptance?.dispositions ?? []).map((disposition) => ({
      acceptanceCriterionId: disposition.acceptanceCriterionId,
      dispositionKind: disposition.dispositionKind,
      status: disposition.status,
      evidenceRefs: [...disposition.evidenceRefs]
    })),
    ...latest ? {
      latestAttempt: {
        id: attempts.length,
        exitCode: latest.exitCode,
        // 结束原因分开报告：timeout/output-limit/spawn-failure 是环境或进程
        // 问题，non-zero-exit 才是代码缺陷；不统一显示为“测试失败”。
        exitReason: latest.exitReason ?? "unknown",
        phase: latest.phase ?? "forward",
        // 验收来源分级（ADR-0009）：self-check 表示只有智能体文字说明，
        // 不构成人工验收完成。
        ...latest.acceptanceKind ? { acceptanceKind: latest.acceptanceKind } : {}
      }
    } : {},
    // 风险接受只对当时的交付内容有效（issue 22）：current 表示门禁仍在
    // 豁免验证义务，stale 表示内容已变化、验证已重新打开，需重跑后重新判断。
    riskAcceptance: accepted.map(({ authorization, status }) => ({
      status,
      acceptedAt: authorization.recordedAt,
      riskSummary: authorization.target
    }))
  };
}
async function delivery(state) {
  const snapshot = state.deliverySnapshot;
  return {
    lifecycle: state.lifecycle,
    workspace: state.workspace.reconciliationStatus,
    snapshot: state.deliverySnapshot ? "\u5DF2\u751F\u6210" : "\u672A\u751F\u6210",
    featureOwnedPathCount: Object.values(state.workspace.ownership).filter((value) => value === "feature").length,
    ...snapshot?.excludedChangedPaths?.length ? { excludedChangedPaths: snapshot.excludedChangedPaths } : {}
  };
}
async function history(root2, state) {
  const events = await readFeatureEvents(root2, state.featureId);
  return {
    count: events.length,
    recent: events.slice(-10).map((event) => ({ at: event.at, type: event.type }))
  };
}
async function diagnostics(root2, state) {
  const events = await readFeatureEvents(root2, state.featureId);
  return {
    featureId: state.featureId,
    revision: state.revision,
    schemaVersion: state.schemaVersion,
    workspace: state.workspace,
    artifacts: state.artifacts,
    traceability: state.traceability,
    review: state.review,
    pendingDecision: pendingDecisionForState(state),
    recentEvents: events.slice(-20)
  };
}
async function inspectFeature(root2, featureId, requestedTopic) {
  const selected = topic(requestedTopic);
  const state = await readState(root2, featureId);
  const content = selected === "classification" ? await classification(root2, state) : selected === "artifacts" ? await artifacts(state) : selected === "trace" ? await trace(root2, state) : selected === "review" ? await review(root2, state) : selected === "implementation" ? await implementation(state) : selected === "verification" ? await verification(state) : selected === "delivery" ? await delivery(state) : selected === "history" ? await history(root2, state) : await diagnostics(root2, state);
  return { topic: selected, content };
}

// plugins/dev-flow/src/core/review-projection-rebuild.ts
async function rebuildReviewProjection(root2, featureId, expectedRevision) {
  const current = await readState(root2, featureId);
  if (!current.review) throw new DevFlowError("REVIEW_PROJECTION_INVALID", "\u5F53\u524D feature \u6CA1\u6709 review ledger pointer\u3002", { userMessage: "\u5F53\u524D\u6CA1\u6709\u53EF\u91CD\u5EFA\u7684\u5BA1\u67E5\u6295\u5F71\u3002", recoveryKind: "repair", recoveryInstruction: "\u8FD0\u884C doctor \u68C0\u67E5\u5BA1\u67E5 ledger\u3002", retryOriginal: false });
  return mutatePrepared(root2, featureId, expectedRevision, "review-projection-rebuilt", async (state) => {
    const projectionState = structuredClone(state);
    await prepareReviewProjection(root2, projectionState);
    const artifact = projectionState.artifacts["plan-review"];
    if (!artifact) throw new DevFlowError("REVIEW_PROJECTION_INVALID", "\u65E0\u6CD5\u4ECE ledger \u751F\u6210 review projection\u3002", { userMessage: "\u5BA1\u67E5\u6295\u5F71\u65E0\u6CD5\u4ECE\u5F53\u524D ledger \u91CD\u5EFA\u3002", recoveryKind: "repair", recoveryInstruction: "\u8FD0\u884C doctor \u68C0\u67E5\u5BA1\u67E5 ledger \u548C\u6295\u5F71\u6587\u4EF6\u3002", retryOriginal: false });
    return {
      mutate: (draft) => {
        draft.artifacts["plan-review"] = artifact;
      },
      eventData: { projectionPath: artifact.path }
    };
  });
}

// plugins/dev-flow/src/mcp/doctor.ts
import { lstat as lstat8, readdir as readdir7, readFile as readFile19 } from "node:fs/promises";
import path23 from "node:path";
import { createHash as createHash32 } from "node:crypto";
function projectActiveWorkflow(state) {
  let pending;
  let pendingUnreadable = false;
  try {
    const decision = pendingDecisionForState(state);
    if (decision) pending = { kind: decision.kind, question: decision.question };
  } catch {
    pendingUnreadable = true;
  }
  const nextStep = pendingUnreadable ? "\u5F85\u51B3\u95EE\u9898\u4E0D\u53EF\u8BFB\uFF0C\u67E5\u770B dev_flow_status" : pending ? `\u56DE\u7B54\u5F85\u51B3\u95EE\u9898\uFF1A${pending.question}` : state.mode === "intake" ? "\u5B8C\u6210\u8C03\u67E5\u540E\u8C03\u7528 dev_flow_lock_classification" : state.mode === "routed" ? "\u8BE6\u60C5\u770B dev_flow_status" : "\u67E5\u770B dev_flow_status";
  return {
    mode: state.mode,
    ...state.mode === "routed" ? { stage: effectiveStage(state) } : {},
    ...pending ? { pendingDecision: pending } : {},
    nextStep
  };
}
async function readable(file) {
  try {
    await lstat8(file);
    return true;
  } catch {
    return false;
  }
}
async function validJson(file) {
  try {
    JSON.parse(await readFile19(file, "utf8"));
    return true;
  } catch {
    return false;
  }
}
async function pointerRecoveryCandidates(root2) {
  try {
    const directory = path23.join(root2, ".dev-flow", "features");
    const entries = await readdir7(directory, { withFileTypes: true });
    return await Promise.all(entries.filter((entry) => entry.isDirectory()).map(async (entry) => {
      let stateSha256;
      try {
        stateSha256 = await stateFileSha256(root2, entry.name);
      } catch {
      }
      return { featureId: entry.name, ...stateSha256 ? { stateSha256 } : {} };
    }));
  } catch {
    return [];
  }
}
async function collectDoctorReport(root2, pluginRoot, version, tools) {
  const diagnostics2 = [];
  const add2 = (code, status, message, recoveryHint) => diagnostics2.push({ code, status, message, ...recoveryHint ? { recoveryHint } : {} });
  const healthSignals = await readHostHealth(root2);
  const now = Date.now();
  const hookHealth = ["claude", "codex"].map((host) => {
    const latest = [...healthSignals].reverse().find((signal) => signal.host === host);
    const ageMs = latest ? Math.max(0, now - Date.parse(latest.at)) : void 0;
    const capability = (kinds) => {
      const signal = [...healthSignals].reverse().find((candidate) => candidate.host === host && kinds.includes(candidate.kind));
      const capabilityAgeMs = signal ? Math.max(0, now - Date.parse(signal.at)) : void 0;
      const status2 = !signal ? "missing" : capabilityAgeMs <= 15 * 60 * 1e3 ? "healthy" : "stale";
      return { status: status2, ...signal ? { latest: signal } : {}, ...capabilityAgeMs !== void 0 ? { ageMs: capabilityAgeMs } : {} };
    };
    const capabilities = {
      session: capability(["session-start"]),
      prompt: capability(["user-prompt-submit"]),
      tool: capability(["tool", "turn-boundary"])
    };
    const capabilityStatuses = Object.values(capabilities).map((entry) => entry.status);
    const status = !latest ? "missing" : capabilityStatuses.every((entry) => entry === "healthy") ? "healthy" : capabilityStatuses.some((entry) => entry === "healthy") ? "partial" : "stale";
    if (status === "missing") add2("HOOK_HEALTH_MISSING", "warning", `${host} hook \u5C1A\u672A\u8BB0\u5F55 SessionStart/UserPromptSubmit \u5065\u5EB7\u4FE1\u53F7`, "\u786E\u8BA4\u5BF9\u5E94\u5BBF\u4E3B\u5DF2\u5B89\u88C5\u5E76\u63A5\u7EBF Dev Flow hook\uFF0C\u7136\u540E\u91CD\u65B0\u5F00\u542F\u4F1A\u8BDD");
    else if (status === "stale") add2("HOOK_HEALTH_STALE", "warning", `${host} hook \u6700\u8FD1\u4FE1\u53F7\u5DF2\u8FC7\u671F`, "\u6062\u590D\u5BBF\u4E3B hook \u540E\u91CD\u65B0\u5F00\u542F\u4F1A\u8BDD\u5E76\u91CD\u8BD5\u539F\u64CD\u4F5C\uFF1B\u82E5\u6709\u672A\u77E5\u8DEF\u5F84\uFF0C\u518D\u8C03\u7528 dev_flow_reconcile_workspace");
    else if (status === "partial") add2("HOOK_HEALTH_PARTIAL", "warning", `${host} hook \u53EA\u6709\u90E8\u5206\u80FD\u529B\u5B58\u5728\u8FD1\u671F\u4FE1\u53F7`, "\u89E6\u53D1\u4E00\u6B21\u7528\u6237\u6D88\u606F\u548C\u4E00\u6B21\u5B89\u5168\u5DE5\u5177\u8C03\u7528\uFF0C\u786E\u8BA4\u5404 hook \u901A\u9053\u5747\u5DF2\u63A5\u7EBF");
    else add2("HOOK_HEALTH_HEALTHY", "ok", `${host} hook \u5F53\u524D\u5065\u5EB7`);
    if (capabilities.prompt.status === "missing") add2("HOOK_PROMPT_HEALTH_MISSING", "warning", `${host} UserPromptSubmit \u901A\u9053\u5C1A\u65E0\u53EF\u4FE1\u4FE1\u53F7`, "\u786E\u8BA4 UserPromptSubmit hook \u5DF2\u5B89\u88C5\uFF0C\u53D1\u9001\u4E00\u6761\u7528\u6237\u6D88\u606F\u540E\u91CD\u65B0\u8FD0\u884C doctor");
    else if (capabilities.prompt.status === "stale") add2("HOOK_PROMPT_HEALTH_STALE", "warning", `${host} UserPromptSubmit \u901A\u9053\u6700\u8FD1\u4FE1\u53F7\u5DF2\u8FC7\u671F`, "\u6062\u590D UserPromptSubmit hook\uFF0C\u53D1\u9001\u4E00\u6761\u7528\u6237\u6D88\u606F\u540E\u91CD\u8BD5\u6587\u672C\u56DE\u7B54");
    return { host, status, capabilities, ...latest ? { latest } : {}, ...ageMs !== void 0 ? { ageMs } : {} };
  });
  const projectFile = path23.join(root2, ".dev-flow", "project.json");
  let project = { initialized: await readable(projectFile), valid: false };
  if (!project.initialized) add2("PROJECT_NOT_INITIALIZED", "warning", "run dev_flow_init_project before starting a feature");
  else {
    try {
      await readProjectConfig(root2);
      project.valid = true;
      add2("PROJECT_CONFIG_VALID", "ok", "strict project configuration is valid");
    } catch (error) {
      add2("PROJECT_CONFIG_INVALID", "error", error instanceof Error ? error.message : String(error));
    }
  }
  const activeFile = path23.join(root2, ".dev-flow", "active.json");
  let activeFeature = { present: await readable(activeFile), valid: false };
  let corruptFeature;
  let corruptActivePointer;
  let traceState;
  if (activeFeature.present) {
    try {
      const active = await readActive(root2);
      if (!active?.featureId) throw new Error("active feature id is missing");
      try {
        const state = await readState(root2, active.featureId);
        await assertActivePointerConsistent(root2);
        traceState = state;
        const projection = projectActiveWorkflow(state);
        activeFeature = {
          present: true,
          featureId: state.featureId,
          valid: state.lifecycle === "active",
          ...projection
        };
        add2(
          activeFeature.valid ? "ACTIVE_FEATURE_VALID" : "ACTIVE_FEATURE_INVALID",
          activeFeature.valid ? "ok" : "error",
          activeFeature.valid ? `active feature ${state.featureId} is valid` : `active feature ${state.featureId} is not active`
        );
        add2(
          "ACTIVE_FEATURE_STATE",
          "ok",
          `active feature ${state.featureId} \u5904\u4E8E ${projection.mode}${projection.pendingDecision ? "\uFF0C\u6709\u5F85\u51B3\u95EE\u9898" : ""}\uFF1B\u4E0B\u4E00\u6B65\uFF1A${projection.nextStep}\u3002\u65E5\u5E38\u770B dev_flow_status\uFF0Cdoctor \u53EA\u662F\u9644\u5E26\u6295\u5F71`
        );
      } catch (error) {
        let digest13;
        try {
          digest13 = await stateFileSha256(root2, active.featureId);
        } catch {
        }
        if (!digest13) {
          try {
            const raw = await readFile19(path23.join(root2, ".dev-flow", "features", active.featureId, "state.json"));
            digest13 = createHash32("sha256").update(raw).digest("hex");
          } catch {
            digest13 = void 0;
          }
        }
        activeFeature = {
          present: true,
          featureId: active.featureId,
          valid: false,
          corrupt: true,
          stateSha256: digest13,
          recoveryAction: "abandon"
        };
        const message = error instanceof Error ? error.message : String(error);
        add2("ACTIVE_FEATURE_CORRUPT", "error", message, "Call dev_flow_recover_corrupt_feature with stateSha256, reason, and userEvidence");
        if (digest13) {
          corruptFeature = {
            featureId: active.featureId,
            stateSha256: digest13,
            recommendedAction: "abandon",
            recoveryHint: "User must explicitly agree to abandon; then start a new feature. Do not hand-edit state.json."
          };
        }
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (error.code === "ACTIVE_POINTER_UNREADABLE") {
        let activeSha256;
        try {
          activeSha256 = createHash32("sha256").update(await readFile19(activeFile)).digest("hex");
        } catch {
        }
        activeFeature = { present: true, valid: false, corrupt: true, recoveryAction: "abandon" };
        add2("ACTIVE_POINTER_CORRUPT", "error", message, "Choose a doctor-reported feature and call dev_flow_recover_corrupt_feature with activeSha256, stateSha256, reason, and userEvidence");
        if (activeSha256) {
          corruptActivePointer = {
            activeSha256,
            candidates: await pointerRecoveryCandidates(root2),
            recoveryHint: "User must explicitly select one candidate feature to abandon. Recovery backs up active.json and the selected feature; it never guesses."
          };
        }
      } else add2("ACTIVE_FEATURE_INVALID", "error", message);
    }
  } else add2("NO_ACTIVE_FEATURE", "ok", "no active feature is recorded");
  let recoveryTxn;
  try {
    recoveryTxn = await readRecoveryTransaction(root2);
  } catch (error) {
    add2("RECOVERY_TRANSACTION_UNREADABLE", "error", error instanceof Error ? error.message : String(error), "Do not start a feature or hand-edit .dev-flow; recovery remains fail-closed");
  }
  if (recoveryTxn) add2(
    "RECOVERY_TRANSACTION_OPEN",
    "error",
    `open recovery transaction phase=${String(recoveryTxn.phase)} featureId=${String(recoveryTxn.featureId ?? "")}`,
    "Re-run dev_flow_recover_corrupt_feature with the same doctor-reported input to resume the next safe journal phase"
  );
  const rollbackTransactions = [];
  try {
    const featuresDirectory = path23.join(root2, ".dev-flow", "features");
    const entries = await readdir7(featuresDirectory, { withFileTypes: true });
    for (const entry of entries.filter((candidate) => candidate.isDirectory())) {
      let journal;
      try {
        journal = await readRollbackTransaction(root2, entry.name);
      } catch (error) {
        add2(
          "ROLLBACK_TRANSACTION_UNREADABLE",
          "error",
          error instanceof Error ? error.message : String(error),
          "Do not hand-edit .dev-flow; the feature stays fail-closed while its rollback journal is unreadable"
        );
        continue;
      }
      if (!journal) continue;
      const current = journal;
      const finished = rollbackTransactionFinished(current);
      const blocked = !finished && typeof current.error === "string";
      const events = blocked ? await readFeatureEvents(root2, entry.name).catch(() => []) : [];
      const attemptIds = (type) => events.filter((event) => event.type === type && event.data.transactionId === current.transactionId).map((event) => event.data.attemptId).filter((attemptId) => typeof attemptId === "string");
      rollbackTransactions.push({
        featureId: entry.name,
        transactionId: current.transactionId,
        phase: current.phase,
        targetCheckpointId: current.targetCheckpointId,
        undoOrder: [...current.undoOrder],
        backupDirectory: current.backupDirectory,
        blocked,
        ...current.error ? { error: current.error } : {},
        verificationAttemptIds: attemptIds("rollback-verification-attempt"),
        compensationAttemptIds: attemptIds("rollback-compensation-attempt")
      });
      if (finished) {
        add2("ROLLBACK_TRANSACTION_COMPLETED", "ok", `rollback transaction ${current.transactionId} finished phase=${current.phase} feature=${entry.name}`);
      } else if (blocked) {
        add2(
          "ROLLBACK_RECOVERY_BLOCKED",
          "error",
          `rollback recovery is blocked feature=${entry.name} transaction=${current.transactionId}: ${current.error ?? ""}`,
          "Resolve the reported cause, then resume the rollback with the same target checkpoint; the backup scene is preserved"
        );
      } else {
        add2(
          "ROLLBACK_TRANSACTION_OPEN",
          "error",
          `open rollback transaction phase=${current.phase} feature=${entry.name} target=${current.targetCheckpointId}`,
          `Resume the rollback with the same target checkpoint ${current.targetCheckpointId} before mutating this feature`
        );
      }
    }
  } catch {
  }
  let trace2;
  if (traceState && traceState.mode !== "intake") {
    const enforced = traceEnforcementRequired(traceState.route, traceState.classification.controls);
    const orphanSnapshots = await listOrphanTraceSnapshots(root2, traceState);
    trace2 = { enforced, pointerPresent: Boolean(traceState.traceability), orphanSnapshots };
    if (!enforced) {
      add2(
        traceState.workflowCapabilities ? "TRACE_NOT_REQUIRED" : "TRACE_LEGACY_FEATURE",
        "ok",
        traceState.workflowCapabilities ? "Trace pointer is not required for this route" : "legacy feature has no Trace capability stamp"
      );
    } else {
      try {
        await readTraceability(root2, traceState);
        add2("TRACE_POINTER_VALID", "ok", "current Trace pointer and snapshot are valid");
      } catch (error) {
        add2(
          "TRACE_POINTER_INVALID",
          "error",
          error instanceof Error ? error.message : String(error),
          "Restore the referenced Trace snapshot or re-register the current Trace artifact; doctor will not select a replacement snapshot automatically"
        );
      }
    }
    if (orphanSnapshots.length) {
      add2(
        "TRACE_ORPHAN_SNAPSHOTS",
        "warning",
        `unreferenced Trace snapshots: ${orphanSnapshots.join(", ")}`,
        "Orphan snapshots are retained for diagnosis; do not hand-edit state or select an orphan as the current pointer"
      );
    }
  }
  let review2;
  if (traceState && traceState.mode !== "intake") {
    const enforced = reviewEnforcementRequired(traceState.route, traceState.classification.controls);
    const orphanSnapshots = await listOrphanReviewSnapshots(root2, traceState);
    review2 = { enforced, pointerPresent: Boolean(traceState.review), orphanSnapshots };
    if (!enforced) {
      add2(
        traceState.workflowCapabilities ? "REVIEW_NOT_REQUIRED" : "REVIEW_LEGACY_FEATURE",
        "ok",
        traceState.workflowCapabilities ? "Review pointer is not required for this route" : "legacy feature has no Review capability stamp"
      );
    } else {
      try {
        await readReviewLedger(root2, traceState);
        add2("REVIEW_POINTER_VALID", "ok", "current review pointer and snapshot are valid");
      } catch (error) {
        add2(
          "REVIEW_POINTER_INVALID",
          "error",
          error instanceof Error ? error.message : String(error),
          "Restore the referenced review snapshot; doctor will not select a replacement snapshot automatically"
        );
      }
    }
    if (orphanSnapshots.length) {
      add2(
        "REVIEW_ORPHAN_SNAPSHOTS",
        "warning",
        `unreferenced review snapshots: ${orphanSnapshots.join(", ")}`,
        "Orphan snapshots are retained for diagnosis; do not hand-edit state or select an orphan as the current pointer"
      );
    }
  }
  if (traceState && traceState.mode !== "intake" && traceState.workspace) {
    const workspace = traceState.workspace;
    try {
      const { branch, head: head2 } = await gitBranchAndHead(root2);
      if (workspace.baseBranch && branch !== workspace.baseBranch) {
        add2(
          "WORKSPACE_BRANCH_CHANGED",
          "error",
          `\u542F\u52A8\u5206\u652F\u4E3A ${workspace.baseBranch}\uFF0C\u5F53\u524D\u5206\u652F\u4E3A ${branch || "\u672A\u547D\u540D\u5206\u652F"}`,
          "\u5207\u56DE\u539F\u5206\u652F\u540E\u8FD0\u884C dev_flow_reconcile_workspace \u5237\u65B0\u72B6\u6001\uFF0C\u6216\u6682\u505C/\u7EC8\u6B62\u8BE5 feature\uFF1B\u4E0D\u8981\u624B\u52A8\u4FEE\u6539 .dev-flow"
        );
      } else if (workspace.baseHead) {
        const ancestor = await isAncestor(root2, workspace.baseHead, head2);
        add2(
          ancestor ? "WORKSPACE_LINEAGE_VALID" : "WORKSPACE_HISTORY_REWRITTEN",
          ancestor ? "ok" : "error",
          ancestor ? "Git \u57FA\u7EBF\u4ECD\u662F\u5F53\u524D HEAD \u7684\u7956\u5148\uFF0C\u63D0\u4EA4\u94FE\u53EF\u8BC1\u660E" : "\u5F53\u524D HEAD \u4E0D\u518D\u662F\u542F\u52A8\u57FA\u7EBF\u7684\u540E\u4EE3",
          ancestor ? void 0 : "\u6062\u590D\u53EF\u8BC1\u660E\u7684\u63D0\u4EA4\u94FE\u540E\u8FD0\u884C dev_flow_reconcile_workspace\uFF0C\u6216\u6682\u505C/\u7EC8\u6B62\u8BE5 feature"
        );
      }
    } catch {
    }
  }
  const paths = {
    claudeManifest: path23.join(pluginRoot, ".claude-plugin", "plugin.json"),
    codexManifest: path23.join(pluginRoot, ".codex-plugin", "plugin.json"),
    mcp: path23.join(pluginRoot, ".mcp.json"),
    claudeHooks: path23.join(pluginRoot, "hosts", "claude", "hooks.json"),
    codexHooks: path23.join(pluginRoot, "hosts", "codex", "hooks.json"),
    mcpBundle: path23.join(pluginRoot, "dist", "mcp-server.mjs"),
    claudeBundle: path23.join(pluginRoot, "dist", "claude-hook.mjs"),
    codexBundle: path23.join(pluginRoot, "dist", "codex-hook.mjs")
  };
  const files = await Promise.all(Object.entries(paths).map(async ([name, file]) => [name, await readable(file)]));
  const missing = files.filter(([, exists]) => !exists).map(([name]) => name);
  add2(missing.length ? "PLUGIN_FILES_MISSING" : "PLUGIN_FILES_PRESENT", missing.length ? "error" : "ok", missing.length ? `missing plugin files: ${missing.join(", ")}` : "manifests, hooks, MCP configuration and bundles are present");
  const jsonFiles = [paths.claudeManifest, paths.codexManifest, paths.mcp, paths.claudeHooks, paths.codexHooks];
  const invalidJson = (await Promise.all(jsonFiles.map(async (file) => !await validJson(file)))).some(Boolean);
  add2(invalidJson ? "PLUGIN_WIRING_INVALID" : "PLUGIN_WIRING_VALID", invalidJson ? "error" : "ok", invalidJson ? "a manifest, MCP file, or hook file is not valid JSON" : "plugin manifest, MCP and hook wiring parse successfully");
  const legacyFeatures = [];
  try {
    const directory = path23.join(root2, ".dev-flow", "features");
    const entries = await readdir7(directory, { withFileTypes: true });
    for (const entry of entries.filter((candidate) => candidate.isDirectory())) {
      try {
        const raw = JSON.parse(await readFile19(path23.join(directory, entry.name, "state.json"), "utf8"));
        if ([1, 2, 3].includes(Number(raw.schemaVersion)) && raw.lifecycle !== "finalized" && raw.lifecycle !== "abandoned") legacyFeatures.push(entry.name);
      } catch {
      }
    }
  } catch {
  }
  const v4Ready = legacyFeatures.length === 0;
  add2(v4Ready ? "V4_READY" : "V4_NOT_READY", v4Ready ? "ok" : "warning", v4Ready ? "\u6CA1\u6709\u672A\u5B8C\u6210\u7684\u65E7\u7248 feature\uFF0C\u53EF\u4EE5\u4F7F\u7528 schema v4" : `\u4ECD\u6709\u672A\u5B8C\u6210\u7684\u65E7\u7248 feature: ${legacyFeatures.join(", ")}`, v4Ready ? void 0 : "\u5148\u4F7F\u7528 4.x \u5B8C\u6210\u6216\u653E\u5F03\u65E7 feature\uFF0C\u5907\u4EFD .dev-flow\uFF0C\u518D\u4F7F\u7528 5.0 \u91CD\u65B0\u521D\u59CB\u5316\uFF1Bdoctor \u4E0D\u81EA\u52A8\u8FC1\u79FB\u6216\u7EC8\u6B62");
  return {
    version,
    root: root2,
    pluginRoot,
    tools,
    project,
    activeFeature,
    corruptFeature,
    corruptActivePointer,
    hookHealth,
    recoveryTransaction: recoveryTxn ?? null,
    rollbackTransactions,
    trace: trace2 ?? null,
    review: review2 ?? null,
    mcp: { server: "running", configuration: !invalidJson },
    v4Ready,
    legacyFeatures,
    diagnostics: diagnostics2
  };
}

// plugins/dev-flow/src/mcp/interaction-pipeline.ts
function interactionEnvelope(state, interaction, interactionOutcome, response) {
  const optionLabel = interaction.options.find((option) => option.id === interactionOutcome)?.label;
  return {
    state,
    interaction,
    interactionOutcome: optionLabel ?? interactionOutcome,
    ...response ? { response: {
      action: optionLabel ?? response.action,
      ...response.kind ? { kind: response.kind } : {},
      ...response.answerCode ? { answerCode: response.answerCode } : {},
      ...response.selectedOptionId ? { selectedOptionId: response.selectedOptionId } : {},
      ...response.rawReply ? { rawReply: response.rawReply } : {},
      ...response.comment ? { comment: response.comment } : {}
    } } : {}
  };
}
async function elicitAndAnswer(ports2, presentation, spec) {
  ports2.notify({
    kind: "decision-required",
    featureId: spec.featureId,
    decision: spec.decision,
    ...spec.approvalId ? { approvalId: spec.approvalId } : {}
  });
  const selection = await ports2.elicit(presentation.interaction, spec.question);
  if (!selection) {
    return { ...interactionEnvelope(presentation.state, presentation.interaction, spec.pendingOutcome ?? "pending"), ...spec.extra };
  }
  const next = await ports2.answer({
    root: spec.root,
    featureId: spec.featureId,
    expectedRevision: presentation.state.revision,
    host: spec.host,
    credential: { source: "elicitation", action: selection.action, comment: selection.comment }
  });
  const response = interactionResponse(next.state, presentation.interactionId);
  return {
    ...interactionEnvelope(
      next.state,
      toPublicInteraction(getInteraction(next.state, presentation.interactionId)),
      response?.action ?? selection.action,
      response
    ),
    ...spec.extra
  };
}

// plugins/dev-flow/src/mcp/input-validation.ts
function typeOf(value) {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  return typeof value;
}
function childPath(path25, key) {
  return typeof key === "number" ? `${path25}[${key}]` : `${path25}.${key}`;
}
function issue2(path25, keyword, message, extra = {}) {
  return { path: path25, keyword, message, ...extra };
}
function matchesType(value, expected) {
  if (expected === "integer") return typeof value === "number" && Number.isInteger(value);
  return typeOf(value) === expected;
}
function discriminatorMatches(value, schema) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const properties = schema.properties;
  if (!properties || typeof properties !== "object" || Array.isArray(properties)) return false;
  const record = value;
  let constrained = false;
  for (const [key, candidate] of Object.entries(properties)) {
    if (!(key in record) || !candidate || typeof candidate !== "object") continue;
    if (candidate.const !== void 0) {
      constrained = true;
      if (stableJson(record[key]) !== stableJson(candidate.const)) return false;
    } else if (Array.isArray(candidate.enum)) {
      constrained = true;
      if (!candidate.enum.some((allowed) => stableJson(record[key]) === stableJson(allowed))) return false;
    }
  }
  return constrained;
}
function validate(value, schema, path25) {
  if (Object.keys(schema).length === 0) return [];
  const issues = [];
  const expectedType = schema.type;
  if (typeof expectedType === "string" && !matchesType(value, expectedType)) {
    return [issue2(path25, "type", `expected ${expectedType}, got ${typeOf(value)}`)];
  }
  if (Array.isArray(expectedType) && !expectedType.some((candidate) => typeof candidate === "string" && matchesType(value, candidate))) {
    return [issue2(path25, "type", `expected one of ${expectedType.join(", ")}, got ${typeOf(value)}`)];
  }
  if (schema.const !== void 0 && stableJson(value) !== stableJson(schema.const)) {
    issues.push(issue2(path25, "const", `must equal ${stableJson(schema.const)}`));
  }
  if (Array.isArray(schema.enum) && !schema.enum.some((candidate) => stableJson(value) === stableJson(candidate))) {
    issues.push(issue2(path25, "enum", "must be one of the allowed values"));
  }
  if (typeof value === "string") {
    if (typeof schema.minLength === "number" && value.length < schema.minLength) issues.push(issue2(path25, "minLength", `must have length >= ${schema.minLength}`));
    if (typeof schema.pattern === "string") {
      let matches = false;
      try {
        matches = new RegExp(schema.pattern).test(value);
      } catch {
        matches = false;
      }
      if (!matches) issues.push(issue2(path25, "pattern", "does not match the required pattern"));
    }
  }
  if (typeof value === "number" && typeof schema.minimum === "number" && value < schema.minimum) {
    issues.push(issue2(path25, "minimum", `must be >= ${schema.minimum}`));
  }
  if (Array.isArray(value)) {
    if (typeof schema.minItems === "number" && value.length < schema.minItems) issues.push(issue2(path25, "minItems", `must contain at least ${schema.minItems} items`));
    if (typeof schema.maxItems === "number" && value.length > schema.maxItems) issues.push(issue2(path25, "maxItems", `must contain at most ${schema.maxItems} items`));
    if (schema.uniqueItems === true) {
      const seen = new Set(value.map(stableJson));
      if (seen.size !== value.length) issues.push(issue2(path25, "uniqueItems", "items must be unique"));
    }
    if (schema.items && typeof schema.items === "object" && !Array.isArray(schema.items)) {
      value.forEach((item, index) => issues.push(...validate(item, schema.items, childPath(path25, index))));
    }
  }
  if (typeof value === "object" && value !== null && !Array.isArray(value)) {
    const record = value;
    const properties = schema.properties && typeof schema.properties === "object" && !Array.isArray(schema.properties) ? schema.properties : {};
    const required = Array.isArray(schema.required) ? schema.required.filter((key) => typeof key === "string") : [];
    for (const key of required) {
      if (!(key in record)) issues.push(issue2(childPath(path25, key), "required", "is required"));
    }
    const additional = schema.additionalProperties;
    for (const [key, item] of Object.entries(record)) {
      if (properties[key]) {
        issues.push(...validate(item, properties[key], childPath(path25, key)));
      } else if (additional === false) {
        issues.push(issue2(childPath(path25, key), "additionalProperties", "unknown field", {
          unknownField: key,
          allowedFields: Object.keys(properties).sort()
        }));
      } else if (additional && typeof additional === "object" && !Array.isArray(additional)) {
        issues.push(...validate(item, additional, childPath(path25, key)));
      }
    }
    const propertyNames = schema.propertyNames && typeof schema.propertyNames === "object" && !Array.isArray(schema.propertyNames) ? schema.propertyNames : void 0;
    if (propertyNames) {
      for (const key of Object.keys(record)) issues.push(...validate(key, propertyNames, childPath(path25, key)));
    }
  }
  if (Array.isArray(schema.oneOf)) {
    const candidates = schema.oneOf.filter((candidate) => typeof candidate === "object" && candidate !== null && !Array.isArray(candidate));
    const results = candidates.map((candidate) => validate(value, candidate, path25));
    const valid = results.filter((result) => result.length === 0);
    if (valid.length !== 1) {
      const discriminatorResults = results.filter((_, index) => discriminatorMatches(value, candidates[index]));
      const bestPool = discriminatorResults.length ? discriminatorResults : results;
      const best = bestPool.sort((left, right) => left.length - right.length)[0] ?? [];
      issues.push(...best);
      issues.push(issue2(path25, "oneOf", "must match exactly one schema"));
    }
  }
  return issues;
}
function normalizeIssues(tool, issues) {
  const normalized = tool === "dev_flow_classify" ? issues.map((candidate) => candidate.unknownField === "riskFactRefs" ? { ...candidate, path: "$.classificationBasis.riskFactRefs", message: "riskFactRefs belongs inside classificationBasis" } : candidate) : issues;
  return [...normalized].sort((left, right) => `${left.path}\0${left.keyword}`.localeCompare(`${right.path}\0${right.keyword}`));
}
function validateToolInput(toolName, args, schemas) {
  const schema = schemas[toolName]?.inputSchema;
  if (!schema) throw new DevFlowError("UNKNOWN_TOOL", toolName, { mutationApplied: false });
  const issues = normalizeIssues(toolName, validate(args, schema, "$"));
  if (issues.length) {
    throw new DevFlowError("INVALID_TOOL_INPUT", `${toolName} input does not match its schema`, {
      tool: toolName,
      issues,
      mutationApplied: false
    });
  }
}

// plugins/dev-flow/src/mcp/dispatch.ts
function pluginRootForDoctor(fallbackRoot) {
  try {
    const moduleDirectory = path24.dirname(fileURLToPath(import.meta.url));
    return path24.basename(moduleDirectory) === "dist" ? path24.resolve(moduleDirectory, "..") : path24.resolve(moduleDirectory, "../..");
  } catch {
    return fallbackRoot;
  }
}
var object = (required, properties = {}) => ({
  type: "object",
  required,
  properties,
  additionalProperties: false
});
var string = { type: "string", minLength: 1 };
var integer = { type: "integer", minimum: 0 };
var featureMutation = (extra = {}, requiredExtras = []) => object(
  ["featureId", "expectedRevision", ...requiredExtras],
  { featureId: string, expectedRevision: integer, ...extra }
);
var riskLabelsSchema = { type: "array", items: { enum: allowedRiskLabels }, uniqueItems: true };
var reviewRolesSchema = { type: "array", uniqueItems: true, items: { enum: [
  "code-quality",
  "requirement-fidelity",
  "requirements-coverage",
  "architecture-testability",
  "rollback-operability",
  "security",
  "data-irreversibility",
  "money-safety",
  "contract-failure",
  "recovery-observability",
  "critical-correctness"
] } };
var controlEnhancementsSchema = object([], {
  requirements: { const: true },
  plan: { enum: ["brief", "formal"] },
  trace: { const: true },
  planReview: { const: true },
  reviewRoles: reviewRolesSchema,
  executionApproval: { const: true },
  checkpoints: { const: "unit-chain" },
  recovery: { type: "array", uniqueItems: true, items: { enum: ["operational-strategy", "executable-rollback", "irreversible-compensation"] } },
  codeReview: { enum: ["focused", "independent", "full"] },
  verification: { type: "array", uniqueItems: true, items: { enum: ["targeted", "behavior", "integration", "full"] } }
});
var classificationSignalsSchema = object(["changeSurface", "behaviorChange", "topology", "unitCount", "requirements", "operationalRecovery", "executableRollback"], {
  changeSurface: { enum: ["single-site", "single-component", "multi-component", "system-wide"] },
  behaviorChange: { enum: ["mechanical", "bounded-rule", "new-capability", "systemic-change"] },
  topology: { enum: ["local", "shared-contract", "multi-chain", "coordinated-rollback"] },
  unitCount: { type: "integer", minimum: 1 },
  requirements: { enum: ["missing-or-unclear", "documented-unconfirmed", "provided-confirmed"] },
  operationalRecovery: { type: "boolean" },
  executableRollback: { type: "boolean" },
  upwardLevel: { enum: ["XS", "S", "M", "L"] }
});
var classificationBasisSchema = object(["scopeFactRefs", "topologyFactRefs", "uncertaintyFactRefs", "riskFactRefs", "decisionRefs"], {
  scopeFactRefs: { type: "array", items: string },
  topologyFactRefs: { type: "array", items: string },
  uncertaintyFactRefs: { type: "array", items: string },
  riskFactRefs: { type: "object", propertyNames: { enum: allowedRiskLabels }, additionalProperties: { type: "array", items: string } },
  decisionRefs: { type: "array", items: string },
  signals: classificationSignalsSchema,
  controlEnhancements: controlEnhancementsSchema
});
var recommendedClassificationBasisSchema = object(["scopeFactRefs", "topologyFactRefs", "uncertaintyFactRefs", "riskFactRefs", "decisionRefs", "signals"], {
  ...classificationBasisSchema.properties
});
var flatClassificationBasisProperties = {
  scopeFactRefs: classificationBasisSchema.properties.scopeFactRefs,
  topologyFactRefs: classificationBasisSchema.properties.topologyFactRefs,
  uncertaintyFactRefs: classificationBasisSchema.properties.uncertaintyFactRefs,
  riskFactRefs: classificationBasisSchema.properties.riskFactRefs,
  decisionRefs: classificationBasisSchema.properties.decisionRefs
};
var classificationInputSchema = object(["level", "topology"], {
  level: { enum: ["XS", "S", "M", "L"] },
  topology: { enum: ["local", "shared-contract", "multi-chain", "coordinated-rollback"] },
  requirements: { enum: ["missing-or-unclear", "documented-unconfirmed", "provided-confirmed"] },
  riskLabels: riskLabelsSchema,
  classificationBasis: classificationBasisSchema,
  ...flatClassificationBasisProperties,
  acceptanceAssistSuggested: { type: "boolean" },
  controlEnhancements: controlEnhancementsSchema
});
var traceArtifactKinds2 = ["requirements", "implementation-plan", "coverage-matrix", "rollback-units"];
var traceId = (prefix) => ({ type: "string", pattern: `^${prefix}-[0-9]{3,}$` });
var stringArray = { type: "array", minItems: 1, items: string };
var relativeCwd = { type: "string", minLength: 1, pattern: "^(?!/)(?![A-Za-z]:)(?!.*(?:^|/)\\.\\.(?:/|$)).*$" };
var inlineVerificationCommand = object(["command"], {
  command: string,
  args: { type: "array", items: string },
  cwd: relativeCwd
});
var verificationCommandRef = { oneOf: [string, inlineVerificationCommand] };
var verificationCommandArray = { type: "array", minItems: 1, uniqueItems: true, items: verificationCommandRef };
var traceNodeSchemas = [
  object(["kind", "id"], { kind: { const: "requirement" }, id: traceId("REQ") }),
  object(["kind", "id", "parentRequirement"], { kind: { const: "acceptance-criterion" }, id: traceId("AC"), parentRequirement: traceId("REQ"), verificationDisposition: object(["kind"], { kind: { enum: ["behavior-test", "type-check", "rule-check", "file-check", "human-acceptance"] }, reason: string, target: string }) }),
  object(["kind", "id", "covers", "implementationUnit"], { kind: { const: "task" }, id: traceId("TASK"), covers: stringArray, implementationUnit: traceId("UNIT") }),
  object(["kind", "id", "verifies"], { kind: { const: "test" }, id: traceId("TEST"), verifies: { type: "array", minItems: 1, items: traceId("AC") } }),
  object(["kind", "id", "tasks", "dependsOn", "fileScope", "covers", "forwardVerification", "rollbackVerification"], {
    kind: { const: "rollback" },
    id: traceId("RU"),
    tasks: { type: "array", minItems: 1, items: traceId("TASK") },
    dependsOn: { type: "array", items: traceId("RU") },
    fileScope: stringArray,
    covers: stringArray,
    forwardVerification: verificationCommandArray,
    rollbackVerification: verificationCommandArray
  }),
  object(["kind", "id", "tasks", "dependsOn", "fileScope", "covers", "forwardVerification"], {
    kind: { const: "implementation-unit" },
    id: traceId("UNIT"),
    tasks: { type: "array", minItems: 1, items: traceId("TASK") },
    dependsOn: { type: "array", items: traceId("UNIT") },
    fileScope: stringArray,
    covers: stringArray,
    forwardVerification: verificationCommandArray
  }),
  object(["kind", "id", "stepRef", "recoveryKind", "method", "riskRef"], {
    kind: { const: "recovery" },
    id: traceId("REC"),
    stepRef: { type: "string", pattern: "^(UNIT|TASK)-[0-9]{3,}$" },
    recoveryKind: { enum: ["rollback", "compensation"] },
    method: string,
    riskRef: string
  })
];
var traceDeltaSchema = object(["nodes"], {
  nodes: { type: "array", items: { oneOf: traceNodeSchemas } }
});
var reviewEvidenceSchema = object(["path"], { path: string, line: { type: "integer", minimum: 1 } });
var reviewFindingSchema = object(["severity", "category", "targets", "evidence", "claim", "recommendation"], {
  severity: { enum: ["blocking", "warning", "note"] },
  category: { enum: ["code-quality", "requirement-fidelity", "requirements-coverage", "architecture-testability", "rollback-operability", "security", "data-irreversibility", "money-safety", "contract-failure", "recovery-observability", "critical-correctness"] },
  targets: { type: "array", minItems: 1, items: string },
  evidence: { type: "array", minItems: 1, items: reviewEvidenceSchema },
  claim: string,
  recommendation: string
});
var reviewResolutionSchema = object(["findingId", "evidence", "note"], {
  findingId: string,
  evidence: { type: "array", minItems: 1, items: reviewEvidenceSchema },
  note: string
});
var reviewCompletionSchema = object(["coverageSummary", "findings"], {
  coverageSummary: string,
  findings: { type: "array", items: reviewFindingSchema },
  resolutions: { type: "array", items: reviewResolutionSchema }
});
var reviewAttestationSchema = object(["host", "agentId", "issuedAt", "raw"], {
  host: { enum: ["claude", "codex"] },
  agentId: string,
  issuedAt: string,
  raw: string,
  // 与 policy/review.ts 的 parseHostAttestation 白名单一致：hostEventId 必须指向
  // 宿主捕获的 review-execution 事件才会被 Core 计入来源/隔离证明；isolated 只是
  // 声明，不能单独形成证明。
  hostEventId: string,
  isolated: { type: "boolean" }
});
var scopeSchema = {
  type: "object",
  required: ["inScope", "outOfScope"],
  additionalProperties: false,
  properties: {
    inScope: { type: "array", items: { type: "string" } },
    outOfScope: { type: "array", items: { type: "string" } }
  }
};
var repositoryObservationSchema = {
  oneOf: [
    object(["kind", "path"], { kind: { const: "file-exists" }, path: string }),
    object(["kind", "path", "text"], { kind: { const: "text-present" }, path: string, text: string, occurrence: { type: "integer", minimum: 1 } }),
    object(["kind", "path", "symbol"], { kind: { const: "symbol-present" }, path: string, symbol: string }),
    object(["kind", "path", "pointer", "expected"], { kind: { const: "json-value" }, path: string, pointer: string, expected: {} }),
    object(["kind", "checkedScope", "pattern", "patternKind"], {
      kind: { const: "search-absent" },
      checkedScope: { type: "array", minItems: 1, items: string },
      pattern: string,
      patternKind: { enum: ["literal", "regex"] }
    })
  ]
};
var acceptanceEvidenceSchema = {
  oneOf: [
    object(["kind", "eventId"], { kind: { const: "browser-operation" }, eventId: string, note: string }),
    object(["kind", "path", "sourceEventId"], { kind: { const: "screenshot" }, path: string, sourceEventId: string, note: string }),
    object(["kind", "observation"], { kind: { const: "file-inspection" }, observation: repositoryObservationSchema, note: string }),
    object(["kind", "note"], { kind: { const: "agent-self-check" }, note: string })
  ]
};
var interactionOptionSchema = object(["id", "label", "description"], {
  id: string,
  label: string,
  description: string,
  requiresComment: { type: "boolean" }
});
var grillRecommendationSchema = object(["optionId", "reason"], {
  optionId: string,
  reason: string,
  drawback: string,
  alternative: object(["optionId", "condition"], { optionId: string, condition: string })
});
var boundaryAuditItemSchema = object(["id", "kind", "disposition", "summary"], {
  id: string,
  kind: { enum: ["assumption", "free-space", "tbd", "fallback", "scope", "acceptance"] },
  disposition: { enum: ["repository-fact", "resolved-decision"] },
  factRef: string,
  decisionRef: string,
  summary: string
});
var boundaryAuditSchema = object(["scanned", "items"], {
  scanned: { type: "array", minItems: 6, uniqueItems: true, items: { enum: ["assumption", "free-space", "tbd", "fallback", "scope", "acceptance"] } },
  items: { type: "array", items: boundaryAuditItemSchema }
});
var toolSchemas = {
  dev_flow_init_project: { description: "Create strict project configuration.", inputSchema: object(["config"], { config: { type: "object" } }) },
  dev_flow_update_project: { description: "Update strict project configuration using sha256 compare-and-swap.", inputSchema: object(["config", "expectedSha256"], { config: { type: "object" }, expectedSha256: string }) },
  dev_flow_classify: {
    description: "Pure route classification (read-only preview).",
    inputSchema: object([], {
      classificationBasis: recommendedClassificationBasisSchema,
      level: { enum: ["XS", "S", "M", "L"] },
      topology: { enum: ["local", "shared-contract", "multi-chain", "coordinated-rollback"] },
      requirements: { enum: ["missing-or-unclear", "documented-unconfirmed", "provided-confirmed"] },
      riskLabels: riskLabelsSchema,
      controlEnhancements: controlEnhancementsSchema,
      acceptanceAssistSuggested: { type: "boolean", description: "Offer optional browser/user acceptance help; never blocks the route." }
    }),
    annotations: { readOnlyHint: true }
  },
  dev_flow_start: {
    description: "Create an unclassified intake feature.",
    inputSchema: object(["featureId", "objective", "host"], {
      objective: string,
      featureId: string,
      activation: { enum: ["active", "paused"] },
      scope: scopeSchema,
      host: { enum: ["claude", "codex"] }
    })
  },
  dev_flow_lock_classification: {
    description: "Atomically lock a classification after intake decisions are resolved.",
    inputSchema: featureMutation({ classification: classificationInputSchema, boundaryAudit: boundaryAuditSchema }, ["classification", "boundaryAudit"])
  },
  dev_flow_record_decision: {
    description: "Record an already-known user conclusion as one trusted resolved decision.",
    inputSchema: featureMutation({ question: string, evidence: string, conclusion: string, factRefs: { type: "array", items: string }, host: { enum: ["claude", "codex"] } }, ["question", "evidence", "conclusion", "host"])
  },
  dev_flow_record_repository_fact: {
    description: "Execute and register one reproducible repository observation; BoundaryAudit only accepts current fact records.",
    inputSchema: featureMutation({
      observation: repositoryObservationSchema,
      host: { enum: ["claude", "codex"] }
    }, ["observation", "host"])
  },
  dev_flow_record_repository_facts: {
    description: "Execute and register many reproducible repository observations in one CAS write; BoundaryAudit only accepts current fact records.",
    inputSchema: featureMutation({
      observations: { type: "array", minItems: 1, maxItems: 50, items: repositoryObservationSchema },
      host: { enum: ["claude", "codex"] }
    }, ["observations", "host"])
  },
  dev_flow_revise_decision: {
    description: "Revise a registered decision before implementation: show the old decision, new conclusion, and affected work, then ratify with one confirmation.",
    inputSchema: featureMutation({
      decisionId: string,
      newConclusion: string,
      reason: string,
      host: { enum: ["claude", "codex"] }
    }, ["decisionId", "newConclusion", "reason", "host"])
  },
  dev_flow_revise_plan: {
    description: "Revise the implementation plan during planning/implementation: pause the current step, show affected units and side-effect warnings, then redo only the affected work after confirmation.",
    inputSchema: featureMutation({
      kind: { const: "implementation-plan" },
      traceDelta: traceDeltaSchema,
      host: { enum: ["claude", "codex"] }
    }, ["kind", "traceDelta", "host"])
  },
  dev_flow_status: { description: "Read the compact daily status of one feature.", inputSchema: object(["featureId"], { featureId: string }), annotations: { readOnlyHint: true } },
  dev_flow_inspect: { description: "Read one detailed topic; full state is never exposed through a single public response.", inputSchema: object(["featureId", "topic"], { featureId: string, topic: { enum: inspectionTopics } }), annotations: { readOnlyHint: true } },
  dev_flow_scaffold_artifact: { description: "Create only the current route artifact. For editable artifacts, read the registered path before editing, then record it. Generated status artifacts are read-only: scaffold them and continue with the requested step; do not edit or record them.", inputSchema: featureMutation({ kind: string }, ["kind"]) },
  dev_flow_record_artifact: { description: "Register an edited route artifact.", inputSchema: featureMutation({ kind: string }, ["kind"]) },
  dev_flow_validate_plan: {
    description: "Read-only plan preflight: returns the complete diagnostic set in stable order with zero side effects; formal registration uses the same compile result.",
    inputSchema: featureMutation({ kind: { enum: traceArtifactKinds2 }, traceDelta: traceDeltaSchema }, ["kind", "traceDelta"]),
    annotations: { readOnlyHint: true }
  },
  dev_flow_record_artifact_with_trace: {
    description: "Atomically register one Trace source artifact and its complete Trace delta.",
    inputSchema: featureMutation({ kind: { enum: traceArtifactKinds2 }, traceDelta: traceDeltaSchema }, ["kind", "traceDelta"])
  },
  dev_flow_get_traceability: {
    description: "Read the current Trace pointer, ledger, effective summary, and current-step blockers.",
    inputSchema: object(["featureId"], { featureId: string }),
    annotations: { readOnlyHint: true }
  },
  dev_flow_rebuild_review_projection: { description: "Rebuild only the generated review projection from the immutable ledger.", inputSchema: featureMutation() },
  dev_flow_create_review_batch: {
    description: "Create or return the Core-derived immutable review batch for the current basis.",
    inputSchema: featureMutation()
  },
  dev_flow_get_review_job: {
    description: "Read only the claimed job's immutable package. A job capability never reveals sibling jobs.",
    inputSchema: object(["featureId", "batchId", "jobId", "capability"], { featureId: string, batchId: string, jobId: string, capability: string }),
    annotations: { readOnlyHint: true }
  },
  dev_flow_claim_review_job: {
    description: "Claim one current review job using a high-entropy retry key; returns the job capability.",
    inputSchema: featureMutation({ batchId: string, jobId: string, claimRequestId: string }, ["batchId", "jobId", "claimRequestId"])
  },
  dev_flow_release_review_job: {
    description: "Release the current review job claim back to pending using the same capability; expired claims remain releasable by their holder.",
    inputSchema: featureMutation({ batchId: string, jobId: string, capability: string }, ["batchId", "jobId", "capability"])
  },
  dev_flow_submit_review_job: {
    description: "Submit one claimed job's structured completion. Host attestation is diagnostic unless a trusted verifier accepts it; Core still owns assurance. Isolation proof requires a real host-captured review-execution event or server sampling; agent-authored event claims never qualify.",
    inputSchema: featureMutation({
      batchId: string,
      jobId: string,
      capability: string,
      completion: reviewCompletionSchema,
      attestation: reviewAttestationSchema
    }, ["batchId", "jobId", "capability", "completion"])
  },
  dev_flow_sample_review_job: {
    description: "Ask a sampling-capable MCP client to complete one pending review job. The server owns the one-use request and submits only a validated response.",
    inputSchema: object(["featureId", "expectedRevision", "batchId", "jobId"], {
      featureId: string,
      expectedRevision: integer,
      batchId: string,
      jobId: string
    })
  },
  dev_flow_record_review_execution_event: {
    expose: false,
    // 宿主接缝：agent 不可调用、不进入 tools/list，也无需 dispatch case
    description: "Record one review-execution event for the active feature (host adapter seam for subagent reviews). Only this dedicated event type can prove review source or context isolation; ordinary user-prompt/tool events never qualify. contextId must identify the review context and implementationContextId the implementation context; submitReviewJob validates that contextId differs from implementationContextId.",
    inputSchema: object(["event"], {
      event: object(["eventId", "type", "host", "batchId", "jobId", "executionId", "sourceId", "contextId", "implementationContextId"], {
        eventId: string,
        type: { const: "review-execution" },
        host: { enum: ["claude", "codex"] },
        batchId: string,
        jobId: string,
        executionId: string,
        sourceId: string,
        contextId: string,
        implementationContextId: string,
        parentContextId: string,
        text: string
      })
    })
  },
  dev_flow_present_review_risk_acceptance: {
    description: "Present a one-time user decision for an exact set of current blocking review findings.",
    inputSchema: featureMutation({ findingIds: { type: "array", minItems: 1, uniqueItems: true, items: string }, host: { enum: ["claude", "codex"] } }, ["findingIds", "host"])
  },
  dev_flow_answer: {
    description: "Answer the one current user decision in plain Chinese; Core resolves its kind and trusted host provenance.",
    inputSchema: featureMutation({ userReply: string, host: { enum: ["claude", "codex"] } }, ["userReply", "host"])
  },
  dev_flow_present_quality_exception: {
    description: "Present one workflow-quality risk for an explicit user decision; integrity failures cannot use this path.",
    inputSchema: featureMutation({ kind: { enum: ["review", "verification", "checkpoint", "implementation-evidence"] }, basisHash: string, fingerprint: string, riskSummary: string, host: { enum: ["claude", "codex"] } }, ["kind", "basisHash", "fingerprint", "riskSummary", "host"])
  },
  dev_flow_record_step: { description: "Record the current non-gate route step.", inputSchema: featureMutation({ step: string, evidence: {} }, ["step", "evidence"]) },
  dev_flow_pause: { description: "Pause an active feature without requiring commit, verification, or finalize.", inputSchema: featureMutation({ reason: string, host: { enum: ["claude", "codex"] } }, ["reason", "host"]) },
  dev_flow_resume: { description: "Resume a paused feature after automatic workspace reconciliation.", inputSchema: object(["featureId", "host"], { featureId: string, host: { enum: ["claude", "codex"] } }) },
  dev_flow_reconcile_workspace: { description: "Reconcile manual commits and workspace changes without asking for already-authorized commit permission.", inputSchema: featureMutation({ host: { enum: ["claude", "codex"] } }, ["host"]) },
  dev_flow_begin_implementation_unit: {
    description: "Begin the next implementation unit of a checkpoints:1 feature; Core derives basis, scope, and dependency order.",
    inputSchema: object(["featureId", "expectedRevision", "unitId"], { featureId: string, expectedRevision: integer, unitId: traceId("UNIT") })
  },
  dev_flow_checkpoint_implementation_unit: {
    description: "Confirm the active implementation unit: scope-checked diff, forward verification, content-addressed checkpoint.",
    inputSchema: object(["featureId", "expectedRevision", "unitId"], { featureId: string, expectedRevision: integer, unitId: traceId("UNIT") })
  },
  dev_flow_abandon_implementation_unit: {
    description: "Cancel the active implementation unit without touching the workspace; the unit returns to pending so the plan can be re-registered and the unit re-begun (e.g. after a verification config change made its Trace basis stale).",
    inputSchema: object(["featureId", "expectedRevision", "unitId", "reason", "host"], { featureId: string, expectedRevision: integer, unitId: traceId("UNIT"), reason: string, host: { enum: ["claude", "codex"] } })
  },
  dev_flow_preview_rollback: {
    description: "Read-only rollback plan for a confirmed checkpoint: undo order, restored files, verification commands.",
    inputSchema: object(["featureId", "targetCheckpointId"], { featureId: string, targetCheckpointId: string }),
    annotations: { readOnlyHint: true }
  },
  dev_flow_present_rollback_gate: {
    description: "Present a rollback confirmation gate for a confirmed checkpoint. Requires checkpoints:1 and rollbackExecution:1.",
    inputSchema: object(["featureId", "expectedRevision", "targetCheckpointId", "host"], { featureId: string, expectedRevision: integer, targetCheckpointId: string, host: { enum: ["claude", "codex"] } })
  },
  dev_flow_execute_rollback: {
    description: "Execute a confirmed rollback as a resumable file transaction. Rolls back to the target checkpoint, undoing all later units in reverse order.",
    inputSchema: object(["featureId", "expectedRevision", "targetCheckpointId"], { featureId: string, expectedRevision: integer, targetCheckpointId: string })
  },
  dev_flow_present_approval: { description: "Present the unique current Core-derived approval obligation.", inputSchema: featureMutation({ host: { enum: ["claude", "codex"] } }, ["host"]) },
  dev_flow_record_acceptance_evidence: {
    description: "Record one current, verifiable acceptance artifact for one human-acceptance criterion. Text-only self-checks remain informational.",
    inputSchema: featureMutation({ acceptanceCriterionId: traceId("AC"), evidence: acceptanceEvidenceSchema, host: { enum: ["claude", "codex"] } }, ["acceptanceCriterionId", "evidence", "host"])
  },
  dev_flow_present_acceptance_confirmation: {
    description: "Present a one-time confirmation for selected human-acceptance criteria, bound to the current delivery content.",
    inputSchema: featureMutation({ acceptanceCriterionIds: { type: "array", minItems: 1, uniqueItems: true, items: traceId("AC") }, host: { enum: ["claude", "codex"] } }, ["acceptanceCriterionIds", "host"])
  },
  dev_flow_request_grill_decision: {
    description: "Present the current grill question as structured choices when the host supports MCP elicitation, otherwise return one-time text replies.",
    inputSchema: featureMutation({
      questionId: string,
      question: string,
      options: { type: "array", minItems: 2, maxItems: 3, items: interactionOptionSchema },
      recommendation: grillRecommendationSchema,
      host: { enum: ["claude", "codex"] }
    }, ["questionId", "question", "options", "recommendation", "host"])
  },
  dev_flow_reclassify: {
    description: "Recompute controls before governed writes; after implementation starts only monotonic strengthening is allowed.",
    inputSchema: featureMutation({ classification: classificationInputSchema, reason: string, userEvidence: string }, ["classification", "reason"])
  },
  dev_flow_verify: {
    description: "Run configured verification commands. Acceptance evidence is recorded separately and cannot be self-reported here.",
    inputSchema: featureMutation({
      commandIds: { type: "array", items: string },
      host: { enum: ["claude", "codex"] }
    }, ["host"])
  },
  dev_flow_finalize: { description: "Set logic-complete after all obligations pass.", inputSchema: featureMutation() },
  dev_flow_repair_feature: { description: "Rebuild derived pointers, stage, freshness, and review/status projections only.", inputSchema: featureMutation({ host: { enum: ["claude", "codex"] } }, ["host"]) },
  dev_flow_abandon: { description: "Terminally abandon a non-finalized feature.", inputSchema: featureMutation({ reason: string, userEvidence: string }, ["reason", "userEvidence"]) },
  dev_flow_enable_windows_notifications: {
    description: "Explicitly enable per-user Windows Toast notifications for Dev Flow. Does not change feature state.",
    inputSchema: object([])
  },
  dev_flow_doctor: { description: "Diagnose plugin and project wiring.", inputSchema: object([]), annotations: { readOnlyHint: true } },
  dev_flow_recover_corrupt_feature: {
    description: "Backup and abandon a corrupt active feature, or resume its doctor-reported recovery journal.",
    inputSchema: object(
      ["featureId", "stateSha256", "action", "reason", "userEvidence", "host"],
      {
        featureId: string,
        stateSha256: string,
        activeSha256: string,
        action: { enum: ["abandon"] },
        reason: string,
        userEvidence: string,
        host: { enum: ["claude", "codex"] }
      }
    )
  }
};
var publicTools = Object.keys(toolSchemas).filter((name) => toolSchemas[name].expose !== false);
var publicToolSet = new Set(publicTools);
function traceRegistrationInput(value) {
  return value;
}
function traceReadInput(value) {
  return value;
}
function reviewMutationInput(value) {
  return value;
}
function reviewGetInput(value) {
  return value;
}
function reviewSubmitInput(value) {
  return value;
}
function reviewSamplingInput(value) {
  return value;
}
function unitMutationInput(value) {
  return value;
}
function previewRollbackInput(value) {
  return value;
}
function rollbackMutationInput(value) {
  return value;
}
function answerOutcomeMessage(action, kind) {
  if (kind === "workspace-ownership") {
    if (action === "adopt-all" || action === "adopt" || action === "include") return "\u5DF2\u5C06\u8DEF\u5F84\u7EB3\u5165\u5F53\u524D\u4EFB\u52A1\u3002";
    if (action === "exclude-all" || action === "exclude") return "\u5DF2\u5C06\u8DEF\u5F84\u6392\u9664\uFF1B\u7CFB\u7EDF\u4E0D\u4F1A\u81EA\u52A8\u8FD8\u539F\u6216\u6682\u5B58\u5B83\u4EEC\u3002";
    if (action === "one-by-one") return "\u5DF2\u5207\u6362\u4E3A\u9010\u4E2A\u786E\u8BA4\u8DEF\u5F84\u3002";
    return void 0;
  }
  if (kind === "route-confirmation" && action === "confirm") return "\u8DEF\u7EBF\u5DF2\u6309\u53EF\u4FE1\u7528\u6237\u786E\u8BA4\u539F\u5B50\u9501\u5B9A\u3002";
  if (kind === "task-switch") {
    if (action === "pause-old") return "\u65E7\u4EFB\u52A1\u5DF2\u6682\u505C\u5E76\u91CA\u653E active \u6307\u9488\uFF1B\u91CD\u8BD5 dev_flow_start \u5373\u53EF\u5F00\u59CB\u65B0\u4EFB\u52A1\u3002";
    if (action === "finish-old") return "\u5DF2\u89E3\u9664\u4EFB\u52A1\u5207\u6362\u5F85\u51B3\uFF1B\u8BF7\u5148\u5B8C\u6210\u5F53\u524D\u4EFB\u52A1\uFF0C\u518D\u5F00\u59CB\u65B0\u4EFB\u52A1\u3002";
    if (action === "return-old") return "\u5DF2\u89E3\u9664\u4EFB\u52A1\u5207\u6362\u5F85\u51B3\uFF0C\u7EE7\u7EED\u5F53\u524D\u4EFB\u52A1\u3002";
    return void 0;
  }
  return void 0;
}
function rollbackGateMessage(preview) {
  const files = preview.filePlan.map((action) => `${action.action === "restore" ? "\u6062\u590D" : "\u5220\u9664"} ${action.path}`);
  const verification2 = preview.verificationCommands.map((command2) => command2.command);
  return [
    `\u56DE\u64A4\u76EE\u6807\uFF1A\u8BE5\u5B9E\u73B0\u5355\u5143\u6700\u8FD1\u4E00\u6B21\u4FDD\u5B58\u70B9\u3002`,
    `\u5C06\u64A4\u9500 ${preview.undoOrder.length} \u4E2A\u5B9E\u73B0\u5355\u5143\uFF08\u6309\u63D0\u4EA4\u987A\u5E8F\u5012\u5E8F\uFF09\u3002`,
    `\u6587\u4EF6\u5F71\u54CD\uFF08${files.length}\uFF09\uFF1A${files.length ? files.join("\uFF1B") : "\u65E0"}\u3002`,
    `\u56DE\u64A4\u9A8C\u8BC1\uFF1A${verification2.length ? verification2.join("\uFF1B") : "\u65E0"}\u3002`,
    "\u786E\u8BA4\u6267\u884C\u56DE\u64A4\uFF1F"
  ].join("\n");
}
function reviewSubmissionEnvelope(result, submittedJobId) {
  const job = result.batch.jobs.find((candidate) => candidate.jobId === submittedJobId);
  if (!job) throw new DevFlowError("REVIEW_INTEGRITY_FAILED", "submitted review job is missing from its batch", { submittedJobId });
  const publicJob2 = toPublicReviewJob(job);
  return {
    state: result.state,
    idempotent: result.idempotent,
    job: publicJob2,
    batch: {
      batchId: result.batch.batchId,
      basisHash: result.batch.basisHash,
      validity: result.batch.validity,
      progress: result.batch.progress,
      assuranceLevel: result.batch.assuranceLevel,
      executionMode: result.batch.executionMode,
      jobs: result.batch.jobs.map(({ jobId, role, reviewDepth, status }) => ({ jobId, role, reviewDepth, status }))
    }
  };
}
var classificationBasisKeys = ["scopeFactRefs", "topologyFactRefs", "uncertaintyFactRefs", "riskFactRefs", "decisionRefs", "controlEnhancements"];
function normalizeLockClassification(value) {
  const nested = value.classificationBasis;
  const nestedBasis = nested && typeof nested === "object" && !Array.isArray(nested) ? nested : void 0;
  const flatBasis = Object.fromEntries(classificationBasisKeys.filter((key) => Object.hasOwn(value, key)).map((key) => [key, value[key]]));
  if (nestedBasis && Object.keys(flatBasis).length) {
    const conflicts = classificationBasisKeys.filter((key) => Object.hasOwn(flatBasis, key) && stableJson(flatBasis[key]) !== stableJson(nestedBasis[key])).map((key) => ({
      path: `$.classification.classificationBasis.${key}`,
      nestedValue: nestedBasis[key],
      flatValue: flatBasis[key]
    }));
    if (conflicts.length) {
      throw new DevFlowError("CLASSIFICATION_BASIS_CONFLICT", "nested and flat classification basis fields disagree", { conflicts });
    }
  }
  const basis = nestedBasis ?? flatBasis;
  return {
    ...value,
    ...basis,
    ...Object.keys(basis).length ? { classificationBasis: basis } : {}
  };
}
var McpConnection = class {
  supportsFormElicitation = false;
  supportsSampling = false;
  elicitationFused = false;
  expired = /* @__PURE__ */ new Set();
  nextClientRequestId = 0;
  pending = /* @__PURE__ */ new Map();
  configure(capabilities, clientInfo) {
    this.supportsFormElicitation = false;
    this.elicitationFused = false;
    this.supportsSampling = false;
    if (!capabilities || typeof capabilities !== "object" || Array.isArray(capabilities)) return;
    const sampling = capabilities.sampling;
    this.supportsSampling = !!sampling && typeof sampling === "object" && !Array.isArray(sampling);
    const clientName = clientInfo && typeof clientInfo === "object" && !Array.isArray(clientInfo) ? clientInfo.name : void 0;
    if (clientName === "claude-code") return;
    const elicitation = capabilities.elicitation;
    if (!elicitation || typeof elicitation !== "object" || Array.isArray(elicitation)) return;
    const modes = elicitation;
    this.supportsFormElicitation = Object.keys(modes).length === 0 || modes.form !== void 0;
  }
  consumeResponse(message) {
    if (typeof message.id !== "string" || message.method !== void 0) return false;
    const pending = this.pending.get(message.id);
    if (!pending) return this.expired.delete(message.id);
    this.pending.delete(message.id);
    if (pending.timeout) clearTimeout(pending.timeout);
    if (message.error !== void 0) {
      pending.reject(new Error(`client request failed: ${JSON.stringify(message.error)}`));
    } else {
      pending.resolve(message.result);
    }
    return true;
  }
  close() {
    for (const { reject, timeout } of this.pending.values()) {
      if (timeout) clearTimeout(timeout);
      reject(new Error("MCP client stream closed while awaiting a client request"));
    }
    this.pending.clear();
  }
  assertSamplingSupported() {
    if (!this.supportsSampling) {
      throw new DevFlowError("REVIEW_SAMPLING_UNSUPPORTED", "MCP client did not advertise sampling/createMessage capability");
    }
  }
  request(method, params, timeoutMilliseconds) {
    const id = `dev-flow-${++this.nextClientRequestId}`;
    process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}
`);
    return new Promise((resolve, reject) => {
      const pending = { resolve, reject };
      if (timeoutMilliseconds !== void 0) {
        pending.timeout = setTimeout(() => {
          if (this.pending.delete(id)) {
            this.expired.add(id);
            process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", method: "notifications/cancelled", params: { requestId: id, reason: "Dev Flow request timed out" } })}
`);
            reject(new DevFlowError(method === "elicitation/create" ? "ELICITATION_TIMEOUT" : "REVIEW_SAMPLING_TIMEOUT", "MCP client request timed out"));
          }
        }, timeoutMilliseconds);
      }
      this.pending.set(id, pending);
    });
  }
  async sampleReview(job) {
    this.assertSamplingSupported();
    const response = await this.request("sampling/createMessage", {
      messages: [{
        role: "user",
        content: JSON.stringify({
          instruction: "Return exactly one JSON review completion with coverageSummary, findings, and optional resolutions. Do not include prose outside the JSON object.",
          role: job.role,
          reviewDepth: job.reviewDepth,
          package: job.package
        })
      }]
    }, 12e4);
    if (!response || typeof response !== "object" || Array.isArray(response)) {
      throw new DevFlowError("REVIEW_SAMPLING_RESPONSE_INVALID", "sampling/createMessage returned an invalid response");
    }
    const content = response.content;
    const items = Array.isArray(content) ? content : [content];
    if (items.length !== 1 || !items[0] || typeof items[0] !== "object" || Array.isArray(items[0]) || items[0].type !== "text" || typeof items[0].text !== "string") {
      throw new DevFlowError("REVIEW_SAMPLING_RESPONSE_INVALID", "sampling/createMessage must return one text JSON completion");
    }
    try {
      return JSON.parse(items[0].text);
    } catch {
      throw new DevFlowError("REVIEW_SAMPLING_RESPONSE_INVALID", "sampling/createMessage text must be valid JSON");
    }
  }
  async elicit(interaction, message) {
    if (!this.supportsFormElicitation || this.elicitationFused) return void 0;
    let raw;
    const choices = interaction.kind === "grill" ? [
      ...interaction.options.map((option) => ({
        const: option.id,
        title: `${option.answerCode}. ${option.label}${option.recommended ? "\uFF08\u63A8\u8350\uFF09" : ""}`
      })),
      { const: "other", title: "\u5176\u4ED6\uFF08\u8BF7\u8865\u5145\u65B9\u6848\u548C\u7406\u7531\uFF09" }
    ] : interaction.options.map((option) => ({ const: option.id, title: option.label }));
    try {
      raw = await this.request("elicitation/create", {
        mode: "form",
        message,
        requestedSchema: {
          type: "object",
          properties: {
            action: {
              type: "string",
              title: "\u64CD\u4F5C",
              description: "\u9009\u62E9\u786E\u8BA4\u3001\u63D0\u51FA\u4FEE\u6539\u610F\u89C1\uFF0C\u6216\u5F53\u524D\u95EE\u9898\u7684\u4E00\u4E2A\u9009\u9879",
              oneOf: choices
            },
            comment: {
              type: "string",
              title: "\u4FEE\u6539\u610F\u89C1 / \u8865\u5145\u8BF4\u660E",
              description: "\u9009\u62E9\u201C\u63D0\u51FA\u4FEE\u6539\u610F\u89C1\u201D\u6216\u201C\u5176\u4ED6\u201D\u65F6\u5FC5\u586B"
            }
          },
          required: ["action"]
        }
      }, process.env.NODE_ENV === "test" && /^\d+$/.test(process.env.DEV_FLOW_ELICITATION_TIMEOUT_MS ?? "") ? Number(process.env.DEV_FLOW_ELICITATION_TIMEOUT_MS) : 6e4);
    } catch {
      this.elicitationFused = true;
      return void 0;
    }
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return void 0;
    const result = raw;
    if (result.action !== "accept" || !result.content || typeof result.content.action !== "string") {
      this.elicitationFused = true;
      return void 0;
    }
    const comment = typeof result.content.comment === "string" ? result.content.comment : void 0;
    return { action: result.content.action, ...comment ? { comment } : {} };
  }
};
function samplingFailureCode(error) {
  if (error instanceof DevFlowError) {
    if (error.code === "REVIEW_SAMPLING_TIMEOUT" || error.code === "REVIEW_SAMPLING_REQUEST_EXPIRED") return "timeout";
    if (error.code === "REVIEW_SAMPLING_RESPONSE_INVALID") return "invalid-response";
  }
  if (error instanceof Error && (/^client request failed:/.test(error.message) || /^MCP client stream closed/.test(error.message))) {
    return "client-error";
  }
  return "validation-failed";
}
async function dispatch(root2, name, a, ports2) {
  validateToolInput(name, a, toolSchemas);
  if (!publicToolSet.has(name)) throw new DevFlowError("UNKNOWN_TOOL", name);
  const pipelinePorts = { elicit: ports2.elicit, notify: ports2.notify, answer };
  const tool = name;
  switch (tool) {
    case "dev_flow_init_project": {
      await initProject(root2, a.config);
      return { \u72B6\u6001: "\u5DF2\u521D\u59CB\u5316", \u914D\u7F6E\u8DEF\u5F84: path24.join(root2, ".dev-flow", "project.json"), \u4E0B\u4E00\u6B65: "\u8C03\u7528 dev_flow_start \u5F00\u59CB\u4E00\u4E2A\u9700\u6C42\u3002" };
    }
    case "dev_flow_update_project": {
      const result = await updateProjectConfig(root2, a.config, a.expectedSha256);
      return { \u72B6\u6001: "\u5DF2\u66F4\u65B0", \u914D\u7F6E\u8DEF\u5F84: path24.join(root2, ".dev-flow", "project.json"), previousSha256: result.previousSha256, sha256: result.sha256, \u53D8\u5316: result.impact, \u53D7\u5F71\u54CD\u8BC1\u636E: result.affectedEvidence, \u4E0B\u4E00\u6B65: "\u65B0\u589E\u6216\u6269\u5145\u9A8C\u8BC1\u80FD\u529B\u53EF\u7EE7\u7EED\u5F53\u524D\u4EFB\u52A1\uFF1B\u88AB\u5F15\u7528\u547D\u4EE4\u53D8\u5316\u7684 Trace/RU \u9700\u8981\u6309\u9519\u8BEF\u63D0\u793A\u91CD\u65B0\u767B\u8BB0\u3002" };
    }
    case "dev_flow_classify": {
      if (!a.classificationBasis && (a.level === void 0 || a.topology === void 0)) {
        throw new DevFlowError("CLASSIFICATION_ARGS_INVALID", "classify requires classificationBasis or level+topology", {
          userMessage: "\u5206\u7C7B\u9884\u89C8\u53C2\u6570\u4E0D\u8DB3\u3002",
          cause: "\u9700\u63D0\u4F9B classificationBasis\uFF08\u63A8\u8350\u6A21\u5F0F\uFF09\u6216 level+topology\u3002",
          impact: "\u65E0\u6CD5\u751F\u6210\u5206\u7C7B\u9884\u89C8\u3002",
          recoveryKind: "retry",
          recoveryInstruction: "\u8865\u9F50 classificationBasis \u6216 level+topology \u540E\u91CD\u8BD5 dev_flow_classify\u3002",
          retryOriginal: true,
          requiresUserDecision: false
        });
      }
      if (a.classificationBasis?.signals) {
        const preview = recommendClassification(a.classificationBasis);
        return preview.readyToLock ? { ...preview, riskRequirements: deriveRiskRequirements(preview.classification.riskLabels) } : preview;
      }
      const selected = selectRoute(a);
      return {
        ...selected,
        riskRequirements: deriveRiskRequirements(selected.classification.riskLabels)
      };
    }
    case "dev_flow_start":
      return startFeature(root2, { ...a, host: a.host });
    case "dev_flow_record_repository_fact":
      return registerRepositoryFact(root2, a.featureId, a.expectedRevision, { observation: a.observation }, a.host);
    case "dev_flow_record_repository_facts": {
      if (!Array.isArray(a.observations)) throw new DevFlowError("INVALID_TOOL_INPUT", "dev_flow_record_repository_facts requires observations[]");
      const observations = a.observations;
      return registerRepositoryFacts(root2, a.featureId, a.expectedRevision, observations.map((observation) => ({ observation })), a.host);
    }
    case "dev_flow_revise_decision": {
      const result = await reviseDecision(root2, a.featureId, a.expectedRevision, a.decisionId, a.newConclusion, a.reason, a.host);
      return elicitAndAnswer(pipelinePorts, result, {
        root: root2,
        featureId: a.featureId,
        host: a.host,
        decision: "decision-revision",
        question: result.interaction.question ?? "\u8BF7\u786E\u8BA4\u662F\u5426\u4FEE\u8BA2\u8BE5\u51B3\u5B9A\u3002"
      });
    }
    case "dev_flow_revise_plan": {
      const result = await revisePlanDuringImplementation(root2, a.featureId, a.expectedRevision, a.traceDelta, a.host);
      return elicitAndAnswer(pipelinePorts, result, {
        root: root2,
        featureId: a.featureId,
        host: a.host,
        decision: "plan-revision",
        question: result.interaction.question ?? "\u8BF7\u786E\u8BA4\u662F\u5426\u4FEE\u8BA2\u5B9E\u65BD\u8BA1\u5212\u3002"
      });
    }
    case "dev_flow_lock_classification": {
      const classification2 = normalizeLockClassification(a.classification);
      const { level, topology, requirements, riskLabels, acceptanceAssistSuggested, scopeFactRefs, topologyFactRefs, uncertaintyFactRefs, riskFactRefs, decisionRefs, controlEnhancements } = classification2;
      const state = await lockClassification(root2, a.featureId, a.expectedRevision, {
        level,
        topology,
        ...requirements ? { requirements } : {},
        ...riskLabels ? { riskLabels } : {},
        ...acceptanceAssistSuggested !== void 0 ? { acceptanceAssistSuggested } : {},
        scopeFactRefs,
        topologyFactRefs,
        uncertaintyFactRefs,
        riskFactRefs,
        decisionRefs,
        ...controlEnhancements ? { controlEnhancements } : {},
        classificationBasis: classification2.classificationBasis,
        signals: classification2.classificationBasis?.signals
      }, a.boundaryAudit);
      const decision = pendingDecisionForState(state);
      const interaction = decision ? pendingInteractionForDecision(state, decision) : void 0;
      if (decision?.kind !== "route-confirmation" || !interaction) return state;
      return elicitAndAnswer(pipelinePorts, { state, interaction: toPublicInteraction(interaction), interactionId: interaction.id }, {
        root: root2,
        featureId: a.featureId,
        host: state.lastUpdatedBy.host,
        decision: "route-confirmation",
        question: interaction.question ?? decision.question
      });
    }
    case "dev_flow_status":
      return readCompactStatus(root2, a.featureId);
    case "dev_flow_inspect":
      return inspectFeature(root2, a.featureId, a.topic);
    case "dev_flow_scaffold_artifact":
      return scaffoldArtifact(root2, a.featureId, a.expectedRevision, a.kind);
    case "dev_flow_record_artifact":
      return recordArtifact(root2, a.featureId, a.expectedRevision, a.kind);
    case "dev_flow_record_artifact_with_trace": {
      const input = traceRegistrationInput(a);
      validateTraceDelta(input.traceDelta);
      return recordArtifactWithTrace(root2, input.featureId, input.expectedRevision, input.kind, input.traceDelta);
    }
    case "dev_flow_validate_plan": {
      const input = traceRegistrationInput(a);
      validateTraceDelta(input.traceDelta);
      return validatePlan(root2, input.featureId, input.kind, input.traceDelta);
    }
    case "dev_flow_get_traceability": {
      const input = traceReadInput(a);
      const state = await readState(root2, input.featureId);
      const inspection = await inspectCurrentTrace(root2, state);
      return {
        pointer: state.traceability,
        ...inspection.ledger ? { ledger: inspection.ledger } : {},
        ...inspection.effectiveSummary ? { effectiveSummary: inspection.effectiveSummary } : {},
        blockers: inspection.blocker ? [inspection.blocker] : []
      };
    }
    case "dev_flow_rebuild_review_projection":
      return rebuildReviewProjection(root2, a.featureId, a.expectedRevision);
    case "dev_flow_create_review_batch": {
      const input = reviewMutationInput(a);
      return createReviewBatch(root2, input.featureId, input.expectedRevision);
    }
    case "dev_flow_get_review_job": {
      const input = reviewGetInput(a);
      return getReviewJob(root2, input.featureId, input.batchId, input.jobId, input.capability);
    }
    case "dev_flow_claim_review_job": {
      const input = reviewMutationInput(a);
      return claimReviewJob(root2, input.featureId, input.expectedRevision, input.batchId, input.jobId, input.claimRequestId);
    }
    case "dev_flow_release_review_job": {
      const input = reviewMutationInput(a);
      return releaseReviewJob(root2, input.featureId, input.expectedRevision, input.batchId, input.jobId, input.capability);
    }
    case "dev_flow_submit_review_job": {
      const input = reviewSubmitInput(a);
      try {
        parseReviewJobCompletion(input.completion);
      } catch (error) {
        throw new DevFlowError("INVALID_TOOL_INPUT", "dev_flow_submit_review_job input does not match its schema", {
          mutationApplied: false,
          ...error instanceof Error ? { cause: error.message } : {}
        });
      }
      if (input.attestation !== void 0) {
        try {
          parseHostAttestation(input.attestation);
        } catch (error) {
          throw new DevFlowError("INVALID_TOOL_INPUT", "dev_flow_submit_review_job attestation does not match its schema", {
            mutationApplied: false,
            ...error instanceof Error ? { cause: error.message } : {}
          });
        }
      }
      const result = await submitReviewJob(
        root2,
        input.featureId,
        input.expectedRevision,
        input.batchId,
        input.jobId,
        input.capability,
        input.completion,
        input.attestation
      );
      return reviewSubmissionEnvelope(result, input.jobId);
    }
    case "dev_flow_sample_review_job": {
      const input = reviewSamplingInput(a);
      ports2.assertSamplingSupported();
      const started = await beginReviewSampling(root2, input.featureId, input.expectedRevision, input.batchId, input.jobId);
      try {
        const completion = await ports2.sampleReview({
          role: started.job.role,
          reviewDepth: started.job.reviewDepth,
          package: started.package
        });
        const completed = await completeReviewSampling(
          root2,
          input.featureId,
          started.state.revision,
          input.batchId,
          input.jobId,
          started.requestId,
          completion
        );
        return reviewSubmissionEnvelope({ ...completed, idempotent: false }, input.jobId);
      } catch (error) {
        try {
          await failReviewSampling(
            root2,
            input.featureId,
            started.state.revision,
            input.batchId,
            input.jobId,
            started.requestId,
            samplingFailureCode(error)
          );
        } catch {
        }
        const code = error instanceof DevFlowError ? error.code : "REVIEW_SAMPLING_FAILED";
        throw new DevFlowError("REVIEW_SAMPLING_FAILED", "sampling review did not produce an accepted completion", {
          batchId: input.batchId,
          jobId: input.jobId,
          causeCode: code
        });
      }
    }
    case "dev_flow_record_decision": {
      const result = await recordDecision(root2, a.featureId, a.expectedRevision, a.question, a.evidence, a.conclusion, a.factRefs ?? [], a.host);
      if (!result.interaction || !result.interactionId) {
        return {
          state: result.state,
          decisionId: result.decisionId,
          ratifiedFrom: result.ratifiedFrom,
          question: result.question,
          evidence: result.evidence,
          conclusion: result.conclusion
        };
      }
      return elicitAndAnswer(pipelinePorts, { state: result.state, interaction: result.interaction, interactionId: result.interactionId }, {
        root: root2,
        featureId: a.featureId,
        host: a.host,
        decision: "decision-ratification",
        question: result.interaction.question ?? "\u8BF7\u786E\u8BA4\u662F\u5426\u767B\u8BB0\u8BE5\u51B3\u5B9A\u3002",
        extra: { decisionId: result.decisionId }
      });
    }
    case "dev_flow_present_review_risk_acceptance": {
      const input = reviewMutationInput(a);
      if (!Array.isArray(input.findingIds) || !input.findingIds.length || input.findingIds.some((findingId) => typeof findingId !== "string" || !findingId)) {
        throw new DevFlowError("INVALID_TOOL_INPUT", "dev_flow_present_review_risk_acceptance input does not match its schema");
      }
      const result = await presentReviewRiskAcceptance(root2, input.featureId, input.expectedRevision, input.findingIds);
      return elicitAndAnswer(pipelinePorts, result, {
        root: root2,
        featureId: input.featureId,
        host: input.host,
        decision: "review-risk",
        question: result.interaction.question ?? "\u8BF7\u51B3\u5B9A\u662F\u5426\u63A5\u53D7\u5F53\u524D\u963B\u65AD\u6027\u53D1\u73B0\u7684\u98CE\u9669\u3002",
        pendingOutcome: result.idempotent ? "pending" : "presented"
      });
    }
    case "dev_flow_record_step": {
      if (a.step === "implementation" && a.evidence && typeof a.evidence === "object" && Object.hasOwn(a.evidence, "files")) {
        throw new DevFlowError("INVALID_TOOL_INPUT", "implementation evidence.files was removed in Dev Flow 5.0", {
          issues: [{ path: "$.evidence.files", message: "Core derives implementation files from trusted writes and ownership" }],
          recoveryHint: "\u5220\u9664 evidence.files\uFF0C\u5148\u7528 implementation inspect \u67E5\u770B\u6D3E\u751F\u6587\u4EF6\uFF0C\u518D\u91CD\u8BD5 record_step"
        });
      }
      return recordStep(root2, a.featureId, a.expectedRevision, a.step, a.evidence);
    }
    case "dev_flow_pause":
      return pauseFeature(root2, a.featureId, a.expectedRevision, a.reason, a.host);
    case "dev_flow_resume":
      return resumeFeature(root2, a.featureId, a.host);
    case "dev_flow_reconcile_workspace":
      return reconcileWorkspace(root2, a.featureId, a.expectedRevision, a.host);
    case "dev_flow_begin_implementation_unit": {
      const input = unitMutationInput(a);
      return beginImplementationUnit(root2, input.featureId, input.expectedRevision, input.unitId);
    }
    case "dev_flow_checkpoint_implementation_unit": {
      const input = unitMutationInput(a);
      return checkpointImplementationUnit(root2, input.featureId, input.expectedRevision, input.unitId);
    }
    case "dev_flow_abandon_implementation_unit": {
      const input = unitMutationInput(a);
      if (typeof input.reason !== "string" || !input.reason.trim() || input.host !== "claude" && input.host !== "codex") {
        throw new DevFlowError("INVALID_TOOL_INPUT", "dev_flow_abandon_implementation_unit input does not match its schema");
      }
      return abandonImplementationUnit(root2, input.featureId, input.expectedRevision, input.unitId, input.reason, input.host);
    }
    case "dev_flow_preview_rollback": {
      const input = previewRollbackInput(a);
      return previewRollback(root2, input.featureId, input.targetCheckpointId);
    }
    case "dev_flow_present_rollback_gate": {
      const input = rollbackMutationInput(a);
      const presentation = await presentRollbackGate(root2, input.featureId, input.expectedRevision, input.targetCheckpointId);
      return elicitAndAnswer(pipelinePorts, presentation, {
        root: root2,
        featureId: input.featureId,
        host: input.host,
        decision: "rollback-confirmation",
        question: rollbackGateMessage(presentation.preview),
        extra: { preview: presentation.preview }
      });
    }
    case "dev_flow_execute_rollback": {
      const input = rollbackMutationInput(a);
      const result = await executeRollback(root2, input.featureId, input.expectedRevision, input.targetCheckpointId);
      return { outcome: result.outcome, state: result.state, transactionId: result.transaction.transactionId };
    }
    case "dev_flow_present_approval": {
      const presentation = await presentApproval(root2, a.featureId, a.expectedRevision);
      return elicitAndAnswer(pipelinePorts, presentation, {
        root: root2,
        featureId: a.featureId,
        host: a.host,
        decision: "approval",
        approvalId: presentation.approvalId,
        question: "\u8BF7\u786E\u8BA4\u5F53\u524D\u6267\u884C\u6458\u8981\uFF0C\u6216\u63D0\u51FA\u9700\u8981\u4FEE\u6539\u7684\u610F\u89C1\u3002"
      });
    }
    case "dev_flow_record_acceptance_evidence": {
      return recordAcceptanceEvidence(root2, a.featureId, a.expectedRevision, {
        acceptanceCriterionId: a.acceptanceCriterionId,
        evidence: a.evidence,
        host: a.host
      });
    }
    case "dev_flow_present_acceptance_confirmation": {
      const presentation = await presentAcceptanceConfirmation(root2, a.featureId, a.expectedRevision, a.acceptanceCriterionIds);
      return elicitAndAnswer(pipelinePorts, presentation, {
        root: root2,
        featureId: a.featureId,
        host: a.host,
        decision: "acceptance-confirmation",
        question: presentation.interaction.question ?? "\u8BF7\u786E\u8BA4\u5F53\u524D\u9A8C\u6536\u7ED3\u679C\u3002"
      });
    }
    case "dev_flow_answer": {
      await assertHostHealth(root2, a.host, "\u56DE\u7B54\u5F53\u524D\u95EE\u9898");
      const prior = await readState(root2, a.featureId);
      const priorDecision = pendingDecisionForState(prior);
      const priorInteraction = priorDecision ? pendingInteractionForDecision(prior, priorDecision) : void 0;
      const result = await answer({
        root: root2,
        featureId: a.featureId,
        expectedRevision: a.expectedRevision,
        host: a.host,
        credential: { source: "text", userReply: a.userReply }
      });
      const interaction = priorInteraction ? getInteraction(result.state, priorInteraction.id) : void 0;
      const publicInteraction = interaction ? toPublicInteraction(interaction) : void 0;
      const response = interaction?.response;
      const pending = result.pending;
      const message = answerOutcomeMessage(result.action, priorDecision?.kind);
      return {
        ...publicInteraction ? interactionEnvelope(result.state, publicInteraction, response?.action ?? result.action, response) : { state: result.state },
        action: result.action,
        ...result.comment ? { comment: result.comment } : {},
        ...message ? { message } : {},
        ...pending ? { attention: "\u8BF7\u53EA\u56DE\u7B54\u5F53\u524D\u8FD9\u4E00\u9053\u95EE\u9898\u3002", \u9700\u8981\u7528\u6237\u51B3\u5B9A: true, pending } : { \u9700\u8981\u7528\u6237\u51B3\u5B9A: false }
      };
    }
    case "dev_flow_present_quality_exception": {
      const result = await presentQualityException(root2, a.featureId, a.expectedRevision, {
        kind: a.kind,
        basisHash: a.basisHash,
        fingerprint: a.fingerprint,
        riskSummary: a.riskSummary
      });
      return elicitAndAnswer(pipelinePorts, result, {
        root: root2,
        featureId: a.featureId,
        host: a.host,
        decision: "quality-exception",
        question: result.interaction.question ?? "\u8BF7\u51B3\u5B9A\u662F\u5426\u63A5\u53D7\u5F53\u524D\u98CE\u9669\u3002"
      });
    }
    case "dev_flow_request_grill_decision": {
      const result = await requestGrillDecision(root2, a.featureId, a.expectedRevision, {
        questionId: a.questionId,
        question: a.question,
        options: a.options,
        recommendation: a.recommendation,
        host: a.host
      });
      return elicitAndAnswer(pipelinePorts, result, {
        root: root2,
        featureId: a.featureId,
        host: a.host,
        decision: "grill",
        question: result.interaction.presentation ?? result.interaction.question ?? "\u8BF7\u9009\u62E9\u4E00\u4E2A\u65B9\u6848\u3002"
      });
    }
    case "dev_flow_reclassify":
      return reclassifyFeature(root2, a.featureId, a.expectedRevision, a.classification, a.reason, a.userEvidence);
    case "dev_flow_verify":
      return runVerification(
        root2,
        a.featureId,
        a.expectedRevision,
        a.host,
        a.commandIds
      );
    case "dev_flow_repair_feature":
      return repairFeature(root2, a.featureId, a.expectedRevision, a.host);
    case "dev_flow_finalize": {
      const state = await finalize(root2, a.featureId, a.expectedRevision);
      ports2.notify({ kind: "workflow-finalized", featureId: a.featureId });
      return state;
    }
    case "dev_flow_abandon":
      return abandonFeature(root2, a.featureId, a.expectedRevision, a.reason, a.userEvidence);
    case "dev_flow_enable_windows_notifications":
      return enableWindowsNotifications({ nodeExecutable: process.execPath });
    case "dev_flow_doctor":
      return collectDoctorReport(root2, pluginRootForDoctor(root2), "5.1.0", publicTools);
    case "dev_flow_recover_corrupt_feature":
      return recoverCorruptFeature(root2, {
        featureId: a.featureId,
        stateSha256: a.stateSha256,
        activeSha256: a.activeSha256,
        action: a.action,
        reason: a.reason,
        userEvidence: a.userEvidence,
        host: a.host
      });
    default: {
      const _exhaustive = tool;
      throw new DevFlowError("UNKNOWN_TOOL", name);
    }
  }
}

// plugins/dev-flow/src/mcp/server.ts
var root = process.cwd();
function protocolResult(id, value) {
  process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", id, result: value })}
`);
}
function toolResult(id, value) {
  const view = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  const contentValue = view.contentView === void 0 ? value : view.contentView;
  const structuredValue = view.structuredContentView === void 0 ? value : view.structuredContentView;
  process.stdout.write(`${JSON.stringify({
    jsonrpc: "2.0",
    id,
    result: {
      content: [{ type: "text", text: JSON.stringify(contentValue) }],
      structuredContent: structuredValue
    }
  })}
`);
}
var readOnlyResponseTools = /* @__PURE__ */ new Set([
  "dev_flow_init_project",
  "dev_flow_classify",
  "dev_flow_status",
  "dev_flow_inspect",
  "dev_flow_get_traceability",
  "dev_flow_get_review_job",
  "dev_flow_preview_rollback",
  "dev_flow_enable_windows_notifications",
  "dev_flow_doctor"
]);
function isFeatureState(value) {
  const schemaVersion = value?.schemaVersion;
  return Boolean(value && typeof value === "object" && !Array.isArray(value) && (schemaVersion === 4 || schemaVersion === 5) && typeof value.featureId === "string" && typeof value.revision === "number" && typeof value.mode === "string");
}
function compactMutationResult(toolName, value) {
  if (readOnlyResponseTools.has(toolName)) return value;
  const mutationContent = (summary2, interaction) => ({
    \u72B6\u6001: lifecycleLabel(summary2.lifecycle),
    ...summary2.route ? { \u8DEF\u7EBF: routeLabel(summary2.route) } : {},
    \u5F53\u524D\u9636\u6BB5: stageLabel(summary2.stage),
    \u4E0B\u4E00\u6B65: summary2.logicComplete ? "\u5F53\u524D\u4EFB\u52A1\u5DF2\u5B8C\u6210\u3002" : "\u6309\u5F53\u524D\u72B6\u6001\u7EE7\u7EED\u4E0B\u4E00\u6B65\u3002",
    \u9700\u8981\u7528\u6237\u51B3\u5B9A: summary2.counters.openInteractions > 0,
    \u5065\u5EB7\u72B6\u6001: summary2.counters.blockingFindings > 0 ? "\u9700\u8981\u5904\u7406" : "\u6B63\u5E38",
    ...interaction?.status === "pending" ? {
      \u9700\u8981\u7528\u6237\u51B3\u5B9A: true,
      \u5F53\u524D\u95EE\u9898: interaction.question ?? "\u8BF7\u56DE\u7B54\u5F53\u524D\u95EE\u9898\u3002",
      \u4EA4\u4E92\u63D0\u793A: interaction.presentation ?? interaction.question ?? "\u8BF7\u56DE\u7B54\u5F53\u524D\u95EE\u9898\u3002",
      \u9009\u9879: interaction.options.map((option) => `${option.answerCode ? `${option.answerCode}. ` : ""}${option.label}${option.recommended ? "\uFF08\u63A8\u8350\uFF09" : ""}`)
    } : {}
  });
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  const record = isFeatureState(value) ? { state: value } : value;
  const state = record.state;
  if (!isFeatureState(state)) return value;
  const summary = buildFeatureMutationSummary(state);
  const content = mutationContent(summary, record.interaction);
  const highlighted = record.ratifiedFrom ? { \u51B3\u7B56ID: record.decisionId, \u767B\u8BB0\u65B9\u5F0F: "\u5DF2\u4F9D\u636E\u4F60\u6700\u8FD1\u7684\u56DE\u7B54\u81EA\u52A8\u767B\u8BB0", \u95EE\u9898: record.question, \u539F\u8BDD: record.evidence, \u7ED3\u8BBA: record.conclusion, ...content } : record.recordIds ? { \u4E8B\u5B9EID: record.recordIds, \u65B0\u5EFA: record.created, \u5DF2\u5B58\u5728: record.existing, ...content } : record.recordId ? { \u4E8B\u5B9EID: record.recordId, ...content } : record.decisionId ? { \u51B3\u7B56ID: record.decisionId, ...content } : content;
  const control = { featureId: summary.featureId, expectedRevision: summary.revision, stage: summary.stage, lifecycle: summary.lifecycle };
  const structuredContentView = isFeatureState(value) ? { ...summary, state: summary, control } : { ...record, ...summary, state: summary, control };
  return { contentView: highlighted, structuredContentView };
}
function failure(id, error) {
  const value = failureFrom(error);
  const content = JSON.stringify({
    \u72B6\u6001: "\u672A\u5B8C\u6210",
    \u9519\u8BEF\u7801: value.code,
    \u539F\u56E0: value.cause,
    \u63D0\u793A: value.userMessage,
    \u5F71\u54CD: value.impact,
    \u6062\u590D\u52A8\u4F5C: value.recovery.instruction,
    ...value.technical && Object.keys(value.technical).length ? { \u5B89\u5168\u7EC6\u8282: value.technical } : {}
  });
  process.stdout.write(`${JSON.stringify({
    jsonrpc: "2.0",
    id,
    result: {
      isError: true,
      content: [{ type: "text", text: content }],
      structuredContent: value
    }
  })}
`);
}
function protocolFailure(id, error) {
  const value = failureFrom(error);
  process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", id, error: { code: -32e3, message: value.userMessage, data: value } })}
`);
}
function emitAttentionNotification(event) {
  void emitAttention(event, {
    emit: (message) => process.stdout.write(`${JSON.stringify(message)}
`)
  });
}
var connection = new McpConnection();
var ports = {
  elicit: (interaction, question) => connection.elicit(interaction, question),
  sampleReview: (job) => connection.sampleReview(job),
  assertSamplingSupported: () => connection.assertSamplingSupported(),
  notify: emitAttentionNotification
};
var inFlight = /* @__PURE__ */ new Set();
async function dispatchRequest(message) {
  try {
    if (!Object.hasOwn(message, "id") || message.id === void 0 || message.id === null) return;
    if (message.method === "initialize") {
      connection.configure(message.params?.capabilities, message.params?.clientInfo);
      protocolResult(message.id, {
        protocolVersion: message.params?.protocolVersion || "2024-11-05",
        serverInfo: { name: "dev-flow", version: "5.1.0" },
        capabilities: { tools: {} },
        instructions: "\u5148\u5B8C\u6210\u4E8B\u5B9E\u8C03\u67E5\u548C\u8DEF\u7EBF\u5206\u7C7B\u3002\u65E5\u5E38\u8BFB\u53D6 dev_flow_status\uFF1B\u5B83\u4F1A\u663E\u793A\u4E2D\u6587\u9636\u6BB5\u3001\u5F53\u524D\u4E0B\u4E00\u6B65\u548C\u552F\u4E00\u5F85\u51B3\u95EE\u9898\u3002\u6240\u6709\u7528\u6237\u51B3\u5B9A\u7EDF\u4E00\u4F7F\u7528 dev_flow_answer\uFF0C\u7CFB\u7EDF\u4F1A\u81EA\u52A8\u6309\u95EE\u9898\u7C7B\u578B\u5904\u7406\u3002\u6CA1\u6709\u771F\u5B9E\u51B3\u7B56\u7F3A\u53E3\u65F6\u6D41\u7A0B\u4F1A\u81EA\u52A8\u63A8\u8FDB\u3002\u5148\u8C03\u7528 dev_flow_init_project\uFF0C\u518D\u5F00\u59CB feature\u3002"
      });
      return;
    }
    if (message.method === "tools/list") {
      protocolResult(message.id, {
        tools: publicTools.map((name) => {
          const { expose, ...schema } = toolSchemas[name];
          return { name, ...schema };
        })
      });
      return;
    }
    if (message.method === "tools/call") {
      const name = message.params?.name;
      const arguments_ = message.params?.arguments ?? {};
      toolResult(message.id, compactMutationResult(name, await dispatch(root, name, arguments_, ports)));
      return;
    }
    if (message.method === "ping") {
      protocolResult(message.id, {});
      return;
    }
    protocolFailure(message.id, new DevFlowError("UNKNOWN_METHOD", String(message.method ?? "missing method")));
  } catch (error) {
    if (message?.id !== void 0 && message?.id !== null) failure(message.id, error);
  }
}
var requestTail = Promise.resolve();
for await (const line of readline.createInterface({ input: process.stdin, crlfDelay: Infinity })) {
  let message;
  try {
    message = JSON.parse(line);
  } catch {
    continue;
  }
  if (connection.consumeResponse(message)) continue;
  const task = requestTail.then(() => dispatchRequest(message)).finally(() => inFlight.delete(task));
  requestTail = task;
  inFlight.add(task);
}
connection.close();
await Promise.allSettled(inFlight);
