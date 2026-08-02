/* dev-flow 2.0.1; built from source, deterministic build */

// plugins/dev-flow/src/hosts/claude-adapter.ts
import { lstat as lstat2 } from "node:fs/promises";
import path12 from "node:path";

// plugins/dev-flow/src/core/state-store.ts
import { randomUUID as randomUUID4, createHash as createHash5 } from "node:crypto";
import { access, mkdir as mkdir4, open as open4, readdir as readdir4, readFile as readFile5, rename as rename4, rm, rmdir, writeFile } from "node:fs/promises";
import { hostname } from "node:os";
import path7 from "node:path";

// plugins/dev-flow/policy/contract.json
var contract_default = {
  schemaVersion: 2,
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
if (contract.schemaVersion !== 2) {
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

// plugins/dev-flow/src/core/errors.ts
var DevFlowError = class extends Error {
  constructor(code, message, details = {}) {
    super(`${code}: ${message}`);
    this.code = code;
    this.details = details;
  }
};

// plugins/dev-flow/src/core/delivery-snapshot.ts
import { execFile } from "node:child_process";
import { promisify } from "node:util";

// plugins/dev-flow/src/core/path-normalization.ts
import path from "node:path";
function normalizeUnicode(value) {
  return value.normalize("NFC");
}
function normalizeProjectPath(value) {
  return path.posix.normalize(normalizeUnicode(value).replaceAll("\\", "/"));
}

// plugins/dev-flow/src/core/delivery-snapshot.ts
var run = promisify(execFile);

// plugins/dev-flow/src/core/fingerprint.ts
import { createHash } from "node:crypto";
import { readdir, readFile, lstat } from "node:fs/promises";
import path2 from "node:path";
var ignored = /* @__PURE__ */ new Set([".git", ".dev-flow", "node_modules"]);
async function collect(root, relative, files) {
  const absolute = path2.join(root, relative);
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
    const target = path2.join(root, child);
    const metadata = await lstat(target);
    if (metadata.isSymbolicLink()) throw new DevFlowError("UNSAFE_PROTECTED_ROOT", `symbolic link is not allowed: ${child}`);
    if (metadata.isDirectory()) await collect(root, child, files);
    else if (metadata.isFile()) files.push(child);
  }
}
async function fingerprintProtectedRoots(root, protectedRoots) {
  const files = [];
  for (const item of [...protectedRoots].sort()) await collect(root, item, files);
  const digest7 = createHash("sha256");
  for (const relative of files.sort()) {
    digest7.update(relative);
    digest7.update("\0");
    digest7.update(await readFile(path2.join(root, relative)));
    digest7.update("\0");
  }
  return digest7.digest("hex");
}
async function snapshotProtectedRoots(root, protectedRoots) {
  const files = [];
  for (const item of [...protectedRoots].sort()) await collect(root, item, files);
  const snapshots = [];
  for (const relative of files.sort()) {
    const absolute = path2.join(root, relative);
    const metadata = await lstat(absolute);
    snapshots.push({
      path: relative,
      sha256: createHash("sha256").update(await readFile(absolute)).digest("hex"),
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
  if (protectedRoots.some((root) => !root || root.startsWith(".dev-flow"))) {
    throw new DevFlowError("INVALID_PROJECT_CONFIG", "protectedRoots must be project-relative non-.dev-flow directories");
  }
  config.protectedRoots = protectedRoots;
  const commands = config.verification?.commands;
  if (!Array.isArray(commands) || !commands.length) throw new DevFlowError("INVALID_PROJECT_CONFIG", "at least one verification command is required");
  const ids = /* @__PURE__ */ new Set();
  for (const command of commands) {
    if (!command?.id || !command.command || !Array.isArray(command.args) || !relativeDirectory(command.cwd)) throw new DevFlowError("INVALID_PROJECT_CONFIG", "invalid verification command");
    if (ids.has(command.id)) throw new DevFlowError("INVALID_PROJECT_CONFIG", "verification command ids must be unique");
    ids.add(command.id);
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
var ROLLBACK_ID = /^RU-[0-9]{3,}$/;
var SHA256 = /^[0-9a-f]{64}$/;
function isSafeFileScopePattern(value) {
  if (typeof value !== "string" || !value || value.trim() !== value) return false;
  if (value.includes("\\") || value.startsWith("/") || /^[A-Za-z]:/.test(value)) return false;
  if (value === ".") return true;
  return value.split("/").every((segment) => segment.length > 0 && segment !== "." && segment !== "..");
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
function isNonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}
function isNonEmptyStringArray(value) {
  return Array.isArray(value) && value.length > 0 && value.every(isNonEmptyString);
}
function implementationUnitForRollbackNode(node, basisHash2) {
  if (!isRecord(node) || node.kind !== "rollback" || !isRollbackId(node.id) || !isNonEmptyStringArray(node.tasks) || !isNonEmptyStringArray(node.fileScope) || !isNonEmptyStringArray(node.forwardVerification) || !isNonEmptyStringArray(node.rollbackVerification) || node.status !== "current") {
    invalid("rollback node is missing fields required to open an implementation unit");
  }
  if (!isSha256(basisHash2)) invalid("implementation unit basis hash must be a SHA-256 hex digest");
  return { unitId: node.id, status: "pending", basisHash: basisHash2 };
}

// plugins/dev-flow/src/core/traceability.ts
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
function currentNodes(nodes) {
  return Object.values(nodes).filter((node) => node.status !== "tombstoned");
}
function nodeById(nodes, id) {
  const node = nodes[id];
  return node?.status === "tombstoned" ? void 0 : node;
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
  return routeDefinitionForFeature(state.route, state.workflowCapabilities).orderedSteps.find((step) => state.steps[step]?.status !== "satisfied");
}

// plugins/dev-flow/src/core/traceability-store.ts
import { createHash as createHash2, randomUUID } from "node:crypto";
import { mkdir, open, readFile as readFile2, readdir as readdir2, rename } from "node:fs/promises";
import path4 from "node:path";
function digest(contents) {
  return createHash2("sha256").update(contents).digest("hex");
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
async function readTraceabilityWithOptions(root, state, options = {}) {
  if (!state.traceability) integrity("Trace pointer is missing", { featureId: state.featureId });
  const pointer = state.traceability;
  const relative = safeSnapshotPath(pointer);
  const file = path4.join(root, ".dev-flow", "features", state.featureId, relative);
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
async function readTraceability(root, state) {
  return readTraceabilityWithOptions(root, state);
}
async function readProjectConfigSnapshot(root) {
  const file = path4.join(root, ".dev-flow", "project.json");
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
async function inspectTraceGate(root, state, step) {
  if (!traceIsEnforced(state)) return { enforced: false };
  const traceStep = traceSliceForWorkflowStep(step);
  let ledger;
  try {
    ledger = await readTraceability(root, state);
    const { sha256 } = await readProjectConfigSnapshot(root);
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
async function inspectCurrentTrace(root, state) {
  if (!traceIsEnforced(state)) return { enforced: false };
  const step = currentOpenStep(state);
  return step ? inspectTraceGate(root, state, step) : { enforced: true };
}
async function assertTraceGateCurrent(root, state, step) {
  const inspection = await inspectTraceGate(root, state, step);
  if (!inspection.blocker) return inspection.ledger;
  throw new DevFlowError(
    inspection.blocker.code,
    `Trace slice is not ready for ${step}`,
    inspection.blocker.details
  );
}

// plugins/dev-flow/src/core/review-store.ts
import { createHash as createHash3, randomUUID as randomUUID2 } from "node:crypto";
import { mkdir as mkdir2, open as open2, readFile as readFile3, readdir as readdir3, rename as rename2 } from "node:fs/promises";
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
var reviewRoles = [
  "requirements-coverage",
  "architecture-testability",
  "rollback-operability",
  "security",
  "data-irreversibility"
];
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

// plugins/dev-flow/src/core/review-store.ts
function sortValue(value) {
  if (Array.isArray(value)) return value.map(sortValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).sort(([left], [right]) => left.localeCompare(right)).map(([key, child]) => [key, sortValue(child)]));
  }
  return value;
}
var digest2 = (contents) => createHash3("sha256").update(contents).digest("hex");
function canonicalReviewValueJson(value) {
  return `${JSON.stringify(sortValue(value), null, 2)}
`;
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
function isRecord3(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function validSamplingAttempt(value) {
  if (!isRecord3(value) || !validHash(value.requestSha256) || typeof value.issuedAt !== "string" || typeof value.leaseExpiresAt !== "string" || value.status !== "issued" && value.status !== "failed" && value.status !== "submitted") return false;
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
  return isRecord3(value) && (value.host === "claude" || value.host === "codex") && typeof value.agentId === "string" && value.agentId.trim().length > 0 && typeof value.issuedAt === "string" && !Number.isNaN(Date.parse(value.issuedAt)) && typeof value.raw === "string" && value.raw.trim().length > 0 && validHash(value.rawSha256) && typeof value.acceptedAt === "string" && digest2(value.raw) === value.rawSha256;
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
function safeSnapshotPath2(pointer) {
  if (!/^review\/snapshots\/[a-f0-9]{64}\.json$/.test(pointer.path) || pointer.path !== `review/snapshots/${pointer.sha256}.json`) integrity2("review pointer path is invalid");
  return pointer.path;
}
async function readReviewLedger(root, state) {
  if (!state.review) integrity2("review pointer is missing", { featureId: state.featureId });
  const pointer = state.review;
  const relative = safeSnapshotPath2(pointer);
  let contents;
  try {
    contents = await readFile3(path5.join(root, ".dev-flow", "features", state.featureId, relative), "utf8");
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

// plugins/dev-flow/src/core/review-projection.ts
import { createHash as createHash4, randomUUID as randomUUID3 } from "node:crypto";
import { mkdir as mkdir3, open as open3, readFile as readFile4, rename as rename3 } from "node:fs/promises";
import path6 from "node:path";
var digest3 = (contents) => createHash4("sha256").update(contents).digest("hex");
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
function projectionDirectory(root, featureId) {
  return path6.join(root, ".dev-flow", "features", featureId, "review", "projections");
}
async function fsyncDirectory(directory) {
  const handle = await open3(directory, "r");
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}
async function writeProjection(root, featureId, markdown) {
  const sha256 = digest3(markdown);
  const directory = projectionDirectory(root, featureId);
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
    await fsyncDirectory(directory);
  }
  return { path: `review/projections/${sha256}.md`, sha256 };
}
async function prepareReviewProjection(root, state) {
  if (!reviewEnforcementRequired(state.route, state.workflowCapabilities)) return;
  if (!state.review) projectionError("review-enabled feature has no review pointer", { featureId: state.featureId });
  const ledger = await readReviewLedger(root, state);
  const model = reviewProjectionModel(state, ledger);
  const artifact = await writeProjection(root, state.featureId, renderReviewProjection(model));
  state.artifacts["plan-review"] = artifact;
}
function validProjectionArtifact(artifact) {
  return Boolean(artifact) && /^review\/projections\/[a-f0-9]{64}\.md$/.test(artifact.path) && /^[a-f0-9]{64}$/.test(artifact.sha256) && artifact.path === `review/projections/${artifact.sha256}.md`;
}
async function readReviewProjection(root, state) {
  if (!reviewEnforcementRequired(state.route, state.workflowCapabilities)) return void 0;
  const artifact = state.artifacts["plan-review"];
  if (!validProjectionArtifact(artifact)) projectionError("review projection artifact pointer is missing or invalid", { featureId: state.featureId });
  let markdown;
  try {
    markdown = await readFile4(path6.join(root, ".dev-flow", "features", state.featureId, artifact.path), "utf8");
  } catch {
    projectionError("review projection artifact cannot be read", { featureId: state.featureId, path: artifact.path });
  }
  if (digest3(markdown) !== artifact.sha256) projectionError("review projection digest does not match artifact pointer", { featureId: state.featureId });
  const ledger = await readReviewLedger(root, state);
  const model = reviewProjectionModel(state, ledger);
  const expected = renderReviewProjection(model);
  if (markdown !== expected) projectionError("review projection does not match the current review ledger", { featureId: state.featureId });
  return { artifact, model, markdown: expected };
}
async function assertCurrentReviewProjection(root, state) {
  await readReviewProjection(root, state);
}

// plugins/dev-flow/src/core/approval-basis.ts
var approvalBasisArtifacts = [
  "requirements",
  "implementation-plan"
];
function approvalIds(state) {
  return (state.obligations ?? []).filter((obligation) => obligation.kind === "approval").map((obligation) => obligation.id);
}
function confirmedApproval(state) {
  for (const approvalId of approvalIds(state)) {
    const record = state.humanGates[approvalId];
    if (record?.status === "confirmed") return { approvalId, record };
  }
  return void 0;
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
  if (state.schemaVersion === 1) throw new DevFlowError("LEGACY_STATE_UNSUPPORTED", "feature state schema v1 is no longer supported", { recoveryHint: "Use the 1.10 doctor to finish or abandon the feature, then start it again under v2" });
  if (state?.schemaVersion !== 2) throw new DevFlowError("UNSUPPORTED_STATE_SCHEMA", "only state schema v2 is supported");
  if (state.mode !== "intake" && state.mode !== "routed") throw new DevFlowError("INVALID_STATE_SCHEMA", "state mode must be intake or routed");
  if (typeof state.featureId !== "string" || !state.featureId || !Number.isInteger(state.revision) || (state.revision ?? -1) < 0 || !lifecycles.has(state.lifecycle) || !state.scope || !Array.isArray(state.scope.inScope) || !Array.isArray(state.scope.outOfScope) || !state.steps || !state.humanGates || !state.artifacts || !state.verification || !Array.isArray(state.verification.attempts) || state.interactions !== void 0 && (typeof state.interactions !== "object" || state.interactions === null || Array.isArray(state.interactions)) || !state.featureCheck || !Array.isArray(state.blockingFindings) || typeof state.logicComplete !== "boolean" || !state.lastUpdatedBy) {
    throw new DevFlowError("INVALID_STATE_SCHEMA", "state is not a valid v2 feature state");
  }
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
    throw new DevFlowError("INVALID_STATE_SCHEMA", "routed v2 state requires classification facts and obligations");
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
var delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
var devFlow = (root) => path7.join(root, ".dev-flow");
var features = (root) => path7.join(devFlow(root), "features");
var statePath = (root, id) => path7.join(features(root), id, "state.json");
var eventPath = (root, id) => path7.join(features(root), id, "events.jsonl");
var activePath = (root) => path7.join(devFlow(root), "active.json");
var recoveryTxnPath = (root) => path7.join(devFlow(root), "recovery-transaction.json");
var rollbackTxnPath = (root, featureId) => path7.join(features(root), featureId, "rollback-transaction.json");
async function readProjectConfig(root) {
  try {
    const value = JSON.parse(await readFile5(path7.join(devFlow(root), "project.json"), "utf8"));
    validateProjectConfig(value);
    return value;
  } catch (error) {
    if (error instanceof DevFlowError) throw error;
    throw new DevFlowError("PROJECT_NOT_INITIALIZED", "run dev_flow_init_project first");
  }
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
async function prepareStatusProjection(root, state, revision) {
  const status = state.artifacts.status;
  if (!status) return;
  const trace = await inspectCurrentTrace(root, state);
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
  const file = path7.join(features(root), state.featureId, status.path);
  state.artifacts.status = { ...status, sha256: createHash5("sha256").update(contents).digest("hex") };
  return async () => {
    await writeFile(file, contents);
  };
}
async function lock(root, featureId, operation) {
  const directory = path7.join(devFlow(root), ".lock");
  const started = Date.now();
  await mkdir4(devFlow(root), { recursive: true });
  while (true) {
    try {
      await mkdir4(directory);
      await writeFile(path7.join(directory, "owner.json"), JSON.stringify({ pid: process.pid, hostname: hostname(), acquiredAt: (/* @__PURE__ */ new Date()).toISOString(), featureId, operation }));
      return async () => {
        await rm(directory, { recursive: true, force: true });
      };
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
      try {
        const owner = JSON.parse(await readFile5(path7.join(directory, "owner.json"), "utf8"));
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
async function readState(root, featureId) {
  try {
    const state = JSON.parse(await readFile5(statePath(root, featureId), "utf8"));
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
async function readActive(root) {
  let raw;
  try {
    raw = await readFile5(activePath(root), "utf8");
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
async function appendEvent(root, id, revision, type, data) {
  const handle = await open4(eventPath(root, id), "a");
  try {
    await handle.writeFile(`${JSON.stringify({ revision, type, at: (/* @__PURE__ */ new Date()).toISOString(), data })}
`);
    await handle.sync();
  } finally {
    await handle.close();
  }
}
async function recordHostEvent(root, hostEvent) {
  const active = await readActive(root);
  if (!active) return;
  const release = await lock(root, active.featureId, "host-event");
  try {
    const state = await readState(root, active.featureId);
    const events = await readFeatureEvents(root, active.featureId);
    const duplicate = events.some((item) => {
      const recorded = item.data;
      return item.type === "host-event" && recorded.host === hostEvent.host && recorded.eventId === hostEvent.eventId;
    });
    if (!duplicate) await appendEvent(root, active.featureId, state.revision, "host-event", { ...hostEvent, at: hostEvent.at ?? (/* @__PURE__ */ new Date()).toISOString() });
  } finally {
    await release();
  }
}
async function readFeatureEvents(root, id) {
  try {
    return (await readFile5(eventPath(root, id), "utf8")).split("\n").filter(Boolean).map((line) => JSON.parse(line));
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }
}
async function mutate(root, id, expectedRevision, operation, mutator, eventData = {}) {
  return mutatePrepared(root, id, expectedRevision, operation, async () => ({ mutate: mutator, eventData }));
}
async function mutatePrepared(root, id, expectedRevision, operation, prepare, options = {}) {
  const release = await lock(root, id, operation);
  try {
    return await mutatePreparedLocked(root, id, expectedRevision, operation, prepare, options);
  } finally {
    await release();
  }
}
async function mutatePreparedLocked(root, id, expectedRevision, operation, prepare, options = {}) {
  const state = await readState(root, id);
  await assertNoOpenRollbackTransaction(root, { featureId: id, transactionId: options.allowRollbackTransaction });
  if (state.revision !== expectedRevision) throw new DevFlowError("STATE_REVISION_CONFLICT", "state revision changed", { currentRevision: state.revision });
  const prepared = await prepare(state, state.revision + 1);
  if (prepared.unchanged) return state;
  await prepared.mutate(state);
  state.revision += 1;
  await prepareReviewProjection(root, state);
  validateFeatureState(state);
  const writeStatus = await prepareStatusProjection(root, state, state.revision);
  await options.fault?.("before-state-commit");
  await writeAtomic(statePath(root, id), state);
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
    await appendEvent(root, id, state.revision, operation, data);
  } catch {
    failures.push("event");
  }
  try {
    const active = await readActive(root);
    if (active?.featureId === id && (state.lifecycle === "finalized" || state.lifecycle === "abandoned")) await rm(activePath(root), { force: true });
    else if (active?.featureId === id) await writeAtomic(activePath(root), { featureId: id, revision: state.revision, updatedAt: (/* @__PURE__ */ new Date()).toISOString() });
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
function validateRecoveryLocation(root, transaction) {
  const recoveredRoot = path7.join(devFlow(root), "recovered");
  const relative = path7.relative(recoveredRoot, transaction.recoveredTo);
  if (!relative || relative.startsWith("..") || path7.isAbsolute(relative) || path7.basename(relative) !== relative) {
    throw new DevFlowError("RECOVERY_TRANSACTION_UNREADABLE", "recovery journal points outside the recovered directory", {
      recoveryHint: "Run dev_flow_doctor; do not start a new feature or hand-edit .dev-flow"
    });
  }
}
async function readRecoveryTransaction(root) {
  let raw;
  try {
    raw = await readFile5(recoveryTxnPath(root), "utf8");
  } catch (error) {
    if (error.code === "ENOENT") return void 0;
    throw new DevFlowError("RECOVERY_TRANSACTION_UNREADABLE", "recovery journal cannot be read", { recoveryHint: "Run dev_flow_doctor; do not start a new feature" });
  }
  try {
    const transaction = JSON.parse(raw);
    validateRecoveryTransaction(transaction);
    validateRecoveryLocation(root, transaction);
    return transaction;
  } catch (error) {
    if (error instanceof DevFlowError) throw error;
    throw new DevFlowError("RECOVERY_TRANSACTION_UNREADABLE", "recovery journal is not valid JSON", { recoveryHint: "Run dev_flow_doctor; do not start a new feature" });
  }
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
async function readRollbackTransaction(root, featureId) {
  let raw;
  try {
    raw = await readFile5(rollbackTxnPath(root, featureId), "utf8");
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
async function assertNoOpenRollbackTransaction(root, allow2) {
  let entries;
  try {
    entries = await readdir4(features(root), { withFileTypes: true });
  } catch (error) {
    if (error.code === "ENOENT") return;
    throw error;
  }
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const transaction = await readRollbackTransaction(root, entry.name);
    if (!transaction || rollbackTransactionFinished(transaction)) continue;
    if (allow2?.featureId === entry.name && allow2.transactionId !== void 0 && allow2.transactionId === transaction.transactionId) continue;
    throw new DevFlowError("ROLLBACK_TRANSACTION_OPEN", "a rollback transaction is open", {
      transactionId: transaction.transactionId,
      featureId: entry.name,
      phase: transaction.phase,
      recoveryHint: `Resume the rollback transaction for feature ${entry.name} with the same input before mutating features`
    });
  }
}

// plugins/dev-flow/src/hosts/adapter-policy.ts
import path11 from "node:path";

// plugins/dev-flow/src/core/git-policy.ts
var readOnly = /* @__PURE__ */ new Set(["status", "diff", "log", "show", "rev-parse", "ls-files", "ls-tree", "cat-file", "name-rev"]);
var write = /* @__PURE__ */ new Set(["add", "commit", "push", "merge", "rebase", "tag", "cherry-pick", "reset"]);
function isReadOnly(subcommand, args) {
  if (readOnly.has(subcommand)) return true;
  const normalized = args.trim();
  if (subcommand === "branch") return normalized === "" || /^(--list|--show-current|-a|-r|-v|-vv)(\s|$)/.test(normalized);
  if (subcommand === "remote") return /^(?:-v|show|get-url)(\s|$)/.test(normalized);
  if (subcommand === "config") return /^(?:--get|--get-all|--list)(\s|$)/.test(normalized);
  if (subcommand === "worktree") return /^list(\s|$)/.test(normalized);
  if (subcommand === "stash") return /^(?:list|show)(\s|$)/.test(normalized);
  return false;
}
function classifyGitCommand(command) {
  const commands = [...command.matchAll(/(?:^|[;&|]\s*|\$\([^)]*?)(?:[A-Za-z_][A-Za-z0-9_]*=(?:"[^"]*"|'[^']*'|\S+)\s+)*(?:command\s+)?git(?:\s+-C\s+(?:"[^"]+"|'[^']+'|\S+))?\s+([\w-]+)([^;&|\n)]*)/g)];
  if (!commands.length) return "other";
  for (const match of commands) {
    const subcommand = match[1];
    const args = match[2] ?? "";
    if (write.has(subcommand) || !isReadOnly(subcommand, args)) return "write";
  }
  return "read";
}
var gitReadOnlyCommands = [...readOnly].sort();

// plugins/dev-flow/src/core/implementation-units.ts
import { createHash as createHash9, randomUUID as randomUUID7 } from "node:crypto";

// plugins/dev-flow/src/core/artifacts.ts
import { createHash as createHash6 } from "node:crypto";
import { readFile as readFile6, writeFile as writeFile2 } from "node:fs/promises";
import path8 from "node:path";
var hash = (value) => createHash6("sha256").update(value).digest("hex");
var featureDirectory = (root, id) => path8.join(root, ".dev-flow", "features", id);
async function assertArtifactCurrent(root, id, state, kind) {
  const artifact = state.artifacts[kind];
  if (!artifact) throw new DevFlowError("MISSING_REQUIRED_ARTIFACT", kind);
  const contents = await readFile6(path8.join(featureDirectory(root, id), normalizeUnicode(artifact.path)), "utf8");
  if (hash(contents) !== artifact.sha256) throw new DevFlowError("ARTIFACT_INTEGRITY_FAILED", kind);
  return contents;
}

// plugins/dev-flow/src/core/checkpoints.ts
import { randomUUID as randomUUID5, createHash as createHash7 } from "node:crypto";
import { access as access2, mkdir as mkdir5, open as open5, readFile as readFile7, readdir as readdir5, rename as rename5 } from "node:fs/promises";
import path9 from "node:path";

// plugins/dev-flow/src/core/verification.ts
import { execFile as execFile2 } from "node:child_process";
import { promisify as promisify2 } from "node:util";
var run2 = promisify2(execFile2);

// plugins/dev-flow/src/core/checkpoints.ts
var digest4 = (value) => createHash7("sha256").update(value).digest("hex");
var featureDirectory2 = (root, featureId) => path9.join(root, ".dev-flow", "features", featureId);
function blobPath(sha256) {
  return `checkpoints/blobs/${sha256}`;
}
function baselinePath(unitId) {
  return `checkpoints/baselines/${unitId}.json`;
}
async function writeAtomic2(file, contents) {
  const temp = `${file}.${randomUUID5()}.tmp`;
  const handle = await open5(temp, "w");
  try {
    await handle.writeFile(contents);
    await handle.sync();
  } finally {
    await handle.close();
  }
  await rename5(temp, file);
  const directory = await open5(path9.dirname(file), "r");
  try {
    await directory.sync();
  } finally {
    await directory.close();
  }
}
async function pathExists(file) {
  try {
    await access2(file);
    return true;
  } catch {
    return false;
  }
}
async function writeBlobIfAbsent(root, featureId, bytes) {
  const sha256 = digest4(bytes);
  const file = path9.join(featureDirectory2(root, featureId), blobPath(sha256));
  if (await pathExists(file)) return sha256;
  await mkdir5(path9.dirname(file), { recursive: true });
  await writeAtomic2(file, bytes);
  return sha256;
}
async function captureUnitBaseline(root, featureId, unitId, snapshot) {
  for (const file2 of snapshot) {
    const bytes = await readFile7(path9.join(root, file2.path));
    if (digest4(bytes) !== file2.sha256) {
      throw new DevFlowError("CHECKPOINT_HASH_MISMATCH", "protected files changed while capturing the unit baseline", { path: file2.path });
    }
    await writeBlobIfAbsent(root, featureId, bytes);
  }
  const baseline = {
    schemaVersion: 1,
    featureId,
    unitId,
    capturedAt: (/* @__PURE__ */ new Date()).toISOString(),
    files: snapshot
  };
  const file = path9.join(featureDirectory2(root, featureId), baselinePath(unitId));
  await mkdir5(path9.dirname(file), { recursive: true });
  await writeAtomic2(file, `${JSON.stringify(baseline, null, 2)}
`);
}

// plugins/dev-flow/src/core/review-jobs.ts
import { createHash as createHash8, randomUUID as randomUUID6 } from "node:crypto";
import { readFile as readFile8 } from "node:fs/promises";
import path10 from "node:path";
var digest5 = (value) => createHash8("sha256").update(value).digest("hex");
var leaseMilliseconds = 60 * 60 * 1e3;
var samplingLeaseMilliseconds = 120 * 1e3;
var basisArtifactKinds = ["requirements", "implementation-plan", "coverage-matrix", "rollback-units"];
function invalid3(code, message, details = {}) {
  throw new DevFlowError(code, message, details);
}
function reviewArtifactKinds(state) {
  return basisArtifactKinds.filter((kind) => Boolean(state.artifacts[kind]));
}
async function deriveReviewInput(root, state) {
  if (!state.traceability) invalid3("REVIEW_BASIS_UNAVAILABLE", "review basis requires a current Trace pointer");
  const trace = await readTraceability(root, state);
  const { config, sha256: projectConfigSha256 } = await readProjectConfigSnapshot(root);
  const frozenArtifacts = await Promise.all(reviewArtifactKinds(state).map(async (kind) => {
    const artifact = state.artifacts[kind];
    if (!artifact) invalid3("REVIEW_BASIS_ARTIFACT_MISSING", `review basis artifact is missing: ${kind}`, { kind });
    let contents;
    try {
      contents = await readFile8(path10.join(root, ".dev-flow", "features", state.featureId, artifact.path), "utf8");
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
  const projectContents = await readFile8(path10.join(root, ".dev-flow", "project.json"), "utf8");
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
  const protectedRootsFingerprint = await fingerprintProtectedRoots(root, config.protectedRoots);
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
async function currentBatchWithBasis(root, state, options = {}) {
  const ledger = await readReviewLedger(root, state);
  const batch = ledger.batches.find((candidate) => candidate.validity === "current");
  if (!batch) invalid3("REVIEW_BATCH_REQUIRED", "a current review batch is required");
  const requireLiveBasis = options.requireLiveBasis ?? !planReviewBoundToBatch(state, batch);
  if (requireLiveBasis) {
    const reviewInput = await deriveReviewInput(root, state);
    if (basisHash(reviewInput.basis) !== batch.basisHash) {
      invalid3("REVIEW_BASIS_STALE", "review batch basis no longer matches current feature state", { batchId: batch.batchId });
    }
  }
  return { ledger, batch };
}
async function assertReviewComplete(root, state) {
  const { ledger, batch } = await currentBatchWithBasis(root, state);
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
  await assertCurrentReviewProjection(root, state);
  return { batchId: batch.batchId, basisHash: batch.basisHash, assuranceLevel: batch.assuranceLevel };
}

// plugins/dev-flow/src/core/implementation-units.ts
var digest6 = (value) => createHash9("sha256").update(value).digest("hex");
function currentRollbackNodes(ledger) {
  return Object.values(ledger?.nodes ?? {}).filter((node) => node.kind === "rollback" && node.status === "current");
}
async function ensureActiveImplementationUnit(root, id, state) {
  if (!checkpointsEnforcementRequired(state.route, state.workflowCapabilities) || currentOpenStep(state) !== "implementation" || !confirmedApproval(state) || (state.implementationUnits ?? []).some((unit) => unit.status === "active")) return state;
  const ledger = await readTraceability(root, state);
  const nodes = currentRollbackNodes(ledger).sort((a, b) => a.id.localeCompare(b.id));
  const statusByUnit = new Map((state.implementationUnits ?? []).map((unit) => [unit.unitId, unit.status]));
  const ready = nodes.find((node) => statusByUnit.get(node.id) !== "checkpointed" && node.dependsOn.every((dependency) => statusByUnit.get(dependency) === "checkpointed"));
  if (!ready) return state;
  return beginImplementationUnit(root, id, state.revision, ready.id);
}
function implementationUnitBasisHash(state) {
  return digest6(canonicalReviewValueJson({
    traceability: state.traceability,
    approval: confirmedApproval(state)?.record ?? null
  }));
}
function implementationUnitWriteBlock(state, ledger, _relativePath) {
  if (!checkpointsEnforcementRequired(state.route, state.workflowCapabilities)) return void 0;
  if (currentOpenStep(state) !== "implementation") return void 0;
  if (!confirmedApproval(state)) return void 0;
  const active = (state.implementationUnits ?? []).find((unit) => unit.status === "active");
  if (!active) {
    return {
      code: "IMPLEMENTATION_UNIT_REQUIRED",
      details: { recoveryHint: "Begin the next rollback unit via dev_flow_begin_implementation_unit before writing protected files" }
    };
  }
  const node = currentRollbackNodes(ledger).find((candidate) => candidate.id === active.unitId);
  if (!node) {
    return {
      code: "IMPLEMENTATION_UNIT_OUT_OF_SCOPE",
      details: { unitId: active.unitId, fileScope: [], path: _relativePath }
    };
  }
  return void 0;
}
async function beginImplementationUnit(root, id, expectedRevision, unitId) {
  return mutate(root, id, expectedRevision, "implementation-unit-begun", async (state) => {
    if (!checkpointsEnforcementRequired(state.route, state.workflowCapabilities)) {
      throw new DevFlowError("IMPLEMENTATION_UNITS_NOT_ENFORCED", "implementation units require a checkpoints:1 standard feature");
    }
    if (currentOpenStep(state) !== "implementation") {
      throw new DevFlowError("STEP_OUT_OF_ORDER", "begin requires the implementation step", { expected: currentOpenStep(state) });
    }
    if (!confirmedApproval(state)) {
      throw new DevFlowError("DEV_FLOW_IMPLEMENTATION_APPROVAL_REQUIRED", "implementation approval must be confirmed before beginning a unit");
    }
    const ledger = await assertTraceGateCurrent(root, state, "implementation");
    for (const kind of ["requirements", "implementation-plan"]) {
      await assertArtifactCurrent(root, id, state, kind);
    }
    if (reviewEnforcementRequired(state.route, state.workflowCapabilities)) {
      await assertReviewComplete(root, state);
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
    const project = await readProjectConfig(root);
    const snapshot = await snapshotProtectedRoots(root, project.protectedRoots);
    await captureUnitBaseline(root, id, unitId, snapshot);
    delete target.checkpointId;
    target.basisHash = basisHash2;
    target.beginNonce = randomUUID7();
    target.status = "active";
    target.startedFingerprint = await fingerprintProtectedRoots(root, project.protectedRoots);
    state.implementationUnits = merged;
  }, { unitId });
}

// plugins/dev-flow/src/core/write-policy.ts
function judgeWrite(context) {
  if (context.recoveryTransactionOpen) return {
    decision: "block",
    reason: "recovery transaction is open",
    recoveryAction: { kind: "refresh-status", reason: "\u5148\u6062\u590D\u672A\u5B8C\u6210\u4E8B\u52A1" }
  };
  if (context.controlPath) return {
    decision: "block",
    reason: "workflow control files are Core-owned",
    recoveryAction: { kind: "use-equivalent-operation", reason: "\u901A\u8FC7 MCP/Core \u53D8\u66F4\u72B6\u6001" }
  };
  if (context.mode === "intake" && context.protectedPath) return {
    decision: "block",
    reason: "intake has no implementation stage",
    recoveryAction: { kind: "refresh-status", reason: "\u5148\u5B8C\u6210\u4E8B\u5B9E\u8C03\u67E5\u5E76\u9501\u5B9A\u8DEF\u7EBF" }
  };
  if (context.stage === "implementation" && context.protectedPath) {
    return context.impactResolved ? { decision: "allow", reason: "implementation writes are semantically in scope; actual diff is audited at unit boundary" } : { decision: "audit", reason: "write target will be classified from post-tool actual diff" };
  }
  if (context.protectedPath) return {
    decision: "block",
    reason: "protected source write is outside implementation stage",
    recoveryAction: { kind: "revise-plan", reason: "\u5C06\u5B9E\u73B0\u5199\u5165\u653E\u5230 implementation stage" }
  };
  return { decision: "allow", reason: "unprotected or scratch write" };
}

// plugins/dev-flow/src/hosts/adapter-policy.ts
function formatPreToolBlock(block) {
  return `${block.code}: ${block.recoveryHint}`;
}
var directWriteTools = /* @__PURE__ */ new Set(["write", "edit", "multiedit", "applypatch", "apply_patch", "patch"]);
var controlFileNames = /* @__PURE__ */ new Set(["state.json", "active.json", "project.json", "events.jsonl", "status.md", "\u72B6\u6001\u6587\u6863.md", "recovery-transaction.json", "recovery-events.jsonl"]);
var scratchHint = "\uFF1B\u4E34\u65F6\u9A8C\u8BC1\u6587\u4EF6\u8BF7\u653E\u5165 scratch/ \u76EE\u5F55";
function toolName(event2) {
  return String(event2.tool_name ?? "").toLowerCase();
}
function isRelevantPreToolUse(event2) {
  const name = toolName(event2);
  return name === "bash" || directWriteTools.has(name);
}
function projectRelative(root, target) {
  const absolute = path11.resolve(root, target);
  const relative = path11.relative(root, absolute);
  if (relative === "" || relative.startsWith("..") || path11.isAbsolute(relative)) return void 0;
  return relative.split(path11.sep).join("/").normalize("NFC");
}
function isProtected(root, target, protectedRoots) {
  const relative = projectRelative(root, target);
  if (!relative) return false;
  return protectedRoots.some((item) => relative === item || relative.startsWith(`${item}/`));
}
function isDevFlowPath(relative) {
  return relative === ".dev-flow" || relative.startsWith(".dev-flow/");
}
function isControlPath(relative) {
  if (!isDevFlowPath(relative)) return false;
  if (/^\.dev-flow\/features\/[^/]+\/traceability(?:\/|$)/.test(relative)) return true;
  if (/^\.dev-flow\/features\/[^/]+\/review\/(?:snapshots|packages|projections)(?:\/|$)/.test(relative)) return true;
  const base = path11.posix.basename(relative);
  if (controlFileNames.has(base)) return true;
  if (relative.includes("/.lock/") || relative.endsWith("/.lock")) return true;
  if (relative === ".dev-flow/active.json" || relative === ".dev-flow/project.json") return true;
  if (relative.includes("/recovered/")) return true;
  if (relative.endsWith("/state.json") || relative.endsWith("/events.jsonl") || relative.endsWith("/status.md") || relative.endsWith("/\u72B6\u6001\u6587\u6863.md")) return true;
  return false;
}
function isGeneratedReviewProjectionPath(kind, artifactPath) {
  return kind === "plan-review" && typeof artifactPath === "string" && /^review\/projections\/[a-f0-9]{64}\.md$/.test(artifactPath);
}
function patchTargets(value) {
  const text = typeof value === "string" ? value : "";
  const targets = /* @__PURE__ */ new Set();
  for (const match of text.matchAll(/^\*\*\* (?:Add|Update|Delete) File: (.+)$/gm)) targets.add(match[1].trim());
  for (const match of text.matchAll(/^(?:---|\+\+\+) (?:a\/|b\/)?(.+)$/gm)) {
    if (match[1] !== "/dev/null") targets.add(match[1].trim());
  }
  return [...targets];
}
function directTargets(event2) {
  const input = event2.tool_input ?? {};
  const targets = [input.file_path, input.path, input.target_file].filter((value) => typeof value === "string");
  for (const key of ["patch", "diff", "input"]) targets.push(...patchTargets(input[key]));
  return targets;
}
var writeSyntaxHint = /(?:^|[;&|]\s*)(?:\w+=\S+\s+)*(?:tee\b|touch\b|mkdir\b|rm\b|mv\b|cp\b|sed\s+-i\b|perl\s+-pi\b)|(?:^|\s)>{1,2}\s*|\s>{1,2}\s*|\bapply_patch\b/;
function stripQuotes(token) {
  if (token.startsWith("'") && token.endsWith("'") || token.startsWith('"') && token.endsWith('"')) return token.slice(1, -1);
  return token;
}
function hasUnresolvedExpansion(token) {
  return /\$|`|\*|\{|\?/.test(token);
}
function shellWords(input) {
  const words = [];
  let current = "";
  let quote;
  for (let index = 0; index < input.length; index += 1) {
    const char = input[index];
    if (quote) {
      if (char === quote) {
        quote = void 0;
        continue;
      }
      if (quote === '"' && char === "\\") return void 0;
      current += char;
      continue;
    }
    if (char === "'" || char === '"') {
      quote = char;
      continue;
    }
    if (/\s/.test(char)) {
      if (current) {
        words.push(current);
        current = "";
      }
      continue;
    }
    if (/[|&;<>()$`*{}?\\]/.test(char)) return void 0;
    current += char;
  }
  if (quote) return void 0;
  if (current) words.push(current);
  return words;
}
function collectPathOperands(words, start) {
  const paths = [];
  let optionsEnded = false;
  for (const word of words.slice(start)) {
    if (!optionsEnded && word === "--") {
      optionsEnded = true;
      continue;
    }
    if (!optionsEnded && word.startsWith("-")) continue;
    if (hasUnresolvedExpansion(word)) return void 0;
    paths.push(word);
  }
  return paths.length ? paths : void 0;
}
function commandWords(segment, command) {
  const match = segment.match(new RegExp(`(?:^|\\s)${command}\\s+([\\s\\S]*)$`));
  if (!match) return void 0;
  return shellWords(match[1]);
}
var heredocDataConsumers = /* @__PURE__ */ new Set(["cat", "tee"]);
function heredocDelimiter(rest) {
  let word = "";
  let index = 0;
  while (index < rest.length && /\s/.test(rest[index])) index += 1;
  while (index < rest.length) {
    const char = rest[index];
    if (char === "'") {
      const end = rest.indexOf("'", index + 1);
      if (end < 0) return void 0;
      word += rest.slice(index + 1, end);
      index = end + 1;
      continue;
    }
    if (char === '"') {
      let cursor = index + 1;
      let inner = "";
      let closed = false;
      while (cursor < rest.length) {
        const current = rest[cursor];
        if (current === '"') {
          closed = true;
          break;
        }
        if (current === "\\" && cursor + 1 < rest.length) {
          const next = rest[cursor + 1];
          if (["$", "`", '"', "\\"].includes(next)) {
            inner += next;
            cursor += 2;
            continue;
          }
          inner += `\\${next}`;
          cursor += 2;
          continue;
        }
        inner += current;
        cursor += 1;
      }
      if (!closed) return void 0;
      word += inner;
      index = cursor + 1;
      continue;
    }
    if (char === "\\") {
      if (index + 1 >= rest.length) return void 0;
      word += rest[index + 1];
      index += 2;
      continue;
    }
    if (/\s/.test(char)) break;
    if (char === "$" || char === "`") return void 0;
    word += char;
    index += 1;
  }
  return word ? { value: word, consumed: index } : void 0;
}
function findHeredocOpener(line) {
  let quote;
  for (let cursor = 0; cursor < line.length - 1; cursor += 1) {
    const char = line[cursor];
    if (quote) {
      if (char === quote) quote = void 0;
      continue;
    }
    if (char === "'" || char === '"') {
      quote = char;
      continue;
    }
    if (char === "$" && line[cursor + 1] === "(" && line[cursor + 2] === "(" || char === "(" && line[cursor + 1] === "(") {
      let depth = 1;
      cursor += char === "$" ? 2 : 1;
      while (depth > 0 && cursor + 1 < line.length) {
        cursor += 1;
        if (line[cursor] === "(" && line[cursor + 1] === "(") {
          depth += 1;
          cursor += 1;
        } else if (line[cursor] === ")" && line[cursor + 1] === ")") {
          depth -= 1;
          cursor += 1;
        }
      }
      continue;
    }
    if (char !== "<" || line[cursor + 1] !== "<" || line[cursor + 2] === "<") continue;
    let restStart = cursor + 2;
    const stripTabs = line[restStart] === "-";
    if (stripTabs) restStart += 1;
    const parsed = heredocDelimiter(line.slice(restStart));
    return {
      delimiter: parsed?.value,
      openerIndex: cursor,
      openerEndIndex: parsed ? restStart + parsed.consumed : line.length,
      stripTabs
    };
  }
  return void 0;
}
function heredocConsumer(line, openerIndex) {
  const lastSegment = line.slice(0, openerIndex).split(/[;&|]\s*/).at(-1) ?? "";
  const withoutEnv = lastSegment.replace(/^(?:\w+=\S+\s+)+/, "");
  const command = withoutEnv.match(/^\s*(?:command\s+)?([A-Za-z0-9_./-]+)/)?.[1];
  return command ? path11.posix.basename(command) : void 0;
}
function maskHeredocBodies(command) {
  const lines = command.split("\n");
  const masked = [...lines];
  let index = 0;
  while (index < lines.length) {
    const opener = findHeredocOpener(lines[index]);
    if (!opener) {
      index += 1;
      continue;
    }
    const consumer = heredocConsumer(lines[index], opener.openerIndex);
    if (opener.delimiter === void 0 || !consumer || !heredocDataConsumers.has(consumer)) {
      return { masked: command, unsafe: true };
    }
    masked[index] = `${lines[index].slice(0, opener.openerIndex)}${lines[index].slice(opener.openerEndIndex)}`;
    if (findHeredocOpener(masked[index])) return { masked: command, unsafe: true };
    let terminatorIndex = -1;
    for (let candidate = index + 1; candidate < lines.length; candidate += 1) {
      const candidateLine = opener.stripTabs ? lines[candidate].replace(/^\t+/, "") : lines[candidate];
      if (candidateLine === opener.delimiter || candidateLine === `${opener.delimiter}\r`) {
        terminatorIndex = candidate;
        break;
      }
    }
    if (terminatorIndex < 0) return { masked: command, unsafe: true };
    for (let body = index + 1; body < terminatorIndex; body += 1) masked[body] = "";
    index = terminatorIndex + 1;
  }
  return { masked: masked.join("\n"), unsafe: false };
}
function analyzeBashWriteTargets(command) {
  const trimmed = command.trim();
  if (!trimmed) return { kind: "read-only" };
  if (/\b(?:sh|bash|zsh)\s+-c\b/.test(trimmed) || /\bxargs\b/.test(trimmed) || /\bapply_patch\b/.test(trimmed)) {
    return { kind: "unresolved", syntax: "unsupported-shell-wrapper" };
  }
  const { masked, unsafe } = maskHeredocBodies(trimmed);
  if (unsafe) return { kind: "unresolved", syntax: "heredoc-unresolved" };
  if (!writeSyntaxHint.test(masked)) return { kind: "read-only" };
  const segments = masked.split(/(?:&&|\|\||;|\n)/).map((part) => part.trim()).filter(Boolean);
  const targets = [];
  let sawDevNull = false;
  const collect2 = (token) => {
    if (token === "/dev/null") {
      sawDevNull = true;
      return;
    }
    targets.push(token);
  };
  for (const segment of segments) {
    const withoutEnv = segment.replace(/^(?:\w+=\S+\s+)+/, "");
    if (/\b(?:python|node|ruby|perl)\b/.test(withoutEnv) && !/\bsed\s+-i\b/.test(withoutEnv) && !/\bperl\s+-pi\b/.test(withoutEnv)) {
      if (writeSyntaxHint.test(withoutEnv)) return { kind: "unresolved", syntax: "interpreter-write" };
    }
    const redirectMatches = [...withoutEnv.matchAll(/(?:^|[^0-9&])>{1,2}\s*([^\s|&;]+)/g)];
    for (const match of redirectMatches) {
      const token = stripQuotes(match[1]);
      if (hasUnresolvedExpansion(token)) return { kind: "unresolved", syntax: "redirect-expansion" };
      collect2(token);
    }
    const teeIndex = withoutEnv.search(/\btee\b/);
    if (teeIndex >= 0) {
      if ((withoutEnv.match(/\btee\b/g) ?? []).length !== 1) return { kind: "unresolved", syntax: "multiple-tee" };
      const words = commandWords(withoutEnv.slice(teeIndex), "tee");
      const paths = words && collectPathOperands(words, 0);
      if (!paths) return { kind: "unresolved", syntax: "tee-args" };
      for (const path13 of paths) collect2(path13);
    }
    const simple = withoutEnv.match(/^(touch|mkdir|rm)\b/);
    if (simple) {
      const words = commandWords(withoutEnv, simple[1]);
      const paths = words && collectPathOperands(words, 0);
      if (!paths) return { kind: "unresolved", syntax: "simple-args" };
      for (const path13 of paths) collect2(path13);
    }
    const moveCopy = withoutEnv.match(/^(mv|cp)\b/);
    if (moveCopy) {
      const words = commandWords(withoutEnv, moveCopy[1]);
      const paths = words && collectPathOperands(words, 0);
      if (!paths || paths.length < 2) return { kind: "unresolved", syntax: "mv-cp-args" };
      if (moveCopy[1] === "mv") for (const path13 of paths) collect2(path13);
      else collect2(paths.at(-1));
    }
    const sed = withoutEnv.match(/^sed\s+(-i\S*)\s+([\s\S]*)$/);
    if (sed) {
      const words = shellWords(sed[2]);
      const paths = words && collectPathOperands(words, 1);
      if (!paths) return { kind: "unresolved", syntax: "sed-args" };
      for (const path13 of paths) collect2(path13);
    }
    const perl = withoutEnv.match(/^perl\s+(-pi\S*)\s+([\s\S]*)$/);
    if (perl) {
      const words = shellWords(perl[2]);
      const firstPath = words?.[0] === "-e" ? 2 : 0;
      const paths = words && collectPathOperands(words, firstPath);
      if (!paths) return { kind: "unresolved", syntax: "perl-args" };
      for (const path13 of paths) collect2(path13);
    }
  }
  if (targets.length === 0) {
    if (sawDevNull || masked !== trimmed) return { kind: "read-only" };
    return { kind: "unresolved", syntax: "write-syntax-no-target" };
  }
  return { kind: "resolved", targets };
}
async function loadActiveWorkflow(root) {
  try {
    const recovery = await readRecoveryTransaction(root);
    if (recovery) {
      try {
        const project2 = await readProjectConfig(root);
        return { kind: "unreadable", reason: `recovery journal is open for ${recovery.featureId}`, protectedRoots: project2.protectedRoots, blockAllWrites: false };
      } catch {
        return { kind: "unreadable", reason: "recovery journal or project.json invalid", blockAllWrites: true };
      }
    }
  } catch {
    return { kind: "unreadable", reason: "recovery journal unreadable", blockAllWrites: true };
  }
  let active;
  try {
    active = await readActive(root);
  } catch {
    try {
      const project2 = await readProjectConfig(root);
      return { kind: "unreadable", reason: "active.json unreadable", protectedRoots: project2.protectedRoots, blockAllWrites: false };
    } catch {
      return { kind: "unreadable", reason: "active.json or project.json unreadable", blockAllWrites: true };
    }
  }
  if (!active) return { kind: "none" };
  let project;
  try {
    project = await readProjectConfig(root);
  } catch {
    return { kind: "unreadable", reason: "project.json invalid", blockAllWrites: true };
  }
  let state;
  let ledger;
  try {
    state = await readState(root, active.featureId);
    if (state.lifecycle !== "active" || active.revision !== state.revision) return { kind: "unreadable", reason: "active pointer does not match active state", protectedRoots: project.protectedRoots, blockAllWrites: false };
    if (state.traceability) ledger = await readTraceability(root, state);
    if (state.review) await readReviewLedger(root, state);
  } catch {
    return { kind: "unreadable", reason: "state invalid", protectedRoots: project.protectedRoots, blockAllWrites: false };
  }
  const allowedArtifacts = /* @__PURE__ */ new Set();
  for (const [kind, artifact] of Object.entries(state.artifacts ?? {})) {
    if (kind === "status" || !artifact?.path) continue;
    if (isGeneratedReviewProjectionPath(kind, artifact.path)) continue;
    if (typeof artifact.path !== "string" || path11.posix.dirname(artifact.path) !== "." || !artifact.path.endsWith(".md")) {
      return { kind: "unreadable", reason: "artifact path invalid", protectedRoots: project.protectedRoots, blockAllWrites: false };
    }
    const relative = `.dev-flow/features/${active.featureId}/${artifact.path}`.split(path11.sep).join("/");
    allowedArtifacts.add(relative);
  }
  const approvalConfirmed = Boolean(confirmedApproval(state));
  return {
    kind: "ready",
    workflow: {
      featureId: active.featureId,
      route: state.route,
      logicComplete: state.logicComplete,
      approvalConfirmed,
      allowedArtifacts,
      protectedRoots: project.protectedRoots,
      state,
      ledger
    }
  };
}
function classifyTarget(root, target, workflow) {
  const relative = projectRelative(root, target);
  if (!relative) {
    return {
      code: "DEV_FLOW_WRITE_TARGET_UNRESOLVED",
      recoveryHint: "\u8BF7\u4F7F\u7528\u80FD\u89E3\u6790\u5230\u4ED3\u5E93\u5185\u7684\u9879\u76EE\u76F8\u5BF9\u8DEF\u5F84\uFF08\u9A8C\u8BC1\u65E5\u5FD7\u8BF7\u5199\u5165\u9879\u76EE\u5185\uFF0C\u4F8B\u5982 vitest.log\uFF09"
    };
  }
  if (isControlPath(relative)) {
    return {
      code: "DEV_FLOW_STATE_MUTATION_FORBIDDEN",
      recoveryHint: "\u5DE5\u4F5C\u6D41\u72B6\u6001\u4EC5\u80FD\u901A\u8FC7 MCP \u53D8\u66F4\uFF1B\u8BF7\u7F16\u8F91\u5DF2\u767B\u8BB0\u8D44\u4EA7\uFF0C\u6216\u5BF9\u635F\u574F\u72B6\u6001\u4F7F\u7528 doctor/recovery"
    };
  }
  if (isDevFlowPath(relative)) {
    if (workflow.allowedArtifacts.has(relative)) return void 0;
    if (relative.startsWith(`.dev-flow/features/${workflow.featureId}/`) && relative.endsWith(".md")) {
      return {
        code: "DEV_FLOW_ARTIFACT_NOT_REGISTERED",
        recoveryHint: "\u8BF7\u5148\u901A\u8FC7 MCP scaffold \u8BE5\u8D44\u4EA7\uFF0C\u7F16\u8F91\u540E\u767B\u8BB0"
      };
    }
    return {
      code: "DEV_FLOW_STATE_MUTATION_FORBIDDEN",
      recoveryHint: "\u4EC5\u53EF\u7F16\u8F91 active feature \u5DF2\u767B\u8BB0\u7684\u975E status Markdown \u8D44\u4EA7"
    };
  }
  if (workflow.state?.mode === "intake") {
    const decision = judgeWrite({ mode: "intake", controlPath: false, protectedPath: isProtected(root, target, workflow.protectedRoots), impactResolved: false });
    if (decision.decision === "block") return { code: "DEV_FLOW_IMPLEMENTATION_APPROVAL_REQUIRED", recoveryHint: "\u8BF7\u5148\u5B8C\u6210 intake \u8C03\u67E5\u5E76\u9501\u5B9A\u57FA\u7840\u8DEF\u7EBF" };
  }
  if (workflow.state?.mode === "routed" && currentOpenStep(workflow.state) === "implementation" && isProtected(root, target, workflow.protectedRoots)) {
    const approvalPending = workflow.state.obligations?.some((obligation) => obligation.kind === "approval" && obligation.status !== "satisfied") ?? false;
    if (approvalPending && !workflow.approvalConfirmed) {
      return {
        code: "DEV_FLOW_IMPLEMENTATION_APPROVAL_REQUIRED",
        recoveryHint: `\u76EE\u6807\u4F4D\u4E8E\u53D7\u4FDD\u62A4\u6839\u76EE\u5F55\uFF1B\u8BF7\u5B8C\u6210\u5F53\u524D\u6267\u884C\u786E\u8BA4\u4E49\u52A1\u540E\u518D\u5199\u5165${scratchHint}`
      };
    }
    const unitBlock = implementationUnitWriteBlock(workflow.state, workflow.ledger, projectRelative(root, target));
    if (unitBlock?.code === "IMPLEMENTATION_UNIT_REQUIRED") {
      return {
        code: "DEV_FLOW_IMPLEMENTATION_UNIT_REQUIRED",
        recoveryHint: "Core \u5C1A\u672A\u51C6\u5907\u5F53\u524D\u56DE\u64A4\u5355\u5143\uFF1B\u8BF7\u81EA\u52A8\u91CD\u8BD5 dev_flow_begin_implementation_unit \u540E\u518D\u5199\u5165 protected \u6587\u4EF6"
      };
    }
    if (unitBlock?.code === "IMPLEMENTATION_UNIT_OUT_OF_SCOPE") {
      return {
        code: "DEV_FLOW_IMPLEMENTATION_UNIT_OUT_OF_SCOPE",
        recoveryHint: "\u5F53\u524D\u56DE\u64A4\u5355\u5143\u5728 Trace \u4E2D\u5DF2\u5931\u6548\uFF1B\u8BF7\u5237\u65B0\u72B6\u6001\u5E76\u4FEE\u590D\u6216\u91CD\u65B0\u767B\u8BB0\u5F53\u524D Trace \u540E\u518D\u5199\u5165"
      };
    }
    const decision = judgeWrite({ mode: "routed", stage: "implementation", controlPath: false, protectedPath: true, impactResolved: true });
    if (decision.decision !== "block") return void 0;
  }
  if (workflow.state && isProtected(root, target, workflow.protectedRoots)) {
    const relative2 = projectRelative(root, target);
    const block = implementationUnitWriteBlock(workflow.state, workflow.ledger, relative2);
    if (block?.code === "IMPLEMENTATION_UNIT_REQUIRED") {
      return {
        code: "DEV_FLOW_IMPLEMENTATION_UNIT_REQUIRED",
        recoveryHint: "\u8BF7\u5148\u901A\u8FC7 dev_flow_begin_implementation_unit \u5F00\u59CB\u4E0B\u4E00\u4E2A\u56DE\u64A4\u5355\u5143\uFF0C\u518D\u5199 protected \u6587\u4EF6"
      };
    }
    if (block?.code === "IMPLEMENTATION_UNIT_OUT_OF_SCOPE") {
      return {
        code: "DEV_FLOW_IMPLEMENTATION_UNIT_OUT_OF_SCOPE",
        recoveryHint: "\u5F53\u524D\u56DE\u64A4\u5355\u5143\u5728 Trace \u4E2D\u5DF2\u5931\u6548\uFF1B\u8BF7\u5237\u65B0\u72B6\u6001\u5E76\u4FEE\u590D\u6216\u91CD\u65B0\u767B\u8BB0\u5F53\u524D Trace \u540E\u518D\u5199\u5165"
      };
    }
  }
  return void 0;
}
async function revokedImplementationApprovalHint(root, featureId) {
  const events = await readFeatureEvents(root, featureId);
  let lastConfirmedIndex = -1;
  for (let index = events.length - 1; index >= 0; index--) {
    const event2 = events[index];
    const data = event2.data;
    if ((event2.type === "approval-confirmed" || event2.type === "approval-interaction-resolved") && typeof data.approval === "string" && data.approval.startsWith("approval:")) {
      lastConfirmedIndex = index;
      break;
    }
  }
  if (lastConfirmedIndex < 0) return void 0;
  for (let index = events.length - 1; index >= lastConfirmedIndex; index--) {
    const event2 = events[index];
    const data = event2.data;
    if ((event2.type === "artifact-recorded" || event2.type === "artifact-recorded-with-trace") && data.kind !== void 0 && approvalBasisArtifacts.includes(data.kind) && data.invalidationReason) {
      return data.kind;
    }
  }
  return void 0;
}
async function augmentApprovalBlock(root, workflow, block) {
  if (block.code !== "DEV_FLOW_IMPLEMENTATION_APPROVAL_REQUIRED") return block;
  const revokedKind = await revokedImplementationApprovalHint(root, workflow.featureId);
  if (!revokedKind) return block;
  return {
    ...block,
    recoveryHint: `\u8BA1\u5212\u4F9D\u636E\uFF08${revokedKind}\uFF09\u5DF2\u5728\u5B9E\u73B0\u6279\u51C6\u540E\u53D8\u66F4\uFF0C\u6279\u51C6\u5DF2\u4F5C\u5E9F\uFF1B\u8BF7\u5148\u5B8C\u6210\u76F8\u5173\u6B65\u9AA4\u5E76\u91CD\u65B0\u786E\u8BA4\u5B9E\u73B0\u6279\u51C6\u540E\u518D\u5199 protected \u6587\u4EF6${scratchHint}`
  };
}
function unreadableBlock(reason2) {
  return {
    code: "DEV_FLOW_WORKFLOW_STATE_UNREADABLE",
    recoveryHint: `\u65E0\u6CD5\u5B89\u5168\u8BFB\u53D6\u6D3B\u52A8\u5DE5\u4F5C\u6D41\uFF08${reason2}\uFF09\uFF1B\u8BF7\u8FD0\u884C dev_flow_doctor\uFF0C\u635F\u574F\u65F6\u4F7F\u7528 recover \u6062\u590D`
  };
}
function unreadableTargetBlock(root, target, workflow) {
  if (workflow.blockAllWrites) return unreadableBlock(workflow.reason);
  const relative = projectRelative(root, target);
  if (!relative || isDevFlowPath(relative) || isProtected(root, target, workflow.protectedRoots ?? [])) return unreadableBlock(workflow.reason);
  return void 0;
}
async function preToolBlockReason(root, event2) {
  const block = await preToolBlock(root, event2);
  return block ? formatPreToolBlock(block) : void 0;
}
async function preToolBlock(root, event2) {
  if (!isRelevantPreToolUse(event2)) return void 0;
  const loaded = await loadActiveWorkflow(root);
  if (loaded.kind === "none") return void 0;
  if (loaded.kind === "unreadable") {
    if (toolName(event2) === "bash") {
      const command2 = typeof event2.tool_input?.command === "string" ? event2.tool_input.command : "";
      if (classifyGitCommand(command2) === "write") return unreadableBlock(loaded.reason);
      const analysis = analyzeBashWriteTargets(command2);
      if (analysis.kind === "read-only") return void 0;
      if (analysis.kind === "unresolved") return unreadableBlock(loaded.reason);
      for (const target of analysis.targets) {
        const block = unreadableTargetBlock(root, target, loaded);
        if (block) return block;
      }
      return void 0;
    }
    const targets2 = directTargets(event2);
    if (!targets2.length) return unreadableBlock(loaded.reason);
    for (const target of targets2) {
      const block = unreadableTargetBlock(root, target, loaded);
      if (block) return block;
    }
    return void 0;
  }
  let { workflow } = loaded;
  const command = typeof event2.tool_input?.command === "string" ? event2.tool_input.command : "";
  const prepareImplementationWrite = async (targets2) => {
    if (!workflow.state || currentOpenStep(workflow.state) !== "implementation" || !targets2.some((target) => isProtected(root, target, workflow.protectedRoots))) return;
    try {
      const prepared = await ensureActiveImplementationUnit(root, workflow.featureId, workflow.state);
      if (prepared.revision !== workflow.state.revision) {
        const refreshed = await loadActiveWorkflow(root);
        if (refreshed.kind === "ready") workflow = refreshed.workflow;
      }
    } catch {
    }
  };
  if (toolName(event2) === "bash" && classifyGitCommand(command) === "write" && !workflow.logicComplete) {
    return {
      code: "DEV_FLOW_GIT_GUARD",
      recoveryHint: "\u529F\u80FD\u5C1A\u672A logic-complete\uFF1B\u8BF7\u5148\u5B8C\u6210 verify\u3001feature-check \u4E0E finalize \u518D\u8FDB\u884C git \u5199\u5165"
    };
  }
  if (toolName(event2) === "bash") {
    const analysis = analyzeBashWriteTargets(command);
    if (analysis.kind === "read-only") return void 0;
    if (analysis.kind === "unresolved") {
      return {
        code: "DEV_FLOW_WRITE_TARGET_UNRESOLVED",
        recoveryHint: "\u8BF7\u62C6\u5206\u786E\u5B9A\u6027\u7684\u5199\u547D\u4EE4\u6216\u4F7F\u7528 MCP \u8D44\u4EA7\u5DE5\u5177\uFF1B\u9A8C\u8BC1\u65E5\u5FD7\u8BF7\u5199\u5165\u9879\u76EE\u5185\u76F8\u5BF9\u8DEF\u5F84\uFF08\u4F8B\u5982 vitest.log\uFF09\uFF0C\u52FF\u6DF7\u7528\u672A\u89E3\u6790\u7684 shell \u5199\u5165"
      };
    }
    await prepareImplementationWrite(analysis.targets);
    for (const target of analysis.targets) {
      const block = classifyTarget(root, target, workflow);
      if (block) return augmentApprovalBlock(root, workflow, block);
    }
    return void 0;
  }
  const targets = directTargets(event2);
  if (!targets.length) {
    return {
      code: "DEV_FLOW_IMPLEMENTATION_APPROVAL_REQUIRED",
      recoveryHint: "\u8865\u4E01\u65E0\u53EF\u89E3\u6790\u76EE\u6807\uFF1B\u5728\u5B9E\u73B0\u6279\u51C6\u524D\u4FDD\u5B88\u62D2\u7EDD"
    };
  }
  await prepareImplementationWrite(targets);
  for (const target of targets) {
    const block = classifyTarget(root, target, workflow);
    if (block) return augmentApprovalBlock(root, workflow, block);
  }
  return void 0;
}

// plugins/dev-flow/src/hosts/claude-adapter.ts
var chunks = [];
for await (const chunk of process.stdin) chunks.push(Buffer.from(chunk));
var event = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
var cwd = event.cwd ?? process.cwd();
var allow = true;
var reason;
if (event.hook_event_name === "PreToolUse") {
  try {
    reason = await preToolBlockReason(cwd, event);
    allow = !reason;
  } catch {
    try {
      await lstat2(path12.join(cwd, ".dev-flow", "active.json"));
      allow = false;
      reason = "DEV_FLOW_WORKFLOW_STATE_UNREADABLE: \u65E0\u6CD5\u5B89\u5168\u8BFB\u53D6\u6D3B\u52A8\u5DE5\u4F5C\u6D41\uFF1B\u8BF7\u8FD0\u884C dev_flow_doctor\uFF0C\u635F\u574F\u65F6\u4F7F\u7528 recover \u6062\u590D";
    } catch (error) {
      if (error.code === "ENOENT") {
        allow = true;
        reason = void 0;
      } else {
        allow = false;
        reason = "DEV_FLOW_WORKFLOW_STATE_UNREADABLE: \u65E0\u6CD5\u5B89\u5168\u68C0\u67E5\u6D3B\u52A8\u5DE5\u4F5C\u6D41\u8DEF\u5F84\uFF1B\u8BF7\u8FD0\u884C dev_flow_doctor";
      }
    }
  }
}
if (event.hook_event_name === "UserPromptSubmit" || event.hook_event_name === "Stop" || event.hook_event_name === "PostToolUse") {
  try {
    const text = event.prompt ?? event.user_prompt ?? event.tool_input?.prompt;
    await recordHostEvent(cwd, {
      eventId: event.event_id ?? `${event.hook_event_name}-${Date.now()}`,
      type: event.hook_event_name === "UserPromptSubmit" ? "user-prompt" : event.hook_event_name === "Stop" ? "turn-boundary" : "tool",
      host: "claude",
      text: typeof text === "string" ? text : void 0
    });
  } catch {
  }
}
process.stdout.write(JSON.stringify(allow ? { continue: true } : { continue: false, decision: "block", reason }) + "\n");
