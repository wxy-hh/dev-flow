/* dev-flow 1.1.0; built from source, deterministic build */

// plugins/dev-flow/src/core/state-store.ts
import { mkdir, open, readFile, rename, rm, writeFile } from "node:fs/promises";
import { hostname } from "node:os";
import path from "node:path";

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
var devFlow = (root) => path.join(root, ".dev-flow");
var features = (root) => path.join(devFlow(root), "features");
var statePath = (root, id) => path.join(features(root), id, "state.json");
var eventPath = (root, id) => path.join(features(root), id, "events.jsonl");
var activePath = (root) => path.join(devFlow(root), "active.json");
async function lock(root, featureId, operation) {
  const directory = path.join(devFlow(root), ".lock");
  const started = Date.now();
  await mkdir(devFlow(root), { recursive: true });
  while (true) {
    try {
      await mkdir(directory);
      await writeFile(path.join(directory, "owner.json"), JSON.stringify({ pid: process.pid, hostname: hostname(), acquiredAt: (/* @__PURE__ */ new Date()).toISOString(), featureId, operation }));
      return async () => {
        await rm(directory, { recursive: true, force: true });
      };
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
      try {
        const owner = JSON.parse(await readFile(path.join(directory, "owner.json"), "utf8"));
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
    throw new DevFlowError("FEATURE_NOT_FOUND", `feature ${featureId} does not exist`);
  }
}
async function readActive(root) {
  try {
    return JSON.parse(await readFile(activePath(root), "utf8"));
  } catch {
    return void 0;
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

// plugins/dev-flow/src/hosts/adapter-policy.ts
import { readFile as readFile2 } from "node:fs/promises";
import path2 from "node:path";

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
var directWriteTools = /* @__PURE__ */ new Set(["write", "edit", "multiedit", "applypatch", "apply_patch", "patch"]);
function toolName(event2) {
  return String(event2.tool_name ?? "").toLowerCase();
}
function isRelevantPreToolUse(event2) {
  const name = toolName(event2);
  return name === "bash" || directWriteTools.has(name);
}
function isProtected(root, target, protectedRoots) {
  const relative = path2.relative(root, path2.resolve(root, target));
  return relative !== "" && !relative.startsWith("..") && !path2.isAbsolute(relative) && protectedRoots.some((item) => relative === item || relative.startsWith(`${item}${path2.sep}`));
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
function bashMightWriteProtectedRoot(command, protectedRoots) {
  if (/\bapply_patch\b/.test(command)) return true;
  const hasWriteSyntax = /(?:^|[;&|]\s*)(?:\w+=\S+\s+)*(?:tee\b|touch\b|mkdir\b|rm\b|mv\b|cp\b|sed\s+-i\b|perl\s+-pi\b)|(?:^|\s)>{1,2}\s*|\s>{1,2}\s*/.test(command);
  if (!hasWriteSyntax) return false;
  return protectedRoots.some((protectedRoot) => {
    const normalized = protectedRoot.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replaceAll(path2.sep, "[\\\\/]");
    return new RegExp(`(?:^|[\\s'"=])${normalized}(?:[\\\\/\\s'";|&]|$)`).test(command);
  });
}
async function preToolBlockReason(root, event2) {
  if (!isRelevantPreToolUse(event2)) return void 0;
  const active = JSON.parse(await readFile2(path2.join(root, ".dev-flow", "active.json"), "utf8"));
  const state = JSON.parse(await readFile2(path2.join(root, ".dev-flow", "features", active.featureId, "state.json"), "utf8"));
  const command = typeof event2.tool_input?.command === "string" ? event2.tool_input.command : "";
  if (toolName(event2) === "bash" && classifyGitCommand(command) === "write" && !state.logicComplete) return "DEV_FLOW_GIT_GUARD";
  const needsApproval = ["risk-minimal", "standard-m", "light-l", "standard-l"].includes(state.route ?? "");
  if (!needsApproval || state.humanGates?.implementation_approval?.status === "confirmed") return void 0;
  const project = JSON.parse(await readFile2(path2.join(root, ".dev-flow", "project.json"), "utf8"));
  const protectedRoots = project.protectedRoots ?? [];
  if (toolName(event2) === "bash") {
    return bashMightWriteProtectedRoot(command, protectedRoots) ? "DEV_FLOW_IMPLEMENTATION_APPROVAL_REQUIRED" : void 0;
  }
  const targets = directTargets(event2);
  if (toolName(event2).includes("patch") && !targets.length) return "DEV_FLOW_IMPLEMENTATION_APPROVAL_REQUIRED";
  return targets.some((target) => isProtected(root, target, protectedRoots)) ? "DEV_FLOW_IMPLEMENTATION_APPROVAL_REQUIRED" : void 0;
}

// plugins/dev-flow/src/hosts/codex-adapter.ts
var chunks = [];
for await (const chunk of process.stdin) chunks.push(Buffer.from(chunk));
var event = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
var allow = true;
var reason;
if (event.hook_event_name === "PreToolUse") {
  try {
    reason = await preToolBlockReason(event.cwd ?? process.cwd(), event);
    allow = !reason;
  } catch {
  }
}
if (event.hook_event_name === "UserPromptSubmit" || event.hook_event_name === "Stop" || event.hook_event_name === "PostToolUse") {
  try {
    const text = event.prompt ?? event.user_prompt ?? event.tool_input?.prompt;
    await recordHostEvent(event.cwd ?? process.cwd(), { eventId: event.event_id ?? `${event.hook_event_name}-${Date.now()}`, type: event.hook_event_name === "UserPromptSubmit" ? "user-prompt" : event.hook_event_name === "Stop" ? "turn-boundary" : "tool", host: "codex", text: typeof text === "string" ? text : void 0 });
  } catch {
  }
}
process.stdout.write(JSON.stringify(allow ? { continue: true } : { continue: false, decision: "block", reason }) + "\n");
