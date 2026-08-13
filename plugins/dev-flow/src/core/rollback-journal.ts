import { randomUUID } from "node:crypto";
import { mkdir, readFile, rm, rmdir } from "node:fs/promises";
import { hostname } from "node:os";
import path from "node:path";
import { DevFlowError } from "./errors.js";
import { assertNoOpenRollbackTransaction, lock, readState, writeAtomic } from "./state-store.js";

const features = (root: string) => path.join(root, ".dev-flow", "features");
const rollbackTxnPath = (root: string, featureId: string) => path.join(features(root), featureId, "rollback-transaction.json");

export type RollbackTransactionPhase = "prepared" | "backing-up" | "rolling-back" | "verifying" | "committed" | "compensating" | "compensated";
const rollbackTransactionPhases = new Set<RollbackTransactionPhase>(["prepared", "backing-up", "rolling-back", "verifying", "committed", "compensating", "compensated"]);

export interface RollbackTransactionFileAction {
  action: "restore" | "delete";
  path: string;
  blobSha256?: string;
  mode?: string;
  kind?: "file" | "symlink";
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
  /** Referenced verification command identities captured for scoped invalidation. */
  verificationCommandHashes?: Record<string, string>;
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
    if (candidate.kind !== undefined && candidate.kind !== "file" && candidate.kind !== "symlink") return false;
    return true;
  });
  if (transaction?.schemaVersion !== 1 || typeof transaction.transactionId !== "string" || !transaction.transactionId
    || typeof transaction.featureId !== "string" || !transaction.featureId
    || !rollbackTransactionPhases.has(transaction.phase as RollbackTransactionPhase)
    || typeof transaction.targetCheckpointId !== "string" || !/^CP-[0-9]{3,}$/.test(transaction.targetCheckpointId)
    || typeof transaction.targetUnitId !== "string" || !/^UNIT-[0-9]{3,}$/.test(transaction.targetUnitId)
    || !Array.isArray(transaction.undoOrder) || transaction.undoOrder.length === 0 || !transaction.undoOrder.every((unitId) => typeof unitId === "string" && /^UNIT-[0-9]{3,}$/.test(unitId))
    || (transaction.undoCheckpoints !== undefined && (!Array.isArray(transaction.undoCheckpoints) || !transaction.undoCheckpoints.every((id) => typeof id === "string" && /^CP-[0-9]{3,}$/.test(id))))
    || !isSha256(transaction.previewBasisHash) || !isSha256(transaction.projectConfigSha256)
    || (transaction.verificationCommandHashes !== undefined && (typeof transaction.verificationCommandHashes !== "object" || transaction.verificationCommandHashes === null || Array.isArray(transaction.verificationCommandHashes) || Object.values(transaction.verificationCommandHashes).some((hash) => !isSha256(hash))))
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
