import type { RollbackId, RollbackNode } from "./traceability.js";

/**
 * Phase-3 checkpoint domain: runtime lifecycle for rollback units plus the
 * content-addressed checkpoint manifest shape. RollbackNode stays the single
 * definition of an RU; these types never duplicate its fields.
 */

export type ImplementationUnitStatus = "pending" | "active" | "verified" | "checkpointed" | "rolled_back";

export interface ImplementationUnitState {
  unitId: RollbackId;
  status: ImplementationUnitStatus;
  basisHash: string;
  startedFingerprint?: string;
  checkpointId?: string;
  /**
   * Per-begin incarnation discriminator (4A). A redo after rolled_back gets a
   * fresh nonce, so a historical manifest of the same unit can never be
   * mistaken for the in-flight attempt's orphaned manifest. Absent on units
   * begun before 4A.
   */
  beginNonce?: string;
}

export type CheckpointFileChange = "added" | "modified" | "deleted" | "renamed" | "mode-changed";

export interface CheckpointFileRecord {
  path: string;
  change: CheckpointFileChange;
  renamedFrom?: string;
  beforeSha256?: string;
  afterSha256?: string;
  beforeBlobSha256?: string;
  afterBlobSha256?: string;
  /** Permission bits as an octal string, e.g. "644" or "755". */
  beforeMode?: string;
  afterMode?: string;
}

export interface CheckpointVerificationAttempt {
  attemptId: string;
  commandId: string;
  command: string;
  status: "passed" | "failed";
  startedAt: string;
  completedAt: string;
}

export interface CheckpointVerificationCommand {
  commandId: string;
  command: string;
}

export interface CheckpointManifest {
  schemaVersion: 1;
  checkpointId: string;
  unitId: RollbackId;
  sequence: number;
  basisHash: string;
  startedFingerprint: string;
  completedFingerprint: string;
  startedAt: string;
  completedAt: string;
  files: CheckpointFileRecord[];
  forwardPatchSha256: string;
  reversePatchSha256: string;
  verificationAttempts: CheckpointVerificationAttempt[];
  requirementsSha256: string;
  planSha256: string;
  traceabilitySha256: string;
  approvalBasisHash: string;
  projectConfigSha256: string;
  verificationCommands: CheckpointVerificationCommand[];
  /** Incarnation of the unit that produced this manifest; absent on pre-4A manifests. */
  beginNonce?: string;
}

/**
 * The full lifecycle table. Phase 3 produced no runtime path into rolled_back;
 * 4A adds the undo edge (checkpointed -> rolled_back) and the redo edge
 * (rolled_back -> active via a fresh begin with a new beginNonce).
 */
export const IMPLEMENTATION_UNIT_TRANSITIONS: Readonly<Record<ImplementationUnitStatus, readonly ImplementationUnitStatus[]>> = Object.freeze({
  pending: Object.freeze(["active"] as const),
  active: Object.freeze(["verified"] as const),
  verified: Object.freeze(["checkpointed", "active"] as const),
  checkpointed: Object.freeze(["rolled_back"] as const),
  rolled_back: Object.freeze(["active"] as const),
});

const unitStatuses = ["pending", "active", "verified", "checkpointed", "rolled_back"] as const satisfies readonly ImplementationUnitStatus[];

const fileChanges = ["added", "modified", "deleted", "renamed", "mode-changed"] as const satisfies readonly CheckpointFileChange[];

const ROLLBACK_ID = /^RU-[0-9]{3,}$/;
const SHA256 = /^[0-9a-f]{64}$/;
const FILE_MODE = /^[0-7]{3,4}$/;

/**
 * Single scope-matching semantics for every fileScope consumer (Hook scope
 * gate, checkpoint verification, rollback preview). A pattern with glob
 * characters is matched segment by segment (** crosses segments); a pattern
 * without glob characters is a bare prefix that covers an exact file or an
 * entire subtree. Unsafe patterns never match (fail closed).
 */
export function pathWithinFileScope(path: string, fileScope: string[]): boolean {
  return fileScope.some((pattern) => scopePatternMatches(pattern.normalize("NFC"), path.normalize("NFC")));
}

/**
 * Canonical admission contract for a rollback-unit fileScope pattern. Patterns
 * are stored in Trace snapshots and must remain safe and meaningful across
 * every host before they reach the runtime matcher.
 */
