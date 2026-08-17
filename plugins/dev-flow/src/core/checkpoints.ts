import { randomUUID, createHash } from "node:crypto";
import { access, mkdir, open, readFile, readlink, readdir, rename } from "node:fs/promises";
import path from "node:path";
import { checkpointsEnforcementRequired, traceEnforcementRequired } from "../policy/contract.js";
import {
  parseCheckpointManifest,
  RollbackProtocolError,
  type CheckpointFileRecord,
  type CheckpointManifest,
  type CheckpointVerificationAttempt,
} from "../policy/rollback.js";
import type { ImplementationUnitNode } from "../policy/traceability.js";
import type { VerificationCommandRef } from "../policy/traceability.js";
import { DevFlowError } from "./errors.js";
import { fingerprintGovernedRoots, snapshotGovernedRoots, type ProtectedFileSnapshot } from "./fingerprint.js";
import { verificationCommandHashesForRefs, verificationCommandIdsForRefs, type ProjectConfig, type VerificationCommand } from "./project-config.js";
import { canonicalReviewValueJson } from "./review-store.js";
import { assertHostHealth } from "./host-health.js";
import { satisfyObligations } from "../policy/obligations.js";
import { assertWorkspaceOwnershipComplete, mutate, readProjectConfig, readState, type FeatureState } from "./state-store.js";
import { currentOpenStep } from "./step-order.js";
import { readProjectConfigSnapshot, readTraceability } from "./traceability-store.js";
import { runVerificationCommand } from "./verification.js";
import { readCheckpointManifest } from "./checkpoint-store.js";
import { invalidateAffectedClaims, workspaceChangedError } from "./change-invalidation.js";
import { putEvidenceObject } from "./evidence-store.js";
import type { EvidenceObjectRef } from "../policy/evidence-store.js";

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


/** Pack every referenced checkpoint blob into the Evidence Store (v3 manifest). */
async function packCheckpointBlobRefs(root: string, featureId: string, records: CheckpointFileRecord[]): Promise<Record<string, EvidenceObjectRef>> {
  const refs: Record<string, EvidenceObjectRef> = {};
  for (const record of records) {
    for (const blobSha256 of [record.beforeBlobSha256, record.afterBlobSha256]) {
      if (blobSha256 === undefined || refs[blobSha256]) continue;
      const file = path.join(featureDirectory(root, featureId), blobPath(blobSha256));
      const bytes = await readFile(file);
      if (digest(bytes) !== blobSha256) {
        throw new DevFlowError("CHECKPOINT_HASH_MISMATCH", "捕获 checkpoint blob 时 governed 文件发生变化。", { blobSha256 });
      }
      const stored = await putEvidenceObject(root, featureId, "checkpoint-pack", bytes);
      refs[blobSha256] = stored.ref;
    }
  }
  return refs;
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
  schemaVersion: 2;
  featureId: string;
  unitId: string;
  capturedAt: string;
  files: ProtectedFileSnapshot[];
}

function validateBaseline(value: unknown, unitId: string): CheckpointBaseline {
  const baseline = value as Partial<CheckpointBaseline> | undefined;
  const files = baseline?.files;
  if (!baseline || baseline.schemaVersion !== 2 || baseline.unitId !== unitId
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
    const bytes = file.kind === "symlink" ? Buffer.from(await readlink(path.join(root, file.path))) : await readFile(path.join(root, file.path));
    if (digest(bytes) !== file.sha256) {
      throw new DevFlowError("CHECKPOINT_HASH_MISMATCH", "捕获单元基线时 governed 文件发生变化。", { path: file.path });
    }
    await writeBlobIfAbsent(root, featureId, bytes);
  }
  const baseline: CheckpointBaseline = {
    schemaVersion: 2,
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
        beforeKind: beforeFile.kind ?? "file", afterKind: afterFile.kind ?? "file",
      });
    } else if (afterFile.mode !== beforeFile.mode) {
      records.push({
        path: filePath, change: "mode-changed",
        beforeSha256: beforeFile.sha256, afterSha256: afterFile.sha256,
        beforeBlobSha256: beforeFile.sha256, afterBlobSha256: afterFile.sha256,
        beforeMode: beforeFile.mode, afterMode: afterFile.mode,
        beforeKind: beforeFile.kind ?? "file", afterKind: afterFile.kind ?? "file",
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
        beforeKind: from.kind ?? "file", afterKind: to.kind ?? "file",
      });
      pairedDeleted.add(from.path);
      pairedAdded.add(to.path);
    }
  }
  for (const file of deleted) {
    if (pairedDeleted.has(file.path)) continue;
    records.push({ path: file.path, change: "deleted", beforeSha256: file.sha256, beforeBlobSha256: file.sha256, beforeMode: file.mode, beforeKind: file.kind ?? "file" });
  }
  for (const file of added) {
    if (pairedAdded.has(file.path)) continue;
    records.push({ path: file.path, change: "added", afterSha256: file.sha256, afterBlobSha256: file.sha256, afterMode: file.mode, afterKind: file.kind ?? "file" });
  }
  return records.sort((a, b) => a.path.localeCompare(b.path));
}

