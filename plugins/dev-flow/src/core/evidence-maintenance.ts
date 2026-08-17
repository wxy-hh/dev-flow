import { parseEvidenceObjectRef, type EvidenceObjectRef } from "../policy/evidence-store.js";
import { collectEvidenceOrphans, DEFAULT_GC_BYTE_BUDGET, DEFAULT_GC_PACK_BUDGET, readEvidenceObject } from "./evidence-store.js";
import { eventSegmentRootRefs } from "./event-segments.js";
import { checkpointManifestRootRefs } from "./checkpoint-store.js";
import { reviewExecutionEvidenceRoots } from "./review-execution.js";
import { parseEvidenceBaselineManifest } from "../policy/evidence-baseline.js";
import { parsePlanRevisionProposal } from "../policy/plan-revision.js";
import type { FeatureState } from "./state-store.js";

function addRef(refs: EvidenceObjectRef[], value: unknown): void {
  if (!value || typeof value !== "object" || Array.isArray(value)) return;
  try {
    const parsed = parseEvidenceObjectRef(value);
    const key = `${parsed.kind}:${parsed.sha256}`;
    if (!refs.some((ref) => `${ref.kind}:${ref.sha256}` === key)) refs.push(parsed);
  } catch {
    // Not a logical ref; only exact kind/sha256/size objects are roots.
  }
}

/**
 * Current evidence root set derived from FeatureState. All refs reachable
 * through archived collections, governance baselines and pending plan-revision
 * proposals must survive GC. Roots are logical refs only; never pack offsets.
 */
export function evidenceRootSet(state: FeatureState): EvidenceObjectRef[] {
  const refs: EvidenceObjectRef[] = [];
  const archived = state.archivedCollections;
  if (archived) {
    addRef(refs, archived.workspaceLineage);
    addRef(refs, archived.interactionLedger);
    addRef(refs, archived.governanceLedger);
    addRef(refs, archived.verificationLedger);
    addRef(refs, archived.repairLedger);
  }
  for (const claim of state.governance?.claims ?? []) addRef(refs, claim.baselineRef);
  for (const authorization of state.governance?.authorizations ?? []) addRef(refs, authorization.baselineRef);
  for (const interaction of Object.values(state.interactions ?? {})) addRef(refs, interaction.planRevisionProposal);
  return refs;
}

/** Expand state roots with index/manifest roots and embedded content refs. */
export async function collectEvidenceRootSet(root: string, featureId: string, state: FeatureState): Promise<EvidenceObjectRef[]> {
  const refs = evidenceRootSet(state);
  const pushUnique = (ref: EvidenceObjectRef | undefined) => {
    if (!ref) return;
    const key = `${ref.kind}:${ref.sha256}`;
    if (refs.some((candidate) => `${candidate.kind}:${candidate.sha256}` === key)) return;
    refs.push(ref);
  };
  for (const ref of await eventSegmentRootRefs(root, featureId)) pushUnique(ref);
  for (const ref of await checkpointManifestRootRefs(root, featureId)) pushUnique(ref);
  for (const ref of await reviewExecutionEvidenceRoots(root, featureId)) pushUnique(ref);
  for (const claim of state.governance?.claims ?? []) {
    if (!claim.baselineRef) continue;
    try {
      const manifestBytes = await readEvidenceObject(root, featureId, claim.baselineRef);
      const manifest = parseEvidenceBaselineManifest(JSON.parse(manifestBytes.toString("utf8")));
      pushUnique(manifest.snapshotRef);
    } catch {
      // A corrupt baseline remains a root itself and is surfaced by doctor.
    }
  }
  for (const authorization of state.governance?.authorizations ?? []) {
    if (!authorization.baselineRef) continue;
    try {
      const manifestBytes = await readEvidenceObject(root, featureId, authorization.baselineRef);
      const manifest = parseEvidenceBaselineManifest(JSON.parse(manifestBytes.toString("utf8")));
      pushUnique(manifest.snapshotRef);
    } catch {
      // A corrupt baseline remains a root itself and is surfaced by doctor.
    }
  }
  for (const interaction of Object.values(state.interactions ?? {})) {
    if (!interaction.planRevisionProposal) continue;
    try {
      const proposalBytes = await readEvidenceObject(root, featureId, interaction.planRevisionProposal);
      const proposal = parsePlanRevisionProposal(JSON.parse(proposalBytes.toString("utf8")));
      pushUnique(proposal.compiledTrace);
    } catch {
      // A corrupt proposal remains a root itself and is surfaced by doctor.
    }
  }
  return refs;
}


export interface EvidenceMaintenanceResult {
  roots: number;
  deletedPacks: number;
  deletedFiles: number;
  deletedBytes: number;
}

/**
 * One bounded orphan-GC round. Callers run this after a successful mutation or
 * at SessionStart under the feature lock; it never advances FeatureState
 * revision and never reads cold pack payloads.
 */
export async function runBoundedEvidenceMaintenance(
  root: string,
  featureId: string,
  state: FeatureState,
  options: { packBudget?: number; byteBudget?: number } = {},
): Promise<EvidenceMaintenanceResult> {
  const roots = await collectEvidenceRootSet(root, featureId, state);
  const result = await collectEvidenceOrphans(root, featureId, roots, {
    packBudget: options.packBudget ?? DEFAULT_GC_PACK_BUDGET,
    byteBudget: options.byteBudget ?? DEFAULT_GC_BYTE_BUDGET,
  });
  return { roots: roots.length, deletedPacks: result.deletedPacks, deletedFiles: result.deletedFiles, deletedBytes: result.deletedBytes };
}