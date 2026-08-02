import type { ClassificationObligation, RouteId, StageCapabilityView } from "./types.js";

export const routeStages: Readonly<Record<RouteId, readonly string[]>> = Object.freeze({
  xs: ["locate", "implementation", "verification", "finalize"],
  s: ["boundary", "implementation", "verification", "finalize"],
  "light-m": ["planning", "implementation", "code_review", "verification", "finalize"],
  "standard-m": ["requirements_alignment", "planning", "implementation", "code_review", "verification", "finalize"],
  "light-l": ["planning", "implementation", "code_review", "verification", "finalize"],
  "standard-l": ["requirements_alignment", "planning", "implementation", "code_review", "verification", "finalize"],
});

export function stagesForRoute(route: RouteId): readonly string[] {
  return routeStages[route];
}

export function deriveStageCapabilities(state: {
  route?: RouteId;
  mode?: "intake" | "routed";
  currentStage?: string;
  obligations?: ClassificationObligation[];
  lifecycle?: string;
}): StageCapabilityView {
  if (state.mode === "intake" || !state.route) {
    return {
      stage: "intake",
      activity: "investigate-and-resolve-decisions",
      allowedActions: ["inspect", "ask-user", "record-decision", "preview-classification", "lock-classification"],
      completionCriteria: ["objective-and-scope-known", "classification-basis-complete", "no-impacting-open-decision"],
      obligations: [],
    };
  }
  const stage = state.currentStage ?? stagesForRoute(state.route)[0];
  const obligations = (state.obligations ?? []).map(({ id, kind, status, reason }) => ({ id, kind, status, reason }));
  const allowedActions = stage === "requirements_alignment"
    ? ["read", "clarify-requirements", "record-decision", "record-trace"]
    : stage === "planning"
      ? ["read", "write-plan", "review-plan", "record-trace"]
      : stage === "implementation"
        ? ["read", "write", "edit", "run-verification", "repair-current-unit"]
        : stage === "code_review"
          ? ["read", "review-code", "repair-current-unit", "record-trace"]
          : stage === "verification"
            ? ["read", "run-verification", "repair-current-unit"]
            : stage === "finalize"
              ? ["read", "finalize", "refresh-status"]
              : ["read", "run-stage-action", "refresh-status"];
  const pendingApproval = obligations.some((obligation) => obligation.kind === "approval" && obligation.status !== "satisfied");
  return {
    stage,
    activity: stage,
    allowedActions,
    completionCriteria: [`${stage}-evidence-current`, "no-blocking-obligation"],
    obligations,
    ...(state.lifecycle === "active" ? {} : { attention: { reason: `feature-${state.lifecycle}`, required: true as const } }),
    ...(state.lifecycle === "active" && pendingApproval
      ? { attention: { reason: "approval-required", required: true as const } }
      : {}),
  };
}
