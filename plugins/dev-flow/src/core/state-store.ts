import { randomUUID, createHash } from "node:crypto";
import { access, mkdir, open, readdir, readFile, rename, rm, rmdir, writeFile } from "node:fs/promises";
import { hostname } from "node:os";
import path from "node:path";
import { normalizeWorkflowCapabilities, reviewEnforcementRequired, routeDefinition, routeDefinitionForFeature, traceEnforcementRequired } from "../policy/contract.js";
import { selectRoute } from "../policy/route.js";
import { SUPPORTED_WORKFLOW_CAPABILITIES, type Classification, type ClassificationInput, type RouteId, type WorkflowCapabilities } from "../policy/types.js";
import type { TraceabilityPointer } from "../policy/traceability.js";
import type { ReviewPointer } from "../policy/review.js";
import type { ImplementationUnitState } from "../policy/rollback.js";
import { DevFlowError } from "./errors.js";
import { captureDeliveryBaseline, type DeliveryBaseline, type DeliverySnapshot } from "./delivery-snapshot.js";
import { fingerprintProtectedRoots } from "./fingerprint.js";
import { validateProjectConfig, type ProjectConfig } from "./project-config.js";
import { emptyTraceabilityLedger } from "./traceability.js";
import { inspectCurrentTrace } from "./traceability-gates.js";
import { readProjectConfigSnapshot, writeTraceSnapshot } from "./traceability-store.js";
import { emptyReviewLedger, prepareReviewInvalidation, writeReviewSnapshot } from "./review-store.js";
import { prepareReviewProjection } from "./review-projection.js";

export type Lifecycle = "active" | "paused" | "finalized" | "abandoned";
export interface FeatureState {
  schemaVersion: 1; featureId: string; revision: number; lifecycle: Lifecycle; route: RouteId; classification: Classification;
  scope: { inScope: string[]; outOfScope: string[] }; steps: Record<string, { status: "pending" | "satisfied"; evidence?: unknown }>;
  humanGates: Record<string, unknown>; artifacts: Record<string, { path: string; sha256: string }>; verification: { attempts: unknown[]; satisfiedByAttemptId?: number; verifiedFingerprint?: string };
  /** Optional so v1 state written before interactive controls remains readable. */
  interactions?: Record<string, unknown>;
  /** Optional so active features written before traceability capabilities remain readable. */
  workflowCapabilities?: WorkflowCapabilities;
  /** Immutable snapshot pointer; legacy and non-enforced routes may omit it. */
  traceability?: TraceabilityPointer;
  /** Immutable review snapshot pointer; legacy and non-enforced routes may omit it. */
  review?: ReviewPointer;
  /** Runtime lifecycle of rollback units; absent until the first begin and on legacy features. */
  implementationUnits?: ImplementationUnitState[];
  /** Rollback confirmation gate state; absent until presentRollbackGate is called. */
  rollbackGate?: {
    status: "pending" | "confirmed";
    targetCheckpointId: string;
    targetUnitId: string;
    previewBasisHash: string;
    interactionId: string;
    stateRevision: number;
    presentedAt: string;
    confirmedAt?: string;
  };
  featureCheck: { passed?: boolean; fingerprint?: string }; businessFingerprint?: string; startBusinessFingerprint?: string;
  deliveryBaseline?: DeliveryBaseline; deliverySnapshot?: DeliverySnapshot;
  blockingFindings: Array<{ blocking: boolean; message: string }>;
  logicComplete: boolean; lastUpdatedBy: { host: "claude" | "codex"; pluginVersion: string };
}
const lifecycles = new Set<Lifecycle>(["active", "paused", "finalized", "abandoned"]);
const unitStatuses = new Set(["pending", "active", "verified", "checkpointed", "rolled_back"]);
function validateImplementationUnits(units: unknown): asserts units is ImplementationUnitState[] {
  if (!Array.isArray(units)) throw new DevFlowError("INVALID_STATE_SCHEMA", "implementationUnits must be an array");
  const ids = new Set<string>();
  const checkpoints = new Set<string>();
  for (const value of units) {
    const unit = value as Partial<ImplementationUnitState> | undefined;
    if (!unit || typeof unit !== "object" || Array.isArray(unit)
      || typeof unit.unitId !== "string" || !/^RU-[0-9]{3,}$/.test(unit.unitId)
      || typeof unit.status !== "string" || !unitStatuses.has(unit.status)
      || typeof unit.basisHash !== "string" || !/^[a-f0-9]{64}$/.test(unit.basisHash)
      || (unit.startedFingerprint !== undefined && (typeof unit.startedFingerprint !== "string" || !/^[a-f0-9]{64}$/.test(unit.startedFingerprint)))
      || (unit.checkpointId !== undefined && typeof unit.checkpointId !== "string")
      || (unit.beginNonce !== undefined && (typeof unit.beginNonce !== "string" || unit.beginNonce.trim().length === 0))) {
      throw new DevFlowError("INVALID_STATE_SCHEMA", "implementation unit state is invalid");
    }
    const started = unit.startedFingerprint !== undefined;
    const checkpointed = unit.checkpointId !== undefined;
    // Align with policy/parseImplementationUnitState: pending never carries a
    // beginNonce; blank nonces are rejected above via trim.
    const hasNonce = unit.beginNonce !== undefined;
    const consistent = (unit.status === "pending" && !started && !checkpointed && !hasNonce)
      || ((unit.status === "active" || unit.status === "verified") && started && !checkpointed)
      || ((unit.status === "checkpointed" || unit.status === "rolled_back") && started && checkpointed);
    if (!consistent) throw new DevFlowError("INVALID_STATE_SCHEMA", "implementation unit status is inconsistent with its fields");
    if (ids.has(unit.unitId)) throw new DevFlowError("INVALID_STATE_SCHEMA", "implementation units duplicate a rollback unit");
    if (checkpointed && checkpoints.has(unit.checkpointId!)) throw new DevFlowError("INVALID_STATE_SCHEMA", "implementation units duplicate a checkpoint id");
    ids.add(unit.unitId);
    if (checkpointed) checkpoints.add(unit.checkpointId!);
  }
}
export function validateFeatureState(value: unknown): asserts value is FeatureState {
  const state = value as Partial<FeatureState>;
  if (state?.schemaVersion !== 1) throw new DevFlowError("UNSUPPORTED_STATE_SCHEMA", "only state schema v1 is supported");
  if (typeof state.featureId !== "string" || !state.featureId || !Number.isInteger(state.revision) || (state.revision ?? -1) < 0 || !lifecycles.has(state.lifecycle as Lifecycle) || !routeDefinition(state.route as RouteId) || !state.classification || !state.scope || !Array.isArray(state.scope.inScope) || !Array.isArray(state.scope.outOfScope) || !state.steps || !state.humanGates || !state.artifacts || !state.verification || !Array.isArray(state.verification.attempts) || (state.interactions !== undefined && (typeof state.interactions !== "object" || state.interactions === null || Array.isArray(state.interactions))) || !state.featureCheck || !Array.isArray(state.blockingFindings) || typeof state.logicComplete !== "boolean" || !state.lastUpdatedBy) {
    throw new DevFlowError("INVALID_STATE_SCHEMA", "state is not a valid v1 feature state");
  }
  if (state.workflowCapabilities !== undefined) {
    try { normalizeWorkflowCapabilities(state.workflowCapabilities); }
    catch { throw new DevFlowError("INVALID_STATE_SCHEMA", "workflowCapabilities are invalid"); }
  }
  if (state.traceability !== undefined) {
    const pointer = state.traceability;
    if (typeof pointer !== "object" || pointer === null
      || !/^traceability\/snapshots\/[a-f0-9]{64}\.json$/.test(pointer.path)
      || !/^[a-f0-9]{64}$/.test(pointer.sha256)
      || pointer.path !== `traceability/snapshots/${pointer.sha256}.json`
      || !Number.isInteger(pointer.revision) || pointer.revision < 0
      || !pointer.summary || !["total", "current", "stale", "tombstoned"].every((key) => Number.isInteger(pointer.summary[key as keyof typeof pointer.summary]) && pointer.summary[key as keyof typeof pointer.summary] >= 0)) {
      throw new DevFlowError("INVALID_STATE_SCHEMA", "traceability pointer is invalid");
    }
  }
  if (traceEnforcementRequired(state.route as RouteId, state.workflowCapabilities) && !state.traceability) {
    throw new DevFlowError("INVALID_STATE_SCHEMA", "trace-enforced standard feature requires a traceability pointer");
  }
  if (state.review !== undefined) {
    const pointer = state.review;
    if (typeof pointer !== "object" || pointer === null
      || !/^review\/snapshots\/[a-f0-9]{64}\.json$/.test(pointer.path)
      || !/^[a-f0-9]{64}$/.test(pointer.sha256)
      || pointer.path !== `review/snapshots/${pointer.sha256}.json`
      || !Number.isInteger(pointer.revision) || pointer.revision < 0
      || !pointer.summary || !["batches", "current", "stale", "open", "complete"].every((key) => Number.isInteger(pointer.summary[key as keyof typeof pointer.summary]) && pointer.summary[key as keyof typeof pointer.summary] >= 0)) {
      throw new DevFlowError("INVALID_STATE_SCHEMA", "review pointer is invalid");
    }
  }
  if (reviewEnforcementRequired(state.route as RouteId, state.workflowCapabilities) && !state.review) {
    throw new DevFlowError("INVALID_STATE_SCHEMA", "review-enabled standard feature requires a review pointer");
  }
  if (state.implementationUnits !== undefined) validateImplementationUnits(state.implementationUnits);
  if (state.rollbackGate !== undefined) {
    const gate = state.rollbackGate;
    if (typeof gate !== "object" || gate === null
      || (gate.status !== "pending" && gate.status !== "confirmed")
      || typeof gate.targetCheckpointId !== "string" || typeof gate.targetUnitId !== "string"
      || !/^[a-f0-9]{64}$/.test(gate.previewBasisHash)
      || typeof gate.interactionId !== "string"
      || typeof gate.stateRevision !== "number" || !Number.isInteger(gate.stateRevision) || gate.stateRevision < 0
      || typeof gate.presentedAt !== "string"
      || (gate.confirmedAt !== undefined && typeof gate.confirmedAt !== "string")) {
      throw new DevFlowError("INVALID_STATE_SCHEMA", "rollbackGate is invalid");
    }
  }
}

