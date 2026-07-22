/* dev-flow 1.0.0; built from source, deterministic build */
var __defProp = Object.defineProperty;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __esm = (fn, res) => function __init() {
  return fn && (res = (0, fn[__getOwnPropNames(fn)[0]])(fn = 0)), res;
};
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};

// plugins/dev-flow/policy/contract.json
var contract_default;
var init_contract = __esm({
  "plugins/dev-flow/policy/contract.json"() {
    contract_default = {
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
  }
});

// plugins/dev-flow/src/policy/contract.ts
function routeDefinition(route) {
  return contract.routes[route];
}
var contract;
var init_contract2 = __esm({
  "plugins/dev-flow/src/policy/contract.ts"() {
    "use strict";
    init_contract();
    contract = contract_default;
    if (contract.schemaVersion !== 1) {
      throw new Error(`unsupported contract schema ${String(contract.schemaVersion)}`);
    }
  }
});

// plugins/dev-flow/src/core/errors.ts
var DevFlowError;
var init_errors = __esm({
  "plugins/dev-flow/src/core/errors.ts"() {
    "use strict";
    DevFlowError = class extends Error {
      constructor(code, message, details = {}) {
        super(`${code}: ${message}`);
        this.code = code;
        this.details = details;
      }
    };
  }
});

// plugins/dev-flow/src/policy/validation.ts
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
  if (riskLabels.some((label) => !risks.includes(label))) {
    throw new PolicyError("INVALID_RISK_LABEL", "risk label is invalid");
  }
  return { ...input, riskLabels };
}
var PolicyError, levels, topologies, risks;
var init_validation = __esm({
  "plugins/dev-flow/src/policy/validation.ts"() {
    "use strict";
    PolicyError = class extends Error {
      constructor(code, message, details = {}) {
        super(`${code}: ${message}`);
        this.code = code;
        this.details = details;
      }
    };
    levels = ["XS", "S", "M", "L"];
    topologies = ["local", "shared-contract", "multi-chain", "coordinated-rollback"];
    risks = [
      "security",
      "data",
      "money",
      "external",
      "availability",
      "critical_correctness",
      "irreversible_consequence"
    ];
  }
});

