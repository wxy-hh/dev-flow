import { randomUUID, createHash } from "node:crypto";
import { access, mkdir, open, readFile, rename } from "node:fs/promises";
import path from "node:path";
import { checkpointsEnforcementRequired } from "../policy/contract.js";
import {
  parseCheckpointManifest,
  pathWithinFileScope,
  type CheckpointFileRecord,
  type CheckpointManifest,
  type CheckpointVerificationAttempt,
} from "../policy/rollback.js";
import type { RollbackNode } from "../policy/traceability.js";
import { DevFlowError } from "./errors.js";
import { fingerprintProtectedRoots, snapshotProtectedRoots, type ProtectedFileSnapshot } from "./fingerprint.js";
import type { ProjectConfig, VerificationCommand } from "./project-config.js";
import { canonicalReviewValueJson } from "./review-store.js";
import { mutate, readState, type FeatureState } from "./state-store.js";
import { currentOpenStep } from "./step-order.js";
import { readProjectConfigSnapshot, readTraceability } from "./traceability-store.js";
import { runVerificationCommand } from "./verification.js";

const digest = (value: string | Buffer) => createHash("sha256").update(value).digest("hex");
const featureDirectory = (root: string, featureId: string) => path.join(root, ".dev-flow", "features", featureId);

export function blobPath(sha256: string): string {
  return `checkpoints/blobs/${sha256}`;
}

function manifestPath(checkpointId: string): string {
  return `checkpoints/manifests/${checkpointId}.json`;
}

function baselinePath(unitId: string): string {
  return `checkpoints/baselines/${unitId}.json`;
}

async function writeAtomic(file: string, contents: string | Buffer): Promise<void> {
  const temp = `${file}.${randomUUID()}.tmp`;
  const handle = await open(temp, "w");
  try {
    await handle.writeFile(contents);
    await handle.sync();
  } finally {
    await handle.close();
  }
  await rename(temp, file);
  const directory = await open(path.dirname(file), "r");
  try { await directory.sync(); } finally { await directory.close(); }
}

async function pathExists(file: string): Promise<boolean> {
  try { await access(file); return true; } catch { return false; }
}

/** Writes a content-addressed blob; identical content is stored exactly once. */
async function writeBlobIfAbsent(root: string, featureId: string, bytes: Buffer): Promise<string> {
  const sha256 = digest(bytes);
  const file = path.join(featureDirectory(root, featureId), blobPath(sha256));
  if (await pathExists(file)) return sha256;
  await mkdir(path.dirname(file), { recursive: true });
  await writeAtomic(file, bytes);
  return sha256;
}

export interface CheckpointBaseline {
  schemaVersion: 1;
  featureId: string;
  unitId: string;
  capturedAt: string;
  files: ProtectedFileSnapshot[];
}

function validateBaseline(value: unknown, unitId: string): CheckpointBaseline {
  const baseline = value as Partial<CheckpointBaseline> | undefined;
  const files = baseline?.files;
  if (!baseline || baseline.schemaVersion !== 1 || baseline.unitId !== unitId
    || typeof baseline.featureId !== "string" || typeof baseline.capturedAt !== "string"
    || !Array.isArray(files)
    || !files.every((file) => file && typeof file.path === "string"
      && /^[a-f0-9]{64}$/.test(file.sha256) && /^[0-7]{3,4}$/.test(file.mode))) {
    throw new DevFlowError("CHECKPOINT_BASELINE_INVALID", "implementation unit baseline is unreadable", { unitId });
  }
  return baseline as CheckpointBaseline;
}

/**
 * Captures the begin-time before state: every protected file's bytes become a
 * content-addressed blob and the per-file manifest is stored as the baseline.
 * Rollback needs the original bytes, which no longer exist on disk after the
 * unit's edits, so they must be preserved here.
 */