export function validateScopeInput(scope: unknown): { inScope: string[]; outOfScope: string[] } {
  if (scope === undefined || scope === null) return { inScope: [], outOfScope: [] };
  if (typeof scope !== "object" || Array.isArray(scope)) {
    throw new DevFlowError("INVALID_START_INPUT", "scope must be an object with inScope and outOfScope string arrays", {
      recoveryHint: "Fix scope.inScope/outOfScope then call dev_flow_start again",
    });
  }
  const value = scope as Record<string, unknown>;
  const keys = Object.keys(value);
  if (keys.some((key) => key !== "inScope" && key !== "outOfScope")) {
    throw new DevFlowError("INVALID_START_INPUT", "scope only allows inScope and outOfScope", {
      recoveryHint: "Fix scope.inScope/outOfScope then call dev_flow_start again",
    });
  }
  if (!("inScope" in value) || !("outOfScope" in value)) {
    throw new DevFlowError("INVALID_START_INPUT", "scope requires inScope and outOfScope", {
      recoveryHint: "Fix scope.inScope/outOfScope then call dev_flow_start again",
    });
  }
  if (!Array.isArray(value.inScope) || !value.inScope.every((item) => typeof item === "string")
    || !Array.isArray(value.outOfScope) || !value.outOfScope.every((item) => typeof item === "string")) {
    throw new DevFlowError("INVALID_START_INPUT", "scope.inScope and scope.outOfScope must be string arrays", {
      recoveryHint: "Fix scope.inScope/outOfScope then call dev_flow_start again",
    });
  }
  return { inScope: value.inScope as string[], outOfScope: value.outOfScope as string[] };
}

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const devFlow = (root: string) => path.join(root, ".dev-flow");
const features = (root: string) => path.join(devFlow(root), "features");
const statePath = (root: string, id: string) => path.join(features(root), id, "state.json");
const eventPath = (root: string, id: string) => path.join(features(root), id, "events.jsonl");
const activePath = (root: string) => path.join(devFlow(root), "active.json");
const recoveryTxnPath = (root: string) => path.join(devFlow(root), "recovery-transaction.json");
const recoveryEventsPath = (root: string) => path.join(devFlow(root), "recovery-events.jsonl");
const rollbackTxnPath = (root: string, featureId: string) => path.join(features(root), featureId, "rollback-transaction.json");

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
async function prepareStatusProjection(root: string, state: FeatureState, revision: number): Promise<(() => Promise<void>) | undefined> {
  const status = state.artifacts.status; if (!status) return;
  const trace = await inspectCurrentTrace(root, state);
  const summary = trace.effectiveSummary;
  const traceLines = [
    "## Trace", "",
    `- Enforced: ${trace.enforced}`,
    ...(state.traceability ? [`- Pointer: ${state.traceability.path}`] : []),
    ...(summary ? [`- Summary: total=${summary.total} current=${summary.current} stale=${summary.stale} tombstoned=${summary.tombstoned}`] : []),
    ...(trace.blocker ? [`- Blocker: ${trace.blocker.code} (${trace.blocker.step})`] : []),
    "",
  ];
  const projection = [
    "---", "dev_flow:", "  schema_version: 1", `  feature_id: ${state.featureId}`, `  route: ${state.route}`, "  kind: status", "  generated: true", "---", "",
    "# Dev Flow Status", "", `- Revision: ${revision}`, `- Lifecycle: ${state.lifecycle}`, `- Route: ${state.route}`, `- Logic complete: ${state.logicComplete}`, "", "## Steps", "",
    ...routeDefinitionForFeature(state.route, state.workflowCapabilities).orderedSteps.map((step) => `- ${step}: ${state.steps[step]?.status ?? "pending"}`), "",
    ...traceLines,
  ].join("\n");
  const contents = `${projection}\n`;
  const file = path.join(features(root), state.featureId, status.path);
  state.artifacts.status = { ...status, sha256: createHash("sha256").update(contents).digest("hex") };
  return async () => { await writeFile(file, contents); };
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
export async function readState(root: string, featureId: string): Promise<FeatureState> {
  try {
    const state: unknown = JSON.parse(await readFile(statePath(root, featureId), "utf8"));
    validateFeatureState(state);
    if ((state as FeatureState).featureId !== featureId) throw new DevFlowError("INVALID_STATE_SCHEMA", "state feature id does not match its path");
    return state;
  } catch (error) {
    if (error instanceof DevFlowError) throw error;
    if ((error as NodeJS.ErrnoException).code === "ENOENT") throw new DevFlowError("FEATURE_NOT_FOUND", `feature ${featureId} does not exist`);
    throw new DevFlowError("INVALID_STATE_SCHEMA", `feature ${featureId} state is unreadable`, {
      recoveryHint: "Run dev_flow_doctor; if corrupt, use dev_flow_recover_corrupt_feature then start a new feature",
    });
  }
}
export interface ActivePointer { featureId: string; revision: number; updatedAt?: string }
export async function readActive(root: string): Promise<ActivePointer | undefined> {
  let raw: string;
  try { raw = await readFile(activePath(root), "utf8"); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw new DevFlowError("ACTIVE_POINTER_UNREADABLE", "active.json cannot be read", { recoveryHint: "Run dev_flow_doctor and use recovery; do not start a new feature" });
  }
  try {
    const active = JSON.parse(raw) as Partial<ActivePointer>;
    if (typeof active.featureId !== "string" || !active.featureId || typeof active.revision !== "number" || !Number.isInteger(active.revision) || active.revision < 0) {
      throw new Error("invalid active pointer fields");
    }
    return { featureId: active.featureId, revision: active.revision, ...(typeof active.updatedAt === "string" ? { updatedAt: active.updatedAt } : {}) };
  } catch {
    throw new DevFlowError("ACTIVE_POINTER_UNREADABLE", "active.json is invalid", { recoveryHint: "Run dev_flow_doctor and use recovery; do not start a new feature" });
  }
}
async function appendEvent(root: string, id: string, revision: number, type: string, data: unknown): Promise<void> {
  const handle = await open(eventPath(root, id), "a");
  try { await handle.writeFile(`${JSON.stringify({ revision, type, at: new Date().toISOString(), data })}\n`); await handle.sync(); }
  finally { await handle.close(); }
}
export async function stateFileSha256(root: string, featureId: string): Promise<string> {
  const contents = await readFile(statePath(root, featureId));
  return createHash("sha256").update(contents).digest("hex");
}
export interface HostEvent { eventId: string; type: "user-prompt" | "turn-boundary" | "tool"; host: "claude" | "codex"; text?: string; at?: string; }
export async function recordHostEvent(root: string, hostEvent: HostEvent): Promise<void> {
  const active = await readActive(root); if (!active) return;
  const release = await lock(root, active.featureId, "host-event");
  try {
    const state = await readState(root, active.featureId);
    const events = await readFeatureEvents(root, active.featureId);
    const duplicate = events.some((item) => {
      const recorded = item.data as Partial<HostEvent>;
      return item.type === "host-event" && recorded.host === hostEvent.host && recorded.eventId === hostEvent.eventId;
    });
    if (!duplicate) await appendEvent(root, active.featureId, state.revision, "host-event", { ...hostEvent, at: hostEvent.at ?? new Date().toISOString() });
  }
  finally { await release(); }
}
export async function readFeatureEvents(root: string, id: string): Promise<Array<{ revision: number; type: string; at: string; data: unknown }>> {
  try { return (await readFile(eventPath(root, id), "utf8")).split("\n").filter(Boolean).map((line) => JSON.parse(line)); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return []; throw error; }
}
export interface StartFeatureOptions {
  /** Test-only fault injection. Production callers omit this. */
  fault?: (point: "before-state-commit" | "after-state-commit" | "before-event" | "before-active") => void | Promise<void>;
  snapshotFault?: (point: "before-temp-write" | "after-temp-fsync" | "after-snapshot-rename") => void | Promise<void>;
}

export async function startFeature(
  root: string,
  input: ClassificationInput & { featureId?: string; activation?: "active" | "paused"; scope?: { inScope: string[]; outOfScope: string[] }; host: "claude" | "codex" },
  options: StartFeatureOptions = {},
): Promise<FeatureState> {
  await readProjectConfig(root);
  await assertNoOpenRecovery(root);
  await assertNoOpenRollbackTransaction(root);
  const scope = validateScopeInput(input.scope);
  const id = input.featureId ?? randomUUID();
  const release = await lock(root, id, "start");
  try {
    await assertNoOpenRecovery(root);
    await assertNoOpenRollbackTransaction(root);
    const active = await readActive(root);
    const lifecycle = input.activation ?? "active";
    if (lifecycle === "active" && active) throw new DevFlowError("ACTIVE_FEATURE_CONFLICT", "an active feature already exists");
    const { classification, route } = selectRoute(input);
    const project = await readProjectConfig(root);
    const startBusinessFingerprint = await fingerprintProtectedRoots(root, project.protectedRoots);
    const deliveryBaseline = await captureDeliveryBaseline(root, project.protectedRoots);
    const directory = path.join(features(root), id);
    const existedBefore = await pathExists(directory);
    let stateCommitted = false;
    try {
      await mkdir(directory, { recursive: true });
      const workflowCapabilities = normalizeWorkflowCapabilities(SUPPORTED_WORKFLOW_CAPABILITIES);
      const state: FeatureState = {
        schemaVersion: 1, featureId: id, revision: 0, lifecycle, route, classification, scope, steps: {}, humanGates: {}, artifacts: {},
        verification: { attempts: [] }, interactions: {}, workflowCapabilities, featureCheck: {}, startBusinessFingerprint, deliveryBaseline, blockingFindings: [], logicComplete: false,
        lastUpdatedBy: { host: input.host, pluginVersion: __DEV_FLOW_VERSION__ },
      };
      if (traceEnforcementRequired(route, workflowCapabilities)) {
        const configSnapshot = await readProjectConfigSnapshot(root);
        state.traceability = await writeTraceSnapshot(
          root,
          emptyTraceabilityLedger(id, 0, configSnapshot.sha256),
          options.snapshotFault ? { fault: options.snapshotFault } : {},
        );
      }
      if (reviewEnforcementRequired(route, workflowCapabilities)) {
        state.review = await writeReviewSnapshot(root, emptyReviewLedger(id, 0));
        // Store the immutable, content-addressed projection before state.json
        // points at it. A failed write leaves this new feature uncommitted.
        await prepareReviewProjection(root, state);
      }
      validateFeatureState(state);
      await options.fault?.("before-state-commit");
      await writeAtomic(statePath(root, id), state);
      stateCommitted = true;
      // After state.json is durable, event/active are projections: failures keep the commit
      // and surface STATE_COMMITTED_PROJECTION_FAILED (same contract as mutatePrepared).
      const failures: string[] = [];
      try { await options.fault?.("after-state-commit"); } catch { failures.push("after-state-commit"); }
      try {
        await options.fault?.("before-event");
        await appendEvent(root, id, state.revision, "started", { lifecycle, route });
      } catch { failures.push("event"); }
      if (lifecycle === "active") {
        try {
          await options.fault?.("before-active");
          await writeAtomic(activePath(root), { featureId: id, revision: state.revision, updatedAt: new Date().toISOString() });
        } catch { failures.push("active"); }
      }
      if (failures.length) {
        throw new DevFlowError("STATE_COMMITTED_PROJECTION_FAILED", "state commit succeeded but one or more projections failed", {
          committed: true,
          currentRevision: state.revision,
          failedProjections: failures,
        });
      }
      return state;
    } catch (error) {
      // Pre-commit failures leave no feature dir/snapshot; post-commit projection failures keep state.json.
      if (!stateCommitted && !existedBefore) await rm(directory, { recursive: true, force: true });
      throw error;
    }
  } finally { await release(); }
}
export async function mutate(
  root: string,
  id: string,
  expectedRevision: number,
  operation: string,
  mutator: (state: FeatureState) => void | Promise<void>,
  eventData: unknown | (() => unknown) = {},
): Promise<FeatureState> {
  return mutatePrepared(root, id, expectedRevision, operation, async () => ({ mutate: mutator, eventData }));
}

export interface PreparedFeatureMutation {
  mutate: (draft: FeatureState) => void | Promise<void>;
  eventData?: unknown | (() => unknown);
  /** A lock-protected idempotent retry returns current state without a fake revision/event. */
  unchanged?: boolean;
}

export interface PreparedMutationOptions {
  fault?: (point: "before-state-commit" | "after-state-commit") => void | Promise<void>;
  /** The owning rollback transaction may commit through the open-transaction guard. */
  allowRollbackTransaction?: string;
}

export async function mutatePrepared(
  root: string,
  id: string,
  expectedRevision: number,
  operation: string,
  prepare: (current: Readonly<FeatureState>, nextStateRevision: number) => Promise<PreparedFeatureMutation>,
  options: PreparedMutationOptions = {},
): Promise<FeatureState> {
  const release = await lock(root, id, operation);
  try { return await mutatePreparedLocked(root, id, expectedRevision, operation, prepare, options); }
  finally { await release(); }
}

async function mutateLocked(
  root: string,
  id: string,
  expectedRevision: number,
  operation: string,
  mutator: (state: FeatureState) => void | Promise<void>,
  eventData: unknown | (() => unknown) = {},
): Promise<FeatureState> {
  return mutatePreparedLocked(root, id, expectedRevision, operation, async () => ({ mutate: mutator, eventData }));
}

async function mutatePreparedLocked(
  root: string,
  id: string,
  expectedRevision: number,
  operation: string,
  prepare: (current: Readonly<FeatureState>, nextStateRevision: number) => Promise<PreparedFeatureMutation>,
  options: PreparedMutationOptions = {},
): Promise<FeatureState> {
  const state = await readState(root, id);
  await assertNoOpenRollbackTransaction(root, { featureId: id, transactionId: options.allowRollbackTransaction });
  if (state.revision !== expectedRevision) throw new DevFlowError("STATE_REVISION_CONFLICT", "state revision changed", { currentRevision: state.revision });
  const prepared = await prepare(state, state.revision + 1);
  if (prepared.unchanged) return state;
  await prepared.mutate(state);
  state.revision += 1;
  // Review mutations and basis invalidations update the immutable pointer in
  // prepare(). Derive its read-only Markdown before the state CAS so a failed
  // projection cannot leave state pointing at a missing or stale artifact.
  await prepareReviewProjection(root, state);
  validateFeatureState(state);
  const writeStatus = await prepareStatusProjection(root, state, state.revision);
  await options.fault?.("before-state-commit");
  await writeAtomic(statePath(root, id), state);
  const failures: string[] = [];
  try { await options.fault?.("after-state-commit"); } catch { failures.push("after-state-commit"); }
  try { await writeStatus?.(); } catch { failures.push("status"); }
  try {
    const data = typeof prepared.eventData === "function" ? (prepared.eventData as () => unknown)() : prepared.eventData ?? {};
    await appendEvent(root, id, state.revision, operation, data);
  } catch { failures.push("event"); }
  try {
    const active = await readActive(root);
    if (active?.featureId === id && (state.lifecycle === "finalized" || state.lifecycle === "abandoned")) await rm(activePath(root), { force: true });
    else if (active?.featureId === id) await writeAtomic(activePath(root), { featureId: id, revision: state.revision, updatedAt: new Date().toISOString() });
  } catch { failures.push("active"); }
  if (failures.length) {
    throw new DevFlowError("STATE_COMMITTED_PROJECTION_FAILED", "state commit succeeded but one or more projections failed", {
      committed: true, currentRevision: state.revision, failedProjections: failures,
    });
  }
  return state;
}
export async function switchActive(root: string, from: string, to: string, reason: string): Promise<FeatureState> {
  if (!reason) throw new DevFlowError("SWITCH_REASON_REQUIRED", "switch requires a reason");
  const release = await lock(root, `${from}:${to}`, "switch-active");
  try {
    await assertNoOpenRollbackTransaction(root);
    const active = await readActive(root);
    if (active?.featureId !== from) throw new DevFlowError("ACTIVE_FEATURE_CONFLICT", "source is not active");
    const source = await readState(root, from), target = await readState(root, to);
    if (target.lifecycle !== "paused") throw new DevFlowError("INVALID_LIFECYCLE", "target must be paused");
    source.lifecycle = "paused"; source.revision++; target.lifecycle = "active"; target.revision++;
    await writeAtomic(statePath(root, from), source); await writeAtomic(statePath(root, to), target);
    await appendEvent(root, from, source.revision, "paused", { reason });
    await appendEvent(root, to, target.revision, "activated", { reason });
    await writeAtomic(activePath(root), { featureId: to, revision: target.revision, updatedAt: new Date().toISOString() });
    return target;
  } finally { await release(); }
}
export async function abandonFeature(root: string, id: string, expectedRevision: number, reason: string, userEvidence: string): Promise<FeatureState> {
  if (!reason || !userEvidence) throw new DevFlowError("ABANDON_EVIDENCE_REQUIRED", "abandon requires reason and user evidence");
  return mutate(root, id, expectedRevision, "abandoned", async (state) => {
    if (state.lifecycle === "finalized" || state.lifecycle === "abandoned") throw new DevFlowError("INVALID_LIFECYCLE", "terminal feature cannot be abandoned");
    state.lifecycle = "abandoned";
  }, { reason, userEvidence });
}

type RecoveryPhase = "prepared" | "directory-moved" | "active-cleared" | "completed";
interface RecoveryTransaction {
  schemaVersion: 1;
  transactionId: string;
  phase: RecoveryPhase;
  featureId: string;
  stateSha256: string;
  recoveredTo: string;
  reason: string;
  userEvidence: string;
  host: "claude" | "codex";
  at: string;
  activeSha256?: string;
  completedAt?: string;
}
function isRecoveryPhase(value: unknown): value is RecoveryPhase {
  return value === "prepared" || value === "directory-moved" || value === "active-cleared" || value === "completed";
}
function validateRecoveryTransaction(value: unknown): asserts value is RecoveryTransaction {
  const transaction = value as Partial<RecoveryTransaction>;
  if (transaction?.schemaVersion !== 1 || typeof transaction.transactionId !== "string" || !transaction.transactionId
    || !isRecoveryPhase(transaction.phase) || typeof transaction.featureId !== "string" || !transaction.featureId
    || typeof transaction.stateSha256 !== "string" || !transaction.stateSha256 || typeof transaction.recoveredTo !== "string"
    || !path.isAbsolute(transaction.recoveredTo) || typeof transaction.reason !== "string" || typeof transaction.userEvidence !== "string"
    || (transaction.host !== "claude" && transaction.host !== "codex") || typeof transaction.at !== "string"
    || (transaction.activeSha256 !== undefined && typeof transaction.activeSha256 !== "string")) {
    throw new DevFlowError("RECOVERY_TRANSACTION_UNREADABLE", "recovery journal is invalid", {
      recoveryHint: "Run dev_flow_doctor; do not start a new feature or hand-edit .dev-flow",
    });
  }
  if (path.basename(transaction.featureId) !== transaction.featureId || transaction.featureId === "." || transaction.featureId === "..") {
    throw new DevFlowError("RECOVERY_TRANSACTION_UNREADABLE", "recovery journal has an unsafe feature id", { recoveryHint: "Run dev_flow_doctor; recovery remains fail-closed" });
  }
}
function validateRecoveryLocation(root: string, transaction: RecoveryTransaction): void {
  const recoveredRoot = path.join(devFlow(root), "recovered");
  const relative = path.relative(recoveredRoot, transaction.recoveredTo);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative) || path.basename(relative) !== relative) {
    throw new DevFlowError("RECOVERY_TRANSACTION_UNREADABLE", "recovery journal points outside the recovered directory", {
      recoveryHint: "Run dev_flow_doctor; do not start a new feature or hand-edit .dev-flow",
    });
  }
}
export async function readRecoveryTransaction(root: string): Promise<RecoveryTransaction | undefined> {
  let raw: string;
  try { raw = await readFile(recoveryTxnPath(root), "utf8"); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw new DevFlowError("RECOVERY_TRANSACTION_UNREADABLE", "recovery journal cannot be read", { recoveryHint: "Run dev_flow_doctor; do not start a new feature" });
  }
  try { const transaction: unknown = JSON.parse(raw); validateRecoveryTransaction(transaction); validateRecoveryLocation(root, transaction); return transaction; }
  catch (error) {
    if (error instanceof DevFlowError) throw error;
    throw new DevFlowError("RECOVERY_TRANSACTION_UNREADABLE", "recovery journal is not valid JSON", { recoveryHint: "Run dev_flow_doctor; do not start a new feature" });
  }
}
async function assertNoOpenRecovery(root: string): Promise<void> {
  const transaction = await readRecoveryTransaction(root);
  if (transaction) throw new DevFlowError("RECOVERY_TRANSACTION_OPEN", "resume the existing recovery before starting a feature", {
    featureId: transaction.featureId,
    phase: transaction.phase,
    recoveryHint: "Call dev_flow_recover_corrupt_feature again with the doctor-reported feature and digest",
  });
}
async function pathExists(file: string): Promise<boolean> {
  try { await access(file); return true; } catch { return false; }
}
async function fileSha256(file: string): Promise<string> {
  return createHash("sha256").update(await readFile(file)).digest("hex");
}
async function updateRecoveryTransaction(root: string, transaction: RecoveryTransaction, phase: RecoveryPhase): Promise<RecoveryTransaction> {
  const next = { ...transaction, phase, ...(phase === "completed" ? { completedAt: new Date().toISOString() } : {}) };
  await writeAtomic(recoveryTxnPath(root), next);
  return next;
}
async function recoveryEventExists(root: string, transactionId: string): Promise<boolean> {
  try {
    return (await readFile(recoveryEventsPath(root), "utf8")).split("\n").filter(Boolean).some((line) => {
      try { return (JSON.parse(line) as { transactionId?: string }).transactionId === transactionId; }
      catch { throw new DevFlowError("RECOVERY_EVENTS_UNREADABLE", "recovery audit log is invalid", { recoveryHint: "Run dev_flow_doctor; recovery remains fail-closed" }); }
    });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}
async function appendRecoveryEvent(root: string, transaction: RecoveryTransaction): Promise<void> {
  if (await recoveryEventExists(root, transaction.transactionId)) return;
  const handle = await open(recoveryEventsPath(root), "a");
  try { await handle.writeFile(`${JSON.stringify({ ...transaction, phase: "completed", completedAt: new Date().toISOString() })}\n`); await handle.sync(); }
  finally { await handle.close(); }
}
async function resumeRecovery(root: string, transaction: RecoveryTransaction): Promise<{ recoveredTo: string; featureId: string; stateSha256: string }> {
  const sourceDir = path.join(features(root), transaction.featureId);
  if (transaction.phase === "prepared") {
    const [sourceExists, recoveredExists] = await Promise.all([pathExists(sourceDir), pathExists(transaction.recoveredTo)]);
    if (sourceExists === recoveredExists) throw new DevFlowError("RECOVERY_TRANSACTION_INCONSISTENT", "cannot safely determine feature-directory recovery stage", { recoveryHint: "Run dev_flow_doctor; do not start a new feature" });
    if (sourceExists) await rename(sourceDir, transaction.recoveredTo);
    transaction = await updateRecoveryTransaction(root, transaction, "directory-moved");
  }
  if (transaction.phase === "directory-moved") {
    if (transaction.activeSha256) {
      if (await pathExists(activePath(root))) {
        if (await fileSha256(activePath(root)) !== transaction.activeSha256) {
          throw new DevFlowError("RECOVERY_POINTER_DIGEST_MISMATCH", "active pointer changed during recovery", { recoveryHint: "Run dev_flow_doctor; recovery remains fail-closed" });
        }
        await rename(activePath(root), path.join(transaction.recoveredTo, "active.json"));
      }
    } else {
      const active = await readActive(root);
      if (active && active.featureId !== transaction.featureId) {
        throw new DevFlowError("RECOVERY_TRANSACTION_INCONSISTENT", "active pointer changed during recovery", { recoveryHint: "Run dev_flow_doctor; do not start a new feature" });
      }
      if (active?.featureId === transaction.featureId) await rm(activePath(root), { force: true });
    }
    transaction = await updateRecoveryTransaction(root, transaction, "active-cleared");
  }
  if (transaction.phase === "active-cleared") {
    await appendRecoveryEvent(root, transaction);
    transaction = await updateRecoveryTransaction(root, transaction, "completed");
  }
  if (transaction.phase === "completed") await rm(recoveryTxnPath(root), { force: true });
  return { recoveredTo: transaction.recoveredTo, featureId: transaction.featureId, stateSha256: transaction.stateSha256 };
}

// ─── Rollback transaction journal ────────────────────────────────────────────

export type RollbackTransactionPhase = "prepared" | "backing-up" | "rolling-back" | "verifying" | "committed" | "compensating" | "compensated";
const rollbackTransactionPhases = new Set<RollbackTransactionPhase>(["prepared", "backing-up", "rolling-back", "verifying", "committed", "compensating", "compensated"]);

export interface RollbackTransactionFileAction {
  action: "restore" | "delete";
  path: string;
  blobSha256?: string;
  mode?: string;
}

/** Resumable journal for checkpoint rollback execution; mirrors policy/rollback-transaction.schema.json. */
export interface RollbackTransaction {
  schemaVersion: 1;
  transactionId: string;
  featureId: string;
  phase: RollbackTransactionPhase;
  targetCheckpointId: string;
  targetUnitId: string;
  undoOrder: string[];
  undoCheckpoints?: string[];
  previewBasisHash: string;
  stateRevision: number;
  backupDirectory: string;
  nextFileIndex: number;
  filePlan: RollbackTransactionFileAction[];
  verificationAttemptIds: string[];
  projectConfigSha256: string;
  startedAt: string;
  completedAt?: string;
  error?: string;
}

function isSha256(value: unknown): value is string {
  return typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
}

function validateRollbackTransaction(value: unknown): asserts value is RollbackTransaction {
  const transaction = value as Partial<RollbackTransaction>;
  const validPlan = Array.isArray(transaction?.filePlan) && transaction.filePlan.every((action) => {
    const candidate = action as Partial<RollbackTransactionFileAction> | undefined;
    if (!candidate || (candidate.action !== "restore" && candidate.action !== "delete")
      || typeof candidate.path !== "string" || !candidate.path) return false;
    if (candidate.action === "restore" && (!isSha256(candidate.blobSha256) || typeof candidate.mode !== "string" || !/^[0-7]{3,4}$/.test(candidate.mode))) return false;
    if (candidate.blobSha256 !== undefined && !isSha256(candidate.blobSha256)) return false;
    if (candidate.mode !== undefined && (typeof candidate.mode !== "string" || !/^[0-7]{3,4}$/.test(candidate.mode))) return false;
    return true;
  });
  if (transaction?.schemaVersion !== 1 || typeof transaction.transactionId !== "string" || !transaction.transactionId
    || typeof transaction.featureId !== "string" || !transaction.featureId
    || !rollbackTransactionPhases.has(transaction.phase as RollbackTransactionPhase)
    || typeof transaction.targetCheckpointId !== "string" || !/^CP-[0-9]{3,}$/.test(transaction.targetCheckpointId)
    || typeof transaction.targetUnitId !== "string" || !/^RU-[0-9]{3,}$/.test(transaction.targetUnitId)
    || !Array.isArray(transaction.undoOrder) || transaction.undoOrder.length === 0 || !transaction.undoOrder.every((unitId) => typeof unitId === "string" && /^RU-[0-9]{3,}$/.test(unitId))
    || (transaction.undoCheckpoints !== undefined && (!Array.isArray(transaction.undoCheckpoints) || !transaction.undoCheckpoints.every((id) => typeof id === "string" && /^CP-[0-9]{3,}$/.test(id))))
    || !isSha256(transaction.previewBasisHash) || !isSha256(transaction.projectConfigSha256)
    || !Number.isInteger(transaction.stateRevision) || (transaction.stateRevision ?? -1) < 0
    || typeof transaction.backupDirectory !== "string" || !/^checkpoints\/recovery\/[^/]+$/.test(transaction.backupDirectory)
    || !Number.isInteger(transaction.nextFileIndex) || (transaction.nextFileIndex ?? -1) < 0
    || !validPlan
    || !Array.isArray(transaction.verificationAttemptIds) || !transaction.verificationAttemptIds.every((id) => typeof id === "string" && id.length > 0)
    || typeof transaction.startedAt !== "string"
    || (transaction.completedAt !== undefined && typeof transaction.completedAt !== "string")
    || (transaction.error !== undefined && typeof transaction.error !== "string")) {
    throw new DevFlowError("ROLLBACK_TRANSACTION_UNREADABLE", "rollback transaction journal is invalid", {
      recoveryHint: "Run dev_flow_doctor; the workspace may be mid-rollback — do not hand-edit .dev-flow",
    });
  }
}

/** A journal is fully finished only at a terminal phase with cleanup recorded. */
export function rollbackTransactionFinished(transaction: RollbackTransaction): boolean {
  return (transaction.phase === "committed" || transaction.phase === "compensated") && typeof transaction.completedAt === "string";
}

export async function readRollbackTransaction(root: string, featureId: string): Promise<RollbackTransaction | undefined> {
  let raw: string;
  try { raw = await readFile(rollbackTxnPath(root, featureId), "utf8"); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw new DevFlowError("ROLLBACK_TRANSACTION_UNREADABLE", "rollback transaction journal cannot be read", {
      recoveryHint: "Run dev_flow_doctor; the workspace may be mid-rollback — do not hand-edit .dev-flow",
    });
  }
  let parsed: unknown;
  try { parsed = JSON.parse(raw); }
  catch {
    throw new DevFlowError("ROLLBACK_TRANSACTION_UNREADABLE", "rollback transaction journal is not valid JSON", {
      recoveryHint: "Run dev_flow_doctor; the workspace may be mid-rollback — do not hand-edit .dev-flow",
    });
  }
  validateRollbackTransaction(parsed);
  if ((parsed as RollbackTransaction).featureId !== featureId) {
    throw new DevFlowError("ROLLBACK_TRANSACTION_UNREADABLE", "rollback transaction journal feature id does not match its path", {
      recoveryHint: "Run dev_flow_doctor; the workspace may be mid-rollback — do not hand-edit .dev-flow",
    });
  }
  return parsed;
}

export async function writeRollbackTransaction(root: string, featureId: string, transaction: RollbackTransaction): Promise<void> {
  validateRollbackTransaction(transaction);
  if (transaction.featureId !== featureId) {
    throw new DevFlowError("ROLLBACK_TRANSACTION_UNREADABLE", "rollback transaction journal feature id does not match its path");
  }
  await writeAtomic(rollbackTxnPath(root, featureId), transaction);
}

/**
 * Fail-closed mutation guard: an open rollback journal on ANY feature blocks
 * every feature mutation — the plan requires that any open transaction blocks
 * other feature mutations, because the rollback rewrites the shared workspace.
 * The owning transaction commits through via allowTransactionId on its own
 * feature; unreadable journals propagate ROLLBACK_TRANSACTION_UNREADABLE.
 * Reads stay available for status/doctor.
 */
async function assertNoOpenRollbackTransaction(root: string, allow?: { featureId?: string; transactionId?: string }): Promise<void> {
  let entries;
  try { entries = await readdir(features(root), { withFileTypes: true }); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
    throw error;
  }
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const transaction = await readRollbackTransaction(root, entry.name);
    if (!transaction || rollbackTransactionFinished(transaction)) continue;
    if (allow?.featureId === entry.name && allow.transactionId !== undefined && allow.transactionId === transaction.transactionId) continue;
    throw new DevFlowError("ROLLBACK_TRANSACTION_OPEN", "a rollback transaction is open", {
      transactionId: transaction.transactionId,
      featureId: entry.name,
      phase: transaction.phase,
      recoveryHint: `Resume the rollback transaction for feature ${entry.name} with the same input before mutating features`,
    });
  }
}

