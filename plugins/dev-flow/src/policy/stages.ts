import type { ClassificationObligation, RouteId, StageCapabilityView } from "./types.js";

/** Derive the user-visible stage from lifecycle and route evidence. */
export function effectiveStage(state: {
  route?: RouteId;
  mode?: "intake" | "routed";
  currentStage?: string;
  lifecycle?: string;
  steps?: Record<string, { status?: string } | undefined>;
  classification?: { orderedRoute?: string[] };
}): string {
  if (state.mode === "intake" || !state.route) return "intake";
  if (state.lifecycle === "finalized") return "complete";
  // 已 routed 只信账本里的 steps / currentStage。手写阶段表已删除
  // （ADR-0020）；空 steps 视为异常，不会回落成含 plan_review /
  // execution_approval 的假 L 序列——编译出的可 record 步骤才是权威阶段序列。
  if (state.steps) {
    const keys = Object.keys(state.steps);
    if (keys.length > 0) {
      const pending = keys.find((stage) => state.steps?.[stage]?.status !== "satisfied");
      if (pending) return pending;
      return keys[0];
    }
  }
  return state.currentStage ?? "unknown";
}

export function deriveStageCapabilities(state: {
  route?: RouteId;
  mode?: "intake" | "routed";
  currentStage?: string;
  obligations?: ClassificationObligation[];
  workflowCapabilities?: { checkpoints?: 0 | 1 };
  lifecycle?: string;
  steps?: Record<string, { status?: string } | undefined>;
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
  const stage = effectiveStage(state);
  const obligations = (state.obligations ?? []).map(({ id, kind, status, reason }) => ({ id, kind, status, reason }));
  if (stage === "complete") {
    return {
      stage,
      activity: "complete",
      allowedActions: ["read", "refresh-status"],
      completionCriteria: ["feature-finalized"],
      obligations,
    };
  }
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
  return {
    stage,
    activity: stage,
    allowedActions,
    completionCriteria: [`${stage}-evidence-current`, "no-blocking-obligation"],
    obligations,
    ...(stage === "implementation" && state.workflowCapabilities?.checkpoints === 1
      ? { requiredEvidence: { fields: { files: "governed-root-paths" as const }, checks: [], verificationKinds: [] } }
      : {}),
    ...(state.lifecycle === "active" ? {} : { attention: { reason: `feature-${state.lifecycle}`, required: true as const } }),
  };
}
