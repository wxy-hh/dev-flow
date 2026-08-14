import { assertArtifactCurrent } from "./artifacts.js";
import { DevFlowError } from "./errors.js";
import { mutate, mutatePrepared, readFeatureEvents, readState, type FeatureState } from "./state-store.js";
import { decisionBasisHash } from "../policy/obligations.js";
import { resolveInteractionPromptEvent } from "./interaction-provenance.js";
import { pendingDecisionForState } from "./decision-interactions.js";
import { EMPTY_GOVERNANCE_LEDGER } from "../policy/governance-records.js";
import {
  createInteraction,
  findInteractionForTarget,
  resolveResponseForAnswer,
  toPublicInteraction,
  type PresentedInteraction,
  type PublicInteraction,
} from "./user-interactions.js";
import type { GrillRecommendation, InteractionOption, InteractionResponse } from "../policy/interaction.js";
import type { AnswerResolveContext, AnswerResolveResult } from "./interaction-answer.js";

export interface GrillDecisionInput {
  questionId: string;
  question: string;
  options: InteractionOption[];
  recommendation: GrillRecommendation;
  host: "claude" | "codex";
}

export interface GrillDecisionResult extends PresentedInteraction {
  response?: InteractionResponse;
}

async function currentRequirements(root: string, id: string, state: FeatureState): Promise<void> {
  if (!state.artifacts.requirements) throw new DevFlowError("MISSING_REQUIRED_ARTIFACT", "requirements");
  await assertArtifactCurrent(root, id, state, "requirements");
}

export async function requestGrillDecision(
  root: string,
  id: string,
  expectedRevision: number,
  input: GrillDecisionInput,
): Promise<GrillDecisionResult> {
  if (!input.question.trim()) throw new DevFlowError("GRILL_QUESTION_REQUIRED", "问题不能为空。", { userMessage: "当前问题没有内容。", recoveryKind: "retry", recoveryInstruction: "补充一个需要用户决定的问题后重试。", retryOriginal: true });
  // Requirements decisions change the accepted scope or behavior. Core derives
  // them as high-impact; callers cannot silently omit the drawback/alternative
  // reminder to make the prompt shorter.
  if (!input.recommendation.drawback?.trim() || !input.recommendation.alternative?.condition.trim()) {
    throw new DevFlowError("GRILL_HIGH_IMPACT_REMINDER_REQUIRED", "需求决策属于高影响交互，必须说明推荐方案的主要缺点和替代条件。", {
      recoveryHint: "补充 drawback 与 alternative.condition，并让 alternative.optionId 指向非推荐选项后重试。",
      retryOriginal: true,
    });
  }
  const initial = await readState(root, id);
  if (initial.revision !== expectedRevision) throw new DevFlowError("STATE_REVISION_CONFLICT", "state revision changed", { currentRevision: initial.revision });
  if (initial.mode !== "intake") await currentRequirements(root, id, initial);
  const target = `grill:${input.questionId}`;
  const existing = findInteractionForTarget(initial, target);
  if (existing) return { state: initial, interaction: toPublicInteraction(existing), interactionId: existing.id };
  let interaction: ReturnType<typeof createInteraction> | undefined;
  const state = await mutate(root, id, expectedRevision, "decision-presented", (draft) => {
    interaction = createInteraction(draft, {
      kind: "grill",
      target,
      basisHash: decisionBasisHash({ objective: draft.objective, questionId: input.questionId, requirements: draft.artifacts.requirements?.sha256 }),
      question: input.question,
      options: input.options,
      recommendation: input.recommendation,
    });
    draft.lastUpdatedBy = { host: input.host, pluginVersion: __DEV_FLOW_VERSION__ };
  }, () => ({ questionId: input.questionId, mode: "decision", presentationEventId: interaction?.presentationEventId }));
  if (!interaction) throw new DevFlowError("INTERACTION_NOT_CREATED", target);
  return { state, interaction: toPublicInteraction(interaction), interactionId: interaction.id };
}