// plugins/dev-flow/src/policy/route.ts
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
var levelRank;
var init_route = __esm({
  "plugins/dev-flow/src/policy/route.ts"() {
    "use strict";
    init_contract2();
    init_validation();
    levelRank = { XS: 0, S: 1, M: 2, L: 3 };
  }
});

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
  if (!Array.isArray(config.protectedRoots) || !config.protectedRoots.length || config.protectedRoots.some((root2) => !relativeDirectory(root2) || root2.startsWith(".dev-flow"))) {
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
var init_project_config = __esm({
  "plugins/dev-flow/src/core/project-config.ts"() {
    "use strict";
    init_errors();
  }
});

// plugins/dev-flow/src/core/state-store.ts
var state_store_exports = {};
__export(state_store_exports, {
  abandonFeature: () => abandonFeature,
  businessFingerprint: () => businessFingerprint,
  initProject: () => initProject,
  mutate: () => mutate,
  readFeatureEvents: () => readFeatureEvents,
  readProjectConfig: () => readProjectConfig,
  readState: () => readState,
  reclassifyFeature: () => reclassifyFeature,
  recordHostEvent: () => recordHostEvent,
  startFeature: () => startFeature,
  switchActive: () => switchActive
});
import { randomUUID, createHash } from "node:crypto";
import { mkdir, open, readFile, rename, rm, writeFile } from "node:fs/promises";
import { hostname } from "node:os";
import path2 from "node:path";
function validateFeatureState(value) {
  const state = value;
  if (state?.schemaVersion !== 1) throw new DevFlowError("UNSUPPORTED_STATE_SCHEMA", "only state schema v1 is supported");
  if (typeof state.featureId !== "string" || !state.featureId || !Number.isInteger(state.revision) || (state.revision ?? -1) < 0 || !lifecycles.has(state.lifecycle) || !routeDefinition(state.route) || !state.classification || !state.scope || !Array.isArray(state.scope.inScope) || !Array.isArray(state.scope.outOfScope) || !state.steps || !state.humanGates || !state.artifacts || !state.verification || !Array.isArray(state.verification.attempts) || !state.featureCheck || !Array.isArray(state.blockingFindings) || typeof state.logicComplete !== "boolean" || !state.lastUpdatedBy) {
    throw new DevFlowError("INVALID_STATE_SCHEMA", "state is not a valid v1 feature state");
  }
}
async function readProjectConfig(root2) {
  try {
    const value = JSON.parse(await readFile(path2.join(devFlow(root2), "project.json"), "utf8"));
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
  await writeAtomic(path2.join(devFlow(root2), "project.json"), config);
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
  const directory = await open(path2.dirname(file), "r");
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
  const file = path2.join(features(root2), state.featureId, status.path);
  await writeFile(file, `${projection}
`);
  state.artifacts.status = { ...status, sha256: createHash("sha256").update(`${projection}
`).digest("hex") };
}
async function lock(root2, featureId, operation) {
  const directory = path2.join(devFlow(root2), ".lock");
  const started = Date.now();
  await mkdir(devFlow(root2), { recursive: true });
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
async function readState(root2, featureId) {
  try {
    const state = JSON.parse(await readFile(statePath(root2, featureId), "utf8"));
    validateFeatureState(state);
    if (state.featureId !== featureId) throw new DevFlowError("INVALID_STATE_SCHEMA", "state feature id does not match its path");
    return state;
  } catch (error) {
    if (error instanceof DevFlowError) throw error;
    throw new DevFlowError("FEATURE_NOT_FOUND", `feature ${featureId} does not exist`);
  }
}
async function readActive(root2) {
  try {
    return JSON.parse(await readFile(activePath(root2), "utf8"));
  } catch {
    return void 0;
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
async function recordHostEvent(root2, hostEvent) {
  const active = await readActive(root2);
  if (!active) return;
  const release = await lock(root2, active.featureId, "host-event");
  try {
    const state = await readState(root2, active.featureId);
    await appendEvent(root2, active.featureId, state.revision, "host-event", { ...hostEvent, at: hostEvent.at ?? (/* @__PURE__ */ new Date()).toISOString() });
  } finally {
    await release();
  }
}
async function readFeatureEvents(root2, id) {
  try {
    return (await readFile(eventPath(root2, id), "utf8")).split("\n").filter(Boolean).map((line) => JSON.parse(line));
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }
}
async function startFeature(root2, input) {
  await readProjectConfig(root2);
  const id = input.featureId ?? randomUUID();
  const release = await lock(root2, id, "start");
  try {
    const active = await readActive(root2);
    const lifecycle = input.activation ?? "active";
    if (lifecycle === "active" && active) throw new DevFlowError("ACTIVE_FEATURE_CONFLICT", "an active feature already exists");
    const { classification, route } = selectRoute(input);
    await mkdir(path2.join(features(root2), id), { recursive: true });
    const state = { schemaVersion: 1, featureId: id, revision: 0, lifecycle, route, classification, scope: input.scope ?? { inScope: [], outOfScope: [] }, steps: {}, humanGates: {}, artifacts: {}, verification: { attempts: [] }, featureCheck: {}, blockingFindings: [], logicComplete: false, lastUpdatedBy: { host: input.host, pluginVersion: "1.0.0" } };
    await writeAtomic(statePath(root2, id), state);
    await appendEvent(root2, id, 0, "started", { lifecycle, route });
    if (lifecycle === "active") await writeAtomic(activePath(root2), { featureId: id, revision: 0, updatedAt: (/* @__PURE__ */ new Date()).toISOString() });
    return state;
  } finally {
    await release();
  }
}
async function mutate(root2, id, expectedRevision, operation, mutator) {
  const release = await lock(root2, id, operation);
  try {
    const state = await readState(root2, id);
    if (state.revision !== expectedRevision) throw new DevFlowError("STATE_REVISION_CONFLICT", "state revision changed", { currentRevision: state.revision });
    await mutator(state);
    state.revision += 1;
    await writeStatusProjection(root2, state, state.revision);
    await writeAtomic(statePath(root2, id), state);
    await appendEvent(root2, id, state.revision, operation, {});
    const active = await readActive(root2);
    if (active?.featureId === id && (state.lifecycle === "finalized" || state.lifecycle === "abandoned")) await rm(activePath(root2), { force: true });
    else if (active?.featureId === id) await writeAtomic(activePath(root2), { featureId: id, revision: state.revision, updatedAt: (/* @__PURE__ */ new Date()).toISOString() });
    return state;
  } finally {
    await release();
  }
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
    const active = await readActive(root2);
    if (active?.featureId === id) await rm(activePath(root2), { force: true });
  });
}
async function reclassifyFeature(root2, id, expectedRevision, next, reason) {
  if (!reason) throw new DevFlowError("RECLASSIFICATION_REASON_REQUIRED", "reclassify requires a reason");
  return mutate(root2, id, expectedRevision, "reclassified", (state) => {
    if (state.lifecycle !== "active") throw new DevFlowError("INVALID_LIFECYCLE", "only an active feature can be reclassified");
    const selected = selectRoute(next), before = state.classification, after = selected.classification;
    const riskRemoved = before.riskLabels.some((risk) => !after.riskLabels.includes(risk));
    const lessStrict = levelRank2[after.level] < levelRank2[before.level] || topologyRank[after.topology] < topologyRank[before.topology] || before.execution === "standard" && after.execution === "light" || riskRemoved;
    if (lessStrict) throw new DevFlowError("RECLASSIFICATION_NOT_STRICTER", "reclassification cannot lower level, topology, execution, or risk");
    const changed = selected.route !== state.route || JSON.stringify(before) !== JSON.stringify(after);
    if (!changed) throw new DevFlowError("RECLASSIFICATION_NOT_STRICTER", "reclassification did not become stricter");
    const previousRoute = state.route;
    const retainedArtifacts = Object.fromEntries(Object.entries(state.artifacts).filter(([kind]) => routeDefinition(previousRoute).requiredArtifacts.includes(kind) && routeDefinition(selected.route).requiredArtifacts.includes(kind)));
    const retainedSteps = {};
    for (const step of routeDefinition(selected.route).orderedSteps) {
      if (["requirement_confirmation", "implementation_approval", "feature_check", "finalize", "verification"].includes(step)) break;
      if (state.steps[step]?.status !== "satisfied") break;
      retainedSteps[step] = state.steps[step];
    }
    state.classification = after;
    state.route = selected.route;
    state.artifacts = retainedArtifacts;
    state.steps = retainedSteps;
    state.humanGates = {};
    state.verification = { attempts: [] };
    state.featureCheck = {};
    state.logicComplete = false;
  });
}
function businessFingerprint(contents) {
  return createHash("sha256").update(contents).digest("hex");
}
var lifecycles, delay, devFlow, features, statePath, eventPath, activePath, levelRank2, topologyRank;
var init_state_store = __esm({
  "plugins/dev-flow/src/core/state-store.ts"() {
    "use strict";
    init_contract2();
    init_route();
    init_errors();
    init_project_config();
    lifecycles = /* @__PURE__ */ new Set(["active", "paused", "finalized", "abandoned"]);
    delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    devFlow = (root2) => path2.join(root2, ".dev-flow");
    features = (root2) => path2.join(devFlow(root2), "features");
    statePath = (root2, id) => path2.join(features(root2), id, "state.json");
    eventPath = (root2, id) => path2.join(features(root2), id, "events.jsonl");
    activePath = (root2) => path2.join(devFlow(root2), "active.json");
    levelRank2 = { XS: 0, S: 1, M: 2, L: 3 };
    topologyRank = { local: 0, "shared-contract": 1, "multi-chain": 2, "coordinated-rollback": 3 };
  }
});

// plugins/dev-flow/src/mcp/server.ts
import readline from "node:readline";

// plugins/dev-flow/src/core/artifacts.ts
init_contract2();
init_errors();
init_state_store();
import { createHash as createHash2 } from "node:crypto";
import { readFile as readFile2, writeFile as writeFile2 } from "node:fs/promises";
import path3 from "node:path";

// plugins/dev-flow/src/core/step-order.ts
init_contract2();
init_errors();
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

// plugins/dev-flow/src/core/artifacts.ts
var names = { status: "status.md", "risk-card": "risk-card.md", requirements: "requirements.md", "implementation-plan": "implementation-plan.md", "coverage-matrix": "coverage-matrix.md", "boundary-card": "boundary-card.md", "rollback-safety": "rollback-safety.md", verification: "verification.md", "rollback-units": "rollback-units.md", "plan-review": "plan-review.md", "code-review": "code-review.md" };
var hash = (value) => createHash2("sha256").update(value).digest("hex");
var featureDirectory = (root2, id) => path3.join(root2, ".dev-flow", "features", id);
async function scaffoldArtifact(root2, id, expectedRevision, kind) {
  const state = await readState(root2, id);
  if (state.lifecycle !== "active") throw new DevFlowError("INVALID_LIFECYCLE", "only active features can scaffold artifacts");
  if (!routeDefinition(state.route).requiredArtifacts.includes(kind)) throw new DevFlowError("ARTIFACT_NOT_REQUIRED", `${kind} is not required for ${state.route}`);
  const currentStep = currentOpenStep(state);
  const requiredNow = currentStep ? routeDefinition(state.route).artifactSteps?.[currentStep] ?? [] : [];
  if (!requiredNow.includes(kind)) throw new DevFlowError("ARTIFACT_OUT_OF_ORDER", `${kind} is not required by ${currentStep ?? "a pending step"}`, { expectedStep: currentStep });
  const filename = names[kind];
  if (!filename) throw new DevFlowError("INVALID_ARTIFACT", "unknown artifact kind");
  const target = path3.join(featureDirectory(root2, id), filename);
  const content = `---
dev_flow:
  schema_version: 1
  feature_id: ${id}
  route: ${state.route}
  kind: ${kind}
---

# ${kind}

`;
  await writeFile2(target, content, { flag: "wx" }).catch(async (error) => {
    if (error.code !== "EEXIST") throw error;
  });
  const contents = await readFile2(target, "utf8");
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
  const contents = await readFile2(path3.join(featureDirectory(root2, id), artifact.path), "utf8");
  const checksum = hash(contents);
  return mutate(root2, id, expectedRevision, "artifact-recorded", (current) => {
    current.artifacts[kind] = { ...artifact, sha256: checksum };
    if (kind === "requirements") {
      delete current.humanGates.requirement_confirmation;
      delete current.steps.requirement_confirmation;
    }
    if (["requirements", "implementation-plan", "coverage-matrix", "rollback-units", "status", "boundary-card", "rollback-safety"].includes(kind)) {
      delete current.humanGates.implementation_approval;
      delete current.steps.implementation_approval;
    }
    current.featureCheck = {};
    delete current.steps.feature_check;
    current.logicComplete = false;
    delete current.steps.finalize;
  });
}
async function assertArtifactIntegrity(root2, id) {
  const state = await readState(root2, id);
  for (const required of routeDefinition(state.route).requiredArtifacts) {
    const artifact = state.artifacts[required];
    if (!artifact) throw new DevFlowError("MISSING_REQUIRED_ARTIFACT", required);
    const contents = await readFile2(path3.join(featureDirectory(root2, id), artifact.path), "utf8");
    if (hash(contents) !== artifact.sha256) throw new DevFlowError("ARTIFACT_INTEGRITY_FAILED", required);
  }
}

// plugins/dev-flow/src/mcp/server.ts
init_errors();

// plugins/dev-flow/src/core/feature-check.ts
init_contract2();
init_errors();
init_state_store();

// plugins/dev-flow/src/core/verification.ts
init_errors();
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import path5 from "node:path";

// plugins/dev-flow/src/core/fingerprint.ts
init_errors();
import { createHash as createHash3 } from "node:crypto";
import { readdir, readFile as readFile3, lstat } from "node:fs/promises";
import path4 from "node:path";
var ignored = /* @__PURE__ */ new Set([".git", ".dev-flow", "node_modules"]);
async function collect(root2, relative, files) {
  const absolute = path4.join(root2, relative);
  let entries;
  try {
    entries = await readdir(absolute, { withFileTypes: true });
  } catch (error) {
    if (error.code === "ENOENT") return;
    throw error;
  }
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    if (ignored.has(entry.name)) continue;
    const child = path4.join(relative, entry.name);
    const target = path4.join(root2, child);
    const metadata = await lstat(target);
    if (metadata.isSymbolicLink()) throw new DevFlowError("UNSAFE_PROTECTED_ROOT", `symbolic link is not allowed: ${child}`);
    if (metadata.isDirectory()) await collect(root2, child, files);
    else if (metadata.isFile()) files.push(child);
  }
}
async function fingerprintProtectedRoots(root2, protectedRoots) {
  const files = [];
  for (const item of [...protectedRoots].sort()) await collect(root2, item, files);
  const digest2 = createHash3("sha256");
  for (const relative of files.sort()) {
    digest2.update(relative);
    digest2.update("\0");
    digest2.update(await readFile3(path4.join(root2, relative)));
    digest2.update("\0");
  }
  return digest2.digest("hex");
}

// plugins/dev-flow/src/core/verification.ts
init_state_store();
init_state_store();
init_route();
var run = promisify(execFile);
async function runVerification(root2, id, expectedRevision, host, commandIds) {
  const config = await readProjectConfig(root2);
  const selected = commandIds?.length ? config.verification.commands.filter((command) => commandIds.includes(command.id)) : config.verification.commands;
  if (!selected.length || commandIds?.some((command) => !selected.some((item) => item.id === command))) {
    throw new DevFlowError("UNKNOWN_VERIFICATION_COMMAND", "verification command is not configured");
  }
  const fingerprint = await fingerprintProtectedRoots(root2, config.protectedRoots);
  const startedAt = (/* @__PURE__ */ new Date()).toISOString();
  let exitCode = 0;
  const output = [];
  for (const command of selected) {
    try {
      const result2 = await run(command.command, command.args, { cwd: path5.resolve(root2, command.cwd), timeout: 12e4, maxBuffer: 1024 * 1024 });
      output.push(`[${command.id}] ${result2.stdout}${result2.stderr}`);
    } catch (error) {
      const failure2 = error;
      exitCode = typeof failure2.code === "number" ? failure2.code : 1;
      output.push(`[${command.id}] ${failure2.stdout ?? ""}${failure2.stderr ?? failure2.message}`);
      break;
    }
  }
  const finishedAt = (/* @__PURE__ */ new Date()).toISOString();
  return mutate(root2, id, expectedRevision, "verification-recorded", (state) => {
    if (state.lifecycle !== "active") throw new DevFlowError("INVALID_LIFECYCLE", "only active features can verify");
    assertCurrentStep(state, "verification");
    const kinds = state.classification.riskLabels.length ? deriveRiskRequirements(state.classification.riskLabels).verification : ["targeted"];
    const attempt = { id: state.verification.attempts.length + 1, commandIds: selected.map((item) => item.id), kinds, startedAt, finishedAt, exitCode, output: output.join("\n").slice(-32e3), fingerprint, host };
    state.verification.attempts.push(attempt);
    delete state.verification.satisfiedByAttemptId;
    delete state.verification.verifiedFingerprint;
    state.steps.verification = { status: "pending", evidence: { attemptId: attempt.id, exitCode } };
    if (exitCode === 0) {
      state.verification.satisfiedByAttemptId = attempt.id;
      state.verification.verifiedFingerprint = fingerprint;
      state.businessFingerprint = fingerprint;
      state.steps.verification = { status: "satisfied", evidence: { attemptId: attempt.id, commandIds: attempt.commandIds, kinds: attempt.kinds, fingerprint } };
    }
    state.lastUpdatedBy = { host, pluginVersion: "1.0.0" };
  });
}
async function invalidateStaleVerification(root2, id, expectedRevision) {
  const config = await readProjectConfig(root2);
  const current = await fingerprintProtectedRoots(root2, config.protectedRoots);
  const state = await Promise.resolve().then(() => (init_state_store(), state_store_exports)).then(({ readState: readState4 }) => readState4(root2, id));
  if (!state.verification.verifiedFingerprint || state.verification.verifiedFingerprint === current) return void 0;
  if (state.revision !== expectedRevision) throw new DevFlowError("STATE_REVISION_CONFLICT", "state revision changed", { currentRevision: state.revision });
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
init_route();
async function recordStep(root2, id, expectedRevision, step, evidence) {
  return mutate(root2, id, expectedRevision, "step-recorded", (state) => {
    if (state.lifecycle !== "active") throw new DevFlowError("INVALID_LIFECYCLE", "only active features can record steps");
    if (["requirement_confirmation", "implementation_approval", "verification", "feature_check", "finalize"].includes(step) || !routeDefinition(state.route).orderedSteps.includes(step)) throw new DevFlowError("INVALID_STEP", step);
    assertCurrentStep(state, step);
    const reviewType = evidence?.reviewType;
    if (step === "plan_review" && reviewType !== "plan" || step === "code_review" && reviewType !== "code") throw new DevFlowError("REVIEW_TYPE_MISMATCH", step);
    const risk = deriveRiskRequirements(state.classification.riskLabels);
    if (step === "risk_controls") {
      const supplied = evidence?.checks;
      const required = risk.checks.filter((check) => check !== "full-code-review");
      if (!Array.isArray(supplied) || required.some((check) => !supplied.includes(check))) throw new DevFlowError("RISK_EVIDENCE_INCOMPLETE", "risk controls do not cover route risk obligations", { required });
    }
    if (step === "code_review" && risk.checks.includes("full-code-review") && evidence?.reviewDepth !== "full") throw new DevFlowError("RISK_EVIDENCE_INCOMPLETE", "full code review is required");
    state.steps[step] = { status: "satisfied", evidence };
  });
}
async function invalidateBeforeFinalClaim(root2, id, expectedRevision) {
  const invalidated = await invalidateStaleVerification(root2, id, expectedRevision);
  if (invalidated) throw new DevFlowError("VERIFICATION_STALE", "protected files changed; rerun verification", { currentRevision: invalidated.revision });
}
async function featureCheck(root2, id, expectedRevision) {
  await invalidateBeforeFinalClaim(root2, id, expectedRevision);
  await assertArtifactIntegrity(root2, id);
  return mutate(root2, id, expectedRevision, "feature-checked", (state) => {
    assertCurrentStep(state, "feature_check");
    if (state.verification.verifiedFingerprint !== state.businessFingerprint) throw new DevFlowError("VERIFICATION_STALE", "protected files changed or verification did not pass");
    const evidence = state.steps.verification?.evidence;
    const requiredKinds = state.classification.riskLabels.length ? deriveRiskRequirements(state.classification.riskLabels).verification : ["targeted"];
    if (!Array.isArray(evidence?.kinds) || requiredKinds.some((kind) => !evidence.kinds?.includes(kind))) throw new DevFlowError("RISK_EVIDENCE_INCOMPLETE", "verification did not satisfy risk evidence kinds", { requiredKinds });
    state.featureCheck = { passed: true, fingerprint: state.businessFingerprint };
    state.steps.feature_check = { status: "satisfied" };
  });
}
async function finalize(root2, id, expectedRevision) {
  await invalidateBeforeFinalClaim(root2, id, expectedRevision);
  await assertArtifactIntegrity(root2, id);
  return mutate(root2, id, expectedRevision, "finalized", (state) => {
    const route = routeDefinition(state.route);
    assertCurrentStep(state, "finalize");
    if (route.featureCheckRequired && (!state.featureCheck.passed || state.featureCheck.fingerprint !== state.businessFingerprint)) throw new DevFlowError("FEATURE_CHECK_REQUIRED", "feature check is required");
    state.logicComplete = true;
    state.lifecycle = "finalized";
    state.steps.finalize = { status: "satisfied" };
  });
}

// plugins/dev-flow/src/core/human-gates.ts
init_contract2();
init_errors();
init_state_store();
import { createHash as createHash4 } from "node:crypto";
var digest = (value) => createHash4("sha256").update(JSON.stringify(value)).digest("hex");
var gates = /* @__PURE__ */ new Set(["requirement_confirmation", "implementation_approval"]);
function gateBasis(state, gate) {
  if (gate === "requirement_confirmation") return { route: state.route, scope: state.scope, requirements: state.artifacts.requirements, classification: state.classification };
  return { route: state.route, scope: state.scope, classification: state.classification, plan: state.artifacts["implementation-plan"], coverage: state.artifacts["coverage-matrix"], rollback: state.artifacts["rollback-units"] ?? state.artifacts["rollback-safety"], risk: state.artifacts["risk-card"], boundary: state.artifacts["boundary-card"] };
}
async function presentGate(root2, id, expectedRevision, gate) {
  if (!gates.has(gate)) throw new DevFlowError("INVALID_GATE", gate);
  return mutate(root2, id, expectedRevision, "gate-presented", (state) => {
    if (state.lifecycle !== "active") throw new DevFlowError("INVALID_LIFECYCLE", "gate requires active feature");
    if (!routeDefinition(state.route).orderedSteps.includes(gate)) throw new DevFlowError("INVALID_GATE", gate);
    if (state.humanGates[gate]) throw new DevFlowError("HUMAN_GATE_ALREADY_PRESENTED", gate);
    assertCurrentStep(state, gate);
    const missing = artifactsRequiredBeforeGate(state, gate).find((kind) => !state.artifacts[kind]);
    if (missing) throw new DevFlowError("MISSING_REQUIRED_ARTIFACT", missing);
    state.humanGates[gate] = { status: "pending", presentedRevision: state.revision, presentedAt: (/* @__PURE__ */ new Date()).toISOString(), basisHash: digest(gateBasis(state, gate)) };
  });
}
async function confirmGate(root2, id, expectedRevision, gate, userReply, provenance, host) {
  if (!gates.has(gate)) throw new DevFlowError("INVALID_GATE", gate);
  if (!userReply.trim()) throw new DevFlowError("HUMAN_GATE_REPLY_REQUIRED", "userReply is required");
  if (!provenance.promptEventId && !provenance.turnBoundaryEventId) throw new DevFlowError("HUMAN_GATE_PROVENANCE_UNAVAILABLE", "a post-presentation prompt or turn boundary is required");
  const marker = provenance.promptEventId ?? provenance.turnBoundaryEventId;
  if (!marker) throw new DevFlowError("HUMAN_GATE_PROVENANCE_UNAVAILABLE", "a post-presentation prompt or turn boundary is required");
  const events = await readFeatureEvents(root2, id);
  return mutate(root2, id, expectedRevision, "gate-confirmed", (state) => {
    const current = state.humanGates[gate];
    if (current?.status !== "pending") throw new DevFlowError("HUMAN_GATE_NOT_PENDING", gate);
    if ((current.presentedRevision ?? state.revision) >= state.revision) throw new DevFlowError("HUMAN_GATE_SAME_TURN", "confirmation must occur after presentation");
    const eventRecord = events.find((item) => item.type === "host-event" && item.data.eventId === marker);
    const event = eventRecord?.data;
    if (!event || !current.presentedAt || (eventRecord?.revision ?? -1) <= (current.presentedRevision ?? -1) || Date.parse(event.at ?? "") < Date.parse(current.presentedAt)) throw new DevFlowError("HUMAN_GATE_SAME_TURN", "confirmation evidence must be later than gate presentation");
    if (provenance.promptEventId && (event.type !== "user-prompt" || event.text !== userReply)) throw new DevFlowError("HUMAN_GATE_REPLY_MISMATCH", "userReply must match the captured prompt");
    if (provenance.turnBoundaryEventId && event.type !== "turn-boundary") throw new DevFlowError("HUMAN_GATE_PROVENANCE_UNAVAILABLE", "turn boundary was not captured");
    for (const [otherGate, value] of Object.entries(state.humanGates)) if (otherGate !== gate && value.confirmation && Object.values(value.confirmation).includes(marker)) throw new DevFlowError("HUMAN_GATE_EVENT_CONSUMED", String(marker));
    const basisHash = digest(gateBasis(state, gate));
    if (basisHash !== current.basisHash) throw new DevFlowError("HUMAN_GATE_BASIS_CHANGED", gate);
    state.humanGates[gate] = { ...current, status: "confirmed", confirmation: { userReply, ...provenance, host, confirmedAt: (/* @__PURE__ */ new Date()).toISOString() } };
    state.steps[gate] = { status: "satisfied" };
    state.lastUpdatedBy = { host, pluginVersion: "1.0.0" };
  });
}

// plugins/dev-flow/src/mcp/server.ts
init_state_store();

// plugins/dev-flow/src/core/next.ts
init_contract2();

// plugins/dev-flow/src/policy/derive-next.ts
init_contract2();
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
init_state_store();
function toDerivedState(state) {
  const steps = { ...state.steps };
  for (const gate of ["requirement_confirmation", "implementation_approval"]) {
    const snapshot = state.humanGates[gate];
    if (snapshot?.status === "pending") steps[gate] = { status: "pending", artifactReady: true };
  }
  return {
    schemaVersion: state.schemaVersion,
    lifecycle: state.lifecycle,
    route: state.route,
    steps,
    blockingFindings: state.blockingFindings,
    verificationFresh: Boolean(state.verification.verifiedFingerprint && state.verification.verifiedFingerprint === state.businessFingerprint),
    featureCheckFresh: Boolean(state.featureCheck.passed && state.featureCheck.fingerprint === state.businessFingerprint),
    logicComplete: state.logicComplete
  };
}
async function nextAction(root2, id) {
  let state = await readState(root2, id);
  const invalidated = await invalidateStaleVerification(root2, id, state.revision);
  if (invalidated) state = invalidated;
  const action = deriveNext(toDerivedState(state));
  if (action.kind === "run-step" && action.step === "feature_check") return { kind: "feature-check" };
  if (action.kind === "run-step" && action.step === "finalize") return { kind: "finalize" };
  if (action.kind === "run-step" || action.kind === "present-human-gate") {
    const requiredNow = routeDefinition(state.route).artifactSteps?.[action.step] ?? [];
    const missing = requiredNow.find((artifact) => !state.artifacts[artifact]);
    if (missing) return { kind: "scaffold-artifact", step: missing };
  }
  return action;
}

// plugins/dev-flow/src/mcp/server.ts
init_route();

// plugins/dev-flow/src/mcp/doctor.ts
init_state_store();
import { access, readFile as readFile4 } from "node:fs/promises";
import path6 from "node:path";
async function readable(file) {
  try {
    await access(file);
    return true;
  } catch {
    return false;
  }
}
async function validJson(file) {
  try {
    JSON.parse(await readFile4(file, "utf8"));
    return true;
  } catch {
    return false;
  }
}
async function collectDoctorReport(root2, pluginRoot2, version, tools2) {
  const diagnostics = [];
  const add = (code, status, message) => diagnostics.push({ code, status, message });
  const projectFile = path6.join(root2, ".dev-flow", "project.json");
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
  const activeFile = path6.join(root2, ".dev-flow", "active.json");
  let activeFeature = { present: await readable(activeFile), valid: false };
  if (activeFeature.present) {
    try {
      const active = JSON.parse(await readFile4(activeFile, "utf8"));
      if (!active.featureId) throw new Error("active feature id is missing");
      const state = await readState(root2, active.featureId);
      activeFeature = { present: true, featureId: state.featureId, valid: state.lifecycle === "active" };
      add(activeFeature.valid ? "ACTIVE_FEATURE_VALID" : "ACTIVE_FEATURE_INVALID", activeFeature.valid ? "ok" : "error", activeFeature.valid ? `active feature ${state.featureId} is valid` : `active feature ${state.featureId} is not active`);
    } catch (error) {
      add("ACTIVE_FEATURE_INVALID", "error", error instanceof Error ? error.message : String(error));
    }
  } else add("NO_ACTIVE_FEATURE", "ok", "no active feature is recorded");
  const paths = {
    claudeManifest: path6.join(pluginRoot2, ".claude-plugin", "plugin.json"),
    codexManifest: path6.join(pluginRoot2, ".codex-plugin", "plugin.json"),
    mcp: path6.join(pluginRoot2, ".mcp.json"),
    claudeHooks: path6.join(pluginRoot2, "hosts", "claude", "hooks.json"),
    codexHooks: path6.join(pluginRoot2, "hosts", "codex", "hooks.json"),
    mcpBundle: path6.join(pluginRoot2, "dist", "mcp-server.mjs"),
    claudeBundle: path6.join(pluginRoot2, "dist", "claude-hook.mjs"),
    codexBundle: path6.join(pluginRoot2, "dist", "codex-hook.mjs")
  };
  const files = await Promise.all(Object.entries(paths).map(async ([name, file]) => [name, await readable(file)]));
  const missing = files.filter(([, exists]) => !exists).map(([name]) => name);
  add(missing.length ? "PLUGIN_FILES_MISSING" : "PLUGIN_FILES_PRESENT", missing.length ? "error" : "ok", missing.length ? `missing plugin files: ${missing.join(", ")}` : "manifests, hooks, MCP configuration and bundles are present");
  const jsonFiles = [paths.claudeManifest, paths.codexManifest, paths.mcp, paths.claudeHooks, paths.codexHooks];
  const invalidJson = (await Promise.all(jsonFiles.map(async (file) => !await validJson(file)))).some(Boolean);
  add(invalidJson ? "PLUGIN_WIRING_INVALID" : "PLUGIN_WIRING_VALID", invalidJson ? "error" : "ok", invalidJson ? "a manifest, MCP file, or hook file is not valid JSON" : "plugin manifest, MCP and hook wiring parse successfully");
  return { version, root: root2, pluginRoot: pluginRoot2, tools: tools2, project, activeFeature, mcp: { server: "running", configuration: !invalidJson }, diagnostics };
}

// plugins/dev-flow/src/mcp/server.ts
import { fileURLToPath } from "node:url";
import path7 from "node:path";
var root = process.cwd();
var moduleDirectory = path7.dirname(fileURLToPath(import.meta.url));
var pluginRoot = path7.basename(moduleDirectory) === "dist" ? path7.resolve(moduleDirectory, "..") : path7.resolve(moduleDirectory, "../..");
var tools = ["dev_flow_init_project", "dev_flow_classify", "dev_flow_start", "dev_flow_status", "dev_flow_next", "dev_flow_switch_active", "dev_flow_scaffold_artifact", "dev_flow_record_artifact", "dev_flow_record_step", "dev_flow_present_gate", "dev_flow_confirm_gate", "dev_flow_reclassify", "dev_flow_verify", "dev_flow_feature_check", "dev_flow_finalize", "dev_flow_abandon", "dev_flow_doctor"];
var object = (required, properties = {}) => ({ type: "object", required, properties, additionalProperties: false });
var string = { type: "string", minLength: 1 };
var integer = { type: "integer", minimum: 0 };
var featureMutation = (extra = {}) => object(["featureId", "expectedRevision"], { featureId: string, expectedRevision: integer, ...extra });
var toolSchemas = {
  dev_flow_init_project: { description: "Create strict project configuration.", inputSchema: object(["config"], { config: { type: "object" } }) },
  dev_flow_classify: { description: "Pure route classification.", inputSchema: object(["level", "topology"], { level: { enum: ["XS", "S", "M", "L"] }, topology: { enum: ["local", "shared-contract", "multi-chain", "coordinated-rollback"] }, execution: { enum: ["light", "standard"] }, requirements: { enum: ["missing-or-unclear", "documented-unconfirmed", "provided-confirmed"] }, riskLabels: { type: "array" } }), annotations: { readOnlyHint: true } },
  dev_flow_start: { description: "Create a classified feature.", inputSchema: object(["level", "topology"], { level: { enum: ["XS", "S", "M", "L"] }, topology: { enum: ["local", "shared-contract", "multi-chain", "coordinated-rollback"] }, execution: { enum: ["light", "standard"] }, requirements: { type: "string" }, riskLabels: { type: "array" }, featureId: string, activation: { enum: ["active", "paused"] }, scope: { type: "object" }, host: { enum: ["claude", "codex"] } }) },
  dev_flow_status: { description: "Read one feature state.", inputSchema: object(["featureId"], { featureId: string }), annotations: { readOnlyHint: true } },
  dev_flow_next: { description: "Return the unique allowed next action.", inputSchema: object(["featureId"], { featureId: string }), annotations: { readOnlyHint: true } },
  dev_flow_switch_active: { description: "Atomically hand off the single active feature.", inputSchema: object(["fromFeatureId", "toFeatureId", "reason"], { fromFeatureId: string, toFeatureId: string, reason: string }) },
  dev_flow_scaffold_artifact: { description: "Create only the current route artifact.", inputSchema: featureMutation({ kind: string }) },
  dev_flow_record_artifact: { description: "Register an edited route artifact.", inputSchema: featureMutation({ kind: string }) },
  dev_flow_record_step: { description: "Record the current non-gate route step.", inputSchema: featureMutation({ step: string, evidence: {} }) },
  dev_flow_present_gate: { description: "Present a strict human gate.", inputSchema: featureMutation({ gate: { enum: ["requirement_confirmation", "implementation_approval"] } }) },
  dev_flow_confirm_gate: { description: "Confirm a presented gate with later user evidence.", inputSchema: featureMutation({ gate: { enum: ["requirement_confirmation", "implementation_approval"] }, userReply: string, promptEventId: string, turnBoundaryEventId: string, host: { enum: ["claude", "codex"] } }) },
  dev_flow_reclassify: { description: "Monotonically increase route strictness.", inputSchema: featureMutation({ classification: { type: "object" }, reason: string }) },
  dev_flow_verify: { description: "Run only configured verification commands.", inputSchema: featureMutation({ commandIds: { type: "array", items: string }, host: { enum: ["claude", "codex"] } }) },
  dev_flow_feature_check: { description: "Check route completeness and fresh evidence.", inputSchema: featureMutation() },
  dev_flow_finalize: { description: "Set logic-complete after all obligations pass.", inputSchema: featureMutation() },
  dev_flow_abandon: { description: "Terminally abandon a non-finalized feature.", inputSchema: featureMutation({ reason: string, userEvidence: string }) },
  dev_flow_doctor: { description: "Diagnose plugin and project wiring.", inputSchema: object([]), annotations: { readOnlyHint: true } }
};
function result(id, value) {
  process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", id, result: { content: [{ type: "text", text: JSON.stringify(value) }], structuredContent: value } })}
`);
}
function failure(id, error) {
  const value = error instanceof DevFlowError ? { code: error.code, message: error.message, details: error.details } : { code: "INTERNAL_ERROR", message: error instanceof Error ? error.message : String(error) };
  process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", id, error: { code: -32e3, message: value.message, data: value } })}
`);
}
async function call(name, a) {
  switch (name) {
    case "dev_flow_init_project":
      return initProject(root, a.config);
    case "dev_flow_classify":
      return selectRoute(a);
    case "dev_flow_start":
      return startFeature(root, { ...a, host: a.host ?? "codex" });
    case "dev_flow_status":
      return readState(root, a.featureId);
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
    case "dev_flow_present_gate":
      return presentGate(root, a.featureId, a.expectedRevision, a.gate);
    case "dev_flow_confirm_gate":
      return confirmGate(root, a.featureId, a.expectedRevision, a.gate, a.userReply, { promptEventId: a.promptEventId, turnBoundaryEventId: a.turnBoundaryEventId }, a.host ?? "codex");
    case "dev_flow_reclassify":
      return reclassifyFeature(root, a.featureId, a.expectedRevision, a.classification, a.reason);
    case "dev_flow_verify":
      return runVerification(root, a.featureId, a.expectedRevision, a.host ?? "codex", a.commandIds);
    case "dev_flow_feature_check":
      return featureCheck(root, a.featureId, a.expectedRevision);
    case "dev_flow_finalize":
      return finalize(root, a.featureId, a.expectedRevision);
    case "dev_flow_abandon":
      return abandonFeature(root, a.featureId, a.expectedRevision, a.reason, a.userEvidence);
    case "dev_flow_doctor":
      return collectDoctorReport(root, pluginRoot, "1.0.0", tools);
    default:
      throw new DevFlowError("UNKNOWN_TOOL", name);
  }
}
for await (const line of readline.createInterface({ input: process.stdin, crlfDelay: Infinity })) {
  let message = {};
  try {
    message = JSON.parse(line);
    if (message.method === "initialize") result(message.id, { protocolVersion: "2024-11-05", serverInfo: { name: "dev-flow", version: "1.0.0" }, capabilities: { tools: {} }, instructions: "Classify before starting. Call dev_flow_next and execute exactly one returned action. Stop after presenting a HUMAN GATE." });
    else if (message.method === "tools/list") result(message.id, { tools: tools.map((name) => ({ name, ...toolSchemas[name] })) });
    else if (message.method === "tools/call") result(message.id, await call(message.params.name, message.params.arguments ?? {}));
  } catch (error) {
    failure(message.id, error);
  }
}