/**
 * Atomically plant a prepared rollback journal under the project state lock:
 * scan every open journal, re-check the feature revision, then write. This is
 * the only entry that creates a fresh journal — concurrent hosts cannot both
 * pass the open-transaction check and land different journals.
 */
export async function prepareRollbackTransaction(
  root: string,
  featureId: string,
  expectedRevision: number,
  transaction: RollbackTransaction,
): Promise<RollbackTransaction> {
  if (transaction.featureId !== featureId) {
    throw new DevFlowError("ROLLBACK_TRANSACTION_UNREADABLE", "rollback transaction journal feature id does not match its path");
  }
  if (transaction.phase !== "prepared") {
    throw new DevFlowError("ROLLBACK_TRANSACTION_UNREADABLE", "prepareRollbackTransaction only accepts phase prepared");
  }
  if (transaction.stateRevision !== expectedRevision) {
    throw new DevFlowError("STATE_REVISION_CONFLICT", "state revision changed", { currentRevision: transaction.stateRevision });
  }
  const release = await lock(root, featureId, "prepare-rollback-transaction");
  try {
    await assertNoOpenRollbackTransaction(root);
    const state = await readState(root, featureId);
    if (state.revision !== expectedRevision) {
      throw new DevFlowError("STATE_REVISION_CONFLICT", "state revision changed", { currentRevision: state.revision });
    }
    // Finished journals are replaced; an open journal for this feature would
    // already have been rejected by the project-wide scan above.
    await writeRollbackTransaction(root, featureId, transaction);
    return transaction;
  } finally {
    await release();
  }
}