function snapshotsEqual(a: ProtectedFileSnapshot[], b: ProtectedFileSnapshot[]): boolean {
  return a.length === b.length && a.every((file, index) => file.path === b[index]?.path
    && file.sha256 === b[index]?.sha256 && file.mode === b[index]?.mode && (file.kind ?? "file") === (b[index]?.kind ?? "file"));
}

function reverseRecords(records: CheckpointFileRecord[]): CheckpointFileRecord[] {
  return records.map((record) => {
    switch (record.change) {
      case "added":
        return { path: record.path, change: "deleted", beforeSha256: record.afterSha256, beforeBlobSha256: record.afterBlobSha256, beforeMode: record.afterMode, beforeKind: record.afterKind };
      case "deleted":
        return { path: record.path, change: "added", afterSha256: record.beforeSha256, afterBlobSha256: record.beforeBlobSha256, afterMode: record.beforeMode, afterKind: record.beforeKind };
      case "renamed":
        return {
          path: record.renamedFrom!, change: "renamed", renamedFrom: record.path,
          beforeSha256: record.afterSha256, afterSha256: record.beforeSha256,
          beforeBlobSha256: record.afterBlobSha256, afterBlobSha256: record.beforeBlobSha256,
          beforeMode: record.afterMode, afterMode: record.beforeMode,
          beforeKind: record.afterKind, afterKind: record.beforeKind,
        };
      default:
        return {
          path: record.path, change: record.change,
          beforeSha256: record.afterSha256, afterSha256: record.beforeSha256,
          beforeBlobSha256: record.afterBlobSha256, afterBlobSha256: record.beforeBlobSha256,
          beforeMode: record.afterMode, afterMode: record.beforeMode,
          beforeKind: record.afterKind, afterKind: record.beforeKind,
        };
    }
  });
}

function commandSummary(command: VerificationCommand): string {
  return [command.command, ...command.args].join(" ");
}

function currentImplementationNode(state: FeatureState, nodes: ImplementationUnitNode[], unitId: string): ImplementationUnitNode {
  const node = nodes.find((candidate) => candidate.id === unitId);
  if (!node) {
    throw new DevFlowError("IMPLEMENTATION_UNIT_UNKNOWN", "implementation unit is not part of the current trace graph", { unitId });
  }
  return node;
}

export function resolveVerificationCommands(config: ProjectConfig, node: ImplementationUnitNode): VerificationCommand[] {
  return node.forwardVerification.map((reference, index) => resolveVerificationCommand(config, node.id, reference, index));
}

function resolveVerificationCommand(
  config: ProjectConfig,
  unitId: string,
  reference: VerificationCommandRef,
  index: number,
): VerificationCommand {
  const command = config.verification.commands.find((candidate) => candidate.id === reference);
  if (!command) {
    throw new DevFlowError("TRACE_VERIFICATION_COMMAND_UNKNOWN", "implementation unit references an unknown verification command", {
      unitId,
      commandId: reference,
    });
  }
  if (!command.provides.includes("targeted")) {
    throw new DevFlowError("TRACE_VERIFICATION_COMMAND_NOT_TARGETED", "实现单元前向验证只能引用提供 targeted 保证的命令。", {
      commandId: reference,
      recoveryHint: "为该命令增加 targeted provides，或在 RU 中改用明确的 targeted 命令",
    });
  }
  return command;
}

function resolvePreflightCommands(config: ProjectConfig): VerificationCommand[] {
  return (config.verification.preflightCommands ?? []).map((commandId) => {
    const command = config.verification.commands.find((candidate) => candidate.id === commandId);
    if (!command) {
      throw new DevFlowError("INVALID_PROJECT_CONFIG", "preflight command is not configured", { commandId });
    }
    return command;
  });
}

