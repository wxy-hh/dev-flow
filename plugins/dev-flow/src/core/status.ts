import { readFile } from "node:fs/promises";
import path from "node:path";
import { checkpointsEnforcementRequired, routeDefinitionForFeature } from "../policy/contract.js";
import type { NextAction, RequiredEvidence, StageCapabilityView } from "../policy/types.js";
import type { RollbackNode, TraceSummary, TraceabilityPointer } from "../policy/traceability.js";
import { DevFlowError } from "./errors.js";
import { approvalReplyHint, type ApprovalId } from "./approval.js";
import { nextAction } from "./next.js";
import { parseGrillFrontMatter } from "./requirements-grill.js";
import { readProjectConfig, readState, type FeatureState } from "./state-store.js";
import { inspectCurrentTrace, type TraceBlocker } from "./traceability-gates.js";
import { readTraceability } from "./traceability-store.js";
import { fallbackHint, findInteractionForTarget, toPublicInteraction, type PublicInteraction } from "./user-interactions.js";
import { readVerificationFreshness, type VerificationFreshness } from "./verification.js";
import { readReviewProjection, type ReviewProjection } from "./review-projection.js";
import { rollbackChainView, type RollbackChainView } from "./rollback.js";
import { buildExecutionBrief, type ExecutionBrief } from "./execution-brief.js";
import { analyzeDrift, type DriftReport } from "./drift-analysis.js";
import { snapshotProtectedRoots } from "./fingerprint.js";
import { deriveStageCapabilities } from "../policy/stages.js";

export type ProgressWait =
  | { kind: "none" }
  | { kind: "approval"; approvalId: ApprovalId; replyHint: string; interaction?: PublicInteraction; feedback?: string }
  | { kind: "grill"; questionId: string; responseHint: string; interaction?: PublicInteraction }
  | { kind: "recovery"; reason: string; recoveryAction: import("../policy/types.js").RecoveryAction };

export interface Progress {
  stepIndex: number;
  stepTotal: number;
  currentStep?: string;
  nextAction: NextAction;
  wait: ProgressWait;
  remainingSteps: string[];
  requiredEvidence?: RequiredEvidence;
  verificationFreshness: VerificationFreshness;
  acceptanceAssist: { suggested: boolean; blocking: false };
}

export interface TraceStatus {
  enforced: boolean;
  pointer?: TraceabilityPointer;
  effectiveSummary?: TraceSummary;
  blockers: TraceBlocker[];
}

/** Status JSON exposes the same derived model used to render plan-review.md. */
export interface ReviewStatus {
  enforced: boolean;
  projection?: ReviewProjection;
}

/** Unit lifecycle digest for the implementation step of a checkpoints:1 feature. */
export interface ImplementationStatus {
  enforced: boolean;
  activeUnitId?: string;
  lastCheckpointId?: string;
  remainingUnitIds: string[];
}

export type StatusView = FeatureState & {
  progress: Progress;
  trace: TraceStatus;
  reviewStatus: ReviewStatus;
  implementation: ImplementationStatus;
  rollback: RollbackChainView;
  stageCapabilities: StageCapabilityView;
  executionBrief?: ExecutionBrief;
  drift?: DriftReport;
};

/**
 * Public next/status consumers receive the stage contract, while Core keeps
 * the exact scheduler action private for deterministic route execution.
 */
export function stageCapabilitiesForAction(
  state: FeatureState,
  action: NextAction,
): StageCapabilityView {
  const base = deriveStageCapabilities(state);
  if (action.kind === "waiting-user") {
    return { ...base, recoveryAction: action.recoveryAction, attention: { reason: action.reason, required: true } };
  }
  if (action.kind === "stop") {
    return { ...base, attention: { reason: action.reason, required: true } };
  }
  if (action.kind === "present-human-gate" || action.kind === "wait-human-gate") {
    return { ...base, attention: { reason: "approval-required", required: true } };
  }
  if (action.kind === "repair-trace") {
    return { ...base, recoveryAction: { kind: "retry", reason: "Trace evidence needs repair before the stage can continue" }, attention: { reason: action.code, required: true } };
  }
  return base;
}