/** grill 经统一回答入口落账（ADR-0019）：A/B/C 选项或带理由的 other。 */
export async function resolveGrillForAnswer(ctx: AnswerResolveContext): Promise<AnswerResolveResult> {
  const { root, featureId, expectedRevision, host, credential, interaction, state } = ctx;
  if (interaction.kind !== "grill" || interaction.status !== "pending") {
    throw new DevFlowError("INTERACTION_NOT_PENDING", "当前没有待回答的需求问题。", { interactionId: interaction.id });
  }
  let promptEventId: string | undefined;
  let promptText: string | undefined;
  if (credential.source === "text") {
    const events = await readFeatureEvents(root, featureId);
    const match = resolveInteractionPromptEvent(events, state, interaction, { host, userReply: credential.userReply });
    promptEventId = match.eventId;
    promptText = match.text;
  }
  let response: InteractionResponse | undefined;
  const next = await mutatePrepared(root, featureId, expectedRevision, "decision-answered", async () => ({
    mutate: (draft) => {
      response = resolveResponseForAnswer(draft, interaction, { source: credential.source, action: credential.source === "elicitation" ? credential.action : undefined, comment: credential.source === "elicitation" ? credential.comment : undefined, userReply: credential.source === "text" ? credential.userReply : undefined, promptText, promptEventId, host });
      if (!response) throw new DevFlowError("INTERACTION_NOT_RESOLVED", interaction.id);
      const decisionId = interaction.target.slice("grill:".length);
      const existingGovernance = draft.governance ?? EMPTY_GOVERNANCE_LEDGER;
      const previous = existingGovernance.decisions.find((candidate) => candidate.recordId === decisionId && !candidate.supersededBy);
      const recordId = previous ? `${decisionId}-${interaction.id}` : decisionId;
      const decisions = [...existingGovernance.decisions];
      if (previous) {
        const previousIndex = decisions.findIndex((candidate) => candidate.recordId === previous.recordId);
        if (previousIndex >= 0) decisions[previousIndex] = { ...previous, supersededBy: recordId };
      }
      const credentials = [...existingGovernance.credentials];
      const credentialId = `CRED-grill-${interaction.id}`;
      if (!credentials.some((record) => record.recordId === credentialId)) {
        credentials.push({
          recordId: credentialId,
          kind: "credential",
          source: credential.source === "elicitation" ? "native-form" : "text",
          host,
          interactionId: interaction.id,
          ...(response.selectedOptionId ? { optionId: response.selectedOptionId } : {}),
          ...(response.rawReply ? { rawText: response.rawReply } : {}),
          ...(credential.source === "text" && promptEventId ? { basis: { kind: "event", eventId: promptEventId } } : {}),
          recordedAt: response.respondedAt,
        });
      }
      if (!decisions.some((candidate) => candidate.recordId === recordId)) {
        decisions.push({
          recordId,
          kind: "decision",
          question: interaction.question ?? decisionId,
          conclusion: response.action,
          credentialId,
          ...(credential.source === "text" && promptEventId ? { basis: { kind: "event", eventId: promptEventId } } : {}),
          recordedAt: response.respondedAt,
        });
      }
      draft.governance = { ...existingGovernance, decisions, credentials };
      draft.lastUpdatedBy = { host, pluginVersion: __DEV_FLOW_VERSION__ };
    },
    eventData: () => ({ interactionId: interaction.id, mode: "decision" }),
  }));
  if (!response) throw new DevFlowError("INTERACTION_NOT_RESOLVED", interaction.id);
  return { state: next, action: response.action, ...(response.comment ? { comment: response.comment } : {}) };
}

/** Requirements completion is derived from the decision ledger, never Markdown control fields. */
export async function assertRequirementsGrillSatisfied(root: string, id: string, state: FeatureState): Promise<void> {
  if (state.route !== "m" && state.route !== "l") return;
  await currentRequirements(root, id, state);
  const pending = Object.values(state.interactions ?? {}).some((value) => {
    const interaction = value as { kind?: string; status?: string };
    return interaction.kind === "grill" && interaction.status === "pending";
  }) || pendingDecisionForState(state)?.kind === "grill";
  if (pending) throw new DevFlowError("GRILL_INCOMPLETE", "还有一个需求问题等待回答。", { userMessage: "需求澄清还没有完成。", cause: "决策账本仍有待回答的 grill 问题。", impact: "当前路线不能进入下一步。", recoveryKind: "retry", recoveryInstruction: "先回答当前唯一问题，再继续当前步骤。", retryOriginal: true });
}
