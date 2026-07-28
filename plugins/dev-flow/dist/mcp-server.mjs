/* dev-flow 1.7.0; built from source, deterministic build */

// plugins/dev-flow/src/mcp/server.ts
import readline from "node:readline";
import { fileURLToPath } from "node:url";
import path10 from "node:path";

// plugins/dev-flow/src/core/artifacts.ts
import { createHash as createHash4 } from "node:crypto";
import { readFile as readFile4, writeFile as writeFile3 } from "node:fs/promises";
import path5 from "node:path";

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

// plugins/dev-flow/src/policy/contract.ts
var contract = contract_default;
if (contract.schemaVersion !== 1) {
  throw new Error(`unsupported contract schema ${String(contract.schemaVersion)}`);
}
var allowedRiskLabels = Object.freeze(Object.keys(contract.riskEnhancements));
function routeDefinition(route) {
  return contract.routes[route];
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
  return {
    route: state.route,
    scope: state.scope,
    classification: state.classification,
    artifacts: Object.fromEntries(
      gateBasisArtifacts[gate].map((kind) => [kind, state.artifacts[kind]])
    )
  };
}

// plugins/dev-flow/src/core/state-store.ts
import { randomUUID, createHash as createHash3 } from "node:crypto";
import { access, mkdir, open, readFile as readFile3, rename, rm, writeFile as writeFile2 } from "node:fs/promises";
import { hostname } from "node:os";
import path4 from "node:path";

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
  if (level === "XS" || level === "S") {
    if (execution) throw new PolicyError("EXECUTION_NOT_ALLOWED", "XS/S do not accept execution");
    return { classification, route: riskLabels.length ? "risk-minimal" : level.toLowerCase() };
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
  const manifestPath = path.posix.join(relativeDirectory2, manifestFilename);
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
  await writeFile(path.join(root2, manifestPath), manifest, "utf8");
  return { manifestPath, manifestSha256: manifestHash, patchPath, patchSha256: patchHash, baseHead: baseline.gitHead, files };
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
  const digest3 = createHash2("sha256");
  for (const relative of files.sort()) {
    digest3.update(relative);
    digest3.update("\0");
    digest3.update(await readFile2(path2.join(root2, relative)));
    digest3.update("\0");
  }
  return digest3.digest("hex");
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

// plugins/dev-flow/src/core/state-store.ts
var lifecycles = /* @__PURE__ */ new Set(["active", "paused", "finalized", "abandoned"]);
function validateFeatureState(value) {
  const state = value;
  if (state?.schemaVersion !== 1) throw new DevFlowError("UNSUPPORTED_STATE_SCHEMA", "only state schema v1 is supported");
  if (typeof state.featureId !== "string" || !state.featureId || !Number.isInteger(state.revision) || (state.revision ?? -1) < 0 || !lifecycles.has(state.lifecycle) || !routeDefinition(state.route) || !state.classification || !state.scope || !Array.isArray(state.scope.inScope) || !Array.isArray(state.scope.outOfScope) || !state.steps || !state.humanGates || !state.artifacts || !state.verification || !Array.isArray(state.verification.attempts) || state.interactions !== void 0 && (typeof state.interactions !== "object" || state.interactions === null || Array.isArray(state.interactions)) || !state.featureCheck || !Array.isArray(state.blockingFindings) || typeof state.logicComplete !== "boolean" || !state.lastUpdatedBy) {
    throw new DevFlowError("INVALID_STATE_SCHEMA", "state is not a valid v1 feature state");
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
var devFlow = (root2) => path4.join(root2, ".dev-flow");
var features = (root2) => path4.join(devFlow(root2), "features");
var statePath = (root2, id) => path4.join(features(root2), id, "state.json");
var eventPath = (root2, id) => path4.join(features(root2), id, "events.jsonl");
var activePath = (root2) => path4.join(devFlow(root2), "active.json");
var recoveryTxnPath = (root2) => path4.join(devFlow(root2), "recovery-transaction.json");
var recoveryEventsPath = (root2) => path4.join(devFlow(root2), "recovery-events.jsonl");
async function readProjectConfig(root2) {
  try {
    const value = JSON.parse(await readFile3(path4.join(devFlow(root2), "project.json"), "utf8"));
    validateProjectConfig(value);
    return value;
  } catch (error) {
    if (error instanceof DevFlowError) throw error;
    throw new DevFlowError("PROJECT_NOT_INITIALIZED", "run dev_flow_init_project first");
  }
}
async function initProject(root2, config) {
  validateProjectConfig(config);
  await mkdir(devFlow(root2), { recursive: true });
  await writeAtomic(path4.join(devFlow(root2), "project.json"), config);
}
async function writeAtomic(file, value) {
  const temp = `${file}.${randomUUID()}.tmp`;
  const handle = await open(temp, "w");
  try {
    await handle.writeFile(`${JSON.stringify(value, null, 2)}
`);
    await handle.sync();
  } finally {
    await handle.close();
  }
  await rename(temp, file);
  const directory = await open(path4.dirname(file), "r");
  try {
    await directory.sync();
  } finally {
    await directory.close();
  }
}
async function writeStatusProjection(root2, state, revision) {
  const status = state.artifacts.status;
  if (!status) return;
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
    ...routeDefinition(state.route).orderedSteps.map((step) => `- ${step}: ${state.steps[step]?.status ?? "pending"}`),
    ""
  ].join("\n");
  const file = path4.join(features(root2), state.featureId, status.path);
  await writeFile2(file, `${projection}
`);
  state.artifacts.status = { ...status, sha256: createHash3("sha256").update(`${projection}
`).digest("hex") };
}
async function lock(root2, featureId, operation) {
  const directory = path4.join(devFlow(root2), ".lock");
  const started = Date.now();
  await mkdir(devFlow(root2), { recursive: true });
  while (true) {
    try {
      await mkdir(directory);
      await writeFile2(path4.join(directory, "owner.json"), JSON.stringify({ pid: process.pid, hostname: hostname(), acquiredAt: (/* @__PURE__ */ new Date()).toISOString(), featureId, operation }));
      return async () => {
        await rm(directory, { recursive: true, force: true });
      };
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
      try {
        const owner = JSON.parse(await readFile3(path4.join(directory, "owner.json"), "utf8"));
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
    const state = JSON.parse(await readFile3(statePath(root2, featureId), "utf8"));
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
    raw = await readFile3(activePath(root2), "utf8");
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
  const handle = await open(eventPath(root2, id), "a");
  try {
    await handle.writeFile(`${JSON.stringify({ revision, type, at: (/* @__PURE__ */ new Date()).toISOString(), data })}
`);
    await handle.sync();
  } finally {
    await handle.close();
  }
}
async function stateFileSha256(root2, featureId) {
  const contents = await readFile3(statePath(root2, featureId));
  return createHash3("sha256").update(contents).digest("hex");
}
async function readFeatureEvents(root2, id) {
  try {
    return (await readFile3(eventPath(root2, id), "utf8")).split("\n").filter(Boolean).map((line) => JSON.parse(line));
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }
}
async function startFeature(root2, input) {
  await readProjectConfig(root2);
  await assertNoOpenRecovery(root2);
  const scope = validateScopeInput(input.scope);
  const id = input.featureId ?? randomUUID();
  const release = await lock(root2, id, "start");
  try {
    await assertNoOpenRecovery(root2);
    const active = await readActive(root2);
    const lifecycle = input.activation ?? "active";
    if (lifecycle === "active" && active) throw new DevFlowError("ACTIVE_FEATURE_CONFLICT", "an active feature already exists");
    const { classification, route } = selectRoute(input);
    const project = await readProjectConfig(root2);
    const startBusinessFingerprint = await fingerprintProtectedRoots(root2, project.protectedRoots);
    const deliveryBaseline = await captureDeliveryBaseline(root2, project.protectedRoots);
    await mkdir(path4.join(features(root2), id), { recursive: true });
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
      featureCheck: {},
      startBusinessFingerprint,
      deliveryBaseline,
      blockingFindings: [],
      logicComplete: false,
      lastUpdatedBy: { host: input.host, pluginVersion: "1.7.0" }
    };
    await writeAtomic(statePath(root2, id), state);
    await appendEvent(root2, id, 0, "started", { lifecycle, route });
    if (lifecycle === "active") await writeAtomic(activePath(root2), { featureId: id, revision: 0, updatedAt: (/* @__PURE__ */ new Date()).toISOString() });
    return state;
  } finally {
    await release();
  }
}
async function mutate(root2, id, expectedRevision, operation, mutator, eventData = {}) {
  const release = await lock(root2, id, operation);
  try {
    return await mutateLocked(root2, id, expectedRevision, operation, mutator, eventData);
  } finally {
    await release();
  }
}
async function mutateLocked(root2, id, expectedRevision, operation, mutator, eventData = {}) {
  const state = await readState(root2, id);
  if (state.revision !== expectedRevision) throw new DevFlowError("STATE_REVISION_CONFLICT", "state revision changed", { currentRevision: state.revision });
  await mutator(state);
  state.revision += 1;
  await writeStatusProjection(root2, state, state.revision);
  await writeAtomic(statePath(root2, id), state);
  const data = typeof eventData === "function" ? eventData() : eventData;
  await appendEvent(root2, id, state.revision, operation, data);
  const active = await readActive(root2);
  if (active?.featureId === id && (state.lifecycle === "finalized" || state.lifecycle === "abandoned")) await rm(activePath(root2), { force: true });
  else if (active?.featureId === id) await writeAtomic(activePath(root2), { featureId: id, revision: state.revision, updatedAt: (/* @__PURE__ */ new Date()).toISOString() });
  return state;
}
async function switchActive(root2, from, to, reason) {
  if (!reason) throw new DevFlowError("SWITCH_REASON_REQUIRED", "switch requires a reason");
  const release = await lock(root2, `${from}:${to}`, "switch-active");
  try {
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
  if (transaction?.schemaVersion !== 1 || typeof transaction.transactionId !== "string" || !transaction.transactionId || !isRecoveryPhase(transaction.phase) || typeof transaction.featureId !== "string" || !transaction.featureId || typeof transaction.stateSha256 !== "string" || !transaction.stateSha256 || typeof transaction.recoveredTo !== "string" || !path4.isAbsolute(transaction.recoveredTo) || typeof transaction.reason !== "string" || typeof transaction.userEvidence !== "string" || transaction.host !== "claude" && transaction.host !== "codex" || typeof transaction.at !== "string" || transaction.activeSha256 !== void 0 && typeof transaction.activeSha256 !== "string") {
    throw new DevFlowError("RECOVERY_TRANSACTION_UNREADABLE", "recovery journal is invalid", {
      recoveryHint: "Run dev_flow_doctor; do not start a new feature or hand-edit .dev-flow"
    });
  }
  if (path4.basename(transaction.featureId) !== transaction.featureId || transaction.featureId === "." || transaction.featureId === "..") {
    throw new DevFlowError("RECOVERY_TRANSACTION_UNREADABLE", "recovery journal has an unsafe feature id", { recoveryHint: "Run dev_flow_doctor; recovery remains fail-closed" });
  }
}
function validateRecoveryLocation(root2, transaction) {
  const recoveredRoot = path4.join(devFlow(root2), "recovered");
  const relative = path4.relative(recoveredRoot, transaction.recoveredTo);
  if (!relative || relative.startsWith("..") || path4.isAbsolute(relative) || path4.basename(relative) !== relative) {
    throw new DevFlowError("RECOVERY_TRANSACTION_UNREADABLE", "recovery journal points outside the recovered directory", {
      recoveryHint: "Run dev_flow_doctor; do not start a new feature or hand-edit .dev-flow"
    });
  }
}
async function readRecoveryTransaction(root2) {
  let raw;
  try {
    raw = await readFile3(recoveryTxnPath(root2), "utf8");
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
  return createHash3("sha256").update(await readFile3(file)).digest("hex");
}
async function updateRecoveryTransaction(root2, transaction, phase) {
  const next = { ...transaction, phase, ...phase === "completed" ? { completedAt: (/* @__PURE__ */ new Date()).toISOString() } : {} };
  await writeAtomic(recoveryTxnPath(root2), next);
  return next;
}
async function recoveryEventExists(root2, transactionId) {
  try {
    return (await readFile3(recoveryEventsPath(root2), "utf8")).split("\n").filter(Boolean).some((line) => {
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
  const handle = await open(recoveryEventsPath(root2), "a");
  try {
    await handle.writeFile(`${JSON.stringify({ ...transaction, phase: "completed", completedAt: (/* @__PURE__ */ new Date()).toISOString() })}
`);
    await handle.sync();
  } finally {
    await handle.close();
  }
}
async function resumeRecovery(root2, transaction) {
  const sourceDir = path4.join(features(root2), transaction.featureId);
  if (transaction.phase === "prepared") {
    const [sourceExists, recoveredExists] = await Promise.all([pathExists(sourceDir), pathExists(transaction.recoveredTo)]);
    if (sourceExists === recoveredExists) throw new DevFlowError("RECOVERY_TRANSACTION_INCONSISTENT", "cannot safely determine feature-directory recovery stage", { recoveryHint: "Run dev_flow_doctor; do not start a new feature" });
    if (sourceExists) await rename(sourceDir, transaction.recoveredTo);
    transaction = await updateRecoveryTransaction(root2, transaction, "directory-moved");
  }
  if (transaction.phase === "directory-moved") {
    if (transaction.activeSha256) {
      if (await pathExists(activePath(root2))) {
        if (await fileSha256(activePath(root2)) !== transaction.activeSha256) {
          throw new DevFlowError("RECOVERY_POINTER_DIGEST_MISMATCH", "active pointer changed during recovery", { recoveryHint: "Run dev_flow_doctor; recovery remains fail-closed" });
        }
        await rename(activePath(root2), path4.join(transaction.recoveredTo, "active.json"));
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
async function recoverCorruptFeature(root2, input) {
  if (input.action !== "abandon") throw new DevFlowError("INVALID_RECOVERY_ACTION", "only abandon is supported in 1.3");
  if (!input.reason || !input.userEvidence) throw new DevFlowError("RECOVERY_EVIDENCE_REQUIRED", "reason and userEvidence are required");
  if (path4.basename(input.featureId) !== input.featureId || input.featureId === "." || input.featureId === "..") throw new DevFlowError("INVALID_FEATURE_ID", "recovery featureId must name one feature directory");
  const release = await lock(root2, input.featureId, "recover-corrupt");
  try {
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
    let digest3;
    try {
      digest3 = await stateFileSha256(root2, input.featureId);
    } catch {
      throw new DevFlowError("RECOVERY_STATE_MISSING", "feature state file is missing", { recoveryHint: "Run dev_flow_doctor; recovery remains fail-closed" });
    }
    if (digest3 !== input.stateSha256) throw new DevFlowError("RECOVERY_DIGEST_MISMATCH", "stateSha256 does not match current corrupt state", { currentDigest: digest3, recoveryHint: "Re-run dev_flow_doctor and use the reported stateSha256" });
    try {
      const state = await readState(root2, input.featureId);
      if (!pointerRecovery || state.lifecycle !== "active") throw new DevFlowError("RECOVERY_STATE_VALID", "feature state is readable; use abandon instead of recovery");
    } catch (error) {
      if (error instanceof DevFlowError && error.code === "RECOVERY_STATE_VALID") throw error;
    }
    const timestamp = (/* @__PURE__ */ new Date()).toISOString().replace(/[:.]/g, "-");
    const recoveredDir = path4.join(devFlow(root2), "recovered", `${input.featureId}-${timestamp}`);
    await mkdir(path4.join(devFlow(root2), "recovered"), { recursive: true });
    const prepared = {
      schemaVersion: 1,
      transactionId: randomUUID(),
      phase: "prepared",
      featureId: input.featureId,
      stateSha256: digest3,
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
  const retainedArtifacts = Object.fromEntries(Object.entries(state.artifacts).filter(([kind]) => routeDefinition(previousRoute).requiredArtifacts.includes(kind) && routeDefinition(selected.route).requiredArtifacts.includes(kind)));
  const retainedSteps = {};
  for (const step of routeDefinition(selected.route).orderedSteps) {
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
    const state = await mutateLocked(root2, id, expectedRevision, "reclassified", (draft) => {
      if (draft.lifecycle !== "active") throw new DevFlowError("INVALID_LIFECYCLE", "only an active feature can be reclassified");
      const selected = selectRoute(next);
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
    }, () => eventData);
    return notice ? { ...state, reclassifyNotice: notice } : state;
  } finally {
    await release();
  }
}

// plugins/dev-flow/src/core/step-order.ts
function currentOpenStep(state) {
  return routeDefinition(state.route).orderedSteps.find((step) => state.steps[step]?.status !== "satisfied");
}
function assertCurrentStep(state, step) {
  if (currentOpenStep(state) !== step) throw new DevFlowError("STEP_OUT_OF_ORDER", `${step} is not the current route step`, { expected: currentOpenStep(state) });
}
function artifactsRequiredBeforeGate(state, gate) {
  const definition = routeDefinition(state.route);
  const index = definition.orderedSteps.indexOf(gate);
  return [...new Set(definition.orderedSteps.slice(0, index).flatMap((step) => definition.artifactSteps?.[step] ?? []))];
}

// plugins/dev-flow/src/core/user-interactions.ts
import { randomBytes, randomUUID as randomUUID2 } from "node:crypto";
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
    id: randomUUID2(),
    kind: input.kind,
    target: input.target,
    basisHash: input.basisHash,
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
var hash = (value) => createHash4("sha256").update(value).digest("hex");
var featureDirectory = (root2, id) => path5.join(root2, ".dev-flow", "features", id);
function template(state, id, kind) {
  const grillStatus = kind === "requirements" && state.classification.requirements === "provided-confirmed" ? "not_required" : "pending";
  const header = `---
dev_flow:
  schema_version: 1
  feature_id: ${id}
  route: ${state.route}
  kind: ${kind}${kind === "requirements" ? `
  grill_status: ${grillStatus}` : ""}
---

`;
  if (kind !== "requirements") return `${header}# ${kind}

`;
  return `${header}# Requirements

## Scope

## Goals

## Non-goals

## Acceptance Criteria

## Decision Log

| ID | Question | Decision | Source | Impact |
| --- | --- | --- | --- | --- |

## Open Questions

- None
`;
}
async function assertArtifactCurrent(root2, id, state, kind) {
  const artifact = state.artifacts[kind];
  if (!artifact) throw new DevFlowError("MISSING_REQUIRED_ARTIFACT", kind);
  const contents = await readFile4(path5.join(featureDirectory(root2, id), artifact.path), "utf8");
  if (hash(contents) !== artifact.sha256) throw new DevFlowError("ARTIFACT_INTEGRITY_FAILED", kind);
  return contents;
}
async function scaffoldArtifact(root2, id, expectedRevision, kind) {
  const state = await readState(root2, id);
  if (state.lifecycle !== "active") throw new DevFlowError("INVALID_LIFECYCLE", "only active features can scaffold artifacts");
  if (!routeDefinition(state.route).requiredArtifacts.includes(kind)) throw new DevFlowError("ARTIFACT_NOT_REQUIRED", `${kind} is not required for ${state.route}`);
  const currentStep = currentOpenStep(state);
  const requiredNow = currentStep ? routeDefinition(state.route).artifactSteps?.[currentStep] ?? [] : [];
  if (!requiredNow.includes(kind)) throw new DevFlowError("ARTIFACT_OUT_OF_ORDER", `${kind} is not required by ${currentStep ?? "a pending step"}`, { expectedStep: currentStep });
  const filename = names[kind];
  if (!filename) throw new DevFlowError("INVALID_ARTIFACT", "unknown artifact kind");
  const target = path5.join(featureDirectory(root2, id), filename);
  const content = template(state, id, kind);
  await writeFile3(target, content, { flag: "wx" }).catch(async (error) => {
    if (error.code !== "EEXIST") throw error;
  });
  const contents = await readFile4(target, "utf8");
  return mutate(root2, id, expectedRevision, "artifact-scaffolded", (current) => {
    current.artifacts[kind] = { path: filename, sha256: hash(contents) };
  });
}
async function recordArtifact(root2, id, expectedRevision, kind) {
  const state = await readState(root2, id);
  if (!routeDefinition(state.route).requiredArtifacts.includes(kind)) throw new DevFlowError("ARTIFACT_NOT_REQUIRED", `${kind} is not required for ${state.route}`);
  if (kind === "status") throw new DevFlowError("GENERATED_ARTIFACT_READ_ONLY", "status is generated from state and cannot be registered as manual evidence");
  const artifact = state.artifacts[kind];
  if (!artifact) throw new DevFlowError("MISSING_REQUIRED_ARTIFACT", kind);
  const contents = await readFile4(path5.join(featureDirectory(root2, id), artifact.path), "utf8");
  const checksum = hash(contents);
  return mutate(root2, id, expectedRevision, "artifact-recorded", (current) => {
    current.artifacts[kind] = { ...artifact, sha256: checksum };
    for (const gate of gatesInvalidatedByArtifact(kind)) {
      delete current.humanGates[gate];
      delete current.steps[gate];
      clearInteractionsForTarget(current, `gate:${gate}`);
    }
    if (kind === "requirements") clearInteractionsByKind(current, "grill");
    current.featureCheck = {};
    delete current.steps.feature_check;
    current.logicComplete = false;
    delete current.steps.finalize;
  });
}
async function assertArtifactIntegrity(root2, id) {
  const state = await readState(root2, id);
  for (const required of routeDefinition(state.route).requiredArtifacts) await assertArtifactCurrent(root2, id, state, required);
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
function requiredEvidenceForStep(route, riskLabels, step) {
  const required = emptyEvidence();
  const orderedSteps = routeDefinition(route).orderedSteps;
  const risk = deriveRiskRequirements(riskLabels);
  if (step === "plan_review") required.fields.reviewType = "plan";
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
  const frontMatter = contents.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/)?.[1];
  if (!frontMatter) invalidStatus({ reason: "MISSING_FRONT_MATTER" });
  const lines = frontMatter.split(/\r?\n/);
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
  if (fields.grill_question_limit) {
    const limit = Number(fields.grill_question_limit);
    if (!Number.isInteger(limit) || limit < 1 || limit > 8) {
      throw new DevFlowError("GRILL_STATUS_INVALID", "grill_question_limit must be an integer 1-8", {
        recoveryHint: "Set grill_question_limit to 3 (visual) or up to 5 with Decision Log reason"
      });
    }
    result.questionLimit = limit;
  }
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
import path6 from "node:path";
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
    try {
      const invocation = verificationInvocation(command2);
      const result = await run2(invocation.executable, invocation.args, {
        cwd: path6.resolve(root2, command2.cwd),
        timeout: 12e4,
        maxBuffer: 1024 * 1024
      });
      output.push(`[${command2.id}] ${result.stdout}${result.stderr}`);
    } catch (error) {
      const failure2 = error;
      exitCode = typeof failure2.code === "number" ? failure2.code : 1;
      output.push(`[${command2.id}] ${failure2.stdout ?? ""}${failure2.stderr ?? failure2.message}`);
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
    const route = routeDefinition(state.route);
    if (["requirement_confirmation", "implementation_approval", "verification", "feature_check", "finalize"].includes(step) || !route.orderedSteps.includes(step)) {
      throw new DevFlowError("INVALID_STEP", step);
    }
    assertCurrentStep(state, step);
    await assertRequirementsGrillSatisfied(root2, id, state);
    const required = requiredEvidenceForStep(state.route, state.classification.riskLabels, step);
    assertRequiredEvidence(step, required, normalizedEvidence);
    state.steps[step] = { status: "satisfied", evidence: normalizedEvidence };
  });
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
    if (state.verification.verifiedFingerprint !== state.businessFingerprint) {
      throw new DevFlowError("VERIFICATION_STALE", "protected files changed or verification did not pass");
    }
    const orderedSteps = routeDefinition(state.route).orderedSteps;
    const featureCheckIndex = orderedSteps.indexOf("feature_check");
    for (const step of orderedSteps.slice(0, featureCheckIndex)) {
      const required = requiredEvidenceForStep(state.route, state.classification.riskLabels, step);
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
    const route = routeDefinition(state.route);
    assertCurrentStep(state, "finalize");
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
import { createHash as createHash5 } from "node:crypto";

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
var digest2 = (value) => createHash5("sha256").update(JSON.stringify(value)).digest("hex");
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
async function presentGate(root2, id, expectedRevision, gate) {
  const selectedGate = gateId(gate);
  let interaction;
  const state = await mutate(root2, id, expectedRevision, "gate-presented", async (state2) => {
    if (state2.lifecycle !== "active") {
      throw new DevFlowError("INVALID_LIFECYCLE", "gate requires active feature");
    }
    if (!routeDefinition(state2.route).orderedSteps.includes(selectedGate)) {
      throw new DevFlowError("INVALID_GATE", selectedGate);
    }
    if (state2.humanGates[selectedGate]) {
      throw new DevFlowError("HUMAN_GATE_ALREADY_PRESENTED", selectedGate);
    }
    assertCurrentStep(state2, selectedGate);
    const missing = artifactsRequiredBeforeGate(state2, selectedGate).find((kind) => !state2.artifacts[kind]);
    if (missing) throw new DevFlowError("MISSING_REQUIRED_ARTIFACT", missing);
    await assertRequirementsGrillSatisfied(root2, id, state2);
    const basisHash = digest2(gateBasis(state2, selectedGate));
    state2.humanGates[selectedGate] = {
      status: "pending",
      presentedRevision: state2.revision,
      presentedAt: (/* @__PURE__ */ new Date()).toISOString(),
      basisHash
    };
    interaction = createInteraction(state2, {
      kind: "gate",
      target: `gate:${selectedGate}`,
      basisHash,
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
    const current = state.humanGates[gate];
    if (current?.status !== "pending") throw new DevFlowError("HUMAN_GATE_NOT_PENDING", gate);
    const interaction = getInteraction(state, interactionId);
    if (interaction.kind !== "gate" || interaction.target !== `gate:${gate}` || interaction.status !== "pending") {
      throw new DevFlowError("INTERACTION_NOT_PENDING", interactionId);
    }
    const basisHash = digest2(gateBasis(state, gate));
    if (basisHash !== current.basisHash || basisHash !== interaction.basisHash) {
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
    const basisHash = digest2(gateBasis(state, selectedGate));
    if (basisHash !== current.basisHash) {
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
  const requiredEvidence = requiredEvidenceForStep(state.route, state.classification.riskLabels, step);
  return requiredEvidenceIsEmpty(requiredEvidence) ? { kind: "run-step", step } : { kind: "run-step", step, requiredEvidence };
}
function enrichFeatureCheck(state) {
  const requiredEvidence = requiredEvidenceForStep(state.route, state.classification.riskLabels, "feature_check");
  return requiredEvidenceIsEmpty(requiredEvidence) ? { kind: "feature-check" } : { kind: "feature-check", requiredEvidence };
}
async function nextAction(root2, id) {
  const state = await readState(root2, id);
  const action = deriveNext(toDerivedState(state, await verificationIsStale(root2, state)));
  if (action.kind === "run-step" || action.kind === "present-human-gate") {
    const requiredNow = routeDefinition(state.route).artifactSteps?.[action.step] ?? [];
    const missing = requiredNow.find((artifact) => !state.artifacts[artifact]);
    if (missing) return { kind: "scaffold-artifact", step: missing };
  }
  if (action.kind === "run-step" && action.step === "feature_check") return enrichFeatureCheck(state);
  if (action.kind === "run-step" && action.step === "finalize") return { kind: "finalize" };
  if (action.kind === "run-step") return enrichRunStep(state, action.step);
  if (action.kind === "feature-check") return enrichFeatureCheck(state);
  return action;
}

// plugins/dev-flow/src/core/status.ts
import { readFile as readFile5 } from "node:fs/promises";
import path7 from "node:path";
async function grillWait(root2, state, action) {
  if (action.kind !== "run-step" || action.step !== "requirements") return { kind: "none" };
  const artifact = state.artifacts.requirements;
  if (!artifact) return { kind: "none" };
  let contents;
  try {
    contents = await readFile5(path7.join(root2, ".dev-flow", "features", state.featureId, artifact.path), "utf8");
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
    questionLimit: grill.questionLimit ?? 5,
    ...interaction ? { interaction: toPublicInteraction(interaction) } : {}
  };
}
async function buildProgress(root2, state, action) {
  const ordered = routeDefinition(state.route).orderedSteps;
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
async function readStatusView(root2, featureId) {
  const state = await readState(root2, featureId);
  const action = await nextAction(root2, featureId);
  const progress = await buildProgress(root2, state, action);
  return { ...state, progress };
}

// plugins/dev-flow/src/mcp/doctor.ts
import { lstat as lstat3, readdir as readdir2, readFile as readFile6 } from "node:fs/promises";
import path8 from "node:path";
import { createHash as createHash6 } from "node:crypto";
async function readable(file) {
  try {
    await lstat3(file);
    return true;
  } catch {
    return false;
  }
}
async function validJson(file) {
  try {
    JSON.parse(await readFile6(file, "utf8"));
    return true;
  } catch {
    return false;
  }
}
async function pointerRecoveryCandidates(root2) {
  try {
    const directory = path8.join(root2, ".dev-flow", "features");
    const entries = await readdir2(directory, { withFileTypes: true });
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
  const projectFile = path8.join(root2, ".dev-flow", "project.json");
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
  const activeFile = path8.join(root2, ".dev-flow", "active.json");
  let activeFeature = { present: await readable(activeFile), valid: false };
  let corruptFeature;
  let corruptActivePointer;
  if (activeFeature.present) {
    try {
      const active = await readActive(root2);
      if (!active?.featureId) throw new Error("active feature id is missing");
      try {
        const state = await readState(root2, active.featureId);
        activeFeature = { present: true, featureId: state.featureId, valid: state.lifecycle === "active" };
        add(
          activeFeature.valid ? "ACTIVE_FEATURE_VALID" : "ACTIVE_FEATURE_INVALID",
          activeFeature.valid ? "ok" : "error",
          activeFeature.valid ? `active feature ${state.featureId} is valid` : `active feature ${state.featureId} is not active`
        );
      } catch (error) {
        let digest3;
        try {
          digest3 = await stateFileSha256(root2, active.featureId);
        } catch {
        }
        if (!digest3) {
          try {
            const raw = await readFile6(path8.join(root2, ".dev-flow", "features", active.featureId, "state.json"));
            digest3 = createHash6("sha256").update(raw).digest("hex");
          } catch {
            digest3 = void 0;
          }
        }
        activeFeature = {
          present: true,
          featureId: active.featureId,
          valid: false,
          corrupt: true,
          stateSha256: digest3,
          recoveryAction: "abandon"
        };
        const message = error instanceof Error ? error.message : String(error);
        add("ACTIVE_FEATURE_CORRUPT", "error", message, "Call dev_flow_recover_corrupt_feature with stateSha256, reason, and userEvidence");
        if (digest3) {
          corruptFeature = {
            featureId: active.featureId,
            stateSha256: digest3,
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
          activeSha256 = createHash6("sha256").update(await readFile6(activeFile)).digest("hex");
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
  const paths = {
    claudeManifest: path8.join(pluginRoot2, ".claude-plugin", "plugin.json"),
    codexManifest: path8.join(pluginRoot2, ".codex-plugin", "plugin.json"),
    mcp: path8.join(pluginRoot2, ".mcp.json"),
    claudeHooks: path8.join(pluginRoot2, "hosts", "claude", "hooks.json"),
    codexHooks: path8.join(pluginRoot2, "hosts", "codex", "hooks.json"),
    mcpBundle: path8.join(pluginRoot2, "dist", "mcp-server.mjs"),
    claudeBundle: path8.join(pluginRoot2, "dist", "claude-hook.mjs"),
    codexBundle: path8.join(pluginRoot2, "dist", "codex-hook.mjs")
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
    mcp: { server: "running", configuration: !invalidJson },
    diagnostics
  };
}

// plugins/dev-flow/src/mcp/attention.ts
import { execFile as execFile4 } from "node:child_process";
import { promisify as promisify4 } from "node:util";

// plugins/dev-flow/src/mcp/windows-notifications.ts
import { execFile as execFile3 } from "node:child_process";
import { access as access2 } from "node:fs/promises";
import path9 from "node:path";
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
  return appData ? path9.win32.join(appData, "Microsoft", "Windows", "Start Menu", "Programs", shortcutName) : void 0;
}
async function command(file, args) {
  return run3(file, args);
}
async function pathExists2(file) {
  try {
    await access2(file);
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
$workingDirectory = ${powerShellLiteral(path9.win32.dirname(shortcutPath))}
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
    if (!await (options.exists ?? pathExists2)(shortcutPath)) return;
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
  const decision = event.decision === "requirement_confirmation" ? "\u9700\u6C42\u786E\u8BA4" : event.decision === "implementation_approval" ? "\u786E\u8BA4\u6267\u884C" : "\u9700\u6C42\u9009\u62E9";
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
var moduleDirectory = path10.dirname(fileURLToPath(import.meta.url));
var pluginRoot = path10.basename(moduleDirectory) === "dist" ? path10.resolve(moduleDirectory, "..") : path10.resolve(moduleDirectory, "../..");
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
  dev_flow_record_step: { description: "Record the current non-gate route step.", inputSchema: featureMutation({ step: string, evidence: {} }) },
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
function interactionEnvelope(state, interaction, interactionOutcome, response) {
  return {
    ...state,
    interaction,
    interactionOutcome,
    ...response ? { response } : {}
  };
}
var McpConnection = class {
  supportsFormElicitation = false;
  nextClientRequestId = 0;
  pending = /* @__PURE__ */ new Map();
  configure(capabilities) {
    this.supportsFormElicitation = false;
    if (!capabilities || typeof capabilities !== "object" || Array.isArray(capabilities)) return;
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
    if (message.error !== void 0) {
      pending.reject(new Error(`client request failed: ${JSON.stringify(message.error)}`));
    } else {
      pending.resolve(message.result);
    }
    return true;
  }
  close() {
    for (const { reject } of this.pending.values()) reject(new Error("MCP client stream closed while awaiting user interaction"));
    this.pending.clear();
  }
  request(method, params) {
    const id = `dev-flow-${++this.nextClientRequestId}`;
    process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}
`);
    return new Promise((resolve, reject) => this.pending.set(id, { resolve, reject }));
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
    case "dev_flow_record_step":
      return recordStep(root, a.featureId, a.expectedRevision, a.step, a.evidence);
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