export async function captureUnitBaseline(
  root: string,
  featureId: string,
  unitId: string,
  snapshot: ProtectedFileSnapshot[],
): Promise<void> {
  for (const file of snapshot) {
    const bytes = await readFile(path.join(root, file.path));
    if (digest(bytes) !== file.sha256) {
      throw new DevFlowError("CHECKPOINT_HASH_MISMATCH", "protected files changed while capturing the unit baseline", { path: file.path });
    }
    await writeBlobIfAbsent(root, featureId, bytes);
  }
  const baseline: CheckpointBaseline = {
    schemaVersion: 1,
    featureId,
    unitId,
    capturedAt: new Date().toISOString(),
    files: snapshot,
  };
  const file = path.join(featureDirectory(root, featureId), baselinePath(unitId));
  await mkdir(path.dirname(file), { recursive: true });
  await writeAtomic(file, `${JSON.stringify(baseline, null, 2)}\n`);
}

export async function readCheckpointBaseline(root: string, featureId: string, unitId: string): Promise<CheckpointBaseline> {
  const file = path.join(featureDirectory(root, featureId), baselinePath(unitId));
  let raw: string;
  try { raw = await readFile(file, "utf8"); }
  catch { throw new DevFlowError("CHECKPOINT_BASELINE_INVALID", "implementation unit baseline is missing", { unitId }); }
  try { return validateBaseline(JSON.parse(raw), unitId); }
  catch (error) {
    if (error instanceof DevFlowError) throw error;
    throw new DevFlowError("CHECKPOINT_BASELINE_INVALID", "implementation unit baseline is unreadable", { unitId });
  }
}

