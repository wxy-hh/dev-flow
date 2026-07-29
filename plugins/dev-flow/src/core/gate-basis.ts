import type { GateId } from "./gate-approval.js";
import type { FeatureState } from "./state-store.js";
import { traceEnforcementRequired } from "../policy/contract.js";

/** Artifact evidence whose revision invalidates each human approval. */
export const gateBasisArtifacts: Record<GateId, readonly string[]> = {
  requirement_confirmation: ["requirements"],
  implementation_approval: [
    "requirements",
    "implementation-plan",
    "coverage-matrix",
    "rollback-units",
    "rollback-safety",
    "risk-card",
    "boundary-card",
  ],
};

/** Gate approvals that must be presented again after this artifact changes. */
export function gatesInvalidatedByArtifact(kind: string): GateId[] {
  return (Object.keys(gateBasisArtifacts) as GateId[])
    .filter((gate) => gateBasisArtifacts[gate].includes(kind));
}

/** Stable, explicit approval basis used for both presentation and confirmation. */
export function gateBasis(state: FeatureState, gate: GateId): Record<string, unknown> {
  const basis: Record<string, unknown> = {
    route: state.route,
    scope: state.scope,
    classification: state.classification,
    artifacts: Object.fromEntries(
      gateBasisArtifacts[gate].map((kind) => [kind, state.artifacts[kind]]),
    ),
  };
  if (gate === "implementation_approval" && traceEnforcementRequired(state.route, state.workflowCapabilities)) {
    basis.traceability = state.traceability;
  }
  return basis;
}
