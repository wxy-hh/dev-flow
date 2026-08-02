import { routeDefinitionForFeature, checkpointsEnforcementRequired } from "../policy/contract.js";
import {
  missingRequiredEvidence,
  requiredEvidenceForStep,
  requiredEvidenceIsEmpty,
} from "../policy/evidence.js";
import type { RequiredEvidence } from "../policy/types.js";
import { assertArtifactIntegrity } from "./artifacts.js";
import { DevFlowError } from "./errors.js";
import {
  assertImplementationFilesExist,
  assertImplementationFilesInProtectedRoots,
  createDeliverySnapshot,
  implementationFiles,
  type DeliverySnapshot,
} from "./delivery-snapshot.js";
import { assertRequirementsGrillSatisfied } from "./requirements-grill.js";
import { mutate, readProjectConfig, readState, type FeatureState } from "./state-store.js";
import { assertCurrentStep } from "./step-order.js";
import { assertTraceGateCurrent } from "./traceability-gates.js";
import { readTraceability } from "./traceability-store.js";
import { invalidateStaleVerification } from "./verification.js";
import { assertReviewComplete } from "./review-jobs.js";
import { captureAutomaticCheckpoint } from "./auto-checkpoint.js";

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
    // Validated before the mutation so a rejected registration leaves the step
    // open and can be re-recorded without a dead end.
    await assertImplementationFilesExist(root, files);
    normalizedEvidence = {
      ...(typeof evidence === "object" && evidence !== null && !Array.isArray(evidence) ? evidence : {}),
      files,
    };
  }
  const next = await mutate(root, id, expectedRevision, "step-recorded", async (state) => {
    if (state.lifecycle !== "active") {
      throw new DevFlowError("INVALID_LIFECYCLE", "only active features can record steps");
    }
    const route = routeDefinitionForFeature(state.route, state.workflowCapabilities);
    if (["verification", "feature_check", "finalize"].includes(step)
      || !route.orderedSteps.includes(step)) {
      throw new DevFlowError("INVALID_STEP", step);
    }
    assertCurrentStep(state, step);
    await assertRequirementsGrillSatisfied(root, id, state);
    await assertTraceGateCurrent(root, state, step);
    if (step === "implementation" && state.schemaVersion !== 2 && checkpointsEnforcementRequired(state.route, state.workflowCapabilities)) {
      await assertImplementationUnitsComplete(root, state);
    }
    const required = requiredEvidenceForStep(
      state.route,
      state.classification.riskLabels,
      step,
      state.workflowCapabilities,
    );
    if (required.fields.reviewBatch) {
      // batch/basis/assurance are Core-owned; callers cannot provide substitutes.
      normalizedEvidence = await assertReviewComplete(root, state);
    } else {
      assertRequiredEvidence(step, required, normalizedEvidence);
    }
    state.steps[step] = { status: "satisfied", evidence: normalizedEvidence };
    const next = route.orderedSteps.find((candidate) => state.steps[candidate]?.status !== "satisfied");
    state.currentStage = next;
  });
  if (next.schemaVersion === 2 && next.currentStage === "implementation" && !next.checkpoints?.length) {
    return captureAutomaticCheckpoint(root, id, next.revision, "implementation", "implementation-entry");
  }
  if (step === "implementation" && next.schemaVersion === 2 && next.checkpoints?.length) {
    return captureAutomaticCheckpoint(root, id, next.revision, "implementation", "implementation-complete");
  }
  return next;
}

async function assertImplementationUnitsComplete(root: string, state: FeatureState): Promise<void> {
  const ledger = await readTraceability(root, state);
  const required = Object.values(ledger.nodes).filter((node) => node.kind === "rollback" && node.status === "current");
  const units = new Map((state.implementationUnits ?? []).map((unit) => [unit.unitId, unit]));
  const incomplete = required
    .map((node) => node.id as `RU-${string}`)
    .filter((nodeId) => units.get(nodeId)?.status !== "checkpointed");
  if (incomplete.length) {
    throw new DevFlowError("IMPLEMENTATION_UNITS_INCOMPLETE", "every rollback unit must be checkpointed before recording implementation", {
      incomplete,
    });
  }
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
      if (required.fields.reviewBatch) {
        await assertReviewComplete(root, state);
        continue;
      }
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
    state.currentStage = undefined;
  }, () => snapshot ? { deliverySnapshot: snapshot } : {});
}