/** Next checkpoint id is max-on-disk + 1: manifests are immutable history
 * (rollback keeps them as rolled_back audit), so a number is never reused. */
async function nextCheckpointSequence(root: string, featureId: string): Promise<number> {
  const directory = path.join(featureDirectory(root, featureId), "checkpoints", "manifests");
  let entries: string[];
  try { entries = await readdir(directory); } catch { return 1; }
  let max = 0;
  for (const entry of entries) {
    const match = /^CP-(\d+)\.json$/.exec(entry);
    if (match) max = Math.max(max, Number.parseInt(match[1], 10));
  }
  return max + 1;
}

export interface CheckpointOptions {
  /** Test-only fault injection. Production callers omit this. */
  fault?: (point: "before-manifest-rename" | "after-manifest-rename") => void | Promise<void>;
}

/**
 * Confirms an active unit: diffs the governed roots against the begin-time
 * baseline, records the complete actual file set for drift/audit analysis,
 * runs forward verification, persists blobs plus the manifest, and only then
 * commits the unit transition in the same state CAS. fileScope is an
 * anticipated scope, not a write-time allowlist.
 */
export async function checkpointImplementationUnit(
  root: string,
  id: string,
  expectedRevision: number,
  unitId: string,
  options: CheckpointOptions = {},
): Promise<{ state: FeatureState; manifest: CheckpointManifest }> {
  const initial = await readState(root, id);
  await assertHostHealth(root, initial.lastUpdatedBy.host, "checkpoint");
  if (initial.revision !== expectedRevision) {
    throw new DevFlowError("STATE_REVISION_CONFLICT", "state revision changed", { currentRevision: initial.revision });
  }
  const invalidated = await invalidateAffectedClaims(root, id, expectedRevision);
  if (invalidated) throw workspaceChangedError(invalidated);
  if (!checkpointsEnforcementRequired(initial.route, initial.classification.controls)
    && initial.classification.controls.plan !== "formal") {
    throw new DevFlowError("IMPLEMENTATION_UNITS_NOT_ENFORCED", "当前动态路线未启用 unit-chain checkpoint 控制。");
  }
  if (currentOpenStep(initial) !== "implementation") {
    throw new DevFlowError("STEP_OUT_OF_ORDER", "checkpoint requires the implementation step", { expected: currentOpenStep(initial) });
  }
  await assertWorkspaceOwnershipComplete(root, initial, await readProjectConfig(root), "checkpoint");
  const unit = (initial.implementationUnits ?? []).find((candidate) => candidate.unitId === unitId);
  if (!unit) throw new DevFlowError("IMPLEMENTATION_UNIT_UNKNOWN", "implementation unit has no runtime state", { unitId });
  if (unit.status !== "active") {
    throw new DevFlowError("IMPLEMENTATION_UNIT_NOT_ACTIVE", "checkpoint requires an active implementation unit", { unitId, status: unit.status });
  }

  const traceEnforced = traceEnforcementRequired(initial.route, initial.classification.controls);
  let commands: import("./project-config.js").VerificationCommand[] = [];
  let config = await readProjectConfig(root);
  let currentCommandHashes: Record<string, string> = {};
  if (traceEnforced) {
    const ledger = await readTraceability(root, initial);
    const node = currentImplementationNode(
      initial,
      Object.values(ledger.nodes).filter((candidate): candidate is ImplementationUnitNode => candidate.kind === "implementation-unit" && candidate.status === "current"),
      unitId,
    );
    const { config: configSnapshot, sha256: projectConfigSha256 } = await readProjectConfigSnapshot(root);
    config = configSnapshot;
    const verificationRefs = [...node.forwardVerification];
    currentCommandHashes = verificationCommandHashesForRefs(config, verificationRefs);
    const traceCommandHashes = ledger.verificationCommandHashes;
    const commandSliceStale = traceCommandHashes
      ? verificationCommandIdsForRefs(verificationRefs).some((id) => traceCommandHashes[id] !== currentCommandHashes[id])
      : node.verificationConfigSha256 !== projectConfigSha256;
    if (commandSliceStale) {
      throw new DevFlowError("TRACE_SLICE_STALE", "rollback verification configuration is stale", {
        unitId,
        recoveryHint: "验证命令定义已变更：先用 dev_flow_abandon_implementation_unit 取消当前单元，再重登记计划刷新 Trace 基线，然后重新开始该单元。",
      });
    }
    commands = resolveVerificationCommands(config, node);
  }
  const preflightCommands = resolvePreflightCommands(config);
  const projectConfigSha256 = (await readProjectConfigSnapshot(root)).sha256;

  const baseline = await readCheckpointBaseline(root, id, unitId);
  const after = await snapshotGovernedRoots(root, config);
  const records = diffSnapshots(baseline.files, after);
  // fileScope is anticipated scope. The complete actual file set is retained
  // in the checkpoint manifest and surfaced through drift analysis; a missing
  // anticipated path must not turn an otherwise valid atomic implementation
  // unit into a dead end.

  const sequence = await nextCheckpointSequence(root, id);
  const checkpointId = `CP-${String(sequence).padStart(3, "0")}`;
  const implementationUnitId = unit.unitId;
  const featureDir = featureDirectory(root, id);

  // Idempotent retry is decided BEFORE running any verification. Only a
  // manifest from THIS begin incarnation (same beginNonce) can be this
  // attempt's orphan: it is reused verbatim — commands never re-run — when it
  // still describes the same unit, basis, config, and workspace diff; a same
  // nonce with any mismatch is a real conflict. A manifest whose nonce
  // differs (or a pre-4A manifest on a re-begun unit) belongs to a previous
  // incarnation — for example a redo after rollback — and never blocks or
  // satisfies this attempt, so a fresh checkpoint id is minted.
  //
  // Control-evidence boundary: a well-formed manifest with a *different*
  // beginNonce is indistinguishable from legitimate redo history (the Hook is
  // the write barrier for manifests). Corrupted or unreadable CP-*.json is
  // different — that is fail-closed: skip would re-run verification and mint a
  // new id, breaking the link to the orphaned evidence.
  const manifestsDir = path.join(featureDir, "checkpoints", "manifests");
  let orphan: CheckpointManifest | undefined;
  let entries: string[];
  try {
    entries = await readdir(manifestsDir);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") entries = [];
    else throw error;
  }
  for (const entry of entries.sort().reverse()) {
    if (!/^CP-\d+\.json$/.test(entry)) continue;
    let candidate: CheckpointManifest;
    try {
      candidate = parseCheckpointManifest(JSON.parse(await readFile(path.join(manifestsDir, entry), "utf8")));
    } catch (error) {
      throw new DevFlowError("ROLLBACK_CHECKPOINT_CORRUPT", "checkpoint manifest is unreadable or invalid", {
        checkpointFile: entry,
        unitId: implementationUnitId,
        cause: error instanceof Error ? error.message : String(error),
        recoveryHint: "Do not hand-edit checkpoint manifests; repair or remove the corrupt file before retrying the checkpoint",
      });
    }
    if (candidate.unitId === implementationUnitId && candidate.beginNonce === unit.beginNonce) {
      orphan = candidate;
      break;
    }
  }
  if (orphan) {
    const sameCheckpoint = orphan.basisHash === unit.basisHash
      && (orphan.verificationCommandHashes
        ? Object.keys(orphan.verificationCommandHashes).every((id) => orphan.verificationCommandHashes?.[id] === currentCommandHashes[id])
        : orphan.projectConfigSha256 === projectConfigSha256)
      && JSON.stringify(orphan.files) === JSON.stringify(records);
    if (!sameCheckpoint) {
      throw new DevFlowError("CHECKPOINT_CONFLICT", "an existing checkpoint manifest no longer matches this unit", {
        checkpointId: orphan.checkpointId,
        unitId: implementationUnitId,
      });
    }
    const reused = await mutate(root, id, expectedRevision, "implementation-unit-checkpointed", (draft) => {
      const current = (draft.implementationUnits ?? []).find((candidate) => candidate.unitId === unitId);
      if (!current || current.status !== "active") {
        throw new DevFlowError("IMPLEMENTATION_UNIT_NOT_ACTIVE", "checkpoint requires an active implementation unit", { unitId, status: current?.status });
      }
      current.status = "checkpointed";
      current.checkpointId = orphan.checkpointId;
      draft.evidenceFreshness.checkpoint = "current";
      draft.obligations = satisfyObligations(draft.obligations, ["checkpoint"]);
    }, { unitId, checkpointId: orphan.checkpointId, sequence: orphan.sequence });
    return { state: reused, manifest: orphan };
  }
  const manifestFile = path.join(featureDir, manifestPath(checkpointId));

  const attempts: CheckpointVerificationAttempt[] = [];
  for (const { command, phase } of [
    ...preflightCommands.map((command) => ({ command, phase: "preflight" as const })),
    ...commands.map((command) => ({ command, phase: "forward" as const })),
  ]) {
    const startedAt = new Date().toISOString();
    const result = await runVerificationCommand(root, command);
    const attempt: CheckpointVerificationAttempt = {
      attemptId: randomUUID(),
      commandId: command.id,
      command: commandSummary(command),
      status: result.exitCode === 0 ? "passed" : "failed",
      startedAt,
      completedAt: new Date().toISOString(),
      phase,
      cwd: command.cwd,
      outputTail: result.output.slice(-4_000),
    };
    attempts.push(attempt);
    if (result.exitCode !== 0) {
      throw new DevFlowError(phase === "preflight" ? "CHECKPOINT_PREFLIGHT_FAILED" : "CHECKPOINT_VERIFICATION_FAILED", phase === "preflight"
        ? "preflight verification failed; the unit stays active and no checkpoint is recorded"
        : "forward verification failed; the unit stays active and no checkpoint is recorded", {
        unitId,
        attemptId: attempt.attemptId,
        phase,
        commandId: attempt.commandId,
        command: attempt.command,
        cwd: command.cwd,
        exitCode: result.exitCode,
        outputTail: result.output.slice(-4_000),
        recoveryHint: phase === "preflight"
          ? "修复配置的环境前置命令后重试；单元保持 active 且不会创建 checkpoint"
          : "前向验证失败时单元保持 active 且不记 checkpoint：若失败源于测试先行（验证依赖尚未落地的单元），请把测试与修复合并为同一回撤单元（原子单元）一并回滚；checkpoint 前清理 scratch/ 中的残留红测试",
      });
    }
  }

  // Drift guard: verification commands must not change protected files.
  const afterVerification = await snapshotGovernedRoots(root, config);
  if (!snapshotsEqual(after, afterVerification)) {
    throw new DevFlowError("CHECKPOINT_HASH_MISMATCH", "运行验证时 governed 文件发生变化。", { unitId });
  }
  const completedFingerprint = await fingerprintGovernedRoots(root, config);

  for (const record of records) {
    if (record.change === "deleted" || record.change === "renamed") continue;
    const bytes = record.afterKind === "symlink" ? Buffer.from(await readlink(path.join(root, record.path))) : await readFile(path.join(root, record.path));
    if (digest(bytes) !== record.afterSha256) {
      throw new DevFlowError("CHECKPOINT_HASH_MISMATCH", "捕获 checkpoint blob 时 governed 文件发生变化。", { path: record.path });
    }
    await writeBlobIfAbsent(root, id, bytes);
  }

  const forwardPatch = canonicalReviewValueJson({ direction: "forward", checkpointId, unitId: implementationUnitId, files: records });
  const reversePatch = canonicalReviewValueJson({ direction: "reverse", checkpointId, unitId: implementationUnitId, files: reverseRecords(records) });
  const blobRefs = await packCheckpointBlobRefs(root, id, records);
  const manifest: CheckpointManifest = {
    schemaVersion: 3,
    checkpointId,
    unitId: implementationUnitId,
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
    ...(unit.beginNonce ? { beginNonce: unit.beginNonce } : {}),
    verificationCommands: [...preflightCommands, ...commands].map((command) => ({ commandId: command.id, command: commandSummary(command) })),
    verificationCommandHashes: Object.fromEntries([...preflightCommands, ...commands].map((command) => [command.id, currentCommandHashes[command.id] ?? digest(JSON.stringify(command))])),
    blobRefs,
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
      throw new DevFlowError("IMPLEMENTATION_UNIT_NOT_ACTIVE", "checkpoint requires an active implementation unit", { unitId, status: current?.status });
    }
    current.status = "checkpointed";
    current.checkpointId = checkpointId;
    draft.evidenceFreshness.checkpoint = "current";
    draft.obligations = satisfyObligations(draft.obligations, ["checkpoint"]);
  }, { unitId, checkpointId, sequence });
  return { state, manifest: validated };
}

export async function readCheckpoint(root: string, featureId: string, checkpointId: string): Promise<CheckpointManifest> {
  return readCheckpointManifest(root, featureId, checkpointId);
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