/** A remote drive lease must renew within this window or it may be reclaimed. */
const ROLLBACK_DRIVE_LEASE_STALE_MS = 30_000;
const ROLLBACK_DRIVE_LEASE_HEARTBEAT_MS = 10_000;

export interface RollbackDriveLease {
  schemaVersion: 1;
  transactionId: string;
  featureId: string;
  ownerId: string;
  pid: number;
  hostname: string;
  acquiredAt: string;
  /** Last owner-authenticated renewal. Older leases may only have acquiredAt. */
  heartbeatAt?: string;
}

function driveLeasePath(root: string, featureId: string, transactionId: string): string {
  // The sidecar is the current-version fencing token. It is paired with the
  // legacy in-directory lease below for the whole open-transaction lifetime.
  return path.join(features(root), featureId, "checkpoints", "recovery", `${transactionId}-drive-lease.json`);
}

/**
 * Older hosts only read this in-directory lease. New hosts therefore mirror
 * their lease here until completedAt is durable; a sidecar-only lease would be
 * invisible to an older host and permit two concurrent transaction drivers.
 */
function legacyDriveLeasePath(root: string, featureId: string, transactionId: string): string {
  return path.join(features(root), featureId, "checkpoints", "recovery", transactionId, "drive-lease.json");
}

/** Read a lease from a specific file path.  Returns undefined for ENOENT,
 *  throws ROLLBACK_TRANSACTION_UNREADABLE for other I/O errors. */