export function isSafeFileScopePattern(value: unknown): value is string {
  if (typeof value !== "string" || !value || value.trim() !== value) return false;
  if (value.includes("\\") || value.startsWith("/") || /^[A-Za-z]:/.test(value)) return false;
  if (value === ".") return true;
  return value.split("/").every((segment) => segment.length > 0 && segment !== "." && segment !== "..");
}

function scopePatternMatches(pattern: string, target: string): boolean {
  if (!isSafeFileScopePattern(pattern) || typeof target !== "string" || !target.trim()) return false;
  if (target.includes("\\") || target.startsWith("/")) return false;
  const segments = pattern.split("/");
  const parts = target.split("/");
  if (parts.some((part) => part === "..")) return false;
  if (/[*?]/.test(pattern)) return globSegmentsMatch(segments, parts);
  if (pattern === ".") return true;
  return target === pattern || target.startsWith(`${pattern}/`);
}

function globSegmentsMatch(pattern: string[], target: string[]): boolean {
  if (pattern.length === 0) return target.length === 0;
  const [head, ...rest] = pattern;
  if (head === "**") {
    if (rest.length === 0) return true;
    for (let skip = 0; skip <= target.length; skip += 1) {
      if (globSegmentsMatch(rest, target.slice(skip))) return true;
    }
    return false;
  }
  if (target.length === 0 || !globSegmentMatches(head, target[0])) return false;
  return globSegmentsMatch(rest, target.slice(1));
}

function globSegmentMatches(pattern: string, segment: string): boolean {
  if (pattern === "") return segment === "";
  const [head, ...rest] = pattern;
  if (head === "*") {
    for (let take = 0; take <= segment.length; take += 1) {
      if (globSegmentMatches(rest.join(""), segment.slice(take))) return true;
    }
    return false;
  }
  if (head === "?") return segment.length > 0 && globSegmentMatches(rest.join(""), segment.slice(1));
  return segment.startsWith(head) && globSegmentMatches(rest.join(""), segment.slice(head.length));
}

