import { routeDefinitionForFeature } from "../policy/contract.js";
import { deriveNext } from "../policy/derive-next.js";
import { requiredEvidenceForStep, requiredEvidenceIsEmpty } from "../policy/evidence.js";
import type { NextAction } from "../policy/types.js";
import { readState, type FeatureState } from "./state-store.js";
import { inspectTraceGate } from "./traceability-gates.js";
import { verificationIsStale } from "./verification.js";

function toDerivedState(state: FeatureState, verificationStale: boolean) {
  const steps: Record<string, { status: "pending" | "satisfied"; artifactReady?: boolean }> = { ...state.steps };
  if (verificationStale) steps.verification = { status: "pending" };
  for (const gate of ["requirement_confirmation", "implementation_approval"]) {
    const snapshot = state.humanGates[gate] as { status?: string } | undefined;
    if (snapshot?.status === "pending" || snapshot?.status === "returned") steps[gate] = { status: "pending", artifactReady: true };
  }
  return {
    schemaVersion: state.schemaVersion,
    lifecycle: state.lifecycle,
    route: state.route,
    steps,
    blockingFindings: state.blockingFindings,
    verificationFresh: !verificationStale && Boolean(
      state.verification.verifiedFingerprint
      && state.verification.verifiedFingerprint === state.businessFingerprint,
    ),
    featureCheckFresh: !verificationStale && Boolean(
      state.featureCheck.passed
      && state.featureCheck.fingerprint === state.businessFingerprint,
    ),
    logicComplete: state.logicComplete,
  } as const;
}

function enrichRunStep(state: FeatureState, step: string): NextAction {
  const requiredEvidence = requiredEvidenceForStep(
    state.route,
    state.classification.riskLabels,
    step,
    state.workflowCapabilities,
  );
  return requiredEvidenceIsEmpty(requiredEvidence)
    ? { kind: "run-step", step }
    : { kind: "run-step", step, requiredEvidence };
}

function enrichFeatureCheck(state: FeatureState): NextAction {
  const requiredEvidence = requiredEvidenceForStep(
    state.route,
    state.classification.riskLabels,
    "feature_check",
    state.workflowCapabilities,
  );
  return requiredEvidenceIsEmpty(requiredEvidence)
    ? { kind: "feature-check" }
    : { kind: "feature-check", requiredEvidence };
}

function traceStepForAction(action: NextAction): string | undefined {
  if (action.kind === "run-step" || action.kind === "present-human-gate") return action.step;
  if (action.kind === "feature-check") return "feature_check";
  if (action.kind === "finalize") return "finalize";
  return undefined;
}

export async function nextAction(root: string, id: string): Promise<NextAction> {
  const state = await readState(root, id);
  const action = deriveNext(toDerivedState(state, await verificationIsStale(root, state)));

  if (action.kind === "run-step" || action.kind === "present-human-gate") {
    const definition = routeDefinitionForFeature(state.route, state.workflowCapabilities);
    const requiredNow = [
      ...(definition.artifactSteps?.[action.step] ?? []),
      ...(definition.generatedArtifactSteps?.[action.step] ?? []),
    ];
    const missing = requiredNow.find((artifact) => !state.artifacts[artifact]);
    if (missing) return { kind: "scaffold-artifact", step: missing };
  }

  const traceStep = traceStepForAction(action);
  if (traceStep) {
    const trace = await inspectTraceGate(root, state, traceStep);
    if (trace.blocker) return { kind: "repair-trace", ...trace.blocker };
  }

  if (action.kind === "run-step" && action.step === "feature_check") return enrichFeatureCheck(state);
  if (action.kind === "run-step" && action.step === "finalize") return { kind: "finalize" };
  if (action.kind === "run-step") return enrichRunStep(state, action.step);
  if (action.kind === "feature-check") return enrichFeatureCheck(state);
  return action;
}
