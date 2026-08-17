/**
 * Phase 6 Evidence Baseline contract. Each content-bound governance
 * claim/authorization owns its own baseline; there is no global latest
 * accepted baseline.
 */

import { parseEvidenceObjectRef, type EvidenceObjectRef } from "./evidence-store.js";

export type EvidenceBaselineOriginKind = "review-complete" | "verification-current" | "risk-acceptance";

export interface EvidenceBaselineOrigin {
  kind: EvidenceBaselineOriginKind;
  target: string;
  recordId: string;
  at: string;
}

export interface EvidenceBaselineFileUnitMapping {
  path: string;
  unitIds: string[];
}

export interface EvidenceBaselineManifest {
  schemaVersion: 1;
  featureId: string;
  capturedAt: string;
  contentFingerprint: string;
  governedScopeHash: string;
  ownershipHash: string;
  planExecutionBasisHash: string;
  checkpointIds: string[];
  fileToUnits: EvidenceBaselineFileUnitMapping[];
  snapshotRef: EvidenceObjectRef;
  origin: EvidenceBaselineOrigin;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isSha256(value: unknown): value is string {
  return typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
}

export function parseEvidenceBaselineManifest(value: unknown): EvidenceBaselineManifest {
  if (!isRecord(value) || value.schemaVersion !== 1
    || typeof value.featureId !== "string" || !value.featureId
    || typeof value.capturedAt !== "string" || Number.isNaN(Date.parse(value.capturedAt))
    || !isSha256(value.contentFingerprint)
    || !isSha256(value.governedScopeHash)
    || !isSha256(value.ownershipHash)
    || !isSha256(value.planExecutionBasisHash)
    || !Array.isArray(value.checkpointIds) || value.checkpointIds.some((id) => typeof id !== "string")
    || !Array.isArray(value.fileToUnits)
    || !isRecord(value.snapshotRef)
    || !isRecord(value.origin)
    || (value.origin.kind !== "review-complete" && value.origin.kind !== "verification-current" && value.origin.kind !== "risk-acceptance")
    || typeof value.origin.target !== "string"
    || typeof value.origin.recordId !== "string"
    || typeof value.origin.at !== "string") {
    throw new TypeError("invalid evidence baseline manifest");
  }
  const fileToUnits = value.fileToUnits.map((mapping) => {
    if (!isRecord(mapping) || typeof mapping.path !== "string" || !mapping.path
      || !Array.isArray(mapping.unitIds) || mapping.unitIds.some((id) => typeof id !== "string")) {
      throw new TypeError("invalid evidence baseline file-unit mapping");
    }
    return { path: mapping.path, unitIds: [...new Set(mapping.unitIds as string[])].sort() };
  });
  return {
    schemaVersion: 1,
    featureId: String(value.featureId),
    capturedAt: String(value.capturedAt),
    contentFingerprint: String(value.contentFingerprint),
    governedScopeHash: String(value.governedScopeHash),
    ownershipHash: String(value.ownershipHash),
    planExecutionBasisHash: String(value.planExecutionBasisHash),
    checkpointIds: [...new Set(value.checkpointIds as string[])].sort(),
    fileToUnits,
    snapshotRef: parseEvidenceObjectRef(value.snapshotRef),
    origin: {
      kind: value.origin.kind as EvidenceBaselineOriginKind,
      target: String(value.origin.target),
      recordId: String(value.origin.recordId),
      at: String(value.origin.at),
    },
  };
}
