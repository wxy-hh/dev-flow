import { createHash } from "node:crypto";
import { stableJson } from "../policy/stable-json.js";
import {
  parseEvidenceBaselineManifest,
  type EvidenceBaselineManifest,
  type EvidenceBaselineOrigin,
} from "../policy/evidence-baseline.js";
import type { EvidenceObjectRef, EvidenceStorePointer } from "../policy/evidence-store.js";
import { putEvidenceObject } from "./evidence-store.js";
import { readCheckpointManifest } from "./checkpoint-store.js";
import { captureWorkspaceSnapshot, type WorkspaceSnapshotResult } from "./workspace-snapshot.js";
import type { FeatureState } from "./state-store.js";
import type { ProjectConfig } from "./project-config.js";

const sha256 = (value: string): string => createHash("sha256").update(value).digest("hex");

export interface CaptureEvidenceBaselineOptions {
  now?: Date;
}

export interface EvidenceBaselineCapture {
  snapshot: WorkspaceSnapshotResult;
  manifest: EvidenceBaselineManifest;
  ref: EvidenceObjectRef;
  pointer: EvidenceStorePointer;
}

export function featureOwnedSnapshotHash(files: Array<{ path: string }>, ownership: FeatureState["workspace"]["ownership"]): string {
  return sha256(stableJson({ files: files.filter((file) => ownership[file.path] === "feature") }));
}

function featureOwnedContentHash(snapshot: WorkspaceSnapshotResult, ownership: FeatureState["workspace"]["ownership"]): string {
  return featureOwnedSnapshotHash(snapshot.files, ownership);
}

function emptyHash(): string {
  return "0".repeat(64);
}

/**
 * Capture one governance-record-owned baseline from a single canonical
 * workspace snapshot. The same snapshot produces content fingerprint, scope
 * and file→UNIT mapping; callers cannot splice independent fingerprints.
 */
export async function captureEvidenceBaseline(
  root: string,
  state: FeatureState,
  config: ProjectConfig,
  origin: EvidenceBaselineOrigin,
  options: CaptureEvidenceBaselineOptions = {},
): Promise<EvidenceBaselineCapture> {
  const snapshot = await captureWorkspaceSnapshot(root, state.featureId, config, { now: options.now });
  const units = state.implementationUnits ?? [];
  const fileToUnits = new Map<string, Set<string>>();
  const checkpointIds: string[] = [];
  for (const unit of units) {
    if (!unit.checkpointId) continue;
    checkpointIds.push(unit.checkpointId);
    const manifest = await readCheckpointManifest(root, state.featureId, unit.checkpointId);
    for (const file of manifest.files) {
      const unitIds = fileToUnits.get(file.path) ?? new Set<string>();
      unitIds.add(unit.unitId);
      fileToUnits.set(file.path, unitIds);
    }
  }
  const manifest: EvidenceBaselineManifest = {
    schemaVersion: 1,
    featureId: state.featureId,
    capturedAt: (options.now ?? new Date()).toISOString(),
    contentFingerprint: featureOwnedContentHash(snapshot, state.workspace.ownership),
    governedScopeHash: sha256(stableJson({ governedRoots: config.governedRoots, excludes: config.governedRootsExclude ?? [] })),
    ownershipHash: sha256(stableJson(state.workspace.ownership)),
    planExecutionBasisHash: state.executionSemanticBasisHash ?? emptyHash(),
    checkpointIds: [...new Set(checkpointIds)].sort(),
    fileToUnits: [...fileToUnits.entries()]
      .map(([filePath, unitIds]) => ({ path: filePath, unitIds: [...unitIds].sort() }))
      .sort((left, right) => left.path.localeCompare(right.path)),
    snapshotRef: snapshot.ref,
    origin,
  };
  parseEvidenceBaselineManifest(manifest);
  const stored = await putEvidenceObject(
    root,
    state.featureId,
    "evidence-baseline",
    Buffer.from(`${stableJson(manifest)}\n`, "utf8"),
  );
  return {
    snapshot,
    manifest,
    ref: stored.ref,
    pointer: stored.pointer,
  };
}