async function readLeaseAt(leaseFile: string, transactionId: string): Promise<RollbackDriveLease | undefined> {
  try {
    const raw = await readFile(leaseFile, "utf8");
    return JSON.parse(raw) as RollbackDriveLease;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw new DevFlowError("ROLLBACK_TRANSACTION_UNREADABLE", "rollback drive lease is unreadable", {
      transactionId,
      recoveryHint: "Run dev_flow_doctor; do not hand-edit the drive lease",
    });
  }
}

/** Both lease locations are read independently: any fresh lease is authoritative. */
async function readDriveLeases(
  root: string,
  featureId: string,
  transactionId: string,
): Promise<{ sidecar?: RollbackDriveLease; legacy?: RollbackDriveLease }> {
  const [sidecar, legacy] = await Promise.all([
    readLeaseAt(driveLeasePath(root, featureId, transactionId), transactionId),
    readLeaseAt(legacyDriveLeasePath(root, featureId, transactionId), transactionId),
  ]);
  return { ...(sidecar ? { sidecar } : {}), ...(legacy ? { legacy } : {}) };
}

/**
 * New hosts publish to both locations. The legacy write comes first so a host
 * that knows only the old path never observes an unlocked active transaction.
 * Calls happen under the shared project lock, making the pair a single claim
 * protocol for current and older binaries.
 */
