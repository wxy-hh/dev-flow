import { decisionBasisHash } from "../policy/obligations.js";
import type { ClassificationBasis, ClassificationObligation } from "../policy/types.js";
import type { FeatureState } from "./state-store.js";

/**
 * A compact, Core-owned view of the facts that make an execution decision
 * meaningful. It is deliberately a projection: no separate Markdown file or
 * user-facing route step is needed.
 */
export interface ExecutionBrief {
  featureId: string;
  route: string;
  objective: string;
  scope: { inScope: string[]; outOfScope: string[] };
  classificationBasis: ClassificationBasis;
  plan: { requirements?: { path: string; sha256: string }; implementationPlan?: { path: string; sha256: string } };
  obligations: Array<Pick<ClassificationObligation, "id" | "kind" | "status" | "reason">>;
  review: {
    assurance?: string;
    status: "not-required" | "pending" | "complete" | "stale";
  };
  rollback: { required: boolean; strategy: "checkpointed" | "planned" | "none" };
  verification: { requiredKinds: string[]; status: "missing" | "passed" | "stale" };
  basisHash: string;
}

export function buildExecutionBrief(
  state: FeatureState,
  review?: { assurance?: { level?: string }; batch?: { status?: string } },
): ExecutionBrief | undefined {
  if (state.mode !== "routed" || !state.route || !state.classificationBasis || !state.obligations) return undefined;
  const plan = {
    ...(state.artifacts.requirements ? { requirements: state.artifacts.requirements } : {}),
    ...(state.artifacts["implementation-plan"] ? { implementationPlan: state.artifacts["implementation-plan"] } : {}),
  };
  const reviewRequired = state.obligations.some((obligation) => obligation.kind === "review");
  const reviewStatus = !reviewRequired
    ? "not-required"
    : review?.batch?.status === "stale" ? "stale"
      : review?.batch?.status === "complete" ? "complete" : "pending";
  const rollbackRequired = state.obligations.some((obligation) => obligation.kind === "rollback" || obligation.kind === "checkpoint");
  const checkpointed = (state.implementationUnits ?? []).some((unit) => unit.status === "checkpointed")
    || (state.checkpoints ?? []).length > 0;
  const requiredKinds = [...new Set(state.obligations.flatMap((obligation) => obligation.verificationKinds ?? []))].sort();
  const verificationStatus = state.verification.verifiedFingerprint
    ? state.verification.verifiedFingerprint === state.businessFingerprint ? "passed" : "stale"
    : "missing";
  const basis = {
    route: state.route,
    objective: state.objective,
    scope: state.scope,
    classification: state.classification,
    classificationBasis: state.classificationBasis,
    plan,
    obligations: state.obligations.map(({ id, kind, basisHash, status }) => ({ id, kind, basisHash, status })),
    review: state.review,
    rollbackRequired,
    verificationKinds: requiredKinds,
  };
  return {
    featureId: state.featureId,
    route: state.route,
    objective: state.objective ?? "",
    scope: { inScope: [...state.scope.inScope], outOfScope: [...state.scope.outOfScope] },
    classificationBasis: state.classificationBasis,
    plan,
    obligations: state.obligations.map(({ id, kind, status, reason }) => ({ id, kind, status, reason })),
    review: {
      status: reviewStatus,
      ...(review?.assurance?.level ? { assurance: review.assurance.level } : {}),
    },
    rollback: { required: rollbackRequired, strategy: checkpointed ? "checkpointed" : rollbackRequired ? "planned" : "none" },
    verification: { requiredKinds, status: verificationStatus },
    basisHash: decisionBasisHash(basis),
  };
}
