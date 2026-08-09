import type { FeatureState } from "./state-store.js";

/** Editable evidence that can invalidate a pending or confirmed approval. */
export const approvalBasisArtifacts: readonly string[] = [
  "requirements",
  "implementation-plan",
];

/** Return approval obligation ids currently represented by confirmation records. */
export function approvalIds(state: FeatureState): string[] {
  return (state.obligations ?? [])
    .filter((obligation) => obligation.kind === "approval")
    .map((obligation) => obligation.id);
}

/** Stable, explicit basis used for one dynamically derived approval obligation. */
export function approvalBasis(state: FeatureState, approvalId: string): Record<string, unknown> {
  const obligation = state.obligations?.find((candidate) => candidate.id === approvalId && candidate.kind === "approval");
  if (!obligation) throw new Error(`approval obligation not found: ${approvalId}`);
  const basis: Record<string, unknown> = {
    approvalId,
    obligationBasisHash: obligation.basisHash,
    route: state.route,
    scope: state.scope,
    classification: state.classification,
    classificationBasis: state.classificationBasis,
    executionSemanticBasisHash: state.executionSemanticBasisHash,
  };
  // Review batch ids, snapshot pointers, generated projections, and stage
  // position are deliberately absent. Only the current blocking risk
  // meaning can affect the execution authorization.
  basis.blockingRisks = state.blockingFindings
    .filter((finding) => finding.blocking)
    .map((finding) => finding.message)
    .sort();
  basis.verification = {
    riskLabels: state.classification.riskLabels,
    blockingRisks: basis.blockingRisks,
  };
  return basis;
}

export function confirmedApproval(state: FeatureState): { approvalId: string; record: { status?: string } } | undefined {
  for (const approvalId of approvalIds(state)) {
    const record = state.humanGates[approvalId] as { status?: string } | undefined;
    if (record?.status === "confirmed") return { approvalId, record };
  }
  return undefined;
}
