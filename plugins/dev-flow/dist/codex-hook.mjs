/* dev-flow 5.0.9; built from source, deterministic build */

// plugins/dev-flow/src/core/state-store.ts
import { randomUUID as randomUUID6, createHash as createHash11 } from "node:crypto";
import { access, mkdir as mkdir5, open as open5, readdir as readdir4, readFile as readFile9, rename as rename4, rm, writeFile as writeFile2 } from "node:fs/promises";
import { hostname } from "node:os";
import path11 from "node:path";

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
var EMPTY_GOVERNANCE_LEDGER = Object.freeze({
  decisions: [],
  claims: [],
  authorizations: [],
  credentials: [],
  repositoryFacts: []
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
function routeDefinitionForFeature(route, controlsOrCapabilities) {
  const definition = cloneRouteDefinition(routeDefinition(route));
  if (controlsOrCapabilities && "plan" in controlsOrCapabilities) {
    const controls = controlsOrCapabilities;
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
  } else {
    const normalized = normalizeWorkflowCapabilities(controlsOrCapabilities);
    for (const transition of definition.artifactTransitions ?? []) {
      if (normalized[transition.capability] === 1) moveArtifactToGenerated(definition, transition.artifact, transition.steps);
    }
  }
  validateArtifactModes(definition);
  return definition;
}
function traceEnforcementRequired(route, controlsOrCapabilities) {
  return controlsOrCapabilities && "plan" in controlsOrCapabilities ? controlsOrCapabilities.trace : normalizeWorkflowCapabilities(controlsOrCapabilities).trace === 1 && (route === "m" || route === "l");
}
function reviewEnforcementRequired(route, controlsOrCapabilities) {
  return controlsOrCapabilities && "plan" in controlsOrCapabilities ? controlsOrCapabilities.planReview : normalizeWorkflowCapabilities(controlsOrCapabilities).review === 1 && (route === "m" || route === "l");
}
function reviewLedgerRequired(route, controlsOrCapabilities) {
  return controlsOrCapabilities && "plan" in controlsOrCapabilities ? controlsOrCapabilities.planReview || controlsOrCapabilities.codeReview !== "none" : reviewEnforcementRequired(route, controlsOrCapabilities);
}
function checkpointsEnforcementRequired(route, controlsOrCapabilities) {
  return controlsOrCapabilities && "plan" in controlsOrCapabilities ? controlsOrCapabilities.checkpoints === "unit-chain" && controlsOrCapabilities.trace : normalizeWorkflowCapabilities(controlsOrCapabilities).checkpoints === 1 && traceEnforcementRequired(route, controlsOrCapabilities);
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

// plugins/dev-flow/src/core/schema-migration.ts
import { createHash } from "node:crypto";
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
    recordId: `AUTH-${createHash("sha256").update(`${item.kind}|${item.fingerprint}|${item.at}`).digest("hex").slice(0, 16)}`,
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
    const eventId2 = response.promptEventId ?? interaction.presentationEventId;
    credentials.push({
      recordId: `CRED-${interaction.id}`,
      kind: "credential",
      source: response.source === "elicitation" ? "native-form" : "text",
      host: response.host,
      interactionId: interaction.id,
      ...response.selectedOptionId ? { optionId: response.selectedOptionId } : {},
      ...response.rawReply ?? response.userReply ? { rawText: response.rawReply ?? response.userReply } : {},
      ...eventId2 ? { basis: { kind: "event", eventId: eventId2 } } : {},
      ...response.respondedAt ? { recordedAt: response.respondedAt } : {}
    });
  }
  return credentials;
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
import { execFile } from "node:child_process";
import { createHash as createHash2 } from "node:crypto";
import { readdir, readFile, readlink, realpath, lstat } from "node:fs/promises";
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
function pathWithinFileScope(path17, fileScope) {
  return fileScope.some((pattern) => scopePatternMatches(pattern.normalize("NFC"), path17.normalize("NFC")));
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

// plugins/dev-flow/src/core/fingerprint.ts
var runFile = promisify(execFile);
var ignored = /* @__PURE__ */ new Set([".git", ".dev-flow", "node_modules"]);
function controlPath(relative) {
  return relative === ".git" || relative.startsWith(".git/") || relative === ".dev-flow" || relative.startsWith(".dev-flow/") || relative === "node_modules" || relative.startsWith("node_modules/");
}
function configFor(input) {
  return Array.isArray(input) ? { governedRoots: input } : input;
}
async function collect(root2, relative, files, excludes) {
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
    if (excludes?.some((pattern) => pathWithinFileScope(child, [pattern]))) continue;
    const target = path2.join(root2, child);
    const metadata = await lstat(target);
    if (metadata.isSymbolicLink()) throw new DevFlowError("UNSAFE_PROTECTED_ROOT", `symbolic link is not allowed: ${child}`);
    if (metadata.isDirectory()) await collect(root2, child, files, excludes);
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
  const unique = applyExcludes([...new Set(resolved.map(normalizeProjectPath).filter((file) => !controlPath(file)).filter((file) => withinConfiguredRoot(file, governedRoots)))].sort(), config.governedRootsExclude);
  const tracked = fromGit ? await gitTrackedFiles(root2, governedRoots) : /* @__PURE__ */ new Set();
  for (const relative of unique) {
    let metadata;
    try {
      metadata = await lstat(path2.join(root2, relative));
    } catch (error) {
      if (error.code === "ENOENT") continue;
      throw error;
    }
    if (metadata.isSymbolicLink()) {
      if (!tracked.has(relative)) throw new DevFlowError("UNSAFE_GOVERNED_SYMLINK", `symlink must be Git-tracked: ${relative}`, { path: relative, recoveryHint: "\u8DDF\u8E2A\u8BE5\u4ED3\u5185\u94FE\u63A5\uFF0C\u6216\u5C06\u5176\u6392\u9664\u5728 governedRoots \u4E4B\u5916" });
      const resolvedTarget = await realpath(path2.join(root2, relative));
      const rootPath = await realpath(root2);
      const targetRelative = normalizeProjectPath(path2.relative(rootPath, resolvedTarget));
      if (!targetRelative || targetRelative === ".." || targetRelative.startsWith("../") || path2.isAbsolute(targetRelative) || targetRelative === ".git" || targetRelative.startsWith(".git/") || targetRelative === ".dev-flow" || targetRelative.startsWith(".dev-flow/")) {
        throw new DevFlowError("UNSAFE_GOVERNED_SYMLINK", `symlink target escapes governed safety boundary: ${relative}`, { path: relative, linkTarget: await readlink(path2.join(root2, relative)) });
      }
    }
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
  return present;
}
async function fingerprintGovernedRoots(root2, input) {
  const files = await enumerateProtectedFiles(root2, input);
  const digest7 = createHash2("sha256");
  for (const relative of files) {
    const absolute = path2.join(root2, relative);
    const metadata = await lstat(absolute);
    digest7.update(relative);
    digest7.update("\0");
    if (metadata.isSymbolicLink()) {
      digest7.update("symlink\0");
      digest7.update(await readlink(absolute));
    } else {
      digest7.update("file\0");
      digest7.update(await readFile(absolute));
    }
    digest7.update("\0");
  }
  return digest7.digest("hex");
}
async function snapshotGovernedRoots(root2, input) {
  const files = await enumerateProtectedFiles(root2, input);
  const snapshots = [];
  for (const relative of files) {
    const absolute = path2.join(root2, relative);
    const metadata = await lstat(absolute);
    const symbolic = metadata.isSymbolicLink();
    const bytes = symbolic ? Buffer.from(await readlink(absolute)) : await readFile(absolute);
    snapshots.push({
      path: relative,
      sha256: createHash2("sha256").update(bytes).digest("hex"),
      mode: (metadata.mode & 511).toString(8).padStart(3, "0"),
      kind: symbolic ? "symlink" : "file",
      ...symbolic ? { linkTarget: bytes.toString("utf8") } : {}
    });
  }
  return snapshots;
}

// plugins/dev-flow/src/core/project-config.ts
import path3 from "node:path";
import { createHash as createHash3 } from "node:crypto";
function verificationCommandHashes(config) {
  return Object.fromEntries(config.verification.commands.map((command) => [
    command.id,
    // `provides` is a governance declaration, not executable command
    // identity. Expanding guarantees must not invalidate evidence that ran
    // the same command bytes with the same cwd/args.
    createHash3("sha256").update(JSON.stringify({ id: command.id, command: command.command, args: command.args, cwd: command.cwd })).digest("hex")
  ]));
}
function verificationGuarantees(config) {
  const preflight = new Set(config.verification.preflightCommands ?? []);
  return new Set(config.verification.commands.filter((command) => !preflight.has(command.id)).flatMap((command) => command.provides));
}
function missingVerificationGuarantees(config, required) {
  const available = verificationGuarantees(config);
  return [...new Set(required)].filter((kind) => !available.has(kind));
}
function relativeDirectory(value) {
  return value.length > 0 && !path3.isAbsolute(value) && !value.split(/[\\/]+/).includes("..");
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
  for (const command of commands) {
    if (!command?.id || !command.command || !Array.isArray(command.args) || !relativeDirectory(command.cwd) || !Array.isArray(command.provides) || command.provides.length === 0 || command.provides.some((kind) => !["targeted", "behavior", "integration", "full"].includes(kind))) {
      throw new DevFlowError("INVALID_PROJECT_CONFIG", "verification commands require valid provides guarantees");
    }
    if (command.timeoutMs !== void 0 && (!Number.isInteger(command.timeoutMs) || command.timeoutMs < 1e3)) {
      throw new DevFlowError("INVALID_PROJECT_CONFIG", `verification command ${command.id} timeoutMs must be an integer of at least 1000ms`);
    }
    if (command.maxOutputBytes !== void 0 && (!Number.isInteger(command.maxOutputBytes) || command.maxOutputBytes < 1024)) {
      throw new DevFlowError("INVALID_PROJECT_CONFIG", `verification command ${command.id} maxOutputBytes must be an integer of at least 1024 bytes`);
    }
    if (ids.has(command.id)) throw new DevFlowError("INVALID_PROJECT_CONFIG", "verification command ids must be unique");
    ids.add(command.id);
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

// plugins/dev-flow/src/core/step-order.ts
function currentOpenStep(state) {
  if (state.mode !== "routed") return void 0;
  return routeDefinitionForFeature(state.route, state.classification.controls).orderedSteps.find((step) => state.steps[step]?.status !== "satisfied");
}

// plugins/dev-flow/src/core/traceability-store.ts
import { createHash as createHash4, randomUUID } from "node:crypto";
import { mkdir, open, readFile as readFile2, readdir as readdir2, rename } from "node:fs/promises";
import path4 from "node:path";

// plugins/dev-flow/src/core/traceability.ts
var idPrefix = {
  requirement: "REQ",
  "acceptance-criterion": "AC",
  task: "TASK",
  test: "TEST",
  "implementation-unit": "UNIT",
  rollback: "RU",
  recovery: "REC"
};
function invalid(message, details = {}) {
  throw new DevFlowError("TRACE_GRAPH_INVALID", message, details);
}
function sliceError(code, message, details = {}) {
  throw new DevFlowError(code, message, details);
}
function isRecord(value) {
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
  if (!isRecord(value) || Object.keys(value).some((key) => !["command", "args", "cwd"].includes(key)) || typeof value.command !== "string" || !value.command.trim() || value.args !== void 0 && (!Array.isArray(value.args) || value.args.some((arg) => typeof arg !== "string")) || value.cwd !== void 0 && !isSafeCommandCwd(value.cwd)) return false;
  return true;
}
function isVerificationCommandArray(value) {
  return Array.isArray(value) && value.length > 0 && value.every(isVerificationCommandRef);
}
function assertId(kind, id) {
  if (typeof id !== "string" || !new RegExp(`^${idPrefix[kind]}-[0-9]{3,}$`).test(id)) {
    invalid("node ID does not match its kind", { kind, id });
  }
}
function assertSafeFileScope(fileScope, id, persisted = false) {
  for (const pattern of fileScope) {
    if (persisted && pattern !== normalizeUnicode(pattern)) {
      invalid("persisted rollback fileScope must use Unicode NFC", { id, field: "fileScope", pattern });
    }
    if (!isSafeFileScopePattern(pattern)) {
      invalid(persisted ? "persisted rollback fileScope is unsafe" : "rollback fileScope is unsafe", { id, field: "fileScope", pattern });
    }
  }
}
var dispositionKinds = /* @__PURE__ */ new Set(["behavior-test", "type-check", "rule-check", "file-check", "human-acceptance"]);
function validateVerificationDisposition(value, id) {
  if (!isRecord(value) || Object.keys(value).some((key) => !["kind", "reason", "target"].includes(key)) || typeof value.kind !== "string" || !dispositionKinds.has(value.kind)) {
    invalid("acceptance-criterion verificationDisposition is invalid", { id });
  }
  if (value.kind !== "behavior-test") {
    if (typeof value.reason !== "string" || !value.reason.trim()) {
      invalid("non-behavior verification disposition requires a non-empty reason", { id });
    }
    if (value.target !== void 0 && (typeof value.target !== "string" || !value.target.trim())) {
      invalid("verification disposition target must be a non-empty string", { id });
    }
  } else if (value.reason !== void 0 && typeof value.reason !== "string") {
    invalid("verification disposition reason must be a string", { id });
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
  if (!node || !kinds.includes(node.kind)) invalid("graph reference is missing or has the wrong kind", { id, ...details });
  return node;
}
function assertRollbackDag(nodes) {
  const visiting = /* @__PURE__ */ new Set();
  const visited = /* @__PURE__ */ new Set();
  const visit = (id) => {
    if (visited.has(id)) return;
    if (visiting.has(id)) invalid("rollback dependency graph contains a cycle", { id });
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
    if (visiting.has(id)) invalid("implementation unit dependency graph contains a cycle", { id });
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
  if (!isRecord(value)) invalid("persisted node is not an object", { id: recordId });
  const kind = value.kind;
  if (typeof kind !== "string" || !(kind in idPrefix)) invalid("persisted node has an unknown kind", { id: recordId, kind });
  assertId(kind, value.id);
  if (value.id !== recordId) invalid("persisted node id does not match its record key", { id: recordId, nodeId: value.id });
  if (!statusValues.has(value.status)) invalid("persisted node has an invalid status", { id: recordId, status: value.status });
  if (typeof value.sourceArtifact !== "string" || !sourceArtifacts.has(value.sourceArtifact)) {
    invalid("persisted node has an invalid sourceArtifact", { id: recordId, sourceArtifact: value.sourceArtifact });
  }
  if (typeof value.sourceSha256 !== "string" || !hex64.test(value.sourceSha256)) {
    invalid("persisted node has an invalid sourceSha256", { id: recordId });
  }
  if (typeof value.sourceAnchor !== "string" || !value.sourceAnchor.includes(`id=${value.id}`)) {
    invalid("persisted node has an invalid sourceAnchor", { id: recordId });
  }
  if (typeof value.sourceBlockSha256 !== "string" || !hex64.test(value.sourceBlockSha256)) {
    invalid("persisted node has an invalid sourceBlockSha256", { id: recordId });
  }
  if (kind === "acceptance-criterion") {
    assertId("requirement", value.parentRequirement);
    if (value.verificationDisposition !== void 0) validateVerificationDisposition(value.verificationDisposition, recordId);
  }
  if (kind === "task") {
    if (!isStringArray(value.covers)) invalid("persisted task covers is invalid", { id: recordId });
    assertId("implementation-unit", value.implementationUnit);
    if (value.tdd !== void 0 && value.tdd !== "test-first" && value.tdd !== "direct") {
      invalid("persisted task tdd is invalid", { id: recordId });
    }
  }
  if (kind === "test") {
    if (!isStringArray(value.verifies)) invalid("persisted test verifies is invalid", { id: recordId });
  }
  if (kind === "recovery") {
    if (typeof value.stepRef !== "string" || !/^(?:UNIT|TASK)-[0-9]{3,}$/.test(value.stepRef)) invalid("persisted recovery stepRef is invalid", { id: recordId });
    if (value.recoveryKind !== "rollback" && value.recoveryKind !== "compensation") invalid("persisted recovery recoveryKind is invalid", { id: recordId });
    if (typeof value.method !== "string" || !value.method.trim()) invalid("persisted recovery method is invalid", { id: recordId });
    if (typeof value.riskRef !== "string" || !value.riskRef.trim()) invalid("persisted recovery riskRef is invalid", { id: recordId });
  }
  if (kind === "rollback") {
    for (const [field, allowEmpty] of [["tasks", false], ["dependsOn", true], ["fileScope", false], ["covers", false], ["forwardVerification", false], ["rollbackVerification", false]]) {
      if (field === "forwardVerification" || field === "rollbackVerification") {
        if (!isVerificationCommandArray(value[field])) invalid("persisted rollback verification field is invalid", { id: recordId, field });
      } else if (!isStringArray(value[field], allowEmpty)) {
        invalid("persisted rollback field is invalid", { id: recordId, field });
      }
    }
    if (value.sourceArtifact !== "implementation-plan" && value.sourceArtifact !== "rollback-units") {
      invalid("persisted rollback has an invalid sourceArtifact", { id: recordId });
    }
    if (typeof value.verificationConfigSha256 !== "string" || !hex64.test(value.verificationConfigSha256)) {
      invalid("persisted rollback has an invalid verificationConfigSha256", { id: recordId });
    }
    const allowLegacyRepair = value.status !== "tombstoned" && value.sourceArtifact === options.allowUnsafeFileScopeSourceArtifact;
    if (value.status !== "tombstoned" && !allowLegacyRepair) {
      assertSafeFileScope(value.fileScope, recordId, true);
    }
  }
  if (kind === "implementation-unit") {
    if (!isStringArray(value.tasks) || !isStringArray(value.dependsOn, true) || !isStringArray(value.fileScope) || !isStringArray(value.covers) || !isVerificationCommandArray(value.forwardVerification)) {
      invalid("persisted implementation unit fields are invalid", { id: recordId });
    }
    for (const taskId of value.tasks) assertId("task", taskId);
    for (const dependency of value.dependsOn) assertId("implementation-unit", dependency);
    assertSafeFileScope(value.fileScope, recordId, true);
    if (typeof value.verificationConfigSha256 !== "string" || !hex64.test(value.verificationConfigSha256)) invalid("persisted implementation unit verification configuration is invalid", { id: recordId });
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
  if (typeof ledger.featureId !== "string" || !ledger.featureId) invalid("ledger featureId is invalid");
  if (!Number.isInteger(ledger.revision) || ledger.revision < 0) invalid("ledger revision is invalid");
  if (!Number.isInteger(ledger.stateRevision) || ledger.stateRevision < 0) invalid("ledger stateRevision is invalid");
  if (typeof ledger.projectConfigSha256 !== "string" || !hex64.test(ledger.projectConfigSha256)) {
    invalid("ledger projectConfigSha256 is invalid");
  }
  if (ledger.verificationCommandHashes !== void 0 && (!isRecord(ledger.verificationCommandHashes) || Object.values(ledger.verificationCommandHashes).some((value) => typeof value !== "string" || !hex64.test(value)))) {
    invalid("ledger verification command hashes are invalid");
  }
  for (const [id, node] of Object.entries(ledger.nodes)) assertPersistedNode(id, node, options);
}
function validateTraceGraph(ledger, route, mode, options = {}) {
  if (!isRecord(ledger) || ledger.schemaVersion !== 1 || !isRecord(ledger.nodes) || !Array.isArray(ledger.edges)) invalid("traceability ledger has an invalid shape");
  assertPersistedLedgerShape(ledger, options);
  const nodes = ledger.nodes;
  for (const node of currentNodes(nodes)) {
    if (node.kind === "acceptance-criterion") assertReference(nodes, node.parentRequirement, ["requirement"], { from: node.id });
    if (node.kind === "task") {
      if (node.covers.length === 0) invalid("task cannot be orphaned", { id: node.id });
      for (const covered of node.covers) assertReference(nodes, covered, ["requirement", "acceptance-criterion"], { from: node.id });
      const unit = nodeById(nodes, node.implementationUnit);
      if (!unit && !(route === "l" && mode === "partial")) invalid("task references a missing implementation unit", { id: node.id, implementationUnit: node.implementationUnit });
      if (unit && unit.kind !== "implementation-unit") invalid("task implementation unit has the wrong kind", { id: node.id });
      if (unit?.kind === "implementation-unit" && !unit.tasks.includes(node.id)) {
        invalid("implementation unit must list the task", { id: node.id, implementationUnit: node.implementationUnit });
      }
    }
    if (node.kind === "test") for (const verified of node.verifies) assertReference(nodes, verified, ["acceptance-criterion"], { from: node.id });
    if (node.kind === "rollback") {
      for (const taskId of node.tasks) {
        const task = assertReference(nodes, taskId, ["task"], { from: node.id });
        if (task.kind !== "task") invalid("rollback arrangement task reference is invalid", { id: node.id, taskId });
      }
      for (const dependency of node.dependsOn) assertReference(nodes, dependency, ["rollback"], { from: node.id });
      for (const covered of node.covers) assertReference(nodes, covered, ["requirement", "acceptance-criterion"], { from: node.id });
    }
    if (node.kind === "implementation-unit") {
      for (const taskId of node.tasks) {
        const task = assertReference(nodes, taskId, ["task"], { from: node.id });
        if (task.kind !== "task" || task.implementationUnit !== node.id) invalid("implementation unit tasks must be symmetric with task implementationUnit", { id: node.id, taskId });
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
  if (!sameEdges(ledger.edges, edges)) invalid("ledger edges do not match nodes");
  if (!sameSummary(ledger.summary, traceSummary(nodes))) invalid("ledger summary does not match nodes");
  if (mode === "complete") {
    const kinds = new Set(currentNodes(nodes).map((node) => node.kind));
    for (const kind of ["requirement", "acceptance-criterion", "task", "implementation-unit"]) if (!kinds.has(kind)) invalid("complete graph is missing a required node kind", { kind });
    if (currentNodes(nodes).some((node) => node.status !== "current")) invalid("complete graph cannot contain stale nodes");
    for (const node of currentNodes(nodes)) {
      if (node.kind === "acceptance-criterion" && !acceptanceCriterionCovered(nodes, node)) {
        invalid("every acceptance criterion requires a test or an explicit verification disposition", { id: node.id });
      }
    }
  }
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
function digest(contents) {
  return createHash4("sha256").update(contents).digest("hex");
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
async function readProjectConfigSnapshot(root2) {
  const file = path4.join(root2, ".dev-flow", "project.json");
  let raw;
  try {
    raw = await readFile2(file, "utf8");
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
  return { config, sha256: digest(raw), contents: raw };
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
import { createHash as createHash5, randomUUID as randomUUID2 } from "node:crypto";
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
var digest2 = (contents) => createHash5("sha256").update(contents).digest("hex");
function canonicalReviewValueJson(value) {
  return `${JSON.stringify(sortValue(value), null, 2)}
`;
}
function semanticReviewBasisHash(basis) {
  const { projectConfigSha256: _projectConfigSha256, verificationCommandHashes: _verificationCommandHashes, ...semanticBasis } = basis;
  return digest2(canonicalReviewValueJson(semanticBasis));
}
function validBasisHash(basis, basisHash2) {
  return basisHash2 === digest2(canonicalReviewValueJson(basis)) || basisHash2 === semanticReviewBasisHash(basis);
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
function isRecord2(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function validSamplingAttempt(value) {
  if (!isRecord2(value) || !validHash(value.requestSha256) || typeof value.issuedAt !== "string" || typeof value.leaseExpiresAt !== "string" || value.status !== "issued" && value.status !== "failed" && value.status !== "submitted") return false;
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
  return isRecord2(value) && (value.host === "claude" || value.host === "codex") && typeof value.agentId === "string" && value.agentId.trim().length > 0 && typeof value.issuedAt === "string" && !Number.isNaN(Date.parse(value.issuedAt)) && typeof value.raw === "string" && value.raw.trim().length > 0 && validHash(value.rawSha256) && typeof value.acceptedAt === "string" && digest2(value.raw) === value.rawSha256;
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
    for (const event2 of ledger.findingEvents) {
      if (!event2 || typeof event2 !== "object" || typeof event2.type !== "string" || typeof event2.at !== "string") integrity2("review finding event has an invalid shape");
      if (event2.type === "origin") {
        if (!event2.finding || typeof event2.finding.findingId !== "string" || origins.has(event2.finding.findingId)) integrity2("review finding origin is missing or duplicated");
        origins.add(event2.finding.findingId);
      } else if (typeof event2.findingId !== "string" || !origins.has(event2.findingId)) {
        integrity2("review finding event references an unknown origin", { findingId: event2.findingId });
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

// plugins/dev-flow/src/core/workspace-store.ts
import { lstat as lstat2, readFile as readFile4, readlink as readlink2 } from "node:fs/promises";
import path6 from "node:path";
import { createHash as createHash6 } from "node:crypto";
async function trustedWriteSummary(root2, file) {
  const target = path6.join(root2, file);
  try {
    const metadata = await lstat2(target);
    const bytes = metadata.isSymbolicLink() ? Buffer.from(await readlink2(target)) : await readFile4(target);
    return `${metadata.isSymbolicLink() ? "symlink" : "file"}:${createHash6("sha256").update(bytes).digest("hex")}`;
  } catch (error) {
    if (error.code === "ENOENT") return "missing";
    throw error;
  }
}

// plugins/dev-flow/src/core/review-projection.ts
import { createHash as createHash7, randomUUID as randomUUID3 } from "node:crypto";
import { mkdir as mkdir3, open as open3, readFile as readFile5, rename as rename3 } from "node:fs/promises";
import path7 from "node:path";

// plugins/dev-flow/src/core/review-findings.ts
function eventsFor(ledger, findingId) {
  return (ledger.findingEvents ?? []).filter((event2) => event2.type === "origin" ? event2.finding.findingId === findingId : event2.findingId === findingId);
}
function originFor(ledger, findingId) {
  return (ledger.findingEvents ?? []).find((event2) => event2.type === "origin" && event2.finding.findingId === findingId);
}
function latestEvent(events) {
  return events.filter((event2) => event2.type !== "origin").at(-1);
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
  const ids = new Set((ledger.findingEvents ?? []).filter((event2) => event2.type === "origin" && event2.finding.severity === "blocking").map((event2) => event2.finding.findingId));
  return [...ids].map((findingId) => effectiveFindingState(ledger, findingId, currentBasisHash)).filter((state) => Boolean(state?.blocking)).map((state) => state.origin.finding);
}

// plugins/dev-flow/src/core/review-projection.ts
var digest3 = (contents) => createHash7("sha256").update(contents).digest("hex");
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
  return path7.join(root2, ".dev-flow", "features", featureId, "review", "projections");
}
async function fsyncDirectory(directory) {
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
  const target = path7.join(directory, `${sha256}.md`);
  await mkdir3(directory, { recursive: true });
  try {
    const existing = await readFile5(target, "utf8");
    if (existing !== markdown) projectionError("existing review projection does not match its content address");
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    const temporary = path7.join(directory, `.${sha256}.${randomUUID3()}.tmp`);
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
    await fsyncDirectory(directory);
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
    markdown = await readFile5(path7.join(root2, ".dev-flow", "features", state.featureId, artifact.path), "utf8");
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

// plugins/dev-flow/src/core/git-reconciliation.ts
import { execFile as execFile2 } from "node:child_process";
import { createHash as createHash8 } from "node:crypto";
import { lstat as lstat3, readFile as readFile6 } from "node:fs/promises";
import path8 from "node:path";
import { promisify as promisify2 } from "node:util";
var run = promisify2(execFile2);
async function git(root2, args, allowExitOne = false) {
  try {
    const result = await run("git", args, { cwd: root2, encoding: "buffer", maxBuffer: 8 * 1024 * 1024 });
    return Buffer.from(result.stdout).toString("utf8");
  } catch (error) {
    const failure = error;
    if (allowExitOne && failure.code === 1) return Buffer.from(failure.stdout ?? "").toString("utf8");
    throw new DevFlowError("GIT_LINEAGE_UNAVAILABLE", "\u65E0\u6CD5\u8BFB\u53D6\u5F53\u524D Git \u5DE5\u4F5C\u533A\u3002", {
      cause: Buffer.from(failure.stderr ?? failure.message ?? "").toString("utf8").trim() || "Git \u547D\u4EE4\u5931\u8D25\u3002",
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
    const metadata = await lstat3(path8.join(root2, relative));
    if (!metadata.isFile()) return void 0;
    return createHash8("sha256").update(await readFile6(path8.join(root2, relative))).digest("hex");
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
    const failure = error;
    if (failure.code === 1) return false;
    throw error;
  }
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
  const changedPaths = [...candidates].filter(
    (file) => previousPaths[file] !== currentPaths[file] || knownUnowned.has(file)
  ).sort();
  const unownedPaths = [.../* @__PURE__ */ new Set([...state.workspace.unownedPaths ?? [], ...changedPaths])].filter((file) => workspace.ownership[file] === void 0).sort();
  return {
    workspace: { ...workspace, unownedPaths },
    contentChanged: changedPaths.length > 0,
    changedPaths
  };
}

// plugins/dev-flow/src/core/user-interactions.ts
import { randomUUID as randomUUID4 } from "node:crypto";

// plugins/dev-flow/src/core/grill-interaction.ts
var answerCodes = ["A", "B", "C"];
function invalid2(message) {
  throw new DevFlowError("GRILL_PRESENTATION_INVALID", message, {
    userMessage: "\u5F53\u524D grill \u95EE\u9898\u4E0D\u7B26\u5408\u4EA4\u4E92\u5408\u540C\u3002",
    recoveryKind: "repair",
    recoveryInstruction: "\u63D0\u4F9B 2-3 \u4E2A\u5E26\u8BF4\u660E\u7684\u9009\u9879\uFF0C\u5E76\u660E\u786E\u4E00\u4E2A\u63A8\u8350\u9879\u53CA\u63A8\u8350\u7406\u7531\u3002",
    retryOriginal: false
  });
}
function buildGrillPresentation(input) {
  const question = input.question.trim();
  if (!question) invalid2("question must not be empty");
  if (!Array.isArray(input.options) || input.options.length < 2 || input.options.length > 3) {
    invalid2("grill must contain 2-3 options");
  }
  if (input.options.some((option) => option.id === "other" || !option.description?.trim())) {
    invalid2("grill options require descriptions and cannot use the reserved other id");
  }
  const reason = input.recommendation.reason.trim();
  if (!reason) invalid2("recommendation reason must not be empty");
  const recommendedIndex = input.options.findIndex((option) => option.id === input.recommendation.optionId);
  if (recommendedIndex < 0) invalid2("recommendation must reference one current option");
  const drawback = input.recommendation.drawback?.trim();
  const alternative = input.recommendation.alternative;
  const hasReminder = drawback !== void 0 || alternative !== void 0;
  if (hasReminder) {
    if (!drawback || !alternative || !alternative.condition.trim()) {
      invalid2("high-impact recommendation requires both a drawback and an alternative condition");
    }
    if (alternative.optionId === input.recommendation.optionId) {
      invalid2("alternative must reference a non-recommended option");
    }
    const alternativeIndex = input.options.findIndex((option) => option.id === alternative.optionId);
    if (alternativeIndex < 0) invalid2("alternative must reference one current option");
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
function findInteractionForTarget(state, target) {
  return Object.values(state.interactions ?? {}).find((value) => {
    const interaction = value;
    return interaction.target === target && interaction.status === "pending";
  });
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

// plugins/dev-flow/src/core/host-health.ts
import { mkdir as mkdir4, open as open4, readFile as readFile7 } from "node:fs/promises";
import path9 from "node:path";
var healthWindowMs = 15 * 60 * 1e3;
var hostHealthPath = (root2) => path9.join(root2, ".dev-flow", "host-health.jsonl");
async function readHostHealth(root2) {
  try {
    const raw = await readFile7(hostHealthPath(root2), "utf8");
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
async function recordHostHealth(root2, signal) {
  const before = await readHostHealth(root2);
  const latest = [...before].reverse().find((entry) => entry.host === signal.host);
  const now = signal.at ?? (/* @__PURE__ */ new Date()).toISOString();
  await mkdir4(path9.dirname(hostHealthPath(root2)), { recursive: true });
  const handle = await open4(hostHealthPath(root2), "a");
  try {
    await handle.writeFile(`${JSON.stringify({ ...signal, at: now })}
`);
    await handle.sync();
  } finally {
    await handle.close();
  }
  return { recovered: Boolean(latest && Date.parse(now) - Date.parse(latest.at) > healthWindowMs), latest };
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

// plugins/dev-flow/src/core/ownership-workflow.ts
import { createHash as createHash9, randomUUID as randomUUID5 } from "node:crypto";

// plugins/dev-flow/src/policy/obligations.ts
function reopenObligations(obligations, kinds) {
  if (!obligations) return void 0;
  const selected = new Set(kinds);
  return obligations.map((obligation) => selected.has(obligation.kind) && obligation.status !== "pending" ? { ...obligation, status: "pending" } : obligation);
}

// plugins/dev-flow/src/core/ownership-workflow.ts
function unknownOwnershipPaths(state) {
  const candidates = new Set(state.workspace.unownedPaths ?? Object.keys(state.workspace.startedDirty));
  return [...candidates].filter((file) => state.workspace.ownership[file] === void 0).sort();
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
  const basisHash2 = createHash9("sha256").update(JSON.stringify({ kind: "workspace-ownership", paths: batchPaths, fingerprint: state.workspace.lastWorkspaceFingerprint })).digest("hex");
  const interaction = createInteraction(state, {
    kind: "workspace-ownership",
    target: `workspace:${createHash9("sha256").update(batchPaths.join("\n")).digest("hex").slice(0, 16)}:${currentPaths[0] ?? "batch"}`,
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
async function reconcileWorkspace(root2, id, expectedRevision, host) {
  const state = await readState(root2, id);
  const config = await readProjectConfig(root2);
  const { workspace, contentChanged, changedPaths } = await reconcileWorkspaceForFeature(root2, state, config);
  const legalCheckpointPaths = contentChanged ? await legalActiveUnitChanges(root2, state, changedPaths) : /* @__PURE__ */ new Set();
  const active = state.lifecycle === "finalized" && contentChanged ? await readActive(root2) : void 0;
  const reopenedLifecycle = state.lifecycle === "finalized" && contentChanged ? !active || active.featureId === id ? "active" : "paused" : void 0;
  const checkpointAffected = contentChanged ? checkpointAffectedByPaths(state, changedPaths, legalCheckpointPaths) : false;
  let presentationEventId;
  return mutate(root2, id, expectedRevision, "workspace-reconciled", (draft) => {
    draft.workspace = workspace;
    if (contentChanged) markAffectedEvidenceStale(draft, changedPaths, reopenedLifecycle, legalCheckpointPaths);
    presentationEventId = queueNextOwnershipDecision(draft);
    draft.lastUpdatedBy = { host, pluginVersion: "5.0.9" };
  }, () => ({
    observedHead: workspace.observedHead,
    commitCount: workspace.observedCommits.length,
    contentChanged,
    checkpointAffected,
    reopenedLifecycle,
    unresolvedOwnership: changedPaths.filter((file) => workspace.ownership[file] === void 0),
    ...presentationEventId ? { presentationEventId } : {}
  }));
}
function queueNextOwnershipDecision(draft) {
  if (pendingDecisionForState(draft)) return void 0;
  const paths = unknownOwnershipPaths(draft);
  if (!paths.length) return void 0;
  return presentWorkspaceOwnership(draft, paths).presentationEventId;
}
function markAffectedEvidenceStale(draft, changedPaths, reopenedLifecycle, legalCheckpointPaths = /* @__PURE__ */ new Set()) {
  const checkpointAffected = checkpointAffectedByPaths(draft, changedPaths, legalCheckpointPaths);
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
    draft.currentStage = "implementation";
  } else if (draft.steps.verification?.status === "satisfied" || draft.steps.finalize?.status === "satisfied") {
    delete draft.steps.verification;
    delete draft.steps.finalize;
    draft.currentStage = "verification";
  }
  draft.logicComplete = false;
  if (reopenedLifecycle) {
    draft.lifecycle = reopenedLifecycle;
    delete draft.deliverySnapshot;
    draft.resumeSummary = reopenedLifecycle === "active" ? `\u5DF2\u64A4\u9500\u8FC7\u671F\u7684\u5B8C\u6210\u58F0\u660E\uFF0C\u4ECE\u201C${draft.currentStage ?? "\u5F53\u524D\u9636\u6BB5"}\u201D\u7EE7\u7EED\u3002` : `\u5B8C\u6210\u540E\u68C0\u6D4B\u5230\u771F\u5B9E\u5185\u5BB9\u6F02\u79FB\uFF1B\u53E6\u4E00\u4E2A feature \u6B63\u5728\u8FDB\u884C\uFF0C\u672C\u4EFB\u52A1\u5DF2\u6062\u590D\u4E3A\u6682\u505C\u72B6\u6001\u5E76\u56DE\u9000\u5230\u201C${draft.currentStage ?? "\u5F53\u524D\u9636\u6BB5"}\u201D\u3002`;
  }
  draft.obligations = reopenObligations(draft.obligations, [
    ...checkpointAffected ? ["checkpoint"] : [],
    "verification"
  ]);
}
function checkpointAffectedByPaths(state, changedPaths, legalCheckpointPaths) {
  const externallyChangedPaths = changedPaths.filter((file) => !legalCheckpointPaths.has(file));
  return state.checkpoints?.some((checkpoint) => checkpoint.files.some((file) => externallyChangedPaths.includes(file))) ?? false;
}
async function legalActiveUnitChanges(root2, state, changedPaths) {
  const activeUnit = state.implementationUnits?.find((unit) => unit.status === "active" || unit.status === "verified");
  if (!activeUnit || !state.traceability || !state.checkpoints?.length) return /* @__PURE__ */ new Set();
  const trace = await readTraceability(root2, state);
  const node = trace.nodes[activeUnit.unitId];
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
  for (const file of changedPaths) {
    if (!pathWithinFileScope(file, node.fileScope)) continue;
    let event2;
    for (let index = events.length - 1; index > lastCheckpointEventIndex; index -= 1) {
      const candidate = events[index];
      const after = candidate.type === "trusted-write-owned" ? candidate.data.after : void 0;
      if (typeof after?.[file] === "string") {
        event2 = candidate;
        break;
      }
    }
    if (!event2) continue;
    const expected = event2.data.after[file];
    if (expected === await trustedWriteSummary(root2, file)) legal.add(file);
  }
  return legal;
}

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

// plugins/dev-flow/src/core/artifacts.ts
import { createHash as createHash10 } from "node:crypto";
import { readFile as readFile8, writeFile } from "node:fs/promises";
import path10 from "node:path";

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

// plugins/dev-flow/src/core/plan-graph.ts
var TRACE_ANCHOR = /<!-- dev-flow:id=(REQ|AC|TASK|TEST|UNIT)-([0-9]{3,}) kind=(requirement|acceptance-criterion|task|test|implementation-unit) -->/g;
function parsePlanBlocks(markdown) {
  TRACE_ANCHOR.lastIndex = 0;
  const anchors = [];
  let match;
  while ((match = TRACE_ANCHOR.exec(markdown)) !== null) {
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

// plugins/dev-flow/src/core/artifacts.ts
var hash = (value) => createHash10("sha256").update(value).digest("hex");
var featureDirectory = (root2, id) => path10.join(root2, ".dev-flow", "features", id);
async function assertArtifactCurrent(root2, id, state, kind) {
  const artifact = state.artifacts[kind];
  if (!artifact) throw new DevFlowError("MISSING_REQUIRED_ARTIFACT", kind);
  const contents = await readFile8(path10.join(featureDirectory(root2, id), normalizeUnicode(artifact.path)), "utf8");
  if (hash(contents) !== artifact.sha256) throw new DevFlowError("ARTIFACT_INTEGRITY_FAILED", kind);
  return contents;
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
var delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
var devFlow = (root2) => path11.join(root2, ".dev-flow");
var features = (root2) => path11.join(devFlow(root2), "features");
var statePath = (root2, id) => path11.join(features(root2), id, "state.json");
var eventPath = (root2, id) => path11.join(features(root2), id, "events.jsonl");
var activePath = (root2) => path11.join(devFlow(root2), "active.json");
var recoveryTxnPath = (root2) => path11.join(devFlow(root2), "recovery-transaction.json");
var rollbackTxnPath = (root2, featureId) => path11.join(features(root2), featureId, "rollback-transaction.json");
async function readProjectConfig(root2) {
  try {
    const raw = await readFile9(path11.join(devFlow(root2), "project.json"), "utf8");
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
async function writeAtomic(file, value) {
  const temp = `${file}.${randomUUID6()}.tmp`;
  const handle = await open5(temp, "w");
  const payload = file.endsWith(`${path11.sep}state.json`) && value && typeof value === "object" && value.schemaVersion === 5 ? (() => {
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
  await rename4(temp, file);
  const directory = await open5(path11.dirname(file), "r");
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
    const file2 = path11.join(features(root2), state.featureId, status.path);
    state.artifacts.status = { ...status, sha256: createHash11("sha256").update(contents2).digest("hex") };
    return async () => {
      await writeFile2(file2, contents2);
    };
  }
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
    ...routeDefinitionForFeature(state.route, state.classification.controls).orderedSteps.map((step) => `- ${step}: ${state.steps[step]?.status ?? "pending"}`),
    "",
    ...traceLines
  ].join("\n");
  const contents = `${projection}
`;
  const file = path11.join(features(root2), state.featureId, status.path);
  state.artifacts.status = { ...status, sha256: createHash11("sha256").update(contents).digest("hex") };
  return async () => {
    await writeFile2(file, contents);
  };
}
async function lock(root2, featureId, operation) {
  const directory = path11.join(devFlow(root2), ".lock");
  const started = Date.now();
  await mkdir5(devFlow(root2), { recursive: true });
  while (true) {
    try {
      await mkdir5(directory);
      await writeFile2(path11.join(directory, "owner.json"), JSON.stringify({ pid: process.pid, hostname: hostname(), acquiredAt: (/* @__PURE__ */ new Date()).toISOString(), featureId, operation }));
      return async () => {
        await rm(directory, { recursive: true, force: true });
      };
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
      try {
        const owner = JSON.parse(await readFile9(path11.join(directory, "owner.json"), "utf8"));
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
    const raw = JSON.parse(await readFile9(statePath(root2, featureId), "utf8"));
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
    raw = await readFile9(activePath(root2), "utf8");
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
  const handle = await open5(eventPath(root2, id), "a");
  try {
    await handle.writeFile(`${JSON.stringify({ revision, type, at: (/* @__PURE__ */ new Date()).toISOString(), data })}
`);
    await handle.sync();
  } finally {
    await handle.close();
  }
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
async function recordHostEvent(root2, hostEvent) {
  if (hostEvent.type === "review-execution") {
    throw new DevFlowError("REVIEW_EXECUTION_EVENT_INVALID", "review execution proofs must use the dedicated adapter seam");
  }
  const active = await readActive(root2);
  if (!active) return;
  const release = await lock(root2, active.featureId, "host-event");
  try {
    const state = await readState(root2, active.featureId);
    const events = await readFeatureEvents(root2, active.featureId);
    const duplicate = events.some((item) => {
      const recorded = item.data;
      return item.type === "host-event" && recorded.host === hostEvent.host && recorded.eventId === hostEvent.eventId;
    });
    if (!duplicate) await appendEvent(root2, active.featureId, state.revision, "host-event", { ...hostEvent, at: hostEvent.at ?? (/* @__PURE__ */ new Date()).toISOString() });
  } finally {
    await release();
  }
}
async function recordTrustedWriteIntent(root2, paths, host, eventId2) {
  const active = await readActive(root2);
  if (!active || paths.length === 0) return;
  const state = await readState(root2, active.featureId);
  if (state.mode !== "routed" || state.lifecycle !== "active" || state.currentStage !== "implementation") return;
  const config = await readProjectConfig(root2);
  const governed = paths.filter((file) => config.governedRoots.some((entry) => entry === "." || file === entry || file.startsWith(`${entry}/`)));
  if (!governed.length) return;
  const before = Object.fromEntries(await Promise.all(governed.map(async (file) => [file, await trustedWriteSummary(root2, file)])));
  await appendFeatureEvent(root2, state.featureId, state.revision, "trusted-write-before", { eventId: eventId2, host, paths: governed, before });
}
async function recordTrustedWriteOwnership(root2, paths, host, eventId2) {
  const active = await readActive(root2);
  if (!active || paths.length === 0) return;
  const state = await readState(root2, active.featureId);
  if (state.mode !== "routed" || state.lifecycle !== "active" || state.currentStage !== "implementation") return;
  const config = await readProjectConfig(root2);
  const governed = paths.filter((file) => config.governedRoots.some((entry) => entry === "." || file === entry || file.startsWith(`${entry}/`)));
  if (!governed.length) return;
  const after = Object.fromEntries(await Promise.all(governed.map(async (file) => [file, await trustedWriteSummary(root2, file)])));
  await mutate(root2, state.featureId, state.revision, "trusted-write-owned", (draft) => {
    for (const file of governed) {
      draft.workspace.ownership[file] = "feature";
      draft.workspace.ownershipSource[file] = "trusted-hook";
    }
    draft.workspace.unownedPaths = (draft.workspace.unownedPaths ?? []).filter((file) => !governed.includes(file));
    draft.lastUpdatedBy = { host, pluginVersion: "5.0.9" };
  }, { eventId: eventId2, host, paths: governed, after });
}
async function recordHostAuthorizationEvent(root2, type, record) {
  const active = await readActive(root2);
  if (!active || active.featureId !== record.featureId) return;
  const release = await lock(root2, active.featureId, "host-authorization");
  try {
    const current = await readActive(root2);
    if (!current || current.featureId !== record.featureId || current.revision !== active.revision) return;
    const state = await readState(root2, record.featureId);
    if (state.lifecycle !== "active" || state.revision !== current.revision) return;
    const events = await readFeatureEvents(root2, record.featureId);
    const duplicate = events.some((event2) => {
      if (event2.type !== type) return false;
      const value = event2.data;
      return value.host === record.host && value.featureId === record.featureId && value.riskClass === record.riskClass && value.commandFingerprint === record.commandFingerprint && value.sourceToolEvent === record.sourceToolEvent;
    });
    if (!duplicate) await appendEvent(root2, record.featureId, state.revision, type, record);
  } finally {
    await release();
  }
}
async function readHostAuthorizationEvents(root2, featureId) {
  const events = await readFeatureEvents(root2, featureId);
  return events.flatMap((event2) => {
    if (event2.type !== "host-authorization-pending" && event2.type !== "host-authorization-granted") return [];
    return [{ type: event2.type, data: event2.data }];
  });
}
async function readFeatureEvents(root2, id) {
  try {
    return (await readFile9(eventPath(root2, id), "utf8")).split("\n").filter(Boolean).map((line) => JSON.parse(line));
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
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
    if (active?.featureId === id && (state.lifecycle === "finalized" || state.lifecycle === "abandoned" || state.lifecycle === "paused")) await rm(activePath(root2), { force: true });
    else if (state.lifecycle === "active" && (active?.featureId === id || !active && ["feature-resumed", "workspace-reconciled", "feature-derived-state-repaired"].includes(operation))) await writeAtomic(activePath(root2), { featureId: id, revision: state.revision, updatedAt: (/* @__PURE__ */ new Date()).toISOString() });
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
  if (transaction?.schemaVersion !== 1 || typeof transaction.transactionId !== "string" || !transaction.transactionId || !isRecoveryPhase(transaction.phase) || typeof transaction.featureId !== "string" || !transaction.featureId || typeof transaction.stateSha256 !== "string" || !transaction.stateSha256 || typeof transaction.recoveredTo !== "string" || !path11.isAbsolute(transaction.recoveredTo) || typeof transaction.reason !== "string" || typeof transaction.userEvidence !== "string" || transaction.host !== "claude" && transaction.host !== "codex" || typeof transaction.at !== "string" || transaction.activeSha256 !== void 0 && typeof transaction.activeSha256 !== "string") {
    throw new DevFlowError("RECOVERY_TRANSACTION_UNREADABLE", "recovery journal is invalid", {
      recoveryHint: "Run dev_flow_doctor; do not start a new feature or hand-edit .dev-flow"
    });
  }
  if (path11.basename(transaction.featureId) !== transaction.featureId || transaction.featureId === "." || transaction.featureId === "..") {
    throw new DevFlowError("RECOVERY_TRANSACTION_UNREADABLE", "recovery journal has an unsafe feature id", { recoveryHint: "Run dev_flow_doctor; recovery remains fail-closed" });
  }
}
function validateRecoveryLocation(root2, transaction) {
  const recoveredRoot = path11.join(devFlow(root2), "recovered");
  const relative = path11.relative(recoveredRoot, transaction.recoveredTo);
  if (!relative || relative.startsWith("..") || path11.isAbsolute(relative) || path11.basename(relative) !== relative) {
    throw new DevFlowError("RECOVERY_TRANSACTION_UNREADABLE", "recovery journal points outside the recovered directory", {
      recoveryHint: "Run dev_flow_doctor; do not start a new feature or hand-edit .dev-flow"
    });
  }
}
async function readRecoveryTransaction(root2) {
  let raw;
  try {
    raw = await readFile9(recoveryTxnPath(root2), "utf8");
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
async function readRollbackJournalPresence(root2, featureId) {
  let raw;
  try {
    raw = await readFile9(rollbackTxnPath(root2, featureId), "utf8");
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
    entries = await readdir4(features(root2), { withFileTypes: true });
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

// plugins/dev-flow/src/hosts/adapter-policy.ts
import path14 from "node:path";
import { execFile as execFile4 } from "node:child_process";
import { promisify as promisify4 } from "node:util";

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
function classifyGitCommandKind(command) {
  const commands = [...command.matchAll(/(?:^|[;&|]\s*)(?:[A-Za-z_][A-Za-z0-9_]*=(?:"[^"]*"|'[^']*'|\S+)\s+)*(?:command\s+)?git(?:\s+-C\s+(?:"[^"]+"|'[^']+'|\S+))?\s+([\w-]+)([^;&|\n)]*)/g)];
  if (!commands.length) return "other";
  let result = "read";
  for (const match of commands) {
    const subcommand = match[1];
    const args = (match[2] ?? "").trim();
    if (isReadOnly(subcommand, args)) continue;
    if (subcommand === "add") result = "local-stage";
    else if (subcommand === "commit") result = result === "history-rewrite" ? result : "local-commit";
    else if (subcommand === "push") result = "external-publish";
    else result = "history-rewrite";
  }
  return result;
}
var gitReadOnlyCommands = [...readOnly].sort();

// plugins/dev-flow/src/core/write-gate.ts
import path13 from "node:path";

// plugins/dev-flow/src/core/implementation-units.ts
import { createHash as createHash14, randomUUID as randomUUID9 } from "node:crypto";

// plugins/dev-flow/src/core/checkpoints.ts
import { randomUUID as randomUUID7, createHash as createHash12 } from "node:crypto";
import { access as access2, mkdir as mkdir6, open as open6, readFile as readFile10, readlink as readlink3, readdir as readdir5, rename as rename5 } from "node:fs/promises";
import path12 from "node:path";

// plugins/dev-flow/src/core/verification-store.ts
import { execFile as execFile3 } from "node:child_process";
import { promisify as promisify3 } from "node:util";
var run2 = promisify3(execFile3);

// plugins/dev-flow/src/core/verification.ts
var DEFAULT_COMMAND_MAX_OUTPUT_BYTES = 1024 * 1024;

// plugins/dev-flow/src/core/checkpoints.ts
var digest4 = (value) => createHash12("sha256").update(value).digest("hex");
var featureDirectory2 = (root2, featureId) => path12.join(root2, ".dev-flow", "features", featureId);
function blobPath(sha256) {
  return `checkpoints/blobs/${sha256}`;
}
function baselinePath(unitId) {
  return `checkpoints/baselines/${unitId}.json`;
}
async function writeAtomic2(file, contents) {
  const temp = `${file}.${randomUUID7()}.tmp`;
  const handle = await open6(temp, "w");
  try {
    await handle.writeFile(contents);
    await handle.sync();
  } finally {
    await handle.close();
  }
  await rename5(temp, file);
  const directory = await open6(path12.dirname(file), "r");
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
async function writeBlobIfAbsent(root2, featureId, bytes) {
  const sha256 = digest4(bytes);
  const file = path12.join(featureDirectory2(root2, featureId), blobPath(sha256));
  if (await pathExists(file)) return sha256;
  await mkdir6(path12.dirname(file), { recursive: true });
  await writeAtomic2(file, bytes);
  return sha256;
}
async function captureUnitBaseline(root2, featureId, unitId, snapshot) {
  for (const file2 of snapshot) {
    const bytes = file2.kind === "symlink" ? Buffer.from(await readlink3(path12.join(root2, file2.path))) : await readFile10(path12.join(root2, file2.path));
    if (digest4(bytes) !== file2.sha256) {
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
  const file = path12.join(featureDirectory2(root2, featureId), baselinePath(unitId));
  await mkdir6(path12.dirname(file), { recursive: true });
  await writeAtomic2(file, `${JSON.stringify(baseline, null, 2)}
`);
}

// plugins/dev-flow/src/core/review-jobs.ts
import { createHash as createHash13, randomUUID as randomUUID8 } from "node:crypto";

// plugins/dev-flow/src/core/governance-state.ts
function governanceLedger(state) {
  return state.governance ?? EMPTY_GOVERNANCE_LEDGER;
}
function currentRiskAuthorizations(state, basis) {
  return governanceLedger(state).authorizations.filter((authorization) => authorization.authorizationType === "risk-acceptance" && deriveCurrency(authorization, basis) === "current");
}

// plugins/dev-flow/src/core/quality-exceptions.ts
function hasCurrentQualityException(state, kind) {
  const invalidatedAt = state.lastInvalidation?.at ? Date.parse(state.lastInvalidation.at) : Number.NaN;
  const authorization = currentRiskAuthorizations(state, { contentFingerprint: state.businessFingerprint }).some((item) => item.target === kind && (!Number.isFinite(invalidatedAt) || !item.recordedAt || Date.parse(item.recordedAt) >= invalidatedAt));
  return authorization;
}

// plugins/dev-flow/src/core/review-jobs.ts
var digest5 = (value) => createHash13("sha256").update(value).digest("hex");
var leaseMilliseconds = 60 * 60 * 1e3;
var samplingLeaseMilliseconds = 120 * 1e3;
var basisArtifactKinds = ["requirements", "implementation-plan", "coverage-matrix", "rollback-units"];
function nonBehaviorDispositions(trace) {
  const nodes = Object.values(trace?.nodes ?? {}).filter((node) => node.status !== "tombstoned");
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
function invalid3(code, message, details = {}) {
  throw new DevFlowError(code, message, details);
}
function reviewArtifactKinds(state) {
  return basisArtifactKinds.filter((kind) => Boolean(state.artifacts[kind]));
}
async function deriveReviewInput(root2, state) {
  const trace = state.traceability ? await readTraceability(root2, state) : void 0;
  const { config, sha256: projectConfigSha256 } = await readProjectConfigSnapshot(root2);
  const frozenArtifacts = await Promise.all(reviewArtifactKinds(state).map(async (kind) => {
    const artifact = state.artifacts[kind];
    if (!artifact) invalid3("REVIEW_BASIS_ARTIFACT_MISSING", `review basis artifact is missing: ${kind}`, { kind });
    let contents;
    try {
      contents = await assertArtifactCurrent(root2, state.featureId, state, kind);
    } catch (error) {
      if (error instanceof DevFlowError && error.code === "ARTIFACT_INTEGRITY_FAILED") throw error;
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
  const projectContents = (await readProjectConfigSnapshot(root2)).contents;
  if (digest5(projectContents) !== projectConfigSha256) {
    invalid3("REVIEW_BASIS_UNAVAILABLE", "project configuration changed while review basis was being captured");
  }
  const scopeManifest = {
    inScope: [...state.scope.inScope].sort(),
    outOfScope: [...state.scope.outOfScope].sort(),
    governedRoots: [...config.governedRoots].sort(),
    rollbackFileScopes: Object.values(trace?.nodes ?? {}).reduce((scopes, node) => {
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
    ...state.traceability && trace ? { traceability: { path: state.traceability.path, sha256: state.traceability.sha256, revision: trace.revision } } : {},
    projectConfigSha256,
    verificationCommandHashes: verificationCommandHashes(config),
    scopeManifestSha256: digest5(canonicalReviewValueJson(scopeManifest)),
    governedRootsFingerprint
  };
  const roles = [.../* @__PURE__ */ new Set([
    ...state.classification.controls.reviewRoles,
    ...state.classification.controls.codeReview !== "none" ? ["code-quality", "requirement-fidelity"] : []
  ])];
  const roleBasisHashes = Object.fromEntries(
    roles.map((role) => [role, roleBasisHash(basis, frozenArtifacts, trace, role)])
  );
  return {
    basis,
    roleBasisHashes,
    frozenArtifacts,
    projectConfig: { sha256: projectConfigSha256, contents: projectContents },
    scopeManifest: {
      governedRoots: scopeManifest.governedRoots,
      rollbackFileScopes: scopeManifest.rollbackFileScopes.flatMap((item) => item.fileScope),
      traceIds: Object.values(trace?.nodes ?? {}).filter((node) => node.status === "current").map((node) => node.id).sort(),
      frozenArtifactPaths: frozenArtifacts.map((artifact) => artifact.path).sort()
    },
    nonBehaviorDispositions: nonBehaviorDispositions(trace)
  };
}
function basisHash(basis) {
  return semanticReviewBasisHash(basis);
}
function roleBasisHash(basis, frozenArtifacts, trace, role) {
  const artifacts = frozenArtifacts.filter((artifact) => {
    if (role === "code-quality" || role === "requirement-fidelity") return true;
    if (role === "requirements-coverage") return artifact.kind === "requirements" || artifact.kind === "implementation-plan";
    if (role === "architecture-testability") return artifact.kind === "implementation-plan";
    if (role === "rollback-operability") return artifact.kind === "implementation-plan" || artifact.kind === "rollback-units";
    return artifact.kind === "requirements" || artifact.kind === "implementation-plan";
  }).map(({ kind, path: artifactPath, sha256 }) => ({ kind, path: artifactPath, sha256 }));
  const traceKinds = role === "requirements-coverage" || role === "requirement-fidelity" ? ["requirement", "acceptance-criterion", "task", "test", "implementation-unit"] : role === "architecture-testability" ? ["task", "test", "implementation-unit"] : role === "rollback-operability" ? ["task", "implementation-unit", "recovery", "rollback"] : ["requirement", "acceptance-criterion", "task", "test", "implementation-unit", "recovery", "rollback"];
  const traceSlice = Object.values(trace?.nodes ?? {}).filter((node) => node.status !== "tombstoned" && traceKinds.includes(node.kind)).sort((left, right) => left.id.localeCompare(right.id)).map(({ sourceArtifact: _sourceArtifact, sourceSha256: _sourceSha256, sourceAnchor: _sourceAnchor, sourceBlockSha256: _sourceBlockSha256, status: _status, ...semantic }) => semantic);
  const specialtyRisk = {
    security: ["security"],
    "data-irreversibility": ["data", "irreversible_consequence"],
    "money-safety": ["money"],
    "contract-failure": ["external"],
    "recovery-observability": ["availability"],
    "critical-correctness": ["critical_correctness"]
  };
  if (specialtyRisk[role]) {
    return digest5(canonicalReviewValueJson({
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
  return digest5(canonicalReviewValueJson({
    role,
    route: basis.route,
    level: basis.classification.level,
    artifacts,
    traceSlice,
    // requirements-coverage 显式绑定非行为处置豁免清单：豁免变化必须使该角色
    // basis 失效（traceSlice 已覆盖，这里把语义绑定写明，防止切片收窄后脱钩）。
    ...role === "requirements-coverage" ? { nonBehaviorDispositions: nonBehaviorDispositions(trace) } : {},
    ...role === "architecture-testability" || role === "rollback-operability" ? { verificationCommandHashes: referencedCommandHashes } : {}
  }));
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

// plugins/dev-flow/src/core/implementation-units.ts
var digest6 = (value) => createHash14("sha256").update(value).digest("hex");
function currentImplementationNodes(ledger) {
  return Object.values(ledger?.nodes ?? {}).filter((node) => node.kind === "implementation-unit" && node.status === "current");
}
function planImplementationUnitDefs(planMarkdown) {
  const blocks = parsePlanBlocks(planMarkdown);
  const defs = [];
  for (const [id, block2] of blocks) {
    if (block2.kind !== "implementation-unit" || !/^UNIT-[0-9]{3,}$/.test(id)) continue;
    const fields = {};
    for (const line of block2.text.split("\n")) {
      const match = /^-\s+([A-Za-z_]+):\s*(.*)$/.exec(line.trim());
      if (!match) continue;
      const raw = match[2].trim();
      fields[match[1]] = raw.startsWith("[") && raw.endsWith("]") ? raw.slice(1, -1).trim() ? raw.slice(1, -1).split(",").map((item) => item.trim()).filter(Boolean) : [] : raw ? [raw] : [];
    }
    defs.push({ id, tasks: fields["tasks"] ?? [], dependsOn: fields["depends_on"] ?? [] });
  }
  return defs.sort((left, right) => left.id.localeCompare(right.id));
}
async function ensureActiveImplementationUnit(root2, id, state) {
  if (!checkpointsEnforcementRequired(state.route, state.classification.controls) || currentOpenStep(state) !== "implementation" || !confirmedApproval(state) || (state.implementationUnits ?? []).some((unit) => unit.status === "active")) return state;
  const ledger = await readTraceability(root2, state);
  const nodes = currentImplementationNodes(ledger).sort((a, b) => a.id.localeCompare(b.id));
  const statusByUnit = new Map((state.implementationUnits ?? []).map((unit) => [unit.unitId, unit.status]));
  const ready = nodes.find((node) => statusByUnit.get(node.id) !== "checkpointed" && node.dependsOn.every((dependency) => statusByUnit.get(dependency) === "checkpointed"));
  if (!ready) return state;
  return beginImplementationUnit(root2, id, state.revision, ready.id);
}
function implementationUnitBasisHash(state) {
  return digest6(canonicalReviewValueJson({
    traceability: state.traceability,
    approval: confirmedApproval(state)?.record ?? null
  }));
}
function implementationUnitWriteBlock(state, ledger, _relativePath) {
  if (!checkpointsEnforcementRequired(state.route, state.classification.controls)) return void 0;
  if (currentOpenStep(state) !== "implementation") return void 0;
  if (!confirmedApproval(state)) return void 0;
  const active = (state.implementationUnits ?? []).find((unit) => unit.status === "active");
  if (!active) {
    return {
      code: "IMPLEMENTATION_UNIT_REQUIRED",
      details: { recoveryHint: "\u5199\u5165 governed \u6587\u4EF6\u524D\uFF0C\u5148\u901A\u8FC7 dev_flow_begin_implementation_unit \u5F00\u59CB\u4E0B\u4E00\u4E2A implementation unit" }
    };
  }
  const node = currentImplementationNodes(ledger).find((candidate) => candidate.id === active.unitId);
  if (!node) {
    return {
      code: "IMPLEMENTATION_UNIT_OUT_OF_SCOPE",
      details: { unitId: active.unitId, fileScope: [], path: _relativePath }
    };
  }
  return void 0;
}
async function beginImplementationUnit(root2, id, expectedRevision, unitId) {
  return mutate(root2, id, expectedRevision, "implementation-unit-begun", async (state) => {
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
    const pendingSideEffect = Object.values(state.interactions ?? {}).find((value) => {
      const candidate = value;
      return candidate.kind === "side-effect-rerun" && candidate.status === "pending" && candidate.sideEffectRerun?.units.includes(unitId);
    });
    if (pendingSideEffect) {
      throw new DevFlowError("SIDE_EFFECT_UNIT_PENDING_CONFIRMATION", "\u8BE5\u5B9E\u73B0\u5355\u5143\u5305\u542B\u6709\u526F\u4F5C\u7528\u7684\u64CD\u4F5C\uFF0C\u8BA1\u5212\u4FEE\u8BA2\u540E\u9700\u7528\u6237\u786E\u8BA4\u624D\u80FD\u91CD\u8DD1\u3002", {
        unitId,
        recoveryHint: "\u56DE\u7B54\u5F53\u524D\u5F85\u51B3\u95EE\u9898\uFF08\u786E\u8BA4\u91CD\u8DD1\u8BE5\u5355\u5143\uFF0C\u6216\u4E0D\u91CD\u8DD1\u4FDD\u7559\u539F\u7ED3\u679C\uFF09\u540E\u518D\u91CD\u8BD5 begin\u3002"
      });
    }
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
    const node = nodes.find((candidate) => candidate.id === unitId);
    if (!node) {
      throw new DevFlowError("IMPLEMENTATION_UNIT_UNKNOWN", "implementation unit is not part of the current execution graph", { unitId });
    }
    if ((state.implementationUnits ?? []).some((unit) => unit.status === "active")) {
      const active = state.implementationUnits.find((unit) => unit.status === "active");
      throw new DevFlowError("IMPLEMENTATION_UNIT_ALREADY_ACTIVE", "another implementation unit is already active", { activeUnitId: active.unitId });
    }
    const basisHash2 = implementationUnitBasisHash(state);
    const byId = new Map((state.implementationUnits ?? []).map((unit) => [unit.unitId, unit]));
    const merged = [];
    for (const candidate of nodes) {
      const unitIdValue = candidate.id;
      const existing = byId.get(unitIdValue);
      if (existing && existing.status !== "pending") {
        merged.push(existing);
      } else {
        merged.push({
          unitId: unitIdValue,
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
          unitId,
          dependency,
          status: unit?.status ?? "unknown"
        });
      }
    }
    const target = merged.find((unit) => unit.unitId === unitId);
    if (target.status !== "pending" && target.status !== "rolled_back") {
      throw new DevFlowError("IMPLEMENTATION_UNIT_NOT_PENDING", "implementation unit cannot begin from its current status", { unitId, status: target.status });
    }
    const project = await readProjectConfig(root2);
    const snapshot = await snapshotGovernedRoots(root2, project);
    await captureUnitBaseline(root2, id, unitId, snapshot);
    delete target.checkpointId;
    target.basisHash = basisHash2;
    target.beginNonce = randomUUID9();
    target.status = "active";
    target.startedFingerprint = await fingerprintGovernedRoots(root2, project);
    state.implementationUnits = merged;
  }, { unitId });
}

// plugins/dev-flow/src/core/write-gate.ts
function block(code, paths, reason, detail) {
  return { decision: "block", block: { code, paths, reason, ...detail ? { detail } : {} } };
}
var controlFileNames = /* @__PURE__ */ new Set(["state.json", "active.json", "project.json", "events.jsonl", "status.md", "\u72B6\u6001\u6587\u6863.md", "recovery-transaction.json", "recovery-events.jsonl"]);
function isDevFlowPath(relative) {
  return relative === ".dev-flow" || relative.startsWith(".dev-flow/");
}
function isControlPath(relative) {
  if (!isDevFlowPath(relative)) return false;
  if (/^\.dev-flow\/features\/[^/]+\/traceability(?:\/|$)/.test(relative)) return true;
  if (/^\.dev-flow\/features\/[^/]+\/review\/(?:snapshots|packages|projections)(?:\/|$)/.test(relative)) return true;
  const base = path13.posix.basename(relative);
  if (controlFileNames.has(base)) return true;
  if (relative.includes("/.lock/") || relative.endsWith("/.lock")) return true;
  if (relative === ".dev-flow/active.json" || relative === ".dev-flow/project.json") return true;
  if (relative.includes("/recovered/")) return true;
  if (relative.endsWith("/state.json") || relative.endsWith("/events.jsonl") || relative.endsWith("/status.md") || relative.endsWith("/\u72B6\u6001\u6587\u6863.md")) return true;
  return false;
}
function isGoverned(relative, governedRoots) {
  return governedRoots.some((item) => relative === item || relative.startsWith(`${item}/`));
}
function isGeneratedReviewProjectionPath(kind, artifactPath) {
  return kind === "plan-review" && typeof artifactPath === "string" && /^review\/projections\/[a-f0-9]{64}\.md$/.test(artifactPath);
}
function inFeatureScope(relative, state) {
  return state.scope.inScope.some((scope) => scope === "." || relative === scope || relative.startsWith(`${scope}/`));
}
async function loadActiveWorkflow(root2) {
  try {
    const recovery = await readRecoveryTransaction(root2);
    if (recovery) {
      try {
        const project2 = await readProjectConfig(root2);
        return { kind: "unreadable", reason: `recovery journal open for ${recovery.featureId}`, governedRoots: project2.governedRoots, blockAllWrites: false };
      } catch {
        return { kind: "unreadable", reason: "project.json invalid while recovery journal is open", blockAllWrites: true };
      }
    }
  } catch {
    return { kind: "unreadable", reason: "recovery journal unreadable", blockAllWrites: true };
  }
  let active;
  try {
    active = await readActive(root2);
  } catch {
    try {
      const project2 = await readProjectConfig(root2);
      return { kind: "unreadable", reason: "active.json unreadable", governedRoots: project2.governedRoots, blockAllWrites: false };
    } catch {
      return { kind: "unreadable", reason: "project.json invalid while active.json is unreadable", blockAllWrites: true };
    }
  }
  if (!active) return { kind: "none" };
  let project;
  try {
    project = await readProjectConfig(root2);
  } catch {
    return { kind: "unreadable", reason: "project.json invalid", blockAllWrites: true };
  }
  let state;
  let ledger;
  try {
    state = await readState(root2, active.featureId);
  } catch {
    return { kind: "unreadable", reason: "state invalid", governedRoots: project.governedRoots, blockAllWrites: false };
  }
  if (state.lifecycle !== "active" || active.revision !== state.revision) return { kind: "unreadable", reason: "active pointer revision mismatch", governedRoots: project.governedRoots, blockAllWrites: false };
  if (state.traceability) {
    try {
      ledger = await readTraceability(root2, state);
    } catch {
      return { kind: "unreadable", reason: "traceability snapshot invalid", governedRoots: project.governedRoots, blockAllWrites: false };
    }
  }
  if (state.review) {
    try {
      await readReviewLedger(root2, state);
    } catch {
      return { kind: "unreadable", reason: "review snapshot invalid", governedRoots: project.governedRoots, blockAllWrites: false };
    }
  }
  const allowedArtifacts = /* @__PURE__ */ new Set();
  for (const [kind, artifact] of Object.entries(state.artifacts ?? {})) {
    if (kind === "status" || !artifact?.path) continue;
    if (isGeneratedReviewProjectionPath(kind, artifact.path)) continue;
    if (typeof artifact.path !== "string" || path13.posix.dirname(artifact.path) !== "." || !artifact.path.endsWith(".md")) {
      return { kind: "unreadable", reason: "artifact path invalid", governedRoots: project.governedRoots, blockAllWrites: false };
    }
    const relative = `.dev-flow/features/${active.featureId}/${artifact.path}`.split(path13.sep).join("/");
    allowedArtifacts.add(relative);
  }
  return {
    kind: "ready",
    workflow: {
      featureId: active.featureId,
      logicComplete: state.logicComplete,
      approvalConfirmed: Boolean(confirmedApproval(state)),
      allowedArtifacts,
      governedRoots: project.governedRoots,
      state,
      ledger
    }
  };
}
async function revokedImplementationApprovalHint(root2, featureId) {
  const events = await readFeatureEvents(root2, featureId);
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
async function writeGate(root2, intent) {
  if (intent.kind === "file" && "unresolved" in intent) {
    const loaded2 = await loadActiveWorkflow(root2);
    return loaded2.kind === "ready" ? { decision: "allow", advisory: "unresolved-write" } : { decision: "allow" };
  }
  if (intent.kind === "file") {
    for (const relative of intent.paths) {
      if (isControlPath(relative)) {
        return block("CONTROL_MUTATION_FORBIDDEN", [relative], "workflow control files are Core-owned", { variant: "control-file" });
      }
    }
  }
  const loaded = await loadActiveWorkflow(root2);
  if (loaded.kind === "none") return { decision: "allow" };
  if (loaded.kind === "unreadable") {
    if (intent.kind === "git") {
      return block("WORKFLOW_STATE_UNREADABLE", [], loaded.reason, { unreadableReason: loaded.reason });
    }
    for (const relative of intent.paths) {
      if (loaded.blockAllWrites || isDevFlowPath(relative) || isGoverned(relative, loaded.governedRoots ?? [])) {
        return block("WORKFLOW_STATE_UNREADABLE", [relative], loaded.reason, { unreadableReason: loaded.reason });
      }
    }
    return { decision: "allow" };
  }
  if (intent.kind === "git") return evaluateGitWrite(loaded.workflow, intent);
  return evaluateFileWrite(root2, loaded.workflow, intent.paths);
}
async function evaluateFileWrite(root2, workflow, paths) {
  const state = workflow.state;
  if (!state) return { decision: "allow" };
  let unitNeededPath;
  for (const relative of paths) {
    if (isControlPath(relative)) return block("CONTROL_MUTATION_FORBIDDEN", [relative], "workflow control files are Core-owned", { variant: "control-file" });
    if (isDevFlowPath(relative)) {
      if (workflow.allowedArtifacts.has(relative)) continue;
      if (relative.startsWith(`.dev-flow/features/${workflow.featureId}/`) && relative.endsWith(".md")) {
        return block("ARTIFACT_NOT_REGISTERED", [relative], "feature artifact Markdown is not registered");
      }
      return block("CONTROL_MUTATION_FORBIDDEN", [relative], "Dev Flow control area is Core-owned", { variant: "control-area" });
    }
    const governed = isGoverned(relative, workflow.governedRoots);
    if (state.mode === "intake" && governed) {
      return approvalBlock(root2, workflow, relative, "intake");
    }
    if (state.mode === "routed" && currentOpenStep(state) === "implementation" && governed) {
      const approvalPending = state.obligations?.some((obligation) => obligation.kind === "approval" && obligation.status !== "satisfied") ?? false;
      if (approvalPending && !workflow.approvalConfirmed) {
        return approvalBlock(root2, workflow, relative, "approval");
      }
      const unitBlock = implementationUnitWriteBlock(state, workflow.ledger, relative);
      if (unitBlock?.code === "IMPLEMENTATION_UNIT_OUT_OF_SCOPE") {
        return block("IMPLEMENTATION_UNIT_OUT_OF_SCOPE", [relative], "active implementation unit is not backed by the current trace");
      }
      if (unitBlock?.code === "IMPLEMENTATION_UNIT_REQUIRED") unitNeededPath ??= relative;
      continue;
    }
  }
  if (unitNeededPath) {
    try {
      const prepared = await ensureActiveImplementationUnit(root2, workflow.featureId, state);
      if (prepared.revision !== state.revision) {
        const refreshed = await loadActiveWorkflow(root2);
        if (refreshed.kind !== "ready") {
          return block("IMPLEMENTATION_UNIT_REQUIRED", [unitNeededPath], "no active implementation unit", { beginFailed: "active workflow refresh after implementation-unit preparation did not produce a readable state" });
        }
        for (const relative of paths) {
          if (!isGoverned(relative, refreshed.workflow.governedRoots)) continue;
          const unitBlock = implementationUnitWriteBlock(refreshed.workflow.state, refreshed.workflow.ledger, relative);
          if (unitBlock?.code === "IMPLEMENTATION_UNIT_OUT_OF_SCOPE") {
            return block("IMPLEMENTATION_UNIT_OUT_OF_SCOPE", [relative], "active implementation unit is not backed by the current trace");
          }
        }
        return { decision: "allow" };
      }
      return block("IMPLEMENTATION_UNIT_REQUIRED", [unitNeededPath], "no active implementation unit");
    } catch (error) {
      const diagnostic = error instanceof Error ? error.message : String(error);
      return block("IMPLEMENTATION_UNIT_REQUIRED", [unitNeededPath], "no active implementation unit", { beginFailed: diagnostic });
    }
  }
  return { decision: "allow" };
}
async function approvalBlock(root2, workflow, relative, variant) {
  let revokedKind;
  try {
    revokedKind = await revokedImplementationApprovalHint(root2, workflow.featureId);
  } catch {
    return block("WORKFLOW_STATE_UNREADABLE", [relative], "events.jsonl invalid or unreadable", { unreadableReason: "events.jsonl invalid or unreadable" });
  }
  return block("IMPLEMENTATION_APPROVAL_REQUIRED", [relative], "governed write requires implementation approval", {
    variant,
    ...revokedKind ? { revokedKind } : {}
  });
}
function evaluateGitWrite(workflow, intent) {
  if (intent.kind !== "git") return { decision: "allow" };
  if ("form" in intent) {
    if (intent.form === "publish") {
      return block("GIT_GUARD", [], "external publish is not allowed", { variant: "publish" });
    }
    return block("GIT_GUARD", [], "git write cannot be safety-enumerated", { variant: "unbounded" });
  }
  const state = workflow.state;
  const paths = intent.paths;
  if (!state || state.lifecycle !== "active") {
    return block("GIT_GUARD", paths, "git delivery write is not allowed before the implementation stage", { variant: "not-eligible" });
  }
  const implementationReady = state.mode === "routed" && currentOpenStep(state) === "implementation" && workflow.approvalConfirmed;
  if (!state.logicComplete && !implementationReady) {
    return block("GIT_GUARD", paths, "git delivery write is not allowed before logic-complete", { variant: "not-eligible" });
  }
  const startedDirty = state.workspace.startedDirty ?? {};
  const startupExcluded = paths.filter((relative) => state.workspace.ownership[relative] === "excluded" && startedDirty[relative] !== void 0);
  const excluded = paths.filter((relative) => state.workspace.ownership[relative] === "excluded" && startedDirty[relative] === void 0);
  const unknown = paths.filter((relative) => state.workspace.ownership[relative] !== "feature" && state.workspace.ownership[relative] !== "excluded" && !inFeatureScope(relative, state));
  if (excluded.length || unknown.length) {
    return block("GIT_GUARD", [...excluded, ...unknown], "git command includes unowned or excluded paths", { variant: "paths" });
  }
  if (startupExcluded.length) {
    return {
      decision: "audit",
      block: {
        code: "GIT_STARTUP_EXCLUDED",
        paths: startupExcluded,
        reason: "startup-excluded pre-existing dirty paths are not blocked but stay out of delivery"
      }
    };
  }
  return { decision: "allow" };
}

// plugins/dev-flow/src/hosts/adapter-policy.ts
function hostToolExecutionDetails(event2, succeeded, fallbackEventId) {
  const response = event2.tool_response ?? event2.tool_result;
  const record = response && typeof response === "object" && !Array.isArray(response) ? response : void 0;
  const message = [record?.summary, record?.message, record?.text].find((value) => typeof value === "string" && value.trim().length > 0);
  return {
    toolName: String(event2.tool_name ?? "unknown"),
    executionId: event2.tool_use_id ?? event2.event_id ?? fallbackEventId,
    result: succeeded ? "success" : "failure",
    resultSummary: (message?.trim() ?? (succeeded ? "\u5DE5\u5177\u6267\u884C\u6210\u529F" : "\u5DE5\u5177\u6267\u884C\u5931\u8D25")).slice(0, 512)
  };
}
function createPreToolBlock(code, reason, impact, recovery) {
  return { code, reason, impact, recovery, recoveryHint: recovery.action };
}
function formatPreToolBlock(block2) {
  const confirmation = block2.recovery.mode === "user-decision" ? "\u9700\u8981\u7528\u6237\u51B3\u5B9A\uFF1B\u6A21\u578B\u5E94\u53EA\u8BE2\u95EE\u4E00\u6B21\uFF0C\u786E\u8BA4\u540E\u76F4\u63A5\u6267\u884C\u89E3\u51B3\u52A8\u4F5C\u3002" : block2.recovery.mode === "guided" ? "\u5148\u81EA\u52A8\u6267\u884C\u89E3\u51B3\u52A8\u4F5C\uFF1B\u53EA\u6709\u52A8\u4F5C\u8BC1\u660E\u9700\u8981 recover\u3001\u91CD\u5EFA\u3001\u653E\u5F03\u6216\u6539\u53D8\u76EE\u6807\u65F6\u624D\u8BE2\u95EE\u7528\u6237\u4E00\u6B21\u3002" : "\u4E0D\u9700\u8981\u7528\u6237\u51B3\u5B9A\uFF1B\u6A21\u578B\u53EF\u4EE5\u76F4\u63A5\u6267\u884C\u89E3\u51B3\u52A8\u4F5C\u3002";
  const continuation = block2.recovery.retryOriginal ? "\u89E3\u51B3\u540E\u81EA\u52A8\u91CD\u8BD5\u539F\u64CD\u4F5C\uFF0C\u65E0\u9700\u7528\u6237\u518D\u6B21\u56DE\u590D\u7EE7\u7EED" : "\u539F\u64CD\u4F5C\u4E0D\u4F1A\u91CD\u8BD5\uFF1B\u5B8C\u6210\u89E3\u51B3\u52A8\u4F5C\u540E\u7EE7\u7EED\u540E\u7EED\u5FC5\u8981\u6B65\u9AA4";
  return [
    block2.code,
    `\u539F\u56E0\uFF1A${block2.reason}`,
    `\u5F71\u54CD\uFF1A${block2.impact}`,
    `\u89E3\u51B3\u65B9\u6848\uFF1A${block2.recovery.action}`,
    `\u786E\u8BA4\uFF1A${confirmation}`,
    `\u7EE7\u7EED\u65B9\u5F0F\uFF1A${continuation}`
  ].join("\n");
}
var directWriteTools = /* @__PURE__ */ new Set(["write", "edit", "multiedit", "applypatch", "apply_patch", "patch"]);
var scratchHint = "\uFF1B\u4E34\u65F6\u9A8C\u8BC1\u6587\u4EF6\u8BF7\u653E\u5165 scratch/ \u76EE\u5F55";
var runGit = promisify4(execFile4);
function toolName(event2) {
  return String(event2.tool_name ?? "").toLowerCase();
}
function isRelevantPreToolUse(event2) {
  const name = toolName(event2);
  return name === "bash" || directWriteTools.has(name);
}
function projectRelative(root2, target) {
  const absolute = path14.resolve(root2, target);
  const relative = path14.relative(root2, absolute);
  if (relative === "" || relative.startsWith("..") || path14.isAbsolute(relative)) return void 0;
  return relative.split(path14.sep).join("/").normalize("NFC");
}
function projectRelativePaths(root2, targets) {
  const seen = /* @__PURE__ */ new Set();
  const paths = [];
  for (const target of targets) {
    const relative = projectRelative(root2, target);
    if (!relative || seen.has(relative)) continue;
    seen.add(relative);
    paths.push(relative);
  }
  return paths;
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
function trustedWriteTargets(root2, event2) {
  const targets = toolName(event2) === "bash" ? (() => {
    const analysis = analyzeBashWriteTargets(String(event2.tool_input?.command ?? ""));
    return analysis.kind === "resolved" ? analysis.targets : [];
  })() : directTargets(event2);
  return [...new Set(targets.map((target) => projectRelative(root2, target)).filter((value) => Boolean(value)))].sort();
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
  return command ? path14.posix.basename(command) : void 0;
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
      for (const path17 of paths) collect2(path17);
    }
    const simple = withoutEnv.match(/^(touch|mkdir|rm)\b/);
    if (simple) {
      const words = commandWords(withoutEnv, simple[1]);
      const paths = words && collectPathOperands(words, 0);
      if (!paths) return { kind: "unresolved", syntax: "simple-args" };
      for (const path17 of paths) collect2(path17);
    }
    const moveCopy = withoutEnv.match(/^(mv|cp)\b/);
    if (moveCopy) {
      const words = commandWords(withoutEnv, moveCopy[1]);
      const paths = words && collectPathOperands(words, 0);
      if (!paths || paths.length < 2) return { kind: "unresolved", syntax: "mv-cp-args" };
      if (moveCopy[1] === "mv") for (const path17 of paths) collect2(path17);
      else collect2(paths.at(-1));
    }
    const sed = withoutEnv.match(/^sed\s+(-i\S*)\s+([\s\S]*)$/);
    if (sed) {
      const words = shellWords(sed[2]);
      const paths = words && collectPathOperands(words, 1);
      if (!paths) return { kind: "unresolved", syntax: "sed-args" };
      for (const path17 of paths) collect2(path17);
    }
    const perl = withoutEnv.match(/^perl\s+(-pi\S*)\s+([\s\S]*)$/);
    if (perl) {
      const words = shellWords(perl[2]);
      const firstPath = words?.[0] === "-e" ? 2 : 0;
      const paths = words && collectPathOperands(words, firstPath);
      if (!paths) return { kind: "unresolved", syntax: "perl-args" };
      for (const path17 of paths) collect2(path17);
    }
  }
  if (targets.length === 0) {
    if (sawDevNull || masked !== trimmed) return { kind: "read-only" };
    return { kind: "unresolved", syntax: "write-syntax-no-target" };
  }
  return { kind: "resolved", targets };
}
async function stagedGitPaths(root2) {
  const result = await runGit("git", ["diff", "--cached", "--name-only", "-z"], { cwd: root2, encoding: "utf8" });
  return String(result.stdout).split("\0").filter(Boolean).map((value) => value.replaceAll("\\", "/").normalize("NFC"));
}
async function buildGitIntent(command, root2) {
  const gitKind = classifyGitCommandKind(command);
  const localCommit = gitKind === "local-stage" || gitKind === "local-commit";
  const unsafePathForm = localCommit && (/\bgit\s+add\s+(?:-A|--all|\.|-u\b)/.test(command) || /\bgit\s+commit\b[^;&|\n]*?\s(?:-a(?:m)?|--all)(?:\s|$)/.test(command));
  if (gitKind === "external-publish") return { kind: "git", form: "publish" };
  if (unsafePathForm) return { kind: "git", form: "unbounded" };
  if (localCommit) {
    const addMatch = command.match(/\bgit\s+add\s+([^;&|\n]+)/);
    const explicitPaths = addMatch ? addMatch[1].split(/\s+/).filter((value) => value && !value.startsWith("-")) : await stagedGitPaths(root2);
    return { kind: "git", paths: projectRelativePaths(root2, explicitPaths) };
  }
  return { kind: "git", form: "unbounded" };
}
function artifactKind(relative) {
  const displayName = path14.posix.basename(relative, ".md");
  return displayName === "\u9700\u6C42\u6587\u6863" ? "requirements" : displayName === "\u5B9E\u65BD\u8BA1\u5212" ? "implementation-plan" : displayName;
}
function unreadableBlock(reason) {
  return createPreToolBlock(
    "DEV_FLOW_WORKFLOW_STATE_UNREADABLE",
    `\u8BFB\u53D6\u5DE5\u4F5C\u6D41\u8BC1\u636E\u5931\u8D25\uFF1A${reason}`,
    "\u539F\u64CD\u4F5C\u672A\u6267\u884C\uFF1B\u65E0\u6CD5\u5B89\u5168\u786E\u8BA4\u5F53\u524D workflow gate \u662F\u5426\u6EE1\u8DB3",
    {
      mode: "guided",
      action: "\u5148\u81EA\u52A8\u5237\u65B0 active/state \u5E76\u8FD0\u884C\u53EA\u8BFB dev_flow_doctor\uFF1B\u53EA\u6709 doctor \u8BC1\u660E\u5FC5\u987B recover\u3001\u91CD\u5EFA\u6216\u653E\u5F03 feature \u65F6\u624D\u5411\u7528\u6237\u8BE2\u95EE\u4E00\u6B21\uFF0C\u89E3\u51B3\u540E\u81EA\u52A8\u91CD\u8BD5\u539F\u64CD\u4F5C",
      retryOriginal: true
    }
  );
}
function formatWriteGateBlock(block2) {
  const relative = block2.paths[0] ?? "";
  const detail = block2.detail;
  switch (block2.code) {
    case "CONTROL_MUTATION_FORBIDDEN":
      if (detail?.variant === "control-area") {
        return createPreToolBlock(
          "DEV_FLOW_STATE_MUTATION_FORBIDDEN",
          `\u76EE\u6807 ${relative} \u4F4D\u4E8E Dev Flow \u63A7\u5236\u533A\uFF0C\u4E14\u4E0D\u662F active feature \u5DF2\u767B\u8BB0\u7684\u53EF\u7F16\u8F91 Markdown \u8D44\u4EA7`,
          "\u539F\u5199\u5165\u672A\u6267\u884C\uFF1BDev Flow \u63A7\u5236\u533A\u6CA1\u6709\u88AB\u4FEE\u6539",
          { mode: "user-decision", action: "\u786E\u8BA4\u540E\u7531\u6A21\u578B\u8C03\u7528\u5BF9\u5E94 MCP \u5B8C\u6210\u540C\u4E00\u5DE5\u4F5C\u6D41\u610F\u56FE\uFF1B\u4E0D\u8981\u76F4\u63A5\u7F16\u8F91\u63A7\u5236\u533A\u6587\u4EF6", retryOriginal: false }
        );
      }
      return createPreToolBlock(
        "DEV_FLOW_STATE_MUTATION_FORBIDDEN",
        `\u76EE\u6807 ${relative} \u662F Dev Flow \u63A7\u5236\u6587\u4EF6\uFF0C\u4E0D\u80FD\u7531\u666E\u901A\u6587\u4EF6\u5DE5\u5177\u76F4\u63A5\u4FEE\u6539`,
        "\u539F\u5199\u5165\u672A\u6267\u884C\uFF1B\u5DE5\u4F5C\u6D41\u63A7\u5236\u72B6\u6001\u4FDD\u6301\u4E0D\u53D8",
        { mode: "user-decision", action: `\u786E\u8BA4\u540E\u7531\u6A21\u578B\u8C03\u7528\u5BF9\u5E94 MCP \u5B8C\u6210\u5BF9 ${relative} \u7684\u540C\u4E00\u610F\u56FE\uFF1B\u4E0D\u8981\u91CD\u8BD5\u8FD9\u6B21\u63A7\u5236\u6587\u4EF6\u76F4\u63A5\u5199\u5165`, retryOriginal: false }
      );
    case "ARTIFACT_NOT_REGISTERED": {
      const kind = artifactKind(relative);
      return createPreToolBlock(
        "DEV_FLOW_ARTIFACT_NOT_REGISTERED",
        `\u76EE\u6807 ${relative} \u662F active feature \u7684 ${kind} Markdown \u8D44\u4EA7\uFF0C\u4F46\u5C1A\u672A\u767B\u8BB0`,
        "\u539F\u5199\u5165\u672A\u6267\u884C\uFF1B\u8BE5\u8D44\u4EA7\u4E0D\u4F1A\u8FDB\u5165 feature \u8BC1\u636E\u8D26\u672C",
        { mode: "guided", action: `\u5148\u901A\u8FC7 MCP scaffold/register ${kind} \u8D44\u4EA7 ${relative}\uFF0C\u518D\u81EA\u52A8\u91CD\u8BD5\u539F\u5199\u5165`, retryOriginal: true }
      );
    }
    case "IMPLEMENTATION_APPROVAL_REQUIRED": {
      const impact = "\u539F\u5199\u5165\u672A\u6267\u884C\uFF1B\u76EE\u6807\u6587\u4EF6\u548C\u5F53\u524D feature \u72B6\u6001\u672A\u6539\u53D8";
      if (detail?.revokedKind) {
        const action = `\u8BA1\u5212\u4F9D\u636E\uFF08${detail.revokedKind}\uFF09\u5DF2\u5728\u5B9E\u73B0\u6279\u51C6\u540E\u53D8\u66F4\uFF0C\u6279\u51C6\u5DF2\u4F5C\u5E9F\uFF1B\u8BF7\u5148\u5B8C\u6210\u76F8\u5173\u6B65\u9AA4\u5E76\u91CD\u65B0\u786E\u8BA4\u5B9E\u73B0\u6279\u51C6\u540E\u518D\u5199 governed \u6587\u4EF6${scratchHint}`;
        return createPreToolBlock("DEV_FLOW_IMPLEMENTATION_APPROVAL_REQUIRED", action, impact, { mode: "user-decision", action, retryOriginal: true });
      }
      if (detail?.variant === "approval") {
        return createPreToolBlock(
          "DEV_FLOW_IMPLEMENTATION_APPROVAL_REQUIRED",
          `\u5F53\u524D open step \u662F implementation\uFF0C\u4F46\u76EE\u6807 ${relative} \u4F4D\u4E8E governed root\uFF0C\u6267\u884C\u6279\u51C6\u4E49\u52A1\u5C1A\u672A\u6EE1\u8DB3`,
          impact,
          { mode: "user-decision", action: `\u5411\u7528\u6237\u5C55\u793A\u5F53\u524D\u5B9E\u73B0\u6279\u51C6\u95EE\u9898\u5E76\u8BF7\u6C42\u4E00\u6B21\u786E\u8BA4\uFF1B\u786E\u8BA4\u540E\u81EA\u52A8\u91CD\u8BD5\u539F\u5199\u5165${scratchHint}`, retryOriginal: true }
        );
      }
      return createPreToolBlock(
        "DEV_FLOW_IMPLEMENTATION_APPROVAL_REQUIRED",
        `feature \u4ECD\u5904\u4E8E intake\uFF0C\u76EE\u6807 ${relative} \u4F4D\u4E8E governed root\uFF0C\u5C1A\u672A\u8FDB\u5165\u53EF\u6267\u884C\u5B9E\u73B0\u9636\u6BB5`,
        "\u539F\u5199\u5165\u672A\u6267\u884C\uFF1Bgoverned \u76EE\u6807\u4FDD\u6301\u4E0D\u53D8",
        { mode: "user-decision", action: "\u5148\u5B8C\u6210 intake \u8C03\u67E5\u3001\u89E3\u51B3\u5206\u7C7B\u51B3\u7B56\u5E76\u9501\u5B9A\u57FA\u7840\u8DEF\u7EBF\uFF1B\u6EE1\u8DB3\u5B9E\u73B0\u6279\u51C6\u6761\u4EF6\u540E\u81EA\u52A8\u91CD\u8BD5\u539F\u5199\u5165", retryOriginal: true }
      );
    }
    case "IMPLEMENTATION_UNIT_REQUIRED": {
      const base = createPreToolBlock(
        "DEV_FLOW_IMPLEMENTATION_UNIT_REQUIRED",
        `\u76EE\u6807 ${relative} \u5DF2\u901A\u8FC7\u5B9E\u73B0\u6279\u51C6\uFF0C\u4F46\u5F53\u524D\u6CA1\u6709\u6D3B\u52A8\u7684 implementation unit`,
        "\u539F\u5199\u5165\u672A\u6267\u884C\uFF1Bgoverned \u76EE\u6807\u4FDD\u6301\u4E0D\u53D8",
        { mode: "automatic", action: "\u8C03\u7528 dev_flow_begin_implementation_unit \u51C6\u5907\u5F53\u524D implementation unit\uFF1B\u6210\u529F\u540E\u81EA\u52A8\u91CD\u8BD5\u539F\u5199\u5165", retryOriginal: true }
      );
      if (!detail?.beginFailed) return base;
      const reason = `${base.reason} Core \u81EA\u52A8\u51C6\u5907 implementation unit \u5931\u8D25\uFF1A${detail.beginFailed}`;
      const action = `${base.recovery.action}\uFF1B\u4E0D\u8981\u628A\u8BE5 Core \u9519\u8BEF\u89E3\u91CA\u4E3A workflow state unreadable`;
      return { ...base, reason, recovery: { ...base.recovery, action }, recoveryHint: action };
    }
    case "IMPLEMENTATION_UNIT_OUT_OF_SCOPE":
      return createPreToolBlock(
        "DEV_FLOW_IMPLEMENTATION_UNIT_OUT_OF_SCOPE",
        `\u5F53\u524D implementation unit \u5728 Trace \u4E2D\u5DF2\u5931\u6548\uFF0C\u65E0\u6CD5\u8BC1\u660E\u76EE\u6807 ${relative} \u5C5E\u4E8E\u5F53\u524D\u5B9E\u73B0\u4F9D\u636E`,
        "\u539F\u5199\u5165\u672A\u6267\u884C\uFF1B\u76EE\u6807\u6587\u4EF6\u548C Trace \u72B6\u6001\u672A\u6539\u53D8",
        { mode: "user-decision", action: "\u5237\u65B0 Trace\uFF1B\u80FD\u81EA\u52A8\u4FEE\u590D\u5931\u6548\u5F15\u7528\u65F6\u5148\u4FEE\u590D\uFF0C\u5426\u5219\u5C55\u793A\u5DEE\u5F02\u5E76\u5411\u7528\u6237\u8BE2\u95EE\u4E00\u6B21\uFF1B\u89E3\u51B3\u540E\u81EA\u52A8\u91CD\u8BD5\u539F\u5199\u5165", retryOriginal: true }
      );
    case "GIT_GUARD":
      if (detail?.variant === "paths") {
        return createPreToolBlock(
          "DEV_FLOW_GIT_GUARD",
          "Git \u547D\u4EE4\u5305\u542B\u672A\u5F52\u5C5E\u6216\u5DF2\u6392\u9664\u7684\u8DEF\u5F84",
          "\u539F Git \u64CD\u4F5C\u672A\u6267\u884C\uFF1B\u4E0D\u4F1A\u628A\u7528\u6237\u6216\u5176\u4ED6\u4EFB\u52A1\u7684\u6587\u4EF6\u6DF7\u5165 feature \u63D0\u4EA4",
          { mode: "user-decision", action: "\u5148\u5C06\u8DEF\u5F84\u660E\u786E\u7EB3\u5165\u5F53\u524D feature \u6216\u79FB\u51FA\u6682\u5B58\u533A\uFF1B\u672C\u4ED3\u5E93\u7981\u6B62\u667A\u80FD\u4F53\u63D0\u4EA4\u65F6\u4EA4\u7531\u7528\u6237\u5BA1\u6838", retryOriginal: false }
        );
      }
      if (detail?.variant === "publish") {
        return createPreToolBlock(
          "DEV_FLOW_GIT_GUARD",
          "\u5916\u90E8\u53D1\u5E03\u4ECD\u7136\u88AB\u7981\u6B62",
          "\u539F Git \u64CD\u4F5C\u672A\u6267\u884C\uFF1B\u5DE5\u4F5C\u6811\u548C Git \u5386\u53F2\u6CA1\u6709\u88AB\u8FD9\u6B21\u547D\u4EE4\u4FEE\u6539",
          { mode: "guided", action: "\u4E0D\u8981\u6267\u884C push \u6216\u5176\u4ED6\u5916\u90E8\u53D1\u5E03\uFF1B\u672C\u4ED3\u5E93\u7531\u7528\u6237\u5BA1\u6838\u540E\u624B\u52A8\u53D1\u5E03", retryOriginal: true }
        );
      }
      return createPreToolBlock(
        "DEV_FLOW_GIT_GUARD",
        "\u5F53\u524D Git \u5199\u5165\u4E0D\u6EE1\u8DB3\u9636\u6BB5\u3001\u6279\u51C6\u6216\u8DEF\u5F84\u5F52\u5C5E\u6761\u4EF6",
        "\u539F Git \u64CD\u4F5C\u672A\u6267\u884C\uFF1B\u5DE5\u4F5C\u6811\u548C Git \u5386\u53F2\u6CA1\u6709\u88AB\u8FD9\u6B21\u547D\u4EE4\u4FEE\u6539",
        { mode: "guided", action: "\u5148\u5B8C\u6210\u5B9E\u73B0\u6279\u51C6\u5E76\u53EA\u6682\u5B58 feature-owned \u8DEF\u5F84\uFF1B\u4ED3\u5E93\u89C4\u5219\u7981\u6B62\u667A\u80FD\u4F53\u63D0\u4EA4\u65F6\u4EA4\u7531\u7528\u6237\u6267\u884C", retryOriginal: true }
      );
    case "WORKFLOW_STATE_UNREADABLE":
      return unreadableBlock(detail?.unreadableReason ?? block2.reason);
    default:
      return unreadableBlock(block2.reason);
  }
}
async function evaluatePreToolUse(root2, event2) {
  if (!isRelevantPreToolUse(event2)) return { kind: "allow" };
  const advisoryOut = {};
  try {
    const block2 = await evaluatePreToolUseInternal(root2, event2, advisoryOut);
    if (block2) return { kind: "block", block: block2 };
    return advisoryOut.advisory ? { kind: "allow", advisory: advisoryOut.advisory } : { kind: "allow" };
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return {
      kind: "allow",
      advisory: {
        code: "DEV_FLOW_HOOK_EVALUATION_FAILED",
        message: `DEV_FLOW_HOOK_EVALUATION_FAILED: Dev Flow hook analysis failed (${detail}); the original operation was not blocked and remains subject to host permissions.`
      }
    };
  }
}
async function evaluatePreToolUseInternal(root2, event2, advisoryOut = {}) {
  if (!isRelevantPreToolUse(event2)) return void 0;
  const command = typeof event2.tool_input?.command === "string" ? event2.tool_input.command : "";
  if (toolName(event2) === "bash" && classifyGitCommand(command) === "write") {
    const intent = await buildGitIntent(command, root2);
    const verdict2 = await writeGate(root2, intent);
    if (verdict2.decision === "allow") return void 0;
    if (verdict2.decision === "audit") {
      advisoryOut.advisory = {
        code: "DEV_FLOW_GIT_STARTUP_EXCLUDED",
        message: `\u8BE5\u8DEF\u5F84\u542F\u52A8\u524D\u5DF2\u6709\u6539\u52A8\u3001\u5DF2\u9ED8\u8BA4\u6392\u9664\u51FA\u4EA4\u4ED8\uFF1B\u672C\u6B21 Git \u64CD\u4F5C\u672A\u62E6\u622A\uFF0C\u4F46\u8FD9\u4E9B\u6587\u4EF6\u4E0D\u4F1A\u8FDB\u5165\u4EA4\u4ED8\u5FEB\u7167\u3002\u5982\u9700\u8BA1\u5165\u8BF7\u5148\u5728\u5DE5\u4F5C\u533A\u5BF9\u8D26\u7EB3\u5165\uFF1A${verdict2.block.paths.join("\u3001")}`
      };
      return void 0;
    }
    return formatWriteGateBlock(verdict2.block);
  }
  if (toolName(event2) === "bash") {
    const analysis = analyzeBashWriteTargets(command);
    if (analysis.kind === "read-only") return void 0;
    if (analysis.kind === "unresolved") {
      const verdict3 = await writeGate(root2, { kind: "file", unresolved: true });
      if (verdict3.decision === "allow" && verdict3.advisory === "unresolved-write") {
        advisoryOut.advisory = {
          code: "DEV_FLOW_HOOK_UNRESOLVED_WRITE",
          message: "DEV_FLOW_HOOK_UNRESOLVED_WRITE: \u65E0\u6CD5\u4ECE\u547D\u4EE4\u6587\u672C\u786E\u8BA4\u672C\u6B21\u5199\u5165\u6D89\u53CA\u54EA\u4E9B\u6587\u4EF6\uFF0C\u56E0\u6B64\u6CA1\u6709\u81EA\u52A8\u628A\u8FD9\u4E9B\u6587\u4EF6\u8BB0\u5165\u5F53\u524D\u4EFB\u52A1\uFF1B\u5982\u679C\u6D89\u53CA\u9879\u76EE\u6587\u4EF6\uFF0C\u7A0D\u540E\u4F1A\u8BF7\u4F60\u786E\u8BA4\u8FD9\u4E9B\u6587\u4EF6\u662F\u5426\u5C5E\u4E8E\u5F53\u524D\u4EFB\u52A1\u3002"
        };
      }
      return void 0;
    }
    const verdict2 = await writeGate(root2, { kind: "file", paths: projectRelativePaths(root2, analysis.targets) });
    if (verdict2.decision === "block") return formatWriteGateBlock(verdict2.block);
    return void 0;
  }
  const targets = directTargets(event2);
  if (!targets.length) return void 0;
  const verdict = await writeGate(root2, { kind: "file", paths: projectRelativePaths(root2, targets) });
  if (verdict.decision === "block") return formatWriteGateBlock(verdict.block);
  return void 0;
}

// plugins/dev-flow/src/hosts/risk-policy.ts
import { createHash as createHash15 } from "node:crypto";
import path15 from "node:path";
function canonical(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  return `{${Object.entries(value).sort(([left], [right]) => left.localeCompare(right)).map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(",")}}`;
}
function commandFor(input) {
  const command = input.toolInput?.command;
  if (typeof command === "string") return command.trim().replace(/\s+/g, " ");
  return canonical(input.toolInput ?? {});
}
function targetScope(command, root2) {
  if (/[$`*?{]/.test(command) || /(?:^|\s)~(?:\/|\s|$)/.test(command)) return "unknown";
  const candidates = [...command.matchAll(/(?:^|[\s"'=])((?:\/|(?:\.\.\/)+)[^\s'"`;|&]*)/g)].map((match) => match[1]);
  for (const target of candidates) {
    const absolute = path15.resolve(root2, target);
    const relative = path15.relative(root2, absolute);
    if (relative.startsWith("..") || path15.isAbsolute(relative)) return "outside";
  }
  return "inside";
}
function fingerprint2(input, riskClass, category, command) {
  return createHash15("sha256").update(canonical({ riskClass, category, toolName: String(input.toolName ?? ""), command })).digest("hex");
}
function classifyRisk(input, root2) {
  const toolName2 = String(input.toolName ?? "").toLowerCase();
  const command = commandFor(input);
  if (!command && !toolName2) return void 0;
  const external = /\b(?:git\s+push|(?:npm|pnpm|yarn|bun)\s+(?:publish|release)|docker\s+push)\b/i.test(command) || /\b(?:deploy|deployment|publish|release)\b/i.test(command) || /\b(?:production|prod)\b/i.test(command) && /\b(?:change|apply|delete|deploy|push|publish|release|migrate)\b/i.test(command) || /\b(?:terraform\s+destroy|kubectl\s+delete|helm\s+(?:uninstall|delete)|(?:aws|gcloud|az)\b[^\n]*(?:delete|destroy|remove))\b/i.test(command);
  if (external) {
    return {
      riskClass: "always-confirm",
      category: "external-action",
      commandFingerprint: fingerprint2(input, "always-confirm", "external-action", command)
    };
  }
  const destructive = /\brm\s+(?:-[^\s]*r[^\s]*|--recursive)\b/i.test(command) || /\bgit\s+(?:reset\s+--hard|clean\s+[^\n]*-[^\n]*f|(?:checkout|restore)\s+--|rebase)\b/i.test(command) || /\b(?:delete|remove)\b/i.test(toolName2);
  if (!destructive) return void 0;
  const scope = targetScope(command, root2);
  if (scope !== "inside") {
    return {
      riskClass: "always-confirm",
      category: "external-action",
      commandFingerprint: fingerprint2(input, "always-confirm", "external-action", command)
    };
  }
  return {
    riskClass: "task-reusable",
    category: "destructive-worktree",
    commandFingerprint: fingerprint2(input, "task-reusable", "destructive-worktree", command)
  };
}

// plugins/dev-flow/src/hosts/host-authorization.ts
function eventId(event2, assessment, kind) {
  const value = event2;
  const supplied = [value.event_id, value.tool_use_id, value.permission_request_id].find((candidate) => typeof candidate === "string" && candidate.length > 0);
  return supplied ?? `${kind}:${assessment.commandFingerprint}`;
}
function executionKey(event2) {
  const value = event2;
  return [value.tool_use_id, value.permission_request_id, value.event_id].find((candidate) => typeof candidate === "string" && candidate.length > 0);
}
async function activeFeature(root2) {
  const active = await readActive(root2);
  if (!active) return void 0;
  const state = await readState(root2, active.featureId);
  if (state.lifecycle !== "active" || state.revision !== active.revision) return void 0;
  return { featureId: active.featureId, revision: active.revision };
}
function sameRequest(record, host, featureId, assessment) {
  return record.host === host && record.featureId === featureId && record.riskClass === assessment.riskClass && record.commandFingerprint === assessment.commandFingerprint;
}
async function evaluatePermissionRequest(root2, event2, host) {
  if (event2.hook_event_name !== "PermissionRequest") return void 0;
  const assessment = classifyRisk({ toolName: event2.tool_name, toolInput: event2.tool_input }, root2);
  if (!assessment) return void 0;
  const feature = await activeFeature(root2);
  if (!feature) return void 0;
  const events = await readHostAuthorizationEvents(root2, feature.featureId);
  const key = executionKey(event2);
  if (key !== void 0 && events.some((item) => item.type === "host-authorization-pending" && item.data.executionKey === key)) {
    return void 0;
  }
  const sourceToolEvent = eventId(event2, assessment, "permission-request");
  await recordHostAuthorizationEvent(root2, "host-authorization-pending", {
    host,
    featureId: feature.featureId,
    riskClass: assessment.riskClass,
    commandFingerprint: assessment.commandFingerprint,
    sourceToolEvent,
    ...key !== void 0 ? { executionKey: key } : {},
    requestedAt: (/* @__PURE__ */ new Date()).toISOString()
  });
  return { kind: "defer", assessment };
}
function postToolSucceeded(event2) {
  const value = event2;
  if (value.error !== void 0 && value.error !== null) return false;
  for (const response of [value.tool_response, value.tool_result]) {
    if (!response || typeof response !== "object") continue;
    const candidate = response;
    if (candidate.is_error === true || candidate.isError === true || candidate.success === false || candidate.error !== void 0) return false;
  }
  return true;
}
async function recordPermissionPostToolUse(root2, event2, host) {
  if (event2.hook_event_name !== "PostToolUse" || !postToolSucceeded(event2)) return;
  const assessment = classifyRisk({ toolName: event2.tool_name, toolInput: event2.tool_input }, root2);
  if (!assessment || assessment.riskClass !== "task-reusable") return;
  const feature = await activeFeature(root2);
  if (!feature) return;
  const events = await readHostAuthorizationEvents(root2, feature.featureId);
  const key = executionKey(event2);
  const pending = [...events].reverse().find((item) => {
    if (item.type !== "host-authorization-pending") return false;
    if (item.data.executionKey !== void 0) {
      return key !== void 0 && item.data.executionKey === key;
    }
    return sameRequest(item.data, host, feature.featureId, assessment);
  });
  if (!pending) return;
  await recordHostAuthorizationEvent(root2, "host-authorization-granted", {
    host,
    featureId: feature.featureId,
    riskClass: assessment.riskClass,
    commandFingerprint: assessment.commandFingerprint,
    sourceToolEvent: pending.data.sourceToolEvent,
    ...pending.data.executionKey !== void 0 ? { executionKey: pending.data.executionKey } : {},
    grantedAt: (/* @__PURE__ */ new Date()).toISOString()
  });
}

// plugins/dev-flow/src/core/host-recovery.ts
async function observeHostRecovery(root2, signal) {
  const health = await recordHostHealth(root2, signal);
  if (!health.recovered) return;
  const active = await readActive(root2);
  if (!active) return;
  const state = await readState(root2, active.featureId);
  if (state.lifecycle !== "active" && state.lifecycle !== "finalized") return;
  await reconcileWorkspace(root2, active.featureId, state.revision, signal.host);
}

// plugins/dev-flow/src/hosts/host-health-adapter.ts
async function recordAdapterHealth(root2, event2, host) {
  const kind = event2.hook_event_name === "SessionStart" ? "session-start" : event2.hook_event_name === "UserPromptSubmit" ? "user-prompt-submit" : event2.hook_event_name === "Stop" ? "turn-boundary" : event2.hook_event_name === "PreToolUse" || event2.hook_event_name === "PostToolUse" ? "tool" : void 0;
  if (!kind) return;
  try {
    await observeHostRecovery(root2, {
      host,
      kind,
      eventId: event2.event_id ?? `${event2.hook_event_name}-${Date.now()}`
    });
  } catch {
  }
}

// plugins/dev-flow/src/hosts/project-root.ts
import { access as access3 } from "node:fs/promises";
import path16 from "node:path";
async function hasDevFlowMarker(directory) {
  for (const marker of ["project.json", "active.json"]) {
    try {
      await access3(path16.join(directory, ".dev-flow", marker));
      return true;
    } catch {
    }
  }
  return false;
}
async function resolveDevFlowRoot(cwd) {
  const original = path16.resolve(cwd);
  let current = original;
  for (; ; ) {
    if (await hasDevFlowMarker(current)) return current;
    const parent = path16.dirname(current);
    if (parent === current) return original;
    current = parent;
  }
}

// plugins/dev-flow/src/hosts/codex-adapter.ts
var chunks = [];
for await (const chunk of process.stdin) chunks.push(Buffer.from(chunk));
var event = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
var root = await resolveDevFlowRoot(event.cwd ?? process.cwd());
await recordAdapterHealth(root, event, "codex");
if (event.hook_event_name === "PermissionRequest") {
  try {
    const outcome = await evaluatePermissionRequest(root, event, "codex");
    if (outcome?.kind === "allow") process.stdout.write(JSON.stringify({ decision: "allow" }) + "\n");
  } catch (error) {
    process.stderr.write(`Dev Flow Codex permission evaluation failed: ${String(error)}
`);
  }
}
if (event.hook_event_name === "PreToolUse") {
  try {
    const outcome = await evaluatePreToolUse(root, event);
    if (outcome.kind === "block") {
      process.stdout.write(JSON.stringify({ decision: "block", reason: formatPreToolBlock(outcome.block) }) + "\n");
    } else if (outcome.advisory) {
      process.stdout.write(JSON.stringify({ hookSpecificOutput: { additionalContext: outcome.advisory.message } }) + "\n");
    } else {
      await recordTrustedWriteIntent(root, trustedWriteTargets(root, event), "codex", event.event_id ?? event.tool_use_id ?? `pre-${Date.now()}`);
    }
  } catch (error) {
    process.stderr.write(`Dev Flow Codex hook evaluation failed: ${String(error)}
`);
  }
}
if (event.hook_event_name === "UserPromptSubmit" || event.hook_event_name === "Stop" || event.hook_event_name === "PostToolUse") {
  if (event.hook_event_name === "PostToolUse") {
    try {
      await recordPermissionPostToolUse(root, event, "codex");
    } catch {
    }
    if (postToolSucceeded(event)) {
      try {
        await recordTrustedWriteOwnership(root, trustedWriteTargets(root, event), "codex", event.event_id ?? event.tool_use_id ?? `post-${Date.now()}`);
      } catch {
      }
    }
  }
  try {
    const text = event.prompt ?? event.user_prompt ?? event.tool_input?.prompt;
    const eventId2 = event.event_id ?? `${event.hook_event_name}-${Date.now()}`;
    await recordHostEvent(root, {
      eventId: eventId2,
      type: event.hook_event_name === "UserPromptSubmit" ? "user-prompt" : event.hook_event_name === "Stop" ? "turn-boundary" : "tool",
      host: "codex",
      text: typeof text === "string" ? text : void 0,
      ...event.hook_event_name === "PostToolUse" ? hostToolExecutionDetails(event, postToolSucceeded(event), eventId2) : {}
    });
  } catch {
  }
}
