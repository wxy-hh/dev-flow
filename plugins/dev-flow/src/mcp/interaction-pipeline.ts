import type { AnswerInput, AnswerResult } from "../core/interaction-answer.js";
import type { FeatureState } from "../core/state-store.js";
import {
  getInteraction,
  interactionResponse,
  toPublicInteraction,
  type PresentedInteraction,
  type PublicInteraction,
} from "../core/user-interactions.js";
import type { InteractionResponse } from "../policy/interaction.js";
import type { AttentionEvent } from "./attention.js";

/** elicit 归一后的用户选择。 */
export interface ElicitationSelection {
  action: string;
  comment?: string;
}

/**
 * 管道的协议端口：征询、attention 通知、落账全部由入口注入。
 * 注入使本模块进程内可测，并为 dispatch 导出（候选 3 方向）预演注入模式。
 */
export interface InteractionPipelinePorts {
  elicit: (interaction: PublicInteraction, question: string) => Promise<ElicitationSelection | undefined>;
  notify: (event: Extract<AttentionEvent, { kind: "decision-required" }>) => void;
  answer: (input: AnswerInput) => Promise<AnswerResult>;
}

export interface ElicitAndAnswerSpec {
  root: string;
  featureId: string;
  host: "claude" | "codex";
  /** attention 通知的 decision 标签（枚举随 AttentionEvent）。 */
  decision: Extract<AttentionEvent, { kind: "decision-required" }>["decision"];
  approvalId?: string;
  /** elicit 的提示文案；回落链（如 interaction.presentation ?? question ?? 默认）由调用方算好传入。 */
  question: string;
  /** 无选择时的 outcome，默认 "pending"。 */
  pendingOutcome?: string;
  /** 附加到两个分支返回对象的字段（如 decisionId、preview）。 */
  extra?: Record<string, unknown>;
}

/** A consistent result shape for every native or text interaction operation. */
export function interactionEnvelope(
  state: FeatureState,
  interaction: PublicInteraction,
  interactionOutcome: string,
  response?: InteractionResponse,
) {
  const optionLabel = interaction.options.find((option) => option.id === interactionOutcome)?.label;
  return {
    state,
    interaction,
    interactionOutcome: optionLabel ?? interactionOutcome,
    ...(response ? { response: {
      action: optionLabel ?? response.action,
      ...(response.kind ? { kind: response.kind } : {}),
      ...(response.answerCode ? { answerCode: response.answerCode } : {}),
      ...(response.selectedOptionId ? { selectedOptionId: response.selectedOptionId } : {}),
      ...(response.rawReply ? { rawReply: response.rawReply } : {}),
      ...(response.comment ? { comment: response.comment } : {}),
    } } : {}),
  };
}

/**
 * 「呈现 → 通知 → 征询 → 落账 → 包装」管道的收拢内核。
 * present 是各 case 的异质部分（参数与早退各异），留在 case 内；这里只收
 * 100% 同构的后半段。pending 语义、envelope 形状、optionLabel 映射全局仅此一份。
 */
export async function elicitAndAnswer(
  ports: InteractionPipelinePorts,
  presentation: PresentedInteraction,
  spec: ElicitAndAnswerSpec,
) {
  ports.notify({
    kind: "decision-required",
    featureId: spec.featureId,
    decision: spec.decision,
    ...(spec.approvalId ? { approvalId: spec.approvalId } : {}),
  });
  const selection = await ports.elicit(presentation.interaction, spec.question);
  if (!selection) {
    return { ...interactionEnvelope(presentation.state, presentation.interaction, spec.pendingOutcome ?? "pending"), ...spec.extra };
  }
  const next = await ports.answer({
    root: spec.root,
    featureId: spec.featureId,
    expectedRevision: presentation.state.revision,
    host: spec.host,
    credential: { source: "elicitation", action: selection.action, comment: selection.comment },
  });
  const response = interactionResponse(next.state, presentation.interactionId);
  return {
    ...interactionEnvelope(
      next.state,
      toPublicInteraction(getInteraction(next.state, presentation.interactionId)),
      response?.action ?? selection.action,
      response,
    ),
    ...spec.extra,
  };
}
