import { assertArtifactCurrent } from "./artifacts.js";
import { DevFlowError } from "./errors.js";
import { mutate, readFeatureEvents, readState, type FeatureState } from "./state-store.js";
import { decisionBasisHash } from "../policy/obligations.js";
import { resolveInteractionPromptEvent } from "./interaction-provenance.js";
import { pendingDecisionForState } from "./decision-interactions.js";
import { EMPTY_GOVERNANCE_LEDGER } from "../policy/types.js";
import {
  createInteraction,
  findInteractionForTarget,
  getInteraction,
  resolveNativeInteraction,
  resolveTextInteraction,
  toPublicInteraction,
  type InteractionOption,
  type InteractionResponse,
  type PublicInteraction,
} from "./user-interactions.js";
import type { GrillRecommendation } from "./grill-interaction.js";

export interface GrillDecisionInput {
  questionId: string;
  question: string;
  options: InteractionOption[];
  recommendation: GrillRecommendation;
  host: "claude" | "codex";
}

export interface GrillDecisionResult {
  state: FeatureState;
  interaction: PublicInteraction;
  response?: InteractionResponse;
  /** Internal correlation used by the MCP server; never serialized in content. */
  interactionId: string;
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

async function resolveGrillDecision(
  root: string,
  id: string,
  expectedRevision: number,
  interactionId: string,
  host: "claude" | "codex",
  input: { source: "elicitation"; action: string; comment?: string } | { source: "text"; userReply: string },
): Promise<GrillDecisionResult> {
  const initial = await readState(root, id);
  if (initial.revision !== expectedRevision) throw new DevFlowError("STATE_REVISION_CONFLICT", "state revision changed", { currentRevision: initial.revision });
  const interaction = getInteraction(initial, interactionId);
  if (interaction.kind !== "grill" || interaction.status !== "pending") throw new DevFlowError("INTERACTION_NOT_PENDING", "当前问题已经处理或不存在。", { interactionId });
  let promptEventId: string | undefined;
  let promptText: string | undefined;
  if (input.source === "text") {
    const events = await readFeatureEvents(root, id);
    const match = resolveInteractionPromptEvent(events, initial, interaction, {
      host,
      userReply: input.userReply,
    });
    promptEventId = match.eventId;
    promptText = match.text;
  }
  let response: InteractionResponse | undefined;
  const state = await mutate(root, id, expectedRevision, "decision-answered", (draft) => {
    response = input.source === "elicitation"
      ? resolveNativeInteraction(draft, interactionId, input.action, input.comment, host)
      : resolveTextInteraction(draft, interactionId, promptText ?? input.userReply, host, { promptEventId });
    const decisionId = interaction.target.slice("grill:".length);
    if (response) {
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
      if (!credentials.some((credential) => credential.recordId === credentialId)) {
        credentials.push({
          recordId: credentialId,
          kind: "credential",
          source: input.source === "elicitation" ? "native-form" : "text",
          host,
          interactionId,
          ...(response.selectedOptionId ? { optionId: response.selectedOptionId } : {}),
          ...(response.rawReply ? { rawText: response.rawReply } : {}),
          ...(input.source === "text" && promptEventId ? { basis: { kind: "event", eventId: promptEventId } } : {}),
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
          ...(input.source === "text" && promptEventId ? { basis: { kind: "event", eventId: promptEventId } } : {}),
          recordedAt: response.respondedAt,
        });
      }
      draft.governance = { ...existingGovernance, decisions, credentials };
    }
    draft.lastUpdatedBy = { host, pluginVersion: __DEV_FLOW_VERSION__ };
  }, { interactionId, mode: "decision" });
  if (!response) throw new DevFlowError("INTERACTION_NOT_RESOLVED", "当前问题没有完成回答。", { interactionId });
  return { state, interaction: toPublicInteraction(getInteraction(state, interactionId)), response, interactionId };
}

export async function resolveGrillElicitation(root: string, id: string, expectedRevision: number, interactionId: string, action: string, comment: string | undefined, host: "claude" | "codex"): Promise<GrillDecisionResult> {
  return resolveGrillDecision(root, id, expectedRevision, interactionId, host, { source: "elicitation", action, comment });
}

export async function resolveGrillAnswer(root: string, id: string, expectedRevision: number, interactionId: string, userReply: string, host: "claude" | "codex"): Promise<GrillDecisionResult> {
  return resolveGrillDecision(root, id, expectedRevision, interactionId, host, { source: "text", userReply });
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
