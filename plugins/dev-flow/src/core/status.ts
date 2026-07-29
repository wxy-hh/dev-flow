import { readFile } from "node:fs/promises";
import path from "node:path";
import { routeDefinitionForFeature } from "../policy/contract.js";
import type { NextAction, RequiredEvidence } from "../policy/types.js";
import { DevFlowError } from "./errors.js";
import { gateReplyHint, type GateId } from "./gate-approval.js";
import { nextAction } from "./next.js";
import { parseGrillFrontMatter } from "./requirements-grill.js";
import { readState, type FeatureState } from "./state-store.js";
import { fallbackHint, findInteractionForTarget, toPublicInteraction, type PublicInteraction } from "./user-interactions.js";
import { readVerificationFreshness, type VerificationFreshness } from "./verification.js";

export type ProgressWait =
  | { kind: "none" }
  | { kind: "human-gate"; gate: GateId; replyHint: string; interaction?: PublicInteraction; feedback?: string }
  | { kind: "grill"; questionId: string; responseHint: string; questionLimit: number; interaction?: PublicInteraction };

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

export type StatusView = FeatureState & { progress: Progress };

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
    questionLimit: grill.questionLimit ?? 5,
    ...(interaction ? { interaction: toPublicInteraction(interaction) } : {}),
  };
}

export async function buildProgress(
  root: string,
  state: FeatureState,
  action: NextAction,
): Promise<Progress> {
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
    const gate = action.step as GateId;
    const interaction = findInteractionForTarget(state, `gate:${gate}`);
    const snapshot = state.humanGates[gate] as { status?: string; lastResponse?: { comment?: string } } | undefined;
    const returned = snapshot?.status === "returned";
    wait = {
      kind: "human-gate",
      gate,
      replyHint: returned
        ? "已记录修改意见；请先更新并登记门禁依据，再展示新的确认控件"
        : interaction ? fallbackHint(interaction) : gateReplyHint(gate),
      ...(interaction ? { interaction: toPublicInteraction(interaction) } : {}),
      ...(returned && snapshot?.lastResponse?.comment ? { feedback: snapshot.lastResponse.comment } : {}),
    };
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

export async function readStatusView(root: string, featureId: string): Promise<StatusView> {
  const state = await readState(root, featureId);
  const action = await nextAction(root, featureId);
  const progress = await buildProgress(root, state, action);
  return { ...state, progress };
}
