import { routeDefinition } from "../policy/contract.js";
import { deriveNext } from "../policy/derive-next.js";
import type { NextAction } from "../policy/types.js";
import { readState, type FeatureState } from "./state-store.js";
import { verificationIsStale } from "./verification.js";

function toDerivedState(state: FeatureState, verificationStale: boolean) {
  const steps: Record<string, { status: "pending" | "satisfied"; artifactReady?: boolean }> = { ...state.steps };
  if (verificationStale) steps.verification = { status: "pending" };
  for (const gate of ["requirement_confirmation", "implementation_approval"]) {
    const snapshot = state.humanGates[gate] as { status?: string } | undefined;
    if (snapshot?.status === "pending") steps[gate] = { status: "pending", artifactReady: true };
  }
  return {
    schemaVersion: state.schemaVersion, lifecycle: state.lifecycle, route: state.route, steps,
    blockingFindings: state.blockingFindings,
    verificationFresh: !verificationStale && Boolean(state.verification.verifiedFingerprint && state.verification.verifiedFingerprint === state.businessFingerprint),
    featureCheckFresh: !verificationStale && Boolean(state.featureCheck.passed && state.featureCheck.fingerprint === state.businessFingerprint),
    logicComplete: state.logicComplete,
  } as const;
}

export async function nextAction(root: string, id: string): Promise<NextAction> {
  const state = await readState(root, id);
  const action = deriveNext(toDerivedState(state, await verificationIsStale(root, state)));
  if (action.kind === "run-step" && action.step === "feature_check") return { kind: "feature-check" };
  if (action.kind === "run-step" && action.step === "finalize") return { kind: "finalize" };
  if (action.kind === "run-step" || action.kind === "present-human-gate") {
    const requiredNow = routeDefinition(state.route).artifactSteps?.[action.step] ?? [];
    const missing = requiredNow.find((artifact) => !state.artifacts[artifact]);
    if (missing) return { kind: "scaffold-artifact", step: missing };
  }
  return action;
}
