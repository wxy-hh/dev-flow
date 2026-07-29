import { routeDefinitionForFeature } from "../policy/contract.js";
import {
  missingRequiredEvidence,
  requiredEvidenceForStep,
  requiredEvidenceIsEmpty,
} from "../policy/evidence.js";
import type { RequiredEvidence } from "../policy/types.js";
import { assertArtifactIntegrity } from "./artifacts.js";
import { DevFlowError } from "./errors.js";
import {
  assertImplementationFilesInProtectedRoots,
  createDeliverySnapshot,
  implementationFiles,
  type DeliverySnapshot,
} from "./delivery-snapshot.js";
import { assertRequirementsGrillSatisfied } from "./requirements-grill.js";
import { mutate, readProjectConfig, readState, type FeatureState } from "./state-store.js";
import { assertCurrentStep } from "./step-order.js";
import { assertTraceGateCurrent } from "./traceability-gates.js";
import { invalidateStaleVerification } from "./verification.js";

function assertRequiredEvidence(step: string, required: RequiredEvidence, evidence: unknown): void {
  const missing = missingRequiredEvidence(required, evidence);
  if (requiredEvidenceIsEmpty(missing)) return;
  const details = { step, requiredEvidence: required, missing };
  if (missing.fields.reviewType !== undefined) {
    throw new DevFlowError("REVIEW_TYPE_MISMATCH", `${step} reviewType is missing or incorrect`, details);
  }
  throw new DevFlowError("RISK_EVIDENCE_INCOMPLETE", `${step} evidence is incomplete`, details);
}

export async function recordStep(
  root: string,
  id: string,
  expectedRevision: number,
  step: string,
  evidence: unknown,
): Promise<FeatureState> {
  let normalizedEvidence = evidence;
  if (step === "implementation") {
    const files = implementationFiles(evidence);
    const config = await readProjectConfig(root);
    assertImplementationFilesInProtectedRoots(files, config.protectedRoots);
    normalizedEvidence = {
      ...(typeof evidence === "object" && evidence !== null && !Array.isArray(evidence) ? evidence : {}),
      files,
    };
  }
  return mutate(root, id, expectedRevision, "step-recorded", async (state) => {
    if (state.lifecycle !== "active") {
      throw new DevFlowError("INVALID_LIFECYCLE", "only active features can record steps");
    }
    const route = routeDefinitionForFeature(state.route, state.workflowCapabilities);
    if (["requirement_confirmation", "implementation_approval", "verification", "feature_check", "finalize"].includes(step)
      || !route.orderedSteps.includes(step)) {
      throw new DevFlowError("INVALID_STEP", step);
    }
    assertCurrentStep(state, step);
    await assertRequirementsGrillSatisfied(root, id, state);
    await assertTraceGateCurrent(root, state, step);
    const required = requiredEvidenceForStep(
      state.route,
      state.classification.riskLabels,
      step,
      state.workflowCapabilities,
    );
    assertRequiredEvidence(step, required, normalizedEvidence);
    state.steps[step] = { status: "satisfied", evidence: normalizedEvidence };
  });
}

async function invalidateBeforeFinalClaim(root: string, id: string, expectedRevision: number): Promise<void> {
  const invalidated = await invalidateStaleVerification(root, id, expectedRevision);
  if (invalidated) {
    throw new DevFlowError("VERIFICATION_STALE", "protected files changed; rerun verification", {
      currentRevision: invalidated.revision,
    });
  }
}

function assertVerificationWasNotInvalidated(state: FeatureState): void {
  const evidence = state.steps.verification?.evidence as { reason?: unknown } | undefined;
  if (evidence?.reason === "protected-files-changed") {
    throw new DevFlowError("VERIFICATION_STALE", "protected files changed; rerun verification");
  }
}

export async function featureCheck(
  root: string,
  id: string,
  expectedRevision: number,
): Promise<FeatureState> {
  const initial = await readState(root, id);
  if (initial.revision !== expectedRevision) {
    throw new DevFlowError("STATE_REVISION_CONFLICT", "state revision changed", {
      currentRevision: initial.revision,
    });
  }
  await assertRequirementsGrillSatisfied(root, id, initial);
  await invalidateBeforeFinalClaim(root, id, expectedRevision);
  await assertArtifactIntegrity(root, id);
  return mutate(root, id, expectedRevision, "feature-checked", async (state) => {
    await assertRequirementsGrillSatisfied(root, id, state);
    assertVerificationWasNotInvalidated(state);
    assertCurrentStep(state, "feature_check");
    await assertTraceGateCurrent(root, state, "feature_check");
    if (state.verification.verifiedFingerprint !== state.businessFingerprint) {
      throw new DevFlowError("VERIFICATION_STALE", "protected files changed or verification did not pass");
    }
    const orderedSteps = routeDefinitionForFeature(state.route, state.workflowCapabilities).orderedSteps;
    const featureCheckIndex = orderedSteps.indexOf("feature_check");
    for (const step of orderedSteps.slice(0, featureCheckIndex)) {
      const required = requiredEvidenceForStep(
        state.route,
        state.classification.riskLabels,
        step,
        state.workflowCapabilities,
      );
      if (requiredEvidenceIsEmpty(required)) continue;
      assertRequiredEvidence(step, required, state.steps[step]?.evidence);
    }
    state.featureCheck = { passed: true, fingerprint: state.businessFingerprint };
    state.steps.feature_check = { status: "satisfied" };
  });
}

export async function finalize(
  root: string,
  id: string,
  expectedRevision: number,
): Promise<FeatureState> {
  const initial = await readState(root, id);
  if (initial.revision !== expectedRevision) {
    throw new DevFlowError("STATE_REVISION_CONFLICT", "state revision changed", {
      currentRevision: initial.revision,
    });
  }
  await assertRequirementsGrillSatisfied(root, id, initial);
  await invalidateBeforeFinalClaim(root, id, expectedRevision);
  await assertArtifactIntegrity(root, id);
  const config = await readProjectConfig(root);
  let snapshot: DeliverySnapshot | undefined;
  return mutate(root, id, expectedRevision, "finalized", async (state) => {
    await assertRequirementsGrillSatisfied(root, id, state);
    assertVerificationWasNotInvalidated(state);
    const route = routeDefinitionForFeature(state.route, state.workflowCapabilities);
    assertCurrentStep(state, "finalize");
    await assertTraceGateCurrent(root, state, "finalize");
    if (route.featureCheckRequired
      && (!state.featureCheck.passed || state.featureCheck.fingerprint !== state.businessFingerprint)) {
      throw new DevFlowError("FEATURE_CHECK_REQUIRED", "feature check is required");
    }
    snapshot = await createDeliverySnapshot(root, id, state, config);
    if (snapshot) state.deliverySnapshot = snapshot;
    state.logicComplete = true;
    state.lifecycle = "finalized";
    state.steps.finalize = { status: "satisfied" };
  }, () => snapshot ? { deliverySnapshot: snapshot } : {});
}
