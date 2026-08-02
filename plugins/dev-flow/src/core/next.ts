import { checkpointsEnforcementRequired, reviewEnforcementRequired, routeDefinitionForFeature } from "../policy/contract.js";
import { deriveNext } from "../policy/derive-next.js";
import { requiredEvidenceForStep, requiredEvidenceIsEmpty } from "../policy/evidence.js";
import type { NextAction } from "../policy/types.js";
import type { RollbackNode } from "../policy/traceability.js";
import { readState, type FeatureState } from "./state-store.js";
import { inspectTraceGate } from "./traceability-gates.js";
import { readTraceability } from "./traceability-store.js";
import { verificationIsStale } from "./verification.js";
import { assertReviewComplete } from "./review-jobs.js";
import { readReviewLedger } from "./review-store.js";
import { assertCurrentReviewProjection } from "./review-projection.js";

function toDerivedState(state: FeatureState, verificationStale: boolean) {
  const steps: Record<string, { status: "pending" | "satisfied"; artifactReady?: boolean }> = { ...state.steps };
  if (verificationStale) steps.verification = { status: "pending" };
  for (const [approvalId, snapshot] of Object.entries(state.humanGates)) {
    const value = snapshot as { status?: string };
    if (approvalId.startsWith("approval:") && (value.status === "pending" || value.status === "returned")) {
      steps[approvalId] = { status: "pending", artifactReady: true };
    }
  }
  return {
    schemaVersion: state.schemaVersion,
    lifecycle: state.lifecycle,
    route: state.route,
    steps,
    obligations: state.obligations,
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
    repair: state.repair,
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
  if (action.kind === "run-step") {
    if (action.step === "requirements_alignment") return "requirements";
    if (action.step === "planning") return "implementation_plan";
    return action.step;
  }
  if (action.kind === "present-human-gate") return action.step.startsWith("approval:") ? "implementation_plan" : action.step;
  if (action.kind === "feature-check") return "feature_check";
  if (action.kind === "finalize") return "finalize";
  return undefined;
}

/**
 * Review jobs are state-machine actions, not a suggestion embedded in a Skill.
 * No job output is exposed here: callers only receive the work queue metadata.
 */
async function reviewPlanAction(root: string, state: FeatureState): Promise<NextAction | undefined> {
  if (!reviewEnforcementRequired(state.route, state.workflowCapabilities)) return undefined;
  const ledger = await readReviewLedger(root, state);
  const batch = ledger.batches.find((candidate) => candidate.validity === "current");
  if (!batch) return { kind: "create-review-batch", step: "planning" };
  if (batch.progress !== "complete") {
    return {
      kind: "review-jobs-pending",
      step: "planning",
      batchId: batch.batchId,
      jobs: batch.jobs.map(({ jobId, role, reviewDepth, status }) => ({ jobId, role, reviewDepth, status })),
    };
  }
  try {
    await assertReviewComplete(root, state);
    return undefined;
  } catch (error) {
    const code = (error as { code?: unknown }).code;
    if (code === "REVIEW_BASIS_STALE" || code === "REVIEW_BATCH_REQUIRED") {
      return { kind: "create-review-batch", step: "planning" };
    }
    if (code === "REVIEW_BLOCKING_FINDINGS" || code === "REVIEW_BATCH_INCOMPLETE") {
      return {
        kind: "review-jobs-pending",
        step: "planning",
        batchId: batch.batchId,
        jobs: batch.jobs.map(({ jobId, role, reviewDepth, status }) => ({ jobId, role, reviewDepth, status })),
      };
    }
    throw error;
  }
}

/**
 * During the implementation step of a checkpoints:1 feature, the next action
 * is the unit lifecycle itself: checkpoint the active unit, or begin the
 * first pending unit whose dependencies are all checkpointed. Only when every
 * rollback unit is checkpointed may the route record implementation.
 */
async function unitLifecycleAction(root: string, state: FeatureState): Promise<NextAction | undefined> {
  if (!checkpointsEnforcementRequired(state.route, state.workflowCapabilities)) return undefined;
  const units = state.implementationUnits ?? [];
  const active = units.find((unit) => unit.status === "active");
  if (active) return { kind: "checkpoint-implementation-unit", unitId: active.unitId };
  const ledger = await readTraceability(root, state);
  const nodes = Object.values(ledger.nodes)
    .filter((node): node is RollbackNode => node.kind === "rollback" && node.status === "current")
    .sort((a, b) => a.id.localeCompare(b.id));
  const statusByUnit = new Map(units.map((unit) => [unit.unitId, unit.status]));
  const ready = nodes.find((node) =>
    statusByUnit.get(node.id) !== "checkpointed"
    && node.dependsOn.every((dependency) => statusByUnit.get(dependency) === "checkpointed"));
  return ready ? { kind: "begin-implementation-unit", unitId: ready.id } : undefined;
}

export async function nextAction(root: string, id: string): Promise<NextAction> {
  const state = await readState(root, id);
  if (state.mode === "intake") {
    const openDecisions = (state.decisionLedger ?? []).filter((decision) => decision.status === "open");
    return openDecisions.length
      ? { kind: "intake", activity: "resolve-decision", reason: `${openDecisions.length} 个决策仍待用户确认` }
      : { kind: "intake", activity: "investigate", reason: "读取需求、代码、文档和测试，生成 classificationBasis 后锁定路线" };
  }
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

  // A rollback can stale the review batch while planning evidence remains
  // satisfied and implementation becomes the derived route step. Review is
  // still a prerequisite of beginning a replacement unit. Artifact
  // scaffolding must happen first so the immutable review basis always
  // includes the current implementation plan.
  if (action.kind === "run-step" && (action.step === "planning" || action.step === "implementation")) {
    const reviewAction = await reviewPlanAction(root, state);
    if (reviewAction) return reviewAction;
    if (action.step === "planning") {
      // A complete ledger is necessary but not sufficient: the generated
      // projection is a registered artifact and must still be readable/current.
      await assertCurrentReviewProjection(root, state);
    }
  }

  // Check trace gate before unit lifecycle derivation — corrupted or stale
  // trace must return repair-trace, not crash or suggest stale units.
  const traceStep = traceStepForAction(action);
  if (traceStep) {
    const trace = await inspectTraceGate(root, state, traceStep);
    if (trace.blocker) return { kind: "repair-trace", ...trace.blocker };
  }

  if (action.kind === "run-step" && action.step === "implementation") {
    const unitAction = await unitLifecycleAction(root, state);
    if (unitAction) return unitAction;
  }

  if (action.kind === "run-step" && action.step === "feature_check") return enrichFeatureCheck(state);
  if (action.kind === "run-step" && action.step === "finalize") return { kind: "finalize" };
  if (action.kind === "run-step") return enrichRunStep(state, action.step);
  if (action.kind === "feature-check") return enrichFeatureCheck(state);
  return action;
}