async function writeDriveLeasePair(
  root: string,
  featureId: string,
  transactionId: string,
  lease: RollbackDriveLease,
): Promise<void> {
  const legacyFile = legacyDriveLeasePath(root, featureId, transactionId);
  const sidecarFile = driveLeasePath(root, featureId, transactionId);
  await mkdir(path.dirname(legacyFile), { recursive: true });
  await mkdir(path.dirname(sidecarFile), { recursive: true });
  await writeAtomic(legacyFile, lease);
  await writeAtomic(sidecarFile, lease);
}

function isProcessAlive(pid: number, ownerHostname: string): boolean {
  if (ownerHostname !== hostname()) return true; // different host: assume live (fail closed until stale)
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function leaseHeartbeatAt(lease: RollbackDriveLease): number {
  const timestamp = Date.parse(lease.heartbeatAt ?? lease.acquiredAt);
  return Number.isFinite(timestamp) ? timestamp : Number.NaN;
}

function activeLease(lease: RollbackDriveLease): boolean {
  const heartbeatAt = leaseHeartbeatAt(lease);
  const live = Number.isFinite(heartbeatAt) && isProcessAlive(lease.pid, lease.hostname);
  const stale = !Number.isFinite(heartbeatAt) || Date.now() - heartbeatAt > ROLLBACK_DRIVE_LEASE_STALE_MS;
  return live && !stale;
}

function leaseBusyError(featureId: string, transactionId: string, lease: RollbackDriveLease): DevFlowError {
  return new DevFlowError("ROLLBACK_TRANSACTION_BUSY", "another host is already driving this rollback transaction", {
    transactionId,
    featureId,
    ownerId: lease.ownerId,
    pid: lease.pid,
    hostname: lease.hostname,
    recoveryHint: "Wait for the other host to finish, or resume after its process exits and the lease ages out",
  });
}

/**
 * Claim exclusive ownership of driving an open rollback journal. Held only for
 * the duration of driveRollbackTransaction (not the whole verification wait
 * via the project lock — the lease file is the mutex). Concurrent resumes get
 * ROLLBACK_TRANSACTION_BUSY while the owner is live.
 */
export async function claimRollbackDriveLease(
  root: string,
  featureId: string,
  transactionId: string,
): Promise<RollbackDriveLease> {
  const release = await lock(root, featureId, "claim-rollback-drive");
  try {
    const journal = await readRollbackTransaction(root, featureId);
    if (!journal || rollbackTransactionFinished(journal)) {
      throw new DevFlowError("ROLLBACK_TRANSACTION_MISMATCH", "no open rollback transaction to drive", {
        featureId,
        transactionId,
      });
    }
    if (journal.transactionId !== transactionId) {
      throw new DevFlowError("ROLLBACK_TRANSACTION_MISMATCH", "rollback transaction id does not match the open journal", {
        openTransactionId: journal.transactionId,
        transactionId,
      });
    }
    // Every fresh lease is authoritative. This includes the legacy mirror so
    // an old host and a new host cannot independently claim the same journal.
    const leases = await readDriveLeases(root, featureId, transactionId);
    for (const existing of [leases.sidecar, leases.legacy]) {
      if (existing && activeLease(existing)) {
        throw leaseBusyError(featureId, transactionId, existing);
      }
    }
    const lease: RollbackDriveLease = {
      schemaVersion: 1,
      transactionId,
      featureId,
      ownerId: randomUUID(),
      pid: process.pid,
      hostname: hostname(),
      acquiredAt: new Date().toISOString(),
      heartbeatAt: new Date().toISOString(),
    };
    await writeDriveLeasePair(root, featureId, transactionId, lease);
    return lease;
  } finally {
    await release();
  }
}

/** Refreshes a lease only when the caller still owns its fencing token. */
export async function renewRollbackDriveLease(
  root: string,
  featureId: string,
  lease: RollbackDriveLease,
): Promise<void> {
  const release = await lock(root, featureId, "renew-rollback-drive");
  try {
    const leases = await readDriveLeases(root, featureId, lease.transactionId);
    const existing = leases.sidecar ?? leases.legacy;
    if (!existing) {
      throw new DevFlowError("ROLLBACK_TRANSACTION_MISMATCH", "rollback drive lease disappeared while being renewed", {
        transactionId: lease.transactionId,
      });
    }
    for (const candidate of [leases.sidecar, leases.legacy]) {
      if (candidate && candidate.ownerId !== lease.ownerId) {
        throw leaseBusyError(featureId, lease.transactionId, candidate);
      }
    }
    const renewed: RollbackDriveLease = { ...existing, heartbeatAt: new Date().toISOString() };
    await writeDriveLeasePair(root, featureId, lease.transactionId, renewed);
  } finally {
    await release();
  }
}

export interface RollbackDriveLeaseHeartbeat {
  assertOwned(): void;
  stop(): Promise<void>;
}

/**
 * Keeps a remote-visible lease fresh while long file operations or verification
 * commands run. A renewal failure is surfaced to the driver before it performs
 * a further transaction transition.
 */
export function maintainRollbackDriveLease(
  root: string,
  featureId: string,
  lease: RollbackDriveLease,
): RollbackDriveLeaseHeartbeat {
  let stopped = false;
  let inFlight: Promise<void> | undefined;
  let failure: unknown;
  const renew = (): Promise<void> => {
    if (stopped || failure) return inFlight ?? Promise.resolve();
    if (!inFlight) {
      inFlight = renewRollbackDriveLease(root, featureId, lease)
        .catch((error) => { failure = error; })
        .finally(() => { inFlight = undefined; });
    }
    return inFlight;
  };
  const interval = setInterval(() => { void renew(); }, ROLLBACK_DRIVE_LEASE_HEARTBEAT_MS);
  interval.unref();
  return {
    assertOwned(): void {
      if (!failure) return;
      if (failure instanceof DevFlowError && failure.code === "ROLLBACK_TRANSACTION_BUSY") throw failure;
      throw new DevFlowError("ROLLBACK_TRANSACTION_BUSY", "rollback drive lease could not be renewed; refusing to continue this driver", {
        transactionId: lease.transactionId,
        cause: failure instanceof DevFlowError ? failure.code : String(failure),
        recoveryHint: "Wait for the current driver to finish, then resume the open rollback transaction",
      });
    },
    async stop(): Promise<void> {
      stopped = true;
      clearInterval(interval);
      await inFlight;
    },
  };
}

/** Release the drive lease only if this owner still holds it. */
export async function releaseRollbackDriveLease(
  root: string,
  featureId: string,
  lease: RollbackDriveLease,
): Promise<void> {
  const release = await lock(root, featureId, "release-rollback-drive");
  try {
    const sidecarFile = driveLeasePath(root, featureId, lease.transactionId);
    const legacyFile = legacyDriveLeasePath(root, featureId, lease.transactionId);
    let sidecar: RollbackDriveLease | undefined;
    try {
      sidecar = JSON.parse(await readFile(sidecarFile, "utf8")) as RollbackDriveLease;
    } catch {
      // Best-effort release continues with the legacy mirror.
    }
    if (sidecar?.ownerId === lease.ownerId) {
      await rm(sidecarFile, { force: true });
    }
    try {
      const legacyExisting = JSON.parse(await readFile(legacyFile, "utf8")) as RollbackDriveLease;
      if (legacyExisting?.ownerId === lease.ownerId) {
        await rm(legacyFile, { force: true });
      }
    } catch {
      // ENOENT or unreadable: nothing to clean up.
    }
    // After the terminal marker is durable, both mirrors are gone and this
    // otherwise-empty directory can disappear. During a resumable failure it
    // still contains the backup, so rmdir safely leaves it in place.
    try { await rmdir(path.dirname(legacyFile)); } catch { /* backup is still present or another owner holds the lease */ }
  } finally {
    await release();
  }
}

/** Append one audit record to the feature event ledger (rollback attempts, transaction milestones). */
export async function appendFeatureEvent(root: string, id: string, revision: number, type: string, data: unknown): Promise<void> {
  await appendEvent(root, id, revision, type, data);
}

export async function recoverCorruptFeature(root: string, input: {
  featureId: string; stateSha256: string; activeSha256?: string; action: "abandon"; reason: string; userEvidence: string; host: "claude" | "codex";
}): Promise<{ recoveredTo: string; featureId: string; stateSha256: string }> {
  if (input.action !== "abandon") throw new DevFlowError("INVALID_RECOVERY_ACTION", "only abandon is supported in 1.3");
  if (!input.reason || !input.userEvidence) throw new DevFlowError("RECOVERY_EVIDENCE_REQUIRED", "reason and userEvidence are required");
  if (path.basename(input.featureId) !== input.featureId || input.featureId === "." || input.featureId === "..") throw new DevFlowError("INVALID_FEATURE_ID", "recovery featureId must name one feature directory");
  const release = await lock(root, input.featureId, "recover-corrupt");
  try {
    // Fail closed while any rollback journal is open: recovery moves the whole
    // feature directory (journal + backup evidence). Resume the rollback first.
    await assertNoOpenRollbackTransaction(root);
    const openTransaction = await readRecoveryTransaction(root);
    if (openTransaction) {
      if (openTransaction.featureId !== input.featureId || openTransaction.stateSha256 !== input.stateSha256
        || openTransaction.activeSha256 !== input.activeSha256) {
        throw new DevFlowError("RECOVERY_TRANSACTION_MISMATCH", "recovery input does not match the open journal", { recoveryHint: "Use the doctor-reported feature and digest to resume" });
      }
      return resumeRecovery(root, openTransaction);
    }

    let pointerRecovery = false;
    try {
      const active = await readActive(root);
      if (!active || active.featureId !== input.featureId) throw new DevFlowError("RECOVERY_NOT_ACTIVE", "featureId must be the active feature", { recoveryHint: "Run dev_flow_doctor and recover only the active corrupt feature" });
    } catch (error) {
      if (!(error instanceof DevFlowError) || error.code !== "ACTIVE_POINTER_UNREADABLE") throw error;
      if (!input.activeSha256) throw new DevFlowError("RECOVERY_POINTER_DIGEST_REQUIRED", "activeSha256 is required for a corrupt active pointer", { recoveryHint: "Use the active pointer digest from dev_flow_doctor" });
      const currentPointerDigest = await fileSha256(activePath(root));
      if (currentPointerDigest !== input.activeSha256) throw new DevFlowError("RECOVERY_POINTER_DIGEST_MISMATCH", "activeSha256 does not match active.json", { currentDigest: currentPointerDigest, recoveryHint: "Re-run dev_flow_doctor" });
      pointerRecovery = true;
    }

    let digest: string;
    try { digest = await stateFileSha256(root, input.featureId); }
    catch { throw new DevFlowError("RECOVERY_STATE_MISSING", "feature state file is missing", { recoveryHint: "Run dev_flow_doctor; recovery remains fail-closed" }); }
    if (digest !== input.stateSha256) throw new DevFlowError("RECOVERY_DIGEST_MISMATCH", "stateSha256 does not match current corrupt state", { currentDigest: digest, recoveryHint: "Re-run dev_flow_doctor and use the reported stateSha256" });
    try {
      const state = await readState(root, input.featureId);
      if (!pointerRecovery || state.lifecycle !== "active") throw new DevFlowError("RECOVERY_STATE_VALID", "feature state is readable; use abandon instead of recovery");
    } catch (error) {
      if (error instanceof DevFlowError && error.code === "RECOVERY_STATE_VALID") throw error;
      // A corrupt feature state is the ordinary recovery path.
    }

    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const recoveredDir = path.join(devFlow(root), "recovered", `${input.featureId}-${timestamp}`);
    await mkdir(path.join(devFlow(root), "recovered"), { recursive: true });
    const prepared: RecoveryTransaction = {
      schemaVersion: 1, transactionId: randomUUID(), phase: "prepared", featureId: input.featureId, stateSha256: digest, recoveredTo: recoveredDir,
      reason: input.reason, userEvidence: input.userEvidence, host: input.host, at: new Date().toISOString(),
      ...(pointerRecovery ? { activeSha256: input.activeSha256 } : {}),
    };
    await writeAtomic(recoveryTxnPath(root), prepared);
    return resumeRecovery(root, prepared);
  } finally { await release(); }
}

const levelRank: Record<string, number> = { XS: 0, S: 1, M: 2, L: 3 };
const topologyRank: Record<string, number> = { local: 0, "shared-contract": 1, "multi-chain": 2, "coordinated-rollback": 3 };
const sameRisk = (a: string[], b: string[]) => a.length === b.length && [...a].sort().every((value, index) => value === [...b].sort()[index]);

function isDowngrade(before: Classification, after: Classification): boolean {
  const riskRemoved = before.riskLabels.some((risk) => !after.riskLabels.includes(risk));
  return levelRank[after.level] < levelRank[before.level]
    || topologyRank[after.topology] < topologyRank[before.topology]
    || (before.execution === "standard" && after.execution === "light")
    || riskRemoved;
}

function applyRouteTransition(state: FeatureState, selected: { classification: Classification; route: RouteId }) {
  const previousRoute = state.route;
  const previousDefinition = routeDefinitionForFeature(previousRoute, state.workflowCapabilities);
  const nextDefinition = routeDefinitionForFeature(selected.route, state.workflowCapabilities);
  const previousArtifacts = new Set([...previousDefinition.requiredArtifacts, ...(previousDefinition.generatedArtifacts ?? [])]);
  const nextArtifacts = new Set([...nextDefinition.requiredArtifacts, ...(nextDefinition.generatedArtifacts ?? [])]);
  const retainedArtifacts = Object.fromEntries(Object.entries(state.artifacts).filter(([kind]) =>
    previousArtifacts.has(kind) && nextArtifacts.has(kind)));
  const retainedSteps: FeatureState["steps"] = {};
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

async function implementationApprovalWasPresented(root: string, id: string): Promise<boolean> {
  let events: Array<{ revision: number; type: string; at: string; data: unknown }>;
  try { events = await readFeatureEvents(root, id); }
  catch {
    throw new DevFlowError("RECLASSIFICATION_HISTORY_UNREADABLE", "cannot safely read gate history for downgrade", {
      recoveryHint: "Finish the current standard route or abandon and restart; do not downgrade with unreadable history",
    });
  }
  for (const event of events) {
    if (event.type !== "gate-presented" && event.type !== "gate-confirmed") continue;
    const gate = (event.data as { gate?: unknown } | undefined)?.gate;
    if (typeof gate !== "string") {
      throw new DevFlowError("RECLASSIFICATION_HISTORY_UNREADABLE", "a historical gate event has no gate identity", {
        recoveryHint: "Finish the current standard route or abandon and restart; old ambiguous gate history cannot downgrade",
      });
    }
    if (gate === "implementation_approval") return true;
  }
  return false;
}

export async function reclassifyFeature(
  root: string,
  id: string,
  expectedRevision: number,
  next: ClassificationInput,
  reason: string,
  userEvidence?: string,
): Promise<FeatureState & { reclassifyNotice?: string }> {
  if (!reason) throw new DevFlowError("RECLASSIFICATION_REASON_REQUIRED", "reclassify requires a reason");
  const release = await lock(root, id, "reclassify");
  try {
    const initial = await readState(root, id);
    if (initial.revision !== expectedRevision) throw new DevFlowError("STATE_REVISION_CONFLICT", "state revision changed", { currentRevision: initial.revision });
    const selectedAtLock = selectRoute(next);
    const historicalApproval = isDowngrade(initial.classification, selectedAtLock.classification)
      ? await implementationApprovalWasPresented(root, id)
      : false;
    const project = await readProjectConfig(root);
    const currentFingerprint = await fingerprintProtectedRoots(root, project.protectedRoots);
    let notice: string | undefined;
    let eventData: unknown = { reason };
    const state = await mutatePreparedLocked(root, id, expectedRevision, "reclassified", async (current, nextStateRevision) => {
    const preparedTraceability = traceEnforcementRequired(selectedAtLock.route, current.workflowCapabilities) && !current.traceability
      ? await (async () => {
        const configSnapshot = await readProjectConfigSnapshot(root);
        return writeTraceSnapshot(root, emptyTraceabilityLedger(id, nextStateRevision, configSnapshot.sha256));
      })()
      : undefined;
    const preparedReview = reviewEnforcementRequired(selectedAtLock.route, current.workflowCapabilities) && !current.review
      ? await writeReviewSnapshot(root, emptyReviewLedger(id, nextStateRevision))
      : undefined;
    const reviewInvalidation = current.review
      && (selectedAtLock.route !== current.route || JSON.stringify(selectedAtLock.classification) !== JSON.stringify(current.classification))
      ? await prepareReviewInvalidation(root, current, nextStateRevision)
      : undefined;
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
      const lessStrict = levelRank[after.level] < levelRank[before.level] || topologyRank[after.topology] < topologyRank[before.topology] || (before.execution === "standard" && after.execution === "light");
      if (lessStrict) throw new DevFlowError("RECLASSIFICATION_NOT_STRICTER", "reclassification cannot lower level, topology, execution, or risk");
      const changed = selected.route !== draft.route || JSON.stringify(before) !== JSON.stringify(after);
      if (!changed) throw new DevFlowError("RECLASSIFICATION_NOT_STRICTER", "reclassification did not become stricter");
      const transition = applyRouteTransition(draft, selected);
      eventData = {
        before, after, previousRoute: transition.previousRoute, nextRoute: selected.route, reason,
        invalidatedSteps: transition.invalidatedSteps, invalidatedArtifacts: transition.invalidatedArtifacts,
      };
      return;
    }

    // Restricted standard → light only.
    if (before.level !== after.level || before.topology !== after.topology || !sameRisk(before.riskLabels, after.riskLabels)) {
      throw new DevFlowError("RECLASSIFICATION_DOWNGRADE_FORBIDDEN", "1.3 only allows same level/topology/risk standard→light", {
        recoveryHint: "Abandon and restart with a lighter classification if level must change",
      });
    }
    if (!(before.execution === "standard" && after.execution === "light")) {
      throw new DevFlowError("RECLASSIFICATION_DOWNGRADE_FORBIDDEN", "only standard→light downgrade is allowed", {
        recoveryHint: "Abandon and restart with a lighter classification, or finish the current route",
      });
    }
    if (!userEvidence) {
      throw new DevFlowError("RECLASSIFICATION_EVIDENCE_REQUIRED", "downgrade requires userEvidence with the user's exact words", {
        recoveryHint: "Pass userEvidence containing the user's request to lighten the route",
      });
    }
    if (draft.steps.implementation?.status === "satisfied") {
      throw new DevFlowError("RECLASSIFICATION_DOWNGRADE_FORBIDDEN", "implementation already satisfied", {
        recoveryHint: "Finish the current standard route or abandon and restart",
      });
    }
    const approval = draft.humanGates.implementation_approval as { status?: string } | undefined;
    if (historicalApproval || approval?.status === "pending" || approval?.status === "returned" || approval?.status === "confirmed") {
      throw new DevFlowError("RECLASSIFICATION_DOWNGRADE_FORBIDDEN", "implementation_approval already presented or confirmed", {
        recoveryHint: "Finish the current standard route or abandon and restart",
      });
    }
    if (!draft.startBusinessFingerprint) {
      throw new DevFlowError("RECLASSIFICATION_DOWNGRADE_FORBIDDEN", "missing startBusinessFingerprint baseline", {
        recoveryHint: "Old features without baseline cannot downgrade; abandon and restart",
      });
    }
    if (draft.startBusinessFingerprint !== currentFingerprint) {
      throw new DevFlowError("RECLASSIFICATION_PROTECTED_ROOTS_CHANGED", "protected roots changed since start", {
        recoveryHint: "Cannot downgrade after business files changed; finish the current standard route, or abandon and restart with a lighter classification",
      });
    }
    const transition = applyRouteTransition(draft, selected);
    eventData = {
      before, after, previousRoute: transition.previousRoute, nextRoute: selected.route, reason, userEvidence,
      invalidatedSteps: transition.invalidatedSteps, invalidatedArtifacts: transition.invalidatedArtifacts,
    };
    notice = `Route switched to ${selected.route}. Previous docs remain on disk but are no longer registered evidence. Next: run the light route steps.`;
    }, eventData: () => eventData };
    });
    return notice ? { ...state, reclassifyNotice: notice } : state;
  } finally { await release(); }
}
export function businessFingerprint(contents: string): string { return createHash("sha256").update(contents).digest("hex"); }