function invalid(message: string): never {
  throw new Error(`ROLLBACK_PROTOCOL_INVALID: ${message}`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isRollbackId(value: unknown): value is RollbackId {
  return typeof value === "string" && ROLLBACK_ID.test(value);
}

function isSha256(value: unknown): value is string {
  return typeof value === "string" && SHA256.test(value);
}

function isTimestamp(value: unknown): value is string {
  return typeof value === "string" && !Number.isNaN(Date.parse(value));
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isNonEmptyStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.length > 0 && value.every(isNonEmptyString);
}

function hasOnlyKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return Object.keys(value).every((key) => keys.includes(key));
}

export function isValidUnitTransition(from: ImplementationUnitStatus, to: ImplementationUnitStatus): boolean {
  return IMPLEMENTATION_UNIT_TRANSITIONS[from].includes(to);
}

/**
 * Derive the initial pending unit from a current RollbackNode. Standard M
 * (implementation-plan) and standard L (rollback-units) nodes share one shape,
 * so lifecycle code never branches on the source artifact.
 */
export function implementationUnitForRollbackNode(node: RollbackNode, basisHash: string): ImplementationUnitState {
  if (!isRecord(node)
    || node.kind !== "rollback"
    || !isRollbackId(node.id)
    || !isNonEmptyStringArray(node.tasks)
    || !isNonEmptyStringArray(node.fileScope)
    || !isNonEmptyStringArray(node.forwardVerification)
    || !isNonEmptyStringArray(node.rollbackVerification)
    || node.status !== "current") {
    invalid("rollback node is missing fields required to open an implementation unit");
  }
  if (!isSha256(basisHash)) invalid("implementation unit basis hash must be a SHA-256 hex digest");
  return { unitId: node.id, status: "pending", basisHash };
}

export function parseImplementationUnitState(value: unknown): ImplementationUnitState {
  if (!isRecord(value)
    || !hasOnlyKeys(value, ["unitId", "status", "basisHash", "startedFingerprint", "checkpointId", "beginNonce"])
    || !isRollbackId(value.unitId)
    || typeof value.status !== "string"
    || !unitStatuses.includes(value.status as ImplementationUnitStatus)
    || !isSha256(value.basisHash)
    || (value.startedFingerprint !== undefined && !isSha256(value.startedFingerprint))
    || (value.checkpointId !== undefined && !isNonEmptyString(value.checkpointId))
    || (value.beginNonce !== undefined && !isNonEmptyString(value.beginNonce))) {
    invalid("implementation unit state has an invalid shape");
  }
  const status = value.status as ImplementationUnitStatus;
  const started = value.startedFingerprint !== undefined;
  const checkpointed = value.checkpointId !== undefined;
  const hasNonce = value.beginNonce !== undefined;
  // beginNonce is optional for pre-4A units that never began under the redo
  // protocol. Once present it is only meaningful for statuses that have begun
  // (active/verified/checkpointed/rolled_back); a pending unit must not carry one.
  const consistent =
    (status === "pending" && !started && !checkpointed && !hasNonce)
    || ((status === "active" || status === "verified") && started && !checkpointed)
    || ((status === "checkpointed" || status === "rolled_back") && started && checkpointed);
  if (!consistent) invalid(`implementation unit status ${status} is inconsistent with its fingerprint/checkpoint fields`);
  return {
    unitId: value.unitId,
    status,
    basisHash: value.basisHash,
    ...(started ? { startedFingerprint: value.startedFingerprint as string } : {}),
    ...(checkpointed ? { checkpointId: (value.checkpointId as string).trim() } : {}),
    ...(hasNonce ? { beginNonce: (value.beginNonce as string).trim() } : {}),
  };
}

/** Validate a persisted unit set against the feature's known RU IDs. */
export function parseImplementationUnits(value: unknown, knownUnitIds: readonly RollbackId[]): ImplementationUnitState[] {
  if (!Array.isArray(value)) invalid("implementation units must be an array");
  const seenUnits = new Set<RollbackId>();
  const seenCheckpoints = new Set<string>();
  return value.map((item, index) => {
    const unit = parseImplementationUnitState(item);
    if (seenUnits.has(unit.unitId)) invalid(`implementation unit ${index} duplicates unit ${unit.unitId}`);
    if (!knownUnitIds.includes(unit.unitId)) invalid(`implementation unit ${index} references unknown unit ${unit.unitId}`);
    if (unit.checkpointId) {
      if (seenCheckpoints.has(unit.checkpointId)) invalid(`implementation unit ${index} duplicates checkpoint ${unit.checkpointId}`);
      seenCheckpoints.add(unit.checkpointId);
    }
    seenUnits.add(unit.unitId);
    return unit;
  });
}

function parseFileRecord(value: unknown, index: number): CheckpointFileRecord {
  if (!isRecord(value)
    || !hasOnlyKeys(value, ["path", "change", "renamedFrom", "beforeSha256", "afterSha256", "beforeBlobSha256", "afterBlobSha256", "beforeMode", "afterMode"])
    || !isNonEmptyString(value.path)
    || typeof value.change !== "string"
    || !fileChanges.includes(value.change as CheckpointFileChange)) {
    invalid(`checkpoint file record ${index} has an invalid shape`);
  }
  const label = `checkpoint file record ${index}`;
  const change = value.change as CheckpointFileChange;
  const beforeOk = change !== "added"
    ? isSha256(value.beforeSha256) && isSha256(value.beforeBlobSha256) && typeof value.beforeMode === "string" && FILE_MODE.test(value.beforeMode)
    : value.beforeSha256 === undefined && value.beforeBlobSha256 === undefined && value.beforeMode === undefined;
  const afterOk = change !== "deleted"
    ? isSha256(value.afterSha256) && isSha256(value.afterBlobSha256) && typeof value.afterMode === "string" && FILE_MODE.test(value.afterMode)
    : value.afterSha256 === undefined && value.afterBlobSha256 === undefined && value.afterMode === undefined;
  if (!beforeOk) invalid(`${label} has invalid before fields for change ${change}`);
  if (!afterOk) invalid(`${label} has invalid after fields for change ${change}`);
  if (change === "renamed" && !isNonEmptyString(value.renamedFrom)) invalid(`${label} renamed record requires renamedFrom`);
  if (change !== "renamed" && value.renamedFrom !== undefined) invalid(`${label} only renamed records may carry renamedFrom`);
  return {
    path: value.path,
    change,
    ...(value.renamedFrom !== undefined ? { renamedFrom: value.renamedFrom as string } : {}),
    ...(change !== "added"
      ? { beforeSha256: value.beforeSha256 as string, beforeBlobSha256: value.beforeBlobSha256 as string, beforeMode: value.beforeMode as string }
      : {}),
    ...(change !== "deleted"
      ? { afterSha256: value.afterSha256 as string, afterBlobSha256: value.afterBlobSha256 as string, afterMode: value.afterMode as string }
      : {}),
  };
}

function parseVerificationAttempt(value: unknown, index: number): CheckpointVerificationAttempt {
  if (!isRecord(value)
    || !hasOnlyKeys(value, ["attemptId", "commandId", "command", "status", "startedAt", "completedAt"])
    || !isNonEmptyString(value.attemptId)
    || !isNonEmptyString(value.commandId)
    || !isNonEmptyString(value.command)
    || (value.status !== "passed" && value.status !== "failed")
    || !isTimestamp(value.startedAt)
    || !isTimestamp(value.completedAt)) {
    invalid(`checkpoint verification attempt ${index} has an invalid shape`);
  }
  return {
    attemptId: value.attemptId,
    commandId: value.commandId,
    command: value.command,
    status: value.status,
    startedAt: value.startedAt,
    completedAt: value.completedAt,
  };
}

export function parseCheckpointManifest(value: unknown): CheckpointManifest {
  if (!isRecord(value)
    || !hasOnlyKeys(value, ["schemaVersion", "checkpointId", "unitId", "sequence", "basisHash", "startedFingerprint", "completedFingerprint", "startedAt", "completedAt", "files", "forwardPatchSha256", "reversePatchSha256", "verificationAttempts", "requirementsSha256", "planSha256", "traceabilitySha256", "approvalBasisHash", "projectConfigSha256", "verificationCommands", "beginNonce"])
    || value.schemaVersion !== 1
    || !isNonEmptyString(value.checkpointId)
    || !isRollbackId(value.unitId)
    || typeof value.sequence !== "number" || !Number.isInteger(value.sequence) || value.sequence < 1
    || !isSha256(value.basisHash)
    || !isSha256(value.startedFingerprint)
    || !isSha256(value.completedFingerprint)
    || (value.beginNonce !== undefined && !isNonEmptyString(value.beginNonce))
    || !isTimestamp(value.startedAt)
    || !isTimestamp(value.completedAt)
    || !Array.isArray(value.files)
    || !isSha256(value.forwardPatchSha256)
    || !isSha256(value.reversePatchSha256)
    || !Array.isArray(value.verificationAttempts)
    || !isSha256(value.requirementsSha256)
    || !isSha256(value.planSha256)
    || !isSha256(value.traceabilitySha256)
    || !isSha256(value.approvalBasisHash)
    || !isSha256(value.projectConfigSha256)
    || !Array.isArray(value.verificationCommands)
    || value.verificationCommands.length === 0) {
    invalid("checkpoint manifest has an invalid shape");
  }
  const files = value.files.map((file, index) => parseFileRecord(file, index));
  const verificationAttempts = value.verificationAttempts.map((attempt, index) => parseVerificationAttempt(attempt, index));
  const verificationCommands = value.verificationCommands.map((command, index) => {
    if (!isRecord(command) || !hasOnlyKeys(command, ["commandId", "command"]) || !isNonEmptyString(command.commandId) || !isNonEmptyString(command.command)) {
      invalid(`checkpoint verification command ${index} has an invalid shape`);
    }
    return { commandId: command.commandId, command: command.command };
  });
  const declaredCommandIds = new Set(verificationCommands.map((command) => command.commandId));
  for (const attempt of verificationAttempts) {
    if (!declaredCommandIds.has(attempt.commandId)) {
      invalid(`checkpoint verification attempt ${attempt.attemptId} references undeclared command ${attempt.commandId}`);
    }
  }
  return {
    schemaVersion: 1,
    checkpointId: value.checkpointId,
    unitId: value.unitId,
    sequence: value.sequence,
    basisHash: value.basisHash,
    startedFingerprint: value.startedFingerprint,
    completedFingerprint: value.completedFingerprint,
    startedAt: value.startedAt,
    completedAt: value.completedAt,
    files,
    forwardPatchSha256: value.forwardPatchSha256,
    reversePatchSha256: value.reversePatchSha256,
    verificationAttempts,
    requirementsSha256: value.requirementsSha256,
    planSha256: value.planSha256,
    traceabilitySha256: value.traceabilitySha256,
    approvalBasisHash: value.approvalBasisHash,
    projectConfigSha256: value.projectConfigSha256,
    verificationCommands,
    ...(typeof value.beginNonce === "string" ? { beginNonce: value.beginNonce } : {}),
  };
}
