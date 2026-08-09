import { isExplicitApproval } from "./approval.js";
import { matchNaturalDecision } from "./decision-language.js";
import { DevFlowError } from "./errors.js";
import { buildGrillPresentation } from "./grill-interaction.js";
import { normalizeReplyText, type InteractionOption, type UserInteraction } from "./user-interactions.js";
import type { FeatureState } from "./state-store.js";
import type { PendingDecision, PendingDecisionKind } from "../policy/types.js";

export interface PublicPendingDecision {
  kind: PendingDecisionKind;
  question: string;
  options: Array<{ label: string; description?: string; answerCode?: "A" | "B" | "C"; recommended: boolean; requiresComment: boolean }>;
  recommendation?: { optionId: string; reason: string };
  presentation?: string;
}

export interface MatchedDecision {
  option: InteractionOption;
  comment?: string;
}

function pendingInteraction(state: FeatureState): UserInteraction | undefined {
  return Object.values(state.interactions ?? {}).find((value) => (value as UserInteraction).status === "pending") as UserInteraction | undefined;
}

function rejectLegacyGrill(): never {
  throw new DevFlowError("GRILL_INTERACTION_RESTART_REQUIRED", "legacy grill state has no explicit recommendation", {
    userMessage: "这个 grill 问题来自旧版交互合同，不能可靠继续。",
    recoveryKind: "repair",
    recoveryInstruction: "放弃受影响的 feature，再用当前版本重新提出该 grill 问题。",
    retryOriginal: false,
  });
}

export function pendingDecisionForState(state: FeatureState): PendingDecision | undefined {
  const interaction = pendingInteraction(state);
  if (interaction) {
    if (interaction.kind === "grill" && !interaction.recommendation) rejectLegacyGrill();
    const grillPresentation = interaction.kind === "grill" && interaction.recommendation
      ? buildGrillPresentation({ question: interaction.question ?? "", options: interaction.options, recommendation: interaction.recommendation })
      : undefined;
    return {
      kind: interaction.kind === "risk-acceptance" ? "review-risk" : interaction.kind,
      question: interaction.question ?? "请选择一个方案。",
      options: grillPresentation
        ? grillPresentation.options.map((option) => ({ ...option }))
        : interaction.options.map((option, index) => ({ ...option, recommended: index === 0 })),
      ...(grillPresentation ? {
        recommendation: { ...grillPresentation.recommendation },
        presentation: grillPresentation.text,
      } : {}),
      basisHash: interaction.basisHash,
      presentedAt: interaction.presentedAt,
      presentedRevision: interaction.presentedRevision ?? state.pendingDecision?.presentedRevision ?? state.revision,
      source: "core",
      target: interaction.target,
      ...(interaction.presentationEventId ? { presentationEventId: interaction.presentationEventId } : {}),
    };
  }
  if (state.pendingDecision?.kind === "grill") rejectLegacyGrill();
  return state.pendingDecision;
}

export function publicPendingDecision(state: FeatureState): PublicPendingDecision | undefined {
  const decision = pendingDecisionForState(state);
  if (!decision) return undefined;
  return {
    kind: decision.kind,
    question: decision.question,
    options: decision.options.map((option, index) => ({
      label: option.label,
      ...(option.description ? { description: option.description } : {}),
      ...(option.answerCode ? { answerCode: option.answerCode } : {}),
      recommended: option.recommended ?? index === 0,
      requiresComment: Boolean(option.requiresComment),
    })),
    ...(decision.recommendation ? { recommendation: { ...decision.recommendation } } : {}),
    ...(decision.presentation ? { presentation: decision.presentation } : {}),
  };
}

export function matchDecisionReply(
  decision: PendingDecision,
  userReply: string,
): MatchedDecision {
  const normalized = normalizeReplyText(userReply);
  if (!normalized) throw new DevFlowError("DECISION_REPLY_REQUIRED", "请回答当前问题。", { userMessage: "当前问题还没有得到回答。", recoveryKind: "retry", recoveryInstruction: "请回复一个选项、能唯一指向它的简称或同义说法。", retryOriginal: true });
  const options = decision.options;
  let match: MatchedDecision | undefined;
  if (decision.kind === "approval" && isExplicitApproval(userReply)) {
    const option = options.find((candidate) => candidate.id === "confirm");
    if (option) match = { option };
  }
  if (!match) match = matchNaturalDecision(decision.kind === "review-risk" ? "risk-acceptance" : decision.kind, options, userReply);
  if (!match) {
    throw new DevFlowError("DECISION_REPLY_NOT_RECOGNIZED", "回答没有精确匹配当前问题的选项。", {
      userMessage: "没有识别出当前问题的有效回答。",
      cause: "回答无法唯一对应当前选项，也不是受支持的批准短语。",
      impact: "当前问题仍保持待回答，没有任何状态被改变。",
      recoveryKind: "retry",
      recoveryInstruction: "请换一种能唯一指向某个选项的简短说法，或直接回复完整选项。",
      retryOriginal: true,
    });
  }
  if (match.option.requiresComment && !match.comment?.trim()) {
    throw new DevFlowError("DECISION_COMMENT_REQUIRED", "该选项需要补充说明。", { userMessage: "请补充一句具体说明后再提交。", recoveryKind: "retry", recoveryInstruction: "在选项后补充修改意见或风险说明。", retryOriginal: true });
  }
  return match;
}

export function pendingInteractionForDecision(state: FeatureState, decision: PendingDecision): UserInteraction | undefined {
  return pendingInteraction(state) ?? (decision.target
    ? Object.values(state.interactions ?? {}).find((value) => (value as UserInteraction).target === decision.target) as UserInteraction | undefined
    : undefined);
}
