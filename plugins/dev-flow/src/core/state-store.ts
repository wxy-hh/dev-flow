import { randomUUID, createHash } from "node:crypto";
import { access, mkdir, open, readFile, rename, rm, writeFile } from "node:fs/promises";
import { hostname } from "node:os";
import path from "node:path";
import { routeDefinition } from "../policy/contract.js";
import { selectRoute } from "../policy/route.js";
import type { Classification, ClassificationInput, RouteId } from "../policy/types.js";
import { DevFlowError } from "./errors.js";
import { fingerprintProtectedRoots } from "./fingerprint.js";
import { validateProjectConfig, type ProjectConfig } from "./project-config.js";

export type Lifecycle = "active" | "paused" | "finalized" | "abandoned";
export interface FeatureState {
  schemaVersion: 1; featureId: string; revision: number; lifecycle: Lifecycle; route: RouteId; classification: Classification;
  scope: { inScope: string[]; outOfScope: string[] }; steps: Record<string, { status: "pending" | "satisfied"; evidence?: unknown }>;
  humanGates: Record<string, unknown>; artifacts: Record<string, { path: string; sha256: string }>; verification: { attempts: unknown[]; satisfiedByAttemptId?: number; verifiedFingerprint?: string };
  featureCheck: { passed?: boolean; fingerprint?: string }; businessFingerprint?: string; startBusinessFingerprint?: string;
  blockingFindings: Array<{ blocking: boolean; message: string }>;
  logicComplete: boolean; lastUpdatedBy: { host: "claude" | "codex"; pluginVersion: string };
}
const lifecycles = new Set<Lifecycle>(["active", "paused", "finalized", "abandoned"]);
export function validateFeatureState(value: unknown): asserts value is FeatureState {
  const state = value as Partial<FeatureState>;
  if (state?.schemaVersion !== 1) throw new DevFlowError("UNSUPPORTED_STATE_SCHEMA", "only state schema v1 is supported");
  if (typeof state.featureId !== "string" || !state.featureId || !Number.isInteger(state.revision) || (state.revision ?? -1) < 0 || !lifecycles.has(state.lifecycle as Lifecycle) || !routeDefinition(state.route as RouteId) || !state.classification || !state.scope || !Array.isArray(state.scope.inScope) || !Array.isArray(state.scope.outOfScope) || !state.steps || !state.humanGates || !state.artifacts || !state.verification || !Array.isArray(state.verification.attempts) || !state.featureCheck || !Array.isArray(state.blockingFindings) || typeof state.logicComplete !== "boolean" || !state.lastUpdatedBy) {
    throw new DevFlowError("INVALID_STATE_SCHEMA", "state is not a valid v1 feature state");
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
  try { const state = await readState(root, active.featureId); await appendEvent(root, active.featureId, state.revision, "host-event", { ...hostEvent, at: hostEvent.at ?? new Date().toISOString() }); }
  finally { await release(); }
}
export async function readFeatureEvents(root: string, id: string): Promise<Array<{ revision: number; type: string; at: string; data: unknown }>> {
  try { return (await readFile(eventPath(root, id), "utf8")).split("\n").filter(Boolean).map((line) => JSON.parse(line)); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return []; throw error; }
}
export async function startFeature(root: string, input: ClassificationInput & { featureId?: string; activation?: "active" | "paused"; scope?: { inScope: string[]; outOfScope: string[] }; host: "claude" | "codex" }): Promise<FeatureState> {
  await readProjectConfig(root);
  await assertNoOpenRecovery(root);
  const scope = validateScopeInput(input.scope);
  const id = input.featureId ?? randomUUID();
  const release = await lock(root, id, "start");
  try {
    await assertNoOpenRecovery(root);
    const active = await readActive(root);
    const lifecycle = input.activation ?? "active";
    if (lifecycle === "active" && active) throw new DevFlowError("ACTIVE_FEATURE_CONFLICT", "an active feature already exists");
    const { classification, route } = selectRoute(input);
    const project = await readProjectConfig(root);
    const startBusinessFingerprint = await fingerprintProtectedRoots(root, project.protectedRoots);
    await mkdir(path.join(features(root), id), { recursive: true });
    const state: FeatureState = {
      schemaVersion: 1, featureId: id, revision: 0, lifecycle, route, classification, scope, steps: {}, humanGates: {}, artifacts: {},
      verification: { attempts: [] }, featureCheck: {}, startBusinessFingerprint, blockingFindings: [], logicComplete: false,
      lastUpdatedBy: { host: input.host, pluginVersion: __DEV_FLOW_VERSION__ },
    };
    await writeAtomic(statePath(root, id), state);
    await appendEvent(root, id, 0, "started", { lifecycle, route });
    if (lifecycle === "active") await writeAtomic(activePath(root), { featureId: id, revision: 0, updatedAt: new Date().toISOString() });
    return state;
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
  const release = await lock(root, id, operation);
  try { return await mutateLocked(root, id, expectedRevision, operation, mutator, eventData); }
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
  const state = await readState(root, id);
  if (state.revision !== expectedRevision) throw new DevFlowError("STATE_REVISION_CONFLICT", "state revision changed", { currentRevision: state.revision });
  await mutator(state);
  state.revision += 1;
  await writeStatusProjection(root, state, state.revision);
  await writeAtomic(statePath(root, id), state);
  const data = typeof eventData === "function" ? (eventData as () => unknown)() : eventData;
  await appendEvent(root, id, state.revision, operation, data);
  const active = await readActive(root);
  if (active?.featureId === id && (state.lifecycle === "finalized" || state.lifecycle === "abandoned")) await rm(activePath(root), { force: true });
  else if (active?.featureId === id) await writeAtomic(activePath(root), { featureId: id, revision: state.revision, updatedAt: new Date().toISOString() });
  return state;
}
export async function switchActive(root: string, from: string, to: string, reason: string): Promise<void> {
  if (!reason) throw new DevFlowError("SWITCH_REASON_REQUIRED", "switch requires a reason");
  const release = await lock(root, `${from}:${to}`, "switch-active");
  try {
    const active = await readActive(root);
    if (active?.featureId !== from) throw new DevFlowError("ACTIVE_FEATURE_CONFLICT", "source is not active");
    const source = await readState(root, from), target = await readState(root, to);
    if (target.lifecycle !== "paused") throw new DevFlowError("INVALID_LIFECYCLE", "target must be paused");
    source.lifecycle = "paused"; source.revision++; target.lifecycle = "active"; target.revision++;
    await writeAtomic(statePath(root, from), source); await writeAtomic(statePath(root, to), target);
    await appendEvent(root, from, source.revision, "paused", { reason });
    await appendEvent(root, to, target.revision, "activated", { reason });
    await writeAtomic(activePath(root), { featureId: to, revision: target.revision, updatedAt: new Date().toISOString() });
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

export async function recoverCorruptFeature(root: string, input: {
  featureId: string; stateSha256: string; activeSha256?: string; action: "abandon"; reason: string; userEvidence: string; host: "claude" | "codex";
}): Promise<{ recoveredTo: string; featureId: string; stateSha256: string }> {
  if (input.action !== "abandon") throw new DevFlowError("INVALID_RECOVERY_ACTION", "only abandon is supported in 1.3");
  if (!input.reason || !input.userEvidence) throw new DevFlowError("RECOVERY_EVIDENCE_REQUIRED", "reason and userEvidence are required");
  if (path.basename(input.featureId) !== input.featureId || input.featureId === "." || input.featureId === "..") throw new DevFlowError("INVALID_FEATURE_ID", "recovery featureId must name one feature directory");
  const release = await lock(root, input.featureId, "recover-corrupt");
  try {
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
  const retainedArtifacts = Object.fromEntries(Object.entries(state.artifacts).filter(([kind]) =>
    routeDefinition(previousRoute).requiredArtifacts.includes(kind) && routeDefinition(selected.route).requiredArtifacts.includes(kind)));
  const retainedSteps: FeatureState["steps"] = {};
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
    const state = await mutateLocked(root, id, expectedRevision, "reclassified", (draft) => {
    if (draft.lifecycle !== "active") throw new DevFlowError("INVALID_LIFECYCLE", "only an active feature can be reclassified");
    const selected = selectRoute(next);
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
    if (historicalApproval || approval?.status === "pending" || approval?.status === "confirmed") {
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
    }, () => eventData);
    return notice ? { ...state, reclassifyNotice: notice } : state;
  } finally { await release(); }
}
export function businessFingerprint(contents: string): string { return createHash("sha256").update(contents).digest("hex"); }
