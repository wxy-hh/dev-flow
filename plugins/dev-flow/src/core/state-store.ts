import { randomUUID, createHash } from "node:crypto";
import { mkdir, open, readFile, rename, rm, writeFile } from "node:fs/promises";
import { hostname } from "node:os";
import path from "node:path";
import { routeDefinition } from "../policy/contract.js";
import { selectRoute } from "../policy/route.js";
import type { Classification, ClassificationInput, RouteId } from "../policy/types.js";
import { DevFlowError } from "./errors.js";
import { validateProjectConfig, type ProjectConfig } from "./project-config.js";

export type Lifecycle = "active" | "paused" | "finalized" | "abandoned";
export interface FeatureState {
  schemaVersion: 1; featureId: string; revision: number; lifecycle: Lifecycle; route: RouteId; classification: Classification;
  scope: { inScope: string[]; outOfScope: string[] }; steps: Record<string, { status: "pending" | "satisfied"; evidence?: unknown }>;
  humanGates: Record<string, unknown>; artifacts: Record<string, { path: string; sha256: string }>; verification: { attempts: unknown[]; satisfiedByAttemptId?: number; verifiedFingerprint?: string };
  featureCheck: { passed?: boolean; fingerprint?: string }; businessFingerprint?: string; blockingFindings: Array<{ blocking: boolean; message: string }>;
  logicComplete: boolean; lastUpdatedBy: { host: "claude" | "codex"; pluginVersion: string };
}
const lifecycles = new Set<Lifecycle>(["active", "paused", "finalized", "abandoned"]);
function validateFeatureState(value: unknown): asserts value is FeatureState {
  const state = value as Partial<FeatureState>;
  if (state?.schemaVersion !== 1) throw new DevFlowError("UNSUPPORTED_STATE_SCHEMA", "only state schema v1 is supported");
  if (typeof state.featureId !== "string" || !state.featureId || !Number.isInteger(state.revision) || (state.revision ?? -1) < 0 || !lifecycles.has(state.lifecycle as Lifecycle) || !routeDefinition(state.route as RouteId) || !state.classification || !state.scope || !Array.isArray(state.scope.inScope) || !Array.isArray(state.scope.outOfScope) || !state.steps || !state.humanGates || !state.artifacts || !state.verification || !Array.isArray(state.verification.attempts) || !state.featureCheck || !Array.isArray(state.blockingFindings) || typeof state.logicComplete !== "boolean" || !state.lastUpdatedBy) {
    throw new DevFlowError("INVALID_STATE_SCHEMA", "state is not a valid v1 feature state");
  }
}
const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const devFlow = (root: string) => path.join(root, ".dev-flow");
const features = (root: string) => path.join(devFlow(root), "features");
const statePath = (root: string, id: string) => path.join(features(root), id, "state.json");
const eventPath = (root: string, id: string) => path.join(features(root), id, "events.jsonl");
const activePath = (root: string) => path.join(devFlow(root), "active.json");

