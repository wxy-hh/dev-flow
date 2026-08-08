import type { FeatureState } from "./state-store.js";
import { reviewEnforcementRequired, traceEnforcementRequired } from "../policy/contract.js";

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
  if (reviewEnforcementRequired(state.route, state.classification.controls)) {
    // The ledger pointer, rather than any caller-supplied batch string or
    // generated Markdown, is the authoritative plan-review approval basis.
    basis.review = state.review;
  }
  basis.verification = {
    riskLabels: state.classification.riskLabels,
    obligations: state.obligations,
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
