import { isExplicitApproval } from "./approval.js";
import { DevFlowError } from "./errors.js";
import { normalizeReplyText, type InteractionOption, type UserInteraction } from "./user-interactions.js";
import type { FeatureState } from "./state-store.js";
import type { PendingDecision, PendingDecisionKind } from "../policy/types.js";

export interface PublicPendingDecision {
  kind: PendingDecisionKind;
  question: string;
  options: Array<{ label: string; description?: string; recommended: boolean; requiresComment: boolean }>;
}

export interface MatchedDecision {
  option: InteractionOption;
  comment?: string;
}

function pendingInteraction(state: FeatureState): UserInteraction | undefined {
  return Object.values(state.interactions ?? {}).find((value) => (value as UserInteraction).status === "pending") as UserInteraction | undefined;
}

export function pendingDecisionForState(state: FeatureState): PendingDecision | undefined {
  if (state.pendingDecision) return state.pendingDecision;
  const interaction = pendingInteraction(state);
  if (!interaction) return undefined;
  return {
    kind: interaction.kind === "risk-acceptance" ? "review-risk" : interaction.kind,
    question: interaction.question ?? "请选择一个方案。",
    options: interaction.options.map((option, index) => ({ ...option, recommended: index === 0 })),
    basisHash: interaction.basisHash,
    presentedAt: interaction.presentedAt,
    presentedRevision: state.revision,
    source: "core",
    target: interaction.target,
  };
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
      recommended: option.recommended ?? index === 0,
      requiresComment: Boolean(option.requiresComment),
    })),
  };
}

export function matchDecisionReply(
  decision: PendingDecision,
  userReply: string,
): MatchedDecision {
  const normalized = normalizeReplyText(userReply);
  if (!normalized) throw new DevFlowError("DECISION_REPLY_REQUIRED", "请回答当前问题。", { userMessage: "当前问题还没有得到回答。", recoveryKind: "retry", recoveryInstruction: "直接回复一个完整中文选项。", retryOriginal: true });
  const options = decision.options;
  let match: MatchedDecision | undefined;
  if (decision.kind === "approval" && isExplicitApproval(userReply)) {
    const option = options.find((candidate) => candidate.id === "confirm");
    if (option) match = { option };
  }
  if (!match) {
    for (const option of options) {
      const label = normalizeReplyText(option.label);
      if (label === normalized) {
        match = { option };
        break;
      }
      if (option.id !== "confirm" && normalized.startsWith(label) && normalized.length > label.length) {
        match = { option, comment: userReply.trim().slice(option.label.length).trim() };
        break;
      }
    }
  }
  if (!match) {
    throw new DevFlowError("DECISION_REPLY_NOT_RECOGNIZED", "回答没有精确匹配当前问题的选项。", {
      userMessage: "没有识别出当前问题的有效回答。",
      cause: "回答不是完整选项，也不是受支持的批准短语。",
      impact: "当前问题仍保持待回答，没有任何状态被改变。",
      recoveryKind: "retry",
      recoveryInstruction: "请直接复制一个中文选项的完整名称再回答。",
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
