/* dev-flow 1.7.0; built from source, deterministic build */

// plugins/dev-flow/src/mcp/server.ts
import readline from "node:readline";
import { fileURLToPath } from "node:url";
import path16 from "node:path";

// plugins/dev-flow/src/core/artifacts.ts
import { createHash as createHash8 } from "node:crypto";
import { readFile as readFile7, writeFile as writeFile3 } from "node:fs/promises";
import path8 from "node:path";

// plugins/dev-flow/policy/contract.json
var contract_default = {
  schemaVersion: 1,
  routes: {
    xs: {
      orderedSteps: ["locate", "implementation", "verification", "finalize"],
      requiredArtifacts: [],
      featureCheckRequired: false
    },
    s: {
      orderedSteps: ["boundary", "implementation", "verification", "self_review", "finalize"],
      requiredArtifacts: [],
      featureCheckRequired: false
    },
    "risk-minimal": {
      orderedSteps: ["risk_review", "risk_controls", "implementation_approval", "implementation", "code_review", "verification", "feature_check", "finalize"],
      requiredArtifacts: ["status", "risk-card"],
      artifactSteps: { risk_review: ["risk-card"], risk_controls: ["status"] },
      featureCheckRequired: true
    },
    "light-m": {
      orderedSteps: ["boundary_plan", "implementation", "code_review", "verification", "finalize"],
      requiredArtifacts: [],
      featureCheckRequired: false
    },
    "standard-m": {
      orderedSteps: ["requirements", "requirement_confirmation", "implementation_plan", "coverage_review", "rollback_unit", "plan_review", "implementation_approval", "implementation", "code_review", "verification", "feature_check", "finalize"],
      requiredArtifacts: ["requirements", "implementation-plan", "status", "coverage-matrix"],
      artifactSteps: { requirements: ["requirements"], implementation_plan: ["implementation-plan"], coverage_review: ["coverage-matrix"], implementation_approval: ["status"] },
      artifactTransitions: [{ artifact: "plan-review", capability: "review", from: "absent", to: "generated", steps: ["plan_review"] }],
      featureCheckRequired: true
    },
    "light-l": {
      orderedSteps: ["boundary", "rollback_safety", "implementation_approval", "implementation", "code_review", "verification", "feature_check", "finalize"],
      requiredArtifacts: ["boundary-card", "rollback-safety", "verification"],
      artifactSteps: { boundary: ["boundary-card"], rollback_safety: ["rollback-safety"], verification: ["verification"] },
      featureCheckRequired: true
    },
    "standard-l": {
      orderedSteps: ["requirements", "requirement_confirmation", "implementation_plan", "coverage_review", "rollback_unit", "plan_review", "implementation_approval", "implementation", "code_review", "verification", "feature_check", "finalize"],
      requiredArtifacts: ["requirements", "implementation-plan", "coverage-matrix", "rollback-units", "plan-review", "code-review", "verification"],
      artifactSteps: { requirements: ["requirements"], implementation_plan: ["implementation-plan"], coverage_review: ["coverage-matrix"], rollback_unit: ["rollback-units"], plan_review: ["plan-review"], code_review: ["code-review"], verification: ["verification"] },
      artifactTransitions: [{ artifact: "plan-review", capability: "review", from: "editable", to: "generated", steps: ["plan_review"] }],
      featureCheckRequired: true
    }
  },
  riskEnhancements: {
    security: { checks: ["security"], verification: "behavior" },
    data: { checks: ["rollback"], verification: "behavior" },
    money: { checks: ["rollback"], verification: "behavior" },
    external: { checks: [], verification: "integration" },
    availability: { checks: [], verification: "integration" },
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
if (contract.schemaVersion !== 1) {
  throw new Error(`unsupported contract schema ${String(contract.schemaVersion)}`);
}
var allowedRiskLabels = Object.freeze(Object.keys(contract.riskEnhancements));
function routeDefinition(route) {
  return contract.routes[route];
}
function cloneArtifactSteps(steps) {
  if (!steps) return void 0;
  return Object.fromEntries(Object.entries(steps).map(([step, artifacts]) => [step, [...artifacts]]));
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
  const sourceSteps = steps ?? Object.entries(definition.artifactSteps ?? {}).filter(([, artifacts]) => artifacts.includes(artifact)).map(([step]) => step);
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
  if (route === "risk-minimal" || route === "standard-m") {
    moveArtifactToGenerated(definition, "status");
  }
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
function frontMatter(context, kind, grillStatus) {
  return [
    "---",
    "dev_flow:",
    "  schema_version: 1",
    `  feature_id: ${context.featureId}`,
    `  route: ${context.route}`,
    `  kind: ${kind}`,
    ...grillStatus ? [`  grill_status: ${grillStatus}`] : [],
    "---",
    ""
  ].join("\n");
}
function requirementsTemplate(context) {
  const grillStatus = context.requirementsState === "provided-confirmed" ? "not_required" : "pending";
  return `${frontMatter(context, "requirements", grillStatus)}# \u9700\u6C42

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
  const rollback = context.route === "standard-m" ? "\n<!-- dev-flow:id=RU-001 kind=rollback -->\n### RU-001\uFF1A\u56DE\u64A4\u5355\u5143\n\n- tasks: TASK-001\n- depends_on: []\n- file_scope:\n- covers: REQ-001\n- forward_verification: unit\n- rollback_verification: unit\n" : "";
  return `${frontMatter(context, "implementation-plan")}# \u5B9E\u73B0\u8BA1\u5212

<!-- dev-flow:id=TASK-001 kind=task -->
### TASK-001\uFF1A\u5B9E\u73B0\u4EFB\u52A1

- covers: REQ-001
- rollback_unit: RU-001
${rollback}`;
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

- tasks: TASK-001
- depends_on: []
- file_scope:
- covers: REQ-001
- forward_verification: unit
- rollback_verification: unit
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
var DevFlowError = class extends Error {
  constructor(code, message, details = {}) {
    super(`${code}: ${message}`);
    this.code = code;
    this.details = details;
  }
};

// plugins/dev-flow/src/core/gate-basis.ts
var gateBasisArtifacts = {
  requirement_confirmation: ["requirements"],
  implementation_approval: [
    "requirements",
    "implementation-plan",
    "coverage-matrix",
    "rollback-units",
    "rollback-safety",
    "risk-card",
    "boundary-card"
  ]
};
function gatesInvalidatedByArtifact(kind) {
  return Object.keys(gateBasisArtifacts).filter((gate) => gateBasisArtifacts[gate].includes(kind));
}
function gateBasis(state, gate) {
  const basis = {
    route: state.route,
    scope: state.scope,
    classification: state.classification,
    artifacts: Object.fromEntries(
      gateBasisArtifacts[gate].map((kind) => [kind, state.artifacts[kind]])
    )
  };
  if (gate === "implementation_approval" && traceEnforcementRequired(state.route, state.workflowCapabilities)) {
    basis.traceability = state.traceability;
  }
  if (gate === "implementation_approval" && reviewEnforcementRequired(state.route, state.workflowCapabilities)) {
    basis.review = state.review;
  }
  return basis;
}

// plugins/dev-flow/src/core/state-store.ts
import { randomUUID as randomUUID4, createHash as createHash6 } from "node:crypto";
import { access, mkdir as mkdir4, open as open4, readdir as readdir4, readFile as readFile6, rename as rename4, rm, rmdir, writeFile as writeFile2 } from "node:fs/promises";
import { hostname } from "node:os";
import path7 from "node:path";

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
  if (!levels.includes(input.level)) throw new PolicyError("INVALID_LEVEL", "level is invalid");
  if (!topologies.includes(input.topology)) throw new PolicyError("INVALID_TOPOLOGY", "topology is invalid");
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
    acceptanceAssistSuggested: input.acceptanceAssistSuggested === true || input.manualAcceptanceRequired === true
  };
}

// plugins/dev-flow/src/policy/route.ts
var levelRank = { XS: 0, S: 1, M: 2, L: 3 };
function minimumLevelForTopology(topology) {
  return contract.topologyMinimumLevel[topology];
}
function assertTopologyLevel(classification) {
  const minimum = minimumLevelForTopology(classification.topology);
  if (levelRank[classification.level] < levelRank[minimum]) {
    throw new PolicyError("TOPOLOGY_LEVEL_MISMATCH", "level is below topology minimum", {
      suggestedLevel: minimum,
      topology: classification.topology
    });
  }
}
function selectRoute(input) {
  const classification = normalizeClassification(input);
  assertTopologyLevel(classification);
  const { level, execution, requirements, riskLabels } = classification;
  let route;
  if (level === "XS" || level === "S") {
    if (execution) throw new PolicyError("EXECUTION_NOT_ALLOWED", "XS/S do not accept execution");
    route = riskLabels.length ? "risk-minimal" : level.toLowerCase();
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
  const warning = requirements && requirements !== "provided-confirmed" && route !== "standard-m" && route !== "standard-l" ? `\u9700\u6C42\u72B6\u6001\u4E3A ${requirements}\uFF0C\u4F46 ${route} \u8DEF\u7EBF\u65E0\u9700\u6C42\u6F84\u6E05\u73AF\u8282\uFF1B\u5EFA\u8BAE\u5347\u7EA7 M + standard \u6216\u5148\u5411\u7528\u6237\u6F84\u6E05\u540E\u91CD\u65B0\u5206\u7C7B` : void 0;
  return { classification, route, ...warning ? { warning } : {} };
}
function deriveRiskRequirements(riskLabels) {
  const checks = /* @__PURE__ */ new Set();
  const verification = /* @__PURE__ */ new Set();
  for (const label of riskLabels) {
    const enhancement = contract.riskEnhancements[label];
    enhancement.checks.forEach((check) => checks.add(check));
    verification.add(enhancement.verification);
  }
  return { checks: [...checks].sort(), verification: [...verification].sort() };
}

// plugins/dev-flow/src/core/delivery-snapshot.ts
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { lstat, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
var run = promisify(execFile);
var digest = (value) => createHash("sha256").update(value).digest("hex");
async function git(root2, args, allowExitOne = false) {
  try {
    const result = await run("git", args, { cwd: root2, encoding: "buffer", maxBuffer: 8 * 1024 * 1024 });
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
function normalizePath(value) {
  const slashPath = value.replaceAll("\\\\", "/");
  const normalized = path.posix.normalize(slashPath);
  if (!normalized || path.posix.isAbsolute(normalized) || normalized.startsWith("../") || normalized === ".." || normalized.startsWith(".dev-flow/") || normalized !== slashPath) {
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
      protectedRoots
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
  const normalized = files.map(normalizePath);
  if (new Set(normalized).size !== normalized.length) {
    throw new DevFlowError("INVALID_IMPLEMENTATION_FILE", "implementation files must not contain duplicates");
  }
  return normalized.sort();
}
function statusPaths(value) {
  const items = nulItems(value);
  const paths = /* @__PURE__ */ new Set();
  for (let index = 0; index < items.length; index += 1) {
    const item = items[index];
    if (item.length < 4) continue;
    const status = item.slice(0, 2);
    paths.add(normalizePath(item.slice(3)));
    if (/[RC]/.test(status)) {
      const original = items[index + 1];
      if (original) {
        paths.add(normalizePath(original));
        index += 1;
      }
    }
  }
  return [...paths].sort();
}
async function dirtyPaths(root2, protectedRoots) {
  const output = await git(root2, ["status", "--porcelain=v1", "-z", "--untracked-files=all", "--", ...protectedRoots]);
  return statusPaths(output);
}
async function captureDeliveryBaseline(root2, protectedRoots) {
  try {
    const gitHead = (await git(root2, ["rev-parse", "HEAD"])).trim();
    return { gitHead, dirtyPaths: await dirtyPaths(root2, protectedRoots) };
  } catch (error) {
    if (error instanceof DevFlowError && error.code === "DELIVERY_SNAPSHOT_GIT_REQUIRED") {
      return { dirtyPaths: [] };
    }
    throw error;
  }
}
async function fileHash(root2, file) {
  try {
    return digest(await readFile(path.join(root2, file)));
  } catch (error) {
    if (error.code === "ENOENT") return "deleted";
    throw error;
  }
}
async function assertPlainFile(root2, file) {
  const metadata = await lstat(path.join(root2, file));
  if (!metadata.isFile()) throw new DevFlowError("INVALID_IMPLEMENTATION_FILE", "untracked implementation files must be regular files", { path: file });
}
async function untrackedFiles(root2, files) {
  if (!files.length) return /* @__PURE__ */ new Set();
  const output = await git(root2, ["ls-files", "--others", "--exclude-standard", "-z", "--", ...files]);
  return new Set(nulItems(output).map(normalizePath));
}
async function createDeliverySnapshot(root2, featureId, state, config) {
  const files = implementationFiles(state.steps.implementation?.evidence);
  assertImplementationFilesInProtectedRoots(files, config.protectedRoots);
  const baseline = state.deliveryBaseline;
  if (!baseline?.gitHead) {
    throw new DevFlowError("DELIVERY_SNAPSHOT_GIT_REQUIRED", "delivery snapshots require Git HEAD captured at feature start", {
      recoveryHint: "Start a new feature from a committed Git baseline before modifying protected files"
    });
  }
  const currentHead = (await git(root2, ["rev-parse", "HEAD"])).trim();
  if (currentHead !== baseline.gitHead) {
    throw new DevFlowError("DELIVERY_BASELINE_CHANGED", "Git HEAD changed after this feature started; delivery snapshot ownership is no longer reliable", {
      expectedHead: baseline.gitHead,
      currentHead,
      recoveryHint: "Start a new feature from the current committed HEAD, then reapply and verify the intended changes"
    });
  }
  const initialDirty = new Set(baseline.dirtyPaths);
  const claimedDirty = files.filter((file) => initialDirty.has(file));
  if (claimedDirty.length) {
    throw new DevFlowError("DELIVERY_FILE_PREEXISTING_DIRTY", "feature-owned files were already dirty when the feature started", {
      files: claimedDirty,
      recoveryHint: "Isolate the feature in a clean worktree or exclude the pre-existing changes before finalizing"
    });
  }
  const currentDirty = await dirtyPaths(root2, config.protectedRoots);
  const unexpected = currentDirty.filter((file) => !initialDirty.has(file) && !files.includes(file));
  if (unexpected.length) {
    throw new DevFlowError("DELIVERY_FILE_UNREGISTERED", "protected changes are not registered in implementation evidence", {
      files: unexpected,
      recoveryHint: "Add every feature-owned protected file to implementation evidence.files, then rerun verification and finalize"
    });
  }
  const changed = files.filter((file) => currentDirty.includes(file));
  const untracked = await untrackedFiles(root2, changed);
  const tracked = changed.filter((file) => !untracked.has(file));
  const patches = [];
  if (tracked.length) {
    patches.push(await git(root2, ["diff", "--binary", "--full-index", "--no-ext-diff", baseline.gitHead, "--", ...tracked]));
  }
  for (const file of [...untracked].sort()) {
    await assertPlainFile(root2, file);
    patches.push(await git(root2, ["diff", "--binary", "--no-index", "--", "/dev/null", file], true));
  }
  const relativeDirectory2 = path.posix.join(".dev-flow", "features", featureId);
  const patchFilename = "\u4EA4\u4ED8\u5FEB\u7167.patch";
  const manifestFilename = "\u4EA4\u4ED8\u5FEB\u7167\u6587\u6863.md";
  const patchPath = path.posix.join(relativeDirectory2, patchFilename);
  const manifestPath2 = path.posix.join(relativeDirectory2, manifestFilename);
  const patch = patches.filter(Boolean).join("\n");
  const patchHash = digest(patch);
  await writeFile(path.join(root2, patchPath), patch, "utf8");
  const rows = await Promise.all(files.map(async (file) => `| ${file} | ${currentDirty.includes(file) ? "changed" : "unchanged"} | ${await fileHash(root2, file)} |`));
  const manifest = [
    "# \u4EA4\u4ED8\u5FEB\u7167",
    "",
    `- Feature: ${featureId}`,
    `- Base Git HEAD: ${baseline.gitHead}`,
    `- Patch: ${patchFilename}`,
    `- Patch SHA-256: ${patchHash}`,
    "",
    "## \u5DF2\u767B\u8BB0\u6587\u4EF6",
    "",
    "| \u8DEF\u5F84 | \u72B6\u6001 | SHA-256 |",
    "| --- | --- | --- |",
    ...rows,
    "",
    "## \u56DE\u6EDA",
    "",
    `\u5728\u4ED3\u5E93\u6839\u76EE\u5F55\u6267\u884C\uFF1A\`git apply -R --binary ${patchPath}\``,
    ""
  ].join("\n");
  const manifestHash = digest(manifest);
  await writeFile(path.join(root2, manifestPath2), manifest, "utf8");
  return { manifestPath: manifestPath2, manifestSha256: manifestHash, patchPath, patchSha256: patchHash, baseHead: baseline.gitHead, files };
}

// plugins/dev-flow/src/core/fingerprint.ts
import { createHash as createHash2 } from "node:crypto";
import { readdir, readFile as readFile2, lstat as lstat2 } from "node:fs/promises";
import path2 from "node:path";
var ignored = /* @__PURE__ */ new Set([".git", ".dev-flow", "node_modules"]);
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
    const child = path2.join(relative, entry.name);
    const target = path2.join(root2, child);
    const metadata = await lstat2(target);
    if (metadata.isSymbolicLink()) throw new DevFlowError("UNSAFE_PROTECTED_ROOT", `symbolic link is not allowed: ${child}`);
    if (metadata.isDirectory()) await collect(root2, child, files);
    else if (metadata.isFile()) files.push(child);
  }
}
async function fingerprintProtectedRoots(root2, protectedRoots) {
  const files = [];
  for (const item of [...protectedRoots].sort()) await collect(root2, item, files);
  const digest10 = createHash2("sha256");
  for (const relative of files.sort()) {
    digest10.update(relative);
    digest10.update("\0");
    digest10.update(await readFile2(path2.join(root2, relative)));
    digest10.update("\0");
  }
  return digest10.digest("hex");
}
async function snapshotProtectedRoots(root2, protectedRoots) {
  const files = [];
  for (const item of [...protectedRoots].sort()) await collect(root2, item, files);
  const snapshots = [];
  for (const relative of files.sort()) {
    const absolute = path2.join(root2, relative);
    const metadata = await lstat2(absolute);
    snapshots.push({
      path: relative,
      sha256: createHash2("sha256").update(await readFile2(absolute)).digest("hex"),
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
  const slashPath = value.replaceAll("\\\\", "/");
  const normalized = path3.posix.normalize(slashPath).replace(/\/+$/u, "");
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
}

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
function pathWithinFileScope(path17, fileScope) {
  return fileScope.some((pattern) => scopePatternMatches(pattern, path17));
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
  const [head, ...rest] = pattern;
  if (head === "**") {
    if (rest.length === 0) return true;
    for (let skip = 0; skip <= target.length; skip += 1) {
      if (globSegmentsMatch(rest, target.slice(skip))) return true;
    }
    return false;
  }
  if (target.length === 0 || !globSegmentMatches(head, target[0])) return false;
  return globSegmentsMatch(rest, target.slice(1));
}
function globSegmentMatches(pattern, segment) {
  if (pattern === "") return segment === "";
  const [head, ...rest] = pattern;
  if (head === "*") {
    for (let take = 0; take <= segment.length; take += 1) {
      if (globSegmentMatches(rest.join(""), segment.slice(take))) return true;
    }
    return false;
  }
  if (head === "?") return segment.length > 0 && globSegmentMatches(rest.join(""), segment.slice(1));
  return segment.startsWith(head) && globSegmentMatches(rest.join(""), segment.slice(head.length));
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
function hasOnlyKeys(value, keys) {
  return Object.keys(value).every((key) => keys.includes(key));
}
function implementationUnitForRollbackNode(node, basisHash2) {
  if (!isRecord(node) || node.kind !== "rollback" || !isRollbackId(node.id) || !isNonEmptyStringArray(node.tasks) || !isNonEmptyStringArray(node.fileScope) || !isNonEmptyStringArray(node.forwardVerification) || !isNonEmptyStringArray(node.rollbackVerification) || node.status !== "current") {
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
  if (!isRecord(value) || !hasOnlyKeys(value, ["attemptId", "commandId", "command", "status", "startedAt", "completedAt"]) || !isNonEmptyString(value.attemptId) || !isNonEmptyString(value.commandId) || !isNonEmptyString(value.command) || value.status !== "passed" && value.status !== "failed" || !isTimestamp(value.startedAt) || !isTimestamp(value.completedAt)) {
    invalid(`checkpoint verification attempt ${index} has an invalid shape`);
  }
  return {
    attemptId: value.attemptId,
    commandId: value.commandId,
    command: value.command,
    status: value.status,
    startedAt: value.startedAt,
    completedAt: value.completedAt
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

// plugins/dev-flow/src/core/traceability.ts
var ALLOWED_TRACE_KINDS = {
  requirements: ["requirement", "acceptance-criterion"],
  "implementation-plan": ["task", "rollback"],
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
      if (!isStringArray(value[field], allowEmpty)) invalid2("rollback relationship must be a string array", { field, id: value.id });
      assertNoDuplicate(value[field], field, value.id);
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
        forwardVerification: [...node.forwardVerification],
        rollbackVerification: [...node.rollbackVerification],
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
  if (input.artifactKind === "implementation-plan" && input.route === "standard-l" && has("rollback")) {
    invalid2("standard L implementation plans cannot declare rollback units");
  }
  if (input.artifactKind === "rollback-units" && input.route !== "standard-l") invalid2("rollback-units are only valid for standard L");
  for (const node of input.delta.nodes) {
    if (node.kind !== "rollback") continue;
    if (!["implementation-plan", "rollback-units"].includes(input.artifactKind)) invalid2("rollback node has an invalid source artifact");
    if (node.forwardVerification.some((id) => !input.verificationCommandIds.includes(id)) || node.rollbackVerification.some((id) => !input.verificationCommandIds.includes(id))) {
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
      if (!isStringArray(value[field], allowEmpty)) invalid2("persisted rollback field is invalid", { id: recordId, field });
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
  validateTraceDelta(input.delta);
  assertArtifactDeltaContract(input);
  const sourceBlocks = assertSourceBlocks(input);
  const nodes = structuredClone(input.current.nodes);
  const changed = /* @__PURE__ */ new Set();
  for (const node of input.delta.nodes) {
    const previous = nodes[node.id];
    if (previous?.status === "tombstoned") invalid2("tombstoned IDs cannot be reused", { id: node.id });
    const next = sourceFor(input, node, sourceBlocks.get(node.id));
    if (previous && previous.sourceArtifact !== input.artifactKind) invalid2("node ID already belongs to a different source artifact", { id: node.id });
    if (previous && (previous.sourceBlockSha256 !== next.sourceBlockSha256 || nodeMeaning(previous) !== inputMeaning(node))) changed.add(node.id);
    nodes[node.id] = next;
  }
  const inputIds = new Set(input.delta.nodes.map((node) => node.id));
  for (const node of Object.values(nodes)) {
    if (node.sourceArtifact !== input.artifactKind || inputIds.has(node.id) || node.status === "tombstoned") continue;
    node.status = "tombstoned";
    changed.add(node.id);
  }
  downstream(nodes, changed, inputIds);
  const ledger = {
    schemaVersion: 1,
    featureId: input.current.featureId,
    revision: input.current.revision + 1,
    stateRevision: input.nextStateRevision,
    projectConfigSha256: input.projectConfigSha256,
    nodes,
    edges: deriveTraceEdges(nodes),
    summary: traceSummary(nodes)
  };
  validateTraceGraph(ledger, input.route, "partial");
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
  const completeSteps = /* @__PURE__ */ new Set(["plan_review", "implementation_approval", "implementation", "feature_check", "finalize"]);
  if (completeSteps.has(step)) return assertTraceabilityComplete(ledger, route, currentProjectConfigSha256);
  const requirements = ["requirement", "acceptance-criterion"];
  if (["requirements", "requirement_confirmation"].includes(step)) {
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
  return routeDefinitionForFeature(state.route, state.workflowCapabilities).orderedSteps.find((step) => state.steps[step]?.status !== "satisfied");
}
function assertCurrentStep(state, step) {
  if (currentOpenStep(state) !== step) throw new DevFlowError("STEP_OUT_OF_ORDER", `${step} is not the current route step`, { expected: currentOpenStep(state) });
}
function artifactsRequiredBeforeGate(state, gate) {
  const definition = routeDefinitionForFeature(state.route, state.workflowCapabilities);
  const index = definition.orderedSteps.indexOf(gate);
  const required = [...new Set(definition.orderedSteps.slice(0, index).flatMap((step) => [
    ...definition.artifactSteps?.[step] ?? [],
    ...definition.generatedArtifactSteps?.[step] ?? []
  ]))];
  return required;
}

// plugins/dev-flow/src/core/traceability-store.ts
import { createHash as createHash3, randomUUID } from "node:crypto";
import { mkdir, open, readFile as readFile3, readdir as readdir2, rename } from "node:fs/promises";
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
function digest2(contents) {
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
  const sha256 = digest2(contents);
  const directory = snapshotDirectory(root2, ledger.featureId);
  const target = path4.join(directory, `${sha256}.json`);
  await mkdir(directory, { recursive: true });
  try {
    const existing = await readFile3(target, "utf8");
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
  const file = path4.join(root2, ".dev-flow", "features", state.featureId, relative);
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
    raw = await readFile3(file, "utf8");
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
  return { config, sha256: digest2(raw) };
}

// plugins/dev-flow/src/core/traceability-gates.ts
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
  let ledger;
  try {
    ledger = await readTraceability(root2, state);
    const { sha256 } = await readProjectConfigSnapshot(root2);
    assertTraceSliceCurrent(ledger, state.route, step, sha256);
    return { enforced: true, ledger, effectiveSummary: ledger.summary };
  } catch (error) {
    return {
      enforced: true,
      ...ledger ? { ledger, effectiveSummary: ledger.summary } : {},
      blocker: blockerFor(step, error)
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
import { mkdir as mkdir2, open as open2, readFile as readFile4, readdir as readdir3, rename as rename2 } from "node:fs/promises";
import path5 from "node:path";

// plugins/dev-flow/src/policy/review.ts
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
  if (!isRecord3(value) || Object.keys(value).some((key) => !["host", "agentId", "issuedAt", "raw"].includes(key)) || value.host !== "claude" && value.host !== "codex" || typeof value.agentId !== "string" || !value.agentId.trim() || typeof value.issuedAt !== "string" || !value.issuedAt.trim() || Number.isNaN(Date.parse(value.issuedAt)) || typeof value.raw !== "string" || !value.raw.trim()) {
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
  if (!isRecord3(value) || Object.keys(value).some((key) => key !== "findingId" && key !== "evidence" && key !== "note") || typeof value.findingId !== "string" || !value.findingId || typeof value.note !== "string" || !value.note.trim()) {
    protocolInvalid(`review resolution ${index} has an invalid shape`);
  }
  return { findingId: value.findingId, evidence: parseEvidence(value.evidence, `review resolution ${index}`), note: value.note };
}
function deriveReviewJobRequirements(route, riskLabels) {
  if (route !== "standard-m" && route !== "standard-l") return [];
  const roles = ["requirements-coverage", "architecture-testability"];
  if (route === "standard-l") roles.push("rollback-operability");
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
var digest3 = (contents) => createHash4("sha256").update(contents).digest("hex");
function emptyReviewLedger(featureId, stateRevision) {
  return { schemaVersion: 1, featureId, revision: 0, stateRevision, batches: [], summary: emptySummary() };
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
  return isRecord4(value) && (value.host === "claude" || value.host === "codex") && typeof value.agentId === "string" && value.agentId.trim().length > 0 && typeof value.issuedAt === "string" && !Number.isNaN(Date.parse(value.issuedAt)) && typeof value.raw === "string" && value.raw.trim().length > 0 && validHash(value.rawSha256) && typeof value.acceptedAt === "string" && digest3(value.raw) === value.rawSha256;
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
    if (batchIds.has(batch.batchId) || batch.basis.featureId !== ledger.featureId || digest3(canonicalReviewValueJson(batch.basis)) !== batch.basisHash || batch.progress === "complete" !== batch.jobs.every((job) => job.status === "submitted")) {
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
  const target = path5.join(directory, `${sha256}.json`);
  await mkdir2(directory, { recursive: true });
  try {
    const existing = await readFile4(target, "utf8");
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
  const target = path5.join(directory, `${sha256}.json`);
  await mkdir2(directory, { recursive: true });
  try {
    const existing = await readFile4(target, "utf8");
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
    contents = await readFile4(path5.join(packageDirectory(root2, featureId), `${sha256}.json`), "utf8");
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
    contents = await readFile4(path5.join(root2, ".dev-flow", "features", state.featureId, relative), "utf8");
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
import { mkdir as mkdir3, open as open3, readFile as readFile5, rename as rename3 } from "node:fs/promises";
import path6 from "node:path";
var digest4 = (contents) => createHash5("sha256").update(contents).digest("hex");
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
function allDispositions(ledger) {
  return Object.assign({}, ...ledger.batches.map((batch) => batch.dispositions ?? {}));
}
function unresolvedBlockingFindingIds(ledger) {
  const dispositions = allDispositions(ledger);
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
  const sha256 = digest4(markdown);
  const directory = projectionDirectory(root2, featureId);
  const target = path6.join(directory, `${sha256}.md`);
  await mkdir3(directory, { recursive: true });
  try {
    const existing = await readFile5(target, "utf8");
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
      if (await readFile5(target, "utf8") !== markdown) projectionError("concurrent review projection does not match its content address");
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
    markdown = await readFile5(path6.join(root2, ".dev-flow", "features", state.featureId, artifact.path), "utf8");
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
  if (state?.schemaVersion !== 1) throw new DevFlowError("UNSUPPORTED_STATE_SCHEMA", "only state schema v1 is supported");
  if (typeof state.featureId !== "string" || !state.featureId || !Number.isInteger(state.revision) || (state.revision ?? -1) < 0 || !lifecycles.has(state.lifecycle) || !routeDefinition(state.route) || !state.classification || !state.scope || !Array.isArray(state.scope.inScope) || !Array.isArray(state.scope.outOfScope) || !state.steps || !state.humanGates || !state.artifacts || !state.verification || !Array.isArray(state.verification.attempts) || state.interactions !== void 0 && (typeof state.interactions !== "object" || state.interactions === null || Array.isArray(state.interactions)) || !state.featureCheck || !Array.isArray(state.blockingFindings) || typeof state.logicComplete !== "boolean" || !state.lastUpdatedBy) {
    throw new DevFlowError("INVALID_STATE_SCHEMA", "state is not a valid v1 feature state");
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
  return { inScope: value.inScope, outOfScope: value.outOfScope };
}
var delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
var devFlow = (root2) => path7.join(root2, ".dev-flow");
var features = (root2) => path7.join(devFlow(root2), "features");
var statePath = (root2, id) => path7.join(features(root2), id, "state.json");
var eventPath = (root2, id) => path7.join(features(root2), id, "events.jsonl");
var activePath = (root2) => path7.join(devFlow(root2), "active.json");
var recoveryTxnPath = (root2) => path7.join(devFlow(root2), "recovery-transaction.json");
var recoveryEventsPath = (root2) => path7.join(devFlow(root2), "recovery-events.jsonl");
var rollbackTxnPath = (root2, featureId) => path7.join(features(root2), featureId, "rollback-transaction.json");
async function readProjectConfig(root2) {
  try {
    const value = JSON.parse(await readFile6(path7.join(devFlow(root2), "project.json"), "utf8"));
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
  await writeAtomic(path7.join(devFlow(root2), "project.json"), config);
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
  const directory = await open4(path7.dirname(file), "r");
  try {
    await directory.sync();
  } finally {
    await directory.close();
  }
}
async function prepareStatusProjection(root2, state, revision) {
  const status = state.artifacts.status;
  if (!status) return;
  const trace = await inspectCurrentTrace(root2, state);
  const summary = trace.effectiveSummary;
  const traceLines = [
    "## Trace",
    "",
    `- Enforced: ${trace.enforced}`,
    ...state.traceability ? [`- Pointer: ${state.traceability.path}`] : [],
    ...summary ? [`- Summary: total=${summary.total} current=${summary.current} stale=${summary.stale} tombstoned=${summary.tombstoned}`] : [],
    ...trace.blocker ? [`- Blocker: ${trace.blocker.code} (${trace.blocker.step})`] : [],
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
  const file = path7.join(features(root2), state.featureId, status.path);
  state.artifacts.status = { ...status, sha256: createHash6("sha256").update(contents).digest("hex") };
  return async () => {
    await writeFile2(file, contents);
  };
}
async function lock(root2, featureId, operation) {
  const directory = path7.join(devFlow(root2), ".lock");
  const started = Date.now();
  await mkdir4(devFlow(root2), { recursive: true });
  while (true) {
    try {
      await mkdir4(directory);
      await writeFile2(path7.join(directory, "owner.json"), JSON.stringify({ pid: process.pid, hostname: hostname(), acquiredAt: (/* @__PURE__ */ new Date()).toISOString(), featureId, operation }));
      return async () => {
        await rm(directory, { recursive: true, force: true });
      };
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
      try {
        const owner = JSON.parse(await readFile6(path7.join(directory, "owner.json"), "utf8"));
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
  return createHash6("sha256").update(contents).digest("hex");
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
    if (lifecycle === "active" && active) throw new DevFlowError("ACTIVE_FEATURE_CONFLICT", "an active feature already exists");
    const { classification, route } = selectRoute(input);
    const project = await readProjectConfig(root2);
    const startBusinessFingerprint = await fingerprintProtectedRoots(root2, project.protectedRoots);
    const deliveryBaseline = await captureDeliveryBaseline(root2, project.protectedRoots);
    const directory = path7.join(features(root2), id);
    const existedBefore = await pathExists(directory);
    let stateCommitted = false;
    try {
      await mkdir4(directory, { recursive: true });
      const workflowCapabilities = normalizeWorkflowCapabilities(SUPPORTED_WORKFLOW_CAPABILITIES);
      const state = {
        schemaVersion: 1,
        featureId: id,
        revision: 0,
        lifecycle,
        route,
        classification,
        scope,
        steps: {},
        humanGates: {},
        artifacts: {},
        verification: { attempts: [] },
        interactions: {},
        workflowCapabilities,
        featureCheck: {},
        startBusinessFingerprint,
        deliveryBaseline,
        blockingFindings: [],
        logicComplete: false,
        lastUpdatedBy: { host: input.host, pluginVersion: "1.7.0" }
      };
      if (traceEnforcementRequired(route, workflowCapabilities)) {
        const configSnapshot = await readProjectConfigSnapshot(root2);
        state.traceability = await writeTraceSnapshot(
          root2,
          emptyTraceabilityLedger(id, 0, configSnapshot.sha256),
          options.snapshotFault ? { fault: options.snapshotFault } : {}
        );
      }
      if (reviewEnforcementRequired(route, workflowCapabilities)) {
        state.review = await writeReviewSnapshot(root2, emptyReviewLedger(id, 0));
        await prepareReviewProjection(root2, state);
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
        await appendEvent(root2, id, state.revision, "started", { lifecycle, route });
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
    if (active?.featureId === id && (state.lifecycle === "finalized" || state.lifecycle === "abandoned")) await rm(activePath(root2), { force: true });
    else if (active?.featureId === id) await writeAtomic(activePath(root2), { featureId: id, revision: state.revision, updatedAt: (/* @__PURE__ */ new Date()).toISOString() });
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
async function switchActive(root2, from, to, reason) {
  if (!reason) throw new DevFlowError("SWITCH_REASON_REQUIRED", "switch requires a reason");
  const release = await lock(root2, `${from}:${to}`, "switch-active");
  try {
    await assertNoOpenRollbackTransaction(root2);
    const active = await readActive(root2);
    if (active?.featureId !== from) throw new DevFlowError("ACTIVE_FEATURE_CONFLICT", "source is not active");
    const source = await readState(root2, from), target = await readState(root2, to);
    if (target.lifecycle !== "paused") throw new DevFlowError("INVALID_LIFECYCLE", "target must be paused");
    source.lifecycle = "paused";
    source.revision++;
    target.lifecycle = "active";
    target.revision++;
    await writeAtomic(statePath(root2, from), source);
    await writeAtomic(statePath(root2, to), target);
    await appendEvent(root2, from, source.revision, "paused", { reason });
    await appendEvent(root2, to, target.revision, "activated", { reason });
    await writeAtomic(activePath(root2), { featureId: to, revision: target.revision, updatedAt: (/* @__PURE__ */ new Date()).toISOString() });
  } finally {
    await release();
  }
}
async function abandonFeature(root2, id, expectedRevision, reason, userEvidence) {
  if (!reason || !userEvidence) throw new DevFlowError("ABANDON_EVIDENCE_REQUIRED", "abandon requires reason and user evidence");
  return mutate(root2, id, expectedRevision, "abandoned", async (state) => {
    if (state.lifecycle === "finalized" || state.lifecycle === "abandoned") throw new DevFlowError("INVALID_LIFECYCLE", "terminal feature cannot be abandoned");
    state.lifecycle = "abandoned";
  }, { reason, userEvidence });
}
function isRecoveryPhase(value) {
  return value === "prepared" || value === "directory-moved" || value === "active-cleared" || value === "completed";
}
function validateRecoveryTransaction(value) {
  const transaction = value;
  if (transaction?.schemaVersion !== 1 || typeof transaction.transactionId !== "string" || !transaction.transactionId || !isRecoveryPhase(transaction.phase) || typeof transaction.featureId !== "string" || !transaction.featureId || typeof transaction.stateSha256 !== "string" || !transaction.stateSha256 || typeof transaction.recoveredTo !== "string" || !path7.isAbsolute(transaction.recoveredTo) || typeof transaction.reason !== "string" || typeof transaction.userEvidence !== "string" || transaction.host !== "claude" && transaction.host !== "codex" || typeof transaction.at !== "string" || transaction.activeSha256 !== void 0 && typeof transaction.activeSha256 !== "string") {
    throw new DevFlowError("RECOVERY_TRANSACTION_UNREADABLE", "recovery journal is invalid", {
      recoveryHint: "Run dev_flow_doctor; do not start a new feature or hand-edit .dev-flow"
    });
  }
  if (path7.basename(transaction.featureId) !== transaction.featureId || transaction.featureId === "." || transaction.featureId === "..") {
    throw new DevFlowError("RECOVERY_TRANSACTION_UNREADABLE", "recovery journal has an unsafe feature id", { recoveryHint: "Run dev_flow_doctor; recovery remains fail-closed" });
  }
}
function validateRecoveryLocation(root2, transaction) {
  const recoveredRoot = path7.join(devFlow(root2), "recovered");
  const relative = path7.relative(recoveredRoot, transaction.recoveredTo);
  if (!relative || relative.startsWith("..") || path7.isAbsolute(relative) || path7.basename(relative) !== relative) {
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
  return createHash6("sha256").update(await readFile6(file)).digest("hex");
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
  const sourceDir = path7.join(features(root2), transaction.featureId);
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
        await rename4(activePath(root2), path7.join(transaction.recoveredTo, "active.json"));
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
  return path7.join(features(root2), featureId, "checkpoints", "recovery", `${transactionId}-drive-lease.json`);
}
function legacyDriveLeasePath(root2, featureId, transactionId) {
  return path7.join(features(root2), featureId, "checkpoints", "recovery", transactionId, "drive-lease.json");
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
  await mkdir4(path7.dirname(legacyFile), { recursive: true });
  await mkdir4(path7.dirname(sidecarFile), { recursive: true });
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
      await rmdir(path7.dirname(legacyFile));
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
  if (path7.basename(input.featureId) !== input.featureId || input.featureId === "." || input.featureId === "..") throw new DevFlowError("INVALID_FEATURE_ID", "recovery featureId must name one feature directory");
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
    const recoveredDir = path7.join(devFlow(root2), "recovered", `${input.featureId}-${timestamp}`);
    await mkdir4(path7.join(devFlow(root2), "recovered"), { recursive: true });
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
    if (["requirement_confirmation", "implementation_approval", "feature_check", "finalize", "verification"].includes(step)) break;
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
    if (event.type !== "gate-presented" && event.type !== "gate-confirmed") continue;
    const gate = event.data?.gate;
    if (typeof gate !== "string") {
      throw new DevFlowError("RECLASSIFICATION_HISTORY_UNREADABLE", "a historical gate event has no gate identity", {
        recoveryHint: "Finish the current standard route or abandon and restart; old ambiguous gate history cannot downgrade"
      });
    }
    if (gate === "implementation_approval") return true;
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
    const currentFingerprint = await fingerprintProtectedRoots(root2, project.protectedRoots);
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
        const approval = draft.humanGates.implementation_approval;
        if (historicalApproval || approval?.status === "pending" || approval?.status === "returned" || approval?.status === "confirmed") {
          throw new DevFlowError("RECLASSIFICATION_DOWNGRADE_FORBIDDEN", "implementation_approval already presented or confirmed", {
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
import { createHash as createHash7 } from "node:crypto";
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
      sourceBlockSha256: createHash7("sha256").update(sourceBlock, "utf8").digest("hex")
    };
  });
}

// plugins/dev-flow/src/core/user-interactions.ts
import { randomBytes, randomUUID as randomUUID5 } from "node:crypto";
function interactions(state) {
  if (!state.interactions) state.interactions = {};
  return state.interactions;
}
function validateOptions(options) {
  if (!Array.isArray(options) || options.length < 2 || options.length > 8) {
    throw new DevFlowError("INTERACTION_OPTIONS_INVALID", "an interaction requires 2-8 options");
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
    fallbackToken: `DF-${randomBytes(9).toString("base64url").toUpperCase()}`,
    presentedAt: (/* @__PURE__ */ new Date()).toISOString(),
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
}
function clearInteractionsByKind(state, kind) {
  if (!state.interactions) return;
  for (const [id, value] of Object.entries(state.interactions)) {
    if (value.kind === kind) delete state.interactions[id];
  }
}
function optionFor(interaction, action) {
  const option = interaction.options.find((candidate) => candidate.id === action);
  if (!option) throw new DevFlowError("INTERACTION_ACTION_INVALID", action, { interactionId: interaction.id });
  return option;
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
  return response;
}
function resolveTokenInteraction(state, interactionId, userReply, host, promptEventId) {
  const interaction = getInteraction(state, interactionId);
  if (interaction.status !== "pending") throw new DevFlowError("INTERACTION_ALREADY_RESOLVED", interactionId);
  let match;
  for (const option of interaction.options) {
    const prefix = `${interaction.fallbackToken} ${option.id}`;
    if (option.requiresComment) {
      if (userReply === prefix) match = { option };
      else if (userReply.startsWith(`${prefix} `)) match = { option, comment: userReply.slice(prefix.length).trim() };
    } else if (userReply === prefix) {
      match = { option };
    }
    if (match) break;
  }
  if (!match) {
    throw new DevFlowError("INTERACTION_TOKEN_MISMATCH", "response does not match the current one-time interaction token", {
      recoveryHint: `Use the exact reply shown for interaction ${interactionId}`
    });
  }
  const normalizedComment = validateComment(match.option, match.comment);
  const response = {
    action: match.option.id,
    ...normalizedComment ? { comment: normalizedComment } : {},
    source: "text-token",
    promptEventId,
    userReply,
    host,
    respondedAt: (/* @__PURE__ */ new Date()).toISOString()
  };
  interaction.status = "resolved";
  interaction.response = response;
  return response;
}
function toPublicInteraction(interaction) {
  return {
    id: interaction.id,
    kind: interaction.kind,
    status: interaction.status,
    ...interaction.question ? { question: interaction.question } : {},
    options: interaction.options.map((option) => ({ ...option })),
    fallback: {
      token: interaction.fallbackToken,
      replies: interaction.options.map((option) => ({
        action: option.id,
        reply: `${interaction.fallbackToken} ${option.id}${option.requiresComment ? " <\u4FEE\u6539\u610F\u89C1>" : ""}`,
        requiresComment: Boolean(option.requiresComment)
      }))
    }
  };
}
function fallbackHint(interaction) {
  const replies = toPublicInteraction(interaction).fallback.replies;
  return interaction.options.map((option) => {
    const reply = replies.find((candidate) => candidate.action === option.id);
    return `${option.label}: ${reply.reply}`;
  }).join("\uFF1B");
}

// plugins/dev-flow/src/core/artifacts.ts
var names = {
  status: "\u72B6\u6001\u6587\u6863.md",
  "risk-card": "\u98CE\u9669\u6587\u6863.md",
  requirements: "\u9700\u6C42\u6587\u6863.md",
  "implementation-plan": "\u8BA1\u5212\u6587\u6863.md",
  "coverage-matrix": "\u8986\u76D6\u77E9\u9635\u6587\u6863.md",
  "boundary-card": "\u8FB9\u754C\u6587\u6863.md",
  "rollback-safety": "\u56DE\u6EDA\u5B89\u5168\u6587\u6863.md",
  verification: "\u9A8C\u8BC1\u6587\u6863.md",
  "rollback-units": "\u56DE\u6EDA\u5355\u5143\u6587\u6863.md",
  "plan-review": "\u8BA1\u5212\u5BA1\u6838\u6587\u6863.md",
  "code-review": "\u4EE3\u7801\u5BA1\u6838\u6587\u6863.md"
};
var hash = (value) => createHash8("sha256").update(value).digest("hex");
var featureDirectory = (root2, id) => path8.join(root2, ".dev-flow", "features", id);
var traceArtifactKinds = /* @__PURE__ */ new Set(["requirements", "implementation-plan", "coverage-matrix", "rollback-units"]);
var traceArtifactKindList = /* @__PURE__ */ new Set(["requirements", "implementation-plan", "coverage-matrix", "rollback-units"]);
var artifactInvalidations = {
  requirements: { gates: ["requirement_confirmation", "implementation_approval"], afterStep: "requirements" },
  "implementation-plan": { gates: ["implementation_approval"], afterStep: "implementation_plan" },
  "coverage-matrix": { gates: ["implementation_approval"], afterStep: "coverage_review" },
  "rollback-units": { gates: ["implementation_approval"], afterStep: "rollback_unit" },
  "risk-card": { gates: ["implementation_approval"] },
  "boundary-card": { gates: ["implementation_approval"] },
  "rollback-safety": { gates: ["implementation_approval"] }
};
function template(state, id, kind) {
  if (traceArtifactKinds.has(kind)) {
    return renderArtifactTemplate({ featureId: id, route: state.route, requirementsState: state.classification.requirements }, kind);
  }
  return `---
dev_flow:
  schema_version: 1
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
function invalidateArtifactDependents(state, kind, reason) {
  const rule = artifactInvalidations[kind] ?? { gates: gatesInvalidatedByArtifact(kind) };
  for (const gate of /* @__PURE__ */ new Set([...rule.gates, ...gatesInvalidatedByArtifact(kind)])) {
    delete state.humanGates[gate];
    delete state.steps[gate];
    clearInteractionsForTarget(state, `gate:${gate}`);
  }
  if (rule.afterStep) {
    const ordered = effectiveRoute(state).orderedSteps;
    const sourceIndex = ordered.indexOf(rule.afterStep);
    for (const step of ordered.slice(sourceIndex + 1)) {
      delete state.steps[step];
      clearInteractionsForTarget(state, `gate:${step}`);
    }
  }
  if (kind === "requirements") clearInteractionsByKind(state, "grill");
  state.featureCheck = {};
  delete state.steps.feature_check;
  state.logicComplete = false;
  delete state.steps.finalize;
  void reason;
}
async function assertArtifactCurrent(root2, id, state, kind) {
  const artifact = state.artifacts[kind];
  if (!artifact) throw new DevFlowError("MISSING_REQUIRED_ARTIFACT", kind);
  const contents = await readFile7(path8.join(featureDirectory(root2, id), artifact.path), "utf8");
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
  const filename = names[kind];
  if (!filename) throw new DevFlowError("INVALID_ARTIFACT", "unknown artifact kind");
  const target = path8.join(featureDirectory(root2, id), filename);
  const content = template(state, id, kind);
  await writeFile3(target, content, { flag: "wx" }).catch(async (error) => {
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
  const artifact = state.artifacts[kind];
  if (!artifact) throw new DevFlowError("MISSING_REQUIRED_ARTIFACT", kind);
  const contents = await readFile7(path8.join(featureDirectory(root2, id), artifact.path), "utf8");
  const checksum = hash(contents);
  return mutate(root2, id, expectedRevision, "artifact-recorded", (current) => {
    current.artifacts[kind] = { ...artifact, sha256: checksum };
    invalidateArtifactDependents(current, kind, "artifact-changed");
  }, { kind, invalidationReason: "artifact-changed" });
}
async function recordArtifactWithTrace(root2, id, expectedRevision, artifactKind, traceDelta, options = {}) {
  if (!traceArtifactKindList.has(artifactKind)) throw new DevFlowError("INVALID_ARTIFACT", artifactKind);
  let eventData = { kind: artifactKind };
  return mutatePrepared(root2, id, expectedRevision, "artifact-recorded-with-trace", async (current, nextStateRevision) => {
    if (current.lifecycle !== "active") throw new DevFlowError("INVALID_LIFECYCLE", "only active features can register artifacts");
    assertManualRegistrationAllowed(current, artifactKind, true);
    const artifact = current.artifacts[artifactKind];
    if (!artifact) throw new DevFlowError("MISSING_REQUIRED_ARTIFACT", artifactKind);
    const contents = await readFile7(path8.join(featureDirectory(root2, id), artifact.path), "utf8");
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
    const pointer = await writeTraceSnapshot(root2, ledger, options.snapshot);
    const artifactChanged = artifact.sha256 !== artifactSha256;
    const traceChanged = JSON.stringify(currentLedger.nodes) !== JSON.stringify(ledger.nodes) || JSON.stringify(currentLedger.edges) !== JSON.stringify(ledger.edges);
    const reviewPointer = artifactChanged || traceChanged ? await prepareReviewInvalidation(root2, current, nextStateRevision) : void 0;
    eventData = {
      kind: artifactKind,
      artifactChanged,
      traceChanged,
      invalidationReason: artifactChanged ? "artifact-changed" : traceChanged ? "trace-changed" : void 0
    };
    return {
      mutate: (draft) => {
        draft.artifacts[artifactKind] = { ...artifact, sha256: artifactSha256 };
        draft.traceability = pointer;
        if (reviewPointer) draft.review = reviewPointer;
        if (artifactChanged || traceChanged) {
          invalidateArtifactDependents(draft, artifactKind, artifactChanged ? "artifact-changed" : "trace-changed");
        }
      },
      eventData: () => eventData
    };
  }, options.mutation);
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
  if (step === "plan_review") {
    const effectiveRoute2 = routeDefinitionForFeature(route, workflowCapabilities);
    if (effectiveRoute2.generatedArtifacts?.includes("plan-review")) required.fields.reviewBatch = true;
    else required.fields.reviewType = "plan";
  }
  if (step === "code_review") required.fields.reviewType = "code";
  if (step === "code_review" && risk.checks.includes("full-code-review")) {
    required.fields.reviewDepth = "full";
  }
  if (risk.checks.includes("security")) {
    const target = orderedSteps.includes("risk_controls") ? "risk_controls" : "code_review";
    if (step === target) addChecks(required.checks, ["security"]);
  }
  const rollbackChecks = risk.checks.filter((check) => check === "rollback" || check === "full-rollback");
  if (rollbackChecks.length) {
    const target = orderedSteps.includes("risk_controls") ? "risk_controls" : orderedSteps.includes("rollback_safety") ? "rollback_safety" : "rollback_unit";
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
  const suppliedChecks = Array.isArray(supplied.checks) ? supplied.checks.filter((value) => typeof value === "string") : [];
  missing.checks = required.checks.filter((check) => !suppliedChecks.includes(check));
  const kinds = Array.isArray(supplied.kinds) ? supplied.kinds.filter((value) => typeof value === "string") : [];
  missing.verificationKinds = required.verificationKinds.filter((kind) => !kinds.includes(kind));
  return missing;
}

// plugins/dev-flow/src/core/requirements-grill.ts
var statuses = ["not_required", "pending", "in_progress", "complete"];
function allowedStatuses(state) {
  return state.classification.requirements === "provided-confirmed" ? ["not_required", "complete"] : ["complete"];
}
function invalidStatus(details) {
  throw new DevFlowError("GRILL_STATUS_INVALID", "requirements grill_status must be a supported enum", {
    allowed: statuses,
    recoveryHint: "Set grill_status to a supported value and re-record the requirements artifact",
    ...details
  });
}
function parseNestedDevFlow(contents) {
  const frontMatter2 = contents.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/)?.[1];
  if (!frontMatter2) invalidStatus({ reason: "MISSING_FRONT_MATTER" });
  const lines = frontMatter2.split(/\r?\n/);
  const devFlowIndexes = lines.map((line, index) => line === "dev_flow:" ? index : -1).filter((index) => index >= 0);
  if (devFlowIndexes.length !== 1) invalidStatus({ reason: "MISSING_OR_DUPLICATE_DEV_FLOW" });
  const fields = {};
  for (const line of lines.slice(devFlowIndexes[0] + 1)) {
    if (!line.startsWith("  ")) break;
    const match = line.match(/^  ([A-Za-z0-9_]+):\s*(.*)$/);
    if (!match) continue;
    const key = match[1];
    let value = match[2].trim();
    if (value.startsWith('"') && value.endsWith('"') || value.startsWith("'") && value.endsWith("'")) {
      value = value.slice(1, -1);
    }
    if (fields[key] !== void 0) invalidStatus({ reason: "DUPLICATE_FIELD", field: key });
    fields[key] = value;
  }
  return fields;
}
function readStatus(fields) {
  const status = fields.grill_status;
  if (!status || !statuses.includes(status)) invalidStatus({ actual: status, reason: "MISSING_OR_INVALID_GRILL_STATUS" });
  return status;
}
function parseGrillFrontMatter(contents) {
  const fields = parseNestedDevFlow(contents);
  const status = readStatus(fields);
  const result = { status };
  if (fields.grill_question_id) result.questionId = fields.grill_question_id;
  if (fields.grill_response_hint) result.responseHint = fields.grill_response_hint;
  if (status === "in_progress" && (!result.questionId || !result.responseHint)) {
    throw new DevFlowError("GRILL_STATUS_INVALID", "in_progress grill requires grill_question_id and grill_response_hint", {
      recoveryHint: "Set the current Q-id and response hint, record the requirements artifact, then ask the user"
    });
  }
  if (status === "complete" || status === "not_required") {
    if (result.questionId || result.responseHint) {
      throw new DevFlowError("GRILL_STATUS_INVALID", "complete/not_required grill must not retain current-question fields", {
        recoveryHint: "Clear grill_question_id and grill_response_hint when grill is finished"
      });
    }
  }
  return result;
}
async function currentGrillQuestion(root2, id, state) {
  if (!state.artifacts.requirements) throw new DevFlowError("MISSING_REQUIRED_ARTIFACT", "requirements");
  const grill = parseGrillFrontMatter(await assertArtifactCurrent(root2, id, state, "requirements"));
  if (grill.status !== "in_progress" || !grill.questionId) {
    throw new DevFlowError("GRILL_DECISION_NOT_PENDING", "there is no current grill question");
  }
  return grill;
}
async function requestGrillDecision(root2, id, expectedRevision, input) {
  if (!input.question.trim()) throw new DevFlowError("GRILL_QUESTION_REQUIRED", "question is required");
  const initial = await readState(root2, id);
  if (initial.revision !== expectedRevision) {
    throw new DevFlowError("STATE_REVISION_CONFLICT", "state revision changed", { currentRevision: initial.revision });
  }
  const grill = await currentGrillQuestion(root2, id, initial);
  if (grill.questionId !== input.questionId) {
    throw new DevFlowError("GRILL_QUESTION_MISMATCH", input.questionId, { expectedQuestionId: grill.questionId });
  }
  const target = `grill:${input.questionId}`;
  const existing = findInteractionForTarget(initial, target);
  if (existing) return { state: initial, interaction: toPublicInteraction(existing) };
  let interaction;
  const state = await mutate(root2, id, expectedRevision, "grill-decision-presented", (draft) => {
    interaction = createInteraction(draft, {
      kind: "grill",
      target,
      basisHash: draft.artifacts.requirements.sha256,
      question: input.question,
      options: input.options
    });
    draft.lastUpdatedBy = { host: input.host, pluginVersion: "1.7.0" };
  }, () => ({ questionId: input.questionId, interactionId: interaction?.id, options: input.options }));
  if (!interaction) throw new DevFlowError("INTERACTION_NOT_CREATED", target);
  return { state, interaction: toPublicInteraction(interaction) };
}
function resolveGrillTextPrompt(events, interactionId, userReply, promptEventId) {
  const matches = (item) => {
    const event2 = item.data;
    return item.type === "host-event" && event2.type === "user-prompt" && event2.text === userReply && typeof event2.eventId === "string";
  };
  const selected = promptEventId ? events.find((item) => matches(item) && item.data.eventId === promptEventId) : [...events].reverse().find(matches);
  if (!selected) {
    throw new DevFlowError("INTERACTION_PROVENANCE_UNAVAILABLE", interactionId, {
      recoveryHint: "Ensure the UserPromptSubmit hook captured the exact one-time reply, then retry"
    });
  }
  const event = selected.data;
  const interaction = interactionId;
  if (typeof event.at !== "string") throw new DevFlowError("INTERACTION_PROVENANCE_UNAVAILABLE", interaction);
  return event.eventId;
}
async function resolveGrillDecision(root2, id, expectedRevision, interactionId, host, input) {
  const initial = await readState(root2, id);
  if (initial.revision !== expectedRevision) {
    throw new DevFlowError("STATE_REVISION_CONFLICT", "state revision changed", { currentRevision: initial.revision });
  }
  const interaction = getInteraction(initial, interactionId);
  if (interaction.kind !== "grill" || interaction.status !== "pending") throw new DevFlowError("INTERACTION_NOT_PENDING", interactionId);
  const grill = await currentGrillQuestion(root2, id, initial);
  if (interaction.target !== `grill:${grill.questionId}` || interaction.basisHash !== initial.artifacts.requirements.sha256) {
    throw new DevFlowError("GRILL_BASIS_CHANGED", interactionId, { recoveryHint: "Record the current requirements and request a new decision" });
  }
  let promptEventId;
  if (input.source === "text-token") {
    const events = await readFeatureEvents(root2, id);
    promptEventId = resolveGrillTextPrompt(events, interactionId, input.userReply, input.promptEventId);
    const event = events.find((item) => item.data.eventId === promptEventId)?.data;
    if (!event?.at || Date.parse(event.at) < Date.parse(interaction.presentedAt)) {
      throw new DevFlowError("INTERACTION_PROVENANCE_UNAVAILABLE", interactionId, { recoveryHint: "Use a reply submitted after the decision was shown" });
    }
  }
  let response;
  const state = await mutate(root2, id, expectedRevision, "grill-decision-resolved", (draft) => {
    response = input.source === "elicitation" ? resolveNativeInteraction(draft, interactionId, input.action, input.comment, host) : resolveTokenInteraction(draft, interactionId, input.userReply, host, promptEventId);
    draft.lastUpdatedBy = { host, pluginVersion: "1.7.0" };
  }, () => ({ interactionId, response }));
  if (!response) throw new DevFlowError("INTERACTION_NOT_RESOLVED", interactionId);
  return { state, interaction: toPublicInteraction(getInteraction(state, interactionId)), response };
}
async function resolveGrillElicitation(root2, id, expectedRevision, interactionId, action, comment, host) {
  return resolveGrillDecision(root2, id, expectedRevision, interactionId, host, { source: "elicitation", action, comment });
}
async function resolveGrillToken(root2, id, expectedRevision, interactionId, userReply, promptEventId, host) {
  return resolveGrillDecision(root2, id, expectedRevision, interactionId, host, { source: "text-token", userReply, promptEventId });
}
async function assertRequirementsGrillSatisfied(root2, id, state) {
  if (state.route !== "standard-m" && state.route !== "standard-l") return;
  const contents = await assertArtifactCurrent(root2, id, state, "requirements");
  const fields = parseNestedDevFlow(contents);
  const status = readStatus(fields);
  const allowed = allowedStatuses(state);
  if (!allowed.includes(status)) {
    throw new DevFlowError("GRILL_INCOMPLETE", "requirements grill is not complete", {
      requirementsState: state.classification.requirements,
      status,
      allowedStatuses: allowed,
      recoveryHint: "Continue grillme until grill_status is complete, record the artifact, then record the requirements step"
    });
  }
  if (fields.grill_question_id || fields.grill_response_hint) {
    throw new DevFlowError("GRILL_STATUS_INVALID", "complete/not_required grill must not retain current-question fields", {
      recoveryHint: "Clear grill_question_id and grill_response_hint when grill is finished"
    });
  }
}

// plugins/dev-flow/src/core/verification.ts
import { execFile as execFile2 } from "node:child_process";
import path9 from "node:path";
import { promisify as promisify2 } from "node:util";
var run2 = promisify2(execFile2);
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
    const result = await run2(invocation.executable, invocation.args, {
      cwd: path9.resolve(root2, command2.cwd),
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
    const promptEventId = input.promptEventId;
    const userReply = input.userReply;
    if (typeof promptEventId !== "string" || !promptEventId.trim() || typeof userReply !== "string" || !userReply.trim()) {
      throw new DevFlowError("INVALID_MANUAL_ACCEPTANCE", "user-signoff requires promptEventId and userReply");
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
      promptEventId: promptEventId.trim(),
      userReply
    };
  }
  if (input.promptEventId !== void 0 || input.userReply !== void 0) {
    throw new DevFlowError("INVALID_MANUAL_ACCEPTANCE", "only user-signoff may include prompt evidence");
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
async function assertOptionalManualAcceptance(root2, id, state, manualAcceptance) {
  if (manualAcceptance?.mode !== "user-signoff") return;
  const consumed = consumedSignoffEventIds(state);
  if (consumed.has(manualAcceptance.promptEventId)) {
    throw new DevFlowError("MANUAL_ACCEPTANCE_EVENT_CONSUMED", "user signoff event was already consumed");
  }
  const events = await readFeatureEvents(root2, id);
  const event = events.find((item) => item.type === "host-event" && item.data.eventId === manualAcceptance.promptEventId);
  const payload = event?.data;
  if (!payload || payload.type !== "user-prompt" || payload.text !== manualAcceptance.userReply) {
    throw new DevFlowError(
      "MANUAL_ACCEPTANCE_PROVENANCE_UNAVAILABLE",
      "user signoff must match a captured user prompt",
      { recoveryHint: "Capture a later UserPromptSubmit event with one exact acceptance phrase, then retry verification" }
    );
  }
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
  await assertOptionalManualAcceptance(root2, id, initial, manualAcceptance);
  assertMoneyBehaviorCommands(initial, selected.map((command2) => command2.id), config.verification.behaviorCommands);
  const fingerprint = await fingerprintProtectedRoots(root2, config.protectedRoots);
  const replacingStaleVerification = Boolean(
    initial.verification.verifiedFingerprint && initial.verification.verifiedFingerprint !== fingerprint
  );
  const startedAt = (/* @__PURE__ */ new Date()).toISOString();
  let exitCode = 0;
  const output = [];
  for (const command2 of selected) {
    const result = await runVerificationCommand(root2, command2);
    output.push(`[${command2.id}] ${result.output}`);
    if (result.exitCode !== 0) {
      exitCode = result.exitCode;
      break;
    }
  }
  const finishedAt = (/* @__PURE__ */ new Date()).toISOString();
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
      commandIds: selected.map((item) => item.id),
      kinds,
      startedAt,
      finishedAt,
      exitCode,
      output: output.join("\n").slice(-32e3),
      fingerprint,
      host,
      ...manualAcceptance ? { manualAcceptance } : {}
    };
    state.verification.attempts.push(attempt);
    delete state.verification.satisfiedByAttemptId;
    delete state.verification.verifiedFingerprint;
    state.steps.verification = { status: "pending", evidence: { attemptId: attempt.id, exitCode } };
    if (exitCode === 0) {
      state.verification.satisfiedByAttemptId = attempt.id;
      state.verification.verifiedFingerprint = fingerprint;
      state.businessFingerprint = fingerprint;
      state.steps.verification = {
        status: "satisfied",
        evidence: {
          attemptId: attempt.id,
          commandIds: attempt.commandIds,
          kinds: attempt.kinds,
          fingerprint,
          ...manualAcceptance ? { manualAcceptance } : {}
        }
      };
    }
    state.lastUpdatedBy = { host, pluginVersion: "1.7.0" };
  });
}
async function readVerificationFreshness(root2, state) {
  if (!state.verification.verifiedFingerprint) return { status: "missing" };
  const config = await readProjectConfig(root2);
  const current = await fingerprintProtectedRoots(root2, config.protectedRoots);
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
  const current = await fingerprintProtectedRoots(root2, config.protectedRoots);
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
import { createHash as createHash9, randomUUID as randomUUID6 } from "node:crypto";
import { readFile as readFile8 } from "node:fs/promises";
import path10 from "node:path";
var digest5 = (value) => createHash9("sha256").update(value).digest("hex");
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
function cloneLedger(ledger, stateRevision, batches) {
  return {
    ...ledger,
    revision: ledger.revision + 1,
    stateRevision,
    batches,
    summary: reviewSummary(batches)
  };
}
function reviewArtifactKinds(state) {
  return basisArtifactKinds.filter((kind) => kind !== "rollback-units" || state.route === "standard-l");
}
async function deriveReviewInput(root2, state) {
  if (!state.traceability) invalid3("REVIEW_BASIS_UNAVAILABLE", "review basis requires a current Trace pointer");
  const trace = await readTraceability(root2, state);
  const { config, sha256: projectConfigSha256 } = await readProjectConfigSnapshot(root2);
  const frozenArtifacts = await Promise.all(reviewArtifactKinds(state).map(async (kind) => {
    const artifact = state.artifacts[kind];
    if (!artifact) invalid3("REVIEW_BASIS_ARTIFACT_MISSING", `review basis artifact is missing: ${kind}`, { kind });
    let contents;
    try {
      contents = await readFile8(path10.join(root2, ".dev-flow", "features", state.featureId, artifact.path), "utf8");
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
  const projectContents = await readFile8(path10.join(root2, ".dev-flow", "project.json"), "utf8");
  if (digest5(projectContents) !== projectConfigSha256) {
    invalid3("REVIEW_BASIS_UNAVAILABLE", "project configuration changed while review basis was being captured");
  }
  const scopeManifest = {
    inScope: [...state.scope.inScope].sort(),
    outOfScope: [...state.scope.outOfScope].sort(),
    protectedRoots: [...config.protectedRoots].sort(),
    rollbackFileScopes: Object.values(trace.nodes).reduce((scopes, node) => {
      if (node.kind === "rollback" && node.status === "current") {
        scopes.push({ id: node.id, fileScope: [...node.fileScope].sort() });
      }
      return scopes;
    }, []).sort((left, right) => left.id.localeCompare(right.id))
  };
  const protectedRootsFingerprint = await fingerprintProtectedRoots(root2, config.protectedRoots);
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
    traceability: { path: state.traceability.path, sha256: state.traceability.sha256, revision: trace.revision },
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
  const { claim: _claim, ...visible } = job;
  return visible;
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
  return value.length > 0 && value === value.trim() && !path10.posix.isAbsolute(value) && !value.includes("\\") && path10.posix.normalize(value) === value && !value.split("/").includes("..");
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
  const inManifest = (value) => safePackagePath(value) && allowed.some((scope) => scope === "." || value === scope || value.startsWith(`${scope}/`));
  for (const finding of findings) {
    if (finding.severity === "blocking" && !finding.evidence.length) invalid3("REVIEW_FINDING_EVIDENCE_REQUIRED", "blocking finding requires evidence");
    if (finding.targets.some((target) => !inManifest(target)) || finding.evidence.some((evidence) => !inManifest(evidence.path))) {
      invalid3("REVIEW_FINDING_SCOPE_INVALID", "finding targets and evidence must be package-relative paths inside the scope manifest");
    }
  }
  if (resolutions.some((resolution) => resolution.evidence.some((evidence) => !inManifest(evidence.path)))) {
    invalid3("REVIEW_FINDING_SCOPE_INVALID", "resolution evidence must be package-relative paths inside the scope manifest");
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
        reviewDepth: requirement.reviewDepth
      });
      jobs.push({ jobId, role: requirement.role, reviewDepth: requirement.reviewDepth, packageSha256, status: "pending" });
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
async function submitParsedReviewJob(root2, featureId, ledger, batch, job, parsed, now, samplingAttempt, hostAttestation) {
  if (parsed.findings.some((finding) => finding.category !== job.role)) {
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
  assertFindingScope(manifest, parsed.findings, parsed.resolutions ?? []);
  const dispositions = { ...batch.dispositions };
  const resolvedIds = /* @__PURE__ */ new Set();
  for (const resolution of parsed.resolutions ?? []) {
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
    resolvedIds.add(resolution.findingId);
  }
  const payloadSha256 = digest5(canonicalReviewValueJson(parsed));
  const findings = dedupeFindings(parsed.findings).map((finding) => ({
    ...finding,
    findingId: `F-${randomUUID6()}`,
    jobId: job.jobId
  }));
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
      coverageSummary: parsed.coverageSummary,
      findings,
      resolutions: parsed.resolutions ?? [],
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
  return { batch: withDerivedAssurance(updatedBatch), payloadSha256 };
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
    if (Date.parse(job.claim.leaseExpiresAt) <= now.getTime()) invalid3("REVIEW_JOB_LEASE_EXPIRED", "review job lease has expired", { jobId });
    const submitted = await submitParsedReviewJob(root2, id, ledger, batch, job, parsed, now, void 0, hostAttestation);
    const batches = ledger.batches.map((candidate) => candidate.batchId === batchId ? submitted.batch : candidate);
    const pointer = await writeReviewSnapshot(root2, cloneLedger(ledger, nextStateRevision, batches));
    result = { batch: submitted.batch, idempotent: false };
    return {
      mutate: (draft) => {
        draft.review = pointer;
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
      ledger.batches.map((candidate) => candidate.batchId === batchId ? submitted.batch : candidate)
    ));
    result = { batch: submitted.batch };
    return {
      mutate: (draft) => {
        draft.review = pointer;
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
  const evidence = state.steps.plan_review?.evidence;
  return state.steps.plan_review?.status === "satisfied" && evidence?.batchId === batch.batchId && evidence?.basisHash === batch.basisHash;
}
async function currentBatchWithBasis(root2, state, options = {}) {
  const ledger = await readReviewLedger(root2, state);
  const batch = ledger.batches.find((candidate) => candidate.validity === "current");
  if (!batch) invalid3("REVIEW_BATCH_REQUIRED", "a current review batch is required");
  const requireLiveBasis = options.requireLiveBasis ?? !planReviewBoundToBatch(state, batch);
  if (requireLiveBasis) {
    const reviewInput = await deriveReviewInput(root2, state);
    if (basisHash(reviewInput.basis) !== batch.basisHash) {
      invalid3("REVIEW_BASIS_STALE", "review batch basis no longer matches current feature state", { batchId: batch.batchId });
    }
  }
  return { ledger, batch };
}
function acceptanceFindings(ledger, batch, findingIds) {
  return selectCurrentBlockingFindings(ledger, batch, findingIds, true);
}
function selectCurrentBlockingFindings(ledger, batch, findingIds, unresolvedOnly) {
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
async function resolveReviewRiskAcceptanceToken(root2, id, expectedRevision, interactionId, userReply, promptEventId, host) {
  let result;
  const state = await mutatePrepared(root2, id, expectedRevision, "review-risk-acceptance-resolved", async (current, nextStateRevision) => {
    const interaction = getInteraction(current, interactionId);
    const { ledger, batch } = await currentBatchWithBasis(root2, current);
    const binding = riskBinding(interaction);
    if (interaction.status === "resolved") {
      const findings2 = selectCurrentBlockingFindings(ledger, batch, binding.findingIds, false);
      assertResolvedAcceptance(current, interaction, batch, findings2);
      const accepted = interaction.response?.action === "accept" && interaction.response.source === "text-token" && interaction.response.userReply === userReply && interaction.response.promptEventId === promptEventId && interaction.response.host === host;
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
    const response = resolveTokenInteraction(preview, interactionId, userReply, host, promptEventId);
    if (response.action !== "accept") {
      result = { acceptedFindingIds: [], idempotent: false };
      return {
        mutate: (draft) => {
          resolveTokenInteraction(draft, interactionId, userReply, host, promptEventId);
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
    const pointer = await writeReviewSnapshot(root2, cloneLedger(
      ledger,
      nextStateRevision,
      ledger.batches.map((candidate) => candidate.batchId === batch.batchId ? updatedBatch : candidate)
    ));
    result = { acceptedFindingIds: binding.findingIds, idempotent: false };
    return {
      mutate: (draft) => {
        resolveTokenInteraction(draft, interactionId, userReply, host, promptEventId);
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
async function recordStep(root2, id, expectedRevision, step, evidence) {
  let normalizedEvidence = evidence;
  if (step === "implementation") {
    const files = implementationFiles(evidence);
    const config = await readProjectConfig(root2);
    assertImplementationFilesInProtectedRoots(files, config.protectedRoots);
    normalizedEvidence = {
      ...typeof evidence === "object" && evidence !== null && !Array.isArray(evidence) ? evidence : {},
      files
    };
  }
  return mutate(root2, id, expectedRevision, "step-recorded", async (state) => {
    if (state.lifecycle !== "active") {
      throw new DevFlowError("INVALID_LIFECYCLE", "only active features can record steps");
    }
    const route = routeDefinitionForFeature(state.route, state.workflowCapabilities);
    if (["requirement_confirmation", "implementation_approval", "verification", "feature_check", "finalize"].includes(step) || !route.orderedSteps.includes(step)) {
      throw new DevFlowError("INVALID_STEP", step);
    }
    assertCurrentStep(state, step);
    await assertRequirementsGrillSatisfied(root2, id, state);
    await assertTraceGateCurrent(root2, state, step);
    if (step === "implementation" && checkpointsEnforcementRequired(state.route, state.workflowCapabilities)) {
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
  });
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
  const invalidated = await invalidateStaleVerification(root2, id, expectedRevision);
  if (invalidated) {
    throw new DevFlowError("VERIFICATION_STALE", "protected files changed; rerun verification", {
      currentRevision: invalidated.revision
    });
  }
}
function assertVerificationWasNotInvalidated(state) {
  const evidence = state.steps.verification?.evidence;
  if (evidence?.reason === "protected-files-changed") {
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
    if (state.verification.verifiedFingerprint !== state.businessFingerprint) {
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
  let snapshot;
  return mutate(root2, id, expectedRevision, "finalized", async (state) => {
    await assertRequirementsGrillSatisfied(root2, id, state);
    assertVerificationWasNotInvalidated(state);
    const route = routeDefinitionForFeature(state.route, state.workflowCapabilities);
    assertCurrentStep(state, "finalize");
    await assertTraceGateCurrent(root2, state, "finalize");
    if (route.featureCheckRequired && (!state.featureCheck.passed || state.featureCheck.fingerprint !== state.businessFingerprint)) {
      throw new DevFlowError("FEATURE_CHECK_REQUIRED", "feature check is required");
    }
    snapshot = await createDeliverySnapshot(root2, id, state, config);
    if (snapshot) state.deliverySnapshot = snapshot;
    state.logicComplete = true;
    state.lifecycle = "finalized";
    state.steps.finalize = { status: "satisfied" };
  }, () => snapshot ? { deliverySnapshot: snapshot } : {});
}

// plugins/dev-flow/src/core/human-gates.ts
import { createHash as createHash10 } from "node:crypto";

// plugins/dev-flow/src/core/gate-approval.ts
var gateApprovalPhrases = {
  requirement_confirmation: [
    "\u786E\u8BA4\u9700\u6C42",
    "\u9700\u6C42\u5DF2\u786E\u8BA4",
    "\u540C\u610F\u9700\u6C42",
    "approved",
    "LGTM"
  ],
  implementation_approval: [
    "\u786E\u8BA4\u6267\u884C",
    "\u6279\u51C6\u5B9E\u73B0",
    "\u540C\u610F\u5B9E\u73B0",
    "\u5F00\u59CB\u5B9E\u73B0",
    "approved",
    "LGTM"
  ]
};
var normalizeGateReply = (value) => value.trim().toLocaleLowerCase("en-US");
function gateReplyHint(gate) {
  return gateApprovalPhrases[gate].join(" / ");
}
function isExplicitGateApproval(gate, userReply) {
  const normalized = normalizeGateReply(userReply);
  return gateApprovalPhrases[gate].some((phrase) => normalizeGateReply(phrase) === normalized);
}

// plugins/dev-flow/src/core/human-gates.ts
var digest6 = (value) => createHash10("sha256").update(JSON.stringify(value)).digest("hex");
var gates = /* @__PURE__ */ new Set(["requirement_confirmation", "implementation_approval"]);
function gateId(value) {
  if (!gates.has(value)) throw new DevFlowError("INVALID_GATE", value);
  return value;
}
function gateInteractionOptions(gate) {
  return [
    { id: "confirm", label: gate === "requirement_confirmation" ? "\u786E\u8BA4\u9700\u6C42" : "\u786E\u8BA4\u6267\u884C" },
    { id: "request-changes", label: "\u63D0\u51FA\u4FEE\u6539\u610F\u89C1", requiresComment: true }
  ];
}
async function assertReviewProjectionForGate(root2, state, gate) {
  if (gate === "implementation_approval" && reviewEnforcementRequired(state.route, state.workflowCapabilities)) {
    await assertCurrentReviewProjection(root2, state);
  }
}
async function presentGate(root2, id, expectedRevision, gate) {
  const selectedGate = gateId(gate);
  let interaction;
  const state = await mutate(root2, id, expectedRevision, "gate-presented", async (state2) => {
    if (state2.lifecycle !== "active") {
      throw new DevFlowError("INVALID_LIFECYCLE", "gate requires active feature");
    }
    if (!routeDefinitionForFeature(state2.route, state2.workflowCapabilities).orderedSteps.includes(selectedGate)) {
      throw new DevFlowError("INVALID_GATE", selectedGate);
    }
    if (state2.humanGates[selectedGate]) {
      throw new DevFlowError("HUMAN_GATE_ALREADY_PRESENTED", selectedGate);
    }
    assertCurrentStep(state2, selectedGate);
    const missing = artifactsRequiredBeforeGate(state2, selectedGate).find((kind) => !state2.artifacts[kind]);
    if (missing) throw new DevFlowError("MISSING_REQUIRED_ARTIFACT", missing);
    await assertRequirementsGrillSatisfied(root2, id, state2);
    await assertTraceGateCurrent(root2, state2, selectedGate);
    await assertReviewProjectionForGate(root2, state2, selectedGate);
    const basisHash2 = digest6(gateBasis(state2, selectedGate));
    state2.humanGates[selectedGate] = {
      status: "pending",
      presentedRevision: state2.revision,
      presentedAt: (/* @__PURE__ */ new Date()).toISOString(),
      basisHash: basisHash2
    };
    interaction = createInteraction(state2, {
      kind: "gate",
      target: `gate:${selectedGate}`,
      basisHash: basisHash2,
      options: gateInteractionOptions(selectedGate)
    });
  }, () => ({
    gate: selectedGate,
    replyHint: interaction ? fallbackHint(interaction) : gateReplyHint(selectedGate),
    interactionId: interaction?.id
  }));
  if (!interaction) throw new DevFlowError("INTERACTION_NOT_CREATED", selectedGate);
  return { ...state, gateReplyHint: fallbackHint(interaction), gateInteraction: toPublicInteraction(interaction) };
}
function eventIdFromConfirmation(value) {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return void 0;
  const confirmation = value.confirmation;
  if (typeof confirmation !== "object" || confirmation === null || Array.isArray(confirmation)) return void 0;
  const record = confirmation;
  return typeof record.promptEventId === "string" ? record.promptEventId : typeof record.turnBoundaryEventId === "string" ? record.turnBoundaryEventId : void 0;
}
function resolveProvenance(events, state, gate, userReply, provenance) {
  if (provenance.promptEventId || provenance.turnBoundaryEventId) return provenance;
  const current = state.humanGates[gate];
  const consumed = new Set(
    Object.values(state.humanGates).map(eventIdFromConfirmation).filter((eventId2) => Boolean(eventId2))
  );
  const match = [...events].reverse().find((item) => {
    const event = item.data;
    return item.type === "host-event" && typeof event.eventId === "string" && !consumed.has(event.eventId) && event.type === "user-prompt" && event.text === userReply && item.revision > (current?.presentedRevision ?? state.revision) && typeof current?.presentedAt === "string" && typeof event.at === "string" && Date.parse(event.at) >= Date.parse(current.presentedAt);
  });
  const eventId = match?.data?.eventId;
  if (typeof eventId !== "string") {
    throw new DevFlowError(
      "HUMAN_GATE_PROVENANCE_UNAVAILABLE",
      "no matching post-presentation user prompt was captured",
      { recoveryHint: "Ensure the host UserPromptSubmit hook is active, then submit one exact approval phrase and retry confirmation" }
    );
  }
  return { promptEventId: eventId };
}
function gateFromInteraction(state, interactionId) {
  const interaction = getInteraction(state, interactionId);
  if (interaction.kind !== "gate" || !interaction.target.startsWith("gate:")) {
    throw new DevFlowError("INTERACTION_TARGET_INVALID", interactionId);
  }
  return gateId(interaction.target.slice("gate:".length));
}
function assertTokenEvidence(events, state, gate, userReply, provenance) {
  const resolved = resolveProvenance(events, state, gate, userReply, provenance);
  const marker = resolved.promptEventId ?? resolved.turnBoundaryEventId;
  const current = state.humanGates[gate];
  const eventRecord = events.find((item) => item.type === "host-event" && item.data.eventId === marker);
  const event = eventRecord?.data;
  if (!marker || !event || !current?.presentedAt || (eventRecord?.revision ?? -1) <= (current.presentedRevision ?? -1) || Date.parse(event.at ?? "") < Date.parse(current.presentedAt)) {
    throw new DevFlowError("HUMAN_GATE_SAME_TURN", "confirmation evidence must be later than gate presentation", {
      recoveryHint: "Submit the exact one-time reply in a later user turn"
    });
  }
  if (resolved.promptEventId && (event.type !== "user-prompt" || event.text !== userReply)) {
    throw new DevFlowError("HUMAN_GATE_REPLY_MISMATCH", "userReply must match the captured prompt", {
      recoveryHint: "Pass the captured user prompt text exactly"
    });
  }
  if (resolved.turnBoundaryEventId && event.type !== "turn-boundary") {
    throw new DevFlowError("HUMAN_GATE_PROVENANCE_UNAVAILABLE", "turn boundary was not captured");
  }
  return resolved;
}
async function resolveGateResponse(root2, id, expectedRevision, interactionId, host, input) {
  const initial = await readState(root2, id);
  if (initial.revision !== expectedRevision) {
    throw new DevFlowError("STATE_REVISION_CONFLICT", "state revision changed", { currentRevision: initial.revision });
  }
  const gate = gateFromInteraction(initial, interactionId);
  const events = input.source === "text-token" ? await readFeatureEvents(root2, id) : [];
  const provenance = input.source === "text-token" ? assertTokenEvidence(events, initial, gate, input.userReply, input.provenance) : void 0;
  let response;
  return mutate(root2, id, expectedRevision, "gate-interaction-resolved", async (state) => {
    await assertRequirementsGrillSatisfied(root2, id, state);
    await assertTraceGateCurrent(root2, state, gate);
    await assertReviewProjectionForGate(root2, state, gate);
    const current = state.humanGates[gate];
    if (current?.status !== "pending") throw new DevFlowError("HUMAN_GATE_NOT_PENDING", gate);
    const interaction = getInteraction(state, interactionId);
    if (interaction.kind !== "gate" || interaction.target !== `gate:${gate}` || interaction.status !== "pending") {
      throw new DevFlowError("INTERACTION_NOT_PENDING", interactionId);
    }
    const basisHash2 = digest6(gateBasis(state, gate));
    if (basisHash2 !== current.basisHash || basisHash2 !== interaction.basisHash) {
      throw new DevFlowError("HUMAN_GATE_BASIS_CHANGED", gate, {
        recoveryHint: "Present the gate again after updating its approval basis"
      });
    }
    response = input.source === "elicitation" ? resolveNativeInteraction(state, interactionId, input.action, input.comment, host) : resolveTokenInteraction(state, interactionId, input.userReply, host, provenance.promptEventId ?? provenance.turnBoundaryEventId);
    if (response.action === "confirm") {
      state.humanGates[gate] = {
        ...current,
        status: "confirmed",
        confirmation: {
          interactionId,
          ...response,
          confirmedAt: (/* @__PURE__ */ new Date()).toISOString()
        }
      };
      state.steps[gate] = { status: "satisfied" };
    } else if (response.action === "request-changes") {
      state.humanGates[gate] = { ...current, status: "returned", lastResponse: response };
    } else {
      throw new DevFlowError("INTERACTION_ACTION_INVALID", response.action);
    }
    state.lastUpdatedBy = { host, pluginVersion: "1.7.0" };
  }, () => ({ gate, interactionId, response }));
}
async function resolveGateElicitation(root2, id, expectedRevision, interactionId, action, comment, host) {
  return resolveGateResponse(root2, id, expectedRevision, interactionId, host, { action, comment, source: "elicitation" });
}
async function resolveGateToken(root2, id, expectedRevision, interactionId, userReply, provenance, host) {
  return resolveGateResponse(root2, id, expectedRevision, interactionId, host, { userReply, provenance, source: "text-token" });
}
async function confirmGate(root2, id, expectedRevision, gate, userReply, provenance, host) {
  const selectedGate = gateId(gate);
  if (!userReply.trim()) throw new DevFlowError("HUMAN_GATE_REPLY_REQUIRED", "userReply is required");
  if (!isExplicitGateApproval(selectedGate, userReply)) {
    throw new DevFlowError(
      "HUMAN_GATE_APPROVAL_NOT_EXPLICIT",
      "userReply is not an exact approval phrase",
      {
        gate: selectedGate,
        allowed: gateApprovalPhrases[selectedGate],
        recoveryHint: "Reply with one exact approval phrase after the gate is presented"
      }
    );
  }
  const currentState = await readState(root2, id);
  const events = await readFeatureEvents(root2, id);
  const resolvedProvenance = resolveProvenance(events, currentState, selectedGate, userReply, provenance);
  const marker = resolvedProvenance.promptEventId ?? resolvedProvenance.turnBoundaryEventId;
  if (!marker) throw new DevFlowError("HUMAN_GATE_PROVENANCE_UNAVAILABLE", "confirmation provenance is required");
  return mutate(root2, id, expectedRevision, "gate-confirmed", async (state) => {
    await assertRequirementsGrillSatisfied(root2, id, state);
    await assertTraceGateCurrent(root2, state, selectedGate);
    await assertReviewProjectionForGate(root2, state, selectedGate);
    const current = state.humanGates[selectedGate];
    if (current?.status !== "pending") {
      throw new DevFlowError("HUMAN_GATE_NOT_PENDING", selectedGate, {
        recoveryHint: "Present the current gate before attempting confirmation"
      });
    }
    if ((current.presentedRevision ?? state.revision) >= state.revision) {
      throw new DevFlowError("HUMAN_GATE_SAME_TURN", "confirmation must occur after presentation", {
        recoveryHint: "Wait for a later user turn before confirming the gate"
      });
    }
    const eventRecord = events.find((item) => item.type === "host-event" && item.data.eventId === marker);
    const event = eventRecord?.data;
    if (!event || !current.presentedAt || (eventRecord?.revision ?? -1) <= (current.presentedRevision ?? -1) || Date.parse(event.at ?? "") < Date.parse(current.presentedAt)) {
      throw new DevFlowError("HUMAN_GATE_SAME_TURN", "confirmation evidence must be later than gate presentation", {
        recoveryHint: "Capture confirmation from a later user turn"
      });
    }
    if (resolvedProvenance.promptEventId && (event.type !== "user-prompt" || event.text !== userReply)) {
      throw new DevFlowError("HUMAN_GATE_REPLY_MISMATCH", "userReply must match the captured prompt", {
        recoveryHint: "Pass the captured user prompt text exactly"
      });
    }
    if (resolvedProvenance.turnBoundaryEventId && event.type !== "turn-boundary") {
      throw new DevFlowError("HUMAN_GATE_PROVENANCE_UNAVAILABLE", "turn boundary was not captured", {
        recoveryHint: "Use a captured turn-boundary event or later user prompt"
      });
    }
    for (const [otherGate, value] of Object.entries(state.humanGates)) {
      const confirmation = value.confirmation;
      if (otherGate !== selectedGate && confirmation && Object.values(confirmation).includes(marker)) {
        throw new DevFlowError("HUMAN_GATE_EVENT_CONSUMED", String(marker));
      }
    }
    const basisHash2 = digest6(gateBasis(state, selectedGate));
    if (basisHash2 !== current.basisHash) {
      throw new DevFlowError("HUMAN_GATE_BASIS_CHANGED", selectedGate, {
        recoveryHint: "Present the gate again after updating its approval basis"
      });
    }
    state.humanGates[selectedGate] = {
      ...current,
      status: "confirmed",
      confirmation: { userReply, ...resolvedProvenance, host, confirmedAt: (/* @__PURE__ */ new Date()).toISOString() }
    };
    clearInteractionsForTarget(state, `gate:${selectedGate}`);
    state.steps[selectedGate] = { status: "satisfied" };
    state.lastUpdatedBy = { host, pluginVersion: "1.7.0" };
  }, { gate: selectedGate });
}

// plugins/dev-flow/src/policy/derive-next.ts
var humanGates = /* @__PURE__ */ new Set(["requirement_confirmation", "implementation_approval"]);
function deriveNext(state) {
  if (state.schemaVersion !== 1) throw new Error("UNSUPPORTED_STATE_SCHEMA");
  if (state.lifecycle === "finalized") return { kind: "done" };
  if (state.classificationViolatesTopology) return { kind: "stop", reason: "reclassification-required" };
  if (state.blockingFindings?.some((finding) => finding.blocking)) return { kind: "stop", reason: "resolve-blocking-findings" };
  const definition = routeDefinition(state.route);
  for (const step of definition.orderedSteps) {
    const snapshot = state.steps[step];
    if (snapshot?.status === "satisfied") continue;
    if (humanGates.has(step)) {
      if (!snapshot?.artifactReady) return { kind: "present-human-gate", step };
      return { kind: "wait-human-gate", step };
    }
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
  for (const gate of ["requirement_confirmation", "implementation_approval"]) {
    const snapshot = state.humanGates[gate];
    if (snapshot?.status === "pending" || snapshot?.status === "returned") steps[gate] = { status: "pending", artifactReady: true };
  }
  return {
    schemaVersion: state.schemaVersion,
    lifecycle: state.lifecycle,
    route: state.route,
    steps,
    blockingFindings: state.blockingFindings,
    verificationFresh: !verificationStale && Boolean(
      state.verification.verifiedFingerprint && state.verification.verifiedFingerprint === state.businessFingerprint
    ),
    featureCheckFresh: !verificationStale && Boolean(
      state.featureCheck.passed && state.featureCheck.fingerprint === state.businessFingerprint
    ),
    logicComplete: state.logicComplete
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
  if (action.kind === "run-step" || action.kind === "present-human-gate") return action.step;
  if (action.kind === "feature-check") return "feature_check";
  if (action.kind === "finalize") return "finalize";
  return void 0;
}
async function reviewPlanAction(root2, state) {
  if (!reviewEnforcementRequired(state.route, state.workflowCapabilities)) return void 0;
  const ledger = await readReviewLedger(root2, state);
  const batch = ledger.batches.find((candidate) => candidate.validity === "current");
  if (!batch) return { kind: "create-review-batch", step: "plan_review" };
  if (batch.progress !== "complete") {
    return {
      kind: "review-jobs-pending",
      step: "plan_review",
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
      return { kind: "create-review-batch", step: "plan_review" };
    }
    if (code === "REVIEW_BLOCKING_FINDINGS" || code === "REVIEW_BATCH_INCOMPLETE") {
      return {
        kind: "review-jobs-pending",
        step: "plan_review",
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
  const action = deriveNext(toDerivedState(state, await verificationIsStale(root2, state)));
  if (action.kind === "run-step" && (action.step === "plan_review" || action.step === "implementation")) {
    const reviewAction = await reviewPlanAction(root2, state);
    if (reviewAction) return reviewAction;
    if (action.step === "plan_review") {
      await assertCurrentReviewProjection(root2, state);
    }
  }
  if (action.kind === "run-step" || action.kind === "present-human-gate") {
    const definition = routeDefinitionForFeature(state.route, state.workflowCapabilities);
    const requiredNow = [
      ...definition.artifactSteps?.[action.step] ?? [],
      ...definition.generatedArtifactSteps?.[action.step] ?? []
    ];
    const missing = requiredNow.find((artifact) => !state.artifacts[artifact]);
    if (missing) return { kind: "scaffold-artifact", step: missing };
  }
  const traceStep = traceStepForAction(action);
  if (traceStep) {
    const trace = await inspectTraceGate(root2, state, traceStep);
    if (trace.blocker) return { kind: "repair-trace", ...trace.blocker };
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

// plugins/dev-flow/src/core/status.ts
import { readFile as readFile11 } from "node:fs/promises";
import path13 from "node:path";

// plugins/dev-flow/src/core/rollback.ts
import { createHash as createHash13, randomUUID as randomUUID9 } from "node:crypto";
import { access as access3, chmod, lstat as lstat3, mkdir as mkdir6, open as open6, readFile as readFile10, rename as rename6, rm as rm2 } from "node:fs/promises";
import path12 from "node:path";

// plugins/dev-flow/src/core/checkpoints.ts
import { randomUUID as randomUUID7, createHash as createHash11 } from "node:crypto";
import { access as access2, mkdir as mkdir5, open as open5, readFile as readFile9, readdir as readdir5, rename as rename5 } from "node:fs/promises";
import path11 from "node:path";
var digest7 = (value) => createHash11("sha256").update(value).digest("hex");
var featureDirectory2 = (root2, featureId) => path11.join(root2, ".dev-flow", "features", featureId);
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
  const temp = `${file}.${randomUUID7()}.tmp`;
  const handle = await open5(temp, "w");
  try {
    await handle.writeFile(contents);
    await handle.sync();
  } finally {
    await handle.close();
  }
  await rename5(temp, file);
  const directory = await open5(path11.dirname(file), "r");
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
  const file = path11.join(featureDirectory2(root2, featureId), blobPath(sha256));
  if (await pathExists2(file)) return sha256;
  await mkdir5(path11.dirname(file), { recursive: true });
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
    const bytes = await readFile9(path11.join(root2, file2.path));
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
  const file = path11.join(featureDirectory2(root2, featureId), baselinePath(unitId));
  await mkdir5(path11.dirname(file), { recursive: true });
  await writeAtomic2(file, `${JSON.stringify(baseline, null, 2)}
`);
}
async function readCheckpointBaseline(root2, featureId, unitId) {
  const file = path11.join(featureDirectory2(root2, featureId), baselinePath(unitId));
  let raw;
  try {
    raw = await readFile9(file, "utf8");
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
  return node.forwardVerification.map((commandId) => {
    const command2 = config.verification.commands.find((candidate) => candidate.id === commandId);
    if (!command2) {
      throw new DevFlowError("TRACE_VERIFICATION_COMMAND_UNKNOWN", "rollback unit references an unknown verification command", {
        unitId: node.id,
        commandId
      });
    }
    return command2;
  });
}
async function nextCheckpointSequence(root2, featureId) {
  const directory = path11.join(featureDirectory2(root2, featureId), "checkpoints", "manifests");
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
  const baseline = await readCheckpointBaseline(root2, id, unitId);
  const after = await snapshotProtectedRoots(root2, config.protectedRoots);
  const records = diffSnapshots(baseline.files, after);
  for (const record of records) {
    for (const changedPath of [record.path, ...record.renamedFrom ? [record.renamedFrom] : []]) {
      if (!pathWithinFileScope(changedPath, node.fileScope)) {
        throw new DevFlowError("IMPLEMENTATION_UNIT_OUT_OF_SCOPE", "checkpoint found changes outside the rollback unit fileScope", {
          unitId,
          path: changedPath,
          fileScope: [...node.fileScope]
        });
      }
    }
  }
  const sequence = await nextCheckpointSequence(root2, id);
  const checkpointId = `CP-${String(sequence).padStart(3, "0")}`;
  const rollbackUnitId = unit.unitId;
  const featureDir = featureDirectory2(root2, id);
  const manifestsDir = path11.join(featureDir, "checkpoints", "manifests");
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
      candidate = parseCheckpointManifest(JSON.parse(await readFile9(path11.join(manifestsDir, entry), "utf8")));
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
  const manifestFile = path11.join(featureDir, manifestPath(checkpointId));
  const attempts = [];
  for (const command2 of commands) {
    const startedAt = (/* @__PURE__ */ new Date()).toISOString();
    const result = await runVerificationCommand(root2, command2);
    const attempt = {
      attemptId: randomUUID7(),
      commandId: command2.id,
      command: commandSummary(command2),
      status: result.exitCode === 0 ? "passed" : "failed",
      startedAt,
      completedAt: (/* @__PURE__ */ new Date()).toISOString()
    };
    attempts.push(attempt);
    if (result.exitCode !== 0) {
      throw new DevFlowError("CHECKPOINT_VERIFICATION_FAILED", "forward verification failed; the unit stays active and no checkpoint is recorded", {
        unitId,
        attemptId: attempt.attemptId,
        commandId: attempt.commandId,
        exitCode: result.exitCode,
        output: result.output.slice(-4e3)
      });
    }
  }
  const afterVerification = await snapshotProtectedRoots(root2, config.protectedRoots);
  if (!snapshotsEqual(after, afterVerification)) {
    throw new DevFlowError("CHECKPOINT_HASH_MISMATCH", "protected files changed while verification ran", { unitId });
  }
  const completedFingerprint = await fingerprintProtectedRoots(root2, config.protectedRoots);
  for (const record of records) {
    if (record.change === "deleted" || record.change === "renamed") continue;
    const bytes = await readFile9(path11.join(root2, record.path));
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
    verificationCommands: commands.map((command2) => ({ commandId: command2.id, command: commandSummary(command2) }))
  };
  const validated = parseCheckpointManifest(JSON.parse(JSON.stringify(manifest)));
  await mkdir5(path11.join(featureDir, "checkpoints", "patches"), { recursive: true });
  await mkdir5(path11.dirname(manifestFile), { recursive: true });
  await writeAtomic2(path11.join(featureDir, "checkpoints", "patches", `${manifest.forwardPatchSha256}.json`), forwardPatch);
  await writeAtomic2(path11.join(featureDir, "checkpoints", "patches", `${manifest.reversePatchSha256}.json`), reversePatch);
  const manifestContents = `${JSON.stringify(validated, null, 2)}
`;
  const temp = `${manifestFile}.${randomUUID7()}.tmp`;
  const handle = await open5(temp, "w");
  try {
    await handle.writeFile(manifestContents);
    await handle.sync();
  } finally {
    await handle.close();
  }
  await options.fault?.("before-manifest-rename");
  await rename5(temp, manifestFile);
  const manifestDir = await open5(path11.dirname(manifestFile), "r");
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
  const file = path11.join(featureDirectory2(root2, featureId), manifestPath(checkpointId));
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
import { createHash as createHash12, randomUUID as randomUUID8 } from "node:crypto";
var digest8 = (value) => createHash12("sha256").update(value).digest("hex");
function currentRollbackNodes(ledger) {
  return Object.values(ledger?.nodes ?? {}).filter((node) => node.kind === "rollback" && node.status === "current");
}
function implementationUnitBasisHash(state) {
  return digest8(canonicalReviewValueJson({
    traceability: state.traceability,
    approval: state.humanGates.implementation_approval ?? null
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
    const approval = state.humanGates.implementation_approval;
    if (approval?.status !== "confirmed") {
      throw new DevFlowError("DEV_FLOW_IMPLEMENTATION_APPROVAL_REQUIRED", "implementation approval must be confirmed before beginning a unit");
    }
    const ledger = await assertTraceGateCurrent(root2, state, "implementation");
    for (const kind of ["requirements", "implementation-plan", "coverage-matrix", ...state.route === "standard-l" ? ["rollback-units"] : []]) {
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
    const snapshot = await snapshotProtectedRoots(root2, project.protectedRoots);
    await captureUnitBaseline(root2, id, unitId, snapshot);
    delete target.checkpointId;
    target.basisHash = basisHash2;
    target.beginNonce = randomUUID8();
    target.status = "active";
    target.startedFingerprint = await fingerprintProtectedRoots(root2, project.protectedRoots);
    state.implementationUnits = merged;
  }, { unitId });
}

// plugins/dev-flow/src/core/rollback.ts
var digest9 = (value) => createHash13("sha256").update(value).digest("hex");
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
  const snapshot = await snapshotProtectedRoots(root2, config.protectedRoots);
  const fileScopes = [...new Set(nodes.flatMap((node) => node.fileScope))];
  const baselineFiles = (await readCheckpointBaseline(root2, featureId, chain[0].unitId)).files;
  const conflicts = detectChainConflicts(chain, snapshot, fileScopes, baselineFiles);
  if (conflicts.length) {
    throw new DevFlowError("ROLLBACK_CONFLICT", "workspace has unregistered modifications; rollback would overwrite them", {
      conflicts
    });
  }
  const stale = suffix.filter((manifest) => manifest.projectConfigSha256 !== projectConfigSha256);
  if (stale.length) {
    throw new DevFlowError("ROLLBACK_BASIS_STALE", "project verification config changed after these checkpoints", {
      checkpointIds: stale.map((manifest) => manifest.checkpointId)
    });
  }
  const undoManifests = [...suffix].reverse();
  const verificationCommands = [];
  for (const manifest of undoManifests) {
    const node = nodes.find((candidate) => candidate.id === manifest.unitId);
    for (const commandId of node?.rollbackVerification ?? []) {
      const command2 = config.verification.commands.find((candidate) => candidate.id === commandId);
      if (!command2) {
        throw new DevFlowError("TRACE_VERIFICATION_COMMAND_UNKNOWN", "rollback verification command is not configured", {
          unitId: manifest.unitId,
          commandId
        });
      }
      verificationCommands.push({ commandId: command2.id, command: commandSummary2(command2) });
    }
  }
  const filePlan = /* @__PURE__ */ new Map();
  const planAction = (path17, action) => {
    filePlan.set(path17, action);
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
async function rollbackChainView(root2, state) {
  if (!checkpointsEnforcementRequired(state.route, state.workflowCapabilities)) {
    return { enforced: false, chain: [], validTargets: [], conflicts: [] };
  }
  const gateStatus = state.rollbackGate?.status === "pending" || state.rollbackGate?.status === "confirmed" ? {
    status: state.rollbackGate.status,
    targetCheckpointId: state.rollbackGate.targetCheckpointId,
    targetUnitId: state.rollbackGate.targetUnitId,
    interactionId: state.rollbackGate.interactionId,
    presentedAt: state.rollbackGate.presentedAt,
    ...state.rollbackGate.status === "confirmed" && state.rollbackGate.confirmedAt ? { confirmedAt: state.rollbackGate.confirmedAt } : {}
  } : void 0;
  let openTransaction;
  try {
    const tx = await readRollbackTransaction(root2, state.featureId);
    if (tx && !rollbackTransactionFinished(tx)) {
      openTransaction = {
        transactionId: tx.transactionId,
        phase: tx.phase,
        targetCheckpointId: tx.targetCheckpointId,
        startedAt: tx.startedAt,
        ...tx.error ? { error: tx.error } : {}
      };
    }
  } catch {
  }
  let nodes;
  try {
    nodes = rollbackNodes((await readTraceability(root2, state)).nodes);
  } catch {
    return { enforced: true, chain: [], validTargets: [], conflicts: [], gateStatus, openTransaction };
  }
  const chain = await checkpointChain(root2, state.featureId, state);
  const live = liveChain(state, chain);
  try {
    assertChainIntegrity(live, nodes);
  } catch {
    return {
      enforced: true,
      chain: chain.map((manifest) => ({
        checkpointId: manifest.checkpointId,
        unitId: manifest.unitId,
        sequence: manifest.sequence
      })),
      validTargets: [],
      conflicts: [],
      gateStatus,
      openTransaction
    };
  }
  const { config } = await readProjectConfigSnapshot(root2);
  const snapshot = await snapshotProtectedRoots(root2, config.protectedRoots);
  const fileScopes = [...new Set(nodes.flatMap((node) => node.fileScope))];
  let baselineFiles = [];
  if (live.length) {
    try {
      baselineFiles = (await readCheckpointBaseline(root2, state.featureId, live[0].unitId)).files;
    } catch {
      return { enforced: true, chain: [], validTargets: [], conflicts: [], gateStatus, openTransaction };
    }
  }
  return {
    enforced: true,
    chain: chain.map((manifest) => ({
      checkpointId: manifest.checkpointId,
      unitId: manifest.unitId,
      sequence: manifest.sequence
    })),
    // The live chain tip has nothing to undo and can never be a target.
    validTargets: live.slice(0, -1).map((manifest) => manifest.checkpointId),
    conflicts: live.length ? detectChainConflicts(live, snapshot, fileScopes, baselineFiles) : [],
    gateStatus,
    openTransaction
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
  return { state, interaction: toPublicInteraction(interaction), preview };
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
  if (input.source === "text-token") {
    if (!input.promptEventId) {
      throw new DevFlowError("ROLLBACK_GATE_PROVENANCE_UNAVAILABLE", "text-token resolution requires a prompt event id", {
        recoveryHint: "Pass the host-captured promptEventId from a user prompt that occurred after gate presentation"
      });
    }
    const events = await readFeatureEvents(root2, featureId);
    const eventRecord = events.find(
      (item) => item.type === "host-event" && item.data.eventId === input.promptEventId
    );
    if (!eventRecord) {
      throw new DevFlowError("ROLLBACK_GATE_PROVENANCE_UNAVAILABLE", "no matching host event found for the given promptEventId", {
        recoveryHint: "Ensure the host UserPromptSubmit hook is active, then submit one exact approval reply and retry"
      });
    }
    const event = eventRecord.data;
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
    response = input.source === "elicitation" ? resolveNativeInteraction(state, interactionId, input.action, input.comment, host) : resolveTokenInteraction(state, interactionId, input.userReply, host, input.promptEventId);
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
    state.lastUpdatedBy = { host, pluginVersion: "1.7.0" };
  }, () => ({ gate: "rollback-confirmation", interactionId, response }));
}
async function resolveRollbackGateElicitation(root2, featureId, expectedRevision, interactionId, action, comment, host) {
  return resolveRollbackGateResponse(root2, featureId, expectedRevision, interactionId, host, {
    action,
    comment,
    source: "elicitation"
  });
}
async function resolveRollbackGateToken(root2, featureId, expectedRevision, interactionId, userReply, host, promptEventId) {
  return resolveRollbackGateResponse(root2, featureId, expectedRevision, interactionId, host, {
    userReply,
    promptEventId,
    source: "text-token"
  });
}
var featureDirectory3 = (root2, featureId) => path12.join(root2, ".dev-flow", "features", featureId);
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
  await mkdir6(path12.dirname(file), { recursive: true });
  const temp = `${file}.${randomUUID9()}.tmp`;
  const handle = await open6(temp, "w");
  try {
    await handle.writeFile(bytes);
    await handle.sync();
  } finally {
    await handle.close();
  }
  await chmod(temp, Number.parseInt(mode, 8));
  await rename6(temp, file);
  await fsyncDirectory4(path12.dirname(file));
}
async function writeAtomicBuffer(file, contents) {
  await mkdir6(path12.dirname(file), { recursive: true });
  const temp = `${file}.${randomUUID9()}.tmp`;
  const handle = await open6(temp, "w");
  try {
    await handle.writeFile(contents);
    await handle.sync();
  } finally {
    await handle.close();
  }
  await rename6(temp, file);
  await fsyncDirectory4(path12.dirname(file));
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
    raw = await readFile10(manifestFile, "utf8");
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
  const snapshot = await snapshotProtectedRoots(root2, config.protectedRoots);
  const conflicts = detectChainConflicts(chain, snapshot, fileScopes, baselineFiles);
  if (conflicts.length) {
    throw new DevFlowError("ROLLBACK_HASH_MISMATCH", "workspace drifted from the confirmed rollback basis; refusing to capture it as the pre-rollback backup", {
      conflicts,
      recoveryHint: "Restore the drifted files to their checkpointed bytes, then resume the rollback with the same target; run dev_flow_doctor to inspect the open transaction"
    });
  }
}
async function captureBackup(root2, featureId, journal, config, options) {
  const dir = path12.join(featureDirectory3(root2, featureId), journal.backupDirectory);
  const manifestFile = path12.join(dir, "backup-manifest.json");
  if (await pathExists3(manifestFile)) {
    const manifest2 = await readBackupManifest(manifestFile, journal.transactionId);
    const current = await snapshotProtectedRoots(root2, config.protectedRoots);
    const mismatches = snapshotMismatches(manifest2.files, current);
    if (mismatches.length) {
      throw new DevFlowError("ROLLBACK_HASH_MISMATCH", "workspace drifted from the recorded rollback backup", { mismatches });
    }
    return;
  }
  await assertWorkspaceMatchesChainTip(root2, featureId, config);
  await mkdir6(path12.join(dir, "files"), { recursive: true });
  await mkdir6(path12.join(dir, "trash"), { recursive: true });
  const snapshot = await snapshotProtectedRoots(root2, config.protectedRoots);
  let first = true;
  for (const file of snapshot) {
    const bytes = await readFile10(path12.join(root2, file.path));
    if (digest9(bytes) !== file.sha256) {
      throw new DevFlowError("ROLLBACK_HASH_MISMATCH", "protected files changed while capturing the rollback backup", { path: file.path });
    }
    const blobFile = path12.join(dir, "files", file.sha256);
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
  const captureDrift = snapshotMismatches(manifest.files, await snapshotProtectedRoots(root2, config.protectedRoots));
  if (captureDrift.length) {
    throw new DevFlowError("ROLLBACK_HASH_MISMATCH", "protected files changed while capturing the rollback backup", { mismatches: captureDrift });
  }
}
async function assertPathMatchesBackupExpectation(root2, filePath, expected) {
  const absolute = path12.join(root2, filePath);
  if (expected) {
    let metadata;
    let bytes;
    try {
      metadata = await lstat3(absolute);
      bytes = await readFile10(absolute);
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
  const dir = path12.join(featureDirectory3(root2, featureId), journal.backupDirectory);
  const trash = path12.join(dir, "trash");
  const backup = await readBackupManifest(path12.join(dir, "backup-manifest.json"), journal.transactionId);
  const expectedByPath = new Map(backup.files.map((file) => [file.path, file]));
  for (let index = journal.nextFileIndex; index < journal.filePlan.length; index += 1) {
    const action = journal.filePlan[index];
    if (index === 0) await options.fault?.("before-first-rename");
    await assertPathMatchesBackupExpectation(root2, action.path, expectedByPath.get(action.path));
    const target = path12.join(root2, action.path);
    if (action.action === "restore") {
      const blobFile = path12.join(featureDirectory3(root2, featureId), blobPath(action.blobSha256));
      let bytes;
      try {
        bytes = await readFile10(blobFile);
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
      const trashFile = path12.join(trash, `${String(index).padStart(4, "0")}-${path12.basename(action.path)}`);
      if (await pathExists3(target)) {
        await mkdir6(trash, { recursive: true });
        await rename6(target, trashFile);
        await fsyncDirectory4(path12.dirname(target));
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
        if (await pathExists3(path12.join(root2, action2.path))) {
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
          metadata = await lstat3(path12.join(root2, action2.path));
          bytes = await readFile10(path12.join(root2, action2.path));
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
    for (const commandId of node.rollbackVerification) {
      const command2 = config.verification.commands.find((candidate) => candidate.id === commandId);
      if (!command2) {
        throw new DevFlowError("TRACE_VERIFICATION_COMMAND_UNKNOWN", "rollback verification command is not configured", {
          unitId,
          commandId
        });
      }
      plan.push({ unitId, command: command2 });
    }
  }
  return plan;
}
async function expectedPlanStateAfter(root2, featureId, journal, appliedCount) {
  const manifest = await readBackupManifest(
    path12.join(featureDirectory3(root2, featureId), journal.backupDirectory, "backup-manifest.json"),
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
  const attemptId = randomUUID9();
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
        commandId: command2.id,
        attemptId,
        exitCode: result.exitCode,
        output: result.output.slice(-4e3)
      });
    }
  }
  const expected = await expectedPlanState(root2, featureId, journal);
  const current = await snapshotProtectedRoots(root2, config.protectedRoots);
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
      attemptId,
      mismatches,
      source: "verification-drift"
    });
  }
}
async function recordCompensationAttempt(root2, featureId, journal, attempt) {
  const attemptId = randomUUID9();
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
  const dir = path12.join(featureDirectory3(root2, featureId), journal.backupDirectory);
  const startedAt = (/* @__PURE__ */ new Date()).toISOString();
  try {
    const manifest = await readBackupManifest(path12.join(dir, "backup-manifest.json"), journal.transactionId);
    let restored = 0;
    for (const file of manifest.files) {
      const blobFile = path12.join(dir, "files", file.sha256);
      let bytes;
      try {
        bytes = await readFile10(blobFile);
      } catch {
        throw new DevFlowError("ROLLBACK_BACKUP_CORRUPT", "rollback backup bytes are missing", { path: file.path, sha256: file.sha256 });
      }
      if (digest9(bytes) !== file.sha256) {
        throw new DevFlowError("ROLLBACK_BACKUP_CORRUPT", "rollback backup bytes failed their digest check", { path: file.path, sha256: file.sha256 });
      }
      await writeFileAtomicMode(path12.join(root2, file.path), bytes, file.mode);
      restored += 1;
      if (restored === 1) await options.fault?.("during-compensation");
    }
    const current = await snapshotProtectedRoots(root2, config.protectedRoots);
    const expectedPaths = new Set(manifest.files.map((file) => file.path));
    const trash = path12.join(dir, "trash");
    for (const file of current) {
      if (expectedPaths.has(file.path)) continue;
      const trashFile = path12.join(trash, `extra-${digest9(file.path).slice(0, 16)}-${path12.basename(file.path)}`);
      await mkdir6(trash, { recursive: true });
      await rename6(path12.join(root2, file.path), trashFile);
      await fsyncDirectory4(path12.dirname(path12.join(root2, file.path)));
    }
    const after = await snapshotProtectedRoots(root2, config.protectedRoots);
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
    const review = reviewEnforcementRequired(current.route, current.workflowCapabilities) ? await prepareReviewInvalidation(root2, current, nextStateRevision) : void 0;
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
          delete draft.humanGates.implementation_approval;
          clearInteractionsForTarget(draft, "gate:implementation_approval");
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
        if (review) draft.review = review;
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
  const directory = path12.join(featureDirectory3(root2, featureId), journal.backupDirectory);
  await rm2(path12.join(directory, "files"), { recursive: true, force: true });
  await rm2(path12.join(directory, "trash"), { recursive: true, force: true });
  await rm2(path12.join(directory, "backup-manifest.json"), { force: true });
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
  const transactionId = randomUUID9();
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

// plugins/dev-flow/src/core/status.ts
async function traceStatus(root2, state) {
  const inspection = await inspectCurrentTrace(root2, state);
  return {
    enforced: inspection.enforced,
    ...inspection.enforced && state.traceability ? { pointer: state.traceability } : {},
    ...inspection.effectiveSummary ? { effectiveSummary: inspection.effectiveSummary } : {},
    blockers: inspection.blocker ? [inspection.blocker] : []
  };
}
async function reviewStatus(root2, state) {
  const projection = await readReviewProjection(root2, state);
  return {
    enforced: Boolean(projection),
    ...projection ? { projection: projection.model } : {}
  };
}
async function grillWait(root2, state, action) {
  if (action.kind !== "run-step" || action.step !== "requirements") return { kind: "none" };
  const artifact = state.artifacts.requirements;
  if (!artifact) return { kind: "none" };
  let contents;
  try {
    contents = await readFile11(path13.join(root2, ".dev-flow", "features", state.featureId, artifact.path), "utf8");
  } catch {
    throw new DevFlowError("GRILL_STATUS_INVALID", "registered requirements artifact cannot be read", {
      recoveryHint: "Restore or re-scaffold the requirements artifact through MCP, then record it before continuing"
    });
  }
  const grill = parseGrillFrontMatter(contents);
  if (grill.status !== "in_progress") return { kind: "none" };
  const interaction = findInteractionForTarget(state, `grill:${grill.questionId}`);
  return {
    kind: "grill",
    questionId: grill.questionId,
    responseHint: interaction ? fallbackHint(interaction) : grill.responseHint,
    ...interaction ? { interaction: toPublicInteraction(interaction) } : {}
  };
}
async function buildProgress(root2, state, action) {
  const ordered = routeDefinitionForFeature(state.route, state.workflowCapabilities).orderedSteps;
  const stepTotal = ordered.length;
  let currentStep;
  let stepIndex = stepTotal;
  for (let index = 0; index < ordered.length; index += 1) {
    const step = ordered[index];
    const staleVerification = step === "verification" && action.kind === "run-step" && action.step === "verification";
    if (state.steps[step]?.status === "satisfied" && !staleVerification) continue;
    currentStep = step;
    stepIndex = index + 1;
    break;
  }
  if (state.lifecycle === "finalized" || action.kind === "done") {
    currentStep = void 0;
    stepIndex = stepTotal;
  }
  let wait = { kind: "none" };
  if (action.kind === "present-human-gate" || action.kind === "wait-human-gate") {
    const gate = action.step;
    const interaction = findInteractionForTarget(state, `gate:${gate}`);
    const snapshot = state.humanGates[gate];
    const returned = snapshot?.status === "returned";
    wait = {
      kind: "human-gate",
      gate,
      replyHint: returned ? "\u5DF2\u8BB0\u5F55\u4FEE\u6539\u610F\u89C1\uFF1B\u8BF7\u5148\u66F4\u65B0\u5E76\u767B\u8BB0\u95E8\u7981\u4F9D\u636E\uFF0C\u518D\u5C55\u793A\u65B0\u7684\u786E\u8BA4\u63A7\u4EF6" : interaction ? fallbackHint(interaction) : gateReplyHint(gate),
      ...interaction ? { interaction: toPublicInteraction(interaction) } : {},
      ...returned && snapshot?.lastResponse?.comment ? { feedback: snapshot.lastResponse.comment } : {}
    };
  } else {
    wait = await grillWait(root2, state, action);
  }
  const remainingSteps = ordered.filter((step) => state.steps[step]?.status !== "satisfied" || step === "verification" && action.kind === "run-step" && action.step === "verification");
  const requiredEvidence = action.kind === "run-step" || action.kind === "feature-check" ? action.requiredEvidence : void 0;
  return {
    stepIndex,
    stepTotal,
    currentStep,
    nextAction: action,
    wait,
    remainingSteps,
    ...requiredEvidence ? { requiredEvidence } : {},
    verificationFreshness: await readVerificationFreshness(root2, state),
    acceptanceAssist: {
      suggested: state.classification.acceptanceAssistSuggested ?? state.classification.manualAcceptanceRequired === true,
      blocking: false
    }
  };
}
async function implementationStatus(root2, state, rollback) {
  if (!checkpointsEnforcementRequired(state.route, state.workflowCapabilities)) {
    return { enforced: false, remainingUnitIds: [] };
  }
  let remainingUnitIds = [];
  try {
    const ledger = await readTraceability(root2, state);
    const byUnit = new Map((state.implementationUnits ?? []).map((unit) => [unit.unitId, unit.status]));
    remainingUnitIds = Object.values(ledger.nodes).filter((node) => node.kind === "rollback" && node.status === "current").map((node) => node.id).filter((unitId) => byUnit.get(unitId) !== "checkpointed").sort();
  } catch {
    remainingUnitIds = [];
  }
  const active = (state.implementationUnits ?? []).find((unit) => unit.status === "active");
  return {
    enforced: true,
    ...active ? { activeUnitId: active.unitId } : {},
    ...rollback.chain.length ? { lastCheckpointId: rollback.chain.at(-1).checkpointId } : {},
    remainingUnitIds
  };
}
async function readStatusView(root2, featureId) {
  const state = await readState(root2, featureId);
  const action = await nextAction(root2, featureId);
  const progress = await buildProgress(root2, state, action);
  const rollback = await rollbackChainView(root2, state);
  return {
    ...state,
    progress,
    trace: await traceStatus(root2, state),
    reviewStatus: await reviewStatus(root2, state),
    implementation: await implementationStatus(root2, state, rollback),
    rollback
  };
}

// plugins/dev-flow/src/mcp/doctor.ts
import { lstat as lstat4, readdir as readdir6, readFile as readFile12 } from "node:fs/promises";
import path14 from "node:path";
import { createHash as createHash14 } from "node:crypto";
async function readable(file) {
  try {
    await lstat4(file);
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
    const directory = path14.join(root2, ".dev-flow", "features");
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
  const diagnostics = [];
  const add = (code, status, message, recoveryHint) => diagnostics.push({ code, status, message, ...recoveryHint ? { recoveryHint } : {} });
  const projectFile = path14.join(root2, ".dev-flow", "project.json");
  let project = { initialized: await readable(projectFile), valid: false };
  if (!project.initialized) add("PROJECT_NOT_INITIALIZED", "warning", "run dev_flow_init_project before starting a feature");
  else {
    try {
      await readProjectConfig(root2);
      project.valid = true;
      add("PROJECT_CONFIG_VALID", "ok", "strict project configuration is valid");
    } catch (error) {
      add("PROJECT_CONFIG_INVALID", "error", error instanceof Error ? error.message : String(error));
    }
  }
  const activeFile = path14.join(root2, ".dev-flow", "active.json");
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
        traceState = state;
        activeFeature = { present: true, featureId: state.featureId, valid: state.lifecycle === "active" };
        add(
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
            const raw = await readFile12(path14.join(root2, ".dev-flow", "features", active.featureId, "state.json"));
            digest10 = createHash14("sha256").update(raw).digest("hex");
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
        add("ACTIVE_FEATURE_CORRUPT", "error", message, "Call dev_flow_recover_corrupt_feature with stateSha256, reason, and userEvidence");
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
          activeSha256 = createHash14("sha256").update(await readFile12(activeFile)).digest("hex");
        } catch {
        }
        activeFeature = { present: true, valid: false, corrupt: true, recoveryAction: "abandon" };
        add("ACTIVE_POINTER_CORRUPT", "error", message, "Choose a doctor-reported feature and call dev_flow_recover_corrupt_feature with activeSha256, stateSha256, reason, and userEvidence");
        if (activeSha256) {
          corruptActivePointer = {
            activeSha256,
            candidates: await pointerRecoveryCandidates(root2),
            recoveryHint: "User must explicitly select one candidate feature to abandon. Recovery backs up active.json and the selected feature; it never guesses."
          };
        }
      } else add("ACTIVE_FEATURE_INVALID", "error", message);
    }
  } else add("NO_ACTIVE_FEATURE", "ok", "no active feature is recorded");
  let recoveryTxn;
  try {
    recoveryTxn = await readRecoveryTransaction(root2);
  } catch (error) {
    add("RECOVERY_TRANSACTION_UNREADABLE", "error", error instanceof Error ? error.message : String(error), "Do not start a feature or hand-edit .dev-flow; recovery remains fail-closed");
  }
  if (recoveryTxn) add(
    "RECOVERY_TRANSACTION_OPEN",
    "error",
    `open recovery transaction phase=${String(recoveryTxn.phase)} featureId=${String(recoveryTxn.featureId ?? "")}`,
    "Re-run dev_flow_recover_corrupt_feature with the same doctor-reported input to resume the next safe journal phase"
  );
  const rollbackTransactions = [];
  try {
    const featuresDirectory = path14.join(root2, ".dev-flow", "features");
    const entries = await readdir6(featuresDirectory, { withFileTypes: true });
    for (const entry of entries.filter((candidate) => candidate.isDirectory())) {
      let journal;
      try {
        journal = await readRollbackTransaction(root2, entry.name);
      } catch (error) {
        add(
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
        add("ROLLBACK_TRANSACTION_COMPLETED", "ok", `rollback transaction ${current.transactionId} finished phase=${current.phase} feature=${entry.name}`);
      } else if (blocked) {
        add(
          "ROLLBACK_RECOVERY_BLOCKED",
          "error",
          `rollback recovery is blocked feature=${entry.name} transaction=${current.transactionId}: ${current.error ?? ""}`,
          "Resolve the reported cause, then resume the rollback with the same target checkpoint; the backup scene is preserved"
        );
      } else {
        add(
          "ROLLBACK_TRANSACTION_OPEN",
          "error",
          `open rollback transaction phase=${current.phase} feature=${entry.name} target=${current.targetCheckpointId}`,
          `Resume the rollback with the same target checkpoint ${current.targetCheckpointId} before mutating this feature`
        );
      }
    }
  } catch {
  }
  let trace;
  if (traceState) {
    const enforced = traceEnforcementRequired(traceState.route, traceState.workflowCapabilities);
    const orphanSnapshots = await listOrphanTraceSnapshots(root2, traceState);
    trace = { enforced, pointerPresent: Boolean(traceState.traceability), orphanSnapshots };
    if (!enforced) {
      add(
        traceState.workflowCapabilities ? "TRACE_NOT_REQUIRED" : "TRACE_LEGACY_FEATURE",
        "ok",
        traceState.workflowCapabilities ? "Trace pointer is not required for this route" : "legacy feature has no Trace capability stamp"
      );
    } else {
      try {
        await readTraceability(root2, traceState);
        add("TRACE_POINTER_VALID", "ok", "current Trace pointer and snapshot are valid");
      } catch (error) {
        add(
          "TRACE_POINTER_INVALID",
          "error",
          error instanceof Error ? error.message : String(error),
          "Restore the referenced Trace snapshot or re-register the current Trace artifact; doctor will not select a replacement snapshot automatically"
        );
      }
    }
    if (orphanSnapshots.length) {
      add(
        "TRACE_ORPHAN_SNAPSHOTS",
        "warning",
        `unreferenced Trace snapshots: ${orphanSnapshots.join(", ")}`,
        "Orphan snapshots are retained for diagnosis; do not hand-edit state or select an orphan as the current pointer"
      );
    }
  }
  let review;
  if (traceState) {
    const enforced = reviewEnforcementRequired(traceState.route, traceState.workflowCapabilities);
    const orphanSnapshots = await listOrphanReviewSnapshots(root2, traceState);
    review = { enforced, pointerPresent: Boolean(traceState.review), orphanSnapshots };
    if (!enforced) {
      add(
        traceState.workflowCapabilities ? "REVIEW_NOT_REQUIRED" : "REVIEW_LEGACY_FEATURE",
        "ok",
        traceState.workflowCapabilities ? "Review pointer is not required for this route" : "legacy feature has no Review capability stamp"
      );
    } else {
      try {
        await readReviewLedger(root2, traceState);
        add("REVIEW_POINTER_VALID", "ok", "current review pointer and snapshot are valid");
      } catch (error) {
        add(
          "REVIEW_POINTER_INVALID",
          "error",
          error instanceof Error ? error.message : String(error),
          "Restore the referenced review snapshot; doctor will not select a replacement snapshot automatically"
        );
      }
    }
    if (orphanSnapshots.length) {
      add(
        "REVIEW_ORPHAN_SNAPSHOTS",
        "warning",
        `unreferenced review snapshots: ${orphanSnapshots.join(", ")}`,
        "Orphan snapshots are retained for diagnosis; do not hand-edit state or select an orphan as the current pointer"
      );
    }
  }
  const paths = {
    claudeManifest: path14.join(pluginRoot2, ".claude-plugin", "plugin.json"),
    codexManifest: path14.join(pluginRoot2, ".codex-plugin", "plugin.json"),
    mcp: path14.join(pluginRoot2, ".mcp.json"),
    claudeHooks: path14.join(pluginRoot2, "hosts", "claude", "hooks.json"),
    codexHooks: path14.join(pluginRoot2, "hosts", "codex", "hooks.json"),
    mcpBundle: path14.join(pluginRoot2, "dist", "mcp-server.mjs"),
    claudeBundle: path14.join(pluginRoot2, "dist", "claude-hook.mjs"),
    codexBundle: path14.join(pluginRoot2, "dist", "codex-hook.mjs")
  };
  const files = await Promise.all(Object.entries(paths).map(async ([name, file]) => [name, await readable(file)]));
  const missing = files.filter(([, exists]) => !exists).map(([name]) => name);
  add(missing.length ? "PLUGIN_FILES_MISSING" : "PLUGIN_FILES_PRESENT", missing.length ? "error" : "ok", missing.length ? `missing plugin files: ${missing.join(", ")}` : "manifests, hooks, MCP configuration and bundles are present");
  const jsonFiles = [paths.claudeManifest, paths.codexManifest, paths.mcp, paths.claudeHooks, paths.codexHooks];
  const invalidJson = (await Promise.all(jsonFiles.map(async (file) => !await validJson(file)))).some(Boolean);
  add(invalidJson ? "PLUGIN_WIRING_INVALID" : "PLUGIN_WIRING_VALID", invalidJson ? "error" : "ok", invalidJson ? "a manifest, MCP file, or hook file is not valid JSON" : "plugin manifest, MCP and hook wiring parse successfully");
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
    trace: trace ?? null,
    review: review ?? null,
    mcp: { server: "running", configuration: !invalidJson },
    diagnostics
  };
}

// plugins/dev-flow/src/mcp/attention.ts
import { execFile as execFile4 } from "node:child_process";
import { promisify as promisify4 } from "node:util";

// plugins/dev-flow/src/mcp/windows-notifications.ts
import { execFile as execFile3 } from "node:child_process";
import { access as access4 } from "node:fs/promises";
import path15 from "node:path";
import { promisify as promisify3 } from "node:util";
var run3 = promisify3(execFile3);
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
  return appData ? path15.win32.join(appData, "Microsoft", "Windows", "Start Menu", "Programs", shortcutName) : void 0;
}
async function command(file, args) {
  return run3(file, args);
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
$workingDirectory = ${powerShellLiteral(path15.win32.dirname(shortcutPath))}
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
var run4 = promisify4(execFile4);
function messageFor(event) {
  if (event.kind === "workflow-finalized") {
    return { title: "Dev Flow \u5DF2\u5B8C\u6210", body: `\u529F\u80FD ${event.featureId} \u5DF2\u5B8C\u6210\u5E76\u751F\u6210\u4EA4\u4ED8\u5FEB\u7167\u3002` };
  }
  const decision = event.decision === "requirement_confirmation" ? "\u9700\u6C42\u786E\u8BA4" : event.decision === "implementation_approval" ? "\u786E\u8BA4\u6267\u884C" : event.decision === "rollback-confirmation" ? "\u56DE\u64A4\u786E\u8BA4" : "\u9700\u6C42\u9009\u62E9";
  return { title: "Dev Flow \u9700\u8981\u51B3\u7B56", body: `\u529F\u80FD ${event.featureId} \u6B63\u5728\u7B49\u5F85\u4F60\u7684${decision}\u3002` };
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
    await (options.execute ?? ((file, args) => run4(file, args)))("osascript", ["-e", script]);
  } catch {
  }
}

// plugins/dev-flow/src/mcp/server.ts
var root = process.cwd();
var moduleDirectory = path16.dirname(fileURLToPath(import.meta.url));
var pluginRoot = path16.basename(moduleDirectory) === "dist" ? path16.resolve(moduleDirectory, "..") : path16.resolve(moduleDirectory, "../..");
var tools = [
  "dev_flow_init_project",
  "dev_flow_classify",
  "dev_flow_start",
  "dev_flow_status",
  "dev_flow_next",
  "dev_flow_switch_active",
  "dev_flow_scaffold_artifact",
  "dev_flow_record_artifact",
  "dev_flow_record_step",
  "dev_flow_record_artifact_with_trace",
  "dev_flow_get_traceability",
  "dev_flow_create_review_batch",
  "dev_flow_get_review_job",
  "dev_flow_claim_review_job",
  "dev_flow_submit_review_job",
  "dev_flow_sample_review_job",
  "dev_flow_present_review_risk_acceptance",
  "dev_flow_resolve_review_risk_acceptance",
  "dev_flow_present_gate",
  "dev_flow_confirm_gate",
  "dev_flow_reclassify",
  "dev_flow_verify",
  "dev_flow_respond_interaction",
  "dev_flow_request_grill_decision",
  "dev_flow_resolve_grill_decision",
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
var featureMutation = (extra = {}) => object(
  ["featureId", "expectedRevision"],
  { featureId: string, expectedRevision: integer, ...extra }
);
var riskLabelsSchema = { type: "array", items: { enum: allowedRiskLabels }, uniqueItems: true };
var traceArtifactKinds2 = ["requirements", "implementation-plan", "coverage-matrix", "rollback-units"];
var traceId = (prefix) => ({ type: "string", pattern: `^${prefix}-[0-9]{3,}$` });
var stringArray = { type: "array", minItems: 1, items: string };
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
    forwardVerification: stringArray,
    rollbackVerification: stringArray
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
var manualAcceptanceSchema = object(["mode", "source", "scenarios"], {
  mode: { enum: ["browser", "user-signoff", "code-path-audit"] },
  source: string,
  promptEventId: string,
  userReply: string,
  scenarios: {
    type: "array",
    minItems: 1,
    items: object(["name", "evidence"], { name: string, evidence: string })
  }
});
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
    inputSchema: object(["level", "topology"], {
      level: { enum: ["XS", "S", "M", "L"] },
      topology: { enum: ["local", "shared-contract", "multi-chain", "coordinated-rollback"] },
      execution: { enum: ["light", "standard"] },
      requirements: { enum: ["missing-or-unclear", "documented-unconfirmed", "provided-confirmed"] },
      riskLabels: riskLabelsSchema,
      acceptanceAssistSuggested: { type: "boolean", description: "Offer optional browser/user acceptance help; never blocks the route." },
      manualAcceptanceRequired: { type: "boolean" }
    }),
    annotations: { readOnlyHint: true }
  },
  dev_flow_start: {
    description: "Create a classified feature.",
    inputSchema: object(["level", "topology"], {
      level: { enum: ["XS", "S", "M", "L"] },
      topology: { enum: ["local", "shared-contract", "multi-chain", "coordinated-rollback"] },
      execution: { enum: ["light", "standard"] },
      requirements: { enum: ["missing-or-unclear", "documented-unconfirmed", "provided-confirmed"] },
      riskLabels: riskLabelsSchema,
      acceptanceAssistSuggested: { type: "boolean", description: "Offer optional browser/user acceptance help; never blocks the route." },
      manualAcceptanceRequired: { type: "boolean" },
      featureId: string,
      activation: { enum: ["active", "paused"] },
      scope: scopeSchema,
      host: { enum: ["claude", "codex"] }
    })
  },
  dev_flow_status: { description: "Read one feature StatusView (state + progress).", inputSchema: object(["featureId"], { featureId: string }), annotations: { readOnlyHint: true } },
  dev_flow_next: { description: "Return the unique allowed next action.", inputSchema: object(["featureId"], { featureId: string }), annotations: { readOnlyHint: true } },
  dev_flow_switch_active: { description: "Atomically hand off the single active feature.", inputSchema: object(["fromFeatureId", "toFeatureId", "reason"], { fromFeatureId: string, toFeatureId: string, reason: string }) },
  dev_flow_scaffold_artifact: { description: "Create only the current route artifact. For editable artifacts, read the registered path before editing, then record it. Generated status artifacts are read-only: scaffold them and continue with the requested step; do not edit or record them.", inputSchema: featureMutation({ kind: string }) },
  dev_flow_record_artifact: { description: "Register an edited route artifact.", inputSchema: featureMutation({ kind: string }) },
  dev_flow_record_artifact_with_trace: {
    description: "Atomically register one Trace source artifact and its complete Trace delta.",
    inputSchema: featureMutation({ kind: { enum: traceArtifactKinds2 }, traceDelta: traceDeltaSchema })
  },
  dev_flow_get_traceability: {
    description: "Read the current Trace pointer, ledger, effective summary, and current-step blockers.",
    inputSchema: object(["featureId"], { featureId: string }),
    annotations: { readOnlyHint: true }
  },
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
    inputSchema: featureMutation({ batchId: string, jobId: string, claimRequestId: string })
  },
  dev_flow_submit_review_job: {
    description: "Submit one claimed job's structured completion. Optional host attestation can raise multi-agent-attested only; Core still owns assurance.",
    inputSchema: featureMutation({
      batchId: string,
      jobId: string,
      capability: string,
      completion: reviewCompletionSchema,
      attestation: reviewAttestationSchema
    })
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
    inputSchema: featureMutation({ findingIds: { type: "array", minItems: 1, uniqueItems: true, items: string } })
  },
  dev_flow_resolve_review_risk_acceptance: {
    description: "Resolve the one-time risk-acceptance token. Replays are accepted only for the identical prior reply.",
    inputSchema: featureMutation({
      interactionId: string,
      userReply: string,
      promptEventId: string,
      host: { enum: ["claude", "codex"] }
    })
  },
  dev_flow_record_step: { description: "Record the current non-gate route step.", inputSchema: featureMutation({ step: string, evidence: {} }) },
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
    inputSchema: object(["featureId", "expectedRevision", "targetCheckpointId"], { featureId: string, expectedRevision: integer, targetCheckpointId: string })
  },
  dev_flow_execute_rollback: {
    description: "Execute a confirmed rollback as a resumable file transaction. Rolls back to the target checkpoint, undoing all later units in reverse order.",
    inputSchema: object(["featureId", "expectedRevision", "targetCheckpointId"], { featureId: string, expectedRevision: integer, targetCheckpointId: string })
  },
  dev_flow_present_gate: { description: "Present a strict human gate.", inputSchema: featureMutation({ gate: { enum: ["requirement_confirmation", "implementation_approval"] } }) },
  dev_flow_confirm_gate: {
    description: "Confirm a presented gate with later user evidence.",
    inputSchema: featureMutation({
      gate: { enum: ["requirement_confirmation", "implementation_approval"] },
      userReply: string,
      promptEventId: string,
      turnBoundaryEventId: string,
      host: { enum: ["claude", "codex"] }
    })
  },
  dev_flow_respond_interaction: {
    description: "Resolve the current gate through its one-time text-token fallback.",
    inputSchema: featureMutation({
      interactionId: string,
      userReply: string,
      promptEventId: string,
      turnBoundaryEventId: string,
      host: { enum: ["claude", "codex"] }
    })
  },
  dev_flow_request_grill_decision: {
    description: "Present the current grill question as structured choices when the host supports MCP elicitation, otherwise return one-time text replies.",
    inputSchema: featureMutation({
      questionId: string,
      question: string,
      options: { type: "array", minItems: 2, maxItems: 8, items: interactionOptionSchema },
      host: { enum: ["claude", "codex"] }
    })
  },
  dev_flow_resolve_grill_decision: {
    description: "Resolve a current grill question through its one-time text-token fallback.",
    inputSchema: featureMutation({
      interactionId: string,
      userReply: string,
      promptEventId: string,
      host: { enum: ["claude", "codex"] }
    })
  },
  dev_flow_reclassify: {
    description: "Reclassify route (stricter always; same-level standard\u2192light with userEvidence before implementation).",
    inputSchema: featureMutation({ classification: { type: "object" }, reason: string, userEvidence: string })
  },
  dev_flow_verify: {
    description: "Run only configured verification commands and optionally record manual acceptance.",
    inputSchema: featureMutation({
      commandIds: { type: "array", items: string },
      host: { enum: ["claude", "codex"] },
      manualAcceptance: manualAcceptanceSchema
    })
  },
  dev_flow_feature_check: { description: "Check route completeness and fresh evidence.", inputSchema: featureMutation() },
  dev_flow_finalize: { description: "Set logic-complete after all obligations pass.", inputSchema: featureMutation() },
  dev_flow_abandon: { description: "Terminally abandon a non-finalized feature.", inputSchema: featureMutation({ reason: string, userEvidence: string }) },
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
  process.stdout.write(`${JSON.stringify({
    jsonrpc: "2.0",
    id,
    result: {
      content: [{ type: "text", text: JSON.stringify(value) }],
      structuredContent: value
    }
  })}
`);
}
function failure(id, error) {
  const value = error instanceof DevFlowError ? { code: error.code, message: error.message, details: error.details } : { code: "INTERNAL_ERROR", message: error instanceof Error ? error.message : String(error) };
  process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", id, error: { code: -32e3, message: value.message, data: value } })}
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
  } catch {
    throw new DevFlowError("INVALID_TOOL_INPUT", "dev_flow_submit_review_job input does not match its schema");
  }
  if (value.attestation !== void 0) {
    try {
      parseHostAttestation(value.attestation);
    } catch {
      throw new DevFlowError("INVALID_TOOL_INPUT", "dev_flow_submit_review_job attestation does not match its schema");
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
function assertRollbackMutationInput(value, tool) {
  assertReviewMutationInput(value, tool, ["targetCheckpointId"]);
  if (typeof value.targetCheckpointId !== "string" || !value.targetCheckpointId) {
    throw new DevFlowError("INVALID_TOOL_INPUT", `${tool} input does not match its schema`);
  }
}
function interactionEnvelope(state, interaction, interactionOutcome, response) {
  return {
    ...state,
    interaction,
    interactionOutcome,
    ...response ? { response } : {}
  };
}
function rollbackGateMessage(preview) {
  const files = preview.filePlan.map((action) => `${action.action === "restore" ? "\u6062\u590D" : "\u5220\u9664"} ${action.path}`);
  const verification = preview.verificationCommands.map((command2) => `${command2.commandId}: ${command2.command}`);
  return [
    `\u56DE\u64A4\u76EE\u6807\uFF1A${preview.targetUnitId}\uFF08${preview.targetCheckpointId}\uFF09\u3002`,
    `\u5C06\u64A4\u9500 ${preview.undoOrder.length} \u4E2A\u5355\u5143\uFF1A${preview.undoOrder.join(" \u2192 ")}\u3002`,
    `\u6587\u4EF6\u5F71\u54CD\uFF08${files.length}\uFF09\uFF1A${files.length ? files.join("\uFF1B") : "\u65E0"}\u3002`,
    `\u56DE\u64A4\u9A8C\u8BC1\uFF1A${verification.length ? verification.join("\uFF1B") : "\u65E0"}\u3002`,
    "\u786E\u8BA4\u6267\u884C\u56DE\u64A4\uFF1F"
  ].join("\n");
}
function reviewSubmissionEnvelope(result, submittedJobId) {
  const job = result.batch.jobs.find((candidate) => candidate.jobId === submittedJobId);
  if (!job) throw new DevFlowError("REVIEW_INTEGRITY_FAILED", "submitted review job is missing from its batch", { submittedJobId });
  const { claim: _claim, ...publicJob2 } = job;
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
    this.supportsFormElicitation = Object.keys(modes).length === 0 || modes.form !== void 0;
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
      const selected = selectRoute(a);
      return {
        ...selected,
        riskRequirements: deriveRiskRequirements(selected.classification.riskLabels)
      };
    }
    case "dev_flow_start":
      return startFeature(root, { ...a, host: a.host ?? "codex" });
    case "dev_flow_status":
      return readStatusView(root, a.featureId);
    case "dev_flow_next":
      return nextAction(root, a.featureId);
    case "dev_flow_switch_active":
      return switchActive(root, a.fromFeatureId, a.toFeatureId, a.reason);
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
    case "dev_flow_present_review_risk_acceptance": {
      assertReviewMutationInput(a, "dev_flow_present_review_risk_acceptance", [], ["findingIds"]);
      if (!Array.isArray(a.findingIds) || !a.findingIds.length || a.findingIds.some((findingId) => typeof findingId !== "string" || !findingId)) {
        throw new DevFlowError("INVALID_TOOL_INPUT", "dev_flow_present_review_risk_acceptance input does not match its schema");
      }
      const result = await presentReviewRiskAcceptance(root, a.featureId, a.expectedRevision, a.findingIds);
      return interactionEnvelope(result.state, result.interaction, result.idempotent ? "pending" : "presented");
    }
    case "dev_flow_resolve_review_risk_acceptance": {
      assertReviewMutationInput(a, "dev_flow_resolve_review_risk_acceptance", ["interactionId", "userReply", "promptEventId"], ["host"]);
      if (a.host !== void 0 && a.host !== "claude" && a.host !== "codex") {
        throw new DevFlowError("INVALID_TOOL_INPUT", "dev_flow_resolve_review_risk_acceptance input does not match its schema");
      }
      const result = await resolveReviewRiskAcceptanceToken(
        root,
        a.featureId,
        a.expectedRevision,
        a.interactionId,
        a.userReply,
        a.promptEventId,
        a.host ?? "codex"
      );
      const interaction = toPublicInteraction(getInteraction(result.state, a.interactionId));
      return interactionEnvelope(result.state, interaction, result.idempotent ? "accepted" : "resolved", interactionResponse(result.state, a.interactionId));
    }
    case "dev_flow_record_step":
      return recordStep(root, a.featureId, a.expectedRevision, a.step, a.evidence);
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
      assertRollbackMutationInput(a, "dev_flow_present_rollback_gate");
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
        presentation.interaction.id,
        selection.action,
        selection.comment,
        a.host ?? "codex"
      );
      return {
        ...interactionEnvelope(
          state,
          toPublicInteraction(getInteraction(state, presentation.interaction.id)),
          selection.action,
          interactionResponse(state, presentation.interaction.id)
        ),
        preview: presentation.preview
      };
    }
    case "dev_flow_execute_rollback": {
      assertRollbackMutationInput(a, "dev_flow_execute_rollback");
      const result = await executeRollback(root, a.featureId, a.expectedRevision, a.targetCheckpointId);
      return { outcome: result.outcome, state: result.state, transactionId: result.transaction.transactionId };
    }
    case "dev_flow_present_gate": {
      const presentation = await presentGate(root, a.featureId, a.expectedRevision, a.gate);
      emitAttentionNotification({ kind: "decision-required", featureId: a.featureId, decision: a.gate });
      const selection = await connection2.elicit(
        presentation.gateInteraction,
        a.gate === "requirement_confirmation" ? "\u8BF7\u786E\u8BA4\u5F53\u524D\u9700\u6C42\uFF0C\u6216\u63D0\u51FA\u9700\u8981\u4FEE\u6539\u7684\u610F\u89C1\u3002" : "\u8BF7\u786E\u8BA4\u5F53\u524D\u5B9E\u73B0\u8BA1\u5212\uFF0C\u6216\u63D0\u51FA\u9700\u8981\u4FEE\u6539\u7684\u610F\u89C1\u3002"
      );
      if (!selection) return interactionEnvelope(presentation, presentation.gateInteraction, "pending");
      const state = await resolveGateElicitation(
        root,
        a.featureId,
        presentation.revision,
        presentation.gateInteraction.id,
        selection.action,
        selection.comment,
        a.host ?? "codex"
      );
      return interactionEnvelope(
        state,
        presentation.gateInteraction,
        selection.action,
        interactionResponse(state, presentation.gateInteraction.id)
      );
    }
    case "dev_flow_confirm_gate":
      return confirmGate(root, a.featureId, a.expectedRevision, a.gate, a.userReply, { promptEventId: a.promptEventId, turnBoundaryEventId: a.turnBoundaryEventId }, a.host ?? "codex");
    case "dev_flow_respond_interaction": {
      const interaction = getInteraction(await readState(root, a.featureId), a.interactionId);
      if (interaction.kind === "rollback-confirmation") {
        const state2 = await resolveRollbackGateToken(
          root,
          a.featureId,
          a.expectedRevision,
          a.interactionId,
          a.userReply,
          a.host ?? "codex",
          a.promptEventId
        );
        const response2 = interactionResponse(state2, a.interactionId);
        return interactionEnvelope(state2, toPublicInteraction(getInteraction(state2, a.interactionId)), response2?.action ?? "resolved", response2);
      }
      const state = await resolveGateToken(
        root,
        a.featureId,
        a.expectedRevision,
        a.interactionId,
        a.userReply,
        { promptEventId: a.promptEventId, turnBoundaryEventId: a.turnBoundaryEventId },
        a.host ?? "codex"
      );
      const response = interactionResponse(state, a.interactionId);
      return interactionEnvelope(
        state,
        toPublicInteraction(getInteraction(state, a.interactionId)),
        response?.action ?? "resolved",
        response
      );
    }
    case "dev_flow_request_grill_decision": {
      const result = await requestGrillDecision(root, a.featureId, a.expectedRevision, {
        questionId: a.questionId,
        question: a.question,
        options: a.options,
        host: a.host ?? "codex"
      });
      emitAttentionNotification({ kind: "decision-required", featureId: a.featureId, decision: "grill" });
      const selection = await connection2.elicit(result.interaction, result.interaction.question ?? "\u8BF7\u9009\u62E9\u4E00\u4E2A\u65B9\u6848\u3002");
      if (!selection) return interactionEnvelope(result.state, result.interaction, "pending");
      const resolved = await resolveGrillElicitation(
        root,
        a.featureId,
        result.state.revision,
        result.interaction.id,
        selection.action,
        selection.comment,
        a.host ?? "codex"
      );
      return interactionEnvelope(resolved.state, resolved.interaction, selection.action, resolved.response);
    }
    case "dev_flow_resolve_grill_decision": {
      const resolved = await resolveGrillToken(
        root,
        a.featureId,
        a.expectedRevision,
        a.interactionId,
        a.userReply,
        a.promptEventId,
        a.host ?? "codex"
      );
      return interactionEnvelope(resolved.state, resolved.interaction, resolved.response?.action ?? "resolved", resolved.response);
    }
    case "dev_flow_reclassify":
      return reclassifyFeature(root, a.featureId, a.expectedRevision, a.classification, a.reason, a.userEvidence);
    case "dev_flow_verify":
      return runVerification(
        root,
        a.featureId,
        a.expectedRevision,
        a.host ?? "codex",
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
      return collectDoctorReport(root, pluginRoot, "1.7.0", tools);
    case "dev_flow_recover_corrupt_feature":
      return recoverCorruptFeature(root, {
        featureId: a.featureId,
        stateSha256: a.stateSha256,
        activeSha256: a.activeSha256,
        action: a.action,
        reason: a.reason,
        userEvidence: a.userEvidence,
        host: a.host ?? "codex"
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
        serverInfo: { name: "dev-flow", version: "1.7.0" },
        capabilities: { tools: {} },
        instructions: "Classify before starting. Call dev_flow_next and execute exactly one returned action. A presented human gate may open a native structured confirmation control; otherwise use the returned one-time reply. Use dev_flow_init_project before start."
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
      toolResult(message.id, await call(message.params?.name, message.params?.arguments ?? {}, connection));
      return;
    }
    if (message.method === "ping") {
      protocolResult(message.id, {});
      return;
    }
    failure(message.id, new DevFlowError("UNKNOWN_METHOD", String(message.method ?? "missing method")));
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