async function traceStatus(root: string, state: FeatureState): Promise<TraceStatus> {
  if (state.mode === "intake") return { enforced: false, blockers: [] };
  const inspection = await inspectCurrentTrace(root, state);
  return {
    enforced: inspection.enforced,
    ...(inspection.enforced && state.traceability ? { pointer: state.traceability } : {}),
    ...(inspection.effectiveSummary ? { effectiveSummary: inspection.effectiveSummary } : {}),
    blockers: inspection.blocker ? [inspection.blocker] : [],
  };
}

async function reviewStatus(root: string, state: FeatureState): Promise<ReviewStatus> {
  if (state.mode === "intake") return { enforced: false };
  const projection = await readReviewProjection(root, state);
  return {
    enforced: Boolean(projection),
    ...(projection ? { projection: projection.model } : {}),
  };
}

async function grillWait(root: string, state: FeatureState, action: NextAction): Promise<ProgressWait> {
  if (action.kind !== "run-step" || action.step !== "requirements") return { kind: "none" };
  const artifact = state.artifacts.requirements;
  if (!artifact) return { kind: "none" };
  let contents: string;
  try {
    contents = await readFile(path.join(root, ".dev-flow", "features", state.featureId, artifact.path), "utf8");
  } catch {
    throw new DevFlowError("GRILL_STATUS_INVALID", "registered requirements artifact cannot be read", {
      recoveryHint: "Restore or re-scaffold the requirements artifact through MCP, then record it before continuing",
    });
  }
  const grill = parseGrillFrontMatter(contents);
  if (grill.status !== "in_progress") return { kind: "none" };
  const interaction = findInteractionForTarget(state, `grill:${grill.questionId!}`);
  return {
    kind: "grill",
    questionId: grill.questionId!,
    responseHint: interaction ? fallbackHint(interaction) : grill.responseHint!,
    ...(interaction ? { interaction: toPublicInteraction(interaction) } : {}),
  };
}

export async function buildProgress(
  root: string,
  state: FeatureState,
  action: NextAction,
): Promise<Progress> {
  if (state.mode === "intake") {
    return {
      stepIndex: 1,
      stepTotal: 1,
      currentStep: "intake",
      nextAction: action,
      wait: { kind: "none" },
      remainingSteps: ["intake"],
      verificationFreshness: { status: "missing" },
      acceptanceAssist: { suggested: false, blocking: false },
    };
  }
  const ordered = routeDefinitionForFeature(state.route, state.workflowCapabilities).orderedSteps;
  const stepTotal = ordered.length;
  let currentStep: string | undefined;
  let stepIndex = stepTotal;
  for (let index = 0; index < ordered.length; index += 1) {
    const step = ordered[index];
    const staleVerification = step === "verification"
      && action.kind === "run-step"
      && action.step === "verification";
    if (state.steps[step]?.status === "satisfied" && !staleVerification) continue;
    currentStep = step;
    stepIndex = index + 1;
    break;
  }
  if (state.lifecycle === "finalized" || action.kind === "done") {
    currentStep = undefined;
    stepIndex = stepTotal;
  }

  let wait: ProgressWait = { kind: "none" };
  if (action.kind === "present-human-gate" || action.kind === "wait-human-gate") {
    const approvalId = action.step as ApprovalId;
    const interaction = findInteractionForTarget(state, `approval:${approvalId}`);
    const snapshot = state.humanGates[approvalId] as { status?: string; lastResponse?: { comment?: string } } | undefined;
    const returned = snapshot?.status === "returned";
    wait = {
      kind: "approval",
      approvalId,
      replyHint: returned
        ? "已记录修改意见；请先更新并登记门禁依据，再展示新的确认控件"
        : interaction ? fallbackHint(interaction) : approvalReplyHint(),
      ...(interaction ? { interaction: toPublicInteraction(interaction) } : {}),
      ...(returned && snapshot?.lastResponse?.comment ? { feedback: snapshot.lastResponse.comment } : {}),
    };
  } else if (action.kind === "waiting-user") {
    wait = { kind: "recovery", reason: action.reason, recoveryAction: action.recoveryAction };
  } else {
    wait = await grillWait(root, state, action);
  }

  const remainingSteps = ordered.filter((step) => state.steps[step]?.status !== "satisfied"
    || (step === "verification" && action.kind === "run-step" && action.step === "verification"));
  const requiredEvidence = action.kind === "run-step" || action.kind === "feature-check"
    ? action.requiredEvidence
    : undefined;
  return {
    stepIndex,
    stepTotal,
    currentStep,
    nextAction: action,
    wait,
    remainingSteps,
    ...(requiredEvidence ? { requiredEvidence } : {}),
    verificationFreshness: await readVerificationFreshness(root, state),
    acceptanceAssist: {
      suggested: state.classification.acceptanceAssistSuggested
        ?? (state.classification as { manualAcceptanceRequired?: boolean }).manualAcceptanceRequired === true,
      blocking: false,
    },
  };
}

