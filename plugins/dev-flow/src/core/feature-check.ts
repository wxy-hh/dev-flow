import { routeDefinitionForFeature, checkpointsEnforcementRequired, reviewEnforcementRequired } from "../policy/contract.js";
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
import { satisfyObligations } from "../policy/obligations.js";
import { reconcileWorkspaceLineage } from "./git-reconciliation.js";
import { hasCurrentQualityException } from "./quality-exceptions.js";

function assertRequiredEvidence(step: string, required: RequiredEvidence, evidence: unknown): void {
  const missing = missingRequiredEvidence(required, evidence);
  if (requiredEvidenceIsEmpty(missing)) return;
  const details = { step, requiredEvidence: required, missing };
  if (missing.fields.reviewType !== undefined) {
    throw new DevFlowError("REVIEW_TYPE_MISMATCH", `${step} reviewType is missing or incorrect`, details);
  }
  throw new DevFlowError("RISK_EVIDENCE_INCOMPLETE", `${step} evidence is incomplete`, details);
}

function assertRecordableStep(state: FeatureState, step: string): void {
  if (state.lifecycle !== "active") {
    throw new DevFlowError("INVALID_LIFECYCLE", "only active features can record steps");
  }
  const route = routeDefinitionForFeature(state.route, state.workflowCapabilities);
  if (["verification", "feature_check", "finalize"].includes(step)
    || !route.orderedSteps.includes(step)) {
    const recoveryHint = step === "verification"
      ? "请调用 dev_flow_verify"
      : step === "feature_check"
        ? "请调用 dev_flow_feature_check"
        : step === "finalize"
          ? "请调用 dev_flow_finalize"
          : "请使用当前路线允许的 record_step 阶段";
    throw new DevFlowError("INVALID_STEP", step, { recoveryHint });
  }
  assertCurrentStep(state, step);
}

function satisfyStepObligations(state: FeatureState, route: ReturnType<typeof routeDefinitionForFeature>, step: string): void {
  // L's plan is the rollback strategy obligation. The standard L trace gate
  // has already validated its rollback graph before this point; light L uses
  // the registered plan as its intentionally lighter evidence boundary.
  if (step === "planning" && (state.route === "light-l" || state.route === "standard-l")) {
    state.obligations = satisfyObligations(state.obligations, ["rollback"]);
  }
  // Risk review is a single explicit evidence check on light/XS/S routes. A
  // standard route keeps the independent multi-role review batch as its sole
  // review completion source.
  const riskReviewTarget = route.orderedSteps.includes("code_review")
    ? "code_review"
    : route.orderedSteps.includes("planning")
      ? "planning"
      : route.orderedSteps.includes("verification") ? "verification" : undefined;
  if (step === riskReviewTarget
    && state.classification.riskLabels.length > 0) {
    if (!reviewEnforcementRequired(state.route, state.workflowCapabilities)) {
      state.obligations = satisfyObligations(state.obligations, ["review"]);
    }
    if (state.classification.riskLabels.includes("irreversible_consequence")) {
      state.obligations = satisfyObligations(state.obligations, ["rollback"]);
    }
  }
}

export async function recordStep(
  root: string,
  id: string,
  expectedRevision: number,
  step: string,
  evidence: unknown,
): Promise<FeatureState> {
  let normalizedEvidence = evidence;
  const initial = await readState(root, id);
  if (initial.revision !== expectedRevision) {
    throw new DevFlowError("STATE_REVISION_CONFLICT", "state revision changed", {
      currentRevision: initial.revision,
    });
  }
  assertRecordableStep(initial, step);
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
    assertRecordableStep(state, step);
    const route = routeDefinitionForFeature(state.route, state.workflowCapabilities);
    await assertRequirementsGrillSatisfied(root, id, state);
    await assertTraceGateCurrent(root, state, step);
    if (step === "implementation" && state.schemaVersion === 3 && checkpointsEnforcementRequired(state.route, state.workflowCapabilities)) {
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
    satisfyStepObligations(state, route, step);
    const next = route.orderedSteps.find((candidate) => state.steps[candidate]?.status !== "satisfied");
    state.currentStage = next;
  });
  if (next.schemaVersion === 3 && next.currentStage === "implementation" && !next.checkpoints?.length) {
    return captureAutomaticCheckpoint(root, id, next.revision, "implementation", "implementation-entry");
  }
  if (step === "implementation" && next.schemaVersion === 3 && next.checkpoints?.length) {
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
  const state = await readState(root, id);
  if (hasCurrentQualityException(state, "verification")) return;
  const invalidated = await invalidateStaleVerification(root, id, expectedRevision);
  if (invalidated) {
    throw new DevFlowError("VERIFICATION_STALE", "protected files changed; rerun verification", {
      currentRevision: invalidated.revision,
    });
  }
}

function assertVerificationWasNotInvalidated(state: FeatureState): void {
  const evidence = state.steps.verification?.evidence as { reason?: unknown } | undefined;
  if (evidence?.reason === "protected-files-changed" && !hasCurrentQualityException(state, "verification")) {
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
    if (state.verification.verifiedFingerprint !== state.businessFingerprint && !hasCurrentQualityException(state, "verification")) {
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
  const reconciledWorkspace = initial.workspace.baseHead
    ? await reconcileWorkspaceLineage(root, initial.workspace, config)
    : initial.workspace;
  let snapshot: DeliverySnapshot | undefined;
  return mutate(root, id, expectedRevision, "finalized", async (state) => {
    await assertRequirementsGrillSatisfied(root, id, state);
    assertVerificationWasNotInvalidated(state);
    const route = routeDefinitionForFeature(state.route, state.workflowCapabilities);
    state.workspace = reconciledWorkspace;
    assertCurrentStep(state, "finalize");
    await assertTraceGateCurrent(root, state, "finalize");
    if (route.featureCheckRequired
      && (!state.featureCheck.passed || state.featureCheck.fingerprint !== state.businessFingerprint)) {
      throw new DevFlowError("FEATURE_CHECK_REQUIRED", "feature check is required");
    }
    const requiredKinds = new Set(["approval", "checkpoint", "verification"]);
    for (const obligation of state.obligations ?? []) {
      if (["review", "rollback"].includes(obligation.kind)) requiredKinds.add(obligation.kind);
    }
    const pending = (state.obligations ?? [])
      .filter((obligation) => requiredKinds.has(obligation.kind) && obligation.status !== "satisfied")
      .map(({ id, kind, status, reason }) => ({ id, kind, status, reason }));
    if (pending.length) {
      throw new DevFlowError("OBLIGATIONS_INCOMPLETE", "required workflow obligations are not satisfied", {
        obligations: pending,
        recoveryHint: "请按 dev_flow_status 和对应 inspect 主题完成确认、审查、验证或回撤策略后重试完成",
      });
    }
    snapshot = await createDeliverySnapshot(root, id, state, config);
    if (snapshot) state.deliverySnapshot = snapshot;
    state.logicComplete = true;
    state.lifecycle = "finalized";
    state.steps.finalize = { status: "satisfied" };
    state.currentStage = "complete";
  }, () => snapshot ? { deliverySnapshot: snapshot } : {});
}