function diffSnapshots(before: ProtectedFileSnapshot[], after: ProtectedFileSnapshot[]): CheckpointFileRecord[] {
  const beforeMap = new Map(before.map((file) => [file.path, file]));
  const afterMap = new Map(after.map((file) => [file.path, file]));
  const records: CheckpointFileRecord[] = [];
  const deleted: ProtectedFileSnapshot[] = [];
  const added: ProtectedFileSnapshot[] = [];
  for (const [filePath, beforeFile] of beforeMap) {
    const afterFile = afterMap.get(filePath);
    if (!afterFile) { deleted.push(beforeFile); continue; }
    if (afterFile.sha256 !== beforeFile.sha256) {
      records.push({
        path: filePath, change: "modified",
        beforeSha256: beforeFile.sha256, afterSha256: afterFile.sha256,
        beforeBlobSha256: beforeFile.sha256, afterBlobSha256: afterFile.sha256,
        beforeMode: beforeFile.mode, afterMode: afterFile.mode,
      });
    } else if (afterFile.mode !== beforeFile.mode) {
      records.push({
        path: filePath, change: "mode-changed",
        beforeSha256: beforeFile.sha256, afterSha256: afterFile.sha256,
        beforeBlobSha256: beforeFile.sha256, afterBlobSha256: afterFile.sha256,
        beforeMode: beforeFile.mode, afterMode: afterFile.mode,
      });
    }
  }
  for (const [filePath, afterFile] of afterMap) {
    if (!beforeMap.has(filePath)) added.push(afterFile);
  }
  // Rename pairing: an added file and a deleted file with the same content are
  // a rename only when the hash is unique on both sides; otherwise the pair is
  // ambiguous and stays a deterministic delete + add.
  const byHash = (files: ProtectedFileSnapshot[]) => {
    const groups = new Map<string, ProtectedFileSnapshot[]>();
    for (const file of files) groups.set(file.sha256, [...(groups.get(file.sha256) ?? []), file]);
    return groups;
  };
  const deletedByHash = byHash(deleted);
  const addedByHash = byHash(added);
  const pairedDeleted = new Set<string>();
  const pairedAdded = new Set<string>();
  for (const [hash, deletedFiles] of deletedByHash) {
    const addedFiles = addedByHash.get(hash) ?? [];
    if (deletedFiles.length === 1 && addedFiles.length === 1) {
      const from = deletedFiles[0];
      const to = addedFiles[0];
      records.push({
        path: to.path, change: "renamed", renamedFrom: from.path,
        beforeSha256: hash, afterSha256: hash, beforeBlobSha256: hash, afterBlobSha256: hash,
        beforeMode: from.mode, afterMode: to.mode,
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

function snapshotsEqual(a: ProtectedFileSnapshot[], b: ProtectedFileSnapshot[]): boolean {
  return a.length === b.length && a.every((file, index) => file.path === b[index]?.path
    && file.sha256 === b[index]?.sha256 && file.mode === b[index]?.mode);
}

function reverseRecords(records: CheckpointFileRecord[]): CheckpointFileRecord[] {
  return records.map((record) => {
    switch (record.change) {
      case "added":
        return { path: record.path, change: "deleted", beforeSha256: record.afterSha256, beforeBlobSha256: record.afterBlobSha256, beforeMode: record.afterMode };
      case "deleted":
        return { path: record.path, change: "added", afterSha256: record.beforeSha256, afterBlobSha256: record.beforeBlobSha256, afterMode: record.beforeMode };
      case "renamed":
        return {
          path: record.renamedFrom!, change: "renamed", renamedFrom: record.path,
          beforeSha256: record.afterSha256, afterSha256: record.beforeSha256,
          beforeBlobSha256: record.afterBlobSha256, afterBlobSha256: record.beforeBlobSha256,
          beforeMode: record.afterMode, afterMode: record.beforeMode,
        };
      default:
        return {
          path: record.path, change: record.change,
          beforeSha256: record.afterSha256, afterSha256: record.beforeSha256,
          beforeBlobSha256: record.afterBlobSha256, afterBlobSha256: record.beforeBlobSha256,
          beforeMode: record.afterMode, afterMode: record.beforeMode,
        };
    }
  });
}

function commandSummary(command: VerificationCommand): string {
  return [command.command, ...command.args].join(" ");
}

function currentRollbackNode(state: FeatureState, nodes: RollbackNode[], unitId: string): RollbackNode {
  const node = nodes.find((candidate) => candidate.id === unitId);
  if (!node) {
    throw new DevFlowError("IMPLEMENTATION_UNIT_UNKNOWN", "rollback unit is not part of the current trace graph", { unitId });
  }
  return node;
}

function resolveVerificationCommands(config: ProjectConfig, node: RollbackNode): VerificationCommand[] {
  return node.forwardVerification.map((commandId) => {
    const command = config.verification.commands.find((candidate) => candidate.id === commandId);
    if (!command) {
      throw new DevFlowError("TRACE_VERIFICATION_COMMAND_UNKNOWN", "rollback unit references an unknown verification command", {
        unitId: node.id,
        commandId,
      });
    }
    return command;
  });
}

export interface CheckpointOptions {
  /** Test-only fault injection. Production callers omit this. */
  fault?: (point: "before-manifest-rename" | "after-manifest-rename") => void | Promise<void>;
}

/**
 * Confirms an active unit: diffs the protected roots against the begin-time
 * baseline, enforces the unit fileScope on the authoritative file system,
 * runs forward verification, persists blobs plus the manifest, and only then
 * commits the unit transition in the same state CAS.
 */
export async function checkpointImplementationUnit(
  root: string,
  id: string,
  expectedRevision: number,
  unitId: string,
  options: CheckpointOptions = {},
): Promise<{ state: FeatureState; manifest: CheckpointManifest }> {
  const initial = await readState(root, id);
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

  const ledger = await readTraceability(root, initial);
  const node = currentRollbackNode(
    initial,
    Object.values(ledger.nodes).filter((candidate): candidate is RollbackNode => candidate.kind === "rollback" && candidate.status === "current"),
    unitId,
  );
  const { config, sha256: projectConfigSha256 } = await readProjectConfigSnapshot(root);
  if (node.verificationConfigSha256 !== projectConfigSha256) {
    throw new DevFlowError("TRACE_SLICE_STALE", "rollback verification configuration is stale", { unitId });
  }
  const commands = resolveVerificationCommands(config, node);

  const baseline = await readCheckpointBaseline(root, id, unitId);
  const after = await snapshotProtectedRoots(root, config.protectedRoots);
  const records = diffSnapshots(baseline.files, after);
  for (const record of records) {
    for (const changedPath of [record.path, ...(record.renamedFrom ? [record.renamedFrom] : [])]) {
      if (!pathWithinFileScope(changedPath, node.fileScope)) {
        throw new DevFlowError("IMPLEMENTATION_UNIT_OUT_OF_SCOPE", "checkpoint found changes outside the rollback unit fileScope", {
          unitId,
          path: changedPath,
          fileScope: [...node.fileScope],
        });
      }
    }
  }

  const chainLength = (initial.implementationUnits ?? []).filter((candidate) => candidate.checkpointId).length;
  const sequence = chainLength + 1;
  const checkpointId = `CP-${String(sequence).padStart(3, "0")}`;
  const rollbackUnitId = unit.unitId;
  const featureDir = featureDirectory(root, id);
  const manifestFile = path.join(featureDir, manifestPath(checkpointId));

  // Idempotent retry is decided BEFORE running any verification: a manifest
  // whose state CAS previously failed is reused verbatim only when it still
  // describes this exact unit, basis, config, and workspace diff. Commands
  // never re-run; anything else is a real conflict and stays blocked.
  if (await pathExists(manifestFile)) {
    const existing = await readCheckpoint(root, id, checkpointId);
    const sameCheckpoint = existing.unitId === rollbackUnitId
      && existing.sequence === sequence
      && existing.basisHash === unit.basisHash
      && existing.projectConfigSha256 === projectConfigSha256
      && JSON.stringify(existing.files) === JSON.stringify(records);
    if (!sameCheckpoint) {
      throw new DevFlowError("CHECKPOINT_CONFLICT", "an existing checkpoint manifest no longer matches this unit", {
        checkpointId,
        unitId: rollbackUnitId,
      });
    }
    const reused = await mutate(root, id, expectedRevision, "implementation-unit-checkpointed", (draft) => {
      const current = (draft.implementationUnits ?? []).find((candidate) => candidate.unitId === unitId);
      if (!current || current.status !== "active") {
        throw new DevFlowError("IMPLEMENTATION_UNIT_NOT_ACTIVE", "checkpoint requires an active rollback unit", { unitId, status: current?.status });
      }
      current.status = "checkpointed";
      current.checkpointId = checkpointId;
    }, { unitId, checkpointId, sequence });
    return { state: reused, manifest: existing };
  }

  const attempts: CheckpointVerificationAttempt[] = [];
  for (const command of commands) {
    const startedAt = new Date().toISOString();
    const result = await runVerificationCommand(root, command);
    const attempt: CheckpointVerificationAttempt = {
      attemptId: randomUUID(),
      commandId: command.id,
      command: commandSummary(command),
      status: result.exitCode === 0 ? "passed" : "failed",
      startedAt,
      completedAt: new Date().toISOString(),
    };
    attempts.push(attempt);
    if (result.exitCode !== 0) {
      throw new DevFlowError("CHECKPOINT_VERIFICATION_FAILED", "forward verification failed; the unit stays active and no checkpoint is recorded", {
        unitId,
        attemptId: attempt.attemptId,
        commandId: attempt.commandId,
        exitCode: result.exitCode,
        output: result.output.slice(-4_000),
      });
    }
  }

  // Drift guard: verification commands must not change protected files.
  const afterVerification = await snapshotProtectedRoots(root, config.protectedRoots);
  if (!snapshotsEqual(after, afterVerification)) {
    throw new DevFlowError("CHECKPOINT_HASH_MISMATCH", "protected files changed while verification ran", { unitId });
  }
  const completedFingerprint = await fingerprintProtectedRoots(root, config.protectedRoots);

  for (const record of records) {
    if (record.change === "deleted" || record.change === "renamed") continue;
    const bytes = await readFile(path.join(root, record.path));
    if (digest(bytes) !== record.afterSha256) {
      throw new DevFlowError("CHECKPOINT_HASH_MISMATCH", "protected files changed while capturing checkpoint blobs", { path: record.path });
    }
    await writeBlobIfAbsent(root, id, bytes);
  }

  const forwardPatch = canonicalReviewValueJson({ direction: "forward", checkpointId, unitId: rollbackUnitId, files: records });
  const reversePatch = canonicalReviewValueJson({ direction: "reverse", checkpointId, unitId: rollbackUnitId, files: reverseRecords(records) });
  const manifest: CheckpointManifest = {
    schemaVersion: 1,
    checkpointId,
    unitId: rollbackUnitId,
    sequence,
    basisHash: unit.basisHash,
    startedFingerprint: unit.startedFingerprint!,
    completedFingerprint,
    startedAt: attempts[0]?.startedAt ?? new Date().toISOString(),
    completedAt: new Date().toISOString(),
    files: records,
    forwardPatchSha256: digest(forwardPatch),
    reversePatchSha256: digest(reversePatch),
    verificationAttempts: attempts,
    requirementsSha256: initial.artifacts.requirements?.sha256 ?? "",
    planSha256: initial.artifacts["implementation-plan"]?.sha256 ?? "",
    traceabilitySha256: initial.traceability?.sha256 ?? "",
    approvalBasisHash: unit.basisHash,
    projectConfigSha256,
    verificationCommands: commands.map((command) => ({ commandId: command.id, command: commandSummary(command) })),
  };
  const validated = parseCheckpointManifest(JSON.parse(JSON.stringify(manifest)));

  await mkdir(path.join(featureDir, "checkpoints", "patches"), { recursive: true });
  await mkdir(path.dirname(manifestFile), { recursive: true });
  await writeAtomic(path.join(featureDir, "checkpoints", "patches", `${manifest.forwardPatchSha256}.json`), forwardPatch);
  await writeAtomic(path.join(featureDir, "checkpoints", "patches", `${manifest.reversePatchSha256}.json`), reversePatch);

  const manifestContents = `${JSON.stringify(validated, null, 2)}\n`;
  const temp = `${manifestFile}.${randomUUID()}.tmp`;
  const handle = await open(temp, "w");
  try {
    await handle.writeFile(manifestContents);
    await handle.sync();
  } finally {
    await handle.close();
  }
  await options.fault?.("before-manifest-rename");
  await rename(temp, manifestFile);
  const manifestDir = await open(path.dirname(manifestFile), "r");
  try { await manifestDir.sync(); } finally { await manifestDir.close(); }
  await options.fault?.("after-manifest-rename");

  const state = await mutate(root, id, expectedRevision, "implementation-unit-checkpointed", (draft) => {
    const current = (draft.implementationUnits ?? []).find((candidate) => candidate.unitId === unitId);
    if (!current || current.status !== "active") {
      throw new DevFlowError("IMPLEMENTATION_UNIT_NOT_ACTIVE", "checkpoint requires an active rollback unit", { unitId, status: current?.status });
    }
    current.status = "checkpointed";
    current.checkpointId = checkpointId;
  }, { unitId, checkpointId, sequence });
  return { state, manifest: validated };
}

export async function readCheckpoint(root: string, featureId: string, checkpointId: string): Promise<CheckpointManifest> {
  const file = path.join(featureDirectory(root, featureId), manifestPath(checkpointId));
  let raw: string;
  try { raw = await readFile(file, "utf8"); }
  catch { throw new DevFlowError("CHECKPOINT_NOT_FOUND", "checkpoint manifest does not exist", { checkpointId }); }
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

/** Confirmed checkpoints in chain order, derived from unit state only. */
export async function checkpointChain(root: string, featureId: string, state: FeatureState): Promise<CheckpointManifest[]> {
  const ids = (state.implementationUnits ?? [])
    .filter((unit) => unit.checkpointId && (unit.status === "checkpointed" || unit.status === "rolled_back"))
    .map((unit) => unit.checkpointId!);
  const manifests: CheckpointManifest[] = [];
  for (const checkpointId of ids) manifests.push(await readCheckpoint(root, featureId, checkpointId));
  return manifests.sort((a, b) => a.sequence - b.sequence);
}