/**
 * Unit lifecycle digest: remaining units come from the current trace ledger
 * (units not yet begun count too); fail-soft when the ledger is unreadable,
 * since view.trace.blockers already reports the corruption.
 */
async function implementationStatus(root: string, state: FeatureState, rollback: RollbackChainView): Promise<ImplementationStatus> {
  if (state.mode === "intake") return { enforced: false, remainingUnitIds: [] };
  if (!checkpointsEnforcementRequired(state.route, state.workflowCapabilities)) {
    return { enforced: false, remainingUnitIds: [] };
  }
  let remainingUnitIds: string[] = [];
  try {
    const ledger = await readTraceability(root, state);
    const byUnit = new Map((state.implementationUnits ?? []).map((unit) => [unit.unitId, unit.status]));
    remainingUnitIds = Object.values(ledger.nodes)
      .filter((node): node is RollbackNode => node.kind === "rollback" && node.status === "current")
      .map((node) => node.id)
      .filter((unitId) => byUnit.get(unitId) !== "checkpointed")
      .sort();
  } catch {
    remainingUnitIds = [];
  }
  const active = (state.implementationUnits ?? []).find((unit) => unit.status === "active");
  return {
    enforced: true,
    ...(active ? { activeUnitId: active.unitId } : {}),
    ...(rollback.chain.length ? { lastCheckpointId: rollback.chain.at(-1)!.checkpointId } : {}),
    remainingUnitIds,
  };
}

async function driftStatus(root: string, state: FeatureState): Promise<DriftReport | undefined> {
  const checkpoint = state.checkpoints?.at(-1);
  if (state.mode === "intake" || !checkpoint) return undefined;
  const config = await readProjectConfig(root);
  const actual = (await snapshotProtectedRoots(root, config.protectedRoots)).map((file) => file.path);
  const anticipated = checkpoint.files;
  const changed = actual.length !== anticipated.length || actual.some((file, index) => file !== anticipated[index]);
  if (!changed) return undefined;
  const knownOutOfScope = state.scope.outOfScope.filter((item) => actual.includes(item));
  return analyzeDrift({
    anticipatedFiles: anticipated,
    actualFiles: actual,
    outOfScope: knownOutOfScope,
    touchesSharedContract: state.classification.topology !== "local",
    classificationBasis: state.classificationBasis,
  });
}

export async function readStatusView(root: string, featureId: string): Promise<StatusView> {
  const state = await readState(root, featureId);
  const action = await nextAction(root, featureId);
  const progress = await buildProgress(root, state, action);
  const rollback = await rollbackChainView(root, state);
  const review = await reviewStatus(root, state);
  const drift = await driftStatus(root, state);
  return {
    ...state,
    progress,
    trace: await traceStatus(root, state),
    reviewStatus: review,
    implementation: await implementationStatus(root, state, rollback),
    rollback,
    stageCapabilities: stageCapabilitiesForAction(state, action),
    ...(buildExecutionBrief(state, review.projection) ? { executionBrief: buildExecutionBrief(state, review.projection) } : {}),
    ...(drift ? { drift } : {}),
  };
}
