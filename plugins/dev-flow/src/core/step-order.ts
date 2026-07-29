import { routeDefinitionForFeature } from "../policy/contract.js";
import { DevFlowError } from "./errors.js";
import type { FeatureState } from "./state-store.js";

export function currentOpenStep(state: FeatureState): string | undefined {
  return routeDefinitionForFeature(state.route, state.workflowCapabilities).orderedSteps.find((step) => state.steps[step]?.status !== "satisfied");
}

export function assertCurrentStep(state: FeatureState, step: string): void {
  if (currentOpenStep(state) !== step) throw new DevFlowError("STEP_OUT_OF_ORDER", `${step} is not the current route step`, { expected: currentOpenStep(state) });
}

export function artifactsRequiredBeforeGate(state: FeatureState, gate: string): string[] {
  const definition = routeDefinitionForFeature(state.route, state.workflowCapabilities);
  const index = definition.orderedSteps.indexOf(gate);
  return [...new Set(definition.orderedSteps.slice(0, index).flatMap((step) => [
    ...(definition.artifactSteps?.[step] ?? []),
    ...(definition.generatedArtifactSteps?.[step] ?? []),
  ]))];
}