export async function readProjectConfig(root: string): Promise<ProjectConfig> {
  try { const value = JSON.parse(await readFile(path.join(devFlow(root), "project.json"), "utf8")); validateProjectConfig(value); return value; }
  catch (error) { if (error instanceof DevFlowError) throw error; throw new DevFlowError("PROJECT_NOT_INITIALIZED", "run dev_flow_init_project first"); }
}
export async function initProject(root: string, config: ProjectConfig): Promise<void> {
  validateProjectConfig(config); await mkdir(devFlow(root), { recursive: true });
  await writeAtomic(path.join(devFlow(root), "project.json"), config);
}
async function writeAtomic(file: string, value: unknown): Promise<void> {
  const temp = `${file}.${randomUUID()}.tmp`; const handle = await open(temp, "w");
  try { await handle.writeFile(`${JSON.stringify(value, null, 2)}\n`); await handle.sync(); } finally { await handle.close(); }
  await rename(temp, file);
  const directory = await open(path.dirname(file), "r"); try { await directory.sync(); } finally { await directory.close(); }
}
async function writeStatusProjection(root: string, state: FeatureState, revision: number): Promise<void> {
  const status = state.artifacts.status; if (!status) return;
  const projection = [
    "---", "dev_flow:", "  schema_version: 1", `  feature_id: ${state.featureId}`, `  route: ${state.route}`, "  kind: status", "  generated: true", "---", "",
    "# Dev Flow Status", "", `- Revision: ${revision}`, `- Lifecycle: ${state.lifecycle}`, `- Route: ${state.route}`, `- Logic complete: ${state.logicComplete}`, "", "## Steps", "",
    ...routeDefinition(state.route).orderedSteps.map((step) => `- ${step}: ${state.steps[step]?.status ?? "pending"}`), "",
  ].join("\n");
  const file = path.join(features(root), state.featureId, status.path); await writeFile(file, `${projection}\n`);
  state.artifacts.status = { ...status, sha256: createHash("sha256").update(`${projection}\n`).digest("hex") };
}
async function lock(root: string, featureId: string, operation: string): Promise<() => Promise<void>> {
  const directory = path.join(devFlow(root), ".lock"); const started = Date.now(); await mkdir(devFlow(root), { recursive: true });
  while (true) {
    try { await mkdir(directory); await writeFile(path.join(directory, "owner.json"), JSON.stringify({ pid: process.pid, hostname: hostname(), acquiredAt: new Date().toISOString(), featureId, operation })); return async () => { await rm(directory, { recursive: true, force: true }); }; }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      try { const owner = JSON.parse(await readFile(path.join(directory, "owner.json"), "utf8")); const age = Date.now() - Date.parse(owner.acquiredAt); let live = owner.hostname === hostname(); if (live) { try { process.kill(owner.pid, 0); } catch { live = false; } } if (!live && age > 30_000) { await rm(directory, { recursive: true, force: true }); continue; } } catch { /* wait for owner */ }
      if (Date.now() - started >= 5_000) throw new DevFlowError("STATE_LOCK_TIMEOUT", "state lock could not be acquired");
      await delay(50 + Math.floor(Math.random() * 20));
    }
  }
}
export async function readState(root: string, featureId: string): Promise<FeatureState> { try { const state: unknown = JSON.parse(await readFile(statePath(root, featureId), "utf8")); validateFeatureState(state); if ((state as FeatureState).featureId !== featureId) throw new DevFlowError("INVALID_STATE_SCHEMA", "state feature id does not match its path"); return state; } catch (error) { if (error instanceof DevFlowError) throw error; throw new DevFlowError("FEATURE_NOT_FOUND", `feature ${featureId} does not exist`); } }
async function readActive(root: string): Promise<{ featureId: string; revision: number } | undefined> { try { return JSON.parse(await readFile(activePath(root), "utf8")); } catch { return undefined; } }
async function appendEvent(root: string, id: string, revision: number, type: string, data: unknown): Promise<void> { const handle = await open(eventPath(root, id), "a"); try { await handle.writeFile(`${JSON.stringify({ revision, type, at: new Date().toISOString(), data })}\n`); await handle.sync(); } finally { await handle.close(); } }
export interface HostEvent { eventId: string; type: "user-prompt" | "turn-boundary" | "tool"; host: "claude" | "codex"; text?: string; at?: string; }
export async function recordHostEvent(root: string, hostEvent: HostEvent): Promise<void> {
  const active = await readActive(root); if (!active) return;
  const release = await lock(root, active.featureId, "host-event");
  try { const state = await readState(root, active.featureId); await appendEvent(root, active.featureId, state.revision, "host-event", { ...hostEvent, at: hostEvent.at ?? new Date().toISOString() }); }
  finally { await release(); }
}
export async function readFeatureEvents(root: string, id: string): Promise<Array<{ revision: number; type: string; at: string; data: unknown }>> {
  try { return (await readFile(eventPath(root, id), "utf8")).split("\n").filter(Boolean).map((line) => JSON.parse(line)); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return []; throw error; }
}
export async function startFeature(root: string, input: ClassificationInput & { featureId?: string; activation?: "active" | "paused"; scope?: { inScope: string[]; outOfScope: string[] }; host: "claude" | "codex" }): Promise<FeatureState> {
  await readProjectConfig(root); const id = input.featureId ?? randomUUID(); const release = await lock(root, id, "start"); try { const active = await readActive(root); const lifecycle = input.activation ?? "active"; if (lifecycle === "active" && active) throw new DevFlowError("ACTIVE_FEATURE_CONFLICT", "an active feature already exists"); const { classification, route } = selectRoute(input); await mkdir(path.join(features(root), id), { recursive: true }); const state: FeatureState = { schemaVersion: 1, featureId: id, revision: 0, lifecycle, route, classification, scope: input.scope ?? { inScope: [], outOfScope: [] }, steps: {}, humanGates: {}, artifacts: {}, verification: { attempts: [] }, featureCheck: {}, blockingFindings: [], logicComplete: false, lastUpdatedBy: { host: input.host, pluginVersion: __DEV_FLOW_VERSION__ } }; await writeAtomic(statePath(root, id), state); await appendEvent(root, id, 0, "started", { lifecycle, route }); if (lifecycle === "active") await writeAtomic(activePath(root), { featureId: id, revision: 0, updatedAt: new Date().toISOString() }); return state; } finally { await release(); } }
