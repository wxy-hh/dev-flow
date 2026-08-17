import { parseEvidenceObjectRef, parseEvidenceStorePointer, type EvidenceObjectRef, type EvidenceStorePointer } from "./evidence-store.js";
import type { GovernanceLedger } from "./governance-records.js";
import type { WorkspaceLineage } from "./types.js";

export interface FeatureStateArchivePointers {
  schemaVersion: 1;
  featureId: string;
  workspaceLineage?: EvidenceObjectRef;
  interactionLedger?: EvidenceObjectRef;
  governanceLedger?: EvidenceObjectRef;
  verificationLedger?: EvidenceObjectRef;
  repairLedger?: EvidenceObjectRef;
  pointer: EvidenceStorePointer;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function parseFeatureStateArchivePointers(value: unknown): FeatureStateArchivePointers {
  if (!isRecord(value) || value.schemaVersion !== 1 || typeof value.featureId !== "string" || !value.featureId) {
    throw new TypeError("invalid FeatureState archive pointers");
  }
  const parsed: FeatureStateArchivePointers = {
    schemaVersion: 1,
    featureId: value.featureId,
    pointer: parseEvidenceStorePointer(value.pointer),
  };
  for (const key of ["workspaceLineage", "interactionLedger", "governanceLedger", "verificationLedger", "repairLedger"] as const) {
    if (value[key] === undefined) continue;
    parsed[key] = parseEvidenceObjectRef(value[key]);
  }
  return parsed;
}

function parseStringRecord(value: unknown, label: string): Record<string, string> {
  if (!isRecord(value) || Object.values(value).some((item) => typeof item !== "string")) {
    throw new TypeError(`${label} must be a string map`);
  }
  return value as Record<string, string>;
}

export function parseWorkspaceLineage(value: unknown): WorkspaceLineage {
  if (!isRecord(value)
    || typeof value.baseHead !== "string"
    || typeof value.baseBranch !== "string"
    || typeof value.observedHead !== "string"
    || typeof value.lastWorkspaceFingerprint !== "string"
    || (value.reconciliationStatus !== "current" && value.reconciliationStatus !== "required" && value.reconciliationStatus !== "blocked")
    || !isRecord(value.startedDirty)
    || !isRecord(value.ownership)
    || !isRecord(value.ownershipSource)
    || !isRecord(value.observedPathFingerprints)
    || !Array.isArray(value.observedCommits)
    || (value.unownedPaths !== undefined && (!Array.isArray(value.unownedPaths) || value.unownedPaths.some((item) => typeof item !== "string")))) {
    throw new TypeError("invalid workspace lineage archive");
  }
  return {
    baseHead: value.baseHead,
    baseBranch: value.baseBranch,
    observedHead: value.observedHead,
    startedDirty: value.startedDirty as WorkspaceLineage["startedDirty"],
    ownership: parseStringRecord(value.ownership, "workspace.ownership") as WorkspaceLineage["ownership"],
    ownershipSource: parseStringRecord(value.ownershipSource, "workspace.ownershipSource") as WorkspaceLineage["ownershipSource"],
    observedCommits: value.observedCommits as WorkspaceLineage["observedCommits"],
    observedPathFingerprints: parseStringRecord(value.observedPathFingerprints, "workspace.observedPathFingerprints"),
    lastWorkspaceFingerprint: value.lastWorkspaceFingerprint,
    reconciliationStatus: value.reconciliationStatus,
    ...(value.unownedPaths ? { unownedPaths: value.unownedPaths as string[] } : {}),
  };
}

export function parseGovernanceLedger(value: unknown): GovernanceLedger {
  if (!isRecord(value)
    || !Array.isArray(value.decisions)
    || !Array.isArray(value.claims)
    || !Array.isArray(value.authorizations)
    || !Array.isArray(value.credentials)
    || !Array.isArray(value.repositoryFacts)) {
    throw new TypeError("invalid governance ledger archive");
  }
  return {
    decisions: value.decisions as GovernanceLedger["decisions"],
    claims: value.claims as GovernanceLedger["claims"],
    authorizations: value.authorizations as GovernanceLedger["authorizations"],
    credentials: value.credentials as GovernanceLedger["credentials"],
    repositoryFacts: value.repositoryFacts as GovernanceLedger["repositoryFacts"],
  };
}

export function parseInteractionLedger(value: unknown): Record<string, { id: string; status: string }> {
  if (!isRecord(value)) throw new TypeError("invalid interaction ledger archive");
  const parsed: Record<string, { id: string; status: string }> = {};
  for (const [id, item] of Object.entries(value)) {
    if (!isRecord(item) || typeof item.id !== "string" || typeof item.status !== "string") {
      throw new TypeError("invalid interaction ledger entry");
    }
    parsed[id] = item as { id: string; status: string };
  }
  return parsed;
}

export function parseAttemptLog(value: unknown, label: string): unknown[] {
  if (!Array.isArray(value)) throw new TypeError(`invalid ${label} archive`);
  return value;
}
