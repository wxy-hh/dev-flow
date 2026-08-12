import { decisionBasisHash } from "../policy/obligations.js";
import type { ClassificationBasis, ClassificationObligation } from "../policy/types.js";
import type { FeatureState } from "./state-store.js";
import { effectiveStage } from "../policy/stages.js";

export interface FeatureMutationSummary {
  featureId: string;
  revision: number;
  mode: "intake" | "routed";
  lifecycle: FeatureState["lifecycle"];
  route?: FeatureState["route"];
  stage: string;
  logicComplete: boolean;
  obligations: { pending: number; satisfied: number; stale: number };
  counters: {
    checkpoints: number;
    unitsDone: number;
    unitsTotal: number;
    openInteractions: number;
    blockingFindings: number;
  };
}

/** Compact mutation response; full state remains available through status. */
export function buildFeatureMutationSummary(state: FeatureState): FeatureMutationSummary {
  const obligations = state.obligations ?? [];
  const units = state.implementationUnits ?? [];
  const interactions = Object.values(state.interactions ?? {});
  const snapshot = state.deliverySnapshot as { excludedChangedPaths?: string[] } | undefined;
  return {
    featureId: state.featureId,
    revision: state.revision,
    mode: state.mode,
    lifecycle: state.lifecycle,
    ...(state.mode === "routed" ? { route: state.route } : {}),
    stage: effectiveStage(state),
    logicComplete: state.logicComplete,
    obligations: {
      pending: obligations.filter((obligation) => obligation.status === "pending").length,
      satisfied: obligations.filter((obligation) => obligation.status === "satisfied").length,
      stale: obligations.filter((obligation) => obligation.status === "stale").length,
    },
    counters: {
      checkpoints: state.checkpoints?.length ?? 0,
      unitsDone: units.filter((unit) => unit.status === "checkpointed" || unit.status === "rolled_back").length,
      unitsTotal: units.length,
      openInteractions: interactions.filter((interaction) => (interaction as { status?: unknown }).status === "pending").length,
      blockingFindings: state.blockingFindings.filter((finding) => finding.blocking).length,
    },
    // finalize 透明性：已排除但仍有变化的路径不阻塞完成，只在响应中提醒。
    ...(snapshot?.excludedChangedPaths?.length ? { excludedChangedPaths: snapshot.excludedChangedPaths } : {}),
  };
}

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
  verificationFreshness?: "missing" | "fresh" | "stale",
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
  const verificationStatus = verificationFreshness === "stale"
    ? "stale"
    : verificationFreshness === "fresh"
      ? "passed"
      : state.verification.verifiedFingerprint
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