export async function mutate(root: string, id: string, expectedRevision: number, operation: string, mutator: (state: FeatureState) => void | Promise<void>): Promise<FeatureState> { const release = await lock(root, id, operation); try { const state = await readState(root, id); if (state.revision !== expectedRevision) throw new DevFlowError("STATE_REVISION_CONFLICT", "state revision changed", { currentRevision: state.revision }); await mutator(state); state.revision += 1; await writeStatusProjection(root, state, state.revision); await writeAtomic(statePath(root, id), state); await appendEvent(root, id, state.revision, operation, {}); const active = await readActive(root); if (active?.featureId === id && (state.lifecycle === "finalized" || state.lifecycle === "abandoned")) await rm(activePath(root), { force: true }); else if (active?.featureId === id) await writeAtomic(activePath(root), { featureId: id, revision: state.revision, updatedAt: new Date().toISOString() }); return state; } finally { await release(); } }
export async function switchActive(root: string, from: string, to: string, reason: string): Promise<void> { if (!reason) throw new DevFlowError("SWITCH_REASON_REQUIRED", "switch requires a reason"); const release = await lock(root, `${from}:${to}`, "switch-active"); try { const active = await readActive(root); if (active?.featureId !== from) throw new DevFlowError("ACTIVE_FEATURE_CONFLICT", "source is not active"); const source = await readState(root, from), target = await readState(root, to); if (target.lifecycle !== "paused") throw new DevFlowError("INVALID_LIFECYCLE", "target must be paused"); source.lifecycle = "paused"; source.revision++; target.lifecycle = "active"; target.revision++; await writeAtomic(statePath(root, from), source); await writeAtomic(statePath(root, to), target); await appendEvent(root, from, source.revision, "paused", { reason }); await appendEvent(root, to, target.revision, "activated", { reason }); await writeAtomic(activePath(root), { featureId: to, revision: target.revision, updatedAt: new Date().toISOString() }); } finally { await release(); } }
export async function abandonFeature(root: string, id: string, expectedRevision: number, reason: string, userEvidence: string): Promise<FeatureState> { if (!reason || !userEvidence) throw new DevFlowError("ABANDON_EVIDENCE_REQUIRED", "abandon requires reason and user evidence"); return mutate(root, id, expectedRevision, "abandoned", async (state) => { if (state.lifecycle === "finalized" || state.lifecycle === "abandoned") throw new DevFlowError("INVALID_LIFECYCLE", "terminal feature cannot be abandoned"); state.lifecycle = "abandoned"; const active = await readActive(root); if (active?.featureId === id) await rm(activePath(root), { force: true }); }); }
const levelRank: Record<string, number> = { XS: 0, S: 1, M: 2, L: 3 };
const topologyRank: Record<string, number> = { local: 0, "shared-contract": 1, "multi-chain": 2, "coordinated-rollback": 3 };
export async function reclassifyFeature(root: string, id: string, expectedRevision: number, next: ClassificationInput, reason: string): Promise<FeatureState> {
  if (!reason) throw new DevFlowError("RECLASSIFICATION_REASON_REQUIRED", "reclassify requires a reason");
  return mutate(root, id, expectedRevision, "reclassified", (state) => {
    if (state.lifecycle !== "active") throw new DevFlowError("INVALID_LIFECYCLE", "only an active feature can be reclassified");
    const selected = selectRoute(next), before = state.classification, after = selected.classification;
    const riskRemoved = before.riskLabels.some((risk) => !after.riskLabels.includes(risk));
    const lessStrict = levelRank[after.level] < levelRank[before.level] || topologyRank[after.topology] < topologyRank[before.topology] || (before.execution === "standard" && after.execution === "light") || riskRemoved;
    if (lessStrict) throw new DevFlowError("RECLASSIFICATION_NOT_STRICTER", "reclassification cannot lower level, topology, execution, or risk");
    const changed = selected.route !== state.route || JSON.stringify(before) !== JSON.stringify(after);
    if (!changed) throw new DevFlowError("RECLASSIFICATION_NOT_STRICTER", "reclassification did not become stricter");
    const previousRoute = state.route;
    const retainedArtifacts = Object.fromEntries(Object.entries(state.artifacts).filter(([kind]) => routeDefinition(previousRoute).requiredArtifacts.includes(kind) && routeDefinition(selected.route).requiredArtifacts.includes(kind)));
    const retainedSteps: FeatureState["steps"] = {};
    for (const step of routeDefinition(selected.route).orderedSteps) {
      if (["requirement_confirmation", "implementation_approval", "feature_check", "finalize", "verification"].includes(step)) break;
      if (state.steps[step]?.status !== "satisfied") break;
      retainedSteps[step] = state.steps[step];
    }
    state.classification = after; state.route = selected.route; state.artifacts = retainedArtifacts; state.steps = retainedSteps; state.humanGates = {}; state.verification = { attempts: [] }; state.featureCheck = {}; state.logicComplete = false;
  });
}
export function businessFingerprint(contents: string): string { return createHash("sha256").update(contents).digest("hex"); }
