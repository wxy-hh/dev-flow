import { routeDefinitionForFeature } from "./contract.js";
import { requiredEvidenceForStep, requiredEvidenceIsEmpty } from "./evidence.js";
import type { ClassificationObligation, GovernanceControls, RiskLabel, RouteId, StageCapabilityView } from "./types.js";

/**
 * 当前开放步骤的唯一权威归约（ADR-0020）：按编译出的 orderedSteps 顺序
 * 找第一个未满足的步骤；全部满足返回 undefined。展示投影与执行门禁
 * 共用此答案——任何“现在进行到哪一步”的判断都走这里，禁止另写循环。
 */
export function firstOpenStep(
  orderedSteps: readonly string[],
  steps: Record<string, { status?: string } | undefined>,
): string | undefined {
  return orderedSteps.find((step) => steps[step]?.status !== "satisfied");
}

/** Derive the user-visible stage from lifecycle and route evidence. */
export function effectiveStage(state: {
  route?: RouteId;
  mode?: "intake" | "routed";
  lifecycle?: string;
  steps?: Record<string, { status?: string } | undefined>;
  classification?: { orderedRoute?: string[]; controls?: GovernanceControls };
}): string {
  if (state.mode === "intake" || !state.route) return "intake";
  if (state.lifecycle === "finalized") return "complete";
  // 已 routed 只信账本里的 steps（ADR-0020）：空 steps 视为从头开始，
  // 全部满足而未 finalized 的过渡态落在路线末步（finalize 恒为末步）。
  const definition = routeDefinitionForFeature(state.route, state.classification?.controls);
  return firstOpenStep(definition.orderedSteps, state.steps ?? {})
    ?? definition.orderedSteps[definition.orderedSteps.length - 1]
    ?? "unknown";
}

export function deriveStageCapabilities(state: {
  route?: RouteId;
  mode?: "intake" | "routed";
  obligations?: ClassificationObligation[];
  lifecycle?: string;
  steps?: Record<string, { status?: string } | undefined>;
  classification?: { orderedRoute?: string[]; controls?: GovernanceControls; riskLabels?: RiskLabel[] };
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
  const stageEvidence = stage === "implementation" && state.route && state.classification?.controls
    ? requiredEvidenceForStep(state.route, state.classification.riskLabels ?? [], stage, state.classification.controls)
    : undefined;
  return {
    stage,
    activity: stage,
    allowedActions,
    completionCriteria: [`${stage}-evidence-current`, "no-blocking-obligation"],
    obligations,
    ...(stageEvidence && !requiredEvidenceIsEmpty(stageEvidence) ? { requiredEvidence: stageEvidence } : {}),
    ...(state.lifecycle === "active" ? {} : { attention: { reason: `feature-${state.lifecycle}`, required: true as const } }),
  };
}
