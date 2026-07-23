/* dev-flow 1.3.0; built from source, deterministic build */

// plugins/dev-flow/src/hosts/claude-adapter.ts
import { lstat } from "node:fs/promises";
import path4 from "node:path";

// plugins/dev-flow/src/core/state-store.ts
import { access, mkdir, open, readFile, rename, rm, writeFile } from "node:fs/promises";
import { hostname } from "node:os";
import path2 from "node:path";

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

// plugins/dev-flow/src/core/project-config.ts
import path from "node:path";
function relativeDirectory(value) {
  return value.length > 0 && !path.isAbsolute(value) && !value.split(/[\\/]+/).includes("..");
}
function validateProjectConfig(value) {
  const config = value;
  if (config?.schemaVersion !== 1 || config.enforcement?.mode !== "strict") throw new DevFlowError("INVALID_PROJECT_CONFIG", "only schema v1 strict configuration is supported");
  if (config.enforcement.gitWriteRequiresLogicComplete !== true || config.enforcement.oneActiveFeature !== true || config.enforcement.requireExplicitHumanReply !== true) {
    throw new DevFlowError("INVALID_PROJECT_CONFIG", "all strict enforcement controls must be enabled");
  }
  if (!Array.isArray(config.protectedRoots) || !config.protectedRoots.length || config.protectedRoots.some((root) => !relativeDirectory(root) || root.startsWith(".dev-flow"))) {
    throw new DevFlowError("INVALID_PROJECT_CONFIG", "protectedRoots must be project-relative non-.dev-flow directories");
  }
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

// plugins/dev-flow/src/core/state-store.ts
var lifecycles = /* @__PURE__ */ new Set(["active", "paused", "finalized", "abandoned"]);
function validateFeatureState(value) {
  const state = value;
  if (state?.schemaVersion !== 1) throw new DevFlowError("UNSUPPORTED_STATE_SCHEMA", "only state schema v1 is supported");
  if (typeof state.featureId !== "string" || !state.featureId || !Number.isInteger(state.revision) || (state.revision ?? -1) < 0 || !lifecycles.has(state.lifecycle) || !routeDefinition(state.route) || !state.classification || !state.scope || !Array.isArray(state.scope.inScope) || !Array.isArray(state.scope.outOfScope) || !state.steps || !state.humanGates || !state.artifacts || !state.verification || !Array.isArray(state.verification.attempts) || !state.featureCheck || !Array.isArray(state.blockingFindings) || typeof state.logicComplete !== "boolean" || !state.lastUpdatedBy) {
    throw new DevFlowError("INVALID_STATE_SCHEMA", "state is not a valid v1 feature state");
  }
}
var delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
var devFlow = (root) => path2.join(root, ".dev-flow");
var features = (root) => path2.join(devFlow(root), "features");
var statePath = (root, id) => path2.join(features(root), id, "state.json");
var eventPath = (root, id) => path2.join(features(root), id, "events.jsonl");
var activePath = (root) => path2.join(devFlow(root), "active.json");
var recoveryTxnPath = (root) => path2.join(devFlow(root), "recovery-transaction.json");
async function readProjectConfig(root) {
  try {
    const value = JSON.parse(await readFile(path2.join(devFlow(root), "project.json"), "utf8"));
    validateProjectConfig(value);
    return value;
  } catch (error) {
    if (error instanceof DevFlowError) throw error;
    throw new DevFlowError("PROJECT_NOT_INITIALIZED", "run dev_flow_init_project first");
  }
}
async function lock(root, featureId, operation) {
  const directory = path2.join(devFlow(root), ".lock");
  const started = Date.now();
  await mkdir(devFlow(root), { recursive: true });
  while (true) {
    try {
      await mkdir(directory);
      await writeFile(path2.join(directory, "owner.json"), JSON.stringify({ pid: process.pid, hostname: hostname(), acquiredAt: (/* @__PURE__ */ new Date()).toISOString(), featureId, operation }));
      return async () => {
        await rm(directory, { recursive: true, force: true });
      };
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
      try {
        const owner = JSON.parse(await readFile(path2.join(directory, "owner.json"), "utf8"));
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
    const state = JSON.parse(await readFile(statePath(root, featureId), "utf8"));
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
    raw = await readFile(activePath(root), "utf8");
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
  const handle = await open(eventPath(root, id), "a");
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
    await appendEvent(root, active.featureId, state.revision, "host-event", { ...hostEvent, at: hostEvent.at ?? (/* @__PURE__ */ new Date()).toISOString() });
  } finally {
    await release();
  }
}
function isRecoveryPhase(value) {
  return value === "prepared" || value === "directory-moved" || value === "active-cleared" || value === "completed";
}
function validateRecoveryTransaction(value) {
  const transaction = value;
  if (transaction?.schemaVersion !== 1 || typeof transaction.transactionId !== "string" || !transaction.transactionId || !isRecoveryPhase(transaction.phase) || typeof transaction.featureId !== "string" || !transaction.featureId || typeof transaction.stateSha256 !== "string" || !transaction.stateSha256 || typeof transaction.recoveredTo !== "string" || !path2.isAbsolute(transaction.recoveredTo) || typeof transaction.reason !== "string" || typeof transaction.userEvidence !== "string" || transaction.host !== "claude" && transaction.host !== "codex" || typeof transaction.at !== "string" || transaction.activeSha256 !== void 0 && typeof transaction.activeSha256 !== "string") {
    throw new DevFlowError("RECOVERY_TRANSACTION_UNREADABLE", "recovery journal is invalid", {
      recoveryHint: "Run dev_flow_doctor; do not start a new feature or hand-edit .dev-flow"
    });
  }
  if (path2.basename(transaction.featureId) !== transaction.featureId || transaction.featureId === "." || transaction.featureId === "..") {
    throw new DevFlowError("RECOVERY_TRANSACTION_UNREADABLE", "recovery journal has an unsafe feature id", { recoveryHint: "Run dev_flow_doctor; recovery remains fail-closed" });
  }
}
function validateRecoveryLocation(root, transaction) {
  const recoveredRoot = path2.join(devFlow(root), "recovered");
  const relative = path2.relative(recoveredRoot, transaction.recoveredTo);
  if (!relative || relative.startsWith("..") || path2.isAbsolute(relative) || path2.basename(relative) !== relative) {
    throw new DevFlowError("RECOVERY_TRANSACTION_UNREADABLE", "recovery journal points outside the recovered directory", {
      recoveryHint: "Run dev_flow_doctor; do not start a new feature or hand-edit .dev-flow"
    });
  }
}
async function readRecoveryTransaction(root) {
  let raw;
  try {
    raw = await readFile(recoveryTxnPath(root), "utf8");
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

// plugins/dev-flow/src/hosts/adapter-policy.ts
import path3 from "node:path";

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

// plugins/dev-flow/src/hosts/adapter-policy.ts
function formatPreToolBlock(block) {
  return `${block.code}: ${block.recoveryHint}`;
}
var directWriteTools = /* @__PURE__ */ new Set(["write", "edit", "multiedit", "applypatch", "apply_patch", "patch"]);
var controlFileNames = /* @__PURE__ */ new Set(["state.json", "active.json", "project.json", "events.jsonl", "status.md", "recovery-transaction.json", "recovery-events.jsonl"]);
function toolName(event2) {
  return String(event2.tool_name ?? "").toLowerCase();
}
function isRelevantPreToolUse(event2) {
  const name = toolName(event2);
  return name === "bash" || directWriteTools.has(name);
}
function projectRelative(root, target) {
  const absolute = path3.resolve(root, target);
  const relative = path3.relative(root, absolute);
  if (relative === "" || relative.startsWith("..") || path3.isAbsolute(relative)) return void 0;
  return relative.split(path3.sep).join("/");
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
  const base = path3.posix.basename(relative);
  if (controlFileNames.has(base)) return true;
  if (relative.includes("/.lock/") || relative.endsWith("/.lock")) return true;
  if (relative === ".dev-flow/active.json" || relative === ".dev-flow/project.json") return true;
  if (relative.includes("/recovered/")) return true;
  if (relative.endsWith("/state.json") || relative.endsWith("/events.jsonl") || relative.endsWith("/status.md")) return true;
  return false;
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
function analyzeBashWriteTargets(command) {
  const trimmed = command.trim();
  if (!trimmed) return { kind: "read-only" };
  if (/\b(?:sh|bash|zsh)\s+-c\b/.test(trimmed) || /\bxargs\b/.test(trimmed) || /\bapply_patch\b/.test(trimmed)) {
    return { kind: "unresolved", syntax: "unsupported-shell-wrapper" };
  }
  if (!writeSyntaxHint.test(trimmed)) return { kind: "read-only" };
  const segments = trimmed.split(/(?:&&|\|\||;|\n)/).map((part) => part.trim()).filter(Boolean);
  const targets = [];
  for (const segment of segments) {
    const withoutEnv = segment.replace(/^(?:\w+=\S+\s+)+/, "");
    if (/\b(?:python|node|ruby|perl)\b/.test(withoutEnv) && !/\bsed\s+-i\b/.test(withoutEnv) && !/\bperl\s+-pi\b/.test(withoutEnv)) {
      if (writeSyntaxHint.test(withoutEnv)) return { kind: "unresolved", syntax: "interpreter-write" };
    }
    const redirectMatches = [...withoutEnv.matchAll(/(?:^|[^0-9])>{1,2}\s*([^\s|&;]+)/g)];
    for (const match of redirectMatches) {
      const token = stripQuotes(match[1]);
      if (hasUnresolvedExpansion(token)) return { kind: "unresolved", syntax: "redirect-expansion" };
      targets.push(token);
    }
    const teeIndex = withoutEnv.search(/\btee\b/);
    if (teeIndex >= 0) {
      if ((withoutEnv.match(/\btee\b/g) ?? []).length !== 1) return { kind: "unresolved", syntax: "multiple-tee" };
      const words = commandWords(withoutEnv.slice(teeIndex), "tee");
      const paths = words && collectPathOperands(words, 0);
      if (!paths) return { kind: "unresolved", syntax: "tee-args" };
      targets.push(...paths);
    }
    const simple = withoutEnv.match(/^(touch|mkdir|rm)\b/);
    if (simple) {
      const words = commandWords(withoutEnv, simple[1]);
      const paths = words && collectPathOperands(words, 0);
      if (!paths) return { kind: "unresolved", syntax: "simple-args" };
      targets.push(...paths);
    }
    const moveCopy = withoutEnv.match(/^(mv|cp)\b/);
    if (moveCopy) {
      const words = commandWords(withoutEnv, moveCopy[1]);
      const paths = words && collectPathOperands(words, 0);
      if (!paths || paths.length < 2) return { kind: "unresolved", syntax: "mv-cp-args" };
      if (moveCopy[1] === "mv") targets.push(...paths);
      else targets.push(paths.at(-1));
    }
    const sed = withoutEnv.match(/^sed\s+(-i\S*)\s+([\s\S]*)$/);
    if (sed) {
      const words = shellWords(sed[2]);
      const paths = words && collectPathOperands(words, 1);
      if (!paths) return { kind: "unresolved", syntax: "sed-args" };
      targets.push(...paths);
    }
    const perl = withoutEnv.match(/^perl\s+(-pi\S*)\s+([\s\S]*)$/);
    if (perl) {
      const words = shellWords(perl[2]);
      const firstPath = words?.[0] === "-e" ? 2 : 0;
      const paths = words && collectPathOperands(words, firstPath);
      if (!paths) return { kind: "unresolved", syntax: "perl-args" };
      targets.push(...paths);
    }
  }
  if (targets.length === 0) return { kind: "unresolved", syntax: "write-syntax-no-target" };
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
  try {
    state = await readState(root, active.featureId);
    if (state.lifecycle !== "active" || active.revision !== state.revision) return { kind: "unreadable", reason: "active pointer does not match active state", protectedRoots: project.protectedRoots, blockAllWrites: false };
  } catch {
    return { kind: "unreadable", reason: "state invalid", protectedRoots: project.protectedRoots, blockAllWrites: false };
  }
  const allowedArtifacts = /* @__PURE__ */ new Set();
  for (const [kind, artifact] of Object.entries(state.artifacts ?? {})) {
    if (kind === "status" || !artifact?.path) continue;
    if (path3.posix.dirname(artifact.path) !== "." || !artifact.path.endsWith(".md")) {
      return { kind: "unreadable", reason: "artifact path invalid", protectedRoots: project.protectedRoots, blockAllWrites: false };
    }
    const relative = `.dev-flow/features/${active.featureId}/${artifact.path}`.split(path3.sep).join("/");
    allowedArtifacts.add(relative);
  }
  return {
    kind: "ready",
    workflow: {
      featureId: active.featureId,
      route: state.route,
      logicComplete: state.logicComplete,
      approvalConfirmed: state.humanGates.implementation_approval?.status === "confirmed",
      allowedArtifacts,
      protectedRoots: project.protectedRoots
    }
  };
}
function classifyTarget(root, target, workflow) {
  const relative = projectRelative(root, target);
  if (!relative) {
    return { code: "DEV_FLOW_WRITE_TARGET_UNRESOLVED", recoveryHint: "Use a project-relative path that resolves inside the repository" };
  }
  if (isControlPath(relative)) {
    return {
      code: "DEV_FLOW_STATE_MUTATION_FORBIDDEN",
      recoveryHint: "Workflow state is MCP-only; edit registered artifacts or use doctor/recovery for corrupt state"
    };
  }
  if (isDevFlowPath(relative)) {
    if (workflow.allowedArtifacts.has(relative)) return void 0;
    if (relative.startsWith(`.dev-flow/features/${workflow.featureId}/`) && relative.endsWith(".md")) {
      return {
        code: "DEV_FLOW_ARTIFACT_NOT_REGISTERED",
        recoveryHint: "Scaffold the artifact via MCP first, then edit and record it"
      };
    }
    return {
      code: "DEV_FLOW_STATE_MUTATION_FORBIDDEN",
      recoveryHint: "Only registered non-status artifacts for the active feature may be edited"
    };
  }
  const needsApproval = ["risk-minimal", "standard-m", "light-l", "standard-l"].includes(workflow.route ?? "");
  if (needsApproval && !workflow.approvalConfirmed && isProtected(root, target, workflow.protectedRoots)) {
    return {
      code: "DEV_FLOW_IMPLEMENTATION_APPROVAL_REQUIRED",
      recoveryHint: "Target is under a protected root; finish the route and wait for implementation approval"
    };
  }
  return void 0;
}
function unreadableBlock(reason2) {
  return {
    code: "DEV_FLOW_WORKFLOW_STATE_UNREADABLE",
    recoveryHint: `Active workflow cannot be read safely (${reason2}); run dev_flow_doctor and recover if corrupt`
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
  const { workflow } = loaded;
  const command = typeof event2.tool_input?.command === "string" ? event2.tool_input.command : "";
  if (toolName(event2) === "bash" && classifyGitCommand(command) === "write" && !workflow.logicComplete) {
    return {
      code: "DEV_FLOW_GIT_GUARD",
      recoveryHint: "Feature is not logic-complete; finish verify, feature-check, and finalize before git writes"
    };
  }
  if (toolName(event2) === "bash") {
    const analysis = analyzeBashWriteTargets(command);
    if (analysis.kind === "read-only") return void 0;
    if (analysis.kind === "unresolved") {
      return {
        code: "DEV_FLOW_WRITE_TARGET_UNRESOLVED",
        recoveryHint: "Split into deterministic write commands or use MCP artifact tools; do not mix unresolved shell writes"
      };
    }
    for (const target of analysis.targets) {
      const block = classifyTarget(root, target, workflow);
      if (block) return block;
    }
    return void 0;
  }
  const targets = directTargets(event2);
  if (!targets.length) {
    return {
      code: "DEV_FLOW_IMPLEMENTATION_APPROVAL_REQUIRED",
      recoveryHint: "Patch has no parseable targets; denied conservatively until implementation approval"
    };
  }
  for (const target of targets) {
    const block = classifyTarget(root, target, workflow);
    if (block) return block;
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
      await lstat(path4.join(cwd, ".dev-flow", "active.json"));
      allow = false;
      reason = "DEV_FLOW_WORKFLOW_STATE_UNREADABLE: Active workflow cannot be read safely; run dev_flow_doctor and recover if corrupt";
    } catch (error) {
      if (error.code === "ENOENT") {
        allow = true;
        reason = void 0;
      } else {
        allow = false;
        reason = "DEV_FLOW_WORKFLOW_STATE_UNREADABLE: Active workflow path cannot be inspected safely; run dev_flow_doctor";
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
