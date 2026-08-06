/* dev-flow 4.1.0; built from source, deterministic build */

// plugins/dev-flow/src/mcp/server.ts
import readline from "node:readline";
import { fileURLToPath } from "node:url";
import path17 from "node:path";

// plugins/dev-flow/src/core/artifacts.ts
import { createHash as createHash10 } from "node:crypto";
import { readFile as readFile7, writeFile as writeFile2 } from "node:fs/promises";
import path9 from "node:path";

// plugins/dev-flow/policy/contract.json
var contract_default = {
  schemaVersion: 3,
  routes: {
    xs: {
      orderedSteps: ["locate", "implementation", "verification", "finalize"],
      stages: ["locate", "implementation", "verification", "finalize"],
      requiredArtifacts: [],
      featureCheckRequired: false
    },
    s: {
      orderedSteps: ["boundary", "implementation", "verification", "finalize"],
      stages: ["boundary", "implementation", "verification", "finalize"],
      requiredArtifacts: [],
      featureCheckRequired: false
    },
    "light-m": {
      orderedSteps: ["planning", "implementation", "code_review", "verification", "finalize"],
      stages: ["planning", "implementation", "code_review", "verification", "finalize"],
      requiredArtifacts: [],
      featureCheckRequired: false
    },
    "standard-m": {
      orderedSteps: ["requirements_alignment", "planning", "implementation", "code_review", "verification", "finalize"],
      stages: ["requirements_alignment", "planning", "implementation", "code_review", "verification", "finalize"],
      requiredArtifacts: ["requirements", "implementation-plan"],
      artifactSteps: { requirements_alignment: ["requirements"], planning: ["implementation-plan"] },
      artifactTransitions: [{ artifact: "plan-review", capability: "review", from: "absent", to: "generated", steps: ["planning"] }],
      featureCheckRequired: false
    },
    "light-l": {
      orderedSteps: ["planning", "implementation", "code_review", "verification", "finalize"],
      stages: ["planning", "implementation", "code_review", "verification", "finalize"],
      requiredArtifacts: ["implementation-plan"],
      artifactSteps: { planning: ["implementation-plan"] },
      featureCheckRequired: false
    },
    "standard-l": {
      orderedSteps: ["requirements_alignment", "planning", "implementation", "code_review", "verification", "finalize"],
      stages: ["requirements_alignment", "planning", "implementation", "code_review", "verification", "finalize"],
      requiredArtifacts: ["requirements", "implementation-plan"],
      artifactSteps: { requirements_alignment: ["requirements"], planning: ["implementation-plan"] },
      artifactTransitions: [{ artifact: "plan-review", capability: "review", from: "absent", to: "generated", steps: ["planning"] }],
      featureCheckRequired: false
    }
  },
  riskEnhancements: {
    security: { checks: ["security-boundary"], verification: "behavior" },
    data: { checks: ["data-integrity", "rollback"], verification: "integration" },
    money: { checks: ["idempotency", "reconciliation", "rollback"], verification: "integration" },
    external: { checks: ["contract-failure"], verification: "integration" },
    availability: { checks: ["degradation-recovery"], verification: "integration" },
    critical_correctness: { checks: ["full-code-review"], verification: "full" },
    irreversible_consequence: { checks: ["full-rollback", "full-code-review"], verification: "full" }
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
if (contract.schemaVersion !== 3) {
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
function ensureGeneratedArtifact(definition, artifact) {
  if (!definition.generatedArtifacts) definition.generatedArtifacts = [];
  if (!definition.generatedArtifacts.includes(artifact)) definition.generatedArtifacts.push(artifact);
}
function moveArtifactSteps(definition, artifact, steps) {
  if (!definition.generatedArtifactSteps) definition.generatedArtifactSteps = {};
  const sourceSteps = steps ?? Object.entries(definition.artifactSteps ?? {}).filter(([, artifacts2]) => artifacts2.includes(artifact)).map(([step]) => step);
  for (const step of sourceSteps) {
    const source = definition.artifactSteps?.[step] ?? [];
    if (source.includes(artifact)) {
      const remaining = source.filter((kind) => kind !== artifact);
      if (remaining.length === 0) delete definition.artifactSteps?.[step];
      else if (definition.artifactSteps) definition.artifactSteps[step] = remaining;
    }
    const generated = definition.generatedArtifactSteps[step] ?? [];
    if (!generated.includes(artifact)) definition.generatedArtifactSteps[step] = [...generated, artifact];
  }
}
function moveArtifactToGenerated(definition, artifact, steps) {
  definition.requiredArtifacts = definition.requiredArtifacts.filter((kind) => kind !== artifact);
  ensureGeneratedArtifact(definition, artifact);
  moveArtifactSteps(definition, artifact, steps);
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
function routeDefinitionForFeature(route, capabilities) {
  const definition = cloneRouteDefinition(routeDefinition(route));
  const normalized = normalizeWorkflowCapabilities(capabilities);
  for (const transition of definition.artifactTransitions ?? []) {
    if (normalized[transition.capability] === 1) {
      moveArtifactToGenerated(definition, transition.artifact, transition.steps);
    }
  }
  validateArtifactModes(definition);
  return definition;
}
function traceEnforcementRequired(route, capabilities) {
  return normalizeWorkflowCapabilities(capabilities).trace === 1 && (route === "standard-m" || route === "standard-l");
}
function reviewEnforcementRequired(route, capabilities) {
  return normalizeWorkflowCapabilities(capabilities).review === 1 && (route === "standard-m" || route === "standard-l");
}
function checkpointsEnforcementRequired(route, capabilities) {
  return normalizeWorkflowCapabilities(capabilities).checkpoints === 1 && traceEnforcementRequired(route, capabilities);
}
function rollbackExecutionAllowed(route, capabilities) {
  return normalizeWorkflowCapabilities(capabilities).rollbackExecution === 1 && checkpointsEnforcementRequired(route, capabilities);
}

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
  const rollback = ["standard-m", "standard-l"].includes(context.route) ? "\n<!-- dev-flow:id=RU-001 kind=rollback -->\n### RU-001\uFF1A\u56DE\u64A4\u5355\u5143\n\n- tasks: [TASK-001]\n- depends_on: []\n- file_scope: []\n- covers: [REQ-001]\n- forward_verification: [unit]\n- rollback_verification: [unit]\n" : "";
  const test = ["standard-m", "standard-l"].includes(context.route) ? "\n<!-- dev-flow:id=TEST-001 kind=test -->\n### TEST-001\uFF1A\u9A8C\u8BC1\u573A\u666F\uFF08verifies: AC-001\uFF09\n\n- \u9A8C\u8BC1\u65B9\u6CD5\uFF1A\n" : "";
  return `${frontMatter(context, "implementation-plan")}# \u5B9E\u73B0\u8BA1\u5212

<!-- dev-flow:id=TASK-001 kind=task -->
### TASK-001\uFF1A\u5B9E\u73B0\u4EFB\u52A1

- covers: [REQ-001]
- rollback_unit: RU-001
${test}${rollback}`;
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
var DevFlowError = class extends Error {
  constructor(code, message, details = {}) {
    super(`${code}: ${message}`);
    this.code = code;
    this.details = details;
    this.name = "DevFlowError";
    this.userMessage = typeof details.userMessage === "string" ? details.userMessage : "\u5F53\u524D\u52A8\u4F5C\u672A\u5B8C\u6210\u3002";
    this.cause = typeof details.cause === "string" ? details.cause : "\u5F53\u524D\u6D41\u7A0B\u6761\u4EF6\u5C1A\u672A\u6EE1\u8DB3\u3002";
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
    const technical = { ...this.details };
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
function failureFrom(error) {
  if (error instanceof DevFlowError) return error.toFailure();
  const cause = error instanceof Error ? error.message : String(error);
  return {
    code: "INTERNAL_ERROR",
    userMessage: "\u7CFB\u7EDF\u52A8\u4F5C\u672A\u5B8C\u6210\u3002",
    cause,
    impact: "\u6D41\u7A0B\u4FDD\u6301\u5728\u5F53\u524D\u9636\u6BB5\uFF0C\u672A\u786E\u8BA4\u7684\u52A8\u4F5C\u4E0D\u4F1A\u88AB\u89C6\u4E3A\u6210\u529F\u3002",
    recovery: { kind: "repair", instruction: "\u8FD0\u884C doctor \u5BFC\u51FA\u8BCA\u65AD\u5E76\u505C\u6B62\u7EE7\u7EED\u5199\u5165\u3002", requiresUserDecision: false, retryOriginal: false },
    technical: {}
  };
}

// plugins/dev-flow/src/core/approval-basis.ts
var approvalBasisArtifacts = [
  "requirements",
  "implementation-plan"
];
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
    artifacts: Object.fromEntries(
      approvalBasisArtifacts.map((kind) => [kind, state.artifacts[kind]])
    )
  };
  if (traceEnforcementRequired(state.route, state.workflowCapabilities)) {
    basis.traceability = state.traceability;
  }
  if (reviewEnforcementRequired(state.route, state.workflowCapabilities)) {
    basis.review = state.review;
  }
  basis.verification = {
    riskLabels: state.classification.riskLabels,
    obligations: state.obligations
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
import { randomUUID as randomUUID4, createHash as createHash8 } from "node:crypto";
import { access, mkdir as mkdir4, open as open4, readdir as readdir4, readFile as readFile6, rename as rename4, rm, rmdir, writeFile } from "node:fs/promises";
import { hostname } from "node:os";
import path8 from "node:path";

// plugins/dev-flow/src/policy/obligations.ts
import { createHash } from "node:crypto";
function stable(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stable(value[key])}`).join(",")}}`;
}
function decisionBasisHash(decision) {
  return createHash("sha256").update(stable(decision)).digest("hex");
}
var riskRules = {
  security: { kinds: ["review", "verification", "approval"], verification: ["behavior"], roles: ["security"] },
  data: { kinds: ["review", "verification"], verification: ["behavior", "integration"], roles: ["data-integrity"] },
  money: { kinds: ["review", "verification", "approval"], verification: ["behavior", "integration"], roles: ["money-safety"] },
  external: { kinds: ["review", "verification"], verification: ["integration"], roles: ["contract-failure"] },
  availability: { kinds: ["review", "verification"], verification: ["integration"], roles: ["recovery-observability"] },
  critical_correctness: { kinds: ["review", "verification", "approval"], verification: ["full"], roles: ["critical-correctness"] },
  irreversible_consequence: { kinds: ["review", "verification", "rollback", "approval", "checkpoint"], verification: ["full"], roles: ["irreversibility"] }
};
function add(output, kind, source, reason, basis, roles = [], verificationKinds = []) {
  const basisHash2 = decisionBasisHash({ kind, source, reason, basis });
  const id = `${kind}:${basisHash2.slice(0, 16)}`;
  if (output.has(id)) return;
  output.set(id, { id, kind, source, basisHash: basisHash2, status: "pending", reason, ...roles.length ? { roles: [...new Set(roles)].sort() } : {}, ...verificationKinds.length ? { verificationKinds: [...new Set(verificationKinds)].sort() } : {} });
}
function deriveObligations(route, classificationBasis, projectPolicy = {}) {
  const output = /* @__PURE__ */ new Map();
  const labels = Object.keys(classificationBasis.riskFacts);
  if (route === "standard-m" || route === "light-l" || route === "standard-l") {
    add(output, "approval", "route", "\u8BE5\u8DEF\u7EBF\u9700\u8981\u4E00\u6B21\u5408\u5E76\u7684\u6267\u884C\u786E\u8BA4", { route }, ["execution"]);
  }
  if (route === "standard-m" || route === "standard-l") {
    add(output, "review", "route", "\u8BE5\u8DEF\u7EBF\u9700\u8981\u72EC\u7ACB\u8BA1\u5212\u5BA1\u67E5", { route }, ["requirements-coverage", "architecture-testability", "rollback-operability"]);
  }
  if (route === "light-l" || route === "standard-l") {
    add(output, "rollback", "route", "L \u8DEF\u7EBF\u9700\u8981\u53EF\u64CD\u4F5C\u7684\u56DE\u6EDA\u7B56\u7565", { route }, ["rollback-operability"]);
  }
  if (projectPolicy.requireCheckpoints !== false) {
    add(output, "checkpoint", "route", "\u5B9E\u73B0\u8FB9\u754C\u81EA\u52A8\u4FDD\u5B58\u53EF\u6062\u590D\u68C0\u67E5\u70B9", { route }, ["checkpoint"]);
  }
  for (const label of labels) {
    const rule = riskRules[label];
    if (!rule) continue;
    for (const kind of rule.kinds) {
      add(output, kind, "risk", `\u98CE\u9669\u4E8B\u5B9E\u8981\u6C42 ${kind} \u4E49\u52A1`, { label, facts: classificationBasis.riskFacts[label] }, rule.roles, rule.verification);
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

// plugins/dev-flow/src/policy/validation.ts
var PolicyError = class extends Error {
  constructor(code, message, details = {}) {
    super(`${code}: ${message}`);
    this.code = code;
    this.details = details;
  }
};
var levels = ["XS", "S", "M", "L"];
var topologies = ["local", "shared-contract", "multi-chain", "coordinated-rollback"];
function normalizeClassification(input) {
  if (!input.level || !levels.includes(input.level)) throw new PolicyError("INVALID_LEVEL", "level is invalid");
  if (!input.topology || !topologies.includes(input.topology)) throw new PolicyError("INVALID_TOPOLOGY", "topology is invalid");
  if (input.execution && input.execution !== "light" && input.execution !== "standard") {
    throw new PolicyError("INVALID_EXECUTION", "execution is invalid");
  }
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
  if (input.manualAcceptanceRequired !== void 0 && typeof input.manualAcceptanceRequired !== "boolean") {
    throw new PolicyError("INVALID_MANUAL_ACCEPTANCE_REQUIREMENT", "manualAcceptanceRequired must be boolean");
  }
  if (input.acceptanceAssistSuggested !== void 0 && typeof input.acceptanceAssistSuggested !== "boolean") {
    throw new PolicyError("INVALID_ACCEPTANCE_ASSIST_SUGGESTION", "acceptanceAssistSuggested must be boolean");
  }
  return {
    level: input.level,
    topology: input.topology,
    ...input.execution ? { execution: input.execution } : {},
    ...input.requirements ? { requirements: input.requirements } : {},
    riskLabels,
    // The former hard requirement remains a compatibility input only. Browser/user
    // acceptance is advisory and never changes a route's ability to finalize.
    acceptanceAssistSuggested: input.acceptanceAssistSuggested === true || input.manualAcceptanceRequired === true,
    ...input.classificationBasis ? { classificationBasis: input.classificationBasis } : {}
  };
}

// plugins/dev-flow/src/policy/route.ts
var levelRank = { XS: 0, S: 1, M: 2, L: 3 };
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
function defaultBasis(input) {
  const riskLabels = input.riskLabels ?? [];
  const facts = input.classificationBasis;
  return facts ?? {
    scopeFacts: input.scope ? [...input.scope.inScope, ...input.scope.outOfScope] : [],
    topologyFacts: [input.topology ?? ""].filter(Boolean),
    uncertaintyFacts: input.requirements === "provided-confirmed" ? [] : [input.requirements ?? "requirements-not-confirmed"],
    // Labels without explicit evidence are deliberately rejected below.
    riskFacts: {},
    decisionRefs: []
  };
}
function basisOnly(input) {
  const nestedSignals = input.classificationBasis?.signals;
  return {
    scopeFacts: input.scopeFacts,
    topologyFacts: input.topologyFacts,
    uncertaintyFacts: input.uncertaintyFacts,
    riskFacts: input.riskFacts,
    decisionRefs: input.decisionRefs,
    ...input.signals ?? nestedSignals ? { signals: input.signals ?? nestedSignals } : {}
  };
}
function actualType(value) {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  return typeof value;
}
function validateBasis(basis, riskLabels) {
  for (const key of ["scopeFacts", "topologyFacts", "uncertaintyFacts", "decisionRefs"]) {
    if (!Array.isArray(basis[key]) || basis[key].some((item) => typeof item !== "string" || item.trim().length === 0)) {
      throw new PolicyError("CLASSIFICATION_BASIS_INVALID", `${key} must be a list of non-empty fact strings`, {
        path: `$.classificationBasis.${key}`,
        actualType: actualType(basis[key]),
        invalidValue: basis[key]
      });
    }
  }
  if (!basis.riskFacts || typeof basis.riskFacts !== "object" || Array.isArray(basis.riskFacts)) {
    throw new PolicyError("CLASSIFICATION_BASIS_INVALID", "riskFacts must be an object keyed by risk label", {
      path: "$.classificationBasis.riskFacts",
      actualType: actualType(basis.riskFacts),
      invalidValue: basis.riskFacts
    });
  }
  for (const [label, facts] of Object.entries(basis.riskFacts)) {
    if (!allowedRiskLabels.includes(label)) {
      throw new PolicyError("CLASSIFICATION_BASIS_INVALID", `riskFacts contains an unknown risk label: ${label}`, {
        path: `$.classificationBasis.riskFacts.${label}`,
        actualType: actualType(facts),
        invalidValue: label,
        allowed: allowedRiskLabels
      });
    }
    if (!Array.isArray(facts) || facts.length === 0 || facts.some((fact) => typeof fact !== "string" || fact.trim().length === 0)) {
      throw new PolicyError("CLASSIFICATION_BASIS_INVALID", `riskFacts.${label} must be a non-empty fact list`, {
        path: `$.classificationBasis.riskFacts.${label}`,
        actualType: actualType(facts),
        invalidValue: facts
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
        invalidValue: facts
      });
    }
  }
}
function selectBaseRoute(input) {
  const classification2 = normalizeClassification(input);
  const basis = basisOnly(input);
  validateBasis(basis, classification2.riskLabels);
  assertTopologyLevel(classification2);
  const contradictions = [];
  if (classification2.level === "XS" || classification2.level === "S") {
    if (classification2.execution) contradictions.push("XS/S \u4E0D\u5141\u8BB8\u6307\u5B9A execution");
  } else if (!classification2.execution) {
    contradictions.push("M/L \u5FC5\u987B\u6307\u5B9A execution");
  }
  if (classification2.level === "M" && classification2.execution === "light") return {
    classification: { ...classification2, classificationBasis: basis },
    route: "light-m",
    classificationBasis: basis,
    obligations: deriveObligations("light-m", basis),
    contradictions
  };
  if (classification2.level === "L" && classification2.execution === "light") return {
    classification: { ...classification2, classificationBasis: basis },
    route: "light-l",
    classificationBasis: basis,
    obligations: deriveObligations("light-l", basis),
    contradictions
  };
  const route = classification2.level === "XS" ? "xs" : classification2.level === "S" ? "s" : classification2.level === "M" ? "standard-m" : "standard-l";
  if ((route === "standard-m" || route === "standard-l") && !classification2.requirements) {
    contradictions.push("standard M/L \u9700\u8981 requirements \u72B6\u6001\uFF1B\u53EF\u5728 lock \u524D\u7531\u51B3\u7B56\u53F0\u8D26\u8865\u9F50");
  }
  return {
    classification: { ...classification2, classificationBasis: basis },
    route,
    classificationBasis: basis,
    obligations: deriveObligations(route, basis),
    contradictions
  };
}
var signalRequirements = /* @__PURE__ */ new Set(["missing-or-unclear", "documented-unconfirmed", "provided-confirmed"]);
var formalControlValues = /* @__PURE__ */ new Set(["trace", "independent-review", "multiple-rollback-units"]);
function issue(code, path18, message, recoveryHint) {
  return { code, path: path18, message, recoveryHint };
}
function signalPath(field) {
  return `$.classificationBasis.signals.${field}`;
}
function maxLevel(left, right) {
  return levelRank[left] >= levelRank[right] ? left : right;
}
function levelForImpactScope(scope) {
  return scope === "single-location" ? "XS" : scope === "single-module" ? "S" : "M";
}
function recommendationReasons(signals, topology, level, riskLabels, basis) {
  const reasons = [
    {
      field: "impactScope",
      value: signals.impactScope,
      basisPaths: [signalPath("impactScope")],
      message: `\u5F71\u54CD\u8303\u56F4\u51B3\u5B9A\u57FA\u7840\u7EA7\u522B ${levelForImpactScope(signals.impactScope)}`
    },
    {
      field: "topology",
      value: topology,
      basisPaths: [signalPath("coordinatedRollback"), signalPath("independentChains"), signalPath("sharedContract")],
      message: `\u7ED3\u6784\u5316\u62D3\u6251\u4FE1\u53F7\u5EFA\u8BAE ${topology}`
    },
    {
      field: "level",
      value: level,
      basisPaths: [signalPath("impactScope"), signalPath("coordinatedRollback"), signalPath("independentChains"), signalPath("sharedContract")],
      message: `\u57FA\u7840\u7EA7\u522B\u4E0E\u62D3\u6251\u6700\u4F4E\u7EA7\u522B\u5408\u5E76\u4E3A ${level}`
    }
  ];
  const execution = level === "M" || level === "L" ? signals.requirements !== "provided-confirmed" || signals.formalControls.length > 0 ? "standard" : "light" : void 0;
  if (execution) reasons.push({
    field: "execution",
    value: execution,
    basisPaths: [signalPath("requirements"), signalPath("formalControls")],
    message: `\u9700\u6C42\u786E\u8BA4\u72B6\u6001\u4E0E\u5F62\u5F0F\u5316\u63A7\u5236\u51B3\u5B9A ${execution} \u6267\u884C\u6A21\u5F0F`
  });
  for (const label of riskLabels) reasons.push({
    field: "riskLabels",
    value: label,
    basisPaths: [`$.classificationBasis.riskFacts.${label}`],
    message: `\u98CE\u9669\u4E8B\u5B9E\u589E\u52A0 ${label} \u4E49\u52A1\uFF0C\u4E0D\u63D0\u9AD8\u7EA7\u522B`
  });
  void basis;
  return reasons;
}
function recommendClassification(basis) {
  const issues = [];
  try {
    validateBasis(basis, []);
  } catch (error) {
    if (error instanceof PolicyError) {
      issues.push(issue(error.code, String(error.details.path ?? "$.classificationBasis"), error.message, "\u4FEE\u6B63 classificationBasis \u7684\u7ED3\u6784\u5316\u5B57\u6BB5\u540E\u91CD\u65B0\u63A8\u8350"));
    } else {
      issues.push(issue("CLASSIFICATION_BASIS_INVALID", "$.classificationBasis", "classification basis is invalid", "\u63D0\u4F9B\u5B8C\u6574\u7684\u7ED3\u6784\u5316 classificationBasis"));
    }
  }
  const signals = basis?.signals;
  if (!signals || typeof signals !== "object" || Array.isArray(signals)) {
    issues.push(issue("CLASSIFICATION_SIGNALS_REQUIRED", "$.classificationBasis.signals", "signals is required for recommendation mode", "\u8C03\u67E5\u4ED3\u5E93\u540E\u63D0\u4F9B\u5B8C\u6574 ClassificationSignals"));
    return { readyToLock: false, reasons: [], issues };
  }
  const signalRecord = signals;
  const impactScope = signalRecord.impactScope;
  if (impactScope !== "single-location" && impactScope !== "single-module" && impactScope !== "cross-module") {
    issues.push(issue("CLASSIFICATION_SIGNAL_INVALID", signalPath("impactScope"), "impactScope is invalid", "\u9009\u62E9 single-location\u3001single-module \u6216 cross-module"));
  }
  if (typeof signalRecord.sharedContract !== "boolean") {
    issues.push(issue("CLASSIFICATION_SIGNAL_INVALID", signalPath("sharedContract"), "sharedContract must be boolean", "\u63D0\u4F9B\u5E03\u5C14\u578B sharedContract"));
  }
  if (typeof signalRecord.independentChains !== "number" || !Number.isInteger(signalRecord.independentChains) || signalRecord.independentChains < 1) {
    issues.push(issue("CLASSIFICATION_SIGNAL_INVALID", signalPath("independentChains"), "independentChains must be an integer >= 1", "\u63D0\u4F9B\u5927\u4E8E\u7B49\u4E8E 1 \u7684\u72EC\u7ACB\u94FE\u6570\u91CF"));
  }
  if (typeof signalRecord.coordinatedRollback !== "boolean") {
    issues.push(issue("CLASSIFICATION_SIGNAL_INVALID", signalPath("coordinatedRollback"), "coordinatedRollback must be boolean", "\u63D0\u4F9B\u5E03\u5C14\u578B coordinatedRollback"));
  }
  if (!signalRequirements.has(signalRecord.requirements)) {
    issues.push(issue("CLASSIFICATION_SIGNAL_INVALID", signalPath("requirements"), "requirements is invalid", "\u63D0\u4F9B\u5408\u6CD5 RequirementsState"));
  }
  if (!Array.isArray(signalRecord.formalControls) || signalRecord.formalControls.some((control) => typeof control !== "string" || !formalControlValues.has(control))) {
    issues.push(issue("CLASSIFICATION_SIGNAL_INVALID", signalPath("formalControls"), "formalControls contains an invalid control", "\u4EC5\u4F7F\u7528 trace\u3001independent-review\u3001multiple-rollback-units"));
  }
  if (issues.length) return { readyToLock: false, reasons: [], issues };
  const validSignals = signals;
  if (validSignals.impactScope === "single-location" && (validSignals.sharedContract || validSignals.independentChains > 1 || validSignals.coordinatedRollback)) {
    issues.push(issue("CLASSIFICATION_SIGNALS_CONTRADICTORY", signalPath("impactScope"), "single-location conflicts with cross-location topology signals", "\u4FEE\u6B63\u5F71\u54CD\u8303\u56F4\u6216\u62D3\u6251\u4FE1\u53F7\uFF0C\u4F7F\u4E24\u8005\u4E00\u81F4"));
  }
  if (validSignals.impactScope === "single-module" && (validSignals.independentChains > 1 || validSignals.coordinatedRollback)) {
    issues.push(issue("CLASSIFICATION_SIGNALS_CONTRADICTORY", signalPath("impactScope"), "single-module conflicts with multiple independent chains or coordinated rollback", "\u4FEE\u6B63\u5F71\u54CD\u8303\u56F4\u6216\u62D3\u6251\u4FE1\u53F7\uFF0C\u4F7F\u4E24\u8005\u4E00\u81F4"));
  }
  if (issues.length) return { readyToLock: false, reasons: [], issues };
  const topology = validSignals.coordinatedRollback ? "coordinated-rollback" : validSignals.independentChains >= 2 ? "multi-chain" : validSignals.sharedContract ? "shared-contract" : "local";
  const level = maxLevel(levelForImpactScope(validSignals.impactScope), minimumLevelForTopology(topology));
  const riskLabels = Object.keys(basis.riskFacts).sort();
  const execution = level === "M" || level === "L" ? validSignals.requirements !== "provided-confirmed" || validSignals.formalControls.length > 0 ? "standard" : "light" : void 0;
  const classification2 = {
    level,
    topology,
    ...execution ? { execution } : {},
    requirements: validSignals.requirements,
    riskLabels,
    acceptanceAssistSuggested: false,
    classificationBasis: basis
  };
  const route = level === "XS" ? "xs" : level === "S" ? "s" : level === "M" ? execution === "light" ? "light-m" : "standard-m" : execution === "light" ? "light-l" : "standard-l";
  return {
    readyToLock: true,
    classification: classification2,
    route,
    obligations: deriveObligations(route, basis),
    reasons: recommendationReasons(validSignals, topology, level, riskLabels, basis),
    issues: []
  };
}
function selectRoute(input) {
  if (input.level === void 0 || input.topology === void 0) throw new PolicyError("CLASSIFICATION_FACTS_REQUIRED", "level and topology facts are required before route selection");
  const basis = defaultBasis(input);
  return selectBaseRoute({
    ...basis,
    level: input.level,
    topology: input.topology,
    ...input.execution ? { execution: input.execution } : {},
    ...input.requirements ? { requirements: input.requirements } : {},
    ...input.riskLabels ? { riskLabels: input.riskLabels } : {},
    ...input.acceptanceAssistSuggested !== void 0 ? { acceptanceAssistSuggested: input.acceptanceAssistSuggested } : {}
  });
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

// plugins/dev-flow/src/core/host-id.ts
function isHostId(value) {
  return value === "claude" || value === "codex" || value === "kimi";
}

// plugins/dev-flow/src/core/fingerprint.ts
import { execFile } from "node:child_process";
import { createHash as createHash2 } from "node:crypto";
import { readdir, readFile, lstat } from "node:fs/promises";
import path2 from "node:path";
import { promisify } from "node:util";

// plugins/dev-flow/src/policy/rollback.ts
var IMPLEMENTATION_UNIT_TRANSITIONS = Object.freeze({
  pending: Object.freeze(["active"]),
  active: Object.freeze(["verified"]),
  verified: Object.freeze(["checkpointed", "active"]),
  checkpointed: Object.freeze(["rolled_back"]),
  rolled_back: Object.freeze(["active"])
});
var fileChanges = ["added", "modified", "deleted", "renamed", "mode-changed"];
var ROLLBACK_ID = /^RU-[0-9]{3,}$/;
var SHA256 = /^[0-9a-f]{64}$/;
var FILE_MODE = /^[0-7]{3,4}$/;
function pathWithinFileScope(path18, fileScope) {
  return fileScope.some((pattern) => scopePatternMatches(pattern.normalize("NFC"), path18.normalize("NFC")));
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
function invalid(message) {
  throw new Error(`ROLLBACK_PROTOCOL_INVALID: ${message}`);
}
function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function isRollbackId(value) {
  return typeof value === "string" && ROLLBACK_ID.test(value);
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
function implementationUnitForRollbackNode(node, basisHash2) {
  if (!isRecord(node) || node.kind !== "rollback" || !isRollbackId(node.id) || !isNonEmptyStringArray(node.tasks) || !isNonEmptyStringArray(node.fileScope) || !isVerificationCommandArray(node.forwardVerification) || !isVerificationCommandArray(node.rollbackVerification) || node.status !== "current") {
    invalid("rollback node is missing fields required to open an implementation unit");
  }
  if (!isSha256(basisHash2)) invalid("implementation unit basis hash must be a SHA-256 hex digest");
  return { unitId: node.id, status: "pending", basisHash: basisHash2 };
}
function parseFileRecord(value, index) {
  if (!isRecord(value) || !hasOnlyKeys(value, ["path", "change", "renamedFrom", "beforeSha256", "afterSha256", "beforeBlobSha256", "afterBlobSha256", "beforeMode", "afterMode"]) || !isNonEmptyString(value.path) || typeof value.change !== "string" || !fileChanges.includes(value.change)) {
    invalid(`checkpoint file record ${index} has an invalid shape`);
  }
  const label = `checkpoint file record ${index}`;
  const change = value.change;
  const beforeOk = change !== "added" ? isSha256(value.beforeSha256) && isSha256(value.beforeBlobSha256) && typeof value.beforeMode === "string" && FILE_MODE.test(value.beforeMode) : value.beforeSha256 === void 0 && value.beforeBlobSha256 === void 0 && value.beforeMode === void 0;
  const afterOk = change !== "deleted" ? isSha256(value.afterSha256) && isSha256(value.afterBlobSha256) && typeof value.afterMode === "string" && FILE_MODE.test(value.afterMode) : value.afterSha256 === void 0 && value.afterBlobSha256 === void 0 && value.afterMode === void 0;
  if (!beforeOk) invalid(`${label} has invalid before fields for change ${change}`);
  if (!afterOk) invalid(`${label} has invalid after fields for change ${change}`);
  if (change === "renamed" && !isNonEmptyString(value.renamedFrom)) invalid(`${label} renamed record requires renamedFrom`);
  if (change !== "renamed" && value.renamedFrom !== void 0) invalid(`${label} only renamed records may carry renamedFrom`);
  return {
    path: value.path,
    change,
    ...value.renamedFrom !== void 0 ? { renamedFrom: value.renamedFrom } : {},
    ...change !== "added" ? { beforeSha256: value.beforeSha256, beforeBlobSha256: value.beforeBlobSha256, beforeMode: value.beforeMode } : {},
    ...change !== "deleted" ? { afterSha256: value.afterSha256, afterBlobSha256: value.afterBlobSha256, afterMode: value.afterMode } : {}
  };
}
function parseVerificationAttempt(value, index) {
  if (!isRecord(value) || !hasOnlyKeys(value, ["attemptId", "commandId", "command", "status", "startedAt", "completedAt", "phase", "cwd", "outputTail"]) || !isNonEmptyString(value.attemptId) || !isNonEmptyString(value.commandId) || !isNonEmptyString(value.command) || value.status !== "passed" && value.status !== "failed" || !isTimestamp(value.startedAt) || !isTimestamp(value.completedAt)) {
    invalid(`checkpoint verification attempt ${index} has an invalid shape`);
  }
  if (value.phase !== void 0 && value.phase !== "preflight" && value.phase !== "forward" || value.cwd !== void 0 && !isNonEmptyString(value.cwd) || value.outputTail !== void 0 && typeof value.outputTail !== "string") {
    invalid(`checkpoint verification attempt ${index} has invalid diagnostics`);
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
  if (!isRecord(value) || !hasOnlyKeys(value, ["schemaVersion", "checkpointId", "unitId", "sequence", "basisHash", "startedFingerprint", "completedFingerprint", "startedAt", "completedAt", "files", "forwardPatchSha256", "reversePatchSha256", "verificationAttempts", "requirementsSha256", "planSha256", "traceabilitySha256", "approvalBasisHash", "projectConfigSha256", "verificationCommands", "beginNonce"]) || value.schemaVersion !== 1 || !isNonEmptyString(value.checkpointId) || !isRollbackId(value.unitId) || typeof value.sequence !== "number" || !Number.isInteger(value.sequence) || value.sequence < 1 || !isSha256(value.basisHash) || !isSha256(value.startedFingerprint) || !isSha256(value.completedFingerprint) || value.beginNonce !== void 0 && !isNonEmptyString(value.beginNonce) || !isTimestamp(value.startedAt) || !isTimestamp(value.completedAt) || !Array.isArray(value.files) || !isSha256(value.forwardPatchSha256) || !isSha256(value.reversePatchSha256) || !Array.isArray(value.verificationAttempts) || !isSha256(value.requirementsSha256) || !isSha256(value.planSha256) || !isSha256(value.traceabilitySha256) || !isSha256(value.approvalBasisHash) || !isSha256(value.projectConfigSha256) || !Array.isArray(value.verificationCommands) || value.verificationCommands.length === 0) {
    invalid("checkpoint manifest has an invalid shape");
  }
  const files = value.files.map((file, index) => parseFileRecord(file, index));
  const verificationAttempts = value.verificationAttempts.map((attempt, index) => parseVerificationAttempt(attempt, index));
  const verificationCommands = value.verificationCommands.map((command2, index) => {
    if (!isRecord(command2) || !hasOnlyKeys(command2, ["commandId", "command"]) || !isNonEmptyString(command2.commandId) || !isNonEmptyString(command2.command)) {
      invalid(`checkpoint verification command ${index} has an invalid shape`);
    }
    return { commandId: command2.commandId, command: command2.command };
  });
  const declaredCommandIds = new Set(verificationCommands.map((command2) => command2.commandId));
  for (const attempt of verificationAttempts) {
    if (!declaredCommandIds.has(attempt.commandId)) {
      invalid(`checkpoint verification attempt ${attempt.attemptId} references undeclared command ${attempt.commandId}`);
    }
  }
  return {
    schemaVersion: 1,
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
    ...typeof value.beginNonce === "string" ? { beginNonce: value.beginNonce } : {}
  };
}

// plugins/dev-flow/src/core/path-normalization.ts
import path from "node:path";
function normalizeUnicode(value) {
  return value.normalize("NFC");
}
function normalizeProjectPath(value) {
  return path.posix.normalize(normalizeUnicode(value).replaceAll("\\", "/"));
}

// plugins/dev-flow/src/core/fingerprint.ts
var runFile = promisify(execFile);
var ignored = /* @__PURE__ */ new Set([".git", ".dev-flow", "node_modules"]);
function configFor(input) {
  return Array.isArray(input) ? { protectedRoots: input } : input;
}
async function collect(root2, relative, files) {
  const absolute = path2.join(root2, relative);
  let entries;
  try {
    entries = await readdir(absolute, { withFileTypes: true });
  } catch (error) {
    if (error.code === "ENOENT") return;
    throw error;
  }
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    if (ignored.has(entry.name)) continue;
    const child = normalizeProjectPath(path2.join(relative, entry.name));
    const target = path2.join(root2, child);
    const metadata = await lstat(target);
    if (metadata.isSymbolicLink()) throw new DevFlowError("UNSAFE_PROTECTED_ROOT", `symbolic link is not allowed: ${child}`);
    if (metadata.isDirectory()) await collect(root2, child, files);
    else if (metadata.isFile()) files.push(child);
  }
}
async function hasGitMetadata(root2) {
  let current = path2.resolve(root2);
  while (true) {
    try {
      await lstat(path2.join(current, ".git"));
      return true;
    } catch (error) {
      if (error.code !== "ENOENT") return true;
    }
    const parent = path2.dirname(current);
    if (parent === current) return false;
    current = parent;
  }
}
async function gitOutput(root2, args) {
  try {
    const result = await runFile("git", args, { cwd: root2, encoding: "utf8", maxBuffer: 8 * 1024 * 1024 });
    return String(result.stdout);
  } catch (error) {
    throw new DevFlowError("PROTECTED_ROOT_ENUMERATION_FAILED", "Git could not enumerate protected roots", {
      command: ["git", ...args].join(" "),
      cause: error instanceof Error ? error.message : String(error)
    });
  }
}
async function gitFiles(root2, protectedRoots) {
  const hasMetadata = await hasGitMetadata(root2);
  let insideWorktree = false;
  try {
    insideWorktree = (await gitOutput(root2, ["rev-parse", "--is-inside-work-tree"])).trim() === "true";
  } catch (error) {
    if (!hasMetadata) return void 0;
    throw error;
  }
  if (!insideWorktree) return void 0;
  const output = await gitOutput(root2, ["ls-files", "--cached", "--others", "--exclude-standard", "-z", "--", ...protectedRoots]);
  return output.split("\0").filter(Boolean).map(normalizeProjectPath);
}
function withinConfiguredRoot(file, protectedRoots) {
  return protectedRoots.some((root2) => root2 === "." || file === root2 || file.startsWith(`${root2}/`));
}
function applyExcludes(files, excludes) {
  return files.filter((file) => !excludes?.some((pattern) => pathWithinFileScope(file, [pattern])));
}
async function assertProtectedRootsSafe(root2, protectedRoots) {
  for (const relative of protectedRoots) {
    try {
      const metadata = await lstat(path2.join(root2, relative));
      if (metadata.isSymbolicLink()) throw new DevFlowError("UNSAFE_PROTECTED_ROOT", `symbolic link is not allowed: ${relative}`);
    } catch (error) {
      if (error instanceof DevFlowError) throw error;
      if (error.code !== "ENOENT") throw error;
    }
  }
}
async function enumerateProtectedFiles(root2, input) {
  const config = configFor(input);
  const protectedRoots = [...new Set(config.protectedRoots.map(normalizeProjectPath))].sort();
  await assertProtectedRootsSafe(root2, protectedRoots);
  const fromGit = await gitFiles(root2, protectedRoots);
  const files = fromGit ?? (() => {
    const collected = [];
    return Promise.all(protectedRoots.map((item) => collect(root2, item, collected))).then(() => collected);
  })();
  const resolved = await files;
  const unique = [...new Set(resolved.map(normalizeProjectPath).filter((file) => withinConfiguredRoot(file, protectedRoots)))].sort();
  for (const relative of unique) {
    let metadata;
    try {
      metadata = await lstat(path2.join(root2, relative));
    } catch (error) {
      if (error.code === "ENOENT") continue;
      throw error;
    }
    if (metadata.isSymbolicLink()) throw new DevFlowError("UNSAFE_PROTECTED_ROOT", `symbolic link is not allowed: ${relative}`);
  }
  const present = [];
  for (const relative of unique) {
    try {
      await lstat(path2.join(root2, relative));
      present.push(relative);
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
  }
  return applyExcludes(present, config.protectedRootsExclude);
}
async function fingerprintProtectedRoots(root2, input) {
  const files = await enumerateProtectedFiles(root2, input);
  const digest10 = createHash2("sha256");
  for (const relative of files) {
    digest10.update(relative);
    digest10.update("\0");
    digest10.update(await readFile(path2.join(root2, relative)));
    digest10.update("\0");
  }
  return digest10.digest("hex");
}
async function snapshotProtectedRoots(root2, input) {
  const files = await enumerateProtectedFiles(root2, input);
  const snapshots = [];
  for (const relative of files) {
    const absolute = path2.join(root2, relative);
    const metadata = await lstat(absolute);
    snapshots.push({
      path: relative,
      sha256: createHash2("sha256").update(await readFile(absolute)).digest("hex"),
      mode: (metadata.mode & 511).toString(8).padStart(3, "0")
    });
  }
  return snapshots;
}

// plugins/dev-flow/src/core/project-config.ts
import path3 from "node:path";
function relativeDirectory(value) {
  return value.length > 0 && !path3.isAbsolute(value) && !value.split(/[\\/]+/).includes("..");
}
function normalizedRelativeDirectory(value) {
  if (!relativeDirectory(value)) return void 0;
  const normalized = normalizeProjectPath(value).replace(/\/+$/u, "");
  return normalized || void 0;
}
function validateProjectConfig(value) {
  const config = value;
  if (config?.schemaVersion !== 1 || config.enforcement?.mode !== "strict") throw new DevFlowError("INVALID_PROJECT_CONFIG", "only schema v1 strict configuration is supported");
  if (config.enforcement.gitWriteRequiresLogicComplete !== true || config.enforcement.oneActiveFeature !== true || config.enforcement.requireExplicitHumanReply !== true) {
    throw new DevFlowError("INVALID_PROJECT_CONFIG", "all strict enforcement controls must be enabled");
  }
  if (!Array.isArray(config.protectedRoots) || !config.protectedRoots.length) {
    throw new DevFlowError("INVALID_PROJECT_CONFIG", "protectedRoots must be project-relative non-.dev-flow directories");
  }
  const protectedRoots = config.protectedRoots.map(normalizedRelativeDirectory);
  if (protectedRoots.some((root2) => !root2 || root2.startsWith(".dev-flow"))) {
    throw new DevFlowError("INVALID_PROJECT_CONFIG", "protectedRoots must be project-relative non-.dev-flow directories");
  }
  config.protectedRoots = protectedRoots;
  if (config.protectedRootsExclude !== void 0) {
    if (!Array.isArray(config.protectedRootsExclude) || config.protectedRootsExclude.some((pattern) => typeof pattern !== "string" || !relativeDirectory(pattern))) {
      throw new DevFlowError("INVALID_PROJECT_CONFIG", "protectedRootsExclude must contain non-empty relative glob patterns without ..");
    }
    config.protectedRootsExclude = config.protectedRootsExclude.map((pattern) => normalizeProjectPath(pattern));
  }
  const commands = config.verification?.commands;
  if (!Array.isArray(commands) || !commands.length) throw new DevFlowError("INVALID_PROJECT_CONFIG", "at least one verification command is required");
  const ids = /* @__PURE__ */ new Set();
  for (const command2 of commands) {
    if (!command2?.id || !command2.command || !Array.isArray(command2.args) || !relativeDirectory(command2.cwd)) throw new DevFlowError("INVALID_PROJECT_CONFIG", "invalid verification command");
    if (ids.has(command2.id)) throw new DevFlowError("INVALID_PROJECT_CONFIG", "verification command ids must be unique");
    ids.add(command2.id);
  }
  const behaviorCommands = config.verification?.behaviorCommands;
  if (!Array.isArray(behaviorCommands) || behaviorCommands.some((id) => !ids.has(id))) {
    throw new DevFlowError("INVALID_PROJECT_CONFIG", "behaviorCommands must reference configured command ids");
  }
  const preflightCommands = config.verification?.preflightCommands;
  if (preflightCommands !== void 0 && (!Array.isArray(preflightCommands) || preflightCommands.some((id) => typeof id !== "string" || !ids.has(id)))) {
    throw new DevFlowError("INVALID_PROJECT_CONFIG", "preflightCommands must reference configured command ids");
  }
  if (preflightCommands && config.verification) config.verification.preflightCommands = [...new Set(preflightCommands)];
}

// plugins/dev-flow/src/core/traceability.ts
var ALLOWED_TRACE_KINDS = {
  requirements: ["requirement", "acceptance-criterion"],
  // The implementation plan is the single editable source for the execution
  // graph. Coverage and rollback projections are derived from these nodes;
  // they are not additional user-maintained route documents.
  "implementation-plan": ["task", "test", "rollback"],
  "coverage-matrix": ["test"],
  "rollback-units": ["rollback"]
};
var inputKeys = {
  requirement: ["kind", "id"],
  "acceptance-criterion": ["kind", "id", "parentRequirement"],
  task: ["kind", "id", "covers", "rollbackUnit"],
  test: ["kind", "id", "verifies"],
  rollback: ["kind", "id", "tasks", "dependsOn", "fileScope", "covers", "forwardVerification", "rollbackVerification"]
};
var idPrefix = {
  requirement: "REQ",
  "acceptance-criterion": "AC",
  task: "TASK",
  test: "TEST",
  rollback: "RU"
};
function invalid2(message, details = {}) {
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
    invalid2("node ID does not match its kind", { kind, id });
  }
}
function assertNoDuplicate(values, field, id) {
  if (new Set(values).size !== values.length) invalid2("node relationship contains duplicates", { field, id });
}
function assertSafeFileScope(fileScope, id, persisted = false) {
  for (const pattern of fileScope) {
    if (persisted && pattern !== normalizeUnicode(pattern)) {
      invalid2("persisted rollback fileScope must use Unicode NFC", { id, field: "fileScope", pattern });
    }
    if (!isSafeFileScopePattern(pattern)) {
      invalid2(persisted ? "persisted rollback fileScope is unsafe" : "rollback fileScope is unsafe", { id, field: "fileScope", pattern });
    }
  }
}
function validateNodeInput(value) {
  if (!isRecord2(value) || typeof value.kind !== "string" || !(value.kind in inputKeys)) invalid2("node input has an unknown kind");
  const kind = value.kind;
  const keys = Object.keys(value);
  if (keys.some((key) => !inputKeys[kind].includes(key))) invalid2("node input contains Core-owned or unknown fields", { kind, keys });
  assertId(kind, value.id);
  if (kind === "acceptance-criterion") assertId("requirement", value.parentRequirement);
  if (kind === "task") {
    if (!isStringArray(value.covers)) invalid2("task covers must be a non-empty string array", { id: value.id });
    assertNoDuplicate(value.covers, "covers", value.id);
    assertId("rollback", value.rollbackUnit);
  }
  if (kind === "test") {
    if (!isStringArray(value.verifies)) invalid2("test verifies must be a non-empty string array", { id: value.id });
    assertNoDuplicate(value.verifies, "verifies", value.id);
    for (const id of value.verifies) assertId("acceptance-criterion", id);
  }
  if (kind === "rollback") {
    const rollback = value;
    for (const [field, allowEmpty] of [["tasks", false], ["dependsOn", true], ["fileScope", false], ["covers", false], ["forwardVerification", false], ["rollbackVerification", false]]) {
      const relationship = field === "forwardVerification" || field === "rollbackVerification" ? value[field] : value[field];
      if (field === "forwardVerification" || field === "rollbackVerification") {
        if (!isVerificationCommandArray2(relationship)) invalid2("rollback verification must be a non-empty command array", { field, id: value.id });
        const keys2 = relationship.map(verificationCommandKey);
        assertNoDuplicate(keys2, field, value.id);
      } else {
        if (!isStringArray(relationship, allowEmpty)) invalid2("rollback relationship must be a string array", { field, id: value.id });
        assertNoDuplicate(relationship, field, value.id);
      }
    }
    for (const id of rollback.tasks) assertId("task", id);
    for (const id of rollback.dependsOn) assertId("rollback", id);
    assertSafeFileScope(rollback.fileScope, value.id);
  }
}
function validateTraceDelta(value) {
  if (!isRecord2(value) || Object.keys(value).length !== 1 || !Array.isArray(value.nodes)) invalid2("Trace delta must contain only nodes");
  const ids = /* @__PURE__ */ new Set();
  for (const node of value.nodes) {
    validateNodeInput(node);
    if (ids.has(node.id)) invalid2("Trace delta declares an ID more than once", { id: node.id });
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
      return { ...common, kind: node.kind, id: node.id, parentRequirement: node.parentRequirement };
    case "task":
      return { ...common, kind: node.kind, id: node.id, covers: [...node.covers], rollbackUnit: node.rollbackUnit };
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
        sourceArtifact: input.artifactKind,
        verificationConfigSha256: input.projectConfigSha256
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
      return JSON.stringify({ kind: node.kind, id: node.id, parentRequirement: node.parentRequirement });
    case "task":
      return JSON.stringify({ kind: node.kind, id: node.id, covers: node.covers, rollbackUnit: node.rollbackUnit });
    case "test":
      return JSON.stringify({ kind: node.kind, id: node.id, verifies: node.verifies });
    case "rollback":
      return JSON.stringify({ kind: node.kind, id: node.id, tasks: node.tasks, dependsOn: node.dependsOn, fileScope: node.fileScope, covers: node.covers, forwardVerification: node.forwardVerification, rollbackVerification: node.rollbackVerification });
  }
}
function assertSourceBlocks(input) {
  const sourceBlocks = /* @__PURE__ */ new Map();
  for (const block of input.sourceBlocks) {
    if (!isRecord2(block) || typeof block.id !== "string" || typeof block.kind !== "string" || typeof block.sourceAnchor !== "string" || typeof block.sourceBlockSha256 !== "string") {
      invalid2("source block is invalid");
    }
    if (sourceBlocks.has(block.id)) invalid2("source block ID is declared more than once", { id: block.id });
    sourceBlocks.set(block.id, block);
  }
  const ids = new Set(input.delta.nodes.map((node) => node.id));
  if (ids.size !== sourceBlocks.size || [...ids].some((id) => !sourceBlocks.has(id))) invalid2("source blocks must exactly match delta nodes");
  for (const node of input.delta.nodes) {
    const source = sourceBlocks.get(node.id);
    if (source.kind !== node.kind) invalid2("source anchor kind does not match delta node", { id: node.id });
  }
  return sourceBlocks;
}
function assertArtifactDeltaContract(input) {
  const allowed = ALLOWED_TRACE_KINDS[input.artifactKind];
  if (input.delta.nodes.some((node) => !allowed.includes(node.kind))) invalid2("delta kind is not allowed for its artifact", { artifactKind: input.artifactKind });
  const has = (kind) => input.delta.nodes.some((node) => node.kind === kind);
  if (input.artifactKind === "implementation-plan" && input.route === "standard-m" && (!has("task") || !has("rollback"))) {
    invalid2("standard M implementation plans require both tasks and rollback units");
  }
  if (input.artifactKind === "rollback-units" && input.route !== "standard-l") invalid2("rollback-units are only valid for standard L");
  for (const node of input.delta.nodes) {
    if (node.kind !== "rollback") continue;
    if (!["implementation-plan", "rollback-units"].includes(input.artifactKind)) invalid2("rollback node has an invalid source artifact");
    if ([...node.forwardVerification, ...node.rollbackVerification].some((ref) => typeof ref === "string" && !input.verificationCommandIds.includes(ref))) {
      invalid2("rollback verification references an unknown command ID", { id: node.id });
    }
  }
}
function deriveTraceEdges(nodes) {
  const edges = [];
  for (const node of currentNodes(nodes)) {
    if (node.kind === "acceptance-criterion") edges.push({ from: node.id, type: "parent", to: node.parentRequirement });
    if (node.kind === "task") {
      for (const target of node.covers) edges.push({ from: node.id, type: "covers", to: target });
      edges.push({ from: node.id, type: "rollback-unit", to: node.rollbackUnit });
    }
    if (node.kind === "test") for (const target of node.verifies) edges.push({ from: node.id, type: "verifies", to: target });
    if (node.kind === "rollback") {
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
  if (!node || !kinds.includes(node.kind)) invalid2("graph reference is missing or has the wrong kind", { id, ...details });
  return node;
}
function assertRollbackDag(nodes) {
  const visiting = /* @__PURE__ */ new Set();
  const visited = /* @__PURE__ */ new Set();
  const visit = (id) => {
    if (visited.has(id)) return;
    if (visiting.has(id)) invalid2("rollback dependency graph contains a cycle", { id });
    visiting.add(id);
    const node = nodeById(nodes, id);
    if (node?.kind === "rollback") for (const dependency of node.dependsOn) visit(dependency);
    visiting.delete(id);
    visited.add(id);
  };
  for (const node of currentNodes(nodes)) if (node.kind === "rollback") visit(node.id);
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
  if (!isRecord2(value)) invalid2("persisted node is not an object", { id: recordId });
  const kind = value.kind;
  if (typeof kind !== "string" || !(kind in idPrefix)) invalid2("persisted node has an unknown kind", { id: recordId, kind });
  assertId(kind, value.id);
  if (value.id !== recordId) invalid2("persisted node id does not match its record key", { id: recordId, nodeId: value.id });
  if (!statusValues.has(value.status)) invalid2("persisted node has an invalid status", { id: recordId, status: value.status });
  if (typeof value.sourceArtifact !== "string" || !sourceArtifacts.has(value.sourceArtifact)) {
    invalid2("persisted node has an invalid sourceArtifact", { id: recordId, sourceArtifact: value.sourceArtifact });
  }
  if (typeof value.sourceSha256 !== "string" || !hex64.test(value.sourceSha256)) {
    invalid2("persisted node has an invalid sourceSha256", { id: recordId });
  }
  if (typeof value.sourceAnchor !== "string" || !value.sourceAnchor.includes(`id=${value.id}`)) {
    invalid2("persisted node has an invalid sourceAnchor", { id: recordId });
  }
  if (typeof value.sourceBlockSha256 !== "string" || !hex64.test(value.sourceBlockSha256)) {
    invalid2("persisted node has an invalid sourceBlockSha256", { id: recordId });
  }
  if (kind === "acceptance-criterion") assertId("requirement", value.parentRequirement);
  if (kind === "task") {
    if (!isStringArray(value.covers)) invalid2("persisted task covers is invalid", { id: recordId });
    assertId("rollback", value.rollbackUnit);
  }
  if (kind === "test") {
    if (!isStringArray(value.verifies)) invalid2("persisted test verifies is invalid", { id: recordId });
  }
  if (kind === "rollback") {
    for (const [field, allowEmpty] of [["tasks", false], ["dependsOn", true], ["fileScope", false], ["covers", false], ["forwardVerification", false], ["rollbackVerification", false]]) {
      if (field === "forwardVerification" || field === "rollbackVerification") {
        if (!isVerificationCommandArray2(value[field])) invalid2("persisted rollback verification field is invalid", { id: recordId, field });
      } else if (!isStringArray(value[field], allowEmpty)) {
        invalid2("persisted rollback field is invalid", { id: recordId, field });
      }
    }
    if (value.sourceArtifact !== "implementation-plan" && value.sourceArtifact !== "rollback-units") {
      invalid2("persisted rollback has an invalid sourceArtifact", { id: recordId });
    }
    if (typeof value.verificationConfigSha256 !== "string" || !hex64.test(value.verificationConfigSha256)) {
      invalid2("persisted rollback has an invalid verificationConfigSha256", { id: recordId });
    }
    const allowLegacyRepair = value.status !== "tombstoned" && value.sourceArtifact === options.allowUnsafeFileScopeSourceArtifact;
    if (value.status !== "tombstoned" && !allowLegacyRepair) {
      assertSafeFileScope(value.fileScope, recordId, true);
    }
  }
}
function assertPersistedLedgerShape(ledger, options) {
  if (typeof ledger.featureId !== "string" || !ledger.featureId) invalid2("ledger featureId is invalid");
  if (!Number.isInteger(ledger.revision) || ledger.revision < 0) invalid2("ledger revision is invalid");
  if (!Number.isInteger(ledger.stateRevision) || ledger.stateRevision < 0) invalid2("ledger stateRevision is invalid");
  if (typeof ledger.projectConfigSha256 !== "string" || !hex64.test(ledger.projectConfigSha256)) {
    invalid2("ledger projectConfigSha256 is invalid");
  }
  for (const [id, node] of Object.entries(ledger.nodes)) assertPersistedNode(id, node, options);
}
function validateTraceGraph(ledger, route, mode, options = {}) {
  if (!isRecord2(ledger) || ledger.schemaVersion !== 1 || !isRecord2(ledger.nodes) || !Array.isArray(ledger.edges)) invalid2("traceability ledger has an invalid shape");
  assertPersistedLedgerShape(ledger, options);
  const nodes = ledger.nodes;
  for (const node of currentNodes(nodes)) {
    if (node.kind === "acceptance-criterion") assertReference(nodes, node.parentRequirement, ["requirement"], { from: node.id });
    if (node.kind === "task") {
      if (node.covers.length === 0) invalid2("task cannot be orphaned", { id: node.id });
      for (const covered of node.covers) assertReference(nodes, covered, ["requirement", "acceptance-criterion"], { from: node.id });
      const rollback = nodeById(nodes, node.rollbackUnit);
      if (!rollback && !(route === "standard-l" && mode === "partial")) invalid2("task references a missing rollback unit", { id: node.id, rollbackUnit: node.rollbackUnit });
      if (rollback && rollback.kind !== "rollback") invalid2("task rollback unit has the wrong kind", { id: node.id });
      if (rollback?.kind === "rollback" && !rollback.tasks.includes(node.id)) {
        invalid2("task rollback unit must list the task", { id: node.id, rollbackUnit: node.rollbackUnit });
      }
    }
    if (node.kind === "test") for (const verified of node.verifies) assertReference(nodes, verified, ["acceptance-criterion"], { from: node.id });
    if (node.kind === "rollback") {
      for (const taskId of node.tasks) {
        const task = assertReference(nodes, taskId, ["task"], { from: node.id });
        if (task.kind !== "task" || task.rollbackUnit !== node.id) invalid2("rollback unit tasks must be symmetric with task rollbackUnit", { id: node.id, taskId });
      }
      for (const dependency of node.dependsOn) assertReference(nodes, dependency, ["rollback"], { from: node.id });
      for (const covered of node.covers) assertReference(nodes, covered, ["requirement", "acceptance-criterion"], { from: node.id });
    }
  }
  assertRollbackDag(nodes);
  const edges = deriveTraceEdges(nodes);
  if (!sameEdges(ledger.edges, edges)) invalid2("ledger edges do not match nodes");
  if (!sameSummary(ledger.summary, traceSummary(nodes))) invalid2("ledger summary does not match nodes");
  if (mode === "complete") {
    const kinds = new Set(currentNodes(nodes).map((node) => node.kind));
    for (const kind of ["requirement", "acceptance-criterion", "task", "test", "rollback"]) if (!kinds.has(kind)) invalid2("complete graph is missing a required node kind", { kind });
    if (currentNodes(nodes).some((node) => node.status !== "current")) invalid2("complete graph cannot contain stale nodes");
    for (const node of currentNodes(nodes)) {
      if (node.kind === "acceptance-criterion" && !currentNodes(nodes).some((candidate) => candidate.kind === "test" && candidate.verifies.includes(node.id))) {
        invalid2("every acceptance criterion requires a test", { id: node.id });
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
function applyTraceDelta(input) {
  const effectiveInput = { ...input, delta: normalizeTraceDelta(input.delta) };
  validateTraceDelta(effectiveInput.delta);
  assertArtifactDeltaContract(effectiveInput);
  const sourceBlocks = assertSourceBlocks(effectiveInput);
  const nodes = structuredClone(effectiveInput.current.nodes);
  const changed = /* @__PURE__ */ new Set();
  for (const node of effectiveInput.delta.nodes) {
    const previous = nodes[node.id];
    if (previous?.status === "tombstoned") invalid2("tombstoned IDs cannot be reused", { id: node.id });
    const next = sourceFor(effectiveInput, node, sourceBlocks.get(node.id));
    if (previous && previous.sourceArtifact !== effectiveInput.artifactKind) invalid2("node ID already belongs to a different source artifact", { id: node.id });
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
    nodes,
    edges: deriveTraceEdges(nodes),
    summary: traceSummary(nodes)
  };
  validateTraceGraph(ledger, effectiveInput.route, "partial");
  return ledger;
}
function assertConfigCurrent(ledger, currentProjectConfigSha256) {
  if (ledger.projectConfigSha256 !== currentProjectConfigSha256) sliceError("TRACE_SLICE_STALE", "project configuration changed since Trace registration");
  for (const node of currentNodes(ledger.nodes)) {
    if (node.kind === "rollback" && node.verificationConfigSha256 !== currentProjectConfigSha256) {
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
function assertTraceabilityComplete(ledger, route, currentProjectConfigSha256) {
  assertConfigCurrent(ledger, currentProjectConfigSha256);
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
function assertTraceSliceCurrent(ledger, route, step, currentProjectConfigSha256) {
  assertConfigCurrent(ledger, currentProjectConfigSha256);
  const completeSteps = /* @__PURE__ */ new Set(["planning", "implementation", "feature_check", "finalize"]);
  if (completeSteps.has(step)) return assertTraceabilityComplete(ledger, route, currentProjectConfigSha256);
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
  const kinds = step === "implementation_plan" ? [...requirements, "task", ...route === "standard-m" ? ["rollback"] : []] : step === "coverage_review" ? [...requirements, "task", "test"] : step === "rollback_unit" ? [...requirements, "task", "test", "rollback"] : [...requirements, "task", "test", "rollback"];
  requireCurrentKinds(ledger, kinds);
  try {
    validateTraceGraph(ledger, route, step === "rollback_unit" ? "complete" : "partial");
    if (step === "coverage_review") {
      for (const node of currentNodes(ledger.nodes)) if (node.kind === "acceptance-criterion" && !currentNodes(ledger.nodes).some((candidate) => candidate.kind === "test" && candidate.verifies.includes(node.id))) {
        sliceError("TRACE_SLICE_INCOMPLETE", "coverage review requires a test for every acceptance criterion", { id: node.id });
      }
    }
  } catch (error) {
    if (error instanceof DevFlowError) sliceError("TRACE_SLICE_INCOMPLETE", error.message, error.details);
    throw error;
  }
}

// plugins/dev-flow/src/core/step-order.ts
function currentOpenStep(state) {
  if (state.mode !== "routed") return void 0;
  return routeDefinitionForFeature(state.route, state.workflowCapabilities).orderedSteps.find((step) => state.steps[step]?.status !== "satisfied");
}
function assertCurrentStep(state, step) {
  if (currentOpenStep(state) !== step) throw new DevFlowError("STEP_OUT_OF_ORDER", `${step} is not the current route step`, { expected: currentOpenStep(state) });
}

// plugins/dev-flow/src/core/traceability-store.ts
import { createHash as createHash3, randomUUID } from "node:crypto";
import { mkdir, open, readFile as readFile2, readdir as readdir2, rename } from "node:fs/promises";
import path4 from "node:path";
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
  return path4.join(root2, ".dev-flow", "features", featureId, "traceability", "snapshots");
}
function digest(contents) {
  return createHash3("sha256").update(contents).digest("hex");
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
  const sha256 = digest(contents);
  const directory = snapshotDirectory(root2, ledger.featureId);
  const target = path4.join(directory, `${sha256}.json`);
  await mkdir(directory, { recursive: true });
  try {
    const existing = await readFile2(target, "utf8");
    if (existing !== contents) throw new DevFlowError("TRACEABILITY_INTEGRITY_FAILED", "existing snapshot does not match its content address");
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    await options.fault?.("before-temp-write");
    const temporary = path4.join(directory, `.${sha256}.${randomUUID()}.tmp`);
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
      const existing = await readFile2(target, "utf8");
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
  const file = path4.join(root2, ".dev-flow", "features", state.featureId, relative);
  let contents;
  try {
    contents = await readFile2(file, "utf8");
  } catch {
    integrity("Trace snapshot cannot be read", { featureId: state.featureId, path: relative });
  }
  if (digest(contents) !== pointer.sha256) integrity("Trace snapshot digest does not match pointer", { featureId: state.featureId });
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
    entries = await readdir2(directory);
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }
  const active = state.traceability?.path.split("/").at(-1);
  return entries.filter((entry) => /^[a-f0-9]{64}\.json$/.test(entry) && entry !== active).sort();
}
async function readProjectConfigSnapshot(root2) {
  const file = path4.join(root2, ".dev-flow", "project.json");
  let raw;
  try {
    raw = await readFile2(file, "utf8");
  } catch {
    throw new DevFlowError("PROJECT_NOT_INITIALIZED", "run dev_flow_init_project first");
  }
  let config;
  try {
    config = JSON.parse(raw);
    validateProjectConfig(config);
  } catch (error) {
    if (error instanceof DevFlowError) throw error;
    throw new DevFlowError("INVALID_PROJECT_CONFIG", "project configuration is unreadable");
  }
  return { config, sha256: digest(raw) };
}

// plugins/dev-flow/src/core/traceability-gates.ts
function traceSliceForWorkflowStep(step) {
  if (step === "requirements_alignment") return "requirements";
  if (step === "planning") return "implementation_plan";
  return step;
}
function traceIsEnforced(state) {
  return traceEnforcementRequired(state.route, state.workflowCapabilities);
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
    const { sha256 } = await readProjectConfigSnapshot(root2);
    assertTraceSliceCurrent(ledger, state.route, traceStep, sha256);
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
    inspection.blocker.details
  );
}

// plugins/dev-flow/src/core/review-store.ts
import { createHash as createHash4, randomUUID as randomUUID2 } from "node:crypto";
import { mkdir as mkdir2, open as open2, readFile as readFile3, readdir as readdir3, rename as rename2 } from "node:fs/promises";
import path5 from "node:path";

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
  const agentIds = new Set(attested.map((job) => job.submission.attestation.agentId));
  const rawHashes = new Set(attested.map((job) => job.submission.attestation.rawSha256));
  if (attested.length >= 2 && agentIds.size >= 2 && rawHashes.size >= 2) return "multi-agent-attested";
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
  if (!isRecord3(value) || Object.keys(value).some((key) => !["host", "agentId", "issuedAt", "raw"].includes(key)) || !isHostId(value.host) || typeof value.agentId !== "string" || !value.agentId.trim() || typeof value.issuedAt !== "string" || !value.issuedAt.trim() || Number.isNaN(Date.parse(value.issuedAt)) || typeof value.raw !== "string" || !value.raw.trim()) {
    protocolInvalid("host attestation has an invalid shape");
  }
  return {
    host: value.host,
    agentId: value.agentId.trim(),
    issuedAt: value.issuedAt,
    raw: value.raw
  };
}
var reviewRoles = [
  "requirements-coverage",
  "architecture-testability",
  "rollback-operability",
  "security",
  "data-irreversibility"
];
function protocolInvalid(message) {
  throw new Error(`REVIEW_PROTOCOL_INVALID: ${message}`);
}
function isRecord3(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function isReviewRole(value) {
  return typeof value === "string" && reviewRoles.includes(value);
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
function deriveReviewJobRequirements(route, riskLabels) {
  if (route !== "standard-m" && route !== "standard-l") return [];
  const roles = ["requirements-coverage", "architecture-testability", "rollback-operability"];
  if (riskLabels.includes("security")) roles.push("security");
  if (riskLabels.some((label) => label === "data" || label === "money" || label === "irreversible_consequence")) {
    roles.push("data-irreversibility");
  }
  const reviewDepth = riskLabels.includes("critical_correctness") ? "full" : "standard";
  return reviewRoles.filter((role) => roles.includes(role)).map((role) => ({ role, reviewDepth }));
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
var digest2 = (contents) => createHash4("sha256").update(contents).digest("hex");
function emptyReviewLedger(featureId, stateRevision) {
  return { schemaVersion: 1, featureId, revision: 0, stateRevision, batches: [], summary: emptySummary(), findingEvents: [] };
}
function canonicalReviewJson(ledger) {
  return `${JSON.stringify(sortValue2(ledger), null, 2)}
`;
}
function canonicalReviewValueJson(value) {
  return `${JSON.stringify(sortValue2(value), null, 2)}
`;
}
function snapshotDirectory2(root2, featureId) {
  return path5.join(root2, ".dev-flow", "features", featureId, "review", "snapshots");
}
function packageDirectory(root2, featureId) {
  return path5.join(root2, ".dev-flow", "features", featureId, "review", "packages");
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
  return isRecord4(value) && isHostId(value.host) && typeof value.agentId === "string" && value.agentId.trim().length > 0 && typeof value.issuedAt === "string" && !Number.isNaN(Date.parse(value.issuedAt)) && typeof value.raw === "string" && value.raw.trim().length > 0 && validHash(value.rawSha256) && typeof value.acceptedAt === "string" && digest2(value.raw) === value.rawSha256;
}
function validateBatch(value) {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const batch = value;
  if (typeof batch.batchId !== "string" || !batch.batchId || !validHash(batch.basisHash) || !batch.basis || batch.validity !== "current" && batch.validity !== "stale" || batch.progress !== "open" && batch.progress !== "complete" || batch.executionMode !== "isolated-sequential" && batch.executionMode !== "mcp-sampling" && batch.executionMode !== "native-subagent" || batch.assuranceLevel !== "multi-perspective" && batch.assuranceLevel !== "independent-sampling" && batch.assuranceLevel !== "multi-agent-attested" && batch.assuranceLevel !== "multi-agent-verified" || !Array.isArray(batch.jobs)) return false;
  const ids = /* @__PURE__ */ new Set();
  const attestationRaws = /* @__PURE__ */ new Set();
  return batch.jobs.every((job) => {
    if (!job || typeof job !== "object" || typeof job.jobId !== "string" || !job.jobId || ids.has(job.jobId) || typeof job.role !== "string" || job.reviewDepth !== "standard" && job.reviewDepth !== "full" || !validHash(job.packageSha256) || job.status !== "pending" && job.status !== "claimed" && job.status !== "sampling" && job.status !== "submitted") return false;
    ids.add(job.jobId);
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
  if (ledger.schemaVersion !== 1 || typeof ledger.featureId !== "string" || !ledger.featureId || !Number.isInteger(ledger.revision) || (ledger.revision ?? -1) < 0 || !Number.isInteger(ledger.stateRevision) || (ledger.stateRevision ?? -1) < 0 || !Array.isArray(ledger.batches) || !ledger.batches.every(validateBatch) || !validateSummary(ledger.summary)) {
    integrity2("review snapshot has an invalid shape");
  }
  const batchIds = /* @__PURE__ */ new Set();
  for (const batch of ledger.batches) {
    if (batchIds.has(batch.batchId) || batch.basis.featureId !== ledger.featureId || digest2(canonicalReviewValueJson(batch.basis)) !== batch.basisHash || batch.progress === "complete" !== batch.jobs.every((job) => job.status === "submitted")) {
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
  const sha256 = digest2(contents);
  const directory = snapshotDirectory2(root2, ledger.featureId);
  const target = path5.join(directory, `${sha256}.json`);
  await mkdir2(directory, { recursive: true });
  try {
    const existing = await readFile3(target, "utf8");
    if (existing !== contents) integrity2("existing review snapshot does not match its content address");
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    const temporary = path5.join(directory, `.${sha256}.${randomUUID2()}.tmp`);
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
      if (await readFile3(target, "utf8") !== contents) integrity2("concurrent review snapshot does not match its content address");
    }
    await fsyncDirectory2(directory);
  }
  return { path: `review/snapshots/${sha256}.json`, sha256, revision: ledger.revision, summary: ledger.summary };
}
async function writeReviewPackage(root2, featureId, value) {
  const contents = canonicalReviewValueJson(value);
  const sha256 = digest2(contents);
  const directory = packageDirectory(root2, featureId);
  const target = path5.join(directory, `${sha256}.json`);
  await mkdir2(directory, { recursive: true });
  try {
    const existing = await readFile3(target, "utf8");
    if (existing !== contents) integrity2("existing review package does not match its content address");
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    const temporary = path5.join(directory, `.${sha256}.${randomUUID2()}.tmp`);
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
      if (await readFile3(target, "utf8") !== contents) integrity2("concurrent review package does not match its content address");
    }
    await fsyncDirectory2(directory);
  }
  return sha256;
}
async function readReviewPackage(root2, featureId, sha256) {
  if (!validHash(sha256)) integrity2("review package hash is invalid");
  let contents;
  try {
    contents = await readFile3(path5.join(packageDirectory(root2, featureId), `${sha256}.json`), "utf8");
  } catch {
    integrity2("review package cannot be read", { featureId, sha256 });
  }
  if (digest2(contents) !== sha256) integrity2("review package digest does not match its address", { featureId, sha256 });
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
    contents = await readFile3(path5.join(root2, ".dev-flow", "features", state.featureId, relative), "utf8");
  } catch {
    integrity2("review snapshot cannot be read", { featureId: state.featureId, path: relative });
  }
  if (digest2(contents) !== pointer.sha256) integrity2("review snapshot digest does not match pointer", { featureId: state.featureId });
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
    entries = await readdir3(snapshotDirectory2(root2, state.featureId));
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }
  const active = state.review?.path.split("/").at(-1);
  return entries.filter((entry) => /^[a-f0-9]{64}\.json$/.test(entry) && entry !== active).sort();
}

// plugins/dev-flow/src/core/review-projection.ts
import { createHash as createHash5, randomUUID as randomUUID3 } from "node:crypto";
import { mkdir as mkdir3, open as open3, readFile as readFile4, rename as rename3 } from "node:fs/promises";
import path6 from "node:path";

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
  const basisCurrent = !currentBasisHash || !latest || latest.basisHash === currentBasisHash;
  const status = !basisCurrent ? "unresolved" : latest?.type === "resolved" ? "resolved" : latest?.type === "still-blocking" ? "still-blocking" : latest?.type === "risk-accepted" ? "risk-accepted" : "unresolved";
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
function carriedFindings(ledger, role) {
  return unresolvedBlockingFindings(ledger).map((finding) => {
    const origin = originFor(ledger, finding.findingId);
    return origin && origin.role === role ? { finding, originBatchId: origin.batchId, basisHash: origin.basisHash } : void 0;
  }).filter((value) => Boolean(value));
}

// plugins/dev-flow/src/core/review-projection.ts
var digest3 = (contents) => createHash5("sha256").update(contents).digest("hex");
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
    return unresolvedBlockingFindings(ledger, current?.basisHash).map((finding) => finding.findingId).sort();
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
    ...model.assurance.level === "multi-agent-attested" ? ["- Note: multi-agent-attested is host subagent proof, not multi-agent-verified identity."] : [],
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
  return path6.join(root2, ".dev-flow", "features", featureId, "review", "projections");
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
  const sha256 = digest3(markdown);
  const directory = projectionDirectory(root2, featureId);
  const target = path6.join(directory, `${sha256}.md`);
  await mkdir3(directory, { recursive: true });
  try {
    const existing = await readFile4(target, "utf8");
    if (existing !== markdown) projectionError("existing review projection does not match its content address");
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    const temporary = path6.join(directory, `.${sha256}.${randomUUID3()}.tmp`);
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
      if (await readFile4(target, "utf8") !== markdown) projectionError("concurrent review projection does not match its content address");
    }
    await fsyncDirectory3(directory);
  }
  return { path: `review/projections/${sha256}.md`, sha256 };
}
async function prepareReviewProjection(root2, state) {
  if (!reviewEnforcementRequired(state.route, state.workflowCapabilities)) return;
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
  if (!reviewEnforcementRequired(state.route, state.workflowCapabilities)) return void 0;
  const artifact = state.artifacts["plan-review"];
  if (!validProjectionArtifact(artifact)) projectionError("review projection artifact pointer is missing or invalid", { featureId: state.featureId });
  let markdown;
  try {
    markdown = await readFile4(path6.join(root2, ".dev-flow", "features", state.featureId, artifact.path), "utf8");
  } catch {
    projectionError("review projection artifact cannot be read", { featureId: state.featureId, path: artifact.path });
  }
  if (digest3(markdown) !== artifact.sha256) projectionError("review projection digest does not match artifact pointer", { featureId: state.featureId });
  const ledger = await readReviewLedger(root2, state);
  const model = reviewProjectionModel(state, ledger);
  const expected = renderReviewProjection(model);
  if (markdown !== expected) projectionError("review projection does not match the current review ledger", { featureId: state.featureId });
  return { artifact, model, markdown: expected };
}
async function assertCurrentReviewProjection(root2, state) {
  await readReviewProjection(root2, state);
}

// plugins/dev-flow/src/core/decision-ledger.ts
import { createHash as createHash6 } from "node:crypto";
function idFor(question, refs = []) {
  return `DEC-${createHash6("sha256").update(`${question}
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

// plugins/dev-flow/src/core/git-reconciliation.ts
import { execFile as execFile2 } from "node:child_process";
import { createHash as createHash7 } from "node:crypto";
import { lstat as lstat2, readFile as readFile5 } from "node:fs/promises";
import path7 from "node:path";
import { promisify as promisify2 } from "node:util";
var run = promisify2(execFile2);
async function git(root2, args, allowExitOne = false) {
  try {
    const result = await run("git", args, { cwd: root2, encoding: "buffer", maxBuffer: 8 * 1024 * 1024 });
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
function statusKind(code) {
  if (code.includes("?") || code.includes("A")) return "untracked";
  if (code.includes("D")) return "deleted";
  if (code.includes("R")) return "renamed";
  if (code[0] !== " " && code[1] === " ") return "staged";
  return "unstaged";
}
async function contentHash(root2, relative) {
  try {
    const metadata = await lstat2(path7.join(root2, relative));
    if (!metadata.isFile()) return void 0;
    return createHash7("sha256").update(await readFile5(path7.join(root2, relative))).digest("hex");
  } catch {
    return void 0;
  }
}
async function dirtyPaths(root2, config) {
  const output = await git(root2, ["status", "--porcelain=v1", "-z", "--untracked-files=all", "--", ...config.protectedRoots]);
  const items = output.split("\0").filter(Boolean);
  const result = {};
  for (let index = 0; index < items.length; index += 1) {
    const item = items[index];
    if (item.length < 4) continue;
    const code = item.slice(0, 2);
    const current = normalizePath(item.slice(3));
    if (config.protectedRootsExclude?.some((pattern) => current === pattern || current.startsWith(`${pattern}/`))) {
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
  return fingerprintProtectedRoots(root2, config);
}
async function captureWorkspaceLineage(root2, config) {
  let baseHead = "";
  let baseBranch = "";
  let startedDirty = {};
  try {
    baseHead = await head(root2);
    baseBranch = await branchName(root2);
    startedDirty = await dirtyPaths(root2, config);
  } catch (error) {
    if (!(error instanceof DevFlowError)) throw error;
  }
  const lastWorkspaceFingerprint = await fingerprint(root2, config).catch(() => createHash7("sha256").update("").digest("hex"));
  return {
    baseHead,
    baseBranch,
    observedHead: baseHead,
    startedDirty,
    ownership: {},
    ownershipSource: {},
    observedCommits: [],
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
      changedPaths: paths.split("\n").map((value) => value.trim()).filter(Boolean).map(normalizePath),
      source: "unknown",
      observedAt: (/* @__PURE__ */ new Date()).toISOString()
    });
  }
  return commits;
}
async function changedPathsBetween(root2, baseHead, observedHead) {
  if (!baseHead || !observedHead || baseHead === observedHead) return [];
  const output = await git(root2, ["diff", "--name-only", "-z", baseHead, observedHead]);
  return output.split("\0").filter(Boolean).map(normalizePath).sort();
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
    if (outOfScope.some((scope) => scope === "." || file === scope || file.startsWith(`${scope}/`))) {
      ownership[file] = "excluded";
    }
  }
  void inScope;
  return { ...lineage, ownership, ownershipSource };
}
async function reconcileWorkspaceForFeature(root2, state, config) {
  let workspace = await reconcileWorkspaceLineage(root2, state.workspace, config);
  const committedPaths = await changedPathsBetween(root2, workspace.baseHead, workspace.observedHead);
  const ownership = { ...workspace.ownership };
  const ownershipSource = { ...workspace.ownershipSource };
  for (const file of committedPaths) {
    if (state.scope.inScope.some((entry) => entry === "." || file === entry || file.startsWith(`${entry}/`)) || ownership[file] === "excluded") {
      ownership[file] = "feature";
      ownershipSource[file] = "manual-commit";
    } else if (state.scope.outOfScope.some((entry) => entry === "." || file === entry || file.startsWith(`${entry}/`))) {
      ownership[file] = "excluded";
    }
  }
  workspace = { ...workspace, ownership, ownershipSource };
  return { workspace, contentChanged: state.workspace.lastWorkspaceFingerprint !== workspace.lastWorkspaceFingerprint };
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
    if (!unit || typeof unit !== "object" || Array.isArray(unit) || typeof unit.unitId !== "string" || !/^RU-[0-9]{3,}$/.test(unit.unitId) || typeof unit.status !== "string" || !unitStatuses.has(unit.status) || typeof unit.basisHash !== "string" || !/^[a-f0-9]{64}$/.test(unit.basisHash) || unit.startedFingerprint !== void 0 && (typeof unit.startedFingerprint !== "string" || !/^[a-f0-9]{64}$/.test(unit.startedFingerprint)) || unit.checkpointId !== void 0 && typeof unit.checkpointId !== "string" || unit.beginNonce !== void 0 && (typeof unit.beginNonce !== "string" || unit.beginNonce.trim().length === 0)) {
      throw new DevFlowError("INVALID_STATE_SCHEMA", "implementation unit state is invalid");
    }
    const started = unit.startedFingerprint !== void 0;
    const checkpointed = unit.checkpointId !== void 0;
    const hasNonce = unit.beginNonce !== void 0;
    const consistent = unit.status === "pending" && !started && !checkpointed && !hasNonce || (unit.status === "active" || unit.status === "verified") && started && !checkpointed || (unit.status === "checkpointed" || unit.status === "rolled_back") && started && checkpointed;
    if (!consistent) throw new DevFlowError("INVALID_STATE_SCHEMA", "implementation unit status is inconsistent with its fields");
    if (ids.has(unit.unitId)) throw new DevFlowError("INVALID_STATE_SCHEMA", "implementation units duplicate a rollback unit");
    if (checkpointed && checkpoints.has(unit.checkpointId)) throw new DevFlowError("INVALID_STATE_SCHEMA", "implementation units duplicate a checkpoint id");
    ids.add(unit.unitId);
    if (checkpointed) checkpoints.add(unit.checkpointId);
  }
}
function validateFeatureState(value) {
  const state = value;
  if (state.schemaVersion === 1 || state.schemaVersion === 2) throw new DevFlowError("LEGACY_STATE_UNSUPPORTED", "\u65E7\u7248 feature \u72B6\u6001\u4E0D\u53D7 4.0 \u8FD0\u884C\u65F6\u652F\u6301\u3002", { userMessage: "\u5F53\u524D feature \u4F7F\u7528\u65E7\u7248\u72B6\u6001\uFF0C\u4E0D\u80FD\u5728 Dev Flow 4.0 \u4E2D\u7EE7\u7EED\u3002", cause: "\u68C0\u6D4B\u5230 schema v1/v2 \u72B6\u6001\u3002", impact: "\u7CFB\u7EDF\u4E0D\u4F1A\u8FC1\u79FB\u3001\u8986\u76D6\u6216\u731C\u6D4B\u65E7\u72B6\u6001\u3002", recoveryKind: "repair", recoveryInstruction: "\u8FD0\u884C doctor \u67E5\u770B\u7ED3\u675F\u6D4B\u8BD5\u72B6\u6001\u6216\u6E05\u7406 fixture \u7684\u8BF4\u660E\uFF0C\u7136\u540E\u91CD\u65B0\u5F00\u59CB\u4EFB\u52A1\u3002", retryOriginal: false });
  if (state?.schemaVersion !== 3) throw new DevFlowError("UNSUPPORTED_STATE_SCHEMA", "\u5F53\u524D\u53EA\u652F\u6301 schema v3 \u72B6\u6001\u3002", { userMessage: "\u5F53\u524D feature \u72B6\u6001\u7248\u672C\u4E0D\u53D7\u652F\u6301\u3002", cause: "\u72B6\u6001\u4E0D\u662F schema v3\u3002", impact: "\u6D41\u7A0B\u5DF2\u505C\u6B62\uFF0C\u907F\u514D\u5728\u672A\u77E5\u72B6\u6001\u4E0A\u7EE7\u7EED\u5199\u5165\u3002", recoveryKind: "repair", recoveryInstruction: "\u8FD0\u884C doctor \u68C0\u67E5\u72B6\u6001\uFF0C\u5E76\u91CD\u65B0\u5F00\u59CB\u4E00\u4E2A v3 feature\u3002", retryOriginal: false });
  if (state.mode !== "intake" && state.mode !== "routed") throw new DevFlowError("INVALID_STATE_SCHEMA", "state mode must be intake or routed");
  if (typeof state.featureId !== "string" || !state.featureId || !Number.isInteger(state.revision) || (state.revision ?? -1) < 0 || !lifecycles.has(state.lifecycle) || !state.scope || !Array.isArray(state.scope.inScope) || !Array.isArray(state.scope.outOfScope) || !state.steps || !state.humanGates || !state.artifacts || !state.verification || !Array.isArray(state.verification.attempts) || state.interactions !== void 0 && (typeof state.interactions !== "object" || state.interactions === null || Array.isArray(state.interactions)) || !state.featureCheck || !Array.isArray(state.blockingFindings) || typeof state.logicComplete !== "boolean" || !state.lastUpdatedBy || !state.workspace || !state.evidenceFreshness || !Array.isArray(state.qualityExceptions)) {
    throw new DevFlowError("INVALID_STATE_SCHEMA", "state is not a valid v3 feature state");
  }
  if (!isHostId(state.lastUpdatedBy.host)) throw new DevFlowError("INVALID_STATE_SCHEMA", "lastUpdatedBy host is invalid");
  const pendingInteractions = Object.values(state.interactions ?? {}).filter((item) => item.status === "pending");
  if (pendingInteractions.length > 1) throw new DevFlowError("MULTIPLE_PENDING_DECISIONS", "v3 state contains more than one pending decision", { userMessage: "\u5F53\u524D\u72B6\u6001\u540C\u65F6\u5B58\u5728\u591A\u4E2A\u5F85\u51B3\u95EE\u9898\uFF0C\u6D41\u7A0B\u5DF2\u5B89\u5168\u505C\u6B62\u3002", cause: "\u51B3\u7B56\u8D26\u672C\u4E0D\u662F\u5355\u4E00\u5F85\u51B3\u95EE\u9898\u3002", impact: "\u7CFB\u7EDF\u4E0D\u4F1A\u4EFB\u9009\u4E00\u4E2A\u95EE\u9898\u6D88\u8D39\u3002", recoveryKind: "repair", recoveryInstruction: "\u8FD0\u884C doctor \u68C0\u67E5\u51B3\u7B56\u8D26\u672C\uFF0C\u7136\u540E\u901A\u8FC7\u516C\u5F00\u56DE\u7B54\u63A5\u53E3\u6062\u590D\u3002", retryOriginal: false });
  if (state.pendingDecision !== void 0) {
    const decision = state.pendingDecision;
    if (!decision || decision.source !== "core" || typeof decision.question !== "string" || !decision.question.trim() || !/^[a-f0-9]{64}$/.test(decision.basisHash) || !Number.isInteger(decision.presentedRevision) || !Array.isArray(decision.options) || decision.options.length < 2 || decision.options.length > 3 || decision.options.some((option) => !option || typeof option.id !== "string" || typeof option.label !== "string" || !option.label.trim())) {
      throw new DevFlowError("INVALID_STATE_SCHEMA", "pendingDecision is invalid");
    }
  }
  const workspace = state.workspace;
  if (!workspace || typeof workspace.baseHead !== "string" || typeof workspace.baseBranch !== "string" || typeof workspace.observedHead !== "string" || typeof workspace.lastWorkspaceFingerprint !== "string" || !["current", "required", "blocked"].includes(workspace.reconciliationStatus) || typeof workspace.startedDirty !== "object" || workspace.startedDirty === null || Array.isArray(workspace.startedDirty) || typeof workspace.ownership !== "object" || workspace.ownership === null || Array.isArray(workspace.ownership) || typeof workspace.ownershipSource !== "object" || workspace.ownershipSource === null || Array.isArray(workspace.ownershipSource) || !Array.isArray(workspace.observedCommits)) {
    throw new DevFlowError("INVALID_STATE_SCHEMA", "workspace lineage is invalid");
  }
  if (state.lifecycle === "finalized" && !state.deliverySnapshot) throw new DevFlowError("INVALID_STATE_SCHEMA", "finalized v3 state requires a delivery result");
  if (state.lifecycle === "abandoned" && !state.abandonment) throw new DevFlowError("INVALID_STATE_SCHEMA", "abandoned v3 state requires a user reason");
  if (state.mode === "intake") {
    if (state.route !== void 0 || state.classification !== void 0 || state.classificationBasis !== void 0 || state.obligations !== void 0) {
      throw new DevFlowError("INVALID_STATE_SCHEMA", "intake state cannot contain route or classification fields");
    }
    if (state.decisionLedger !== void 0 && (!Array.isArray(state.decisionLedger) || state.decisionLedger.some((decision) => !decision || typeof decision.id !== "string"))) {
      throw new DevFlowError("INVALID_STATE_SCHEMA", "decisionLedger is invalid");
    }
    return;
  }
  if (!state.route || !routeDefinition(state.route) || !state.classification || !state.classificationBasis || !Array.isArray(state.obligations)) {
    throw new DevFlowError("INVALID_STATE_SCHEMA", "routed v3 state requires classification facts and obligations");
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
  if (traceEnforcementRequired(state.route, state.workflowCapabilities) && !state.traceability) {
    throw new DevFlowError("INVALID_STATE_SCHEMA", "trace-enforced standard feature requires a traceability pointer");
  }
  if (state.review !== void 0) {
    const pointer = state.review;
    if (typeof pointer !== "object" || pointer === null || !/^review\/snapshots\/[a-f0-9]{64}\.json$/.test(pointer.path) || !/^[a-f0-9]{64}$/.test(pointer.sha256) || pointer.path !== `review/snapshots/${pointer.sha256}.json` || !Number.isInteger(pointer.revision) || pointer.revision < 0 || !pointer.summary || !["batches", "current", "stale", "open", "complete"].every((key) => Number.isInteger(pointer.summary[key]) && pointer.summary[key] >= 0)) {
      throw new DevFlowError("INVALID_STATE_SCHEMA", "review pointer is invalid");
    }
  }
  if (reviewEnforcementRequired(state.route, state.workflowCapabilities) && !state.review) {
    throw new DevFlowError("INVALID_STATE_SCHEMA", "review-enabled standard feature requires a review pointer");
  }
  if (state.implementationUnits !== void 0) validateImplementationUnits(state.implementationUnits);
  if (state.rollbackGate !== void 0) {
    const gate = state.rollbackGate;
    if (typeof gate !== "object" || gate === null || gate.status !== "pending" && gate.status !== "confirmed" || typeof gate.targetCheckpointId !== "string" || typeof gate.targetUnitId !== "string" || !/^[a-f0-9]{64}$/.test(gate.previewBasisHash) || typeof gate.interactionId !== "string" || typeof gate.stateRevision !== "number" || !Number.isInteger(gate.stateRevision) || gate.stateRevision < 0 || typeof gate.presentedAt !== "string" || gate.confirmedAt !== void 0 && typeof gate.confirmedAt !== "string") {
      throw new DevFlowError("INVALID_STATE_SCHEMA", "rollbackGate is invalid");
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
var devFlow = (root2) => path8.join(root2, ".dev-flow");
var features = (root2) => path8.join(devFlow(root2), "features");
var statePath = (root2, id) => path8.join(features(root2), id, "state.json");
var eventPath = (root2, id) => path8.join(features(root2), id, "events.jsonl");
var activePath = (root2) => path8.join(devFlow(root2), "active.json");
var recoveryTxnPath = (root2) => path8.join(devFlow(root2), "recovery-transaction.json");
var recoveryEventsPath = (root2) => path8.join(devFlow(root2), "recovery-events.jsonl");
var rollbackTxnPath = (root2, featureId) => path8.join(features(root2), featureId, "rollback-transaction.json");
async function readProjectConfig(root2) {
  try {
    const value = JSON.parse(await readFile6(path8.join(devFlow(root2), "project.json"), "utf8"));
    validateProjectConfig(value);
    return value;
  } catch (error) {
    if (error instanceof DevFlowError) throw error;
    throw new DevFlowError("PROJECT_NOT_INITIALIZED", "run dev_flow_init_project first");
  }
}
async function initProject(root2, config) {
  validateProjectConfig(config);
  await mkdir4(devFlow(root2), { recursive: true });
  await writeAtomic(path8.join(devFlow(root2), "project.json"), config);
}
async function writeAtomic(file, value) {
  const temp = `${file}.${randomUUID4()}.tmp`;
  const handle = await open4(temp, "w");
  try {
    await handle.writeFile(`${JSON.stringify(value, null, 2)}
`);
    await handle.sync();
  } finally {
    await handle.close();
  }
  await rename4(temp, file);
  const directory = await open4(path8.dirname(file), "r");
  try {
    await directory.sync();
  } finally {
    await directory.close();
  }
}
async function prepareStatusProjection(root2, state, revision) {
  const status = state.artifacts.status;
  if (!status) return;
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
    ...routeDefinitionForFeature(state.route, state.workflowCapabilities).orderedSteps.map((step) => `- ${step}: ${state.steps[step]?.status ?? "pending"}`),
    "",
    ...traceLines
  ].join("\n");
  const contents = `${projection}
`;
  const file = path8.join(features(root2), state.featureId, status.path);
  state.artifacts.status = { ...status, sha256: createHash8("sha256").update(contents).digest("hex") };
  return async () => {
    await writeFile(file, contents);
  };
}
async function lock(root2, featureId, operation) {
  const directory = path8.join(devFlow(root2), ".lock");
  const started = Date.now();
  await mkdir4(devFlow(root2), { recursive: true });
  while (true) {
    try {
      await mkdir4(directory);
      await writeFile(path8.join(directory, "owner.json"), JSON.stringify({ pid: process.pid, hostname: hostname(), acquiredAt: (/* @__PURE__ */ new Date()).toISOString(), featureId, operation }));
      return async () => {
        await rm(directory, { recursive: true, force: true });
      };
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
      try {
        const owner = JSON.parse(await readFile6(path8.join(directory, "owner.json"), "utf8"));
        const age = Date.now() - Date.parse(owner.acquiredAt);
        let live = owner.hostname === hostname();
        if (live) {
          try {
            process.kill(owner.pid, 0);
          } catch {
            live = false;
          }
        }
        if (!live && age > 3e4) {
          await rm(directory, { recursive: true, force: true });
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
    const state = JSON.parse(await readFile6(statePath(root2, featureId), "utf8"));
    validateFeatureState(state);
    if (state.featureId !== featureId) throw new DevFlowError("INVALID_STATE_SCHEMA", "state feature id does not match its path");
    return state;
  } catch (error) {
    if (error instanceof DevFlowError) throw error;
    if (error.code === "ENOENT") throw new DevFlowError("FEATURE_NOT_FOUND", `feature ${featureId} does not exist`);
    throw new DevFlowError("INVALID_STATE_SCHEMA", `feature ${featureId} state is unreadable`, {
      recoveryHint: "Run dev_flow_doctor; if corrupt, use dev_flow_recover_corrupt_feature then start a new feature"
    });
  }
}
async function readActive(root2) {
  let raw;
  try {
    raw = await readFile6(activePath(root2), "utf8");
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
    throw new DevFlowError("ACTIVE_POINTER_INCONSISTENT", "active pointer does not match the active v3 feature revision", {
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
  const handle = await open4(eventPath(root2, id), "a");
  try {
    await handle.writeFile(`${JSON.stringify({ revision, type, at: (/* @__PURE__ */ new Date()).toISOString(), data })}
`);
    await handle.sync();
  } finally {
    await handle.close();
  }
}
async function stateFileSha256(root2, featureId) {
  const contents = await readFile6(statePath(root2, featureId));
  return createHash8("sha256").update(contents).digest("hex");
}
async function readFeatureEvents(root2, id) {
  try {
    return (await readFile6(eventPath(root2, id), "utf8")).split("\n").filter(Boolean).map((line) => JSON.parse(line));
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }
}
async function startFeature(root2, input, options = {}) {
  await readProjectConfig(root2);
  await assertNoOpenRecovery(root2);
  await assertNoOpenRollbackTransaction(root2);
  const scope = validateScopeInput(input.scope);
  const id = input.featureId ?? randomUUID4();
  const release = await lock(root2, id, "start");
  try {
    await assertNoOpenRecovery(root2);
    await assertNoOpenRollbackTransaction(root2);
    const active = await readActive(root2);
    const lifecycle = input.activation ?? "active";
    if (lifecycle === "active" && active) {
      const activeState = await readState(root2, active.featureId);
      if (!activeState.pendingDecision) {
        const pendingState = structuredClone(activeState);
        pendingState.pendingDecision = {
          kind: "task-switch",
          question: "\u5F53\u524D\u5DF2\u6709\u4E00\u4E2A\u8FDB\u884C\u4E2D\u7684\u4EFB\u52A1\u3002\u5F00\u59CB\u65B0\u4EFB\u52A1\u524D\uFF0C\u4F60\u5E0C\u671B\u5982\u4F55\u5904\u7406\u65E7\u4EFB\u52A1\uFF1F",
          options: [
            { id: "finish-old", label: "\u5148\u5B8C\u6210\u5F53\u524D\u4EFB\u52A1", recommended: true },
            { id: "pause-old", label: "\u6682\u505C\u5F53\u524D\u4EFB\u52A1\u540E\u5F00\u59CB\u65B0\u4EFB\u52A1" },
            { id: "return-old", label: "\u8FD4\u56DE\u5F53\u524D\u4EFB\u52A1" }
          ],
          basisHash: createHash8("sha256").update(`${active.featureId}
${objectiveForSwitch(input)}`).digest("hex"),
          presentedAt: (/* @__PURE__ */ new Date()).toISOString(),
          presentedRevision: activeState.revision,
          source: "core",
          target: `task-switch:${id}`
        };
        pendingState.revision += 1;
        validateFeatureState(pendingState);
        await writeAtomic(statePath(root2, active.featureId), pendingState);
        await appendEvent(root2, active.featureId, pendingState.revision, "task-switch-presented", { targetFeatureId: id });
        await writeAtomic(activePath(root2), { featureId: active.featureId, revision: pendingState.revision, updatedAt: (/* @__PURE__ */ new Date()).toISOString() });
      }
      throw new DevFlowError("TASK_SWITCH_REQUIRED", "\u53E6\u4E00\u4E2A feature \u5F53\u524D\u5904\u4E8E active \u72B6\u6001\u3002", {
        userMessage: "\u5F53\u524D\u5DF2\u6709\u4E00\u4E2A\u8FDB\u884C\u4E2D\u7684\u4EFB\u52A1\uFF0C\u8BF7\u5148\u51B3\u5B9A\u5982\u4F55\u5904\u7406\u5B83\u3002",
        cause: "\u7CFB\u7EDF\u4E0D\u4F1A\u540E\u53F0 finalize\u3001\u6682\u505C\u3001\u7EC8\u6B62\u6216\u5207\u6362\u65E7\u4EFB\u52A1\u3002",
        impact: "\u65B0\u4EFB\u52A1\u5C1A\u672A\u521B\u5EFA\uFF0C\u4E5F\u6CA1\u6709\u6539\u53D8\u65E7\u4EFB\u52A1\u7684\u6267\u884C\u72B6\u6001\u3002",
        recoveryKind: "ask-user",
        recoveryInstruction: "\u8BF7\u901A\u8FC7 dev_flow_answer \u9010\u9898\u9009\u62E9\u5904\u7406\u65E7\u4EFB\u52A1\u7684\u65B9\u5F0F\u3002",
        requiresUserDecision: true,
        retryOriginal: false,
        activeFeatureId: active.featureId
      });
    }
    const objective = typeof input.objective === "string" && input.objective.trim().length > 0 ? input.objective.trim() : "\u672A\u547D\u540D\u9700\u6C42";
    const project = await readProjectConfig(root2);
    const startBusinessFingerprint = await fingerprintProtectedRoots(root2, project);
    const directory = path8.join(features(root2), id);
    const existedBefore = await pathExists(directory);
    let stateCommitted = false;
    try {
      await mkdir4(directory, { recursive: true });
      const workflowCapabilities = normalizeWorkflowCapabilities(SUPPORTED_WORKFLOW_CAPABILITIES);
      const capturedWorkspace = ownershipForScope(await captureWorkspaceLineage(root2, project), scope.inScope, scope.outOfScope);
      const deliveryBaseline = {
        gitHead: capturedWorkspace.baseHead || void 0,
        dirtyPaths: Object.keys(capturedWorkspace.startedDirty),
        baseBranch: capturedWorkspace.baseBranch,
        startedDirty: capturedWorkspace.startedDirty
      };
      const state = {
        schemaVersion: 3,
        mode: "intake",
        featureId: id,
        revision: 0,
        lifecycle,
        objective,
        scope,
        workspace: capturedWorkspace,
        evidenceFreshness: { review: "missing", verification: "missing", checkpoint: "missing", implementation: "missing" },
        qualityExceptions: [],
        steps: {},
        humanGates: {},
        artifacts: {},
        verification: { attempts: [] },
        interactions: {},
        workflowCapabilities,
        checkpoints: [],
        featureCheck: {},
        startBusinessFingerprint,
        deliveryBaseline,
        decisionLedger: [],
        blockingFindings: [],
        logicComplete: false,
        lastUpdatedBy: { host: input.host, pluginVersion: "4.1.0" }
      };
      const ownershipPath = Object.keys(capturedWorkspace.startedDirty).find((file) => capturedWorkspace.ownership[file] === void 0);
      if (ownershipPath) {
        state.pendingDecision = {
          kind: "workspace-ownership",
          question: `\u542F\u52A8\u524D\u5DF2\u53D1\u73B0\u8DEF\u5F84\u201C${ownershipPath}\u201D\u5B58\u5728\u6539\u52A8\u3002\u5B83\u662F\u5426\u5C5E\u4E8E\u5F53\u524D\u4EFB\u52A1\uFF1F`,
          options: [
            { id: "adopt", label: "\u7EB3\u5165\u5F53\u524D\u4EFB\u52A1", recommended: true },
            { id: "exclude", label: "\u5148\u5904\u7406\u540E\u7EE7\u7EED" }
          ],
          basisHash: createHash8("sha256").update(`${id}
${ownershipPath}
${capturedWorkspace.lastWorkspaceFingerprint}`).digest("hex"),
          presentedAt: (/* @__PURE__ */ new Date()).toISOString(),
          presentedRevision: 0,
          source: "core",
          target: `workspace:${ownershipPath}`
        };
      }
      validateFeatureState(state);
      await options.fault?.("before-state-commit");
      await writeAtomic(statePath(root2, id), state);
      stateCommitted = true;
      const failures = [];
      try {
        await options.fault?.("after-state-commit");
      } catch {
        failures.push("after-state-commit");
      }
      try {
        await options.fault?.("before-event");
        await appendEvent(root2, id, state.revision, "started", { lifecycle, mode: state.mode, objective });
      } catch {
        failures.push("event");
      }
      if (lifecycle === "active") {
        try {
          await options.fault?.("before-active");
          await writeAtomic(activePath(root2), { featureId: id, revision: state.revision, updatedAt: (/* @__PURE__ */ new Date()).toISOString() });
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
      if (!stateCommitted && !existedBefore) await rm(directory, { recursive: true, force: true });
      throw error;
    }
  } finally {
    await release();
  }
}
function objectiveForSwitch(input) {
  return typeof input.objective === "string" ? input.objective.trim() : "\u672A\u547D\u540D\u9700\u6C42";
}
async function lockClassification(root2, id, expectedRevision, facts) {
  const selected = selectBaseRoute(facts);
  if (selected.contradictions.length) {
    throw new DevFlowError("CLASSIFICATION_CONTRADICTION", "classification facts contain unresolved contradictions", { contradictions: selected.contradictions });
  }
  const release = await lock(root2, id, "lock-classification");
  try {
    const current = await readState(root2, id);
    if (current.revision !== expectedRevision) throw new DevFlowError("STATE_REVISION_CONFLICT", "state revision changed", { currentRevision: current.revision });
    if (current.mode !== "intake") throw new DevFlowError("CLASSIFICATION_ALREADY_LOCKED", "classification is already locked");
    const decisionRefs = new Set(facts.decisionRefs);
    const openDecisions = (current.decisionLedger ?? []).filter((decision) => decision.status === "open" && (decisionRefs.has(decision.id) || decisionRefs.size === 0));
    if (openDecisions.length) throw new DevFlowError("OPEN_CLASSIFICATION_DECISIONS", "classification-affecting decisions remain open", { decisionIds: openDecisions.map((decision) => decision.id), recoveryHint: "Resolve the listed decisions with grillme, then retry lock" });
    const project = await readProjectConfig(root2);
    const capabilities = normalizeWorkflowCapabilities(SUPPORTED_WORKFLOW_CAPABILITIES);
    return mutatePreparedLocked(root2, id, expectedRevision, "classification-locked", async (_current, nextRevision) => {
      const definition = routeDefinitionForFeature(selected.route, capabilities);
      const traceability = traceEnforcementRequired(selected.route, capabilities) ? await writeTraceSnapshot(root2, emptyTraceabilityLedger(id, nextRevision, (await readProjectConfigSnapshot(root2)).sha256)) : void 0;
      const review2 = reviewEnforcementRequired(selected.route, capabilities) ? await writeReviewSnapshot(root2, emptyReviewLedger(id, nextRevision)) : void 0;
      return { mutate: (draft) => {
        draft.schemaVersion = 3;
        draft.mode = "routed";
        draft.route = selected.route;
        draft.classification = selected.classification;
        draft.classificationBasis = selected.classificationBasis;
        draft.obligations = selected.obligations;
        draft.currentStage = definition.orderedSteps[0];
        draft.workflowCapabilities = capabilities;
        draft.steps = Object.fromEntries(definition.orderedSteps.map((step) => [step, { status: "pending" }]));
        draft.humanGates = {};
        draft.artifacts = {};
        draft.verification = { attempts: [] };
        draft.featureCheck = {};
        draft.logicComplete = false;
        if (traceability) draft.traceability = traceability;
        if (review2) draft.review = review2;
        void project;
      } };
    });
  } finally {
    await release();
  }
}
async function recordDecision(root2, id, expectedRevision, question, factRefs = [], host) {
  const decision = createDecision(question, factRefs);
  return mutate(root2, id, expectedRevision, "decision-opened", (draft) => {
    const ledger = draft.decisionLedger ?? [];
    if (ledger.some((candidate) => candidate.id === decision.id)) return;
    draft.decisionLedger = [...ledger, decision];
    draft.lastUpdatedBy = { host, pluginVersion: "4.1.0" };
  }, { decisionId: decision.id });
}
async function resolveRecordedDecision(root2, id, expectedRevision, decisionId, evidence, conclusion, host) {
  return mutate(root2, id, expectedRevision, "decision-resolved", (draft) => {
    const ledger = draft.decisionLedger ?? [];
    const index = ledger.findIndex((decision) => decision.id === decisionId);
    if (index < 0) throw new DevFlowError("DECISION_NOT_FOUND", decisionId);
    const next = [...ledger];
    next[index] = resolveDecision(next[index], evidence, conclusion);
    draft.decisionLedger = next;
    draft.lastUpdatedBy = { host, pluginVersion: "4.1.0" };
  }, { decisionId });
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
  await writeAtomic(statePath(root2, id), state);
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
    if (active?.featureId === id && (state.lifecycle === "finalized" || state.lifecycle === "abandoned" || state.lifecycle === "paused")) await rm(activePath(root2), { force: true });
    else if (state.lifecycle === "active" && (active?.featureId === id || operation === "feature-resumed")) await writeAtomic(activePath(root2), { featureId: id, revision: state.revision, updatedAt: (/* @__PURE__ */ new Date()).toISOString() });
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
    state.resumeSummary = `\u6682\u505C\u539F\u56E0\uFF1A${reason.trim()}\u3002\u6062\u590D\u540E\u5148\u5BF9\u8D26\u5DE5\u4F5C\u533A\uFF0C\u518D\u4ECE${state.currentStage ? `\u201C${state.currentStage}\u201D` : "\u5F53\u524D\u9636\u6BB5"}\u7EE7\u7EED\u3002`;
    state.lastUpdatedBy = { host, pluginVersion: "4.1.0" };
  }, { reason: reason.trim() });
}
async function reconcileWorkspace(root2, id, expectedRevision, host) {
  const state = await readState(root2, id);
  const config = await readProjectConfig(root2);
  const { workspace, contentChanged } = await reconcileWorkspaceForFeature(root2, state, config);
  return mutate(root2, id, expectedRevision, "workspace-reconciled", (draft) => {
    draft.workspace = workspace;
    if (contentChanged) {
      markEvidenceStale(draft);
    }
    draft.lastUpdatedBy = { host, pluginVersion: "4.1.0" };
  }, { observedHead: workspace.observedHead, commitCount: workspace.observedCommits.length, manualAdoptionCount: Object.values(workspace.ownershipSource).filter((source) => source === "manual-commit").length });
}
function markEvidenceStale(draft) {
  draft.evidenceFreshness = {
    ...draft.evidenceFreshness,
    review: "stale",
    verification: "stale",
    checkpoint: "stale",
    implementation: "stale"
  };
  draft.qualityExceptions = draft.qualityExceptions.map((exception) => ({ ...exception, status: "stale" }));
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
  const { workspace, contentChanged } = await reconcileWorkspaceForFeature(root2, current, config);
  return mutate(root2, id, current.revision, "feature-resumed", (state) => {
    state.lifecycle = "active";
    state.workspace = workspace;
    if (contentChanged) {
      markEvidenceStale(state);
    }
    state.resumeSummary = `\u5DF2\u6062\u590D${state.currentStage ? `\uFF0C\u4ECE\u201C${state.currentStage}\u201D\u7EE7\u7EED` : "\u5F53\u524D\u4EFB\u52A1"}\u3002${contentChanged ? "\u5DE5\u4F5C\u533A\u5185\u5BB9\u6709\u53D8\u5316\uFF0C\u76F8\u5173\u8BC1\u636E\u5DF2\u6807\u8BB0\u4E3A\u5F85\u66F4\u65B0\u3002" : ""}`;
    state.lastUpdatedBy = { host, pluginVersion: "4.1.0" };
  }, { observedHead: workspace.observedHead, contentChanged });
}
async function abandonFeature(root2, id, expectedRevision, reason, userEvidence) {
  if (!reason || !userEvidence) throw new DevFlowError("ABANDON_EVIDENCE_REQUIRED", "abandon requires reason and user evidence");
  return mutate(root2, id, expectedRevision, "abandoned", async (state) => {
    if (state.lifecycle === "finalized" || state.lifecycle === "abandoned") throw new DevFlowError("INVALID_LIFECYCLE", "terminal feature cannot be abandoned");
    state.lifecycle = "abandoned";
    state.abandonment = { reason: reason.trim(), userEvidence: userEvidence.trim(), at: (/* @__PURE__ */ new Date()).toISOString() };
  }, { reason, userEvidence });
}
function isRecoveryPhase(value) {
  return value === "prepared" || value === "directory-moved" || value === "active-cleared" || value === "completed";
}
function validateRecoveryTransaction(value) {
  const transaction = value;
  if (transaction?.schemaVersion !== 1 || typeof transaction.transactionId !== "string" || !transaction.transactionId || !isRecoveryPhase(transaction.phase) || typeof transaction.featureId !== "string" || !transaction.featureId || typeof transaction.stateSha256 !== "string" || !transaction.stateSha256 || typeof transaction.recoveredTo !== "string" || !path8.isAbsolute(transaction.recoveredTo) || typeof transaction.reason !== "string" || typeof transaction.userEvidence !== "string" || !isHostId(transaction.host) || typeof transaction.at !== "string" || transaction.activeSha256 !== void 0 && typeof transaction.activeSha256 !== "string") {
    throw new DevFlowError("RECOVERY_TRANSACTION_UNREADABLE", "recovery journal is invalid", {
      recoveryHint: "Run dev_flow_doctor; do not start a new feature or hand-edit .dev-flow"
    });
  }
  if (path8.basename(transaction.featureId) !== transaction.featureId || transaction.featureId === "." || transaction.featureId === "..") {
    throw new DevFlowError("RECOVERY_TRANSACTION_UNREADABLE", "recovery journal has an unsafe feature id", { recoveryHint: "Run dev_flow_doctor; recovery remains fail-closed" });
  }
}
function validateRecoveryLocation(root2, transaction) {
  const recoveredRoot = path8.join(devFlow(root2), "recovered");
  const relative = path8.relative(recoveredRoot, transaction.recoveredTo);
  if (!relative || relative.startsWith("..") || path8.isAbsolute(relative) || path8.basename(relative) !== relative) {
    throw new DevFlowError("RECOVERY_TRANSACTION_UNREADABLE", "recovery journal points outside the recovered directory", {
      recoveryHint: "Run dev_flow_doctor; do not start a new feature or hand-edit .dev-flow"
    });
  }
}
async function readRecoveryTransaction(root2) {
  let raw;
  try {
    raw = await readFile6(recoveryTxnPath(root2), "utf8");
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
async function pathExists(file) {
  try {
    await access(file);
    return true;
  } catch {
    return false;
  }
}
async function fileSha256(file) {
  return createHash8("sha256").update(await readFile6(file)).digest("hex");
}
async function updateRecoveryTransaction(root2, transaction, phase) {
  const next = { ...transaction, phase, ...phase === "completed" ? { completedAt: (/* @__PURE__ */ new Date()).toISOString() } : {} };
  await writeAtomic(recoveryTxnPath(root2), next);
  return next;
}
async function recoveryEventExists(root2, transactionId) {
  try {
    return (await readFile6(recoveryEventsPath(root2), "utf8")).split("\n").filter(Boolean).some((line) => {
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
  const handle = await open4(recoveryEventsPath(root2), "a");
  try {
    await handle.writeFile(`${JSON.stringify({ ...transaction, phase: "completed", completedAt: (/* @__PURE__ */ new Date()).toISOString() })}
`);
    await handle.sync();
  } finally {
    await handle.close();
  }
}
async function resumeRecovery(root2, transaction) {
  const sourceDir = path8.join(features(root2), transaction.featureId);
  if (transaction.phase === "prepared") {
    const [sourceExists, recoveredExists] = await Promise.all([pathExists(sourceDir), pathExists(transaction.recoveredTo)]);
    if (sourceExists === recoveredExists) throw new DevFlowError("RECOVERY_TRANSACTION_INCONSISTENT", "cannot safely determine feature-directory recovery stage", { recoveryHint: "Run dev_flow_doctor; do not start a new feature" });
    if (sourceExists) await rename4(sourceDir, transaction.recoveredTo);
    transaction = await updateRecoveryTransaction(root2, transaction, "directory-moved");
  }
  if (transaction.phase === "directory-moved") {
    if (transaction.activeSha256) {
      if (await pathExists(activePath(root2))) {
        if (await fileSha256(activePath(root2)) !== transaction.activeSha256) {
          throw new DevFlowError("RECOVERY_POINTER_DIGEST_MISMATCH", "active pointer changed during recovery", { recoveryHint: "Run dev_flow_doctor; recovery remains fail-closed" });
        }
        await rename4(activePath(root2), path8.join(transaction.recoveredTo, "active.json"));
      }
    } else {
      const active = await readActive(root2);
      if (active && active.featureId !== transaction.featureId) {
        throw new DevFlowError("RECOVERY_TRANSACTION_INCONSISTENT", "active pointer changed during recovery", { recoveryHint: "Run dev_flow_doctor; do not start a new feature" });
      }
      if (active?.featureId === transaction.featureId) await rm(activePath(root2), { force: true });
    }
    transaction = await updateRecoveryTransaction(root2, transaction, "active-cleared");
  }
  if (transaction.phase === "active-cleared") {
    await appendRecoveryEvent(root2, transaction);
    transaction = await updateRecoveryTransaction(root2, transaction, "completed");
  }
  if (transaction.phase === "completed") await rm(recoveryTxnPath(root2), { force: true });
  return { recoveredTo: transaction.recoveredTo, featureId: transaction.featureId, stateSha256: transaction.stateSha256 };
}
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
    return true;
  });
  if (transaction?.schemaVersion !== 1 || typeof transaction.transactionId !== "string" || !transaction.transactionId || typeof transaction.featureId !== "string" || !transaction.featureId || !rollbackTransactionPhases.has(transaction.phase) || typeof transaction.targetCheckpointId !== "string" || !/^CP-[0-9]{3,}$/.test(transaction.targetCheckpointId) || typeof transaction.targetUnitId !== "string" || !/^RU-[0-9]{3,}$/.test(transaction.targetUnitId) || !Array.isArray(transaction.undoOrder) || transaction.undoOrder.length === 0 || !transaction.undoOrder.every((unitId) => typeof unitId === "string" && /^RU-[0-9]{3,}$/.test(unitId)) || transaction.undoCheckpoints !== void 0 && (!Array.isArray(transaction.undoCheckpoints) || !transaction.undoCheckpoints.every((id) => typeof id === "string" && /^CP-[0-9]{3,}$/.test(id))) || !isSha2562(transaction.previewBasisHash) || !isSha2562(transaction.projectConfigSha256) || !Number.isInteger(transaction.stateRevision) || (transaction.stateRevision ?? -1) < 0 || typeof transaction.backupDirectory !== "string" || !/^checkpoints\/recovery\/[^/]+$/.test(transaction.backupDirectory) || !Number.isInteger(transaction.nextFileIndex) || (transaction.nextFileIndex ?? -1) < 0 || !validPlan || !Array.isArray(transaction.verificationAttemptIds) || !transaction.verificationAttemptIds.every((id) => typeof id === "string" && id.length > 0) || typeof transaction.startedAt !== "string" || transaction.completedAt !== void 0 && typeof transaction.completedAt !== "string" || transaction.error !== void 0 && typeof transaction.error !== "string") {
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
    raw = await readFile6(rollbackTxnPath(root2, featureId), "utf8");
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
  await writeAtomic(rollbackTxnPath(root2, featureId), transaction);
}
async function assertNoOpenRollbackTransaction(root2, allow) {
  let entries;
  try {
    entries = await readdir4(features(root2), { withFileTypes: true });
  } catch (error) {
    if (error.code === "ENOENT") return;
    throw error;
  }
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const transaction = await readRollbackTransaction(root2, entry.name);
    if (!transaction || rollbackTransactionFinished(transaction)) continue;
    if (allow?.featureId === entry.name && allow.transactionId !== void 0 && allow.transactionId === transaction.transactionId) continue;
    throw new DevFlowError("ROLLBACK_TRANSACTION_OPEN", "a rollback transaction is open", {
      transactionId: transaction.transactionId,
      featureId: entry.name,
      phase: transaction.phase,
      recoveryHint: `Resume the rollback transaction for feature ${entry.name} with the same input before mutating features`
    });
  }
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
  return path8.join(features(root2), featureId, "checkpoints", "recovery", `${transactionId}-drive-lease.json`);
}
function legacyDriveLeasePath(root2, featureId, transactionId) {
  return path8.join(features(root2), featureId, "checkpoints", "recovery", transactionId, "drive-lease.json");
}
async function readLeaseAt(leaseFile, transactionId) {
  try {
    const raw = await readFile6(leaseFile, "utf8");
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
  await mkdir4(path8.dirname(legacyFile), { recursive: true });
  await mkdir4(path8.dirname(sidecarFile), { recursive: true });
  await writeAtomic(legacyFile, lease);
  await writeAtomic(sidecarFile, lease);
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
      ownerId: randomUUID4(),
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
      sidecar = JSON.parse(await readFile6(sidecarFile, "utf8"));
    } catch {
    }
    if (sidecar?.ownerId === lease.ownerId) {
      await rm(sidecarFile, { force: true });
    }
    try {
      const legacyExisting = JSON.parse(await readFile6(legacyFile, "utf8"));
      if (legacyExisting?.ownerId === lease.ownerId) {
        await rm(legacyFile, { force: true });
      }
    } catch {
    }
    try {
      await rmdir(path8.dirname(legacyFile));
    } catch {
    }
  } finally {
    await release();
  }
}
async function appendFeatureEvent(root2, id, revision, type, data) {
  await appendEvent(root2, id, revision, type, data);
}
async function recoverCorruptFeature(root2, input) {
  if (input.action !== "abandon") throw new DevFlowError("INVALID_RECOVERY_ACTION", "only abandon is supported in 1.3");
  if (!input.reason || !input.userEvidence) throw new DevFlowError("RECOVERY_EVIDENCE_REQUIRED", "reason and userEvidence are required");
  if (path8.basename(input.featureId) !== input.featureId || input.featureId === "." || input.featureId === "..") throw new DevFlowError("INVALID_FEATURE_ID", "recovery featureId must name one feature directory");
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
    let digest10;
    try {
      digest10 = await stateFileSha256(root2, input.featureId);
    } catch {
      throw new DevFlowError("RECOVERY_STATE_MISSING", "feature state file is missing", { recoveryHint: "Run dev_flow_doctor; recovery remains fail-closed" });
    }
    if (digest10 !== input.stateSha256) throw new DevFlowError("RECOVERY_DIGEST_MISMATCH", "stateSha256 does not match current corrupt state", { currentDigest: digest10, recoveryHint: "Re-run dev_flow_doctor and use the reported stateSha256" });
    try {
      const state = await readState(root2, input.featureId);
      if (!pointerRecovery || state.lifecycle !== "active") throw new DevFlowError("RECOVERY_STATE_VALID", "feature state is readable; use abandon instead of recovery");
    } catch (error) {
      if (error instanceof DevFlowError && error.code === "RECOVERY_STATE_VALID") throw error;
    }
    const timestamp = (/* @__PURE__ */ new Date()).toISOString().replace(/[:.]/g, "-");
    const recoveredDir = path8.join(devFlow(root2), "recovered", `${input.featureId}-${timestamp}`);
    await mkdir4(path8.join(devFlow(root2), "recovered"), { recursive: true });
    const prepared = {
      schemaVersion: 1,
      transactionId: randomUUID4(),
      phase: "prepared",
      featureId: input.featureId,
      stateSha256: digest10,
      recoveredTo: recoveredDir,
      reason: input.reason,
      userEvidence: input.userEvidence,
      host: input.host,
      at: (/* @__PURE__ */ new Date()).toISOString(),
      ...pointerRecovery ? { activeSha256: input.activeSha256 } : {}
    };
    await writeAtomic(recoveryTxnPath(root2), prepared);
    return resumeRecovery(root2, prepared);
  } finally {
    await release();
  }
}
var levelRank2 = { XS: 0, S: 1, M: 2, L: 3 };
var topologyRank = { local: 0, "shared-contract": 1, "multi-chain": 2, "coordinated-rollback": 3 };
var sameRisk = (a, b) => a.length === b.length && [...a].sort().every((value, index) => value === [...b].sort()[index]);
function isDowngrade(before, after) {
  const riskRemoved = before.riskLabels.some((risk) => !after.riskLabels.includes(risk));
  return levelRank2[after.level] < levelRank2[before.level] || topologyRank[after.topology] < topologyRank[before.topology] || before.execution === "standard" && after.execution === "light" || riskRemoved;
}
function applyRouteTransition(state, selected) {
  const previousRoute = state.route;
  const previousDefinition = routeDefinitionForFeature(previousRoute, state.workflowCapabilities);
  const nextDefinition = routeDefinitionForFeature(selected.route, state.workflowCapabilities);
  const previousArtifacts = /* @__PURE__ */ new Set([...previousDefinition.requiredArtifacts, ...previousDefinition.generatedArtifacts ?? []]);
  const nextArtifacts = /* @__PURE__ */ new Set([...nextDefinition.requiredArtifacts, ...nextDefinition.generatedArtifacts ?? []]);
  const retainedArtifacts = Object.fromEntries(Object.entries(state.artifacts).filter(([kind]) => previousArtifacts.has(kind) && nextArtifacts.has(kind)));
  const retainedSteps = {};
  for (const step of nextDefinition.orderedSteps) {
    if (["feature_check", "finalize", "verification"].includes(step)) break;
    if (state.steps[step]?.status !== "satisfied") break;
    retainedSteps[step] = state.steps[step];
  }
  const invalidatedSteps = Object.keys(state.steps).filter((step) => !retainedSteps[step]);
  const invalidatedArtifacts = Object.keys(state.artifacts).filter((kind) => !retainedArtifacts[kind]);
  state.classification = selected.classification;
  state.route = selected.route;
  state.artifacts = retainedArtifacts;
  state.steps = retainedSteps;
  state.humanGates = {};
  state.interactions = {};
  state.verification = { attempts: [] };
  state.featureCheck = {};
  state.logicComplete = false;
  return { previousRoute, invalidatedSteps, invalidatedArtifacts };
}
async function implementationApprovalWasPresented(root2, id) {
  let events;
  try {
    events = await readFeatureEvents(root2, id);
  } catch {
    throw new DevFlowError("RECLASSIFICATION_HISTORY_UNREADABLE", "cannot safely read gate history for downgrade", {
      recoveryHint: "Finish the current standard route or abandon and restart; do not downgrade with unreadable history"
    });
  }
  for (const event of events) {
    if (event.type !== "approval-presented" && event.type !== "approval-confirmed") continue;
    const approval = event.data?.approvalId ?? event.data?.approval;
    if (typeof approval !== "string") {
      throw new DevFlowError("RECLASSIFICATION_HISTORY_UNREADABLE", "a historical approval event has no obligation identity", {
        recoveryHint: "Finish the current standard route or abandon and restart; old ambiguous gate history cannot downgrade"
      });
    }
    if (approval.startsWith("approval:")) return true;
  }
  return false;
}
async function reclassifyFeature(root2, id, expectedRevision, next, reason, userEvidence) {
  if (!reason) throw new DevFlowError("RECLASSIFICATION_REASON_REQUIRED", "reclassify requires a reason");
  const release = await lock(root2, id, "reclassify");
  try {
    const initial = await readState(root2, id);
    if (initial.revision !== expectedRevision) throw new DevFlowError("STATE_REVISION_CONFLICT", "state revision changed", { currentRevision: initial.revision });
    const selectedAtLock = selectRoute(next);
    const historicalApproval = isDowngrade(initial.classification, selectedAtLock.classification) ? await implementationApprovalWasPresented(root2, id) : false;
    const project = await readProjectConfig(root2);
    const currentFingerprint = await fingerprintProtectedRoots(root2, project);
    let notice;
    let eventData = { reason };
    const state = await mutatePreparedLocked(root2, id, expectedRevision, "reclassified", async (current, nextStateRevision) => {
      const preparedTraceability = traceEnforcementRequired(selectedAtLock.route, current.workflowCapabilities) && !current.traceability ? await (async () => {
        const configSnapshot = await readProjectConfigSnapshot(root2);
        return writeTraceSnapshot(root2, emptyTraceabilityLedger(id, nextStateRevision, configSnapshot.sha256));
      })() : void 0;
      const preparedReview = reviewEnforcementRequired(selectedAtLock.route, current.workflowCapabilities) && !current.review ? await writeReviewSnapshot(root2, emptyReviewLedger(id, nextStateRevision)) : void 0;
      const reviewInvalidation = current.review && (selectedAtLock.route !== current.route || JSON.stringify(selectedAtLock.classification) !== JSON.stringify(current.classification)) ? await prepareReviewInvalidation(root2, current, nextStateRevision) : void 0;
      return { mutate: async (draft) => {
        if (draft.lifecycle !== "active") throw new DevFlowError("INVALID_LIFECYCLE", "only an active feature can be reclassified");
        const selected = selectRoute(next);
        if (preparedTraceability) draft.traceability = preparedTraceability;
        if (preparedReview) draft.review = preparedReview;
        if (reviewInvalidation) draft.review = reviewInvalidation;
        const before = draft.classification;
        const after = selected.classification;
        const downgrade = isDowngrade(before, after);
        if (!downgrade) {
          const riskRemoved = before.riskLabels.some((risk) => !after.riskLabels.includes(risk));
          if (riskRemoved) throw new DevFlowError("RECLASSIFICATION_NOT_STRICTER", "reclassification cannot lower level, topology, execution, or risk");
          const lessStrict = levelRank2[after.level] < levelRank2[before.level] || topologyRank[after.topology] < topologyRank[before.topology] || before.execution === "standard" && after.execution === "light";
          if (lessStrict) throw new DevFlowError("RECLASSIFICATION_NOT_STRICTER", "reclassification cannot lower level, topology, execution, or risk");
          const changed = selected.route !== draft.route || JSON.stringify(before) !== JSON.stringify(after);
          if (!changed) throw new DevFlowError("RECLASSIFICATION_NOT_STRICTER", "reclassification did not become stricter");
          const transition2 = applyRouteTransition(draft, selected);
          eventData = {
            before,
            after,
            previousRoute: transition2.previousRoute,
            nextRoute: selected.route,
            reason,
            invalidatedSteps: transition2.invalidatedSteps,
            invalidatedArtifacts: transition2.invalidatedArtifacts
          };
          return;
        }
        if (before.level !== after.level || before.topology !== after.topology || !sameRisk(before.riskLabels, after.riskLabels)) {
          throw new DevFlowError("RECLASSIFICATION_DOWNGRADE_FORBIDDEN", "1.3 only allows same level/topology/risk standard\u2192light", {
            recoveryHint: "Abandon and restart with a lighter classification if level must change"
          });
        }
        if (!(before.execution === "standard" && after.execution === "light")) {
          throw new DevFlowError("RECLASSIFICATION_DOWNGRADE_FORBIDDEN", "only standard\u2192light downgrade is allowed", {
            recoveryHint: "Abandon and restart with a lighter classification, or finish the current route"
          });
        }
        if (!userEvidence) {
          throw new DevFlowError("RECLASSIFICATION_EVIDENCE_REQUIRED", "downgrade requires userEvidence with the user's exact words", {
            recoveryHint: "Pass userEvidence containing the user's request to lighten the route"
          });
        }
        if (draft.steps.implementation?.status === "satisfied") {
          throw new DevFlowError("RECLASSIFICATION_DOWNGRADE_FORBIDDEN", "implementation already satisfied", {
            recoveryHint: "Finish the current standard route or abandon and restart"
          });
        }
        const approvalPresented = approvalIds(draft).some((approvalId2) => {
          const record = draft.humanGates[approvalId2];
          return record?.status === "pending" || record?.status === "returned" || record?.status === "confirmed";
        });
        if (historicalApproval || approvalPresented) {
          throw new DevFlowError("RECLASSIFICATION_DOWNGRADE_FORBIDDEN", "approval obligation already presented or confirmed", {
            recoveryHint: "Finish the current standard route or abandon and restart"
          });
        }
        if (!draft.startBusinessFingerprint) {
          throw new DevFlowError("RECLASSIFICATION_DOWNGRADE_FORBIDDEN", "missing startBusinessFingerprint baseline", {
            recoveryHint: "Old features without baseline cannot downgrade; abandon and restart"
          });
        }
        if (draft.startBusinessFingerprint !== currentFingerprint) {
          throw new DevFlowError("RECLASSIFICATION_PROTECTED_ROOTS_CHANGED", "protected roots changed since start", {
            recoveryHint: "Cannot downgrade after business files changed; finish the current standard route, or abandon and restart with a lighter classification"
          });
        }
        const transition = applyRouteTransition(draft, selected);
        eventData = {
          before,
          after,
          previousRoute: transition.previousRoute,
          nextRoute: selected.route,
          reason,
          userEvidence,
          invalidatedSteps: transition.invalidatedSteps,
          invalidatedArtifacts: transition.invalidatedArtifacts
        };
        notice = `Route switched to ${selected.route}. Previous docs remain on disk but are no longer registered evidence. Next: run the light route steps.`;
      }, eventData: () => eventData };
    });
    return notice ? { ...state, reclassifyNotice: notice } : state;
  } finally {
    await release();
  }
}

// plugins/dev-flow/src/core/traceability-anchors.ts
import { createHash as createHash9 } from "node:crypto";
var TRACE_ANCHOR = /<!-- dev-flow:id=(REQ|AC|TASK|TEST|RU)-([0-9]{3,}) kind=(requirement|acceptance-criterion|task|test|rollback) -->/g;
var expectedKind = {
  REQ: "requirement",
  AC: "acceptance-criterion",
  TASK: "task",
  TEST: "test",
  RU: "rollback"
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
      sourceBlockSha256: createHash9("sha256").update(sourceBlock, "utf8").digest("hex")
    };
  });
}

// plugins/dev-flow/src/core/user-interactions.ts
import { randomUUID as randomUUID5 } from "node:crypto";
function normalizeReplyText(value) {
  return value.trim().replace(/[\s\u00A0\uFEFF]+/g, " ").toLowerCase();
}
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
  const pending = Object.values(state.interactions ?? {}).filter((value) => value.status === "pending");
  if (pending.length) throw new DevFlowError("MULTIPLE_PENDING_DECISIONS", "\u540C\u4E00 feature \u53EA\u80FD\u5B58\u5728\u4E00\u4E2A\u5F85\u51B3\u95EE\u9898\u3002", { userMessage: "\u5F53\u524D\u5DF2\u6709\u4E00\u4E2A\u95EE\u9898\u7B49\u5F85\u56DE\u7B54\u3002", cause: "\u7CFB\u7EDF\u62D2\u7EDD\u5E76\u884C\u521B\u5EFA\u7B2C\u4E8C\u4E2A pending decision\u3002", impact: "\u65B0\u95EE\u9898\u6CA1\u6709\u88AB\u521B\u5EFA\uFF0C\u539F\u95EE\u9898\u4ECD\u7B49\u5F85\u56DE\u7B54\u3002", recoveryKind: "refresh", recoveryInstruction: "\u5148\u56DE\u7B54\u5F53\u524D\u95EE\u9898\uFF0C\u4E0B\u4E00\u56DE\u5408\u518D\u5904\u7406\u65B0\u95EE\u9898\u3002", retryOriginal: false });
  const current = findInteractionForTarget(state, input.target);
  if (current?.status === "pending") {
    throw new DevFlowError("INTERACTION_ALREADY_PENDING", input.target, { interactionId: current.id });
  }
  const interaction = {
    id: randomUUID5(),
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
    presentedAt: (/* @__PURE__ */ new Date()).toISOString(),
    status: "pending"
  };
  interactions(state)[interaction.id] = interaction;
  const kind = input.kind === "risk-acceptance" ? "review-risk" : input.kind;
  state.pendingDecision = {
    kind,
    question: input.question ?? "\u8BF7\u9009\u62E9\u4E00\u4E2A\u65B9\u6848\u3002",
    options: input.options.map((option, index) => ({ ...option, recommended: index === 0 })),
    basisHash: input.basisHash,
    presentedAt: interaction.presentedAt,
    presentedRevision: state.revision,
    source: "core",
    target: input.target
  };
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
  return Object.values(state.interactions ?? {}).find((value) => {
    const interaction = value;
    return interaction.target === target && interaction.status === "pending";
  });
}
function clearInteractionsForTarget(state, target) {
  if (!state.interactions) return;
  for (const [id, value] of Object.entries(state.interactions)) {
    const interaction = value;
    if (interaction.target === target) delete state.interactions[id];
  }
  if (state.pendingDecision?.target === target) delete state.pendingDecision;
}
function clearInteractionsByKind(state, kind) {
  if (!state.interactions) return;
  for (const [id, value] of Object.entries(state.interactions)) {
    if (value.kind === kind) delete state.interactions[id];
  }
  if (state.pendingDecision?.kind === (kind === "risk-acceptance" ? "review-risk" : kind)) delete state.pendingDecision;
}
function optionFor(interaction, action) {
  const option = interaction.options.find((candidate) => candidate.id === action);
  if (!option) throw new DevFlowError("INTERACTION_ACTION_INVALID", action, { interactionId: interaction.id });
  return option;
}
function matchNaturalOption(interaction, userReply) {
  const normalized = normalizeReplyText(userReply);
  if (!normalized) return void 0;
  const editMatch = normalized.match(/^修改(?:需求|意见|计划|方案|)?[:：]?\s*([\s\S]*)$/u);
  if (editMatch) {
    const option = interaction.options.find((candidate) => candidate.id === "request-changes");
    if (option) return { option, comment: editMatch[1] || void 0 };
  }
  for (const candidate of interaction.options) {
    const labelNorm = normalizeReplyText(candidate.label);
    if (!labelNorm) continue;
    if (labelNorm === normalized) {
      return { option: candidate };
    }
    if (candidate.id !== "confirm" && normalized.startsWith(labelNorm) && normalized.length > labelNorm.length) {
      return { option: candidate, comment: normalized.slice(labelNorm.length).trim() };
    }
  }
  return void 0;
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
  let match;
  if (phraseAction) {
    match = { option: optionFor(interaction, phraseAction) };
  } else if (match = matchNaturalOption(interaction, userReply)) {
  }
  if (!match) {
    throw new DevFlowError("DECISION_REPLY_NOT_RECOGNIZED", "\u56DE\u7B54\u6CA1\u6709\u7CBE\u786E\u5339\u914D\u5F53\u524D\u95EE\u9898\u7684\u9009\u9879\u3002", {
      userMessage: "\u6CA1\u6709\u8BC6\u522B\u51FA\u5F53\u524D\u95EE\u9898\u7684\u6709\u6548\u56DE\u7B54\u3002",
      cause: "\u56DE\u7B54\u4E0D\u662F\u5B8C\u6574\u9009\u9879\uFF0C\u4E5F\u4E0D\u662F\u53D7\u652F\u6301\u7684\u6279\u51C6\u77ED\u8BED\u3002",
      impact: "\u5F53\u524D\u95EE\u9898\u4ECD\u4FDD\u6301\u5F85\u56DE\u7B54\uFF0C\u6CA1\u6709\u4EFB\u4F55\u72B6\u6001\u88AB\u6539\u53D8\u3002",
      recoveryKind: "retry",
      recoveryInstruction: "\u8BF7\u76F4\u63A5\u56DE\u590D\u4E00\u4E2A\u5B8C\u6574\u4E2D\u6587\u9009\u9879\u3002",
      retryOriginal: true
    });
  }
  const normalizedComment = validateComment(match.option, match.comment);
  const ids = provenance;
  const response = {
    action: match.option.id,
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
function toPublicInteraction(interaction) {
  return {
    kind: interaction.kind,
    status: interaction.status,
    ...interaction.question ? { question: interaction.question } : {},
    options: interaction.options.map((option) => ({ ...option }))
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
  const lines = [interaction.question ?? "\u8BF7\u9009\u62E9\u65B9\u6848\uFF1A"];
  interaction.options.forEach((option, index) => {
    const recommended = index === 0 ? "\uFF08\u63A8\u8350\uFF09" : "";
    lines.push(`- ${option.label}${recommended}`);
  });
  lines.push("\u8BF7\u76F4\u63A5\u56DE\u590D\u4E00\u4E2A\u5B8C\u6574\u9009\u9879\uFF1B\u5982\u9700\u8865\u5145\u8BF4\u660E\uFF0C\u8BF7\u5728\u9009\u9879\u540E\u5199\u660E\u610F\u89C1\u3002");
  return lines.join("\n");
}

// plugins/dev-flow/src/policy/rollback-warnings.ts
function isTestScope(pattern) {
  const normalized = pattern.normalize("NFC").replaceAll("\\", "/");
  return normalized.includes("__tests__") || /(^|\/)(tests?|fixtures?)(\/|$)/u.test(normalized) || /\.(test|spec)\./u.test(normalized);
}
function detectRollbackSplitWarning(nodes) {
  const current = new Map(nodes.filter((node) => node.kind === "rollback" && node.status === "current").map((node) => [node.id, node]));
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
  return splits.length === 0 ? [] : [`\u6D4B\u8BD5\u4E0E\u5B9E\u73B0\u62C6\u4E3A\u4E0D\u540C\u56DE\u64A4\u5355\u5143\uFF0C${[...new Set(splits)].sort().join(",")}\uFF1AA \u7684\u524D\u5411\u9A8C\u8BC1\u7EA2\u6D4B\u8BD5\u671F\u5FC5\u5931\u8D25\u6B7B\u9501\uFF1B\u5EFA\u8BAE\u5408\u5E76\u539F\u5B50\u5355\u5143`];
}

// plugins/dev-flow/src/core/artifacts.ts
var names = {
  requirements: "\u9700\u6C42\u6587\u6863.md",
  "implementation-plan": "\u5B9E\u65BD\u8BA1\u5212.md"
};
var hash = (value) => createHash10("sha256").update(value).digest("hex");
var featureDirectory = (root2, id) => path9.join(root2, ".dev-flow", "features", id);
var traceArtifactKinds = /* @__PURE__ */ new Set(["requirements", "implementation-plan"]);
var traceArtifactKindList = /* @__PURE__ */ new Set(["requirements", "implementation-plan"]);
var artifactInvalidations = {
  requirements: { afterStep: "requirements_alignment" },
  "implementation-plan": { afterStep: "planning", reopenFromStep: "planning" }
};
function template(state, id, kind) {
  if (traceArtifactKinds.has(kind)) {
    return renderArtifactTemplate({ featureId: id, route: state.route, requirementsState: state.classification.requirements }, kind);
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
  return routeDefinitionForFeature(state.route, state.workflowCapabilities);
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
  if (!traceAware && traceArtifactKinds.has(kind) && traceEnforcementRequired(state.route, state.workflowCapabilities)) {
    throw new DevFlowError("TRACE_AWARE_REGISTRATION_REQUIRED", `${kind} must be registered with its Trace delta`);
  }
}
function assertPlanRevisionQuiescent(state, kind) {
  if (kind !== "implementation-plan") return;
  const active = (state.implementationUnits ?? []).find((unit) => unit.status === "active");
  if (active) {
    throw new DevFlowError("PLAN_REVISION_REQUIRES_QUIESCENT_UNIT", "implementation-plan cannot change while an implementation unit is active", {
      activeUnitId: active.unitId,
      hint: "\u5148 checkpoint \u6216 rollback \u518D\u4FEE\u8BA2\u8BA1\u5212"
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
  const reopenFromStep = rule.reopenFromStep && reviewEnforcementRequired(state.route, state.workflowCapabilities) ? rule.reopenFromStep : void 0;
  if (reopenFromStep) {
    const ordered2 = effectiveRoute(state).orderedSteps;
    const sourceIndex = ordered2.indexOf(reopenFromStep);
    for (const step of ordered2.slice(sourceIndex)) delete state.steps[step];
    planningReopened = reopenFromStep === "planning";
  } else if (rule.afterStep) {
    const ordered2 = effectiveRoute(state).orderedSteps;
    const sourceIndex = ordered2.indexOf(rule.afterStep);
    for (const step of ordered2.slice(sourceIndex + 1)) delete state.steps[step];
  }
  const ordered = effectiveRoute(state).orderedSteps;
  state.currentStage = ordered.find((step) => state.steps[step]?.status !== "satisfied") ?? ordered.at(-1);
  state.featureCheck = {};
  state.logicComplete = false;
  delete state.steps.finalize;
  return { planningReopened };
}
function invalidateArtifactDependents(state, kind, reason) {
  const invalidation = invalidateFromStep(state, kind);
  for (const approval of approvalIds(state)) {
    delete state.humanGates[approval];
    clearInteractionsForTarget(state, `approval:${approval}`);
  }
  if (kind === "requirements") clearInteractionsByKind(state, "grill");
  state.featureCheck = {};
  delete state.steps.feature_check;
  state.logicComplete = false;
  delete state.steps.finalize;
  state.qualityExceptions = state.qualityExceptions.map((exception) => ({ ...exception, status: "stale" }));
  state.obligations = reopenObligations(state.obligations, ["approval"]);
  void reason;
  return invalidation;
}
async function assertArtifactCurrent(root2, id, state, kind) {
  const artifact = state.artifacts[kind];
  if (!artifact) throw new DevFlowError("MISSING_REQUIRED_ARTIFACT", kind);
  const contents = await readFile7(path9.join(featureDirectory(root2, id), normalizeUnicode(artifact.path)), "utf8");
  if (hash(contents) !== artifact.sha256) throw new DevFlowError("ARTIFACT_INTEGRITY_FAILED", kind);
  return contents;
}
async function scaffoldArtifact(root2, id, expectedRevision, kind) {
  const state = await readState(root2, id);
  if (state.lifecycle !== "active") throw new DevFlowError("INVALID_LIFECYCLE", "only active features can scaffold artifacts");
  const route = effectiveRoute(state);
  if (!artifactKinds(route).includes(kind)) throw new DevFlowError("ARTIFACT_NOT_REQUIRED", `${kind} is not required for ${state.route}`);
  if (kind === "plan-review" && reviewEnforcementRequired(state.route, state.workflowCapabilities)) {
    throw new DevFlowError("GENERATED_ARTIFACT_READ_ONLY", "plan-review is generated from the immutable review ledger");
  }
  const currentStep = currentOpenStep(state);
  const requiredNow = currentStep ? [...route.artifactSteps?.[currentStep] ?? [], ...route.generatedArtifactSteps?.[currentStep] ?? []] : [];
  if (!requiredNow.includes(kind)) throw new DevFlowError("ARTIFACT_OUT_OF_ORDER", `${kind} is not required by ${currentStep ?? "a pending step"}`, { expectedStep: currentStep });
  const filename = names[kind] ? normalizeUnicode(names[kind]) : void 0;
  if (!filename) throw new DevFlowError("INVALID_ARTIFACT", "unknown artifact kind");
  const target = path9.join(featureDirectory(root2, id), filename);
  const content = template(state, id, kind);
  await writeFile2(target, content, { flag: "wx" }).catch(async (error) => {
    if (error.code !== "EEXIST") throw error;
  });
  const contents = await readFile7(target, "utf8");
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
  const contents = await readFile7(path9.join(featureDirectory(root2, id), normalizeUnicode(artifact.path)), "utf8");
  const checksum = hash(contents);
  return mutate(root2, id, expectedRevision, "artifact-recorded", (current) => {
    assertPlanRevisionQuiescent(current, kind);
    current.artifacts[kind] = { ...artifact, path: normalizeUnicode(artifact.path), sha256: checksum };
    invalidateArtifactDependents(current, kind, "artifact-changed");
  }, { kind, invalidationReason: "artifact-changed", planningReopened: kind === "implementation-plan" && reviewEnforcementRequired(state.route, state.workflowCapabilities) });
}
async function recordArtifactWithTrace(root2, id, expectedRevision, artifactKind, traceDelta, options = {}) {
  if (!traceArtifactKindList.has(artifactKind)) throw new DevFlowError("INVALID_ARTIFACT", artifactKind);
  let eventData = { kind: artifactKind };
  let warnings = [];
  const state = await mutatePrepared(root2, id, expectedRevision, "artifact-recorded-with-trace", async (current, nextStateRevision) => {
    if (current.lifecycle !== "active") throw new DevFlowError("INVALID_LIFECYCLE", "only active features can register artifacts");
    if (!traceEnforcementRequired(current.route, current.workflowCapabilities)) {
      throw new DevFlowError("TRACE_NOT_ENFORCED", `${artifactKind} does not use Trace registration on ${current.route}`, {
        route: current.route,
        recoveryHint: "\u5F53\u524D\u8DEF\u7EBF\u4E0D\u5F3A\u5236 Trace\uFF1B\u8BF7\u6539\u7528 dev_flow_record_artifact \u767B\u8BB0\u8BE5\u6587\u6863"
      });
    }
    assertManualRegistrationAllowed(current, artifactKind, true);
    assertPlanRevisionQuiescent(current, artifactKind);
    const artifact = current.artifacts[artifactKind];
    if (!artifact) throw new DevFlowError("MISSING_REQUIRED_ARTIFACT", artifactKind);
    const contents = await readFile7(path9.join(featureDirectory(root2, id), normalizeUnicode(artifact.path)), "utf8");
    const artifactSha256 = hash(contents);
    const sourceBlocks = parseTraceSourceBlocks(contents);
    const { config, sha256: projectConfigSha256 } = await readProjectConfigSnapshot(root2);
    const currentLedger = await readTraceabilityForArtifactReplacement(root2, current, artifactKind);
    const ledger = applyTraceDelta({
      current: currentLedger,
      route: current.route,
      artifactKind,
      artifactSha256,
      sourceBlocks,
      delta: traceDelta,
      projectConfigSha256,
      verificationCommandIds: config.verification.commands.map((command2) => command2.id),
      nextStateRevision
    });
    warnings = detectRollbackSplitWarning(Object.values(ledger.nodes).filter((node) => node.kind === "rollback"));
    const pointer = await writeTraceSnapshot(root2, ledger, options.snapshot);
    const artifactChanged = artifact.sha256 !== artifactSha256;
    const traceChanged = JSON.stringify(currentLedger.nodes) !== JSON.stringify(ledger.nodes) || JSON.stringify(currentLedger.edges) !== JSON.stringify(ledger.edges);
    const reviewPointer = artifactChanged || traceChanged ? await prepareReviewInvalidation(root2, current, nextStateRevision) : void 0;
    eventData = {
      kind: artifactKind,
      artifactChanged,
      traceChanged,
      invalidationReason: artifactChanged ? "artifact-changed" : traceChanged ? "trace-changed" : void 0,
      ...warnings.length ? { warnings } : {}
    };
    return {
      mutate: (draft) => {
        draft.artifacts[artifactKind] = { ...artifact, sha256: artifactSha256 };
        draft.traceability = pointer;
        if (reviewPointer) draft.review = reviewPointer;
        if (artifactChanged || traceChanged) {
          const invalidation = invalidateArtifactDependents(draft, artifactKind, artifactChanged ? "artifact-changed" : "trace-changed");
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

// plugins/dev-flow/src/policy/evidence.ts
var emptyEvidence = () => ({
  fields: {},
  checks: [],
  verificationKinds: []
});
function addChecks(target, checks) {
  for (const check of checks) if (!target.includes(check)) target.push(check);
}
function requiredEvidenceForStep(route, riskLabels, step, workflowCapabilities) {
  const required = emptyEvidence();
  const orderedSteps = routeDefinition(route).orderedSteps;
  const risk = deriveRiskRequirements(riskLabels);
  if (step === "planning") {
    const effectiveRoute2 = routeDefinitionForFeature(route, workflowCapabilities);
    if (effectiveRoute2.generatedArtifacts?.includes("plan-review")) required.fields.reviewBatch = true;
    else required.fields.reviewType = "plan";
    if (route === "light-l") addChecks(required.checks, ["rollback-strategy"]);
  }
  if (step === "code_review") required.fields.reviewType = "code";
  if (step === "implementation" && workflowCapabilities?.checkpoints === 1) {
    required.fields.files = "protected-root-paths";
  }
  if (step === "code_review" && risk.checks.includes("full-code-review")) {
    required.fields.reviewDepth = "full";
  }
  const riskReviewTarget = orderedSteps.includes("code_review") ? "code_review" : orderedSteps.includes("planning") ? "planning" : orderedSteps.includes("verification") ? "verification" : void 0;
  if (riskReviewTarget === step && riskLabels.length) addChecks(required.checks, ["risk-review"]);
  if (risk.checks.some((check) => check.includes("security"))) {
    const target = orderedSteps.includes("code_review") ? "code_review" : orderedSteps.includes("planning") ? "planning" : orderedSteps.includes("verification") ? "verification" : void 0;
    if (step === target) addChecks(required.checks, risk.checks.filter((check) => check.includes("security")));
  }
  const rollbackChecks = risk.checks.filter((check) => check === "rollback" || check === "full-rollback");
  if (rollbackChecks.length) {
    const target = orderedSteps.includes("planning") ? "planning" : "verification";
    if (step === target) addChecks(required.checks, rollbackChecks);
  }
  if (step === "verification" || step === "feature_check") {
    required.verificationKinds = riskLabels.length ? [...risk.verification] : ["targeted"];
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

// plugins/dev-flow/src/core/delivery-snapshot.ts
import { createHash as createHash11 } from "node:crypto";
import { execFile as execFile3 } from "node:child_process";
import { lstat as lstat3, readFile as readFile8, writeFile as writeFile3 } from "node:fs/promises";
import path10 from "node:path";
import { promisify as promisify3 } from "node:util";
var run2 = promisify3(execFile3);
var digest4 = (value) => createHash11("sha256").update(value).digest("hex");
async function git2(root2, args, allowExitOne = false) {
  try {
    const result = await run2("git", args, { cwd: root2, encoding: "buffer", maxBuffer: 8 * 1024 * 1024 });
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
  if (!normalized || path10.posix.isAbsolute(normalized) || normalized.startsWith("../") || normalized === ".." || normalized.startsWith(".dev-flow/") || normalized !== slashPath) {
    throw new DevFlowError("INVALID_IMPLEMENTATION_FILE", "implementation files must be normalized project-relative protected paths", {
      path: value
    });
  }
  return normalized;
}
function isWithinProtectedRoot(file, protectedRoots) {
  return protectedRoots.some((root2) => root2 === "." || file === root2 || file.startsWith(`${root2}/`));
}
function assertImplementationFilesInProtectedRoots(files, protectedRoots) {
  if (files.some((file) => !isWithinProtectedRoot(file, protectedRoots))) {
    throw new DevFlowError("INVALID_IMPLEMENTATION_FILE", "implementation files must be inside configured protectedRoots", {
      protectedRoots,
      recoveryHint: "\u5B9E\u73B0\u8BC1\u636E\u53EA\u767B\u8BB0 feature-owned \u4E14\u4F4D\u4E8E protectedRoots \u7684\u6587\u4EF6\uFF1B\u6D4B\u8BD5\u3001\u65E5\u5FD7\u548C\u9A8C\u8BC1\u4EA7\u7269\u8BF7\u653E\u5165 verification evidence\uFF0C\u6216\u5148\u628A\u786E\u5C5E\u4EA4\u4ED8\u8303\u56F4\u7684\u76EE\u5F55\u52A0\u5165 protectedRoots"
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
var missingFileHint = 'files \u53EA\u63A5\u53D7\u7EAF\u8DEF\u5F84\uFF0C\u5982 "src/foo.js"\uFF08\u800C\u975E "src/foo.js (\u65B0\u589E)"\uFF09\uFF1B\u5148\u521B\u5EFA\u6216\u767B\u8BB0\u5B9E\u9645\u5B58\u5728\u7684\u6587\u4EF6\u540E\u518D\u91CD\u5F55';
async function assertImplementationFilesExist(root2, files) {
  const missing = [];
  for (const file of files) {
    try {
      await lstat3(path10.join(root2, file));
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
  const output = await git2(root2, ["status", "--porcelain=v1", "-z", "--untracked-files=all", "--", ...config.protectedRoots]);
  return statusPaths(output).filter((file) => !config.protectedRootsExclude?.some((pattern) => pathWithinFileScope(file, [pattern])));
}
async function fileHash(root2, file) {
  try {
    return digest4(await readFile8(path10.join(root2, file)));
  } catch (error) {
    if (error.code === "ENOENT") return "deleted";
    throw error;
  }
}
async function assertPlainFile(root2, file) {
  const metadata = await lstat3(path10.join(root2, file));
  if (!metadata.isFile()) throw new DevFlowError("INVALID_IMPLEMENTATION_FILE", "untracked implementation files must be regular files", { path: file });
}
async function untrackedFiles(root2, files) {
  if (!files.length) return /* @__PURE__ */ new Set();
  const output = await git2(root2, ["ls-files", "--others", "--exclude-standard", "-z", "--", ...files]);
  return new Set(nulItems(output).map(normalizePath2));
}
async function createDeliverySnapshot(root2, featureId, state, config) {
  const implementation2 = implementationFiles(state.steps.implementation?.evidence);
  assertImplementationFilesInProtectedRoots(implementation2, config.protectedRoots);
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
  const protectedChanged = [.../* @__PURE__ */ new Set([...committed, ...currentDirty])].filter((file) => isWithinProtectedRoot(file, config.protectedRoots));
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
  const untracked = await untrackedFiles(root2, files);
  const tracked = files.filter((file) => !untracked.has(file));
  const patches = [];
  if (tracked.length) patches.push(await git2(root2, ["diff", "--binary", "--full-index", "--no-ext-diff", lineage.baseHead, "--", ...tracked]));
  for (const file of [...untracked].sort()) {
    await assertPlainFile(root2, file);
    patches.push(await git2(root2, ["diff", "--binary", "--no-index", "--", "/dev/null", file], true));
  }
  const relativeDirectory2 = path10.posix.join(".dev-flow", "features", featureId);
  const patchFilename = "\u4EA4\u4ED8\u5FEB\u7167.patch";
  const manifestFilename = "\u4EA4\u4ED8\u5FEB\u7167\u6587\u6863.md";
  const patchPath = path10.posix.join(relativeDirectory2, patchFilename);
  const manifestPath2 = path10.posix.join(relativeDirectory2, manifestFilename);
  const patch = patches.filter(Boolean).join("\n");
  const patchHash = digest4(patch);
  await writeFile3(path10.join(root2, patchPath), patch, "utf8");
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
    `- \u7528\u6237\u624B\u52A8\u63A5\u7EB3\u8DEF\u5F84\uFF1A${Object.entries(lineage.ownershipSource).filter(([, source]) => source === "manual-commit").map(([file]) => file).join(", ") || "\u65E0"}`,
    `- \u672A\u63D0\u4EA4\u8DEF\u5F84\uFF1A${currentDirty.filter((file) => featureOwned.has(file)).join(", ") || "\u65E0"}`,
    `- \u7528\u6237\u63A5\u53D7\u98CE\u9669\uFF1A${state.qualityExceptions.filter((exception) => exception.status === "current").map((exception) => exception.kind).join(", ") || "\u65E0"}`,
    "",
    "## \u56DE\u6EDA",
    "",
    `\u5728\u4ED3\u5E93\u6839\u76EE\u5F55\u6267\u884C\uFF1A\`git apply -R --binary ${patchPath}\``,
    ""
  ].join("\n");
  const manifestHash = digest4(manifest);
  await writeFile3(path10.join(root2, manifestPath2), manifest, "utf8");
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
    manualAdoptedPaths: Object.entries(lineage.ownershipSource).filter(([, source]) => source === "manual-commit").map(([file]) => file),
    uncommittedPaths: currentDirty.filter((file) => featureOwned.has(file)),
    qualityExceptions: state.qualityExceptions.filter((exception) => exception.status === "current").map((exception) => exception.kind)
  };
}

// plugins/dev-flow/src/core/interaction-provenance.ts
function promptFrom(record) {
  if (record.type !== "host-event" || !record.data || typeof record.data !== "object" || Array.isArray(record.data)) return void 0;
  const data = record.data;
  if (data.type !== "user-prompt" || typeof data.eventId !== "string" || typeof data.text !== "string" || !isHostId(data.host)) return void 0;
  const at = typeof data.at === "string" ? data.at : record.at;
  if (Number.isNaN(Date.parse(at))) return void 0;
  return { eventId: data.eventId, text: data.text, host: data.host, at };
}
function resolvePromptEvent(events, input) {
  const consumed = new Set(input.consumedEventIds ?? []);
  const otherHost = events.flatMap((record) => {
    const prompt = promptFrom(record);
    if (!prompt || prompt.host === input.host || consumed.has(prompt.eventId)) return [];
    if (record.revision <= input.presentedRevision || Date.parse(prompt.at) < Date.parse(input.presentedAt)) return [];
    return normalizeReplyText(prompt.text) === normalizeReplyText(input.userReply) ? [prompt] : [];
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
  const matches = events.flatMap((record) => {
    const prompt = promptFrom(record);
    if (!prompt || prompt.host !== input.host || consumed.has(prompt.eventId)) return [];
    if (record.revision <= input.presentedRevision || Date.parse(prompt.at) < Date.parse(input.presentedAt)) return [];
    if (normalizeReplyText(prompt.text) !== normalizeReplyText(input.userReply)) return [];
    return [{ eventId: prompt.eventId, revision: record.revision, at: prompt.at, text: prompt.text, host: prompt.host }];
  });
  if (matches.length === 0) {
    throw new DevFlowError("INTERACTION_PROVENANCE_UNAVAILABLE", "\u6CA1\u6709\u627E\u5230\u5448\u73B0\u95EE\u9898\u4E4B\u540E\u3001\u6765\u81EA\u5F53\u524D\u5BBF\u4E3B\u7684\u552F\u4E00\u7528\u6237\u56DE\u7B54\u3002", {
      userMessage: "\u6CA1\u6709\u786E\u8BA4\u5230\u8FD9\u6B21\u56DE\u7B54\u5C5E\u4E8E\u5F53\u524D\u95EE\u9898\u3002",
      cause: "\u5F53\u524D\u5BBF\u4E3B\u6CA1\u6709\u6355\u83B7\u5230\u5339\u914D\u7684\u540E\u7EED\u7528\u6237\u6D88\u606F\uFF0C\u6216\u8BE5\u6D88\u606F\u5DF2\u88AB\u6D88\u8D39\u3002",
      impact: "\u5F53\u524D\u95EE\u9898\u4ECD\u4FDD\u6301\u5F85\u56DE\u7B54\uFF0C\u7CFB\u7EDF\u4E0D\u4F1A\u731C\u6D4B\u7528\u6237\u610F\u56FE\u3002",
      recoveryKind: "retry",
      recoveryInstruction: "\u8BF7\u5728\u95EE\u9898\u5448\u73B0\u540E\u7684\u4E0B\u4E00\u56DE\u5408\u76F4\u63A5\u91CD\u590D\u5B8C\u6574\u56DE\u7B54\u3002",
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

// plugins/dev-flow/src/core/requirements-grill.ts
async function currentRequirements(root2, id, state) {
  if (!state.artifacts.requirements) throw new DevFlowError("MISSING_REQUIRED_ARTIFACT", "requirements");
  await assertArtifactCurrent(root2, id, state, "requirements");
}
async function requestGrillDecision(root2, id, expectedRevision, input) {
  if (!input.question.trim()) throw new DevFlowError("GRILL_QUESTION_REQUIRED", "\u95EE\u9898\u4E0D\u80FD\u4E3A\u7A7A\u3002", { userMessage: "\u5F53\u524D\u95EE\u9898\u6CA1\u6709\u5185\u5BB9\u3002", recoveryKind: "retry", recoveryInstruction: "\u8865\u5145\u4E00\u4E2A\u9700\u8981\u7528\u6237\u51B3\u5B9A\u7684\u95EE\u9898\u540E\u91CD\u8BD5\u3002", retryOriginal: true });
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
      options: input.options
    });
    const ledger = draft.decisionLedger ?? [];
    const index = ledger.findIndex((decision) => decision.id === input.questionId);
    if (index >= 0) ledger[index] = { ...ledger[index], question: input.question, status: "open", evidence: void 0, conclusion: void 0, source: "grill" };
    else ledger.push({ id: input.questionId, question: input.question, status: "open", source: "grill" });
    draft.decisionLedger = ledger;
    draft.lastUpdatedBy = { host: input.host, pluginVersion: "4.1.0" };
  }, () => ({ questionId: input.questionId, mode: "decision" }));
  if (!interaction) throw new DevFlowError("INTERACTION_NOT_CREATED", target);
  return { state, interaction: toPublicInteraction(interaction), interactionId: interaction.id };
}
async function resolveGrillDecision(root2, id, expectedRevision, interactionId, host, input) {
  const initial = await readState(root2, id);
  if (initial.revision !== expectedRevision) throw new DevFlowError("STATE_REVISION_CONFLICT", "state revision changed", { currentRevision: initial.revision });
  const interaction = getInteraction(initial, interactionId);
  if (interaction.kind !== "grill" || interaction.status !== "pending") throw new DevFlowError("INTERACTION_NOT_PENDING", "\u5F53\u524D\u95EE\u9898\u5DF2\u7ECF\u5904\u7406\u6216\u4E0D\u5B58\u5728\u3002", { interactionId });
  let promptEventId;
  if (input.source === "text") {
    const events = await readFeatureEvents(root2, id);
    const match = resolvePromptEvent(events, {
      host,
      userReply: input.userReply,
      presentedAt: interaction.presentedAt,
      presentedRevision: initial.pendingDecision?.presentedRevision ?? initial.revision - 1
    });
    promptEventId = match.eventId;
  }
  let response;
  const state = await mutate(root2, id, expectedRevision, "decision-answered", (draft) => {
    response = input.source === "elicitation" ? resolveNativeInteraction(draft, interactionId, input.action, input.comment, host) : resolveTextInteraction(draft, interactionId, input.userReply, host, { promptEventId });
    const decisionId = interaction.target.slice("grill:".length);
    const index = (draft.decisionLedger ?? []).findIndex((decision) => decision.id === decisionId);
    if (index >= 0 && response) {
      const next = [...draft.decisionLedger ?? []];
      next[index] = resolveDecision(next[index], input.source === "elicitation" ? input.comment ?? "\u7528\u6237\u9009\u62E9" : input.userReply, response.action);
      draft.decisionLedger = next;
    }
    draft.lastUpdatedBy = { host, pluginVersion: "4.1.0" };
  }, { interactionId, mode: "decision" });
  if (!response) throw new DevFlowError("INTERACTION_NOT_RESOLVED", "\u5F53\u524D\u95EE\u9898\u6CA1\u6709\u5B8C\u6210\u56DE\u7B54\u3002", { interactionId });
  return { state, interaction: toPublicInteraction(getInteraction(state, interactionId)), response, interactionId };
}
async function resolveGrillElicitation(root2, id, expectedRevision, interactionId, action, comment, host) {
  return resolveGrillDecision(root2, id, expectedRevision, interactionId, host, { source: "elicitation", action, comment });
}
async function resolveGrillAnswer(root2, id, expectedRevision, interactionId, userReply, host) {
  return resolveGrillDecision(root2, id, expectedRevision, interactionId, host, { source: "text", userReply });
}
async function assertRequirementsGrillSatisfied(root2, id, state) {
  if (state.route !== "standard-m" && state.route !== "standard-l") return;
  await currentRequirements(root2, id, state);
  const pending = Object.values(state.interactions ?? {}).some((value) => {
    const interaction = value;
    return interaction.kind === "grill" && interaction.status === "pending";
  }) || state.pendingDecision?.kind === "grill";
  if (pending) throw new DevFlowError("GRILL_INCOMPLETE", "\u8FD8\u6709\u4E00\u4E2A\u9700\u6C42\u95EE\u9898\u7B49\u5F85\u56DE\u7B54\u3002", { userMessage: "\u9700\u6C42\u6F84\u6E05\u8FD8\u6CA1\u6709\u5B8C\u6210\u3002", cause: "\u51B3\u7B56\u8D26\u672C\u4ECD\u6709\u5F85\u56DE\u7B54\u7684 grill \u95EE\u9898\u3002", impact: "\u5F53\u524D\u8DEF\u7EBF\u4E0D\u80FD\u8FDB\u5165\u4E0B\u4E00\u6B65\u3002", recoveryKind: "retry", recoveryInstruction: "\u5148\u56DE\u7B54\u5F53\u524D\u552F\u4E00\u95EE\u9898\uFF0C\u518D\u7EE7\u7EED\u5F53\u524D\u6B65\u9AA4\u3002", retryOriginal: true });
  const openDecision = (state.decisionLedger ?? []).find((decision) => decision.source === "grill" && decision.status === "open");
  if (openDecision) throw new DevFlowError("GRILL_INCOMPLETE", "\u9700\u6C42\u51B3\u7B56\u8D26\u672C\u4ECD\u6709\u672A\u6536\u655B\u95EE\u9898\u3002", { userMessage: "\u9700\u6C42\u6F84\u6E05\u8FD8\u6CA1\u6709\u5B8C\u6210\u3002", cause: "\u51B3\u7B56\u8D26\u672C\u4E2D\u5B58\u5728 open grill decision\u3002", impact: "\u7CFB\u7EDF\u4E0D\u4F1A\u4ECE Markdown \u5B57\u6BB5\u731C\u6D4B\u5B8C\u6210\u6001\u3002", recoveryKind: "retry", recoveryInstruction: "\u56DE\u7B54\u5F53\u524D\u95EE\u9898\u540E\u91CD\u65B0\u767B\u8BB0\u771F\u5B9E\u9700\u6C42\u5185\u5BB9\u3002", retryOriginal: true });
}

// plugins/dev-flow/src/core/verification.ts
import { execFile as execFile4 } from "node:child_process";
import { createHash as createHash12 } from "node:crypto";
import { mkdir as mkdir5, writeFile as writeFile4 } from "node:fs/promises";
import path11 from "node:path";
import { promisify as promisify4 } from "node:util";

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

// plugins/dev-flow/src/core/verification.ts
var run3 = promisify4(execFile4);
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
async function runVerificationCommand(root2, command2) {
  try {
    const invocation = verificationInvocation(command2);
    const result = await run3(invocation.executable, invocation.args, {
      cwd: path11.resolve(root2, command2.cwd),
      timeout: 12e4,
      maxBuffer: 1024 * 1024
    });
    return { exitCode: 0, output: `${result.stdout}${result.stderr}` };
  } catch (error) {
    const failure2 = error;
    return {
      exitCode: typeof failure2.code === "number" ? failure2.code : 1,
      output: `${failure2.stdout ?? ""}${failure2.stderr ?? failure2.message}`
    };
  }
}
var userSignoffPhrases = ["\u9A8C\u6536\u901A\u8FC7", "\u786E\u8BA4\u9A8C\u6536", "\u540C\u610F\u9A8C\u6536", "approved", "LGTM"];
function normalizeReply(value) {
  return value.trim().toLocaleLowerCase("en-US");
}
function validateManualAcceptance(value) {
  if (value === void 0) return void 0;
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new DevFlowError("INVALID_MANUAL_ACCEPTANCE", "manualAcceptance must be an object");
  }
  const input = value;
  if (input.mode !== "browser" && input.mode !== "user-signoff" && input.mode !== "code-path-audit" || typeof input.source !== "string" || !input.source.trim() || !Array.isArray(input.scenarios) || input.scenarios.length === 0 || "outcome" in input) {
    throw new DevFlowError("INVALID_MANUAL_ACCEPTANCE", "manualAcceptance is incomplete or invalid");
  }
  const scenarios = input.scenarios.map((scenario) => {
    if (typeof scenario !== "object" || scenario === null || Array.isArray(scenario)) {
      throw new DevFlowError("INVALID_MANUAL_ACCEPTANCE", "manualAcceptance scenarios must be objects");
    }
    const item = scenario;
    if (typeof item.name !== "string" || !item.name.trim() || typeof item.evidence !== "string" || !item.evidence.trim()) {
      throw new DevFlowError("INVALID_MANUAL_ACCEPTANCE", "manualAcceptance scenarios require name and evidence");
    }
    return { name: item.name.trim(), evidence: item.evidence.trim() };
  });
  if (input.mode === "user-signoff") {
    const userReply = input.userReply;
    if (typeof userReply !== "string" || !userReply.trim()) {
      throw new DevFlowError("INVALID_MANUAL_ACCEPTANCE", "user-signoff requires a userReply");
    }
    if (!userSignoffPhrases.some((phrase) => normalizeReply(phrase) === normalizeReply(userReply))) {
      throw new DevFlowError("INVALID_MANUAL_ACCEPTANCE", "user-signoff reply is not an explicit acceptance phrase", {
        allowed: userSignoffPhrases
      });
    }
    return {
      mode: input.mode,
      source: input.source.trim(),
      scenarios,
      userReply
    };
  }
  if (input.userReply !== void 0) {
    throw new DevFlowError("INVALID_MANUAL_ACCEPTANCE", "only user-signoff may include a userReply");
  }
  return { mode: input.mode, source: input.source.trim(), scenarios };
}
function consumedSignoffEventIds(state) {
  const consumed = /* @__PURE__ */ new Set();
  for (const attempt of state.verification.attempts) {
    const manualAcceptance = attempt.manualAcceptance;
    if (typeof manualAcceptance?.promptEventId === "string") consumed.add(manualAcceptance.promptEventId);
  }
  for (const gate of Object.values(state.humanGates)) {
    const confirmation = gate.confirmation;
    if (typeof confirmation?.promptEventId === "string") consumed.add(confirmation.promptEventId);
    if (typeof confirmation?.turnBoundaryEventId === "string") consumed.add(confirmation.turnBoundaryEventId);
  }
  return consumed;
}
async function assertOptionalManualAcceptance(root2, id, state, manualAcceptance, host) {
  if (manualAcceptance?.mode !== "user-signoff") return;
  const events = await readFeatureEvents(root2, id);
  resolvePromptEvent(events, {
    host,
    userReply: manualAcceptance.userReply,
    presentedAt: (/* @__PURE__ */ new Date(0)).toISOString(),
    presentedRevision: state.revision - 1,
    consumedEventIds: consumedSignoffEventIds(state)
  });
}
function assertMoneyBehaviorCommands(state, commandIds, behaviorCommands) {
  if (!state.classification.riskLabels.includes("money")) return;
  if (!behaviorCommands.length) {
    throw new DevFlowError("MONEY_BEHAVIOR_COMMAND_REQUIRED", "money-risk features require configured behaviorCommands");
  }
  const missing = behaviorCommands.filter((id) => !commandIds.includes(id));
  if (missing.length) {
    throw new DevFlowError("MONEY_BEHAVIOR_COMMAND_REQUIRED", "money-risk features must run every configured behavior command", {
      missing
    });
  }
}
async function runVerification(root2, id, expectedRevision, host, commandIds, manualAcceptanceInput) {
  const initial = await readState(root2, id);
  if (initial.revision !== expectedRevision) {
    throw new DevFlowError("STATE_REVISION_CONFLICT", "state revision changed", {
      currentRevision: initial.revision
    });
  }
  await assertRequirementsGrillSatisfied(root2, id, initial);
  const manualAcceptance = validateManualAcceptance(manualAcceptanceInput);
  const config = await readProjectConfig(root2);
  const selected = commandIds?.length ? config.verification.commands.filter((command2) => commandIds.includes(command2.id)) : config.verification.commands;
  if (!selected.length || commandIds?.some((command2) => !selected.some((item) => item.id === command2))) {
    throw new DevFlowError("UNKNOWN_VERIFICATION_COMMAND", "verification command is not configured");
  }
  await assertOptionalManualAcceptance(root2, id, initial, manualAcceptance, host);
  assertMoneyBehaviorCommands(initial, selected.map((command2) => command2.id), config.verification.behaviorCommands);
  const fingerprint2 = await fingerprintProtectedRoots(root2, config);
  const replacingStaleVerification = Boolean(
    initial.verification.verifiedFingerprint && initial.verification.verifiedFingerprint !== fingerprint2
  );
  const startedAt = (/* @__PURE__ */ new Date()).toISOString();
  let exitCode = 0;
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
      if (result.exitCode !== 0) {
        exitCode = result.exitCode;
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
    const kinds = state.classification.riskLabels.length ? deriveRiskRequirements(state.classification.riskLabels).verification : ["targeted"];
    const attempt = {
      id: state.verification.attempts.length + 1,
      commandIds: [...preflight, ...selected].map((item) => item.id),
      kinds,
      startedAt,
      finishedAt,
      exitCode,
      outputTail: fullOutput.slice(-4e3),
      outputPath: `verification/${state.verification.attempts.length + 1}.log`,
      fingerprint: fingerprint2,
      host,
      phase,
      ...manualAcceptance ? { manualAcceptance } : {}
    };
    const outputFile = path11.join(root2, ".dev-flow", "features", id, attempt.outputPath);
    await mkdir5(path11.dirname(outputFile), { recursive: true });
    await writeFile4(outputFile, fullOutput);
    state.verification.attempts.push(attempt);
    delete state.verification.satisfiedByAttemptId;
    delete state.verification.verifiedFingerprint;
    state.steps.verification = { status: "pending", evidence: { attemptId: attempt.id, exitCode } };
    if (exitCode === 0) {
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
          ...manualAcceptance ? { manualAcceptance } : {}
        }
      };
      if (state.repair) state.repair = markRepairCompleted(state.repair);
      state.obligations = satisfyObligations(state.obligations, ["verification"]);
      if (state.classification.riskLabels.length && !reviewEnforcementRequired(state.route, state.workflowCapabilities)) {
        state.obligations = satisfyObligations(state.obligations, ["review"]);
      }
      if (state.classification.riskLabels.includes("irreversible_consequence")) {
        state.obligations = satisfyObligations(state.obligations, ["rollback"]);
      }
      state.currentStage = "finalize";
    } else {
      const signature = `${exitCode}:${createHash12("sha256").update(fullOutput).digest("hex").slice(0, 16)}`;
      state.repair = recordRepairAttempt(state.repair ?? startRepairLoop(), signature, output.slice(-3));
    }
    state.lastUpdatedBy = { host, pluginVersion: "4.1.0" };
  });
}
async function readVerificationFreshness(root2, state) {
  if (!state.verification.verifiedFingerprint) return { status: "missing" };
  const config = await readProjectConfig(root2);
  const current = await fingerprintProtectedRoots(root2, config);
  if (state.verification.verifiedFingerprint === current) return { status: "fresh" };
  return {
    status: "stale",
    reasonCode: "VERIFICATION_STALE",
    recoveryHint: "Protected files changed; rerun verification before feature-check or finalize"
  };
}
async function verificationIsStale(root2, state) {
  return (await readVerificationFreshness(root2, state)).status === "stale";
}
async function invalidateStaleVerification(root2, id, expectedRevision) {
  const config = await readProjectConfig(root2);
  const current = await fingerprintProtectedRoots(root2, config);
  const state = await readState(root2, id);
  if (!state.verification.verifiedFingerprint || state.verification.verifiedFingerprint === current) return void 0;
  if (state.revision !== expectedRevision) {
    throw new DevFlowError("STATE_REVISION_CONFLICT", "state revision changed", {
      currentRevision: state.revision
    });
  }
  return mutate(root2, id, expectedRevision, "verification-invalidated", (draft) => {
    delete draft.verification.satisfiedByAttemptId;
    delete draft.verification.verifiedFingerprint;
    draft.steps.verification = { status: "pending", evidence: { reason: "protected-files-changed", current } };
    draft.featureCheck = {};
    delete draft.steps.feature_check;
    draft.logicComplete = false;
    delete draft.steps.finalize;
  });
}

// plugins/dev-flow/src/core/review-jobs.ts
import { createHash as createHash13, randomUUID as randomUUID6 } from "node:crypto";
import { readFile as readFile9 } from "node:fs/promises";
import path12 from "node:path";

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
  return state.qualityExceptions.some((exception) => exception.kind === kind && exception.status === "current");
}
async function presentQualityException(root2, featureId, expectedRevision, input) {
  const kind = validKind(input.kind);
  if (!input.riskSummary.trim()) throw new DevFlowError("QUALITY_EXCEPTION_SUMMARY_REQUIRED", "\u98CE\u9669\u8BF4\u660E\u4E0D\u80FD\u4E3A\u7A7A\u3002", { userMessage: "\u8BF7\u5148\u8BF4\u660E\u63A5\u53D7\u98CE\u9669\u7684\u5177\u4F53\u5F71\u54CD\u3002", recoveryKind: "retry", recoveryInstruction: "\u8865\u5145\u7B80\u660E\u98CE\u9669\u8BF4\u660E\u540E\u91CD\u8BD5\u3002", retryOriginal: true });
  let interactionId = "";
  let interaction;
  const state = await mutate(root2, featureId, expectedRevision, "quality-exception-presented", (draft) => {
    const existing = draft.qualityExceptions.find((exception) => exception.kind === kind && exception.basisHash === input.basisHash && exception.fingerprint === input.fingerprint && exception.status === "current");
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
  }, { kind });
  if (!interaction) throw new DevFlowError("INTERACTION_NOT_CREATED", kind);
  return { state, interaction: toPublicInteraction(interaction), interactionId };
}
async function resolveQualityExceptionAnswer(root2, featureId, expectedRevision, interactionId, userReply, host) {
  const initial = await readState(root2, featureId);
  const interaction = getInteraction(initial, interactionId);
  if (interaction.kind !== "quality-exception" || interaction.status !== "pending") throw new DevFlowError("INTERACTION_NOT_PENDING", "\u5F53\u524D\u98CE\u9669\u95EE\u9898\u5DF2\u7ECF\u5904\u7406\u3002", { interactionId });
  const match = resolvePromptEvent(await readFeatureEvents(root2, featureId), {
    host,
    userReply,
    presentedAt: interaction.presentedAt,
    presentedRevision: initial.pendingDecision?.presentedRevision ?? initial.revision - 1
  });
  return mutate(root2, featureId, expectedRevision, "quality-exception-answered", (state) => {
    const response = resolveTextInteraction(state, interactionId, userReply, host, { promptEventId: match.eventId });
    const kind = interaction.target.slice("quality-exception:".length);
    if (response.action === "accept") {
      state.qualityExceptions.push({
        kind,
        basisHash: interaction.basisHash,
        fingerprint: state.workspace.lastWorkspaceFingerprint,
        riskSummary: interaction.question ?? "\u5DF2\u63A5\u53D7\u5F53\u524D\u6D41\u7A0B\u8D28\u91CF\u98CE\u9669\u3002",
        userEvidence: response.comment ?? userReply,
        at: response.respondedAt,
        status: "current"
      });
      if (kind === "review" || kind === "verification" || kind === "checkpoint") {
        state.obligations = satisfyObligations(state.obligations, [kind]);
      }
    }
    state.lastUpdatedBy = { host, pluginVersion: "4.1.0" };
  }, { interactionId });
}

// plugins/dev-flow/src/core/review-jobs.ts
var digest5 = (value) => createHash13("sha256").update(value).digest("hex");
var leaseMilliseconds = 60 * 60 * 1e3;
var samplingLeaseMilliseconds = 120 * 1e3;
var basisArtifactKinds = ["requirements", "implementation-plan", "coverage-matrix", "rollback-units"];
function invalid3(code, message, details = {}) {
  throw new DevFlowError(code, message, details);
}
function currentBatch2(ledger, batchId) {
  const batch = ledger.batches.find((candidate) => candidate.batchId === batchId);
  if (!batch) invalid3("REVIEW_BATCH_NOT_FOUND", "review batch does not exist", { batchId });
  if (batch.validity !== "current") invalid3("REVIEW_BATCH_STALE", "review batch is stale", { batchId });
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
  if (!state.traceability) invalid3("REVIEW_BASIS_UNAVAILABLE", "review basis requires a current Trace pointer");
  const trace2 = await readTraceability(root2, state);
  const { config, sha256: projectConfigSha256 } = await readProjectConfigSnapshot(root2);
  const frozenArtifacts = await Promise.all(reviewArtifactKinds(state).map(async (kind) => {
    const artifact = state.artifacts[kind];
    if (!artifact) invalid3("REVIEW_BASIS_ARTIFACT_MISSING", `review basis artifact is missing: ${kind}`, { kind });
    let contents;
    try {
      contents = await readFile9(path12.join(root2, ".dev-flow", "features", state.featureId, artifact.path), "utf8");
    } catch {
      invalid3("REVIEW_BASIS_ARTIFACT_MISSING", `review basis artifact cannot be read: ${kind}`, { kind });
    }
    if (digest5(contents) !== artifact.sha256) {
      invalid3("ARTIFACT_INTEGRITY_FAILED", `review basis artifact was edited without registration: ${kind}`, {
        kind,
        recoveryHint: `Re-register the edited ${kind} artifact with the latest feature revision known before the edit.`
      });
    }
    return { kind, path: artifact.path, sha256: artifact.sha256, contents };
  }));
  const projectContents = await readFile9(path12.join(root2, ".dev-flow", "project.json"), "utf8");
  if (digest5(projectContents) !== projectConfigSha256) {
    invalid3("REVIEW_BASIS_UNAVAILABLE", "project configuration changed while review basis was being captured");
  }
  const scopeManifest = {
    inScope: [...state.scope.inScope].sort(),
    outOfScope: [...state.scope.outOfScope].sort(),
    protectedRoots: [...config.protectedRoots].sort(),
    rollbackFileScopes: Object.values(trace2.nodes).reduce((scopes, node) => {
      if (node.kind === "rollback" && node.status === "current") {
        scopes.push({ id: node.id, fileScope: [...node.fileScope].sort() });
      }
      return scopes;
    }, []).sort((left, right) => left.id.localeCompare(right.id))
  };
  const protectedRootsFingerprint = await fingerprintProtectedRoots(root2, config);
  const basis = {
    featureId: state.featureId,
    route: state.route,
    workflowCapabilities: { ...state.workflowCapabilities ?? { trace: 0, review: 0, checkpoints: 0, rollbackExecution: 0 } },
    classification: {
      level: state.classification.level,
      topology: state.classification.topology,
      ...state.classification.execution ? { execution: state.classification.execution } : {},
      ...state.classification.requirements ? { requirements: state.classification.requirements } : {},
      riskLabels: [...state.classification.riskLabels].sort()
    },
    artifacts: frozenArtifacts.map(({ kind, path: artifactPath, sha256 }) => ({ kind, path: artifactPath, sha256 })),
    traceability: { path: state.traceability.path, sha256: state.traceability.sha256, revision: trace2.revision },
    projectConfigSha256,
    scopeManifestSha256: digest5(canonicalReviewValueJson(scopeManifest)),
    protectedRootsFingerprint
  };
  return {
    basis,
    frozenArtifacts,
    projectConfig: { sha256: projectConfigSha256, contents: projectContents },
    scopeManifest: {
      protectedRoots: scopeManifest.protectedRoots,
      rollbackFileScopes: scopeManifest.rollbackFileScopes.flatMap((item) => item.fileScope)
    }
  };
}
function basisHash(basis) {
  return digest5(canonicalReviewValueJson(basis));
}
function requireClaimRequestId(value) {
  if (typeof value !== "string" || value.length < 24 || !/[A-Za-z]/.test(value) || !/[0-9]/.test(value)) {
    invalid3("REVIEW_CLAIM_REQUEST_INVALID", "claimRequestId must be an unguessable high-entropy value");
  }
}
function findJob(batch, jobId) {
  const job = batch.jobs.find((candidate) => candidate.jobId === jobId);
  if (!job) invalid3("REVIEW_JOB_NOT_FOUND", "review job does not exist", { batchId: batch.batchId, jobId });
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
    rawSha256: digest5(parsed.raw),
    acceptedAt: now.toISOString()
  };
}
function assertAttestationUnique(ledger, batchId, jobId, attestation) {
  for (const batch of ledger.batches) {
    for (const job of batch.jobs) {
      if (batch.batchId === batchId && job.jobId === jobId) continue;
      if (job.status !== "submitted" || !job.submission?.attestation) continue;
      if (job.submission.attestation.rawSha256 === attestation.rawSha256) {
        invalid3("REVIEW_ATTESTATION_REUSED", "the same host attestation cannot be reused across review jobs or successor batches", {
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
  return normalized.length > 0 && normalized === normalized.trim() && !path12.posix.isAbsolute(normalized) && !normalized.includes("\\") && path12.posix.normalize(normalized) === normalized && !normalized.split("/").includes("..");
}
function validScopeManifest(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const manifest = value;
  return Array.isArray(manifest.protectedRoots) && Array.isArray(manifest.rollbackFileScopes) && manifest.protectedRoots.every((entry) => typeof entry === "string" && safePackagePath(entry)) && manifest.rollbackFileScopes.every((entry) => typeof entry === "string" && safePackagePath(entry));
}
async function readBoundReviewPackage(root2, featureId, batch, job) {
  const reviewPackage = await readReviewPackage(root2, featureId, job.packageSha256);
  if (typeof reviewPackage !== "object" || reviewPackage === null || Array.isArray(reviewPackage)) {
    invalid3("REVIEW_INTEGRITY_FAILED", "review package does not belong to its job", { batchId: batch.batchId, jobId: job.jobId });
  }
  const packageRecord = reviewPackage;
  if (packageRecord.featureId !== featureId || packageRecord.batchId !== batch.batchId || packageRecord.jobId !== job.jobId || packageRecord.basisHash !== batch.basisHash) {
    invalid3("REVIEW_INTEGRITY_FAILED", "review package does not belong to its job", { batchId: batch.batchId, jobId: job.jobId });
  }
  return packageRecord;
}
function assertFindingScope(manifest, findings, resolutions) {
  const allowed = [.../* @__PURE__ */ new Set([...manifest.protectedRoots, ...manifest.rollbackFileScopes])];
  const inManifest = (value) => {
    const normalized = normalizeUnicode(value);
    return safePackagePath(normalized) && allowed.some((scope) => pathWithinFileScope(normalized, [scope]));
  };
  const invalidPaths = [];
  for (const finding of findings) {
    if (finding.severity === "blocking" && !finding.evidence.length) invalid3("REVIEW_FINDING_EVIDENCE_REQUIRED", "blocking finding requires evidence");
    invalidPaths.push(...finding.targets.filter((target) => !inManifest(target)));
    invalidPaths.push(...finding.evidence.map((evidence) => evidence.path).filter((path18) => !inManifest(path18)));
  }
  invalidPaths.push(...resolutions.flatMap((resolution) => resolution.evidence.map((evidence) => evidence.path).filter((path18) => !inManifest(path18))));
  if (invalidPaths.length) {
    invalid3("REVIEW_FINDING_SCOPE_INVALID", "finding targets and evidence must be package-relative paths inside the scope manifest", {
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
    if (current.lifecycle !== "active") invalid3("INVALID_LIFECYCLE", "only active features can create review batches");
    const ledger = await readReviewLedger(root2, current);
    const reviewInput = await deriveReviewInput(root2, current);
    const { basis } = reviewInput;
    const currentBasisHash = basisHash(basis);
    const existing = ledger.batches.find((batch2) => batch2.validity === "current" && batch2.basisHash === currentBasisHash);
    if (existing) {
      result = { state: void 0, batch: existing, created: false };
      return { mutate: () => void 0, unchanged: true, eventData: { batchId: existing.batchId, basisHash: currentBasisHash, idempotent: true } };
    }
    const requirements = deriveReviewJobRequirements(current.route, current.classification.riskLabels);
    if (!requirements.length) invalid3("REVIEW_ROUTE_UNSUPPORTED", "review jobs require a standard M or L route");
    const batchId = randomUUID6();
    const jobs = [];
    for (const requirement of requirements) {
      const jobId = randomUUID6();
      const carried = carriedFindings(ledger, requirement.role);
      const packageSha256 = await writeReviewPackage(root2, current.featureId, {
        schemaVersion: 1,
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
      basis,
      basisHash: currentBasisHash,
      validity: "current",
      progress: "open",
      executionMode: "isolated-sequential",
      assuranceLevel: assuranceForReview2a(),
      jobs
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
      eventData: { batchId, basisHash: currentBasisHash, roles: jobs.map((job) => job.role) }
    };
  });
  return { ...result, state };
}
async function getReviewJob(root2, id, batchId, jobId, capability) {
  const state = await readState(root2, id);
  const batch = currentBatch2(await readReviewLedger(root2, state), batchId);
  const job = findJob(batch, jobId);
  if (!job.claim || digest5(capability) !== job.claim.requestSha256) invalid3("REVIEW_JOB_CAPABILITY_INVALID", "review job capability is invalid");
  const reviewPackage = await readBoundReviewPackage(root2, id, batch, job);
  return { job: visibleJob(job), package: reviewPackage };
}
async function claimReviewJob(root2, id, expectedRevision, batchId, jobId, claimRequestId, now = /* @__PURE__ */ new Date()) {
  requireClaimRequestId(claimRequestId);
  let result;
  const state = await mutatePrepared(root2, id, expectedRevision, "review-job-claimed", async (current, nextStateRevision) => {
    const ledger = await readReviewLedger(root2, current);
    const batch = currentBatch2(ledger, batchId);
    const requestSha256 = digest5(claimRequestId);
    const original = findJob(batch, jobId);
    const job = recoverExpiredSampling(recoverExpiredLease(original, now), now);
    if (job.status === "submitted") invalid3("REVIEW_JOB_ALREADY_SUBMITTED", "review job has already been submitted", { jobId });
    if (job.status === "sampling") invalid3("REVIEW_JOB_SAMPLING_IN_PROGRESS", "review job is held by server sampling", { jobId });
    if (job.status === "claimed" && job.claim.requestSha256 !== requestSha256) {
      invalid3("REVIEW_JOB_ALREADY_CLAIMED", "review job is claimed by another capability", { jobId });
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
    if (original.status === "submitted") invalid3("REVIEW_JOB_ALREADY_SUBMITTED", "review job has already been submitted", { jobId });
    if (original.status === "sampling") invalid3("REVIEW_JOB_SAMPLING_IN_PROGRESS", "review job is held by server sampling", { jobId });
    if (original.status !== "claimed" || !original.claim) invalid3("REVIEW_JOB_NOT_CLAIMED", "review job is not currently claimed", { jobId });
    if (digest5(capability) !== original.claim.requestSha256) invalid3("REVIEW_JOB_CAPABILITY_INVALID", "review job capability is invalid");
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
async function submitParsedReviewJob(root2, featureId, ledger, batch, job, parsed, now, samplingAttempt, hostAttestation) {
  const normalizedParsed = normalizeReviewCompletion(parsed);
  if (normalizedParsed.findings.some((finding) => finding.category !== job.role)) {
    invalid3("REVIEW_FINDING_ROLE_MISMATCH", "a job may only submit findings for its assigned review role", { jobId: job.jobId, role: job.role });
  }
  if (samplingAttempt && hostAttestation) {
    invalid3("REVIEW_ATTESTATION_INVALID", "server sampling submissions cannot carry host attestation");
  }
  if (hostAttestation) assertAttestationUnique(ledger, batch.batchId, job.jobId, hostAttestation);
  const reviewPackage = await readBoundReviewPackage(root2, featureId, batch, job);
  if (!validScopeManifest(reviewPackage.scopeManifest)) {
    invalid3("REVIEW_INTEGRITY_FAILED", "review package scope manifest is invalid", { jobId: job.jobId });
  }
  const manifest = reviewPackage.scopeManifest;
  assertFindingScope(manifest, normalizedParsed.findings, normalizedParsed.resolutions ?? []);
  const dispositions = { ...batch.dispositions };
  const findingEvents = [];
  const resolvedIds = /* @__PURE__ */ new Set();
  for (const resolution of normalizedParsed.resolutions ?? []) {
    if (resolvedIds.has(resolution.findingId)) invalid3("REVIEW_RESOLUTION_DUPLICATE", "a finding may be resolved only once per successor batch", { findingId: resolution.findingId });
    const source = ledger.batches.filter((candidate) => candidate.batchId !== batch.batchId).flatMap((candidate) => candidate.jobs.map((candidateJob) => ({ batch: candidate, job: candidateJob }))).find(({ job: candidateJob }) => candidateJob.submission?.findings.some((finding2) => finding2.findingId === resolution.findingId));
    const finding = source?.job.submission?.findings.find((candidate) => candidate.findingId === resolution.findingId);
    if (!source || !finding) invalid3("REVIEW_RESOLUTION_UNKNOWN_FINDING", "resolution references an unknown prior finding", { findingId: resolution.findingId });
    if (finding.severity !== "blocking" || source.job.role !== job.role) {
      invalid3("REVIEW_RESOLUTION_ROLE_MISMATCH", "only the same role may resolve a prior blocking finding", { findingId: resolution.findingId });
    }
    if (dispositions[resolution.findingId]) {
      invalid3("REVIEW_RESOLUTION_ALREADY_DISPOSED", "a prior finding already has a disposition", { findingId: resolution.findingId });
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
      basisHash: batch.basisHash,
      evidence: resolution,
      at: now.toISOString()
    } : {
      type: "still-blocking",
      findingId: resolution.findingId,
      successorBatchId: batch.batchId,
      resolutionJobId: job.jobId,
      basisHash: batch.basisHash,
      reason: resolution.note,
      at: now.toISOString()
    });
    resolvedIds.add(resolution.findingId);
  }
  const payloadSha256 = digest5(canonicalReviewValueJson(normalizedParsed));
  const findings = dedupeFindings(normalizedParsed.findings).map((finding) => ({
    ...finding,
    findingId: `F-${randomUUID6()}`,
    jobId: job.jobId
  }));
  for (const finding of findings) {
    findingEvents.push({ type: "origin", finding, batchId: batch.batchId, role: job.role, basisHash: batch.basisHash, at: now.toISOString() });
  }
  const missingCarried = (job.carriedFindings ?? []).filter((finding) => !resolvedIds.has(finding.findingId));
  if (missingCarried.length) {
    invalid3("REVIEW_CARRIED_FINDING_UNRESOLVED", "\u6BCF\u4E2A\u7ED3\u8F6C blocker \u90FD\u5FC5\u987B\u63D0\u4EA4\u660E\u786E\u5904\u7F6E\u7ED3\u679C", {
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
      ...hostAttestation ? { attestation: hostAttestation } : {}
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
    progress: updatedBatch.jobs.every((candidate) => candidate.status === "submitted") ? "complete" : "open"
  };
  return { batch: withDerivedAssurance(updatedBatch), payloadSha256, findingEvents };
}
async function submitReviewJob(root2, id, expectedRevision, batchId, jobId, capability, completion, attestationOrNow, maybeNow) {
  const attestation = attestationOrNow instanceof Date ? void 0 : attestationOrNow;
  const now = attestationOrNow instanceof Date ? attestationOrNow : maybeNow instanceof Date ? maybeNow : /* @__PURE__ */ new Date();
  const parsed = parseReviewJobCompletion(completion);
  const hostAttestation = attestation === void 0 ? void 0 : normalizeHostAttestation(attestation, now);
  let result;
  const state = await mutatePrepared(root2, id, expectedRevision, "review-job-submitted", async (current, nextStateRevision) => {
    const ledger = await readReviewLedger(root2, current);
    const batch = currentBatch2(ledger, batchId);
    const job = findJob(batch, jobId);
    const payloadSha256 = digest5(canonicalReviewValueJson(parsed));
    if (job.status === "sampling") invalid3("REVIEW_JOB_SAMPLING_IN_PROGRESS", "review job is held by server sampling", { jobId });
    if (!job.claim || digest5(capability) !== job.claim.requestSha256) {
      invalid3("REVIEW_JOB_CAPABILITY_INVALID", "review job capability is invalid");
    }
    if (job.status === "submitted") {
      if (job.submission?.payloadSha256 !== payloadSha256) invalid3("REVIEW_SUBMISSION_CONFLICT", "review job was submitted with a different payload", { jobId });
      if (hostAttestation) {
        const existing = job.submission?.attestation;
        if (!existing || existing.rawSha256 !== hostAttestation.rawSha256 || existing.agentId !== hostAttestation.agentId || existing.host !== hostAttestation.host) {
          invalid3("REVIEW_SUBMISSION_CONFLICT", "review job was submitted with a different host attestation", { jobId });
        }
      } else if (job.submission?.attestation) {
        invalid3("REVIEW_SUBMISSION_CONFLICT", "review job was submitted with a different host attestation", { jobId });
      }
      result = { batch, idempotent: true };
      return { mutate: () => void 0, unchanged: true, eventData: { batchId, jobId, idempotent: true } };
    }
    if (Date.parse(job.claim.leaseExpiresAt) <= now.getTime()) invalid3("REVIEW_JOB_LEASE_EXPIRED", "review job lease has expired", {
      jobId,
      leaseExpiresAt: job.claim.leaseExpiresAt,
      recoveryHint: "\u91CD\u65B0 claim \u5F53\u524D job \u540E\u518D\u63D0\u4EA4\uFF1B\u8FC7\u671F\u79DF\u7EA6\u4E0D\u4F1A\u81EA\u52A8\u4FDD\u7559\u63D0\u4EA4\u6743"
    });
    let submitted;
    try {
      submitted = await submitParsedReviewJob(root2, id, ledger, batch, job, parsed, now, void 0, hostAttestation);
    } catch (error) {
      if (error instanceof DevFlowError) {
        invalid3(error.code, error.message, {
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
    invalid3("REVIEW_SAMPLING_REQUEST_REPLAY", "sampling request is not valid for a current review batch", { batchId });
  }
  return batch;
}
function samplingAttemptForRequest(job, requestId) {
  const requestSha256 = digest5(requestId);
  const attempt = activeSamplingAttempt(job);
  if (job.status !== "sampling" || !attempt || attempt.requestSha256 !== requestSha256) {
    invalid3("REVIEW_SAMPLING_REQUEST_REPLAY", "sampling request was already consumed or does not belong to this job", { jobId: job.jobId });
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
    if (job.status === "submitted") invalid3("REVIEW_JOB_ALREADY_SUBMITTED", "review job has already been submitted", { jobId });
    if (job.status === "claimed") invalid3("REVIEW_JOB_ALREADY_CLAIMED", "review job is claimed by a human capability", { jobId });
    if (job.status === "sampling") invalid3("REVIEW_JOB_SAMPLING_IN_PROGRESS", "review job is already held by server sampling", { jobId });
    const requestId = `${randomUUID6()}-${randomUUID6()}`;
    const attempt = {
      requestSha256: digest5(requestId),
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
      invalid3("REVIEW_SAMPLING_REQUEST_EXPIRED", "sampling request lease has expired", { jobId });
    }
    const submitted = await submitParsedReviewJob(root2, id, ledger, batch, job, parsed, now, attempt);
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
    invalid3("REVIEW_RISK_ACCEPTANCE_INVALID", "risk acceptance requires one or more finding ids");
  }
  const sorted = [...findingIds].sort();
  if (new Set(sorted).size !== sorted.length) {
    invalid3("REVIEW_RISK_ACCEPTANCE_INVALID", "risk acceptance finding ids must be unique");
  }
  return sorted;
}
function findingSetHash(batch, findings) {
  const items = findings.map((finding) => ({ findingId: finding.findingId, sha256: digest5(canonicalReviewValueJson(finding)) })).sort((left, right) => left.findingId.localeCompare(right.findingId));
  return digest5(canonicalReviewValueJson({ batchId: batch.batchId, basisHash: batch.basisHash, findings: items }));
}
function riskBinding(interaction) {
  const binding = interaction.binding;
  if (interaction.kind !== "risk-acceptance" || !binding || typeof binding.batchId !== "string" || typeof binding.findingSetHash !== "string" || !Array.isArray(binding.findingIds)) {
    invalid3("REVIEW_RISK_ACCEPTANCE_INVALID", "interaction is not a valid review risk-acceptance decision", { interactionId: interaction.id });
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
  if (!batch) invalid3("REVIEW_BATCH_REQUIRED", "a current review batch is required");
  const requireLiveBasis = options.requireLiveBasis ?? !planReviewBoundToBatch(state, batch);
  if (requireLiveBasis) {
    const reviewInput = await deriveReviewInput(root2, state);
    if (basisHash(reviewInput.basis) !== batch.basisHash) {
      invalid3("REVIEW_BASIS_STALE", "review batch basis no longer matches current feature state", {
        batchId: batch.batchId,
        recoveryHint: "\u91CD\u5EFA\u6279\u6B21\u2192\u91CD\u4EA4 jobs\u2192re-record planning"
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
    const unresolved = new Map(unresolvedBlockingFindings(ledger, batch.basisHash).map((finding) => [finding.findingId, finding]));
    const selected2 = sortedFindingIds(findingIds).map((findingId) => unresolved.get(findingId));
    if (selected2.some((finding) => !finding)) invalid3("REVIEW_RISK_ACCEPTANCE_INVALID", "\u98CE\u9669\u63A5\u53D7\u53EA\u80FD\u8986\u76D6\u5F53\u524D\u672A\u89E3\u51B3\u7684\u963B\u65AD\u53D1\u73B0", { findingIds });
    return selected2;
  }
  const byId = new Map(submittedFindings(ledger).filter(({ batch: source, finding }) => source.batchId === batch.batchId && finding.severity === "blocking" && (!unresolvedOnly || !batch.dispositions?.[finding.findingId])).map(({ finding }) => [finding.findingId, finding]));
  const selected = sortedFindingIds(findingIds).map((findingId) => byId.get(findingId));
  if (selected.some((finding) => !finding)) {
    invalid3("REVIEW_RISK_ACCEPTANCE_INVALID", "risk acceptance can cover only current unresolved blocking findings", {
      batchId: batch.batchId,
      findingIds
    });
  }
  return selected;
}
async function presentReviewRiskAcceptance(root2, id, expectedRevision, findingIds) {
  let result;
  const state = await mutatePrepared(root2, id, expectedRevision, "review-risk-acceptance-presented", async (current) => {
    const { ledger, batch } = await currentBatchWithBasis(root2, current);
    if (batch.progress !== "complete") invalid3("REVIEW_BATCH_INCOMPLETE", "all required review jobs must be submitted", { batchId: batch.batchId });
    const findings = acceptanceFindings(ledger, batch, findingIds);
    const ids = findings.map((finding) => finding.findingId).sort();
    const setHash = findingSetHash(batch, findings);
    const target = `review-risk:${batch.batchId}:${setHash}`;
    const existing = findInteractionForTarget(current, target);
    if (existing) {
      result = { interaction: toPublicInteraction(existing), idempotent: true };
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
        result = { interaction: toPublicInteraction(interaction), idempotent: false };
      },
      eventData: { batchId: batch.batchId, findingIds: ids, findingSetHash: setHash }
    };
  });
  return { ...result, state };
}
function assertResolvedAcceptance(state, interaction, batch, findings) {
  const binding = riskBinding(interaction);
  const expectedIds = findings.map((finding) => finding.findingId).sort();
  const expectedSetHash = findingSetHash(batch, findings);
  if (interaction.basisHash !== batch.basisHash || binding.batchId !== batch.batchId || binding.findingSetHash !== expectedSetHash || binding.findingIds.join("\n") !== expectedIds.join("\n")) {
    invalid3("REVIEW_RISK_ACCEPTANCE_STALE", "risk acceptance no longer matches the current batch and finding set", { interactionId: interaction.id });
  }
  if (state.interactions?.[interaction.id] !== interaction) {
    invalid3("REVIEW_RISK_ACCEPTANCE_INVALID", "risk acceptance interaction is not part of feature state", { interactionId: interaction.id });
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
  if (payload.text !== userReply) {
    throw new DevFlowError("REVIEW_RISK_ACCEPTANCE_REPLY_MISMATCH", "userReply must match the captured prompt text exactly", {
      eventId: promptEventId,
      recoveryHint: "\u4F20\u5165\u4E0E host event \u5B8C\u5168\u4E00\u81F4\u7684 userReply"
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
async function resolveReviewRiskAcceptanceAnswer(root2, id, expectedRevision, interactionId, userReply, host) {
  let result;
  const state = await mutatePrepared(root2, id, expectedRevision, "review-risk-acceptance-resolved", async (current, nextStateRevision) => {
    const interaction = getInteraction(current, interactionId);
    const events = await readFeatureEvents(root2, id);
    const resolvedPromptEventId = resolvePromptEvent(events, {
      host,
      userReply,
      presentedAt: interaction.presentedAt,
      presentedRevision: current.pendingDecision?.presentedRevision ?? current.revision - 1
    }).eventId;
    const hostEvent = events.find((event) => event.type === "host-event" && event.data.eventId === resolvedPromptEventId);
    assertReviewRiskAcceptanceEvidence(hostEvent, interaction, resolvedPromptEventId, userReply, host);
    const { ledger, batch } = await currentBatchWithBasis(root2, current);
    const binding = riskBinding(interaction);
    if (interaction.status === "resolved") {
      const findings2 = selectCurrentBlockingFindings(ledger, batch, binding.findingIds, false);
      assertResolvedAcceptance(current, interaction, batch, findings2);
      const accepted = interaction.response?.action === "accept" && interaction.response.source === "text" && interaction.response.userReply === userReply && interaction.response.promptEventId === resolvedPromptEventId && interaction.response.host === host;
      const dispositions2 = batch.dispositions ?? {};
      if (accepted && findings2.every((finding) => {
        const disposition = dispositions2[finding.findingId];
        return disposition?.kind === "risk-accepted" && disposition.interactionId === interaction.id && disposition.findingSetHash === binding.findingSetHash;
      })) {
        result = { acceptedFindingIds: binding.findingIds, idempotent: true };
        return { mutate: () => void 0, unchanged: true, eventData: { interactionId, idempotent: true } };
      }
      invalid3("INTERACTION_ALREADY_RESOLVED", interactionId);
    }
    const findings = acceptanceFindings(ledger, batch, binding.findingIds);
    assertResolvedAcceptance(current, interaction, batch, findings);
    const preview = structuredClone(current);
    const response = resolveTextInteraction(preview, interactionId, userReply, host, { promptEventId: resolvedPromptEventId });
    if (response.action !== "accept") {
      result = { acceptedFindingIds: [], idempotent: false };
      return {
        mutate: (draft) => {
          resolveTextInteraction(draft, interactionId, userReply, host, { promptEventId: resolvedPromptEventId });
        },
        eventData: { interactionId, batchId: batch.batchId, action: response.action }
      };
    }
    const dispositions = { ...batch.dispositions };
    for (const finding of findings) {
      dispositions[finding.findingId] = {
        kind: "risk-accepted",
        interactionId,
        acceptedAt: response.respondedAt,
        batchId: batch.batchId,
        basisHash: batch.basisHash,
        findingIds: binding.findingIds,
        findingSetHash: binding.findingSetHash
      };
    }
    const updatedBatch = { ...batch, dispositions };
    const findingEvents = findings.map((finding) => ({
      type: "risk-accepted",
      findingId: finding.findingId,
      batchId: batch.batchId,
      interactionId,
      basisHash: batch.basisHash,
      findingSetHash: binding.findingSetHash,
      userEvidence: userReply,
      at: response.respondedAt
    }));
    const pointer = await writeReviewSnapshot(root2, cloneLedger(
      ledger,
      nextStateRevision,
      ledger.batches.map((candidate) => candidate.batchId === batch.batchId ? updatedBatch : candidate),
      findingEvents
    ));
    result = { acceptedFindingIds: binding.findingIds, idempotent: false };
    return {
      mutate: (draft) => {
        resolveTextInteraction(draft, interactionId, userReply, host, { promptEventId: resolvedPromptEventId });
        draft.review = pointer;
      },
      eventData: { interactionId, batchId: batch.batchId, findingIds: binding.findingIds, findingSetHash: binding.findingSetHash }
    };
  });
  return { ...result, state };
}
async function assertReviewComplete(root2, state) {
  const { ledger, batch } = await currentBatchWithBasis(root2, state);
  if (batch.progress !== "complete") invalid3("REVIEW_BATCH_INCOMPLETE", "all required review jobs must be submitted", { batchId: batch.batchId });
  if (ledger.findingEvents?.length) {
    const unresolved = unresolvedBlockingFindings(ledger, batch.basisHash);
    if (unresolved.length && !hasCurrentQualityException(state, "review")) invalid3("REVIEW_BLOCKING_FINDINGS", "review ledger has unresolved blocking findings", {
      batchId: batch.batchId,
      findingIds: unresolved.map((finding) => finding.findingId)
    });
    await assertCurrentReviewProjection(root2, state);
    return { batchId: batch.batchId, basisHash: batch.basisHash, assuranceLevel: batch.assuranceLevel };
  }
  const jobs = ledger.batches.flatMap((candidate) => candidate.jobs);
  const dispositions = Object.assign({}, ...ledger.batches.map((candidate) => candidate.dispositions ?? {}));
  const blocking = jobs.flatMap((job) => job.submission?.findings ?? []).filter((finding) => {
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
  if (blocking.length) invalid3("REVIEW_BLOCKING_FINDINGS", "review batch has unresolved blocking findings", {
    batchId: batch.batchId,
    findingIds: blocking.map((finding) => finding.findingId)
  });
  await assertCurrentReviewProjection(root2, state);
  return { batchId: batch.batchId, basisHash: batch.basisHash, assuranceLevel: batch.assuranceLevel };
}

// plugins/dev-flow/src/core/auto-checkpoint.ts
import { randomUUID as randomUUID7 } from "node:crypto";
async function captureAutomaticCheckpoint(root2, featureId, expectedRevision, stage, reason = "stage-boundary") {
  const config = await readProjectConfig(root2);
  const files = await snapshotProtectedRoots(root2, config);
  const fingerprint2 = await fingerprintProtectedRoots(root2, config);
  const capturedAt = (/* @__PURE__ */ new Date()).toISOString();
  const checkpoint = {
    checkpointId: `AUTO-${randomUUID7()}`,
    stage,
    capturedAt,
    fingerprint: fingerprint2,
    files: files.map((file) => file.path).sort(),
    basisHash: decisionBasisHash({ stage, reason, fingerprint: fingerprint2, files: files.map((file) => file.path).sort() })
  };
  return mutate(root2, featureId, expectedRevision, "automatic-checkpoint-captured", (state) => {
    state.checkpoints = [...state.checkpoints ?? [], checkpoint];
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
  const route = routeDefinitionForFeature(state.route, state.workflowCapabilities);
  if (["verification", "feature_check", "finalize"].includes(step) || !route.orderedSteps.includes(step)) {
    const recoveryHint = step === "verification" ? "\u8BF7\u8C03\u7528 dev_flow_verify" : step === "feature_check" ? "\u8BF7\u8C03\u7528 dev_flow_feature_check" : step === "finalize" ? "\u8BF7\u8C03\u7528 dev_flow_finalize" : "\u8BF7\u4F7F\u7528\u5F53\u524D\u8DEF\u7EBF\u5141\u8BB8\u7684 record_step \u9636\u6BB5";
    throw new DevFlowError("INVALID_STEP", step, { recoveryHint });
  }
  assertCurrentStep(state, step);
}
function satisfyStepObligations(state, route, step) {
  if (step === "planning" && (state.route === "light-l" || state.route === "standard-l")) {
    state.obligations = satisfyObligations(state.obligations, ["rollback"]);
  }
  const riskReviewTarget = route.orderedSteps.includes("code_review") ? "code_review" : route.orderedSteps.includes("planning") ? "planning" : route.orderedSteps.includes("verification") ? "verification" : void 0;
  if (step === riskReviewTarget && state.classification.riskLabels.length > 0) {
    if (!reviewEnforcementRequired(state.route, state.workflowCapabilities)) {
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
  assertRecordableStep(initial, step);
  if (step === "implementation") {
    const files = implementationFiles(evidence);
    const config = await readProjectConfig(root2);
    assertImplementationFilesInProtectedRoots(files, config.protectedRoots);
    await assertImplementationFilesExist(root2, files);
    normalizedEvidence = {
      ...typeof evidence === "object" && evidence !== null && !Array.isArray(evidence) ? evidence : {},
      files
    };
  }
  const next = await mutate(root2, id, expectedRevision, "step-recorded", async (state) => {
    assertRecordableStep(state, step);
    const route = routeDefinitionForFeature(state.route, state.workflowCapabilities);
    await assertRequirementsGrillSatisfied(root2, id, state);
    await assertTraceGateCurrent(root2, state, step);
    if (step === "implementation" && state.schemaVersion === 3 && checkpointsEnforcementRequired(state.route, state.workflowCapabilities)) {
      await assertImplementationUnitsComplete(root2, state);
    }
    const required = requiredEvidenceForStep(
      state.route,
      state.classification.riskLabels,
      step,
      state.workflowCapabilities
    );
    if (required.fields.reviewBatch) {
      normalizedEvidence = await assertReviewComplete(root2, state);
    } else {
      assertRequiredEvidence(step, required, normalizedEvidence);
    }
    state.steps[step] = { status: "satisfied", evidence: normalizedEvidence };
    satisfyStepObligations(state, route, step);
    const next2 = route.orderedSteps.find((candidate) => state.steps[candidate]?.status !== "satisfied");
    state.currentStage = next2;
  });
  if (next.schemaVersion === 3 && next.currentStage === "implementation" && !next.checkpoints?.length) {
    return captureAutomaticCheckpoint(root2, id, next.revision, "implementation", "implementation-entry");
  }
  if (step === "implementation" && next.schemaVersion === 3 && next.checkpoints?.length) {
    return captureAutomaticCheckpoint(root2, id, next.revision, "implementation", "implementation-complete");
  }
  return next;
}
async function assertImplementationUnitsComplete(root2, state) {
  const ledger = await readTraceability(root2, state);
  const required = Object.values(ledger.nodes).filter((node) => node.kind === "rollback" && node.status === "current");
  const units = new Map((state.implementationUnits ?? []).map((unit) => [unit.unitId, unit]));
  const incomplete = required.map((node) => node.id).filter((nodeId) => units.get(nodeId)?.status !== "checkpointed");
  if (incomplete.length) {
    throw new DevFlowError("IMPLEMENTATION_UNITS_INCOMPLETE", "every rollback unit must be checkpointed before recording implementation", {
      incomplete
    });
  }
}
async function invalidateBeforeFinalClaim(root2, id, expectedRevision) {
  const state = await readState(root2, id);
  if (hasCurrentQualityException(state, "verification")) return;
  const invalidated = await invalidateStaleVerification(root2, id, expectedRevision);
  if (invalidated) {
    throw new DevFlowError("VERIFICATION_STALE", "protected files changed; rerun verification", {
      currentRevision: invalidated.revision
    });
  }
}
function assertVerificationWasNotInvalidated(state) {
  const evidence = state.steps.verification?.evidence;
  if (evidence?.reason === "protected-files-changed" && !hasCurrentQualityException(state, "verification")) {
    throw new DevFlowError("VERIFICATION_STALE", "protected files changed; rerun verification");
  }
}
async function featureCheck(root2, id, expectedRevision) {
  const initial = await readState(root2, id);
  if (initial.revision !== expectedRevision) {
    throw new DevFlowError("STATE_REVISION_CONFLICT", "state revision changed", {
      currentRevision: initial.revision
    });
  }
  await assertRequirementsGrillSatisfied(root2, id, initial);
  await invalidateBeforeFinalClaim(root2, id, expectedRevision);
  await assertArtifactIntegrity(root2, id);
  return mutate(root2, id, expectedRevision, "feature-checked", async (state) => {
    await assertRequirementsGrillSatisfied(root2, id, state);
    assertVerificationWasNotInvalidated(state);
    assertCurrentStep(state, "feature_check");
    await assertTraceGateCurrent(root2, state, "feature_check");
    if (state.verification.verifiedFingerprint !== state.businessFingerprint && !hasCurrentQualityException(state, "verification")) {
      throw new DevFlowError("VERIFICATION_STALE", "protected files changed or verification did not pass");
    }
    const orderedSteps = routeDefinitionForFeature(state.route, state.workflowCapabilities).orderedSteps;
    const featureCheckIndex = orderedSteps.indexOf("feature_check");
    for (const step of orderedSteps.slice(0, featureCheckIndex)) {
      const required = requiredEvidenceForStep(
        state.route,
        state.classification.riskLabels,
        step,
        state.workflowCapabilities
      );
      if (required.fields.reviewBatch) {
        await assertReviewComplete(root2, state);
        continue;
      }
      if (requiredEvidenceIsEmpty(required)) continue;
      assertRequiredEvidence(step, required, state.steps[step]?.evidence);
    }
    state.featureCheck = { passed: true, fingerprint: state.businessFingerprint };
    state.steps.feature_check = { status: "satisfied" };
  });
}
async function finalize(root2, id, expectedRevision) {
  const initial = await readState(root2, id);
  if (initial.revision !== expectedRevision) {
    throw new DevFlowError("STATE_REVISION_CONFLICT", "state revision changed", {
      currentRevision: initial.revision
    });
  }
  await assertRequirementsGrillSatisfied(root2, id, initial);
  await invalidateBeforeFinalClaim(root2, id, expectedRevision);
  await assertArtifactIntegrity(root2, id);
  const config = await readProjectConfig(root2);
  const reconciledWorkspace = initial.workspace.baseHead ? await reconcileWorkspaceLineage(root2, initial.workspace, config) : initial.workspace;
  let snapshot;
  return mutate(root2, id, expectedRevision, "finalized", async (state) => {
    await assertRequirementsGrillSatisfied(root2, id, state);
    assertVerificationWasNotInvalidated(state);
    const route = routeDefinitionForFeature(state.route, state.workflowCapabilities);
    state.workspace = reconciledWorkspace;
    assertCurrentStep(state, "finalize");
    await assertTraceGateCurrent(root2, state, "finalize");
    if (route.featureCheckRequired && (!state.featureCheck.passed || state.featureCheck.fingerprint !== state.businessFingerprint)) {
      throw new DevFlowError("FEATURE_CHECK_REQUIRED", "feature check is required");
    }
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
    state.currentStage = "complete";
  }, () => snapshot ? { deliverySnapshot: snapshot } : {});
}

// plugins/dev-flow/src/core/approval-interactions.ts
import { createHash as createHash14 } from "node:crypto";

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

// plugins/dev-flow/src/core/approval-interactions.ts
var digest6 = (value) => createHash14("sha256").update(JSON.stringify(value)).digest("hex");
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
  if (reviewEnforcementRequired(state.route, state.workflowCapabilities)) {
    await assertCurrentReviewProjection(root2, state);
  }
}
async function presentApproval(root2, id, expectedRevision, requestedApprovalId) {
  const selectedApproval = approvalId(requestedApprovalId);
  let interaction;
  const state = await mutate(root2, id, expectedRevision, "approval-presented", async (state2) => {
    if (state2.lifecycle !== "active") {
      throw new DevFlowError("INVALID_LIFECYCLE", "approval requires active feature");
    }
    const obligation = state2.obligations?.find((candidate) => candidate.id === selectedApproval && candidate.kind === "approval");
    if (!obligation || obligation.status === "satisfied") throw new DevFlowError("INVALID_APPROVAL", selectedApproval);
    const definition = routeDefinitionForFeature(state2.route, state2.workflowCapabilities);
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
    const basisHash2 = digest6(approvalBasis(state2, selectedApproval));
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
    interactionId: interaction?.id
  }));
  if (!interaction) throw new DevFlowError("INTERACTION_NOT_CREATED", selectedApproval);
  return { ...state, approvalId: selectedApproval, interactionId: interaction.id, approvalReplyHint: decisionHint(interaction), approvalInteraction: toPublicInteraction(interaction) };
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
  if (event?.type !== "user-prompt" || normalizeReplyText(String(event.text ?? "")) !== normalizeReplyText(userReply)) {
    throw new DevFlowError("APPROVAL_REPLY_MISMATCH", "userReply must match the captured prompt", {
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
    return item.type === "host-event" && typeof event.eventId === "string" && !consumed.has(event.eventId) && event.type === "user-prompt" && event.host === host && normalizeReplyText(String(event.text ?? "")) === normalizeReplyText(userReply) && item.revision > (current?.presentedRevision ?? state.revision) && typeof current?.presentedAt === "string" && typeof event.at === "string" && Date.parse(event.at) >= Date.parse(current.presentedAt);
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
function approvalFromInteraction(state, interactionId) {
  const interaction = getInteraction(state, interactionId);
  if (interaction.kind !== "approval" || !interaction.target.startsWith("approval:")) {
    throw new DevFlowError("INTERACTION_TARGET_INVALID", interactionId);
  }
  return approvalId(interaction.target.slice("approval:".length));
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
async function resolveApprovalResponse(root2, id, expectedRevision, interactionId, host, input) {
  const initial = await readState(root2, id);
  if (initial.revision !== expectedRevision) {
    throw new DevFlowError("STATE_REVISION_CONFLICT", "state revision changed", { currentRevision: initial.revision });
  }
  const approval = approvalFromInteraction(initial, interactionId);
  const events = input.source === "text" ? await readFeatureEvents(root2, id) : [];
  const provenance = input.source === "text" ? assertTokenEvidence(events, initial, approval, input.userReply, input.provenance, host) : void 0;
  let response;
  return mutate(root2, id, expectedRevision, "approval-interaction-resolved", async (state) => {
    await assertRequirementsGrillSatisfied(root2, id, state);
    await assertTraceGateCurrent(root2, state, "planning");
    await assertReviewProjectionForApproval(root2, state);
    const current = state.humanGates[approval];
    if (current?.status !== "pending") throw new DevFlowError("APPROVAL_NOT_PENDING", approval);
    const interaction = getInteraction(state, interactionId);
    if (interaction.kind !== "approval" || interaction.target !== `approval:${approval}` || interaction.status !== "pending") {
      throw new DevFlowError("INTERACTION_NOT_PENDING", interactionId);
    }
    const basisHash2 = digest6(approvalBasis(state, approval));
    if (basisHash2 !== current.basisHash || basisHash2 !== interaction.basisHash) {
      throw new DevFlowError("APPROVAL_BASIS_CHANGED", approval, {
        recoveryHint: "\u95E8\u7981\u4F9D\u636E\u5DF2\u53D8\u66F4\uFF0C\u8BF7\u66F4\u65B0\u5E76\u767B\u8BB0\u76F8\u5173\u8D44\u4EA7\u540E\u91CD\u65B0\u5448\u73B0\u95E8\u7981"
      });
    }
    if (input.source === "text") {
      const ids = [
        ...provenance?.promptEventId ? [provenance.promptEventId] : [],
        ...provenance?.turnBoundaryEventId ? [provenance.turnBoundaryEventId] : []
      ];
      for (const [otherApproval, value] of Object.entries(state.humanGates)) {
        if (otherApproval === approval) continue;
        const replayed = confirmationEventIds(value).find((eventId) => ids.includes(eventId));
        if (replayed) throw new DevFlowError("APPROVAL_EVENT_CONSUMED", replayed);
      }
    }
    response = input.source === "elicitation" ? resolveNativeInteraction(state, interactionId, input.action, input.comment, host) : resolveTextInteraction(
      state,
      interactionId,
      input.userReply,
      host,
      provenance,
      // 动态 approval 支持自然语言批准词（如“确认需求”“批准实现”），映射为 confirm 选项；
      // Approval phrases are handled by the single natural-language answer path.
      isExplicitApproval(input.userReply) ? "confirm" : void 0
    );
    if (response.action === "confirm") {
      state.humanGates[approval] = {
        ...current,
        status: "confirmed",
        confirmation: {
          interactionId,
          ...response,
          confirmedAt: (/* @__PURE__ */ new Date()).toISOString()
        }
      };
      state.obligations = satisfyObligations(state.obligations, ["approval"]);
    } else if (response.action === "request-changes") {
      state.humanGates[approval] = { ...current, status: "returned", lastResponse: response };
    } else {
      throw new DevFlowError("INTERACTION_ACTION_INVALID", response.action);
    }
    state.lastUpdatedBy = { host, pluginVersion: "4.1.0" };
  }, () => ({ approval, interactionId, response }));
}
async function resolveApprovalElicitation(root2, id, expectedRevision, interactionId, action, comment, host) {
  return resolveApprovalResponse(root2, id, expectedRevision, interactionId, host, { action, comment, source: "elicitation" });
}
async function resolveApprovalAnswer(root2, id, expectedRevision, interactionId, userReply, host) {
  return resolveApprovalResponse(root2, id, expectedRevision, interactionId, host, {
    userReply,
    provenance: {},
    source: "text"
  });
}

// plugins/dev-flow/src/policy/stages.ts
var routeStages = Object.freeze({
  xs: ["locate", "implementation", "verification", "finalize"],
  s: ["boundary", "implementation", "verification", "finalize"],
  "light-m": ["planning", "implementation", "code_review", "verification", "finalize"],
  "standard-m": ["requirements_alignment", "planning", "implementation", "code_review", "verification", "finalize"],
  "light-l": ["planning", "implementation", "code_review", "verification", "finalize"],
  "standard-l": ["requirements_alignment", "planning", "implementation", "code_review", "verification", "finalize"]
});
function stagesForRoute(route) {
  return routeStages[route];
}
function effectiveStage(state) {
  if (state.mode === "intake" || !state.route) return "intake";
  if (state.lifecycle === "finalized") return "complete";
  const stages = stagesForRoute(state.route);
  if (state.steps) {
    const pending = stages.find((stage) => state.steps?.[stage]?.status !== "satisfied");
    if (pending) return pending;
  }
  return state.currentStage ?? stages[0];
}

// plugins/dev-flow/src/core/execution-brief.ts
function buildFeatureMutationSummary(state) {
  const obligations = state.obligations ?? [];
  const units = state.implementationUnits ?? [];
  const interactions2 = Object.values(state.interactions ?? {});
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
    }
  };
}

// plugins/dev-flow/src/policy/derive-next.ts
function deriveNext(state) {
  if (state.schemaVersion !== 3) throw new Error("UNSUPPORTED_STATE_SCHEMA");
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
  const approval = state.obligations?.find((obligation) => obligation.kind === "approval" && obligation.status !== "satisfied");
  const implementationIndex = definition.orderedSteps.indexOf("implementation");
  const implementationReady = implementationIndex >= 0 && definition.orderedSteps.slice(0, implementationIndex).every((step) => state.steps[step]?.status === "satisfied");
  if (approval && implementationReady) {
    return { kind: "present-human-gate", step: approval.id };
  }
  for (const step of definition.orderedSteps) {
    const snapshot = state.steps[step];
    if (snapshot?.status === "satisfied") continue;
    if (snapshot && snapshot.artifactReady === false) return { kind: "scaffold-artifact", step };
    return { kind: "run-step", step };
  }
  if (definition.featureCheckRequired && !state.featureCheckFresh) return { kind: "feature-check" };
  if (!state.logicComplete) return { kind: "finalize" };
  return { kind: "done" };
}

// plugins/dev-flow/src/core/next.ts
function toDerivedState(state, verificationStale) {
  const steps = { ...state.steps };
  if (verificationStale) steps.verification = { status: "pending" };
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
    steps,
    obligations: state.obligations,
    blockingFindings: state.blockingFindings,
    verificationFresh: !verificationStale && Boolean(
      state.verification.verifiedFingerprint && state.verification.verifiedFingerprint === state.businessFingerprint
    ),
    featureCheckFresh: !verificationStale && Boolean(
      state.featureCheck.passed && state.featureCheck.fingerprint === state.businessFingerprint
    ),
    logicComplete: state.logicComplete,
    repair: state.repair
  };
}
function enrichRunStep(state, step) {
  const requiredEvidence = requiredEvidenceForStep(
    state.route,
    state.classification.riskLabels,
    step,
    state.workflowCapabilities
  );
  return requiredEvidenceIsEmpty(requiredEvidence) ? { kind: "run-step", step } : { kind: "run-step", step, requiredEvidence };
}
function enrichFeatureCheck(state) {
  const requiredEvidence = requiredEvidenceForStep(
    state.route,
    state.classification.riskLabels,
    "feature_check",
    state.workflowCapabilities
  );
  return requiredEvidenceIsEmpty(requiredEvidence) ? { kind: "feature-check" } : { kind: "feature-check", requiredEvidence };
}
function traceStepForAction(action) {
  if (action.kind === "run-step") {
    if (action.step === "requirements_alignment") return "requirements";
    if (action.step === "planning") return "implementation_plan";
    return action.step;
  }
  if (action.kind === "present-human-gate") return action.step.startsWith("approval:") ? "implementation_plan" : action.step;
  if (action.kind === "feature-check") return "feature_check";
  if (action.kind === "finalize") return "finalize";
  return void 0;
}
async function reviewPlanAction(root2, state) {
  if (!reviewEnforcementRequired(state.route, state.workflowCapabilities)) return void 0;
  const ledger = await readReviewLedger(root2, state);
  const batch = ledger.batches.find((candidate) => candidate.validity === "current");
  if (!batch) return { kind: "create-review-batch", step: "planning" };
  if (batch.progress !== "complete") {
    return {
      kind: "review-jobs-pending",
      step: "planning",
      batchId: batch.batchId,
      jobs: batch.jobs.map(({ jobId, role, reviewDepth, status }) => ({ jobId, role, reviewDepth, status }))
    };
  }
  try {
    await assertReviewComplete(root2, state);
    return void 0;
  } catch (error) {
    const code = error.code;
    if (code === "REVIEW_BASIS_STALE" || code === "REVIEW_BATCH_REQUIRED") {
      return { kind: "create-review-batch", step: "planning" };
    }
    if (code === "REVIEW_BLOCKING_FINDINGS" || code === "REVIEW_BATCH_INCOMPLETE") {
      return {
        kind: "review-jobs-pending",
        step: "planning",
        batchId: batch.batchId,
        jobs: batch.jobs.map(({ jobId, role, reviewDepth, status }) => ({ jobId, role, reviewDepth, status }))
      };
    }
    throw error;
  }
}
async function unitLifecycleAction(root2, state) {
  if (!checkpointsEnforcementRequired(state.route, state.workflowCapabilities)) return void 0;
  const units = state.implementationUnits ?? [];
  const active = units.find((unit) => unit.status === "active");
  if (active) return { kind: "checkpoint-implementation-unit", unitId: active.unitId };
  const ledger = await readTraceability(root2, state);
  const nodes = Object.values(ledger.nodes).filter((node) => node.kind === "rollback" && node.status === "current").sort((a, b) => a.id.localeCompare(b.id));
  const statusByUnit = new Map(units.map((unit) => [unit.unitId, unit.status]));
  const ready = nodes.find((node) => statusByUnit.get(node.id) !== "checkpointed" && node.dependsOn.every((dependency) => statusByUnit.get(dependency) === "checkpointed"));
  return ready ? { kind: "begin-implementation-unit", unitId: ready.id } : void 0;
}
async function nextAction(root2, id) {
  const state = await readState(root2, id);
  if (state.mode === "intake") {
    const openDecisions = (state.decisionLedger ?? []).filter((decision) => decision.status === "open");
    return openDecisions.length ? { kind: "intake", activity: "resolve-decision", reason: `${openDecisions.length} \u4E2A\u51B3\u7B56\u4ECD\u5F85\u7528\u6237\u786E\u8BA4` } : { kind: "intake", activity: "investigate", reason: "\u8BFB\u53D6\u9700\u6C42\u3001\u4EE3\u7801\u3001\u6587\u6863\u548C\u6D4B\u8BD5\uFF0C\u751F\u6210 classificationBasis \u540E\u9501\u5B9A\u8DEF\u7EBF" };
  }
  const action = deriveNext(toDerivedState(state, await verificationIsStale(root2, state)));
  if (action.kind === "run-step" || action.kind === "present-human-gate") {
    const definition = routeDefinitionForFeature(state.route, state.workflowCapabilities);
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
  if (action.kind === "run-step" && action.step === "feature_check") return enrichFeatureCheck(state);
  if (action.kind === "run-step" && action.step === "finalize") return { kind: "finalize" };
  if (action.kind === "run-step") return enrichRunStep(state, action.step);
  if (action.kind === "feature-check") return enrichFeatureCheck(state);
  return action;
}

// plugins/dev-flow/src/policy/presentation.ts
var stageLabels = {
  intake: "\u9700\u6C42\u4E86\u89E3",
  locate: "\u9700\u6C42\u4E86\u89E3",
  boundary: "\u9700\u6C42\u786E\u8BA4",
  requirements: "\u9700\u6C42\u786E\u8BA4",
  requirements_alignment: "\u9700\u6C42\u786E\u8BA4",
  planning: "\u5B9E\u65BD\u89C4\u5212",
  implementation: "\u5F00\u53D1\u5B9E\u73B0",
  code_review: "\u4EE3\u7801\u5BA1\u67E5",
  verification: "\u9A8C\u8BC1",
  feature_check: "\u4EA4\u4ED8\u6536\u5C3E",
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
    case "light-m":
      return "light-m\uFF1A\u4E2D\u578B\u53D8\u66F4\uFF08\u8F7B\u91CF\u6CBB\u7406\uFF09";
    case "standard-m":
      return "standard-m\uFF1A\u4E2D\u578B\u53D8\u66F4\uFF08\u6807\u51C6\u6CBB\u7406\uFF09";
    case "light-l":
      return "light-l\uFF1A\u5927\u578B\u53D8\u66F4\uFF08\u8F7B\u91CF\u6CBB\u7406\uFF09";
    case "standard-l":
      return "standard-l\uFF1A\u5927\u578B\u53D8\u66F4\uFF08\u6807\u51C6\u6CBB\u7406\uFF09";
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

// plugins/dev-flow/src/core/decision-interactions.ts
function pendingInteraction(state) {
  return Object.values(state.interactions ?? {}).find((value) => value.status === "pending");
}
function pendingDecisionForState(state) {
  if (state.pendingDecision) return state.pendingDecision;
  const interaction = pendingInteraction(state);
  if (!interaction) return void 0;
  return {
    kind: interaction.kind === "risk-acceptance" ? "review-risk" : interaction.kind,
    question: interaction.question ?? "\u8BF7\u9009\u62E9\u4E00\u4E2A\u65B9\u6848\u3002",
    options: interaction.options.map((option, index) => ({ ...option, recommended: index === 0 })),
    basisHash: interaction.basisHash,
    presentedAt: interaction.presentedAt,
    presentedRevision: state.revision,
    source: "core",
    target: interaction.target
  };
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
      recommended: option.recommended ?? index === 0,
      requiresComment: Boolean(option.requiresComment)
    }))
  };
}
function matchDecisionReply(decision, userReply) {
  const normalized = normalizeReplyText(userReply);
  if (!normalized) throw new DevFlowError("DECISION_REPLY_REQUIRED", "\u8BF7\u56DE\u7B54\u5F53\u524D\u95EE\u9898\u3002", { userMessage: "\u5F53\u524D\u95EE\u9898\u8FD8\u6CA1\u6709\u5F97\u5230\u56DE\u7B54\u3002", recoveryKind: "retry", recoveryInstruction: "\u76F4\u63A5\u56DE\u590D\u4E00\u4E2A\u5B8C\u6574\u4E2D\u6587\u9009\u9879\u3002", retryOriginal: true });
  const options = decision.options;
  let match;
  if (decision.kind === "approval" && isExplicitApproval(userReply)) {
    const option = options.find((candidate) => candidate.id === "confirm");
    if (option) match = { option };
  }
  if (!match) {
    for (const option of options) {
      const label = normalizeReplyText(option.label);
      if (label === normalized) {
        match = { option };
        break;
      }
      if (option.id !== "confirm" && normalized.startsWith(label) && normalized.length > label.length) {
        match = { option, comment: userReply.trim().slice(option.label.length).trim() };
        break;
      }
    }
  }
  if (!match) {
    throw new DevFlowError("DECISION_REPLY_NOT_RECOGNIZED", "\u56DE\u7B54\u6CA1\u6709\u7CBE\u786E\u5339\u914D\u5F53\u524D\u95EE\u9898\u7684\u9009\u9879\u3002", {
      userMessage: "\u6CA1\u6709\u8BC6\u522B\u51FA\u5F53\u524D\u95EE\u9898\u7684\u6709\u6548\u56DE\u7B54\u3002",
      cause: "\u56DE\u7B54\u4E0D\u662F\u5B8C\u6574\u9009\u9879\uFF0C\u4E5F\u4E0D\u662F\u53D7\u652F\u6301\u7684\u6279\u51C6\u77ED\u8BED\u3002",
      impact: "\u5F53\u524D\u95EE\u9898\u4ECD\u4FDD\u6301\u5F85\u56DE\u7B54\uFF0C\u6CA1\u6709\u4EFB\u4F55\u72B6\u6001\u88AB\u6539\u53D8\u3002",
      recoveryKind: "retry",
      recoveryInstruction: "\u8BF7\u76F4\u63A5\u590D\u5236\u4E00\u4E2A\u4E2D\u6587\u9009\u9879\u7684\u5B8C\u6574\u540D\u79F0\u518D\u56DE\u7B54\u3002",
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

// plugins/dev-flow/src/core/status-projection.ts
var STATUS_SCHEMA_VERSION = 1;
function actionText(state, action) {
  switch (action.kind) {
    case "done":
      return "\u5F53\u524D\u4EFB\u52A1\u5DF2\u5B8C\u6210\u3002";
    case "intake":
      return action.activity === "resolve-decision" ? "\u56DE\u7B54\u5F53\u524D\u552F\u4E00\u5F85\u51B3\u95EE\u9898\u3002" : "\u7EE7\u7EED\u8C03\u67E5\u4E8B\u5B9E\u5E76\u9501\u5B9A\u8DEF\u7EBF\u3002";
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
    case "feature-check":
      return "\u6267\u884C\u4EA4\u4ED8\u524D\u5B8C\u6574\u6027\u68C0\u67E5\u3002";
    case "finalize":
      return "\u8FDB\u5165\u4EA4\u4ED8\u6536\u5C3E\u5E76\u751F\u6210\u6700\u7EC8\u4EA4\u4ED8\u5FEB\u7167\u3002";
    case "run-step":
      return `\u7EE7\u7EED${stageLabel(action.step)}\u3002`;
    default:
      return "\u7EE7\u7EED\u5F53\u524D\u9636\u6BB5\u3002";
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
  const definition = state.mode === "routed" ? routeDefinitionForFeature(state.route, state.workflowCapabilities) : void 0;
  const total = definition?.orderedSteps.length ?? 1;
  const completed = definition?.orderedSteps.filter((step) => state.steps[step]?.status === "satisfied").length ?? 0;
  const decision = pendingDecisionForState(state);
  const content = {
    statusSchemaVersion: STATUS_SCHEMA_VERSION,
    \u72B6\u6001: state.lifecycle === "finalized" && state.qualityExceptions.some((exception) => exception.status === "current") ? "\u5DF2\u5B8C\u6210\uFF08\u7528\u6237\u63A5\u53D7\u98CE\u9669\uFF09" : lifecycleLabel(state.lifecycle),
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
        question: publicPendingDecision(state).question,
        options: publicPendingDecision(state).options
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
async function classification(state) {
  return {
    objective: state.objective ?? "\u672A\u547D\u540D\u9700\u6C42",
    scope: state.scope,
    ...state.mode === "routed" ? { route: routeLabel(state.route), stage: stageLabel(effectiveStage(state)) } : { route: "\u8DEF\u7EBF\u5C1A\u672A\u786E\u5B9A", stage: "\u9700\u6C42\u4E86\u89E3" },
    decisionStatus: (state.decisionLedger ?? []).reduce((summary, decision) => {
      summary[decision.status] = (summary[decision.status] ?? 0) + 1;
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
  if (state.mode === "intake" || !traceEnforcementRequired(state.route, state.workflowCapabilities)) return { enforced: false, blocker: void 0 };
  const inspection = await inspectCurrentTrace(root2, state);
  return {
    enforced: true,
    summary: inspection.effectiveSummary,
    blocker: inspection.blocker ? "\u8FFD\u6EAF\u8BC1\u636E\u9700\u8981\u4FEE\u590D" : void 0
  };
}
async function review(root2, state) {
  if (state.mode === "intake" || !reviewEnforcementRequired(state.route, state.workflowCapabilities)) return { enforced: false };
  const ledger = await readReviewLedger(root2, state);
  const current = ledger.batches.find((batch) => batch.validity === "current");
  return {
    enforced: true,
    currentBatch: current ? { progress: current.progress, roles: current.jobs.map((job) => ({ role: job.role, status: job.status })) } : void 0,
    unresolvedBlockingCount: unresolvedBlockingFindings({ findingEvents: ledger.findingEvents }, current?.basisHash).length,
    staleBatchCount: ledger.batches.filter((batch) => batch.validity === "stale").length
  };
}
async function implementation(state) {
  const units = state.implementationUnits ?? [];
  return { total: units.length, completed: units.filter((unit) => unit.status === "checkpointed").length, active: units.find((unit) => unit.status === "active") ? "\u6709\u4E00\u4E2A\u5B9E\u73B0\u5355\u5143\u6B63\u5728\u8FDB\u884C" : "\u65E0" };
}
async function verification(state) {
  return {
    attempts: state.verification.attempts.length,
    freshness: state.evidenceFreshness.verification,
    passed: Boolean(state.verification.satisfiedByAttemptId !== void 0)
  };
}
async function delivery(state) {
  return {
    lifecycle: state.lifecycle,
    workspace: state.workspace.reconciliationStatus,
    snapshot: state.deliverySnapshot ? "\u5DF2\u751F\u6210" : "\u672A\u751F\u6210",
    featureOwnedPathCount: Object.values(state.workspace.ownership).filter((value) => value === "feature").length
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
    pendingDecision: state.pendingDecision,
    recentEvents: events.slice(-20)
  };
}
async function inspectFeature(root2, featureId, requestedTopic) {
  const selected = topic(requestedTopic);
  const state = await readState(root2, featureId);
  const content = selected === "classification" ? await classification(state) : selected === "artifacts" ? await artifacts(state) : selected === "trace" ? await trace(root2, state) : selected === "review" ? await review(root2, state) : selected === "implementation" ? await implementation(state) : selected === "verification" ? await verification(state) : selected === "delivery" ? await delivery(state) : selected === "history" ? await history(root2, state) : await diagnostics(root2, state);
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

// plugins/dev-flow/src/core/implementation-units.ts
import { createHash as createHash16, randomUUID as randomUUID9 } from "node:crypto";

// plugins/dev-flow/src/core/checkpoints.ts
import { randomUUID as randomUUID8, createHash as createHash15 } from "node:crypto";
import { access as access2, mkdir as mkdir6, open as open5, readFile as readFile10, readdir as readdir5, rename as rename5 } from "node:fs/promises";
import path13 from "node:path";
var digest7 = (value) => createHash15("sha256").update(value).digest("hex");
var featureDirectory2 = (root2, featureId) => path13.join(root2, ".dev-flow", "features", featureId);
function blobPath(sha256) {
  return `checkpoints/blobs/${sha256}`;
}
function manifestPath(checkpointId) {
  return `checkpoints/manifests/${checkpointId}.json`;
}
function baselinePath(unitId) {
  return `checkpoints/baselines/${unitId}.json`;
}
async function writeAtomic2(file, contents) {
  const temp = `${file}.${randomUUID8()}.tmp`;
  const handle = await open5(temp, "w");
  try {
    await handle.writeFile(contents);
    await handle.sync();
  } finally {
    await handle.close();
  }
  await rename5(temp, file);
  const directory = await open5(path13.dirname(file), "r");
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
  const sha256 = digest7(bytes);
  const file = path13.join(featureDirectory2(root2, featureId), blobPath(sha256));
  if (await pathExists2(file)) return sha256;
  await mkdir6(path13.dirname(file), { recursive: true });
  await writeAtomic2(file, bytes);
  return sha256;
}
function validateBaseline(value, unitId) {
  const baseline = value;
  const files = baseline?.files;
  if (!baseline || baseline.schemaVersion !== 1 || baseline.unitId !== unitId || typeof baseline.featureId !== "string" || typeof baseline.capturedAt !== "string" || !Array.isArray(files) || !files.every((file) => file && typeof file.path === "string" && /^[a-f0-9]{64}$/.test(file.sha256) && /^[0-7]{3,4}$/.test(file.mode))) {
    throw new DevFlowError("CHECKPOINT_BASELINE_INVALID", "implementation unit baseline is unreadable", { unitId });
  }
  return baseline;
}
async function captureUnitBaseline(root2, featureId, unitId, snapshot) {
  for (const file2 of snapshot) {
    const bytes = await readFile10(path13.join(root2, file2.path));
    if (digest7(bytes) !== file2.sha256) {
      throw new DevFlowError("CHECKPOINT_HASH_MISMATCH", "protected files changed while capturing the unit baseline", { path: file2.path });
    }
    await writeBlobIfAbsent(root2, featureId, bytes);
  }
  const baseline = {
    schemaVersion: 1,
    featureId,
    unitId,
    capturedAt: (/* @__PURE__ */ new Date()).toISOString(),
    files: snapshot
  };
  const file = path13.join(featureDirectory2(root2, featureId), baselinePath(unitId));
  await mkdir6(path13.dirname(file), { recursive: true });
  await writeAtomic2(file, `${JSON.stringify(baseline, null, 2)}
`);
}
async function readCheckpointBaseline(root2, featureId, unitId) {
  const file = path13.join(featureDirectory2(root2, featureId), baselinePath(unitId));
  let raw;
  try {
    raw = await readFile10(file, "utf8");
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
        afterMode: afterFile.mode
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
        afterMode: afterFile.mode
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
        afterMode: to.mode
      });
      pairedDeleted.add(from.path);
      pairedAdded.add(to.path);
    }
  }
  for (const file of deleted) {
    if (pairedDeleted.has(file.path)) continue;
    records.push({ path: file.path, change: "deleted", beforeSha256: file.sha256, beforeBlobSha256: file.sha256, beforeMode: file.mode });
  }
  for (const file of added) {
    if (pairedAdded.has(file.path)) continue;
    records.push({ path: file.path, change: "added", afterSha256: file.sha256, afterBlobSha256: file.sha256, afterMode: file.mode });
  }
  return records.sort((a, b) => a.path.localeCompare(b.path));
}
function snapshotsEqual(a, b) {
  return a.length === b.length && a.every((file, index) => file.path === b[index]?.path && file.sha256 === b[index]?.sha256 && file.mode === b[index]?.mode);
}
function reverseRecords(records) {
  return records.map((record) => {
    switch (record.change) {
      case "added":
        return { path: record.path, change: "deleted", beforeSha256: record.afterSha256, beforeBlobSha256: record.afterBlobSha256, beforeMode: record.afterMode };
      case "deleted":
        return { path: record.path, change: "added", afterSha256: record.beforeSha256, afterBlobSha256: record.beforeBlobSha256, afterMode: record.beforeMode };
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
          afterMode: record.beforeMode
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
          afterMode: record.beforeMode
        };
    }
  });
}
function commandSummary(command2) {
  return [command2.command, ...command2.args].join(" ");
}
function currentRollbackNode(state, nodes, unitId) {
  const node = nodes.find((candidate) => candidate.id === unitId);
  if (!node) {
    throw new DevFlowError("IMPLEMENTATION_UNIT_UNKNOWN", "rollback unit is not part of the current trace graph", { unitId });
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
      cwd: reference.cwd ?? "."
    };
  }
  const command2 = config.verification.commands.find((candidate) => candidate.id === reference);
  if (!command2) {
    throw new DevFlowError("TRACE_VERIFICATION_COMMAND_UNKNOWN", "rollback unit references an unknown verification command", {
      unitId,
      commandId: reference
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
  const directory = path13.join(featureDirectory2(root2, featureId), "checkpoints", "manifests");
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
  if (initial.revision !== expectedRevision) {
    throw new DevFlowError("STATE_REVISION_CONFLICT", "state revision changed", { currentRevision: initial.revision });
  }
  if (!checkpointsEnforcementRequired(initial.route, initial.workflowCapabilities)) {
    throw new DevFlowError("IMPLEMENTATION_UNITS_NOT_ENFORCED", "checkpoints require a checkpoints:1 standard feature");
  }
  if (currentOpenStep(initial) !== "implementation") {
    throw new DevFlowError("STEP_OUT_OF_ORDER", "checkpoint requires the implementation step", { expected: currentOpenStep(initial) });
  }
  const unit = (initial.implementationUnits ?? []).find((candidate) => candidate.unitId === unitId);
  if (!unit) throw new DevFlowError("IMPLEMENTATION_UNIT_UNKNOWN", "rollback unit has no implementation state", { unitId });
  if (unit.status !== "active") {
    throw new DevFlowError("IMPLEMENTATION_UNIT_NOT_ACTIVE", "checkpoint requires an active rollback unit", { unitId, status: unit.status });
  }
  const ledger = await readTraceability(root2, initial);
  const node = currentRollbackNode(
    initial,
    Object.values(ledger.nodes).filter((candidate) => candidate.kind === "rollback" && candidate.status === "current"),
    unitId
  );
  const { config, sha256: projectConfigSha256 } = await readProjectConfigSnapshot(root2);
  if (node.verificationConfigSha256 !== projectConfigSha256) {
    throw new DevFlowError("TRACE_SLICE_STALE", "rollback verification configuration is stale", { unitId });
  }
  const commands = resolveVerificationCommands(config, node);
  const preflightCommands = resolvePreflightCommands(config);
  const baseline = await readCheckpointBaseline(root2, id, unitId);
  const after = await snapshotProtectedRoots(root2, config);
  const records = diffSnapshots(baseline.files, after);
  const sequence = await nextCheckpointSequence(root2, id);
  const checkpointId = `CP-${String(sequence).padStart(3, "0")}`;
  const rollbackUnitId = unit.unitId;
  const featureDir = featureDirectory2(root2, id);
  const manifestsDir = path13.join(featureDir, "checkpoints", "manifests");
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
      candidate = parseCheckpointManifest(JSON.parse(await readFile10(path13.join(manifestsDir, entry), "utf8")));
    } catch (error) {
      throw new DevFlowError("ROLLBACK_CHECKPOINT_CORRUPT", "checkpoint manifest is unreadable or invalid", {
        checkpointFile: entry,
        unitId: rollbackUnitId,
        cause: error instanceof Error ? error.message : String(error),
        recoveryHint: "Do not hand-edit checkpoint manifests; repair or remove the corrupt file before retrying the checkpoint"
      });
    }
    if (candidate.unitId === rollbackUnitId && candidate.beginNonce === unit.beginNonce) {
      orphan = candidate;
      break;
    }
  }
  if (orphan) {
    const sameCheckpoint = orphan.basisHash === unit.basisHash && orphan.projectConfigSha256 === projectConfigSha256 && JSON.stringify(orphan.files) === JSON.stringify(records);
    if (!sameCheckpoint) {
      throw new DevFlowError("CHECKPOINT_CONFLICT", "an existing checkpoint manifest no longer matches this unit", {
        checkpointId: orphan.checkpointId,
        unitId: rollbackUnitId
      });
    }
    const reused = await mutate(root2, id, expectedRevision, "implementation-unit-checkpointed", (draft) => {
      const current = (draft.implementationUnits ?? []).find((candidate) => candidate.unitId === unitId);
      if (!current || current.status !== "active") {
        throw new DevFlowError("IMPLEMENTATION_UNIT_NOT_ACTIVE", "checkpoint requires an active rollback unit", { unitId, status: current?.status });
      }
      current.status = "checkpointed";
      current.checkpointId = orphan.checkpointId;
    }, { unitId, checkpointId: orphan.checkpointId, sequence: orphan.sequence });
    return { state: reused, manifest: orphan };
  }
  const manifestFile = path13.join(featureDir, manifestPath(checkpointId));
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
  const afterVerification = await snapshotProtectedRoots(root2, config);
  if (!snapshotsEqual(after, afterVerification)) {
    throw new DevFlowError("CHECKPOINT_HASH_MISMATCH", "protected files changed while verification ran", { unitId });
  }
  const completedFingerprint = await fingerprintProtectedRoots(root2, config);
  for (const record of records) {
    if (record.change === "deleted" || record.change === "renamed") continue;
    const bytes = await readFile10(path13.join(root2, record.path));
    if (digest7(bytes) !== record.afterSha256) {
      throw new DevFlowError("CHECKPOINT_HASH_MISMATCH", "protected files changed while capturing checkpoint blobs", { path: record.path });
    }
    await writeBlobIfAbsent(root2, id, bytes);
  }
  const forwardPatch = canonicalReviewValueJson({ direction: "forward", checkpointId, unitId: rollbackUnitId, files: records });
  const reversePatch = canonicalReviewValueJson({ direction: "reverse", checkpointId, unitId: rollbackUnitId, files: reverseRecords(records) });
  const manifest = {
    schemaVersion: 1,
    checkpointId,
    unitId: rollbackUnitId,
    sequence,
    basisHash: unit.basisHash,
    startedFingerprint: unit.startedFingerprint,
    completedFingerprint,
    startedAt: attempts[0]?.startedAt ?? (/* @__PURE__ */ new Date()).toISOString(),
    completedAt: (/* @__PURE__ */ new Date()).toISOString(),
    files: records,
    forwardPatchSha256: digest7(forwardPatch),
    reversePatchSha256: digest7(reversePatch),
    verificationAttempts: attempts,
    requirementsSha256: initial.artifacts.requirements?.sha256 ?? "",
    planSha256: initial.artifacts["implementation-plan"]?.sha256 ?? "",
    traceabilitySha256: initial.traceability?.sha256 ?? "",
    approvalBasisHash: unit.basisHash,
    projectConfigSha256,
    ...unit.beginNonce ? { beginNonce: unit.beginNonce } : {},
    verificationCommands: [...preflightCommands, ...commands].map((command2) => ({ commandId: command2.id, command: commandSummary(command2) }))
  };
  const validated = parseCheckpointManifest(JSON.parse(JSON.stringify(manifest)));
  await mkdir6(path13.join(featureDir, "checkpoints", "patches"), { recursive: true });
  await mkdir6(path13.dirname(manifestFile), { recursive: true });
  await writeAtomic2(path13.join(featureDir, "checkpoints", "patches", `${manifest.forwardPatchSha256}.json`), forwardPatch);
  await writeAtomic2(path13.join(featureDir, "checkpoints", "patches", `${manifest.reversePatchSha256}.json`), reversePatch);
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
  await rename5(temp, manifestFile);
  const manifestDir = await open5(path13.dirname(manifestFile), "r");
  try {
    await manifestDir.sync();
  } finally {
    await manifestDir.close();
  }
  await options.fault?.("after-manifest-rename");
  const state = await mutate(root2, id, expectedRevision, "implementation-unit-checkpointed", (draft) => {
    const current = (draft.implementationUnits ?? []).find((candidate) => candidate.unitId === unitId);
    if (!current || current.status !== "active") {
      throw new DevFlowError("IMPLEMENTATION_UNIT_NOT_ACTIVE", "checkpoint requires an active rollback unit", { unitId, status: current?.status });
    }
    current.status = "checkpointed";
    current.checkpointId = checkpointId;
  }, { unitId, checkpointId, sequence });
  return { state, manifest: validated };
}
async function readCheckpoint(root2, featureId, checkpointId) {
  const file = path13.join(featureDirectory2(root2, featureId), manifestPath(checkpointId));
  let raw;
  try {
    raw = await readFile10(file, "utf8");
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
    throw new DevFlowError("CHECKPOINT_INTEGRITY_FAILED", "checkpoint manifest is unreadable", { checkpointId });
  }
}
async function checkpointChain(root2, featureId, state) {
  const ids = (state.implementationUnits ?? []).filter((unit) => unit.checkpointId && (unit.status === "checkpointed" || unit.status === "rolled_back")).map((unit) => unit.checkpointId);
  const manifests = [];
  for (const checkpointId of ids) manifests.push(await readCheckpoint(root2, featureId, checkpointId));
  return manifests.sort((a, b) => a.sequence - b.sequence);
}

// plugins/dev-flow/src/core/implementation-units.ts
var digest8 = (value) => createHash16("sha256").update(value).digest("hex");
function currentRollbackNodes(ledger) {
  return Object.values(ledger?.nodes ?? {}).filter((node) => node.kind === "rollback" && node.status === "current");
}
function implementationUnitBasisHash(state) {
  return digest8(canonicalReviewValueJson({
    traceability: state.traceability,
    approval: confirmedApproval(state)?.record ?? null
  }));
}
async function beginImplementationUnit(root2, id, expectedRevision, unitId) {
  return mutate(root2, id, expectedRevision, "implementation-unit-begun", async (state) => {
    if (!checkpointsEnforcementRequired(state.route, state.workflowCapabilities)) {
      throw new DevFlowError("IMPLEMENTATION_UNITS_NOT_ENFORCED", "implementation units require a checkpoints:1 standard feature");
    }
    if (currentOpenStep(state) !== "implementation") {
      throw new DevFlowError("STEP_OUT_OF_ORDER", "begin requires the implementation step", { expected: currentOpenStep(state) });
    }
    if (!confirmedApproval(state)) {
      throw new DevFlowError("DEV_FLOW_IMPLEMENTATION_APPROVAL_REQUIRED", "implementation approval must be confirmed before beginning a unit");
    }
    const ledger = await assertTraceGateCurrent(root2, state, "implementation");
    for (const kind of ["requirements", "implementation-plan"]) {
      await assertArtifactCurrent(root2, id, state, kind);
    }
    if (reviewEnforcementRequired(state.route, state.workflowCapabilities)) {
      await assertReviewComplete(root2, state);
    }
    const nodes = currentRollbackNodes(ledger);
    const node = nodes.find((candidate) => candidate.id === unitId);
    if (!node) {
      throw new DevFlowError("IMPLEMENTATION_UNIT_UNKNOWN", "rollback unit is not part of the current trace graph", { unitId });
    }
    if ((state.implementationUnits ?? []).some((unit) => unit.status === "active")) {
      const active = state.implementationUnits.find((unit) => unit.status === "active");
      throw new DevFlowError("IMPLEMENTATION_UNIT_ALREADY_ACTIVE", "another rollback unit is already active", { activeUnitId: active.unitId });
    }
    const basisHash2 = implementationUnitBasisHash(state);
    const byId = new Map((state.implementationUnits ?? []).map((unit) => [unit.unitId, unit]));
    const merged = [];
    for (const candidate of nodes) {
      const existing = byId.get(candidate.id);
      if (existing && existing.status !== "pending") {
        merged.push(existing);
      } else {
        merged.push(implementationUnitForRollbackNode(candidate, basisHash2));
      }
    }
    for (const dependency of node.dependsOn) {
      const unit = merged.find((candidate) => candidate.unitId === dependency);
      if (unit?.status !== "checkpointed") {
        throw new DevFlowError("IMPLEMENTATION_UNIT_DEPENDENCY_INCOMPLETE", "rollback unit dependencies must be checkpointed first", {
          unitId,
          dependency,
          status: unit?.status ?? "unknown"
        });
      }
    }
    const target = merged.find((unit) => unit.unitId === unitId);
    if (target.status !== "pending" && target.status !== "rolled_back") {
      throw new DevFlowError("IMPLEMENTATION_UNIT_NOT_PENDING", "rollback unit cannot begin from its current status", { unitId, status: target.status });
    }
    const project = await readProjectConfig(root2);
    const snapshot = await snapshotProtectedRoots(root2, project);
    await captureUnitBaseline(root2, id, unitId, snapshot);
    delete target.checkpointId;
    target.basisHash = basisHash2;
    target.beginNonce = randomUUID9();
    target.status = "active";
    target.startedFingerprint = await fingerprintProtectedRoots(root2, project);
    state.implementationUnits = merged;
  }, { unitId });
}

// plugins/dev-flow/src/core/rollback.ts
import { createHash as createHash17, randomUUID as randomUUID10 } from "node:crypto";
import { access as access3, chmod, lstat as lstat4, mkdir as mkdir7, open as open6, readFile as readFile11, rename as rename6, rm as rm2 } from "node:fs/promises";
import path14 from "node:path";
var digest9 = (value) => createHash17("sha256").update(value).digest("hex");
function rollbackNodes(nodes) {
  return Object.values(nodes).filter((node) => node.kind === "rollback" && node.status === "current");
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
  if (!checkpointsEnforcementRequired(state.route, state.workflowCapabilities)) {
    throw new DevFlowError("IMPLEMENTATION_UNITS_NOT_ENFORCED", "rollback preview requires a checkpoints:1 standard feature");
  }
  const ledger = await readTraceability(root2, state);
  const nodes = rollbackNodes(ledger.nodes);
  const chain = liveChain(state, await checkpointChain(root2, featureId, state));
  assertChainIntegrity(chain, nodes);
  const { config, sha256: projectConfigSha256 } = await readProjectConfigSnapshot(root2);
  return { state, chain, nodes, config, projectConfigSha256 };
}
function commandSummary2(command2) {
  return [command2.command, ...command2.args].join(" ");
}
async function previewRollback(root2, featureId, targetCheckpointId) {
  const { state, chain, nodes, config, projectConfigSha256 } = await previewContext(root2, featureId);
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
  const stale = suffix.filter((manifest) => manifest.projectConfigSha256 !== projectConfigSha256);
  if (stale.length) {
    throw new DevFlowError("ROLLBACK_BASIS_STALE", "project verification config changed after these checkpoints", {
      checkpointIds: stale.map((manifest) => manifest.checkpointId)
    });
  }
  const snapshot = await snapshotProtectedRoots(root2, config);
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
    for (const [index, reference] of (node?.rollbackVerification ?? []).entries()) {
      const command2 = typeof reference === "string" ? config.verification.commands.find((candidate) => candidate.id === reference) : {
        id: `inline:${manifest.unitId}:${index}`,
        command: reference.command,
        args: [...reference.args ?? []],
        cwd: reference.cwd ?? "."
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
  const planAction = (path18, action) => {
    filePlan.set(path18, action);
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
            mode: record.beforeMode
          });
          break;
        case "deleted":
        case "modified":
        case "mode-changed":
          planAction(record.path, {
            action: "restore",
            path: record.path,
            blobSha256: record.beforeBlobSha256,
            mode: record.beforeMode
          });
          break;
      }
    }
  }
  const plan = [...filePlan.values()].sort((a, b) => a.path.localeCompare(b.path));
  const previewBasisHash = digest9(canonicalReviewValueJson({
    targetCheckpointId,
    targetUnitId: target.unitId,
    undoOrder: undoManifests.map((manifest) => manifest.unitId),
    filePlan: plan,
    verificationCommands,
    projectConfigSha256,
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
    previewBasisHash
  };
}
async function presentRollbackGate(root2, featureId, expectedRevision, targetCheckpointId) {
  const initial = await readState(root2, featureId);
  if (initial.revision !== expectedRevision) {
    throw new DevFlowError("STATE_REVISION_CONFLICT", "state revision changed", { currentRevision: initial.revision });
  }
  if (!rollbackExecutionAllowed(initial.route, initial.workflowCapabilities)) {
    throw new DevFlowError("ROLLBACK_EXECUTION_NOT_ALLOWED", "rollback execution requires checkpoints:1 and rollbackExecution:1 in a standard route");
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
    if (!rollbackExecutionAllowed(state2.route, state2.workflowCapabilities)) {
      throw new DevFlowError("ROLLBACK_EXECUTION_NOT_ALLOWED", "rollback execution requires checkpoints:1 and rollbackExecution:1 in a standard route");
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
    interactionId: interaction?.id
  }));
  if (!interaction) throw new DevFlowError("INTERACTION_NOT_CREATED", targetCheckpointId);
  return { state, interaction: toPublicInteraction(interaction), interactionId: interaction.id, preview };
}
async function resolveRollbackGateResponse(root2, featureId, expectedRevision, interactionId, host, input) {
  const initial = await readState(root2, featureId);
  if (initial.revision !== expectedRevision) {
    throw new DevFlowError("STATE_REVISION_CONFLICT", "state revision changed", { currentRevision: initial.revision });
  }
  const gate = initial.rollbackGate;
  if (!gate || gate.status !== "pending" || gate.interactionId !== interactionId) {
    throw new DevFlowError("ROLLBACK_GATE_NOT_PENDING", "rollback gate is not pending or belongs to a different interaction");
  }
  const interaction = getInteraction(initial, interactionId);
  if (interaction.kind !== "rollback-confirmation" || interaction.status !== "pending") {
    throw new DevFlowError("INTERACTION_NOT_PENDING", interactionId);
  }
  let currentPreview;
  try {
    currentPreview = await previewRollback(root2, featureId, gate.targetCheckpointId);
  } catch (err) {
    if (err instanceof DevFlowError) {
      await mutate(root2, featureId, expectedRevision, "rollback-gate-stale", async (state) => {
        if (state.rollbackGate?.interactionId === interactionId) {
          delete state.rollbackGate;
          clearInteractionsForTarget(state, `rollback:${gate.targetCheckpointId}`);
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
    await mutate(root2, featureId, expectedRevision, "rollback-gate-stale", async (state) => {
      if (state.rollbackGate?.interactionId === interactionId) {
        delete state.rollbackGate;
        clearInteractionsForTarget(state, `rollback:${gate.targetCheckpointId}`);
      }
    });
    throw new DevFlowError("ROLLBACK_GATE_BASIS_CHANGED", "rollback preview basis hash changed since gate was presented; the pending gate has been cleared", {
      recoveryHint: "Present the rollback gate again after updating checkpoint state"
    });
  }
  let resolvedPromptEventId;
  if (input.source === "text") {
    const events = await readFeatureEvents(root2, featureId);
    resolvedPromptEventId = input.promptEventId ?? resolvePromptEvent(events, {
      host,
      userReply: input.userReply,
      presentedAt: gate.presentedAt,
      presentedRevision: gate.stateRevision
    }).eventId;
    const eventRecord = events.find(
      (item) => item.type === "host-event" && item.data.eventId === resolvedPromptEventId
    );
    if (!eventRecord) {
      throw new DevFlowError("ROLLBACK_GATE_PROVENANCE_UNAVAILABLE", "no matching host event found for the given promptEventId", {
        recoveryHint: "Ensure the host UserPromptSubmit hook is active, then submit one exact approval reply and retry"
      });
    }
    const event = eventRecord.data;
    if (event.host !== host) {
      throw new DevFlowError("HOST_EVENT_HOST_MISMATCH", "host event belongs to a different host", {
        expectedHost: host,
        actualHost: event.host,
        eventId: resolvedPromptEventId
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
    if (event.text !== input.userReply) {
      throw new DevFlowError("ROLLBACK_GATE_REPLY_MISMATCH", "userReply must match the captured prompt text exactly", {
        recoveryHint: "Pass the exact user prompt text that was captured for this event"
      });
    }
  }
  let response;
  return mutate(root2, featureId, expectedRevision, "rollback-gate-resolved", async (state) => {
    const currentGate = state.rollbackGate;
    if (!currentGate || currentGate.status !== "pending" || currentGate.interactionId !== interactionId) {
      throw new DevFlowError("ROLLBACK_GATE_NOT_PENDING", "rollback gate was resolved concurrently");
    }
    response = input.source === "elicitation" ? resolveNativeInteraction(state, interactionId, input.action, input.comment, host) : resolveTextInteraction(state, interactionId, input.userReply, host, { promptEventId: resolvedPromptEventId });
    if (response.action === "confirm") {
      state.rollbackGate = {
        ...currentGate,
        status: "confirmed",
        confirmedAt: (/* @__PURE__ */ new Date()).toISOString()
      };
    } else if (response.action === "request-changes") {
      delete state.rollbackGate;
      clearInteractionsForTarget(state, `rollback:${gate.targetCheckpointId}`);
    } else {
      throw new DevFlowError("INTERACTION_ACTION_INVALID", response.action);
    }
    state.lastUpdatedBy = { host, pluginVersion: "4.1.0" };
  }, () => ({ gate: "rollback-confirmation", interactionId, response }));
}
async function resolveRollbackGateElicitation(root2, featureId, expectedRevision, interactionId, action, comment, host) {
  return resolveRollbackGateResponse(root2, featureId, expectedRevision, interactionId, host, {
    action,
    comment,
    source: "elicitation"
  });
}
async function resolveRollbackGateAnswer(root2, featureId, expectedRevision, interactionId, userReply, host) {
  return resolveRollbackGateResponse(root2, featureId, expectedRevision, interactionId, host, {
    userReply,
    source: "text"
  });
}
var featureDirectory3 = (root2, featureId) => path14.join(root2, ".dev-flow", "features", featureId);
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
  await mkdir7(path14.dirname(file), { recursive: true });
  const temp = `${file}.${randomUUID10()}.tmp`;
  const handle = await open6(temp, "w");
  try {
    await handle.writeFile(bytes);
    await handle.sync();
  } finally {
    await handle.close();
  }
  await chmod(temp, Number.parseInt(mode, 8));
  await rename6(temp, file);
  await fsyncDirectory4(path14.dirname(file));
}
async function writeAtomicBuffer(file, contents) {
  await mkdir7(path14.dirname(file), { recursive: true });
  const temp = `${file}.${randomUUID10()}.tmp`;
  const handle = await open6(temp, "w");
  try {
    await handle.writeFile(contents);
    await handle.sync();
  } finally {
    await handle.close();
  }
  await rename6(temp, file);
  await fsyncDirectory4(path14.dirname(file));
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
    raw = await readFile11(manifestFile, "utf8");
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
    } else if (actual.sha256 !== file.sha256 || actual.mode !== file.mode) {
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
  const snapshot = await snapshotProtectedRoots(root2, config);
  const conflicts = detectChainConflicts(chain, snapshot, fileScopes, baselineFiles);
  if (conflicts.length) {
    throw new DevFlowError("ROLLBACK_HASH_MISMATCH", "workspace drifted from the confirmed rollback basis; refusing to capture it as the pre-rollback backup", {
      conflicts,
      recoveryHint: "Restore the drifted files to their checkpointed bytes, then resume the rollback with the same target; run dev_flow_doctor to inspect the open transaction"
    });
  }
}
async function captureBackup(root2, featureId, journal, config, options) {
  const dir = path14.join(featureDirectory3(root2, featureId), journal.backupDirectory);
  const manifestFile = path14.join(dir, "backup-manifest.json");
  if (await pathExists3(manifestFile)) {
    const manifest2 = await readBackupManifest(manifestFile, journal.transactionId);
    const current = await snapshotProtectedRoots(root2, config);
    const mismatches = snapshotMismatches(manifest2.files, current);
    if (mismatches.length) {
      throw new DevFlowError("ROLLBACK_HASH_MISMATCH", "workspace drifted from the recorded rollback backup", { mismatches });
    }
    return;
  }
  await assertWorkspaceMatchesChainTip(root2, featureId, config);
  await mkdir7(path14.join(dir, "files"), { recursive: true });
  await mkdir7(path14.join(dir, "trash"), { recursive: true });
  const snapshot = await snapshotProtectedRoots(root2, config);
  let first = true;
  for (const file of snapshot) {
    const bytes = await readFile11(path14.join(root2, file.path));
    if (digest9(bytes) !== file.sha256) {
      throw new DevFlowError("ROLLBACK_HASH_MISMATCH", "protected files changed while capturing the rollback backup", { path: file.path });
    }
    const blobFile = path14.join(dir, "files", file.sha256);
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
  const captureDrift = snapshotMismatches(manifest.files, await snapshotProtectedRoots(root2, config));
  if (captureDrift.length) {
    throw new DevFlowError("ROLLBACK_HASH_MISMATCH", "protected files changed while capturing the rollback backup", { mismatches: captureDrift });
  }
}
async function assertPathMatchesBackupExpectation(root2, filePath, expected) {
  const absolute = path14.join(root2, filePath);
  if (expected) {
    let metadata;
    let bytes;
    try {
      metadata = await lstat4(absolute);
      bytes = await readFile11(absolute);
    } catch {
      throw new DevFlowError("ROLLBACK_HASH_MISMATCH", "workspace drifted from the pre-rollback backup before a file action", {
        path: filePath,
        expected: "present",
        actual: "missing",
        recoveryHint: "Restore the drifted path to its pre-rollback bytes, then resume the rollback with the same target"
      });
    }
    const mode = (metadata.mode & 511).toString(8).padStart(3, "0");
    if (digest9(bytes) !== expected.sha256 || mode !== expected.mode) {
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
  const dir = path14.join(featureDirectory3(root2, featureId), journal.backupDirectory);
  const trash = path14.join(dir, "trash");
  const backup = await readBackupManifest(path14.join(dir, "backup-manifest.json"), journal.transactionId);
  const expectedByPath = new Map(backup.files.map((file) => [file.path, file]));
  for (let index = journal.nextFileIndex; index < journal.filePlan.length; index += 1) {
    const action = journal.filePlan[index];
    if (index === 0) await options.fault?.("before-first-rename");
    await assertPathMatchesBackupExpectation(root2, action.path, expectedByPath.get(action.path));
    const target = path14.join(root2, action.path);
    if (action.action === "restore") {
      const blobFile = path14.join(featureDirectory3(root2, featureId), blobPath(action.blobSha256));
      let bytes;
      try {
        bytes = await readFile11(blobFile);
      } catch {
        throw new DevFlowError("ROLLBACK_CHECKPOINT_CORRUPT", "checkpoint blob is missing", {
          blobSha256: action.blobSha256,
          path: action.path
        });
      }
      if (digest9(bytes) !== action.blobSha256) {
        throw new DevFlowError("ROLLBACK_CHECKPOINT_CORRUPT", "checkpoint blob failed its digest check", {
          blobSha256: action.blobSha256,
          path: action.path
        });
      }
      await writeFileAtomicMode(target, bytes, action.mode);
    } else {
      const trashFile = path14.join(trash, `${String(index).padStart(4, "0")}-${path14.basename(action.path)}`);
      if (await pathExists3(target)) {
        await mkdir7(trash, { recursive: true });
        await rename6(target, trashFile);
        await fsyncDirectory4(path14.dirname(target));
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
        if (await pathExists3(path14.join(root2, action2.path))) {
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
          metadata = await lstat4(path14.join(root2, action2.path));
          bytes = await readFile11(path14.join(root2, action2.path));
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
        if (digest9(bytes) !== expected.sha256 || mode !== expected.mode) {
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
    for (const [index, reference] of node.rollbackVerification.entries()) {
      const command2 = typeof reference === "string" ? config.verification.commands.find((candidate) => candidate.id === reference) : {
        id: `inline:${unitId}:${index}`,
        command: reference.command,
        args: [...reference.args ?? []],
        cwd: reference.cwd ?? "."
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
    path14.join(featureDirectory3(root2, featureId), journal.backupDirectory, "backup-manifest.json"),
    journal.transactionId
  );
  const expected = new Map(manifest.files.map((file) => [file.path, { path: file.path, sha256: file.sha256, mode: file.mode }]));
  for (const action of journal.filePlan.slice(0, appliedCount)) {
    if (action.action === "restore") {
      expected.set(action.path, { path: action.path, sha256: action.blobSha256, mode: action.mode });
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
  const attemptId = randomUUID10();
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
  const current = await snapshotProtectedRoots(root2, config);
  const mismatches = snapshotMismatches(expected, current);
  if (mismatches.length) {
    const attemptId = await recordVerificationAttempt(root2, featureId, journal, {
      unitId: null,
      commandId: "drift-guard",
      command: "protected-root drift guard",
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
      command: "protected-root drift guard",
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
  const attemptId = randomUUID10();
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
  const dir = path14.join(featureDirectory3(root2, featureId), journal.backupDirectory);
  const startedAt = (/* @__PURE__ */ new Date()).toISOString();
  try {
    const manifest = await readBackupManifest(path14.join(dir, "backup-manifest.json"), journal.transactionId);
    let restored = 0;
    for (const file of manifest.files) {
      const blobFile = path14.join(dir, "files", file.sha256);
      let bytes;
      try {
        bytes = await readFile11(blobFile);
      } catch {
        throw new DevFlowError("ROLLBACK_BACKUP_CORRUPT", "rollback backup bytes are missing", { path: file.path, sha256: file.sha256 });
      }
      if (digest9(bytes) !== file.sha256) {
        throw new DevFlowError("ROLLBACK_BACKUP_CORRUPT", "rollback backup bytes failed their digest check", { path: file.path, sha256: file.sha256 });
      }
      await writeFileAtomicMode(path14.join(root2, file.path), bytes, file.mode);
      restored += 1;
      if (restored === 1) await options.fault?.("during-compensation");
    }
    const current = await snapshotProtectedRoots(root2, config);
    const expectedPaths = new Set(manifest.files.map((file) => file.path));
    const trash = path14.join(dir, "trash");
    for (const file of current) {
      if (expectedPaths.has(file.path)) continue;
      const trashFile = path14.join(trash, `extra-${digest9(file.path).slice(0, 16)}-${path14.basename(file.path)}`);
      await mkdir7(trash, { recursive: true });
      await rename6(path14.join(root2, file.path), trashFile);
      await fsyncDirectory4(path14.dirname(path14.join(root2, file.path)));
    }
    const after = await snapshotProtectedRoots(root2, config);
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
    const review2 = reviewEnforcementRequired(current.route, current.workflowCapabilities) ? await prepareReviewInvalidation(root2, current, nextStateRevision) : void 0;
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
            units.push(implementationUnitForRollbackNode(node, basisHash2));
          }
        }
        draft.implementationUnits = units;
        for (const step of ["implementation", "code_review", "verification", "feature_check", "finalize"]) {
          delete draft.steps[step];
        }
        draft.logicComplete = false;
        draft.featureCheck = {};
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
  const directory = path14.join(featureDirectory3(root2, featureId), journal.backupDirectory);
  await rm2(path14.join(directory, "files"), { recursive: true, force: true });
  await rm2(path14.join(directory, "trash"), { recursive: true, force: true });
  await rm2(path14.join(directory, "backup-manifest.json"), { force: true });
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
      if ((journal.phase === "prepared" || journal.phase === "backing-up" || journal.phase === "rolling-back" || journal.phase === "verifying") && projectConfigSha256 !== journal.projectConfigSha256) {
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
  const open7 = await readRollbackTransaction(root2, featureId);
  if (open7 && !rollbackTransactionFinished(open7)) {
    if (open7.targetCheckpointId !== targetCheckpointId) {
      throw new DevFlowError("ROLLBACK_TRANSACTION_MISMATCH", "an open rollback transaction targets a different checkpoint", {
        transactionId: open7.transactionId,
        openTargetCheckpointId: open7.targetCheckpointId,
        targetCheckpointId,
        recoveryHint: "Resume the open transaction with its original target checkpoint"
      });
    }
    return driveRollbackTransaction(root2, featureId, open7, options);
  }
  if (!rollbackExecutionAllowed(initial.route, initial.workflowCapabilities)) {
    throw new DevFlowError("ROLLBACK_EXECUTION_NOT_ALLOWED", "rollback execution requires checkpoints:1 and rollbackExecution:1 in a standard route");
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
  const transactionId = randomUUID10();
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
    startedAt: (/* @__PURE__ */ new Date()).toISOString()
  };
  await options.fault?.("before-journal-write");
  await prepareRollbackTransaction(root2, featureId, expectedRevision, journal);
  await options.fault?.("after-journal-write");
  return driveRollbackTransaction(root2, featureId, journal, options);
}

// plugins/dev-flow/src/mcp/doctor.ts
import { lstat as lstat5, readdir as readdir6, readFile as readFile12 } from "node:fs/promises";
import path15 from "node:path";
import { createHash as createHash18 } from "node:crypto";
async function readable(file) {
  try {
    await lstat5(file);
    return true;
  } catch {
    return false;
  }
}
async function validJson(file) {
  try {
    JSON.parse(await readFile12(file, "utf8"));
    return true;
  } catch {
    return false;
  }
}
async function pointerRecoveryCandidates(root2) {
  try {
    const directory = path15.join(root2, ".dev-flow", "features");
    const entries = await readdir6(directory, { withFileTypes: true });
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
async function collectDoctorReport(root2, pluginRoot2, version, tools2) {
  const diagnostics2 = [];
  const add2 = (code, status, message, recoveryHint) => diagnostics2.push({ code, status, message, ...recoveryHint ? { recoveryHint } : {} });
  const projectFile = path15.join(root2, ".dev-flow", "project.json");
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
  const activeFile = path15.join(root2, ".dev-flow", "active.json");
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
        activeFeature = { present: true, featureId: state.featureId, valid: state.lifecycle === "active" };
        add2(
          activeFeature.valid ? "ACTIVE_FEATURE_VALID" : "ACTIVE_FEATURE_INVALID",
          activeFeature.valid ? "ok" : "error",
          activeFeature.valid ? `active feature ${state.featureId} is valid` : `active feature ${state.featureId} is not active`
        );
      } catch (error) {
        let digest10;
        try {
          digest10 = await stateFileSha256(root2, active.featureId);
        } catch {
        }
        if (!digest10) {
          try {
            const raw = await readFile12(path15.join(root2, ".dev-flow", "features", active.featureId, "state.json"));
            digest10 = createHash18("sha256").update(raw).digest("hex");
          } catch {
            digest10 = void 0;
          }
        }
        activeFeature = {
          present: true,
          featureId: active.featureId,
          valid: false,
          corrupt: true,
          stateSha256: digest10,
          recoveryAction: "abandon"
        };
        const message = error instanceof Error ? error.message : String(error);
        add2("ACTIVE_FEATURE_CORRUPT", "error", message, "Call dev_flow_recover_corrupt_feature with stateSha256, reason, and userEvidence");
        if (digest10) {
          corruptFeature = {
            featureId: active.featureId,
            stateSha256: digest10,
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
          activeSha256 = createHash18("sha256").update(await readFile12(activeFile)).digest("hex");
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
    const featuresDirectory = path15.join(root2, ".dev-flow", "features");
    const entries = await readdir6(featuresDirectory, { withFileTypes: true });
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
    const enforced = traceEnforcementRequired(traceState.route, traceState.workflowCapabilities);
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
    const enforced = reviewEnforcementRequired(traceState.route, traceState.workflowCapabilities);
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
    claudeManifest: path15.join(pluginRoot2, ".claude-plugin", "plugin.json"),
    codexManifest: path15.join(pluginRoot2, ".codex-plugin", "plugin.json"),
    kimiManifest: path15.join(pluginRoot2, ".kimi-plugin", "plugin.json"),
    mcp: path15.join(pluginRoot2, ".mcp.json"),
    claudeHooks: path15.join(pluginRoot2, "hosts", "claude", "hooks.json"),
    codexHooks: path15.join(pluginRoot2, "hosts", "codex", "hooks.json"),
    kimiHooks: path15.join(pluginRoot2, "hosts", "kimi", "hooks.json"),
    mcpBundle: path15.join(pluginRoot2, "dist", "mcp-server.mjs"),
    claudeBundle: path15.join(pluginRoot2, "dist", "claude-hook.mjs"),
    codexBundle: path15.join(pluginRoot2, "dist", "codex-hook.mjs"),
    kimiBundle: path15.join(pluginRoot2, "dist", "kimi-hook.mjs")
  };
  const files = await Promise.all(Object.entries(paths).map(async ([name, file]) => [name, await readable(file)]));
  const missing = files.filter(([, exists]) => !exists).map(([name]) => name);
  add2(missing.length ? "PLUGIN_FILES_MISSING" : "PLUGIN_FILES_PRESENT", missing.length ? "error" : "ok", missing.length ? `missing plugin files: ${missing.join(", ")}` : "manifests, hooks, MCP configuration and bundles are present");
  const jsonFiles = [paths.claudeManifest, paths.codexManifest, paths.kimiManifest, paths.mcp, paths.claudeHooks, paths.codexHooks, paths.kimiHooks];
  const invalidJson = (await Promise.all(jsonFiles.map(async (file) => !await validJson(file)))).some(Boolean);
  add2(invalidJson ? "PLUGIN_WIRING_INVALID" : "PLUGIN_WIRING_VALID", invalidJson ? "error" : "ok", invalidJson ? "a manifest, MCP file, or hook file is not valid JSON" : "plugin manifest, MCP and hook wiring parse successfully");
  const legacyFeatures = [];
  try {
    const directory = path15.join(root2, ".dev-flow", "features");
    const entries = await readdir6(directory, { withFileTypes: true });
    for (const entry of entries.filter((candidate) => candidate.isDirectory())) {
      try {
        const raw = JSON.parse(await readFile12(path15.join(directory, entry.name, "state.json"), "utf8"));
        if ((raw.schemaVersion === 1 || raw.schemaVersion === 2) && raw.lifecycle !== "finalized" && raw.lifecycle !== "abandoned") legacyFeatures.push(entry.name);
      } catch {
      }
    }
  } catch {
  }
  const v3Ready = legacyFeatures.length === 0;
  add2(v3Ready ? "V3_READY" : "V3_NOT_READY", v3Ready ? "ok" : "warning", v3Ready ? "\u6CA1\u6709\u672A\u5B8C\u6210\u7684\u65E7\u7248 feature\uFF0C\u53EF\u4EE5\u4F7F\u7528 schema v3" : `\u4ECD\u6709\u672A\u5B8C\u6210\u7684\u65E7\u7248 feature: ${legacyFeatures.join(", ")}`, v3Ready ? void 0 : "\u5148\u7ED3\u675F\u6216\u6E05\u7406\u65E7\u7248\u6D4B\u8BD5 fixture\uFF0C\u518D\u91CD\u65B0\u5F00\u59CB schema v3\uFF1Bdoctor \u4E0D\u81EA\u52A8\u8FC1\u79FB\u6216\u7EC8\u6B62");
  return {
    version,
    root: root2,
    pluginRoot: pluginRoot2,
    tools: tools2,
    project,
    activeFeature,
    corruptFeature,
    corruptActivePointer,
    recoveryTransaction: recoveryTxn ?? null,
    rollbackTransactions,
    trace: trace2 ?? null,
    review: review2 ?? null,
    mcp: { server: "running", configuration: !invalidJson },
    v3Ready,
    legacyFeatures,
    diagnostics: diagnostics2
  };
}

// plugins/dev-flow/src/mcp/attention.ts
import { execFile as execFile6 } from "node:child_process";
import { promisify as promisify6 } from "node:util";

// plugins/dev-flow/src/mcp/windows-notifications.ts
import { execFile as execFile5 } from "node:child_process";
import { access as access4 } from "node:fs/promises";
import path16 from "node:path";
import { promisify as promisify5 } from "node:util";
var run4 = promisify5(execFile5);
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
  return appData ? path16.win32.join(appData, "Microsoft", "Windows", "Start Menu", "Programs", shortcutName) : void 0;
}
async function command(file, args) {
  return run4(file, args);
}
async function pathExists4(file) {
  try {
    await access4(file);
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
$workingDirectory = ${powerShellLiteral(path16.win32.dirname(shortcutPath))}
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
    if (!await (options.exists ?? pathExists4)(shortcutPath)) return;
    await (options.execute ?? command)("powershell.exe", encodedPowerShell(toastScript(title, body)));
  } catch {
  }
}

// plugins/dev-flow/src/mcp/attention.ts
var run5 = promisify6(execFile6);
function messageFor(event) {
  if (event.kind === "workflow-finalized") {
    return { title: "Dev Flow \u5DF2\u5B8C\u6210", body: "\u5F53\u524D\u529F\u80FD\u5DF2\u5B8C\u6210\u5E76\u751F\u6210\u4EA4\u4ED8\u5FEB\u7167\u3002" };
  }
  const decision = event.decision === "approval" ? "\u786E\u8BA4\u5F00\u59CB\u6267\u884C" : event.decision === "rollback-confirmation" ? "\u56DE\u64A4\u786E\u8BA4" : event.decision === "quality-exception" ? "\u98CE\u9669\u63A5\u53D7" : "\u9700\u6C42\u9009\u62E9";
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
    await (options.execute ?? ((file, args) => run5(file, args)))("osascript", ["-e", script]);
  } catch {
  }
}

// plugins/dev-flow/src/mcp/input-validation.ts
function typeOf(value) {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  return typeof value;
}
function stable2(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stable2).join(",")}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stable2(value[key])}`).join(",")}}`;
}
function childPath(path18, key) {
  return typeof key === "number" ? `${path18}[${key}]` : `${path18}.${key}`;
}
function issue2(path18, keyword, message, extra = {}) {
  return { path: path18, keyword, message, ...extra };
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
      if (stable2(record[key]) !== stable2(candidate.const)) return false;
    } else if (Array.isArray(candidate.enum)) {
      constrained = true;
      if (!candidate.enum.some((allowed) => stable2(record[key]) === stable2(allowed))) return false;
    }
  }
  return constrained;
}
function validate(value, schema, path18) {
  if (Object.keys(schema).length === 0) return [];
  const issues = [];
  const expectedType = schema.type;
  if (typeof expectedType === "string" && !matchesType(value, expectedType)) {
    return [issue2(path18, "type", `expected ${expectedType}, got ${typeOf(value)}`)];
  }
  if (Array.isArray(expectedType) && !expectedType.some((candidate) => typeof candidate === "string" && matchesType(value, candidate))) {
    return [issue2(path18, "type", `expected one of ${expectedType.join(", ")}, got ${typeOf(value)}`)];
  }
  if (schema.const !== void 0 && stable2(value) !== stable2(schema.const)) {
    issues.push(issue2(path18, "const", `must equal ${stable2(schema.const)}`));
  }
  if (Array.isArray(schema.enum) && !schema.enum.some((candidate) => stable2(value) === stable2(candidate))) {
    issues.push(issue2(path18, "enum", "must be one of the allowed values"));
  }
  if (typeof value === "string") {
    if (typeof schema.minLength === "number" && value.length < schema.minLength) issues.push(issue2(path18, "minLength", `must have length >= ${schema.minLength}`));
    if (typeof schema.pattern === "string") {
      let matches = false;
      try {
        matches = new RegExp(schema.pattern).test(value);
      } catch {
        matches = false;
      }
      if (!matches) issues.push(issue2(path18, "pattern", "does not match the required pattern"));
    }
  }
  if (typeof value === "number" && typeof schema.minimum === "number" && value < schema.minimum) {
    issues.push(issue2(path18, "minimum", `must be >= ${schema.minimum}`));
  }
  if (Array.isArray(value)) {
    if (typeof schema.minItems === "number" && value.length < schema.minItems) issues.push(issue2(path18, "minItems", `must contain at least ${schema.minItems} items`));
    if (typeof schema.maxItems === "number" && value.length > schema.maxItems) issues.push(issue2(path18, "maxItems", `must contain at most ${schema.maxItems} items`));
    if (schema.uniqueItems === true) {
      const seen = new Set(value.map(stable2));
      if (seen.size !== value.length) issues.push(issue2(path18, "uniqueItems", "items must be unique"));
    }
    if (schema.items && typeof schema.items === "object" && !Array.isArray(schema.items)) {
      value.forEach((item, index) => issues.push(...validate(item, schema.items, childPath(path18, index))));
    }
  }
  if (typeof value === "object" && value !== null && !Array.isArray(value)) {
    const record = value;
    const properties = schema.properties && typeof schema.properties === "object" && !Array.isArray(schema.properties) ? schema.properties : {};
    const required = Array.isArray(schema.required) ? schema.required.filter((key) => typeof key === "string") : [];
    for (const key of required) {
      if (!(key in record)) issues.push(issue2(childPath(path18, key), "required", "is required"));
    }
    const additional = schema.additionalProperties;
    for (const [key, item] of Object.entries(record)) {
      if (properties[key]) {
        issues.push(...validate(item, properties[key], childPath(path18, key)));
      } else if (additional === false) {
        issues.push(issue2(childPath(path18, key), "additionalProperties", "unknown field", {
          unknownField: key,
          allowedFields: Object.keys(properties).sort()
        }));
      } else if (additional && typeof additional === "object" && !Array.isArray(additional)) {
        issues.push(...validate(item, additional, childPath(path18, key)));
      }
    }
    const propertyNames = schema.propertyNames && typeof schema.propertyNames === "object" && !Array.isArray(schema.propertyNames) ? schema.propertyNames : void 0;
    if (propertyNames) {
      for (const key of Object.keys(record)) issues.push(...validate(key, propertyNames, childPath(path18, key)));
    }
  }
  if (Array.isArray(schema.oneOf)) {
    const candidates = schema.oneOf.filter((candidate) => typeof candidate === "object" && candidate !== null && !Array.isArray(candidate));
    const results = candidates.map((candidate) => validate(value, candidate, path18));
    const valid = results.filter((result) => result.length === 0);
    if (valid.length !== 1) {
      const discriminatorResults = results.filter((_, index) => discriminatorMatches(value, candidates[index]));
      const bestPool = discriminatorResults.length ? discriminatorResults : results;
      const best = bestPool.sort((left, right) => left.length - right.length)[0] ?? [];
      issues.push(...best);
      issues.push(issue2(path18, "oneOf", "must match exactly one schema"));
    }
  }
  return issues;
}
function normalizeIssues(tool, issues) {
  const normalized = tool === "dev_flow_classify" ? issues.map((candidate) => candidate.unknownField === "riskFacts" ? { ...candidate, path: "$.classificationBasis.riskFacts", message: "riskFacts belongs inside classificationBasis" } : candidate) : issues;
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

// plugins/dev-flow/src/mcp/server.ts
var root = process.cwd();
var formElicitationEnabled = process.env.DEV_FLOW_ELICITATION_FORM === "1";
var moduleDirectory = path17.dirname(fileURLToPath(import.meta.url));
var pluginRoot = path17.basename(moduleDirectory) === "dist" ? path17.resolve(moduleDirectory, "..") : path17.resolve(moduleDirectory, "../..");
var tools = [
  "dev_flow_init_project",
  "dev_flow_classify",
  "dev_flow_start",
  "dev_flow_lock_classification",
  "dev_flow_record_decision",
  "dev_flow_resolve_decision",
  "dev_flow_status",
  "dev_flow_inspect",
  "dev_flow_scaffold_artifact",
  "dev_flow_record_artifact",
  "dev_flow_record_step",
  "dev_flow_pause",
  "dev_flow_resume",
  "dev_flow_reconcile_workspace",
  "dev_flow_record_artifact_with_trace",
  "dev_flow_get_traceability",
  "dev_flow_rebuild_review_projection",
  "dev_flow_create_review_batch",
  "dev_flow_get_review_job",
  "dev_flow_claim_review_job",
  "dev_flow_submit_review_job",
  "dev_flow_sample_review_job",
  "dev_flow_release_review_job",
  "dev_flow_present_review_risk_acceptance",
  "dev_flow_present_approval",
  "dev_flow_present_quality_exception",
  "dev_flow_answer",
  "dev_flow_reclassify",
  "dev_flow_verify",
  "dev_flow_request_grill_decision",
  "dev_flow_feature_check",
  "dev_flow_finalize",
  "dev_flow_abandon",
  "dev_flow_enable_windows_notifications",
  "dev_flow_doctor",
  "dev_flow_begin_implementation_unit",
  "dev_flow_checkpoint_implementation_unit",
  "dev_flow_preview_rollback",
  "dev_flow_present_rollback_gate",
  "dev_flow_execute_rollback",
  "dev_flow_recover_corrupt_feature"
];
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
var classificationSignalsSchema = object(["impactScope", "sharedContract", "independentChains", "coordinatedRollback", "requirements", "formalControls"], {
  impactScope: { enum: ["single-location", "single-module", "cross-module"] },
  sharedContract: { type: "boolean" },
  independentChains: { type: "integer", minimum: 1 },
  coordinatedRollback: { type: "boolean" },
  requirements: { enum: ["missing-or-unclear", "documented-unconfirmed", "provided-confirmed"] },
  formalControls: { type: "array", items: { enum: ["trace", "independent-review", "multiple-rollback-units"] }, uniqueItems: true }
});
var classificationBasisSchema = object(["scopeFacts", "topologyFacts", "uncertaintyFacts", "riskFacts", "decisionRefs"], {
  scopeFacts: { type: "array", items: string },
  topologyFacts: { type: "array", items: string },
  uncertaintyFacts: { type: "array", items: string },
  riskFacts: { type: "object", propertyNames: { enum: allowedRiskLabels }, additionalProperties: { type: "array", items: string } },
  decisionRefs: { type: "array", items: string },
  signals: classificationSignalsSchema
});
var recommendedClassificationBasisSchema = object(["scopeFacts", "topologyFacts", "uncertaintyFacts", "riskFacts", "decisionRefs", "signals"], {
  ...classificationBasisSchema.properties
});
var flatClassificationBasisProperties = {
  scopeFacts: classificationBasisSchema.properties.scopeFacts,
  topologyFacts: classificationBasisSchema.properties.topologyFacts,
  uncertaintyFacts: classificationBasisSchema.properties.uncertaintyFacts,
  riskFacts: classificationBasisSchema.properties.riskFacts,
  decisionRefs: classificationBasisSchema.properties.decisionRefs
};
var classificationInputSchema = object(["level", "topology"], {
  level: { enum: ["XS", "S", "M", "L"] },
  topology: { enum: ["local", "shared-contract", "multi-chain", "coordinated-rollback"] },
  execution: { enum: ["light", "standard"] },
  requirements: { enum: ["missing-or-unclear", "documented-unconfirmed", "provided-confirmed"] },
  riskLabels: riskLabelsSchema,
  classificationBasis: classificationBasisSchema,
  ...flatClassificationBasisProperties,
  acceptanceAssistSuggested: { type: "boolean" }
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
  object(["kind", "id", "parentRequirement"], { kind: { const: "acceptance-criterion" }, id: traceId("AC"), parentRequirement: traceId("REQ") }),
  object(["kind", "id", "covers", "rollbackUnit"], { kind: { const: "task" }, id: traceId("TASK"), covers: stringArray, rollbackUnit: traceId("RU") }),
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
  })
];
var traceDeltaSchema = object(["nodes"], {
  nodes: { type: "array", items: { oneOf: traceNodeSchemas } }
});
var reviewEvidenceSchema = object(["path"], { path: string, line: { type: "integer", minimum: 1 } });
var reviewFindingSchema = object(["severity", "category", "targets", "evidence", "claim", "recommendation"], {
  severity: { enum: ["blocking", "warning", "note"] },
  category: { enum: ["requirements-coverage", "architecture-testability", "rollback-operability", "security", "data-irreversibility"] },
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
  raw: string
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
var manualAcceptanceScenarioSchema = {
  type: "array",
  minItems: 1,
  items: object(["name", "evidence"], { name: string, evidence: string })
};
var manualAcceptanceSchema = { oneOf: [
  object(["mode", "source", "scenarios"], {
    mode: { enum: ["browser", "code-path-audit"] },
    source: string,
    scenarios: manualAcceptanceScenarioSchema
  }),
  object(["mode", "source", "userReply", "scenarios"], {
    mode: { const: "user-signoff" },
    source: string,
    userReply: string,
    scenarios: manualAcceptanceScenarioSchema
  })
] };
var interactionOptionSchema = object(["id", "label"], {
  id: string,
  label: string,
  description: string,
  requiresComment: { type: "boolean" }
});
var toolSchemas = {
  dev_flow_init_project: { description: "Create strict project configuration.", inputSchema: object(["config"], { config: { type: "object" } }) },
  dev_flow_classify: {
    description: "Pure route classification.",
    inputSchema: { type: "object", oneOf: [
      object(["classificationBasis"], { classificationBasis: recommendedClassificationBasisSchema }),
      object(["level", "topology"], {
        level: { enum: ["XS", "S", "M", "L"] },
        topology: { enum: ["local", "shared-contract", "multi-chain", "coordinated-rollback"] },
        execution: { enum: ["light", "standard"] },
        requirements: { enum: ["missing-or-unclear", "documented-unconfirmed", "provided-confirmed"] },
        riskLabels: riskLabelsSchema,
        classificationBasis: classificationBasisSchema,
        acceptanceAssistSuggested: { type: "boolean", description: "Offer optional browser/user acceptance help; never blocks the route." },
        manualAcceptanceRequired: { type: "boolean" }
      })
    ] },
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
    inputSchema: featureMutation({ classification: classificationInputSchema }, ["classification"])
  },
  dev_flow_record_decision: {
    description: "Record one unresolved user-owned decision in the shared ledger.",
    inputSchema: featureMutation({ question: string, factRefs: { type: "array", items: string }, host: { enum: ["claude", "codex"] } }, ["question", "host"])
  },
  dev_flow_resolve_decision: {
    description: "Resolve one decision with normalized user evidence and conclusion.",
    inputSchema: featureMutation({ decisionId: string, evidence: string, conclusion: string, host: { enum: ["claude", "codex"] } }, ["decisionId", "evidence", "conclusion", "host"])
  },
  dev_flow_status: { description: "Read the compact daily status of one feature.", inputSchema: object(["featureId"], { featureId: string }), annotations: { readOnlyHint: true } },
  dev_flow_inspect: { description: "Read one detailed topic; full state is never exposed through a single public response.", inputSchema: object(["featureId", "topic"], { featureId: string, topic: { enum: inspectionTopics } }), annotations: { readOnlyHint: true } },
  dev_flow_scaffold_artifact: { description: "Create only the current route artifact. For editable artifacts, read the registered path before editing, then record it. Generated status artifacts are read-only: scaffold them and continue with the requested step; do not edit or record them.", inputSchema: featureMutation({ kind: string }, ["kind"]) },
  dev_flow_record_artifact: { description: "Register an edited route artifact.", inputSchema: featureMutation({ kind: string }, ["kind"]) },
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
    description: "Submit one claimed job's structured completion. Optional host attestation can raise multi-agent-attested only; Core still owns assurance.",
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
  dev_flow_present_review_risk_acceptance: {
    description: "Present a one-time user decision for an exact set of current blocking review findings.",
    inputSchema: featureMutation({ findingIds: { type: "array", minItems: 1, uniqueItems: true, items: string } }, ["findingIds"])
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
    description: "Begin the next rollback unit of a checkpoints:1 feature; Core derives basis, scope, and dependency order.",
    inputSchema: object(["featureId", "expectedRevision", "unitId"], { featureId: string, expectedRevision: integer, unitId: traceId("RU") })
  },
  dev_flow_checkpoint_implementation_unit: {
    description: "Confirm the active rollback unit: scope-checked diff, forward verification, content-addressed checkpoint.",
    inputSchema: object(["featureId", "expectedRevision", "unitId"], { featureId: string, expectedRevision: integer, unitId: traceId("RU") })
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
  dev_flow_present_approval: { description: "Present one Core-derived approval obligation.", inputSchema: featureMutation({ approvalId: string, host: { enum: ["claude", "codex"] } }, ["approvalId", "host"]) },
  dev_flow_request_grill_decision: {
    description: "Present the current grill question as structured choices when the host supports MCP elicitation, otherwise return one-time text replies.",
    inputSchema: featureMutation({
      questionId: string,
      question: string,
      options: { type: "array", minItems: 2, maxItems: 3, items: interactionOptionSchema },
      host: { enum: ["claude", "codex"] }
    }, ["questionId", "question", "options", "host"])
  },
  dev_flow_reclassify: {
    description: "Reclassify route (stricter always; same-level standard\u2192light with userEvidence before implementation).",
    inputSchema: featureMutation({ classification: classificationInputSchema, reason: string, userEvidence: string }, ["classification", "reason"])
  },
  dev_flow_verify: {
    description: "Run only configured verification commands and optionally record manual acceptance.",
    inputSchema: featureMutation({
      commandIds: { type: "array", items: string },
      host: { enum: ["claude", "codex"] },
      manualAcceptance: manualAcceptanceSchema
    }, ["host"])
  },
  dev_flow_feature_check: { description: "Check route completeness and fresh evidence.", inputSchema: featureMutation() },
  dev_flow_finalize: { description: "Set logic-complete after all obligations pass.", inputSchema: featureMutation() },
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
  return Boolean(value && typeof value === "object" && !Array.isArray(value) && value.schemaVersion === 3 && typeof value.featureId === "string" && typeof value.revision === "number" && typeof value.mode === "string");
}
function compactMutationResult(toolName, value) {
  if (readOnlyResponseTools.has(toolName)) return value;
  const mutationContent = (summary, interaction) => ({
    \u72B6\u6001: lifecycleLabel(summary.lifecycle),
    ...summary.route ? { \u8DEF\u7EBF: routeLabel(summary.route) } : {},
    \u5F53\u524D\u9636\u6BB5: stageLabel(summary.stage),
    \u4E0B\u4E00\u6B65: summary.logicComplete ? "\u5F53\u524D\u4EFB\u52A1\u5DF2\u5B8C\u6210\u3002" : "\u6309\u5F53\u524D\u72B6\u6001\u7EE7\u7EED\u4E0B\u4E00\u6B65\u3002",
    \u9700\u8981\u7528\u6237\u51B3\u5B9A: summary.counters.openInteractions > 0,
    \u5065\u5EB7\u72B6\u6001: summary.counters.blockingFindings > 0 ? "\u9700\u8981\u5904\u7406" : "\u6B63\u5E38",
    ...interaction?.status === "pending" ? {
      \u9700\u8981\u7528\u6237\u51B3\u5B9A: true,
      \u5F53\u524D\u95EE\u9898: interaction.question ?? "\u8BF7\u56DE\u7B54\u5F53\u524D\u95EE\u9898\u3002",
      \u9009\u9879: interaction.options.map((option) => option.label)
    } : {}
  });
  if (isFeatureState(value)) {
    const summary = buildFeatureMutationSummary(value);
    return { contentView: mutationContent(summary), structuredContentView: { ...summary, state: summary, control: { featureId: summary.featureId, expectedRevision: summary.revision, stage: summary.stage, lifecycle: summary.lifecycle } } };
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  const record = value;
  if (isFeatureState(record.state)) {
    const summary = buildFeatureMutationSummary(record.state);
    return { contentView: mutationContent(summary, record.interaction), structuredContentView: { ...record, ...summary, state: summary, control: { featureId: summary.featureId, expectedRevision: summary.revision, stage: summary.stage, lifecycle: summary.lifecycle } } };
  }
  return value;
}
function failure(id, error) {
  const value = failureFrom(error);
  const content = JSON.stringify({
    \u72B6\u6001: "\u672A\u5B8C\u6210",
    \u539F\u56E0: value.cause,
    \u63D0\u793A: value.userMessage,
    \u5F71\u54CD: value.impact,
    \u6062\u590D\u52A8\u4F5C: value.recovery.instruction
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
function assertExactToolInput(value, keys, tool) {
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).some((key) => !keys.includes(key)) || keys.some((key) => !(key in value))) {
    throw new DevFlowError("INVALID_TOOL_INPUT", `${tool} input does not match its schema`);
  }
}
function assertTraceRegistrationInput(value) {
  assertExactToolInput(value, ["featureId", "expectedRevision", "kind", "traceDelta"], "dev_flow_record_artifact_with_trace");
  const input = value;
  if (typeof input.featureId !== "string" || !input.featureId || typeof input.expectedRevision !== "number" || !Number.isInteger(input.expectedRevision) || input.expectedRevision < 0 || !traceArtifactKinds2.includes(input.kind)) {
    throw new DevFlowError("INVALID_TOOL_INPUT", "dev_flow_record_artifact_with_trace input does not match its schema");
  }
  validateTraceDelta(input.traceDelta);
}
function assertTraceReadInput(value) {
  assertExactToolInput(value, ["featureId"], "dev_flow_get_traceability");
  if (typeof value.featureId !== "string" || !value.featureId) {
    throw new DevFlowError("INVALID_TOOL_INPUT", "dev_flow_get_traceability input does not match its schema");
  }
}
function assertReviewMutationInput(value, tool, stringExtras, otherExtras = []) {
  assertExactToolInput(value, ["featureId", "expectedRevision", ...stringExtras, ...otherExtras], tool);
  if (typeof value.featureId !== "string" || !value.featureId || typeof value.expectedRevision !== "number" || !Number.isInteger(value.expectedRevision) || value.expectedRevision < 0 || stringExtras.some((key) => typeof value[key] !== "string" || !value[key])) {
    throw new DevFlowError("INVALID_TOOL_INPUT", `${tool} input does not match its schema`);
  }
}
function assertReviewGetInput(value) {
  assertExactToolInput(value, ["featureId", "batchId", "jobId", "capability"], "dev_flow_get_review_job");
  if (typeof value.featureId !== "string" || !value.featureId || typeof value.batchId !== "string" || !value.batchId || typeof value.jobId !== "string" || !value.jobId || typeof value.capability !== "string" || !value.capability) {
    throw new DevFlowError("INVALID_TOOL_INPUT", "dev_flow_get_review_job input does not match its schema");
  }
}
function assertReviewSubmitInput(value) {
  const extras = ["completion", ...value && typeof value === "object" && !Array.isArray(value) && "attestation" in value ? ["attestation"] : []];
  assertReviewMutationInput(value, "dev_flow_submit_review_job", ["batchId", "jobId", "capability"], extras);
  try {
    parseReviewJobCompletion(value.completion);
  } catch (error) {
    throw new DevFlowError("INVALID_TOOL_INPUT", "dev_flow_submit_review_job input does not match its schema", {
      mutationApplied: false,
      ...error instanceof Error ? { cause: error.message } : {}
    });
  }
  if (value.attestation !== void 0) {
    try {
      parseHostAttestation(value.attestation);
    } catch (error) {
      throw new DevFlowError("INVALID_TOOL_INPUT", "dev_flow_submit_review_job attestation does not match its schema", {
        mutationApplied: false,
        ...error instanceof Error ? { cause: error.message } : {}
      });
    }
  }
}
function assertReviewSamplingInput(value) {
  assertReviewMutationInput(value, "dev_flow_sample_review_job", ["batchId", "jobId"]);
}
var ROLLBACK_UNIT_ID = /^RU-[0-9]{3,}$/;
function assertUnitMutationInput(value, tool) {
  assertReviewMutationInput(value, tool, ["unitId"]);
  if (typeof value.unitId !== "string" || !ROLLBACK_UNIT_ID.test(value.unitId)) {
    throw new DevFlowError("INVALID_TOOL_INPUT", `${tool} input does not match its schema`);
  }
}
function assertPreviewRollbackInput(value) {
  assertExactToolInput(value, ["featureId", "targetCheckpointId"], "dev_flow_preview_rollback");
  if (typeof value.featureId !== "string" || !value.featureId || typeof value.targetCheckpointId !== "string" || !value.targetCheckpointId) {
    throw new DevFlowError("INVALID_TOOL_INPUT", "dev_flow_preview_rollback input does not match its schema");
  }
}
function assertRollbackMutationInput(value, tool, includeHost = false) {
  assertReviewMutationInput(value, tool, ["targetCheckpointId"], includeHost ? ["host"] : []);
  if (typeof value.targetCheckpointId !== "string" || !value.targetCheckpointId) {
    throw new DevFlowError("INVALID_TOOL_INPUT", `${tool} input does not match its schema`);
  }
}
function interactionEnvelope(state, interaction, interactionOutcome, response) {
  const optionLabel = interaction.options.find((option) => option.id === interactionOutcome)?.label;
  return {
    state,
    interaction,
    interactionOutcome: optionLabel ?? interactionOutcome,
    ...response ? { response: { action: optionLabel ?? response.action, ...response.comment ? { comment: response.comment } : {} } } : {}
  };
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
var classificationBasisKeys = ["scopeFacts", "topologyFacts", "uncertaintyFacts", "riskFacts", "decisionRefs"];
function stableJson(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(",")}}`;
}
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
  nextClientRequestId = 0;
  pending = /* @__PURE__ */ new Map();
  configure(capabilities) {
    this.supportsFormElicitation = false;
    this.supportsSampling = false;
    if (!capabilities || typeof capabilities !== "object" || Array.isArray(capabilities)) return;
    const sampling = capabilities.sampling;
    this.supportsSampling = !!sampling && typeof sampling === "object" && !Array.isArray(sampling);
    const elicitation = capabilities.elicitation;
    if (!elicitation || typeof elicitation !== "object" || Array.isArray(elicitation)) return;
    const modes = elicitation;
    this.supportsFormElicitation = formElicitationEnabled && (Object.keys(modes).length === 0 || modes.form !== void 0);
  }
  consumeResponse(message) {
    if (typeof message.id !== "string" || message.method !== void 0) return false;
    const pending = this.pending.get(message.id);
    if (!pending) return false;
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
            reject(new DevFlowError("REVIEW_SAMPLING_TIMEOUT", "MCP sampling/createMessage did not return before its lease expired"));
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
    if (!this.supportsFormElicitation) return void 0;
    let raw;
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
              enum: interaction.options.map((option) => option.id),
              enumNames: interaction.options.map((option) => option.label)
            },
            comment: {
              type: "string",
              title: "\u4FEE\u6539\u610F\u89C1 / \u8865\u5145\u8BF4\u660E",
              description: "\u9009\u62E9\u201C\u63D0\u51FA\u4FEE\u6539\u610F\u89C1\u201D\u6216\u201C\u5176\u4ED6\u201D\u65F6\u5FC5\u586B"
            }
          },
          required: ["action"]
        }
      });
    } catch {
      return void 0;
    }
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return void 0;
    const result = raw;
    if (result.action !== "accept" || !result.content || typeof result.content.action !== "string") return void 0;
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
async function call(name, a, connection2) {
  switch (name) {
    case "dev_flow_init_project":
      return initProject(root, a.config);
    case "dev_flow_classify": {
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
      return startFeature(root, { ...a, host: a.host });
    case "dev_flow_lock_classification": {
      const classification2 = normalizeLockClassification(a.classification);
      const { level, topology, execution, requirements, riskLabels, acceptanceAssistSuggested, scopeFacts, topologyFacts, uncertaintyFacts, riskFacts, decisionRefs } = classification2;
      return lockClassification(root, a.featureId, a.expectedRevision, {
        level,
        topology,
        ...execution ? { execution } : {},
        ...requirements ? { requirements } : {},
        ...riskLabels ? { riskLabels } : {},
        ...acceptanceAssistSuggested !== void 0 ? { acceptanceAssistSuggested } : {},
        scopeFacts,
        topologyFacts,
        uncertaintyFacts,
        riskFacts,
        decisionRefs,
        classificationBasis: classification2.classificationBasis
      });
    }
    case "dev_flow_status":
      return readCompactStatus(root, a.featureId);
    case "dev_flow_inspect":
      return inspectFeature(root, a.featureId, a.topic);
    case "dev_flow_scaffold_artifact":
      return scaffoldArtifact(root, a.featureId, a.expectedRevision, a.kind);
    case "dev_flow_record_artifact":
      return recordArtifact(root, a.featureId, a.expectedRevision, a.kind);
    case "dev_flow_record_artifact_with_trace": {
      assertTraceRegistrationInput(a);
      const input = a;
      return recordArtifactWithTrace(root, input.featureId, input.expectedRevision, input.kind, input.traceDelta);
    }
    case "dev_flow_get_traceability": {
      assertTraceReadInput(a);
      const state = await readState(root, a.featureId);
      const inspection = await inspectCurrentTrace(root, state);
      return {
        pointer: state.traceability,
        ...inspection.ledger ? { ledger: inspection.ledger } : {},
        ...inspection.effectiveSummary ? { effectiveSummary: inspection.effectiveSummary } : {},
        blockers: inspection.blocker ? [inspection.blocker] : []
      };
    }
    case "dev_flow_rebuild_review_projection":
      return rebuildReviewProjection(root, a.featureId, a.expectedRevision);
    case "dev_flow_create_review_batch": {
      assertReviewMutationInput(a, "dev_flow_create_review_batch", []);
      return createReviewBatch(root, a.featureId, a.expectedRevision);
    }
    case "dev_flow_get_review_job": {
      assertReviewGetInput(a);
      return getReviewJob(root, a.featureId, a.batchId, a.jobId, a.capability);
    }
    case "dev_flow_claim_review_job": {
      assertReviewMutationInput(a, "dev_flow_claim_review_job", ["batchId", "jobId", "claimRequestId"]);
      return claimReviewJob(root, a.featureId, a.expectedRevision, a.batchId, a.jobId, a.claimRequestId);
    }
    case "dev_flow_release_review_job": {
      assertReviewMutationInput(a, "dev_flow_release_review_job", ["batchId", "jobId", "capability"]);
      return releaseReviewJob(root, a.featureId, a.expectedRevision, a.batchId, a.jobId, a.capability);
    }
    case "dev_flow_submit_review_job": {
      assertReviewSubmitInput(a);
      const result = await submitReviewJob(
        root,
        a.featureId,
        a.expectedRevision,
        a.batchId,
        a.jobId,
        a.capability,
        a.completion,
        a.attestation
      );
      return reviewSubmissionEnvelope(result, a.jobId);
    }
    case "dev_flow_sample_review_job": {
      assertReviewSamplingInput(a);
      connection2.assertSamplingSupported();
      const started = await beginReviewSampling(root, a.featureId, a.expectedRevision, a.batchId, a.jobId);
      try {
        const completion = await connection2.sampleReview({
          role: started.job.role,
          reviewDepth: started.job.reviewDepth,
          package: started.package
        });
        const completed = await completeReviewSampling(
          root,
          a.featureId,
          started.state.revision,
          a.batchId,
          a.jobId,
          started.requestId,
          completion
        );
        return reviewSubmissionEnvelope({ ...completed, idempotent: false }, a.jobId);
      } catch (error) {
        try {
          await failReviewSampling(
            root,
            a.featureId,
            started.state.revision,
            a.batchId,
            a.jobId,
            started.requestId,
            samplingFailureCode(error)
          );
        } catch {
        }
        const code = error instanceof DevFlowError ? error.code : "REVIEW_SAMPLING_FAILED";
        throw new DevFlowError("REVIEW_SAMPLING_FAILED", "sampling review did not produce an accepted completion", {
          batchId: a.batchId,
          jobId: a.jobId,
          causeCode: code
        });
      }
    }
    case "dev_flow_record_decision":
      return recordDecision(
        root,
        a.featureId,
        a.expectedRevision,
        a.question,
        a.factRefs ?? [],
        a.host
      );
    case "dev_flow_resolve_decision":
      return resolveRecordedDecision(
        root,
        a.featureId,
        a.expectedRevision,
        a.decisionId,
        a.evidence,
        a.conclusion,
        a.host
      );
    case "dev_flow_present_review_risk_acceptance": {
      assertReviewMutationInput(a, "dev_flow_present_review_risk_acceptance", [], ["findingIds"]);
      if (!Array.isArray(a.findingIds) || !a.findingIds.length || a.findingIds.some((findingId) => typeof findingId !== "string" || !findingId)) {
        throw new DevFlowError("INVALID_TOOL_INPUT", "dev_flow_present_review_risk_acceptance input does not match its schema");
      }
      const result = await presentReviewRiskAcceptance(root, a.featureId, a.expectedRevision, a.findingIds);
      return interactionEnvelope(result.state, result.interaction, result.idempotent ? "pending" : "presented");
    }
    case "dev_flow_record_step":
      return recordStep(root, a.featureId, a.expectedRevision, a.step, a.evidence);
    case "dev_flow_pause":
      return pauseFeature(root, a.featureId, a.expectedRevision, a.reason, a.host);
    case "dev_flow_resume":
      return resumeFeature(root, a.featureId, a.host);
    case "dev_flow_reconcile_workspace":
      return reconcileWorkspace(root, a.featureId, a.expectedRevision, a.host);
    case "dev_flow_begin_implementation_unit": {
      assertUnitMutationInput(a, "dev_flow_begin_implementation_unit");
      return beginImplementationUnit(root, a.featureId, a.expectedRevision, a.unitId);
    }
    case "dev_flow_checkpoint_implementation_unit": {
      assertUnitMutationInput(a, "dev_flow_checkpoint_implementation_unit");
      return checkpointImplementationUnit(root, a.featureId, a.expectedRevision, a.unitId);
    }
    case "dev_flow_preview_rollback": {
      assertPreviewRollbackInput(a);
      return previewRollback(root, a.featureId, a.targetCheckpointId);
    }
    case "dev_flow_present_rollback_gate": {
      assertRollbackMutationInput(a, "dev_flow_present_rollback_gate", true);
      const presentation = await presentRollbackGate(root, a.featureId, a.expectedRevision, a.targetCheckpointId);
      emitAttentionNotification({ kind: "decision-required", featureId: a.featureId, decision: "rollback-confirmation" });
      const selection = await connection2.elicit(
        presentation.interaction,
        rollbackGateMessage(presentation.preview)
      );
      if (!selection) return { ...interactionEnvelope(presentation.state, presentation.interaction, "pending"), preview: presentation.preview };
      const state = await resolveRollbackGateElicitation(
        root,
        a.featureId,
        presentation.state.revision,
        presentation.interactionId,
        selection.action,
        selection.comment,
        a.host
      );
      return {
        ...interactionEnvelope(
          state,
          toPublicInteraction(getInteraction(state, presentation.interactionId)),
          selection.action,
          interactionResponse(state, presentation.interactionId)
        ),
        preview: presentation.preview
      };
    }
    case "dev_flow_execute_rollback": {
      assertRollbackMutationInput(a, "dev_flow_execute_rollback");
      const result = await executeRollback(root, a.featureId, a.expectedRevision, a.targetCheckpointId);
      return { outcome: result.outcome, state: result.state, transactionId: result.transaction.transactionId };
    }
    case "dev_flow_present_approval": {
      const presentation = await presentApproval(root, a.featureId, a.expectedRevision, a.approvalId);
      emitAttentionNotification({ kind: "decision-required", featureId: a.featureId, decision: "approval", approvalId: a.approvalId });
      const selection = await connection2.elicit(
        presentation.approvalInteraction,
        "\u8BF7\u786E\u8BA4\u5F53\u524D\u6267\u884C\u6458\u8981\uFF0C\u6216\u63D0\u51FA\u9700\u8981\u4FEE\u6539\u7684\u610F\u89C1\u3002"
      );
      if (!selection) return interactionEnvelope(presentation, presentation.approvalInteraction, "pending");
      const state = await resolveApprovalElicitation(
        root,
        a.featureId,
        presentation.revision,
        presentation.interactionId,
        selection.action,
        selection.comment,
        a.host
      );
      return interactionEnvelope(
        state,
        presentation.approvalInteraction,
        selection.action,
        interactionResponse(state, presentation.interactionId)
      );
    }
    case "dev_flow_answer": {
      const state = await readState(root, a.featureId);
      const decision = pendingDecisionForState(state);
      if (!decision) {
        return {
          state,
          message: "\u5F53\u524D\u6CA1\u6709\u9700\u8981\u56DE\u7B54\u7684\u95EE\u9898\u3002",
          nextStep: "\u6D41\u7A0B\u5C06\u6309\u5F53\u524D\u9636\u6BB5\u81EA\u52A8\u7EE7\u7EED\u3002"
        };
      }
      const interaction = pendingInteractionForDecision(state, decision);
      if (!interaction) {
        const prompt = resolvePromptEvent(await readFeatureEvents(root, a.featureId), {
          host: a.host,
          userReply: a.userReply,
          presentedAt: decision.presentedAt,
          presentedRevision: decision.presentedRevision
        });
        const matched = matchDecisionReply(decision, a.userReply);
        const next = await mutate(root, a.featureId, a.expectedRevision, "decision-answered", (draft) => {
          const current = draft.pendingDecision;
          if (!current) throw new DevFlowError("DECISION_ALREADY_RESOLVED", "\u5F53\u524D\u95EE\u9898\u5DF2\u7ECF\u5904\u7406\u3002", { userMessage: "\u5F53\u524D\u95EE\u9898\u5DF2\u7ECF\u5904\u7406\uFF0C\u8BF7\u5237\u65B0\u72B6\u6001\u3002", recoveryKind: "refresh", recoveryInstruction: "\u5237\u65B0\u5F53\u524D\u72B6\u6001\u540E\u7EE7\u7EED\u3002", retryOriginal: false });
          delete draft.pendingDecision;
          if (current.kind === "workspace-ownership" && current.target?.startsWith("workspace:")) {
            const file = current.target.slice("workspace:".length);
            const owner = matched.option.id === "adopt" ? "feature" : "excluded";
            draft.workspace.ownership[file] = owner;
            if (owner === "feature") draft.workspace.ownershipSource[file] = "user-adopted";
            const nextFile = Object.keys(draft.workspace.startedDirty).find((candidate) => draft.workspace.ownership[candidate] === void 0);
            if (nextFile) {
              draft.pendingDecision = {
                kind: "workspace-ownership",
                question: `\u542F\u52A8\u524D\u5DF2\u53D1\u73B0\u8DEF\u5F84\u201C${nextFile}\u201D\u5B58\u5728\u6539\u52A8\u3002\u5B83\u662F\u5426\u5C5E\u4E8E\u5F53\u524D\u4EFB\u52A1\uFF1F`,
                options: [
                  { id: "adopt", label: "\u7EB3\u5165\u5F53\u524D\u4EFB\u52A1", recommended: true },
                  { id: "exclude", label: "\u5148\u5904\u7406\u540E\u7EE7\u7EED" }
                ],
                basisHash: current.basisHash,
                presentedAt: (/* @__PURE__ */ new Date()).toISOString(),
                presentedRevision: draft.revision,
                source: "core",
                target: `workspace:${nextFile}`
              };
            }
          } else if (current.kind === "task-switch" && matched.option.id === "pause-old") {
            draft.lifecycle = "paused";
            draft.resumeSummary = "\u65E7\u4EFB\u52A1\u5DF2\u6682\u505C\uFF1B\u6062\u590D\u65F6\u4F1A\u81EA\u52A8\u5BF9\u8D26\u5DE5\u4F5C\u533A\u3002";
          }
        }, { eventId: prompt.eventId, action: matched.option.id });
        return {
          state: next,
          message: matched.option.id === "adopt" ? "\u5DF2\u5C06\u8BE5\u8DEF\u5F84\u7EB3\u5165\u5F53\u524D\u4EFB\u52A1\u3002" : matched.option.id === "exclude" ? "\u5DF2\u5C06\u8BE5\u8DEF\u5F84\u6392\u9664\uFF1B\u7CFB\u7EDF\u4E0D\u4F1A\u81EA\u52A8\u8FD8\u539F\u6216\u6682\u5B58\u5B83\u3002" : "\u5DF2\u8BB0\u5F55\u4F60\u7684\u9009\u62E9\uFF0C\u6D41\u7A0B\u5C06\u6309\u5F53\u524D\u4EFB\u52A1\u72B6\u6001\u7EE7\u7EED\u3002",
          ...next.pendingDecision ? { attention: "\u8BF7\u53EA\u56DE\u7B54\u5F53\u524D\u8FD9\u4E00\u9053\u95EE\u9898\u3002", \u9700\u8981\u7528\u6237\u51B3\u5B9A: true } : { \u9700\u8981\u7528\u6237\u51B3\u5B9A: false }
        };
      }
      if (decision.kind === "approval") {
        const next = await resolveApprovalAnswer(root, a.featureId, a.expectedRevision, interaction.id, a.userReply, a.host);
        const response = interactionResponse(next, interaction.id);
        return interactionEnvelope(next, toPublicInteraction(getInteraction(next, interaction.id)), response?.action ?? "\u5DF2\u5904\u7406", response);
      }
      if (decision.kind === "grill") {
        const result = await resolveGrillAnswer(root, a.featureId, a.expectedRevision, interaction.id, a.userReply, a.host);
        return interactionEnvelope(result.state, result.interaction, result.response?.action ?? "\u5DF2\u5904\u7406", result.response);
      }
      if (decision.kind === "review-risk") {
        const result = await resolveReviewRiskAcceptanceAnswer(root, a.featureId, a.expectedRevision, interaction.id, a.userReply, a.host);
        const response = interactionResponse(result.state, interaction.id);
        return interactionEnvelope(result.state, toPublicInteraction(getInteraction(result.state, interaction.id)), result.idempotent ? "\u5DF2\u63A5\u53D7\u98CE\u9669" : response?.action ?? "\u5DF2\u5904\u7406", response);
      }
      if (decision.kind === "quality-exception") {
        const next = await resolveQualityExceptionAnswer(root, a.featureId, a.expectedRevision, interaction.id, a.userReply, a.host);
        const response = interactionResponse(next, interaction.id);
        return interactionEnvelope(next, toPublicInteraction(getInteraction(next, interaction.id)), response?.action ?? "\u5DF2\u5904\u7406", response);
      }
      if (decision.kind === "rollback-confirmation") {
        const next = await resolveRollbackGateAnswer(root, a.featureId, a.expectedRevision, interaction.id, a.userReply, a.host);
        const response = interactionResponse(next, interaction.id);
        return interactionEnvelope(next, toPublicInteraction(getInteraction(next, interaction.id)), response?.action ?? "\u5DF2\u5904\u7406", response);
      }
      throw new DevFlowError("DECISION_KIND_UNSUPPORTED", "\u5F53\u524D\u51B3\u7B56\u7C7B\u578B\u8FD8\u6CA1\u6709\u53EF\u7528\u7684\u56DE\u7B54\u5904\u7406\u5668\u3002", {
        userMessage: "\u5F53\u524D\u95EE\u9898\u6682\u65F6\u4E0D\u80FD\u81EA\u52A8\u5904\u7406\u3002",
        cause: `\u51B3\u7B56\u7C7B\u578B\u4E3A ${decision.kind}\u3002`,
        impact: "\u6D41\u7A0B\u4FDD\u6301\u5728\u5F53\u524D\u9636\u6BB5\u3002",
        recoveryKind: "repair",
        recoveryInstruction: "\u8FD0\u884C doctor \u68C0\u67E5\u63D2\u4EF6\u7248\u672C\u548C\u72B6\u6001\u3002",
        retryOriginal: false
      });
    }
    case "dev_flow_present_quality_exception": {
      const result = await presentQualityException(root, a.featureId, a.expectedRevision, {
        kind: a.kind,
        basisHash: a.basisHash,
        fingerprint: a.fingerprint,
        riskSummary: a.riskSummary
      });
      emitAttentionNotification({ kind: "decision-required", featureId: a.featureId, decision: "quality-exception" });
      const selection = await connection2.elicit(result.interaction, result.interaction.question ?? "\u8BF7\u51B3\u5B9A\u662F\u5426\u63A5\u53D7\u5F53\u524D\u98CE\u9669\u3002");
      if (!selection) return interactionEnvelope(result.state, result.interaction, "pending");
      const next = await resolveQualityExceptionAnswer(root, a.featureId, result.state.revision, result.interactionId, selection.action, a.host);
      const response = interactionResponse(next, result.interactionId);
      return interactionEnvelope(next, toPublicInteraction(getInteraction(next, result.interactionId)), response?.action ?? selection.action, response);
    }
    case "dev_flow_request_grill_decision": {
      const result = await requestGrillDecision(root, a.featureId, a.expectedRevision, {
        questionId: a.questionId,
        question: a.question,
        options: a.options,
        host: a.host
      });
      emitAttentionNotification({ kind: "decision-required", featureId: a.featureId, decision: "grill" });
      const selection = await connection2.elicit(result.interaction, result.interaction.question ?? "\u8BF7\u9009\u62E9\u4E00\u4E2A\u65B9\u6848\u3002");
      if (!selection) return interactionEnvelope(result.state, result.interaction, "pending");
      const resolved = await resolveGrillElicitation(
        root,
        a.featureId,
        result.state.revision,
        result.interactionId,
        selection.action,
        selection.comment,
        a.host
      );
      return interactionEnvelope(resolved.state, resolved.interaction, selection.action, resolved.response);
    }
    case "dev_flow_reclassify":
      return reclassifyFeature(root, a.featureId, a.expectedRevision, a.classification, a.reason, a.userEvidence);
    case "dev_flow_verify":
      return runVerification(
        root,
        a.featureId,
        a.expectedRevision,
        a.host,
        a.commandIds,
        a.manualAcceptance
      );
    case "dev_flow_feature_check":
      return featureCheck(root, a.featureId, a.expectedRevision);
    case "dev_flow_finalize": {
      const state = await finalize(root, a.featureId, a.expectedRevision);
      emitAttentionNotification({ kind: "workflow-finalized", featureId: a.featureId });
      return state;
    }
    case "dev_flow_abandon":
      return abandonFeature(root, a.featureId, a.expectedRevision, a.reason, a.userEvidence);
    case "dev_flow_enable_windows_notifications":
      return enableWindowsNotifications({ nodeExecutable: process.execPath });
    case "dev_flow_doctor":
      return collectDoctorReport(root, pluginRoot, "4.1.0", tools);
    case "dev_flow_recover_corrupt_feature":
      return recoverCorruptFeature(root, {
        featureId: a.featureId,
        stateSha256: a.stateSha256,
        activeSha256: a.activeSha256,
        action: a.action,
        reason: a.reason,
        userEvidence: a.userEvidence,
        host: a.host
      });
    default:
      throw new DevFlowError("UNKNOWN_TOOL", name);
  }
}
var connection = new McpConnection();
var inFlight = /* @__PURE__ */ new Set();
async function dispatchRequest(message) {
  try {
    if (!Object.hasOwn(message, "id") || message.id === void 0 || message.id === null) return;
    if (message.method === "initialize") {
      connection.configure(message.params?.capabilities);
      protocolResult(message.id, {
        protocolVersion: message.params?.protocolVersion || "2024-11-05",
        serverInfo: { name: "dev-flow", version: "4.1.0" },
        capabilities: { tools: {} },
        instructions: "\u5148\u5B8C\u6210\u4E8B\u5B9E\u8C03\u67E5\u548C\u8DEF\u7EBF\u5206\u7C7B\u3002\u65E5\u5E38\u8BFB\u53D6 dev_flow_status\uFF1B\u5B83\u4F1A\u663E\u793A\u4E2D\u6587\u9636\u6BB5\u3001\u5F53\u524D\u4E0B\u4E00\u6B65\u548C\u552F\u4E00\u5F85\u51B3\u95EE\u9898\u3002\u6240\u6709\u7528\u6237\u51B3\u5B9A\u7EDF\u4E00\u4F7F\u7528 dev_flow_answer\uFF0C\u7CFB\u7EDF\u4F1A\u81EA\u52A8\u6309\u95EE\u9898\u7C7B\u578B\u5904\u7406\u3002\u6CA1\u6709\u771F\u5B9E\u51B3\u7B56\u7F3A\u53E3\u65F6\u6D41\u7A0B\u4F1A\u81EA\u52A8\u63A8\u8FDB\u3002\u5148\u8C03\u7528 dev_flow_init_project\uFF0C\u518D\u5F00\u59CB feature\u3002"
      });
      return;
    }
    if (message.method === "tools/list") {
      protocolResult(message.id, {
        tools: tools.map((name) => ({ name, ...toolSchemas[name] }))
      });
      return;
    }
    if (message.method === "tools/call") {
      const name = message.params?.name;
      const arguments_ = message.params?.arguments ?? {};
      validateToolInput(name, arguments_, toolSchemas);
      toolResult(message.id, compactMutationResult(name, await call(name, arguments_, connection)));
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
