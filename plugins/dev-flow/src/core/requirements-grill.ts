import { assertArtifactCurrent } from "./artifacts.js";
import { DevFlowError } from "./errors.js";
import { mutate, readFeatureEvents, readState, type FeatureState } from "./state-store.js";
import { resolveDecision } from "./decision-ledger.js";
import { decisionBasisHash } from "../policy/obligations.js";
import { resolvePromptEvent } from "./interaction-provenance.js";
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

export interface GrillDecisionInput {
  questionId: string;
  question: string;
  options: InteractionOption[];
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
    });
    const ledger = draft.decisionLedger ?? [];
    const index = ledger.findIndex((decision) => decision.id === input.questionId);
    if (index >= 0) ledger[index] = { ...ledger[index], question: input.question, status: "open", evidence: undefined, conclusion: undefined, source: "grill" };
    else ledger.push({ id: input.questionId, question: input.question, status: "open", source: "grill" });
    draft.decisionLedger = ledger;
    draft.lastUpdatedBy = { host: input.host, pluginVersion: __DEV_FLOW_VERSION__ };
  }, () => ({ questionId: input.questionId, mode: "decision" }));
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
  if (input.source === "text") {
    const events = await readFeatureEvents(root, id);
    const match = resolvePromptEvent(events, {
      host,
      userReply: input.userReply,
      presentedAt: interaction.presentedAt,
      presentedRevision: initial.pendingDecision?.presentedRevision ?? initial.revision - 1,
    });
    promptEventId = match.eventId;
  }
  let response: InteractionResponse | undefined;
  const state = await mutate(root, id, expectedRevision, "decision-answered", (draft) => {
    response = input.source === "elicitation"
      ? resolveNativeInteraction(draft, interactionId, input.action, input.comment, host)
      : resolveTextInteraction(draft, interactionId, input.userReply, host, { promptEventId });
    const decisionId = interaction.target.slice("grill:".length);
    const index = (draft.decisionLedger ?? []).findIndex((decision) => decision.id === decisionId);
    if (index >= 0 && response) {
      const next = [...(draft.decisionLedger ?? [])];
      next[index] = resolveDecision(next[index], input.source === "elicitation" ? (input.comment ?? "用户选择") : input.userReply, response.action);
      draft.decisionLedger = next;
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
  }) || state.pendingDecision?.kind === "grill";
  if (pending) throw new DevFlowError("GRILL_INCOMPLETE", "还有一个需求问题等待回答。", { userMessage: "需求澄清还没有完成。", cause: "决策账本仍有待回答的 grill 问题。", impact: "当前路线不能进入下一步。", recoveryKind: "retry", recoveryInstruction: "先回答当前唯一问题，再继续当前步骤。", retryOriginal: true });
  const openDecision = (state.decisionLedger ?? []).find((decision) => decision.source === "grill" && decision.status === "open");
  if (openDecision) throw new DevFlowError("GRILL_INCOMPLETE", "需求决策账本仍有未收敛问题。", { userMessage: "需求澄清还没有完成。", cause: "决策账本中存在 open grill decision。", impact: "系统不会从 Markdown 字段猜测完成态。", recoveryKind: "retry", recoveryInstruction: "回答当前问题后重新登记真实需求内容。", retryOriginal: true });
}
