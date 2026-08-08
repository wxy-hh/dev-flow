import { routeDefinitionForFeature } from "../policy/contract.js";
import type { RouteDefinition } from "../policy/types.js";
import { DevFlowError } from "./errors.js";
import type { FeatureState } from "./state-store.js";

/** Route access with an explicit intake boundary: throws instead of crashing on undefined route. */
export function routeDefinitionForState(state: FeatureState): RouteDefinition {
  if (state.mode !== "routed") {
    throw new DevFlowError("ROUTE_NOT_DETERMINED", "route is not determined yet", {
      userMessage: "当前 feature 尚未锁定路线。",
      cause: `feature ${state.featureId} 处于 intake 阶段，route 尚未确定。`,
      impact: "锁定路线前无法推进任何路线步骤。",
      recoveryKind: "retry",
      recoveryInstruction: "先调用 dev_flow_lock_classification 锁定路线，再继续当前操作。",
      retryOriginal: true,
      requiresUserDecision: false,
    });
  }
  return routeDefinitionForFeature(state.route, state.classification.controls);
}

export function currentOpenStep(state: FeatureState): string | undefined {
  // Intake deliberately has no route. FeatureState keeps route required for
  // the routed branch for now, so this runtime guard documents that type debt.
  if (state.mode !== "routed") return undefined;
  return routeDefinitionForFeature(state.route, state.classification.controls).orderedSteps.find((step) => state.steps[step]?.status !== "satisfied");
}

export function assertCurrentStep(state: FeatureState, step: string): void {
  if (currentOpenStep(state) !== step) throw new DevFlowError("STEP_OUT_OF_ORDER", `${step} is not the current route step`, { expected: currentOpenStep(state) });
}

export function artifactsRequiredBeforeApproval(state: FeatureState, stage: string): string[] {
  const definition = routeDefinitionForState(state);
  const index = definition.orderedSteps.indexOf(stage);
  const required = [...new Set(definition.orderedSteps.slice(0, index).flatMap((step) => [
    ...(definition.artifactSteps?.[step] ?? []),
    ...(definition.generatedArtifactSteps?.[step] ?? []),
  ]))];
  return required;
}
